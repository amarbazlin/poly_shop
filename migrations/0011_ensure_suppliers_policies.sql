-- ═══════════════════════════════════════════════════════════════════════════
-- 0011: Ensure read/write RLS policies exist on suppliers
-- Symptom: adding or editing suppliers fails with a row-level security error.
-- Idempotent: safe to run multiple times in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_read_all" ON public.suppliers;
DROP POLICY IF EXISTS "auth_write" ON public.suppliers;

CREATE POLICY "auth_read_all" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write" ON public.suppliers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
