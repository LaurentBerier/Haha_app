jest.mock('../../services/profileService', () => ({
  fetchProfile: jest.fn(),
  fetchAccountType: jest.fn()
}));

import type { AuthSession } from '../../models/AuthUser';
import type { UserProfile } from '../../models/UserProfile';
import type { StoreState } from '../useStore';
import { fetchAccountType, fetchProfile } from '../../services/profileService';
import { createAuthSlice } from './authSlice';

function createSliceHarness(initialState: Partial<StoreState> = {}) {
  const state: Record<string, unknown> = {
    userProfile: null
  };
  const setCalls: Array<Record<string, unknown>> = [];

  const set = (partial: unknown) => {
    const next =
      typeof partial === 'function'
        ? (partial as (snapshot: Record<string, unknown>) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    setCalls.push(next);
    Object.assign(state, next);
  };
  const get = () => state as unknown as StoreState;

  Object.assign(state, createAuthSlice(set as never, get as never, undefined as never), initialState);
  return {
    state: state as unknown as StoreState,
    setCalls
  };
}

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

function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    preferredName: null,
    age: null,
    sex: null,
    relationshipStatus: null,
    horoscopeSign: null,
    interests: [],
    onboardingCompleted: true,
    onboardingSkipped: false,
    ...overrides
  };
}

describe('authSlice', () => {
  const fetchProfileMock = fetchProfile as jest.MockedFunction<typeof fetchProfile>;
  const fetchAccountTypeMock = fetchAccountType as jest.MockedFunction<typeof fetchAccountType>;

  beforeEach(() => {
    fetchProfileMock.mockReset();
    fetchAccountTypeMock.mockReset();
  });

  it('sets unauthenticated state when session is null', async () => {
    const { state } = createSliceHarness({
      authStatus: 'authenticated',
      session: buildSession(),
      userProfile: buildProfile()
    });

    await state.setSession(null);

    expect(state.authStatus).toBe('unauthenticated');
    expect(state.session).toBeNull();
    expect(state.userProfile).toBeNull();
  });

  it('keeps loading during bootstrap and resolves to authenticated', async () => {
    fetchProfileMock.mockResolvedValue(buildProfile());
    fetchAccountTypeMock.mockResolvedValue('regular');
    const { state, setCalls } = createSliceHarness({
      authStatus: 'loading',
      session: null
    });

    await state.setSession(buildSession());

    expect(setCalls[0]?.authStatus).toBe('loading');
    expect(state.authStatus).toBe('authenticated');
    expect(state.session?.user.accountType).toBe('regular');
  });

  it('does not re-enter loading when refreshing session for the same authenticated user', async () => {
    fetchProfileMock.mockResolvedValue(buildProfile());
    fetchAccountTypeMock.mockResolvedValue('premium');
    const currentSession = buildSession();
    const refreshedSession = buildSession({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresAt: 1_700_000_500
    });
    const { state, setCalls } = createSliceHarness({
      authStatus: 'authenticated',
      session: currentSession,
      userProfile: buildProfile({ preferredName: 'Laurent' })
    });

    await state.setSession(refreshedSession);

    expect(setCalls.some((call) => call.authStatus === 'loading')).toBe(false);
    expect(state.authStatus).toBe('authenticated');
    expect(state.session?.accessToken).toBe('access-token-2');
    expect(state.session?.user.accountType).toBe('premium');
  });

  it('enters loading when switching to another authenticated user', async () => {
    fetchProfileMock.mockResolvedValue(
      buildProfile({
        id: 'user-2'
      })
    );
    fetchAccountTypeMock.mockResolvedValue('regular');
    const currentSession = buildSession();
    const nextSession = buildSession({
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
    const { state, setCalls } = createSliceHarness({
      authStatus: 'authenticated',
      session: currentSession,
      userProfile: buildProfile({ preferredName: 'Laurent' })
    });

    await state.setSession(nextSession);

    expect(setCalls[0]?.authStatus).toBe('loading');
    expect(state.authStatus).toBe('authenticated');
    expect(state.session?.user.id).toBe('user-2');
  });

  it('keeps authenticated state on same-user refresh even if profile fetch fails', async () => {
    fetchProfileMock.mockRejectedValue(new Error('profile fetch failed'));
    fetchAccountTypeMock.mockRejectedValue(new Error('account type fetch failed'));
    const currentSession = buildSession();
    const refreshedSession = buildSession({
      accessToken: 'access-token-3',
      refreshToken: 'refresh-token-3'
    });
    const { state, setCalls } = createSliceHarness({
      authStatus: 'authenticated',
      session: currentSession,
      userProfile: buildProfile({ preferredName: 'Laurent' })
    });

    await state.setSession(refreshedSession);

    expect(setCalls.some((call) => call.authStatus === 'loading')).toBe(false);
    expect(state.authStatus).toBe('authenticated');
    expect(state.session?.accessToken).toBe('access-token-3');
  });
});
