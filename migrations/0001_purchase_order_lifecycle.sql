-- =============================================================================
-- Phase 0 — Purchase Order Lifecycle Migration
-- Project: Forgera (ai-system / mosucapcjbbcgndciurt)
--
-- Step 1 discoveries (live schema, 2026-06-22):
--   • purchases PK: bigint identity; user FK pattern: UUID → public.users(id)
--   • purchases already has purchased_by (UUID → users) — semantic duplicate of
--     created_by; created_by is added and backfilled from purchased_by
--   • purchases already has location_id (bigint → locations)
--   • No status column or enum types on purchases yet
--   • products stock column: quantity (integer)
--   • location_stock: (product_id, location_id) UNIQUE, upsert via ON CONFLICT
--   • purchases RLS SELECT/INSERT roles: super_admin, general_manager
-- =============================================================================

BEGIN;

-- ── STEP 2: Extend purchases ─────────────────────────────────────────────────

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- location_id already exists from schema_v2; ensure FK if column was added elsewhere
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchases'::regclass
      AND conname = 'purchases_location_id_fkey'
  ) THEN
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES public.locations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill created_by from legacy purchased_by column
UPDATE public.purchases
SET created_by = purchased_by
WHERE created_by IS NULL
  AND purchased_by IS NOT NULL;

-- Legacy rows (pre-lifecycle) → completed; new rows default to draft
UPDATE public.purchases
SET status = 'completed'
WHERE status IS NULL;

ALTER TABLE public.purchases
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.purchases
  ALTER COLUMN source SET DEFAULT 'manual';

UPDATE public.purchases
SET source = 'manual'
WHERE source IS NULL;

-- Drop/recreate CHECK constraints (idempotent)
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'sent',
    'received', 'completed', 'cancelled'
  ));

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_source_check;
ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_source_check
  CHECK (source IN ('manual', 'ai_draft'));

CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.purchases(status);

-- ── purchase_order_status_history ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.purchase_order_status_history (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_id  BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_status_history_purchase
  ON public.purchase_order_status_history(purchase_id);

-- Seed audit rows for legacy purchases migrated to completed
INSERT INTO public.purchase_order_status_history (
  purchase_id, from_status, to_status, changed_by, changed_at, notes
)
SELECT
  p.id,
  NULL,
  'completed',
  COALESCE(p.created_by, p.purchased_by),
  COALESCE(p.received_at, p.created_at::timestamptz, NOW()),
  'Legacy purchase migrated to completed status'
FROM public.purchases p
WHERE p.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.purchase_order_status_history h
    WHERE h.purchase_id = p.id
  );

-- RLS — mirror purchases SELECT / INSERT; immutable log + super_admin DELETE
ALTER TABLE public.purchase_order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_status_history_select_role_scoped"
  ON public.purchase_order_status_history;
CREATE POLICY "po_status_history_select_role_scoped"
  ON public.purchase_order_status_history
  FOR SELECT TO authenticated
  USING (public.auth_user_role() IN ('super_admin', 'general_manager'));

DROP POLICY IF EXISTS "po_status_history_insert_role_scoped"
  ON public.purchase_order_status_history;
CREATE POLICY "po_status_history_insert_role_scoped"
  ON public.purchase_order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('super_admin', 'general_manager'));

DROP POLICY IF EXISTS "po_status_history_delete_super_admin"
  ON public.purchase_order_status_history;
CREATE POLICY "po_status_history_delete_super_admin"
  ON public.purchase_order_status_history
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'super_admin');

