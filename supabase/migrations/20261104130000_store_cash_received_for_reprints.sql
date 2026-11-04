BEGIN;

ALTER TABLE public.sales
  ADD COLUMN cash_received NUMERIC;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_cash_received_check
  CHECK (
    cash_received IS NULL OR (
      payment_method = 'cash' AND
      cash_received >= total_amount
    )
  );

COMMIT;
