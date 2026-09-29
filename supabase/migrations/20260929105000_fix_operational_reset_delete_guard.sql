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

  DELETE FROM public.settlement_idempotency WHERE TRUE;
  DELETE FROM public.vendor_debt_payments WHERE TRUE;
  DELETE FROM public.customer_debt_payments WHERE TRUE;
  DELETE FROM public.sale_returns WHERE TRUE;
  DELETE FROM public.stock_adjustments WHERE TRUE;
  DELETE FROM public.sale_items WHERE TRUE;
  DELETE FROM public.sales WHERE TRUE;
  DELETE FROM public.checkout_idempotency WHERE TRUE;
  DELETE FROM public.product_stock_batches WHERE TRUE;
  DELETE FROM public.products WHERE TRUE;
  DELETE FROM public.customers WHERE TRUE;
  DELETE FROM public.custom_units WHERE TRUE;
  DELETE FROM public.vendors WHERE TRUE;
  DELETE FROM public.categories WHERE TRUE;
  DELETE FROM public.low_stock_notification_log WHERE TRUE;

  UPDATE public.invoice_sequences
  SET next_number = 1
  WHERE id = 1;

  UPDATE public.operational_reset_state
  SET generation = generation + 1
  WHERE id = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_operational_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_operational_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
