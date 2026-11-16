-- =============================================================================
-- Migration 0014 — Return restock: partial returns restore stock under RLS
--
-- salesService.processReturn runs entirely from the browser under role-scoped
-- RLS and performs, in order:
--   1. INSERT into returns / return_items   (returns.business_id column needed)
--   2. UPDATE products.quantity             (the restock — checked for 0 rows)
--   3. INSERT into inventory_transactions   (ledger row; needs business_id and
--      must be allowed for sales_rep, who process most returns)
--   4. UPDATE sales_items lines / DELETE fully-returned lines
--      (phase-C: UPDATE manager-only, DELETE super_admin-only → silent 0 rows
--       for every other role)
--   5. UPDATE sales.total_amount            (phase-C excludes sales_rep)
--
-- products was never covered by any role-scoped policy file in this repo, so
-- a hardened live DB has no products UPDATE policy at all — which is exactly
-- the "updates match 0 rows with no error" failure this fixes.
--
-- Requires public.auth_user_role() (shipped by rls_phase_c_remaining.sql).
-- Additive + idempotent: every statement is DROP-then-CREATE / IF NOT EXISTS,
-- so the file converges whether or not phase-C was already applied.
-- Safe to re-run. Run in the Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- ── 1. Columns the return flow writes ─────────────────────────────────────────
ALTER TABLE public.returns                ADD COLUMN IF NOT EXISTS business_id BIGINT;
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS business_id BIGINT;

-- ── 2. products — restock must never match 0 rows ─────────────────────────────
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_role_scoped" ON public.products;
CREATE POLICY "products_select_role_scoped" ON public.products FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','accountant','sales_rep'));

DROP POLICY IF EXISTS "products_update_role_scoped" ON public.products;
CREATE POLICY "products_update_role_scoped" ON public.products FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep'));

-- ── 3. inventory_transactions — sales_rep may write the return ledger row ─────
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_transactions_select_role_scoped" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_select_role_scoped" ON public.inventory_transactions FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep'));

DROP POLICY IF EXISTS "inventory_transactions_insert_role_scoped" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_insert_role_scoped" ON public.inventory_transactions FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep'));

-- ── 4. sales_items — shrink / remove the returned lines ──────────────────────
ALTER TABLE public.sales_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_items_update_role_scoped" ON public.sales_items;
CREATE POLICY "sales_items_update_role_scoped" ON public.sales_items FOR UPDATE TO authenticated
USING (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.sold_by = auth.uid()))
)
WITH CHECK (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.sold_by = auth.uid()))
);

-- Fully returned lines are deleted from the invoice — phase-C restricted this
-- to super_admin, which made line removal a silent no-op for everyone else.
DROP POLICY IF EXISTS "sales_items_delete_super_admin" ON public.sales_items;
DROP POLICY IF EXISTS "sales_items_delete_role_scoped" ON public.sales_items;
CREATE POLICY "sales_items_delete_role_scoped" ON public.sales_items FOR DELETE TO authenticated
USING (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.sold_by = auth.uid()))
);

-- ── 5. sales — invoice total after a partial return ───────────────────────────
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_update_role_scoped" ON public.sales;
CREATE POLICY "sales_update_role_scoped" ON public.sales FOR UPDATE TO authenticated
USING (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND sold_by = auth.uid())
)
WITH CHECK (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND sold_by = auth.uid())
);

-- ── 6. returns / return_items — recreate the phase-C shapes verbatim ──────────
-- (converges environments that never applied rls_phase_c_remaining.sql; when
--  phase-C was already applied these are the same policies, re-created.)
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all"              ON public.returns;
DROP POLICY IF EXISTS "auth_write"                 ON public.returns;
DROP POLICY IF EXISTS "returns_select_role_scoped" ON public.returns;
DROP POLICY IF EXISTS "returns_insert_role_scoped" ON public.returns;
DROP POLICY IF EXISTS "returns_update_role_scoped" ON public.returns;
DROP POLICY IF EXISTS "returns_delete_super_admin" ON public.returns;
CREATE POLICY "returns_select_role_scoped" ON public.returns FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep','accountant'));
CREATE POLICY "returns_insert_role_scoped" ON public.returns FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "returns_update_role_scoped" ON public.returns FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "returns_delete_super_admin" ON public.returns FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all"                   ON public.return_items;
DROP POLICY IF EXISTS "auth_write"                      ON public.return_items;
DROP POLICY IF EXISTS "return_items_select_role_scoped" ON public.return_items;
DROP POLICY IF EXISTS "return_items_insert_role_scoped" ON public.return_items;
DROP POLICY IF EXISTS "return_items_update_role_scoped" ON public.return_items;
DROP POLICY IF EXISTS "return_items_delete_super_admin" ON public.return_items;
CREATE POLICY "return_items_select_role_scoped" ON public.return_items FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep','accountant'));
CREATE POLICY "return_items_insert_role_scoped" ON public.return_items FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "return_items_update_role_scoped" ON public.return_items FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "return_items_delete_super_admin" ON public.return_items FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('products','inventory_transactions','sales','sales_items','returns','return_items')
-- ORDER BY tablename, policyname;
