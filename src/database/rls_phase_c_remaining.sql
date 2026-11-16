-- Forgera RLS Phase C remaining rollout.
-- Production caution: run section-by-section in Supabase SQL Editor.
-- Assumes public.auth_user_role(), users role CHECK, and users role-change trigger exist.

-- 00_inventory_transactions
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.inventory_transactions;
DROP POLICY IF EXISTS "auth_write" ON public.inventory_transactions;
DROP POLICY IF EXISTS "auth_all_inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "inventory_transactions_select_role_scoped" ON public.inventory_transactions;
DROP POLICY IF EXISTS "inventory_transactions_insert_role_scoped" ON public.inventory_transactions;
DROP POLICY IF EXISTS "inventory_transactions_update_role_scoped" ON public.inventory_transactions;
DROP POLICY IF EXISTS "inventory_transactions_delete_super_admin" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_select_role_scoped" ON public.inventory_transactions FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "inventory_transactions_insert_role_scoped" ON public.inventory_transactions FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "inventory_transactions_update_role_scoped" ON public.inventory_transactions FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "inventory_transactions_delete_super_admin" ON public.inventory_transactions FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 01_sales
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.sales;
DROP POLICY IF EXISTS "auth_write" ON public.sales;
DROP POLICY IF EXISTS "auth_all_sales" ON public.sales;
DROP POLICY IF EXISTS "sales_select_role_scoped" ON public.sales;
DROP POLICY IF EXISTS "sales_insert_role_scoped" ON public.sales;
DROP POLICY IF EXISTS "sales_update_role_scoped" ON public.sales;
DROP POLICY IF EXISTS "sales_delete_super_admin" ON public.sales;
CREATE POLICY "sales_select_role_scoped" ON public.sales FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','accountant') OR (public.auth_user_role() = 'sales_rep' AND sold_by = auth.uid()));
CREATE POLICY "sales_insert_role_scoped" ON public.sales FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager') OR (public.auth_user_role() = 'sales_rep' AND sold_by = auth.uid()));
CREATE POLICY "sales_update_role_scoped" ON public.sales FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager'));
CREATE POLICY "sales_delete_super_admin" ON public.sales FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 02_sales_items
ALTER TABLE public.sales_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.sales_items;
DROP POLICY IF EXISTS "auth_write" ON public.sales_items;
DROP POLICY IF EXISTS "auth_all_sales_items" ON public.sales_items;
DROP POLICY IF EXISTS "sales_items_select_role_scoped" ON public.sales_items;
DROP POLICY IF EXISTS "sales_items_insert_role_scoped" ON public.sales_items;
DROP POLICY IF EXISTS "sales_items_update_role_scoped" ON public.sales_items;
DROP POLICY IF EXISTS "sales_items_delete_super_admin" ON public.sales_items;
CREATE POLICY "sales_items_select_role_scoped" ON public.sales_items FOR SELECT TO authenticated
USING (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','accountant')
  OR (public.auth_user_role() = 'sales_rep' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.sold_by = auth.uid()))
);
CREATE POLICY "sales_items_insert_role_scoped" ON public.sales_items FOR INSERT TO authenticated
WITH CHECK (
  public.auth_user_role() IN ('super_admin','general_manager','branch_manager')
  OR (public.auth_user_role() = 'sales_rep' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.sold_by = auth.uid()))
);
CREATE POLICY "sales_items_update_role_scoped" ON public.sales_items FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager'));
CREATE POLICY "sales_items_delete_super_admin" ON public.sales_items FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 03_purchases
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.purchases;
DROP POLICY IF EXISTS "auth_write" ON public.purchases;
DROP POLICY IF EXISTS "auth_all_purchases" ON public.purchases;
DROP POLICY IF EXISTS "purchases_select_role_scoped" ON public.purchases;
DROP POLICY IF EXISTS "purchases_insert_role_scoped" ON public.purchases;
DROP POLICY IF EXISTS "purchases_update_role_scoped" ON public.purchases;
DROP POLICY IF EXISTS "purchases_delete_super_admin" ON public.purchases;
CREATE POLICY "purchases_select_role_scoped" ON public.purchases FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchases_insert_role_scoped" ON public.purchases FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchases_update_role_scoped" ON public.purchases FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchases_delete_super_admin" ON public.purchases FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 04_purchase_items
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.purchase_items;
DROP POLICY IF EXISTS "auth_write" ON public.purchase_items;
DROP POLICY IF EXISTS "auth_all_purchase_items" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_select_role_scoped" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_insert_role_scoped" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_update_role_scoped" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_delete_super_admin" ON public.purchase_items;
CREATE POLICY "purchase_items_select_role_scoped" ON public.purchase_items FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchase_items_insert_role_scoped" ON public.purchase_items FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchase_items_update_role_scoped" ON public.purchase_items FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "purchase_items_delete_super_admin" ON public.purchase_items FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 05_alerts
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_all" ON public.alerts;
DROP POLICY IF EXISTS "auth_write" ON public.alerts;
DROP POLICY IF EXISTS "auth_all_alerts" ON public.alerts;
DROP POLICY IF EXISTS "alerts_select_role_scoped" ON public.alerts;
DROP POLICY IF EXISTS "alerts_insert_role_scoped" ON public.alerts;
DROP POLICY IF EXISTS "alerts_update_role_scoped" ON public.alerts;
DROP POLICY IF EXISTS "alerts_delete_super_admin" ON public.alerts;
CREATE POLICY "alerts_select_role_scoped" ON public.alerts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep','accountant'));
CREATE POLICY "alerts_insert_role_scoped" ON public.alerts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "alerts_update_role_scoped" ON public.alerts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "alerts_delete_super_admin" ON public.alerts FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 06_locations
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_locations" ON public.locations;
DROP POLICY IF EXISTS "locations_select_role_scoped" ON public.locations;
DROP POLICY IF EXISTS "locations_insert_role_scoped" ON public.locations;
DROP POLICY IF EXISTS "locations_update_role_scoped" ON public.locations;
DROP POLICY IF EXISTS "locations_delete_super_admin" ON public.locations;
CREATE POLICY "locations_select_role_scoped" ON public.locations FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep','accountant'));
CREATE POLICY "locations_insert_role_scoped" ON public.locations FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "locations_update_role_scoped" ON public.locations FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "locations_delete_super_admin" ON public.locations FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 07_location_stock
ALTER TABLE public.location_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_location_stock" ON public.location_stock;
DROP POLICY IF EXISTS "location_stock_select_role_scoped" ON public.location_stock;
DROP POLICY IF EXISTS "location_stock_insert_role_scoped" ON public.location_stock;
DROP POLICY IF EXISTS "location_stock_update_role_scoped" ON public.location_stock;
DROP POLICY IF EXISTS "location_stock_delete_super_admin" ON public.location_stock;
CREATE POLICY "location_stock_select_role_scoped" ON public.location_stock FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager','sales_rep'));
CREATE POLICY "location_stock_insert_role_scoped" ON public.location_stock FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "location_stock_update_role_scoped" ON public.location_stock FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "location_stock_delete_super_admin" ON public.location_stock FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 08_stock_transfers
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_stock_transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfers_select_role_scoped" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfers_insert_role_scoped" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfers_update_role_scoped" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfers_delete_super_admin" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select_role_scoped" ON public.stock_transfers FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfers_insert_role_scoped" ON public.stock_transfers FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfers_update_role_scoped" ON public.stock_transfers FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfers_delete_super_admin" ON public.stock_transfers FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 09_stock_transfer_items
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_stock_transfer_items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "stock_transfer_items_select_role_scoped" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "stock_transfer_items_insert_role_scoped" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "stock_transfer_items_update_role_scoped" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "stock_transfer_items_delete_super_admin" ON public.stock_transfer_items;
CREATE POLICY "stock_transfer_items_select_role_scoped" ON public.stock_transfer_items FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfer_items_insert_role_scoped" ON public.stock_transfer_items FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfer_items_update_role_scoped" ON public.stock_transfer_items FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','inventory_manager'));
CREATE POLICY "stock_transfer_items_delete_super_admin" ON public.stock_transfer_items FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 10_customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_customers" ON public.customers;
DROP POLICY IF EXISTS "customers_select_role_scoped" ON public.customers;
DROP POLICY IF EXISTS "customers_insert_role_scoped" ON public.customers;
DROP POLICY IF EXISTS "customers_update_role_scoped" ON public.customers;
DROP POLICY IF EXISTS "customers_delete_super_admin" ON public.customers;
CREATE POLICY "customers_select_role_scoped" ON public.customers FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep','accountant'));
CREATE POLICY "customers_insert_role_scoped" ON public.customers FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager'));
-- Sales reps are deliberately excluded from direct customer UPDATE.
-- Credit-sale balance changes for sales reps must go through
-- public.create_sale_with_side_effects(p_sale_id), whose SECURITY DEFINER body
-- enforces the allowed operation and own-sale check before updating customers.
CREATE POLICY "customers_update_role_scoped" ON public.customers FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "customers_delete_super_admin" ON public.customers FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 11_customer_payments
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_customer_payments" ON public.customer_payments;
DROP POLICY IF EXISTS "customer_payments_select_role_scoped" ON public.customer_payments;
DROP POLICY IF EXISTS "customer_payments_insert_role_scoped" ON public.customer_payments;
DROP POLICY IF EXISTS "customer_payments_update_role_scoped" ON public.customer_payments;
DROP POLICY IF EXISTS "customer_payments_delete_super_admin" ON public.customer_payments;
CREATE POLICY "customer_payments_select_role_scoped" ON public.customer_payments FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep','accountant'));
CREATE POLICY "customer_payments_insert_role_scoped" ON public.customer_payments FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "customer_payments_update_role_scoped" ON public.customer_payments FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "customer_payments_delete_super_admin" ON public.customer_payments FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 12_price_tiers
ALTER TABLE public.price_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_price_tiers" ON public.price_tiers;
DROP POLICY IF EXISTS "price_tiers_select_role_scoped" ON public.price_tiers;
DROP POLICY IF EXISTS "price_tiers_insert_super_admin" ON public.price_tiers;
DROP POLICY IF EXISTS "price_tiers_update_super_admin" ON public.price_tiers;
DROP POLICY IF EXISTS "price_tiers_delete_super_admin" ON public.price_tiers;
CREATE POLICY "price_tiers_select_role_scoped" ON public.price_tiers FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep','accountant'));
CREATE POLICY "price_tiers_insert_super_admin" ON public.price_tiers FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "price_tiers_update_super_admin" ON public.price_tiers FOR UPDATE TO authenticated
USING (public.auth_user_role() = 'super_admin')
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "price_tiers_delete_super_admin" ON public.price_tiers FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 13_customer_price_overrides
ALTER TABLE public.customer_price_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_customer_price_overrides" ON public.customer_price_overrides;
DROP POLICY IF EXISTS "customer_price_overrides_select_role_scoped" ON public.customer_price_overrides;
DROP POLICY IF EXISTS "customer_price_overrides_insert_super_admin" ON public.customer_price_overrides;
DROP POLICY IF EXISTS "customer_price_overrides_update_super_admin" ON public.customer_price_overrides;
DROP POLICY IF EXISTS "customer_price_overrides_delete_super_admin" ON public.customer_price_overrides;
CREATE POLICY "customer_price_overrides_select_role_scoped" ON public.customer_price_overrides FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "customer_price_overrides_insert_super_admin" ON public.customer_price_overrides FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "customer_price_overrides_update_super_admin" ON public.customer_price_overrides FOR UPDATE TO authenticated
USING (public.auth_user_role() = 'super_admin')
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "customer_price_overrides_delete_super_admin" ON public.customer_price_overrides FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 14_returns
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_returns" ON public.returns;
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

