CREATE OR REPLACE FUNCTION public.update_liff_order_before_payment(p_order_id uuid, p_line_user_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_branch_id UUID; v_branch_code TEXT; v_order_number TEXT;
    v_order_status TEXT; v_payment_status TEXT; v_customer_line_user_id TEXT;
    v_transaction_id UUID; v_transaction_status TEXT; v_old_total NUMERIC(10,2); v_old_expected_amount NUMERIC(10,2);
    v_product_id UUID; v_product_name TEXT; v_product_active BOOLEAN;
    v_base_price NUMERIC(10,2); v_branch_available BOOLEAN; v_quantity INTEGER;
    v_option_ids JSONB; v_option_count INTEGER; v_option_distinct_count INTEGER;
    v_valid_option_count INTEGER; v_option_delta NUMERIC(10,2); v_option_snapshot JSONB;
    v_unit_price NUMERIC(10,2); v_line_total NUMERIC(10,2);
    v_total NUMERIC(10,2) := 0; v_item JSONB; v_group RECORD;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'order update is not authorized';
    END IF;
    IF p_order_id IS NULL OR NULLIF(pg_catalog.btrim(p_line_user_id), '') IS NULL THEN
        RAISE EXCEPTION 'order and verified LINE customer are required';
    END IF;
    IF pg_catalog.jsonb_typeof(p_items) <> 'array'
       OR pg_catalog.jsonb_array_length(p_items) < 1
       OR pg_catalog.jsonb_array_length(p_items) > 30 THEN
        RAISE EXCEPTION 'items must be an array containing 1 to 30 lines';
    END IF;

    -- Lock the payment row first, matching LINE webhook update order to avoid deadlocks.
    SELECT pt.id, pt.status, pt.branch_id, pt.expected_amount
      INTO v_transaction_id, v_transaction_status, v_branch_id, v_old_expected_amount
    FROM public.payment_transactions pt
    WHERE pt.order_id = p_order_id
      AND pt.customer_line_user_id = pg_catalog.btrim(p_line_user_id)
    FOR UPDATE;
    IF NOT FOUND OR v_transaction_status <> 'awaiting_payment' THEN
        RAISE EXCEPTION 'payment has already been submitted or is no longer editable';
    END IF;

    SELECT o.order_number, o.order_status, o.payment_status, o.total_amount, c.line_user_id, b.branch_code
      INTO v_order_number, v_order_status, v_payment_status, v_old_total, v_customer_line_user_id, v_branch_code
    FROM public.orders o
    JOIN public.branches b ON b.id = o.branch_id
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id = p_order_id AND o.branch_id = v_branch_id
    FOR UPDATE OF o;
    IF NOT FOUND OR v_customer_line_user_id <> pg_catalog.btrim(p_line_user_id) THEN
        RAISE EXCEPTION 'order not found for this LINE customer';
    END IF;
    IF v_order_status <> 'pending' OR COALESCE(v_payment_status, '') <> 'unpaid' THEN
        RAISE EXCEPTION 'order is no longer editable';
    END IF;
    IF v_old_expected_amount IS DISTINCT FROM v_old_total THEN
        RAISE EXCEPTION 'order and payment amounts do not match; please contact the shop';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.payment_settings ps
      WHERE ps.branch_id = v_branch_id AND ps.qr_payment_enabled IS TRUE) THEN
        RAISE EXCEPTION 'QR payment is not enabled for this branch';
    END IF;

    DELETE FROM public.order_items WHERE order_id = p_order_id;
