-- migrations/0002_purchase_orders_rls.sql

BEGIN;

-- Update purchases RLS to allow branch_manager and inventory_manager
DROP POLICY IF EXISTS "purchases_select_role_scoped" ON public.purchases;
CREATE POLICY "purchases_select_role_scoped" ON public.purchases FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));

DROP POLICY IF EXISTS "purchases_insert_role_scoped" ON public.purchases;
CREATE POLICY "purchases_insert_role_scoped" ON public.purchases FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));

DROP POLICY IF EXISTS "purchases_update_role_scoped" ON public.purchases;
CREATE POLICY "purchases_update_role_scoped" ON public.purchases FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));

-- Update purchase_order_status_history RLS
DROP POLICY IF EXISTS "po_status_history_select_role_scoped" ON public.purchase_order_status_history;
CREATE POLICY "po_status_history_select_role_scoped" ON public.purchase_order_status_history
FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin', 'general_manager', 'branch_manager', 'inventory_manager'));

DROP POLICY IF EXISTS "po_status_history_insert_role_scoped" ON public.purchase_order_status_history;
CREATE POLICY "po_status_history_insert_role_scoped" ON public.purchase_order_status_history
FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin', 'general_manager', 'branch_manager', 'inventory_manager'));

COMMIT;
