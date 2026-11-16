-- =============================================================================
-- Migration 0006 — Finance Module
-- Project: Forgera (in-house accountant for hardware retail)
--
-- Design notes:
--   • A previous finance module was removed by 9999_remove_finance_tables.sql
--     (dropped income/accounts/expenses/invoices/supplier_payments + purchase
--     credit columns). This migration rebuilds finance on a cleaner footing:
--     a single `transactions` ledger + derived AR/AP views.
--   • Finance READS from sales/purchases/products — no duplication of source
--     of truth. Sales → income ledger entries; purchases (on credit) → AP.
--   • All tables scoped by business_id (multi-tenant) with RLS matching the
--     role-scoped pattern from 0002_purchase_orders_rls.sql.
--   • Reintroduces supplier-credit columns on purchases (additive, non-breaking,
--     nullable with defaults — legacy rows treated as settled cash).
--   • Idempotent: safe to re-run.
--
-- RBAC: finance data is restricted to super_admin, general_manager, accountant
--   (SELECT) and super_admin, accountant (write). The service_role used by the
--   FastAPI backend bypasses RLS for aggregation endpoints.
-- =============================================================================

BEGIN;

-- ── STEP 1: Extend purchases for supplier credit terms (AP source) ───────────
-- Additive only — no existing column is altered or dropped.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS credit_period_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date DATE;

UPDATE public.purchases
SET payment_type = 'cash'
WHERE payment_type IS NULL;

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_payment_type_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_payment_type_check
  CHECK (payment_type IN ('cash', 'credit'));

-- Credit purchases: due_date = created_at + credit_period_days (owner can override)
UPDATE public.purchases
SET due_date = (created_at::date + COALESCE(credit_period_days, 0))
WHERE payment_type = 'credit'
  AND due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_payment    ON public.purchases(payment_type);
CREATE INDEX IF NOT EXISTS idx_purchases_due_date   ON public.purchases(due_date);

-- ── STEP 2: Extend sales for customer credit due dates (AR aging source) ─────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- Legacy credit sales: assume 30-day terms
UPDATE public.sales
SET due_date = (created_at::date + 30)
WHERE payment_method = 'credit'
  AND due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_due_date ON public.sales(due_date);

-- ── STEP 3: Per-product taxable flag (non-breaking, defaults taxable) ────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT TRUE;

UPDATE public.products SET is_taxable = TRUE WHERE is_taxable IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 4: cash_accounts — cash-in-hand, bank accounts, mobile wallets
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_accounts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    account_type    TEXT NOT NULL DEFAULT 'cash'
                    CHECK (account_type IN ('cash', 'bank', 'mobile_wallet', 'other')),
    account_number  TEXT,
    opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'LKR',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cash_accounts_business ON public.cash_accounts(business_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 5: expense_categories — editable by owner
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,  -- system seeds cannot be deleted
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_business ON public.expense_categories(business_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 6: transactions — the single income/expense ledger
--   • Auto-generated entries carry source = 'sale'/'purchase' + reference_id
--     (no manual double entry for normal operations).
--   • Payment allocations (customer_payment / supplier_payment) reference the
--     sale/purchase via reference_id — this drives AR/AP aging.
--   • cash_account_id optional so entries can post to a specific wallet.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.transactions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category        TEXT NOT NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'LKR',
    related_entity  TEXT CHECK (related_entity IN ('customer', 'supplier', 'none')),
    reference_id    BIGINT,            -- sales.id / purchases.id when source-linked
    source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'sale', 'purchase', 'customer_payment', 'supplier_payment')),
    payment_method  TEXT CHECK (payment_method IN
                      ('cash', 'card', 'bank_transfer', 'cheque', 'credit', 'mobile_wallet')),
    cash_account_id BIGINT REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'cleared'
                    CHECK (status IN ('pending', 'cleared')),
    description     TEXT,
    created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_business ON public.transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type     ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_date     ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_ref      ON public.transactions(reference_id, source);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category);

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 7: tax_settings — Sri Lanka VAT / SSCL / turnover tax
--   • Per-product override via products.is_taxable (STEP 3).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tax_settings (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    tax_name        TEXT NOT NULL,               -- 'VAT', 'SSCL', 'Turnover Tax'
    tax_rate        NUMERIC(5,4) NOT NULL,       -- e.g. 0.1800 = 18%
    applies_to      TEXT NOT NULL DEFAULT 'all'
                    CHECK (applies_to IN ('all', 'taxable_products_only', 'services')),
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, tax_name)
);

