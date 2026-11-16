-- ═══════════════════════════════════════════════════════════════════════════
-- 0010: Rename sale_items → sales_items and products.buying_price → cost_price
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.sale_items RENAME TO sales_items;

ALTER TABLE IF EXISTS public.products RENAME COLUMN buying_price TO cost_price;

-- Indexes named after the old table
ALTER INDEX IF EXISTS public.idx_sale_items_sale   RENAME TO idx_sales_items_sale;
ALTER INDEX IF EXISTS public.idx_sale_items_product RENAME TO idx_sales_items_product;
