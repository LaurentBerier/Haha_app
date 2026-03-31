import type { Conversation } from '../models/Conversation';
import type { Message, MessagePage } from '../models/Message';
import type { StoreState } from '../store/useStore';
import { deriveGreetingActivityContext } from './greetingActivity';

function createConversation(id: string, threadType: Conversation['threadType'] = 'primary'): Conversation {
  const now = new Date('2026-03-31T12:00:00.000Z').toISOString();
  return {
    id,
    artistId: 'cathy-gauthier',
    title: 'Conversation',
    language: 'fr-CA',
    modeId: 'on-jase',
    threadType,
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: ''
  };
}

function createMessage(params: Partial<Message> & { id: string; role: Message['role']; timestamp: string }): Message {
  return {
    id: params.id,
    conversationId: params.conversationId ?? 'conv-1',
    role: params.role,
    content: params.content ?? '',
    status: params.status ?? 'complete',
    timestamp: params.timestamp,
    metadata: params.metadata
  };
}

function createMessagePage(messages: Message[]): MessagePage {
  return {
    messages,
    hasMore: false,
    cursor: null,
    messageIndexById: messages.reduce<Record<string, number>>((acc, message, index) => {
      acc[message.id] = index;
      return acc;
    }, {})
  };
}

function createState(params: {
  messages: Message[];
  extraConversations?: Array<{
    id: string;
    threadType?: Conversation['threadType'];
    messages: Message[];
  }>;
  punchlinesCreated?: number;
  battleWins?: number;
  memesGenerated?: number;
  photosRoasted?: number;
  roastsGenerated?: number;
}): StoreState {
  const baseConversations: Conversation[] = [createConversation('conv-1')];
  const messagesByConversation: Record<string, MessagePage> = {
    'conv-1': createMessagePage(params.messages)
  };

  for (const extra of params.extraConversations ?? []) {
    baseConversations.push(createConversation(extra.id, extra.threadType ?? 'mode'));
    messagesByConversation[extra.id] = createMessagePage(extra.messages);
  }

  return {
    conversations: {
      'cathy-gauthier': baseConversations
    },
    messagesByConversation,
    punchlinesCreated: params.punchlinesCreated ?? 0,
    battleWins: params.battleWins ?? 0,
    memesGenerated: params.memesGenerated ?? 0,
    photosRoasted: params.photosRoasted ?? 0,
    roastsGenerated: params.roastsGenerated ?? 0
  } as unknown as StoreState;
}

