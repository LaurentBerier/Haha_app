import type { Message } from '../models/Message';
import { shouldSkipModeSelectGreetingInjection } from './modeSelectGreetingDedup';

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? 'msg-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    role: overrides.role ?? 'artist',
    content: overrides.content ?? 'hello',
    status: overrides.status ?? 'complete',
    timestamp: overrides.timestamp ?? '2026-04-01T10:00:00.000Z',
    metadata: overrides.metadata
  };
}

describe('shouldSkipModeSelectGreetingInjection', () => {
  it('returns true when tail is a complete injected greeting', () => {
    const messages = [
      createMessage({
        id: 'msg-greeting',
        role: 'artist',
        status: 'complete',
        metadata: {
          injected: true,
          injectedType: 'greeting'
        }
      })
    ];

    expect(shouldSkipModeSelectGreetingInjection(messages)).toBe(true);
  });

  it('returns false when tail is a user message', () => {
    const messages = [
      createMessage({
        id: 'msg-greeting',
        role: 'artist',
        status: 'complete',
        metadata: {
          injected: true,
          injectedType: 'greeting'
        }
      }),
      createMessage({
        id: 'msg-user',
        role: 'user',
        status: 'complete',
        metadata: undefined
      })
    ];

    expect(shouldSkipModeSelectGreetingInjection(messages)).toBe(false);
  });

  it('returns false when tail is a non-greeting artist message', () => {
    const messages = [
      createMessage({
        id: 'msg-nudge',
        role: 'artist',
        status: 'complete',
        metadata: {
          injected: true,
          injectedType: 'mode_nudge'
        }
      })
    ];

    expect(shouldSkipModeSelectGreetingInjection(messages)).toBe(false);
  });

  it('returns false when greeting tail is not complete', () => {
    const messages = [
      createMessage({
        id: 'msg-greeting-pending',
        role: 'artist',
        status: 'pending',
        metadata: {
          injected: true,
          injectedType: 'tutorial_greeting'
        }
      })
    ];

    expect(shouldSkipModeSelectGreetingInjection(messages)).toBe(false);
  });
});

