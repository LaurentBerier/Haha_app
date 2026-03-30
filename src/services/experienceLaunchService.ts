import { router } from 'expo-router';
import { ARTIST_IDS, MODE_IDS } from '../config/constants';
import {
  VISIBLE_CONVERSATION_MODE_IDS,
  VISIBLE_GAME_IDS,
  getLaunchableExperiencesForArtist,
  type LaunchableExperienceDefinition
} from '../config/experienceCatalog';
import type { GameType } from '../games/types';
import type { Message } from '../models/Message';
import { resolveExperienceLaunchIntent } from './experienceLaunchIntent';
import { fetchModeIntroFromApi, generateModeIntro } from './modeIntroService';
import { fetchAndCacheVoice } from './ttsService';
import { useStore } from '../store/useStore';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../utils/accountTypeUtils';
import { normalizeSpeechText, stripAudioTags } from '../utils/audioTags';
import { generateId } from '../utils/generateId';

export interface ExperienceLaunchOutcome {
  launched: boolean;
  targetType?: 'mode' | 'game';
  targetId?: string;
  conversationId?: string;
}

interface LaunchModeConversationParams {
  artistId: string;
  modeId: string;
  fallbackLanguage: string;
  preferredConversationLanguage?: string;
}

const MODE_INTRO_API_TIMEOUT_MS = 1_500;
const MODE_INTRO_MIN_LOADING_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveVoiceErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const explicitCode = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
    if (explicitCode) {
      return explicitCode;
    }
    const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
    if (status === 429) {
      return 'RATE_LIMIT_EXCEEDED';
    }
    if (status === 403) {
      return 'TTS_FORBIDDEN';
    }
    if (status === 401) {
      return 'UNAUTHORIZED';
    }
  }

  return 'TTS_PROVIDER_ERROR';
}

function mergeMessageMetadata(
  conversationId: string,
  messageId: string,
  patch: NonNullable<Message['metadata']>
): void {
  const latestState = useStore.getState();
  const latestMessage = latestState.messagesByConversation[conversationId]?.messages.find((entry) => entry.id === messageId);
  if (!latestMessage) {
    return;
  }

  latestState.updateMessage(conversationId, messageId, {
    metadata: {
      ...(latestMessage.metadata ?? {}),
      ...patch
    }
  });
}

async function resolveModeIntroMessage(params: {
  artistId: string;
  modeId: string;
  language: string;
  accessToken: string;
  preferredName?: string | null;
  memoryFacts?: string[];
  userProfile?: ReturnType<typeof useStore.getState>['userProfile'];
}): Promise<string> {
  const fallbackIntro = generateModeIntro(params.modeId, params.userProfile);
  const token = params.accessToken.trim();
  const shouldAttemptApiIntro =
    token.length > 0 && (params.modeId === MODE_IDS.ON_JASE || params.modeId === MODE_IDS.GRILL);
  const startTs = Date.now();
  let resolvedIntro = fallbackIntro;

  if (shouldAttemptApiIntro) {
    const timeoutMarker = Symbol('mode_intro_timeout');
    try {
      const raced = await Promise.race<string | null | symbol>([
        fetchModeIntroFromApi({
          artistId: params.artistId,
          modeId: params.modeId,
          language: params.language,
          accessToken: token,
          preferredName: params.preferredName,
          memoryFacts: params.memoryFacts
        }),
        sleep(MODE_INTRO_API_TIMEOUT_MS).then(() => timeoutMarker)
      ]);

      if (typeof raced === 'string' && raced.trim()) {
        resolvedIntro = raced.trim();
      }
    } catch {
      // Keep local fallback when intro API fails.
    }
  }

  const elapsedMs = Date.now() - startTs;
  const remainingLoadingMs = MODE_INTRO_MIN_LOADING_MS - elapsedMs;
  if (remainingLoadingMs > 0) {
    await sleep(remainingLoadingMs);
  }

  return resolvedIntro;
}

