import { normalizeConversationThreadType } from '../models/Conversation';
import type { GreetingActivitySnapshot, Message } from '../models/Message';
import type { GameType } from '../games/types';
import { getLaunchableExperienceByGameId, getLaunchableExperienceByModeId } from '../config/experienceCatalog';
import type { StoreState } from '../store/useStore';
import type { SessionExperienceType } from '../store/slices/uiSlice';

const GREETING_INJECTED_TYPES = new Set(['greeting', 'tutorial_greeting']);
const CHAT_ACTIVITY_FEEDBACK_THRESHOLD = 3;
const MAX_ACTIVITY_FACTS = 2;
const SNIPPET_MAX_LENGTH = 180;

interface LastGreetingRecord {
  message: Message;
  timestampMs: number;
  snapshot: GreetingActivitySnapshot | null;
}

interface RecentSessionExperienceRecord {
  experienceType: SessionExperienceType;
  experienceId: string;
  occurredAt: string;
  occurredAtMs: number;
}

export interface GreetingActivityContext {
  recentActivityFacts: string[];
  askActivityFeedback: boolean;
  lastGreetingSnippet: string | null;
  recentExperienceName: string | null;
  recentExperienceType: SessionExperienceType | null;
  activityFeedbackCue: string | null;
  currentSnapshot: GreetingActivitySnapshot;
  hasActivity: boolean;
  userChatMessageCount: number;
  modeLaunchCount: number;
  gameActivityDelta: number;
}

function normalizeCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeSnapshot(value: unknown): GreetingActivitySnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const capturedAt = typeof raw.capturedAt === 'string' ? raw.capturedAt.trim() : '';
  if (!capturedAt) {
    return null;
  }

  return {
    punchlinesCreated: normalizeCounter(raw.punchlinesCreated),
    battleWins: normalizeCounter(raw.battleWins),
    memesGenerated: normalizeCounter(raw.memesGenerated),
    photosRoasted: normalizeCounter(raw.photosRoasted),
    roastsGenerated: normalizeCounter(raw.roastsGenerated),
    capturedAt
  };
}

function buildCurrentSnapshot(state: StoreState): GreetingActivitySnapshot {
  return {
    punchlinesCreated: normalizeCounter(state.punchlinesCreated),
    battleWins: normalizeCounter(state.battleWins),
    memesGenerated: normalizeCounter(state.memesGenerated),
    photosRoasted: normalizeCounter(state.photosRoasted),
    roastsGenerated: normalizeCounter(state.roastsGenerated),
    capturedAt: new Date().toISOString()
  };
}

function toTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSessionExperienceEvent(value: unknown): RecentSessionExperienceRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const rawType = typeof raw.experienceType === 'string' ? raw.experienceType : '';
  const experienceType = rawType === 'mode' || rawType === 'game' ? rawType : null;
  if (!experienceType) {
    return null;
  }

  const experienceId = typeof raw.experienceId === 'string' ? raw.experienceId.trim() : '';
  if (!experienceId) {
    return null;
  }

  const occurredAt = typeof raw.occurredAt === 'string' ? raw.occurredAt.trim() : '';
  if (!occurredAt) {
    return null;
  }
  const occurredAtMs = toTimestampMs(occurredAt);
  if (occurredAtMs <= 0) {
    return null;
  }

  return {
    experienceType,
    experienceId,
    occurredAt,
    occurredAtMs
  };
}

function resolveRecentExperienceName(
  artistId: string,
  event: RecentSessionExperienceRecord,
  language: string
): string | null {
  const isEnglish = language.toLowerCase().startsWith('en');

  if (event.experienceType === 'mode') {
    const experience = getLaunchableExperienceByModeId(artistId, event.experienceId);
    if (!experience) {
      return null;
    }
    return isEnglish ? experience.nameEn : experience.nameFr;
  }

  const experience = getLaunchableExperienceByGameId(artistId, event.experienceId as GameType);
  if (!experience) {
    return null;
  }
  return isEnglish ? experience.nameEn : experience.nameFr;
}

function buildRecentExperienceFact(
  language: string,
  recentExperienceName: string,
  recentExperienceType: SessionExperienceType
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return recentExperienceType === 'game'
      ? `You just came back from ${recentExperienceName}.`
      : `You just came back from ${recentExperienceName}.`;
  }

  return recentExperienceType === 'game'
    ? `Tu reviens du jeu ${recentExperienceName}.`
    : `Tu reviens de ${recentExperienceName}.`;
}

