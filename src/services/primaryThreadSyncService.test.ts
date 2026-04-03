interface SupabaseResponse {
  data: unknown;
  error: unknown;
}

type QueryBuilder = {
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (value: number) => QueryBuilder;
  maybeSingle: <T>() => QueryBuilder;
  then: <TResult1 = SupabaseResponse, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
};

const selectResponseQueue: SupabaseResponse[] = [];
const upsertResponseQueue: SupabaseResponse[] = [];
const rpcResponseQueue: SupabaseResponse[] = [];

const mockUpsertPrimaryConversationFromCloud = jest.fn();

const mockSelectCalls: Array<{ table: string; columns: string }> = [];
const mockUpsertCalls: Array<{ table: string; payload: unknown; options: unknown }> = [];
const mockRpcCalls: Array<{ fnName: string; args: unknown }> = [];

function dequeueResponse(queue: SupabaseResponse[]): SupabaseResponse {
  const response = queue.shift();
  if (!response) {
    return { data: null, error: null };
  }
  return response;
}

function createQueryBuilder(response: SupabaseResponse): QueryBuilder {
  const builder: QueryBuilder = {
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    then: (onfulfilled, onrejected) => Promise.resolve(response).then(onfulfilled, onrejected)
  };
  return builder;
}

const mockFrom = jest.fn((table: string) => ({
  select: (columns: string) => {
    mockSelectCalls.push({ table, columns });
    return createQueryBuilder(dequeueResponse(selectResponseQueue));
  },
  upsert: (payload: unknown, options: unknown) => {
    mockUpsertCalls.push({ table, payload, options });
    return Promise.resolve(dequeueResponse(upsertResponseQueue));
  }
}));

const mockRpc = jest.fn((fnName: string, args: unknown) => {
  mockRpcCalls.push({ fnName, args });
  return Promise.resolve(dequeueResponse(rpcResponseQueue));
});

jest.mock('./supabaseClient', () => ({
  assertSupabaseConfigured: jest.fn(),
  supabase: {
    from: (...args: [string]) => mockFrom(...args),
    rpc: (...args: [string, unknown]) => mockRpc(...args)
  }
}));

const mockStoreStateRef: {
  current: {
    conversations: Record<string, Array<Record<string, unknown>>>;
    messagesByConversation: Record<string, { messages: Array<Record<string, unknown>> }>;
    upsertPrimaryConversationFromCloud: typeof mockUpsertPrimaryConversationFromCloud;
  };
} = {
  current: {
    conversations: {},
    messagesByConversation: {},
    upsertPrimaryConversationFromCloud: mockUpsertPrimaryConversationFromCloud
  }
};

jest.mock('../store/useStore', () => {
  const useStore: { getState?: () => unknown } = () => null;
  useStore.getState = () => mockStoreStateRef.current;
  return { useStore };
});

import {
  fetchPrimaryThreadMessages,
  syncPrimaryThreadArtist
} from './primaryThreadSyncService';

