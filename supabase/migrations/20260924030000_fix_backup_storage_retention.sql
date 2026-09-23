-- Storage objects must be removed through the Storage API, not by deleting
-- directly from storage.objects inside a database trigger.

CREATE OR REPLACE FUNCTION public.enforce_operational_backup_retention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.operational_backups
  WHERE id IN (
    SELECT id
    FROM public.operational_backups
    WHERE created_by = NEW.created_by
    ORDER BY created_at DESC, id DESC
    OFFSET 7
  );
  RETURN NEW;
END;
$$;
