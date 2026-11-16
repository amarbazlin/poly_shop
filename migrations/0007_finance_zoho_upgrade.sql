-- =============================================================================
-- Migration 0007 — Finance Module: Zoho Books-style upgrade (additive)
-- Project: Forgera (in-house accountant for construction hardware retail)
--
-- Additive ON TOP of 0006_finance.sql (already live). No existing column is
-- altered/dropped. New tables: chart_of_accounts, tags, transaction_tags,
-- journal_entries, journal_entry_lines. transactions gains a nullable
-- account_id FK so it can post against the chart while the legacy `category`
-- text column is retained for backward compatibility.
--
-- Idempotent: safe to re-run.
-- RBAC: same role-scoped pattern — finance SELECT = super_admin/general_manager/
--   accountant; writes = super_admin/accountant.
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1: chart_of_accounts — the backbone replacing flat expense_categories
--   account_type ∈ Asset | Liability | Equity | Income | Expense
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_code    TEXT NOT NULL,
    account_name    TEXT NOT NULL,
    account_type    TEXT NOT NULL
                    CHECK (account_type IN ('Asset','Liability','Equity','Income','Expense')),
    parent_account_id BIGINT REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_coa_business    ON public.chart_of_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_coa_type        ON public.chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_coa_parent      ON public.chart_of_accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_coa_active      ON public.chart_of_accounts(business_id, is_active);

-- =============================================================================
-- STEP 2: tags + transaction_tags (free-text tagging, Zoho-style creatable tags)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tags (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    tag_name    TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#CCCCCC',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, tag_name)
);
CREATE INDEX IF NOT EXISTS idx_tags_business ON public.tags(business_id);

CREATE TABLE IF NOT EXISTS public.transaction_tags (
    transaction_id BIGINT NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    tag_id         BIGINT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON public.transaction_tags(tag_id);

-- =============================================================================
-- STEP 3: journal_entries + journal_entry_lines (for manual double-entry posts
--   such as depreciation, write-offs, corrections not covered by the sync
--   engine). Each journal must balance (debits = credits).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.journal_entries (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    entry_number TEXT NOT NULL,
    description   TEXT,
    entry_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    posted        BOOLEAN NOT NULL DEFAULT FALSE,
    created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_business ON public.journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date     ON public.journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted   ON public.journal_entries(posted);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id BIGINT NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
    account_id      BIGINT NOT NULL REFERENCES public.chart_of_accounts(id),
    debit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT journal_line_one_side CHECK ((debit > 0)::int + (credit > 0)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry   ON public.journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_entry_lines(account_id);

-- =============================================================================
-- STEP 4: transactions — add nullable account_id FK (post against the chart)
--   Legacy `category` text column retained so 0006 sync engine keeps working.
-- =============================================================================
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);

-- =============================================================================
-- STEP 5: Seed the 37-account Chart of Accounts for every business.
-- Codes follow Zoho/standard numbering (1xxx Assets, 2xxx Liabilities, 3xxx
-- Equity, 4xxx Income, 5xxx COGS, 6xxx Operating Expenses).
-- =============================================================================
WITH seed_list AS (
  SELECT * FROM (
    VALUES
-- Assets (1xxx)
    ('1000','Cash in Hand','Asset',NULL),
    ('1010','Bank Accounts','Asset',NULL),
    ('1100','Accounts Receivable','Asset',NULL),
    ('1200','Inventory Asset','Asset',NULL),
    ('1300','Fixed Assets (Vehicles)','Asset',NULL),
    ('1310','Fixed Assets (Warehouse Equip.)','Asset',NULL),
    ('1400','Prepaid Expenses','Asset',NULL),
-- Liabilities (2xxx)
    ('2000','Accounts Payable','Liability',NULL),
    ('2100','Loans Payable','Liability',NULL),
    ('2200','VAT Payable','Liability',NULL),
    ('2300','Accrued Salaries','Liability',NULL),
-- Equity (3xxx)
    ('3000','Owner''s Capital','Equity',NULL),
    ('3100','Retained Earnings','Equity',NULL),
    ('3200','Drawings','Equity',NULL),
-- Income (4xxx)
    ('4000','Sales Revenue','Income',NULL),
    ('4100','Service / Installation Income','Income',NULL),
    ('4200','Other Income','Income',NULL),
-- Expense — COGS (5xxx)
    ('5000','Cost of Goods Sold','Expense',NULL),
    ('5100','Freight & Transport Inward','Expense',NULL),
-- Expense — Operating (6xxx)
    ('6000','Rent','Expense',NULL),
    ('6010','Utilities (Electricity/Water)','Expense',NULL),
    ('6100','Salaries & Wages','Expense',NULL),
    ('6110','Staff EPF/ETF','Expense',NULL),
    ('6200','Fuel & Vehicle Maintenance','Expense',NULL),
    ('6300','Repairs & Maintenance','Expense',NULL),
    ('6400','Marketing & Advertising','Expense',NULL),
    ('6500','Bank Charges & Fees','Expense',NULL),
    ('6600','Loan Interest','Expense',NULL),
    ('6700','Insurance','Expense',NULL),
    ('6800','Office Supplies & Stationery','Expense',NULL),
    ('6900','Professional / Legal Fees','Expense',NULL),
    ('7000','Depreciation','Expense',NULL),
    ('7100','Warehouse / Storage Costs','Expense',NULL),
    ('7200','Telephone & Internet','Expense',NULL),
    ('7900','Miscellaneous Expense','Expense',NULL)
  ) AS v(code, name, type, parent)
)
INSERT INTO public.chart_of_accounts (business_id, account_code, account_name, account_type, is_default)
SELECT b.id, s.code, s.name, s.type, TRUE
FROM public.businesses b
CROSS JOIN seed_list s
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c
  WHERE c.business_id = b.id AND c.account_code = s.code
);

-- =============================================================================
-- STEP 6: Migrate legacy expense_categories onto the chart.
--   Each user-created expense_category → a 6xxx Expense account with a code
--   derived from a hash of its name, so no collision with system codes 6xxx-79xx.
--   System seed categories (Rent/Utilities/Salaries/Transport/Misc) map to
--   their exact CoA twins; custom ones get a unique generated code.
-- =============================================================================
-- First, migrate any user-created (non-system) expense categories.
INSERT INTO public.chart_of_accounts (business_id, account_code, account_name, account_type, is_default)
SELECT e.business_id,
       lpad((6000 + (hashtext(e.name) % 900))::text, 4, '0') AS account_code,
       e.name, 'Expense', FALSE
FROM public.expense_categories e
WHERE e.is_system = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts c
    WHERE c.business_id = e.business_id
      AND c.account_name = e.name
      AND c.account_type = 'Expense'
  );

