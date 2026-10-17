import { buildPushPayload } from './vendor/webcrypto-web-push.js';
import { activateOwnerPush, resolvePushEnvironment } from './_setup.js';

export const BOOKING_REQUEST_TYPES = Object.freeze([
  'tattoo_inquiry', 'flash_claim', 'special_project', 'build_brief',
  'maze_design', 'tattoo_special', 'consultation', 'studio_booking',
]);
const DEVICE_LIMIT = 10;
const MAX_ATTEMPTS = 5;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export function requireBookingAdmin(request, env) {
  if (!env.SUBMISSIONS_ADMIN_TOKEN) return json({ error: 'Studio access is not configured.' }, 503);
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.slice(7) !== env.SUBMISSIONS_ADMIN_TOKEN) {
    return json({ error: 'Unlock Studio to continue.' }, 401);
  }
  return null;
}

export function pushConfigured(env) {
  return env.BOOKING_PUSH_ENABLED === 'true'
    && Boolean(env.BOOKING_PUSH_PUBLIC_KEY && env.BOOKING_PUSH_PRIVATE_KEY && env.BOOKING_PUSH_SUBJECT);
}

function base64urlBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid push key.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
}

export function allowedPushEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    return url.hostname === 'web.push.apple.com'
      || url.hostname.endsWith('.push.apple.com')
      || url.hostname === 'fcm.googleapis.com'
      || url.hostname === 'updates.push.services.mozilla.com'
      || url.hostname === 'updates-autopush.stage.mozaws.net'
      || url.hostname.endsWith('.notify.windows.com');
  } catch { return false; }
}

export async function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || !allowedPushEndpoint(value.endpoint)) {
    throw new Error('This push service is not supported.');
  }
  const publicKey = base64urlBytes(value.keys?.p256dh);
  const auth = base64urlBytes(value.keys?.auth);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) throw new Error('Invalid push subscription keys.');
  await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return { endpoint: value.endpoint, expirationTime: null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 8192) throw new Error('Request is too large.');
  return JSON.parse(text);
}

export async function handleBookingPushApi(request, env) {
  const auth = requireBookingAdmin(request, env);
  if (auth) return auth;
  const path = new URL(request.url).pathname;
  if (!env.SUBMISSIONS_DB) return json({ error: 'The booking database is unavailable.' }, 503);
  try {
    const canActivate = env.BOOKING_PUSH_ENABLED !== 'false';
    if (path === '/api/admin/booking-push/activate' && request.method === 'POST') {
      if (!canActivate) return json({ error: 'Phone alerts have been paused in the website settings.' }, 409);
      env = await activateOwnerPush(env);
      return json({ configured: pushConfigured(env), publicKey: env.BOOKING_PUSH_PUBLIC_KEY, canActivate: false });
    }
    env = await resolvePushEnvironment(env);
    if (path === '/api/admin/booking-push/config' && request.method === 'GET') {
      return json({ configured: pushConfigured(env), publicKey: pushConfigured(env) ? env.BOOKING_PUSH_PUBLIC_KEY : null,
        canActivate: canActivate && !pushConfigured(env) });
    }
    const db = env.SUBMISSIONS_DB;
    if (path === '/api/admin/booking-push/subscriptions' && request.method === 'POST') {
      if (!pushConfigured(env)) return json({ error: 'Phone notifications have not been activated yet.' }, 503);
      let body, subscription;
      try { body = await readBody(request); subscription = await validateSubscription(body.subscription); }
      catch { return json({ error: 'Invalid push subscription.' }, 400); }
      const existing = await db.prepare('SELECT id FROM booking_push_subscriptions WHERE endpoint = ?').bind(subscription.endpoint).first();
      const count = await db.prepare('SELECT COUNT(*) AS count FROM booking_push_subscriptions').first();
      if (!existing && count.count >= DEVICE_LIMIT) return json({ error: 'Remove a saved device before adding another.' }, 409);
      const now = new Date().toISOString();
      const id = existing?.id || crypto.randomUUID();
      await db.prepare(`INSERT INTO booking_push_subscriptions (id, endpoint, subscription_json, device_label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json,
        device_label = excluded.device_label, updated_at = excluded.updated_at`)
        .bind(id, subscription.endpoint, JSON.stringify(subscription), String(body.deviceLabel || 'My device').slice(0, 80), now, now).run();
      return json({ ok: true, subscriptionId: id });
    }
    if (path === '/api/admin/booking-push/subscriptions' && request.method === 'DELETE') {
      let body;
      try { body = await readBody(request); } catch { return json({ error: 'Invalid request.' }, 400); }
      if (typeof body.endpoint !== 'string') return json({ error: 'A device is required.' }, 400);
      await db.batch([
        db.prepare('DELETE FROM booking_push_deliveries WHERE subscription_id IN (SELECT id FROM booking_push_subscriptions WHERE endpoint = ?)').bind(body.endpoint),
        db.prepare('DELETE FROM booking_push_subscriptions WHERE endpoint = ?').bind(body.endpoint),
      ]);
      return json({ ok: true });
    }
    if (path === '/api/admin/booking-push/test' && request.method === 'POST') {
      if (!pushConfigured(env)) return json({ error: 'Phone notifications have not been activated yet.' }, 503);
      let body;
      try { body = await readBody(request); } catch { return json({ error: 'Invalid request.' }, 400); }
      const device = await db.prepare('SELECT * FROM booking_push_subscriptions WHERE endpoint = ?').bind(String(body.endpoint || '')).first();
      if (!device) return json({ error: 'Enable notifications on this device first.' }, 404);
      const result = await enqueuePush(env, `test:${crypto.randomUUID()}`, {
        title: 'art.pill booking alerts', body: 'This device is ready for new booking requests.', url: '/studio/bookings/',
      }, [device]);
      return json(result.sent ? result : { ...result, error: 'The push service did not accept the test alert. Try reconnecting notifications.' }, result.sent ? 200 : 502);
    }
    return json({ error: 'Unsupported notification request.' }, 405);
  } catch (error) {
    console.error('Booking push API failed.', error);
    return json({ error: 'Phone notifications are temporarily unavailable.' }, 503);
  }
}

