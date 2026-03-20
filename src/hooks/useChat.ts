import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ARTIST_IDS, MAX_MESSAGE_LENGTH, MODE_IDS } from '../config/constants';
import { resolveModeIdCompat } from '../config/modeCompat';
import {
  QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO,
  QUOTA_THRESHOLD_HARD_FREE_RATIO,
  QUOTA_THRESHOLD_SOFT_1_RATIO,
  QUOTA_THRESHOLD_SOFT_2_RATIO
} from '../config/quotaThresholds';
import { USE_MOCK_LLM } from '../config/env';
import { getAllCathyFewShots, getCathyModeFewShots } from '../data/cathy-gauthier/modeFewShots';
import { getLanguage, setLanguage, t } from '../i18n';
import type { ChatError } from '../models/ChatError';
import type { ChatSendPayload } from '../models/ChatSendPayload';
import type { Message } from '../models/Message';
import type { ClaudeContentBlock, ClaudeMessage } from '../services/claudeApiService';
import { streamClaudeResponse } from '../services/claudeApiService';
import { detectImageIntent, type ImageIntent } from '../services/imageIntentService';
import { streamMockReply } from '../services/mockLlmService';
import { buildSystemPromptForArtist, formatConversationHistory } from '../services/personalityEngineService';
import { addScore } from '../services/scoreManager';
import { fetchAndCacheVoice } from '../services/ttsService';
import { useStore } from '../store/useStore';
import { findConversationById } from '../utils/conversationUtils';
import { shouldAutoSwitchToEnglish } from '../utils/languageDetection';
import { generateId } from '../utils/generateId';
import { normalizeSpeechText, splitDisplayChunkFromRaw, stripAudioTags } from '../utils/audioTags';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../utils/accountTypeUtils';
import type { ScoreAction } from '../models/Gamification';
import { computeTutorialModeForRequest, shouldApplyReactionForUserMessage } from './chatBehavior';
import { useAudioPlayer } from './useAudioPlayer';

interface StreamJob {
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
const MAX_MEMORY_FACTS = 6;
const MIN_TTS_CHUNK_CHARS = 20;
const MAX_TTS_CHUNK_CHARS = 200;
const VOICE_FIRST_CHUNK_MIN_CHARS = 60;
const REACT_TAG_PATTERN = /^\s*\[REACT:([^\]\n]{1,8})\]\s*/i;
const ALLOWED_REACTIONS = new Set(['😂', '💀', '😮', '😤', '🙄', '😬', '🤔', '👍']);
const TERMINAL_TTS_CODES = new Set(['TTS_QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED', 'TTS_FORBIDDEN']);

export type TerminalTtsCode = 'TTS_QUOTA_EXCEEDED' | 'RATE_LIMIT_EXCEEDED' | 'TTS_FORBIDDEN';

function isQuotaBlockedErrorCode(code: string | null): boolean {
  return (
    code === 'QUOTA_EXCEEDED_BLOCKED' ||
    code === 'QUOTA_ABSOLUTE_BLOCKED' ||
    code === 'MONTHLY_QUOTA_EXCEEDED'
  );
}

function isTerminalTtsCode(value: string | null | undefined): value is TerminalTtsCode {
  return typeof value === 'string' && TERMINAL_TTS_CODES.has(value);
}

export function resolveTerminalTtsCode(error: unknown): TerminalTtsCode | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  if (isTerminalTtsCode(code)) {
    return code;
  }

  const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
  if (status === 403) {
    return 'TTS_FORBIDDEN';
  }
  if (status === 429) {
    return 'RATE_LIMIT_EXCEEDED';
  }

  return null;
}

export function shouldShowUpgradeForTtsCode(code: TerminalTtsCode): boolean {
  return code === 'TTS_QUOTA_EXCEEDED' || code === 'TTS_FORBIDDEN';
}

export function buildCathyVoiceNotice(code: TerminalTtsCode): string {
  if (code === 'RATE_LIMIT_EXCEEDED') {
    return t('cathyVoiceRateLimitMessage');
  }
  return t('cathyVoiceQuotaExceededMessage');
}

function isSentenceBoundary(input: string, index: number): boolean {
  const char = input[index];
  if (!char) {
    return false;
  }

  if (char === '\n') {
    return true;
  }

  if (char !== '.' && char !== '!' && char !== '?') {
    return false;
  }

  const next = input[index + 1];
  return next === undefined || /[\s\n]/.test(next);
}

