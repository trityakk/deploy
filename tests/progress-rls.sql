-- Runs against the configured project. All test writes are rolled back.
begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.course_progress limit 1), true);
set local role authenticated;
do $$
declare result jsonb; before_read text;
begin
  if auth.uid() is null then raise exception 'No account available for transactional test'; end if;
  if exists(select 1 from public.course_progress where user_id <> auth.uid()) then
    raise exception 'RLS exposes another account';
  end if;
  select data->>'sa_read' into before_read from public.course_progress where user_id=auth.uid();
  result := public.save_course_progress('{"sa_theme":"dark"}', '{"sa_read":{"add":["audit_test_a"],"remove":[]}}');
  result := public.save_course_progress('{}', '{"sa_read":{"add":["audit_test_b"],"remove":[]}}');
  if not ((result->>'sa_read')::jsonb @> '["audit_test_a","audit_test_b"]') then
    raise exception 'Concurrent-client merge failed';
  end if;
  result := public.save_course_progress('{}', '{"sa_read":{"add":[],"remove":["audit_test_a"]}}');
  if (result->>'sa_read')::jsonb @> '["audit_test_a"]' then raise exception 'Removal failed'; end if;
  if has_table_privilege('anon','public.course_progress','SELECT')
    or has_table_privilege('authenticated','public.course_progress','TRUNCATE') then
    raise exception 'Unexpected broad grants';
  end if;
end $$;
select 'PASS: own-row read/write, merge, removal, no foreign rows, restricted grants; all changes rolled back' as result;
rollback;
