-- Restore the atomic checkout RPC in environments provisioned before checkout_sale
-- was introduced, then refresh PostgREST's schema cache.
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT,
  p_total_amount NUMERIC,
  p_total_cost NUMERIC,
  p_total_profit NUMERIC,
  p_payment_method TEXT,
  p_cashier_id UUID,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_sale_id UUID;
  item JSONB;
  current_stock NUMERIC;
  requested_quantity NUMERIC;
BEGIN
  FOR item IN SELECT item_json FROM jsonb_array_elements(p_items) AS elements(item_json)
  LOOP
    requested_quantity := (item->>'quantity')::NUMERIC;
    SELECT stock INTO current_stock
    FROM public.products
    WHERE id = (item->>'product_id')::UUID
    FOR UPDATE;

    IF current_stock IS NULL OR current_stock < requested_quantity THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name';
    END IF;
  END LOOP;

  INSERT INTO public.sales (
    invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id
  )
  VALUES (
    p_invoice_no, p_total_amount, p_total_cost, p_total_profit, p_payment_method, p_cashier_id
  )
  RETURNING id INTO new_sale_id;

  INSERT INTO public.sale_items (
    sale_id, product_id, product_name, unit, quantity, conversion,
    unit_price, line_total, line_cost, line_profit
  )
  SELECT
    new_sale_id,
    (item->>'product_id')::UUID,
    item->>'product_name',
    item->>'unit',
    (item->>'quantity')::NUMERIC,
    (item->>'conversion')::NUMERIC,
    (item->>'unit_price')::NUMERIC,
    (item->>'line_total')::NUMERIC,
    (item->>'line_cost')::NUMERIC,
    (item->>'line_profit')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  FOR item IN SELECT item_json FROM jsonb_array_elements(p_items) AS elements(item_json)
  LOOP
    UPDATE public.products
    SET stock = stock - (item->>'quantity')::NUMERIC
    WHERE id = (item->>'product_id')::UUID;
  END LOOP;

  RETURN new_sale_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
