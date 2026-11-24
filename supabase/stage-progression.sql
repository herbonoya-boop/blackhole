-- Apply to enable the stronger stage speed progression for newly started stages.
begin;
create or replace function public.bh_start_stage(p_coin_id uuid, p_token_hash text, p_stage integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c blackhole.coins; s blackhole.stages;
begin
  c := blackhole.lock_coin(p_coin_id, p_token_hash);
  perform blackhole.assert_open(c.event_id);
  if c.submitted_at is not null or p_stage not between 1 and 8 then raise exception 'INVALID_STAGE'; end if;
  if (select count(*) from blackhole.stages where coin_id=c.id and completed_at is not null and stage<p_stage) <> p_stage-1 then
    raise exception 'STAGE_ORDER';
  end if;
  insert into blackhole.stages(coin_id, stage, phase_offset, period_ms)
    values(c.id, p_stage, .85 + random()*.65, (2050.0/1.3/.8/.85)/(1+(p_stage-1)*.035))
    on conflict (coin_id,stage) do nothing;
  select * into s from blackhole.stages where coin_id=c.id and stage=p_stage;
  if s.completed_at is not null then raise exception 'STAGE_ALREADY_FINISHED'; end if;
  return jsonb_build_object('offset',s.phase_offset,'period',s.period_ms,'stage',s.stage);
end;
$$;
revoke all on function public.bh_start_stage(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.bh_start_stage(uuid,text,integer) to service_role;
commit;
