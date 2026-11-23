update public.orders
set payment_status='cancelled',updated_at=now()
where order_status='cancelled' and coalesce(payment_status,'unpaid') in ('unpaid','pending','expired');