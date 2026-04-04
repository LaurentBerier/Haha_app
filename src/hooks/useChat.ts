import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ARTIST_IDS, MAX_MESSAGE_LENGTH, MODE_IDS } from '../config/constants';
import { buildAvailableExperiencesForPrompt } from '../config/experienceCatalog';
import { USE_MOCK_LLM } from '../config/env';
import { getAllCathyFewShots, getCathyModeFewShots } from '../data/cathy-gauthier/modeFewShots';
import { getLanguage } from '../i18n';
import type { ChatError } from '../models/ChatError';
import type { ChatImageAttachment, ChatSendPayload } from '../models/ChatSendPayload';
import { normalizeConversationThreadType, type Conversation, type ConversationThreadType } from '../models/Conversation';
import type { Message } from '../models/Message';
import type { ClaudeAvailableExperience, ClaudeContentBlock, ClaudeMessage } from '../services/claudeApiService';
import { streamClaudeResponse } from '../services/claudeApiService';
import { detectImageIntent, type ImageIntent } from '../services/imageIntentService';
import {
  finalizeMemeImage,
  proposeMemeOptions,
  type MemePlacement
} from '../services/memeGeneratorService';
import { saveMemeImage, shareMemeImage } from '../services/memeMediaService';
import { streamMockReply } from '../services/mockLlmService';
import { buildSystemPromptForArtist, formatConversationHistory } from '../services/personalityEngineService';
import { saveMemoryFacts } from '../services/profileService';
import { syncPrimaryThreadArtist } from '../services/primaryThreadSyncService';
import {
  fetchRelationshipMemory,
  getCachedRelationshipMemory,
  summarizeRelationshipMemory,
  type RelationshipMemoryExcerptMessage,
  type RelationshipMemorySnapshot
} from '../services/relationshipMemoryService';
import { addScore } from '../services/scoreManager';
import { fetchAndCacheVoice } from '../services/ttsService';
import { attemptVoiceAutoplayQueue, attemptVoiceAutoplayQueueDetailed } from '../services/voiceAutoplayService';
import { useStore } from '../store/useStore';
import { resolveLanguageForTurn } from '../utils/conversationLanguage';
import { findConversationById } from '../utils/conversationUtils';
import { generateId } from '../utils/generateId';
import { collectArtistMemoryFacts } from '../utils/memoryFacts';
import { normalizeSpeechText, splitDisplayChunkFromRaw, stripAudioTags } from '../utils/audioTags';
import { shouldAutoPlayVoice } from '../utils/voicePlaybackPolicy';
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
  conversationThreadType: ConversationThreadType;
  mockUserTurn: string;
  claudeUserMessage: ClaudeMessage;
  systemPrompt: string;
  history: ClaudeMessage[];
  language: string;
  modeFewShots: ReturnType<typeof getCathyModeFewShots>;
  modeId: string;
  availableExperiences: ClaudeAvailableExperience[];
  imageIntent: ImageIntent;
  tutorialMode: boolean;
}

interface MemeDraftState {
  draftId: string;
  image: ChatImageAttachment;
  language: string;
  optionsById: Record<string, { caption: string; placement: MemePlacement }>;
  createdAt: number;
}

type MemeAssetResult = 'saved' | 'shared' | 'permission_denied' | 'share_unavailable' | 'share_cancelled' | 'failed';

type PendingLanguageConfirmationDecision = 'confirm' | 'reject' | 'unknown';

interface PendingAutoLanguageSwitch {
  payload: ChatSendPayload;
  userMessageId: string;
  requestedLanguage: string;
  fallbackLanguage: string;
}

interface InternalSendOptions {
  conversationId?: string;
  _forcedLanguageForTurn?: string;
  _persistLanguageOverride?: boolean;
  _skipLanguageSwitchConfirmation?: boolean;
  _skipPendingConfirmationFlow?: boolean;
  _skipAddUserMessage?: boolean;
  _existingUserMessageId?: string;
}

const EMPTY_MESSAGES: Message[] = [];
const MAX_CLAUDE_HISTORY_MESSAGES = 39;
const VOICE_MAX_CLAUDE_HISTORY_MESSAGES = 8;
const CONFIRMATION_YES_PREFIX_PATTERN = /^(?:oui|ouais|yes|yeah|yep|sure|ok|okay|d accord|daccord)\b/i;
const CONFIRMATION_NO_PREFIX_PATTERN = /^(?:non|no|nope|nah|annule|annuler|cancel)\b/i;
const MEME_DRAFT_TTL_MS = 30 * 60_000;
const MEME_DRAFT_MAX_COUNT = 8;
const RELATIONSHIP_MEMORY_UPDATE_MIN_USER_TURNS = 20;
const RELATIONSHIP_MEMORY_UPDATE_COOLDOWN_MS = 30 * 60_000;
const RELATIONSHIP_MEMORY_EXCERPT_MAX_MESSAGES = 28;
const RELATIONSHIP_MEMORY_EXCERPT_MAX_CHARS = 280;
const VOICE_AUTOPLAY_MAX_ATTEMPTS = 3;
const VOICE_AUTOPLAY_RETRY_DELAY_MS = 0;
export {
  buildCathyVoiceNotice,
  resolveTerminalTtsCode,
  shouldShowUpgradeForTtsCode,
  type TerminalTtsCode,
  type VoiceErrorCode
};

function isEnglishLanguage(language: string): boolean {
  return language.toLowerCase().startsWith('en');
}

function buildMemeUploadPrompt(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Send one image and I will generate 3 meme options right away.';
  }

  return 'Envoie une image et je te propose 3 memes tout de suite.';
}

function buildMemeGeneratingMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Preparing 3 meme options...';
  }

  return 'Je te prepare 3 options de meme...';
}

function buildMemeOptionsReadyMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Here are 3 options. Tap the one you want.';
  }

  return 'Voici 3 options. Choisis celle que tu veux.';
}

function buildMemeFinalizeLoadingMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Finalizing your meme...';
  }

  return 'Je finalise ton meme...';
}

function buildMemeFinalReadyMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Perfect. Your final meme is ready.';
  }

  return 'Parfait. Ton meme final est pret.';
}

function buildMemeOptionExpiredMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'This option expired. Send the image again and I will regenerate.';
  }

  return "Cette option a expire. Renvoie l'image et je recommence.";
}

function toMemeSupportCode(requestId: string | null | undefined): string | null {
  if (typeof requestId !== 'string') {
    return null;
  }

  const normalized = requestId.trim();
  if (!normalized) {
    return null;
  }

  const [firstSegment] = normalized.split('-');
  const candidate = (firstSegment || normalized).trim().slice(0, 8).toUpperCase();
  return candidate || null;
}

function appendMemeSupportCode(baseMessage: string, supportCode: string | null, language: string): string {
  if (!supportCode) {
    return baseMessage;
  }

  if (isEnglishLanguage(language)) {
    return `${baseMessage} Support code: ${supportCode}.`;
  }

  return `${baseMessage} Code support : ${supportCode}.`;
}

function buildMemeFailureMessage(language: string, supportCode: string | null = null): string {
  if (isEnglishLanguage(language)) {
    return appendMemeSupportCode('Could not generate this meme right now. Please try again.', supportCode, language);
  }

  return appendMemeSupportCode("Impossible de generer ce meme pour le moment. Reessaie dans un instant.", supportCode, language);
}

function buildMemeServiceUnavailableMessage(language: string, supportCode: string | null = null): string {
  if (isEnglishLanguage(language)) {
    return appendMemeSupportCode('Meme service is temporarily unavailable. Please try again.', supportCode, language);
  }

  return appendMemeSupportCode('Le service meme est temporairement indisponible. Reessaie dans un instant.', supportCode, language);
}

function buildMemeUnauthorizedMessage(language: string): string {
  if (isEnglishLanguage(language)) {
    return 'Session expired. Sign in again, then send the image one more time.';
  }

  return "Session expiree. Reconnecte-toi, puis renvoie l'image.";
}

function buildMemeDataUri(mimeType: string, base64: string): string {
  const safeMimeType = mimeType.trim() || 'image/png';
  return `data:${safeMimeType};base64,${base64}`;
}

function resolveMemeErrorMessage(error: unknown, language: string): string {
  const fallback = buildMemeFailureMessage(language);
  if (!(error instanceof Error)) {
    return fallback;
  }

  const apiError = error as Error & { code?: string; status?: number; requestId?: string };
  const normalizedCode = typeof apiError.code === 'string' ? apiError.code.trim().toUpperCase() : '';
  const normalizedStatus = typeof apiError.status === 'number' ? apiError.status : 0;
  const normalizedMessage = error.message.trim().toLowerCase();
  const supportCode = toMemeSupportCode(apiError.requestId);
  if (
    normalizedStatus === 401 ||
    normalizedCode === 'UNAUTHORIZED' ||
    normalizedMessage === 'unauthorized.' ||
    normalizedMessage === 'unauthorized'
  ) {
    return buildMemeUnauthorizedMessage(language);
  }

  if (
    normalizedStatus === 503 ||
    normalizedCode === 'UPSTREAM_TIMEOUT' ||
    normalizedCode === 'RENDERER_UNAVAILABLE'
  ) {
    return buildMemeServiceUnavailableMessage(language, supportCode);
  }

  return buildMemeFailureMessage(language, supportCode);
}

function pruneMemeDraftCache(cache: Map<string, MemeDraftState>): void {
  const now = Date.now();
  for (const [draftId, draft] of cache.entries()) {
    if (now - draft.createdAt > MEME_DRAFT_TTL_MS) {
      cache.delete(draftId);
    }
  }

  if (cache.size <= MEME_DRAFT_MAX_COUNT) {
    return;
  }

  const ordered = [...cache.values()].sort((a, b) => a.createdAt - b.createdAt);
  const overflow = cache.size - MEME_DRAFT_MAX_COUNT;
  for (let index = 0; index < overflow; index += 1) {
    const candidate = ordered[index];
    if (!candidate) {
      continue;
    }
    cache.delete(candidate.draftId);
  }
}

function buildRelationshipMemoryPrimerMessage(
  memory: RelationshipMemorySnapshot | null,
  language: string
): ClaudeMessage | null {
  if (!memory) {
    return null;
  }

  const summary = memory.summary.trim();
  const facts = memory.keyFacts.filter((entry) => entry.trim().length > 0);
  if (!summary && facts.length === 0) {
    return null;
  }

  const isEnglish = language.toLowerCase().startsWith('en');
  const summarySection = summary
    ? isEnglish
      ? `Relationship summary:\n${summary}`
      : `Resume relationnel:\n${summary}`
    : isEnglish
      ? 'Relationship summary:\n(none)'
      : 'Resume relationnel:\n(aucun)';
  const factsSection = facts.length > 0 ? facts.map((fact) => `- ${fact}`).join('\n') : '- (none)';
  const content = isEnglish
    ? `${summarySection}\n\nKey facts to reuse only when relevant:\n${factsSection}\nUse at most 1-2 reminders per response. Avoid repetitive callbacks.`
    : `${summarySection}\n\nFaits cles a reutiliser seulement si pertinent:\n${factsSection}\nUtilise 1-2 rappels max par reponse. Evite les callbacks repetitifs.`;

  return {
    role: 'assistant',
    content
  };
}

