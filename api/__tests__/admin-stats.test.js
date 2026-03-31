const { createReqRes } = require('./testHelpers');

function isoForUtcDayOffset(dayOffset, hour = 12) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour, 0, 0, 0)).toISOString();
}

function buildSupabaseMock({
  user = { id: 'admin-1', app_metadata: { role: 'admin', account_type: 'admin' } },
  usageRows = [],
  revenueRows = [],
  usageEventRows = [],
  tierCounts = {}
} = {}) {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : { message: 'invalid jwt' }
  });

  const usageEventsRange = jest.fn((from, to) =>
    Promise.resolve({
      data: usageEventRows.slice(from, to + 1),
      error: null
    })
  );
  const usageEventsOrderById = jest.fn(() => ({
    range: usageEventsRange
  }));
  const usageEventsOrderByCreatedAt = jest.fn(() => ({
    order: usageEventsOrderById
  }));

  const from = jest.fn((table) => {
    if (table === 'admin_daily_usage') {
      return {
        select: () => ({
          gte: jest.fn().mockResolvedValue({
            data: usageRows,
            error: null
          })
        })
      };
    }

    if (table === 'admin_revenue_summary') {
      return {
        select: () => ({
          gte: jest.fn().mockResolvedValue({
            data: revenueRows,
            error: null
          })
        })
      };
    }

    if (table === 'usage_events') {
      return {
        select: () => ({
          gte: () => ({
            order: usageEventsOrderByCreatedAt
          })
        })
      };
    }

    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (column, tier) =>
            Promise.resolve({
              count: tierCounts[tier] ?? 0,
              error: null
            })
        })
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      auth: { getUser },
      from
    },
    spies: { getUser, from, usageEventsRange, usageEventsOrderByCreatedAt, usageEventsOrderById }
  };
}

describe('api/admin-stats', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    TTS_COST_PER_1K_CHARS: process.env.TTS_COST_PER_1K_CHARS
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.TTS_COST_PER_1K_CHARS;
  });

  afterEach(() => {
    jest.restoreAllMocks();

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

    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

    if (typeof originalEnv.TTS_COST_PER_1K_CHARS === 'string') {
      process.env.TTS_COST_PER_1K_CHARS = originalEnv.TTS_COST_PER_1K_CHARS;
    } else {
      delete process.env.TTS_COST_PER_1K_CHARS;
    }
  });

  it('returns granular timeseries, peakRequests, tier breakdown and split costs', async () => {
    process.env.TTS_COST_PER_1K_CHARS = '0.20';
    const supabase = buildSupabaseMock({
      usageRows: [
        {
          day: '2026-03-30',
          tier: 'regular',
          endpoint: 'claude',
          unique_users: 2,
          requests: 3,
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          tts_chars: 1_000
        }
      ],
      revenueRows: [
        {
          month: '2026-03-01',
          tier: 'regular',
          event_type: 'purchased',
          events: 1,
          total_cents: 1500
        }
      ],
      usageEventRows: [
        { created_at: isoForUtcDayOffset(-1, 11), user_id: 'u-1' },
        { created_at: isoForUtcDayOffset(0, 9), user_id: 'u-1' },
        { created_at: isoForUtcDayOffset(0, 15), user_id: 'u-2' }
      ],
      tierCounts: { free: 10, regular: 5, premium: 3, admin: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-stats');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { period: 'mtd', granularity: 'day' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.granularity).toBe('day');
    expect(res.payload.timeseries).toHaveLength(30);
    expect(res.payload.peakRequests).toBe(2);
    expect(res.payload.userTierBreakdown).toEqual([
      { tier: 'free', users: 10 },
      { tier: 'regular', users: 5 },
      { tier: 'premium', users: 3 },
      { tier: 'admin', users: 1 }
    ]);
    expect(res.payload.estimatedClaudeCostCents).toBe(1050);
    expect(res.payload.estimatedTtsCostCents).toBe(20);
    expect(res.payload.estimatedCostCents).toBe(1070);
  });

  it('falls back to ElevenLabs default TTS cost when env is absent/invalid', async () => {
    process.env.TTS_COST_PER_1K_CHARS = 'not-a-number';
    const supabase = buildSupabaseMock({
      usageRows: [
        {
          day: '2026-03-30',
          tier: 'regular',
          endpoint: 'tts',
          unique_users: 1,
          requests: 1,
          input_tokens: 0,
          output_tokens: 0,
          tts_chars: 1_000
        }
      ],
      usageEventRows: [{ created_at: isoForUtcDayOffset(0, 12), user_id: 'u-1' }]
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-stats');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { period: 'mtd', granularity: 'day' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.estimatedClaudeCostCents).toBe(0);
    expect(res.payload.estimatedTtsCostCents).toBe(18);
    expect(res.payload.estimatedCostCents).toBe(18);
  });

  it('supports hour granularity buckets', async () => {
    const now = new Date();
    const thisHourIso = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      30,
      0,
      0
    )).toISOString();

    const supabase = buildSupabaseMock({
      usageRows: [],
      usageEventRows: [{ created_at: thisHourIso, user_id: 'u-1' }]
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-stats');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { period: 'mtd', granularity: 'hour' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.granularity).toBe('hour');
    expect(res.payload.timeseries).toHaveLength(24);
    expect(res.payload.peakRequests).toBe(1);
  });
});
