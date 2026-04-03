import type { Message } from '../../models/Message';
import type { StoreState } from '../useStore';
import { createMessageSlice } from './messageSlice';

function createSliceHarness<T>(initializer: (set: (partial: unknown) => void, get: () => StoreState) => T) {
  const state: Record<string, unknown> = {};
  const set = (partial: unknown) => {
    const next =
      typeof partial === 'function'
        ? (partial as (snapshot: Record<string, unknown>) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    Object.assign(state, next);
  };
  const get = () => state as unknown as StoreState;

  Object.assign(state, initializer(set, get));
  return state as unknown as T & Record<string, unknown>;
}

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'msg-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'hello',
    status: overrides.status ?? 'complete',
    timestamp: overrides.timestamp ?? '2026-04-03T12:00:00.000Z',
    metadata: overrides.metadata
  };
}

describe('messageSlice mergePrimaryMessagesFromCloud', () => {
  it('dedupes by message id and keeps timeline order', () => {
    const slice = createSliceHarness((set, get) => createMessageSlice(set as never, get as never, undefined as never));

    slice.messagesByConversation = {
      'conv-1': {
        messages: [
          createMessage({
            id: 'msg-local-1',
            role: 'user',
            timestamp: '2026-04-03T12:00:00.000Z',
            content: 'Local 1'
          }),
          createMessage({
            id: 'msg-local-2',
            role: 'artist',
            timestamp: '2026-04-03T12:01:00.000Z',
            content: 'Local 2'
          })
        ],
        hasMore: false,
        cursor: null,
        messageIndexById: {
          'msg-local-1': 0,
          'msg-local-2': 1
        }
      }
    };

    slice.mergePrimaryMessagesFromCloud('conv-1', [
      {
        id: 'msg-local-2',
        role: 'artist',
        content: 'Remote duplicate',
        status: 'complete',
        timestamp: '2026-04-03T12:01:00.000Z',
        metadata: { cathyReaction: '❤️' }
      },
      {
        id: 'msg-cloud-3',
        role: 'artist',
        content: 'Cloud 3',
        status: 'complete',
        timestamp: '2026-04-03T12:02:00.000Z',
        metadata: { cathyReaction: '🔥' }
      },
      {
        id: 'msg-cloud-0',
        role: 'user',
        content: 'Cloud 0',
        status: 'complete',
        timestamp: '2026-04-03T11:59:00.000Z',
        metadata: undefined
      }
    ]);

    const merged = slice.messagesByConversation['conv-1']?.messages ?? [];
    expect(merged.map((message) => message.id)).toEqual(['msg-cloud-0', 'msg-local-1', 'msg-local-2', 'msg-cloud-3']);
    expect(merged.find((message) => message.id === 'msg-local-2')?.content).toBe('Local 2');
    expect(merged.find((message) => message.id === 'msg-cloud-3')?.metadata?.cathyReaction).toBe('🔥');
  });

  it('ignores non-complete cloud messages and preserves local streaming state', () => {
    const slice = createSliceHarness((set, get) => createMessageSlice(set as never, get as never, undefined as never));

    slice.messagesByConversation = {
      'conv-1': {
        messages: [
          createMessage({
            id: 'msg-streaming',
            role: 'artist',
            status: 'streaming',
            content: 'Typing',
            timestamp: '2026-04-03T12:02:00.000Z'
          })
        ],
        hasMore: false,
        cursor: null,
        messageIndexById: {
          'msg-streaming': 0
        }
      }
    };

    slice.mergePrimaryMessagesFromCloud('conv-1', [
      {
        id: 'msg-streaming',
        role: 'artist',
        content: 'Cloud complete',
        status: 'pending',
        timestamp: '2026-04-03T12:02:05.000Z',
        metadata: undefined
      }
    ]);

    const merged = slice.messagesByConversation['conv-1']?.messages ?? [];
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('msg-streaming');
    expect(merged[0]?.status).toBe('streaming');
    expect(merged[0]?.content).toBe('Typing');
  });
});
