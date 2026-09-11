-- The start of writing is separate from the creation of its database record.
-- Existing entries have a known first-save time, but no recorded first keystroke.
ALTER TABLE writing_entries ADD COLUMN started_at TEXT;
ALTER TABLE writing_entries ADD COLUMN draft_saved_at TEXT;

UPDATE writing_entries
SET draft_saved_at = COALESCE(
  (SELECT r.created_at FROM entity_revisions r
   WHERE r.entity_id=writing_entries.entity_id
     AND r.action IN ('writing-create','writing-save-draft')
   ORDER BY r.revision_number DESC LIMIT 1),
  created_at
), version = version + 1;

CREATE TRIGGER writing_entry_creation_dates_guard
BEFORE UPDATE OF started_at,created_at ON writing_entries
WHEN NEW.started_at IS NOT OLD.started_at OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'The original writing dates cannot change'); END;
