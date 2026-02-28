const { createClient } = require('@supabase/supabase-js');

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const hasAllowList = allowedOrigins.length > 0;
  const allowOrigin = !hasAllowList
    ? origin || '*'
    : origin && allowedOrigins.includes(origin)
      ? origin
      : '';

  if (!allowOrigin && hasAllowList) {
    return false;
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return true;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
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

async function validateAdmin(req) {
  const tokenHeader = req.headers.authorization;
  const token = typeof tokenHeader === 'string' ? tokenHeader.replace(/^Bearer\s+/i, '').trim() : '';

  if (!token) {
    return { ok: false, error: 'Missing bearer token', status: 401 };
  }

  if (!supabaseAdmin) {
    return { ok: false, error: 'Supabase admin client unavailable', status: 500 };
  }

  try {
    const {
      data: { user },
      error
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return { ok: false, error: 'Unauthorized', status: 401 };
    }

    const role = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
    const accountType = typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null;
    const isAdmin = role === 'admin' || accountType === 'admin';

    if (!isAdmin) {
      return { ok: false, error: 'Forbidden', status: 403 };
    }

    return { ok: true, userId: user.id };
  } catch {
    return { ok: false, error: 'Token validation failed', status: 401 };
  }
}

async function accountTypeExists(accountTypeId) {
  const { data, error } = await supabaseAdmin
    .from('account_types')
    .select('id')
    .eq('id', accountTypeId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.id);
}

module.exports = async function handler(req, res) {
  const corsOk = setCorsHeaders(req, res);
  if (!corsOk) {
    res.status(403).json({ error: { message: 'Origin not allowed.' } });
    return;
  }

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

  const auth = await validateAdmin(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: { message: auth.error } });
    return;
  }

  if (!isRecord(req.body)) {
    res.status(400).json({ error: { message: 'JSON body is required.' } });
    return;
  }

  const userId = typeof req.body.userId === 'string' ? req.body.userId.trim() : '';
  const accountTypeId = typeof req.body.accountTypeId === 'string' ? req.body.accountTypeId.trim() : '';

  if (!userId || !accountTypeId) {
    res.status(400).json({ error: { message: 'userId and accountTypeId are required.' } });
    return;
  }

  try {
    const exists = await accountTypeExists(accountTypeId);
    if (!exists) {
      res.status(400).json({ error: { message: `Unknown account type: ${accountTypeId}` } });
      return;
    }

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

    res.status(200).json({
      ok: true,
      updatedBy: auth.userId,
      userId,
      accountTypeId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: { message } });
  }
};
