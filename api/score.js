const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');

const SCORE_ACTIONS = {
  roast_generated: { points: 5, field: 'roasts_generated' },
  punchline_created: { points: 10, field: 'punchlines_created' },
  meme_generated: { points: 8, field: 'memes_generated' },
  battle_win: { points: 25, field: 'battle_wins' },
  daily_participation: { points: 5, field: 'daily_streak' },
  photo_roasted: { points: 5, field: 'photos_roasted' },
  joke_landed: { points: 15, field: 'jokes_landed' },
  cathy_surprised: { points: 10, field: 'cathy_surprised' },
  cathy_triggered: { points: 5, field: 'cathy_triggered' },
  cathy_intrigued: { points: 3, field: 'cathy_intrigued' },
  cathy_approved: { points: 2, field: 'cathy_approved' }
};

const REACTION_ACTIONS = new Set([
  'joke_landed',
  'cathy_surprised',
  'cathy_triggered',
  'cathy_intrigued',
  'cathy_approved'
]);
const BASE_PROFILE_COLUMNS =
  'score, roasts_generated, punchlines_created, destructions, photos_roasted, memes_generated, battle_wins, daily_streak, last_active_date';
const REACTION_PROFILE_COLUMNS = ', jokes_landed, cathy_surprised, cathy_triggered, cathy_intrigued, cathy_approved';
let profileSelectSupportsReactionColumns = true;

function toNonNegativeInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isMissingRpcError(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  if (code === 'PGRST202' || code === '42883' || code === '42702') {
    return true;
  }

  const message = error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return (
    message.includes('apply_score_action') &&
    (message.includes('not found') || message.includes('could not find') || message.includes('ambiguous'))
  );
}

function toStats(row) {
  const source = row && typeof row === 'object' ? row : {};
  return {
    score: toNonNegativeInt(source.score),
    roastsGenerated: toNonNegativeInt(source.roasts_generated),
    punchlinesCreated: toNonNegativeInt(source.punchlines_created),
    destructions: toNonNegativeInt(source.destructions),
    photosRoasted: toNonNegativeInt(source.photos_roasted),
    memesGenerated: toNonNegativeInt(source.memes_generated),
    battleWins: toNonNegativeInt(source.battle_wins),
    dailyStreak: toNonNegativeInt(source.daily_streak),
    jokesLanded: toNonNegativeInt(source.jokes_landed),
    cathySurprised: toNonNegativeInt(source.cathy_surprised),
    cathyTriggered: toNonNegativeInt(source.cathy_triggered),
    cathyIntrigued: toNonNegativeInt(source.cathy_intrigued),
    cathyApproved: toNonNegativeInt(source.cathy_approved),
    lastActiveDate: typeof source.last_active_date === 'string' ? source.last_active_date : null
  };
}

function getProfileColumns() {
  return profileSelectSupportsReactionColumns ? `${BASE_PROFILE_COLUMNS}${REACTION_PROFILE_COLUMNS}` : BASE_PROFILE_COLUMNS;
}

function isMissingReactionColumnError(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  const message = error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return code === '42703' && (
    message.includes('jokes_landed') ||
    message.includes('cathy_surprised') ||
    message.includes('cathy_triggered') ||
    message.includes('cathy_intrigued') ||
    message.includes('cathy_approved')
  );
}

async function fetchStats(supabaseAdmin, userId) {
  let query = supabaseAdmin.from('profiles').select(getProfileColumns()).eq('id', userId).maybeSingle();
  let { data, error } = await query;

  if (error && profileSelectSupportsReactionColumns && isMissingReactionColumnError(error)) {
    profileSelectSupportsReactionColumns = false;
    query = supabaseAdmin.from('profiles').select(getProfileColumns()).eq('id', userId).maybeSingle();
    ({ data, error } = await query);
  }

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, stats: toStats(data) };
}

