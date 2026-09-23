-- Keep cloud backups private to administrators and retain only the seven
-- newest snapshots uploaded by each administrator.

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

DROP TRIGGER IF EXISTS operational_backup_retention ON public.operational_backups;
CREATE TRIGGER operational_backup_retention
AFTER INSERT ON public.operational_backups
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_backup_retention();

CREATE OR REPLACE FUNCTION public.upload_operational_backup(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE backup_id UUID;
DECLARE backup_created_at TIMESTAMPTZ;
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengunggah backup';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object'
    OR p_payload->>'format' <> 'tokobahan-operational-backup'
    OR p_payload->'tables' IS NULL THEN
    RAISE EXCEPTION 'Format backup tidak valid';
  END IF;
  IF octet_length(p_payload::text) > 25 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Ukuran backup melebihi batas 25 MB';
  END IF;

  INSERT INTO public.operational_backups(created_by, payload, backup_version)
  VALUES (auth.uid(), p_payload, COALESCE(p_payload->>'version', '1'))
  RETURNING id, created_at INTO backup_id, backup_created_at;

  RETURN jsonb_build_object('id', backup_id, 'created_at', backup_created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.upload_operational_backup(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_operational_backup(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
