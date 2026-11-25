-- Run once to enable private own-rank highlighting and rows below TOP 100.
begin;
create or replace function public.bh_personal_leaderboard(p_coin_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c blackhole.coins; result jsonb;
begin
  c := blackhole.lock_coin(p_coin_id,p_token_hash);
  if c.employee_id is null or c.submitted_at is null then raise exception 'COIN_INCOMPLETE'; end if;
  with ranked as materialized (
    select b.*,row_number() over(order by score desc,sum_accuracy desc,achieved_at,coin_id) as position
    from blackhole.best_scores b where event_id=c.event_id
  ), rows as (
    select position,employee_id,jsonb_build_object('rank',position,'employee',
      case when length(employee_id)<=4 then repeat('*',length(employee_id))
        when employee_id ~ '^[A-Za-z]' then left(employee_id,1)||repeat('*',length(employee_id)-4)||right(employee_id,3)
        else repeat('*',length(employee_id)-3)||right(employee_id,3) end,
      'score',score,'accuracy',round(sum_accuracy/8,2),'combo',max_combo,'perfects',perfect_count) as record
    from ranked
  )
  select jsonb_build_object('participants',count(*),
    'records',coalesce(jsonb_agg(record order by position) filter(where position<=100),'[]'::jsonb),
    'ownRecord',(jsonb_agg(record) filter(where employee_id=c.employee_id))->0)
  into result from rows;
  return result;
end;
$$;
revoke all on function public.bh_personal_leaderboard(uuid,text) from public,anon,authenticated;
grant execute on function public.bh_personal_leaderboard(uuid,text) to service_role;
commit;
