CREATE TABLE IF NOT EXISTS public.operational_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  backup_version TEXT NOT NULL DEFAULT '1',
  payload JSONB NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  category_count INTEGER NOT NULL DEFAULT 0,
  sale_count INTEGER NOT NULL DEFAULT 0,
  sale_item_count INTEGER NOT NULL DEFAULT 0,
  stock_batch_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_operational_backups_created_at
  ON public.operational_backups(created_at DESC);

ALTER TABLE public.operational_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view operational backups" ON public.operational_backups;
CREATE POLICY "Admins can view operational backups"
  ON public.operational_backups
  FOR SELECT TO authenticated
  USING (public.current_user_has_role(ARRAY['admin']));

REVOKE ALL ON TABLE public.operational_backups FROM PUBLIC, authenticated;
GRANT SELECT ON TABLE public.operational_backups TO authenticated;

CREATE OR REPLACE FUNCTION public.create_operational_backup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  backup_id UUID;
  backup_payload JSONB;
  product_count INTEGER;
  category_count INTEGER;
  sale_count INTEGER;
  sale_item_count INTEGER;
  stock_batch_count INTEGER;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat membuat backup';
  END IF;

  SELECT COUNT(*) INTO product_count FROM public.products;
  SELECT COUNT(*) INTO category_count FROM public.categories;
  SELECT COUNT(*) INTO sale_count FROM public.sales;
  SELECT COUNT(*) INTO sale_item_count FROM public.sale_items;
  SELECT COUNT(*) INTO stock_batch_count FROM public.product_stock_batches;

  backup_payload := jsonb_build_object(
    'format', 'tokobahan-operational-backup',
    'version', '1',
    'generated_at', now(),
    'generated_by', auth.uid(),
    'tables', jsonb_build_object(
      'profiles', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.id) FROM public.profiles p), '[]'::jsonb),
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at, c.id) FROM public.categories c), '[]'::jsonb),
      'products', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.id) FROM public.products p), '[]'::jsonb),
      'sales', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at, s.id) FROM public.sales s), '[]'::jsonb),
      'sale_items', COALESCE((SELECT jsonb_agg(to_jsonb(si) ORDER BY si.id) FROM public.sale_items si), '[]'::jsonb),
      'product_stock_batches', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.received_at, b.id) FROM public.product_stock_batches b), '[]'::jsonb)
    )
  );

  INSERT INTO public.operational_backups (
    created_by, payload, product_count, category_count, sale_count, sale_item_count, stock_batch_count
  )
  VALUES (
    auth.uid(), backup_payload, product_count, category_count, sale_count, sale_item_count, stock_batch_count
  )
  RETURNING id INTO backup_id;

  RETURN jsonb_build_object(
    'id', backup_id,
    'created_at', (backup_payload->>'generated_at')::timestamptz,
    'payload', backup_payload,
    'counts', jsonb_build_object(
      'profiles', jsonb_array_length(backup_payload->'tables'->'profiles'),
      'categories', category_count,
      'products', product_count,
      'sales', sale_count,
      'sale_items', sale_item_count,
      'product_stock_batches', stock_batch_count
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_operational_backup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_operational_backup() TO authenticated;

NOTIFY pgrst, 'reload schema';
