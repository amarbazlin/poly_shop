-- =============================================================================
-- Migration 0015 — Cash book (simple finance page ledger)
--
-- The Finance page is now a plain cash book on top of the `transactions`
-- ledger introduced by 0006_finance.sql:
--   • income  = money in
--   • expense = money out
--
-- 0006 also creates cash_accounts / expense_categories / tax_settings, which
-- the old dashboard-style Finance page needed but the cash book does not. This
-- migration therefore re-asserts ONLY the minimum the cash book requires, so
-- any environment converges to the same shape regardless of whether 0006 was
-- ever applied (the same safety pattern used by 0013_purchase_credits.sql).
--
-- Idempotent: safe to re-run. Purely additive — nothing is dropped.
-- =============================================================================

BEGIN;

-- ── 1. transactions — the income/expense ledger ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category        TEXT NOT NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'LKR',
    related_entity  TEXT CHECK (related_entity IN ('customer', 'supplier', 'none')),
    reference_id    BIGINT,
    source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'sale', 'purchase', 'customer_payment', 'supplier_payment')),
    payment_method  TEXT CHECK (payment_method IN
                      ('cash', 'card', 'bank_transfer', 'cheque', 'credit', 'mobile_wallet')),
    cash_account_id BIGINT,
    status          TEXT NOT NULL DEFAULT 'cleared'
                    CHECK (status IN ('pending', 'cleared')),
    description     TEXT,
    created_by      UUID,   -- deliberately no FK: keeps this migration self-contained
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Older environments may predate some columns: add them back if missing.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'LKR';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS related_entity   TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source           TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_method   TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'cleared';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_by       UUID;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_transactions_business ON public.transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type     ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_date     ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category);

-- ── 2. RLS — same role scoping as 0006_finance.sql ───────────────────────────
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_finance_select" ON public.transactions;
CREATE POLICY "transactions_finance_select" ON public.transactions FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin', 'general_manager', 'accountant'));

DROP POLICY IF EXISTS "transactions_finance_insert" ON public.transactions;
CREATE POLICY "transactions_finance_insert" ON public.transactions FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin', 'accountant'));

DROP POLICY IF EXISTS "transactions_finance_update" ON public.transactions;
CREATE POLICY "transactions_finance_update" ON public.transactions FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin', 'accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin', 'accountant'));

DROP POLICY IF EXISTS "transactions_finance_delete" ON public.transactions;
CREATE POLICY "transactions_finance_delete" ON public.transactions FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin', 'accountant'));

-- Explicit grants (RLS still restricts what each role can actually see/write).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT type, COUNT(*), SUM(amount) FROM public.transactions GROUP BY type;