function computeFallbackPatch(currentRow, action) {
  const config = SCORE_ACTIONS[action];
  const today = getTodayIsoDate();
  const patch = {
    score: toNonNegativeInt(currentRow.score),
    roasts_generated: toNonNegativeInt(currentRow.roasts_generated),
    punchlines_created: toNonNegativeInt(currentRow.punchlines_created),
    destructions: toNonNegativeInt(currentRow.destructions),
    photos_roasted: toNonNegativeInt(currentRow.photos_roasted),
    memes_generated: toNonNegativeInt(currentRow.memes_generated),
    battle_wins: toNonNegativeInt(currentRow.battle_wins),
    daily_streak: toNonNegativeInt(currentRow.daily_streak),
    jokes_landed: toNonNegativeInt(currentRow.jokes_landed),
    cathy_surprised: toNonNegativeInt(currentRow.cathy_surprised),
    cathy_triggered: toNonNegativeInt(currentRow.cathy_triggered),
    cathy_intrigued: toNonNegativeInt(currentRow.cathy_intrigued),
    cathy_approved: toNonNegativeInt(currentRow.cathy_approved),
    last_active_date: typeof currentRow.last_active_date === 'string' ? currentRow.last_active_date : null
  };

  if (action === 'daily_participation') {
    const previous = patch.last_active_date;
    if (previous === today) {
      return patch;
    }

    patch.score += config.points;
    const previousDate = previous ? new Date(`${previous}T00:00:00.000Z`) : null;
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const isConsecutive =
      previousDate &&
      Number.isFinite(previousDate.getTime()) &&
      Math.round((todayDate.getTime() - previousDate.getTime()) / 86_400_000) === 1;

    patch.daily_streak = isConsecutive ? patch.daily_streak + 1 : 1;
    patch.last_active_date = today;
    return patch;
  }

  patch.score += config.points;
  patch[config.field] = toNonNegativeInt(patch[config.field]) + 1;
  if (action === 'battle_win') {
    patch.destructions = toNonNegativeInt(patch.destructions) + 1;
  }
  return patch;
}

async function applyScoreActionFallback(supabaseAdmin, userId, action) {
  let profileQuery = supabaseAdmin.from('profiles').select(getProfileColumns()).eq('id', userId).maybeSingle();
  let { data: currentRow, error: readError } = await profileQuery;

  if (readError && profileSelectSupportsReactionColumns && isMissingReactionColumnError(readError)) {
    profileSelectSupportsReactionColumns = false;
    profileQuery = supabaseAdmin.from('profiles').select(getProfileColumns()).eq('id', userId).maybeSingle();
    ({ data: currentRow, error: readError } = await profileQuery);
  }

  if (readError || !currentRow) {
    return { ok: false, error: readError ?? new Error('Profile not found') };
  }

  const patch = computeFallbackPatch(currentRow, action);
  if (!profileSelectSupportsReactionColumns) {
    delete patch.jokes_landed;
    delete patch.cathy_surprised;
    delete patch.cathy_triggered;
    delete patch.cathy_intrigued;
    delete patch.cathy_approved;
  }
  const { error: writeError } = await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
  if (writeError) {
    return { ok: false, error: writeError };
  }

  return { ok: true, stats: toStats(patch) };
}

async function applyScoreAction(supabaseAdmin, userId, action) {
  if (REACTION_ACTIONS.has(action)) {
    return applyScoreActionFallback(supabaseAdmin, userId, action);
  }

  const { data, error } = await supabaseAdmin.rpc('apply_score_action', {
    p_user_id: userId,
    p_action: action
  });

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, stats: toStats(row) };
  }

  if (isMissingRpcError(error)) {
    return applyScoreActionFallback(supabaseAdmin, userId, action);
  }

  return { ok: false, error };
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS' });
  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
    sendError(res, 403, 'Origin not allowed.', { code: 'ORIGIN_NOT_ALLOWED', requestId });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed.', { code: 'METHOD_NOT_ALLOWED', requestId });
    return;
  }

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missingEnv.length > 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  const {
    data: { user },
    error: authError
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  if (req.method === 'GET') {
    const statsResult = await fetchStats(supabaseAdmin, user.id);
    if (!statsResult.ok) {
      console.error(`[api/score][${requestId}] Failed to read stats`, statsResult.error);
      sendError(res, 500, 'Score store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }

    res.status(200).json(statsResult.stats);
    return;
  }

  const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
  if (!action || !SCORE_ACTIONS[action]) {
    sendError(res, 400, 'Invalid score action.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const updateResult = await applyScoreAction(supabaseAdmin, user.id, action);
  if (!updateResult.ok) {
    console.error(`[api/score][${requestId}] Failed to apply score action`, updateResult.error);
    sendError(res, 500, 'Score store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  res.status(200).json(updateResult.stats);
};