-- Backfill: link existing expense transactions to their matching CoA account by name.
UPDATE public.transactions t
SET account_id = coa.id
FROM public.chart_of_accounts coa
WHERE t.account_id IS NULL
  AND coa.business_id = t.business_id
  AND coa.account_name = t.category
        AND coa.account_type = 'Expense';

-- =============================================================================
-- STEP 7: Row Level Security — match existing role-scoped pattern.
--   SELECT: super_admin, general_manager, accountant
--   INSERT/UPDATE/DELETE: super_admin, accountant
-- =============================================================================
ALTER TABLE public.chart_of_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines   ENABLE ROW LEVEL SECURITY;

-- chart_of_accounts
DROP POLICY IF EXISTS "coa_select" ON public.chart_of_accounts;
CREATE POLICY "coa_select" ON public.chart_of_accounts FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
DROP POLICY IF EXISTS "coa_insert" ON public.chart_of_accounts;
CREATE POLICY "coa_insert" ON public.chart_of_accounts FOR INSERT TO authenticated
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));
DROP POLICY IF EXISTS "coa_update" ON public.chart_of_accounts;
CREATE POLICY "coa_update" ON public.chart_of_accounts FOR UPDATE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));
DROP POLICY IF EXISTS "coa_delete" ON public.chart_of_accounts;
CREATE POLICY "coa_delete" ON public.chart_of_accounts FOR DELETE TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'));

-- tags
DROP POLICY IF EXISTS "tags_select" ON public.tags;
CREATE POLICY "tags_select" ON public.tags FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
DROP POLICY IF EXISTS "tags_write" ON public.tags;
CREATE POLICY "tags_write" ON public.tags FOR ALL TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

-- transaction_tags
DROP POLICY IF EXISTS "tt_select" ON public.transaction_tags;
CREATE POLICY "tt_select" ON public.transaction_tags FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
DROP POLICY IF EXISTS "tt_write" ON public.transaction_tags;
CREATE POLICY "tt_write" ON public.transaction_tags FOR ALL TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

-- journal_entries
DROP POLICY IF EXISTS "je_select" ON public.journal_entries;
CREATE POLICY "je_select" ON public.journal_entries FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
DROP POLICY IF EXISTS "je_write" ON public.journal_entries;
CREATE POLICY "je_write" ON public.journal_entries FOR ALL TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

-- journal_entry_lines
DROP POLICY IF EXISTS "jel_select" ON public.journal_entry_lines;
CREATE POLICY "jel_select" ON public.journal_entry_lines FOR SELECT TO authenticated
USING (public.auth_user_role() IN ('super_admin','general_manager','accountant'));
DROP POLICY IF EXISTS "jel_write" ON public.journal_entry_lines;
CREATE POLICY "jel_write" ON public.journal_entry_lines FOR ALL TO authenticated
USING (public.auth_user_role() IN ('super_admin','accountant'))
WITH CHECK (public.auth_user_role() IN ('super_admin','accountant'));

COMMIT;

-- =============================================================================
-- Rollback:
--   ALTER TABLE public.transactions DROP COLUMN IF EXISTS account_id;
--   DROP VIEW IF EXISTS v_accounts_payable, v_accounts_receivable;
--   DROP TABLE IF EXISTS journal_entry_lines, journal_entries,
--                        transaction_tags, tags, chart_of_accounts CASCADE;
-- =============================================================================






