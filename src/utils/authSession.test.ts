import type { AuthSession } from '../models/AuthUser';
import { areAuthSessionsEquivalent, isSameSessionUser } from './authSession';

function buildSession(overrides: Partial<NonNullable<AuthSession>> = {}): NonNullable<AuthSession> {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Laurent',
      avatarUrl: null,
      role: 'user',
      accountType: 'free',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.user ?? {})
    },
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    expiresAt: 1_700_000_000,
    ...overrides
  };
}

describe('authSession helpers', () => {
  it('returns true for equivalent sessions', () => {
    const left = buildSession();
    const right = buildSession();

    expect(areAuthSessionsEquivalent(left, right)).toBe(true);
  });

  it('returns false when token payload changes', () => {
    const left = buildSession();
    const right = buildSession({ accessToken: 'access-token-2' });

    expect(areAuthSessionsEquivalent(left, right)).toBe(false);
  });

  it('handles null sessions safely', () => {
    expect(areAuthSessionsEquivalent(null, null)).toBe(true);
    expect(areAuthSessionsEquivalent(buildSession(), null)).toBe(false);
    expect(areAuthSessionsEquivalent(null, buildSession())).toBe(false);
  });

  it('detects when two sessions belong to the same user', () => {
    const left = buildSession({ accessToken: 'access-token-1' });
    const right = buildSession({ accessToken: 'access-token-2', expiresAt: 1_700_000_500 });
    const other = buildSession({
      user: {
        id: 'user-2',
        email: 'other@example.com',
        displayName: 'Autre',
        avatarUrl: null,
        role: 'user',
        accountType: 'free',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    });

    expect(isSameSessionUser(left, right)).toBe(true);
    expect(isSameSessionUser(left, other)).toBe(false);
    expect(isSameSessionUser(left, null)).toBe(false);
  });
});
