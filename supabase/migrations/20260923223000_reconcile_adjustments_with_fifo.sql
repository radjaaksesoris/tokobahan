-- Keep stock batches aligned when stock opname or a return changes product stock.
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_product_id UUID, p_physical_stock NUMERIC, p_reason TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_stock NUMERIC;
  difference NUMERIC;
  remaining_to_remove NUMERIC;
  consumed NUMERIC;
  batch RECORD;
  adjustment_id UUID;
  current_cost NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat melakukan stok opname';
  END IF;
  IF p_physical_stock IS NULL OR p_physical_stock < 0 OR nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Stok fisik dan alasan wajib diisi';
  END IF;

  SELECT stock, cost_price INTO current_stock, current_cost
  FROM public.products
  WHERE id = p_product_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif';
  END IF;

  difference := p_physical_stock - current_stock;
  IF difference < 0 THEN
    remaining_to_remove := -difference;
    FOR batch IN
      SELECT id, quantity_remaining
      FROM public.product_stock_batches
      WHERE product_id = p_product_id AND quantity_remaining > 0
      ORDER BY received_at DESC, id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN remaining_to_remove <= 0;
      consumed := LEAST(remaining_to_remove, batch.quantity_remaining);
      UPDATE public.product_stock_batches
      SET quantity_remaining = quantity_remaining - consumed
      WHERE id = batch.id;
      remaining_to_remove := remaining_to_remove - consumed;
    END LOOP;
    IF remaining_to_remove > 0 THEN
      RAISE EXCEPTION 'Batch stok tidak konsisten dengan stok produk';
    END IF;
  ELSIF difference > 0 THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    ) VALUES (p_product_id, difference, difference, current_cost);
  END IF;

  INSERT INTO public.stock_adjustments(product_id, system_stock, physical_stock, difference, reason, adjusted_by)
  VALUES (p_product_id, current_stock, p_physical_stock, difference, trim(p_reason), auth.uid())
  RETURNING id INTO adjustment_id;

  UPDATE public.products
  SET stock = p_physical_stock, updated_at = now()
  WHERE id = p_product_id;
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
  restored_unit_cost NUMERIC;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat memproses retur';
  END IF;
  SELECT si.*, s.id AS parent_sale_id INTO item
  FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
  WHERE si.id = p_sale_item_id FOR UPDATE;
  IF NOT FOUND OR p_quantity IS NULL OR p_quantity <= 0 OR nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Data retur tidak valid';
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO already_returned
  FROM public.sale_returns WHERE sale_item_id = p_sale_item_id;
  IF already_returned + p_quantity > item.quantity THEN
    RAISE EXCEPTION 'Jumlah retur melebihi jumlah terjual';
  END IF;

  refund := ROUND((p_quantity / item.quantity) * item.line_total, 2);
  restored_unit_cost := CASE WHEN item.quantity > 0 THEN item.line_cost / item.quantity ELSE 0 END;
  INSERT INTO public.sale_returns(sale_id, sale_item_id, quantity, refund_amount, reason, returned_by)
  VALUES (item.parent_sale_id, p_sale_item_id, p_quantity, refund, trim(p_reason), auth.uid())
  RETURNING id INTO return_id;

  INSERT INTO public.product_stock_batches (
    product_id, quantity_received, quantity_remaining, unit_cost
  ) VALUES (item.product_id, p_quantity, p_quantity, restored_unit_cost);

  UPDATE public.products SET stock = stock + p_quantity, updated_at = now()
  WHERE id = item.product_id;
  UPDATE public.sales SET total_amount = total_amount - refund,
    total_cost = total_cost - ROUND((p_quantity / item.quantity) * item.line_cost, 2),
    total_profit = total_profit - ROUND((p_quantity / item.quantity) * item.line_profit, 2)
  WHERE id = item.parent_sale_id;
  RETURN return_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_sale_item(UUID, NUMERIC, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
