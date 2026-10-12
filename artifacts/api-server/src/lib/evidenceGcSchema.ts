import prisma from "./prisma";

/**
 * This is intentionally idempotent and runs under a PostgreSQL advisory
 * transaction lock. Prisma db push creates the modeled tables; the DDL below
 * makes the trigger/index portion safe on first startup and after a deploy
 * where the application starts before a manual setup command is rerun.
 */
const EVIDENCE_GC_DDL = [
  `CREATE TABLE IF NOT EXISTS evidence_objects (
    id text PRIMARY KEY,
    object_path text NOT NULL UNIQUE,
    content_type text,
    size_bytes integer,
    original_name text,
    requested_by_user_id text,
    state text NOT NULL DEFAULT 'active',
    retention_until timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    eligible_at timestamptz,
    eligibility_reason text,
    deleting_at timestamptz,
    deletion_lease_until timestamptz,
    deletion_token text,
    deleted_at timestamptz,
    delete_attempts integer NOT NULL DEFAULT 0,
    last_delete_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE evidence_objects
    ADD COLUMN IF NOT EXISTS requested_by_user_id text`,
  `CREATE TABLE IF NOT EXISTS evidence_object_references (
    id text PRIMARY KEY,
    object_id text NOT NULL REFERENCES evidence_objects(id) ON DELETE RESTRICT,
    source_type text NOT NULL,
    source_id text NOT NULL,
    source_field text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT evidence_object_reference_source_key UNIQUE (source_type, source_id, source_field)
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_gc_runs (
    id text PRIMARY KEY,
    mode text NOT NULL,
    actor_user_id text,
    actor_email text,
    dry_run_id text,
    dry_run_expires_at timestamptz,
    consumed_at timestamptz,
    consumed_by_run_id text,
    retention_days integer NOT NULL,
    requested_limit integer NOT NULL,
    examined_count integer NOT NULL DEFAULT 0,
    eligible_count integer NOT NULL DEFAULT 0,
    marked_eligible integer NOT NULL DEFAULT 0,
    marked_deleting integer NOT NULL DEFAULT 0,
    retryable_deleting_count integer NOT NULL DEFAULT 0,
    protected_by_reference_count integer NOT NULL DEFAULT 0,
    deleted_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    skipped_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'running',
    error_message text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  )`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS marked_eligible integer NOT NULL DEFAULT 0`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS dry_run_id text`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS dry_run_expires_at timestamptz`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS consumed_at timestamptz`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS consumed_by_run_id text`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS retryable_deleting_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE evidence_gc_runs
    ADD COLUMN IF NOT EXISTS protected_by_reference_count integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS evidence_gc_attempts (
    id text PRIMARY KEY,
    run_id text NOT NULL REFERENCES evidence_gc_runs(id) ON DELETE CASCADE,
    object_id text NOT NULL REFERENCES evidence_objects(id) ON DELETE RESTRICT,
    object_path text NOT NULL,
    outcome text NOT NULL,
    error_message text,
    attempt_count integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT evidence_gc_attempt_run_object_key UNIQUE (run_id, object_id)
  )`,
  `CREATE INDEX IF NOT EXISTS evidence_objects_state_retention_idx
    ON evidence_objects (state, retention_until)`,
  `CREATE INDEX IF NOT EXISTS evidence_objects_state_eligible_idx
    ON evidence_objects (state, eligible_at)`,
  `CREATE INDEX IF NOT EXISTS evidence_objects_deletion_lease_idx
    ON evidence_objects (deletion_lease_until)`,
  `CREATE INDEX IF NOT EXISTS evidence_object_references_object_idx
    ON evidence_object_references (object_id)`,
  `CREATE INDEX IF NOT EXISTS evidence_object_references_source_idx
    ON evidence_object_references (source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS evidence_gc_runs_started_idx
    ON evidence_gc_runs (started_at)`,
  `CREATE INDEX IF NOT EXISTS evidence_gc_attempts_object_idx
    ON evidence_gc_attempts (object_id, started_at)`,
  `CREATE OR REPLACE FUNCTION evidence_gc_normalize_path(raw_path text)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  AS $evidence_gc$
  DECLARE
    candidate text;
  BEGIN
    IF raw_path IS NULL THEN RETURN NULL; END IF;
    candidate := split_part(split_part(btrim(raw_path), '?', 1), '#', 1);
    -- Absolute URLs may alias the exact canonical API path. Do not accept a
    -- report/external path that merely contains an objects/uploads suffix.
    IF candidate ~ '^https?://[^/]+/objects/uploads/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      candidate := regexp_replace(candidate, '^https?://[^/]+', '');
    END IF;
    IF candidate !~ '^/objects/uploads/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RETURN NULL;
    END IF;
    IF candidate IS NULL THEN RETURN NULL; END IF;
    RETURN lower(candidate);
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_extract_paths(payload jsonb)
  RETURNS TABLE(object_path text)
  LANGUAGE sql
  IMMUTABLE
  AS $evidence_gc$
    WITH RECURSIVE nodes(value) AS (
      SELECT payload
      UNION ALL
      SELECT child.value
      FROM nodes
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value
          WHEN jsonb_typeof(nodes.value) = 'object'
            THEN jsonb_path_query_array(nodes.value, '$.*')
          ELSE '[]'::jsonb
        END
      ) child
    )
    SELECT DISTINCT evidence_gc_normalize_path(value #>> '{}')
    FROM nodes
    WHERE jsonb_typeof(value) = 'string'
      AND evidence_gc_normalize_path(value #>> '{}') IS NOT NULL
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_extract_text_paths(raw_value text)
  RETURNS TABLE(object_path text)
  LANGUAGE plpgsql
  IMMUTABLE
  AS $evidence_gc$
  DECLARE
    direct_path text;
    parsed jsonb;
  BEGIN
    direct_path := evidence_gc_normalize_path(raw_value);
    IF direct_path IS NOT NULL THEN
      object_path := direct_path;
      RETURN NEXT;
      RETURN;
    END IF;
    IF left(btrim(coalesce(raw_value, '')), 1) NOT IN ('[', '{') THEN
      RETURN;
    END IF;
    BEGIN
      parsed := raw_value::jsonb;
    EXCEPTION WHEN others THEN
      -- An invalid legacy JSON value is not a GC root, but also must not make
      -- a checklist write fail solely because it is outside this feature.
      RETURN;
    END;
    RETURN QUERY SELECT paths.object_path FROM evidence_gc_extract_paths(parsed) paths;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_upsert_reference(
    raw_path text,
    ref_source_type text,
    ref_source_id text,
    ref_source_field text
  )
  RETURNS void
  LANGUAGE plpgsql
  AS $evidence_gc$
  DECLARE
    canonical_path text;
    object_id_value text;
    object_state text;
  BEGIN
    canonical_path := evidence_gc_normalize_path(raw_path);
    IF canonical_path IS NULL THEN RETURN; END IF;

    -- The row lock is the admission gate. A GC transaction that has committed
    -- deleting cannot be undone by a late reference, even across universities.
    SELECT id, state INTO object_id_value, object_state
    FROM evidence_objects
    WHERE object_path = canonical_path
    FOR UPDATE;
    IF object_id_value IS NULL THEN
      RAISE EXCEPTION 'Evidence object % was not registered before reference creation', canonical_path
        USING ERRCODE = '23514';
    END IF;
    IF object_state <> 'active' THEN
      RAISE EXCEPTION 'Evidence object % is unavailable for new references', canonical_path
        USING ERRCODE = '23514';
    END IF;
    -- A reference that returns after an old gallery row was removed starts a
    -- fresh grace period if that object was previously marked eligible.
    UPDATE evidence_objects
    SET eligible_at = NULL, eligibility_reason = NULL, updated_at = now()
    WHERE id = object_id_value AND state = 'active';
    INSERT INTO evidence_object_references
      (id, object_id, source_type, source_id, source_field, created_at, updated_at)
    VALUES
      (md5(ref_source_type || ':' || ref_source_id || ':' || ref_source_field),
       object_id_value, ref_source_type, ref_source_id, ref_source_field, now(), now())
    ON CONFLICT (source_type, source_id, source_field)
    DO UPDATE SET object_id = EXCLUDED.object_id, updated_at = now();
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_sync_text_reference(
    raw_value text,
    ref_source_type text,
    ref_source_id text,
    ref_source_field text
  )
  RETURNS void
  LANGUAGE plpgsql
  AS $evidence_gc$
  DECLARE
    path_record record;
  BEGIN
    FOR path_record IN
      SELECT object_path FROM evidence_gc_extract_text_paths(raw_value)
    LOOP
      PERFORM evidence_gc_upsert_reference(
        path_record.object_path,
        ref_source_type,
        ref_source_id,
        CASE
          WHEN evidence_gc_normalize_path(raw_value) IS NOT NULL THEN ref_source_field
          ELSE ref_source_field || ':' || md5(path_record.object_path)
        END
      );
    END LOOP;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_sync_dataset_references(
    payload jsonb,
    ref_source_type text,
    ref_source_id text,
    ref_source_field text
  )
  RETURNS void
  LANGUAGE plpgsql
  AS $evidence_gc$
  DECLARE
    path_record record;
  BEGIN
    FOR path_record IN SELECT object_path FROM evidence_gc_extract_paths(payload)
    LOOP
      PERFORM evidence_gc_upsert_reference(
        path_record.object_path,
        ref_source_type,
        ref_source_id,
        ref_source_field || ':' || md5(path_record.object_path)
      );
    END LOOP;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_space_status_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $evidence_gc$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM evidence_object_references
      WHERE source_type = 'space_checklist_status' AND source_id = OLD.id;
      RETURN OLD;
    END IF;
    DELETE FROM evidence_object_references
    WHERE source_type = 'space_checklist_status' AND source_id = NEW.id
      AND (source_field = 'photo_url' OR source_field LIKE 'photo_url:%');
    PERFORM evidence_gc_sync_text_reference(
      NEW.photo_url, 'space_checklist_status', NEW.id, 'photo_url'
    );
    RETURN NEW;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_photo_history_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $evidence_gc$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM evidence_object_references
      WHERE source_type = 'photo_history' AND source_id = OLD.id;
      RETURN OLD;
    END IF;
    DELETE FROM evidence_object_references
    WHERE source_type = 'photo_history' AND source_id = NEW.id
      AND (source_field = 'photo_url' OR source_field LIKE 'photo_url:%');
    PERFORM evidence_gc_sync_text_reference(
      NEW.photo_url, 'photo_history', NEW.id, 'photo_url'
    );
    RETURN NEW;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_university_update_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $evidence_gc$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM evidence_object_references
      WHERE source_type = 'university_update' AND source_id = OLD.id;
      RETURN OLD;
    END IF;
    DELETE FROM evidence_object_references
    WHERE source_type = 'university_update' AND source_id = NEW.id
      AND (source_field = 'image_url' OR source_field LIKE 'image_url:%');
    -- image_url is historically both a URL and a JSON array string.
    PERFORM evidence_gc_sync_text_reference(
      NEW.image_url, 'university_update', NEW.id, 'image_url'
    );
    RETURN NEW;
  END
  $evidence_gc$`,
  `CREATE OR REPLACE FUNCTION evidence_gc_pending_report_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $evidence_gc$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM evidence_object_references
      WHERE source_type = 'pending_report_snapshot' AND source_id = OLD.id;
      RETURN OLD;
    END IF;
    DELETE FROM evidence_object_references
    WHERE source_type = 'pending_report_snapshot' AND source_id = NEW.id;
    PERFORM evidence_gc_sync_dataset_references(
      NEW.dataset::jsonb, 'pending_report_snapshot', NEW.id, 'dataset'
    );
    RETURN NEW;
  END
  $evidence_gc$`,
  // Block checklist/gallery/update/report writes while the initial scan and
  // reference backfill are committed together with trigger installation.
  `LOCK TABLE
    space_checklist_status,
    photo_history,
    university_updates,
    pending_report_snapshots
    IN SHARE MODE`,
  `WITH paths AS (
    SELECT DISTINCT object_path FROM (
      SELECT paths.object_path
      FROM space_checklist_status status
      CROSS JOIN LATERAL evidence_gc_extract_text_paths(status.photo_url) paths
      UNION ALL
      SELECT paths.object_path
      FROM photo_history history
      CROSS JOIN LATERAL evidence_gc_extract_text_paths(history.photo_url) paths
      UNION ALL
      SELECT paths.object_path
      FROM university_updates update_row
      CROSS JOIN LATERAL evidence_gc_extract_text_paths(update_row.image_url) paths
      UNION ALL
      SELECT paths.object_path
      FROM pending_report_snapshots snapshot
      CROSS JOIN LATERAL evidence_gc_extract_paths(snapshot.dataset::jsonb) paths
    ) all_paths
  )
  INSERT INTO evidence_objects
    (id, object_path, retention_until, state, created_at, updated_at)
  SELECT md5('evidence-object:' || paths.object_path), paths.object_path,
    now() + interval '30 days', 'active', now(), now()
  FROM paths
  ON CONFLICT (object_path) DO NOTHING`,
  `WITH refs AS (
    SELECT DISTINCT
      'space_checklist_status'::text AS source_type, status.id::text AS source_id,
      CASE WHEN left(btrim(coalesce(status.photo_url, '')), 1) IN ('[', '{')
        THEN 'photo_url:' || md5(paths.object_path) ELSE 'photo_url' END AS source_field,
      paths.object_path
    FROM space_checklist_status status
    CROSS JOIN LATERAL evidence_gc_extract_text_paths(status.photo_url) paths
    UNION ALL
    SELECT 'photo_history', history.id::text, 'photo_url', paths.object_path
    FROM photo_history history
    CROSS JOIN LATERAL evidence_gc_extract_text_paths(history.photo_url) paths
    UNION ALL
    SELECT 'university_update', update_row.id::text,
      CASE WHEN left(btrim(coalesce(update_row.image_url, '')), 1) IN ('[', '{')
        THEN 'image_url:' || md5(update_paths.object_path) ELSE 'image_url' END,
      update_paths.object_path
    FROM university_updates update_row
    CROSS JOIN LATERAL evidence_gc_extract_text_paths(update_row.image_url) update_paths
    UNION ALL
    SELECT 'pending_report_snapshot', snapshot.id::text,
      'dataset:' || md5(report_paths.object_path), report_paths.object_path
    FROM pending_report_snapshots snapshot
    CROSS JOIN LATERAL evidence_gc_extract_paths(snapshot.dataset::jsonb) report_paths
  )
  INSERT INTO evidence_object_references
    (id, object_id, source_type, source_id, source_field, created_at, updated_at)
  SELECT md5(refs.source_type || ':' || refs.source_id || ':' || refs.source_field),
    objects.id, refs.source_type, refs.source_id, refs.source_field, now(), now()
  FROM refs
  JOIN evidence_objects objects ON objects.object_path = refs.object_path
  ON CONFLICT (source_type, source_id, source_field)
  DO UPDATE SET object_id = EXCLUDED.object_id, updated_at = now()`,
  `DROP TRIGGER IF EXISTS evidence_gc_space_status_reference ON space_checklist_status`,
  `CREATE TRIGGER evidence_gc_space_status_reference
    AFTER INSERT OR UPDATE OF photo_url OR DELETE ON space_checklist_status
    FOR EACH ROW EXECUTE FUNCTION evidence_gc_space_status_trigger()`,
  `DROP TRIGGER IF EXISTS evidence_gc_photo_history_reference ON photo_history`,
  `CREATE TRIGGER evidence_gc_photo_history_reference
    AFTER INSERT OR UPDATE OF photo_url OR DELETE ON photo_history
    FOR EACH ROW EXECUTE FUNCTION evidence_gc_photo_history_trigger()`,
  `DROP TRIGGER IF EXISTS evidence_gc_university_update_reference ON university_updates`,
  `CREATE TRIGGER evidence_gc_university_update_reference
    AFTER INSERT OR UPDATE OF image_url OR DELETE ON university_updates
    FOR EACH ROW EXECUTE FUNCTION evidence_gc_university_update_trigger()`,
  `DROP TRIGGER IF EXISTS evidence_gc_pending_report_reference ON pending_report_snapshots`,
  `CREATE TRIGGER evidence_gc_pending_report_reference
    AFTER INSERT OR UPDATE OF dataset OR DELETE ON pending_report_snapshots
    FOR EACH ROW EXECUTE FUNCTION evidence_gc_pending_report_trigger()`,
];

let initialized = false;
let initializationPromise: Promise<void> | null = null;

export async function ensureEvidenceGcSchema(): Promise<void> {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('niat:evidence-gc:v1'))::text",
    );
    for (const statement of EVIDENCE_GC_DDL) {
      await tx.$executeRawUnsafe(statement);
    }
  }, { timeout: 120_000 });
  try {
    await initializationPromise;
    initialized = true;
  } finally {
    initializationPromise = null;
  }
}