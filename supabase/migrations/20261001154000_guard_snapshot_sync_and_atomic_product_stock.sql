BEGIN;

CREATE TABLE IF NOT EXISTS public.operational_data_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO public.operational_data_state(singleton, revision)
VALUES (TRUE, 0)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.operational_data_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_data_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bump_operational_data_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.operational_data_state
  SET revision = revision + 1
  WHERE singleton = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status versi data operasional tidak tersedia';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_operational_data_revision() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories',
    'vendors',
    'custom_units',
    'products',
    'product_stock_batches',
    'customers',
    'sales',
    'sale_items',
    'vendor_debt_payments',
    'customer_debt_payments',
    'stock_adjustments',
    'sale_returns',
    'settlement_idempotency'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS operational_revision_%I ON public.%I',
      table_name,
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER operational_revision_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_operational_data_revision()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_operational_data_revision()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_revision BIGINT;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memeriksa versi data operasional';
  END IF;
  SELECT revision INTO current_revision
  FROM public.operational_data_state
  WHERE singleton = TRUE;
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'Status versi data operasional tidak tersedia';
  END IF;
  RETURN current_revision::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_data_revision() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_data_revision() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_operational_backup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  backup_id UUID;
  backup_payload JSONB;
  current_revision BIGINT;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat membuat backup';
  END IF;

  SELECT revision INTO current_revision
  FROM public.operational_data_state
  WHERE singleton = TRUE
  FOR UPDATE;
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'Status versi data operasional tidak tersedia';
  END IF;

  backup_payload := jsonb_build_object(
    'format', 'tokobahan-operational-backup',
    'version', '3',
    'generated_at', now(),
    'generated_by', auth.uid(),
    'server_revision', current_revision::TEXT,
    'tables', jsonb_build_object(
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.categories x), '[]'::JSONB),
      'vendors', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.vendors x), '[]'::JSONB),
      'custom_units', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.custom_units x), '[]'::JSONB),
      'products', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.products x), '[]'::JSONB),
      'product_stock_batches', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at, x.id) FROM public.product_stock_batches x), '[]'::JSONB),
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.customers x), '[]'::JSONB),
      'sales', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sales x), '[]'::JSONB),
      'sale_items', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sale_id, x.id) FROM public.sale_items x), '[]'::JSONB),
      'vendor_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.vendor_debt_payments x), '[]'::JSONB),
      'customer_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.customer_debt_payments x), '[]'::JSONB),
      'stock_adjustments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.stock_adjustments x), '[]'::JSONB),
      'sale_returns', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sale_returns x), '[]'::JSONB),
      'settlement_idempotency', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.settlement_idempotency x), '[]'::JSONB)
    )
  );

  INSERT INTO public.operational_backups(created_by, payload)
  VALUES (auth.uid(), backup_payload)
  RETURNING id INTO backup_id;

  RETURN jsonb_build_object(
    'id', backup_id,
    'created_at', backup_payload->>'generated_at',
    'server_revision', current_revision::TEXT,
    'payload', backup_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_stock_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.current_user_has_role(ARRAY['admin'])
     AND pg_catalog.current_setting('tokobahan.sync_operational_snapshot', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF public.current_user_has_role(ARRAY['admin', 'cashier'])
     AND pg_catalog.current_setting('tokobahan.receive_stock_batch', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.stock > 0 THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    )
    VALUES (NEW.id, NEW.stock, NEW.stock, NEW.cost_price);
  ELSIF TG_OP = 'UPDATE' AND NEW.stock > OLD.stock THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    )
    VALUES (NEW.id, NEW.stock - OLD.stock, NEW.stock - OLD.stock, NEW.cost_price);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_batch() FROM PUBLIC, anon, authenticated;

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
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_flag TEXT;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Tidak memiliki akses penerimaan stok';
  END IF;
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
  IF p_vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vendors WHERE id = p_vendor_id
  ) THEN
    RAISE EXCEPTION 'Vendor tidak ditemukan';
  END IF;

  previous_flag := pg_catalog.current_setting('tokobahan.receive_stock_batch', true);
  PERFORM pg_catalog.set_config('tokobahan.receive_stock_batch', 'on', true);
  UPDATE public.products
  SET stock = stock + p_quantity,
      cost_price = p_unit_cost,
      updated_at = now()
  WHERE id = p_product_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif';
  END IF;
  PERFORM pg_catalog.set_config(
    'tokobahan.receive_stock_batch',
    COALESCE(previous_flag, ''),
    true
  );

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

