PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS flash_sheet_designs (
  id TEXT PRIMARY KEY,
  flash_item_id TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','available','reserved','placed','retired')),
  reserved_submission_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (flash_item_id) REFERENCES flash_items(id) ON DELETE CASCADE,
  FOREIGN KEY (reserved_submission_id) REFERENCES submissions(id) ON DELETE SET NULL,
  UNIQUE (flash_item_id, code)
);

CREATE INDEX IF NOT EXISTS idx_flash_sheet_designs_public
  ON flash_sheet_designs(flash_item_id, state, sort_order);

CREATE INDEX IF NOT EXISTS idx_flash_sheet_designs_reservation
  ON flash_sheet_designs(reserved_submission_id, state)
  WHERE reserved_submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS submission_flash_designs (
  submission_id TEXT NOT NULL,
  sheet_design_id TEXT NOT NULL,
  flash_item_id TEXT NOT NULL,
  code_snapshot TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  placement TEXT NOT NULL,
  scale TEXT NOT NULL DEFAULT '',
  requested_order INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'requested'
    CHECK (outcome IN ('requested','approved','not_approved','released','placed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (submission_id, sheet_design_id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (sheet_design_id) REFERENCES flash_sheet_designs(id) ON DELETE RESTRICT,
  FOREIGN KEY (flash_item_id) REFERENCES flash_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_flash_designs_submission
  ON submission_flash_designs(submission_id, requested_order);

CREATE INDEX IF NOT EXISTS idx_submission_flash_designs_design
  ON submission_flash_designs(sheet_design_id, outcome);
