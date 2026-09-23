-- Keep the latest credit-sale checkout compatible with FIFO stock batches.
-- Also make retries safe when the client loses the response after a commit.
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT, p_total_amount NUMERIC, p_total_cost NUMERIC, p_total_profit NUMERIC,
  p_payment_method TEXT, p_cashier_id UUID, p_items JSONB,
  p_customer_name TEXT DEFAULT NULL, p_amount_paid NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_sale_id UUID;
  existing_sale_id UUID;
  customer_record UUID;
  paid NUMERIC := COALESCE(p_amount_paid, CASE WHEN p_payment_method = 'credit' THEN 0 ELSE p_total_amount END);
  item JSONB;
  batch RECORD;
  current_stock NUMERIC;
  requested_quantity NUMERIC;
  remaining_quantity NUMERIC;
  consumed_quantity NUMERIC;
  calculated_line_cost NUMERIC;
  calculated_total_cost NUMERIC := 0;
  calculated_total_amount NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL OR p_cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;

  SELECT id INTO existing_sale_id FROM public.sales WHERE invoice_no = p_invoice_no;
  IF existing_sale_id IS NOT NULL THEN
    RETURN existing_sale_id;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang';
  END IF;
  IF paid < 0 OR paid > p_total_amount THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;
  IF p_payment_method = 'credit' AND nullif(trim(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk transaksi kredit';
  END IF;
  IF p_payment_method = 'credit' THEN
    INSERT INTO public.customers(name) VALUES (trim(p_customer_name))
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO customer_record;
  END IF;

  CREATE TEMP TABLE fifo_checkout_items (
    product_id UUID NOT NULL,
    product_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity NUMERIC(15,3) NOT NULL,
    conversion NUMERIC(15,3) NOT NULL,
    unit_price NUMERIC(15,2) NOT NULL,
    line_total NUMERIC(15,2) NOT NULL,
    line_cost NUMERIC(15,2) NOT NULL,
    line_profit NUMERIC(15,2) NOT NULL
  ) ON COMMIT DROP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
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

    remaining_quantity := requested_quantity;
    calculated_line_cost := 0;
    FOR batch IN
      SELECT id, quantity_remaining, unit_cost
      FROM public.product_stock_batches
      WHERE product_id = (item->>'product_id')::UUID
        AND quantity_remaining > 0
      ORDER BY received_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN remaining_quantity <= 0;
      consumed_quantity := LEAST(remaining_quantity, batch.quantity_remaining);
      calculated_line_cost := calculated_line_cost + consumed_quantity * batch.unit_cost;
      UPDATE public.product_stock_batches
      SET quantity_remaining = quantity_remaining - consumed_quantity
      WHERE id = batch.id;
      remaining_quantity := remaining_quantity - consumed_quantity;
    END LOOP;
    IF remaining_quantity > 0 THEN
      RAISE EXCEPTION 'Batch HPP untuk % tidak mencukupi', item->>'product_name';
    END IF;

    INSERT INTO fifo_checkout_items
      (product_id, product_name, unit, quantity, conversion, unit_price, line_total, line_cost, line_profit)
    VALUES (
      (item->>'product_id')::UUID,
      item->>'product_name',
      item->>'unit',
      requested_quantity,
      COALESCE((item->>'conversion')::NUMERIC, 1),
      (item->>'unit_price')::NUMERIC,
      (item->>'line_total')::NUMERIC,
      calculated_line_cost,
      (item->>'line_total')::NUMERIC - calculated_line_cost
    );
    calculated_total_cost := calculated_total_cost + calculated_line_cost;
    calculated_total_amount := calculated_total_amount + (item->>'line_total')::NUMERIC;
  END LOOP;

  INSERT INTO public.sales
    (invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id, customer_id, amount_paid)
  VALUES
    (p_invoice_no, calculated_total_amount, calculated_total_cost,
     calculated_total_amount - calculated_total_cost, p_payment_method,
     p_cashier_id, customer_record, paid)
  RETURNING id INTO new_sale_id;

  INSERT INTO public.sale_items
    (sale_id, product_id, product_name, unit, quantity, conversion, unit_price, line_total, line_cost, line_profit)
  SELECT new_sale_id, product_id, product_name, unit, quantity, conversion,
    unit_price, line_total, line_cost, line_profit
  FROM fifo_checkout_items;

  UPDATE public.products p
  SET stock = p.stock - item.quantity, updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity) AS quantity
    FROM fifo_checkout_items
    GROUP BY product_id
  ) item
  WHERE p.id = item.product_id;

  RETURN new_sale_id;
END; $$;

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) TO authenticated;
NOTIFY pgrst, 'reload schema';