async function synthesizeModeIntroVoice(params: {
  conversationId: string;
  messageId: string;
  artistId: string;
  language: string;
  content: string;
}): Promise<void> {
  if (params.artistId !== ARTIST_IDS.CATHY_GAUTHIER) {
    return;
  }

  const normalizedSpeech = normalizeSpeechText(params.content, { trim: true });
  if (!normalizedSpeech) {
    return;
  }

  const latestState = useStore.getState();
  const latestSessionUser = latestState.session?.user;
  const effectiveAccountType = resolveEffectiveAccountType(
    latestSessionUser?.accountType ?? null,
    latestSessionUser?.role ?? null
  );
  const latestAccessToken = latestState.session?.accessToken ?? '';

  if (!hasVoiceAccessForAccountType(effectiveAccountType) || !latestAccessToken.trim()) {
    return;
  }

  mergeMessageMetadata(params.conversationId, params.messageId, {
    voiceStatus: 'generating',
    voiceErrorCode: undefined,
    voiceUrl: undefined,
    voiceQueue: undefined,
    voiceChunkBoundaries: undefined
  });

  try {
    const uri = await fetchAndCacheVoice(normalizedSpeech, params.artistId, params.language, latestAccessToken, {
      throwOnError: true,
      purpose: 'reply'
    });
    if (!uri) {
      mergeMessageMetadata(params.conversationId, params.messageId, {
        voiceStatus: 'unavailable',
        voiceErrorCode: 'TTS_PROVIDER_ERROR',
        voiceUrl: undefined,
        voiceQueue: undefined,
        voiceChunkBoundaries: undefined
      });
      return;
    }

    const boundary = stripAudioTags(normalizedSpeech, { trim: true }).length;
    mergeMessageMetadata(params.conversationId, params.messageId, {
      voiceStatus: 'ready',
      voiceErrorCode: undefined,
      voiceUrl: uri,
      voiceQueue: [uri],
      voiceChunkBoundaries: [boundary]
    });
  } catch (error: unknown) {
    mergeMessageMetadata(params.conversationId, params.messageId, {
      voiceStatus: 'unavailable',
      voiceErrorCode: resolveVoiceErrorCode(error),
      voiceUrl: undefined,
      voiceQueue: undefined,
      voiceChunkBoundaries: undefined
    });
  }
}

function resolveConversationLanguage(
  artist: { supportedLanguages: string[]; defaultLanguage: string },
  fallbackLanguage: string,
  preferredConversationLanguage?: string
): string {
  const resolveSupportedFamilyMatch = (candidate: string): string | null => {
    const normalizedPrefix = candidate.toLowerCase().split('-')[0] ?? '';
    if (!normalizedPrefix) {
      return null;
    }

    return (
      artist.supportedLanguages.find((language) =>
        language.toLowerCase().startsWith(normalizedPrefix)
      ) ?? null
    );
  };

  const preferred =
    typeof preferredConversationLanguage === 'string' ? preferredConversationLanguage.trim() : '';
  if (preferred && artist.supportedLanguages.includes(preferred)) {
    return preferred;
  }
  if (preferred) {
    const preferredFamilyMatch = resolveSupportedFamilyMatch(preferred);
    if (preferredFamilyMatch) {
      return preferredFamilyMatch;
    }
  }

  const fallback = typeof fallbackLanguage === 'string' ? fallbackLanguage.trim() : '';
  if (fallback && artist.supportedLanguages.includes(fallback)) {
    return fallback;
  }
  if (fallback) {
    const fallbackFamilyMatch = resolveSupportedFamilyMatch(fallback);
    if (fallbackFamilyMatch) {
      return fallbackFamilyMatch;
    }
  }

  return artist.defaultLanguage;
}

function canLaunchModeForArtist(
  artist: { supportedModeIds: string[] },
  modeId: string
): boolean {
  if (!VISIBLE_CONVERSATION_MODE_IDS.includes(modeId)) {
    return false;
  }

  if (modeId === MODE_IDS.ON_JASE) {
    return true;
  }

  return artist.supportedModeIds.includes(modeId);
}

function canLaunchGame(gameId: GameType): boolean {
  return VISIBLE_GAME_IDS.includes(gameId);
}