-- ── STEP 3: Status transition RPC ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transition_purchase_order_status(
  p_purchase_id bigint,
  p_new_status  text,
  p_notes       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role            text := public.auth_user_role();
  v_purchase        public.purchases%ROWTYPE;
  v_old_status      text;
  v_creator         uuid;
  v_items_received  integer := 0;
  v_item            record;
  v_prev_stock      integer;
  v_new_stock       integer;
  v_stock_updates   jsonb;
BEGIN
  v_stock_updates := '[]'::jsonb;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Authenticated user role not found';
  END IF;

  IF p_new_status NOT IN (
    'draft', 'pending_approval', 'approved', 'sent',
    'received', 'completed', 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Invalid target status: %', p_new_status;
  END IF;

  SELECT * INTO v_purchase
  FROM public.purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found: %', p_purchase_id;
  END IF;

  v_old_status := v_purchase.status;
  v_creator    := COALESCE(v_purchase.created_by, v_purchase.purchased_by);

  IF v_old_status = p_new_status THEN
    RAISE EXCEPTION 'Purchase order is already in status %', p_new_status;
  END IF;

  -- ── Cancellation (pre-sent states only) ───────────────────────────────────
  IF p_new_status = 'cancelled' THEN
    IF v_old_status NOT IN ('draft', 'pending_approval', 'approved') THEN
      RAISE EXCEPTION 'Cannot cancel purchase order after it has been sent (current status: %)', v_old_status;
    END IF;
    IF v_role NOT IN ('general_manager', 'super_admin') THEN
      RAISE EXCEPTION 'Insufficient role to cancel purchase order';
    END IF;

  -- ── Forward lifecycle transitions ─────────────────────────────────────────
  ELSIF v_old_status = 'draft' AND p_new_status = 'pending_approval' THEN
    IF NOT (
      v_role IN ('inventory_manager', 'branch_manager', 'general_manager', 'super_admin')
      OR (v_creator IS NOT NULL AND v_creator = auth.uid())
    ) THEN
      RAISE EXCEPTION 'Insufficient role to submit purchase order for approval';
    END IF;

  ELSIF v_old_status = 'pending_approval' AND p_new_status = 'approved' THEN
    IF v_role NOT IN ('general_manager', 'super_admin') THEN
      RAISE EXCEPTION 'Insufficient role to approve purchase order';
    END IF;

  ELSIF v_old_status = 'approved' AND p_new_status = 'sent' THEN
    IF v_role NOT IN ('inventory_manager', 'branch_manager', 'general_manager', 'super_admin') THEN
      RAISE EXCEPTION 'Insufficient role to mark purchase order as sent';
    END IF;

  ELSIF v_old_status = 'sent' AND p_new_status = 'received' THEN
    IF NOT (
      v_role IN ('inventory_manager', 'branch_manager', 'general_manager', 'super_admin')
      OR (v_creator IS NOT NULL AND v_creator = auth.uid())
    ) THEN
      RAISE EXCEPTION 'Insufficient role to receive purchase order goods';
    END IF;

  ELSIF v_old_status = 'received' AND p_new_status = 'completed' THEN
    IF v_role NOT IN ('inventory_manager', 'branch_manager', 'general_manager', 'super_admin') THEN
      RAISE EXCEPTION 'Insufficient role to complete purchase order';
    END IF;

  ELSE
    RAISE EXCEPTION 'Illegal status transition: % → %', v_old_status, p_new_status;
  END IF;

  -- ── Goods receiving (sent → received) ─────────────────────────────────────
  IF p_new_status = 'received' THEN
    FOR v_item IN
      SELECT pi.product_id, pi.quantity
      FROM public.purchase_items pi
      WHERE pi.purchase_id = p_purchase_id
        AND pi.product_id IS NOT NULL
    LOOP
      SELECT p.quantity INTO v_prev_stock
      FROM public.products p
      WHERE p.id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found for purchase item: %', v_item.product_id;
      END IF;

      v_new_stock := COALESCE(v_prev_stock, 0) + v_item.quantity;

      UPDATE public.products
      SET quantity = v_new_stock,
          last_restocked = NOW()
      WHERE id = v_item.product_id;

      v_stock_updates := v_stock_updates || jsonb_build_object(
        'product_id', v_item.product_id,
        'quantity_received', v_item.quantity,
        'new_stock', v_new_stock
      );

      INSERT INTO public.inventory_transactions (
        product_id, transaction_type, quantity,
        previous_stock, new_stock, reference_id, notes, business_id
      )
      VALUES (
        v_item.product_id,
        'purchase',
        v_item.quantity,
        v_prev_stock,
        v_new_stock,
        p_purchase_id,
        'PO received #' || p_purchase_id,
        v_purchase.business_id
      );

      IF v_purchase.location_id IS NOT NULL THEN
        INSERT INTO public.location_stock (product_id, location_id, quantity, business_id)
        VALUES (v_item.product_id, v_purchase.location_id, v_item.quantity, v_purchase.business_id)
        ON CONFLICT (product_id, location_id)
        DO UPDATE SET quantity = public.location_stock.quantity + EXCLUDED.quantity;
      END IF;

      v_items_received := v_items_received + 1;
    END LOOP;
  END IF;

  -- ── Update purchase row + timestamps ──────────────────────────────────────
  UPDATE public.purchases
  SET
    status     = p_new_status,
    approved_by = CASE WHEN p_new_status = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN p_new_status = 'approved' THEN NOW() ELSE approved_at END,
    sent_at     = CASE WHEN p_new_status = 'sent' THEN NOW() ELSE sent_at END,
    received_at = CASE WHEN p_new_status = 'received' THEN NOW() ELSE received_at END,
    received_by = CASE WHEN p_new_status = 'received' THEN auth.uid() ELSE received_by END
  WHERE id = p_purchase_id;

  INSERT INTO public.purchase_order_status_history (
    purchase_id, from_status, to_status, changed_by, notes
  )
  VALUES (
    p_purchase_id, v_old_status, p_new_status, auth.uid(), p_notes
  );

  RETURN jsonb_build_object(
    'purchase_id',     p_purchase_id,
    'old_status',      v_old_status,
    'new_status',      p_new_status,
    'items_received',  v_items_received,
    'changed_by',      auth.uid(),
    'stock_updates',   v_stock_updates
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_purchase_order_status(bigint, text, text)
  TO authenticated;

COMMIT;