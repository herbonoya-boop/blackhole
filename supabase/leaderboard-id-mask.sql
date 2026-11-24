-- Update public leaderboard masking without changing stored employee IDs.
begin;
create or replace function public.bh_leaderboard(p_slug text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('participants',count(*),'records',coalesce(
    jsonb_agg(jsonb_build_object('rank',position,'employee',
      case when length(employee_id)<=4 then repeat('*',length(employee_id))
        when employee_id ~ '^[A-Za-z]' then left(employee_id,1)||repeat('*',length(employee_id)-4)||right(employee_id,3)
        else repeat('*',length(employee_id)-3)||right(employee_id,3) end,
      'score',score,'accuracy',round(sum_accuracy/8,2),'combo',max_combo,'perfects',perfect_count)
      order by position) filter(where position<=100),'[]'::jsonb))
  from (
    select b.*,row_number() over(order by score desc,sum_accuracy desc,achieved_at,coin_id) as position
    from blackhole.best_scores b join blackhole.events e on e.id=b.event_id where e.slug=p_slug
  ) ranked;
$$;
revoke all on function public.bh_leaderboard(text) from public,anon,authenticated;
grant execute on function public.bh_leaderboard(text) to service_role;
commit;
