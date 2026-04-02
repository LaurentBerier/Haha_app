const { createReqRes } = require('./testHelpers');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function setupModuleMocks({ authOk = true } = {}) {
  const renderMemeImage = jest.fn(async ({ caption, placement }) => ({
    mimeType: 'image/png',
    base64: Buffer.from(`${caption}-${placement}`).toString('base64'),
    logoPlacement: placement === 'bottom' ? 'left' : 'right'
  }));
  const normalizeImageInput = jest.fn((rawImage) => {
    if (!rawImage || typeof rawImage !== 'object') {
      throw new Error('Image payload is required.');
    }
    const mediaType = typeof rawImage.mediaType === 'string' ? rawImage.mediaType.trim().toLowerCase() : '';
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) {
      throw new Error('Unsupported image media type.');
    }
    const base64 = typeof rawImage.base64 === 'string' ? rawImage.base64.trim() : '';
    if (!base64) {
      throw new Error('Image base64 is required.');
    }
    return {
      mediaType,
      base64,
      bytes: 128
    };
  });
  const normalizeCaption = jest.fn((value) => {
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, 120);
  });
  const normalizePlacement = jest.fn((value) => (value === 'bottom' ? 'bottom' : 'top'));

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getUser: jest.fn().mockResolvedValue(
          authOk
            ? {
                data: { user: { id: 'user-1' } },
                error: null
              }
            : {
                data: { user: null },
                error: { message: 'invalid jwt' }
              }
        )
      }
    }))
  }));

  jest.doMock('../_meme-render', () => ({
    ALLOWED_IMAGE_MEDIA_TYPES: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    MAX_IMAGE_BYTES: 3_000_000,
    normalizeImageInput,
    normalizeCaption,
    normalizePlacement,
    renderMemeImage
  }));

  return {
    renderMemeImage,
    normalizeImageInput
  };
}

function createAnthropicSuccessResponse(text) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text
        }
      ]
    })
  };
}

describe('api/meme-generator', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;

    if (typeof originalEnv.SUPABASE_URL === 'string') {
      process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    } else {
      delete process.env.SUPABASE_URL;
    }
    if (typeof originalEnv.SUPABASE_SERVICE_ROLE_KEY === 'string') {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
    if (typeof originalEnv.ANTHROPIC_API_KEY === 'string') {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('rejects unauthorized requests', async () => {
    setupModuleMocks({ authOk: false });
    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'propose',
        language: 'fr-CA',
        image: {
          mediaType: 'image/png',
          base64: 'cGhvdG8='
        }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload?.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns exactly 3 branded options for propose requests', async () => {
    const { renderMemeImage } = setupModuleMocks();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createAnthropicSuccessResponse(
          '{"sceneSummary":"Trois amis en pause","environment":"cabane en bois","mood":"taquin","people":["trois adultes","lunettes"],"animals":[],"notableObjects":["bol de soupe"],"famousPeopleCandidates":[{"name":"Ryan Gosling","confidence":0.92,"description":"acteur canadien"}],"contextHooks":["attente du repas"]}'
        )
      )
      .mockResolvedValueOnce(
        createAnthropicSuccessResponse('{"captions":["Option A","Option B","Option C"]}')
      );
    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'propose',
        language: 'fr-CA',
        image: {
          mediaType: 'image/png',
          base64: 'cGhvdG8='
        },
        text: 'Contexte test'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload?.draftId).toEqual(expect.any(String));
    expect(res.payload?.options).toHaveLength(3);
    expect(res.payload?.options?.[0]).toEqual(
      expect.objectContaining({
        optionId: 'meme_opt_1',
        caption: expect.any(String),
        placement: expect.any(String),
        logoPlacement: expect.any(String),
        previewImageBase64: expect.any(String),
        mimeType: 'image/png'
      })
    );
    expect(renderMemeImage).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[0]?.[0] ?? '')).toBe(ANTHROPIC_API_URL);
    expect(String(global.fetch.mock.calls[1]?.[0] ?? '')).toBe(ANTHROPIC_API_URL);
    const analysisBody = JSON.parse(String(global.fetch.mock.calls[0]?.[1]?.body ?? '{}'));
    const captionsBody = JSON.parse(String(global.fetch.mock.calls[1]?.[1]?.body ?? '{}'));
    expect(analysisBody.system).toContain('famousPeopleCandidates');
    expect(String(captionsBody.messages?.[0]?.content?.[0]?.text ?? '')).toContain('bol de soupe');
    expect(String(captionsBody.messages?.[0]?.content?.[0]?.text ?? '')).toContain('Ryan Gosling');
  });

  it('does not expose low-confidence celebrity names in caption prompt', async () => {
    setupModuleMocks();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createAnthropicSuccessResponse(
          '{"sceneSummary":"Souper entre amis","environment":"restaurant","mood":"poker face","people":["trois personnes"],"animals":[],"notableObjects":["table en bois"],"famousPeopleCandidates":[{"name":"Brad Pitt","confidence":0.45,"description":"acteur hollywoodien"}],"contextHooks":["silence avant la commande"]}'
        )
      )
      .mockResolvedValueOnce(
        createAnthropicSuccessResponse('{"captions":["Option A","Option B","Option C"]}')
      );

    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'propose',
        language: 'fr-CA',
        image: {
          mediaType: 'image/png',
          base64: 'cGhvdG8='
        }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const captionsBody = JSON.parse(String(global.fetch.mock.calls[1]?.[1]?.body ?? '{}'));
    const captionsUserText = String(captionsBody.messages?.[0]?.content?.[0]?.text ?? '');
    expect(captionsUserText).not.toContain('Brad Pitt');
    expect(captionsUserText).toContain('acteur hollywoodien');
  });

  it('continues caption generation when analysis pass fails', async () => {
    setupModuleMocks();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          error: {
            message: 'analysis unavailable'
          }
        })
      })
      .mockResolvedValueOnce(
        createAnthropicSuccessResponse('{"captions":["Option A","Option B","Option C"]}')
      );

    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'propose',
        language: 'fr-CA',
        image: {
          mediaType: 'image/png',
          base64: 'cGhvdG8='
        }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload?.options).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('finalize renders selected caption without calling Anthropic', async () => {
    const { renderMemeImage } = setupModuleMocks();
    global.fetch = jest.fn();
    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'finalize',
        language: 'fr-CA',
        caption: 'Option finale',
        placement: 'bottom',
        image: {
          mediaType: 'image/png',
          base64: 'cGhvdG8='
        }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(
      expect.objectContaining({
        imageBase64: expect.any(String),
        mimeType: 'image/png',
        caption: 'Option finale',
        placement: 'bottom',
        logoPlacement: 'left'
      })
    );
    expect(renderMemeImage).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for unsupported image media types', async () => {
    const { normalizeImageInput } = setupModuleMocks();
    global.fetch = jest.fn();
    const handler = require('../meme-generator');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      body: {
        action: 'propose',
        language: 'fr-CA',
        image: {
          mediaType: 'image/tiff',
          base64: 'cGhvdG8='
        }
      }
    });

    await handler(req, res);

    expect(normalizeImageInput).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.code).toBe('INVALID_REQUEST');
  });
});
