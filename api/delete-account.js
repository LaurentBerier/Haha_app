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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  return true;
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

function readBearerToken(req) {
  const tokenHeader = req.headers.authorization;
  return typeof tokenHeader === 'string' ? tokenHeader.replace(/^Bearer\s+/i, '').trim() : '';
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

  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: { message: 'Missing bearer token.' } });
    return;
  }

  try {
    const {
      data: { user },
      error: getUserError
    } = await supabaseAdmin.auth.getUser(token);

    if (getUserError || !user) {
      res.status(401).json({ error: { message: 'Unauthorized.' } });
      return;
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      res.status(500).json({ error: { message: deleteError.message } });
      return;
    }

    res.status(200).json({ ok: true, deletedUserId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: { message } });
  }
};
