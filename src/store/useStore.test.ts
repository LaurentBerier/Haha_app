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

  it('defaults emoji style to classic when absent and preserves off/full', () => {
    useStore.getState().setEmojiStyle('classic');

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

    expect(useStore.getState().emojiStyle).toBe('classic');

    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark',
        emojiStyle: 'full'
      }
    });

    expect(useStore.getState().emojiStyle).toBe('full');

    const snapshot = selectPersistedSnapshot(useStore.getState());
    expect(snapshot.preferences?.emojiStyle).toBe('full');
  });

  it('sanitizes stale web blob voice metadata during hydration', () => {
    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': [
          {
            id: 'conv-web-voice',
            artistId: 'cathy-gauthier',
            title: 'Web Voice',
            language: 'fr-CA',
            modeId: MODE_IDS.ON_JASE,
            threadType: 'primary',
            createdAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            lastMessagePreview: 'Salut'
          }
        ]
      },
      activeConversationId: 'conv-web-voice',
      messagesByConversation: {
        'conv-web-voice': {
          messages: [
            {
              id: 'msg-web-stale',
              conversationId: 'conv-web-voice',
              role: 'artist',
              content: 'Salut Laurent',
              status: 'complete',
              timestamp: '2026-04-05T00:00:00.000Z',
              metadata: {
                voiceStatus: 'ready',
                voiceUrl: 'blob:https://app.ha-ha.ai/stale-audio',
                voiceQueue: ['blob:https://app.ha-ha.ai/stale-audio']
              }
            }
          ],
          hasMore: false,
          cursor: null
        }
      },
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark'
      }
    });

    const hydratedMessage = useStore.getState().messagesByConversation['conv-web-voice']?.messages[0];
    expect(hydratedMessage?.metadata?.voiceStatus).toBe('unavailable');
    expect(hydratedMessage?.metadata?.voiceErrorCode).toBe('TTS_PROVIDER_ERROR');
    expect(hydratedMessage?.metadata?.voiceUrl).toBeUndefined();
    expect(hydratedMessage?.metadata?.voiceQueue).toBeUndefined();
  });

  it('keeps replayable non-blob queue entries when stale blob voiceUrl is present', () => {
    useStore.getState().hydrateStore({
      ownerUserId: null,
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': [
          {
            id: 'conv-web-voice-ready',
            artistId: 'cathy-gauthier',
            title: 'Web Voice Ready',
            language: 'fr-CA',
            modeId: MODE_IDS.ON_JASE,
            threadType: 'primary',
            createdAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            lastMessagePreview: 'Salut'
          }
        ]
      },
      activeConversationId: 'conv-web-voice-ready',
      messagesByConversation: {
        'conv-web-voice-ready': {
          messages: [
            {
              id: 'msg-web-ready',
              conversationId: 'conv-web-voice-ready',
              role: 'artist',
              content: 'Salut encore',
              status: 'complete',
              timestamp: '2026-04-05T00:00:00.000Z',
              metadata: {
                voiceStatus: 'ready',
                voiceUrl: 'blob:https://app.ha-ha.ai/stale-audio',
                voiceQueue: [
                  'blob:https://app.ha-ha.ai/stale-audio',
                  'https://cdn.ha-ha.ai/audio/fresh.mp3'
                ]
              }
            }
          ],
          hasMore: false,
          cursor: null
        }
      },
      preferences: {
        language: 'fr-CA',
        displayMode: 'dark'
      }
    });

    const hydratedMessage = useStore.getState().messagesByConversation['conv-web-voice-ready']?.messages[0];
    expect(hydratedMessage?.metadata?.voiceStatus).toBe('ready');
    expect(hydratedMessage?.metadata?.voiceErrorCode).toBeUndefined();
    expect(hydratedMessage?.metadata?.voiceUrl).toBe('https://cdn.ha-ha.ai/audio/fresh.mp3');
    expect(hydratedMessage?.metadata?.voiceQueue).toEqual(['https://cdn.ha-ha.ai/audio/fresh.mp3']);
  });
});
