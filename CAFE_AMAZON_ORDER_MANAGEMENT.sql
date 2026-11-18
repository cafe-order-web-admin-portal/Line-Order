-- =====================================================================
-- CAFE AMAZON ORDER MANAGEMENT
-- COMPLETE DATABASE SCRIPT (SIMPLIFIED ORDER OPTIONS)
-- Branch: PKT001 - Cafe Amazon - ตลาดทวีสมาน
--
-- HOW TO USE:
-- 1) Replace all code in SQL Editor with this entire file.
-- 2) Run once. The script is designed to be re-runnable.
-- 3) Existing orders, customers, product prices and stock settings
--    are NOT deleted or overwritten.
--
-- OPTION DESIGN (simple, marketplace-style):
--   A. Drink type: one choice, only mapped choices are shown.
--   B. Sweetness: optional, single choice:
--      100%, 50%, 25%, 0%.
--   C. Size: group is ready but no size choices are activated or linked
--      until the branch confirms actual cup sizes.
--   D. Extra: ready for later; no topping/add-on is invented.
--
-- PRODUCT CATALOG:
-- 40 starter products are inserted as DRAFT:
-- inactive, branch unavailable, price 0.00.
-- This is NOT a live POS export and is NOT verified branch availability.
--
-- OPTION DATA:
-- Previous product-option mappings for CA-* draft products are refreshed.
-- Existing orders/customers/products and branch price edits are preserved.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. CORE TABLES (9)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_code TEXT UNIQUE NOT NULL,
    branch_name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES public.categories(id),
    product_code TEXT UNIQUE,
    product_name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_featured BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0
);

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.branch_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id),
    product_id UUID REFERENCES public.products(id),
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_available BOOLEAN DEFAULT TRUE,
    UNIQUE(branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id TEXT UNIQUE,
    customer_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL,
    branch_id UUID NOT NULL REFERENCES public.branches(id),
    customer_id UUID NOT NULL REFERENCES public.customers(id),
    order_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (order_status IN (
            'pending','confirmed','preparing','ready',
            'on_the_way','arrived','completed','cancelled'
        )),
    payment_status TEXT DEFAULT 'unpaid',
    total_amount NUMERIC(10,2) DEFAULT 0,
    customer_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id),
    product_id UUID REFERENCES public.products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.customer_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id),
    branch_id UUID REFERENCES public.branches(id),
    staff_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff'
        CHECK (role IN ('super_admin','manager','staff')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================
-- 2. OPTION TABLES (4 tables including direct product-option mapping)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.product_option_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code TEXT UNIQUE NOT NULL,
    group_name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'single'
        CHECK (selection_type IN ('single','multiple')),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL
        REFERENCES public.product_option_groups(id),
    option_code TEXT NOT NULL,
    option_name TEXT NOT NULL,
    price_delta NUMERIC(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(group_id, option_code)
);

CREATE TABLE IF NOT EXISTS public.product_option_group_products (
    product_id UUID NOT NULL
        REFERENCES public.products(id) ON DELETE CASCADE,
    group_id UUID NOT NULL
        REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT FALSE,
    min_select INTEGER DEFAULT 0,
    max_select INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (product_id, group_id),
    CHECK (min_select >= 0 AND max_select >= min_select)
);

CREATE TABLE IF NOT EXISTS public.product_option_product_options (
    product_id UUID NOT NULL
        REFERENCES public.products(id) ON DELETE CASCADE,
    option_id UUID NOT NULL
        REFERENCES public.product_options(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (product_id, option_id)
);

-- =====================================================================
-- 3. INDEXES
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_orders_branch ON public.orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(order_status);
CREATE INDEX IF NOT EXISTS idx_locations_order ON public.customer_locations(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_branch_products_branch ON public.branch_products(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_products_product ON public.branch_products(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_product_options_group ON public.product_options(group_id);

-- =====================================================================
-- 4. BRANCH + CUSTOMER CATEGORIES
-- =====================================================================

INSERT INTO public.branches (branch_code, branch_name)
VALUES ('PKT001', 'Cafe Amazon - ตลาดทวีสมาน')
ON CONFLICT (branch_code) DO NOTHING;

INSERT INTO public.categories (category_name, sort_order, is_active)
SELECT v.category_name, v.sort_order, TRUE
FROM (VALUES
    ('กาแฟ', 1),
    ('ชา', 2),
    ('นมและช็อกโกแลต', 3),
    ('เครื่องดื่มผลไม้', 4),
    ('เบเกอรี่และของทานเล่น', 5)
) AS v(category_name, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.category_name = v.category_name
);

-- =====================================================================
-- 5. STARTER PRODUCT CATALOG (40 ITEMS - DRAFT ONLY)
-- =====================================================================

WITH seed_products (product_code, category_name, product_name, display_order) AS (
    VALUES
        ('CA-COF-001', 'กาแฟ', 'เอสเปรสโซ', 1),
        ('CA-COF-002', 'กาแฟ', 'อเมซอน', 2),
        ('CA-COF-003', 'กาแฟ', 'อเมซอนเอ็กซ์ตร้า', 3),
        ('CA-COF-004', 'กาแฟ', 'แบล็คคอฟฟี่', 4),
        ('CA-COF-005', 'กาแฟ', 'แบล็คคอฟฟี่น้ำผึ้ง', 5),
        ('CA-COF-006', 'กาแฟ', 'แบล็คคอฟฟี่น้ำผึ้งมะนาว', 6),
        ('CA-COF-007', 'กาแฟ', 'คาปูชิโน่', 7),
        ('CA-COF-008', 'กาแฟ', 'ลาเต้อเมซอน', 8),
        ('CA-COF-009', 'กาแฟ', 'มอคค่า', 9),
        ('CA-COF-010', 'กาแฟ', 'อเมริกาโน (พรีเมียม)', 10),
        ('CA-COF-011', 'กาแฟ', 'คาราเมล มัคคิอาโต', 11),
        ('CA-COF-012', 'กาแฟ', 'คอฟฟี่ มาร์เบิล', 12),
        ('CA-TEA-001', 'ชา', 'ชา', 1),
        ('CA-TEA-002', 'ชา', 'ชาเขียวนม', 2),
        ('CA-TEA-003', 'ชา', 'ชานม', 3),
        ('CA-TEA-004', 'ชา', 'โฮจิฉะ บราวน์ชูการ์ ลาเต้', 4),
        ('CA-TEA-005', 'ชา', 'ชาดำ', 5),
        ('CA-TEA-006', 'ชา', 'ชามะนาว', 6),
        ('CA-MIL-001', 'นมและช็อกโกแลต', 'นมสด', 1),
        ('CA-MIL-002', 'นมและช็อกโกแลต', 'ช็อกโกแลต', 2),
        ('CA-MIL-003', 'นมและช็อกโกแลต', 'สตรอว์เบอร์รีชีสเค้ก', 3),
        ('CA-MIL-004', 'นมและช็อกโกแลต', 'มิลกี้ สตรอว์เบอร์รี', 4),
        ('CA-FRU-001', 'เครื่องดื่มผลไม้', 'น้ำลิ้นจี่', 1),
        ('CA-FRU-002', 'เครื่องดื่มผลไม้', 'น้ำสตรอว์เบอร์รีปั่น', 2),
        ('CA-FRU-003', 'เครื่องดื่มผลไม้', 'น้ำกีวีปั่น', 3),
        ('CA-FRU-004', 'เครื่องดื่มผลไม้', 'มิกซ์เบอร์รีปั่น', 4),
        ('CA-FRU-005', 'เครื่องดื่มผลไม้', 'สตรอว์เบอร์รีโยเกิร์ตสมูทตี้', 5),
        ('CA-FRU-006', 'เครื่องดื่มผลไม้', 'มิกซ์เบอร์รีโยเกิร์ตสมูทตี้', 6),
        ('CA-BAK-001', 'เบเกอรี่และของทานเล่น', 'ครัวซองเนยสด', 1),
        ('CA-BAK-002', 'เบเกอรี่และของทานเล่น', 'ครัวซองแฮมชีส', 2),
        ('CA-BAK-003', 'เบเกอรี่และของทานเล่น', 'ครัวซองดับเบิ้ลช็อกโกแลต', 3),
        ('CA-BAK-004', 'เบเกอรี่และของทานเล่น', 'เดนิชแฮมชีส', 4),
        ('CA-BAK-005', 'เบเกอรี่และของทานเล่น', 'โทสต์แฮมทริปเปิ้ลชีส', 5),
        ('CA-BAK-006', 'เบเกอรี่และของทานเล่น', 'ผักโขมอบชีสโทสต์', 6),
        ('CA-BAK-007', 'เบเกอรี่และของทานเล่น', 'คุกกี้เนย', 7),
        ('CA-BAK-008', 'เบเกอรี่และของทานเล่น', 'คุกกี้เนย สายรุ้ง', 8),
        ('CA-BAK-009', 'เบเกอรี่และของทานเล่น', 'คุกกี้ช็อกโกแลตแครนเบอร์รี่', 9),
        ('CA-BAK-010', 'เบเกอรี่และของทานเล่น', 'ป๊อปคอร์น กลิ่นทรัฟเฟิล', 10),
        ('CA-BAK-011', 'เบเกอรี่และของทานเล่น', 'ป๊อปคอร์น รสซาวครีมและชีส', 11),
        ('CA-BAK-012', 'เบเกอรี่และของทานเล่น', 'ป๊อปคอร์น รสคาราเมล', 12)
)
INSERT INTO public.products (
    category_id, product_code, product_name, description,
    is_active, is_featured, display_order
)
SELECT
    c.id,
    s.product_code,
    s.product_name,
    'เมนูตั้งต้น - กรุณาตรวจสอบชื่อและรายการขายจริงของสาขา',
    FALSE,
    FALSE,
    s.display_order
FROM seed_products s
JOIN public.categories c
  ON c.category_name = s.category_name
ON CONFLICT (product_code) DO NOTHING;

-- Create branch-specific rows without changing existing price/availability.
INSERT INTO public.branch_products (branch_id, product_id, price, is_available)
SELECT b.id, p.id, 0.00, FALSE
FROM public.branches b
JOIN public.products p ON p.product_code LIKE 'CA-%'
WHERE b.branch_code = 'PKT001'
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- =====================================================================
-- 6. FOUR SIMPLE OPTION GROUPS
-- =====================================================================

INSERT INTO public.product_option_groups
    (group_code, group_name, selection_type, is_active, sort_order)
VALUES
    ('DRINK_TYPE', 'ประเภทเครื่องดื่ม', 'single', TRUE, 1),
    ('SWEETNESS', 'ระดับความหวาน', 'single', TRUE, 2),
    ('SIZE', 'ขนาด', 'single', TRUE, 3),
    ('EXTRA', 'เพิ่มเติม', 'multiple', TRUE, 4)
ON CONFLICT (group_code) DO UPDATE
SET group_name = EXCLUDED.group_name,
    selection_type = EXCLUDED.selection_type,
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order;

-- =====================================================================
-- 7. STANDARD OPTIONS
-- =====================================================================

-- Drink types: mapped per product below.
INSERT INTO public.product_options
    (group_id, option_code, option_name, price_delta, is_active, sort_order)
SELECT g.id, v.option_code, v.option_name, 0.00, TRUE, v.sort_order
FROM public.product_option_groups g
CROSS JOIN (VALUES
    ('HOT', 'ร้อน', 1),
    ('ICED', 'เย็น', 2),
    ('FRAPPE', 'ปั่น', 3)
) AS v(option_code, option_name, sort_order)
WHERE g.group_code = 'DRINK_TYPE'
ON CONFLICT (group_id, option_code) DO UPDATE
SET option_name = EXCLUDED.option_name,
    price_delta = 0.00,
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order;

-- Sweetness follows the four levels used in LINE MAN's less-sweet campaign.
INSERT INTO public.product_options
    (group_id, option_code, option_name, price_delta, is_active, sort_order)
SELECT g.id, v.option_code, v.option_name, 0.00, TRUE, v.sort_order
FROM public.product_option_groups g
CROSS JOIN (VALUES
    ('SWEET_100', 'หวานปกติ 100%', 1),
    ('SWEET_50',  'หวานน้อย 50%', 2),
    ('SWEET_25',  'หวานน้อยมาก 25%', 3),
    ('SWEET_0',   'ไม่หวาน 0%', 4)
) AS v(option_code, option_name, sort_order)
WHERE g.group_code = 'SWEETNESS'
ON CONFLICT (group_id, option_code) DO UPDATE
SET option_name = EXCLUDED.option_name,
    price_delta = 0.00,
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order;

-- Size choices are deliberately inactive until PKT001 confirms actual sizes.
UPDATE public.product_options o
SET is_active = FALSE
FROM public.product_option_groups g
WHERE o.group_id = g.id
  AND g.group_code = 'SIZE';

-- Remove any old 75% sweetness choice from use.
UPDATE public.product_options o
SET is_active = FALSE
FROM public.product_option_groups g
WHERE o.group_id = g.id
  AND g.group_code = 'SWEETNESS'
  AND o.option_code NOT IN ('SWEET_100','SWEET_50','SWEET_25','SWEET_0');

-- =====================================================================
-- 8. RESET OLD OPTION LINKS FOR THE 40 STARTER PRODUCTS ONLY
-- Does not delete products, prices, customers or orders.
-- =====================================================================

DELETE FROM public.product_option_product_options po
USING public.products p
WHERE po.product_id = p.id
  AND p.product_code LIKE 'CA-%';

DELETE FROM public.product_option_group_products pg
USING public.products p
WHERE pg.product_id = p.id
  AND p.product_code LIKE 'CA-%';

-- =====================================================================
-- 9. MAP DRINK TYPES TO STARTER DRINK PRODUCTS
-- This list is provisional. Confirm each drink with the actual branch menu.
-- =====================================================================

WITH product_drink_types (product_code, option_code) AS (
    VALUES
        ('CA-COF-001', 'HOT'),
        ('CA-COF-001', 'ICED'),
        ('CA-COF-001', 'FRAPPE'),
        ('CA-COF-002', 'HOT'),
        ('CA-COF-002', 'ICED'),
        ('CA-COF-002', 'FRAPPE'),
        ('CA-COF-003', 'ICED'),
        ('CA-COF-004', 'HOT'),
        ('CA-COF-004', 'ICED'),
        ('CA-COF-005', 'ICED'),
        ('CA-COF-006', 'ICED'),
        ('CA-COF-007', 'HOT'),
        ('CA-COF-007', 'ICED'),
        ('CA-COF-008', 'HOT'),
        ('CA-COF-009', 'HOT'),
        ('CA-COF-010', 'HOT'),
        ('CA-COF-010', 'ICED'),
        ('CA-COF-011', 'HOT'),
        ('CA-COF-011', 'ICED'),
        ('CA-COF-011', 'FRAPPE'),
        ('CA-COF-012', 'ICED'),
        ('CA-TEA-001', 'HOT'),
        ('CA-TEA-002', 'HOT'),
        ('CA-TEA-002', 'ICED'),
        ('CA-TEA-002', 'FRAPPE'),
        ('CA-TEA-003', 'HOT'),
        ('CA-TEA-003', 'ICED'),
        ('CA-TEA-003', 'FRAPPE'),
        ('CA-TEA-004', 'ICED'),
        ('CA-TEA-005', 'ICED'),
        ('CA-TEA-006', 'ICED'),
        ('CA-MIL-001', 'HOT'),
        ('CA-MIL-001', 'ICED'),
        ('CA-MIL-001', 'FRAPPE'),
        ('CA-MIL-002', 'HOT'),
        ('CA-MIL-002', 'ICED'),
        ('CA-MIL-002', 'FRAPPE'),
        ('CA-MIL-003', 'FRAPPE'),
        ('CA-MIL-004', 'ICED'),
        ('CA-MIL-004', 'FRAPPE'),
        ('CA-FRU-001', 'ICED'),
        ('CA-FRU-001', 'FRAPPE'),
        ('CA-FRU-002', 'FRAPPE'),
        ('CA-FRU-003', 'FRAPPE'),
        ('CA-FRU-004', 'FRAPPE'),
        ('CA-FRU-005', 'FRAPPE'),
        ('CA-FRU-006', 'FRAPPE')
),
resolved AS (
    SELECT DISTINCT
        p.id AS product_id,
        g.id AS group_id
    FROM product_drink_types m
    JOIN public.products p ON p.product_code = m.product_code
    JOIN public.product_option_groups g ON g.group_code = 'DRINK_TYPE'
)
INSERT INTO public.product_option_group_products
    (product_id, group_id, is_required, min_select, max_select, sort_order)
SELECT product_id, group_id, TRUE, 1, 1, 1
FROM resolved
ON CONFLICT (product_id, group_id) DO UPDATE
SET is_required = TRUE, min_select = 1, max_select = 1, sort_order = 1;

WITH product_drink_types (product_code, option_code) AS (
    VALUES
        ('CA-COF-001', 'HOT'),
        ('CA-COF-001', 'ICED'),
        ('CA-COF-001', 'FRAPPE'),
        ('CA-COF-002', 'HOT'),
        ('CA-COF-002', 'ICED'),
        ('CA-COF-002', 'FRAPPE'),
        ('CA-COF-003', 'ICED'),
        ('CA-COF-004', 'HOT'),
        ('CA-COF-004', 'ICED'),
        ('CA-COF-005', 'ICED'),
        ('CA-COF-006', 'ICED'),
        ('CA-COF-007', 'HOT'),
        ('CA-COF-007', 'ICED'),
        ('CA-COF-008', 'HOT'),
        ('CA-COF-009', 'HOT'),
        ('CA-COF-010', 'HOT'),
        ('CA-COF-010', 'ICED'),
        ('CA-COF-011', 'HOT'),
        ('CA-COF-011', 'ICED'),
        ('CA-COF-011', 'FRAPPE'),
        ('CA-COF-012', 'ICED'),
        ('CA-TEA-001', 'HOT'),
        ('CA-TEA-002', 'HOT'),
        ('CA-TEA-002', 'ICED'),
        ('CA-TEA-002', 'FRAPPE'),
        ('CA-TEA-003', 'HOT'),
        ('CA-TEA-003', 'ICED'),
        ('CA-TEA-003', 'FRAPPE'),
        ('CA-TEA-004', 'ICED'),
        ('CA-TEA-005', 'ICED'),
        ('CA-TEA-006', 'ICED'),
        ('CA-MIL-001', 'HOT'),
        ('CA-MIL-001', 'ICED'),
        ('CA-MIL-001', 'FRAPPE'),
        ('CA-MIL-002', 'HOT'),
        ('CA-MIL-002', 'ICED'),
        ('CA-MIL-002', 'FRAPPE'),
        ('CA-MIL-003', 'FRAPPE'),
        ('CA-MIL-004', 'ICED'),
        ('CA-MIL-004', 'FRAPPE'),
        ('CA-FRU-001', 'ICED'),
        ('CA-FRU-001', 'FRAPPE'),
        ('CA-FRU-002', 'FRAPPE'),
        ('CA-FRU-003', 'FRAPPE'),
        ('CA-FRU-004', 'FRAPPE'),
        ('CA-FRU-005', 'FRAPPE'),
        ('CA-FRU-006', 'FRAPPE')
)
INSERT INTO public.product_option_product_options
    (product_id, option_id, sort_order)
SELECT DISTINCT
    p.id,
    o.id,
    o.sort_order
FROM product_drink_types m
JOIN public.products p ON p.product_code = m.product_code
JOIN public.product_option_groups g ON g.group_code = 'DRINK_TYPE'
JOIN public.product_options o
  ON o.group_id = g.id AND o.option_code = m.option_code
ON CONFLICT (product_id, option_id) DO NOTHING;

-- =====================================================================
-- 10. MAP SWEETNESS AS OPTIONAL, SINGLE-CHOICE GROUP
-- User may skip it. Four choices only.
-- =====================================================================

WITH beverage_products (product_code) AS (
    VALUES
        ('CA-COF-001'),
        ('CA-COF-002'),
        ('CA-COF-003'),
        ('CA-COF-004'),
        ('CA-COF-005'),
        ('CA-COF-006'),
        ('CA-COF-007'),
        ('CA-COF-008'),
        ('CA-COF-009'),
        ('CA-COF-010'),
        ('CA-COF-011'),
        ('CA-COF-012'),
        ('CA-TEA-001'),
        ('CA-TEA-002'),
        ('CA-TEA-003'),
        ('CA-TEA-004'),
        ('CA-TEA-005'),
        ('CA-TEA-006'),
        ('CA-MIL-001'),
        ('CA-MIL-002'),
        ('CA-MIL-003'),
        ('CA-MIL-004'),
        ('CA-FRU-001'),
        ('CA-FRU-002'),
        ('CA-FRU-003'),
        ('CA-FRU-004'),
        ('CA-FRU-005'),
        ('CA-FRU-006')
)
INSERT INTO public.product_option_group_products
    (product_id, group_id, is_required, min_select, max_select, sort_order)
SELECT DISTINCT
    p.id, g.id, FALSE, 0, 1, 2
FROM beverage_products bp
JOIN public.products p ON p.product_code = bp.product_code
JOIN public.product_option_groups g ON g.group_code = 'SWEETNESS'
ON CONFLICT (product_id, group_id) DO UPDATE
SET is_required = FALSE, min_select = 0, max_select = 1, sort_order = 2;

WITH beverage_products (product_code) AS (
    VALUES
        ('CA-COF-001'),
        ('CA-COF-002'),
        ('CA-COF-003'),
        ('CA-COF-004'),
        ('CA-COF-005'),
        ('CA-COF-006'),
        ('CA-COF-007'),
        ('CA-COF-008'),
        ('CA-COF-009'),
        ('CA-COF-010'),
        ('CA-COF-011'),
        ('CA-COF-012'),
        ('CA-TEA-001'),
        ('CA-TEA-002'),
        ('CA-TEA-003'),
        ('CA-TEA-004'),
        ('CA-TEA-005'),
        ('CA-TEA-006'),
        ('CA-MIL-001'),
        ('CA-MIL-002'),
        ('CA-MIL-003'),
        ('CA-MIL-004'),
        ('CA-FRU-001'),
        ('CA-FRU-002'),
        ('CA-FRU-003'),
        ('CA-FRU-004'),
        ('CA-FRU-005'),
        ('CA-FRU-006')
)
INSERT INTO public.product_option_product_options
    (product_id, option_id, sort_order)
SELECT DISTINCT
    p.id, o.id, o.sort_order
FROM beverage_products bp
JOIN public.products p ON p.product_code = bp.product_code
JOIN public.product_option_groups g ON g.group_code = 'SWEETNESS'
JOIN public.product_options o
  ON o.group_id = g.id
 AND o.option_code IN ('SWEET_100','SWEET_50','SWEET_25','SWEET_0')
 AND o.is_active = TRUE
ON CONFLICT (product_id, option_id) DO NOTHING;

-- SIZE and EXTRA stay unlinked/without active choices until the branch confirms them.

-- =====================================================================
-- 11. ENABLE RLS + BLOCK DIRECT API ACCESS UNTIL POLICIES ARE CREATED
-- =====================================================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_group_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_product_options ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.branches,
    public.categories,
    public.products,
    public.branch_products,
    public.customers,
    public.orders,
    public.order_items,
    public.customer_locations,
    public.staff,
    public.product_option_groups,
    public.product_options,
    public.product_option_group_products,
    public.product_option_product_options
FROM anon, authenticated;

COMMIT;

-- =====================================================================
-- 12. FINAL CHECK
-- =====================================================================

SELECT
    'branches' AS item,
    COUNT(*) AS total
FROM public.branches
WHERE branch_code = 'PKT001'
UNION ALL
SELECT 'categories', COUNT(*)
FROM public.categories
WHERE category_name IN (
    'กาแฟ','ชา','นมและช็อกโกแลต','เครื่องดื่มผลไม้','เบเกอรี่และของทานเล่น'
)
UNION ALL
SELECT 'starter_products', COUNT(*)
FROM public.products
WHERE product_code LIKE 'CA-%'
UNION ALL
SELECT 'option_groups', COUNT(*)
FROM public.product_option_groups
WHERE group_code IN ('DRINK_TYPE','SWEETNESS','SIZE','EXTRA')
UNION ALL
SELECT 'active_drink_options', COUNT(*)
FROM public.product_options o
JOIN public.product_option_groups g ON g.id = o.group_id
WHERE g.group_code = 'DRINK_TYPE' AND o.is_active = TRUE
UNION ALL
SELECT 'active_sweetness_options', COUNT(*)
FROM public.product_options o
JOIN public.product_option_groups g ON g.id = o.group_id
WHERE g.group_code = 'SWEETNESS' AND o.is_active = TRUE;

-- Show customer selections currently configured per draft product.
SELECT
    p.product_code,
    p.product_name,
    g.group_name AS option_group,
    STRING_AGG(o.option_name, ', ' ORDER BY po.sort_order) AS choices,
    pg.is_required,
    pg.min_select,
    pg.max_select
FROM public.products p
JOIN public.product_option_group_products pg ON pg.product_id = p.id
JOIN public.product_option_groups g ON g.id = pg.group_id
JOIN public.product_option_product_options po ON po.product_id = p.id
JOIN public.product_options o
  ON o.id = po.option_id AND o.group_id = g.id
WHERE p.product_code LIKE 'CA-%'
  AND o.is_active = TRUE
GROUP BY p.product_code, p.product_name, g.group_name,
         pg.is_required, pg.min_select, pg.max_select,
         g.sort_order
ORDER BY p.product_code, g.sort_order;
SELECT
    b.branch_code,
    COUNT(bp.id) AS total_products,
    COUNT(*) FILTER (WHERE bp.price = 0) AS zero_price,
    COUNT(*) FILTER (WHERE bp.is_available = FALSE) AS unavailable
FROM public.branch_products bp
JOIN public.branches b ON b.id = bp.branch_id
JOIN public.products p ON p.id = bp.product_id
WHERE b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%'
GROUP BY b.branch_code;
-- ================================================================
-- CAFE AMAZON WEB ADMIN PORTAL - SECURITY + IMPORT SETUP
-- Run this once in Supabase SQL Editor after the core database exists.
--
-- Auth model:
--   Supabase Auth email/password + public.staff.auth_user_id mapping
--   super_admin: global catalog, categories, options, all branches
--   manager: branch-specific prices and availability, view catalog
--   staff: read-only branch catalog
--
-- This script does NOT grant access to anon and does NOT expose secrets.
-- ================================================================

BEGIN;

-- Private helper schema: not meant to be exposed through the Data API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_staff_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.role
    FROM public.staff AS s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.is_active = TRUE
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.current_staff_branch_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.branch_id
    FROM public.staff AS s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.is_active = TRUE
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.is_active_staff()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.staff AS s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.is_active = TRUE
    )
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.staff AS s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.is_active = TRUE
          AND s.role = 'super_admin'
    )
$$;

CREATE OR REPLACE FUNCTION private.is_branch_manager(target_branch UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.staff AS s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.is_active = TRUE
          AND s.role = 'manager'
          AND s.branch_id = target_branch
    )
$$;

REVOKE ALL ON FUNCTION private.current_staff_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_staff_branch_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_active_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_branch_manager(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.current_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_staff_branch_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_branch_manager(UUID) TO authenticated;

-- Import audit trail.
CREATE TABLE IF NOT EXISTS public.import_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id),
    import_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    success_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('completed','partial','failed')),
    details JSONB DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_history_branch_created
    ON public.import_history(branch_id, created_at DESC);

-- Enable RLS for portal tables.
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_group_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

-- Remove policies with these names so the script can be re-run.
DROP POLICY IF EXISTS staff_self_or_superadmin_read ON public.staff;
DROP POLICY IF EXISTS branches_scope_read ON public.branches;
DROP POLICY IF EXISTS categories_staff_read ON public.categories;
DROP POLICY IF EXISTS categories_superadmin_write ON public.categories;
DROP POLICY IF EXISTS products_staff_read ON public.products;
DROP POLICY IF EXISTS products_superadmin_insert ON public.products;
DROP POLICY IF EXISTS products_superadmin_update ON public.products;
DROP POLICY IF EXISTS products_superadmin_delete ON public.products;
DROP POLICY IF EXISTS branch_products_scope_read ON public.branch_products;
DROP POLICY IF EXISTS branch_products_manager_insert ON public.branch_products;
DROP POLICY IF EXISTS branch_products_manager_update ON public.branch_products;
DROP POLICY IF EXISTS branch_products_manager_delete ON public.branch_products;
DROP POLICY IF EXISTS option_groups_staff_read ON public.product_option_groups;
DROP POLICY IF EXISTS option_groups_superadmin_write ON public.product_option_groups;
DROP POLICY IF EXISTS product_options_staff_read ON public.product_options;
DROP POLICY IF EXISTS product_options_superadmin_write ON public.product_options;
DROP POLICY IF EXISTS option_group_products_staff_read ON public.product_option_group_products;
DROP POLICY IF EXISTS option_group_products_superadmin_write ON public.product_option_group_products;
DROP POLICY IF EXISTS product_option_links_staff_read ON public.product_option_product_options;
DROP POLICY IF EXISTS product_option_links_superadmin_write ON public.product_option_product_options;
DROP POLICY IF EXISTS import_history_scope_read ON public.import_history;
DROP POLICY IF EXISTS import_history_scoped_insert ON public.import_history;

-- STAFF: user can read own row; super_admin can read all staff.
CREATE POLICY staff_self_or_superadmin_read
ON public.staff FOR SELECT TO authenticated
USING (auth_user_id = (SELECT auth.uid()) OR private.is_super_admin());

-- BRANCHES: super_admin sees all; manager/staff see assigned branch.
CREATE POLICY branches_scope_read
ON public.branches FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND (
        private.is_super_admin()
        OR id = private.current_staff_branch_id()
    )
);

-- CATEGORIES: authenticated active staff may read; only super_admin writes.
CREATE POLICY categories_staff_read
ON public.categories FOR SELECT TO authenticated
USING (private.is_active_staff());

CREATE POLICY categories_superadmin_write
ON public.categories FOR ALL TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

-- PRODUCTS: active staff may read; only super_admin changes global catalogue.
CREATE POLICY products_staff_read
ON public.products FOR SELECT TO authenticated
USING (private.is_active_staff());

CREATE POLICY products_superadmin_insert
ON public.products FOR INSERT TO authenticated
WITH CHECK (private.is_super_admin());

CREATE POLICY products_superadmin_update
ON public.products FOR UPDATE TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

CREATE POLICY products_superadmin_delete
ON public.products FOR DELETE TO authenticated
USING (private.is_super_admin());

-- BRANCH PRODUCTS: super_admin all branches; manager only own branch; staff read-only.
CREATE POLICY branch_products_scope_read
ON public.branch_products FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND (
        private.is_super_admin()
        OR branch_id = private.current_staff_branch_id()
    )
);

