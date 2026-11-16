-- Unified alerts system extension.
-- Extends the existing alerts table without altering its RLS policies.

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS related_purchase_order_id bigint REFERENCES public.purchases(id) ON DELETE CASCADE;

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

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
    'forecasted_shortage'
  ));

CREATE INDEX IF NOT EXISTS idx_alerts_purchase_order ON public.alerts(related_purchase_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open_dedupe
  ON public.alerts (
    alert_type,
    COALESCE(product_id, -1),
    COALESCE(related_purchase_order_id, -1)
  )
  WHERE resolved = FALSE;
