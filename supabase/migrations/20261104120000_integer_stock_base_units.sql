BEGIN;

ALTER TABLE public.products
  ADD COLUMN stock_unit_mode TEXT DEFAULT 'fractional';

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_unit_mode_check
  CHECK (stock_unit_mode IS NULL OR stock_unit_mode IN ('fractional', 'integer-base'));

COMMIT;
