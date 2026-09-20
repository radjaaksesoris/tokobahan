-- Allow authenticated users to read stock receipt history for the inventory recap.
ALTER TABLE public.product_stock_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stock batches viewable by authenticated" ON public.product_stock_batches;
CREATE POLICY "Stock batches viewable by authenticated"
  ON public.product_stock_batches
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON TABLE public.product_stock_batches TO authenticated;

CREATE INDEX IF NOT EXISTS idx_stock_batches_received_at
  ON public.product_stock_batches(received_at DESC, id DESC);

NOTIFY pgrst, 'reload schema';
