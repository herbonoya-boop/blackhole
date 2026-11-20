class GameError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

async function rpc(name, parameters) {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new GameError('NOT_CONFIGURED', 503);
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  let response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new GameError('CONNECTION_FAILED', 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const known = new Set(['EVENT_CLOSED', 'RATE_LIMITED', 'INVALID_SESSION', 'SESSION_EXPIRED',
      'INVALID_STAGE', 'STAGE_ORDER', 'STAGE_ALREADY_FINISHED', 'STAGE_NOT_STARTED',
      'INVALID_TIMING', 'INVALID_EMPLOYEE', 'ALREADY_SUBMITTED', 'COIN_INCOMPLETE', 'UNKNOWN_EMPLOYEE']);
    const code = known.has(data?.message) ? data.message : 'DATABASE_ERROR';
    const error = new GameError(code, code === 'RATE_LIMITED' ? 429 : code === 'DATABASE_ERROR' ? 503 : 400);
    if (code === 'DATABASE_ERROR') {
      error.diagnostic = { upstreamStatus: response.status };
      if (/^[A-Z0-9]{5,12}$/.test(data?.code || '')) error.diagnostic.databaseCode = data.code;
    }
    throw error;
  }
  return data;
}

module.exports = { rpc, GameError };
