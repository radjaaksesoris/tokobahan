BEGIN;

CREATE INDEX IF NOT EXISTS idx_products_sku_normalized
  ON public.products (lower(trim(sku)))
  WHERE sku IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_product_sku_taken(
  p_sku TEXT,
  p_product_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memeriksa SKU produk';
  END IF;
  IF NULLIF(trim(p_sku), '') IS NULL THEN
    RAISE EXCEPTION 'SKU wajib diisi';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.products
    WHERE lower(trim(sku)) = lower(trim(p_sku))
      AND id IS DISTINCT FROM p_product_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_product_sku_taken(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_product_sku_taken(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_duplicate_product_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.sku := NULLIF(trim(NEW.sku), '');
  IF NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND lower(trim(NEW.sku)) = lower(trim(OLD.sku)) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(NEW.sku), 0));
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE lower(trim(sku)) = lower(NEW.sku)
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'SKU "%" sudah digunakan produk lain', NEW.sku
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_duplicate_product_sku() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_reject_duplicate_sku ON public.products;
CREATE TRIGGER products_reject_duplicate_sku
  BEFORE INSERT OR UPDATE OF sku ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_duplicate_product_sku();

NOTIFY pgrst, 'reload schema';
COMMIT;
