const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/game.js');

test('API keeps service key private and rejects invalid requests', async () => {
  const originalEnv = { ...process.env }, originalFetch = global.fetch;
  const calls = [];
  async function request(method, action, body, headers = {}) {
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ method, query: { action }, body, headers: { host: 'game.example.com', ...headers } }, response);
    return response;
  }
  try {
    delete process.env.SUPABASE_URL;
    assert.equal((await request('GET', 'config')).data.configured, false);
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-key';
    process.env.RATE_LIMIT_SECRET = 'a'.repeat(32);
    global.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return { ok: true, json: async () => ({ coinId: '11111111-1111-4111-8111-111111111111' }) };
    };
    const headers = { origin: 'https://game.example.com', 'content-type': 'application/json' };
    assert.equal((await request('POST', 'create', {}, { ...headers, origin: 'https://other.example.com' })).code, 403);
    const created = await request('POST', 'create', {}, headers);
    assert.equal(created.code, 200);
    assert.match(created.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
    assert.equal(JSON.stringify(created).includes('server-only-key'), false);
    assert.equal(calls[0].body.p_token_hash.length, 64);
    const cookie = created.headers['Set-Cookie'].split(';')[0];
    const session = { coinId: created.data.coinId, stage: 1 };
    assert.equal((await request('POST', 'finish', { ...session, elapsedMs: -1 }, { ...headers, cookie })).code, 400);
    assert.equal((await request('POST', 'submit', { ...session, employee: ' ' }, { ...headers, cookie })).code, 400);
    assert.equal((await request('POST', 'submit', { ...session, employee: '0001' }, headers)).code, 401);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
