import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import type { MessagePage } from '../models/Message';
import {
  findArtistConversationIdForMessageId,
  isValidBoundModeSelectConversation,
  resolveModeSelectBoundConversationId
} from './modeSelectConversationBinding';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const timestamp = new Date('2026-03-22T16:00:00.000Z').toISOString();
  return {
    id: overrides.id ?? 'conv-default',
    artistId: overrides.artistId ?? 'cathy-gauthier',
    title: overrides.title ?? 'Conversation',
    language: overrides.language ?? 'fr-CA',
    modeId: overrides.modeId ?? MODE_IDS.ON_JASE,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    lastMessagePreview: overrides.lastMessagePreview ?? ''
  };
}

function createMessagePage(messageIds: string[]): MessagePage {
  return {
    messages: messageIds.map((id, index) => ({
      id,
      conversationId: `conv-${index}`,
      role: index % 2 === 0 ? 'user' : 'artist',
      content: `message-${id}`,
      status: 'complete',
      timestamp: new Date('2026-03-22T16:00:00.000Z').toISOString()
    })),
    hasMore: false,
    cursor: null,
    messageIndexById: messageIds.reduce<Record<string, number>>((acc, id, index) => {
      acc[id] = index;
      return acc;
    }, {})
  };
}

describe('modeSelectConversationBinding', () => {
  it('keeps the bound conversation when it is still valid even if activeConversationId differs', () => {
    const conversations = [
      createConversation({ id: 'bound-conv', updatedAt: '2026-03-22T10:00:00.000Z' }),
      createConversation({ id: 'active-conv', updatedAt: '2026-03-22T12:00:00.000Z' })
    ];

    const result = resolveModeSelectBoundConversationId({
      artistId: 'cathy-gauthier',
      isGreetingGateSatisfied: true,
      boundConversationId: 'bound-conv',
      activeConversationId: 'active-conv',
      conversationsForArtist: conversations
    });

    expect(result).toEqual({
      conversationId: 'bound-conv',
      reason: 'keep_bound'
    });
  });

  it('falls back to latest On Jase when bound conversation is missing', () => {
    const conversations = [
      createConversation({ id: 'on-jase-older', updatedAt: '2026-03-22T08:00:00.000Z' }),
      createConversation({ id: 'on-jase-latest', updatedAt: '2026-03-22T12:00:00.000Z' }),
      createConversation({ id: 'grill-latest', modeId: MODE_IDS.GRILL, updatedAt: '2026-03-22T14:00:00.000Z' })
    ];

    const result = resolveModeSelectBoundConversationId({
      artistId: 'cathy-gauthier',
      isGreetingGateSatisfied: true,
      boundConversationId: 'missing-bound',
      activeConversationId: null,
      conversationsForArtist: conversations
    });

    expect(result).toEqual({
      conversationId: 'on-jase-latest',
      reason: 'latest_on_jase'
    });
  });

  it('returns empty binding when greeting gate is not satisfied and nothing is currently bound', () => {
    const result = resolveModeSelectBoundConversationId({
      artistId: 'cathy-gauthier',
      isGreetingGateSatisfied: false,
      boundConversationId: '',
      activeConversationId: null,
      conversationsForArtist: [createConversation({ id: 'conv-1' })]
    });

    expect(result).toEqual({
      conversationId: '',
      reason: 'blocked_not_greeted'
    });
  });

  it('keeps a valid bound conversation while greeting gate is still warming up', () => {
    const result = resolveModeSelectBoundConversationId({
      artistId: 'cathy-gauthier',
      isGreetingGateSatisfied: false,
      boundConversationId: 'conv-1',
      activeConversationId: null,
      conversationsForArtist: [createConversation({ id: 'conv-1' })]
    });

    expect(result).toEqual({
      conversationId: 'conv-1',
      reason: 'keep_bound'
    });
  });

  it('returns missing_context when no On Jase conversation exists', () => {
    const result = resolveModeSelectBoundConversationId({
      artistId: 'cathy-gauthier',
      isGreetingGateSatisfied: true,
      boundConversationId: '',
      activeConversationId: null,
      conversationsForArtist: [createConversation({ id: 'grill-only', modeId: MODE_IDS.GRILL })]
    });

    expect(result).toEqual({
      conversationId: '',
      reason: 'missing_context'
    });
  });

  it('finds conversation id for a replaying message id', () => {
    const conversations = [
      createConversation({ id: 'conv-a', updatedAt: '2026-03-22T08:00:00.000Z' }),
      createConversation({ id: 'conv-b', updatedAt: '2026-03-22T09:00:00.000Z' })
    ];
    const messagesByConversation: Record<string, MessagePage> = {
      'conv-a': createMessagePage(['msg-a1']),
      'conv-b': createMessagePage(['msg-b1', 'msg-b2'])
    };

    expect(
      findArtistConversationIdForMessageId({
        conversationsForArtist: conversations,
        messagesByConversation,
        messageId: 'msg-b2'
      })
    ).toBe('conv-b');
    expect(isValidBoundModeSelectConversation('conv-a', conversations)).toBe(true);
  });

  it('ignores non On Jase conversations for audio mismatch rebinding', () => {
    const conversations = [
      createConversation({ id: 'conv-jase', modeId: MODE_IDS.ON_JASE }),
      createConversation({ id: 'conv-grill', modeId: MODE_IDS.GRILL })
    ];
    const messagesByConversation: Record<string, MessagePage> = {
      'conv-jase': createMessagePage(['msg-jase']),
      'conv-grill': createMessagePage(['msg-grill'])
    };

    expect(
      findArtistConversationIdForMessageId({
        conversationsForArtist: conversations,
        messagesByConversation,
        messageId: 'msg-grill'
      })
    ).toBeNull();
  });
});