CREATE POLICY branch_products_manager_insert
ON public.branch_products FOR INSERT TO authenticated
WITH CHECK (
    private.is_super_admin()
    OR private.is_branch_manager(branch_id)
);

CREATE POLICY branch_products_manager_update
ON public.branch_products FOR UPDATE TO authenticated
USING (
    private.is_super_admin()
    OR private.is_branch_manager(branch_id)
)
WITH CHECK (
    private.is_super_admin()
    OR private.is_branch_manager(branch_id)
);

CREATE POLICY branch_products_manager_delete
ON public.branch_products FOR DELETE TO authenticated
USING (
    private.is_super_admin()
    OR private.is_branch_manager(branch_id)
);

-- OPTION TABLES: read for active staff; write for super_admin.
CREATE POLICY option_groups_staff_read
ON public.product_option_groups FOR SELECT TO authenticated
USING (private.is_active_staff());
CREATE POLICY option_groups_superadmin_write
ON public.product_option_groups FOR ALL TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

CREATE POLICY product_options_staff_read
ON public.product_options FOR SELECT TO authenticated
USING (private.is_active_staff());
CREATE POLICY product_options_superadmin_write
ON public.product_options FOR ALL TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

CREATE POLICY option_group_products_staff_read
ON public.product_option_group_products FOR SELECT TO authenticated
USING (private.is_active_staff());
CREATE POLICY option_group_products_superadmin_write
ON public.product_option_group_products FOR ALL TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

