const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for(const configured of [true,false]) test(configured?'hosted server stages and saved-record retry':'hosted preview plays eight stages without a database', async () => {
  const nodes = new Map(), timers = [], requests = [];
  const classList = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, open: false, value: '', disabled: false, dataset: {}, style: { setProperty() {} }, classList,
      events: {}, textContent: '',
      addEventListener(name, handler) { this.events[name] = handler; },
      setAttribute() {}, removeAttribute() {}, focus() {}, closest() { return node('arena'); },
      querySelector() { return { focus() {} }; }, showModal() { this.open = true; }, close() { this.open = false; },
      replaceChildren() {}, append() {}, setCustomValidity() {}, reportValidity() {}
    });
    return nodes.get(id);
  }
  let failedOnce = false, serverScore = 0, clockNow = 1000;
  const context = vm.createContext({
    console, location: { protocol: 'https:' }, screen: {}, AbortSignal,
    performance: { now: () => clockNow }, localStorage: { getItem: () => null, setItem() {} },
    document: { body: { classList }, fonts: { ready: { then() {} } }, getElementById: node,
      addEventListener() {}, createElement: () => ({ append() {}, classList, setAttribute() {} }) },
    window: { addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; } },
    setTimeout(callback) { timers.push(callback); }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setInterval() {}, clearInterval() {}, clearTimeout() {},
    fetch: async (url, options) => {
      const action = url.split('action=')[1];
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ action, body });
      if (action === 'finish' && !failedOnce) {
        failedOnce = true;
        return { ok: false, json: async () => ({ error: 'DATABASE_ERROR' }) };
      }
      let data;
      if(action === 'config') data = { configured };
      if (action === 'create') data = { coinId: '11111111-1111-4111-8111-111111111111' };
      if (action === 'start') data = { offset: 1.1, period: 2300 };
      if (action === 'finish') {
        serverScore = body.stage * 1000 + 100 * 2 ** (body.stage - 1) + body.stage * 500;
        data = { accuracy: 100, perfect: true, score: serverScore, combo: body.stage, maxCombo: body.stage, perfects: body.stage };
      }
      if (action === 'submit') data = { rank: 1, participants: 1, score: serverScore, bestScore: serverScore };
      return { ok: true, json: async () => data };
    }
  });
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const run = code => vm.runInContext(code, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await run('launchMission()');
  assert.equal(requests[0].action, 'config');
  assert.equal(requests.some(item=>item.action==='create'),configured);
  while (timers.length) { await timers.shift()(); await settle(); }
  assert.equal(run('state'), 'running');
  for (let stage = 1; stage <= 8; stage++) {
    clockNow=run('started+(Math.PI-offset)*stagePeriod/turn');
    run('stop();');
    await settle();
    await timers.shift()();
    if (configured && stage === 1) {
      assert.equal(node('network-notice').hidden, false);
      assert.equal(run('state'), 'settling');
      await run('networkRetry()');
    }
    assert.equal(run('state'), 'finished');
    if (stage < 8) { node('next-round').events.click(); await settle(); }
  }
  assert.equal(run('points'), 24800);
  assert.equal(requests.filter(item => item.action === 'submit').length, 0);
  node('employee').value = '000001';
  await node('form').events.submit({ preventDefault() {} });
  assert.equal(node('stamp').disabled, true);
  assert.equal(node('employee').readOnly, true);
  assert.equal(node('coin-standing').hidden, false);
  if(configured)assert.equal(requests.at(-1).body.employee, '000001');
  else{assert.equal(run('records[0].employee'),'000001');assert.equal(requests.some(item=>item.action==='finish'),false);assert.equal(node('preview-badge').hidden,false);}
  const failures = requests.filter(item => item.action === 'finish' && item.body.stage === 1);
  if(configured)assert.deepEqual(failures[0].body, failures[1].body);
});
