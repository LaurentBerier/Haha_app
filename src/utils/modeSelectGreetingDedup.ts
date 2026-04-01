import type { Message } from '../models/Message';

const GREETING_INJECTED_TYPES = new Set(['greeting', 'tutorial_greeting']);

export function shouldSkipModeSelectGreetingInjection(messages: Message[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  const tail = messages[messages.length - 1];
  if (!tail) {
    return false;
  }

  return (
    tail.role === 'artist' &&
    tail.status === 'complete' &&
    typeof tail.metadata?.injectedType === 'string' &&
    GREETING_INJECTED_TYPES.has(tail.metadata.injectedType)
  );
}

