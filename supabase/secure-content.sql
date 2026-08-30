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
  and exists (
    select 1
    from public.entitlements e
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and e.product = 'amazon-course'
      and e.status = 'active'
  )
);
