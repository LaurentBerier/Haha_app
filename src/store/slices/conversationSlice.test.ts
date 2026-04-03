import type { StoreState } from '../useStore';
import { createConversationSlice } from './conversationSlice';

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

describe('conversationSlice', () => {
  it('updates only the targeted artist conversation list', () => {
    const slice = createSliceHarness((set, get) => createConversationSlice(set as never, get as never, undefined as never));

    slice.conversations = {
      cathy: [
        {
          id: 'conv-1',
          artistId: 'cathy',
          title: 'old',
          language: 'fr-CA',
          modeId: 'default',
          threadType: 'mode',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          lastMessagePreview: 'before'
        }
      ],
      mystery: [
        {
          id: 'conv-2',
          artistId: 'mystery',
          title: 'keep',
          language: 'fr-CA',
          modeId: 'default',
          threadType: 'mode',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          lastMessagePreview: 'unchanged'
        }
      ]
    };

    slice.updateConversation('conv-1', { title: 'new title', lastMessagePreview: 'after' }, 'cathy');

    const cathyConversations = slice.conversations.cathy ?? [];
    const mysteryConversations = slice.conversations.mystery ?? [];

    expect(cathyConversations[0]?.title).toBe('new title');
    expect(cathyConversations[0]?.lastMessagePreview).toBe('after');
    expect(mysteryConversations[0]?.title).toBe('keep');
    expect(mysteryConversations[0]?.lastMessagePreview).toBe('unchanged');
  });

  it('promotes a new primary thread and demotes previous primary threads to secondary', () => {
    const slice = createSliceHarness((set, get) => createConversationSlice(set as never, get as never, undefined as never));
    const sliceWithUi = slice as typeof slice & {
      modeSelectSessionHubConversationByArtist: Record<string, string>;
    };

    sliceWithUi.modeSelectSessionHubConversationByArtist = { cathy: 'conv-primary-old' };
    slice.conversations = {
      cathy: [
        {
          id: 'conv-primary-old',
          artistId: 'cathy',
          title: 'primary',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          lastMessagePreview: 'before'
        },
        {
          id: 'conv-mode',
          artistId: 'cathy',
          title: 'mode',
          language: 'fr-CA',
          modeId: 'grill',
          threadType: 'mode',
          createdAt: '2026-03-01T01:00:00.000Z',
          updatedAt: '2026-03-01T01:00:00.000Z',
          lastMessagePreview: 'mode'
        }
      ]
    };

    const nextPrimary = slice.createAndPromotePrimaryConversation('cathy', 'fr-CA');
    const cathyConversations = slice.conversations.cathy ?? [];
    const primaryConversations = cathyConversations.filter((conversation) => conversation.threadType === 'primary');
    const demotedConversation = cathyConversations.find((conversation) => conversation.id === 'conv-primary-old') ?? null;

    expect(primaryConversations).toHaveLength(1);
    expect(primaryConversations[0]?.id).toBe(nextPrimary.id);
    expect(demotedConversation?.threadType).toBe('secondary');
    expect(slice.activeConversationId).toBe(nextPrimary.id);
    expect(sliceWithUi.modeSelectSessionHubConversationByArtist.cathy).toBe(nextPrimary.id);
  });
});
