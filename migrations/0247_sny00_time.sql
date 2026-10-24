-- Authorized SNY00 schedule update. Preserve the event, occurrence and RSVP identities.
UPDATE events SET
  starts_at='2026-11-06T19:00:00-05:00',
  ends_at='2026-11-06T21:00:00-05:00',
  arrival_notes=replace(arrival_notes,'arrive promptly at 6:30 PM','arrive promptly at 7 PM'),
  updated_at=datetime('now')
WHERE id='evt_sny_00' AND slug='sny-00';

UPDATE event_occurrences SET
  starts_at='2026-11-06T19:00:00-05:00',
  ends_at='2026-11-06T21:00:00-05:00',
  updated_at=datetime('now')
WHERE event_id='evt_sny_00' AND id='occ_sny_00_2026_11_06';
