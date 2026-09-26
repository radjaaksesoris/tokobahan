BEGIN;

CREATE TABLE IF NOT EXISTS public.settlement_idempotency (
  id UUID PRIMARY KEY,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('vendor', 'customer')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.settlement_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.settlement_idempotency FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.pay_vendor_debt(JSONB);
DROP FUNCTION IF EXISTS public.pay_customer_debt(UUID, NUMERIC);

CREATE FUNCTION public.pay_customer_debt(
  p_sale_id UUID,
  p_amount NUMERIC,
  p_idempotency_key UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale_record RECORD;
  already_paid NUMERIC;
  payment_id UUID;
  previous_request public.settlement_idempotency%ROWTYPE;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Tidak memiliki akses pembayaran pelanggan';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci idempotensi pembayaran wajib diisi';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;

  INSERT INTO public.settlement_idempotency(id, payment_type, created_by)
  VALUES (p_idempotency_key, 'customer', auth.uid())
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO previous_request
    FROM public.settlement_idempotency
    WHERE id = p_idempotency_key;
    IF previous_request.payment_type <> 'customer'
       OR previous_request.created_by <> auth.uid()
       OR previous_request.result IS NULL
    THEN
      RAISE EXCEPTION 'Kunci idempotensi pembayaran tidak valid';
    END IF;
    RETURN (previous_request.result->>'payment_id')::UUID;
  END IF;

  SELECT s.id, s.total_amount, s.amount_paid, s.payment_method
  INTO sale_record
  FROM public.sales s
  WHERE s.id = p_sale_id AND s.payment_method = 'credit'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi kredit tidak ditemukan';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO already_paid
  FROM public.customer_debt_payments p
  WHERE p.sale_id = p_sale_id;
  IF p_amount > sale_record.total_amount - sale_record.amount_paid - already_paid + 0.009 THEN
    RAISE EXCEPTION 'Pembayaran melebihi sisa hutang';
  END IF;

  INSERT INTO public.customer_debt_payments(sale_id, amount, paid_by)
  VALUES (p_sale_id, p_amount, auth.uid())
  RETURNING id INTO payment_id;

  UPDATE public.settlement_idempotency
  SET result = jsonb_build_object('payment_id', payment_id)
  WHERE id = p_idempotency_key;
  RETURN payment_id;
END;
$$;

CREATE FUNCTION public.pay_vendor_debt(
  p_allocations JSONB,
  p_idempotency_key UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocation JSONB;
  batch RECORD;
  outstanding NUMERIC;
  amount NUMERIC;
  previous_request public.settlement_idempotency%ROWTYPE;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Tidak memiliki akses pembayaran vendor';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci idempotensi pembayaran wajib diisi';
  END IF;
  IF p_allocations IS NULL
     OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0
  THEN
    RAISE EXCEPTION 'Alokasi pembayaran kosong';
  END IF;

  INSERT INTO public.settlement_idempotency(id, payment_type, created_by)
  VALUES (p_idempotency_key, 'vendor', auth.uid())
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO previous_request
    FROM public.settlement_idempotency
    WHERE id = p_idempotency_key;
    IF previous_request.payment_type <> 'vendor'
       OR previous_request.created_by <> auth.uid()
       OR previous_request.result IS NULL
    THEN
      RAISE EXCEPTION 'Kunci idempotensi pembayaran tidak valid';
    END IF;
    RETURN;
  END IF;

  FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) AS entries(value)
  LOOP
    amount := (allocation->>'amount')::NUMERIC;
    IF amount IS NULL OR amount <= 0 THEN
      RAISE EXCEPTION 'Nominal pembayaran tidak valid';
    END IF;
    SELECT b.* INTO batch
    FROM public.product_stock_batches b
    WHERE b.id = (allocation->>'stock_batch_id')::UUID
      AND b.payment_status = 'kredit'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Batch hutang tidak ditemukan';
    END IF;

    SELECT GREATEST(
      0,
      batch.quantity_received * batch.unit_cost - COALESCE(SUM(p.amount), 0)
    )
    INTO outstanding
    FROM public.vendor_debt_payments p
    WHERE p.stock_batch_id = batch.id;
    IF amount > outstanding + 0.009 THEN
      RAISE EXCEPTION 'Pembayaran melebihi sisa hutang batch';
    END IF;

    INSERT INTO public.vendor_debt_payments(stock_batch_id, amount, paid_by)
    VALUES (batch.id, amount, auth.uid());
    IF amount >= outstanding - 0.009 THEN
      UPDATE public.product_stock_batches
      SET payment_status = 'lunas'
      WHERE id = batch.id;
    END IF;
  END LOOP;

  UPDATE public.settlement_idempotency
  SET result = '{}'::JSONB
  WHERE id = p_idempotency_key;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_customer_debt(UUID, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_customer_debt(UUID, NUMERIC, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.pay_vendor_debt(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_vendor_debt(JSONB, UUID) TO authenticated;

DROP TRIGGER IF EXISTS limit_sales_history ON public.sales;
DROP FUNCTION IF EXISTS public.delete_sales_over_history_limit();

ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS cash_refund_amount NUMERIC(15, 2) NOT NULL DEFAULT 0
  CHECK (cash_refund_amount >= 0);

WITH return_totals AS (
  SELECT r.sale_id, SUM(r.refund_amount) AS total_refunds
  FROM public.sale_returns r
  GROUP BY r.sale_id
),
payment_totals AS (
  SELECT p.sale_id, SUM(p.amount) AS total_payments
  FROM public.customer_debt_payments p
  GROUP BY p.sale_id
),
ranked_returns AS (
  SELECT
    r.id,
    s.payment_method,
    s.total_amount + COALESCE(rt.total_refunds, 0) AS original_total,
    s.amount_paid + COALESCE(pt.total_payments, 0) AS total_paid,
    r.refund_amount,
    COALESCE(
      SUM(r.refund_amount) OVER (
        PARTITION BY r.sale_id
        ORDER BY r.created_at, r.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS prior_refunds
  FROM public.sale_returns r
  JOIN public.sales s ON s.id = r.sale_id
  LEFT JOIN return_totals rt ON rt.sale_id = s.id
  LEFT JOIN payment_totals pt ON pt.sale_id = s.id
)
UPDATE public.sale_returns r
SET cash_refund_amount = CASE
  WHEN ranked.payment_method <> 'credit' THEN ranked.refund_amount
  ELSE GREATEST(
    0,
    ranked.refund_amount
      - GREATEST(ranked.original_total - ranked.total_paid - ranked.prior_refunds, 0)
  )
END
FROM ranked_returns ranked
WHERE ranked.id = r.id
  AND r.cash_refund_amount = 0;

CREATE OR REPLACE FUNCTION public.create_operational_backup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  backup_id UUID;
  backup_payload JSONB;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat membuat backup';
  END IF;

  backup_payload := jsonb_build_object(
    'format', 'tokobahan-operational-backup',
    'version', '3',
    'generated_at', now(),
    'generated_by', auth.uid(),
    'tables', jsonb_build_object(
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.categories x), '[]'::JSONB),
      'vendors', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.vendors x), '[]'::JSONB),
      'custom_units', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.custom_units x), '[]'::JSONB),
      'products', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.products x), '[]'::JSONB),
      'product_stock_batches', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at, x.id) FROM public.product_stock_batches x), '[]'::JSONB),
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.customers x), '[]'::JSONB),
      'sales', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sales x), '[]'::JSONB),
      'sale_items', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sale_items x), '[]'::JSONB),
      'vendor_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.vendor_debt_payments x), '[]'::JSONB),
      'customer_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.customer_debt_payments x), '[]'::JSONB),
      'stock_adjustments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.stock_adjustments x), '[]'::JSONB),
      'sale_returns', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sale_returns x), '[]'::JSONB),
      'settlement_idempotency', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.settlement_idempotency x), '[]'::JSONB)
    )
  );

  INSERT INTO public.operational_backups(created_by, payload)
  VALUES (auth.uid(), backup_payload)
  RETURNING id INTO backup_id;

  RETURN jsonb_build_object(
    'id', backup_id,
    'created_at', backup_payload->>'generated_at',
    'payload', backup_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_operational_backup(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tables_payload JSONB;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memulihkan backup';
  END IF;
  IF p_payload->>'format' <> 'tokobahan-operational-backup' THEN
    RAISE EXCEPTION 'Format backup tidak valid';
  END IF;

  DELETE FROM public.settlement_idempotency;
  DELETE FROM public.vendor_debt_payments;
  DELETE FROM public.customer_debt_payments;
  DELETE FROM public.sale_returns;
  DELETE FROM public.stock_adjustments;
  DELETE FROM public.sale_items;
  DELETE FROM public.sales;
  DELETE FROM public.product_stock_batches;
  DELETE FROM public.products;
  DELETE FROM public.customers;
  DELETE FROM public.custom_units;
  DELETE FROM public.vendors;
  DELETE FROM public.categories;

  tables_payload := p_payload->'tables';
  INSERT INTO public.categories SELECT * FROM jsonb_populate_recordset(NULL::public.categories, COALESCE(tables_payload->'categories', '[]'::JSONB));
  INSERT INTO public.vendors SELECT * FROM jsonb_populate_recordset(NULL::public.vendors, COALESCE(tables_payload->'vendors', '[]'::JSONB));
  INSERT INTO public.custom_units SELECT * FROM jsonb_populate_recordset(NULL::public.custom_units, COALESCE(tables_payload->'custom_units', '[]'::JSONB));
  INSERT INTO public.products SELECT * FROM jsonb_populate_recordset(NULL::public.products, COALESCE(tables_payload->'products', '[]'::JSONB));
  INSERT INTO public.product_stock_batches SELECT * FROM jsonb_populate_recordset(NULL::public.product_stock_batches, COALESCE(tables_payload->'product_stock_batches', '[]'::JSONB));
  INSERT INTO public.customers SELECT * FROM jsonb_populate_recordset(NULL::public.customers, COALESCE(tables_payload->'customers', '[]'::JSONB));
  INSERT INTO public.sales SELECT * FROM jsonb_populate_recordset(NULL::public.sales, COALESCE(tables_payload->'sales', '[]'::JSONB));
  INSERT INTO public.sale_items SELECT * FROM jsonb_populate_recordset(NULL::public.sale_items, COALESCE(tables_payload->'sale_items', '[]'::JSONB));
  INSERT INTO public.vendor_debt_payments SELECT * FROM jsonb_populate_recordset(NULL::public.vendor_debt_payments, COALESCE(tables_payload->'vendor_debt_payments', '[]'::JSONB));
  INSERT INTO public.customer_debt_payments SELECT * FROM jsonb_populate_recordset(NULL::public.customer_debt_payments, COALESCE(tables_payload->'customer_debt_payments', '[]'::JSONB));
  INSERT INTO public.stock_adjustments SELECT * FROM jsonb_populate_recordset(NULL::public.stock_adjustments, COALESCE(tables_payload->'stock_adjustments', '[]'::JSONB));
  INSERT INTO public.sale_returns(
    id, sale_id, sale_item_id, quantity, refund_amount, reason, returned_by, created_at, cash_refund_amount
  )
  SELECT
    id, sale_id, sale_item_id, quantity, refund_amount, reason, returned_by, created_at,
    COALESCE(cash_refund_amount, 0)
  FROM jsonb_populate_recordset(NULL::public.sale_returns, COALESCE(tables_payload->'sale_returns', '[]'::JSONB));

  WITH return_totals AS (
    SELECT sale_id, SUM(refund_amount) AS total_refunds
    FROM public.sale_returns
    GROUP BY sale_id
  ),
  payment_totals AS (
    SELECT sale_id, SUM(amount) AS total_payments
    FROM public.customer_debt_payments
    GROUP BY sale_id
  ),
  ranked_returns AS (
    SELECT
      r.id,
      s.payment_method,
      s.total_amount + COALESCE(rt.total_refunds, 0) AS original_total,
      s.amount_paid + COALESCE(pt.total_payments, 0) AS total_paid,
      r.refund_amount,
      COALESCE(
        SUM(r.refund_amount) OVER (
          PARTITION BY r.sale_id
          ORDER BY r.created_at, r.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      ) AS prior_refunds
    FROM public.sale_returns r
    JOIN public.sales s ON s.id = r.sale_id
    LEFT JOIN return_totals rt ON rt.sale_id = s.id
    LEFT JOIN payment_totals pt ON pt.sale_id = s.id
  )
  UPDATE public.sale_returns r
  SET cash_refund_amount = CASE
    WHEN ranked.payment_method <> 'credit' THEN ranked.refund_amount
    ELSE GREATEST(
      0,
      ranked.refund_amount
        - GREATEST(ranked.original_total - ranked.total_paid - ranked.prior_refunds, 0)
    )
  END
  FROM ranked_returns ranked
  WHERE ranked.id = r.id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(tables_payload->'sale_returns', '[]'::JSONB)) AS saved_return(item)
      WHERE saved_return.item->>'id' = r.id::TEXT
        AND saved_return.item ? 'cash_refund_amount'
    );

  INSERT INTO public.settlement_idempotency
  SELECT * FROM jsonb_populate_recordset(NULL::public.settlement_idempotency, COALESCE(tables_payload->'settlement_idempotency', '[]'::JSONB));
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_operational_backup() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_operational_backup(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.return_sale_item(
  p_sale_item_id UUID,
  p_quantity NUMERIC,
  p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item RECORD;
  already_returned NUMERIC;
  prior_customer_payments NUMERIC;
  outstanding_balance NUMERIC;
  refund NUMERIC;
  cash_refund NUMERIC;
  return_id UUID;
  restored_unit_cost NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memproses retur';
  END IF;

  SELECT
    si.*,
    s.id AS parent_sale_id,
    s.total_amount AS sale_total_amount,
    s.amount_paid AS sale_amount_paid,
    s.payment_method AS sale_payment_method
  INTO item
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE si.id = p_sale_item_id
  FOR UPDATE OF si, s;

  IF NOT FOUND
     OR p_quantity IS NULL
     OR p_quantity <= 0
     OR NULLIF(TRIM(p_reason), '') IS NULL
  THEN
    RAISE EXCEPTION 'Data retur tidak valid';
  END IF;

  SELECT COALESCE(SUM(r.quantity), 0)
  INTO already_returned
  FROM public.sale_returns r
  WHERE r.sale_item_id = p_sale_item_id;
  IF already_returned + p_quantity > item.quantity THEN
    RAISE EXCEPTION 'Jumlah retur melebihi jumlah terjual';
  END IF;

  refund := ROUND((p_quantity / item.quantity) * item.line_total, 2);
  restored_unit_cost := item.line_cost / item.quantity;
  SELECT COALESCE(SUM(p.amount), 0)
  INTO prior_customer_payments
  FROM public.customer_debt_payments p
  WHERE p.sale_id = item.parent_sale_id;

  outstanding_balance := GREATEST(
    item.sale_total_amount - item.sale_amount_paid - prior_customer_payments,
    0
  );
  cash_refund := CASE
    WHEN item.sale_payment_method = 'credit'
      THEN GREATEST(refund - outstanding_balance, 0)
    ELSE refund
  END;

  INSERT INTO public.sale_returns(
    sale_id, sale_item_id, quantity, refund_amount, cash_refund_amount, reason, returned_by
  )
  VALUES (
    item.parent_sale_id, p_sale_item_id, p_quantity, refund, cash_refund, TRIM(p_reason), auth.uid()
  )
  RETURNING id INTO return_id;

  INSERT INTO public.product_stock_batches(
    product_id, quantity_received, quantity_remaining, unit_cost
  )
  VALUES (item.product_id, p_quantity, p_quantity, restored_unit_cost);

  UPDATE public.products
  SET stock = stock + p_quantity, updated_at = now()
  WHERE id = item.product_id;

  UPDATE public.sales
  SET total_amount = total_amount - refund,
      total_cost = total_cost - ROUND((p_quantity / item.quantity) * item.line_cost, 2),
      total_profit = total_profit - ROUND((p_quantity / item.quantity) * item.line_profit, 2)
  WHERE id = item.parent_sale_id;

  RETURN return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.return_sale_item(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_sale_item(UUID, NUMERIC, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION public.sales_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  total_revenue NUMERIC,
  total_credit NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE((
      SELECT SUM(amount)
      FROM (
        SELECT s.amount_paid AS amount
        FROM public.sales s
        WHERE s.created_at >= p_start AND s.created_at <= p_end
        UNION ALL
        SELECT p.amount
        FROM public.customer_debt_payments p
        WHERE p.paid_at >= p_start AND p.paid_at <= p_end
        UNION ALL
        SELECT -r.cash_refund_amount
        FROM public.sale_returns r
        WHERE r.created_at >= p_start AND r.created_at <= p_end
      ) cash
    ), 0),
    COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'credit'), 0),
    COALESCE(SUM(s.total_cost), 0),
    COALESCE(SUM(s.total_profit), 0),
    COUNT(*)
  FROM public.sales s
  WHERE s.created_at >= p_start AND s.created_at <= p_end;
$$;

DROP FUNCTION IF EXISTS public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION public.sales_daily_summary(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  total_credit NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  transaction_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH daily_sales AS (
    SELECT
      (s.created_at AT TIME ZONE 'Asia/Jakarta')::DATE AS sale_date,
      COALESCE(SUM(s.total_cost), 0) AS total_cost,
      COALESCE(SUM(s.total_profit), 0) AS total_profit,
      COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'credit'), 0) AS total_credit,
      COUNT(*) AS transaction_count
    FROM public.sales s
    WHERE s.created_at >= p_start AND s.created_at <= p_end
    GROUP BY 1
  ),
  daily_cash AS (
    SELECT cash.sale_date, SUM(cash.amount) AS amount
    FROM (
      SELECT
        (s.created_at AT TIME ZONE 'Asia/Jakarta')::DATE AS sale_date,
        s.amount_paid AS amount
      FROM public.sales s
      WHERE s.created_at >= p_start AND s.created_at <= p_end
      UNION ALL
      SELECT
        (p.paid_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        p.amount
      FROM public.customer_debt_payments p
      WHERE p.paid_at >= p_start AND p.paid_at <= p_end
      UNION ALL
      SELECT
        (r.created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        -r.cash_refund_amount
      FROM public.sale_returns r
      WHERE r.created_at >= p_start AND r.created_at <= p_end
    ) cash
    GROUP BY cash.sale_date
  )
  SELECT
    COALESCE(s.sale_date, c.sale_date),
    COALESCE(c.amount, 0),
    COALESCE(s.total_credit, 0),
    COALESCE(s.total_cost, 0),
    COALESCE(s.total_profit, 0),
    COALESCE(s.transaction_count, 0)
  FROM daily_sales s
  FULL OUTER JOIN daily_cash c ON c.sale_date = s.sale_date
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT,
  p_total_amount NUMERIC,
  p_total_cost NUMERIC,
  p_total_profit NUMERIC,
  p_payment_method TEXT,
  p_cashier_id UUID,
  p_items JSONB,
  p_customer_name TEXT DEFAULT NULL,
  p_amount_paid NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_customer_id UUID;
  existing_item RECORD;
  item JSONB;
  batch RECORD;
  current_stock NUMERIC;
  current_product_name TEXT;
  configured_conversion NUMERIC;
  configured_list_price NUMERIC;
  unit_is_configured BOOLEAN;
  requested_quantity NUMERIC;
  remaining_quantity NUMERIC;
  consumed_quantity NUMERIC;
  calculated_line_cost NUMERIC;
  calculated_line_total NUMERIC;
  calculated_total_cost NUMERIC := 0;
  calculated_total_amount NUMERIC := 0;
  paid NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin', 'cashier']) THEN
    RAISE EXCEPTION 'Hanya admin atau cashier yang dapat membuat transaksi';
  END IF;
  IF auth.uid() IS NULL OR p_cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;
  IF NULLIF(TRIM(p_invoice_no), '') IS NULL THEN
    RAISE EXCEPTION 'Nomor transaksi wajib diisi';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'qris', 'credit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak didukung';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Daftar barang transaksi tidak valid';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_invoice_no));
  SELECT ci.sale_id INTO v_sale_id
  FROM public.checkout_idempotency ci
  WHERE ci.invoice_no = p_invoice_no;
  IF v_sale_id IS NOT NULL THEN
    RETURN v_sale_id;
  END IF;

  SELECT s.id INTO v_sale_id
  FROM public.sales s
  WHERE s.invoice_no = p_invoice_no;
  IF v_sale_id IS NOT NULL THEN
    INSERT INTO public.checkout_idempotency(invoice_no, sale_id)
    VALUES (p_invoice_no, v_sale_id)
    ON CONFLICT (invoice_no) DO NOTHING;
    RETURN v_sale_id;
  END IF;

  IF p_payment_method = 'credit' AND NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk transaksi kredit';
  END IF;
  IF p_payment_method = 'credit' THEN
    INSERT INTO public.customers(name)
    VALUES (TRIM(p_customer_name))
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_customer_id;
  END IF;

  CREATE TEMP TABLE fifo_checkout_items (
    product_id UUID NOT NULL,
    product_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity NUMERIC(15,3) NOT NULL,
    conversion NUMERIC(15,3) NOT NULL,
    unit_price NUMERIC(15,2) NOT NULL,
    line_total NUMERIC(15,2) NOT NULL,
    line_cost NUMERIC(15,2) NOT NULL,
    line_profit NUMERIC(15,2) NOT NULL
  ) ON COMMIT DROP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) AS entries(value)
  LOOP
    requested_quantity := (item->>'quantity')::NUMERIC;
    IF requested_quantity IS NULL OR requested_quantity <= 0 THEN
      RAISE EXCEPTION 'Jumlah produk harus lebih besar dari 0';
    END IF;
    IF NULLIF(TRIM(item->>'unit'), '') IS NULL
       OR (item->>'unit_price')::NUMERIC IS NULL
       OR (item->>'unit_price')::NUMERIC <= 0
    THEN
      RAISE EXCEPTION 'Satuan dan harga jual transaksi tidak valid';
    END IF;

    SELECT
      p.stock,
      p.name,
      price_entry.value IS NOT NULL,
      (price_entry.value->>'price')::NUMERIC,
      COALESCE(NULLIF((price_entry.value->>'conversion')::NUMERIC, 0), 1)
    INTO current_stock, current_product_name, unit_is_configured,
      configured_list_price, configured_conversion
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT price.value
      FROM jsonb_array_elements(p.prices) AS price(value)
      WHERE price.value->>'unit' = item->>'unit'
      LIMIT 1
    ) price_entry ON true
    WHERE p.id = (item->>'product_id')::UUID
      AND p.is_active = true
    FOR UPDATE OF p;

    IF current_stock IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif';
    END IF;
    IF NOT unit_is_configured
       OR configured_list_price IS NULL
       OR configured_list_price <= 0
       OR configured_conversion IS NULL
       OR configured_conversion <= 0
    THEN
      RAISE EXCEPTION 'Satuan produk tidak valid';
    END IF;
    IF (item->>'unit_price')::NUMERIC > configured_list_price THEN
      RAISE EXCEPTION 'Harga jual tidak boleh melebihi harga katalog';
    END IF;
    IF item->>'conversion' IS NOT NULL
       AND (item->>'conversion')::NUMERIC <> configured_conversion
    THEN
      RAISE EXCEPTION 'Konversi satuan produk berubah, muat ulang katalog';
    END IF;
    IF current_stock < requested_quantity THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', current_product_name;
    END IF;

    remaining_quantity := requested_quantity;
    calculated_line_cost := 0;
    FOR batch IN
      SELECT b.id, b.quantity_remaining, b.unit_cost
      FROM public.product_stock_batches b
      WHERE b.product_id = (item->>'product_id')::UUID
        AND b.quantity_remaining > 0
      ORDER BY b.received_at, b.id
      FOR UPDATE
    LOOP
      EXIT WHEN remaining_quantity <= 0;
      consumed_quantity := LEAST(remaining_quantity, batch.quantity_remaining);
      calculated_line_cost := calculated_line_cost + consumed_quantity * batch.unit_cost;
      UPDATE public.product_stock_batches
      SET quantity_remaining = quantity_remaining - consumed_quantity
      WHERE id = batch.id;
      remaining_quantity := remaining_quantity - consumed_quantity;
    END LOOP;
    IF remaining_quantity > 0 THEN
      RAISE EXCEPTION 'Batch HPP untuk % tidak mencukupi', current_product_name;
    END IF;

    calculated_line_total := ROUND((item->>'unit_price')::NUMERIC * requested_quantity, 2);
    IF calculated_line_total <= calculated_line_cost THEN
      RAISE EXCEPTION 'Harga jual % harus lebih besar dari HPP FIFO', current_product_name;
    END IF;

    INSERT INTO fifo_checkout_items(
      product_id, product_name, unit, quantity, conversion, unit_price,
      line_total, line_cost, line_profit
    )
    VALUES (
      (item->>'product_id')::UUID,
      current_product_name,
      item->>'unit',
      requested_quantity,
      configured_conversion,
      (item->>'unit_price')::NUMERIC,
      calculated_line_total,
      calculated_line_cost,
      calculated_line_total - calculated_line_cost
    );
    calculated_total_cost := calculated_total_cost + calculated_line_cost;
    calculated_total_amount := calculated_total_amount + calculated_line_total;
  END LOOP;

  paid := COALESCE(p_amount_paid, calculated_total_amount);
  IF p_payment_method = 'credit' AND p_amount_paid IS NULL THEN
    paid := 0;
  END IF;
  IF paid < 0 OR paid > calculated_total_amount THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;
  IF p_payment_method IN ('cash', 'qris') AND paid <> calculated_total_amount THEN
    RAISE EXCEPTION 'Pembayaran tunai dan QRIS harus melunasi seluruh transaksi';
  END IF;

  IF p_payment_method = 'credit' THEN
    SELECT s.id INTO v_sale_id
    FROM public.sales s
    WHERE s.customer_id = v_customer_id
      AND s.payment_method = 'credit'
      AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::DATE = (now() AT TIME ZONE 'Asia/Jakarta')::DATE
    ORDER BY s.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_sale_id IS NULL THEN
    INSERT INTO public.sales(
      invoice_no, total_amount, total_cost, total_profit, payment_method,
      cashier_id, customer_id, amount_paid
    )
    VALUES (
      p_invoice_no, calculated_total_amount, calculated_total_cost,
      calculated_total_amount - calculated_total_cost, p_payment_method,
      p_cashier_id, v_customer_id, paid
    )
    RETURNING id INTO v_sale_id;
  ELSE
    UPDATE public.sales
    SET total_amount = total_amount + calculated_total_amount,
        total_cost = total_cost + calculated_total_cost,
        total_profit = total_profit + (calculated_total_amount - calculated_total_cost),
        amount_paid = amount_paid + paid
    WHERE id = v_sale_id;
  END IF;

  FOR item IN SELECT row_to_json(f)::JSONB FROM fifo_checkout_items f
  LOOP
    SELECT si.id INTO existing_item
    FROM public.sale_items si
    WHERE si.sale_id = v_sale_id
      AND si.product_id = (item->>'product_id')::UUID
      AND si.unit = item->>'unit'
      AND si.unit_price = (item->>'unit_price')::NUMERIC
    LIMIT 1
    FOR UPDATE;

    IF existing_item.id IS NULL THEN
      INSERT INTO public.sale_items(
        sale_id, product_id, product_name, unit, quantity, conversion,
        unit_price, line_total, line_cost, line_profit
      )
      VALUES (
        v_sale_id, (item->>'product_id')::UUID, item->>'product_name',
        item->>'unit', (item->>'quantity')::NUMERIC,
        (item->>'conversion')::NUMERIC, (item->>'unit_price')::NUMERIC,
        (item->>'line_total')::NUMERIC, (item->>'line_cost')::NUMERIC,
        (item->>'line_profit')::NUMERIC
      );
    ELSE
      UPDATE public.sale_items
      SET quantity = quantity + (item->>'quantity')::NUMERIC,
          line_total = line_total + (item->>'line_total')::NUMERIC,
          line_cost = line_cost + (item->>'line_cost')::NUMERIC,
          line_profit = line_profit + (item->>'line_profit')::NUMERIC
      WHERE id = existing_item.id;
    END IF;
  END LOOP;

  UPDATE public.products p
  SET stock = p.stock - items.quantity, updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity) AS quantity
    FROM fifo_checkout_items
    GROUP BY product_id
  ) items
  WHERE p.id = items.product_id;

  INSERT INTO public.checkout_idempotency(invoice_no, sale_id)
  VALUES (p_invoice_no, v_sale_id)
  ON CONFLICT (invoice_no) DO NOTHING;
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB, TEXT, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_daily_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
