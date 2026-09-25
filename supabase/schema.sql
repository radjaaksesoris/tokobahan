-- ============================================================
-- KonveksiPOS - Supabase Schema
-- Jalankan di SQL Editor Supabase Dashboard
-- ============================================================

-- Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier', 'monitor')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Categories (optional)
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Products with multi-unit pricing (JSONB)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost_unit TEXT NOT NULL DEFAULT 'satuan',
  cost_conversion NUMERIC(15,3) NOT NULL DEFAULT 1,
  stock_unit TEXT NOT NULL DEFAULT 'satuan',
  stock_conversion NUMERIC(15,3) NOT NULL DEFAULT 1,
  stock NUMERIC(15,3) NOT NULL DEFAULT 0,
  min_stock NUMERIC(15,3) NOT NULL DEFAULT 10,
  unit_base TEXT NOT NULL DEFAULT 'pcs',
  prices JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- prices example: [{"unit":"satuan","price":5000,"conversion":1},{"unit":"lusin","price":55000,"conversion":12}]
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_nonnegative;
ALTER TABLE public.products ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_unit TEXT NOT NULL DEFAULT 'satuan';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_conversion NUMERIC(15,3) NOT NULL DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_unit TEXT NOT NULL DEFAULT 'satuan';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_conversion NUMERIC(15,3) NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_products_name ON public.products USING gin (to_tsvector('indonesian', name));
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);

-- Sales header
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,
  total_amount NUMERIC(15,2) NOT NULL,
  total_cost NUMERIC(15,2) NOT NULL,
  total_profit NUMERIC(15,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  cashier_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON public.sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON public.sales(invoice_no);

CREATE OR REPLACE FUNCTION public.delete_sales_over_history_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stale_sale_ids UUID[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tokobahan.sales-history-cleanup'));

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO stale_sale_ids
  FROM (
    SELECT id
    FROM public.sales
    ORDER BY created_at ASC, id ASC
    OFFSET 900
  ) AS stale;

  IF cardinality(stale_sale_ids) > 0 THEN
    DELETE FROM public.sale_returns WHERE sale_id = ANY(stale_sale_ids);
    DELETE FROM public.customer_debt_payments WHERE sale_id = ANY(stale_sale_ids);
    DELETE FROM public.sale_items WHERE sale_id = ANY(stale_sale_ids);
    DELETE FROM public.sales WHERE id = ANY(stale_sale_ids);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limit_sales_history ON public.sales;
CREATE TRIGGER limit_sales_history
AFTER INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.delete_sales_over_history_limit();

REVOKE ALL ON FUNCTION public.delete_sales_over_history_limit() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sales_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
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
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(total_cost), 0),
    COALESCE(SUM(total_profit), 0),
    COUNT(*)
  FROM public.sales
  WHERE created_at >= p_start AND created_at <= p_end;
$$;

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

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL DEFAULT 1
);

INSERT INTO public.invoice_sequences (id, next_number)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_number INTEGER;
BEGIN
  UPDATE public.invoice_sequences
  SET next_number = next_number + 1
  WHERE id = 1
  RETURNING next_number - 1 INTO current_number;

  RETURN 'RJA-' || LPAD(current_number::TEXT, 4, '0');
END;
$$;

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Invoice sequence is usable by authenticated users"
  ON public.invoice_sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.invoice_sequences FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;

-- Sale items
CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(15,3) NOT NULL,
  conversion NUMERIC(15,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL,
  line_total NUMERIC(15,2) NOT NULL,
  line_cost NUMERIC(15,2) NOT NULL,
  line_profit NUMERIC(15,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

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

-- Refresh PostgREST after function changes so RPC calls see the current signature.
NOTIFY pgrst, 'reload schema';

-- Auto create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'cashier')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON public.products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_has_role(required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = ANY(required_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(TEXT[]) TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile; admins can manage staff visibility.
CREATE POLICY "Profiles viewable by self or admins"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.current_user_has_role(ARRAY['admin']));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Catalog and sales data are available only to users with an assigned store role.
CREATE POLICY "Products viewable by staff"
  ON public.products FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

CREATE POLICY "Products writable by admin or cashier"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_role(ARRAY['admin', 'cashier']));
CREATE POLICY "Products editable by admin or cashier"
  ON public.products FOR UPDATE TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']))
  WITH CHECK (public.current_user_has_role(ARRAY['admin', 'cashier']));
CREATE POLICY "Products removable by admin or cashier"
  ON public.products FOR DELETE TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']));

CREATE POLICY "Categories viewable by staff"
  ON public.categories FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));
CREATE POLICY "Categories writable by admin or cashier"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_role(ARRAY['admin', 'cashier']));
CREATE POLICY "Categories editable by admin or cashier"
  ON public.categories FOR UPDATE TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']))
  WITH CHECK (public.current_user_has_role(ARRAY['admin', 'cashier']));
CREATE POLICY "Categories removable by admin or cashier"
  ON public.categories FOR DELETE TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']));

CREATE POLICY "Sales viewable by staff"
  ON public.sales FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

CREATE POLICY "Sale items viewable by staff"
  ON public.sale_items FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales, public.sale_items FROM authenticated;

-- Enable Realtime for monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;

-- ============================================================
-- SAMPLE DATA (optional - hapus jika tidak perlu)
-- ============================================================
INSERT INTO public.categories (name) VALUES
  ('Jarum & Pin'),
  ('Benang'),
  ('Kancing & Resleting'),
  ('Kain'),
  ('Mesin & Sparepart')
ON CONFLICT DO NOTHING;

-- Example product
-- INSERT INTO public.products (name, sku, cost_price, stock, min_stock, prices) VALUES
-- ('Jarum Jahit Organ No.14', 'JRM-014', 150, 5000, 500,
--  '[{"unit":"satuan","price":250,"conversion":1},{"unit":"lusin","price":2800,"conversion":12},{"unit":"gross","price":30000,"conversion":144}]'::jsonb);