export async function notifyBookingRequestPush(env, submission) {
  if (!env.SUBMISSIONS_DB || !BOOKING_REQUEST_TYPES.includes(submission.type) || !submission.id) return { skipped: true };
  env = await resolvePushEnvironment(env);
  if (!pushConfigured(env) || !env.SUBMISSIONS_DB || !BOOKING_REQUEST_TYPES.includes(submission.type) || !submission.id) {
    return { skipped: true };
  }
  const devices = (await env.SUBMISSIONS_DB.prepare('SELECT * FROM booking_push_subscriptions ORDER BY created_at LIMIT ?').bind(DEVICE_LIMIT).all()).results || [];
  return enqueuePush(env, `request:${submission.id}`, {
    title: 'New art.pill booking request', body: 'Open your inbox to review the details.',
    url: `/studio/bookings/?request=${encodeURIComponent(submission.id)}`,
    tag: `booking:${submission.id}`,
  }, devices);
}

async function enqueuePush(env, eventKey, payload, devices) {
  if (!devices.length) return { skipped: true, sent: 0 };
  const now = new Date().toISOString();
  await env.SUBMISSIONS_DB.batch(devices.map((device) => env.SUBMISSIONS_DB.prepare(
    `INSERT OR IGNORE INTO booking_push_deliveries (id, subscription_id, event_key, payload_json, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), device.id, eventKey, JSON.stringify(payload), now, now, now)));
  return flushBookingPush(env, eventKey);
}

async function deliver(env, row) {
  const db = env.SUBMISSIONS_DB;
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 120000).toISOString();
  const claim = await db.prepare(`UPDATE booking_push_deliveries SET status = 'sending', attempts = attempts + 1,
    next_attempt_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'sending') AND next_attempt_at <= ?`)
    .bind(lease, now, row.id, now).run();
  if (!claim.meta?.changes) return { sent: false };
  let status = 0;
  try {
    const subscription = await validateSubscription(JSON.parse(row.subscription_json));
    const payload = await buildPushPayload({ data: JSON.parse(row.payload_json), options: { ttl: 86400, urgency: 'high' } }, subscription, {
      subject: env.BOOKING_PUSH_SUBJECT, publicKey: env.BOOKING_PUSH_PUBLIC_KEY, privateKey: env.BOOKING_PUSH_PRIVATE_KEY,
    });
    // Workers supports follow/manual, not redirect: 'error'. Treat redirects as
    // failed delivery without forwarding the device payload or authorization.
    const response = await fetch(subscription.endpoint, { ...payload, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    status = response.status;
    await response.body?.cancel();
  } catch { /* Network errors remain retryable; never log device capability URLs or keys. */ }
  const sent = status >= 200 && status < 300;
  const expired = status === 404 || status === 410;
  const retryable = !status || status === 429 || status >= 500;
  const attempts = row.attempts + 1;
  const state = sent ? 'sent' : expired ? 'expired' : retryable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed';
  const next = new Date(Date.now() + Math.min(3600000, 60000 * 2 ** attempts)).toISOString();
  await db.prepare('UPDATE booking_push_deliveries SET status = ?, last_status = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?')
    .bind(state, status || null, next, new Date().toISOString(), row.id).run();
  if (expired) {
    await db.batch([
      db.prepare('DELETE FROM booking_push_deliveries WHERE subscription_id = ?').bind(row.subscription_id),
      db.prepare('DELETE FROM booking_push_subscriptions WHERE id = ?').bind(row.subscription_id),
    ]);
  }
  return { sent, expired };
}

export async function flushBookingPush(env, eventKey = '') {
  env = await resolvePushEnvironment(env);
  if (!pushConfigured(env) || !env.SUBMISSIONS_DB) return { skipped: true, sent: 0 };
  const now = new Date().toISOString();
  const rows = (await env.SUBMISSIONS_DB.prepare(`SELECT d.*, s.subscription_json
    FROM booking_push_deliveries d JOIN booking_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.status IN ('pending', 'sending') AND d.next_attempt_at <= ? AND d.attempts < ?
    ${eventKey ? 'AND d.event_key = ?' : ''} ORDER BY d.created_at LIMIT 10`)
    .bind(now, MAX_ATTEMPTS, ...(eventKey ? [eventKey] : [])).all()).results || [];
  const results = await Promise.allSettled(rows.map((row) => deliver(env, row)));
  if (!eventKey) {
    await env.SUBMISSIONS_DB.prepare("UPDATE booking_push_deliveries SET status = 'failed', updated_at = ? WHERE status = 'sending' AND attempts >= ? AND next_attempt_at <= ?")
      .bind(now, MAX_ATTEMPTS, now).run();
    await env.SUBMISSIONS_DB.prepare("DELETE FROM booking_push_deliveries WHERE status IN ('sent', 'failed') AND updated_at < ?")
      .bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
  }
  return { ok: true, sent: results.filter((result) => result.status === 'fulfilled' && result.value.sent).length,
    pending: results.filter((result) => result.status === 'rejected' || !result.value.sent).length };
}
