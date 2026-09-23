-- Stock adjustments and returns must be recorded through role-checked RPCs.
DROP POLICY IF EXISTS "Authenticated stock adjustments" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Authenticated sale returns" ON public.sale_returns;

CREATE POLICY "Authenticated stock adjustments viewable"
  ON public.stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated sale returns viewable"
  ON public.sale_returns FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.stock_adjustments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_returns FROM authenticated;

NOTIFY pgrst, 'reload schema';
