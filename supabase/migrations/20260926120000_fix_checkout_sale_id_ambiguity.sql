-- Fix checkout RPC failure caused by the PL/pgSQL variable sale_id sharing
-- the same name as sale_items.sale_id.
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT,
  p_total_amount NUMERIC,
  p_total_cost NUMERIC,
  p_total_profit NUMERIC,
  p_payment_method TEXT,
  p_cashier_id UUID,
  p_items JSONB,
  p_customer_name TEXT DEFAULT NULL,
  p_amount_paid NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_customer_id UUID;
  existing_item RECORD;
  item JSONB;
  batch RECORD;
  current_stock NUMERIC;
  requested_quantity NUMERIC;
  remaining_quantity NUMERIC;
  consumed_quantity NUMERIC;
  calculated_line_cost NUMERIC;
  calculated_total_cost NUMERIC := 0;
  calculated_total_amount NUMERIC := 0;
  paid NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Hanya admin atau cashier yang dapat membuat transaksi';
  END IF;
  IF auth.uid() IS NULL OR p_cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;
  IF nullif(trim(p_invoice_no), '') IS NULL THEN
    RAISE EXCEPTION 'Nomor transaksi wajib diisi';
  END IF;
  IF p_payment_method NOT IN ('cash', 'qris', 'credit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak didukung';
  END IF;

  SELECT ci.sale_id INTO v_sale_id
  FROM public.checkout_idempotency ci
  WHERE ci.invoice_no = p_invoice_no;
  IF v_sale_id IS NOT NULL THEN RETURN v_sale_id; END IF;

  SELECT s.id INTO v_sale_id FROM public.sales s WHERE s.invoice_no = p_invoice_no;
  IF v_sale_id IS NOT NULL THEN
    INSERT INTO public.checkout_idempotency(invoice_no, sale_id)
    VALUES (p_invoice_no, v_sale_id)
    ON CONFLICT (invoice_no) DO NOTHING;
    RETURN v_sale_id;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang';
  END IF;
  paid := COALESCE(p_amount_paid, CASE WHEN p_payment_method = 'credit' THEN 0 ELSE p_total_amount END);
  IF paid < 0 THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;
  IF p_payment_method = 'credit' AND nullif(trim(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk transaksi kredit';
  END IF;

  IF p_payment_method = 'credit' THEN
    INSERT INTO public.customers(name)
    VALUES (trim(p_customer_name))
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_customer_id;
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
    IF (item->>'unit_price')::NUMERIC IS NULL OR (item->>'unit_price')::NUMERIC < 0
       OR (item->>'line_total')::NUMERIC IS NULL THEN
      RAISE EXCEPTION 'Detail harga transaksi tidak valid';
    END IF;

    SELECT p.stock INTO current_stock
    FROM public.products p
    WHERE p.id = (item->>'product_id')::UUID
    FOR UPDATE;
    IF current_stock IS NULL OR current_stock < requested_quantity THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name';
    END IF;

    remaining_quantity := requested_quantity;
    calculated_line_cost := 0;
    FOR batch IN
      SELECT b.id, b.quantity_remaining, b.unit_cost
      FROM public.product_stock_batches b
      WHERE b.product_id = (item->>'product_id')::UUID
        AND b.quantity_remaining > 0
      ORDER BY b.received_at, b.id
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
      ROUND((item->>'unit_price')::NUMERIC * requested_quantity, 2),
      calculated_line_cost,
      ROUND((item->>'unit_price')::NUMERIC * requested_quantity - calculated_line_cost, 2)
    );
    calculated_total_cost := calculated_total_cost + calculated_line_cost;
    calculated_total_amount := calculated_total_amount + ROUND((item->>'unit_price')::NUMERIC * requested_quantity, 2);
  END LOOP;

  IF p_payment_method = 'credit' AND paid > calculated_total_amount THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;

  IF p_payment_method = 'credit' THEN
    SELECT s.id INTO v_sale_id
    FROM public.sales s
    WHERE s.customer_id = v_customer_id
      AND s.payment_method = 'credit'
      AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date
    ORDER BY s.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_sale_id IS NULL THEN
    INSERT INTO public.sales(invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id, customer_id, amount_paid)
    VALUES (p_invoice_no, calculated_total_amount, calculated_total_cost,
      calculated_total_amount - calculated_total_cost, p_payment_method, p_cashier_id, v_customer_id, paid)
    RETURNING id INTO v_sale_id;
  ELSE
    UPDATE public.sales
    SET total_amount = total_amount + calculated_total_amount,
        total_cost = total_cost + calculated_total_cost,
        total_profit = total_profit + (calculated_total_amount - calculated_total_cost),
        amount_paid = amount_paid + paid
    WHERE public.sales.id = v_sale_id;
  END IF;

  FOR item IN SELECT row_to_json(f)::JSONB FROM fifo_checkout_items f LOOP
    SELECT si.id INTO existing_item
    FROM public.sale_items si
    WHERE si.sale_id = v_sale_id
      AND si.product_id = (item->>'product_id')::UUID
      AND si.unit = item->>'unit'
      AND si.unit_price = (item->>'unit_price')::NUMERIC
    LIMIT 1
    FOR UPDATE;

    IF existing_item.id IS NULL THEN
      INSERT INTO public.sale_items(sale_id, product_id, product_name, unit, quantity, conversion, unit_price, line_total, line_cost, line_profit)
      VALUES (v_sale_id, (item->>'product_id')::UUID, item->>'product_name', item->>'unit',
        (item->>'quantity')::NUMERIC, (item->>'conversion')::NUMERIC, (item->>'unit_price')::NUMERIC,
        (item->>'line_total')::NUMERIC, (item->>'line_cost')::NUMERIC, (item->>'line_profit')::NUMERIC);
    ELSE
      UPDATE public.sale_items
      SET quantity = quantity + (item->>'quantity')::NUMERIC,
          line_total = line_total + (item->>'line_total')::NUMERIC,
          line_cost = line_cost + (item->>'line_cost')::NUMERIC,
          line_profit = line_profit + (item->>'line_profit')::NUMERIC
      WHERE public.sale_items.id = existing_item.id;
    END IF;
  END LOOP;

  UPDATE public.products p
  SET stock = p.stock - x.quantity, updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity) AS quantity
    FROM fifo_checkout_items
    GROUP BY product_id
  ) x
  WHERE p.id = x.product_id;

  INSERT INTO public.checkout_idempotency(invoice_no, sale_id)
  VALUES (p_invoice_no, v_sale_id)
  ON CONFLICT (invoice_no) DO NOTHING;
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
