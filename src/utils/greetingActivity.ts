import { normalizeConversationThreadType } from '../models/Conversation';
import type { GreetingActivitySnapshot, Message } from '../models/Message';
import type { StoreState } from '../store/useStore';

const GREETING_INJECTED_TYPES = new Set(['greeting', 'tutorial_greeting']);
const CHAT_ACTIVITY_FEEDBACK_THRESHOLD = 3;
const MAX_ACTIVITY_FACTS = 2;
const SNIPPET_MAX_LENGTH = 180;

interface LastGreetingRecord {
  message: Message;
  timestampMs: number;
  snapshot: GreetingActivitySnapshot | null;
}

export interface GreetingActivityContext {
  recentActivityFacts: string[];
  askActivityFeedback: boolean;
  lastGreetingSnippet: string | null;
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
  userChatMessageCount: number;
  modeLaunchCount: number;
  gameActivityDetected: boolean;
}): string[] {
  const isEnglish = params.language.toLowerCase().startsWith('en');
  const facts: string[] = [];

  if (params.gameActivityDetected) {
    facts.push(
      isEnglish
        ? 'You played around with games/challenges since my last hello.'
        : "T'as bouge dans des jeux/defis depuis mon dernier coucou."
    );
  }

  if (params.modeLaunchCount > 0 && facts.length < MAX_ACTIVITY_FACTS) {
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

  const gameActivityDelta = buildGameDelta(currentSnapshot, lastGreeting.snapshot);
  const gameActivityDetected = gameActivityDelta > 0;
  const hasActivity = userChatMessageCount > 0 || modeLaunchCount > 0 || gameActivityDetected;
  const askActivityFeedback = gameActivityDetected || userChatMessageCount >= CHAT_ACTIVITY_FEEDBACK_THRESHOLD;

  return {
    recentActivityFacts: hasActivity
      ? buildActivityFacts({
          language,
          userChatMessageCount,
          modeLaunchCount,
          gameActivityDetected
        })
      : [],
    askActivityFeedback,
    lastGreetingSnippet: compactText(lastGreeting.message.content),
    currentSnapshot,
    hasActivity,
    userChatMessageCount,
    modeLaunchCount,
    gameActivityDelta
  };
}
