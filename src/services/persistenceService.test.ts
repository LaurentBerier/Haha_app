import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPersistedSnapshot } from './persistenceService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn()
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn()
}));

describe('persistenceService', () => {
  beforeAll(() => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns snapshot when persisted payload is valid', async () => {
    const validSnapshot = {
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': [
          {
            id: 'conv-1',
            artistId: 'cathy-gauthier',
            title: 'Nouvelle conversation',
            language: 'fr-CA',
            modeId: 'default',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessagePreview: 'Bonjour'
          }
        ]
      },
      activeConversationId: 'conv-1',
      messagesByConversation: {
        'conv-1': {
          messages: [
            {
              id: 'msg-1',
              conversationId: 'conv-1',
              role: 'user',
              content: 'Hello',
              status: 'complete',
              timestamp: new Date().toISOString()
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
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(validSnapshot));

    const snapshot = await loadPersistedSnapshot();

    expect(snapshot).toEqual(validSnapshot);
  });

  it('returns null when snapshot has corrupted nested content', async () => {
    const invalidSnapshot = {
      selectedArtistId: 'cathy-gauthier',
      conversations: {
        'cathy-gauthier': 'invalid-list'
      },
      activeConversationId: 'conv-1',
      messagesByConversation: {
        'conv-1': {
          messages: [],
          hasMore: false,
          cursor: null
        }
      }
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(invalidSnapshot));

    const snapshot = await loadPersistedSnapshot();

    expect(snapshot).toBeNull();
  });

  it('cleans invalid JSON payloads from storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{invalid-json');

    const snapshot = await loadPersistedSnapshot();

    expect(snapshot).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('ha-ha-store-v1');
  });
});
