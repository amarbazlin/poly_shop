-- =============================================================================
-- Migration 0013 — Purchase Records & Supplier Credit Payables
--
-- The Purchases page + supplier-credit reminders rely on:
--   • purchases.payment_type / credit_period_days / due_date   (0006_finance.sql)
--   • purchase_payments                                        (0008_supplier_credits.sql)
--   • alerts.alert_type = 'supplier_credit_due'                (0008_supplier_credits.sql)
--
-- Those migrations already ship in this repo, but 9999_remove_finance_tables.sql
-- drops the purchases credit columns again, and the two files cannot both be
-- applied. This migration re-asserts the *minimum* needed by the Purchases page
-- in a purely additive, idempotent way so any environment converges to the same
-- shape. Safe to re-run: every statement is IF NOT EXISTS / DROP-then-CREATE.
-- =============================================================================

BEGIN;

-- ── 1. Purchases: cash-or-credit terms ───────────────────────────────────────
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_type       TEXT    DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS credit_period_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date           DATE;

UPDATE public.purchases SET payment_type = 'cash'          WHERE payment_type IS NULL;
UPDATE public.purchases SET credit_period_days = 0         WHERE credit_period_days IS NULL;

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_payment_type_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_payment_type_check
  CHECK (payment_type IN ('cash', 'credit'));

-- A credit bill with no explicit due date falls back to purchase date + terms.
UPDATE public.purchases
SET due_date = (created_at::date + COALESCE(credit_period_days, 0))
WHERE payment_type = 'credit'
  AND due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_payment  ON public.purchases(payment_type);
CREATE INDEX IF NOT EXISTS idx_purchases_due_date ON public.purchases(due_date);

-- ── 2. purchase_payments — the payable ledger (one row per payment) ──────────
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
CREATE INDEX IF NOT EXISTS idx_purchase_payments_date     ON public.purchase_payments(payment_date);

-- ── 3. Alerts: allow the supplier-credit reminder type ───────────────────────
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_alert_type_check
  CHECK (alert_type IN (
    'low_stock',
    'out_of_stock',
    'price_anomaly',
    'demand_spike',
    'dead_stock',
    'reorder',
    'late_delivery',
    'forecasted_shortage',
    'supplier_credit_due'
  ));

COMMIT;

-- =============================================================================
-- Rollback:
--   DROP TABLE IF EXISTS public.purchase_payments CASCADE;
--   ALTER TABLE public.purchases
--     DROP COLUMN IF EXISTS payment_type,
--     DROP COLUMN IF EXISTS credit_period_days,
--     DROP COLUMN IF EXISTS due_date;
-- =============================================================================
