import type { StoreState } from '../store/useStore';
import { collectArtistMemoryFacts, MAX_MEMORY_FACTS } from './memoryFacts';

function createMessage(content: string, index: number, role: 'user' | 'artist' = 'user') {
  return {
    id: `msg-${index}`,
    conversationId: 'conv-1',
    role,
    content,
    status: 'complete' as const,
    timestamp: new Date(2026, 2, 20, 10, index).toISOString()
  };
}

function buildState(overrides: Partial<StoreState> = {}): StoreState {
  return {
    conversations: {
      'cathy-gauthier': [
        {
          id: 'conv-1',
          artistId: 'cathy-gauthier',
          title: 'Test',
          language: 'fr-CA',
          modeId: 'on-jase',
          createdAt: '2026-03-20T10:00:00.000Z',
          updatedAt: '2026-03-20T10:10:00.000Z',
          lastMessagePreview: ''
        }
      ]
    },
    messagesByConversation: {
      'conv-1': {
        messages: [],
        hasMore: false,
        cursor: null
      }
    },
    userProfile: {
      id: 'user-1',
      preferredName: null,
      age: null,
      sex: null,
      relationshipStatus: null,
      horoscopeSign: null,
      interests: [],
      memoryFacts: [],
      onboardingCompleted: true,
      onboardingSkipped: false
    },
    ...overrides
  } as unknown as StoreState;
}

describe('memoryFacts', () => {
  it('merges persisted profile facts with locally extracted user facts', () => {
    const state = buildState({
      userProfile: {
        id: 'user-1',
        preferredName: null,
        age: null,
        sex: null,
        relationshipStatus: null,
        horoscopeSign: null,
        interests: [],
        memoryFacts: ['Je vis a Montreal', "J'aime le cafe"],
        onboardingCompleted: true,
        onboardingSkipped: false
      },
      messagesByConversation: {
        'conv-1': {
          messages: [
            createMessage("J'aime le cafe le matin", 1),
            createMessage('Je travaille de nuit cette semaine', 2),
            createMessage('Ceci est un message artiste', 3, 'artist')
          ],
          hasMore: false,
          cursor: null
        }
      }
    });

    const facts = collectArtistMemoryFacts(state, 'cathy-gauthier', 'conv-1');

    expect(facts).toContain('Je vis a Montreal');
    expect(facts).toContain("J'aime le cafe");
    expect(facts).toContain('Je travaille de nuit cette semaine');
    expect(facts.length).toBeLessThanOrEqual(MAX_MEMORY_FACTS);
  });

  it('caps merged memory facts to MAX_MEMORY_FACTS', () => {
    const memoryFacts = Array.from({ length: 14 }, (_, index) => `Je suis fait-${index}`);
    const state = buildState({
      userProfile: {
        id: 'user-1',
        preferredName: null,
        age: null,
        sex: null,
        relationshipStatus: null,
        horoscopeSign: null,
        interests: [],
        memoryFacts,
        onboardingCompleted: true,
        onboardingSkipped: false
      }
    });

    const facts = collectArtistMemoryFacts(state, 'cathy-gauthier', 'conv-1');

    expect(facts).toHaveLength(MAX_MEMORY_FACTS);
    expect(facts[0]).toBe('Je suis fait-0');
  });
});
