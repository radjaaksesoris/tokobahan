-- Customer master, credit sales, and partial debt payments.
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name)
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);

CREATE TABLE IF NOT EXISTS public.vendor_debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_batch_id UUID NOT NULL REFERENCES public.product_stock_batches(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.customer_debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_debt_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers full access" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Vendor debt payments full access" ON public.vendor_debt_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Customer debt payments full access" ON public.customer_debt_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT, p_total_amount NUMERIC, p_total_cost NUMERIC, p_total_profit NUMERIC,
  p_payment_method TEXT, p_cashier_id UUID, p_items JSONB,
  p_customer_name TEXT DEFAULT NULL, p_amount_paid NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_sale_id UUID;
  customer_record UUID;
  paid NUMERIC := COALESCE(p_amount_paid, CASE WHEN p_payment_method = 'credit' THEN 0 ELSE p_total_amount END);
  item JSONB;
  current_stock NUMERIC;
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
    SELECT stock INTO current_stock FROM public.products WHERE id = (item->>'product_id')::UUID FOR UPDATE;
    IF current_stock IS NULL OR current_stock < (item->>'quantity')::NUMERIC THEN RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name'; END IF;
  END LOOP;
  INSERT INTO public.sales(invoice_no,total_amount,total_cost,total_profit,payment_method,cashier_id,customer_id,amount_paid)
  VALUES (p_invoice_no,p_total_amount,p_total_cost,p_total_profit,p_payment_method,p_cashier_id,customer_record,paid) RETURNING id INTO new_sale_id;
  INSERT INTO public.sale_items(sale_id,product_id,product_name,unit,quantity,conversion,unit_price,line_total,line_cost,line_profit)
  SELECT new_sale_id,(value->>'product_id')::UUID,value->>'product_name',value->>'unit',(value->>'quantity')::NUMERIC,
    (value->>'conversion')::NUMERIC,(value->>'unit_price')::NUMERIC,(value->>'line_total')::NUMERIC,
    (value->>'line_cost')::NUMERIC,(value->>'line_profit')::NUMERIC FROM jsonb_array_elements(p_items);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    UPDATE public.products SET stock = stock - (item->>'quantity')::NUMERIC WHERE id = (item->>'product_id')::UUID;
  END LOOP;
  RETURN new_sale_id;
END; $$;

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,TEXT,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,TEXT,NUMERIC) TO authenticated;
NOTIFY pgrst, 'reload schema';
