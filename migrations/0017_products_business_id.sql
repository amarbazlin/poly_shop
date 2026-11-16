-- =============================================================================
-- Migration 0017 — products.business_id can no longer be lost
--
-- Symptom: a product is created (the INSERT succeeds) but never appears in
-- Inventory, because the list is filtered by business_id while the new row was
-- stored with business_id = NULL (an older cached client, or any writer that
-- forgot the tenant column). The row is in the database yet invisible to every
-- business-scoped query.
--
-- This migration:
--   1. Adds a BEFORE INSERT trigger that fills business_id from the inserting
--      user's profile (public.users.business_id) whenever the client omits it.
--   2. Backfills existing NULL products.business_id — only when the project has
--      exactly one business, so multiple tenants are never mixed.
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- =============================================================================

-- ── 1. Trigger: always derive business_id from the author's profile ──────────
CREATE OR REPLACE FUNCTION public.set_products_business_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS NULL THEN
    SELECT u.business_id INTO NEW.business_id
    FROM public.users u
    WHERE u.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_business_id ON public.products;
CREATE TRIGGER products_set_business_id
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_products_business_id();

-- ── 2. Backfill rows stored without a tenant ─────────────────────────────────
DO $$
DECLARE
  biz_count integer;
  only_biz  bigint;
  fixed     integer;
BEGIN
  SELECT count(*) INTO biz_count FROM public.businesses;

  IF biz_count = 1 THEN
    SELECT id INTO only_biz FROM public.businesses LIMIT 1;
    UPDATE public.products SET business_id = only_biz WHERE business_id IS NULL;
    GET DIAGNOSTICS fixed = ROW_COUNT;
    RAISE NOTICE 'products.business_id backfilled: % row(s) -> business %', fixed, only_biz;
  ELSE
    RAISE NOTICE 'Skipped products.business_id backfill: % businesses exist. Attribute NULL rows manually, e.g. UPDATE public.products SET business_id = <id> WHERE business_id IS NULL;', biz_count;
  END IF;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT count(*) AS still_null FROM public.products WHERE business_id IS NULL;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal;
