import { MODE_IDS } from '../config/constants';
import { artists } from '../config/artists';
import type { Conversation } from '../models/Conversation';
import { resolveChatSendContextFromState } from './chatSendContext';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const timestamp = new Date('2026-03-22T12:00:00.000Z').toISOString();
  return {
    id: overrides.id ?? 'conv-default',
    artistId: overrides.artistId ?? 'cathy-gauthier',
    title: overrides.title ?? 'Conversation',
    language: overrides.language ?? 'fr-CA',
    modeId: overrides.modeId ?? MODE_IDS.ON_JASE,
    threadType: overrides.threadType ?? 'mode',
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    lastMessagePreview: overrides.lastMessagePreview ?? ''
  };
}

describe('resolveChatSendContextFromState', () => {
  it('returns a ready context from live store state when conversation and artist exist', () => {
    const conversation = createConversation({ id: 'conv-live', artistId: artists[0]?.id ?? 'cathy-gauthier' });
    const result = resolveChatSendContextFromState(
      {
        conversations: {
          [conversation.artistId]: [conversation]
        },
        artists
      },
      conversation.id
    );

    expect(result.reason).toBeNull();
    expect(result.conversation?.id).toBe(conversation.id);
    expect(result.artist?.id).toBe(conversation.artistId);
  });

  it('returns missing_conversation when id is set but not present in state', () => {
    const result = resolveChatSendContextFromState(
      {
        conversations: {},
        artists
      },
      'conv-missing'
    );

    expect(result.reason).toBe('missing_conversation');
    expect(result.conversation).toBeNull();
    expect(result.artist).toBeNull();
  });

  it('returns missing_artist when conversation exists but artist catalog does not contain it', () => {
    const conversation = createConversation({ id: 'conv-missing-artist', artistId: 'ghost-artist' });
    const result = resolveChatSendContextFromState(
      {
        conversations: {
          [conversation.artistId]: [conversation]
        },
        artists: []
      },
      conversation.id
    );

    expect(result.reason).toBe('missing_artist');
    expect(result.conversation?.id).toBe(conversation.id);
    expect(result.artist).toBeNull();
  });

  it('returns missing_conversation_id when the id is empty or whitespace', () => {
    const result = resolveChatSendContextFromState(
      {
        conversations: {},
        artists
      },
      '   '
    );

    expect(result.reason).toBe('missing_conversation_id');
    expect(result.conversationId).toBe('');
    expect(result.conversation).toBeNull();
    expect(result.artist).toBeNull();
  });
});