CREATE POLICY product_option_links_staff_read
ON public.product_option_product_options FOR SELECT TO authenticated
USING (private.is_active_staff());
CREATE POLICY product_option_links_superadmin_write
ON public.product_option_product_options FOR ALL TO authenticated
USING (private.is_super_admin())
WITH CHECK (private.is_super_admin());

-- IMPORT HISTORY: super_admin all; manager sees/inserts only own branch.
CREATE POLICY import_history_scope_read
ON public.import_history FOR SELECT TO authenticated
USING (
    private.is_super_admin()
    OR (
        private.current_staff_role() = 'manager'
        AND branch_id = private.current_staff_branch_id()
    )
);

CREATE POLICY import_history_scoped_insert
ON public.import_history FOR INSERT TO authenticated
WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (
        private.is_super_admin()
        OR (
            private.current_staff_role() = 'manager'
            AND branch_id = private.current_staff_branch_id()
        )
    )
);

-- Least-privilege grants: authenticated role only, with RLS enforcing rows/actions.
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON public.staff TO authenticated;
GRANT SELECT ON public.branches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_options TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_group_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_product_options TO authenticated;
GRANT SELECT, INSERT ON public.import_history TO authenticated;

REVOKE ALL ON
    public.staff, public.branches, public.categories, public.products,
    public.branch_products, public.product_option_groups, public.product_options,
    public.product_option_group_products, public.product_option_product_options,
    public.import_history
