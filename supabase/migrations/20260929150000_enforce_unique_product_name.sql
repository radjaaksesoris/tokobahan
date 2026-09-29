BEGIN;

CREATE INDEX IF NOT EXISTS idx_products_name_normalized
  ON public.products (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))));

CREATE OR REPLACE FUNCTION public.is_product_name_taken(
  p_name TEXT,
  p_product_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_normalized_name TEXT;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memeriksa nama produk';
  END IF;

  v_normalized_name := lower(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g')));
  IF v_normalized_name = '' THEN
    RAISE EXCEPTION 'Nama produk wajib diisi';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.products
    WHERE lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) = v_normalized_name
      AND id IS DISTINCT FROM p_product_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_product_name_taken(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_product_name_taken(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_duplicate_product_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_normalized_name TEXT;
  v_normalized_old_name TEXT;
BEGIN
  v_normalized_name := lower(btrim(regexp_replace(NEW.name, '[[:space:]]+', ' ', 'g')));

  IF TG_OP = 'UPDATE' THEN
    v_normalized_old_name := lower(btrim(regexp_replace(OLD.name, '[[:space:]]+', ' ', 'g')));
    IF v_normalized_name = v_normalized_old_name THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_normalized_name, 0));
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) = v_normalized_name
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Nama produk "%" sudah digunakan produk lain', NEW.name
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_duplicate_product_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_reject_duplicate_name ON public.products;
CREATE TRIGGER products_reject_duplicate_name
  BEFORE INSERT OR UPDATE OF name ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_duplicate_product_name();

NOTIFY pgrst, 'reload schema';
COMMIT;
