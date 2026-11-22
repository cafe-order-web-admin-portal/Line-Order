-- Expose stable product references in customer order history for safe reorder.
CREATE OR REPLACE FUNCTION public.get_liff_orders(p_line_user_id text, p_branch_id uuid, p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_orders jsonb;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN RAISE EXCEPTION 'order tracking is not authorized'; END IF;
  IF NULLIF(pg_catalog.btrim(p_line_user_id), '') IS NULL THEN RAISE EXCEPTION 'verified LINE user id is required'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(result.order_data ORDER BY result.created_at DESC), '[]'::jsonb) INTO v_orders
  FROM (
    SELECT o.created_at, pg_catalog.jsonb_build_object(
      'order_id',o.id,'order_number',o.order_number,'order_status',o.order_status,'payment_status',o.payment_status,
      'total_amount',o.total_amount,'customer_note',o.customer_note,'created_at',o.created_at,'updated_at',o.updated_at,
      'items',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'product_id',oi.product_id,'product_name',oi.product_name,'quantity',oi.quantity,'unit_price',oi.unit_price,
        'subtotal',oi.subtotal,'selected_options',oi.selected_options
      ) ORDER BY oi.id),'[]'::jsonb) FROM public.order_items oi WHERE oi.order_id=o.id),
      'status_history',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'previous_status',h.previous_status,'new_status',h.new_status,'actor_type',h.actor_type,'note',h.note,'created_at',h.created_at
      ) ORDER BY h.created_at,h.id),'[]'::jsonb) FROM public.order_status_history h WHERE h.order_id=o.id),
      'location_share',(SELECT pg_catalog.jsonb_build_object(
        'is_sharing',s.is_sharing,'started_at',s.started_at,'stopped_at',s.stopped_at,'last_updated_at',s.updated_at,
        'latitude',s.last_latitude,'longitude',s.last_longitude,'accuracy_m',s.accuracy_m
      ) FROM public.customer_location_shares s WHERE s.order_id=o.id AND s.customer_id=c.id)
    ) AS order_data
    FROM public.orders o JOIN public.customers c ON c.id=o.customer_id
    WHERE c.line_user_id=pg_catalog.btrim(p_line_user_id) AND o.branch_id=p_branch_id
    ORDER BY o.created_at DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,10),20))
  ) result;
  RETURN COALESCE(v_orders,'[]'::jsonb);
END;
$function$;
