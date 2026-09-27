BEGIN;

CREATE TABLE IF NOT EXISTS public.operational_reset_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  generation BIGINT NOT NULL DEFAULT 0
);

INSERT INTO public.operational_reset_state (id, generation)
VALUES (TRUE, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.operational_reset_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operational_reset_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_operational_reset_generation()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memeriksa status reset';
  END IF;

  RETURN (SELECT generation FROM public.operational_reset_state WHERE id = TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_reset_generation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_reset_generation() TO authenticated;

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

  UPDATE public.operational_reset_state
  SET generation = generation + 1
  WHERE id = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_operational_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_operational_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
