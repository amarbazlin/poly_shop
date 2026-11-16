-- =============================================
-- Forgera — Credit sale profit recognition
-- Run this in the Supabase SQL Editor.
--
-- Adds sales.paid_at so a credit sale's profit is recognised on the day the
-- payment is recorded (the day it is marked paid) instead of the sale date.
-- Until a credit sale is marked paid it is excluded from profit entirely.
-- =============================================

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sales.paid_at IS
    'When a credit sale was marked paid. Profit for this sale is recognised on this date instead of created_at.';

CREATE INDEX IF NOT EXISTS idx_sales_paid_at ON public.sales (paid_at);

-- ── Notes ─────────────────────────────────────────────────────────────────────
-- • Cash / card / bank / cheque sales keep paid_at = NULL and their profit is
--   recognised on created_at, exactly as before.
-- • Credit sales still outstanding keep paid_at = NULL and are excluded from
--   profit until they are marked paid from the Sales page.
-- • Credit sales that were already marked paid before this migration have no
--   payment history to back-date, so their profit still counts on created_at.

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT id, invoice_number, is_credit, created_at, paid_at
-- FROM public.sales ORDER BY created_at DESC LIMIT 20;
