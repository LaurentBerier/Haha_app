const mockGetState = jest.fn();

jest.mock('../config/env', () => ({
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
    mockGetState.mockReturnValue({ session: { accessToken: 'token-1' } });
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
      json: jest.fn().mockResolvedValue({ error: { message: 'Rate limit exceeded.' } }),
      text: jest.fn().mockResolvedValue('')
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
});
