jest.mock('../config/env', () => ({
  API_BASE_URL: '',
  CLAUDE_PROXY_URL: ''
}));

import { proposeMemeOptions } from './memeGeneratorService';

type MockResponseOptions = {
  status: number;
  body: unknown;
  requestId?: string;
  contentType?: string;
};

function createMockResponse({ status, body, requestId, contentType = 'application/json' }: MockResponseOptions) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'content-type') {
          return contentType;
        }
        if (normalized === 'x-request-id') {
          return requestId ?? null;
        }
        return null;
      }
    },
    text: jest.fn().mockResolvedValue(text)
  };
}

describe('memeGeneratorService', () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as { window?: unknown }).window;

  beforeEach(() => {
    jest.clearAllMocks();
    (global as { window?: unknown }).window = {
      location: {
        origin: 'https://app.ha-ha.ai'
      }
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (global as { window?: unknown }).window = originalWindow;
  });

  it('deduplicates web endpoint candidates and performs a single propose request on success', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createMockResponse({
        status: 200,
        body: {
          draftId: 'draft-1',
          options: [
            {
              optionId: 'opt-1',
              caption: 'Option 1',
              placement: 'top',
              logoPlacement: 'right',
              previewImageBase64: 'aA==',
              mimeType: 'image/png'
            },
            {
              optionId: 'opt-2',
              caption: 'Option 2',
              placement: 'bottom',
              logoPlacement: 'left',
              previewImageBase64: 'aA==',
              mimeType: 'image/png'
            },
            {
              optionId: 'opt-3',
              caption: 'Option 3',
              placement: 'top',
              logoPlacement: 'right',
              previewImageBase64: 'aA==',
              mimeType: 'image/png'
            }
          ]
        }
      })
    ) as unknown as typeof fetch;

    const result = await proposeMemeOptions({
      accessToken: 'token-123',
      language: 'fr-CA',
      text: 'Contexte',
      image: {
        uri: 'file:///tmp/photo.png',
        mediaType: 'image/png',
        base64: 'aA=='
      }
    });

    expect(result.options).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0]?.[0] ?? '')).toBe('https://app.ha-ha.ai/api/meme-generator');
  });

  it('retries exactly once on transient 503 errors', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createMockResponse({
          status: 503,
          requestId: 'req-503a',
          body: {
            error: {
              code: 'RENDERER_UNAVAILABLE',
              message: 'Meme renderer temporarily unavailable.'
            }
          }
        })
      )
      .mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          body: {
            draftId: 'draft-2',
            options: [
              {
                optionId: 'opt-1',
                caption: 'Option 1',
                placement: 'top',
                logoPlacement: 'right',
                previewImageBase64: 'aA==',
                mimeType: 'image/png'
              },
              {
                optionId: 'opt-2',
                caption: 'Option 2',
                placement: 'bottom',
                logoPlacement: 'left',
                previewImageBase64: 'aA==',
                mimeType: 'image/png'
              },
              {
                optionId: 'opt-3',
                caption: 'Option 3',
                placement: 'top',
                logoPlacement: 'right',
                previewImageBase64: 'aA==',
                mimeType: 'image/png'
              }
            ]
          }
        })
      ) as unknown as typeof fetch;

    const result = await proposeMemeOptions({
      accessToken: 'token-123',
      language: 'fr-CA',
      image: {
        uri: 'file:///tmp/photo.png',
        mediaType: 'image/png',
        base64: 'aA=='
      }
    });

    expect(result.options).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx errors', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createMockResponse({
        status: 400,
        requestId: 'req-400a',
        body: {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Unsupported image media type.'
          }
        }
      })
    ) as unknown as typeof fetch;

    await expect(
      proposeMemeOptions({
        accessToken: 'token-123',
        language: 'fr-CA',
        image: {
          uri: 'file:///tmp/photo.png',
          mediaType: 'image/png',
          base64: 'aA=='
        }
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      requestId: 'req-400a'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('captures requestId from non-JSON 500 responses and still retries once', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createMockResponse({
          status: 500,
          requestId: 'req-500a',
          contentType: 'text/plain',
          body: 'internal server error'
        })
      )
      .mockResolvedValueOnce(
        createMockResponse({
          status: 500,
          requestId: 'req-500b',
          contentType: 'text/plain',
          body: 'internal server error'
        })
      ) as unknown as typeof fetch;

    await expect(
      proposeMemeOptions({
        accessToken: 'token-123',
        language: 'fr-CA',
        image: {
          uri: 'file:///tmp/photo.png',
          mediaType: 'image/png',
          base64: 'aA=='
        }
      })
    ).rejects.toMatchObject({
      status: 500,
      requestId: 'req-500b'
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
