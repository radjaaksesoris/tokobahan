-- Final role-based RLS hardening for authenticated data access.
-- Run after all existing migrations so older permissive policies cannot remain active.

DROP POLICY IF EXISTS "Profiles are viewable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by self or admins" ON public.profiles;
CREATE POLICY "Profiles viewable by self or admins"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.current_user_has_role(ARRAY['admin']));

DROP POLICY IF EXISTS "Products viewable by authenticated" ON public.products;
DROP POLICY IF EXISTS "Products viewable by staff" ON public.products;
CREATE POLICY "Products viewable by staff"
  ON public.products FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Categories viewable by authenticated" ON public.categories;
DROP POLICY IF EXISTS "Categories viewable by staff" ON public.categories;
CREATE POLICY "Categories viewable by staff"
  ON public.categories FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Sales viewable by authenticated" ON public.sales;
DROP POLICY IF EXISTS "Sales viewable by staff" ON public.sales;
CREATE POLICY "Sales viewable by staff"
  ON public.sales FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Sale items viewable by authenticated" ON public.sale_items;
DROP POLICY IF EXISTS "Sale items viewable by staff" ON public.sale_items;
CREATE POLICY "Sale items viewable by staff"
  ON public.sale_items FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Customers viewable by authenticated" ON public.customers;
DROP POLICY IF EXISTS "Customers viewable by staff" ON public.customers;
CREATE POLICY "Customers viewable by staff"
  ON public.customers FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']));

DROP POLICY IF EXISTS "Vendor debt payments viewable by authenticated" ON public.vendor_debt_payments;
DROP POLICY IF EXISTS "Vendor debt payments viewable by staff" ON public.vendor_debt_payments;
CREATE POLICY "Vendor debt payments viewable by staff"
  ON public.vendor_debt_payments FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']));

DROP POLICY IF EXISTS "Customer debt payments viewable by authenticated" ON public.customer_debt_payments;
DROP POLICY IF EXISTS "Customer debt payments viewable by staff" ON public.customer_debt_payments;
CREATE POLICY "Customer debt payments viewable by staff"
  ON public.customer_debt_payments FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier']));

DROP POLICY IF EXISTS "Custom units viewable by authenticated" ON public.custom_units;
DROP POLICY IF EXISTS "Custom units viewable by staff" ON public.custom_units;
CREATE POLICY "Custom units viewable by staff"
  ON public.custom_units FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Vendors viewable by authenticated" ON public.vendors;
DROP POLICY IF EXISTS "Vendors viewable by staff" ON public.vendors;
CREATE POLICY "Vendors viewable by staff"
  ON public.vendors FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Authenticated stock adjustments viewable" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Stock adjustments viewable by staff" ON public.stock_adjustments;
CREATE POLICY "Stock adjustments viewable by staff"
  ON public.stock_adjustments FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

DROP POLICY IF EXISTS "Authenticated sale returns viewable" ON public.sale_returns;
DROP POLICY IF EXISTS "Sale returns viewable by staff" ON public.sale_returns;
CREATE POLICY "Sale returns viewable by staff"
  ON public.sale_returns FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin', 'cashier', 'monitor']));

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products, public.categories FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sales, public.sale_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.customers, public.vendor_debt_payments, public.customer_debt_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.custom_units, public.vendors FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stock_adjustments, public.sale_returns FROM authenticated;

NOTIFY pgrst, 'reload schema';
