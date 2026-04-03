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

  it('upserts cloud primary metadata while preserving a single primary thread per artist', () => {
    const slice = createSliceHarness((set, get) => createConversationSlice(set as never, get as never, undefined as never));
    const sliceWithUi = slice as typeof slice & {
      modeSelectSessionHubConversationByArtist: Record<string, string>;
    };

    sliceWithUi.modeSelectSessionHubConversationByArtist = {};
    slice.conversations = {
      cathy: [
        {
          id: 'conv-primary-old',
          artistId: 'cathy',
          title: 'Primary old',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          lastMessagePreview: 'before'
        },
        {
          id: 'conv-primary-legacy',
          artistId: 'cathy',
          title: 'Primary legacy',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-02-28T00:00:00.000Z',
          updatedAt: '2026-02-28T00:00:00.000Z',
          lastMessagePreview: 'legacy'
        }
      ]
    };

    const upserted = slice.upsertPrimaryConversationFromCloud('cathy', {
      language: 'en-CA',
      title: 'Cloud title',
      lastMessagePreview: 'Cloud preview',
      updatedAt: '2026-04-03T12:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z'
    });

    const cathyConversations = slice.conversations.cathy ?? [];
    const primaryConversations = cathyConversations.filter((conversation) => conversation.threadType === 'primary');
    const demotedLegacy = cathyConversations.find((conversation) => conversation.id === 'conv-primary-legacy') ?? null;

    expect(upserted).not.toBeNull();
    expect(primaryConversations).toHaveLength(1);
    expect(primaryConversations[0]?.id).toBe('conv-primary-old');
    expect(primaryConversations[0]?.language).toBe('en-CA');
    expect(primaryConversations[0]?.title).toBe('Cloud title');
    expect(primaryConversations[0]?.lastMessagePreview).toBe('Cloud preview');
    expect(demotedLegacy?.threadType).toBe('secondary');
    expect(sliceWithUi.modeSelectSessionHubConversationByArtist.cathy).toBe('conv-primary-old');
  });

  it('creates a primary thread from cloud metadata when none exists locally', () => {
    const slice = createSliceHarness((set, get) => createConversationSlice(set as never, get as never, undefined as never));
    const sliceWithUi = slice as typeof slice & {
      modeSelectSessionHubConversationByArtist: Record<string, string>;
    };

    sliceWithUi.modeSelectSessionHubConversationByArtist = {};
    slice.conversations = {
      cathy: [
        {
          id: 'conv-secondary',
          artistId: 'cathy',
          title: 'Secondary',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'secondary',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          lastMessagePreview: 'before'
        }
      ]
    };

    const upserted = slice.upsertPrimaryConversationFromCloud('cathy', {
      language: 'fr-CA',
      title: 'Cloud primary',
      lastMessagePreview: 'Cloud latest',
      updatedAt: '2026-04-03T13:00:00.000Z',
      createdAt: '2026-04-03T12:00:00.000Z'
    });

    const cathyConversations = slice.conversations.cathy ?? [];
    const primaryConversations = cathyConversations.filter((conversation) => conversation.threadType === 'primary');

    expect(upserted).not.toBeNull();
    expect(primaryConversations).toHaveLength(1);
    expect(primaryConversations[0]?.title).toBe('Cloud primary');
    expect(sliceWithUi.modeSelectSessionHubConversationByArtist.cathy).toBe(primaryConversations[0]?.id);
  });

  it('keeps local metadata when cloud primary metadata is older', () => {
    const slice = createSliceHarness((set, get) => createConversationSlice(set as never, get as never, undefined as never));
    const sliceWithUi = slice as typeof slice & {
      modeSelectSessionHubConversationByArtist: Record<string, string>;
    };

    sliceWithUi.modeSelectSessionHubConversationByArtist = {};
    slice.conversations = {
      cathy: [
        {
          id: 'conv-primary-local',
          artistId: 'cathy',
          title: 'Local latest title',
          language: 'fr-CA',
          modeId: 'on-jase',
          threadType: 'primary',
          createdAt: '2026-04-03T10:00:00.000Z',
          updatedAt: '2026-04-03T12:00:00.000Z',
          lastMessagePreview: 'Local latest preview'
        }
      ]
    };

    slice.upsertPrimaryConversationFromCloud('cathy', {
      language: 'en-CA',
      title: 'Cloud stale title',
      lastMessagePreview: 'Cloud stale preview',
      updatedAt: '2026-04-03T11:00:00.000Z',
      createdAt: '2026-04-03T10:00:00.000Z'
    });

    const primaryConversation =
      (slice.conversations.cathy ?? []).find((conversation) => conversation.threadType === 'primary') ?? null;
    expect(primaryConversation?.title).toBe('Local latest title');
    expect(primaryConversation?.lastMessagePreview).toBe('Local latest preview');
    expect(primaryConversation?.updatedAt).toBe('2026-04-03T12:00:00.000Z');
    expect(sliceWithUi.modeSelectSessionHubConversationByArtist.cathy).toBe('conv-primary-local');
  });
});
