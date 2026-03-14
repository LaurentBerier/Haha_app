import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ARTIST_IDS, MAX_MESSAGE_LENGTH, MODE_IDS } from '../config/constants';
import { resolveModeIdCompat } from '../config/modeCompat';
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
import type { ScoreAction } from '../models/Gamification';
import { useAudioPlayer } from './useAudioPlayer';

interface StreamJob {
  artistMessageId: string;
  artistId: string;
  mockUserTurn: string;
  claudeUserMessage: ClaudeMessage;
  systemPrompt: string;
  history: ClaudeMessage[];
  language: string;
  modeFewShots: ReturnType<typeof getCathyModeFewShots>;
  modeId: string;
  imageIntent: ImageIntent;
}

const EMPTY_MESSAGES: Message[] = [];
const MAX_CLAUDE_HISTORY_MESSAGES = 39;
const MAX_MEMORY_FACTS = 6;
const THRESHOLD_1_RATIO = 0.75;
const THRESHOLD_2_RATIO = 0.9;
const THRESHOLD_3_RATIO = 1;
const THRESHOLD_4_RATIO = 1.5;
const MIN_TTS_CHUNK_CHARS = 20;
const MAX_TTS_CHUNK_CHARS = 200;

function normalizeAccountType(accountType: string | null | undefined): string {
  if (typeof accountType === 'string' && accountType.trim()) {
    const normalized = accountType.trim().toLowerCase();
    if (normalized === 'free' || normalized === 'regular' || normalized === 'premium' || normalized === 'admin') {
      return normalized;
    }

    const compact = normalized.replace(/[\s_-]+/g, '');
    if (compact === 'unlimited') {
      return 'regular';
    }
    if (compact === 'proartist') {
      return 'premium';
    }
  }
  return 'free';
}

function isQuotaBlockedErrorCode(code: string | null): boolean {
  return (
    code === 'QUOTA_EXCEEDED_BLOCKED' ||
    code === 'QUOTA_ABSOLUTE_BLOCKED' ||
    code === 'MONTHLY_QUOTA_EXCEEDED'
  );
}

