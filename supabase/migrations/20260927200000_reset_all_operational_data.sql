BEGIN;

CREATE OR REPLACE FUNCTION public.reset_operational_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mereset database';
  END IF;

  DELETE FROM public.settlement_idempotency;
  DELETE FROM public.vendor_debt_payments;
  DELETE FROM public.customer_debt_payments;
  DELETE FROM public.sale_returns;
  DELETE FROM public.stock_adjustments;
  DELETE FROM public.sale_items;
  DELETE FROM public.sales;
  DELETE FROM public.checkout_idempotency;
  DELETE FROM public.product_stock_batches;
  DELETE FROM public.products;
  DELETE FROM public.customers;
  DELETE FROM public.custom_units;
  DELETE FROM public.vendors;
  DELETE FROM public.categories;
  DELETE FROM public.low_stock_notification_log;

  UPDATE public.invoice_sequences
  SET next_number = 1
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_operational_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_operational_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
