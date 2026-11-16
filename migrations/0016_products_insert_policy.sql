-- =============================================================================
-- Migration 0016 — products: allow inventory-managing roles to INSERT
--
-- Symptom: "Add Product" fails with a row-level security error.
--
-- `products` was never covered by a role-scoped write policy in this repo.
-- 0014_return_restock.sql added SELECT + UPDATE (so restocking during a return
-- works), but there is no INSERT policy. On a hardened database — where the
-- legacy `auth_write` FOR ALL policy was dropped — every new product is rejected.
--
-- The roles below mirror permission P.MANAGE_INVENTORY in src/utils/permissions.js
-- (super_admin, general_manager, branch_manager, inventory_manager). sales_rep and
-- accountant can view stock but must not create catalogue rows.
--
-- Requires public.auth_user_role() (shipped by rls_phase_c_remaining.sql).
-- Idempotent: DROP-then-CREATE, safe to re-run in the Supabase SQL Editor.
-- =============================================================================

BEGIN;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_insert_role_scoped" ON public.products;
CREATE POLICY "products_insert_role_scoped" ON public.products FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'products'
-- ORDER BY policyname;
