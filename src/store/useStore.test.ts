import { MODE_IDS } from '../config/constants';
import { selectPersistedSnapshot, useStore } from './useStore';

describe('useStore hydration', () => {
  it('preserves explicit persisted thread types', () => {
    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': [
          {
            id: 'primary-thread',
            artistId: 'cathy-gauthier',
            title: 'Primary',
            language: 'fr-CA',
            modeId: MODE_IDS.ON_JASE,
            threadType: 'primary',
            createdAt: '2026-03-22T12:00:00.000Z',
            updatedAt: '2026-03-22T12:00:00.000Z',
            lastMessagePreview: ''
          },
          {
            id: 'mode-thread',
            artistId: 'cathy-gauthier',
            title: 'Mode',
            language: 'fr-CA',
            modeId: MODE_IDS.GRILL,
            threadType: 'mode',
            createdAt: '2026-03-22T13:00:00.000Z',
            updatedAt: '2026-03-22T13:00:00.000Z',
            lastMessagePreview: ''
          }
        ]
      },
      activeConversationId: 'primary-thread',
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark'
      }
    });

    const conversations = useStore.getState().conversations['cathy-gauthier'] ?? [];

    expect(conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'primary-thread',
          threadType: 'primary'
        }),
        expect.objectContaining({
          id: 'mode-thread',
          threadType: 'mode'
        })
      ])
    );
  });

  it('defaults voice auto-play to true when absent and preserves explicit false', () => {
    useStore.getState().setConversationModeEnabled(true);

    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark'
      }
    });

    expect(useStore.getState().voiceAutoPlay).toBe(true);
    expect(useStore.getState().conversationModeEnabled).toBe(true);

    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark',
        voiceAutoPlay: false
      }
    });

    expect(useStore.getState().voiceAutoPlay).toBe(false);

    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark',
        conversationModeEnabled: false
      }
    });

    expect(useStore.getState().conversationModeEnabled).toBe(false);

    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark',
        conversationModeEnabled: true
      }
    });

    expect(useStore.getState().conversationModeEnabled).toBe(true);
  });

  it('persists conversation mode preference in snapshot selection', () => {
    useStore.getState().setConversationModeEnabled(false);

    const snapshot = selectPersistedSnapshot(useStore.getState());

    expect(snapshot.preferences?.conversationModeEnabled).toBe(false);
  });
});
