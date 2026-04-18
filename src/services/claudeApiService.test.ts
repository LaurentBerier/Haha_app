const mockGetState = jest.fn();

jest.mock('../config/env', () => ({
  API_BASE_URL: '',
  CLAUDE_PROXY_URL: 'https://api.ha-ha.ai/claude'
}));

jest.mock('../store/useStore', () => ({
  useStore: {
    getState: () => mockGetState()
  }
}));

import { streamClaudeResponse } from './claudeApiService';

describe('claudeApiService', () => {
  const originalFetch = global.fetch;
  const originalNavigator = (globalThis as { navigator?: { product?: string } }).navigator;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetState.mockReturnValue({ session: { accessToken: 'token-1' }, emojiStyle: 'classic' });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalNavigator) {
      (globalThis as { navigator?: { product?: string } }).navigator = originalNavigator;
    } else {
      delete (globalThis as { navigator?: { product?: string } }).navigator;
    }
  });

  it('maps backend error payload to onError message', async () => {
    const onToken = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          error: { message: 'Rate limit exceeded.' }
        })
      )
    }) as unknown as typeof fetch;

    streamClaudeResponse({
      artistId: 'cathy-gauthier',
      modeId: 'roast',
      language: 'fr-CA',
      messages: [{ role: 'user', content: 'Salut' }],
      onToken,
      onComplete,
      onError
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Rate limit exceeded.');
    expect(onComplete).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('handles non-stream React Native payload and emits token + complete', async () => {
    const onToken = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    (globalThis as { navigator?: { product?: string } }).navigator = { product: 'ReactNative' };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Bonjour!' }],
        usage: { output_tokens: 9 }
      })
    }) as unknown as typeof fetch;

    streamClaudeResponse({
      artistId: 'cathy-gauthier',
      modeId: 'default',
      language: 'fr-CA',
      messages: [{ role: 'user', content: 'Test' }],
      onToken,
      onComplete,
      onError
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onToken).toHaveBeenCalledWith('Bonjour!');
    expect(onComplete).toHaveBeenCalledWith({ tokensUsed: 9 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls back to relative /api/claude when primary proxy URL fetch fails', async () => {
    const onToken = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Salut fallback!' }],
          usage: { output_tokens: 4 }
        })
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    (globalThis as { navigator?: { product?: string } }).navigator = { product: 'ReactNative' };

    streamClaudeResponse({
      artistId: 'cathy-gauthier',
      modeId: 'default',
      language: 'fr-CA',
      messages: [{ role: 'user', content: 'Test fallback' }],
      onToken,
      onComplete,
      onError
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.ha-ha.ai/claude');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/claude');
    expect(onToken).toHaveBeenCalledWith('Salut fallback!');
    expect(onComplete).toHaveBeenCalledWith({ tokensUsed: 4 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('forwards tutorialMode=true in request payload', async () => {
    const onToken = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    (globalThis as { navigator?: { product?: string } }).navigator = { product: 'ReactNative' };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tutorial reply' }],
        usage: { output_tokens: 5 }
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    streamClaudeResponse({
      artistId: 'cathy-gauthier',
      modeId: 'default',
      language: 'fr-CA',
      tutorialMode: true,
      messages: [{ role: 'user', content: 'Allo' }],
      onToken,
      onComplete,
      onError
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
    expect(body.tutorialMode).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('forwards emojiStyle from store when param omitted', async () => {
    const onToken = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    mockGetState.mockReturnValue({ session: { accessToken: 'token-1' }, emojiStyle: 'full' });

    (globalThis as { navigator?: { product?: string } }).navigator = { product: 'ReactNative' };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Ok' }],
        usage: { output_tokens: 2 }
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    streamClaudeResponse({
      artistId: 'cathy-gauthier',
      modeId: 'default',
      language: 'fr-CA',
      messages: [{ role: 'user', content: 'Hi' }],
      onToken,
      onComplete,
      onError
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
    expect(body.emojiStyle).toBe('full');
    expect(onError).not.toHaveBeenCalled();
  });
});
