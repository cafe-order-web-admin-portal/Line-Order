alter table public.payment_transactions add column if not exists slip_sha256 text;
create unique index if not exists payment_transactions_slip_sha256_uidx
  on public.payment_transactions(slip_sha256) where slip_sha256 is not null;
create unique index if not exists payment_transactions_transfer_reference_uidx
  on public.payment_transactions(transfer_reference) where transfer_reference is not null;
create index if not exists payment_audit_logs_order_id_idx on public.payment_audit_logs(order_id);
create index if not exists payment_settings_updated_by_idx on public.payment_settings(updated_by);
create index if not exists payment_transactions_verified_by_idx on public.payment_transactions(verified_by);