FROM anon;

-- Product image storage: public read through public object URLs; admin-only upload/change/delete.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    TRUE,
    5242880,
    ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = TRUE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS product_images_admin_select ON storage.objects;
DROP POLICY IF EXISTS product_images_admin_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_admin_update ON storage.objects;
DROP POLICY IF EXISTS product_images_admin_delete ON storage.objects;

CREATE POLICY product_images_admin_select
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images' AND private.is_super_admin());

CREATE POLICY product_images_admin_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND private.is_super_admin());

CREATE POLICY product_images_admin_update
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND private.is_super_admin())
WITH CHECK (bucket_id = 'product-images' AND private.is_super_admin());

CREATE POLICY product_images_admin_delete
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND private.is_super_admin());

COMMIT;

-- Verify the portal setup.
SELECT
    table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'import_history';

SELECT id, name, public
FROM storage.buckets
WHERE id = 'product-images';
-- LINK SUPER ADMIN ACCOUNT

INSERT INTO public.staff (
    auth_user_id,
    branch_id,
    staff_name,
    role,
    is_active
)
SELECT
    '511d7c13-9c42-4c41-8179-8f28eee45cc6'::UUID,
    b.id,
    'Super Admin',
    'super_admin',
    TRUE
FROM public.branches b
WHERE b.branch_code = 'PKT001'

ON CONFLICT (auth_user_id)
DO UPDATE SET
    branch_id = EXCLUDED.branch_id,
    staff_name = EXCLUDED.staff_name,
    role = 'super_admin',
    is_active = TRUE;

-- VERIFY
SELECT staff_name, role, is_active
FROM public.staff
WHERE auth_user_id = '511d7c13-9c42-4c41-8179-8f28eee45cc6';

-- =====================================================================
-- 13. LIFF CUSTOMER MENU - PUBLIC READ ACCESS (PKT001 ONLY)
-- =====================================================================
-- Purpose:
--   Allow LINE LIFF visitors using the Supabase anon key to read the
--   active categories and the menu/prices linked to branch PKT001.
-- Security:
--   - Read-only access. No INSERT/UPDATE/DELETE is granted to anon.
--   - Branch, branch_products and products are scoped to PKT001.
--   - Categories are limited to is_active = TRUE.
--   - Product sale status and branch availability are NOT changed here.
--   - Products remain non-orderable until product.is_active = TRUE,
--     branch_products.is_available = TRUE and price > 0.
-- Re-runnable: policies are dropped by name and recreated.
-- =====================================================================

BEGIN;

-- Minimum Data API read permissions required by the Customer LIFF page.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE
    public.branches,
    public.categories,
    public.products,
    public.branch_products
TO anon, authenticated;

-- Branch lookup: expose only the target branch record.
DROP POLICY IF EXISTS liff_read_pkt001_branch ON public.branches;
CREATE POLICY liff_read_pkt001_branch
ON public.branches
FOR SELECT
TO anon, authenticated
USING (branch_code = 'PKT001');

-- Category list: expose active categories only.
DROP POLICY IF EXISTS liff_read_active_categories ON public.categories;
CREATE POLICY liff_read_active_categories
ON public.categories
FOR SELECT
TO anon, authenticated
USING (is_active IS TRUE);

-- Branch prices/availability: expose rows belonging to PKT001 only.
DROP POLICY IF EXISTS liff_read_pkt001_branch_products ON public.branch_products;
CREATE POLICY liff_read_pkt001_branch_products
ON public.branch_products
FOR SELECT
TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branches AS b
        WHERE b.id = branch_products.branch_id
          AND b.branch_code = 'PKT001'
    )
);

-- Product details: expose only products linked to PKT001.
-- Do not filter is_active here; the LIFF page can display draft items
-- as unavailable without accidentally enabling them for purchase.
DROP POLICY IF EXISTS liff_read_pkt001_products ON public.products;
CREATE POLICY liff_read_pkt001_products
ON public.products
FOR SELECT
TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = products.id
          AND b.branch_code = 'PKT001'
    )
);

COMMIT;

-- Verify LIFF public-menu policy setup (expected: 4 policies).
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
      'liff_read_pkt001_branch',
      'liff_read_active_categories',
      'liff_read_pkt001_branch_products',
      'liff_read_pkt001_products'
  )
ORDER BY tablename, policyname;

-- =====================================================================
-- 14. SECURE LIFF ORDER SUBMISSION (SERVER-TO-SERVER ONLY)
-- =====================================================================
-- Purpose:
--   Provide one trusted database entry point for creating customer orders.
--   The LIFF browser must call a Supabase Edge Function; that Edge Function
--   verifies the LINE LIFF ID token and calls this function with service_role.
-- Security:
--   - Never grant this function to anon or authenticated.
--   - Do not trust a line_user_id sent directly by the browser.
--   - The Edge Function must verify the LINE ID token and use the verified
--     LINE sub as p_line_user_id.
--   - Product availability and all prices are re-checked in the database.
-- Behaviour:
--   - Fixed branch PKT001; no client-supplied branch_id is accepted.
--   - Price is calculated from branch_products.price plus selected option deltas.
--   - Required/min/max option rules are validated server-side.
--   - Selected option names/codes/prices are snapshotted on order_items.
--   - p_request_id makes retries idempotent and prevents duplicate orders.
--   - Draft/inactive or unavailable products cannot be ordered.
-- Re-runnable: columns/index/function are created or replaced safely.
-- =====================================================================

BEGIN;

