CREATE OR REPLACE FUNCTION public.change_sale_payment_method(
  p_sale_id UUID,
  p_payment_method TEXT,
  p_customer_name TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sale_record public.sales%ROWTYPE;
  customer_record UUID;
  payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;
  IF p_payment_method NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak didukung';
  END IF;

  SELECT * INTO sale_record
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;
  IF sale_record.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF sale_record.payment_method = p_payment_method THEN
    RETURN;
  END IF;

  IF p_payment_method = 'credit' THEN
    IF nullif(trim(p_customer_name), '') IS NULL THEN
      RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk transaksi kredit';
    END IF;
    INSERT INTO public.customers(name)
    VALUES (trim(p_customer_name))
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO customer_record;

    UPDATE public.sales
    SET payment_method = 'credit',
        customer_id = customer_record,
        amount_paid = 0
    WHERE id = p_sale_id;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO payment_count
  FROM public.customer_debt_payments
  WHERE sale_id = p_sale_id;
  IF payment_count > 0 THEN
    RAISE EXCEPTION 'Transaksi kredit yang sudah memiliki cicilan tidak dapat diubah menjadi tunai';
  END IF;

  UPDATE public.sales
  SET payment_method = 'cash',
      customer_id = NULL,
      amount_paid = total_amount
  WHERE id = p_sale_id;
END; $$;

REVOKE ALL ON FUNCTION public.change_sale_payment_method(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_sale_payment_method(UUID,TEXT,TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