function normalizeTtsChunk(chunk: string): string {
  return chunk.replace(/\s+/g, ' ').trim();
}

function extractReactionTag(text: string): { reaction: string | null; cleaned: string } {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(REACT_TAG_PATTERN);
  if (!match) {
    return {
      reaction: null,
      cleaned: source
    };
  }

  const reactionCandidate = typeof match[1] === 'string' ? match[1].trim() : '';
  const reaction = ALLOWED_REACTIONS.has(reactionCandidate) ? reactionCandidate : null;

  return {
    reaction,
    cleaned: source.slice(match[0].length).trimStart()
  };
}

function reactionToScoreAction(reaction: string): ScoreAction | null {
  if (reaction === '😂' || reaction === '💀') {
    return 'joke_landed';
  }
  if (reaction === '😮') {
    return 'cathy_surprised';
  }
  if (reaction === '😤') {
    return 'cathy_triggered';
  }
  if (reaction === '🤔') {
    return 'cathy_intrigued';
  }
  if (reaction === '👍') {
    return 'cathy_approved';
  }
  return null;
}

function extractReadyTtsChunks(buffer: string, flushRemainder: boolean): { chunks: string[]; remainder: string } {
  let working = buffer;
  const chunks: string[] = [];

  while (working.length > 0) {
    const searchUpperBound = Math.min(working.length, MAX_TTS_CHUNK_CHARS);
    let boundaryIndex = -1;

    for (let index = MIN_TTS_CHUNK_CHARS - 1; index < searchUpperBound; index += 1) {
      if (isSentenceBoundary(working, index)) {
        boundaryIndex = index + 1;
        break;
      }
    }

    if (boundaryIndex === -1 && working.length > MAX_TTS_CHUNK_CHARS) {
      boundaryIndex = MAX_TTS_CHUNK_CHARS;
    }

    if (boundaryIndex === -1 && flushRemainder && working.length >= MIN_TTS_CHUNK_CHARS) {
      boundaryIndex = working.length;
    }

    if (boundaryIndex === -1) {
      break;
    }

    const candidate = normalizeTtsChunk(working.slice(0, boundaryIndex));
    working = working.slice(boundaryIndex);

    if (!candidate) {
      continue;
    }

    if (candidate.length < MIN_TTS_CHUNK_CHARS) {
      if (chunks.length > 0 && chunks[chunks.length - 1]) {
        const previous = chunks[chunks.length - 1] as string;
        chunks[chunks.length - 1] = normalizeTtsChunk(`${previous} ${candidate}`);
      } else {
        working = `${candidate} ${working}`.trimStart();
        break;
      }
      continue;
    }

    chunks.push(candidate);
  }

  if (flushRemainder) {
    const normalizedRemainder = normalizeTtsChunk(working);
    if (normalizedRemainder.length >= MIN_TTS_CHUNK_CHARS) {
      chunks.push(normalizedRemainder);
      working = '';
    }
  }

  return {
    chunks,
    remainder: working
  };
}

function extractMemoryFactsFromText(text: string): string[] {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return [];
  }

  const firstPersonPattern =
    /\b(je|j'|moi|mon|ma|mes|j'aime|j adore|je suis|je travaille|je vis|je prefere|i|i'm|i am|my|me|i like|i love)\b/i;

  return normalized
    .split(/[\n.!?]/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 10 && line.length <= 140)
    .filter((line) => firstPersonPattern.test(line));
}

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

function collectArtistMemoryFacts(
  state: ReturnType<typeof useStore.getState>,
  artistId: string,
  currentConversationId: string
): string[] {
  const conversations = state.conversations[artistId] ?? [];
  if (conversations.length === 0) {
    return [];
  }

  const sortedConversationIds = conversations
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })
    .map((conversation) => conversation.id);

  if (!sortedConversationIds.includes(currentConversationId)) {
    sortedConversationIds.unshift(currentConversationId);
  }

  const seen = new Set<string>();
  const facts: string[] = [];

  for (const conversationId of sortedConversationIds) {
    const page = state.messagesByConversation[conversationId];
    if (!page || !Array.isArray(page.messages) || page.messages.length === 0) {
      continue;
    }

    for (let index = page.messages.length - 1; index >= 0; index -= 1) {
      const message = page.messages[index];
      if (!message) {
        continue;
      }
      if (message.role !== 'user' || message.status !== 'complete' || !message.content.trim()) {
        continue;
      }

      const extractedFacts = extractMemoryFactsFromText(message.content);
      for (const fact of extractedFacts) {
        const key = fact.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        facts.push(fact);
        if (facts.length >= MAX_MEMORY_FACTS) {
          return facts;
        }
      }
    }
  }

  return facts;
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
      return 'INTENT IMAGE: Decode le screenshot, puis donne une lecture + une replique utile.';
    default:
      return '';
  }
}

