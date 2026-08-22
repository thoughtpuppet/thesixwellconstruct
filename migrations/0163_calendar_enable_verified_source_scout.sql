-- Enable the server-side verified-source lane used by Studio's Run Scout action.
-- This lane reads enabled calendar_sources and writes only private candidates,
-- revisions, Strong Picks, and run diagnostics. It does not publish events.
UPDATE calendar_scout_connectors
SET enabled = 1,
    status = 'ready',
    last_error = '',
    cadence_hours = 24,
    per_run_limit = 20,
    updated_at = datetime('now')
WHERE id = 'direct' AND connector_type = 'direct';
