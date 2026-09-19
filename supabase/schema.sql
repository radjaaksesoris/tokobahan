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
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "Profiles are viewable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Products: all authenticated can CRUD (simplify for single store)
CREATE POLICY "Products full access for authenticated"
  ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Categories full access"
  ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sales: all authenticated
CREATE POLICY "Sales full access"
  ON public.sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Sale items full access"
  ON public.sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

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
