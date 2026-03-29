import { router } from 'expo-router';
import { MODE_IDS } from '../config/constants';
import {
  VISIBLE_CONVERSATION_MODE_IDS,
  VISIBLE_GAME_IDS,
  getLaunchableExperiencesForArtist,
  type LaunchableExperienceDefinition
} from '../config/experienceCatalog';
import type { GameType } from '../games/types';
import { resolveExperienceLaunchIntent } from './experienceLaunchIntent';
import { fetchModeIntroFromApi, generateModeIntro } from './modeIntroService';
import { useStore } from '../store/useStore';
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

function resolveConversationLanguage(
  artist: { supportedLanguages: string[]; defaultLanguage: string },
  fallbackLanguage: string,
  preferredConversationLanguage?: string
): string {
  const preferred =
    typeof preferredConversationLanguage === 'string' ? preferredConversationLanguage.trim() : '';
  if (preferred && artist.supportedLanguages.includes(preferred)) {
    return preferred;
  }

  const fallback = typeof fallbackLanguage === 'string' ? fallbackLanguage.trim() : '';
  if (fallback && artist.supportedLanguages.includes(fallback)) {
    return fallback;
  }

  const normalizedFallbackPrefix = fallback.toLowerCase().split('-')[0] ?? '';
  if (normalizedFallbackPrefix) {
    const familyMatch = artist.supportedLanguages.find((language) =>
      language.toLowerCase().startsWith(normalizedFallbackPrefix)
    );
    if (familyMatch) {
      return familyMatch;
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
  const introMessage = generateModeIntro(params.modeId, state.userProfile);
  const timestamp = new Date().toISOString();

  state.addMessage(nextConversation.id, {
    id: introMessageId,
    conversationId: nextConversation.id,
    role: 'artist',
    content: introMessage,
    status: 'complete',
    timestamp,
    metadata: {
      injected: true,
      injectedType: 'mode_nudge'
    }
  });

  state.updateConversation(
    nextConversation.id,
    {
      lastMessagePreview: introMessage.slice(0, 120),
      title: introMessage.slice(0, 30)
    },
    artist.id
  );

  state.setActiveConversation(nextConversation.id);
  router.push(`/chat/${nextConversation.id}`);

  const accessToken = state.session?.accessToken ?? '';
  const preferredName = state.userProfile?.preferredName ?? null;
  const memoryFacts = Array.isArray(state.userProfile?.memoryFacts) ? state.userProfile.memoryFacts : [];

  void fetchModeIntroFromApi({
    artistId: artist.id,
    modeId: params.modeId,
    language: nextConversation.language,
    accessToken,
    preferredName,
    memoryFacts
  })
    .then((generatedIntro) => {
      if (!generatedIntro) {
        return;
      }

      const latestState = useStore.getState();
      latestState.updateMessage(nextConversation.id, introMessageId, {
        content: generatedIntro,
        status: 'complete'
      });
      latestState.updateConversation(
        nextConversation.id,
        {
          lastMessagePreview: generatedIntro.slice(0, 120),
          title: generatedIntro.slice(0, 30)
        },
        artist.id
      );
    })
    .catch(() => {
      // Keep fallback intro when API intro is unavailable.
    });

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
