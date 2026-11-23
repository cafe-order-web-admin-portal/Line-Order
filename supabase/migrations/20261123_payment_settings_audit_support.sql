alter table public.payment_audit_logs alter column transaction_id drop not null;
alter table public.payment_audit_logs alter column order_id drop not null;
create index if not exists payment_audit_logs_branch_created_idx on public.payment_audit_logs(branch_id, created_at desc);