-- Branch-scoped public LIFF menu access and server-side checkout.
-- Apply once to cafe-amazon-order-management.
BEGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.branches, public.categories, public.products, public.branch_products,
         public.product_option_groups, public.product_option_group_products,
         public.product_options, public.product_option_product_options
FROM anon;
GRANT SELECT ON TABLE
    public.branches, public.categories, public.products, public.branch_products,
    public.product_option_groups, public.product_option_group_products,
    public.product_options, public.product_option_product_options
TO anon, authenticated;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_group_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_product_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liff_read_pkt001_branch ON public.branches;
DROP POLICY IF EXISTS liff_read_active_branches ON public.branches;
CREATE POLICY liff_read_active_branches
ON public.branches FOR SELECT TO anon, authenticated
USING (is_active IS TRUE);

DROP POLICY IF EXISTS liff_read_active_categories ON public.categories;
CREATE POLICY liff_read_active_categories
ON public.categories FOR SELECT TO anon, authenticated
USING (is_active IS TRUE);

DROP POLICY IF EXISTS liff_read_pkt001_branch_products ON public.branch_products;
DROP POLICY IF EXISTS liff_read_active_branch_products ON public.branch_products;
CREATE POLICY liff_read_active_branch_products
ON public.branch_products FOR SELECT TO anon, authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = branch_products.branch_id
          AND b.is_active IS TRUE
    )
);

DROP POLICY IF EXISTS liff_read_pkt001_products ON public.products;
DROP POLICY IF EXISTS liff_read_active_branch_products_catalog ON public.products;
CREATE POLICY liff_read_active_branch_products_catalog
ON public.products FOR SELECT TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = products.id
          AND b.is_active IS TRUE
    )
);

DROP POLICY IF EXISTS liff_read_pkt001_option_groups ON public.product_option_groups;
DROP POLICY IF EXISTS liff_read_active_branch_option_groups ON public.product_option_groups;
CREATE POLICY liff_read_active_branch_option_groups
ON public.product_option_groups FOR SELECT TO anon, authenticated
USING (
    is_active IS TRUE
    AND EXISTS (
        SELECT 1
        FROM public.product_option_group_products AS pg
        JOIN public.branch_products AS bp ON bp.product_id = pg.product_id
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE pg.group_id = product_option_groups.id
          AND b.is_active IS TRUE
    )
);

DROP POLICY IF EXISTS liff_read_pkt001_option_group_products ON public.product_option_group_products;
DROP POLICY IF EXISTS liff_read_active_branch_option_group_products ON public.product_option_group_products;
CREATE POLICY liff_read_active_branch_option_group_products
ON public.product_option_group_products FOR SELECT TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = product_option_group_products.product_id
          AND b.is_active IS TRUE
    )
);

DROP POLICY IF EXISTS liff_read_pkt001_product_option_links ON public.product_option_product_options;
DROP POLICY IF EXISTS liff_read_active_branch_product_option_links ON public.product_option_product_options;
CREATE POLICY liff_read_active_branch_product_option_links
ON public.product_option_product_options FOR SELECT TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = product_option_product_options.product_id
          AND b.is_active IS TRUE
    )
);

DROP POLICY IF EXISTS liff_read_pkt001_product_options ON public.product_options;
DROP POLICY IF EXISTS liff_read_active_branch_product_options ON public.product_options;
CREATE POLICY liff_read_active_branch_product_options
ON public.product_options FOR SELECT TO anon, authenticated
USING (
    is_active IS TRUE
    AND EXISTS (
        SELECT 1
        FROM public.product_option_product_options AS link
        JOIN public.branch_products AS bp ON bp.product_id = link.product_id
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE link.option_id = product_options.id
          AND b.is_active IS TRUE
    )
);