-- 15_return_items
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_return_items" ON public.return_items;
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

-- 16_deliveries
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "deliveries_select_role_scoped" ON public.deliveries;
DROP POLICY IF EXISTS "deliveries_insert_role_scoped" ON public.deliveries;
DROP POLICY IF EXISTS "deliveries_update_role_scoped" ON public.deliveries;
DROP POLICY IF EXISTS "deliveries_delete_super_admin" ON public.deliveries;
CREATE POLICY "deliveries_select_role_scoped" ON public.deliveries FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "deliveries_insert_role_scoped" ON public.deliveries FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "deliveries_update_role_scoped" ON public.deliveries FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "deliveries_delete_super_admin" ON public.deliveries FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 17_quotations
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_quotations" ON public.quotations;
DROP POLICY IF EXISTS "quotations_select_role_scoped" ON public.quotations;
DROP POLICY IF EXISTS "quotations_insert_role_scoped" ON public.quotations;
DROP POLICY IF EXISTS "quotations_update_role_scoped" ON public.quotations;
DROP POLICY IF EXISTS "quotations_delete_super_admin" ON public.quotations;
CREATE POLICY "quotations_select_role_scoped" ON public.quotations FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotations_insert_role_scoped" ON public.quotations FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotations_update_role_scoped" ON public.quotations FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotations_delete_super_admin" ON public.quotations FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 18_quotation_items
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_quotation_items" ON public.quotation_items;
DROP POLICY IF EXISTS "quotation_items_select_role_scoped" ON public.quotation_items;
DROP POLICY IF EXISTS "quotation_items_insert_role_scoped" ON public.quotation_items;
DROP POLICY IF EXISTS "quotation_items_update_role_scoped" ON public.quotation_items;
DROP POLICY IF EXISTS "quotation_items_delete_super_admin" ON public.quotation_items;
CREATE POLICY "quotation_items_select_role_scoped" ON public.quotation_items FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotation_items_insert_role_scoped" ON public.quotation_items FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotation_items_update_role_scoped" ON public.quotation_items FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','sales_rep'));
CREATE POLICY "quotation_items_delete_super_admin" ON public.quotation_items FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 19_dispatch_trips
ALTER TABLE public.dispatch_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dispatch_trips" ON public.dispatch_trips;
DROP POLICY IF EXISTS "dispatch_trips_select_role_scoped" ON public.dispatch_trips;
DROP POLICY IF EXISTS "dispatch_trips_insert_role_scoped" ON public.dispatch_trips;
DROP POLICY IF EXISTS "dispatch_trips_update_role_scoped" ON public.dispatch_trips;
DROP POLICY IF EXISTS "dispatch_trips_delete_super_admin" ON public.dispatch_trips;
CREATE POLICY "dispatch_trips_select_role_scoped" ON public.dispatch_trips FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "dispatch_trips_insert_role_scoped" ON public.dispatch_trips FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "dispatch_trips_update_role_scoped" ON public.dispatch_trips FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager'));
CREATE POLICY "dispatch_trips_delete_super_admin" ON public.dispatch_trips FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 20_expenses
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_expenses" ON public.expenses;
DROP POLICY IF EXISTS "expenses_select_role_scoped" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert_role_scoped" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update_role_scoped" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete_super_admin" ON public.expenses;
CREATE POLICY "expenses_select_role_scoped" ON public.expenses FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "expenses_insert_role_scoped" ON public.expenses FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "expenses_update_role_scoped" ON public.expenses FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "expenses_delete_super_admin" ON public.expenses FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 21_supplier_payments
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_supplier_payments" ON public.supplier_payments;
DROP POLICY IF EXISTS "supplier_payments_select_role_scoped" ON public.supplier_payments;
DROP POLICY IF EXISTS "supplier_payments_insert_role_scoped" ON public.supplier_payments;
DROP POLICY IF EXISTS "supplier_payments_update_role_scoped" ON public.supplier_payments;
DROP POLICY IF EXISTS "supplier_payments_delete_super_admin" ON public.supplier_payments;
CREATE POLICY "supplier_payments_select_role_scoped" ON public.supplier_payments FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "supplier_payments_insert_role_scoped" ON public.supplier_payments FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "supplier_payments_update_role_scoped" ON public.supplier_payments FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "supplier_payments_delete_super_admin" ON public.supplier_payments FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 22_invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_invoices" ON public.invoices;
DROP POLICY IF EXISTS "invoices_select_role_scoped" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_role_scoped" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_role_scoped" ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete_super_admin" ON public.invoices;
CREATE POLICY "invoices_select_role_scoped" ON public.invoices FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "invoices_insert_role_scoped" ON public.invoices FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "invoices_update_role_scoped" ON public.invoices FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','branch_manager','accountant'));
CREATE POLICY "invoices_delete_super_admin" ON public.invoices FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 23_inventory_value
ALTER TABLE public.inventory_value ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_inventory_value" ON public.inventory_value;
DROP POLICY IF EXISTS "inventory_value_select_role_scoped" ON public.inventory_value;
DROP POLICY IF EXISTS "inventory_value_insert_super_admin" ON public.inventory_value;
DROP POLICY IF EXISTS "inventory_value_update_super_admin" ON public.inventory_value;
DROP POLICY IF EXISTS "inventory_value_delete_super_admin" ON public.inventory_value;
CREATE POLICY "inventory_value_select_role_scoped" ON public.inventory_value FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','inventory_manager','accountant'));
CREATE POLICY "inventory_value_insert_super_admin" ON public.inventory_value FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "inventory_value_update_super_admin" ON public.inventory_value FOR UPDATE TO authenticated
USING (public.auth_user_role() = 'super_admin')
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "inventory_value_delete_super_admin" ON public.inventory_value FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 24_financial_alerts
ALTER TABLE public.financial_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_financial_alerts" ON public.financial_alerts;
DROP POLICY IF EXISTS "financial_alerts_select_role_scoped" ON public.financial_alerts;
DROP POLICY IF EXISTS "financial_alerts_insert_role_scoped" ON public.financial_alerts;
DROP POLICY IF EXISTS "financial_alerts_update_role_scoped" ON public.financial_alerts;
DROP POLICY IF EXISTS "financial_alerts_delete_super_admin" ON public.financial_alerts;
CREATE POLICY "financial_alerts_select_role_scoped" ON public.financial_alerts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "financial_alerts_insert_role_scoped" ON public.financial_alerts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "financial_alerts_update_role_scoped" ON public.financial_alerts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "financial_alerts_delete_super_admin" ON public.financial_alerts FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 25_financial_reports
ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "financial_reports_select_role_scoped" ON public.financial_reports;
DROP POLICY IF EXISTS "financial_reports_insert_super_admin" ON public.financial_reports;
DROP POLICY IF EXISTS "financial_reports_update_super_admin" ON public.financial_reports;
DROP POLICY IF EXISTS "financial_reports_delete_super_admin" ON public.financial_reports;
CREATE POLICY "financial_reports_select_role_scoped" ON public.financial_reports FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "financial_reports_insert_super_admin" ON public.financial_reports FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "financial_reports_update_super_admin" ON public.financial_reports FOR UPDATE TO authenticated
USING (public.auth_user_role() = 'super_admin')
WITH CHECK (public.auth_user_role() = 'super_admin');
CREATE POLICY "financial_reports_delete_super_admin" ON public.financial_reports FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 26_accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_accounts" ON public.accounts;
DROP POLICY IF EXISTS "accounts_select_role_scoped" ON public.accounts;
DROP POLICY IF EXISTS "accounts_insert_role_scoped" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update_role_scoped" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete_super_admin" ON public.accounts;
CREATE POLICY "accounts_select_role_scoped" ON public.accounts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "accounts_insert_role_scoped" ON public.accounts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "accounts_update_role_scoped" ON public.accounts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "accounts_delete_super_admin" ON public.accounts FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 27_income
ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_income" ON public.income;
DROP POLICY IF EXISTS "income_select_role_scoped" ON public.income;
DROP POLICY IF EXISTS "income_insert_role_scoped" ON public.income;
DROP POLICY IF EXISTS "income_update_role_scoped" ON public.income;
DROP POLICY IF EXISTS "income_delete_super_admin" ON public.income;
CREATE POLICY "income_select_role_scoped" ON public.income FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
-- Branch managers and sales reps are deliberately excluded from direct income INSERT.
-- Sale-generated income for those roles must go through
-- public.create_sale_with_side_effects(p_sale_id), whose SECURITY DEFINER body
-- enforces the allowed operation and own-sale check before inserting income.
CREATE POLICY "income_insert_role_scoped" ON public.income FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
-- Branch managers and sales reps are deliberately excluded from direct income UPDATE.
-- The sale side-effect RPC only inserts sale revenue entries; manual income edits
-- remain finance/ownership-level access.
CREATE POLICY "income_update_role_scoped" ON public.income FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "income_delete_super_admin" ON public.income FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 28_creditor_alerts
ALTER TABLE public.creditor_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_creditor_alerts" ON public.creditor_alerts;
DROP POLICY IF EXISTS "creditor_alerts_select_role_scoped" ON public.creditor_alerts;
DROP POLICY IF EXISTS "creditor_alerts_insert_role_scoped" ON public.creditor_alerts;
DROP POLICY IF EXISTS "creditor_alerts_update_role_scoped" ON public.creditor_alerts;
DROP POLICY IF EXISTS "creditor_alerts_delete_super_admin" ON public.creditor_alerts;
CREATE POLICY "creditor_alerts_select_role_scoped" ON public.creditor_alerts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "creditor_alerts_insert_role_scoped" ON public.creditor_alerts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "creditor_alerts_update_role_scoped" ON public.creditor_alerts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
CREATE POLICY "creditor_alerts_delete_super_admin" ON public.creditor_alerts FOR DELETE TO authenticated
USING (public.auth_user_role() = 'super_admin');

