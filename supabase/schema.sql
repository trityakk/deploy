-- Структура авторизації та доступів курсу.
-- Виконати в Supabase SQL Editor перед підключенням frontend/backend.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null unique,
  email text not null,
  amount numeric(12,2) not null,
  currency text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','refunded','blocked')),
  merchant_account text,
  raw_payload jsonb,
  paid_at timestamptz,
  temporary_password_created_at timestamptz,
  access_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_email_idx on public.orders (lower(email));

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (lower(email)) stored,
  product text not null default 'amazon-course',
  status text not null default 'active'
    check (status in ('active','blocked','refunded')),
  source_order_reference text not null unique references public.orders(order_reference),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (email_normalized, product)
);

create index if not exists entitlements_email_idx
  on public.entitlements (lower(email), product, status);

create table if not exists public.course_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.entitlements enable row level security;
alter table public.course_progress enable row level security;

drop policy if exists "profile owner can read" on public.profiles;
create policy "profile owner can read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profile owner can update" on public.profiles;
create policy "profile owner can update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profile owner can insert" on public.profiles;
create policy "profile owner can insert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "user can read own entitlement" on public.entitlements;
create policy "user can read own entitlement" on public.entitlements
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "user can read own progress" on public.course_progress;
create policy "user can read own progress" on public.course_progress
  for select using (auth.uid() = user_id);

drop policy if exists "user can write own progress" on public.course_progress;
create policy "user can write own progress" on public.course_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "user can update own progress" on public.course_progress;
create policy "user can update own progress" on public.course_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Курсова сторінка повинна віддавати контент лише після перевірки цього view/API.
create or replace view public.active_course_access
with (security_invoker = true) as
select e.email, e.product, e.status
from public.entitlements e
where e.status = 'active'
  and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''));

-- Безпечна перевірка доступу для frontend. Не повертає дані замовлення,
-- лише true/false, тому RLS таблиці не заважає перевірці сесії.
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
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and product = 'amazon-course'
      and status = 'active'
  );
$$;

revoke all on function public.has_active_course_access() from public;
grant execute on function public.has_active_course_access() to authenticated;
