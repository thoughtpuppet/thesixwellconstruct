ALTER TABLE flash_items ADD COLUMN process_category TEXT NOT NULL DEFAULT 'standard'
  CHECK (process_category IN ('standard','experimental'));