function launchModeConversation(params: LaunchModeConversationParams): ExperienceLaunchOutcome {
  const state = useStore.getState();
  const artist = state.artists.find((entry) => entry.id === params.artistId);
  if (!artist || !canLaunchModeForArtist(artist, params.modeId)) {
    return { launched: false };
  }

  const conversationLanguage = resolveConversationLanguage(
    artist,
    params.fallbackLanguage,
    params.preferredConversationLanguage
  );
  const nextConversation = state.createConversation(artist.id, conversationLanguage, params.modeId, {
    threadType: 'mode'
  });

  const introMessageId = generateId('msg');
  const timestamp = new Date().toISOString();

  state.addMessage(nextConversation.id, {
    id: introMessageId,
    conversationId: nextConversation.id,
    role: 'artist',
    content: '',
    status: 'pending',
    timestamp,
    metadata: {
      injected: true,
      injectedType: 'mode_nudge'
    }
  });

  state.setActiveConversation(nextConversation.id);
  router.push(`/chat/${nextConversation.id}`);

  const accessToken = state.session?.accessToken ?? '';
  const preferredName = state.userProfile?.preferredName ?? null;
  const memoryFacts = Array.isArray(state.userProfile?.memoryFacts) ? state.userProfile.memoryFacts : [];

  void (async () => {
    const resolvedIntro = await resolveModeIntroMessage({
      artistId: artist.id,
      modeId: params.modeId,
      language: nextConversation.language,
      accessToken,
      preferredName,
      memoryFacts,
      userProfile: state.userProfile
    });
    const latestState = useStore.getState();
    latestState.updateMessage(nextConversation.id, introMessageId, {
      content: resolvedIntro,
      status: 'complete'
    });
    latestState.updateConversation(
      nextConversation.id,
      {
        lastMessagePreview: resolvedIntro.slice(0, 120),
        title: resolvedIntro.slice(0, 30)
      },
      artist.id
    );
    await synthesizeModeIntroVoice({
      conversationId: nextConversation.id,
      messageId: introMessageId,
      artistId: artist.id,
      language: nextConversation.language,
      content: resolvedIntro
    });
  })();

  return {
    launched: true,
    targetType: 'mode',
    targetId: params.modeId,
    conversationId: nextConversation.id
  };
}

function launchGameRoute(artistId: string, gameId: GameType): ExperienceLaunchOutcome {
  if (!canLaunchGame(gameId)) {
    return { launched: false };
  }

  router.push(`/games/${artistId}/${gameId}`);

  return {
    launched: true,
    targetType: 'game',
    targetId: gameId
  };
}

function launchFromExperience(
  experience: LaunchableExperienceDefinition,
  params: {
    artistId: string;
    fallbackLanguage: string;
    preferredConversationLanguage?: string;
  }
): ExperienceLaunchOutcome {
  if (experience.type === 'mode' && experience.modeId) {
    return launchModeConversation({
      artistId: params.artistId,
      modeId: experience.modeId,
      fallbackLanguage: params.fallbackLanguage,
      preferredConversationLanguage: params.preferredConversationLanguage
    });
  }

  if (experience.type === 'game' && experience.gameId) {
    return launchGameRoute(params.artistId, experience.gameId);
  }

  return { launched: false };
}

export function launchVisibleModeConversation(params: LaunchModeConversationParams): ExperienceLaunchOutcome {
  return launchModeConversation(params);
}

export function launchVisibleGameRoute(artistId: string, gameId: GameType): ExperienceLaunchOutcome {
  return launchGameRoute(artistId, gameId);
}

export function tryLaunchExperienceFromText(params: {
  artistId: string;
  text: string;
  fallbackLanguage: string;
  preferredConversationLanguage?: string;
}): ExperienceLaunchOutcome {
  const experiences = getLaunchableExperiencesForArtist(params.artistId);
  const intent = resolveExperienceLaunchIntent(params.text, experiences);
  if (!intent) {
    return { launched: false };
  }

  return launchFromExperience(intent.experience, {
    artistId: params.artistId,
    fallbackLanguage: params.fallbackLanguage,
    preferredConversationLanguage: params.preferredConversationLanguage
  });
}
