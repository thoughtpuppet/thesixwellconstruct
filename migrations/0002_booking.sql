CREATE TABLE IF NOT EXISTS booking_types (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  submission_id TEXT NOT NULL,
  allowed_booking_types_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_tokens_submission
  ON booking_tokens(submission_id, created_at);

CREATE INDEX IF NOT EXISTS idx_booking_tokens_hash
  ON booking_tokens(token_hash);

CREATE TABLE IF NOT EXISTS availability_windows (
  id TEXT PRIMARY KEY,
  venture TEXT NOT NULL,
  booking_type_id TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
  is_blackout INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_windows_start
  ON availability_windows(venture, active, start_at);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  submission_id TEXT,
  booking_token_id TEXT,
  booking_type_id TEXT NOT NULL,
  availability_window_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending_deposit',
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  client_phone TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  deposit_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  square_order_id TEXT,
  square_payment_link_id TEXT,
  square_checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_token_id) REFERENCES booking_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE RESTRICT,
  FOREIGN KEY (availability_window_id) REFERENCES availability_windows(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_window_status
  ON appointments(availability_window_id, status);

CREATE INDEX IF NOT EXISTS idx_appointments_submission
  ON appointments(submission_id, created_at);

CREATE TABLE IF NOT EXISTS deposit_payments (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'square',
  provider_checkout_id TEXT,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deposit_payments_appointment
  ON deposit_payments(appointment_id, created_at);

INSERT OR IGNORE INTO booking_types (
  id, venture, label, description, duration_minutes, deposit_cents, currency,
  active, sort_order, created_at, updated_at
) VALUES
  (
    'tattoo_quarter', 'tattooing', 'Quarter Session',
    'Approx. 1.5 hours for small approved projects, flash, or focused work.',
    90, 5000, 'USD', 1, 10, datetime('now'), datetime('now')
  ),
  (
    'tattoo_half', 'tattooing', 'Half Session',
    'Approx. 3 hours for medium approved projects or developed symbolic work.',
    180, 10000, 'USD', 1, 20, datetime('now'), datetime('now')
  ),
  (
    'tattoo_full', 'tattooing', 'Full Session',
    'Up to 6 hours for large approved work, special projects, or deeper sessions.',
    360, 20000, 'USD', 1, 30, datetime('now'), datetime('now')
  );