-- Validate each line and calculate its price from trusted database values.
    FOR v_item IN
        SELECT item_value
        FROM pg_catalog.jsonb_array_elements(p_items) AS item_rows(item_value)
    LOOP
        BEGIN
            v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
            v_quantity := NULLIF(v_item->>'quantity', '')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'each item needs a valid product_id and integer quantity';
        END;

        IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 50 THEN
            RAISE EXCEPTION 'item quantity must be between 1 and 50';
        END IF;

        v_option_ids := COALESCE(v_item->'option_ids', '[]'::JSONB);
        IF pg_catalog.jsonb_typeof(v_option_ids) <> 'array' THEN
            RAISE EXCEPTION 'option_ids must be a JSON array';
        END IF;

        SELECT COUNT(*)::INTEGER, COUNT(DISTINCT option_value)::INTEGER
          INTO v_option_count, v_option_distinct_count
        FROM pg_catalog.jsonb_array_elements_text(v_option_ids) AS option_rows(option_value);

        IF v_option_count <> v_option_distinct_count THEN
            RAISE EXCEPTION 'duplicate option selection is not allowed';
        END IF;

        SELECT
            p.product_name,
            p.is_active,
            bp.price,
            bp.is_available
          INTO
            v_product_name,
            v_product_active,
            v_base_price,
            v_branch_available
        FROM public.products AS p
        JOIN public.branch_products AS bp
          ON bp.product_id = p.id
         AND bp.branch_id = v_branch_id
        WHERE p.id = v_product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'product is not configured for branch %', v_branch_code;
        END IF;
        IF v_product_active IS NOT TRUE THEN
            RAISE EXCEPTION 'product % is inactive', v_product_name;
        END IF;
        IF v_branch_available IS NOT TRUE OR v_base_price IS NULL OR v_base_price <= 0 THEN
            RAISE EXCEPTION 'product % is not available for sale at branch %', v_product_name, v_branch_code;
        END IF;

        -- All selected options must be active and explicitly mapped to this product.
        SELECT
            COUNT(DISTINCT o.id)::INTEGER,
            COALESCE(pg_catalog.sum(o.price_delta), 0)::NUMERIC(10,2),
            COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'group_code', g.group_code,
                        'group_name', g.group_name,
                        'option_code', o.option_code,
                        'option_name', o.option_name,
                        'price_delta', o.price_delta
                    ) ORDER BY g.sort_order, o.sort_order
                ),
                '[]'::JSONB
            )
          INTO v_valid_option_count, v_option_delta, v_option_snapshot
        FROM pg_catalog.jsonb_array_elements_text(v_option_ids) AS selected(option_text)
        JOIN public.product_option_product_options AS link
          ON link.product_id = v_product_id
         AND link.option_id = selected.option_text::UUID
        JOIN public.product_options AS o
          ON o.id = link.option_id
         AND o.is_active IS TRUE
        JOIN public.product_option_groups AS g
          ON g.id = o.group_id
         AND g.is_active IS TRUE;

        IF v_valid_option_count <> v_option_count THEN
            RAISE EXCEPTION 'one or more options are invalid or not available for product %', v_product_name;
        END IF;

        -- Enforce each product's configured minimum/maximum selection per group.
        FOR v_group IN
            SELECT
                g.group_name,
                pg.min_select,
                pg.max_select,
                (
                    SELECT COUNT(*)::INTEGER
                    FROM pg_catalog.jsonb_array_elements_text(v_option_ids) AS chosen(option_text)
                    JOIN public.product_option_product_options AS l
                      ON l.product_id = v_product_id
                     AND l.option_id = chosen.option_text::UUID
                    JOIN public.product_options AS op
                      ON op.id = l.option_id
                     AND op.group_id = pg.group_id
                     AND op.is_active IS TRUE
                ) AS selected_count
            FROM public.product_option_group_products AS pg
            JOIN public.product_option_groups AS g ON g.id = pg.group_id
            WHERE pg.product_id = v_product_id
              AND g.is_active IS TRUE
        LOOP
            IF v_group.selected_count < v_group.min_select THEN
                RAISE EXCEPTION 'please select at least % option(s) for %',
                    v_group.min_select, v_group.group_name;
            END IF;
            IF v_group.selected_count > v_group.max_select THEN
                RAISE EXCEPTION 'too many selections for % (maximum %)',
                    v_group.group_name, v_group.max_select;
            END IF;
        END LOOP;

        v_unit_price := v_base_price + v_option_delta;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'calculated unit price cannot be negative';
        END IF;
        v_line_total := v_unit_price * v_quantity;
        v_total := v_total + v_line_total;

        INSERT INTO public.order_items (
            order_id, product_id, product_name, quantity,
            unit_price, subtotal, selected_options
        )
        VALUES (
            p_order_id, v_product_id, v_product_name, v_quantity,
            v_unit_price, v_line_total, v_option_snapshot
        );
    END LOOP;


    UPDATE public.orders SET total_amount = v_total, updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    UPDATE public.payment_transactions SET expected_amount = v_total, updated_at = pg_catalog.now()
     WHERE id = v_transaction_id AND status = 'awaiting_payment';
    IF NOT FOUND THEN RAISE EXCEPTION 'payment state changed; please refresh and check the order'; END IF;

    INSERT INTO public.payment_audit_logs (
      transaction_id, order_id, branch_id, actor_ref, action_key, before_state, after_state
    ) VALUES (
      v_transaction_id, p_order_id, v_branch_id,
      'customer:' || pg_catalog.btrim(p_line_user_id),
      'order_items_updated_before_payment',
      pg_catalog.jsonb_build_object('expected_amount', v_old_expected_amount, 'status', v_transaction_status),
      pg_catalog.jsonb_build_object('expected_amount', v_total, 'status', 'awaiting_payment',
        'item_count', pg_catalog.jsonb_array_length(p_items))
    );
    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'order_id', p_order_id,
      'order_number', v_order_number, 'order_status', v_order_status,
      'payment_status', v_payment_status, 'previous_total', v_old_total, 'total_amount', v_total);
END;
$function$
;
REVOKE ALL ON FUNCTION public.update_liff_order_before_payment(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_liff_order_before_payment(uuid, text, jsonb) TO service_role;