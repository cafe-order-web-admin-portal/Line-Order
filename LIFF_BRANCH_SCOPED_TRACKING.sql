-- Branch-scoped customer order history and location sharing RPCs.
-- The LIFF ID is resolved to a LINE Login Channel and branch before these functions are called.
-- Only the verified service_role Edge Functions may execute these RPCs.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_liff_orders(p_line_user_id text, p_branch_id uuid, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_orders JSONB;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'order tracking is not authorized';
    END IF;
    IF NULLIF(pg_catalog.btrim(p_line_user_id), '') IS NULL THEN
        RAISE EXCEPTION 'verified LINE user id is required';
    END IF;

    SELECT COALESCE(
        pg_catalog.jsonb_agg(result.order_data ORDER BY result.created_at DESC),
        '[]'::JSONB
    ) INTO v_orders
    FROM (
        SELECT o.created_at,
          pg_catalog.jsonb_build_object(
            'order_id', o.id,
            'order_number', o.order_number,
            'order_status', o.order_status,
            'payment_status', o.payment_status,
            'total_amount', o.total_amount,
            'customer_note', o.customer_note,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'items', (
                SELECT COALESCE(pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'product_name', oi.product_name,
                        'quantity', oi.quantity,
                        'unit_price', oi.unit_price,
                        'subtotal', oi.subtotal,
                        'selected_options', oi.selected_options
                    ) ORDER BY oi.id
                ), '[]'::JSONB)
                FROM public.order_items AS oi WHERE oi.order_id = o.id
            ),
            'status_history', (
                SELECT COALESCE(pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'previous_status', h.previous_status,
                        'new_status', h.new_status,
                        'actor_type', h.actor_type,
                        'note', h.note,
                        'created_at', h.created_at
                    ) ORDER BY h.created_at, h.id
                ), '[]'::JSONB)
                FROM public.order_status_history AS h WHERE h.order_id = o.id
            ),
            'location_share', (
                SELECT pg_catalog.jsonb_build_object(
                    'is_sharing', s.is_sharing,
                    'started_at', s.started_at,
                    'stopped_at', s.stopped_at,
                    'last_updated_at', s.updated_at,
                    'latitude', s.last_latitude,
                    'longitude', s.last_longitude,
                    'accuracy_m', s.accuracy_m
                )
                FROM public.customer_location_shares AS s
                WHERE s.order_id = o.id AND s.customer_id = c.id
            )
          ) AS order_data
        FROM public.orders AS o
        JOIN public.customers AS c ON c.id = o.customer_id
        WHERE c.line_user_id = pg_catalog.btrim(p_line_user_id)
          AND o.branch_id = p_branch_id
        ORDER BY o.created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 20))
    ) AS result;

    RETURN COALESCE(v_orders, '[]'::JSONB);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_liff_customer_location(p_line_user_id text, p_order_id uuid, p_branch_id uuid, p_action text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_accuracy_m double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_customer_id UUID;
    v_order_status TEXT;
    v_sharing BOOLEAN;
    v_updated_at TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'location endpoint is not authorized';
    END IF;

    IF NULLIF(pg_catalog.btrim(p_line_user_id), '') IS NULL OR p_order_id IS NULL THEN
        RAISE EXCEPTION 'verified LINE user and order are required';
    END IF;

    IF p_action NOT IN ('start','update','stop') THEN
        RAISE EXCEPTION 'unsupported location action';
    END IF;

    SELECT c.id, o.order_status
      INTO v_customer_id, v_order_status
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.id = p_order_id
      AND c.line_user_id = pg_catalog.btrim(p_line_user_id)
      AND o.branch_id = p_branch_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order does not belong to this LINE account';
    END IF;

    IF p_action = 'stop' THEN
        UPDATE public.customer_location_shares
           SET is_sharing = FALSE,
               stopped_at = pg_catalog.now(),
               updated_at = pg_catalog.now()
         WHERE order_id = p_order_id AND customer_id = v_customer_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', TRUE, 'is_sharing', FALSE, 'order_id', p_order_id,
            'message', 'location_sharing_stopped'
        );
    END IF;

    IF v_order_status IN ('completed','cancelled') THEN
        RAISE EXCEPTION 'order is closed; location sharing is unavailable';
    END IF;

    IF p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude < -90 OR p_latitude > 90
       OR p_longitude < -180 OR p_longitude > 180 THEN
        RAISE EXCEPTION 'invalid latitude or longitude';
    END IF;

    IF p_accuracy_m IS NOT NULL AND (p_accuracy_m < 0 OR p_accuracy_m > 10000) THEN
        RAISE EXCEPTION 'invalid location accuracy';
    END IF;

    IF p_action = 'update' THEN
        SELECT s.is_sharing, s.updated_at
          INTO v_sharing, v_updated_at
        FROM public.customer_location_shares AS s
        WHERE s.order_id = p_order_id AND s.customer_id = v_customer_id
        FOR UPDATE;

        IF NOT FOUND OR v_sharing IS NOT TRUE THEN
            RAISE EXCEPTION 'location sharing has not been started';
        END IF;

        -- Prevent accidental high-frequency writes from the mobile browser.
        IF v_updated_at > pg_catalog.now() - INTERVAL '12 seconds' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', TRUE, 'is_sharing', TRUE, 'throttled', TRUE,
                'order_id', p_order_id, 'updated_at', v_updated_at
            );
        END IF;
    END IF;

    INSERT INTO public.customer_location_shares (
        order_id, customer_id, line_user_id, is_sharing,
        started_at, stopped_at, last_latitude, last_longitude,
        accuracy_m, updated_at
    ) VALUES (
        p_order_id, v_customer_id, pg_catalog.btrim(p_line_user_id), TRUE,
        pg_catalog.now(), NULL, p_latitude, p_longitude,
        p_accuracy_m, pg_catalog.now()
    )
    ON CONFLICT (order_id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        line_user_id = EXCLUDED.line_user_id,
        is_sharing = TRUE,
        started_at = CASE
            WHEN public.customer_location_shares.is_sharing THEN public.customer_location_shares.started_at
            ELSE pg_catalog.now()
        END,
        stopped_at = NULL,
        last_latitude = EXCLUDED.last_latitude,
        last_longitude = EXCLUDED.last_longitude,
        accuracy_m = EXCLUDED.accuracy_m,
        updated_at = pg_catalog.now();

    INSERT INTO public.customer_locations (
        order_id, latitude, longitude, accuracy_m, recorded_at
    ) VALUES (
        p_order_id, p_latitude, p_longitude, p_accuracy_m, pg_catalog.now()
    );

    -- Keep only the latest 7 days of location points for this order.
    DELETE FROM public.customer_locations
    WHERE order_id = p_order_id
      AND recorded_at < pg_catalog.now() - INTERVAL '7 days';

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'is_sharing', TRUE,
        'order_id', p_order_id,
        'latitude', p_latitude,
        'longitude', p_longitude,
        'accuracy_m', p_accuracy_m,
        'updated_at', pg_catalog.now()
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_liff_orders(text, uuid, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liff_orders(text, uuid, integer)
TO service_role;

REVOKE ALL ON FUNCTION public.record_liff_customer_location(text, uuid, uuid, text, double precision, double precision, double precision)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_liff_customer_location(text, uuid, uuid, text, double precision, double precision, double precision)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
