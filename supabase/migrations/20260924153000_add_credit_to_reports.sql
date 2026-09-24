DROP FUNCTION IF EXISTS public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.sales_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  total_revenue NUMERIC,
  total_credit NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE((
      SELECT SUM(amount)
      FROM (
        SELECT s.amount_paid AS amount
        FROM public.sales s
        WHERE s.created_at >= p_start AND s.created_at <= p_end
        UNION ALL
        SELECT p.amount
        FROM public.customer_debt_payments p
        WHERE p.paid_at >= p_start AND p.paid_at <= p_end
      ) cash
    ), 0),
    COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'credit'), 0),
    COALESCE(SUM(s.total_cost), 0),
    COALESCE(SUM(s.total_profit), 0),
    COUNT(*)
  FROM public.sales s
  WHERE s.created_at >= p_start AND s.created_at <= p_end;
$$;

CREATE FUNCTION public.sales_daily_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  total_credit NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH daily_sales AS (
    SELECT
      (s.created_at AT TIME ZONE 'Asia/Jakarta')::DATE AS sale_date,
      COALESCE(SUM(s.total_cost), 0) AS total_cost,
      COALESCE(SUM(s.total_profit), 0) AS total_profit,
      COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'credit'), 0) AS total_credit,
      COUNT(*) AS transaction_count
    FROM public.sales s
    WHERE s.created_at >= p_start AND s.created_at <= p_end
    GROUP BY 1
  ),
  daily_cash AS (
    SELECT
      (s.created_at AT TIME ZONE 'Asia/Jakarta')::DATE AS sale_date,
      COALESCE(SUM(s.amount_paid), 0) AS amount
    FROM public.sales s
    WHERE s.created_at >= p_start AND s.created_at <= p_end
    GROUP BY 1
    UNION ALL
    SELECT
      (p.paid_at AT TIME ZONE 'Asia/Jakarta')::DATE AS sale_date,
      COALESCE(SUM(p.amount), 0) AS amount
    FROM public.customer_debt_payments p
    WHERE p.paid_at >= p_start AND p.paid_at <= p_end
    GROUP BY 1
  )
  SELECT
    COALESCE(s.sale_date, c.sale_date),
    COALESCE(SUM(c.amount), 0),
    COALESCE(s.total_credit, 0),
    COALESCE(s.total_cost, 0),
    COALESCE(s.total_profit, 0),
    COALESCE(s.transaction_count, 0)
  FROM daily_sales s
  FULL OUTER JOIN daily_cash c ON c.sale_date = s.sale_date
  GROUP BY s.sale_date, c.sale_date, s.total_credit, s.total_cost, s.total_profit, s.transaction_count
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