describe('primaryThreadSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectResponseQueue.length = 0;
    upsertResponseQueue.length = 0;
    rpcResponseQueue.length = 0;
    mockSelectCalls.length = 0;
    mockUpsertCalls.length = 0;
    mockRpcCalls.length = 0;
    mockStoreStateRef.current = {
      conversations: {},
      messagesByConversation: {},
      upsertPrimaryConversationFromCloud: mockUpsertPrimaryConversationFromCloud
    };
  });

  it('syncs only missing complete primary messages and prunes remote history to 500', async () => {
    mockStoreStateRef.current.conversations = {
      cathy: [
        {
          id: 'conv-primary',
          artistId: 'cathy',
          title: 'Local primary',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-04-03T10:00:00.000Z',
          updatedAt: '2026-04-03T11:00:00.000Z',
          lastMessagePreview: 'Salut'
        }
      ]
    };
    mockStoreStateRef.current.messagesByConversation = {
      'conv-primary': {
        messages: [
          {
            id: 'm1',
            conversationId: 'conv-primary',
            role: 'user',
            content: 'A',
            status: 'complete',
            timestamp: '2026-04-03T10:00:00.000Z'
          },
          {
            id: 'm2',
            conversationId: 'conv-primary',
            role: 'artist',
            content: 'B',
            status: 'complete',
            timestamp: '2026-04-03T10:01:00.000Z',
            metadata: {
              cathyReaction: '🔥',
              voiceUrl: 'https://private-audio',
              imageUri: 'file://image.png'
            }
          },
          {
            id: 'm3',
            conversationId: 'conv-primary',
            role: 'user',
            content: 'C',
            status: 'streaming',
            timestamp: '2026-04-03T10:02:00.000Z'
          }
        ]
      }
    };

    selectResponseQueue.push(
      { data: null, error: null },
      { data: [{ message_id: 'm1' }], error: null }
    );
    upsertResponseQueue.push(
      { data: null, error: null },
      { data: null, error: null }
    );
    rpcResponseQueue.push({ data: 1, error: null });

    const result = await syncPrimaryThreadArtist('user-1', 'cathy');

    expect(result.skipped).toBe(false);
    expect(result.uploadedMessagesCount).toBe(1);
    expect(result.localCompleteMessagesCount).toBe(2);

    const threadUpsert = mockUpsertCalls.find((call) => call.table === 'primary_threads');
    const messageUpsert = mockUpsertCalls.find((call) => call.table === 'primary_thread_messages');
    expect(threadUpsert).toBeDefined();
    expect(messageUpsert).toBeDefined();

    const uploadedMessages = Array.isArray(messageUpsert?.payload) ? messageUpsert?.payload : [];
    expect(uploadedMessages).toHaveLength(1);
    expect(uploadedMessages[0]).toEqual(
      expect.objectContaining({
        message_id: 'm2',
        status: 'complete',
        metadata: {
          cathyReaction: '🔥'
        }
      })
    );
    expect(mockRpcCalls).toEqual([
      {
        fnName: 'trim_primary_thread_messages',
        args: {
          artist_id: 'cathy',
          keep_count: 500
        }
      }
    ]);
  });

  it('applies newer cloud thread metadata locally instead of overwriting it on push', async () => {
    mockStoreStateRef.current.conversations = {
      cathy: [
        {
          id: 'conv-primary',
          artistId: 'cathy',
          title: 'Local old title',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-04-03T08:00:00.000Z',
          updatedAt: '2026-04-03T09:00:00.000Z',
          lastMessagePreview: 'Local old preview'
        }
      ]
    };
    mockStoreStateRef.current.messagesByConversation = {
      'conv-primary': {
        messages: []
      }
    };

    selectResponseQueue.push(
      {
        data: {
          user_id: 'user-1',
          artist_id: 'cathy',
          language: 'en-CA',
          title: 'Cloud fresh title',
          last_message_preview: 'Cloud fresh preview',
          created_at: '2026-04-03T08:00:00.000Z',
          updated_at: '2026-04-03T12:00:00.000Z'
        },
        error: null
      },
      { data: [], error: null }
    );
    rpcResponseQueue.push({ data: 0, error: null });

    const result = await syncPrimaryThreadArtist('user-1', 'cathy');

    expect(result.skipped).toBe(false);
    expect(result.uploadedMessagesCount).toBe(0);
    expect(mockUpsertPrimaryConversationFromCloud).toHaveBeenCalledWith('cathy', {
      language: 'en-CA',
      title: 'Cloud fresh title',
      lastMessagePreview: 'Cloud fresh preview',
      updatedAt: '2026-04-03T12:00:00.000Z',
      createdAt: '2026-04-03T08:00:00.000Z'
    });
    expect(mockUpsertCalls.some((call) => call.table === 'primary_threads')).toBe(false);
  });

  it('dedupes and sorts fetched cloud primary messages', async () => {
    selectResponseQueue.push({
      data: [
        {
          user_id: 'user-1',
          artist_id: 'cathy',
          message_id: 'm2',
          role: 'artist',
          content: 'Two',
          timestamp: '2026-04-03T10:02:00.000Z',
          status: 'complete',
          metadata: { cathyReaction: '🔥' }
        },
        {
          user_id: 'user-1',
          artist_id: 'cathy',
          message_id: 'm1',
          role: 'user',
          content: 'One',
          timestamp: '2026-04-03T10:01:00.000Z',
          status: 'complete',
          metadata: {}
        },
        {
          user_id: 'user-1',
          artist_id: 'cathy',
          message_id: 'm2',
          role: 'artist',
          content: 'Two (older)',
          timestamp: '2026-04-03T10:00:00.000Z',
          status: 'complete',
          metadata: { cathyReaction: '❤️' }
        }
      ],
      error: null
    });

    const messages = await fetchPrimaryThreadMessages('user-1', 'cathy', 500);

    expect(messages.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(messages[1]?.content).toBe('Two');
  });
});
