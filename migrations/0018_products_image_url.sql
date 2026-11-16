-- =============================================
-- Migration 0018 — products.image_url
-- Run this in the Supabase SQL Editor.
--
-- Adds a column that stores the product's image location, either a
-- site-relative path served from /public (e.g. /products/bosch-gsb600.jpg)
-- or an absolute URL. NULL means "no image" and the UI can fall back to a
-- placeholder.
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- =============================================

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN public.products.image_url IS
    'Product image location — a relative path served from /public (e.g. /products/bosch-gsb600.jpg) or an absolute URL. NULL = no image.';

-- ── Backfill: point every product at /products/<lowercased product_code>.jpg ──
-- e.g. product_code = 'BOSCH-GSB600' -> image_url = '/products/bosch-gsb600.jpg'
UPDATE public.products
SET image_url = '/products/' || lower(trim(product_code)) || '.jpg'
WHERE product_code IS NOT NULL;

-- If a code can contain spaces or other characters not safe in a filename,
-- use this slugified variant instead (runs of non-alphanumerics become '-'):
--   UPDATE public.products
--   SET image_url = '/products/' || lower(regexp_replace(trim(product_code), '[^a-zA-Z0-9]+', '-', 'g')) || '.jpg'
--   WHERE product_code IS NOT NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT id, product_name, image_url FROM public.products ORDER BY created_at DESC LIMIT 20;
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'image_url';
