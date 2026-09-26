-- Add database-side aggregation, search indexes, and atomic operational reset.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON public.sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

DROP POLICY IF EXISTS "Invoice sequence is usable by authenticated users" ON public.invoice_sequences;
REVOKE ALL ON TABLE public.invoice_sequences FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;

DROP POLICY IF EXISTS "Sales full access" ON public.sales;
DROP POLICY IF EXISTS "Sales viewable by authenticated" ON public.sales;
CREATE POLICY "Sales viewable by authenticated"
  ON public.sales FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Sale items full access" ON public.sale_items;
DROP POLICY IF EXISTS "Sale items viewable by authenticated" ON public.sale_items;
CREATE POLICY "Sale items viewable by authenticated"
  ON public.sale_items FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales, public.sale_items FROM authenticated;

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

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) TO authenticated;

-- PostgreSQL cannot replace a function when its RETURNS TABLE columns differ.
DROP FUNCTION IF EXISTS public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.sales_daily_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    (created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(total_cost), 0),
    COALESCE(SUM(total_profit), 0),
    COUNT(*)
  FROM public.sales
  WHERE created_at >= p_start AND created_at <= p_end
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.reset_operational_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mereset database';
  END IF;

  TRUNCATE TABLE public.sale_items, public.sales, public.products, public.categories
    RESTART IDENTITY CASCADE;
  UPDATE public.invoice_sequences SET next_number = 1 WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_operational_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_operational_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
