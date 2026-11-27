-- Run this entire file once in Supabase SQL Editor. Private employee IDs are preserved.
begin;
create table if not exists blackhole.nicknames (
 event_id uuid not null references blackhole.events(id),
 employee_id text not null,
 nickname text,
 confirmed boolean not null default false,
 draw_count integer not null default 0,
 primary key(event_id,employee_id),unique(event_id,nickname)
);
alter table blackhole.nicknames enable row level security;
revoke all on blackhole.nicknames from public,anon,authenticated;
create or replace function blackhole.public_nickname(p_event uuid,p_employee text)
returns text language sql stable set search_path='' as $$
 select nickname from blackhole.nicknames where event_id=p_event and employee_id=p_employee and confirmed;
$$;
revoke all on function blackhole.public_nickname(uuid,text) from public,anon,authenticated;
create or replace function public.bh_nickname(p_coin_id uuid,p_token_hash text,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c blackhole.coins; n blackhole.nicknames; v_rank bigint; v_name text;
 adjectives text[]:=array['반짝이는','용감한','빛나는','날쌘','든든한','신나는','다정한','당당한','힘찬','멋진','행운의','꿈꾸는','도약하는','비상하는','별빛의','우주의','미래의','열정의','희망의','무적의'];
 keywords text[]:=array['무궁이','무진이','동아','동아쏘시오','쏘시오','피닉스','동아에코팩','동아제약','동아에스티','에스티팜','동아오츠카','용마로지스','디에이인포메이션','아벤종합건설','박카스','판피린','챔프','노스카나','베나치오','가그린','검가드','모닝케어','미니막스','파티온','포카리스웨트','오로나민C','데미소다','오란씨','나랑드사이다'];
begin
 c:=blackhole.lock_coin(p_coin_id,p_token_hash);
 if c.submitted_at is null or c.employee_id is null then raise exception 'COIN_INCOMPLETE'; end if;
 if p_action not in ('draw','confirm') or p_action is null then raise exception 'INVALID_REQUEST'; end if;
 select position into v_rank from (
  select employee_id,row_number() over(order by score desc,sum_accuracy desc,achieved_at,coin_id) position
  from blackhole.best_scores where event_id=c.event_id
 ) ranked where employee_id=c.employee_id;
 select * into n from blackhole.nicknames where event_id=c.event_id and employee_id=c.employee_id;
 if n.confirmed then return jsonb_build_object('nickname',n.nickname,'confirmed',true,'rank',v_rank,'drawsRemaining',0); end if;
 if p_action='draw' and (v_rank is null or v_rank>100) then raise exception 'NOT_TOP_100'; end if;
 insert into blackhole.nicknames(event_id,employee_id) values(c.event_id,c.employee_id) on conflict do nothing;
 select * into n from blackhole.nicknames where event_id=c.event_id and employee_id=c.employee_id for update;
 if n.confirmed then return jsonb_build_object('nickname',n.nickname,'confirmed',true,'rank',v_rank,'drawsRemaining',0); end if;
 if p_action='confirm' then
  if n.nickname is null then raise exception 'NICKNAME_NOT_DRAWN'; end if;
  update blackhole.nicknames set confirmed=true where event_id=c.event_id and employee_id=c.employee_id returning * into n;
 elsif n.draw_count<30 then
  for attempt in 1..20 loop
   v_name:=adjectives[1+floor(random()*array_length(adjectives,1))::integer]||' '||keywords[1+floor(random()*array_length(keywords,1))::integer]||' · '||lpad(floor(random()*10000)::integer::text,4,'0');
   begin
    update blackhole.nicknames set nickname=v_name,draw_count=draw_count+1 where event_id=c.event_id and employee_id=c.employee_id returning * into n;
    exit;
   exception when unique_violation then
    if attempt=20 then raise exception 'RATE_LIMITED'; end if;
   end;
  end loop;
 end if;
 return jsonb_build_object('nickname',n.nickname,'confirmed',n.confirmed,'rank',v_rank,'drawsRemaining',greatest(0,30-n.draw_count));
end;
$$;
revoke all on function public.bh_nickname(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bh_nickname(uuid,text,text) to service_role;
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
create or replace function public.bh_leaderboard(p_slug text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('participants',count(*),'records',coalesce(
    jsonb_agg(jsonb_build_object('rank',position,'employee',
      case when length(employee_id)<=4 then repeat('*',length(employee_id))
        when employee_id ~ '^[A-Za-z]' then left(employee_id,1)||repeat('*',length(employee_id)-4)||right(employee_id,3)
        else repeat('*',length(employee_id)-3)||right(employee_id,3) end,
      'nickname',blackhole.public_nickname(event_id,employee_id),'score',score,'accuracy',round(sum_accuracy/8,2),'combo',max_combo,'perfects',perfect_count)
      order by position) filter(where position<=100),'[]'::jsonb))
  from (
    select b.*,row_number() over(order by score desc,sum_accuracy desc,achieved_at,coin_id) as position
    from blackhole.best_scores b join blackhole.events e on e.id=b.event_id where e.slug=p_slug
  ) ranked;
$$;
revoke all on function public.bh_leaderboard(text) from public,anon,authenticated;
grant execute on function public.bh_leaderboard(text) to service_role;
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
      'nickname',blackhole.public_nickname(event_id,employee_id),'score',score,'accuracy',round(sum_accuracy/8,2),'combo',max_combo,'perfects',perfect_count) as record
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
