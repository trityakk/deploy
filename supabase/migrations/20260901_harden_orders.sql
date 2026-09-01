-- Idempotency and delivery state for the payment webhook.
alter table public.orders
  add column if not exists temporary_password_created_at timestamptz,
  add column if not exists access_email_sent_at timestamptz;

create index if not exists orders_email_delivery_idx
  on public.orders (status, access_email_sent_at);
