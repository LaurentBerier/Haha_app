import type { Message } from '../models/Message';

function hasVisibleReaction(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
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