CREATE INDEX IF NOT EXISTS idx_tax_settings_business ON public.tax_settings(business_id);

-- Seed default VAT 18% for every existing business that has no tax settings
INSERT INTO public.tax_settings (business_id, tax_name, tax_rate, applies_to, is_default)
SELECT b.id, 'VAT', 0.1800, 'taxable_products_only', TRUE
FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.tax_settings t WHERE t.business_id = b.id);

-- Seed standard expense categories (rent, utilities, salaries, transport,
-- loan repayments, misc) for every business that has none
INSERT INTO public.expense_categories (business_id, name, is_system)
SELECT b.id, c.name, TRUE
FROM public.businesses b
CROSS JOIN (VALUES
  ('Rent'), ('Utilities'), ('Salaries'), ('Transport'),
  ('Loan Repayments'), ('Miscellaneous')
) AS c(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_categories e WHERE e.business_id = b.id
);

-- Seed a default cash account for businesses that have none
INSERT INTO public.cash_accounts (business_id, name, account_type)
SELECT b.id, 'Cash in Hand', 'cash'
FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.cash_accounts a WHERE a.business_id = b.id);

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 8: AR / AP aging views — DERIVED, no duplication of source of truth.
--   AR: credit sales minus payments allocated to that sale.
--   AP: credit purchases minus supplier payments.
--   Aging buckets: 0-30 / 31-60 / 61-90 / 90+ by days past due_date.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_accounts_receivable AS
SELECT
  s.business_id,
  s.id                       AS sale_id,
  s.invoice_number,
  s.customer_id,
  c.name                     AS customer_name,
  c.phone                    AS customer_phone,
  s.total_amount             AS invoice_amount,
  COALESCE(pay.paid, 0)      AS amount_paid,
  s.total_amount - COALESCE(pay.paid, 0) AS outstanding_amount,
  s.due_date,
  GREATEST(0, (CURRENT_DATE - s.due_date)) AS days_overdue,
  CASE
    WHEN s.due_date IS NULL OR CURRENT_DATE <= s.due_date            THEN '0-30'
    WHEN CURRENT_DATE - s.due_date <= 60                             THEN '31-60'
    WHEN CURRENT_DATE - s.due_date <= 90                             THEN '61-90'
    ELSE '90+'
  END                        AS aging_bucket
FROM public.sales s
JOIN public.customers c      ON c.id = s.customer_id
LEFT JOIN (
  SELECT reference_id, SUM(amount) AS paid
  FROM public.transactions
  WHERE type = 'income' AND source = 'customer_payment' AND status = 'cleared'
  GROUP BY reference_id
) pay ON pay.reference_id = s.id
WHERE s.is_credit = TRUE
  AND s.total_amount - COALESCE(pay.paid, 0) > 0;

CREATE OR REPLACE VIEW public.v_accounts_payable AS
SELECT
  p.business_id,
  p.id                        AS purchase_id,
  p.invoice_number,
  p.supplier_id,
  sup.supplier_name,
  p.total_amount              AS bill_amount,
  COALESCE(pay.paid, 0)       AS amount_paid,
  p.total_amount - COALESCE(pay.paid, 0) AS outstanding_amount,
  p.due_date,
  sup.average_delivery_days,
  GREATEST(0, (CURRENT_DATE - p.due_date)) AS days_overdue,
  CASE
    WHEN p.due_date IS NULL OR CURRENT_DATE <= p.due_date            THEN '0-30'
    WHEN CURRENT_DATE - p.due_date <= 60                             THEN '31-60'
    WHEN CURRENT_DATE - p.due_date <= 90                             THEN '61-90'
    ELSE '90+'
  END                         AS aging_bucket
