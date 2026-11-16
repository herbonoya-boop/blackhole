const { randomBytes, createHash, createHmac } = require('node:crypto');
const { rpc, GameError } = require('../lib/supabase.cjs');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');

function browserToken(req) {
  const found = String(req.headers.cookie || '').match(/(?:^|;\s*)bh_device=([a-f0-9]{64})(?:;|$)/);
  return found?.[1];
}

async function bodyOf(req) {
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body).length > 4096) throw new GameError('INVALID_REQUEST');
    return body;
  }
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw new GameError('INVALID_REQUEST');
  }
  return JSON.parse(text || '{}');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = req.query?.action;
    const slug = process.env.EVENT_SLUG || 'mugung-mujin-2026';
    const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.RATE_LIMIT_SECRET?.length >= 32);
    if (req.method === 'GET' && action === 'config') {
      if (!configured) return res.status(200).json({ configured: false, accepting: false });
      const event = await rpc('bh_config', { p_slug: slug });
      return res.status(200).json({ ...event, configured: true, accepting: event?.accepting === true });
    }
    if (!configured) throw new GameError('NOT_CONFIGURED', 503);
    if (req.method === 'GET' && action === 'leaderboard') {
      return res.status(200).json(await rpc('bh_leaderboard', { p_slug: slug }));
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new GameError('METHOD_NOT_ALLOWED', 405);
    }
    // Browsers must send this JSON request from this origin. No cross-origin CORS grant.
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (!origin || new URL(origin).host !== host || !String(req.headers['content-type']).startsWith('application/json')) {
      throw new GameError('INVALID_ORIGIN', 403);
    }
    const body = await bodyOf(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GameError('INVALID_REQUEST');
    let token = browserToken(req);
    if (action === 'create') {
      token ||= randomBytes(32).toString('hex');
      const address = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const networkHash = createHmac('sha256', process.env.RATE_LIMIT_SECRET).update(address).digest('hex');
      const result = await rpc('bh_create_coin', { p_slug: slug, p_token_hash: hash(token), p_network_hash: networkHash });
      const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `bh_device=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800${secure}`);
      return res.status(200).json(result);
    }
    if (!token || !uuid.test(body.coinId || '')) throw new GameError('INVALID_SESSION', 401);
    const parameters = { p_coin_id: body.coinId, p_token_hash: hash(token) };
    if (action === 'start' || action === 'finish') {
      if (!Number.isInteger(body.stage) || body.stage < 1 || body.stage > 8) throw new GameError('INVALID_STAGE');
      parameters.p_stage = body.stage;
      if (action === 'finish') {
        if (!Number.isFinite(body.elapsedMs) || body.elapsedMs < 0 || body.elapsedMs > 900000) throw new GameError('INVALID_TIMING');
        parameters.p_elapsed_ms = body.elapsedMs;
      }
      return res.status(200).json(await rpc(action === 'start' ? 'bh_start_stage' : 'bh_finish_stage', parameters));
    }
    if (action === 'submit') {
      const employee = typeof body.employee === 'string' ? body.employee.trim() : '';
      if (!/^[A-Za-z0-9_-]{1,30}$/.test(employee)) throw new GameError('INVALID_EMPLOYEE');
      parameters.p_employee = employee;
      return res.status(200).json(await rpc('bh_submit_coin', parameters));
    }
    throw new GameError('INVALID_REQUEST');
  } catch (error) {
    const status = error instanceof GameError ? error.status : 400;
    const code = error instanceof GameError ? error.code : 'INVALID_REQUEST';
    return res.status(status).json({ error: code });
  }
};
