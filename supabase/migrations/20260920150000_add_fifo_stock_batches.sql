-- Track stock cost by receipt batch and consume batches using FIFO at checkout.

CREATE TABLE IF NOT EXISTS public.product_stock_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_received NUMERIC(15,3) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(15,3) NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_batches_fifo
  ON public.product_stock_batches(product_id, received_at, id)
  WHERE quantity_remaining > 0;

ALTER TABLE public.product_stock_batches ENABLE ROW LEVEL SECURITY;

INSERT INTO public.product_stock_batches (
  product_id, quantity_received, quantity_remaining, unit_cost
)
SELECT
  p.id, p.stock, p.stock, p.cost_price
FROM public.products p
WHERE p.stock > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_stock_batches b
    WHERE b.product_id = p.id
  );

CREATE OR REPLACE FUNCTION public.record_stock_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.stock > 0 THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    )
    VALUES (NEW.id, NEW.stock, NEW.stock, NEW.cost_price);
  ELSIF TG_OP = 'UPDATE' AND NEW.stock > OLD.stock THEN
    INSERT INTO public.product_stock_batches (
      product_id, quantity_received, quantity_remaining, unit_cost
    )
    VALUES (NEW.id, NEW.stock - OLD.stock, NEW.stock - OLD.stock, NEW.cost_price);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_record_stock_batch ON public.products;
CREATE TRIGGER products_record_stock_batch
AFTER INSERT OR UPDATE OF stock ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.record_stock_batch();

CREATE OR REPLACE FUNCTION public.receive_stock_batch(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Jumlah stok masuk harus lebih besar dari 0';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'HPP tidak boleh negatif';
  END IF;

  UPDATE public.products
  SET stock = stock + p_quantity,
      cost_price = p_unit_cost,
      updated_at = now()
  WHERE id = p_product_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau sudah tidak aktif';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_invoice_no TEXT,
  p_total_amount NUMERIC,
  p_total_cost NUMERIC,
  p_total_profit NUMERIC,
  p_payment_method TEXT,
  p_cashier_id UUID,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_sale_id UUID;
  item JSONB;
  batch RECORD;
  current_stock NUMERIC;
  requested_quantity NUMERIC;
  remaining_quantity NUMERIC;
  consumed_quantity NUMERIC;
  calculated_line_cost NUMERIC;
  calculated_total_cost NUMERIC := 0;
  calculated_total_amount NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi pengguna tidak valid';
  END IF;

  IF p_cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang';
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

  FOR item IN SELECT item_json FROM jsonb_array_elements(p_items) AS elements(item_json)
  LOOP
    requested_quantity := (item->>'quantity')::NUMERIC;
    IF requested_quantity IS NULL OR requested_quantity <= 0 THEN
      RAISE EXCEPTION 'Jumlah produk harus lebih besar dari 0';
    END IF;

    SELECT stock INTO current_stock
    FROM public.products
    WHERE id = (item->>'product_id')::UUID
    FOR UPDATE;

    IF current_stock IS NULL OR current_stock < requested_quantity THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi', item->>'product_name';
    END IF;

    remaining_quantity := requested_quantity;
    calculated_line_cost := 0;

    FOR batch IN
      SELECT id, quantity_remaining, unit_cost
      FROM public.product_stock_batches
      WHERE product_id = (item->>'product_id')::UUID
        AND quantity_remaining > 0
      ORDER BY received_at, id
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
      RAISE EXCEPTION 'Batch HPP untuk % tidak mencukupi', item->>'product_name';
    END IF;

    INSERT INTO fifo_checkout_items (
      product_id, product_name, unit, quantity, conversion, unit_price,
      line_total, line_cost, line_profit
    )
    VALUES (
      (item->>'product_id')::UUID,
      item->>'product_name',
      item->>'unit',
      requested_quantity,
      COALESCE((item->>'conversion')::NUMERIC, 1),
      (item->>'unit_price')::NUMERIC,
      (item->>'line_total')::NUMERIC,
      calculated_line_cost,
      (item->>'line_total')::NUMERIC - calculated_line_cost
    );

    calculated_total_cost := calculated_total_cost + calculated_line_cost;
    calculated_total_amount := calculated_total_amount + (item->>'line_total')::NUMERIC;
  END LOOP;

  INSERT INTO public.sales (
    invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id
  )
  VALUES (
    p_invoice_no,
    calculated_total_amount,
    calculated_total_cost,
    calculated_total_amount - calculated_total_cost,
    p_payment_method,
    p_cashier_id
  )
  RETURNING id INTO new_sale_id;

  INSERT INTO public.sale_items (
    sale_id, product_id, product_name, unit, quantity, conversion,
    unit_price, line_total, line_cost, line_profit
  )
  SELECT
    new_sale_id, product_id, product_name, unit, quantity, conversion,
    unit_price, line_total, line_cost, line_profit
  FROM fifo_checkout_items;

  UPDATE public.products p
  SET stock = p.stock - item.quantity,
      updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity) AS quantity
    FROM fifo_checkout_items
    GROUP BY product_id
  ) item
  WHERE p.id = item.product_id;

  RETURN new_sale_id;
END;
$$;

REVOKE ALL ON TABLE public.product_stock_batches FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.record_stock_batch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock_batch(UUID, NUMERIC, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_sale(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
