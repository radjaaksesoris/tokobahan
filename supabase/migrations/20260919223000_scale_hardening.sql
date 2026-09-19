-- Add database-side aggregation, search indexes, and atomic operational reset.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON public.sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

CREATE OR REPLACE FUNCTION public.sales_daily_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    (created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(total_cost), 0),
    COALESCE(SUM(total_profit), 0),
    COUNT(*)
  FROM public.sales
  WHERE created_at >= p_start AND created_at <= p_end
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.reset_operational_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mereset database';
  END IF;

  TRUNCATE TABLE public.sale_items, public.sales, public.products, public.categories
    RESTART IDENTITY CASCADE;
  UPDATE public.invoice_sequences SET next_number = 1 WHERE id = 1;
END;
$$;

NOTIFY pgrst, 'reload schema';
