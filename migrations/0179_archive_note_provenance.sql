PRAGMA foreign_keys = ON;

-- Optional public context explaining how an independently archived Note was
-- normalized or reconstructed for presentation.
ALTER TABLE archive_notes
  ADD COLUMN provenance_note TEXT NOT NULL DEFAULT '';
