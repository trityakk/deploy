-- Private course content storage.
-- Run in Supabase SQL Editor before switching cabinet-loader.js to Storage.

insert into storage.buckets (id, name, public)
values ('course-content', 'course-content', false)
on conflict (id) do update set public = false;

drop policy if exists "paid users can read course content" on storage.objects;
create policy "paid users can read course content"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-content'
  and name = 'cabinet-content.html'
  and public.has_active_course_access()
  );

-- The browser uses this small definer function before downloading the file.
-- Keep it here as well as in schema.sql so the secure-content setup is
-- complete even when the project already has the tables but not this RPC.
create or replace function public.has_active_course_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements
    where (user_id = auth.uid()
      or (user_id is null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))))
      and product = 'amazon-course'
      and status = 'active'
  );
$$;

revoke all on function public.has_active_course_access() from public;
grant execute on function public.has_active_course_access() to authenticated;
