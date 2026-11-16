-- =============================================
-- Forgera — Remove Finance Dashboard Tables & Columns
-- Run this in Supabase SQL Editor to clean up all finance-related data
-- WARNING: This will DELETE all financial data (expenses, income, accounts, etc.)
-- =============================================

-- ── 1. Drop finance-specific tables (order matters due to foreign keys) ────────

-- Cashbook & credit management (schema v5)
DROP TABLE IF EXISTS creditor_alerts CASCADE;
DROP TABLE IF EXISTS income CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- Financial intelligence (schema v4)
DROP TABLE IF EXISTS financial_reports CASCADE;
DROP TABLE IF EXISTS financial_alerts CASCADE;
DROP TABLE IF EXISTS inventory_value CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS supplier_payments CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;

-- ── 2. Remove finance-related columns from purchases table ─────────────────────
ALTER TABLE purchases
    DROP COLUMN IF EXISTS payment_type,
    DROP COLUMN IF EXISTS credit_period_days,
    DROP COLUMN IF EXISTS due_date,
    DROP COLUMN IF EXISTS paid,
    DROP COLUMN IF EXISTS paid_at,
    DROP COLUMN IF EXISTS paid_from_account_id;

-- ── 3. Remove cost_price from sales_items (schema v6 finance fix) ───────────────
-- NOTE: cost_price may be used by other features (COGS calculations in sales).
-- Only uncomment if you're certain nothing else depends on it.
-- ALTER TABLE sales_items DROP COLUMN IF EXISTS cost_price;

-- ── 4. Verify cleanup ─────────────────────────────────────────────────────────
-- Run these SELECT queries to confirm all tables were dropped:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
--   'expenses', 'supplier_payments', 'invoices', 'inventory_value',
--   'financial_alerts', 'financial_reports', 'accounts', 'income', 'creditor_alerts'
-- );
-- Expected result: 0 rows (all tables dropped)