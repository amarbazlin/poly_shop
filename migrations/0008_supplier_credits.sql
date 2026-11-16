-- =============================================================================
-- Migration 0008 — Supplier Credit Tracking
--   • purchase_payments: partial payments made against a credit purchase
--     (linked to the purchases row that drives v_accounts_payable).
--   • Alerts: allow the new 'supplier_credit_due' alert type (7/3/1 days and
--     overdue reminders raised by backend/agents/alert_engine.py).
--   • Idempotent: safe to re-run.
-- =============================================================================

BEGIN;

-- ── 1. Alert type constraint: add supplier_credit_due ────────────────────────
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_alert_type_check
  CHECK (alert_type IN (
    'low_stock',
    'out_of_stock',
    'dead_stock',
    'late_delivery',
    'supplier_credit_due'
  ));

-- ── 2. purchase_payments — payments against a purchase (AP reduction) ────────
CREATE TABLE IF NOT EXISTS public.purchase_payments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    purchase_id     BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_method  TEXT NOT NULL DEFAULT 'cash',
    cash_account_id BIGINT REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
    payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON public.purchase_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_business ON public.purchase_payments(business_id);

-- ── 3. RLS (same finance role pattern as 0006_finance.sql) ───────────────────
ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_payments_finance_select" ON public.purchase_payments;
CREATE POLICY "purchase_payments_finance_select" ON public.purchase_payments FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));

DROP POLICY IF EXISTS "purchase_payments_finance_insert" ON public.purchase_payments;
CREATE POLICY "purchase_payments_finance_insert" ON public.purchase_payments FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

DROP POLICY IF EXISTS "purchase_payments_finance_delete" ON public.purchase_payments;
CREATE POLICY "purchase_payments_finance_delete" ON public.purchase_payments FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

COMMIT;

-- =============================================================================
-- Rollback (if ever needed):
--   DROP TABLE IF EXISTS purchase_payments CASCADE;
--   (re-add the previous alerts constraint without 'supplier_credit_due')
-- =============================================================================