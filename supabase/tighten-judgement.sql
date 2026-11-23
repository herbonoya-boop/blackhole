-- Run in the existing game's Supabase SQL Editor.
-- Publish the matching browser rule and server formula atomically.
begin;
create or replace function public.bh_config(p_slug text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('title', title, 'status', status, 'startsAt', starts_at,
    'endsAt', ends_at, 'rulesVersion', rules_version, 'comboRadius', 26,
    'accepting', status = 'active' and clock_timestamp() >= starts_at and clock_timestamp() < ends_at)
  from blackhole.events where slug = p_slug;
$$;

create or replace function public.bh_finish_stage(p_coin_id uuid, p_token_hash text, p_stage integer, p_elapsed_ms double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c blackhole.coins; s blackhole.stages; a double precision; d double precision;
  v_accuracy numeric(5,2); v_streak integer:=0; v_max integer:=0; v_sum numeric:=0;
  v_perfects integer:=0; v_score integer; item record;
begin
  c := blackhole.lock_coin(p_coin_id,p_token_hash);
  -- Completed stage requests are idempotent, including after event closure.
  select * into s from blackhole.stages where coin_id=c.id and stage=p_stage;
  if s.coin_id is null then raise exception 'STAGE_NOT_STARTED'; end if;
  if s.completed_at is null then
    perform blackhole.assert_open(c.event_id);
    if c.submitted_at is not null or p_elapsed_ms is null or p_elapsed_ms < 0 or p_elapsed_ms > 900000
      or p_elapsed_ms = 'NaN'::float8
      or p_elapsed_ms > extract(epoch from (clock_timestamp()-s.started_at))*1000 + 250 then
      raise exception 'INVALID_TIMING';
    end if;
    a := s.phase_offset + p_elapsed_ms * 2*pi() / s.period_ms;
    d := sqrt(power(392*sin(a),2) + power(132*sin(2*a),2));
    v_accuracy := case
      when d<=7 then 100
      when d<=26 then least(99.99,round((100-(d-7)*10/19)::numeric,2))
      else greatest(0,least(89.99,round((90*(392-d)/366)::numeric,2))) end;
    update blackhole.stages set elapsed_ms=p_elapsed_ms,accuracy=v_accuracy,is_perfect=(d<=7),
      completed_at=clock_timestamp() where coin_id=c.id and stage=p_stage returning * into s;
  end if;
  for item in select * from blackhole.stages where coin_id=c.id and completed_at is not null order by stage loop
    v_sum:=v_sum+item.accuracy;
    if item.accuracy>=90 then v_streak:=v_streak+1; else v_streak:=0; end if;
    v_max:=greatest(v_max,v_streak);
    if item.is_perfect then v_perfects:=v_perfects+1; end if;
  end loop;
  v_score := round(v_sum*10)::integer + case when v_max>0 then (100*power(2,v_max-1))::integer else 0 end + v_perfects*500;
  if p_stage=8 then
    update blackhole.coins set score=v_score,sum_accuracy=v_sum,max_combo=v_max,
      perfect_count=v_perfects,completed_at=coalesce(completed_at,clock_timestamp()) where id=c.id;
  end if;
  return jsonb_build_object('accuracy',s.accuracy,'perfect',s.is_perfect,'score',v_score,
    'combo',v_streak,'maxCombo',v_max,'perfects',v_perfects);
end;
$$;
commit;
