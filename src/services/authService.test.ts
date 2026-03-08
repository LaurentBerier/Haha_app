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

import { deleteAccount, getUsageSummary, signUpWithEmail } from './authService';

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
});
