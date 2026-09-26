BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_has_role(required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE('admin' = ANY(required_roles), false) AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(TEXT[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_non_admin_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND (
       NEW.role <> 'admin'
       OR (auth.uid() IS NOT NULL AND NOT public.current_user_has_role(ARRAY['admin']))
     )
  THEN
    RAISE EXCEPTION 'Role hanya dapat diubah ke administrator oleh akun administrator';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'cashier'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_non_admin_role_change ON public.profiles;
CREATE TRIGGER profiles_prevent_non_admin_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_admin_role_change();

DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'single_admin_only_access',
      table_record.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated '
      'USING (public.current_user_has_role(ARRAY[''admin''])) '
      'WITH CHECK (public.current_user_has_role(ARRAY[''admin'']))',
      'single_admin_only_access',
      table_record.tablename
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.products,
  public.vendors,
  public.custom_units
TO authenticated;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_number INTEGER;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya administrator yang dapat membuat nomor transaksi';
  END IF;

  UPDATE public.invoice_sequences
  SET next_number = next_number + 1
  WHERE id = 1
  RETURNING next_number - 1 INTO current_number;

  RETURN 'RJA-' || LPAD(current_number::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_non_admin_role_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
