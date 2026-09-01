-- All course access rows must belong to one authenticated user.
alter table public.entitlements
  alter column user_id set not null;

drop policy if exists "user can read own entitlement" on public.entitlements;
create policy "user can read own entitlement" on public.entitlements
  for select using (auth.uid() = user_id);

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
    where user_id = auth.uid()
      and product = 'amazon-course'
      and status = 'active'
  );
$$;

revoke all on function public.has_active_course_access() from public;
grant execute on function public.has_active_course_access() to authenticated;
