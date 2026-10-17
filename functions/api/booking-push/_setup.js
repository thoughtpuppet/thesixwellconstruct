// Schema setup is limited to the authenticated owner's explicit activation action.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS booking_push_subscriptions (
    id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL,
    device_label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS booking_push_deliveries (
    id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES booking_push_subscriptions(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_status INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (subscription_id, event_key)
  )`,
  `CREATE INDEX IF NOT EXISTS booking_push_deliveries_due ON booking_push_deliveries(status, next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS booking_push_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL,
    subject TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
];

export async function resolvePushEnvironment(env) {
  if (!env.SUBMISSIONS_DB || env.BOOKING_PUSH_ENABLED === 'false') return env;
  if (env.BOOKING_PUSH_ENABLED === 'true' && env.BOOKING_PUSH_PUBLIC_KEY && env.BOOKING_PUSH_PRIVATE_KEY) return env;
  let saved;
  try { saved = await env.SUBMISSIONS_DB.prepare('SELECT public_key, private_key, subject FROM booking_push_settings WHERE id = 1').first(); }
  catch (error) {
    if (/no such table/i.test(String(error.message))) return env;
    throw error;
  }
  return saved ? { ...env, BOOKING_PUSH_ENABLED: 'true', BOOKING_PUSH_PUBLIC_KEY: saved.public_key,
    BOOKING_PUSH_PRIVATE_KEY: saved.private_key, BOOKING_PUSH_SUBJECT: saved.subject } : env;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function activateOwnerPush(env) {
  if (env.BOOKING_PUSH_ENABLED === 'false') throw new Error('Phone alerts have been paused in the website settings.');
  await env.SUBMISSIONS_DB.batch(SCHEMA.map((sql) => env.SUBMISSIONS_DB.prepare(sql)));
  const resolved = await resolvePushEnvironment(env);
  if (resolved.BOOKING_PUSH_PUBLIC_KEY && resolved.BOOKING_PUSH_PRIVATE_KEY) return resolved;
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = base64url(await crypto.subtle.exportKey('raw', keys.publicKey));
  const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d;
  // First activation wins; simultaneous setup or a second phone cannot rotate the key.
  await env.SUBMISSIONS_DB.prepare(`INSERT OR IGNORE INTO booking_push_settings (id, public_key, private_key, subject, created_at)
    VALUES (1, ?, ?, ?, ?)`).bind(publicKey, privateKey, env.BOOKING_PUSH_SUBJECT || 'mailto:saisolehman@artpilltattoohouse.com', new Date().toISOString()).run();
  return resolvePushEnvironment(env);
}
