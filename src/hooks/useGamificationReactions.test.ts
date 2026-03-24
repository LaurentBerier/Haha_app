import { extractReactionTag, reactionToScoreAction } from './useGamificationReactions';

describe('useGamificationReactions helpers', () => {
  it('accepts heart reactions in [REACT:emoji] tags', () => {
    const parsed = extractReactionTag('[REACT:❤️] Merci pour ton message!');

    expect(parsed.reaction).toBe('❤️');
    expect(parsed.cleaned).toBe('Merci pour ton message!');
  });

  it('maps heart reactions to cathy_approved score action', () => {
    expect(reactionToScoreAction('❤️')).toBe('cathy_approved');
    expect(reactionToScoreAction('🫶')).toBe('cathy_approved');
    expect(reactionToScoreAction('🥰')).toBe('cathy_approved');
  });
});
