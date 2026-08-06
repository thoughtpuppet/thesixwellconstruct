ALTER TABLE special_project_call_media
  ADD COLUMN card_focal_x INTEGER NOT NULL DEFAULT 50
  CHECK(card_focal_x BETWEEN 0 AND 100);

ALTER TABLE special_project_call_media
  ADD COLUMN card_focal_y INTEGER NOT NULL DEFAULT 50
  CHECK(card_focal_y BETWEEN 0 AND 100);
