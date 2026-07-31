-- Premade paints and tattoo inks are single practice-facing products. Keep
-- published product identity/profile rows immutable, but allow newly observed
-- manufacturer pigment evidence to be appended over time. Existing evidence
-- remains protected from update and deletion after publication.

DROP TRIGGER IF EXISTS archive_declared_pigment_frozen_insert;
