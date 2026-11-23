alter table public.payment_settings
  add column if not exists slip_auto_verify_enabled boolean not null default false;

create table if not exists public.payment_provider_credentials (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  provider text not null default 'easyslip' check (provider = 'easyslip'),
  api_key text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_provider_credentials enable row level security;
revoke all on public.payment_provider_credentials from anon, authenticated;
grant select, insert, update, delete on public.payment_provider_credentials to service_role;