function countCompleteUserTurns(messages: Message[]): number {
  return messages.reduce((count, message) => {
    if (message.role === 'user' && message.status === 'complete' && message.content.trim()) {
      return count + 1;
    }
    return count;
  }, 0);
}

function buildRelationshipMemoryExcerpt(messages: Message[]): RelationshipMemoryExcerptMessage[] {
  const excerpt = messages
    .filter((message) => message.status === 'complete' && message.content.trim())
    .slice(-RELATIONSHIP_MEMORY_EXCERPT_MAX_MESSAGES)
    .map<RelationshipMemoryExcerptMessage>((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: normalizeSpeechText(message.content, { trim: true }).slice(0, RELATIONSHIP_MEMORY_EXCERPT_MAX_CHARS)
    }))
    .filter((message) => message.content.length > 0);

  return excerpt;
}

function buildLanguageSwitchClarificationMessage(language: string): string {
  if (language.toLowerCase().startsWith('en')) {
    return 'I can switch languages. Please send the language code (for example: en, es-ES, pt-BR).';
  }

  return 'Je peux changer de langue. Ecris le code langue (ex: en, es-ES, pt-BR).';
}

function buildLanguageSwitchConfirmationMessage(language: string, requestedLanguage: string): string {
  if (language.toLowerCase().startsWith('en')) {
    return `Do you want me to switch this conversation to ${requestedLanguage}? Reply yes or no.`;
  }

  return `Veux-tu que je passe cette conversation en ${requestedLanguage}? Reponds oui ou non.`;
}

function buildAutoLanguageSwitchConfirmationReminderMessage(language: string): string {
  if (language.toLowerCase().startsWith('en')) {
    return 'Please reply yes or no so I can continue.';
  }

  return 'Reponds simplement oui ou non pour que je continue.';
}

