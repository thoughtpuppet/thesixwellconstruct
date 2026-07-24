ALTER TABLE art_works
ADD COLUMN print_intent TEXT NOT NULL DEFAULT 'unavailable'
CHECK (print_intent IN ('unavailable', 'planned'));
