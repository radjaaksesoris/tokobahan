CREATE OR REPLACE FUNCTION public.pay_vendor_debt(
  p_allocations JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE allocation JSONB; batch RECORD; outstanding NUMERIC; amount NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin','cashier']) THEN RAISE EXCEPTION 'Tidak memiliki akses pembayaran vendor'; END IF;
  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN RAISE EXCEPTION 'Alokasi pembayaran kosong'; END IF;
  FOR allocation IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    amount := (allocation->>'amount')::NUMERIC;
    IF amount IS NULL OR amount <= 0 THEN RAISE EXCEPTION 'Nominal pembayaran tidak valid'; END IF;
    SELECT b.* INTO batch FROM public.product_stock_batches b
      WHERE b.id = (allocation->>'stock_batch_id')::UUID AND b.payment_status = 'kredit' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch hutang tidak ditemukan'; END IF;
    SELECT GREATEST(0, batch.quantity_received * batch.unit_cost - COALESCE(SUM(p.amount), 0))
      INTO outstanding FROM public.vendor_debt_payments p WHERE p.stock_batch_id = batch.id;
    IF amount > outstanding + 0.009 THEN RAISE EXCEPTION 'Pembayaran melebihi sisa hutang batch'; END IF;
    INSERT INTO public.vendor_debt_payments(stock_batch_id, amount) VALUES (batch.id, amount);
    IF amount >= outstanding - 0.009 THEN
      UPDATE public.product_stock_batches SET payment_status = 'lunas' WHERE id = batch.id;
    END IF;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.pay_vendor_debt(JSONB) TO authenticated;
