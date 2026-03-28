function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe('api/_utils checkIpRateLimit', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    KV_URL: process.env.KV_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    restoreEnv(originalEnv);
  });

  it('bypasses IP rate limit in test mode when KV is not configured', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { checkIpRateLimit } = require('../_utils');
    const result = await checkIpRateLimit(
      {
        headers: {
          'x-forwarded-for': '203.0.113.10'
        }
      },
      { requestId: 'test-1' }
    );

    expect(result).toEqual({
      ok: true,
      retryAfterSeconds: 0
    });
  });

  it('returns 429 when KV-backed IP minute limit is exceeded', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'token';

    const kvStore = new Map();
    jest.doMock('@vercel/kv', () => ({
      kv: {
        incr: jest.fn(async (key) => {
          const next = Number(kvStore.get(key) ?? 0) + 1;
          kvStore.set(key, next);
          return next;
        }),
        expire: jest.fn(async () => 1),
        get: jest.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null))
      }
    }));

    const { checkIpRateLimit } = require('../_utils');
    const req = {
      headers: {
        'x-forwarded-for': '198.51.100.99'
      }
    };

    const first = await checkIpRateLimit(req, {
      requestId: 'test-2',
      maxRequests: 1,
      windowMs: 60_000
    });
    const second = await checkIpRateLimit(req, {
      requestId: 'test-2',
      maxRequests: 1,
      windowMs: 60_000
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.status).toBe(429);
    expect(second.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('uses configured window size for KV bucket keys', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'token';

    const kvStore = new Map();
    const incrMock = jest.fn(async (key) => {
      const next = Number(kvStore.get(key) ?? 0) + 1;
      kvStore.set(key, next);
      return next;
    });
    const getMock = jest.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null));
    const expireMock = jest.fn(async () => 1);

    jest.doMock('@vercel/kv', () => ({
      kv: {
        incr: incrMock,
        expire: expireMock,
        get: getMock
      }
    }));

    jest.spyOn(Date, 'now').mockReturnValue(90_000);

    const { checkIpRateLimit } = require('../_utils');
    const result = await checkIpRateLimit(
      {
        headers: {
          'x-forwarded-for': '198.51.100.77'
        }
      },
      {
        requestId: 'test-window',
        windowMs: 120_000,
        maxRequests: 10
      }
    );

    expect(result.ok).toBe(true);
    expect(incrMock).toHaveBeenCalledWith('ip_ratelimit:120000:198.51.100.77:0');
    expect(getMock).toHaveBeenCalledWith('ip_ratelimit:120000:198.51.100.77:-1');
    expect(expireMock).toHaveBeenCalledWith('ip_ratelimit:120000:198.51.100.77:0', 150);
  });
});
