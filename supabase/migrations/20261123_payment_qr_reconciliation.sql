-- QR payment reconciliation v1.0
-- Payment data is accessed through the authenticated payment-portal Edge Function.
-- No changes to order_status, staff roles, CMS sync, or existing order workflows.

create table if not exists public.payment_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  qr_payment_enabled boolean not null default false,
  qr_image_url text not null default 'https://cafe-order-web-admin-portal.github.io/Line-Order/assets/promptpay-qr.png',
  customer_message text not null default 'กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ',
  offline_message text not null default 'ยืนยันคำสั่งซื้อ ชำระเงินที่หน้าร้าน',
  payment_timeout_minutes integer not null default 20 check (payment_timeout_minutes between 5 and 240),
  require_slip boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  order_number text not null,
  customer_name text,
  customer_line_user_id text,
  expected_amount numeric(12,2) not null check (expected_amount > 0),
  paid_amount numeric(12,2),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','submitted','matched','rejected','needs_review','expired')),
  slip_path text,
  transfer_reference text,
  transfer_at timestamptz,
  verification_note text,
  verified_by uuid null references auth.users(id) on delete set null,
  verified_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_transactions_branch_created_idx on public.payment_transactions(branch_id, created_at desc);
create index if not exists payment_transactions_status_idx on public.payment_transactions(status, created_at desc);
create index if not exists payment_transactions_order_number_idx on public.payment_transactions(order_number);
create table if not exists public.payment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.payment_transactions(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  actor_ref text not null,
  action_key text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payment_audit_logs_transaction_created_idx on public.payment_audit_logs(transaction_id, created_at desc);
alter table public.payment_settings enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_audit_logs enable row level security;
revoke all on public.payment_settings from anon, authenticated;
revoke all on public.payment_transactions from anon, authenticated;
revoke all on public.payment_audit_logs from anon, authenticated;
grant all on public.payment_settings to service_role;
grant all on public.payment_transactions to service_role;
grant all on public.payment_audit_logs to service_role;
insert into public.payment_settings(branch_id, qr_payment_enabled)
select id, false from public.branches where is_active is true
on conflict (branch_id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
