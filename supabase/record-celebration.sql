-- Return the prior personal best only to the authenticated submitting device.
begin;
create index if not exists coins_employee_score on blackhole.coins(event_id,employee_id,score desc) where submitted_at is not null;
create or replace function public.bh_submit_coin(p_coin_id uuid, p_token_hash text, p_employee text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c blackhole.coins; b blackhole.best_scores; employee text:=btrim(p_employee);
  v_rank bigint; v_count bigint; e blackhole.events; v_previous integer;
begin
  c := blackhole.lock_coin(p_coin_id,p_token_hash);
  if employee is null or employee !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'INVALID_EMPLOYEE'; end if;
  if c.submitted_at is not null then
    if c.employee_id<>employee then raise exception 'ALREADY_SUBMITTED'; end if;
  else
    perform blackhole.assert_open(c.event_id);
    if c.completed_at is null or (select count(*) from blackhole.stages where coin_id=c.id and completed_at is not null)<>8 then
      raise exception 'COIN_INCOMPLETE';
    end if;
    select * into e from blackhole.events where id=c.event_id;
    if e.require_employee_roster and not exists(select 1 from blackhole.employees
      where event_id=e.id and employee_id=employee and eligible) then raise exception 'UNKNOWN_EMPLOYEE'; end if;
    update blackhole.coins set employee_id=employee,submitted_at=clock_timestamp() where id=c.id;
    insert into blackhole.best_scores(event_id,employee_id,coin_id,score,sum_accuracy,max_combo,perfect_count,achieved_at)
    values(c.event_id,employee,c.id,c.score,c.sum_accuracy,c.max_combo,c.perfect_count,c.completed_at)
    on conflict (event_id,employee_id) do update set coin_id=excluded.coin_id,score=excluded.score,
      sum_accuracy=excluded.sum_accuracy,max_combo=excluded.max_combo,perfect_count=excluded.perfect_count,achieved_at=excluded.achieved_at
    where excluded.score>blackhole.best_scores.score
      or (excluded.score=blackhole.best_scores.score and excluded.sum_accuracy>blackhole.best_scores.sum_accuracy)
      or (excluded.score=blackhole.best_scores.score and excluded.sum_accuracy=blackhole.best_scores.sum_accuracy
        and (excluded.achieved_at,excluded.coin_id)<(blackhole.best_scores.achieved_at,blackhole.best_scores.coin_id));
  end if;
  select * into b from blackhole.best_scores where event_id=c.event_id and employee_id=employee;
  select position into v_rank from (
    select employee_id,row_number() over(order by score desc,sum_accuracy desc,achieved_at,coin_id) as position
    from blackhole.best_scores where event_id=c.event_id
  ) ranked where employee_id=employee;
  select count(*) into v_count from blackhole.best_scores where event_id=c.event_id;
  select max(score) into v_previous from blackhole.coins where event_id=c.event_id and employee_id=employee and submitted_at is not null and id<>c.id and (submitted_at,id)<(select submitted_at,id from blackhole.coins where id=c.id);
  return jsonb_build_object('previousBestScore',v_previous,'newRecord',c.score>coalesce(v_previous,-1),'rank',v_rank,'participants',v_count,'rankedAt',clock_timestamp(),'score',c.score,'bestScore',b.score,
    'accuracy',round(c.sum_accuracy/8,2),'maxCombo',c.max_combo,'perfects',c.perfect_count);
end;
$$;

revoke all on function public.bh_submit_coin(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bh_submit_coin(uuid,text,text) to service_role;
commit;
