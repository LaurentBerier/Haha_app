describe('authService signInWithApple', () => {
  const originalWindow = global.window;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.window = originalWindow;
  });

  it('uses Supabase OAuth redirect on web', async () => {
    const assign = jest.fn();
    global.window = {
      location: {
        origin: 'https://app.ha-ha.ai',
        assign
      }
    } as unknown as Window & typeof globalThis;

    const signInWithOAuth = jest.fn().mockResolvedValue({
      data: { url: 'https://appleid.apple.com/auth/authorize?foo=bar' },
      error: null
    });

    jest.doMock('../config/env', () => ({
      API_BASE_URL: 'https://api.ha-ha.ai',
      CLAUDE_PROXY_URL: ''
    }));

    jest.doMock('../config/constants', () => ({
      AUTH_CALLBACK_SCHEME_URL: 'hahaha://auth/callback'
    }));

    jest.doMock('./supabaseClient', () => ({
      assertSupabaseConfigured: jest.fn(),
      supabase: {
        auth: {
          signInWithOAuth,
          signInWithIdToken: jest.fn()
        }
      }
    }));

    jest.doMock('react-native', () => ({
      Platform: {
        OS: 'web'
      }
    }));

    jest.doMock('expo-apple-authentication', () => ({
      isAvailableAsync: jest.fn(),
      signInAsync: jest.fn(),
      AppleAuthenticationScope: {
        FULL_NAME: 'FULL_NAME',
        EMAIL: 'EMAIL'
      }
    }));

    const { signInWithApple } = await import('./authService');
    const result = await signInWithApple();

    expect(result).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: {
        redirectTo: 'https://app.ha-ha.ai/auth/callback',
        skipBrowserRedirect: true
      }
    });
    expect(assign).toHaveBeenCalledWith('https://appleid.apple.com/auth/authorize?foo=bar');
  });

  it('throws a clear diagnostic when Apple auth is unavailable on iOS', async () => {
    const signInWithIdToken = jest.fn();
    const isAvailableAsync = jest.fn().mockResolvedValue(false);
    const signInAsync = jest.fn();

    jest.doMock('../config/env', () => ({
      API_BASE_URL: 'https://api.ha-ha.ai',
      CLAUDE_PROXY_URL: ''
    }));

    jest.doMock('../config/constants', () => ({
      AUTH_CALLBACK_SCHEME_URL: 'hahaha://auth/callback'
    }));

    jest.doMock('./supabaseClient', () => ({
      assertSupabaseConfigured: jest.fn(),
      supabase: {
        auth: {
          signInWithOAuth: jest.fn(),
          signInWithIdToken
        }
      }
    }));

    jest.doMock('react-native', () => ({
      Platform: {
        OS: 'ios'
      }
    }));

    jest.doMock('expo-apple-authentication', () => ({
      isAvailableAsync,
      signInAsync,
      AppleAuthenticationScope: {
        FULL_NAME: 'FULL_NAME',
        EMAIL: 'EMAIL'
      }
    }));

    const { signInWithApple } = await import('./authService');

    await expect(signInWithApple()).rejects.toThrow('Apple Sign-In est indisponible');
    expect(signInAsync).not.toHaveBeenCalled();
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('uses Apple identity token on iOS when available', async () => {
    const signInWithIdToken = jest.fn().mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_at: 1234567890,
          user: {
            id: 'user-1',
            email: 'user@example.com',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00.000Z'
          }
        }
      },
      error: null
    });

    const isAvailableAsync = jest.fn().mockResolvedValue(true);
    const signInAsync = jest.fn().mockResolvedValue({
      identityToken: 'apple-token'
    });

    jest.doMock('../config/env', () => ({
      API_BASE_URL: 'https://api.ha-ha.ai',
      CLAUDE_PROXY_URL: ''
    }));

    jest.doMock('../config/constants', () => ({
      AUTH_CALLBACK_SCHEME_URL: 'hahaha://auth/callback'
    }));

    jest.doMock('./supabaseClient', () => ({
      assertSupabaseConfigured: jest.fn(),
      supabase: {
        auth: {
          signInWithOAuth: jest.fn(),
          signInWithIdToken
        }
      }
    }));

    jest.doMock('react-native', () => ({
      Platform: {
        OS: 'ios'
      }
    }));

    jest.doMock('expo-apple-authentication', () => ({
      isAvailableAsync,
      signInAsync,
      AppleAuthenticationScope: {
        FULL_NAME: 'FULL_NAME',
        EMAIL: 'EMAIL'
      }
    }));

    const { signInWithApple } = await import('./authService');
    const session = await signInWithApple();

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-token'
    });
    expect(session).toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      })
    );
  });
});
