const { attachRequestId, extractBearerToken, getSupabaseAdmin, setCorsHeaders } = require('../_utils');

function createResponseMock() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    }
  };
}

describe('api/_utils', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (typeof originalAllowedOrigins === 'string') {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

    if (typeof originalSupabaseUrl === 'string') {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    } else {
      delete process.env.SUPABASE_URL;
    }

    if (typeof originalServiceRoleKey === 'string') {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it('extracts bearer token safely', () => {
    expect(extractBearerToken('Bearer token-123')).toBe('token-123');
    expect(extractBearerToken('bearer token-123')).toBe('token-123');
    expect(extractBearerToken('token-123')).toBe('token-123');
    expect(extractBearerToken(undefined)).toBe('');
  });

  it('rejects browser origin when ALLOWED_ORIGINS is missing', () => {
    delete process.env.ALLOWED_ORIGINS;
    const req = { headers: { origin: 'https://app.example.com' } };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: false, reason: 'cors_not_configured' });
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('allows configured browser origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
    const req = { headers: { origin: 'https://admin.example.com' } };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: true, reason: null });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://admin.example.com');
    expect(res.headers.Vary).toBe('Origin');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
  });

  it('allows same-origin when x-forwarded-host contains comma-separated values', () => {
    process.env.ALLOWED_ORIGINS = 'https://another.example.com';
    const req = {
      headers: {
        origin: 'https://app.ha-ha.ai',
        'x-forwarded-host': 'app.ha-ha.ai, random-edge-host.vercel.app'
      }
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: true, reason: null });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://app.ha-ha.ai');
  });

  it('allows wildcard subdomain origins', () => {
    process.env.ALLOWED_ORIGINS = 'https://*.ha-ha.ai';
    const req = {
      headers: {
        origin: 'https://app.ha-ha.ai'
      }
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: true, reason: null });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://app.ha-ha.ai');
  });

  it('allows configured origin even when ALLOWED_ORIGINS contains trailing slash and mixed case', () => {
    process.env.ALLOWED_ORIGINS = 'HTTPS://App.HA-HA.ai/';
    const req = { headers: { origin: 'https://app.ha-ha.ai' } };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: true, reason: null });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://app.ha-ha.ai');
  });

  it('rejects browser-like request when Origin is missing', () => {
    const req = {
      headers: {
        'sec-fetch-mode': 'no-cors'
      }
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: false, reason: 'origin_required' });
  });

  it('allows non-browser request with bearer token when Origin is missing', () => {
    const req = {
      headers: {
        authorization: 'Bearer abc123'
      }
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: true, reason: null });
  });

  it('allows missing Origin for routes that explicitly opt in', () => {
    const req = {
      headers: {}
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res, { allowMissingOrigin: true });

    expect(result).toEqual({ ok: true, reason: null });
  });

  it('rejects missing Origin when no auth and no explicit allow', () => {
    const req = {
      headers: {}
    };
    const res = createResponseMock();

    const result = setCorsHeaders(req, res);

    expect(result).toEqual({ ok: false, reason: 'origin_required' });
  });

  it('uses provided x-request-id when valid', () => {
    const req = { headers: { 'x-request-id': ' req-123 ' } };
    const res = createResponseMock();

    const requestId = attachRequestId(req, res);

    expect(requestId).toBe('req-123');
    expect(res.headers['X-Request-Id']).toBe('req-123');
  });

  it('returns null supabase admin client when env is missing', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(getSupabaseAdmin()).toBeNull();
  });
});