function normalizeConfirmationInput(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolvePendingLanguageConfirmation(text: string): PendingLanguageConfirmationDecision {
  const normalized = normalizeConfirmationInput(text);
  if (!normalized) {
    return 'unknown';
  }
  const confirms = CONFIRMATION_YES_PREFIX_PATTERN.test(normalized);
  const rejects = CONFIRMATION_NO_PREFIX_PATTERN.test(normalized);
  if (confirms && !rejects) {
    return 'confirm';
  }
  if (rejects && !confirms) {
    return 'reject';
  }
  return 'unknown';
}

function clonePayload(payload: ChatSendPayload): ChatSendPayload {
  return {
    text: payload.text,
    image: payload.image
      ? {
          uri: payload.image.uri,
          base64: payload.image.base64,
          mediaType: payload.image.mediaType
        }
      : payload.image
  };
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
  const sessionUserId = useStore((state) => state.session?.user.id ?? '');
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
  const pendingAutoLanguageSwitchRef = useRef<Map<string, PendingAutoLanguageSwitch>>(new Map());
  const memeDraftsRef = useRef<Map<string, MemeDraftState>>(new Map());
  const relationshipMemorySyncInFlightRef = useRef<Set<string>>(new Set());
  const relationshipMemoryLastAttemptByKeyRef = useRef<Map<string, number>>(new Map());
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const audioPlaybackStateRef = useRef({
    isPlaying: audioPlayer.isPlaying,
    isLoading: audioPlayer.isLoading,
    currentMessageId: audioPlayer.currentMessageId
  });
  const autoplayVoiceQueueRef = useRef<
    ((
      uris: string[],
      messageId: string,
      options?: { retryOnWebUnlock?: boolean }
    ) => Promise<Awaited<ReturnType<typeof attemptVoiceAutoplayQueue>>>) | null
  >(null);

  const autoplayVoiceQueue = useCallback(
    (
      uris: string[],
      messageId: string,
      options?: { retryOnWebUnlock?: boolean }
    ): Promise<Awaited<ReturnType<typeof attemptVoiceAutoplayQueue>>> => {
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return Promise.resolve('failed');
      }
      const shouldRetryOnWebUnlock = options?.retryOnWebUnlock ?? true;
      const normalizedUris = uris.map((uri) => uri.trim()).filter(Boolean);
      if (normalizedUris.length === 0) {
        return Promise.resolve('failed');
      }

      const runAttempt = (retryOnWebUnlock: boolean) =>
        attemptVoiceAutoplayQueueDetailed({
          audioPlayer,
          uris: normalizedUris,
          messageId: normalizedMessageId,
          onWebUnlockRetry: retryOnWebUnlock
            ? () => {
                void autoplayVoiceQueueRef.current?.(normalizedUris, normalizedMessageId, {
                  retryOnWebUnlock: false
                });
              }
            : null
        });

      return (async () => {
        for (let attempt = 1; attempt <= VOICE_AUTOPLAY_MAX_ATTEMPTS; attempt += 1) {
          const result = await runAttempt(attempt === 1 ? shouldRetryOnWebUnlock : false);
          if (result.state !== 'failed') {
            return result.state;
          }

          if (result.failureReason !== 'interrupted' && result.failureReason !== 'playback_error') {
            return 'failed';
          }

          if (attempt >= VOICE_AUTOPLAY_MAX_ATTEMPTS) {
            return 'failed';
          }

          if (VOICE_AUTOPLAY_RETRY_DELAY_MS > 0) {
            await sleep(VOICE_AUTOPLAY_RETRY_DELAY_MS);
          }
        }
        return 'failed';
      })();
    },
    [audioPlayer]
  );

  const autoplayVoiceUri = useCallback(
    (uri: string, messageId: string, options?: { retryOnWebUnlock?: boolean }) => {
      return autoplayVoiceQueue([uri], messageId, options);
    },
    [autoplayVoiceQueue]
  );

  useEffect(() => {
    autoplayVoiceQueueRef.current = autoplayVoiceQueue;
  }, [autoplayVoiceQueue]);

  const shouldAutoPlayWithStoreState = useCallback(
    (overrides?: {
      conversationModeEnabled?: boolean;
      quotaBlocked?: boolean;
    }): boolean => {
      const latestState = useStore.getState();
      return shouldAutoPlayVoice({
        conversationModeEnabled: overrides?.conversationModeEnabled ?? Boolean(latestState.conversationModeEnabled),
        voiceAutoPlayEnabled: Boolean(latestState.voiceAutoPlay),
        quotaBlocked: overrides?.quotaBlocked ?? latestState.quota.isBlocked
      });
    },
    []
  );

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
    const normalizedUserId = sessionUserId.trim();
    const artistId = currentConversation?.artistId?.trim() ?? '';
    if (!normalizedUserId || !artistId) {
      return;
    }

    void fetchRelationshipMemory(normalizedUserId, artistId).catch((error: unknown) => {
      if (__DEV__) {
        console.warn('[useChat] fetchRelationshipMemory failed', error);
      }
    });
  }, [currentConversation?.artistId, sessionUserId]);

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
        conversationThreadType,
        mockUserTurn,
        claudeUserMessage,
        systemPrompt,
        history,
        language,
        modeFewShots,
        modeId,
        availableExperiences,
        imageIntent,
        tutorialMode
      } = nextJob;
      const jobConversationId = queuedConversationId.trim();
      if (!jobConversationId) {
        return;
      }
      const conversationModeEnabledForJob = useStore.getState().conversationModeEnabled;
      const shouldAutoPlayForJob = (): boolean =>
        shouldAutoPlayWithStoreState({
          conversationModeEnabled: conversationModeEnabledForJob
        });
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

            if (shouldAutoPlayForJob()) {
              const playbackState = audioPlaybackStateRef.current;
              const hasActivePlayback = playbackState.isPlaying || playbackState.isLoading;
              const matchesExpectedMessage =
                !options?.expectedCurrentMessageId || playbackState.currentMessageId === options.expectedCurrentMessageId;
              if (hasActivePlayback && matchesExpectedMessage) {
                audioPlayer.appendToQueue(uri, { messageId });
              } else if (!options?.queueOnly) {
                autoplayVoiceUri(uri, messageId);
              }
            }
          })
          .catch((error: unknown) => {
            markMessageVoiceUnavailable(messageId, resolveVoiceErrorCode(error));
          });
      };
      const waitForReplyAudioToSettle = async (): Promise<void> => {
        if (!canGenerateVoice || !shouldAutoPlayForJob()) {
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
      // Semaphore: keep TTS requests serialized to avoid rate-limit bursts.
      let ttsInFlight = 0;
      const MAX_TTS_CONCURRENT = 1;
      const ttsConcurrencyQueue: Array<{ run: () => void; cancel: () => void }> = [];
      let displayTextAccumulator = 0;
      let nextPlayableChunkIndex = 0;
      let hasQueuedAutoplayChunk = false;
      let didStartReplyAutoplay = false;
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

      const hasReplayableVoiceMetadata = (metadata: Message['metadata'] | null | undefined): boolean => {
        if (!metadata) {
          return false;
        }

        if (Array.isArray(metadata.voiceQueue) && metadata.voiceQueue.some((uri) => typeof uri === 'string' && uri.trim())) {
          return true;
        }

        return typeof metadata.voiceUrl === 'string' && metadata.voiceUrl.trim().length > 0;
      };

      const clearPendingTtsQueue = () => {
        while (ttsConcurrencyQueue.length > 0) {
          const pending = ttsConcurrencyQueue.shift();
          pending?.cancel();
        }
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
        clearPendingTtsQueue();
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

        const shouldAutoPlay = shouldAutoPlayForJob();
        let didAdvance = false;

        while (ttsChunkUrisByIndex.has(nextPlayableChunkIndex)) {
          const uri = ttsChunkUrisByIndex.get(nextPlayableChunkIndex);
          if (uri && shouldAutoPlay) {
            if (nextPlayableChunkIndex === 0 && !hasQueuedAutoplayChunk) {
              // First real chunk interrupts any filler currently playing.
              hasQueuedAutoplayChunk = true;
              void autoplayVoiceQueue([uri], artistMessageId).then((state) => {
                if (state === 'started' || state === 'pending_web_unlock') {
                  didStartReplyAutoplay = true;
                  return;
                }

                hasQueuedAutoplayChunk = false;
              });
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

        const runFetch = (): Promise<void> => {
          if (ignoreTtsUpdates) {
            return Promise.resolve();
          }

          ttsInFlight += 1;
          return fetchAndCacheVoice(normalizedChunk, artistId, language, latestAccessToken, {
            throwOnError: true
          })
            .then((uri) => {
              if (ignoreTtsUpdates) {
                return;
              }
              if (uri) {
                ttsChunkUrisByIndex.set(chunkIndex, uri);
                flushReadyPlaybackChunks();
              }
            })
            .catch((error: unknown) => {
              if (registerTerminalTtsError(error)) {
                return;
              }
            })
            .finally(() => {
              ttsInFlight -= 1;
              if (ignoreTtsUpdates) {
                clearPendingTtsQueue();
                return;
              }
              const next = ttsConcurrencyQueue.shift();
              if (next) {
                next.run();
              }
            });
        };

        const ttsPromise: Promise<void> = new Promise((resolve) => {
          const run = () => resolve(runFetch());
          const cancel = () => resolve();
          if (ignoreTtsUpdates) {
            resolve();
            return;
          }
          if (ttsInFlight < MAX_TTS_CONCURRENT) {
            run();
          } else {
            ttsConcurrencyQueue.push({ run, cancel });
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
        // Finalize any buffered tokens before switching the message to complete.
        if (flushFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(flushFrameRef.current);
          flushFrameRef.current = null;
        }
        flushBufferedTokensRef.current?.();
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
        if (resolvedFinalContent.trim().length > 0) {
          updateConversation(
            jobConversationId,
            {
              lastMessagePreview: resolvedFinalContent
            },
            artistId
          );
        }
        incrementUsage();
        const latestStateAfterReply = useStore.getState();
        const latestUserId = latestStateAfterReply.session?.user.id ?? '';
        const liveConversationAfterReply = findConversationById(
          latestStateAfterReply.conversations,
          jobConversationId
        );
        const shouldPersistPrimaryMemory =
          conversationThreadType === 'primary' &&
          normalizeConversationThreadType(liveConversationAfterReply?.threadType) === 'primary';
        if (latestUserId && shouldPersistPrimaryMemory) {
          const latestMemoryFacts = collectArtistMemoryFacts(latestStateAfterReply, artistId, jobConversationId);
          if (latestMemoryFacts.length > 0) {
            void saveMemoryFacts(latestUserId, latestMemoryFacts).catch((error: unknown) => {
              if (__DEV__) {
                console.warn('[useChat] saveMemoryFacts failed', error);
              }
            });
          }

          const primaryMessages = latestStateAfterReply.messagesByConversation[jobConversationId]?.messages ?? [];
          const sourceUserTurnCount = countCompleteUserTurns(primaryMessages);
          const cachedRelationshipMemory = getCachedRelationshipMemory(latestUserId, artistId);
          const previousUserTurnCount = cachedRelationshipMemory?.sourceUserTurnCount ?? 0;
          const turnsDelta = sourceUserTurnCount - previousUserTurnCount;
          const relationshipMemoryKey = `${latestUserId}:${artistId}`;
          const nowMs = Date.now();
          const lastAttemptMs = relationshipMemoryLastAttemptByKeyRef.current.get(relationshipMemoryKey) ?? 0;
          const hasCooldownElapsed = nowMs - lastAttemptMs >= RELATIONSHIP_MEMORY_UPDATE_COOLDOWN_MS;
          if (
            turnsDelta >= RELATIONSHIP_MEMORY_UPDATE_MIN_USER_TURNS &&
            hasCooldownElapsed &&
            !relationshipMemorySyncInFlightRef.current.has(relationshipMemoryKey)
          ) {
            const excerptMessages = buildRelationshipMemoryExcerpt(primaryMessages);
            if (excerptMessages.length > 0) {
              relationshipMemorySyncInFlightRef.current.add(relationshipMemoryKey);
              relationshipMemoryLastAttemptByKeyRef.current.set(relationshipMemoryKey, nowMs);
              const memoryLanguage =
                liveConversationAfterReply?.language?.trim() ? liveConversationAfterReply.language : language;
              void summarizeRelationshipMemory({
                userId: latestUserId,
                artistId,
                language: memoryLanguage,
                accessToken: latestStateAfterReply.session?.accessToken ?? accessToken,
                currentSummary: cachedRelationshipMemory?.summary ?? '',
                currentKeyFacts: cachedRelationshipMemory?.keyFacts ?? [],
                sourceUserTurnCount,
                excerptMessages
              })
                .catch((error: unknown) => {
                  if (__DEV__) {
                    console.warn('[useChat] summarizeRelationshipMemory failed', error);
                  }
                })
                .finally(() => {
                  relationshipMemorySyncInFlightRef.current.delete(relationshipMemoryKey);
                });
            }
          }

          void syncPrimaryThreadArtist(latestUserId, artistId).catch((error: unknown) => {
            if (__DEV__) {
              console.warn('[useChat] syncPrimaryThreadArtist failed', error);
            }
          });
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

                const shouldAutoPlay = shouldAutoPlayForJob();
                if (shouldAutoPlay && !shouldBlockInput) {
                  void autoplayVoiceQueue([uri], artistMessageId);
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

              const shouldAutoPlay = shouldAutoPlayForJob();
              if (shouldAutoPlay && !shouldBlockInput && (!hasQueuedAutoplayChunk || !didStartReplyAutoplay)) {
                void autoplayVoiceQueue(orderedVoiceUris, artistMessageId).then((state) => {
                  if (state === 'started' || state === 'pending_web_unlock') {
                    didStartReplyAutoplay = true;
                    hasQueuedAutoplayChunk = true;
                  }
                });
              }
            });
          }
        }
        const latestArtistMessageAfterVoice = getLatestArtistMessage();
        const hasReplayableVoiceForTurn = hasReplayableVoiceMetadata(latestArtistMessageAfterVoice?.metadata);
        if (pendingVoiceNoticeCode && !hasReplayableVoiceForTurn) {
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
          availableExperiences,
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
    autoplayVoiceQueue,
    autoplayVoiceUri,
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
    shouldAutoPlayWithStoreState,
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

        if (shouldAutoPlayWithStoreState()) {
          void autoplayVoiceQueue([uri], artistMessageId);
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
    [
      accessToken,
      autoplayVoiceQueue,
      currentAccountType,
      currentRole,
      resolveVoiceErrorCode,
      shouldAutoPlayWithStoreState,
      updateMessage
    ]
  );

  const chooseMemeOption = useCallback(
    async (optionMessageId: string): Promise<void> => {
      const targetConversationId = conversationIdRef.current.trim();
      const normalizedOptionMessageId = optionMessageId.trim();
      if (!targetConversationId || !normalizedOptionMessageId) {
        return;
      }

      const latestState = useStore.getState();
      const latestMessages = latestState.messagesByConversation[targetConversationId]?.messages ?? [];
      const targetConversation = findConversationById(latestState.conversations, targetConversationId);
      const language = targetConversation?.language || getLanguage();
      const selectedOptionMessage =
        latestMessages.find((message) => message.id === normalizedOptionMessageId && message.metadata?.memeType === 'option') ??
        null;

      if (!selectedOptionMessage) {
        return;
      }

      const draftId = typeof selectedOptionMessage.metadata?.memeDraftId === 'string'
        ? selectedOptionMessage.metadata.memeDraftId.trim()
        : '';
      const optionId = typeof selectedOptionMessage.metadata?.memeOptionId === 'string'
        ? selectedOptionMessage.metadata.memeOptionId.trim()
        : '';
      if (!draftId || !optionId) {
        addMessage(targetConversationId, {
          id: generateId('msg'),
          conversationId: targetConversationId,
          role: 'artist',
          content: buildMemeOptionExpiredMessage(language),
          status: 'complete',
          timestamp: new Date().toISOString(),
          metadata: {
            injected: true,
            memeType: 'upload_prompt'
          }
        });
        return;
      }

      pruneMemeDraftCache(memeDraftsRef.current);
      const draft = memeDraftsRef.current.get(draftId);
      const optionState = draft?.optionsById[optionId];
      if (!draft || !optionState) {
        addMessage(targetConversationId, {
          id: generateId('msg'),
          conversationId: targetConversationId,
          role: 'artist',
          content: buildMemeOptionExpiredMessage(language),
          status: 'complete',
          timestamp: new Date().toISOString(),
          metadata: {
            injected: true,
            memeType: 'upload_prompt'
          }
        });
        return;
      }

      if (
        latestMessages.some(
          (message) =>
            message.role === 'artist' &&
            message.status === 'pending' &&
            message.metadata?.memeType === 'final' &&
            message.metadata?.memeDraftId === draftId
        )
      ) {
        return;
      }

      const optionMessages = latestMessages.filter(
        (message) =>
          message.role === 'artist' &&
          message.metadata?.memeType === 'option' &&
          message.metadata?.memeDraftId === draftId
      );
      optionMessages.forEach((message) => {
        updateMessage(targetConversationId, message.id, {
          metadata: {
            ...(message.metadata ?? {}),
            memeSelected: message.id === normalizedOptionMessageId
          }
        });
      });

      const finalMessageId = generateId('msg');
      addMessage(targetConversationId, {
        id: finalMessageId,
        conversationId: targetConversationId,
        role: 'artist',
        content: buildMemeFinalizeLoadingMessage(language),
        status: 'pending',
        timestamp: new Date().toISOString(),
        metadata: {
          injected: true,
          memeType: 'final',
          memeDraftId: draftId,
          memeOptionId: optionId,
          memeCaption: optionState.caption,
          memePlacement: optionState.placement
        }
      });

      const latestAccessToken = latestState.session?.accessToken ?? accessToken;
      try {
        const finalized = await finalizeMemeImage({
          language: draft.language,
          image: draft.image,
          caption: optionState.caption,
          placement: optionState.placement,
          accessToken: latestAccessToken
        });

        updateMessage(targetConversationId, finalMessageId, {
          status: 'complete',
          content: buildMemeFinalReadyMessage(language),
          metadata: {
            injected: true,
            memeType: 'final',
            imageUri: buildMemeDataUri(finalized.mimeType, finalized.imageBase64),
            imageMediaType: finalized.mimeType,
            memeDraftId: draftId,
            memeOptionId: optionId,
            memeCaption: finalized.caption,
            memePlacement: finalized.placement,
            memeLogoPlacement: finalized.logoPlacement,
            memeSelected: true
          }
        });
        updateConversation(
          targetConversationId,
          {
            lastMessagePreview: buildMemeFinalReadyMessage(language),
            title: buildMemeFinalReadyMessage(language).slice(0, 30)
          },
          targetConversation?.artistId ?? ARTIST_IDS.CATHY_GAUTHIER
        );

        try {
          await addScore('meme_generated');
        } catch (error) {
          applyLocalScoreAction('meme_generated');
          if (__DEV__) {
            console.warn('[useChat] meme score action failed', error);
          }
        }
      } catch (error: unknown) {
        optionMessages.forEach((message) => {
          updateMessage(targetConversationId, message.id, {
            metadata: {
              ...(message.metadata ?? {}),
              memeSelected: false
            }
          });
        });

        updateMessage(targetConversationId, finalMessageId, {
          status: 'complete',
          content: resolveMemeErrorMessage(error, language),
          metadata: {
            injected: true,
            memeType: 'upload_prompt',
            errorMessage: error instanceof Error ? error.message : undefined
          }
        });
      }
    },
    [accessToken, addMessage, applyLocalScoreAction, updateConversation, updateMessage]
  );

  const saveMemeAsset = useCallback(async (messageId: string): Promise<MemeAssetResult> => {
    const targetConversationId = conversationIdRef.current.trim();
    const normalizedMessageId = messageId.trim();
    if (!targetConversationId || !normalizedMessageId) {
      return 'failed';
    }

    const latestState = useStore.getState();
    const message =
      latestState.messagesByConversation[targetConversationId]?.messages.find((entry) => entry.id === normalizedMessageId) ??
      null;
    const imageUri = typeof message?.metadata?.imageUri === 'string' ? message.metadata.imageUri.trim() : '';
    if (!imageUri) {
      return 'failed';
    }

    const result = await saveMemeImage({
      imageUri,
      mimeType: typeof message?.metadata?.imageMediaType === 'string' ? message.metadata.imageMediaType : undefined,
      fileNameBase: 'haha-meme'
    });
    if (result.ok) {
      return 'saved';
    }
    if (result.code === 'permission_denied') {
      return 'permission_denied';
    }
    return 'failed';
  }, []);

  const shareMemeAsset = useCallback(async (messageId: string): Promise<MemeAssetResult> => {
    const targetConversationId = conversationIdRef.current.trim();
    const normalizedMessageId = messageId.trim();
    if (!targetConversationId || !normalizedMessageId) {
      return 'failed';
    }

    const latestState = useStore.getState();
    const message =
      latestState.messagesByConversation[targetConversationId]?.messages.find((entry) => entry.id === normalizedMessageId) ??
      null;
    const imageUri = typeof message?.metadata?.imageUri === 'string' ? message.metadata.imageUri.trim() : '';
    if (!imageUri) {
      return 'failed';
    }

    const result = await shareMemeImage({
      imageUri,
      mimeType: typeof message?.metadata?.imageMediaType === 'string' ? message.metadata.imageMediaType : undefined,
      dialogTitle: 'Meme'
    });
    if (result.ok) {
      return 'shared';
    }
    if (result.code === 'share_cancelled') {
      return 'share_cancelled';
    }
    if (result.code === 'share_unavailable') {
      return 'share_unavailable';
    }
    return 'failed';
  }, []);

  const sendMessageInternal = (payload: ChatSendPayload, options?: InternalSendOptions): ChatError | null => {
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
    const preferredLanguage = targetConversation.language || getLanguage();
    const now = new Date().toISOString();
    const rawMessagesBeforeSend = getMessages(targetConversationId);
    const historyBeforeSend = formatConversationHistory(rawMessagesBeforeSend);
    const previewText = trimmed || '[Image]';
    const modeId = targetConversation.modeId || MODE_IDS.DEFAULT;
    const hasPendingMemeGeneration =
      modeId === MODE_IDS.MEME_GENERATOR &&
      hasImage &&
      rawMessagesBeforeSend.some(
        (message) =>
          message.role === 'artist' &&
          message.status === 'pending' &&
          message.metadata?.memeType === 'upload_prompt'
      );
    if (hasPendingMemeGeneration) {
      return null;
    }
    const shouldAddUserMessage = !options?._skipAddUserMessage;
    const userMessageId = options?._existingUserMessageId ?? generateId('msg');

    if (shouldAddUserMessage) {
      const userMessage: Message = {
        id: userMessageId,
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
    }

    const pendingAutoLanguageSwitch = options?._skipPendingConfirmationFlow
      ? null
      : pendingAutoLanguageSwitchRef.current.get(targetConversationId) ?? null;
    if (pendingAutoLanguageSwitch) {
      const decision = hasImage ? 'unknown' : resolvePendingLanguageConfirmation(trimmed);
      if (decision === 'confirm' || decision === 'reject') {
        pendingAutoLanguageSwitchRef.current.delete(targetConversationId);
        return sendMessageInternal(pendingAutoLanguageSwitch.payload, {
          conversationId: targetConversationId,
          _forcedLanguageForTurn:
            decision === 'confirm'
              ? pendingAutoLanguageSwitch.requestedLanguage
              : pendingAutoLanguageSwitch.fallbackLanguage,
          _persistLanguageOverride: true,
          _skipLanguageSwitchConfirmation: true,
          _skipPendingConfirmationFlow: true,
          _skipAddUserMessage: true,
          _existingUserMessageId: pendingAutoLanguageSwitch.userMessageId
        });
      }

      const reminderMessage: Message = {
        id: generateId('msg'),
        conversationId: targetConversationId,
        role: 'artist',
        content: buildAutoLanguageSwitchConfirmationReminderMessage(preferredLanguage),
        status: 'complete',
        timestamp: now,
        metadata: {
          injected: true
        }
      };
      addMessage(targetConversationId, reminderMessage);
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

    const modeFewShotsForTurn = resolveModeFewShotsForConversation(targetConversation);
    const languageResolution = resolveLanguageForTurn(trimmed, preferredLanguage);
    const languageForTurn = options?._forcedLanguageForTurn ?? languageResolution.language;
    const shouldPersistLanguage = options?._persistLanguageOverride ?? languageResolution.persistLanguage;
    const shouldAskLanguageClarification =
      options?._forcedLanguageForTurn === undefined &&
      languageResolution.explicitDetected &&
      !languageResolution.explicitRecognized;
    const shouldAskLanguageSwitchConfirmation =
      options?._forcedLanguageForTurn === undefined &&
      !options?._skipLanguageSwitchConfirmation &&
      languageResolution.requiresConfirmation;

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

    if (shouldAskLanguageSwitchConfirmation) {
      pendingAutoLanguageSwitchRef.current.set(targetConversationId, {
        payload: clonePayload(payload),
        userMessageId,
        requestedLanguage: languageForTurn,
        fallbackLanguage: preferredLanguage
      });
      const confirmationMessage: Message = {
        id: generateId('msg'),
        conversationId: targetConversationId,
        role: 'artist',
        content: buildLanguageSwitchConfirmationMessage(preferredLanguage, languageForTurn),
        status: 'complete',
        timestamp: now,
        metadata: {
          injected: true
        }
      };

      addMessage(targetConversationId, confirmationMessage);
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

    const imageIntent = hasImage ? detectImageIntent(modeId, trimmed.length > 0) : 'default';
    if (modeId === MODE_IDS.MEME_GENERATOR && !hasImage) {
      addMessage(targetConversationId, {
        id: generateId('msg'),
        conversationId: targetConversationId,
        role: 'artist',
        content: buildMemeUploadPrompt(languageForTurn),
        status: 'complete',
        timestamp: now,
        metadata: {
          injected: true,
          memeType: 'upload_prompt'
        }
      });

      updateConversation(
        targetConversationId,
        {
          language: shouldPersistLanguage ? languageForTurn : preferredLanguage,
          lastMessagePreview: previewText,
          title: previewText.slice(0, 30)
        },
        targetConversation.artistId
      );
      return null;
    }

    if (modeId === MODE_IDS.MEME_GENERATOR && payload.image) {
      const artistMessageId = generateId('msg');
      addMessage(targetConversationId, {
        id: artistMessageId,
        conversationId: targetConversationId,
        role: 'artist',
        content: buildMemeGeneratingMessage(languageForTurn),
        status: 'pending',
        timestamp: now,
        metadata: {
          injected: true,
          memeType: 'upload_prompt'
        }
      });

      const latestAccessToken = latestStateForSend.session?.accessToken ?? accessToken;
      const sourceImage = payload.image;
      const promptText = trimmed || undefined;
      void (async () => {
        try {
          const proposed = await proposeMemeOptions({
            language: languageForTurn,
            image: sourceImage,
            text: promptText,
            accessToken: latestAccessToken
          });

          const optionsById = proposed.options.reduce<Record<string, { caption: string; placement: MemePlacement }>>(
            (acc, option) => {
              acc[option.optionId] = {
                caption: option.caption,
                placement: option.placement
              };
              return acc;
            },
            {}
          );

          memeDraftsRef.current.set(proposed.draftId, {
            draftId: proposed.draftId,
            image: sourceImage,
            language: languageForTurn,
            optionsById,
            createdAt: Date.now()
          });
          pruneMemeDraftCache(memeDraftsRef.current);

          updateMessage(targetConversationId, artistMessageId, {
            status: 'complete',
            content: buildMemeOptionsReadyMessage(languageForTurn),
            metadata: {
              injected: true,
              memeType: 'upload_prompt',
              memeDraftId: proposed.draftId
            }
          });

          proposed.options.forEach((option, index) => {
            addMessage(targetConversationId, {
              id: generateId('msg'),
              conversationId: targetConversationId,
              role: 'artist',
              content: option.caption,
              status: 'complete',
              timestamp: new Date().toISOString(),
              metadata: {
                injected: true,
                imageUri: buildMemeDataUri(option.mimeType, option.previewImageBase64),
                imageMediaType: option.mimeType,
                memeType: 'option',
                memeDraftId: proposed.draftId,
                memeOptionId: option.optionId,
                memeOptionRank: index + 1,
                memeCaption: option.caption,
                memePlacement: option.placement,
                memeLogoPlacement: option.logoPlacement,
                memeSelected: false
              }
            });
          });

          updateConversation(
            targetConversationId,
            {
              lastMessagePreview: buildMemeOptionsReadyMessage(languageForTurn),
              title: buildMemeOptionsReadyMessage(languageForTurn).slice(0, 30)
            },
            targetConversation.artistId
          );
        } catch (error: unknown) {
          updateMessage(targetConversationId, artistMessageId, {
            status: 'complete',
            content: resolveMemeErrorMessage(error, languageForTurn),
            metadata: {
              injected: true,
              memeType: 'upload_prompt',
              errorMessage: error instanceof Error ? error.message : undefined
            }
          });
        }
      })();

      updateConversation(
        targetConversationId,
        {
          language: shouldPersistLanguage ? languageForTurn : preferredLanguage,
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

    const availableExperiences = buildAvailableExperiencesForPrompt(targetConversation.artistId, languageForTurn);
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
    const latestSessionUserId = (latestStateForSend.session?.user.id ?? '').trim();
    const relationshipMemory = latestSessionUserId
      ? getCachedRelationshipMemory(latestSessionUserId, targetConversation.artistId)
      : null;
    if (latestSessionUserId && !relationshipMemory) {
      void fetchRelationshipMemory(latestSessionUserId, targetConversation.artistId).catch((error: unknown) => {
        if (__DEV__) {
          console.warn('[useChat] fetchRelationshipMemory on send failed', error);
        }
      });
    }
    const relationshipMemoryMessage = buildRelationshipMemoryPrimerMessage(relationshipMemory, languageForTurn);
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
      ...(relationshipMemoryMessage ? [relationshipMemoryMessage] : []),
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
      userMessageId,
      artistId: targetConversation.artistId,
      conversationThreadType: normalizeConversationThreadType(targetConversation.threadType),
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
      availableExperiences,
      imageIntent,
      tutorialMode
    });
    runNext();

    updateConversation(
      targetConversationId,
      {
        language: shouldPersistLanguage ? languageForTurn : preferredLanguage,
        lastMessagePreview: previewText,
        title: previewText.slice(0, 30)
      },
      targetConversation.artistId
    );

    return null;
  };

  const sendMessage = (payload: ChatSendPayload, options?: { conversationId?: string }): ChatError | null =>
    sendMessageInternal(payload, options);

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
      pendingAutoLanguageSwitchRef.current.clear();
      memeDraftsRef.current.clear();
      relationshipMemorySyncInFlightRef.current.clear();
      relationshipMemoryLastAttemptByKeyRef.current.clear();
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
    chooseMemeOption,
    saveMemeAsset,
    shareMemeAsset,
    retryMessage,
    retryVoiceForMessage,
    audioPlayer
  };
}
