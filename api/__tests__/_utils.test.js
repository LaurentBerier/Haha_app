const { extractBearerToken, setCorsHeaders } = require('../_utils');

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

  afterEach(() => {
    if (typeof originalAllowedOrigins === 'string') {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    } else {
      delete process.env.ALLOWED_ORIGINS;
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
});
