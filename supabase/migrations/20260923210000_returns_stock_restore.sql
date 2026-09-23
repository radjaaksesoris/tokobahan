CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  system_stock NUMERIC(15,3) NOT NULL,
  physical_stock NUMERIC(15,3) NOT NULL,
  difference NUMERIC(15,3) NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  refund_amount NUMERIC(15,2) NOT NULL CHECK (refund_amount >= 0),
  reason TEXT NOT NULL,
  returned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated stock adjustments" ON public.stock_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated sale returns" ON public.sale_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_product_id UUID, p_physical_stock NUMERIC, p_reason TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_stock NUMERIC;
  adjustment_id UUID;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Hanya admin yang dapat melakukan stok opname'; END IF;
  IF p_physical_stock IS NULL OR p_physical_stock < 0 OR nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Stok fisik dan alasan wajib diisi';
  END IF;
  SELECT stock INTO current_stock FROM public.products WHERE id = p_product_id AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif'; END IF;
  INSERT INTO public.stock_adjustments(product_id, system_stock, physical_stock, difference, reason, adjusted_by)
  VALUES (p_product_id, current_stock, p_physical_stock, p_physical_stock - current_stock, trim(p_reason), auth.uid())
  RETURNING id INTO adjustment_id;
  UPDATE public.products SET stock = p_physical_stock, updated_at = now() WHERE id = p_product_id;
  RETURN adjustment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.return_sale_item(
  p_sale_item_id UUID, p_quantity NUMERIC, p_reason TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item RECORD;
  already_returned NUMERIC;
  refund NUMERIC;
  return_id UUID;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Hanya admin yang dapat memproses retur'; END IF;
  SELECT si.*, s.id AS parent_sale_id INTO item
  FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
  WHERE si.id = p_sale_item_id FOR UPDATE;
  IF NOT FOUND OR p_quantity IS NULL OR p_quantity <= 0 OR nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Data retur tidak valid';
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO already_returned FROM public.sale_returns WHERE sale_item_id = p_sale_item_id;
  IF already_returned + p_quantity > item.quantity THEN RAISE EXCEPTION 'Jumlah retur melebihi jumlah terjual'; END IF;
  refund := ROUND((p_quantity / item.quantity) * item.line_total, 2);
  INSERT INTO public.sale_returns(sale_id, sale_item_id, quantity, refund_amount, reason, returned_by)
  VALUES (item.parent_sale_id, p_sale_item_id, p_quantity, refund, trim(p_reason), auth.uid())
  RETURNING id INTO return_id;
  UPDATE public.products SET stock = stock + p_quantity, updated_at = now() WHERE id = item.product_id;
  UPDATE public.sales SET total_amount = total_amount - refund,
    total_cost = total_cost - ROUND((p_quantity / item.quantity) * item.line_cost, 2),
    total_profit = total_profit - ROUND((p_quantity / item.quantity) * item.line_profit, 2)
  WHERE id = item.parent_sale_id;
  RETURN return_id;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_operational_backup(p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t JSONB;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Hanya admin yang dapat memulihkan backup'; END IF;
  IF p_payload->>'format' <> 'tokobahan-operational-backup' THEN RAISE EXCEPTION 'Format backup tidak valid'; END IF;
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
  t := p_payload->'tables';
  INSERT INTO public.categories SELECT * FROM jsonb_populate_recordset(NULL::public.categories, COALESCE(t->'categories','[]'));
  INSERT INTO public.vendors SELECT * FROM jsonb_populate_recordset(NULL::public.vendors, COALESCE(t->'vendors','[]'));
  INSERT INTO public.custom_units SELECT * FROM jsonb_populate_recordset(NULL::public.custom_units, COALESCE(t->'custom_units','[]'));
  INSERT INTO public.products SELECT * FROM jsonb_populate_recordset(NULL::public.products, COALESCE(t->'products','[]'));
  INSERT INTO public.product_stock_batches SELECT * FROM jsonb_populate_recordset(NULL::public.product_stock_batches, COALESCE(t->'product_stock_batches','[]'));
  INSERT INTO public.customers SELECT * FROM jsonb_populate_recordset(NULL::public.customers, COALESCE(t->'customers','[]'));
  INSERT INTO public.sales SELECT * FROM jsonb_populate_recordset(NULL::public.sales, COALESCE(t->'sales','[]'));
  INSERT INTO public.sale_items SELECT * FROM jsonb_populate_recordset(NULL::public.sale_items, COALESCE(t->'sale_items','[]'));
  INSERT INTO public.vendor_debt_payments SELECT * FROM jsonb_populate_recordset(NULL::public.vendor_debt_payments, COALESCE(t->'vendor_debt_payments','[]'));
  INSERT INTO public.customer_debt_payments SELECT * FROM jsonb_populate_recordset(NULL::public.customer_debt_payments, COALESCE(t->'customer_debt_payments','[]'));
  INSERT INTO public.stock_adjustments SELECT * FROM jsonb_populate_recordset(NULL::public.stock_adjustments, COALESCE(t->'stock_adjustments','[]'));
  INSERT INTO public.sale_returns SELECT * FROM jsonb_populate_recordset(NULL::public.sale_returns, COALESCE(t->'sale_returns','[]'));
END; $$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_sale_item(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_operational_backup(JSONB) TO authenticated;
