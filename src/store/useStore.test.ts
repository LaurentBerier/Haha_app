import { MODE_IDS } from '../config/constants';
import { useStore } from './useStore';

describe('useStore hydration', () => {
  it('restores legacy on-jase conversations as primary threads when threadType is missing', () => {
    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': [
          {
            id: 'legacy-primary',
            artistId: 'cathy-gauthier',
            title: 'Legacy primary',
            language: 'fr-CA',
            modeId: MODE_IDS.ON_JASE,
            createdAt: '2026-03-22T12:00:00.000Z',
            updatedAt: '2026-03-22T12:00:00.000Z',
            lastMessagePreview: ''
          },
          {
            id: 'legacy-mode',
            artistId: 'cathy-gauthier',
            title: 'Legacy mode',
            language: 'fr-CA',
            modeId: MODE_IDS.GRILL,
            createdAt: '2026-03-22T13:00:00.000Z',
            updatedAt: '2026-03-22T13:00:00.000Z',
            lastMessagePreview: ''
          }
        ]
      },
      activeConversationId: 'legacy-primary',
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
          id: 'legacy-primary',
          threadType: 'primary'
        }),
        expect.objectContaining({
          id: 'legacy-mode',
          threadType: 'mode'
        })
      ])
    );
  });

  it('defaults voice auto-play to true when absent and preserves explicit false', () => {
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
  });
});
