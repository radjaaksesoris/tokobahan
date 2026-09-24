-- Merge credit sales for the same customer made on the same Jakarta calendar day.
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT, p_total_amount NUMERIC, p_total_cost NUMERIC, p_total_profit NUMERIC,
  p_payment_method TEXT, p_cashier_id UUID, p_items JSONB,
  p_customer_name TEXT DEFAULT NULL, p_amount_paid NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  merged_sale_id UUID;
  customer_record UUID;
  existing_item RECORD;
  item JSONB;
  current_stock NUMERIC;
  paid NUMERIC := COALESCE(p_amount_paid, CASE WHEN p_payment_method = 'credit' THEN 0 ELSE p_total_amount END);
BEGIN
  IF auth.uid() IS NULL OR p_cashier_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Kasir transaksi tidak valid'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang'; END IF;
  IF paid < 0 OR paid > p_total_amount THEN RAISE EXCEPTION 'Nominal pembayaran tidak valid'; END IF;
  IF p_payment_method = 'credit' AND nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk transaksi kredit'; END IF;

  IF p_payment_method = 'credit' THEN
    INSERT INTO public.customers(name) VALUES (trim(p_customer_name))
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO customer_record;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT stock INTO current_stock
    FROM public.products
    WHERE id = (item->>'product_id')::UUID
    FOR UPDATE;
    IF current_stock IS NULL OR current_stock < (item->>'quantity')::NUMERIC THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name';
    END IF;
  END LOOP;

  IF p_payment_method = 'credit' THEN
    SELECT id INTO merged_sale_id
    FROM public.sales
    WHERE customer_id = customer_record
      AND payment_method = 'credit'
      AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF merged_sale_id IS NULL THEN
    INSERT INTO public.sales(invoice_no,total_amount,total_cost,total_profit,payment_method,cashier_id,customer_id,amount_paid)
    VALUES (p_invoice_no,p_total_amount,p_total_cost,p_total_profit,p_payment_method,p_cashier_id,customer_record,paid)
    RETURNING id INTO merged_sale_id;
  ELSE
    UPDATE public.sales
    SET total_amount = total_amount + p_total_amount,
        total_cost = total_cost + p_total_cost,
        total_profit = total_profit + p_total_profit,
        amount_paid = amount_paid + paid
    WHERE id = merged_sale_id;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT si.id INTO existing_item
    FROM public.sale_items AS si
    WHERE si.sale_id = merged_sale_id
      AND si.product_id = (item->>'product_id')::UUID
      AND si.unit = item->>'unit'
      AND si.unit_price = (item->>'unit_price')::NUMERIC
    LIMIT 1
    FOR UPDATE;

    IF existing_item.id IS NULL THEN
      INSERT INTO public.sale_items(sale_id,product_id,product_name,unit,quantity,conversion,unit_price,line_total,line_cost,line_profit)
      VALUES (
        merged_sale_id,(item->>'product_id')::UUID,item->>'product_name',item->>'unit',
        (item->>'quantity')::NUMERIC,(item->>'conversion')::NUMERIC,(item->>'unit_price')::NUMERIC,
        (item->>'line_total')::NUMERIC,(item->>'line_cost')::NUMERIC,(item->>'line_profit')::NUMERIC
      );
    ELSE
      UPDATE public.sale_items
      SET quantity = quantity + (item->>'quantity')::NUMERIC,
          line_total = line_total + (item->>'line_total')::NUMERIC,
          line_cost = line_cost + (item->>'line_cost')::NUMERIC,
          line_profit = line_profit + (item->>'line_profit')::NUMERIC
      WHERE id = existing_item.id;
    END IF;

    UPDATE public.products
    SET stock = stock - (item->>'quantity')::NUMERIC
    WHERE id = (item->>'product_id')::UUID;
  END LOOP;

  RETURN merged_sale_id;
END; $$;

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,TEXT,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,TEXT,NUMERIC) TO authenticated;
NOTIFY pgrst, 'reload schema';