-- Preserve a snapshot of selected modifiers on each order line.
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS selected_options JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Client-generated UUID used only for retry protection; nullable for legacy orders.
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_id
    ON public.orders (client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_liff_order(
    p_request_id UUID,
    p_line_user_id TEXT,
    p_customer_name TEXT,
    p_phone TEXT,
    p_customer_note TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_branch_id UUID;
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

    SELECT b.id
      INTO v_branch_id
    FROM public.branches AS b
    WHERE b.branch_code = 'PKT001'
      AND b.is_active IS TRUE
    LIMIT 1;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch PKT001 is missing or inactive';
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

    v_order_number := 'PKT001-'
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
            RAISE EXCEPTION 'product is not configured for branch PKT001';
        END IF;
        IF v_product_active IS NOT TRUE THEN
            RAISE EXCEPTION 'product % is inactive', v_product_name;
        END IF;
        IF v_branch_available IS NOT TRUE OR v_base_price IS NULL OR v_base_price <= 0 THEN
            RAISE EXCEPTION 'product % is not available for sale at branch PKT001', v_product_name;
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

-- This function is called only by a trusted server-side Edge Function.
REVOKE ALL ON FUNCTION public.create_liff_order(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_liff_order(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
    TO service_role;

COMMIT;

-- Verify Section 14 objects.
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'order_items'
  AND column_name = 'selected_options'
UNION ALL
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'client_request_id';

SELECT
    routine_name,
    security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name = 'create_liff_order';


-- =====================================================================
-- 15. LIFF PRODUCT OPTIONS - PUBLIC READ ACCESS (PKT001 ONLY)
-- =====================================================================
-- Purpose:
--   Allow the LIFF customer page to load drink-type and sweetness choices.
-- Security:
--   - Read-only access for anon/authenticated.
--   - Only option groups/options mapped to products linked to PKT001 are visible.
--   - RLS on related tables remains enabled.
--   - No product, price, availability or option status is changed.
-- Re-runnable: policies are dropped by name and recreated.

BEGIN;

ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_group_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_product_options ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE
    public.product_option_groups,
    public.product_options,
    public.product_option_group_products,
    public.product_option_product_options
TO anon, authenticated;

-- Product-to-option-group mappings are visible only for PKT001 products.
DROP POLICY IF EXISTS liff_read_pkt001_option_group_products
    ON public.product_option_group_products;
CREATE POLICY liff_read_pkt001_option_group_products
ON public.product_option_group_products
FOR SELECT
TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = product_option_group_products.product_id
          AND b.branch_code = 'PKT001'
    )
);

-- Active option groups used by at least one PKT001 product.
DROP POLICY IF EXISTS liff_read_pkt001_option_groups
    ON public.product_option_groups;
CREATE POLICY liff_read_pkt001_option_groups
ON public.product_option_groups
FOR SELECT
TO anon, authenticated
USING (
    is_active IS TRUE
    AND EXISTS (
        SELECT 1
        FROM public.product_option_group_products AS pg
        JOIN public.branch_products AS bp ON bp.product_id = pg.product_id
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE pg.group_id = product_option_groups.id
          AND b.branch_code = 'PKT001'
    )
);

-- Active options explicitly mapped to products linked to PKT001.
DROP POLICY IF EXISTS liff_read_pkt001_product_options
    ON public.product_options;
CREATE POLICY liff_read_pkt001_product_options
ON public.product_options
FOR SELECT
TO anon, authenticated
USING (
    is_active IS TRUE
    AND EXISTS (
        SELECT 1
        FROM public.product_option_product_options AS po
        JOIN public.branch_products AS bp ON bp.product_id = po.product_id
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE po.option_id = product_options.id
          AND b.branch_code = 'PKT001'
    )
);

-- Product-to-option choices are visible only for PKT001 products.
DROP POLICY IF EXISTS liff_read_pkt001_product_option_links
    ON public.product_option_product_options;
CREATE POLICY liff_read_pkt001_product_option_links
ON public.product_option_product_options
FOR SELECT
TO anon, authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.branch_products AS bp
        JOIN public.branches AS b ON b.id = bp.branch_id
        WHERE bp.product_id = product_option_product_options.product_id
          AND b.branch_code = 'PKT001'
    )
);

COMMIT;

-- Verify Section 15 policies (expected: 4 rows).
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
      'liff_read_pkt001_option_group_products',
      'liff_read_pkt001_option_groups',
      'liff_read_pkt001_product_options',
      'liff_read_pkt001_product_option_links'
  )
ORDER BY tablename, policyname;

-- =====================================================================
-- 16. STAFF ORDER QUEUE + CONTROLLED STATUS UPDATES
-- =====================================================================
-- Purpose:
--   Give active Super Admin / Manager users read access to orders in their
--   allowed branch scope, and allow status changes only through the guarded
--   update_order_status() function.
-- Security:
--   - No direct UPDATE grant is given on public.orders.
--   - Staff visibility is enforced by RLS and existing private staff helpers.
--   - Only super_admin and manager can change order status.
--   - Manager can change status only for their assigned branch.
--   - Customers/order_items can be read only when attached to a visible order.
-- Re-runnable: policies and function are replaced by name/signature.
-- =====================================================================

BEGIN;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE
    public.orders,
    public.order_items,
    public.customers
TO authenticated;

-- Order queue: super_admin can see all; active manager/staff see own branch.
DROP POLICY IF EXISTS liff_admin_orders_read ON public.orders;
CREATE POLICY liff_admin_orders_read
ON public.orders
FOR SELECT
TO authenticated
USING (
    private.is_active_staff()
    AND (
        private.is_super_admin()
        OR branch_id = private.current_staff_branch_id()
    )
);

-- Order lines are visible only when the parent order is visible to that staff user.
DROP POLICY IF EXISTS liff_admin_order_items_read ON public.order_items;
CREATE POLICY liff_admin_order_items_read
ON public.order_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.orders AS o
        WHERE o.id = order_items.order_id
    )
);

-- Customer contact details are visible only when linked to a visible order.
DROP POLICY IF EXISTS liff_admin_customers_read ON public.customers;
CREATE POLICY liff_admin_customers_read
ON public.customers
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.orders AS o
        WHERE o.customer_id = customers.id
    )
);

-- Controlled order-status update. Do not grant direct UPDATE on orders.
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role TEXT;
    v_staff_branch_id UUID;
    v_order_number TEXT;
    v_current_status TEXT;
    v_order_branch_id UUID;
    v_customer_name TEXT;
    v_line_user_id TEXT;
BEGIN
    v_role := private.current_staff_role();
    v_staff_branch_id := private.current_staff_branch_id();

    IF COALESCE(v_role, '') NOT IN ('super_admin', 'manager') THEN
        RAISE EXCEPTION 'only super_admin or manager can update order status';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'order_id is required';
    END IF;

    IF p_new_status NOT IN (
        'confirmed', 'preparing', 'ready', 'on_the_way',
        'arrived', 'completed', 'cancelled'
    ) THEN
        RAISE EXCEPTION 'unsupported order status';
    END IF;

    SELECT
        o.order_number,
        o.order_status,
        o.branch_id,
        c.customer_name,
        c.line_user_id
    INTO
        v_order_number,
        v_current_status,
        v_order_branch_id,
        v_customer_name,
        v_line_user_id
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.id = p_order_id
      AND o.branch_id = private.current_staff_branch_id()
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found';
    END IF;

    IF v_role = 'manager' AND v_order_branch_id <> v_staff_branch_id THEN
        RAISE EXCEPTION 'manager cannot update an order outside their branch';
    END IF;

    IF NOT (
        (v_current_status = 'pending' AND p_new_status IN ('confirmed', 'cancelled'))
        OR (v_current_status = 'confirmed' AND p_new_status IN ('preparing', 'cancelled'))
        OR (v_current_status = 'preparing' AND p_new_status IN ('ready', 'cancelled'))
        OR (v_current_status = 'ready' AND p_new_status IN ('completed', 'on_the_way', 'cancelled'))
        OR (v_current_status = 'on_the_way' AND p_new_status IN ('arrived', 'cancelled'))
        OR (v_current_status = 'arrived' AND p_new_status = 'completed')
    ) THEN
        RAISE EXCEPTION 'invalid status transition: % -> %', v_current_status, p_new_status;
    END IF;

    UPDATE public.orders
       SET order_status = p_new_status,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'previous_status', v_current_status,
        'order_status', p_new_status,
        'customer_name', v_customer_name,
        'line_user_id', v_line_user_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT)
    TO authenticated;

CREATE INDEX IF NOT EXISTS idx_orders_created_at
    ON public.orders (created_at DESC);

COMMIT;

-- Verify Section 16 staff policies and status RPC.
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
      'liff_admin_orders_read',
      'liff_admin_order_items_read',
      'liff_admin_customers_read'
  )
ORDER BY tablename, policyname;

SELECT routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name = 'update_order_status';

-- =====================================================================
-- 17. CUSTOMER ORDER TRACKING - SERVER-VERIFIED LINE ID ONLY
-- =====================================================================
-- Purpose:
--   Return the signed-in LINE customer's own recent orders for the LIFF page.
-- Security:
--   - This SECURITY DEFINER RPC is callable only by service_role.
--   - The Edge Function must verify LINE ID token and pass verified LINE sub.
--   - Browser-supplied line_user_id is never accepted directly by the RPC.
--   - Returns only orders belonging to the supplied verified LINE user ID.
-- Re-runnable: function replaced by signature.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_liff_orders(
    p_line_user_id TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    )
    INTO v_orders
    FROM (
        SELECT
            o.created_at,
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
                    SELECT COALESCE(
                        pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'product_name', oi.product_name,
                                'quantity', oi.quantity,
                                'unit_price', oi.unit_price,
                                'subtotal', oi.subtotal,
                                'selected_options', oi.selected_options
                            ) ORDER BY oi.id
                        ),
                        '[]'::JSONB
                    )
                    FROM public.order_items AS oi
                    WHERE oi.order_id = o.id
                )
            ) AS order_data
        FROM public.orders AS o
        JOIN public.customers AS c ON c.id = o.customer_id
        WHERE c.line_user_id = pg_catalog.btrim(p_line_user_id)
        ORDER BY o.created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 20))
    ) AS result;

    RETURN COALESCE(v_orders, '[]'::JSONB);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    TO service_role;

-- Verify Section 17 tracking function.
SELECT routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name = 'get_liff_orders';

-- =====================================================================
-- 18. FINAL SECURITY / ORDER-FLOW CHECKS
-- =====================================================================
SELECT
    'PKT001 branch' AS check_name,
    COUNT(*)::BIGINT AS result_count
FROM public.branches
WHERE branch_code = 'PKT001'
UNION ALL
SELECT 'orders', COUNT(*)::BIGINT FROM public.orders
UNION ALL
SELECT 'order_items', COUNT(*)::BIGINT FROM public.order_items
UNION ALL
SELECT 'active products linked to PKT001', COUNT(*)::BIGINT
FROM public.products AS p
JOIN public.branch_products AS bp ON bp.product_id = p.id
JOIN public.branches AS b ON b.id = bp.branch_id
WHERE b.branch_code = 'PKT001'
  AND p.is_active IS TRUE
  AND bp.is_available IS TRUE
  AND bp.price > 0;


-- =====================================================================
-- 19. PRE-OPENING CATALOG PREVIEW MODE - PKT001 ONLY
-- =====================================================================
-- Purpose:
--   Show all 40 starter catalogue items in the public LIFF menu for review.
--   The shop has NOT opened, so customer checkout remains disabled.
-- Safety:
--   - Activates the catalogue records only (products.is_active = TRUE).
--   - Keeps every PKT001 branch item unavailable (is_available = FALSE).
--   - Does not change any price.
--   - Does not create orders or permit customer checkout.
--   - Scoped only to starter products with product_code CA-% at PKT001.
-- Re-runnable: safe to run again while the branch remains pre-opening.

