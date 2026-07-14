ALTER TABLE portfolio_items ADD COLUMN statement TEXT NOT NULL DEFAULT '';
ALTER TABLE portfolio_items ADD COLUMN process_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE portfolio_items ADD COLUMN techniques TEXT NOT NULL DEFAULT '';
ALTER TABLE portfolio_items ADD COLUMN session_count INTEGER
  CHECK (session_count IS NULL OR session_count >= 1);
ALTER TABLE portfolio_items ADD COLUMN session_note TEXT NOT NULL DEFAULT '';
ALTER TABLE portfolio_items ADD COLUMN similar_inquiries_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (similar_inquiries_enabled IN (0, 1));
ALTER TABLE portfolio_items ADD COLUMN similar_inquiry_note TEXT NOT NULL DEFAULT '';
