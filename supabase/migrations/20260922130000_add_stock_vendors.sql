CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_lower ON public.vendors (lower(name));

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vendors viewable by authenticated" ON public.vendors;
CREATE POLICY "Vendors viewable by authenticated"
  ON public.vendors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Vendors manageable by admins" ON public.vendors;
CREATE POLICY "Vendors manageable by admins"
  ON public.vendors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
GRANT SELECT ON public.vendors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.vendors TO authenticated;

ALTER TABLE public.product_stock_batches
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'lunas'
    CHECK (payment_status IN ('kredit', 'lunas')),
  ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE public.product_stock_batches
  DROP CONSTRAINT IF EXISTS product_stock_batches_credit_due_date_check;
ALTER TABLE public.product_stock_batches
  ADD CONSTRAINT product_stock_batches_credit_due_date_check
  CHECK (payment_status = 'lunas' OR due_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_stock_batches_vendor ON public.product_stock_batches(vendor_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.record_stock_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.stock > 0 THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    )
    VALUES (NEW.id, NEW.stock, NEW.stock, NEW.cost_price);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_stock_batch(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_vendor_id UUID DEFAULT NULL,
  p_payment_status TEXT DEFAULT 'lunas',
  p_due_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Jumlah stok masuk harus lebih besar dari 0';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'HPP tidak boleh negatif';
  END IF;
  IF p_payment_status NOT IN ('kredit', 'lunas') THEN
    RAISE EXCEPTION 'Status pembayaran tidak valid';
  END IF;
  IF p_payment_status = 'kredit' AND p_due_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk transaksi kredit';
  END IF;
  IF p_vendor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'Vendor tidak ditemukan';
  END IF;

  UPDATE public.products
  SET stock = stock + p_quantity,
      cost_price = p_unit_cost,
      updated_at = now()
  WHERE id = p_product_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau sudah tidak aktif';
  END IF;

  INSERT INTO public.product_stock_batches (
    product_id, quantity_received, quantity_remaining, unit_cost,
    vendor_id, payment_status, due_date
  )
  VALUES (
    p_product_id, p_quantity, p_quantity, p_unit_cost,
    p_vendor_id, p_payment_status, p_due_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
