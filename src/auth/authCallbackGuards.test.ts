import { isDuplicateAuthCallbackUrl, shouldShortCircuitDuplicateAuthCallback } from './authCallbackGuards';

describe('authCallbackGuards', () => {
  it('detects duplicate callback URLs', () => {
    expect(isDuplicateAuthCallbackUrl('https://app.example/auth/callback?code=1', 'https://app.example/auth/callback?code=1')).toBe(
      true
    );
    expect(isDuplicateAuthCallbackUrl('https://app.example/auth/callback?code=1', 'https://app.example/auth/callback?code=2')).toBe(
      false
    );
    expect(isDuplicateAuthCallbackUrl(null, null)).toBe(false);
  });

  it('short-circuits only when URL repeats last handled', () => {
    expect(shouldShortCircuitDuplicateAuthCallback('a', 'a')).toBe(true);
    expect(shouldShortCircuitDuplicateAuthCallback('a', 'b')).toBe(false);
    expect(shouldShortCircuitDuplicateAuthCallback(null, null)).toBe(false);
  });
});
