CREATE TABLE IF NOT EXISTS tattoo_rendering_requests (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  request_number INTEGER NOT NULL CHECK (request_number > 0),
  amount_cents INTEGER NOT NULL DEFAULT 5000 CHECK (amount_cents = 5000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled','expired','payment_attention')),
  square_order_id TEXT,
  square_payment_link_id TEXT,
  square_checkout_url TEXT,
  square_payment_id TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tattoo_rendering_requests_one_pending
  ON tattoo_rendering_requests(submission_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tattoo_rendering_requests_square_order
  ON tattoo_rendering_requests(square_order_id)
  WHERE square_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tattoo_rendering_requests_submission_history
  ON tattoo_rendering_requests(submission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tattoo_rendering_requests_appointment_status
  ON tattoo_rendering_requests(appointment_id, status, expires_at);