FROM public.purchases p
JOIN public.suppliers sup    ON sup.id = p.supplier_id
LEFT JOIN (
  SELECT reference_id, SUM(amount) AS paid
  FROM public.transactions
  WHERE type = 'expense' AND source = 'supplier_payment' AND status = 'cleared'
  GROUP BY reference_id
) pay ON pay.reference_id = p.id
WHERE p.payment_type = 'credit'
  AND p.status NOT IN ('cancelled')
  AND p.total_amount - COALESCE(pay.paid, 0) > 0;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 9: RLS — role-scoped, mirroring 0002_purchase_orders_rls.sql
--   SELECT: super_admin, general_manager, accountant
--   WRITE : super_admin, accountant
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settings         ENABLE ROW LEVEL SECURITY;

-- transactions — SELECT: owner/GM/accountant; WRITE: owner/accountant
DROP POLICY IF EXISTS "transactions_finance_select" ON public.transactions;
CREATE POLICY "transactions_finance_select" ON public.transactions FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));

DROP POLICY IF EXISTS "transactions_finance_insert" ON public.transactions;
CREATE POLICY "transactions_finance_insert" ON public.transactions FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "transactions_finance_update" ON public.transactions;
CREATE POLICY "transactions_finance_update" ON public.transactions FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "transactions_finance_delete" ON public.transactions;
CREATE POLICY "transactions_finance_delete" ON public.transactions FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

-- cash_accounts
DROP POLICY IF EXISTS "cash_accounts_finance_select" ON public.cash_accounts;
CREATE POLICY "cash_accounts_finance_select" ON public.cash_accounts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));

DROP POLICY IF EXISTS "cash_accounts_finance_insert" ON public.cash_accounts;
CREATE POLICY "cash_accounts_finance_insert" ON public.cash_accounts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "cash_accounts_finance_update" ON public.cash_accounts;
CREATE POLICY "cash_accounts_finance_update" ON public.cash_accounts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "cash_accounts_finance_delete" ON public.cash_accounts;
CREATE POLICY "cash_accounts_finance_delete" ON public.cash_accounts FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

-- expense_categories
DROP POLICY IF EXISTS "expense_categories_finance_select" ON public.expense_categories;
CREATE POLICY "expense_categories_finance_select" ON public.expense_categories FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));

DROP POLICY IF EXISTS "expense_categories_finance_insert" ON public.expense_categories;
CREATE POLICY "expense_categories_finance_insert" ON public.expense_categories FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "expense_categories_finance_update" ON public.expense_categories;
CREATE POLICY "expense_categories_finance_update" ON public.expense_categories FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "expense_categories_finance_delete" ON public.expense_categories;
CREATE POLICY "expense_categories_finance_delete" ON public.expense_categories FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

-- tax_settings
DROP POLICY IF EXISTS "tax_settings_finance_select" ON public.tax_settings;
CREATE POLICY "tax_settings_finance_select" ON public.tax_settings FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));

DROP POLICY IF EXISTS "tax_settings_finance_insert" ON public.tax_settings;
CREATE POLICY "tax_settings_finance_insert" ON public.tax_settings FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "tax_settings_finance_update" ON public.tax_settings;
CREATE POLICY "tax_settings_finance_update" ON public.tax_settings FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "tax_settings_finance_delete" ON public.tax_settings;
CREATE POLICY "tax_settings_finance_delete" ON public.tax_settings FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

COMMIT;

-- =============================================================================
-- Rollback (if ever needed):
--   DROP VIEW IF EXISTS v_accounts_payable, v_accounts_receivable;
--   DROP TABLE IF EXISTS tax_settings, transactions, expense_categories,
--                        cash_accounts CASCADE;
--   ALTER TABLE purchases DROP COLUMN IF EXISTS payment_type,
--     DROP COLUMN IF EXISTS credit_period_days, DROP COLUMN IF EXISTS due_date;
--   ALTER TABLE sales DROP COLUMN IF EXISTS due_date;
--   ALTER TABLE products DROP COLUMN IF EXISTS is_taxable;
-- =============================================================================