BEGIN;

-- Show all starter menu items in the customer catalogue for preview.
UPDATE public.products AS p
SET is_active = TRUE
WHERE p.product_code LIKE 'CA-%'
  AND EXISTS (
      SELECT 1
      FROM public.branch_products AS bp
      JOIN public.branches AS b ON b.id = bp.branch_id
      WHERE bp.product_id = p.id
        AND b.branch_code = 'PKT001'
  );

-- Keep all PKT001 starter items unavailable until the shop officially opens.
UPDATE public.branch_products AS bp
SET is_available = FALSE
FROM public.branches AS b,
     public.products AS p
WHERE bp.branch_id = b.id
  AND bp.product_id = p.id
  AND b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%';

COMMIT;

-- Verify pre-opening state. Expected:
-- visible_catalog_items > 0; orderable_items = 0; no prices changed.
SELECT
    b.branch_code,
    COUNT(*) FILTER (WHERE p.is_active IS TRUE) AS visible_catalog_items,
    COUNT(*) FILTER (
        WHERE p.is_active IS TRUE
          AND bp.is_available IS TRUE
          AND bp.price > 0
    ) AS orderable_items,
    COUNT(*) FILTER (WHERE bp.price <= 0 OR bp.price IS NULL) AS items_missing_price,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE p.is_active IS TRUE
          AND bp.is_available IS TRUE
          AND bp.price > 0
      ) = 0
      THEN 'PRE_OPENING_CHECKOUT_DISABLED'
      ELSE 'WARNING_ORDERABLE_ITEMS_EXIST'
    END AS preopening_status
FROM public.branches AS b
JOIN public.branch_products AS bp ON bp.branch_id = b.id
JOIN public.products AS p ON p.id = bp.product_id
WHERE b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%'
GROUP BY b.branch_code;

-- =====================================================================
-- 20. ENABLE REAL CUSTOMER CHECKOUT FOR PRICED PKT001 CATALOG ITEMS
-- =====================================================================
-- IMPORTANT: This intentionally enables real customer orders for PKT001.
-- Run this Section only when ready to accept live test orders.
-- Scope: starter products CA-% linked to branch PKT001 only.
-- Safety:
--   - Never changes any product price.
--   - Opens only items with an existing price > 0.
--   - Keeps products with NULL/zero/negative price unavailable.
--   - Does not enable products at any other branch.
--   - The LIFF page and create_liff_order RPC both re-check sale status.
-- Re-runnable: safe; it applies the same intended availability state.
-- =====================================================================

BEGIN;

-- 20.1 Activate all PKT001 starter catalogue rows that have a valid price.
UPDATE public.products AS p
SET is_active = TRUE
WHERE p.product_code LIKE 'CA-%'
  AND EXISTS (
      SELECT 1
      FROM public.branch_products AS bp
      JOIN public.branches AS b ON b.id = bp.branch_id
      WHERE bp.product_id = p.id
        AND b.branch_code = 'PKT001'
        AND bp.price IS NOT NULL
        AND bp.price > 0
  );

-- 20.2 Enable sale at PKT001 only when the branch price is greater than zero.
UPDATE public.branch_products AS bp
SET is_available = (bp.price IS NOT NULL AND bp.price > 0)
FROM public.branches AS b,
     public.products AS p
WHERE bp.branch_id = b.id
  AND bp.product_id = p.id
  AND b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%';

COMMIT;

-- 20.3 Summary: orderable_items should equal the number of priced rows.
SELECT
    b.branch_code,
    COUNT(*) FILTER (WHERE p.is_active IS TRUE) AS visible_catalog_items,
    COUNT(*) FILTER (
        WHERE p.is_active IS TRUE
          AND bp.is_available IS TRUE
          AND bp.price > 0
    ) AS orderable_items,
    COUNT(*) FILTER (
        WHERE bp.price IS NULL OR bp.price <= 0
    ) AS items_missing_price,
    COUNT(*) FILTER (
        WHERE bp.is_available IS TRUE
          AND (bp.price IS NULL OR bp.price <= 0)
    ) AS unsafe_open_items,
    CASE
      WHEN COUNT(*) FILTER (
          WHERE p.is_active IS TRUE
            AND bp.is_available IS TRUE
            AND bp.price > 0
      ) > 0
       AND COUNT(*) FILTER (
          WHERE bp.is_available IS TRUE
            AND (bp.price IS NULL OR bp.price <= 0)
      ) = 0
      THEN 'LIVE_TEST_CHECKOUT_ENABLED_FOR_PRICED_ITEMS'
      ELSE 'REVIEW_REQUIRED'
    END AS checkout_status
FROM public.branches AS b
JOIN public.branch_products AS bp ON bp.branch_id = b.id
JOIN public.products AS p ON p.id = bp.product_id
WHERE b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%'
GROUP BY b.branch_code;

-- 20.4 List any products that remain disabled because a price is missing.
SELECT
    p.product_code,
    p.product_name,
    bp.price,
    bp.is_available
FROM public.branches AS b
JOIN public.branch_products AS bp ON bp.branch_id = b.id
JOIN public.products AS p ON p.id = bp.product_id
WHERE b.branch_code = 'PKT001'
  AND p.product_code LIKE 'CA-%'
  AND (bp.price IS NULL OR bp.price <= 0)
ORDER BY p.product_code;

-- 20.5 ROLLBACK / CLOSE CHECKOUT (run manually only when you want to stop orders):
-- BEGIN;
-- UPDATE public.branch_products AS bp
-- SET is_available = FALSE
-- FROM public.branches AS b, public.products AS p
-- WHERE bp.branch_id = b.id
--   AND bp.product_id = p.id
--   AND b.branch_code = 'PKT001'
--   AND p.product_code LIKE 'CA-%';
-- COMMIT;


-- =====================================================================
-- 21. FIX ORDER REQUEST IDEMPOTENCY INDEX FOR create_liff_order
-- =====================================================================
-- Root cause addressed:
--   create_liff_order uses:
--     INSERT ... ON CONFLICT (client_request_id) DO NOTHING
--   The earlier index idx_orders_client_request_id was PARTIAL
--   (WHERE client_request_id IS NOT NULL). PostgreSQL cannot infer that
--   partial index from an ON CONFLICT target without a matching predicate.
--
-- Fix:
--   Add a normal UNIQUE index on client_request_id. PostgreSQL UNIQUE
--   indexes permit multiple NULL values, so existing legacy orders remain
--   valid. The existing partial index is retained; it is harmless.
--
-- Scope:
--   Does not change orders, order_items, prices, products or availability.
--   Does not create or modify any customer order.
-- Re-runnable: safe to run more than once.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_id_full
    ON public.orders (client_request_id);

COMMIT;

-- 21.1 Verify both indexes and confirm the full index is non-partial.
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND indexname IN (
      'idx_orders_client_request_id',
      'idx_orders_client_request_id_full'
  )
ORDER BY indexname;

-- Expected:
-- idx_orders_client_request_id_full has no WHERE clause.
-- This lets ON CONFLICT (client_request_id) infer a valid unique index.


-- =====================================================================
-- 22. ONE-CLICK STAFF ORDER FLOW + CUSTOMER STATUS TIMELINE
-- =====================================================================
-- Purpose:
--   Simplify pickup orders to three staff actions:
--     pending/confirmed -> preparing -> ready -> completed
--   Store every status transition and expose a private, LINE-verified
--   status timeline to the customer through get_liff_orders().
--
-- Security:
--   - Staff status changes still require an authenticated super_admin/manager.
--   - Staff may only update orders in their permitted branch scope.
--   - Customers cannot read this table through the Data API.
--   - Customer tracking uses service_role only after LINE ID token verification
--     in the my-orders Edge Function.
--
-- This section does not change product prices or product availability.
-- Re-runnable.

BEGIN;

-- 22.1 Immutable status-history table.
CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL
        REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL
        CHECK (new_status IN (
            'pending','confirmed','preparing','ready',
            'on_the_way','arrived','completed','cancelled'
        )),
    actor_type TEXT NOT NULL DEFAULT 'system'
        CHECK (actor_type IN ('system','staff')),
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created
    ON public.order_status_history(order_id, created_at, id);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.order_status_history TO authenticated;

DROP POLICY IF EXISTS liff_admin_order_status_history_read
    ON public.order_status_history;
CREATE POLICY liff_admin_order_status_history_read
ON public.order_status_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.orders AS o
        WHERE o.id = order_status_history.order_id
    )
);

-- 22.2 Capture initial status when a new order is created.
CREATE OR REPLACE FUNCTION public.log_initial_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, actor_type, note
    )
    VALUES (
        NEW.id, NULL, NEW.order_status, 'system', 'สร้างคำสั่งซื้อ'
    );
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_initial_order_status()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_initial_status_history
    ON public.orders;
CREATE TRIGGER trg_orders_initial_status_history
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_initial_order_status();

-- Backfill a starting event for any orders created before this section.
INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, actor_type, note
)
SELECT
    o.id, NULL, o.order_status, 'system', 'เริ่มบันทึกประวัติสถานะ'
FROM public.orders AS o
WHERE NOT EXISTS (
    SELECT 1
    FROM public.order_status_history AS h
    WHERE h.order_id = o.id
);

