const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('eight-stage scoring, retries, personal bests, privacy and closing time', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8'));
    await db.exec("update blackhole.events set status='active',starts_at=now()-interval '1 day',ends_at=now()+interval '1 day';");
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/stage-progression.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/personal-leaderboard.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/record-celebration.sql'), 'utf8'));
    const token = 'a'.repeat(64), network = 'b'.repeat(64);
    async function rpc(name, args) {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
      const result = await db.query(`select public.${name}(${placeholders}) as data`, args);
      return result.rows[0].data;
    }
    async function coin(perfect) {
      const created = await rpc('bh_create_coin', ['mugung-mujin-2026', token, network]);
      const id = created.coinId;
      await assert.rejects(rpc('bh_start_stage', [id, token, 2]), /STAGE_ORDER/);
      let final;
      for (let stage = 1; stage <= 8; stage++) {
        const info = await rpc('bh_start_stage', [id, token, stage]);
        assert.ok(Math.abs(info.period-(2050/1.3/.8/.85)/(1+(stage-1)*.035))<1e-8);
        assert.deepEqual(await rpc('bh_start_stage', [id, token, stage]), info);
        await db.query("update blackhole.stages set started_at=clock_timestamp()-interval '10 seconds' where coin_id=$1 and stage=$2", [id, stage]);
        const target = perfect ? Math.PI : Math.PI / 2;
        const elapsed = (target - info.offset) * info.period / (2 * Math.PI);
        final = await rpc('bh_finish_stage', [id, token, stage, elapsed]);
        assert.deepEqual(await rpc('bh_finish_stage', [id, token, stage, elapsed]), final);
        assert.equal(final.accuracy, perfect ? 100 : 0);
      }
      return { id, final };
    }
    const winner = await coin(true);
    assert.equal(winner.final.score, 24800);
    assert.equal(winner.final.maxCombo, 8);
    assert.equal(winner.final.perfects, 8);
    await assert.rejects(rpc('bh_submit_coin', [winner.id, 'c'.repeat(64), 'A000001']), /INVALID_SESSION/);
    const registered = await rpc('bh_submit_coin', [winner.id, token, 'A000001']);
    assert.equal(registered.rank, 1);
    assert.equal(registered.newRecord,true);
    assert.equal(registered.previousBestScore,null);
    const repeated = await rpc('bh_submit_coin', [winner.id, token, 'A000001']);
    assert.ok(Date.parse(repeated.rankedAt) >= Date.parse(registered.rankedAt));
    const { rankedAt: firstRankTime, ...originalResult } = registered;
    const { rankedAt: secondRankTime, ...repeatedResult } = repeated;
    assert.deepEqual(repeatedResult, originalResult);
    await assert.rejects(rpc('bh_submit_coin', [winner.id, token, '000002']), /ALREADY_SUBMITTED/);
    const worse = await coin(false);
    const lower = await rpc('bh_submit_coin', [worse.id, token, 'A000001']);
    assert.equal(lower.score, 0);
    assert.equal(lower.newRecord,false);
    assert.equal(lower.previousBestScore,24800);
    assert.equal(lower.bestScore, 24800);
    const runnerUp = await coin(true);
    const second = await rpc('bh_submit_coin', [runnerUp.id, token, '000002']);
    assert.equal(second.rank, 2);
    assert.equal(second.participants, 2);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/leaderboard-id-mask.sql'), 'utf8'));
    const board = await rpc('bh_leaderboard', ['mugung-mujin-2026']);
    assert.equal(board.records[0].employee, 'A***001');
    assert.equal(board.records[0].score, 24800);
    assert.equal(board.records[1].employee, '***002');
    assert.equal(JSON.stringify(board).includes('A000001'), false);
    await db.exec(`
      insert into blackhole.coins(event_id,token_hash,network_hash,employee_id,score,sum_accuracy,max_combo,perfect_count,completed_at)
      select e.id,repeat('d',64),repeat('e',64),lpad((100000+g)::text,6,'0'),g,500,1,0,clock_timestamp()
      from blackhole.events e cross join generate_series(1,6000) g;
      insert into blackhole.best_scores(event_id,employee_id,coin_id,score,sum_accuracy,max_combo,perfect_count,achieved_at)
      select event_id,employee_id,id,score,sum_accuracy,max_combo,perfect_count,completed_at
      from blackhole.coins where employee_id like '1%';
    `);
    const largeBoard = await rpc('bh_leaderboard', ['mugung-mujin-2026']);
    assert.equal(largeBoard.participants, 6002);
    assert.equal(largeBoard.records.length, 100);
    assert.equal(largeBoard.records[0].score, 24800);
    const ownBest = await rpc('bh_personal_leaderboard', [worse.id, token]);
    assert.equal(ownBest.ownRecord.rank, 1);
    assert.equal(ownBest.ownRecord.score, 24800);
    assert.equal(ownBest.ownRecord.accuracy, 100);
    assert.equal(ownBest.ownRecord.combo, 8);
    assert.equal(ownBest.records.length, 100);
    await assert.rejects(rpc('bh_personal_leaderboard', [worse.id, 'c'.repeat(64)]), /INVALID_SESSION/);
    const outside = await coin(false);
    await rpc('bh_submit_coin', [outside.id, token, 'A000498']);
    const ownOutside = await rpc('bh_personal_leaderboard', [outside.id, token]);
    assert.equal(ownOutside.records.length, 100);
    assert.equal(ownOutside.participants, 6003);
    assert.equal(ownOutside.ownRecord.rank, 6003);
    assert.equal(ownOutside.ownRecord.employee, 'A***498');
    assert.equal(ownOutside.ownRecord.score, 0);
    assert.equal(JSON.stringify(ownOutside).includes('A000498'), false);
    const improvedCoin=await coin(true);
    const improved=await rpc('bh_submit_coin',[improvedCoin.id,token,'A000498']);
    assert.equal(improved.newRecord,true);
    assert.equal(improved.previousBestScore,0);
    assert.equal(improved.score,24800);
    const tiedCoin=await coin(true);
    const tied=await rpc('bh_submit_coin',[tiedCoin.id,token,'A000498']);
    assert.equal(tied.newRecord,false);
    assert.equal(tied.previousBestScore,24800);
    const retried=await rpc('bh_submit_coin',[improvedCoin.id,token,'A000498']);
    assert.equal(retried.previousBestScore,0);
    assert.equal(retried.newRecord,true);
    const personalPermission = await db.query("select has_function_privilege('anon','public.bh_personal_leaderboard(uuid,text)','EXECUTE') as allowed");
    assert.equal(personalPermission.rows[0].allowed, false);
    const permission = await db.query("select has_function_privilege('anon','public.bh_leaderboard(text)','EXECUTE') as allowed");
    assert.equal(permission.rows[0].allowed, false);
    await db.exec("update blackhole.events set ends_at=clock_timestamp()-interval '1 second';");
    await assert.rejects(rpc('bh_create_coin', ['mugung-mujin-2026', token, network]), /EVENT_CLOSED/);
    assert.equal((await rpc('bh_submit_coin', [winner.id, token, 'A000001'])).bestScore, 24800);
  } finally { await db.close(); }
});
