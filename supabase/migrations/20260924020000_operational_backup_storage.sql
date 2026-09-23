-- Store operational backups as real, private Supabase Storage objects.
-- Existing JSON payloads remain readable for backwards compatibility.

ALTER TABLE public.operational_backups
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
  ADD COLUMN IF NOT EXISTS storage_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS storage_content_type TEXT,
  ADD COLUMN IF NOT EXISTS storage_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_operational_backups_storage_object_path
  ON public.operational_backups(storage_object_path)
  WHERE storage_object_path IS NOT NULL;


-- Retention removes database metadata only. Storage objects are managed through
-- the Storage API and are cleaned up by the application when possible.
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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('operational-backups', 'operational-backups', false, 26214400, ARRAY['application/json']::text[])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY['application/json']::text[];

DROP POLICY IF EXISTS "Admins can read operational backup objects" ON storage.objects;
CREATE POLICY "Admins can read operational backup objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'operational-backups'
    AND public.current_user_has_role(ARRAY['admin'])
  );

DROP POLICY IF EXISTS "Admins can upload operational backup objects" ON storage.objects;
CREATE POLICY "Admins can upload operational backup objects"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'operational-backups'
    AND public.current_user_has_role(ARRAY['admin'])
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Admins can update operational backup objects" ON storage.objects;
CREATE POLICY "Admins can update operational backup objects"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'operational-backups'
    AND public.current_user_has_role(ARRAY['admin'])
  )
  WITH CHECK (
    bucket_id = 'operational-backups'
    AND public.current_user_has_role(ARRAY['admin'])
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Admins can delete operational backup objects" ON storage.objects;
CREATE POLICY "Admins can delete operational backup objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'operational-backups'
    AND public.current_user_has_role(ARRAY['admin'])
  );

CREATE OR REPLACE FUNCTION public.finalize_operational_backup_storage(
  p_backup_id UUID,
  p_storage_object_path TEXT,
  p_storage_size_bytes BIGINT,
  p_storage_content_type TEXT DEFAULT 'application/json'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Hanya admin yang dapat menyimpan metadata backup';
  END IF;
  IF p_storage_object_path IS NULL
    OR p_storage_object_path <> auth.uid()::text || '/' || p_backup_id::text || '.json' THEN
    RAISE EXCEPTION 'Path object backup tidak valid';
  END IF;
  IF p_storage_size_bytes IS NULL OR p_storage_size_bytes < 1 OR p_storage_size_bytes > 25 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Ukuran object backup tidak valid';
  END IF;
  IF p_storage_content_type IS DISTINCT FROM 'application/json' THEN
    RAISE EXCEPTION 'Tipe content backup tidak valid';
  END IF;

  UPDATE public.operational_backups
  SET storage_bucket = 'operational-backups',
      storage_object_path = p_storage_object_path,
      storage_size_bytes = p_storage_size_bytes,
      storage_content_type = p_storage_content_type,
      storage_uploaded_at = now()
  WHERE id = p_backup_id AND created_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup tidak ditemukan';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_operational_backup_storage(UUID, TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_operational_backup_storage(UUID, TEXT, BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
