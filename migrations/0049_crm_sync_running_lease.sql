-- A provider can have only one active sync. Keep the newest legacy runner if
-- an interrupted deployment left more than one row marked running.
ALTER TABLE crm_sync_jobs ADD COLUMN lease_token TEXT;

UPDATE crm_sync_jobs AS job
SET status = 'failed',
    error = CASE
      WHEN error = '' THEN 'Superseded by a newer provider sync.'
      ELSE error
    END,
    lease_token = NULL,
    completed_at = COALESCE(
      completed_at,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'running'
  AND EXISTS (
    SELECT 1
    FROM crm_sync_jobs AS newer
    WHERE newer.provider = job.provider
      AND newer.status = 'running'
      AND (
        newer.created_at > job.created_at
        OR (newer.created_at = job.created_at AND newer.id > job.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_sync_jobs_one_running_provider
  ON crm_sync_jobs(provider)
  WHERE status = 'running';
