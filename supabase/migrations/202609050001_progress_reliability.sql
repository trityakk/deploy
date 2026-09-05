begin;

-- RLS applies to row operations, not TRUNCATE. Remove accidental broad grants.
revoke all on public.course_progress, public.profiles, public.orders, public.entitlements from anon, authenticated;
grant select, insert, update on public.course_progress, public.profiles to authenticated;
grant select on public.entitlements to authenticated;
alter table public.course_progress enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.entitlements enable row level security;

-- Merge backup keys once; do not replace already persisted table values.
insert into public.course_progress(user_id, data)
select id, raw_user_meta_data->'course_progress' from auth.users
where jsonb_typeof(raw_user_meta_data->'course_progress') = 'object'
on conflict(user_id) do update
set data = excluded.data || course_progress.data;

-- Lock the account row before applying a patch. Independent clients update
-- only changed keys; read/bookmark sets carry explicit additions/removals.
create or replace function public.save_course_progress(p_patch jsonb, p_lists jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  saved jsonb;
  k text;
  values_now jsonb;
  changes jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_lists) <> 'object'
     or octet_length(p_patch::text) > 262144 then
    raise exception 'Invalid progress patch' using errcode='22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(array['sa_read','sa_last_chapter','sa_bookmarks','sa_flashcards',
      'sa_homework','sa_homework_answers','sa_exam_passed','sa_streak','sa_theme',
      'sa_tour_seen','sa_active_tab','sa_overview_tab','sa_sidebar_open_mobile','sa_display_name'])
      or k ~ '^hw_marked_[a-z0-9_]+$') then
      raise exception 'Invalid progress key' using errcode='22023';
    end if;
    if jsonb_typeof(p_patch->k) not in ('string','null') then
      raise exception 'Invalid progress value' using errcode='22023';
    end if;
  end loop;
  insert into public.course_progress(user_id) values(uid) on conflict do nothing;
  select data into saved from public.course_progress where user_id=uid for update;
  saved := jsonb_strip_nulls(saved || p_patch);
  for k,changes in select * from jsonb_each(p_lists) loop
    if k not in ('sa_read','sa_bookmarks') or jsonb_typeof(changes->'add') <> 'array'
      or jsonb_typeof(changes->'remove') <> 'array' then
      raise exception 'Invalid list patch' using errcode='22023';
    end if;
    values_now := coalesce((saved->>k)::jsonb, '[]'::jsonb);
    select coalesce(jsonb_agg(v order by v), '[]'::jsonb) into values_now from (
      select distinct v from jsonb_array_elements(values_now || (changes->'add')) as items(v)
      where not (changes->'remove') @> jsonb_build_array(v)
    ) as merged;
    saved := jsonb_set(saved, array[k], to_jsonb(values_now::text));
  end loop;
  update public.course_progress set data=saved, updated_at=now() where user_id=uid;
  if p_patch ? 'sa_display_name' then
    update public.profiles set display_name=nullif(left(p_patch->>'sa_display_name',100),''),
      updated_at=now() where id=uid;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_course_progress(jsonb,jsonb) from public, anon;
grant execute on function public.save_course_progress(jsonb,jsonb) to authenticated;
commit;
