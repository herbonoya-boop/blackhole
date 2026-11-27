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
      querySelector() { return { focus() {}, replaceChildren() {}, append() {} }; }, showModal() { this.open = true; this.showCount=(this.showCount||0)+1; }, close() { this.open = false; },
      replaceChildren() {}, append() {}, setCustomValidity() {}, reportValidity() {}
    });
    return nodes.get(id);
  }
  let failedOnce = false, serverScore = 0, clockNow = 1000;
  const context = vm.createContext({
    console, location: { protocol: 'https:' }, screen: {}, AbortSignal,
    performance: { now: () => clockNow }, localStorage: { getItem: () => null, setItem() {} },
    document: { body: { classList, dataset: {} }, fonts: { ready: { then() {} } }, getElementById: node,
      addEventListener() {}, createElement: () => ({ dataset:{}, append() {}, classList, setAttribute() {} }) },
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
      if (action === 'nickname') data={nickname:'빛나는 무궁이 · 1932',confirmed:body.mode==='confirm',drawsRemaining:29};
      if (action === 'submit') data = { rank: 1, participants: 1, score: serverScore, bestScore: serverScore };
      return { ok: true, json: async () => data };
    }
  });
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const run = code => vm.runInContext(code, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await run('launchMission()');
  await settle();
  assert.equal(requests[0].action, 'config');
  assert.equal(requests.some(item=>item.action==='create'),configured);
  assert.equal(requests.filter(item=>item.action==='start').length,configured?1:0);
  assert.equal(node('arena').dataset.launch,'waiting');
  while (timers.length) { await timers.shift()(); await settle(); }
  assert.equal(run('state'), 'running');
  assert.equal(node('arena').dataset.launch,'');
  assert.equal(requests.filter(item=>item.action==='start').length,configured?1:0);
  if(configured)assert.equal(run('phase'),1.1);
  context.getComputedStyle=()=>{throw new Error('Rendering must not synchronously read computed style');};
  run('advanceOrbit(performance.now()+16);paint(Math.PI);');
  for(const id of ['ballA','ballB']){
    assert.equal(node('front-'+id).style.display,'');
    assert.equal(node('rear-'+id).style.display,'none');
  }
  assert.ok(Number.isFinite(run('readOrbitProjection().m11')));
  delete context.getComputedStyle;
  for (let stage = 1; stage <= 8; stage++) {
    clockNow=run('started+(Math.PI-offset)*stagePeriod/turn');
    run('stop();');
    await settle();
    while(timers.length){await timers.shift()();await settle();}
    if (configured && stage === 1) {
      assert.equal(node('network-notice').hidden, false);
      assert.equal(run('state'), 'settling');
      await run('networkRetry()');
    }
    assert.equal(run('state'), 'finished');
    assert.equal(node('result').showCount,stage,'each stage opens its result exactly once');
    if (stage < 8) { node('next-round').events.click(); await settle(); }
  }
  assert.equal(run('points'), 24800);
  assert.equal(requests.filter(item=>item.action==='start').length,configured?8:0,'prefetch must not duplicate stage starts');
  assert.equal(requests.filter(item => item.action === 'submit').length, 0);
  node('employee').value = '000001';
  await node('form').events.submit({ preventDefault() {} });
  assert.equal(node('stamp').disabled, true);
  assert.equal(node('employee').readOnly, true);
  assert.equal(node('coin-standing').hidden, false);
  if(configured)assert.equal(requests.find(item=>item.action==='submit').body.employee, '000001');
  else{assert.equal(run('records[0].employee'),'000001');assert.equal(requests.some(item=>item.action==='finish'),false);assert.equal(node('preview-badge').hidden,false);}
  const failures = requests.filter(item => item.action === 'finish' && item.body.stage === 1);
  if(configured)assert.deepEqual(failures[0].body, failures[1].body);
});