function hasVoiceAccess(accountType: string | null | undefined): boolean {
  const normalized = normalizeAccountType(accountType);
  return normalized === 'regular' || normalized === 'premium' || normalized === 'admin';
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
  const updateConversation = useStore((state) => state.updateConversation);
  const userProfile = useStore((state) => state.userProfile);
  const sessionDisplayName = useStore((state) => state.session?.user.displayName ?? null);
  const currentAccountType = useStore((state) => state.session?.user.accountType ?? 'free');
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
  const isMountedRef = useRef(true);
  const isCancelledRef = useRef(false);
  const cancelRef = useRef<null | (() => void)>(null);
  const bufferedTokensRef = useRef('');
  const flushBufferedTokensRef = useRef<null | (() => void)>(null);
  const flushFrameRef = useRef<number | null>(null);

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
        artistId,
        mockUserTurn,
        claudeUserMessage,
        systemPrompt,
        history,
        language,
        modeFewShots,
        modeId,
        imageIntent
      } = nextJob;
      const jobConversationId = conversationId;
      isStreamingRef.current = true;
      activeMessageIdRef.current = artistMessageId;
      streamingConversationIdRef.current = jobConversationId;
      isCancelledRef.current = false;
      bufferedTokensRef.current = '';

      const flushBufferedTokens = () => {
        if (!bufferedTokensRef.current) {
          return;
        }

        const chunk = bufferedTokensRef.current;
        bufferedTokensRef.current = '';
        appendMessageContent(jobConversationId, artistMessageId, chunk);
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
          if (!isMountedRef.current || streamingConversationIdRef.current !== jobConversationId) {
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
        isCancelledRef.current = false;
        cancelRef.current = null;
        flushBufferedTokensRef.current = null;
        bufferedTokensRef.current = '';
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

      const latestAccountType = normalizeAccountType(useStore.getState().session?.user.accountType ?? currentAccountType);
      const canGenerateVoice =
        artistId === ARTIST_IDS.CATHY_GAUTHIER && hasVoiceAccess(latestAccountType) && Boolean(accessToken.trim());
      let ttsBuffer = '';
      let ttsChunkCount = 0;
      let hasStartedVoiceGeneration = false;
      let ignoreTtsUpdates = false;
      const ttsChunkUrisByIndex = new Map<number, string>();
      const ttsPendingPromises: Array<Promise<void>> = [];

      const queueTtsChunk = (chunk: string) => {
        if (!canGenerateVoice || ignoreTtsUpdates) {
          return;
        }

        const normalizedChunk = normalizeTtsChunk(chunk);
        if (normalizedChunk.length < MIN_TTS_CHUNK_CHARS) {
          return;
        }

        if (!hasStartedVoiceGeneration) {
          hasStartedVoiceGeneration = true;
          mergeArtistMetadata({
            voiceStatus: 'generating',
            voiceUrl: undefined,
            voiceQueue: undefined
          });
        }

        const chunkIndex = ttsChunkCount;
        ttsChunkCount += 1;
        const latestAccessToken = useStore.getState().session?.accessToken ?? accessToken;

        const ttsPromise = fetchAndCacheVoice(normalizedChunk, artistId, language, latestAccessToken)
          .then((uri) => {
            if (uri) {
              ttsChunkUrisByIndex.set(chunkIndex, uri);
            }
          })
          .catch(() => {
            // Silent failure: no voice button if generation fails.
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
        if (!isMountedRef.current) {
          return;
        }
        if (isCancelledRef.current) {
          return;
        }
        if (streamingConversationIdRef.current !== jobConversationId) {
          return;
        }
        bufferedTokensRef.current += token;
        if (canGenerateVoice) {
          ttsBuffer += token;
          flushTtsChunks(false);
        }
        scheduleFlush();
      };

      const onComplete = ({ tokensUsed }: { tokensUsed: number }) => {
        if (!isMountedRef.current || streamingConversationIdRef.current !== jobConversationId) {
          resetStreamState();
          return;
        }
        flushTtsChunks(true);
        const latestArtistMessage = getLatestArtistMessage();
        const finalContent = latestArtistMessage?.content ?? '';
        const battleResult = modeId === MODE_IDS.ROAST_BATTLE ? detectBattleResult(finalContent) : null;
        const scoreActions = resolveScoreActions(modeId, imageIntent, battleResult);

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
        const normalizedAccountType = normalizeAccountType(
          latestState.session?.user.accountType ?? currentAccountType
        );
        let shouldBlockInput = false;
        if (
          typeof latestQuota.messagesCap === 'number' &&
          Number.isFinite(latestQuota.messagesCap) &&
          latestQuota.messagesCap > 0
        ) {
          const ratio = latestQuota.messagesUsed / latestQuota.messagesCap;
          let thresholdToShow: 1 | 2 | 3 | 4 | null = null;
          let thresholdMessage = '';

          if (ratio >= THRESHOLD_4_RATIO && normalizedAccountType !== 'free' && !latestQuota.threshold4MessageShown) {
            thresholdToShow = 4;
            thresholdMessage = t('cathyThreshold4PaidMessage');
          } else if (ratio >= THRESHOLD_3_RATIO && !latestQuota.threshold3MessageShown) {
            thresholdToShow = 3;
            thresholdMessage =
              normalizedAccountType === 'free' ? t('cathyThreshold3FreeMessage') : t('cathyThreshold3PaidMessage');
          } else if (ratio >= THRESHOLD_2_RATIO && !latestQuota.threshold2MessageShown) {
            thresholdToShow = 2;
            thresholdMessage = t('cathyThreshold2Message');
          } else if (ratio >= THRESHOLD_1_RATIO && !latestQuota.threshold1MessageShown) {
            thresholdToShow = 1;
            thresholdMessage = t('cathyThreshold1Message');
          }

          if (thresholdToShow !== null) {
            markThresholdMessageShown(thresholdToShow);
            addMessage(jobConversationId, {
              id: generateId('msg'),
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
          }

          const shouldBlockFree = normalizedAccountType === 'free' && ratio >= THRESHOLD_3_RATIO;
          const shouldBlockPaidAbsolute = normalizedAccountType !== 'free' && ratio >= THRESHOLD_4_RATIO;
          shouldBlockInput = shouldBlockFree || shouldBlockPaidAbsolute;
          if (shouldBlockInput) {
            setBlocked(true);
          }
        }
        if (canGenerateVoice && !ignoreTtsUpdates) {
          const fallbackPreviewText = normalizeTtsChunk(getLatestArtistMessage()?.content ?? '');
          if (!hasStartedVoiceGeneration && fallbackPreviewText) {
            hasStartedVoiceGeneration = true;
            mergeArtistMetadata({
              voiceStatus: 'generating',
              voiceUrl: undefined,
              voiceQueue: undefined
            });
          }

          void Promise.allSettled(ttsPendingPromises).then(async () => {
            if (!isMountedRef.current || ignoreTtsUpdates) {
              return;
            }

            let orderedVoiceUris = Array.from({ length: ttsChunkCount })
              .map((_, index) => ttsChunkUrisByIndex.get(index))
              .filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0);

            // Fallback for short replies or chunking misses: synthesize full final text once.
            if (orderedVoiceUris.length === 0) {
              const fallbackText = normalizeTtsChunk(getLatestArtistMessage()?.content ?? '');
              const fallbackAccessToken = useStore.getState().session?.accessToken ?? accessToken;
              if (fallbackText && fallbackAccessToken.trim()) {
                try {
                  const fallbackUri = await fetchAndCacheVoice(fallbackText, artistId, language, fallbackAccessToken);
                  if (fallbackUri) {
                    orderedVoiceUris = [fallbackUri];
                  }
                } catch {
                  // Silent failure: keep no voice button when fallback also fails.
                }
              }
            }

            if (orderedVoiceUris.length === 0) {
              mergeArtistMetadata({
                voiceStatus: undefined,
                voiceUrl: undefined,
                voiceQueue: undefined
              });
              return;
            }

            mergeArtistMetadata({
              voiceUrl: orderedVoiceUris[0],
              voiceQueue: orderedVoiceUris,
              voiceStatus: 'ready'
            });

            const shouldAutoPlay = Boolean(useStore.getState().voiceAutoPlay);
            if (shouldAutoPlay && !shouldBlockInput) {
              void audioPlayer.playQueue(orderedVoiceUris);
            }
          });
        }
        if (scoreActions.length > 0) {
          void (async () => {
            for (const action of scoreActions) {
              try {
                await addScore(action);
              } catch (error) {
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
        if (!isMountedRef.current || streamingConversationIdRef.current !== jobConversationId) {
          resetStreamState();
          return;
        }
        const errorWithMeta = error as Error & { code?: string; status?: number };
        const errorCode = typeof errorWithMeta.code === 'string' ? errorWithMeta.code : null;
        if (isQuotaBlockedErrorCode(errorCode)) {
          const latestAccountType = normalizeAccountType(
            useStore.getState().session?.user.accountType ?? currentAccountType
          );
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
          resetStreamState();
          runNext();
          return;
        }
        const message = error instanceof Error && typeof error.message === 'string' && error.message.trim()
          ? error.message.trim()
          : 'Erreur pendant la génération';
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
          systemPrompt,
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
    appendMessageContent,
    audioPlayer,
    conversationId,
    accessToken,
    currentAccountType,
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
    const historyBeforeSend = formatConversationHistory(getMessages(conversationId));
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
    const baseSystemPrompt = buildSystemPromptForArtist(
      currentConversation.artistId,
      modeId,
      latestProfile,
      languageForTurn,
      sessionDisplayName
    );
    const systemPrompt = imageIntentPromptPrefix
      ? `${imageIntentPromptPrefix}\n\n${baseSystemPrompt}`
      : baseSystemPrompt;
    const latestState = useStore.getState();
    const memoryFacts = collectArtistMemoryFacts(latestState, currentConversation.artistId, conversationId);
    const memoryMessage = buildMemoryPrimerMessage(memoryFacts, languageForTurn);
    const historyForRequest = memoryMessage ? [...historyBeforeSend, memoryMessage] : historyBeforeSend;

    queueRef.current.push({
      artistMessageId,
      artistId: currentConversation.artistId,
      mockUserTurn: createMockUserTurn(trimmed, hasImage),
      claudeUserMessage: {
        role: 'user',
        content: createClaudeUserContent(trimmed, payload)
      },
      systemPrompt,
      history: historyForRequest.slice(-MAX_CLAUDE_HISTORY_MESSAGES),
      language: languageForTurn,
      modeFewShots,
      modeId,
      imageIntent
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
