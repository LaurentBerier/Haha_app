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

  // Also skip when the tail is a streaming greeting placeholder — this handles
  // React StrictMode double-invocation in dev and any effect re-runs during synthesis.
  const statusOk = tail.status === 'complete' || tail.status === 'streaming';
  return (
    tail.role === 'artist' &&
    statusOk &&
    typeof tail.metadata?.injectedType === 'string' &&
    GREETING_INJECTED_TYPES.has(tail.metadata.injectedType)
  );
}