describe('deriveGreetingActivityContext', () => {
  it('returns no activity when there is no previous greeting', () => {
    const state = createState({
      messages: [createMessage({ id: 'msg-user', role: 'user', timestamp: '2026-03-31T12:01:00.000Z', content: 'Salut!' })]
    });

    const result = deriveGreetingActivityContext(state, 'cathy-gauthier', 'fr-CA');

    expect(result.hasActivity).toBe(false);
    expect(result.recentActivityFacts).toEqual([]);
    expect(result.askActivityFeedback).toBe(false);
    expect(result.lastGreetingSnippet).toBeNull();
  });

  it('detects user chat + mode activity since last greeting', () => {
    const state = createState({
      messages: [
        createMessage({
          id: 'msg-greeting',
          role: 'artist',
          timestamp: '2026-03-31T12:00:00.000Z',
          content: "Hey, on part ca?",
          metadata: {
            injected: true,
            injectedType: 'greeting',
            greetingActivitySnapshot: {
              punchlinesCreated: 0,
              battleWins: 0,
              memesGenerated: 0,
              photosRoasted: 0,
              roastsGenerated: 0,
              capturedAt: '2026-03-31T12:00:00.000Z'
            }
          }
        }),
        createMessage({
          id: 'msg-user',
          role: 'user',
          timestamp: '2026-03-31T12:01:00.000Z',
          content: 'Petit suivi'
        })
      ],
      extraConversations: [
        {
          id: 'conv-mode-1',
          threadType: 'mode',
          messages: [
            createMessage({
              id: 'msg-mode-nudge',
              conversationId: 'conv-mode-1',
              role: 'artist',
              timestamp: '2026-03-31T12:02:00.000Z',
              content: 'Mode prechauffe',
              metadata: {
                injected: true,
                injectedType: 'mode_nudge'
              }
            })
          ]
        }
      ]
    });

    const result = deriveGreetingActivityContext(state, 'cathy-gauthier', 'fr-CA');

    expect(result.hasActivity).toBe(true);
    expect(result.userChatMessageCount).toBe(1);
    expect(result.modeLaunchCount).toBe(1);
    expect(result.askActivityFeedback).toBe(false);
    expect(result.recentActivityFacts.length).toBeGreaterThan(0);
  });

  it('counts mode_nudge activity from mode-thread conversations', () => {
    const state = createState({
      messages: [
        createMessage({
          id: 'msg-greeting',
          role: 'artist',
          timestamp: '2026-03-31T12:00:00.000Z',
          content: 'Hey!',
          metadata: {
            injected: true,
            injectedType: 'greeting',
            greetingActivitySnapshot: {
              punchlinesCreated: 0,
              battleWins: 0,
              memesGenerated: 0,
              photosRoasted: 0,
              roastsGenerated: 0,
              capturedAt: '2026-03-31T12:00:00.000Z'
            }
          }
        })
      ],
      extraConversations: [
        {
          id: 'conv-mode-2',
          threadType: 'mode',
          messages: [
            createMessage({
              id: 'msg-mode-nudge',
              conversationId: 'conv-mode-2',
              role: 'artist',
              timestamp: '2026-03-31T12:05:00.000Z',
              content: 'Mode intro',
              metadata: {
                injected: true,
                injectedType: 'mode_nudge'
              }
            })
          ]
        }
      ]
    });

    const result = deriveGreetingActivityContext(state, 'cathy-gauthier', 'fr-CA');

    expect(result.modeLaunchCount).toBe(1);
    expect(result.hasActivity).toBe(true);
  });

  it('flags feedback question when game activity delta is positive', () => {
    const state = createState({
      messages: [
        createMessage({
          id: 'msg-greeting',
          role: 'artist',
          timestamp: '2026-03-31T12:00:00.000Z',
          content: "Hey, on repart?",
          metadata: {
            injected: true,
            injectedType: 'greeting',
            greetingActivitySnapshot: {
              punchlinesCreated: 0,
              battleWins: 0,
              memesGenerated: 0,
              photosRoasted: 0,
              roastsGenerated: 0,
              capturedAt: '2026-03-31T12:00:00.000Z'
            }
          }
        })
      ],
      punchlinesCreated: 2,
      roastsGenerated: 1
    });

    const result = deriveGreetingActivityContext(state, 'cathy-gauthier', 'fr-CA');

    expect(result.gameActivityDelta).toBeGreaterThan(0);
    expect(result.hasActivity).toBe(true);
    expect(result.askActivityFeedback).toBe(true);
    expect(result.recentActivityFacts.join(' ')).toContain('jeux/defis');
  });

  it('keeps feedback question disabled when activity is only one short user message', () => {
    const state = createState({
      messages: [
        createMessage({
          id: 'msg-greeting',
          role: 'artist',
          timestamp: '2026-03-31T12:00:00.000Z',
          content: "Hey, comment ca va?",
          metadata: {
            injected: true,
            injectedType: 'greeting',
            greetingActivitySnapshot: {
              punchlinesCreated: 3,
              battleWins: 1,
              memesGenerated: 0,
              photosRoasted: 0,
              roastsGenerated: 0,
              capturedAt: '2026-03-31T12:00:00.000Z'
            }
          }
        }),
        createMessage({
          id: 'msg-user',
          role: 'user',
          timestamp: '2026-03-31T12:01:00.000Z',
          content: 'Re-salut'
        })
      ],
      punchlinesCreated: 3,
      battleWins: 1
    });

    const result = deriveGreetingActivityContext(state, 'cathy-gauthier', 'fr-CA');

    expect(result.hasActivity).toBe(true);
    expect(result.userChatMessageCount).toBe(1);
    expect(result.askActivityFeedback).toBe(false);
  });
});
