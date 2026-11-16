-- Operator-only examples. Replace the event dates before opening submissions.
-- update blackhole.events set status='active',
--   starts_at='2026-12-01 09:00:00+09', ends_at='2026-12-08 09:00:00+09'
-- where slug='mugung-mujin-2026';

-- Optionally import the eligible employee roster before enabling this switch.
-- insert into blackhole.employees(event_id,employee_id)
-- select id,'000001' from blackhole.events where slug='mugung-mujin-2026';
-- update blackhole.events set require_employee_roster=true where slug='mugung-mujin-2026';

-- Close the event manually. Automatic cut-off also uses ends_at on the server.
-- update blackhole.events set status='closed' where slug='mugung-mujin-2026';

-- Full employee IDs are available only here, never in the public leaderboard.
-- Run after event closure and export the result as CSV for the prize recipients.
select row_number() over(order by b.score desc,b.sum_accuracy desc,b.achieved_at,b.coin_id) as rank,
  b.employee_id,b.score,round(b.sum_accuracy/8,2) as average_accuracy,
  b.max_combo,b.perfect_count,b.achieved_at,b.coin_id
from blackhole.best_scores b join blackhole.events e on e.id=b.event_id
where e.slug='mugung-mujin-2026'
order by b.score desc,b.sum_accuracy desc,b.achieved_at,b.coin_id
limit 100;

-- Audit the eight timings for a suspicious coin before awarding prizes.
-- select * from blackhole.stages where coin_id='COIN_UUID' order by stage;
