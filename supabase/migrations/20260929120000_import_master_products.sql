CREATE TABLE IF NOT EXISTS public.product_import_batches (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  imported_count INTEGER NOT NULL CHECK (imported_count BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

ALTER TABLE public.product_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_import_batches FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_products_sku_normalized
  ON public.products (lower(trim(sku)))
  WHERE sku IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_duplicate_product_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.sku := NULLIF(trim(NEW.sku), '');
  IF NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(NEW.sku), 0));
  IF EXISTS (
    SELECT 1
    FROM public.products product
    WHERE lower(trim(product.sku)) = lower(NEW.sku)
  ) THEN
    RAISE EXCEPTION 'SKU "%" sudah digunakan. SKU harus unik tanpa membedakan huruf besar/kecil.', NEW.sku
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_reject_duplicate_sku ON public.products;
CREATE TRIGGER products_reject_duplicate_sku
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_duplicate_product_sku();

REVOKE ALL ON FUNCTION public.reject_duplicate_product_sku() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_master_products(
  p_rows JSONB,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_imported_count INTEGER := 0;
  v_row JSONB;
  v_product_id UUID;
  v_vendor_id UUID;
  v_vendor_name TEXT;
  v_name TEXT;
  v_sku TEXT;
  v_barcode TEXT;
  v_stock_unit TEXT;
  v_cost_unit TEXT;
  v_unit_base TEXT;
  v_stock NUMERIC;
  v_min_stock NUMERIC;
  v_cost_price NUMERIC;
  v_cost_conversion NUMERIC;
  v_payment_status TEXT;
  v_due_date DATE;
  v_prices JSONB;
  v_price JSONB;
  v_price_rows JSONB;
  v_price_unit TEXT;
  v_price_number NUMERIC;
  v_conversion NUMERIC;
  v_seen_units TEXT[];
  v_index INTEGER := 0;
  v_idempotent_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Akses impor hanya untuk admin';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci impor tidak valid';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Data baris impor tidak valid';
  END IF;
  IF jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Jumlah baris impor harus antara 1 dan 500';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT || ':' || p_idempotency_key::TEXT, 0));
  SELECT imported_count INTO v_idempotent_count
  FROM public.product_import_batches
  WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('imported_count', v_idempotent_count, 'replayed', TRUE);
  END IF;

  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT lower(trim(item.value ->> 'sku'))
    FROM jsonb_array_elements(p_rows) AS item(value)
    GROUP BY lower(trim(item.value ->> 'sku'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SKU berulang di dalam file. Periksa kembali kolom SKU.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS item(value)
    JOIN public.products product
      ON lower(trim(product.sku)) = lower(trim(item.value ->> 'sku'))
  ) THEN
    RAISE EXCEPTION 'SKU sudah digunakan produk yang ada. Impor hanya menambahkan produk baru.';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_index := v_index + 1;
    v_name := NULLIF(trim(v_row ->> 'name'), '');
    v_sku := NULLIF(trim(v_row ->> 'sku'), '');
    v_barcode := NULLIF(trim(v_row ->> 'barcode'), '');
    IF v_name IS NULL OR v_sku IS NULL THEN
      RAISE EXCEPTION 'Baris %: nama produk dan SKU wajib diisi', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;

    v_stock := NULLIF(v_row ->> 'opening_stock', '')::NUMERIC;
    v_min_stock := NULLIF(v_row ->> 'min_stock', '')::NUMERIC;
    v_cost_price := NULLIF(v_row ->> 'cost_price', '')::NUMERIC;
    v_cost_conversion := NULLIF(v_row ->> 'cost_conversion', '')::NUMERIC;
    IF v_stock IS NULL OR v_stock < 0 OR v_min_stock IS NULL OR v_min_stock < 0
       OR v_cost_price IS NULL OR v_cost_price <= 0
       OR v_cost_conversion IS NULL OR v_cost_conversion <= 0 THEN
      RAISE EXCEPTION 'Baris %: stok, harga, atau konversi tidak valid', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;

    v_payment_status := lower(trim(v_row ->> 'payment_status'));
    IF v_payment_status IS NULL OR v_payment_status NOT IN ('lunas', 'kredit') THEN
      RAISE EXCEPTION 'Baris %: status pembayaran tidak valid', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;
    v_due_date := NULLIF(v_row ->> 'due_date', '')::DATE;
    IF v_stock > 0 AND v_payment_status = 'kredit' AND v_due_date IS NULL THEN
      RAISE EXCEPTION 'Baris %: jatuh tempo wajib untuk stok awal kredit', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;
    IF NOT (v_stock > 0 AND v_payment_status = 'kredit') AND v_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'Baris %: jatuh tempo hanya boleh diisi untuk stok awal kredit', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;

    v_vendor_id := NULLIF(v_row ->> 'vendor_id', '')::UUID;
    SELECT id, name INTO v_vendor_id, v_vendor_name
    FROM public.vendors
    WHERE id = v_vendor_id;
    IF v_vendor_id IS NULL OR v_vendor_name IS NULL THEN
      RAISE EXCEPTION 'Baris %: vendor tidak ditemukan', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;

    v_stock_unit := lower(trim(v_row ->> 'stock_unit'));
    IF v_stock_unit IS NULL OR v_stock_unit NOT IN ('satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack') THEN
      SELECT name INTO v_stock_unit FROM public.custom_units WHERE lower(name) = lower(trim(v_row ->> 'stock_unit'));
      IF v_stock_unit IS NULL THEN
        RAISE EXCEPTION 'Baris %: satuan stok tidak ditemukan', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
      END IF;
    END IF;

    v_cost_unit := lower(trim(v_row ->> 'cost_unit'));
    IF v_cost_unit IS NULL OR v_cost_unit NOT IN ('satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack') THEN
      SELECT name INTO v_cost_unit FROM public.custom_units WHERE lower(name) = lower(trim(v_row ->> 'cost_unit'));
      IF v_cost_unit IS NULL THEN
        RAISE EXCEPTION 'Baris %: satuan modal tidak ditemukan', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
      END IF;
    END IF;

    v_unit_base := lower(trim(v_row ->> 'unit_base'));
    IF v_unit_base IS NULL OR v_unit_base NOT IN ('pcs', 'meter') THEN
      RAISE EXCEPTION 'Baris %: satuan dasar harus pcs atau meter', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;

    v_prices := v_row -> 'prices';
    IF jsonb_typeof(v_prices) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Baris %: harga jual tidak valid', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;
    IF jsonb_array_length(v_prices) < 1 OR jsonb_array_length(v_prices) > 5 THEN
      RAISE EXCEPTION 'Baris %: harga jual tidak valid', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
    END IF;
    v_price_rows := '[]'::JSONB;
    v_seen_units := ARRAY[]::TEXT[];
    FOR v_price IN SELECT value FROM jsonb_array_elements(v_prices)
    LOOP
      v_price_unit := lower(trim(v_price ->> 'unit'));
      IF v_price_unit IS NULL OR v_price_unit NOT IN ('satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack') THEN
        SELECT name INTO v_price_unit FROM public.custom_units WHERE lower(name) = lower(trim(v_price ->> 'unit'));
        IF v_price_unit IS NULL THEN
          RAISE EXCEPTION 'Baris %: satuan jual tidak ditemukan', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
        END IF;
      END IF;
      v_price_number := NULLIF(v_price ->> 'price', '')::NUMERIC;
      v_conversion := NULLIF(v_price ->> 'conversion', '')::NUMERIC;
      IF v_price_number IS NULL OR v_price_number <= 0 OR v_conversion IS NULL OR v_conversion <= 0 THEN
        RAISE EXCEPTION 'Baris %: harga jual dan konversi harus lebih dari nol', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
      END IF;
      IF lower(v_price_unit) = ANY(v_seen_units) THEN
        RAISE EXCEPTION 'Baris %: satuan jual tidak boleh berulang', COALESCE(NULLIF(v_row ->> 'excel_row', '')::INTEGER, v_index + 1);
      END IF;
      v_seen_units := array_append(v_seen_units, lower(v_price_unit));
      v_price_rows := v_price_rows || jsonb_build_array(jsonb_build_object(
        'unit', v_price_unit,
        'price', v_price_number,
        'conversion', v_conversion
      ));
    END LOOP;

    INSERT INTO public.products (
      name, sku, barcode, cost_price, cost_unit, cost_conversion,
      stock_unit, stock_conversion, stock, min_stock, unit_base, prices, is_active
    ) VALUES (
      v_name, v_sku, v_barcode, v_cost_price, v_cost_unit, v_cost_conversion,
      v_stock_unit, 1, 0, v_min_stock, v_unit_base, v_price_rows, TRUE
    )
    RETURNING id INTO v_product_id;

    IF v_stock > 0 THEN
      PERFORM public.receive_stock_batch(
        v_product_id,
        v_stock,
        v_cost_price,
        v_vendor_id,
        v_payment_status,
        v_due_date
      );
    END IF;
    v_imported_count := v_imported_count + 1;
  END LOOP;

  INSERT INTO public.product_import_batches(user_id, idempotency_key, imported_count)
  VALUES (v_user_id, p_idempotency_key, v_imported_count);

  RETURN jsonb_build_object('imported_count', v_imported_count, 'replayed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.import_master_products(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_master_products(JSONB, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
