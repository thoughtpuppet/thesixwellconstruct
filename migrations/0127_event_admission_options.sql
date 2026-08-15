-- Multi-part events can offer independently timed RSVP, ticket, queue, and
-- virtual-access choices without fragmenting one public Event identity into
-- unrelated cards. A NULL capacity is intentionally unlimited.

CREATE TABLE event_admission_options (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  occurrence_id TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  admission_kind TEXT NOT NULL DEFAULT 'rsvp'
    CHECK (admission_kind IN ('rsvp','ticket','queue')),
  attendance_mode TEXT NOT NULL DEFAULT 'in_person'
    CHECK (attendance_mode IN ('in_person','virtual')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  max_seats_per_order INTEGER NOT NULL DEFAULT 1 CHECK (max_seats_per_order >= 1),
  registration_status TEXT NOT NULL DEFAULT 'closed'
    CHECK (registration_status IN ('open','closed','cancelled')),
  reminder_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (reminder_enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (occurrence_id) REFERENCES event_occurrences(id) ON DELETE SET NULL,
  UNIQUE (event_id, slug)
);

CREATE INDEX idx_event_admission_options_event_sort
  ON event_admission_options(event_id, sort_order, starts_at);

ALTER TABLE event_tickets ADD COLUMN admission_option_id TEXT
  REFERENCES event_admission_options(id) ON DELETE SET NULL;

CREATE INDEX idx_event_tickets_admission_status
  ON event_tickets(admission_option_id, status, created_at);

INSERT OR IGNORE INTO events (
  id,slug,title,description,starts_at,ends_at,location,
  price_cents,currency,capacity,max_seats_per_order,status,publication_state,
  image_url,details,included,arrival_notes,accessibility_notes,
  cancellation_policy,contact_note,waitlist_enabled,is_recurring,
  created_at,updated_at
) VALUES (
  'evt_solehmans_new_year_i',
  'solehmans-new-year',
  'SOLEHMAN''S NEW YEAR I',
  'An annual showcase presenting the work made across the creative ecosystem during the year.',
  '2027-10-15T19:00:00-04:00',
  '2027-10-18T23:00:00-04:00',
  'art.pill Tattoo House, Castleberry Hill, Atlanta, 364 Nelson Street SW, Atlanta, GA 30313',
  0,
  'USD',
  0,
  1,
  'closed',
  'draft',
  '',
  'Three programmed days move through an exhibition opening and fashion show, public live tattooing, a Tattoo Party, an artist talk, a showing of the creative ecosystem website and tools, and the closing. A bonus open-studio viewing day follows on October 18.',
  'The exhibition and new merch remain available for viewing during published studio hours. Admission requirements are specific to each program session.',
  'Choose the session you plan to attend. RSVP and ticket confirmations include the session time, location, calendar link, and reminder email.',
  'Contact the studio before attending if you need access accommodations or support participating in the virtual program.',
  'Free RSVPs may be cancelled by replying to the confirmation. Paid-session cancellation terms will be finalized before sales open.',
  'Reply to your confirmation email if your plans change.',
  0,
  1,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO content_entities (
  id,entity_type,node_id,visibility,search_visibility,public_at,
  created_by,updated_by,created_at,updated_at
) VALUES (
  'evt_solehmans_new_year_i','event','node-events','internal',0,NULL,
  'migration-0127','migration-0127',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO event_occurrences (
  id,event_id,starts_at,ends_at,location,capacity,max_seats_per_order,status,
  sort_order,created_at,updated_at
) VALUES
  ('occ_sny_i_2027_10_15','evt_solehmans_new_year_i','2027-10-15T19:00:00-04:00','2027-10-15T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,1,'closed',0,datetime('now'),datetime('now')),
  ('occ_sny_i_2027_10_16','evt_solehmans_new_year_i','2027-10-16T11:00:00-04:00','2027-10-16T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,1,'closed',1,datetime('now'),datetime('now')),
  ('occ_sny_i_2027_10_17','evt_solehmans_new_year_i','2027-10-17T11:00:00-04:00','2027-10-17T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,1,'closed',2,datetime('now'),datetime('now')),
  ('occ_sny_i_2027_10_18','evt_solehmans_new_year_i','2027-10-18T11:00:00-04:00','2027-10-18T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,1,'closed',3,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO event_admission_options (
  id,event_id,occurrence_id,slug,title,description,admission_kind,attendance_mode,
  starts_at,ends_at,location,price_cents,currency,capacity,max_seats_per_order,
  registration_status,reminder_enabled,sort_order,created_at,updated_at
) VALUES
  ('adm_sny_i_opening','evt_solehmans_new_year_i','occ_sny_i_2027_10_15','exhibition-opening','Exhibition Opening + Fashion Show','Opening night for the annual exhibition. The fashion show presenting new merch begins at 8:30 PM.','rsvp','in_person','2027-10-15T19:00:00-04:00','2027-10-15T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,'USD',NULL,1,'open',1,0,datetime('now'),datetime('now')),
  ('adm_sny_i_viewing_sat','evt_solehmans_new_year_i','occ_sny_i_2027_10_16','saturday-open-studio','Saturday Open Studio Viewing','View the exhibition and new merch from 11 AM to 11 PM. This RSVP does not include admission to the live-tattoo audience or a Tattoo Party place.','rsvp','in_person','2027-10-16T11:00:00-04:00','2027-10-16T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,'USD',NULL,1,'open',1,1,datetime('now'),datetime('now')),
  ('adm_sny_i_live_in_person','evt_solehmans_new_year_i','occ_sny_i_2027_10_16','live-tattoo-in-person','Live Tattoo — In Person','Watch a live tattoo in the studio and ask questions during the process.','ticket','in_person','2027-10-16T11:00:00-04:00','2027-10-16T14:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',10000,'USD',12,1,'closed',1,2,datetime('now'),datetime('now')),
  ('adm_sny_i_live_virtual','evt_solehmans_new_year_i','occ_sny_i_2027_10_16','live-tattoo-virtual','Live Tattoo — Virtual','Watch the live tattoo online and submit questions during the event. Virtual access is unlimited.','ticket','virtual','2027-10-16T11:00:00-04:00','2027-10-16T14:00:00-04:00','Virtual access details shared after registration',5000,'USD',NULL,1,'closed',1,3,datetime('now'),datetime('now')),
  ('adm_sny_i_tattoo_party','evt_solehmans_new_year_i','occ_sny_i_2027_10_16','tattoo-party','Tattoo Party','Ten prepaid first-come places for $60 small tattoos by Saiel Solehman. Payment saves the attendee''s place in line.','queue','in_person','2027-10-16T18:00:00-04:00','2027-10-16T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',6000,'USD',10,1,'closed',1,4,datetime('now'),datetime('now')),
  ('adm_sny_i_viewing_sun','evt_solehmans_new_year_i','occ_sny_i_2027_10_17','sunday-open-studio','Sunday Open Studio Viewing','View the exhibition and new merch from 11 AM to 11 PM. The artist talk begins at 3 PM.','rsvp','in_person','2027-10-17T11:00:00-04:00','2027-10-17T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,'USD',NULL,1,'open',1,5,datetime('now'),datetime('now')),
  ('adm_sny_i_artist_talk','evt_solehmans_new_year_i','occ_sny_i_2027_10_17','artist-talk-and-closing','Artist Talk + Creative Ecosystem Showing + Closing','An artist talk at 3 PM followed by a showing of the website and tools that form the creative ecosystem, then the closing.','rsvp','in_person','2027-10-17T15:00:00-04:00','2027-10-17T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,'USD',NULL,1,'open',1,6,datetime('now'),datetime('now')),
  ('adm_sny_i_bonus_viewing','evt_solehmans_new_year_i','occ_sny_i_2027_10_18','bonus-open-studio','Bonus Open Studio Viewing','A final viewing day for anyone who missed the weekend. The exhibition and new merch are open from 11 AM to 11 PM.','rsvp','in_person','2027-10-18T11:00:00-04:00','2027-10-18T23:00:00-04:00','art.pill Tattoo House, Castleberry Hill, Atlanta',0,'USD',NULL,1,'open',1,7,datetime('now'),datetime('now'));
