CREATE TABLE IF NOT EXISTS public.custom_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  factor NUMERIC(15,3) NOT NULL CHECK (factor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Custom units viewable by authenticated" ON public.custom_units;
CREATE POLICY "Custom units viewable by authenticated"
  ON public.custom_units FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Custom units manageable by admins" ON public.custom_units;
CREATE POLICY "Custom units manageable by admins"
  ON public.custom_units FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_units TO authenticated;
