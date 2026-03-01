const { createClient } = require('@supabase/supabase-js');

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function toWebhookEventType(type) {
  if (type === 'INITIAL_PURCHASE') {
    return 'purchased';
  }
  if (type === 'RENEWAL') {
    return 'renewed';
  }
  if (type === 'CANCELLATION' || type === 'EXPIRATION') {
    return 'cancelled';
  }
  if (type === 'REFUND') {
    return 'refunded';
  }
  return 'updated';
}

function getUserId(payload) {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return '';
  }

  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    event.aliases && Array.isArray(event.aliases) ? event.aliases[0] : null
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function getProductId(payload) {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return '';
  }

  const product = event.product_id;
  return typeof product === 'string' ? product : '';
}

function mapProductToAccountType(productId, eventType) {
  if (eventType === 'cancelled' || eventType === 'refunded') {
    return 'free';
  }

  const map = {
    haha_regular_monthly: 'regular',
    haha_regular_annual: 'regular',
    haha_premium_monthly: 'premium',
    haha_premium_annual: 'premium'
  };

  return map[productId] ?? null;
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin =
  typeof supabaseUrl === 'string' &&
  supabaseUrl &&
  typeof serviceRoleKey === 'string' &&
  serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

function isAuthorized(req) {
  const sharedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!sharedSecret) {
    // Fail open in dev until secret is configured.
    return process.env.NODE_ENV !== 'production';
  }

  const header = req.headers.authorization;
  const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
  return token === sharedSecret;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed.' } });
    return;
  }

  if (!supabaseAdmin) {
    res.status(500).json({ error: { message: 'Server misconfigured.' } });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: { message: 'Unauthorized webhook call.' } });
    return;
  }

  if (!isRecord(req.body)) {
    res.status(400).json({ error: { message: 'JSON body is required.' } });
    return;
  }

  const sourceType = isRecord(req.body.event) && typeof req.body.event.type === 'string' ? req.body.event.type : 'UNKNOWN';
  const eventType = toWebhookEventType(sourceType);
  const userId = getUserId(req.body);
  const productId = getProductId(req.body);
  const accountTypeId = mapProductToAccountType(productId, eventType);

  if (!userId) {
    res.status(400).json({ error: { message: 'Webhook payload missing app_user_id.' } });
    return;
  }

  try {
    const { error: eventError } = await supabaseAdmin.from('payment_events').insert({
      user_id: userId,
      provider: 'revenuecat',
      event_type: eventType,
      product_id: productId || 'unknown',
      account_type_id: accountTypeId,
      raw_payload: req.body
    });

    if (eventError) {
      res.status(500).json({ error: { message: eventError.message } });
      return;
    }

    if (accountTypeId) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ account_type_id: accountTypeId })
        .eq('id', userId);

      if (profileError) {
        res.status(500).json({ error: { message: profileError.message } });
        return;
      }

      const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          account_type: accountTypeId,
          role: accountTypeId === 'admin' ? 'admin' : 'user'
        }
      });

      if (metadataError) {
        res.status(500).json({ error: { message: metadataError.message } });
        return;
      }
    }

    res.status(200).json({ ok: true, userId: userId || null, accountTypeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: { message } });
  }
};