-- 22.3 Replace status RPC with a one-click-friendly transition:
-- pending -> preparing, preparing -> ready, ready -> completed.
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role TEXT;
    v_staff_branch_id UUID;
    v_order_number TEXT;
    v_current_status TEXT;
    v_order_branch_id UUID;
    v_customer_name TEXT;
    v_line_user_id TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    v_role := private.current_staff_role();
    v_staff_branch_id := private.current_staff_branch_id();

    IF COALESCE(v_role, '') NOT IN ('super_admin', 'manager') THEN
        RAISE EXCEPTION 'only super_admin or manager can update order status';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'order_id is required';
    END IF;

    IF p_new_status NOT IN (
        'confirmed', 'preparing', 'ready', 'on_the_way',
        'arrived', 'completed', 'cancelled'
    ) THEN
        RAISE EXCEPTION 'unsupported order status';
    END IF;

    SELECT
        o.order_number,
        o.order_status,
        o.branch_id,
        c.customer_name,
        c.line_user_id
    INTO
        v_order_number,
        v_current_status,
        v_order_branch_id,
        v_customer_name,
        v_line_user_id
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.id = p_order_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found';
    END IF;

    IF v_role = 'manager' AND v_order_branch_id <> v_staff_branch_id THEN
        RAISE EXCEPTION 'manager cannot update an order outside their branch';
    END IF;

    IF NOT (
        (v_current_status = 'pending' AND p_new_status IN ('confirmed', 'preparing', 'cancelled'))
        OR (v_current_status = 'confirmed' AND p_new_status IN ('preparing', 'cancelled'))
        OR (v_current_status = 'preparing' AND p_new_status IN ('ready', 'cancelled'))
        OR (v_current_status = 'ready' AND p_new_status IN ('completed', 'on_the_way', 'cancelled'))
        OR (v_current_status = 'on_the_way' AND p_new_status IN ('arrived', 'cancelled'))
        OR (v_current_status = 'arrived' AND p_new_status = 'completed')
    ) THEN
        RAISE EXCEPTION 'invalid status transition: % -> %', v_current_status, p_new_status;
    END IF;

    UPDATE public.orders
       SET order_status = p_new_status,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id
     RETURNING updated_at INTO v_updated_at;

    INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, actor_type, changed_by, note
    )
    VALUES (
        p_order_id,
        v_current_status,
        p_new_status,
        'staff',
        auth.uid(),
        CASE p_new_status
            WHEN 'preparing' THEN 'พนักงานรับออเดอร์และเริ่มเตรียม'
            WHEN 'ready' THEN 'สินค้าเตรียมเสร็จ พร้อมรับ'
            WHEN 'completed' THEN 'ส่งมอบสินค้าให้ลูกค้าแล้ว'
            WHEN 'cancelled' THEN 'ยกเลิกคำสั่งซื้อ'
            WHEN 'on_the_way' THEN 'เริ่มจัดส่ง'
            WHEN 'arrived' THEN 'จัดส่งถึงจุดหมาย'
            WHEN 'confirmed' THEN 'ร้านยืนยันคำสั่งซื้อ'
            ELSE 'อัปเดตสถานะคำสั่งซื้อ'
        END
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'previous_status', v_current_status,
        'order_status', p_new_status,
        'customer_name', v_customer_name,
        'line_user_id', v_line_user_id,
        'updated_at', v_updated_at
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT)
    TO authenticated;

-- 22.4 Return status history only to the Edge Function after LINE token verification.
CREATE OR REPLACE FUNCTION public.get_liff_orders(
    p_line_user_id TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    )
    INTO v_orders
    FROM (
        SELECT
            o.created_at,
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
                    SELECT COALESCE(
                        pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'product_name', oi.product_name,
                                'quantity', oi.quantity,
                                'unit_price', oi.unit_price,
                                'subtotal', oi.subtotal,
                                'selected_options', oi.selected_options
                            ) ORDER BY oi.id
                        ),
                        '[]'::JSONB
                    )
                    FROM public.order_items AS oi
                    WHERE oi.order_id = o.id
                ),
                'status_history', (
                    SELECT COALESCE(
                        pg_catalog.jsonb_agg(
                            pg_catalog.jsonb_build_object(
                                'previous_status', h.previous_status,
                                'new_status', h.new_status,
                                'actor_type', h.actor_type,
                                'note', h.note,
                                'created_at', h.created_at
                            ) ORDER BY h.created_at, h.id
                        ),
                        '[]'::JSONB
                    )
                    FROM public.order_status_history AS h
                    WHERE h.order_id = o.id
                )
            ) AS order_data
        FROM public.orders AS o
        JOIN public.customers AS c ON c.id = o.customer_id
        WHERE c.line_user_id = pg_catalog.btrim(p_line_user_id)
        ORDER BY o.created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 20))
    ) AS result;

    RETURN COALESCE(v_orders, '[]'::JSONB);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    TO service_role;

COMMIT;

-- 22.5 Verification
SELECT
    'order_status_history' AS object_name,
    COUNT(*)::BIGINT AS total_events
FROM public.order_status_history
UNION ALL
SELECT
    'orders_with_history',
    COUNT(DISTINCT order_id)::BIGINT
FROM public.order_status_history;

SELECT routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name IN ('update_order_status', 'get_liff_orders', 'log_initial_order_status')
ORDER BY routine_name;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname = 'liff_admin_order_status_history_read';


-- =====================================================================
-- 23. SIMPLE STAFF ACCESS + CUSTOMER LOCATION SHARING / LIVE DASHBOARD
-- =====================================================================
-- STAFF ACCESS MODEL
--   - No manager/staff/super_admin role tiers for order operations.
--   - Any ACTIVE employee linked to public.staff can use the same
--     one-click status actions within their assigned branch.
--   - A valid Supabase Auth session is still required to protect customer
--     names, phone numbers, order contents and location data.
--   - No public/anon access is granted to the staff dashboard data.
--
-- CUSTOMER LOCATION MODEL
--   - Customer must explicitly tap Share location in the LIFF tracking page.
--   - LINE ID token is verified by share-customer-location Edge Function.
--   - Only the verified LINE owner of the order can start/update/stop sharing.
--   - Coordinates are sent while the LIFF page remains open and location is
--     permitted by the device. Customer can stop sharing at any time.
--   - Staff dashboard sees the latest position and its timestamp/accuracy.
--   - This is not background GPS tracking; no silent tracking is performed.
--
-- Does not change prices, product availability or existing order totals.
-- Re-runnable.
-- =====================================================================

BEGIN;

-- 23.1 Customer location session (one current sharing state per order).
CREATE TABLE IF NOT EXISTS public.customer_location_shares (
    order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    line_user_id TEXT NOT NULL,
    is_sharing BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    last_latitude DOUBLE PRECISION,
    last_longitude DOUBLE PRECISION,
    accuracy_m DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_location_shares_coordinates_check CHECK (
        (last_latitude IS NULL AND last_longitude IS NULL)
        OR (last_latitude BETWEEN -90 AND 90 AND last_longitude BETWEEN -180 AND 180)
    )
);

ALTER TABLE public.customer_locations
    ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_customer_locations_order_latest
    ON public.customer_locations(order_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_location_shares_active_updated
    ON public.customer_location_shares(is_sharing, updated_at DESC);

ALTER TABLE public.customer_location_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_locations ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE
    public.orders,
    public.order_items,
    public.customers,
    public.order_status_history,
    public.customer_locations,
    public.customer_location_shares
TO authenticated;

-- 23.2 All signed-in employees have the same dashboard access.
--      This replaces the prior role/branch-specific order read gate.
DROP POLICY IF EXISTS liff_admin_orders_read ON public.orders;
DROP POLICY IF EXISTS liff_staff_orders_read_all ON public.orders;
CREATE POLICY liff_staff_orders_read_all
ON public.orders FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND branch_id = private.current_staff_branch_id()
);

DROP POLICY IF EXISTS liff_admin_order_items_read ON public.order_items;
DROP POLICY IF EXISTS liff_staff_order_items_read_all ON public.order_items;
CREATE POLICY liff_staff_order_items_read_all
ON public.order_items FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = order_items.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_admin_customers_read ON public.customers;
DROP POLICY IF EXISTS liff_staff_customers_read_all ON public.customers;
CREATE POLICY liff_staff_customers_read_all
ON public.customers FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.customer_id = customers.id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_admin_order_status_history_read
    ON public.order_status_history;
DROP POLICY IF EXISTS liff_staff_order_status_history_read_all
    ON public.order_status_history;
CREATE POLICY liff_staff_order_status_history_read_all
ON public.order_status_history FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = order_status_history.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_staff_customer_locations_read_all
    ON public.customer_locations;
CREATE POLICY liff_staff_customer_locations_read_all
ON public.customer_locations FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = customer_locations.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_staff_location_shares_read_all
    ON public.customer_location_shares;
CREATE POLICY liff_staff_location_shares_read_all
ON public.customer_location_shares FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = customer_location_shares.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

-- 23.3 One-click order status RPC: any authenticated employee may act.
--      Legal transitions stay enforced in the database.
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_order_number TEXT;
    v_current_status TEXT;
    v_customer_name TEXT;
    v_line_user_id TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT private.is_active_staff() THEN
        RAISE EXCEPTION 'active staff session required';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'order_id is required';
    END IF;

    IF p_new_status NOT IN (
        'confirmed', 'preparing', 'ready', 'on_the_way',
        'arrived', 'completed', 'cancelled'
    ) THEN
        RAISE EXCEPTION 'unsupported order status';
    END IF;

    SELECT o.order_number, o.order_status, c.customer_name, c.line_user_id
      INTO v_order_number, v_current_status, v_customer_name, v_line_user_id
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.id = p_order_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found';
    END IF;

    IF NOT (
        (v_current_status = 'pending' AND p_new_status IN ('confirmed','preparing','cancelled'))
        OR (v_current_status = 'confirmed' AND p_new_status IN ('preparing','cancelled'))
        OR (v_current_status = 'preparing' AND p_new_status IN ('ready','cancelled'))
        OR (v_current_status = 'ready' AND p_new_status IN ('completed','on_the_way','cancelled'))
        OR (v_current_status = 'on_the_way' AND p_new_status IN ('arrived','cancelled'))
        OR (v_current_status = 'arrived' AND p_new_status = 'completed')
    ) THEN
        RAISE EXCEPTION 'invalid status transition: % -> %', v_current_status, p_new_status;
    END IF;

    UPDATE public.orders
       SET order_status = p_new_status,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id
     RETURNING updated_at INTO v_updated_at;

    INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, actor_type, changed_by, note
    ) VALUES (
        p_order_id, v_current_status, p_new_status, 'staff', auth.uid(),
        CASE p_new_status
            WHEN 'preparing' THEN 'พนักงานรับออเดอร์และเริ่มเตรียม'
            WHEN 'ready' THEN 'สินค้าเตรียมเสร็จ พร้อมรับ'
            WHEN 'completed' THEN 'ส่งมอบสินค้าให้ลูกค้าแล้ว'
            WHEN 'cancelled' THEN 'ยกเลิกคำสั่งซื้อ'
            WHEN 'on_the_way' THEN 'เริ่มจัดส่ง'
            WHEN 'arrived' THEN 'จัดส่งถึงจุดหมาย'
            WHEN 'confirmed' THEN 'ร้านยืนยันคำสั่งซื้อ'
            ELSE 'อัปเดตสถานะคำสั่งซื้อ'
        END
    );

    -- Automatically end customer sharing after an order is closed/cancelled.
    IF p_new_status IN ('completed','cancelled') THEN
        UPDATE public.customer_location_shares
           SET is_sharing = FALSE,
               stopped_at = COALESCE(stopped_at, pg_catalog.now()),
               updated_at = pg_catalog.now()
         WHERE order_id = p_order_id AND is_sharing = TRUE;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'previous_status', v_current_status,
        'order_status', p_new_status,
        'customer_name', v_customer_name,
        'line_user_id', v_line_user_id,
        'updated_at', v_updated_at
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT)
    TO authenticated;