CREATE OR REPLACE FUNCTION public.create_liff_order(p_request_id uuid, p_line_user_id text, p_customer_name text, p_phone text, p_customer_note text, p_items jsonb, p_branch_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_branch_id UUID;
    v_branch_code TEXT;
    v_customer_id UUID;
    v_order_id UUID;
    v_order_number TEXT;
    v_existing_order_number TEXT;
    v_existing_total NUMERIC(10,2);
    v_existing_status TEXT;
    v_existing_line_user_id TEXT;
    v_product_id UUID;
    v_product_name TEXT;
    v_product_active BOOLEAN;
    v_base_price NUMERIC(10,2);
    v_branch_available BOOLEAN;
    v_quantity INTEGER;
    v_option_ids JSONB;
    v_option_count INTEGER;
    v_option_distinct_count INTEGER;
    v_valid_option_count INTEGER;
    v_option_delta NUMERIC(10,2);
    v_option_snapshot JSONB;
    v_unit_price NUMERIC(10,2);
    v_line_total NUMERIC(10,2);
    v_total NUMERIC(10,2) := 0;
    v_item JSONB;
    v_group RECORD;
BEGIN
    -- Only a trusted server-side Edge Function may submit orders.
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'order submission is not authorized';
    END IF;

    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'request_id is required';
    END IF;
    IF NULLIF(pg_catalog.btrim(p_line_user_id), '') IS NULL THEN
        RAISE EXCEPTION 'verified LINE user id is required';
    END IF;
    IF NULLIF(pg_catalog.btrim(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'customer name is required';
    END IF;
    IF pg_catalog.jsonb_typeof(p_items) <> 'array'
       OR pg_catalog.jsonb_array_length(p_items) < 1
       OR pg_catalog.jsonb_array_length(p_items) > 30 THEN
        RAISE EXCEPTION 'items must be an array containing 1 to 30 lines';
    END IF;

    -- Return an earlier result if the caller retries the same request UUID.
    SELECT o.id, o.order_number, o.total_amount, o.order_status, c.line_user_id
      INTO v_order_id, v_existing_order_number, v_existing_total, v_existing_status, v_existing_line_user_id
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.client_request_id = p_request_id;

    IF FOUND THEN
        IF v_existing_line_user_id <> pg_catalog.btrim(p_line_user_id) THEN
            RAISE EXCEPTION 'request_id has already been used';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
            'success', TRUE,
            'duplicate_request', TRUE,
            'order_id', v_order_id,
            'order_number', v_existing_order_number,
            'order_status', v_existing_status,
            'total_amount', v_existing_total
        );
    END IF;

    IF NULLIF(pg_catalog.btrim(p_branch_code), '') IS NULL THEN
        RAISE EXCEPTION 'branch_code is required';
    END IF;

    SELECT b.id, b.branch_code
      INTO v_branch_id, v_branch_code
    FROM public.branches AS b
    WHERE pg_catalog.upper(b.branch_code) = pg_catalog.upper(pg_catalog.btrim(p_branch_code))
      AND b.is_active IS TRUE
    LIMIT 1;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch % is missing or inactive', pg_catalog.btrim(p_branch_code);
    END IF;

    -- Create/update the customer using the LINE user ID verified by the Edge Function.
    INSERT INTO public.customers (line_user_id, customer_name, phone)
    VALUES (
        pg_catalog.btrim(p_line_user_id),
        pg_catalog.btrim(p_customer_name),
        NULLIF(pg_catalog.btrim(COALESCE(p_phone, '')), '')
    )
    ON CONFLICT (line_user_id) DO UPDATE
       SET customer_name = COALESCE(
               NULLIF(EXCLUDED.customer_name, ''),
               public.customers.customer_name
           ),
           phone = COALESCE(
               NULLIF(EXCLUDED.phone, ''),
               public.customers.phone
           )
    RETURNING id INTO v_customer_id;

    v_order_number := v_branch_code || '-'
        || pg_catalog.to_char(pg_catalog.clock_timestamp(), 'YYMMDDHH24MISS')
        || '-'
        || pg_catalog.upper(pg_catalog.substr(
               pg_catalog.replace(pg_catalog.gen_random_uuid()::TEXT, '-', ''), 1, 6
           ));

    INSERT INTO public.orders (
        order_number, branch_id, customer_id, order_status,
        payment_status, total_amount, customer_note, client_request_id
    )
    VALUES (
        v_order_number, v_branch_id, v_customer_id, 'pending',
        'unpaid', 0, NULLIF(pg_catalog.btrim(COALESCE(p_customer_note, '')), ''),
        p_request_id
    )
    ON CONFLICT (client_request_id) DO NOTHING
    RETURNING id INTO v_order_id;

    -- A concurrent retry may have created the order after the first lookup.
    IF v_order_id IS NULL THEN
        SELECT o.id, o.order_number, o.total_amount, o.order_status, c.line_user_id
          INTO v_order_id, v_existing_order_number, v_existing_total, v_existing_status, v_existing_line_user_id
        FROM public.orders AS o
        JOIN public.customers AS c ON c.id = o.customer_id
        WHERE o.client_request_id = p_request_id;

        IF v_existing_line_user_id <> pg_catalog.btrim(p_line_user_id) THEN
            RAISE EXCEPTION 'request_id has already been used';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
            'success', TRUE,
            'duplicate_request', TRUE,
            'order_id', v_order_id,
            'order_number', v_existing_order_number,
            'order_status', v_existing_status,
            'total_amount', v_existing_total
        );
    END IF;

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
            v_order_id, v_product_id, v_product_name, v_quantity,
            v_unit_price, v_line_total, v_option_snapshot
        );
    END LOOP;

    UPDATE public.orders
       SET total_amount = v_total,
           updated_at = pg_catalog.now()
     WHERE id = v_order_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'duplicate_request', FALSE,
        'order_id', v_order_id,
        'order_number', v_order_number,
        'order_status', 'pending',
        'payment_status', 'unpaid',
        'total_amount', v_total
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_liff_order(p_request_id uuid, p_line_user_id text, p_customer_name text, p_phone text, p_customer_note text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_active_branch_count integer;
    v_branch_code text;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'order submission is not authorized';
    END IF;

    SELECT count(*)::integer, min(b.branch_code)
      INTO v_active_branch_count, v_branch_code
    FROM public.branches AS b
    WHERE b.is_active IS TRUE;

    IF v_active_branch_count = 0 THEN
        RAISE EXCEPTION 'no active branch is configured';
    ELSIF v_active_branch_count > 1 THEN
        RAISE EXCEPTION 'branch_code is required when more than one branch is active';
    END IF;

    RETURN public.create_liff_order(
        p_request_id,
        p_line_user_id,
        p_customer_name,
        p_phone,
        p_customer_note,
        p_items,
        v_branch_code
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_liff_order(uuid, text, text, text, text, jsonb)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_liff_order(uuid, text, text, text, text, jsonb, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_liff_order(uuid, text, text, text, text, jsonb)
TO service_role;
GRANT EXECUTE ON FUNCTION public.create_liff_order(uuid, text, text, text, text, jsonb, text)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
