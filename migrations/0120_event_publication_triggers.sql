-- Event writes now synchronize content_entities in the Events API, where
-- publication and operational changes can be handled as one lifecycle.

DROP TRIGGER IF EXISTS trg_connections_events_insert;
DROP TRIGGER IF EXISTS trg_connections_events_update;