function buildActivityFeedbackCue(
  language: string,
  recentExperience: RecentSessionExperienceRecord | null
): string | null {
  if (!recentExperience) {
    return null;
  }

  const isEnglish = language.toLowerCase().startsWith('en');
  if (recentExperience.experienceId === 'tarot-cathy') {
    return isEnglish ? 'Did you like what your future looked like in that reading?' : "Pis, t'aimes ton avenir?";
  }

  if (recentExperience.experienceId === 'grill') {
    return isEnglish
      ? "Hope I didn't go too hard on you there. You good?"
      : "Bon, j'espere que j'suis pas alle trop fort sur toi. T'es correct?";
  }

  return isEnglish
    ? 'Did you like that experience, or should I switch the angle?'
    : "T'as aime ca, ou tu veux que j'ajuste le ton?";
}

function compactText(value: string, maxLength = SNIPPET_MAX_LENGTH): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function isGreetingMessage(message: Message): boolean {
  if (message.role !== 'artist') {
    return false;
  }
  const injectedType = message.metadata?.injectedType;
  return typeof injectedType === 'string' && GREETING_INJECTED_TYPES.has(injectedType);
}

function findLastGreetingRecord(state: StoreState, artistId: string): LastGreetingRecord | null {
  const conversations = state.conversations[artistId] ?? [];
  let latest: LastGreetingRecord | null = null;

  for (const conversation of conversations) {
    if (normalizeConversationThreadType(conversation.threadType) !== 'primary') {
      continue;
    }

    const page = state.messagesByConversation[conversation.id];
    if (!page || !Array.isArray(page.messages) || page.messages.length === 0) {
      continue;
    }

    for (const message of page.messages) {
      if (!isGreetingMessage(message)) {
        continue;
      }

      const timestampMs = toTimestampMs(message.timestamp);
      if (!latest || timestampMs > latest.timestampMs) {
        latest = {
          message,
          timestampMs,
          snapshot: normalizeSnapshot(message.metadata?.greetingActivitySnapshot)
        };
      }
    }
  }

  return latest;
}

function buildGameDelta(currentSnapshot: GreetingActivitySnapshot, previousSnapshot: GreetingActivitySnapshot | null): number {
  if (!previousSnapshot) {
    return 0;
  }

  return (
    Math.max(0, currentSnapshot.punchlinesCreated - previousSnapshot.punchlinesCreated) +
    Math.max(0, currentSnapshot.battleWins - previousSnapshot.battleWins) +
    Math.max(0, currentSnapshot.memesGenerated - previousSnapshot.memesGenerated) +
    Math.max(0, currentSnapshot.photosRoasted - previousSnapshot.photosRoasted) +
    Math.max(0, currentSnapshot.roastsGenerated - previousSnapshot.roastsGenerated)
  );
}

function buildActivityFacts(params: {
  language: string;
  recentExperienceName: string | null;
  recentExperienceType: SessionExperienceType | null;
  userChatMessageCount: number;
  modeLaunchCount: number;
  gameActivityDetected: boolean;
}): string[] {
  const isEnglish = params.language.toLowerCase().startsWith('en');
  const facts: string[] = [];

  if (params.recentExperienceName && params.recentExperienceType) {
    facts.push(
      buildRecentExperienceFact(params.language, params.recentExperienceName, params.recentExperienceType)
    );
  }

  if (
    params.gameActivityDetected &&
    facts.length < MAX_ACTIVITY_FACTS &&
    !(params.recentExperienceName && params.recentExperienceType === 'game')
  ) {
    facts.push(
      isEnglish
        ? 'You played around with games/challenges since my last hello.'
        : "T'as bouge dans des jeux/defis depuis mon dernier coucou."
    );
  }

  if (
    params.modeLaunchCount > 0 &&
    facts.length < MAX_ACTIVITY_FACTS &&
    !(params.recentExperienceName && params.recentExperienceType === 'mode')
  ) {
    facts.push(
      isEnglish ? 'You also explored other modes in between.' : "T'as aussi explore d'autres modes entre-temps."
    );
  }

  if (params.userChatMessageCount > 0 && facts.length < MAX_ACTIVITY_FACTS) {
    facts.push(
      isEnglish
        ? params.userChatMessageCount >= CHAT_ACTIVITY_FEEDBACK_THRESHOLD
          ? "We already had a solid exchange since my last greeting."
          : 'We already traded a quick exchange since my last greeting.'
        : params.userChatMessageCount >= CHAT_ACTIVITY_FEEDBACK_THRESHOLD
          ? "On s'est deja fait une bonne run d'echanges depuis mon dernier bonjour."
          : "On a deja repris un petit echange depuis mon dernier bonjour."
    );
  }

  return facts.slice(0, MAX_ACTIVITY_FACTS);
}