-- 23.4 Store a customer location only after server-side LINE identity check.
CREATE OR REPLACE FUNCTION public.record_liff_customer_location(
    p_line_user_id TEXT,
    p_order_id UUID,
    p_action TEXT,
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

REVOKE ALL ON FUNCTION public.record_liff_customer_location(
    TEXT, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_liff_customer_location(
    TEXT, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO service_role;

-- 23.5 Extend customer tracking response with the customer's own share state.
CREATE OR REPLACE FUNCTION public.get_liff_orders(
    p_line_user_id TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
        ORDER BY o.created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 20))
    ) AS result;

    RETURN COALESCE(v_orders, '[]'::JSONB);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_liff_orders(TEXT, INTEGER)
    TO service_role;

COMMIT;

-- 23.6 Verification
SELECT
    'location_sharing_sessions' AS check_name,
    COUNT(*)::BIGINT AS result_count
FROM public.customer_location_shares
UNION ALL
SELECT 'location_accuracy_column', COUNT(*)::BIGINT
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'customer_locations'
  AND column_name = 'accuracy_m'
UNION ALL
SELECT 'authenticated_dashboard_read_policies', COUNT(*)::BIGINT
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
      'liff_staff_orders_read_all',
      'liff_staff_order_items_read_all',
      'liff_staff_customers_read_all',
      'liff_staff_order_status_history_read_all',
      'liff_staff_customer_locations_read_all',
      'liff_staff_location_shares_read_all'
  );

SELECT routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name IN (
      'update_order_status',
      'get_liff_orders',
      'record_liff_customer_location'
  )
ORDER BY routine_name;
-- =====================================================================
-- SECTION 24. LIVE ORDER DASHBOARD - STAFF SCOPE + REALTIME + ONE-CLICK
-- Apply this section from the single Master SQL file after Sections 1-23.
--
-- Access:
--   - Requires Supabase Auth AND an active row in public.staff.
--   - All active staff have the same order-action capability.
--   - No manager / staff / super_admin privilege differences for orders.
--   - Staff data is restricted to the branch assigned on public.staff.
--   - No anon/public access to orders, customer PII or customer GPS.
--
-- Order flow:
--   pending -> confirmed -> preparing -> ready -> completed
--   Optional legacy delivery flow remains available:
--   ready -> on_the_way -> arrived -> completed
--
-- Realtime tables: orders + customer_location_shares.
-- =====================================================================

BEGIN;

-- 24.1 Ensure authenticated staff can SELECT the dashboard data.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.orders, public.order_items, public.customers,
    public.order_status_history, public.customer_locations,
    public.customer_location_shares, public.staff, public.branches
TO authenticated;

REVOKE ALL ON public.orders, public.order_items, public.customers,
    public.order_status_history, public.customer_locations,
    public.customer_location_shares
FROM anon;

-- 24.2 Order visibility: active staff only, assigned branch only.
DROP POLICY IF EXISTS liff_admin_orders_read ON public.orders;
DROP POLICY IF EXISTS liff_staff_orders_read_all ON public.orders;
DROP POLICY IF EXISTS ca_staff_orders_branch_read ON public.orders;
CREATE POLICY ca_staff_orders_branch_read
ON public.orders FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND branch_id = private.current_staff_branch_id()
);

DROP POLICY IF EXISTS liff_admin_order_items_read ON public.order_items;
DROP POLICY IF EXISTS liff_staff_order_items_read_all ON public.order_items;
DROP POLICY IF EXISTS ca_staff_order_items_branch_read ON public.order_items;
CREATE POLICY ca_staff_order_items_branch_read
ON public.order_items FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = order_items.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_admin_customers_read ON public.customers;
DROP POLICY IF EXISTS liff_staff_customers_read_all ON public.customers;
DROP POLICY IF EXISTS ca_staff_customers_branch_read ON public.customers;
CREATE POLICY ca_staff_customers_branch_read
ON public.customers FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.customer_id = customers.id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_admin_order_status_history_read ON public.order_status_history;
DROP POLICY IF EXISTS liff_staff_order_status_history_read_all ON public.order_status_history;
DROP POLICY IF EXISTS ca_staff_order_history_branch_read ON public.order_status_history;
CREATE POLICY ca_staff_order_history_branch_read
ON public.order_status_history FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = order_status_history.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_staff_customer_locations_read_all ON public.customer_locations;
DROP POLICY IF EXISTS ca_staff_customer_locations_branch_read ON public.customer_locations;
CREATE POLICY ca_staff_customer_locations_branch_read
ON public.customer_locations FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = customer_locations.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

DROP POLICY IF EXISTS liff_staff_location_shares_read_all ON public.customer_location_shares;
DROP POLICY IF EXISTS ca_staff_location_shares_branch_read ON public.customer_location_shares;
CREATE POLICY ca_staff_location_shares_branch_read
ON public.customer_location_shares FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = customer_location_shares.order_id
          AND o.branch_id = private.current_staff_branch_id()
    )
);

-- 24.3 Replace role-tiered order RPC with one common active-staff flow.
CREATE OR REPLACE FUNCTION public.update_order_status(
    p_order_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_branch_id UUID;
    v_order_number TEXT;
    v_current_status TEXT;
    v_customer_name TEXT;
    v_line_user_id TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT private.is_active_staff() THEN
        RAISE EXCEPTION 'active staff session required';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'order_id is required';
    END IF;

    IF p_new_status NOT IN (
        'confirmed', 'preparing', 'ready', 'on_the_way',
        'arrived', 'completed', 'cancelled'
    ) THEN
        RAISE EXCEPTION 'unsupported order status';
    END IF;

    v_branch_id := private.current_staff_branch_id();
    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'staff branch is not configured';
    END IF;

    SELECT o.order_number, o.order_status, c.customer_name, c.line_user_id
      INTO v_order_number, v_current_status, v_customer_name, v_line_user_id
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE o.id = p_order_id
      AND o.branch_id = v_branch_id
    FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found in assigned branch';
    END IF;

    IF NOT (
        (v_current_status = 'pending' AND p_new_status IN ('confirmed','cancelled'))
        OR (v_current_status = 'confirmed' AND p_new_status IN ('preparing','cancelled'))
        OR (v_current_status = 'preparing' AND p_new_status IN ('ready','cancelled'))
        OR (v_current_status = 'ready' AND p_new_status IN ('completed','on_the_way','cancelled'))
        OR (v_current_status = 'on_the_way' AND p_new_status IN ('arrived','cancelled'))
        OR (v_current_status = 'arrived' AND p_new_status = 'completed')
    ) THEN
        RAISE EXCEPTION 'invalid status transition: % -> %', v_current_status, p_new_status;
    END IF;

    UPDATE public.orders
       SET order_status = p_new_status,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id
     RETURNING updated_at INTO v_updated_at;

    INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, actor_type, changed_by, note
    ) VALUES (
        p_order_id, v_current_status, p_new_status, 'staff', auth.uid(),
        CASE p_new_status
            WHEN 'confirmed' THEN 'พนักงานยืนยันออเดอร์'
            WHEN 'preparing' THEN 'พนักงานเริ่มเตรียมสินค้า'
            WHEN 'ready' THEN 'เตรียมสินค้าเสร็จ พร้อมรับ'
            WHEN 'completed' THEN 'ส่งมอบสินค้าแล้ว'
            WHEN 'cancelled' THEN 'ยกเลิกคำสั่งซื้อ'
            WHEN 'on_the_way' THEN 'เริ่มจัดส่ง'
            WHEN 'arrived' THEN 'ถึงจุดหมายแล้ว'
            ELSE 'อัปเดตสถานะคำสั่งซื้อ'
        END
    );

    IF p_new_status IN ('completed','cancelled') THEN
        UPDATE public.customer_location_shares
           SET is_sharing = FALSE,
               stopped_at = COALESCE(stopped_at, pg_catalog.now()),
               updated_at = pg_catalog.now()
         WHERE order_id = p_order_id AND is_sharing = TRUE;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'previous_status', v_current_status,
        'order_status', p_new_status,
        'customer_name', v_customer_name,
        'line_user_id', v_line_user_id,
        'updated_at', v_updated_at
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT) TO authenticated;

-- 24.4 Enable Postgres Changes for the live monitor (safe to rerun).
DO $realtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public' AND tablename = 'orders'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public' AND tablename = 'customer_location_shares'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_location_shares';
        END IF;
    ELSE
        RAISE NOTICE 'supabase_realtime publication not found; enable Realtime publication for orders and customer_location_shares manually.';
    END IF;
END;
$realtime$;

COMMIT;

-- 24.5 Verification checks.
SELECT policyname, tablename
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
      'ca_staff_orders_branch_read',
      'ca_staff_order_items_branch_read',
      'ca_staff_customers_branch_read',
      'ca_staff_order_history_branch_read',
      'ca_staff_customer_locations_branch_read',
      'ca_staff_location_shares_branch_read'
  )
ORDER BY tablename, policyname;

SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('orders','customer_location_shares')
ORDER BY tablename;

SELECT routine_name, security_type
FROM information_schema.routines
WHERE specific_schema = 'public'
  AND routine_name = 'update_order_status';