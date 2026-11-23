insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('payment-qr','payment-qr',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

-- Transactions whose orders were explicitly cancelled must not remain eligible for LINE slip matching.
with expired as (
  update public.payment_transactions pt
  set status='expired',updated_at=now(),verification_note=coalesce(pt.verification_note,'Order was cancelled; payment session closed.')
  from public.orders o
  where o.id=pt.order_id and o.order_status='cancelled'
    and pt.status in ('awaiting_payment','rejected')
  returning pt.id,pt.order_id,pt.branch_id,pt.status as new_status
)
insert into public.payment_audit_logs(transaction_id,order_id,branch_id,actor_ref,action_key,before_state,after_state)
select e.id,e.order_id,e.branch_id,'system:payment-cleanup','payment_expired_order_cancelled',
       jsonb_build_object('status','awaiting_payment'),
       jsonb_build_object('status','expired','reason','order_cancelled')
from expired e;