import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ARTIST_IDS, MAX_MESSAGE_LENGTH, MODE_IDS } from '../config/constants';
import { USE_MOCK_LLM } from '../config/env';
import { getAllCathyFewShots, getCathyModeFewShots } from '../data/cathy-gauthier/modeFewShots';
import { getLanguage } from '../i18n';
import type { ChatError } from '../models/ChatError';
import type { ChatSendPayload } from '../models/ChatSendPayload';
import type { Conversation } from '../models/Conversation';
import type { Message } from '../models/Message';
import type { ClaudeContentBlock, ClaudeMessage } from '../services/claudeApiService';
import { streamClaudeResponse } from '../services/claudeApiService';
import { detectImageIntent, type ImageIntent } from '../services/imageIntentService';
import { streamMockReply } from '../services/mockLlmService';
import { buildSystemPromptForArtist, formatConversationHistory } from '../services/personalityEngineService';
import { saveMemoryFacts } from '../services/profileService';
import { addScore } from '../services/scoreManager';
import { fetchAndCacheVoice } from '../services/ttsService';
import { useStore } from '../store/useStore';
import { resolveLanguageForTurn } from '../utils/conversationLanguage';
import { findConversationById } from '../utils/conversationUtils';
import { generateId } from '../utils/generateId';
import { collectArtistMemoryFacts } from '../utils/memoryFacts';
import { normalizeSpeechText, splitDisplayChunkFromRaw, stripAudioTags } from '../utils/audioTags';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../utils/accountTypeUtils';
import type { ScoreAction } from '../models/Gamification';
import { computeTutorialModeForRequest, isAffectionateUserMessage, shouldApplyReactionForUserMessage } from './chatBehavior';
import { resolveChatSendContextFromState, type ChatSendContextBlockReason } from './chatSendContext';
import { useAudioPlayer } from './useAudioPlayer';
import { useGamificationReactions } from './useGamificationReactions';
import { useQuotaGuard } from './useQuotaGuard';
import {
  buildCathyVoiceNotice,
  MIN_TTS_CHUNK_CHARS,
  NOTICE_AUDIO_SYNC_FINISH_WAIT_MS,
  NOTICE_AUDIO_SYNC_POLL_MS,
  NOTICE_AUDIO_SYNC_START_WAIT_MS,
  resolveTerminalTtsCode,
  shouldShowUpgradeForTtsCode,
  sleep,
  useTtsPlayback,
  type TerminalTtsCode,
  type VoiceErrorCode
} from './useTtsPlayback';

interface StreamJob {
  conversationId: string;
  artistMessageId: string;
  userMessageId: string;
  artistId: string;
  mockUserTurn: string;
  claudeUserMessage: ClaudeMessage;
  systemPrompt: string;
  history: ClaudeMessage[];
  language: string;
  modeFewShots: ReturnType<typeof getCathyModeFewShots>;
  modeId: string;
  imageIntent: ImageIntent;
  tutorialMode: boolean;
}

const EMPTY_MESSAGES: Message[] = [];
const MAX_CLAUDE_HISTORY_MESSAGES = 39;
const VOICE_MAX_CLAUDE_HISTORY_MESSAGES = 8;
export {
  buildCathyVoiceNotice,
  resolveTerminalTtsCode,
  shouldShowUpgradeForTtsCode,
  type TerminalTtsCode,
  type VoiceErrorCode
};


function buildMemoryPrimerMessage(facts: string[], language: string): ClaudeMessage | null {
  if (!facts.length) {
    return null;
  }

  const isEnglish = language.toLowerCase().startsWith('en');
  const content = isEnglish
    ? `MEMORY HINTS ABOUT USER (shared earlier, reuse only when relevant):\n${facts
        .map((fact) => `- ${fact}`)
        .join('\n')}\nUse at most 1-2 hints per reply and avoid repeating the same one every turn.`
    : `RAPPEL MEMOIRE UTILISATEUR (infos deja partagees, a reutiliser seulement si pertinent) :\n${facts
        .map((fact) => `- ${fact}`)
        .join('\n')}\nUtilise 1-2 rappels max par reponse et evite de repeter la meme info a chaque tour.`;

  return {
    role: 'assistant',
    content
  };
}

function buildLanguageSwitchClarificationMessage(language: string): string {
  if (language.toLowerCase().startsWith('en')) {
    return 'I can switch languages. Please send the language code (for example: en, es-ES, pt-BR).';
  }

  return 'Je peux changer de langue. Ecris le code langue (ex: en, es-ES, pt-BR).';
}


function createClaudeUserContent(text: string, payload: ChatSendPayload): string | ClaudeContentBlock[] {
  if (!payload.image) {
    return text;
  }

  const blocks: ClaudeContentBlock[] = [];
  if (text) {
    blocks.push({ type: 'text', text });
  }

  blocks.push({
    type: 'image',
    source: {
      type: 'base64',
      media_type: payload.image.mediaType,
      data: payload.image.base64
    }
  });

  return blocks;
}

function createMockUserTurn(text: string, hasImage: boolean): string {
  if (!hasImage) {
    return text;
  }

  return text ? `${text}\n[Image jointe]` : '[Image jointe]';
}

function getImageIntentPromptPrefix(intent: ImageIntent): string {
  switch (intent) {
    case 'photo-roast':
      return 'INTENT IMAGE: Tu recu une photo a roaster. Analyse visuelle + humour specifique.';
    case 'meme-generator':
      return 'INTENT IMAGE: Genere des captions courtes et partageables pour un meme.';
    case 'screenshot-analyzer':
      return 'INTENT IMAGE: Lis le screenshot comme un texto (interet + style), puis donne un verdict et UNE replique utile.';
    default:
      return '';
  }
}

function resolveModeFewShotsForConversation(conversation: Conversation): ReturnType<typeof getCathyModeFewShots> {
  if (!conversation.modeId || conversation.artistId !== ARTIST_IDS.CATHY_GAUTHIER) {
    return [];
  }

  const dedicated = getCathyModeFewShots(conversation.modeId);
  return dedicated.length > 0 ? dedicated : getAllCathyFewShots();
}

