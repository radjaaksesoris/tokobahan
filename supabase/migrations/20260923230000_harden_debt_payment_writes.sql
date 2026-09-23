-- Debt payments must be recorded through role-checked RPCs, not direct table writes.
DROP POLICY IF EXISTS "Customers full access" ON public.customers;
DROP POLICY IF EXISTS "Vendor debt payments full access" ON public.vendor_debt_payments;
DROP POLICY IF EXISTS "Customer debt payments full access" ON public.customer_debt_payments;

CREATE POLICY "Customers viewable by authenticated"
  ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Vendor debt payments viewable by authenticated"
  ON public.vendor_debt_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Customer debt payments viewable by authenticated"
  ON public.customer_debt_payments FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.customers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vendor_debt_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.customer_debt_payments FROM authenticated;

CREATE OR REPLACE FUNCTION public.pay_customer_debt(
  p_sale_id UUID, p_amount NUMERIC
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sale_record RECORD;
  already_paid NUMERIC;
  payment_id UUID;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Tidak memiliki akses pembayaran pelanggan';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;

  SELECT id, total_amount, amount_paid, payment_method
  INTO sale_record
  FROM public.sales
  WHERE id = p_sale_id AND payment_method = 'credit'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi kredit tidak ditemukan';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO already_paid
  FROM public.customer_debt_payments
  WHERE sale_id = p_sale_id;
  IF p_amount > sale_record.total_amount - sale_record.amount_paid - already_paid + 0.009 THEN
    RAISE EXCEPTION 'Pembayaran melebihi sisa hutang';
  END IF;

  INSERT INTO public.customer_debt_payments(sale_id, amount, paid_by)
  VALUES (p_sale_id, p_amount, auth.uid())
  RETURNING id INTO payment_id;
  RETURN payment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.pay_vendor_debt(
  p_allocations JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE allocation JSONB; batch RECORD; outstanding NUMERIC; amount NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin','cashier']) THEN
    RAISE EXCEPTION 'Tidak memiliki akses pembayaran vendor';
  END IF;
  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Alokasi pembayaran kosong';
  END IF;
  FOR allocation IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    amount := (allocation->>'amount')::NUMERIC;
    IF amount IS NULL OR amount <= 0 THEN
      RAISE EXCEPTION 'Nominal pembayaran tidak valid';
    END IF;
    SELECT b.* INTO batch FROM public.product_stock_batches b
    WHERE b.id = (allocation->>'stock_batch_id')::UUID
      AND b.payment_status = 'kredit' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch hutang tidak ditemukan'; END IF;
    SELECT GREATEST(0, batch.quantity_received * batch.unit_cost - COALESCE(SUM(p.amount), 0))
    INTO outstanding FROM public.vendor_debt_payments p
    WHERE p.stock_batch_id = batch.id;
    IF amount > outstanding + 0.009 THEN
      RAISE EXCEPTION 'Pembayaran melebihi sisa hutang batch';
    END IF;
    INSERT INTO public.vendor_debt_payments(stock_batch_id, amount, paid_by)
    VALUES (batch.id, amount, auth.uid());
    IF amount >= outstanding - 0.009 THEN
      UPDATE public.product_stock_batches SET payment_status = 'lunas' WHERE id = batch.id;
    END IF;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.pay_customer_debt(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_vendor_debt(JSONB) TO authenticated;
NOTIFY pgrst, 'reload schema';