export function deriveGreetingActivityContext(state: StoreState, artistId: string, language: string): GreetingActivityContext {
  const currentSnapshot = buildCurrentSnapshot(state);
  const lastGreeting = findLastGreetingRecord(state, artistId);
  const lastGreetingTimestampMs = lastGreeting?.timestampMs ?? 0;

  if (!lastGreeting) {
    return {
      recentActivityFacts: [],
      askActivityFeedback: false,
      lastGreetingSnippet: null,
      recentExperienceName: null,
      recentExperienceType: null,
      activityFeedbackCue: null,
      currentSnapshot,
      hasActivity: false,
      userChatMessageCount: 0,
      modeLaunchCount: 0,
      gameActivityDelta: 0
    };
  }

  let userChatMessageCount = 0;
  let modeLaunchCount = 0;

  const conversations = state.conversations[artistId] ?? [];
  for (const conversation of conversations) {
    const page = state.messagesByConversation[conversation.id];
    if (!page || !Array.isArray(page.messages) || page.messages.length === 0) {
      continue;
    }

    for (const message of page.messages) {
      if (toTimestampMs(message.timestamp) <= lastGreetingTimestampMs) {
        continue;
      }

      if (message.role === 'user' && message.status === 'complete') {
        userChatMessageCount += 1;
        continue;
      }

      if (
        message.role === 'artist' &&
        message.status === 'complete' &&
        message.metadata?.injectedType === 'mode_nudge'
      ) {
        modeLaunchCount += 1;
      }
    }
  }

  const allExperienceEvents = Array.isArray(state.sessionExperienceEventsByArtist?.[artistId])
    ? state.sessionExperienceEventsByArtist[artistId]
        .map((entry) => normalizeSessionExperienceEvent(entry))
        .filter((entry): entry is RecentSessionExperienceRecord => Boolean(entry))
    : [];
  let recentExperienceEvent: RecentSessionExperienceRecord | null = null;
  for (const event of allExperienceEvents) {
    if (event.occurredAtMs <= lastGreetingTimestampMs) {
      continue;
    }
    if (!recentExperienceEvent || event.occurredAtMs > recentExperienceEvent.occurredAtMs) {
      recentExperienceEvent = event;
    }
  }
  const recentExperienceName = recentExperienceEvent
    ? resolveRecentExperienceName(artistId, recentExperienceEvent, language)
    : null;

  const gameActivityDelta = buildGameDelta(currentSnapshot, lastGreeting.snapshot);
  const gameActivityDetected = gameActivityDelta > 0;
  const hasRecentExperience = Boolean(recentExperienceEvent);
  const hasActivity = userChatMessageCount > 0 || modeLaunchCount > 0 || gameActivityDetected || hasRecentExperience;
  const askActivityFeedback =
    hasRecentExperience || gameActivityDetected || userChatMessageCount >= CHAT_ACTIVITY_FEEDBACK_THRESHOLD;
  const activityFeedbackCue = askActivityFeedback ? buildActivityFeedbackCue(language, recentExperienceEvent) : null;

  return {
    recentActivityFacts: hasActivity
      ? buildActivityFacts({
          language,
          recentExperienceName,
          recentExperienceType: recentExperienceEvent?.experienceType ?? null,
          userChatMessageCount,
          modeLaunchCount,
          gameActivityDetected
        })
      : [],
    askActivityFeedback,
    lastGreetingSnippet: compactText(lastGreeting.message.content),
    recentExperienceName,
    recentExperienceType: recentExperienceEvent?.experienceType ?? null,
    activityFeedbackCue,
    currentSnapshot,
    hasActivity,
    userChatMessageCount,
    modeLaunchCount,
    gameActivityDelta
  };
}