export function useChat(conversationId: string) {
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
  const appendMessageContent = useStore((state) => state.appendMessageContent);
  const getMessages = useStore((state) => state.getMessages);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const markThresholdMessageShown = useStore((state) => state.markThresholdMessageShown);
  const setBlocked = useStore((state) => state.setBlocked);
  const popProfileChangeHints = useStore((state) => state.popProfileChangeHints);
  const applyLocalScoreAction = useStore((state) => state.applyScoreAction);
  const updateConversation = useStore((state) => state.updateConversation);
  const userProfile = useStore((state) => state.userProfile);
  const sessionDisplayName = useStore((state) => state.session?.user.displayName ?? null);
  const currentAccountType = useStore((state) => state.session?.user.accountType ?? 'free');
  const currentRole = useStore((state) => state.session?.user.role ?? null);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const isQuotaBlocked = useStore((state) => Boolean(state.quota.isBlocked));
  const artists = useStore((state) => state.artists);
  const audioPlayer = useAudioPlayer();
  const { extractReadyTtsChunks, resolveVoiceErrorCode } = useTtsPlayback();
  const { detectBattleResult, extractReactionTag, reactionToScoreAction, resolveScoreActions } = useGamificationReactions();
  const { buildQuotaBlockedMessage, evaluatePostReplyQuota, isQuotaBlockedErrorCode } = useQuotaGuard({
    markThresholdMessageShown,
    setBlocked
  });

  const messages = useStore(
    useCallback((state) => state.messagesByConversation[conversationId]?.messages ?? EMPTY_MESSAGES, [conversationId])
  );

  const currentConversation = useStore(
    useCallback((state) => findConversationById(state.conversations, conversationId), [conversationId])
  );

  const currentArtist = useMemo(
    () => artists.find((artist) => artist.id === currentConversation?.artistId) ?? null,
    [artists, currentConversation?.artistId]
  );

  const queueRef = useRef<StreamJob[]>([]);
  const isStreamingRef = useRef(false);
  const runNextLockRef = useRef(false);
  const failedJobsRef = useRef<Map<string, StreamJob>>(new Map());
  const activeMessageIdRef = useRef<string | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const streamInstanceIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isCancelledRef = useRef(false);
  const cancelRef = useRef<null | (() => void)>(null);
  const bufferedTokensRef = useRef('');
  const flushBufferedTokensRef = useRef<null | (() => void)>(null);
  const flushFrameRef = useRef<number | null>(null);
  const displayPendingTagRef = useRef('');
  const rawTtsResponseRef = useRef('');
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const audioPlaybackStateRef = useRef({
    isPlaying: audioPlayer.isPlaying,
    isLoading: audioPlayer.isLoading,
    currentMessageId: audioPlayer.currentMessageId
  });

  const sendContextBlockReason = useMemo<ChatSendContextBlockReason | null>(() => {
    if (!conversationId.trim()) {
      return 'missing_conversation_id';
    }
    if (!currentConversation) {
      return 'missing_conversation';
    }
    if (!currentArtist) {
      return 'missing_artist';
    }
    return null;
  }, [conversationId, currentArtist, currentConversation]);

  const isSendContextReady = sendContextBlockReason === null;

  useEffect(() => {
    audioPlaybackStateRef.current = {
      isPlaying: audioPlayer.isPlaying,
      isLoading: audioPlayer.isLoading,
      currentMessageId: audioPlayer.currentMessageId
    };
  }, [audioPlayer.currentMessageId, audioPlayer.isLoading, audioPlayer.isPlaying]);

  const runNext = useCallback(() => {
    if (runNextLockRef.current || !isMountedRef.current) {
      return;
    }

    runNextLockRef.current = true;

    try {
      if (isStreamingRef.current) {
        return;
      }

      const nextJob = queueRef.current.shift();
      if (!nextJob) {
        return;
      }

      const {
        conversationId: queuedConversationId,
        artistMessageId,
        userMessageId,
        artistId,
        mockUserTurn,
        claudeUserMessage,
        systemPrompt,
        history,
        language,
        modeFewShots,
        modeId,
        imageIntent,
        tutorialMode
      } = nextJob;
      const jobConversationId = queuedConversationId.trim();
      if (!jobConversationId) {
        return;
      }
      const conversationModeEnabledForJob = useStore.getState().conversationModeEnabled;
      const voiceModeAddendum = conversationModeEnabledForJob
        ? '\n\n## VOICE MODE\nKeep this answer to 1-2 sentences maximum. You are live. No lists, no long explanations.'
        : '';
      const effectiveSystemPrompt = `${systemPrompt}${voiceModeAddendum}`;
      isStreamingRef.current = true;
      activeMessageIdRef.current = artistMessageId;
      streamingConversationIdRef.current = jobConversationId;
      const streamInstanceId = streamInstanceIdRef.current + 1;
      streamInstanceIdRef.current = streamInstanceId;
      isCancelledRef.current = false;
      bufferedTokensRef.current = '';
      displayPendingTagRef.current = '';
      rawTtsResponseRef.current = '';

      const isCurrentStream = () =>
        isMountedRef.current &&
        !isCancelledRef.current &&
        streamInstanceIdRef.current === streamInstanceId &&
        streamingConversationIdRef.current === jobConversationId &&
        activeMessageIdRef.current === artistMessageId;

      const flushBufferedTokens = () => {
        if (!isCurrentStream()) {
          bufferedTokensRef.current = '';
          return;
        }
        if (!bufferedTokensRef.current) {
          return;
        }

        const chunk = bufferedTokensRef.current;
        bufferedTokensRef.current = '';
        const mergedChunk = `${displayPendingTagRef.current}${chunk}`;
        const { displayChunk, pendingChunk } = splitDisplayChunkFromRaw(mergedChunk);
        displayPendingTagRef.current = pendingChunk;
        if (displayChunk) {
          appendMessageContent(jobConversationId, artistMessageId, displayChunk);
        }
      };
      flushBufferedTokensRef.current = flushBufferedTokens;

      const scheduleFlush = () => {
        if (flushFrameRef.current !== null) {
          return;
        }

        if (typeof requestAnimationFrame !== 'function') {
          flushBufferedTokens();
          return;
        }

        flushFrameRef.current = requestAnimationFrame(() => {
          flushFrameRef.current = null;
          if (!isCurrentStream()) {
            return;
          }
          flushBufferedTokens();
        });
      };

      const resetStreamState = () => {
        if (flushFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(flushFrameRef.current);
          flushFrameRef.current = null;
        }

        flushBufferedTokens();
        isStreamingRef.current = false;
        activeMessageIdRef.current = null;
        streamingConversationIdRef.current = null;
        streamInstanceIdRef.current += 1;
        isCancelledRef.current = false;
        cancelRef.current = null;
        flushBufferedTokensRef.current = null;
        bufferedTokensRef.current = '';
        displayPendingTagRef.current = '';
        rawTtsResponseRef.current = '';
      };

      const getLatestArtistMessage = (): Message | null => {
        const latestMessages = useStore.getState().messagesByConversation[jobConversationId]?.messages ?? [];
        return latestMessages.find((message) => message.id === artistMessageId) ?? null;
      };

      const mergeArtistMetadata = (metadataPatch: NonNullable<Message['metadata']>) => {
        const latestArtistMessage = getLatestArtistMessage();
        updateMessage(jobConversationId, artistMessageId, {
          metadata: {
            ...(latestArtistMessage?.metadata ?? {}),
            ...metadataPatch
          }
        });
      };

      const getLatestMessageById = (messageId: string): Message | null => {
        const latestMessages = useStore.getState().messagesByConversation[jobConversationId]?.messages ?? [];
        return latestMessages.find((message) => message.id === messageId) ?? null;
      };

      const mergeMessageMetadata = (messageId: string, metadataPatch: NonNullable<Message['metadata']>) => {
        const latestMessage = getLatestMessageById(messageId);
        updateMessage(jobConversationId, messageId, {
          metadata: {
            ...(latestMessage?.metadata ?? {}),
            ...metadataPatch
          }
        });
      };

      const latestSessionUser = useStore.getState().session?.user;
      const latestAccessTokenForJob = useStore.getState().session?.accessToken ?? accessToken;
      const latestAccountType = resolveEffectiveAccountType(
        latestSessionUser?.accountType ?? currentAccountType,
        latestSessionUser?.role ?? currentRole
      );
      const canGenerateVoice =
        artistId === ARTIST_IDS.CATHY_GAUTHIER &&
        hasVoiceAccessForAccountType(latestAccountType) &&
        Boolean(latestAccessTokenForJob.trim());
      const shouldUseChunkedTts = conversationModeEnabledForJob;
      const markMessageVoiceUnavailable = (messageId: string, code: VoiceErrorCode) => {
        mergeMessageMetadata(messageId, {
          voiceStatus: 'unavailable',
          voiceErrorCode: code,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });
      };
      const synthesizeNoticeVoice = (
        messageId: string,
        content: string,
        options?: {
          queueOnly?: boolean;
          expectedCurrentMessageId?: string | null;
        }
      ) => {
        if (!canGenerateVoice) {
          return;
        }

        const normalizedNotice = normalizeSpeechText(content, { trim: true });
        if (!normalizedNotice) {
          return;
        }

        const latestAccessToken = useStore.getState().session?.accessToken ?? accessToken;
        if (!latestAccessToken.trim()) {
          return;
        }

        mergeMessageMetadata(messageId, {
          voiceStatus: 'generating',
          voiceErrorCode: undefined,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });

        void fetchAndCacheVoice(normalizedNotice, artistId, language, latestAccessToken, {
          throwOnError: true,
          purpose: 'reply'
        })
          .then((uri) => {
            if (!uri) {
              markMessageVoiceUnavailable(messageId, 'TTS_PROVIDER_ERROR');
              return;
            }

            const boundary = stripAudioTags(normalizedNotice, { trim: true }).length;
            mergeMessageMetadata(messageId, {
              voiceStatus: 'ready',
              voiceErrorCode: undefined,
              voiceUrl: uri,
              voiceQueue: [uri],
              voiceChunkBoundaries: [boundary]
            });

            if (useStore.getState().voiceAutoPlay) {
              const playbackState = audioPlaybackStateRef.current;
              const hasActivePlayback = playbackState.isPlaying || playbackState.isLoading;
              const matchesExpectedMessage =
                !options?.expectedCurrentMessageId || playbackState.currentMessageId === options.expectedCurrentMessageId;
              if (hasActivePlayback && matchesExpectedMessage) {
                audioPlayer.appendToQueue(uri, { messageId });
              } else if (!options?.queueOnly) {
                void audioPlayer.play(uri, { messageId });
              }
            }
          })
          .catch((error: unknown) => {
            markMessageVoiceUnavailable(messageId, resolveVoiceErrorCode(error));
          });
      };
      const waitForReplyAudioToSettle = async (): Promise<void> => {
        if (!canGenerateVoice || !useStore.getState().voiceAutoPlay) {
          return;
        }

        const isReplyVoiceGenerating = () => {
          const latestArtistMessage = getLatestArtistMessage();
          return latestArtistMessage?.metadata?.voiceStatus === 'generating';
        };

        const isReplyAudioActive = () => {
          const playbackState = audioPlaybackStateRef.current;
          return (
            (playbackState.isPlaying || playbackState.isLoading) && playbackState.currentMessageId === artistMessageId
          );
        };

        const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (!isMountedRef.current) {
              return false;
            }
            if (predicate()) {
              return true;
            }
            await sleep(NOTICE_AUDIO_SYNC_POLL_MS);
          }
          return predicate();
        };

        if (isReplyVoiceGenerating()) {
          await waitFor(() => !isReplyVoiceGenerating(), NOTICE_AUDIO_SYNC_FINISH_WAIT_MS);
        }

        if (isReplyAudioActive()) {
          await waitFor(() => !isReplyAudioActive(), NOTICE_AUDIO_SYNC_FINISH_WAIT_MS);
          return;
        }

        const started = await waitFor(() => isReplyAudioActive(), NOTICE_AUDIO_SYNC_START_WAIT_MS);
        if (!started) {
          return;
        }

        await waitFor(() => !isReplyAudioActive(), NOTICE_AUDIO_SYNC_FINISH_WAIT_MS);
      };

      const enqueuePostReplyNotices = (
        notices: Array<{
          content: string;
          metadata: NonNullable<Message['metadata']>;
        }>,
        options?: {
          spoken?: boolean;
        }
      ) => {
        if (notices.length === 0) {
          return;
        }

        void (async () => {
          await waitForReplyAudioToSettle();
          if (!isMountedRef.current) {
            return;
          }

          for (const notice of notices) {
            const noticeMessageId = generateId('msg');
            addMessage(jobConversationId, {
              id: noticeMessageId,
              conversationId: jobConversationId,
              role: 'artist',
              content: notice.content,
              status: 'complete',
              timestamp: new Date().toISOString(),
              metadata: notice.metadata
            });

            if (options?.spoken ?? true) {
              synthesizeNoticeVoice(noticeMessageId, notice.content);
            }
          }
        })();
      };
      let ttsBuffer = '';
      let ttsChunkCount = 0;
      let hasStartedVoiceGeneration = false;
      let ignoreTtsUpdates = false;
      let hasDevLocalFallbackAttempt = false;
      const ttsChunkUrisByIndex = new Map<number, string>();
      const ttsChunkDisplayBoundariesByIndex = new Map<number, number>();
      const ttsPendingPromises: Array<Promise<void>> = [];
      let displayTextAccumulator = 0;
      let nextPlayableChunkIndex = 0;
      let hasQueuedAutoplayChunk = false;
      let pendingVoiceNoticeCode: TerminalTtsCode | null = null;
      let pendingVoiceErrorCode: VoiceErrorCode | null = null;

      const markArtistVoiceGenerating = () => {
        mergeArtistMetadata({
          voiceStatus: 'generating',
          voiceErrorCode: undefined,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });
      };

      const markArtistVoiceReady = (uri: string, queue: string[], boundaries: number[]) => {
        mergeArtistMetadata({
          voiceStatus: 'ready',
          voiceErrorCode: undefined,
          voiceUrl: uri,
          voiceQueue: queue,
          voiceChunkBoundaries: boundaries
        });
      };

      const markArtistVoiceUnavailable = (code: VoiceErrorCode) => {
        pendingVoiceErrorCode = code;
        mergeArtistMetadata({
          voiceStatus: 'unavailable',
          voiceErrorCode: code,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });
      };

      const registerTerminalTtsError = (error: unknown): boolean => {
        const terminalCode = resolveTerminalTtsCode(error);
        if (!terminalCode) {
          return false;
        }

        if (pendingVoiceNoticeCode === null) {
          pendingVoiceNoticeCode = terminalCode;
        }

        ignoreTtsUpdates = true;
        const { orderedVoiceUris, orderedBoundaries } = buildVoicePlaybackData();
        if (orderedVoiceUris.length > 0 && orderedVoiceUris[0]) {
          markArtistVoiceReady(orderedVoiceUris[0], orderedVoiceUris, orderedBoundaries);
        } else {
          markArtistVoiceUnavailable(terminalCode);
        }
        return true;
      };

      const buildVoicePlaybackData = () => {
        const orderedVoiceUris: string[] = [];
        const orderedBoundaries: number[] = [];
        let lastBoundary = 0;

        for (let index = 0; index < ttsChunkCount; index += 1) {
          const uri = ttsChunkUrisByIndex.get(index);
          if (!uri) {
            break;
          }

          const boundaryCandidate = ttsChunkDisplayBoundariesByIndex.get(index);
          if (typeof boundaryCandidate === 'number' && Number.isFinite(boundaryCandidate) && boundaryCandidate >= lastBoundary) {
            lastBoundary = boundaryCandidate;
          }

          orderedVoiceUris.push(uri);
          orderedBoundaries.push(lastBoundary);
        }

        return {
          orderedVoiceUris,
          orderedBoundaries
        };
      };

      const flushReadyPlaybackChunks = () => {
        if (!canGenerateVoice || ignoreTtsUpdates) {
          return;
        }

        const shouldAutoPlay = Boolean(useStore.getState().voiceAutoPlay) && !useStore.getState().quota.isBlocked;
        let didAdvance = false;

        while (ttsChunkUrisByIndex.has(nextPlayableChunkIndex)) {
          const uri = ttsChunkUrisByIndex.get(nextPlayableChunkIndex);
          if (uri && shouldAutoPlay) {
            if (nextPlayableChunkIndex === 0 && !hasQueuedAutoplayChunk) {
              // First real chunk interrupts any filler currently playing.
              void audioPlayer.playQueue([uri], { messageId: artistMessageId });
              hasQueuedAutoplayChunk = true;
            } else if (hasQueuedAutoplayChunk) {
              audioPlayer.appendToQueue(uri, { messageId: artistMessageId });
            }
          }
          nextPlayableChunkIndex += 1;
          didAdvance = true;
        }

        if (!didAdvance) {
          return;
        }

        const { orderedVoiceUris, orderedBoundaries } = buildVoicePlaybackData();
        const firstVoiceUri = orderedVoiceUris[0];
        if (!firstVoiceUri) {
          return;
        }

        markArtistVoiceReady(firstVoiceUri, orderedVoiceUris, orderedBoundaries);
      };

      const queueTtsChunk = (chunk: string, options?: { allowShortChunk?: boolean }) => {
        if (!canGenerateVoice || ignoreTtsUpdates) {
          return;
        }

        const normalizedChunk = normalizeSpeechText(chunk, { trim: true });
        if (normalizedChunk.length < MIN_TTS_CHUNK_CHARS && !options?.allowShortChunk) {
          return;
        }

        if (!hasStartedVoiceGeneration) {
          hasStartedVoiceGeneration = true;
          markArtistVoiceGenerating();
        }

        const chunkIndex = ttsChunkCount;
        ttsChunkCount += 1;
        const displayChunk = stripAudioTags(normalizedChunk, { trim: true });
        if (displayChunk) {
          const hasPreviousDisplay = displayTextAccumulator > 0;
          displayTextAccumulator += displayChunk.length;
          if (hasPreviousDisplay) {
            displayTextAccumulator += 1;
          }
        }
        ttsChunkDisplayBoundariesByIndex.set(chunkIndex, Math.max(displayTextAccumulator, 0));
        const latestAccessToken = useStore.getState().session?.accessToken ?? accessToken;

        const ttsPromise = fetchAndCacheVoice(normalizedChunk, artistId, language, latestAccessToken, {
          throwOnError: true
        })
          .then((uri) => {
            if (ignoreTtsUpdates) {
              return;
            }
            if (uri) {
              ttsChunkUrisByIndex.set(chunkIndex, uri);
              flushReadyPlaybackChunks();
              return;
            }
          })
          .catch((error: unknown) => {
            if (registerTerminalTtsError(error)) {
              return;
            }
          });

        ttsPendingPromises.push(ttsPromise);
      };

      const flushTtsChunks = (flushRemainder: boolean) => {
        if (!canGenerateVoice || ignoreTtsUpdates) {
          return;
        }

        const { chunks, remainder } = extractReadyTtsChunks(ttsBuffer, flushRemainder);
        ttsBuffer = remainder;
        chunks.forEach((chunk) => {
          queueTtsChunk(chunk, { allowShortChunk: flushRemainder });
        });
      };

      const onToken = (token: string) => {
        if (!isCurrentStream()) {
          return;
        }
        bufferedTokensRef.current += token;
        rawTtsResponseRef.current += token;
        if (canGenerateVoice) {
          if (shouldUseChunkedTts) {
            ttsBuffer += token;
          }
          if (shouldUseChunkedTts) {
            flushTtsChunks(false);
          }
        }
        scheduleFlush();
      };

      const onComplete = ({ tokensUsed }: { tokensUsed: number }) => {
        if (!isCurrentStream()) {
          return;
        }
        if (shouldUseChunkedTts) {
          flushTtsChunks(true);
        }
        const latestArtistMessage = getLatestArtistMessage();
        const rawFinalContent = latestArtistMessage?.content ?? '';
        const finalContent = stripAudioTags(rawFinalContent);
        const fallbackContentFromStream = stripAudioTags(rawTtsResponseRef.current);
        const resolvedFinalContent =
          finalContent.trim().length > 0 || fallbackContentFromStream.trim().length === 0
            ? finalContent
            : fallbackContentFromStream;
        if (resolvedFinalContent !== rawFinalContent) {
          updateMessage(jobConversationId, artistMessageId, {
            content: resolvedFinalContent
          });
        }
        if (__DEV__ && resolvedFinalContent.trim().length === 0) {
          console.warn('[useChat] artist_empty_content_after_complete', {
            conversationId: jobConversationId,
            artistMessageId,
            rawMessageLength: rawFinalContent.length,
            rawStreamLength: rawTtsResponseRef.current.length
          });
        }
        const battleResult =
          modeId === MODE_IDS.ROAST_BATTLE ? detectBattleResult(resolvedFinalContent) : null;
        const scoreActionSet = new Set<ScoreAction>(resolveScoreActions(modeId, imageIntent, battleResult));
        const { reaction: parsedCathyReaction } = extractReactionTag(rawTtsResponseRef.current);
        const latestMessages = useStore.getState().messagesByConversation[jobConversationId]?.messages ?? [];
        const userMessage = latestMessages.find((message) => message.id === userMessageId) ?? null;
        const autoAffectionReaction =
          !parsedCathyReaction && isAffectionateUserMessage(userMessage?.content) ? '❤️' : null;
        const cathyReaction = parsedCathyReaction ?? autoAffectionReaction;

        if (cathyReaction && shouldApplyReactionForUserMessage(latestMessages, userMessageId)) {
          updateMessage(jobConversationId, userMessageId, {
            metadata: {
              ...(userMessage?.metadata ?? {}),
              cathyReaction
            }
          });
          const reactionScoreAction = reactionToScoreAction(cathyReaction);
          if (reactionScoreAction) {
            scoreActionSet.add(reactionScoreAction);
          }
        }

        failedJobsRef.current.delete(artistMessageId);
        updateMessage(jobConversationId, artistMessageId, {
          status: 'complete',
          metadata: {
            ...(latestArtistMessage?.metadata ?? {}),
            tokensUsed,
            battleResult: battleResult ?? undefined
          }
        });
        incrementUsage();
        const latestStateAfterReply = useStore.getState();
        const latestUserId = latestStateAfterReply.session?.user.id ?? '';
        if (latestUserId) {
          const latestMemoryFacts = collectArtistMemoryFacts(latestStateAfterReply, artistId, jobConversationId);
          if (latestMemoryFacts.length > 0) {
            void saveMemoryFacts(latestUserId, latestMemoryFacts).catch((error: unknown) => {
              if (__DEV__) {
                console.warn('[useChat] saveMemoryFacts failed', error);
              }
            });
          }
        }
        const latestState = useStore.getState();
        const latestQuota = latestState.quota;
        const normalizedAccountType = resolveEffectiveAccountType(
          latestState.session?.user.accountType ?? currentAccountType,
          latestState.session?.user.role ?? currentRole
        );
        const { postReplyNotices, shouldBlockInput } = evaluatePostReplyQuota(latestQuota, normalizedAccountType);
        if (canGenerateVoice && !ignoreTtsUpdates) {
          const fallbackPreviewText = normalizeSpeechText(rawTtsResponseRef.current, { trim: true });
          if (!hasStartedVoiceGeneration && fallbackPreviewText) {
            hasStartedVoiceGeneration = true;
            markArtistVoiceGenerating();
          }

          if (!shouldUseChunkedTts) {
            void (async () => {
              if (!fallbackPreviewText) {
                markArtistVoiceUnavailable('TTS_PROVIDER_ERROR');
                return;
              }

              const fallbackAccessToken = useStore.getState().session?.accessToken ?? accessToken;
              if (!fallbackAccessToken.trim()) {
                markArtistVoiceUnavailable('UNAUTHORIZED');
                return;
              }

              try {
                const uri = await fetchAndCacheVoice(fallbackPreviewText, artistId, language, fallbackAccessToken, {
                  throwOnError: true
                });
                if (!isCurrentStream()) {
                  return;
                }
                if (!uri) {
                  markArtistVoiceUnavailable('TTS_PROVIDER_ERROR');
                  return;
                }

                const normalizedTextLength = stripAudioTags(fallbackPreviewText, { trim: true }).length;
                markArtistVoiceReady(uri, [uri], [normalizedTextLength]);

                const shouldAutoPlay = Boolean(useStore.getState().voiceAutoPlay);
                if (shouldAutoPlay && !shouldBlockInput) {
                  void audioPlayer.playQueue([uri], { messageId: artistMessageId });
                }
              } catch (error: unknown) {
                if (registerTerminalTtsError(error)) {
                  return;
                }
                markArtistVoiceUnavailable(resolveVoiceErrorCode(error));
              }
            })();
          } else {
            void Promise.allSettled(ttsPendingPromises).then(async () => {
              if (!isCurrentStream() || ignoreTtsUpdates) {
                return;
              }

              let { orderedVoiceUris, orderedBoundaries } = buildVoicePlaybackData();
              const fallbackText = normalizeSpeechText(rawTtsResponseRef.current, { trim: true });
              const fallbackAccessToken = useStore.getState().session?.accessToken ?? accessToken;

              // Recover gracefully from short replies and per-chunk failures.
              if (orderedVoiceUris.length === 0 && fallbackText && fallbackAccessToken.trim()) {
                try {
                  const fallbackUri = await fetchAndCacheVoice(fallbackText, artistId, language, fallbackAccessToken, {
                    throwOnError: true
                  });
                  if (fallbackUri) {
                    orderedVoiceUris = [fallbackUri];
                    orderedBoundaries = [stripAudioTags(fallbackText, { trim: true }).length];
                  }
                } catch (error: unknown) {
                  registerTerminalTtsError(error);
                  // Silent failure: keep existing voice chunks when available.
                }
              }

              if (ignoreTtsUpdates) {
                return;
              }

              if (orderedVoiceUris.length === 0) {
                markArtistVoiceUnavailable(pendingVoiceErrorCode ?? 'TTS_PROVIDER_ERROR');
                return;
              }

              const firstVoiceUri = orderedVoiceUris[0];
              if (!firstVoiceUri) {
                markArtistVoiceUnavailable(pendingVoiceErrorCode ?? 'TTS_PROVIDER_ERROR');
                return;
              }
              markArtistVoiceReady(firstVoiceUri, orderedVoiceUris, orderedBoundaries);

              const shouldAutoPlay = Boolean(useStore.getState().voiceAutoPlay);
              if (shouldAutoPlay && !shouldBlockInput && !hasQueuedAutoplayChunk) {
                void audioPlayer.playQueue(orderedVoiceUris, { messageId: artistMessageId });
              }
            });
          }
        }
        if (pendingVoiceNoticeCode) {
          const showUpgradeCta =
            shouldShowUpgradeForTtsCode(pendingVoiceNoticeCode) && normalizedAccountType !== 'admin';
          const noticeMetadata: NonNullable<Message['metadata']> = {
            injected: true,
            errorCode: pendingVoiceNoticeCode
          };
          if (showUpgradeCta) {
            noticeMetadata.showUpgradeCta = true;
            noticeMetadata.upgradeFromTier = normalizedAccountType;
          }

          postReplyNotices.push({
            content: buildCathyVoiceNotice(pendingVoiceNoticeCode),
            metadata: noticeMetadata
          });
        }
        if (postReplyNotices.length > 0) {
          enqueuePostReplyNotices(postReplyNotices, {
            spoken: true
          });
        }
        if (scoreActionSet.size > 0) {
          void (async () => {
            for (const action of scoreActionSet) {
              try {
                await addScore(action);
              } catch (error) {
                applyLocalScoreAction(action);
                if (__DEV__) {
                  console.warn('[useChat] score action failed', action, error);
                }
              }
            }
          })();
        }
        resetStreamState();
        runNext();
      };

      const failStream = (error: Error) => {
        ignoreTtsUpdates = true;
        if (!isCurrentStream()) {
          return;
        }
        const errorWithMeta = error as Error & { code?: string; status?: number };
        const errorCode = typeof errorWithMeta.code === 'string' ? errorWithMeta.code : null;
        const statusCode = typeof errorWithMeta.status === 'number' ? errorWithMeta.status : null;
        const message = error instanceof Error && typeof error.message === 'string' && error.message.trim()
          ? error.message.trim()
          : 'Erreur pendant la génération';
        if (isQuotaBlockedErrorCode(errorCode)) {
          const latestSessionUser = useStore.getState().session?.user;
          const latestAccountType = resolveEffectiveAccountType(
            latestSessionUser?.accountType ?? currentAccountType,
            latestSessionUser?.role ?? currentRole
          );
          if (latestAccountType === 'admin') {
            failedJobsRef.current.set(artistMessageId, nextJob);
            updateMessage(jobConversationId, artistMessageId, {
              content: message,
              status: 'error',
              metadata: {
                errorMessage: message,
                errorCode: errorCode ?? undefined
              }
            });
            resetStreamState();
            runNext();
            return;
          }
          const quotaMessage = buildQuotaBlockedMessage(latestAccountType);
          failedJobsRef.current.delete(artistMessageId);
          updateMessage(jobConversationId, artistMessageId, {
            content: quotaMessage,
            status: 'complete',
            metadata: {
              injected: true,
              showUpgradeCta: true,
              upgradeFromTier: latestAccountType,
              errorCode: errorCode ?? undefined
            }
          });
          synthesizeNoticeVoice(artistMessageId, quotaMessage);
          resetStreamState();
          runNext();
          return;
        }
        const shouldUseDevFallback =
          __DEV__ &&
          !USE_MOCK_LLM &&
          !hasDevLocalFallbackAttempt &&
          !isQuotaBlockedErrorCode(errorCode) &&
          (statusCode === null ||
            statusCode >= 500 ||
            (typeof errorCode === 'string' && errorCode.startsWith('UPSTREAM')) ||
            /failed to fetch|internal server error|server misconfigured|impossible de joindre/i.test(message));

        if (shouldUseDevFallback) {
          hasDevLocalFallbackAttempt = true;
          ignoreTtsUpdates = true;
          const latestArtistMessage = getLatestArtistMessage();
          updateMessage(jobConversationId, artistMessageId, {
            status: 'streaming',
            metadata: {
              ...(latestArtistMessage?.metadata ?? {}),
              errorMessage: undefined,
              errorCode: undefined
            }
          });
          if (__DEV__) {
            console.warn('[Chat] Falling back to mock stream after Claude error', {
              statusCode,
              errorCode,
              message
            });
          }

          const fallbackCancel = streamMockReply({
            systemPrompt: effectiveSystemPrompt,
            userTurn: mockUserTurn,
            language,
            modeFewShots,
            modeId,
            onToken,
            onComplete,
            onError: failStream
          });
          cancelRef.current = () => {
            isCancelledRef.current = true;
            fallbackCancel();
          };
          return;
        }

        if (__DEV__) {
          console.error('[Chat] Generation failed:', message);
        }
        failedJobsRef.current.set(artistMessageId, nextJob);
        updateMessage(jobConversationId, artistMessageId, {
          status: 'error',
          metadata: {
            errorMessage: message,
            errorCode: errorCode ?? undefined
          }
        });
        resetStreamState();
        runNext();
      };

      const startMockStream = () =>
        streamMockReply({
          systemPrompt: effectiveSystemPrompt,
          userTurn: mockUserTurn,
          language,
          modeFewShots,
          modeId,
          onToken,
          onComplete,
          onError: failStream
        });

      const startClaudeStream = () =>
        streamClaudeResponse({
          artistId,
          modeId,
          language,
          tutorialMode,
          messages: [...history, claudeUserMessage],
          imageIntent,
          onToken,
          onComplete,
          onError: failStream
        });

      const rawCancel = USE_MOCK_LLM ? startMockStream() : startClaudeStream();

      cancelRef.current = () => {
        isCancelledRef.current = true;
        rawCancel();
      };
    } finally {
      runNextLockRef.current = false;
    }
  }, [
    addMessage,
    applyLocalScoreAction,
    appendMessageContent,
    audioPlayer,
    accessToken,
    buildQuotaBlockedMessage,
    currentAccountType,
    currentRole,
    detectBattleResult,
    evaluatePostReplyQuota,
    extractReactionTag,
    extractReadyTtsChunks,
    incrementUsage,
    isQuotaBlockedErrorCode,
    reactionToScoreAction,
    resolveScoreActions,
    resolveVoiceErrorCode,
    updateMessage
  ]);

  const retryMessage = useCallback(
    (artistMessageId: string) => {
      if (!artistMessageId || isStreamingRef.current) {
        return;
      }

      const failedJob = failedJobsRef.current.get(artistMessageId);
      if (!failedJob) {
        return;
      }
      const targetConversationId = failedJob.conversationId.trim();
      if (!targetConversationId) {
        return;
      }

      failedJobsRef.current.delete(artistMessageId);
      updateMessage(targetConversationId, artistMessageId, {
        content: '',
        status: 'pending',
        metadata: undefined
      });
      queueRef.current.unshift(failedJob);
      runNext();
    },
    [runNext, updateMessage]
  );

  const retryVoiceForMessage = useCallback(
    async (artistMessageId: string): Promise<void> => {
      const targetConversationId = conversationIdRef.current.trim();
      if (!artistMessageId || !targetConversationId) {
        return;
      }

      const latestState = useStore.getState();
      const sendContext = resolveChatSendContextFromState(latestState, targetConversationId);
      if (!sendContext.conversation || !sendContext.artist || sendContext.reason !== null) {
        return;
      }

      if (sendContext.conversation.artistId !== ARTIST_IDS.CATHY_GAUTHIER) {
        return;
      }

      const latestSessionUser = latestState.session?.user;
      const latestAccessToken = latestState.session?.accessToken ?? accessToken;
      const latestAccountType = resolveEffectiveAccountType(
        latestSessionUser?.accountType ?? currentAccountType,
        latestSessionUser?.role ?? currentRole
      );

      const latestMessage =
        latestState.messagesByConversation[targetConversationId]?.messages.find((message) => message.id === artistMessageId) ??
        null;
      const normalizedContent = normalizeSpeechText(latestMessage?.content ?? '', { trim: true });
      if (!latestMessage || latestMessage.role !== 'artist' || latestMessage.status !== 'complete' || !normalizedContent) {
        return;
      }

      if (!hasVoiceAccessForAccountType(latestAccountType) || !latestAccessToken.trim()) {
        updateMessage(targetConversationId, artistMessageId, {
          metadata: {
            ...(latestMessage.metadata ?? {}),
            voiceStatus: 'unavailable',
            voiceErrorCode: 'UNAUTHORIZED',
            voiceUrl: undefined,
            voiceQueue: undefined,
            voiceChunkBoundaries: undefined
          }
        });
        return;
      }

      updateMessage(targetConversationId, artistMessageId, {
        metadata: {
          ...(latestMessage.metadata ?? {}),
          voiceStatus: 'generating',
          voiceErrorCode: undefined,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        }
      });

      try {
        const uri = await fetchAndCacheVoice(
          normalizedContent,
          sendContext.conversation.artistId,
          sendContext.conversation.language || getLanguage(),
          latestAccessToken,
          {
            throwOnError: true
          }
        );

        const refreshedMessage =
          useStore
            .getState()
            .messagesByConversation[targetConversationId]
            ?.messages.find((message) => message.id === artistMessageId) ?? latestMessage;

        if (!uri) {
          updateMessage(targetConversationId, artistMessageId, {
            metadata: {
              ...(refreshedMessage?.metadata ?? {}),
              voiceStatus: 'unavailable',
              voiceErrorCode: 'TTS_PROVIDER_ERROR',
              voiceUrl: undefined,
              voiceQueue: undefined,
              voiceChunkBoundaries: undefined
            }
          });
          return;
        }

        const boundary = stripAudioTags(normalizedContent, { trim: true }).length;
        updateMessage(targetConversationId, artistMessageId, {
          metadata: {
            ...(refreshedMessage?.metadata ?? {}),
            voiceStatus: 'ready',
            voiceErrorCode: undefined,
            voiceUrl: uri,
            voiceQueue: [uri],
            voiceChunkBoundaries: [boundary]
          }
        });

        if (useStore.getState().voiceAutoPlay) {
          void audioPlayer.playQueue([uri], { messageId: artistMessageId });
        }
      } catch (error: unknown) {
        const latestMessageAfterFailure =
          useStore
            .getState()
            .messagesByConversation[targetConversationId]
            ?.messages.find((message) => message.id === artistMessageId) ?? latestMessage;
        updateMessage(targetConversationId, artistMessageId, {
          metadata: {
            ...(latestMessageAfterFailure?.metadata ?? {}),
            voiceStatus: 'unavailable',
            voiceErrorCode: resolveVoiceErrorCode(error),
            voiceUrl: undefined,
            voiceQueue: undefined,
            voiceChunkBoundaries: undefined
          }
        });
      }
    },
    [accessToken, audioPlayer, currentAccountType, currentRole, resolveVoiceErrorCode, updateMessage]
  );

  const sendMessage = (
    payload: ChatSendPayload,
    options?: {
      conversationId?: string;
    }
  ): ChatError | null => {
    const trimmed = payload.text.trim();
    const hasImage = Boolean(payload.image);

    if (isQuotaBlocked) {
      if (__DEV__) {
        console.warn('[useChat] send_blocked', {
          reason: 'quota_blocked',
          conversationId: conversationIdRef.current.trim()
        });
      }
      return null;
    }

    if (!trimmed && !hasImage) {
      return null;
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { code: 'messageTooLong', maxLength: MAX_MESSAGE_LENGTH };
    }

    const latestStateForSend = useStore.getState();
    const requestedConversationId = options?.conversationId ?? conversationIdRef.current;
    const sendContext = resolveChatSendContextFromState(latestStateForSend, requestedConversationId);
    if (!sendContext.conversation || !sendContext.artist || sendContext.reason !== null) {
      if (__DEV__) {
        console.warn('[useChat] send_blocked', {
          reason: sendContext.reason,
          conversationId: sendContext.conversationId,
          requestedConversationId
        });
      }
      return { code: 'invalidConversation' };
    }

    const targetConversationId = sendContext.conversationId;
    const targetConversation = sendContext.conversation;
    const modeFewShotsForTurn = resolveModeFewShotsForConversation(targetConversation);
    const preferredLanguage = targetConversation.language || getLanguage();
    const languageResolution = resolveLanguageForTurn(trimmed, preferredLanguage);
    const languageForTurn = languageResolution.language;
    const shouldAskLanguageClarification = languageResolution.explicitDetected && !languageResolution.explicitRecognized;

    const now = new Date().toISOString();
    const rawMessagesBeforeSend = getMessages(targetConversationId);
    const historyBeforeSend = formatConversationHistory(rawMessagesBeforeSend);
    const previewText = trimmed || '[Image]';

    const userMessage: Message = {
      id: generateId('msg'),
      conversationId: targetConversationId,
      role: 'user',
      content: trimmed,
      status: 'complete',
      timestamp: now,
      metadata: payload.image
        ? {
            imageUri: payload.image.uri,
            imageMediaType: payload.image.mediaType
          }
        : undefined
    };

    addMessage(targetConversationId, userMessage);

    if (shouldAskLanguageClarification) {
      const clarificationMessage: Message = {
        id: generateId('msg'),
        conversationId: targetConversationId,
        role: 'artist',
        content: buildLanguageSwitchClarificationMessage(preferredLanguage),
        status: 'complete',
        timestamp: now,
        metadata: {
          injected: true
        }
      };

      addMessage(targetConversationId, clarificationMessage);
      updateConversation(
        targetConversationId,
        {
          language: preferredLanguage,
          lastMessagePreview: previewText,
          title: previewText.slice(0, 30)
        },
        targetConversation.artistId
      );
      return null;
    }

    const artistMessageId = generateId('msg');
    const placeholder: Message = {
      id: artistMessageId,
      conversationId: targetConversationId,
      role: 'artist',
      content: '',
      status: 'pending',
      timestamp: now
    };

    addMessage(targetConversationId, placeholder);

    const modeId = targetConversation.modeId || MODE_IDS.DEFAULT;
    const imageIntent = hasImage ? detectImageIntent(modeId, trimmed.length > 0) : 'default';
    const imageIntentPromptPrefix = getImageIntentPromptPrefix(imageIntent);
    const latestProfile = latestStateForSend.userProfile ?? userProfile;
    const isVoiceModeTurn = Boolean(latestStateForSend.conversationModeEnabled);
    const baseSystemPrompt = buildSystemPromptForArtist(
      targetConversation.artistId,
      modeId,
      latestProfile,
      languageForTurn,
      sessionDisplayName
    );
    const voiceModeAddendum = isVoiceModeTurn
      ? languageForTurn.toLowerCase().startsWith('en')
        ? '\n\n## VOICE MODE\nKeep this answer to 1-2 sentences maximum. You are live. No lists, no long explanations.'
        : '\n\n## MODE VOCAL\nGarde cette reponse a 1-2 phrases max. C\'est en direct. Pas de listes, pas de longues explications.'
      : '';
    const systemPrompt = imageIntentPromptPrefix
      ? `${imageIntentPromptPrefix}\n\n${baseSystemPrompt}`
      : baseSystemPrompt + voiceModeAddendum;
    const tutorialMode = computeTutorialModeForRequest(rawMessagesBeforeSend);
    const memoryFacts = collectArtistMemoryFacts(latestStateForSend, targetConversation.artistId, targetConversationId);
    const memoryMessage = buildMemoryPrimerMessage(memoryFacts, languageForTurn);
    const pendingProfileHints = popProfileChangeHints();
    const profileHintHistory: ClaudeMessage[] =
      pendingProfileHints.length > 0
        ? [
            {
              role: 'user',
              content: pendingProfileHints.join(' ')
            },
            {
              role: 'assistant',
              content: languageForTurn.toLowerCase().startsWith('en') ? 'Understood.' : 'Compris.'
            }
          ]
        : [];
    const historyForRequest = [
      ...historyBeforeSend,
      ...(memoryMessage ? [memoryMessage] : []),
      ...profileHintHistory,
      ...(isVoiceModeTurn
        ? [
            {
              role: 'assistant' as const,
              content: languageForTurn.toLowerCase().startsWith('en')
                ? 'VOICE MODE: Keep your next answer to 1-2 short sentences. No lists.'
                : 'MODE VOCAL: Garde ta prochaine reponse a 1-2 phrases courtes. Pas de liste.'
            }
          ]
        : [])
    ];
    const historyLimit = isVoiceModeTurn ? VOICE_MAX_CLAUDE_HISTORY_MESSAGES : MAX_CLAUDE_HISTORY_MESSAGES;

    queueRef.current.push({
      conversationId: targetConversationId,
      artistMessageId,
      userMessageId: userMessage.id,
      artistId: targetConversation.artistId,
      mockUserTurn: createMockUserTurn(trimmed, hasImage),
      claudeUserMessage: {
        role: 'user',
        content: createClaudeUserContent(trimmed, payload)
      },
      systemPrompt,
      history: historyForRequest.slice(-historyLimit),
      language: languageForTurn,
      modeFewShots: modeFewShotsForTurn,
      modeId,
      imageIntent,
      tutorialMode
    });
    runNext();

    updateConversation(targetConversationId, {
      language: languageForTurn,
      lastMessagePreview: previewText,
      title: previewText.slice(0, 30)
    }, targetConversation.artistId);

    return null;
  };

  useEffect(() => {
    const capturedId = conversationId;
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (flushFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
      cancelRef.current?.();
      cancelRef.current = null;
      flushBufferedTokensRef.current?.();
      flushBufferedTokensRef.current = null;
      bufferedTokensRef.current = '';
      if (activeMessageIdRef.current) {
        const activeConversationId = streamingConversationIdRef.current ?? capturedId;
        updateMessage(activeConversationId, activeMessageIdRef.current, { status: 'error' });
        activeMessageIdRef.current = null;
      }
      queueRef.current.forEach((job) => {
        updateMessage(job.conversationId, job.artistMessageId, { status: 'error' });
      });
      queueRef.current = [];
      failedJobsRef.current.clear();
      isStreamingRef.current = false;
      runNextLockRef.current = false;
      streamingConversationIdRef.current = null;
      isCancelledRef.current = false;
    };
  }, [conversationId, updateMessage]);

  const hasStreaming = useMemo(
    () =>
      messages.some(
        (message) => message.role === 'artist' && (message.status === 'pending' || message.status === 'streaming')
      ),
    [messages]
  );

  return {
    messages,
    hasStreaming,
    isQuotaBlocked,
    isSendContextReady,
    sendContextBlockReason,
    currentArtistName: currentArtist?.name ?? null,
    sendMessage,
    retryMessage,
    retryVoiceForMessage,
    audioPlayer
  };
}