CREATE OR REPLACE FUNCTION public.create_product_with_initial_stock(
  p_name TEXT,
  p_sku TEXT,
  p_cost_price NUMERIC,
  p_cost_unit TEXT,
  p_cost_conversion NUMERIC,
  p_stock_unit TEXT,
  p_stock_conversion NUMERIC,
  p_min_stock NUMERIC,
  p_unit_base TEXT,
  p_prices JSONB,
  p_initial_stock NUMERIC,
  p_vendor_id UUID,
  p_payment_status TEXT,
  p_due_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  product_id UUID;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat membuat produk';
  END IF;
  IF NULLIF(BTRIM(p_name), '') IS NULL OR NULLIF(BTRIM(p_sku), '') IS NULL THEN
    RAISE EXCEPTION 'Nama produk dan SKU wajib diisi';
  END IF;
  IF p_cost_price <= 0 OR p_cost_conversion <= 0 OR p_stock_conversion <= 0
     OR p_min_stock < 0 OR p_initial_stock < 0
     OR p_cost_price IS NULL OR p_cost_conversion IS NULL
     OR p_stock_conversion IS NULL OR p_min_stock IS NULL
     OR p_initial_stock IS NULL THEN
    RAISE EXCEPTION 'Data harga, konversi, atau stok produk tidak valid';
  END IF;
  IF p_unit_base IS NULL OR p_unit_base NOT IN ('pcs', 'meter')
     OR NULLIF(BTRIM(p_cost_unit), '') IS NULL
     OR NULLIF(BTRIM(p_stock_unit), '') IS NULL
     OR p_payment_status NOT IN ('kredit', 'lunas')
     OR p_payment_status IS NULL
     OR p_prices IS NULL
     OR pg_catalog.jsonb_typeof(p_prices) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_prices) = 0 THEN
    RAISE EXCEPTION 'Satuan dasar atau daftar harga produk tidak valid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_prices) AS entry(value)
    WHERE pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
       OR NULLIF(BTRIM(entry.value->>'unit'), '') IS NULL
       OR pg_catalog.jsonb_typeof(entry.value->'price') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(entry.value->'conversion') IS DISTINCT FROM 'number'
       OR (entry.value->>'price')::NUMERIC <= 0
       OR (entry.value->>'conversion')::NUMERIC <= 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_prices) AS entry(value)
    GROUP BY entry.value->>'unit'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Daftar harga produk tidak valid';
  END IF;
  IF p_initial_stock > 0 AND p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor wajib dipilih untuk stok awal';
  END IF;
  IF p_initial_stock > 0 AND p_payment_status = 'kredit' AND p_due_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk stok awal kredit';
  END IF;

  INSERT INTO public.products(
    name, sku, cost_price, cost_unit, cost_conversion, stock,
    stock_unit, stock_conversion, min_stock, unit_base, prices, is_active
  )
  VALUES (
    BTRIM(p_name), BTRIM(p_sku), p_cost_price, p_cost_unit, p_cost_conversion, 0,
    p_stock_unit, p_stock_conversion, p_min_stock, p_unit_base, p_prices, TRUE
  )
  RETURNING id INTO product_id;

  IF p_initial_stock > 0 THEN
    PERFORM public.receive_stock_batch(
      product_id,
      p_initial_stock,
      p_cost_price,
      p_vendor_id,
      p_payment_status,
      p_due_date
    );
  END IF;
  RETURN product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_with_initial_stock(
  TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, JSONB, NUMERIC, UUID, TEXT, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_initial_stock(
  TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, JSONB, NUMERIC, UUID, TEXT, DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_operational_snapshot(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_revision BIGINT;
  backup_result JSONB;
  table_name TEXT;
  required_tables CONSTANT TEXT[] := ARRAY[
    'categories', 'vendors', 'custom_units', 'products', 'product_stock_batches',
    'customers', 'sales', 'sale_items', 'vendor_debt_payments',
    'customer_debt_payments', 'stock_adjustments', 'sale_returns',
    'settlement_idempotency'
  ];
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat menyinkronkan snapshot operasional';
  END IF;
  SELECT revision INTO current_revision
  FROM public.operational_data_state
  WHERE singleton = TRUE
  FOR UPDATE;
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'Status versi data operasional tidak tersedia';
  END IF;
  IF p_payload->>'format' IS DISTINCT FROM 'tokobahan-operational-backup'
     OR p_payload->>'version' IS DISTINCT FROM '3'
     OR (p_payload->>'server_revision') IS DISTINCT FROM current_revision::TEXT THEN
    RAISE EXCEPTION 'Data server berubah sejak snapshot lokal dibuat. Ambil snapshot terbaru sebelum sinkronisasi.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload->'tables') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Snapshot operasional harus memuat objek tabel';
  END IF;

  FOREACH table_name IN ARRAY required_tables
  LOOP
    IF pg_catalog.jsonb_typeof(p_payload->'tables'->table_name) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Data tabel % tidak lengkap atau tidak valid', table_name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_payload->'tables'->table_name) AS row_data(item)
      WHERE pg_catalog.jsonb_typeof(row_data.item) IS DISTINCT FROM 'object'
    ) THEN
      RAISE EXCEPTION 'Data tabel % memuat baris yang tidak valid', table_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_payload->'tables') AS table_key(key)
    WHERE NOT (table_key.key = ANY(required_tables))
  ) THEN
    RAISE EXCEPTION 'Snapshot operasional memuat kunci tabel yang tidak dikenal';
  END IF;

  backup_result := public.create_operational_backup();
  PERFORM public.restore_operational_backup(p_payload);
  SELECT revision INTO current_revision
  FROM public.operational_data_state
  WHERE singleton = TRUE;
  RETURN jsonb_build_object(
    'id', backup_result->'id',
    'created_at', backup_result->'created_at',
    'server_revision', current_revision::TEXT
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_operational_snapshot(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_operational_snapshot(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
