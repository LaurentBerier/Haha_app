import type { Message } from '../models/Message';
import { computeTutorialModeForRequest, isAffectionateUserMessage, shouldApplyReactionForUserMessage } from './chatBehavior';

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'msg-default',
    conversationId: overrides.conversationId ?? 'conv-1',
    role: overrides.role ?? 'artist',
    content: overrides.content ?? '',
    status: overrides.status ?? 'complete',
    timestamp: overrides.timestamp ?? '2026-03-20T00:00:00.000Z',
    metadata: overrides.metadata
  };
}

describe('chatBehavior', () => {
  describe('computeTutorialModeForRequest', () => {
    it('returns true on first user turn after tutorial greeting', () => {
      const messages: Message[] = [
        createMessage({
          id: 'greet-1',
          role: 'artist',
          content: 'Hey, comment tu vas?',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        })
      ];

      expect(computeTutorialModeForRequest(messages, {})).toBe(true);
    });

    it('returns false once one completed user message already exists', () => {
      const messages: Message[] = [
        createMessage({
          id: 'greet-1',
          role: 'artist',
          content: 'Hey, comment tu vas?',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        }),
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'Salut!',
          status: 'complete'
        })
      ];

      expect(computeTutorialModeForRequest(messages, {})).toBe(false);
    });

    it('returns false when greeting tutorial is already marked completed', () => {
      const messages: Message[] = [
        createMessage({
          id: 'greet-1',
          role: 'artist',
          content: 'Hey, comment tu vas?',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        })
      ];

      expect(computeTutorialModeForRequest(messages, { greeting: true })).toBe(false);
    });

    it('returns true when completed user turns are only before the latest tutorial greeting', () => {
      const messages: Message[] = [
        createMessage({
          id: 'user-legacy',
          role: 'user',
          content: 'Avant le tuto',
          status: 'complete'
        }),
        createMessage({
          id: 'artist-legacy',
          role: 'artist',
          content: 'Ancienne reponse'
        }),
        createMessage({
          id: 'greet-latest',
          role: 'artist',
          content: 'On commence le tuto',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        })
      ];

      expect(computeTutorialModeForRequest(messages, {})).toBe(true);
    });

    it('returns true for a newer tutorial greeting even if an older tutorial was already consumed', () => {
      const messages: Message[] = [
        createMessage({
          id: 'greet-older',
          role: 'artist',
          content: 'Vieux tuto',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        }),
        createMessage({
          id: 'user-after-old',
          role: 'user',
          content: 'J ai deja repondu',
          status: 'complete'
        }),
        createMessage({
          id: 'greet-new',
          role: 'artist',
          content: 'Nouveau tuto',
          metadata: {
            injected: true,
            injectedType: 'tutorial_greeting',
            tutorialMode: true
          }
        })
      ];

      expect(computeTutorialModeForRequest(messages, {})).toBe(true);
    });
  });

  describe('shouldApplyReactionForUserMessage', () => {
    it('returns true when previous completed user message has no reaction', () => {
      const messages: Message[] = [
        createMessage({ id: 'user-1', role: 'user', content: 'allo', status: 'complete' }),
        createMessage({ id: 'artist-1', role: 'artist', content: 'yo', status: 'complete' }),
        createMessage({ id: 'user-2', role: 'user', content: 'et la?', status: 'complete' })
      ];

      expect(shouldApplyReactionForUserMessage(messages, 'user-2')).toBe(true);
    });

    it('returns false when previous completed user message already has a reaction', () => {
      const messages: Message[] = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'allo',
          status: 'complete',
          metadata: { cathyReaction: '😂' }
        }),
        createMessage({ id: 'artist-1', role: 'artist', content: 'yo', status: 'complete' }),
        createMessage({ id: 'user-2', role: 'user', content: 'et la?', status: 'complete' })
      ];

      expect(shouldApplyReactionForUserMessage(messages, 'user-2')).toBe(false);
    });

    it('returns true for affectionate turn even if previous user message already has a reaction', () => {
      const messages: Message[] = [
        createMessage({
          id: 'user-1',
          role: 'user',
          content: 'allo',
          status: 'complete',
          metadata: { cathyReaction: '❤️' }
        }),
        createMessage({ id: 'artist-1', role: 'artist', content: 'yo', status: 'complete' }),
        createMessage({
          id: 'user-2',
          role: 'user',
          content: "Je t'aime Cathy, t'es incroyable",
          status: 'complete'
        })
      ];

      expect(shouldApplyReactionForUserMessage(messages, 'user-2')).toBe(true);
    });
  });

  describe('isAffectionateUserMessage', () => {
    it('detects affection in French', () => {
      expect(isAffectionateUserMessage("Je t'aime fort")).toBe(true);
      expect(isAffectionateUserMessage("T'es incroyable")).toBe(true);
    });

    it('detects affection in English', () => {
      expect(isAffectionateUserMessage('I love you, Cathy')).toBe(true);
      expect(isAffectionateUserMessage("You're amazing")).toBe(true);
    });

    it('ignores neutral text', () => {
      expect(isAffectionateUserMessage('Quelle heure est-il?')).toBe(false);
    });
  });
});
