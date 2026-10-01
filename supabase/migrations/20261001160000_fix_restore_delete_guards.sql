BEGIN;

CREATE OR REPLACE FUNCTION public.restore_operational_backup_impl(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  tables_payload JSONB;
  table_name TEXT;
  required_tables CONSTANT TEXT[] := ARRAY[
    'categories', 'vendors', 'custom_units', 'products', 'product_stock_batches',
    'customers', 'sales', 'sale_items', 'vendor_debt_payments',
    'customer_debt_payments', 'stock_adjustments', 'sale_returns',
    'settlement_idempotency'
  ];
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memulihkan backup';
  END IF;
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR p_payload->>'format' IS DISTINCT FROM 'tokobahan-operational-backup'
     OR p_payload->>'version' IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'Format atau versi backup tidak valid';
  END IF;

  tables_payload := p_payload->'tables';
  IF pg_catalog.jsonb_typeof(tables_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Backup harus memuat objek tabel';
  END IF;

  FOREACH table_name IN ARRAY required_tables
  LOOP
    IF NOT (tables_payload ? table_name)
       OR pg_catalog.jsonb_typeof(tables_payload->table_name) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Data tabel % tidak lengkap atau tidak valid', table_name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(tables_payload->table_name) AS row_data(item)
      WHERE pg_catalog.jsonb_typeof(row_data.item) IS DISTINCT FROM 'object'
    ) THEN
      RAISE EXCEPTION 'Data tabel % memuat baris yang tidak valid', table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(tables_payload) AS table_key(key)
    WHERE NOT (table_key.key = ANY(required_tables))
  ) THEN
    RAISE EXCEPTION 'Backup memuat kunci tabel yang tidak dikenal';
  END IF;

  DELETE FROM public.settlement_idempotency WHERE TRUE;
  DELETE FROM public.vendor_debt_payments WHERE TRUE;
  DELETE FROM public.customer_debt_payments WHERE TRUE;
  DELETE FROM public.sale_returns WHERE TRUE;
  DELETE FROM public.stock_adjustments WHERE TRUE;
  DELETE FROM public.sale_items WHERE TRUE;
  DELETE FROM public.sales WHERE TRUE;
  DELETE FROM public.product_stock_batches WHERE TRUE;
  DELETE FROM public.products WHERE TRUE;
  DELETE FROM public.customers WHERE TRUE;
  DELETE FROM public.custom_units WHERE TRUE;
  DELETE FROM public.vendors WHERE TRUE;
  DELETE FROM public.categories WHERE TRUE;

  INSERT INTO public.categories SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.categories, COALESCE(tables_payload->'categories', '[]'::JSONB));
  INSERT INTO public.vendors SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.vendors, COALESCE(tables_payload->'vendors', '[]'::JSONB));
  INSERT INTO public.custom_units SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.custom_units, COALESCE(tables_payload->'custom_units', '[]'::JSONB));
  INSERT INTO public.products SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.products, COALESCE(tables_payload->'products', '[]'::JSONB));
  INSERT INTO public.product_stock_batches SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.product_stock_batches, COALESCE(tables_payload->'product_stock_batches', '[]'::JSONB));
  INSERT INTO public.customers (id, name, created_at)
  SELECT customer_rows.id, customer_rows.name, customer_rows.created_at
  FROM pg_catalog.jsonb_to_recordset(COALESCE(tables_payload->'customers', '[]'::JSONB))
    AS customer_rows(id UUID, name TEXT, created_at TIMESTAMPTZ);
  INSERT INTO public.sales SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.sales, COALESCE(tables_payload->'sales', '[]'::JSONB));
  INSERT INTO public.sale_items SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.sale_items, COALESCE(tables_payload->'sale_items', '[]'::JSONB));
  INSERT INTO public.vendor_debt_payments SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.vendor_debt_payments, COALESCE(tables_payload->'vendor_debt_payments', '[]'::JSONB));
  INSERT INTO public.customer_debt_payments SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.customer_debt_payments, COALESCE(tables_payload->'customer_debt_payments', '[]'::JSONB));
  INSERT INTO public.stock_adjustments SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.stock_adjustments, COALESCE(tables_payload->'stock_adjustments', '[]'::JSONB));
  INSERT INTO public.sale_returns(
    id, sale_id, sale_item_id, quantity, refund_amount, reason, returned_by, created_at, cash_refund_amount
  )
  SELECT
    id, sale_id, sale_item_id, quantity, refund_amount, reason, returned_by, created_at,
    COALESCE(cash_refund_amount, 0)
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.sale_returns, COALESCE(tables_payload->'sale_returns', '[]'::JSONB));

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
      FROM pg_catalog.jsonb_array_elements(COALESCE(tables_payload->'sale_returns', '[]'::JSONB)) AS saved_return(item)
      WHERE saved_return.item->>'id' = r.id::TEXT
        AND saved_return.item ? 'cash_refund_amount'
    );

  INSERT INTO public.settlement_idempotency
  SELECT * FROM pg_catalog.jsonb_populate_recordset(NULL::public.settlement_idempotency, COALESCE(tables_payload->'settlement_idempotency', '[]'::JSONB));

  UPDATE public.invoice_sequences
  SET next_number = GREATEST(
    1,
    COALESCE((
      SELECT MAX(
        CASE
          WHEN invoice_no ~ '^RJA-[0-9]+$' THEN substring(invoice_no FROM 5)::BIGINT
          ELSE 0
        END
      ) + 1
      FROM public.sales
    ),
    1
  )
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_operational_backup_impl(JSONB) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;