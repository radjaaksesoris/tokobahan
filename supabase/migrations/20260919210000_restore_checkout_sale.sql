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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;

  IF p_cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang';
  END IF;

  FOR item IN SELECT item_json FROM jsonb_array_elements(p_items) AS elements(item_json)
  LOOP
    requested_quantity := (item->>'quantity')::NUMERIC;
    IF requested_quantity IS NULL OR requested_quantity <= 0 THEN
      RAISE EXCEPTION 'Jumlah produk harus lebih besar dari 0';
    END IF;
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
    (item_element->>'product_id')::UUID,
    item_element->>'product_name',
    item_element->>'unit',
    (item_element->>'quantity')::NUMERIC,
    (item_element->>'conversion')::NUMERIC,
    (item_element->>'unit_price')::NUMERIC,
    (item_element->>'line_total')::NUMERIC,
    (item_element->>'line_cost')::NUMERIC,
    (item_element->>'line_profit')::NUMERIC
  FROM jsonb_array_elements(p_items) AS elements(item_element);

  FOR item IN SELECT item_json FROM jsonb_array_elements(p_items) AS elements(item_json)
  LOOP
    UPDATE public.products
    SET stock = stock - (item->>'quantity')::NUMERIC
    WHERE id = (item->>'product_id')::UUID
      AND stock >= (item->>'quantity')::NUMERIC;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name';
    END IF;
  END LOOP;

  RETURN new_sale_id;
END;
$$;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_nonnegative;
ALTER TABLE public.products ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0);

NOTIFY pgrst, 'reload schema';
