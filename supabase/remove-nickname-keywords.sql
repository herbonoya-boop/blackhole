-- Run once. Removes only these keywords from the current server pool.
-- Keeps other custom keywords and all previously confirmed nicknames.
begin;
do $prune$
declare
 definition text;
 parts text[];
 remaining text;
begin
 definition:=pg_get_functiondef('public.bh_nickname(uuid,text,text)'::regprocedure);
 parts:=regexp_match(definition,'(?is)(keywords\s+text\s*\[\s*\]\s*:=\s*array\s*\[)([^]]*)(\])');
 if parts is null then raise exception 'Nickname keyword array was not found. No change made.'; end if;
 select string_agg(token,',' order by position) into remaining
 from unnest(string_to_array(parts[2],',')) with ordinality as tokens(token,position)
 where btrim(token) not in (quote_literal('수석'),quote_literal('동천수'),quote_literal('에스티젠바이오'),quote_literal('홀딩스'),quote_literal('동아쏘시오홀딩스'));
 if remaining is null then raise exception 'Nickname pool cannot be empty. No change made.'; end if;
 execute replace(definition,parts[1]||parts[2]||parts[3],parts[1]||remaining||parts[3]);
end;
$prune$;
commit;
