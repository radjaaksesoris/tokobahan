CREATE OR REPLACE FUNCTION public.create_operational_backup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE backup_id UUID; backup_payload JSONB;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Hanya admin yang dapat membuat backup'; END IF;
  backup_payload := jsonb_build_object(
    'format', 'tokobahan-operational-backup',
    'version', '2',
    'generated_at', now(),
    'generated_by', auth.uid(),
    'tables', jsonb_build_object(
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.categories x), '[]'::jsonb),
      'vendors', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.vendors x), '[]'::jsonb),
      'custom_units', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.custom_units x), '[]'::jsonb),
      'products', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.products x), '[]'::jsonb),
      'product_stock_batches', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at, x.id) FROM public.product_stock_batches x), '[]'::jsonb),
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.customers x), '[]'::jsonb),
      'sales', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sales x), '[]'::jsonb),
      'sale_items', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.sale_items x), '[]'::jsonb),
      'vendor_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.vendor_debt_payments x), '[]'::jsonb),
      'customer_debt_payments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.paid_at, x.id) FROM public.customer_debt_payments x), '[]'::jsonb),
      'stock_adjustments', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.stock_adjustments x), '[]'::jsonb),
      'sale_returns', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM public.sale_returns x), '[]'::jsonb)
    )
  );
  INSERT INTO public.operational_backups(created_by, payload) VALUES (auth.uid(), backup_payload) RETURNING id INTO backup_id;
  RETURN jsonb_build_object('id', backup_id, 'created_at', backup_payload->>'generated_at', 'payload', backup_payload);
END; $$;
