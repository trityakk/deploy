-- Move entitlement ownership from mutable email text to auth.users UUID.
alter table public.entitlements
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.entitlements e
set user_id = u.id
from auth.users u
where e.user_id is null
  and lower(e.email) = lower(u.email);

create index if not exists entitlements_user_idx
  on public.entitlements (user_id, product, status);

drop policy if exists "user can read own entitlement" on public.entitlements;
create policy "user can read own entitlement" on public.entitlements
  for select using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );

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
