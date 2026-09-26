-- Avoid repeatedly sending the same low-stock notification to the same device.
CREATE TABLE IF NOT EXISTS public.low_stock_notification_log (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, subscription_id)
);

ALTER TABLE public.low_stock_notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.low_stock_notification_log FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_low_stock_notification_log_notified_at
  ON public.low_stock_notification_log(notified_at);

NOTIFY pgrst, 'reload schema';
