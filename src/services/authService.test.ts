const signUp = jest.fn();

jest.mock('../config/env', () => ({
  API_BASE_URL: 'https://api.ha-ha.ai',
  CLAUDE_PROXY_URL: ''
}));

jest.mock('./supabaseClient', () => ({
  assertSupabaseConfigured: jest.fn(),
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp,
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      signInWithIdToken: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
      getSession: jest.fn(),
      onAuthStateChange: jest.fn()
    }
  }
}));

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 'FULL_NAME',
    EMAIL: 'EMAIL'
  }
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

import { deleteAccount, getStoredSession, getUsageSummary, signUpWithEmail } from './authService';
import { supabase } from './supabaseClient';

function buildSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-123',
      email: 'user@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z'
    },
    ...overrides
  };
}

describe('authService', () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    global.window = originalWindow;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('returns confirmationRequired=true when signup requires email confirmation', async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: null
    });

    const result = await signUpWithEmail('user@example.com', 'password123');

    expect(result.confirmationRequired).toBe(true);
    expect(result.session).toBeNull();
  });

  it('uses web callback URL for signup redirect when running on web', async () => {
    global.window = {
      location: {
        origin: 'https://www.ha-ha.ai'
      }
    } as unknown as Window & typeof globalThis;

    signUp.mockResolvedValue({
      data: { session: null },
      error: null
    });

    await signUpWithEmail('user@example.com', 'password123');

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: 'https://www.ha-ha.ai/auth/callback'
        })
      })
    );
  });

  it('parses usage summary payload from backend', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        messagesUsed: 7,
        messagesCap: 45,
        resetDate: '2026-04-01T00:00:00.000Z'
      })
    }) as unknown as typeof fetch;

    const summary = await getUsageSummary('access-token');

    expect(summary).toEqual({
      messagesUsed: 7,
      messagesCap: 45,
      resetDate: '2026-04-01T00:00:00.000Z'
    });
  });

  it('propagates backend delete-account error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Delete failed upstream.' }
      })
    }) as unknown as typeof fetch;

    await expect(deleteAccount('access-token')).rejects.toThrow('Delete failed upstream.');
  });

  it('clears local auth state when stored session refresh token is invalid', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found')
    });
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });

    const session = await getStoredSession();

    expect(session).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('refreshes an expiring stored session before returning auth tokens', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: {
        session: buildSession({
          access_token: 'stale-access-token',
          refresh_token: 'refresh-token',
          expires_at: Math.floor(Date.now() / 1000) - 5
        })
      },
      error: null
    });
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: {
        session: buildSession({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token'
        })
      },
      error: null
    });

    const session = await getStoredSession();

    expect(supabase.auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
    expect(session).toEqual(
      expect.objectContaining({
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token'
      })
    );
  });
});
