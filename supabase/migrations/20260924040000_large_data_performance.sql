-- Indexes and database-side aggregates for larger operational datasets.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sales_created_at
  ON public.sales(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_payment_method_created_at
  ON public.sales(payment_method, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_no_trgm
  ON public.sales USING gin (invoice_no gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON public.products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm
  ON public.products USING gin (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm
  ON public.products USING gin (barcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_stock_batches_status_due_date
  ON public.product_stock_batches(payment_status, due_date ASC, id);

CREATE INDEX IF NOT EXISTS idx_vendor_debt_payments_batch_paid_at
  ON public.vendor_debt_payments(stock_batch_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_debt_payments_sale_paid_at
  ON public.customer_debt_payments(sale_id, paid_at DESC);

CREATE OR REPLACE FUNCTION public.sales_total_amount(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (total_amount NUMERIC, transaction_count BIGINT)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(s.total_amount), 0),
    COUNT(*)
  FROM public.sales s
  WHERE s.created_at >= p_start
    AND s.created_at <= p_end
    AND (
      NULLIF(trim(p_search), '') IS NULL
      OR s.invoice_no ILIKE '%' || trim(p_search) || '%'
      OR s.payment_method ILIKE '%' || trim(p_search) || '%'
    );
$$;

CREATE OR REPLACE FUNCTION public.vendor_payment_daily_summary(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (paid_date DATE, total_amount NUMERIC)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    (p.paid_at AT TIME ZONE 'Asia/Jakarta')::DATE,
    COALESCE(SUM(p.amount), 0)
  FROM public.vendor_debt_payments p
  WHERE p.paid_at >= p_start
    AND p.paid_at <= p_end
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.inventory_summary()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH active_products AS (
    SELECT id, name, stock, min_stock
    FROM public.products
    WHERE is_active = true
  ), low_stock_products AS (
    SELECT id, name, stock, min_stock
    FROM active_products
    WHERE stock <= min_stock
    ORDER BY name
    LIMIT 100
  )
  SELECT jsonb_build_object(
    'total_products', (SELECT COUNT(*) FROM active_products),
    'low_stock_count', (SELECT COUNT(*) FROM active_products WHERE stock <= min_stock),
    'low_stock_products', COALESCE(
      (SELECT jsonb_agg(to_jsonb(low_stock_products) ORDER BY name) FROM low_stock_products),
      '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.sales_total_amount(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_payment_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