-- 29_atomic_sale_side_effects_rpc
CREATE OR REPLACE FUNCTION public.create_sale_with_side_effects(p_sale_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := public.auth_user_role();
  v_sale public.sales%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_customer_name text := 'Walk-in Customer';
  v_new_balance numeric;
  v_income_id bigint;
BEGIN
  IF v_role NOT IN ('super_admin','general_manager','branch_manager','sales_rep') THEN
    RAISE EXCEPTION 'Not allowed to finalize sale side effects';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF v_role = 'sales_rep' AND v_sale.sold_by <> auth.uid() THEN
    RAISE EXCEPTION 'Sales reps may only finalize their own sales';
  END IF;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;
    v_customer_name := COALESCE(v_customer.name, 'Walk-in Customer');
  END IF;

  IF v_sale.is_credit AND v_sale.customer_id IS NOT NULL THEN
    v_new_balance := COALESCE(v_customer.current_balance, 0) + COALESCE(v_sale.total_amount, 0);
    IF COALESCE(v_customer.credit_limit, 0) > 0 AND v_new_balance > v_customer.credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded';
    END IF;
    UPDATE public.customers SET current_balance = v_new_balance WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO public.income (
    income_category, description, amount, payment_method,
    received_from, invoice_ref, recorded_by, location_id, income_date
  )
  VALUES (
    'sales_revenue',
    'Sale ' || v_sale.invoice_number || CASE WHEN v_sale.customer_id IS NULL THEN '' ELSE ' - ' || v_customer_name END,
    v_sale.total_amount,
    v_sale.payment_method,
    v_customer_name,
    v_sale.invoice_number,
    v_sale.sold_by,
    v_sale.location_id,
    CURRENT_DATE
  )
  RETURNING id INTO v_income_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'income_id', v_income_id,
    'customer_id', v_sale.customer_id,
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale_with_side_effects(bigint) TO authenticated;

-- 30_verification
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
