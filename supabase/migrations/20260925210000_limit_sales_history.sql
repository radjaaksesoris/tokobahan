-- Keep at most 900 sales and remove their dependent records together.
-- This runs inside the checkout transaction, so a failed cleanup rolls back.

CREATE OR REPLACE FUNCTION public.delete_sales_over_history_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stale_sale_ids UUID[];
BEGIN
  -- Serialize cleanup so concurrent checkouts cannot both retain more than
  -- the configured history limit.
  PERFORM pg_advisory_xact_lock(hashtext('tokobahan.sales-history-cleanup'));

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO stale_sale_ids
  FROM (
    SELECT id
    FROM public.sales
    ORDER BY created_at ASC, id ASC
    OFFSET 900
  ) AS stale;

  IF cardinality(stale_sale_ids) > 0 THEN
    -- sale_returns references sale_items with ON DELETE RESTRICT, so remove
    -- dependent rows explicitly before deleting the sale itself.
    DELETE FROM public.sale_returns
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.customer_debt_payments
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.sale_items
    WHERE sale_id = ANY(stale_sale_ids);

    DELETE FROM public.sales
    WHERE id = ANY(stale_sale_ids);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limit_sales_history ON public.sales;
CREATE TRIGGER limit_sales_history
AFTER INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.delete_sales_over_history_limit();

REVOKE ALL ON FUNCTION public.delete_sales_over_history_limit() FROM PUBLIC;

