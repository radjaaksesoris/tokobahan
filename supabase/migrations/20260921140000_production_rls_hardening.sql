-- Tighten role-based access for production. Run after the existing schema/migrations.

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

DROP POLICY IF EXISTS "Products full access for authenticated" ON public.products;
DROP POLICY IF EXISTS "Products viewable by authenticated" ON public.products;
DROP POLICY IF EXISTS "Products writable by admin or cashier" ON public.products;
DROP POLICY IF EXISTS "Products editable by admin or cashier" ON public.products;
DROP POLICY IF EXISTS "Products removable by admin or cashier" ON public.products;
CREATE POLICY "Products viewable by authenticated"
  ON public.products FOR SELECT TO authenticated USING (true);

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

DROP POLICY IF EXISTS "Categories full access" ON public.categories;
DROP POLICY IF EXISTS "Categories viewable by authenticated" ON public.categories;
DROP POLICY IF EXISTS "Categories writable by admin or cashier" ON public.categories;
DROP POLICY IF EXISTS "Categories editable by admin or cashier" ON public.categories;
DROP POLICY IF EXISTS "Categories removable by admin or cashier" ON public.categories;
CREATE POLICY "Categories viewable by authenticated"
  ON public.categories FOR SELECT TO authenticated USING (true);

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

CREATE OR REPLACE FUNCTION public.prevent_non_admin_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.current_user_has_role(ARRAY['admin'])
  THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengubah role pengguna';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_non_admin_role_change ON public.profiles;
CREATE TRIGGER profiles_prevent_non_admin_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_admin_role_change();

REVOKE ALL ON FUNCTION public.prevent_non_admin_role_change() FROM PUBLIC;

DO $$
BEGIN
  IF to_regprocedure('public.checkout_sale_internal(text,numeric,numeric,numeric,text,uuid,jsonb)') IS NULL
     AND to_regprocedure('public.checkout_sale(text,numeric,numeric,numeric,text,uuid,jsonb)') IS NOT NULL
  THEN
    ALTER FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB)
      RENAME TO checkout_sale_internal;
  END IF;
END;
$$;

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
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Hanya admin atau cashier yang dapat membuat transaksi';
  END IF;

  RETURN public.checkout_sale_internal(
    p_invoice_no, p_total_amount, p_total_cost, p_total_profit,
    p_payment_method, p_cashier_id, p_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_sale_internal(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale_internal(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.receive_stock_batch_internal(uuid,numeric,numeric)') IS NULL
     AND to_regprocedure('public.receive_stock_batch(uuid,numeric,numeric)') IS NOT NULL
  THEN
    ALTER FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC)
      RENAME TO receive_stock_batch_internal;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_stock_batch(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Hanya admin atau cashier yang dapat menambah stok';
  END IF;

  PERFORM public.receive_stock_batch_internal(p_product_id, p_quantity, p_unit_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_batch_internal(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock_batch_internal(UUID, NUMERIC, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
