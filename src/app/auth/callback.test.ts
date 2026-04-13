import { buildNativeCallbackUrl, parseAuthCallbackParams, resolveAuthCallbackSession, resolveAuthCallbackUrl } from './callbackLogic';

describe('auth callback logic', () => {
  it('exchanges PKCE code using the extracted code value', async () => {
    const parsed = parseAuthCallbackParams({
      query: new URLSearchParams('code=pkce-code-1'),
      hash: new URLSearchParams(),
      params: {}
    });
    const auth = {
      setSession: jest.fn(),
      exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
      verifyOtp: jest.fn()
    };

    const error = await resolveAuthCallbackSession(auth, parsed);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code-1');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(error).toBeNull();
  });

  it('falls back to verifyOtp when PKCE exchange fails and token_hash is present', async () => {
    const parsed = parseAuthCallbackParams({
      query: new URLSearchParams('code=expired-code&token_hash=otp-hash&type=magiclink'),
      hash: new URLSearchParams(),
      params: {}
    });
    const auth = {
      setSession: jest.fn(),
      exchangeCodeForSession: jest.fn().mockResolvedValue({
        error: { message: 'Auth code invalid or expired.' }
      }),
      verifyOtp: jest.fn().mockResolvedValue({ error: null })
    };

    const error = await resolveAuthCallbackSession(auth, parsed);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('expired-code');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'otp-hash',
      type: 'magiclink'
    });
    expect(error).toBeNull();
  });

  it('sets session directly when access and refresh tokens are provided', async () => {
    const parsed = parseAuthCallbackParams({
      query: new URLSearchParams(),
      hash: new URLSearchParams('access_token=access-1&refresh_token=refresh-1'),
      params: {}
    });
    const auth = {
      setSession: jest.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: jest.fn(),
      verifyOtp: jest.fn()
    };

    const error = await resolveAuthCallbackSession(auth, parsed);

    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'access-1',
      refresh_token: 'refresh-1'
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(error).toBeNull();
  });

  it('copies hash auth payload into query params during web-to-native handoff', () => {
    const sourceUrl = new URL(
      'https://app.ha-ha.ai/auth/callback#access_token=access-web&refresh_token=refresh-web&type=magiclink'
    );

    const nativeUrl = buildNativeCallbackUrl(sourceUrl, 'hahaha://auth/callback');
    const parsed = new URL(nativeUrl);

    expect(parsed.protocol).toBe('hahaha:');
    expect(parsed.hostname).toBe('auth');
    expect(parsed.pathname).toBe('/callback');
    expect(parsed.searchParams.get('opened_in_app')).toBe('1');
    expect(parsed.searchParams.get('access_token')).toBe('access-web');
    expect(parsed.searchParams.get('refresh_token')).toBe('refresh-web');
    expect(parsed.searchParams.get('type')).toBe('magiclink');
    expect(parsed.hash).toContain('access_token=access-web');
  });

  it('extracts nested callback URL when auth payload is wrapped in url=', () => {
    const wrapped = new URL(
      'exp://127.0.0.1:8081/--/auth/callback?url=' +
        encodeURIComponent('hahaha://auth/callback?code=wrapped-code&type=magiclink')
    );

    const resolved = resolveAuthCallbackUrl(wrapped.toString());

    expect(resolved).not.toBeNull();
    expect(resolved?.protocol).toBe('hahaha:');
    expect(resolved?.hostname).toBe('auth');
    expect(resolved?.pathname).toBe('/callback');
    expect(resolved?.searchParams.get('code')).toBe('wrapped-code');
    expect(resolved?.searchParams.get('type')).toBe('magiclink');
  });
});
