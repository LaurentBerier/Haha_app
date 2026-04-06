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

export function computeTutorialModeForRequest(
  messages: Message[],
  completedTutorials: Record<string, boolean>
): boolean {
  if (completedTutorials.greeting) {
    return false;
  }

  let lastTutorialGreetingIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'artist') {
      continue;
    }

    const isTutorialGreeting =
      message.metadata?.tutorialMode === true || message.metadata?.injectedType === 'tutorial_greeting';
    if (isTutorialGreeting) {
      lastTutorialGreetingIndex = index;
      break;
    }
  }

  if (lastTutorialGreetingIndex < 0) {
    return false;
  }

  for (let index = lastTutorialGreetingIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === 'user' && message.status === 'complete') {
      return false;
    }
  }

  return true;
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
