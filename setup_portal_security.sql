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
