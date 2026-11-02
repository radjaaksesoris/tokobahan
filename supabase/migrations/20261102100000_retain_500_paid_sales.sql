BEGIN;

CREATE OR REPLACE FUNCTION public.prune_sales_history()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stale_sale_ids UUID[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('tokobahan.sales-history-cleanup')
  );

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO stale_sale_ids
  FROM (
    SELECT sale.id
    FROM public.sales AS sale
    LEFT JOIN (
      SELECT sale_id, SUM(amount) AS total_paid
      FROM public.customer_debt_payments
      GROUP BY sale_id
    ) AS payments ON payments.sale_id = sale.id
    WHERE sale.payment_method <> 'credit'
       OR GREATEST(
         sale.total_amount - sale.amount_paid - COALESCE(payments.total_paid, 0),
         0
       ) <= 0.009
    ORDER BY sale.created_at DESC NULLS FIRST, sale.id DESC
    OFFSET 500
  ) AS stale;

  IF cardinality(stale_sale_ids) > 0 THEN
    DELETE FROM public.sale_returns
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.customer_debt_payments
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.sale_items
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.sales
    WHERE id = ANY(stale_sale_ids);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_sales_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prune_sales_history_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.prune_sales_history();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_sales_history_after_change()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS limit_sales_history ON public.sales;
DROP TRIGGER IF EXISTS prune_sales_history_after_insert ON public.sales;
CREATE TRIGGER prune_sales_history_after_insert
AFTER INSERT ON public.sales
FOR EACH STATEMENT
EXECUTE FUNCTION public.prune_sales_history_after_change();

DROP TRIGGER IF EXISTS prune_sales_history_after_payment ON public.customer_debt_payments;
CREATE TRIGGER prune_sales_history_after_payment
AFTER INSERT OR UPDATE ON public.customer_debt_payments
FOR EACH STATEMENT
EXECUTE FUNCTION public.prune_sales_history_after_change();

SELECT public.prune_sales_history();

COMMIT;
