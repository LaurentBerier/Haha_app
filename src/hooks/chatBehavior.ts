import type { Message } from '../models/Message';

function hasVisibleReaction(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const AFFECTION_PATTERNS = [
  /\b(i love you|love you|i adore you|i like you|you are amazing|you re amazing|you're amazing|you are the best|you re the best|you're the best|you are awesome|you re awesome|you're awesome)\b/i,
  /\b(je t aime|je t adore|j adore|j apprecie|je t apprecie|t es la meilleure|tu es la meilleure|t es incroyable|tu es incroyable|tu es geniale|t es geniale|tu es belle|t es belle)\b/i
];

function normalizeAffectionText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAffectionateUserMessage(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  const normalized = normalizeAffectionText(value);
  if (!normalized) {
    return false;
  }

  return AFFECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function computeTutorialModeForRequest(messages: Message[]): boolean {
  const hasTutorialGreeting = messages.some(
    (message) => message.role === 'artist' && message.metadata?.tutorialMode === true
  );
  if (!hasTutorialGreeting) {
    return false;
  }

  const completedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'complete');
  return completedUserMessages.length < 1;
}

export function shouldApplyReactionForUserMessage(messages: Message[], currentUserMessageId: string): boolean {
  const completedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'complete');
  if (completedUserMessages.length === 0) {
    return true;
  }

  const currentUserIndex = completedUserMessages.findIndex((message) => message.id === currentUserMessageId);
  const currentUserMessage = currentUserIndex === -1 ? null : completedUserMessages[currentUserIndex] ?? null;
  if (isAffectionateUserMessage(currentUserMessage?.content)) {
    return true;
  }

  const previousUserMessage =
    currentUserIndex === -1
      ? completedUserMessages[completedUserMessages.length - 1] ?? null
      : currentUserIndex > 0
        ? completedUserMessages[currentUserIndex - 1] ?? null
        : null;

  if (!previousUserMessage) {
    return true;
  }

  return !hasVisibleReaction(previousUserMessage.metadata?.cathyReaction);
}
