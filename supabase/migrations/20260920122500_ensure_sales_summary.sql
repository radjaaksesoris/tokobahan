-- Ensure the profit-and-loss summary RPC exists in deployed databases.
CREATE OR REPLACE FUNCTION public.sales_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
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
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(total_cost), 0),
    COALESCE(SUM(total_profit), 0),
    COUNT(*)
  FROM public.sales
  WHERE created_at >= p_start AND created_at <= p_end;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