function detectBattleResult(content: string): 'light' | 'solid' | 'destruction' | null {
  const normalized = content.toLowerCase();
  if (normalized.includes('verdict: 💀') || normalized.includes('💀 destruction')) {
    return 'destruction';
  }
  if (normalized.includes('verdict: 🎤') || normalized.includes('🎤 solide')) {
    return 'solid';
  }
  if (normalized.includes('verdict: 🔥') || normalized.includes('🔥 leger')) {
    return 'light';
  }
  return null;
}

function resolveScoreActions(modeId: string, imageIntent: ImageIntent, battleResult: 'light' | 'solid' | 'destruction' | null): ScoreAction[] {
  const canonicalModeId = resolveModeIdCompat(modeId);
  const actions = new Set<ScoreAction>();

  if (canonicalModeId === MODE_IDS.GRILL) {
    actions.add('roast_generated');
  }

  if (modeId === MODE_IDS.PHRASE_DU_JOUR || canonicalModeId === MODE_IDS.ON_JASE || modeId === MODE_IDS.VICTIME_DU_JOUR) {
    actions.add('punchline_created');
  }

  if (modeId === MODE_IDS.VICTIME_DU_JOUR) {
    actions.add('daily_participation');
  }

  if (imageIntent === 'photo-roast') {
    actions.add('photo_roasted');
  }

  if (imageIntent === 'meme-generator') {
    actions.add('meme_generated');
  }

  if (modeId === MODE_IDS.ROAST_BATTLE && battleResult === 'destruction') {
    actions.add('battle_win');
  }

  return [...actions];
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

  const modeFewShots = useMemo(() => {
    if (!currentConversation?.modeId || currentConversation.artistId !== ARTIST_IDS.CATHY_GAUTHIER) {
      return [];
    }

    const dedicated = getCathyModeFewShots(currentConversation.modeId);
    return dedicated.length > 0 ? dedicated : getAllCathyFewShots();
  }, [currentConversation?.artistId, currentConversation?.modeId]);

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

  const runNext = useCallback(() => {
    if (!conversationId || runNextLockRef.current || !isMountedRef.current) {
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
      const jobConversationId = conversationId;
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
      const latestAccountType = resolveEffectiveAccountType(
        latestSessionUser?.accountType ?? currentAccountType,
        latestSessionUser?.role ?? currentRole
      );
      const canGenerateVoice =
        artistId === ARTIST_IDS.CATHY_GAUTHIER &&
        hasVoiceAccessForAccountType(latestAccountType) &&
        Boolean(accessToken.trim());
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
              mergeMessageMetadata(messageId, {
                voiceStatus: undefined,
                voiceUrl: undefined,
                voiceQueue: undefined,
                voiceChunkBoundaries: undefined
              });
              return;
            }

            const boundary = stripAudioTags(normalizedNotice, { trim: true }).length;
            mergeMessageMetadata(messageId, {
              voiceStatus: 'ready',
              voiceUrl: uri,
              voiceQueue: [uri],
              voiceChunkBoundaries: [boundary]
            });

            if (useStore.getState().voiceAutoPlay) {
              const hasActivePlayback = audioPlayer.isPlaying || audioPlayer.isLoading;
              const matchesExpectedMessage =
                !options?.expectedCurrentMessageId || audioPlayer.currentMessageId === options.expectedCurrentMessageId;
              if (hasActivePlayback && matchesExpectedMessage) {
                audioPlayer.appendToQueue(uri, { messageId });
              } else if (!options?.queueOnly) {
                void audioPlayer.play(uri, { messageId });
              }
            }
          })
          .catch(() => {
            mergeMessageMetadata(messageId, {
              voiceStatus: undefined,
              voiceUrl: undefined,
              voiceQueue: undefined,
              voiceChunkBoundaries: undefined
            });
          });
      };
      let ttsBuffer = '';
      let ttsChunkCount = 0;
      let hasStartedVoiceGeneration = false;
      let ignoreTtsUpdates = false;
      let hasTtsChunkFailure = false;
      let hasDevLocalFallbackAttempt = false;
      const ttsChunkUrisByIndex = new Map<number, string>();
      const ttsChunkDisplayBoundariesByIndex = new Map<number, number>();
      const ttsPendingPromises: Array<Promise<void>> = [];
      let displayTextAccumulator = 0;
      let nextPlayableChunkIndex = 0;
      let hasQueuedAutoplayChunk = false;
      let firstChunkFired = false;
      let pendingVoiceNoticeCode: TerminalTtsCode | null = null;

      const registerTerminalTtsError = (error: unknown): boolean => {
        const terminalCode = resolveTerminalTtsCode(error);
        if (!terminalCode) {
          return false;
        }

        if (pendingVoiceNoticeCode === null) {
          pendingVoiceNoticeCode = terminalCode;
        }

        ignoreTtsUpdates = true;
        hasTtsChunkFailure = true;
        mergeArtistMetadata({
          voiceStatus: undefined,
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });
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
        if (orderedVoiceUris.length === 0) {
          return;
        }

        mergeArtistMetadata({
          voiceUrl: orderedVoiceUris[0],
          voiceQueue: orderedVoiceUris,
          voiceChunkBoundaries: orderedBoundaries,
          voiceStatus: 'ready'
        });
      };

      const queueTtsChunk = (chunk: string) => {
        if (!canGenerateVoice || ignoreTtsUpdates) {
          return;
        }

        const normalizedChunk = normalizeSpeechText(chunk, { trim: true });
        if (normalizedChunk.length < MIN_TTS_CHUNK_CHARS) {
          return;
        }

        if (!hasStartedVoiceGeneration) {
          hasStartedVoiceGeneration = true;
          mergeArtistMetadata({
            voiceStatus: 'generating',
            voiceUrl: undefined,
            voiceQueue: undefined,
            voiceChunkBoundaries: undefined
          });
        }

        const chunkIndex = ttsChunkCount;
        ttsChunkCount += 1;
        if (chunkIndex === 0) {
          firstChunkFired = true;
        }
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

            hasTtsChunkFailure = true;
          })
          .catch((error: unknown) => {
            if (registerTerminalTtsError(error)) {
              return;
            }
            hasTtsChunkFailure = true;
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
          queueTtsChunk(chunk);
        });
      };

      const onToken = (token: string) => {
        if (!isCurrentStream()) {
          return;
        }
        bufferedTokensRef.current += token;
        rawTtsResponseRef.current += token;
        if (canGenerateVoice) {
          ttsBuffer += token;
          if (conversationModeEnabledForJob && !firstChunkFired) {
            const lastOpenBracketIndex = ttsBuffer.lastIndexOf('[');
            const lastCloseBracketIndex = ttsBuffer.lastIndexOf(']');
            const hasUnclosedBracketTag = lastOpenBracketIndex > lastCloseBracketIndex;
            const firstChunkCandidate = normalizeSpeechText(ttsBuffer, { trim: true });
            if (!hasUnclosedBracketTag && firstChunkCandidate.length >= VOICE_FIRST_CHUNK_MIN_CHARS) {
              queueTtsChunk(ttsBuffer);
              ttsBuffer = '';
            }
          }
          flushTtsChunks(false);
        }
        scheduleFlush();
      };

      const onComplete = ({ tokensUsed }: { tokensUsed: number }) => {
        if (!isCurrentStream()) {
          return;
        }
        flushTtsChunks(true);
        const latestArtistMessage = getLatestArtistMessage();
        const rawFinalContent = latestArtistMessage?.content ?? '';
        const finalContent = stripAudioTags(rawFinalContent);
        if (finalContent !== rawFinalContent) {
          updateMessage(jobConversationId, artistMessageId, {
            content: finalContent
          });
        }
        const battleResult = modeId === MODE_IDS.ROAST_BATTLE ? detectBattleResult(finalContent) : null;
        const scoreActionSet = new Set<ScoreAction>(resolveScoreActions(modeId, imageIntent, battleResult));
        const { reaction: cathyReaction } = extractReactionTag(rawTtsResponseRef.current);
        if (cathyReaction) {
          const latestMessages = useStore.getState().messagesByConversation[jobConversationId]?.messages ?? [];
          if (shouldApplyReactionForUserMessage(latestMessages, userMessageId)) {
            const userMessage = latestMessages.find((message) => message.id === userMessageId) ?? null;
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
        const latestState = useStore.getState();
        const latestQuota = latestState.quota;
        const normalizedAccountType = resolveEffectiveAccountType(
          latestState.session?.user.accountType ?? currentAccountType,
          latestState.session?.user.role ?? currentRole
        );
        let shouldBlockInput = false;
        if (
          normalizedAccountType !== 'admin' &&
          typeof latestQuota.messagesCap === 'number' &&
          Number.isFinite(latestQuota.messagesCap) &&
          latestQuota.messagesCap > 0
        ) {
          const ratio = latestQuota.messagesUsed / latestQuota.messagesCap;
          let thresholdToShow: 1 | 2 | 3 | 4 | null = null;
          let thresholdMessage = '';

          if (
            ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO &&
            normalizedAccountType !== 'free' &&
            !latestQuota.threshold4MessageShown
          ) {
            thresholdToShow = 4;
            thresholdMessage = t('cathyThreshold4PaidMessage');
          } else if (ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO && !latestQuota.threshold3MessageShown) {
            thresholdToShow = 3;
            thresholdMessage =
              normalizedAccountType === 'free' ? t('cathyThreshold3FreeMessage') : t('cathyThreshold3PaidMessage');
          } else if (ratio >= QUOTA_THRESHOLD_SOFT_2_RATIO && !latestQuota.threshold2MessageShown) {
            thresholdToShow = 2;
            thresholdMessage = t('cathyThreshold2Message');
          } else if (ratio >= QUOTA_THRESHOLD_SOFT_1_RATIO && !latestQuota.threshold1MessageShown) {
            thresholdToShow = 1;
            thresholdMessage = t('cathyThreshold1Message');
          }

          if (thresholdToShow !== null) {
            markThresholdMessageShown(thresholdToShow);
            const thresholdMessageId = generateId('msg');
            addMessage(jobConversationId, {
              id: thresholdMessageId,
              conversationId: jobConversationId,
              role: 'artist',
              content: thresholdMessage,
              status: 'complete',
              timestamp: new Date().toISOString(),
              metadata: {
                injected: true,
                showUpgradeCta: true,
                upgradeFromTier: normalizedAccountType
              }
            });
            synthesizeNoticeVoice(thresholdMessageId, thresholdMessage, {
              queueOnly: true,
              expectedCurrentMessageId: artistMessageId
            });
          }

          const shouldBlockFree = normalizedAccountType === 'free' && ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO;
          const shouldBlockPaidAbsolute =
            normalizedAccountType !== 'free' && ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO;
          shouldBlockInput = shouldBlockFree || shouldBlockPaidAbsolute;
          if (shouldBlockInput) {
            setBlocked(true);
          }
        }
        if (canGenerateVoice && !ignoreTtsUpdates) {
          const fallbackPreviewText = normalizeSpeechText(rawTtsResponseRef.current, { trim: true });
          if (!hasStartedVoiceGeneration && fallbackPreviewText) {
            hasStartedVoiceGeneration = true;
            mergeArtistMetadata({
              voiceStatus: 'generating',
              voiceUrl: undefined,
              voiceQueue: undefined,
              voiceChunkBoundaries: undefined
            });
          }

          void Promise.allSettled(ttsPendingPromises).then(async () => {
            if (!isCurrentStream() || ignoreTtsUpdates) {
              return;
            }

            let { orderedVoiceUris, orderedBoundaries } = buildVoicePlaybackData();
            const fallbackText = normalizeSpeechText(rawTtsResponseRef.current, { trim: true });
            const fallbackAccessToken = useStore.getState().session?.accessToken ?? accessToken;

            // Recover gracefully from short replies and per-chunk failures.
            if ((hasTtsChunkFailure || orderedVoiceUris.length === 0) && fallbackText && fallbackAccessToken.trim()) {
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
              mergeArtistMetadata({
                voiceStatus: undefined,
                voiceUrl: undefined,
                voiceQueue: undefined,
                voiceChunkBoundaries: undefined
              });
              return;
            }

            mergeArtistMetadata({
              voiceUrl: orderedVoiceUris[0],
              voiceQueue: orderedVoiceUris,
              voiceChunkBoundaries: orderedBoundaries,
              voiceStatus: 'ready'
            });

            const shouldAutoPlay = Boolean(useStore.getState().voiceAutoPlay);
            if (shouldAutoPlay && !shouldBlockInput && !hasQueuedAutoplayChunk) {
              void audioPlayer.playQueue(orderedVoiceUris, { messageId: artistMessageId });
            }
          });
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

          addMessage(jobConversationId, {
            id: generateId('msg'),
            conversationId: jobConversationId,
            role: 'artist',
            content: buildCathyVoiceNotice(pendingVoiceNoticeCode),
            status: 'complete',
            timestamp: new Date().toISOString(),
            metadata: noticeMetadata
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
          const quotaMessage =
            latestAccountType === 'free' ? t('cathyThreshold3FreeMessage') : t('cathyThreshold4PaidMessage');
          markThresholdMessageShown(latestAccountType === 'free' ? 3 : 4);
          setBlocked(true);
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
    conversationId,
    accessToken,
    currentAccountType,
    currentRole,
    incrementUsage,
    markThresholdMessageShown,
    setBlocked,
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

      failedJobsRef.current.delete(artistMessageId);
      updateMessage(conversationId, artistMessageId, {
        content: '',
        status: 'pending',
        metadata: undefined
      });
      queueRef.current.unshift(failedJob);
      runNext();
    },
    [conversationId, runNext, updateMessage]
  );

  const sendMessage = (payload: ChatSendPayload): ChatError | null => {
    const trimmed = payload.text.trim();
    const hasImage = Boolean(payload.image);

    if (isQuotaBlocked) {
      return null;
    }

    if ((!trimmed && !hasImage) || !conversationId || !currentConversation || !currentArtist) {
      return null;
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { code: 'messageTooLong', maxLength: MAX_MESSAGE_LENGTH };
    }

    const preferredLanguage = currentConversation.language || getLanguage();
    const shouldSwitchToEnglish = shouldAutoSwitchToEnglish(trimmed, preferredLanguage);
    const languageForTurn = shouldSwitchToEnglish ? 'en-CA' : preferredLanguage;

    if (shouldSwitchToEnglish) {
      setLanguage('en-CA');
    }

    const now = new Date().toISOString();
    const rawMessagesBeforeSend = getMessages(conversationId);
    const historyBeforeSend = formatConversationHistory(rawMessagesBeforeSend);
    const previewText = trimmed || '[Image]';

    const userMessage: Message = {
      id: generateId('msg'),
      conversationId,
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

    const artistMessageId = generateId('msg');
    const placeholder: Message = {
      id: artistMessageId,
      conversationId,
      role: 'artist',
      content: '',
      status: 'pending',
      timestamp: now
    };

    addMessage(conversationId, userMessage);
    addMessage(conversationId, placeholder);

    const modeId = currentConversation.modeId || MODE_IDS.DEFAULT;
    const imageIntent = hasImage ? detectImageIntent(modeId, trimmed.length > 0) : 'default';
    const imageIntentPromptPrefix = getImageIntentPromptPrefix(imageIntent);
    const latestProfile = useStore.getState().userProfile ?? userProfile;
    const isVoiceModeTurn = Boolean(useStore.getState().conversationModeEnabled);
    const baseSystemPrompt = buildSystemPromptForArtist(
      currentConversation.artistId,
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
    const latestState = useStore.getState();
    const tutorialMode = computeTutorialModeForRequest(rawMessagesBeforeSend);
    const memoryFacts = collectArtistMemoryFacts(latestState, currentConversation.artistId, conversationId);
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
      artistMessageId,
      userMessageId: userMessage.id,
      artistId: currentConversation.artistId,
      mockUserTurn: createMockUserTurn(trimmed, hasImage),
      claudeUserMessage: {
        role: 'user',
        content: createClaudeUserContent(trimmed, payload)
      },
      systemPrompt,
      history: historyForRequest.slice(-historyLimit),
      language: languageForTurn,
      modeFewShots,
      modeId,
      imageIntent,
      tutorialMode
    });
    runNext();

    updateConversation(conversationId, {
      language: languageForTurn,
      lastMessagePreview: previewText,
      title: previewText.slice(0, 30)
    }, currentConversation.artistId);

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
        updateMessage(capturedId, activeMessageIdRef.current, { status: 'error' });
        activeMessageIdRef.current = null;
      }
      queueRef.current.forEach((job) => {
        updateMessage(capturedId, job.artistMessageId, { status: 'error' });
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
    currentArtistName: currentArtist?.name ?? null,
    sendMessage,
    retryMessage,
    audioPlayer
  };
}
