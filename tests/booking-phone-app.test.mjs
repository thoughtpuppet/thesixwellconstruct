import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createECDH, createDecipheriv, hkdfSync, randomBytes, createPublicKey, verify } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import worker from '../_worker.js';
import { handleBookingInbox } from '../functions/api/booking-inbox/_lib.js';
import { BOOKING_PUSH_SAMPLES, handleBookingPushApi, notifyBookingRequestPush, notifyBookingAppointmentPush, flushBookingPush, allowedPushEndpoint } from '../functions/api/booking-push/_lib.js';
import { notifyAdminSubmissionReceived, notifyAdminAppointmentConfirmed, notifyAdminAppointmentRescheduled, notifyAppointmentCancelled } from '../functions/api/notifications/_lib.js';

const root = new URL('../', import.meta.url);
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}
function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('migrations/', root)).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`migrations/${file}`, root), 'utf8'));
  }
  const db = { prepare: (sql) => new Statement(sqlite, sql), batch: async (statements) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const key = createECDH('prime256v1'); key.generateKeys();
  return { sqlite, env: { SUBMISSIONS_DB: db, SUBMISSIONS_ADMIN_TOKEN: 'test-owner-token', BOOKING_PUSH_ENABLED: 'true',
    BOOKING_PUSH_PUBLIC_KEY: key.getPublicKey().toString('base64url'), BOOKING_PUSH_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
    BOOKING_PUSH_SUBJECT: 'mailto:owner@example.test' } };
}
function device(endpoint = 'https://web.push.apple.com/test-device') {
  const key = createECDH('prime256v1'); key.generateKeys();
  const auth = randomBytes(16);
  return { key, auth, subscription: { endpoint, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}
function request(path, method = 'GET', body, authorized = true) {
  return new Request(`https://studio.example.test${path}`, { method, headers: {
    ...(authorized ? { authorization: 'Bearer test-owner-token' } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function subscribe(env, value) {
  const response = await handleBookingPushApi(request('/api/admin/booking-push/subscriptions', 'POST', { subscription: value }), env);
  assert.equal(response.status, 200); return response.json();
}
const booking = { id: 'request-one', type: 'tattoo_inquiry', contactName: 'Private Name', contactEmail: 'private@example.test', subject: 'Private project notes' };
const SAMPLE_TITLES = {
  engagement_request: 'New Construct Engagement Inquiry',
  tattoo_inquiry: 'New Custom Inquiry', flash_claim: 'New Flash Claim', special_project: 'New Special Project Request',
  build_brief: 'New Build Your Own Request', maze_design: 'New Maze Design Request', tattoo_special: 'New Tattoo Special Request',
  consultation: 'New Consultation Request', build_session: 'New In-Person Build Session Request', studio_booking: 'New Studio Booking Request',
  artist_led: 'New Artist-Led Design Request', appointment_confirmed: 'Appointment Booked',
  appointment_group_confirmed: 'Appointments Booked', appointment_rescheduled: 'Appointment Rescheduled', appointment_cancelled: 'Appointment Canceled',
};

function decrypt(payload, client) {
  const body = Buffer.from(payload.body), salt = body.subarray(0, 16), keyLength = body[20];
  const serverPublic = body.subarray(21, 21 + keyLength);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), client.key.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', client.key.computeSecret(serverPublic), client.auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const encrypted = body.subarray(21 + keyLength), decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(encrypted.subarray(-16));
  const clear = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  const delimiter = clear.lastIndexOf(2);
  return JSON.parse(clear.subarray(0, delimiter).toString());
}

test('Worker and notification routes reject public callers and tokens in query strings', async () => {
  const { env } = environment();
  for (const path of ['/api/admin/booking-inbox', '/api/admin/booking-push/config']) {
    const response = await worker.fetch(request(path, 'GET', null, false), env);
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await worker.fetch(request(`${path}?token=test-owner-token`, 'GET', null, false), env)).status, 401);
  }
  const config = await (await handleBookingPushApi(request('/api/admin/booking-push/config'), env)).json();
  assert.equal(config.publicKey, env.BOOKING_PUSH_PUBLIC_KEY); assert.equal(config.privateKey, undefined);
});

test('subscription validation prevents internal URLs, redirects hosts, and malformed crypto keys', async () => {
  const { env } = environment();
  assert.equal(allowedPushEndpoint('https://web.push.apple.com.attacker.test/token'), false);
  assert.equal(allowedPushEndpoint('https://web.push.apple.com:444/token'), false);
  for (const endpoint of ['http://web.push.apple.com/token', 'https://127.0.0.1/private', 'https://attacker.test/token']) {
    const response = await handleBookingPushApi(request('/api/admin/booking-push/subscriptions', 'POST', { subscription: device(endpoint).subscription }), env);
    assert.equal(response.status, 400);
  }
  const invalid = device().subscription; invalid.keys.p256dh = 'abcd';
  assert.equal((await handleBookingPushApi(request('/api/admin/booking-push/subscriptions', 'POST', { subscription: invalid }), env)).status, 400);
});

test('owner activation sets up an existing live database without requiring a Cloudflare login', async () => {
  const { env, sqlite } = environment();
  delete env.BOOKING_PUSH_ENABLED; delete env.BOOKING_PUSH_PUBLIC_KEY; delete env.BOOKING_PUSH_PRIVATE_KEY;
  delete env.BOOKING_PUSH_SUBJECT;
  sqlite.exec('DROP TABLE booking_push_deliveries; DROP TABLE booking_push_subscriptions; DROP TABLE booking_push_settings;');
  assert.equal((await handleBookingPushApi(request('/api/admin/booking-push/activate', 'POST', null, false), env)).status, 401);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='booking_push_settings'").get(), undefined);
  const before = await (await handleBookingPushApi(request('/api/admin/booking-push/config'), env)).json();
  assert.equal(before.configured, false); assert.equal(before.canActivate, true);
  const first = await (await handleBookingPushApi(request('/api/admin/booking-push/activate', 'POST'), env)).json();
  assert.equal(first.configured, true); assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);
  const again = await (await handleBookingPushApi(request('/api/admin/booking-push/activate', 'POST'), env)).json();
  assert.equal(again.publicKey, first.publicKey);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM booking_push_settings').get().count, 1);
  const saved = sqlite.prepare('SELECT private_key FROM booking_push_settings').get();
  const config = await (await handleBookingPushApi(request('/api/admin/booking-push/config'), env)).json();
  assert.equal(config.configured, true); assert.ok(!JSON.stringify(config).includes(saved.private_key));
  const client = device(); await subscribe(env, client.subscription);
  const original = globalThis.fetch; let message;
  globalThis.fetch = async (_url, payload) => { message = decrypt(payload, client); return new Response(null, { status: 201 }); };
  try {
    await notifyBookingRequestPush(env, booking);
    assert.equal(message.url, '/studio/bookings/?request=request-one');
    env.BOOKING_PUSH_ENABLED = 'false';
    assert.equal((await handleBookingPushApi(request('/api/admin/booking-push/activate', 'POST'), env)).status, 409);
    const paused = await (await handleBookingPushApi(request('/api/admin/booking-push/config'), env)).json();
    assert.equal(paused.configured, false); assert.equal(paused.canActivate, false);
  } finally { globalThis.fetch = original; }
});

test('actual Apple-compatible encrypted push is signed and deduplicated across notification calls', async () => {
  const { env, sqlite } = environment(), client = device();
  await subscribe(env, client.subscription); await subscribe(env, client.subscription);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM booking_push_subscriptions').get().count, 1);
  const original = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, payload) => { sent.push({ url, payload }); return new Response(null, { status: 201 }); };
  try {
    await notifyBookingRequestPush(env, booking); await notifyBookingRequestPush(env, booking);
    assert.equal(sent.length, 1);
    const { payload } = sent[0];
    assert.equal(payload.redirect, 'manual'); assert.equal(payload.headers['content-encoding'], 'aes128gcm');
    const message = decrypt(payload, client);
    assert.equal(message.url, '/studio/bookings/?request=request-one');
    assert.equal(message.title, 'New Custom Inquiry');
    assert.equal(message.body, 'Private Name');
    assert.ok(!JSON.stringify(message).includes('Private project notes')); assert.ok(!JSON.stringify(message).includes('private@example'));
    const token = payload.headers.authorization.match(/t=([^,]+)/)[1];
    const [header, body, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url'));
    assert.equal(claims.aud, 'https://web.push.apple.com');
    const raw = Buffer.from(env.BOOKING_PUSH_PUBLIC_KEY, 'base64url');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${header}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    assert.equal(sqlite.prepare('SELECT status FROM booking_push_deliveries').get().status, 'sent');
  } finally { globalThis.fetch = original; }
});

test('new request alerts identify each form and safely include only the requested client name', async () => {
  const { env } = environment(), client = device();
  await subscribe(env, client.subscription);
  const original = globalThis.fetch, messages = [];
  globalThis.fetch = async (_url, payload) => { messages.push(decrypt(payload, client)); return new Response(null, { status: 201 }); };
  try {
    for (const type of BOOKING_PUSH_SAMPLES.slice(0, 9).map(sample => sample.id)) {
      await notifyBookingRequestPush(env, { ...booking, id: type, type, contactName: ' Jordan\n Example\u202e ' });
      assert.equal(messages.at(-1).title, SAMPLE_TITLES[type]);
      assert.equal(messages.at(-1).body, 'Jordan Example');
      assert.ok(!JSON.stringify(messages.at(-1)).includes('private@example'));
      assert.ok(!JSON.stringify(messages.at(-1)).includes('Private project notes'));
    }
    await notifyAdminSubmissionReceived(env, { ...booking, id: 'artist-led', payload: { project_category: 'special_projects_artist_led' } });
    assert.equal(messages.at(-1).title, 'New Artist-Led Design Request');
    assert.equal(messages.at(-1).body, 'Private Name');
    await notifyBookingRequestPush(env, { ...booking, id: 'unnamed', contactName: '' });
    assert.equal(messages.at(-1).title, 'New Custom Inquiry');
    assert.equal(messages.at(-1).body, 'Open your inbox to review the request.');
  } finally { globalThis.fetch = original; }
});

test('appointment notification hooks send named confirmed, rescheduled, and canceled alerts once per saved event', async () => {
  const { env } = environment(), client = device();
  await subscribe(env, client.subscription);
  const original = globalThis.fetch, messages = [];
  globalThis.fetch = async (_url, payload) => { messages.push(decrypt(payload, client)); return new Response(null, { status: 201 }); };
  const appointment = { id: 'appointment-one', submission_id: booking.id, status: 'confirmed', booking_type_id: 'tattoo_quarter',
    client_name: 'Jordan Example', client_email: 'private@example.test', client_phone: '555-private',
    start_at: '2026-10-20T18:00:00.000Z', end_at: '2026-10-20T20:00:00.000Z', reschedule_count: 0 };
  try {
    await notifyAdminAppointmentConfirmed(env, null, { ...appointment, status: 'pending_deposit' });
    assert.equal(messages.length, 0);
    await notifyAdminAppointmentConfirmed(env, null, appointment);
    await notifyAdminAppointmentConfirmed(env, null, appointment, { idempotencyKey: 'manual-email-resend' });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].title, 'Appointment Booked');
    assert.match(messages[0].body, /^Jordan Example · .*Oct 20.*2:00.*EDT$/);
    assert.equal(messages[0].url, '/studio/bookings/?request=request-one');
    const moved = { ...appointment, start_at: '2026-10-22T18:00:00.000Z', rescheduled_at: '2026-10-17T18:00:00.000Z', reschedule_count: 1 };
    await notifyAdminAppointmentRescheduled(env, null, moved);
    await notifyAdminAppointmentRescheduled(env, null, moved, { idempotencyKey: 'resend-reschedule-email' });
    assert.equal(messages.length, 2);
    assert.equal(messages[1].title, 'Appointment Rescheduled');
    assert.match(messages[1].body, /^Jordan Example · .*Oct 22/);
    // A later move back to a previous time is a different saved event.
    await notifyAdminAppointmentRescheduled(env, null, { ...appointment, rescheduled_at: '2026-10-18T18:00:00.000Z', reschedule_count: 2 });
    assert.equal(messages.length, 3);
    const canceled = { ...appointment, status: 'cancelled', cancelled_at: '2026-10-19T18:00:00.000Z' };
    await notifyAppointmentCancelled(env, null, canceled);
    await notifyAppointmentCancelled(env, null, canceled, { idempotencyKey: 'resend-cancellation-email' });
    assert.equal(messages.length, 4);
    assert.equal(messages[3].title, 'Appointment Canceled');
    assert.match(messages[3].body, /^Jordan Example · .*Oct 20/);
    for (const message of messages) {
      assert.ok(!message.title.includes('art.pill'));
      assert.ok(!JSON.stringify(message).includes('private@example'));
      assert.ok(!JSON.stringify(message).includes('555-private'));
    }
  } finally { globalThis.fetch = original; }
});

test('grouped bookings send one confirmation and cancellation alerts do not require a client email', async () => {
  const { env } = environment(), client = device();
  await subscribe(env, client.subscription);
  const original = globalThis.fetch, messages = [];
  globalThis.fetch = async (_url, payload) => { messages.push(decrypt(payload, client)); return new Response(null, { status: 201 }); };
  try {
    const appointment = { id: 'group-anchor', status: 'confirmed', checkoutGroupId: 'group-one', checkoutGroupSize: 3, clientName: 'Jordan' };
    await notifyBookingAppointmentPush(env, 'confirmed', appointment);
    await notifyBookingAppointmentPush(env, 'confirmed', { ...appointment, id: 'group-second' });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].title, 'Appointments Booked');
    assert.equal(messages[0].body, 'Jordan · 3 appointments');
    await notifyAppointmentCancelled(env, null, { id: 'manual-no-email', status: 'cancelled', clientName: 'Jordan', startAt: 'invalid-date' });
    assert.equal(messages[1].title, 'Appointment Canceled');
    assert.equal(messages[1].body, 'Jordan');
    assert.equal(messages[1].url, '/studio/bookings/');
  } finally { globalThis.fetch = original; }
});

test('temporary failures retry; expired devices are removed; disabled alerts send nothing', async () => {
  const { env, sqlite } = environment(); await subscribe(env, device().subscription);
  const original = globalThis.fetch; let code = 503, count = 0;
  globalThis.fetch = async () => { count++; return new Response(null, { status: code }); };
  try {
    await notifyBookingRequestPush(env, booking);
    assert.equal(sqlite.prepare('SELECT status FROM booking_push_deliveries').get().status, 'pending');
    await flushBookingPush(env); assert.equal(count, 1);
    sqlite.exec("UPDATE booking_push_deliveries SET next_attempt_at = '2000-01-01T00:00:00.000Z'");
    code = 201; await flushBookingPush(env); assert.equal(count, 2);
    assert.equal(sqlite.prepare('SELECT status FROM booking_push_deliveries').get().status, 'sent');
    code = 410; await notifyBookingRequestPush(env, { ...booking, id: 'request-two' });
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM booking_push_subscriptions').get().count, 0);
    env.BOOKING_PUSH_ENABLED = 'false'; await notifyBookingRequestPush(env, booking); assert.equal(count, 3);
  } finally { globalThis.fetch = original; }
});

test('owner test alert uses Workers-supported manual redirects and reports actual acceptance', async () => {
  const { env, sqlite } = environment(), client = device();
  await subscribe(env, client.subscription);
  const path = '/api/admin/booking-push/test';
  assert.equal((await worker.fetch(request(path, 'POST', { endpoint: client.subscription.endpoint }, false), env)).status, 401);
  const original = globalThis.fetch;
  let code = 201, calls = 0;
  globalThis.fetch = async (url, payload) => {
    calls++;
    assert.equal(url, client.subscription.endpoint);
    // Cloudflare throws before sending when redirect is 'error'.
    assert.equal(payload.redirect, 'manual');
    const message = decrypt(payload, client);
    assert.equal(message.title, 'Test Alert');
    assert.equal(message.url, '/studio/bookings/');
    return new Response(null, { status: code, headers: code === 302 ? { location: 'https://attacker.test/' } : {} });
  };
  try {
    const accepted = await worker.fetch(request(path, 'POST', { endpoint: client.subscription.endpoint }), env);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).sent, 1);
    code = 302;
    const redirected = await worker.fetch(request(path, 'POST', { endpoint: client.subscription.endpoint }), env);
    assert.equal(redirected.status, 502);
    assert.match((await redirected.json()).error, /did not accept/);
    assert.equal(calls, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM booking_push_deliveries WHERE status='failed' AND last_status=302").get().count, 1);
  } finally { globalThis.fetch = original; }
});

test('every named sample uses the real message builders, stays owner-only, and creates no booking records', async () => {
  const { env, sqlite } = environment(), client = device();
  await subscribe(env, client.subscription);
  const original = globalThis.fetch, messages = [];
  globalThis.fetch = async (_url, payload) => { messages.push(decrypt(payload, client)); return new Response(null, { status: 201 }); };
  const path = '/api/admin/booking-push/test';
  const body = { endpoint: client.subscription.endpoint, clientName: 'Sai Solehman' };
  const before = sqlite.prepare('SELECT COUNT(*) count FROM appointments').get().count;
  try {
    assert.equal(BOOKING_PUSH_SAMPLES.length, 15);
    assert.equal((await worker.fetch(request(path, 'POST', { ...body, scenario: 'tattoo_inquiry' }, false), env)).status, 401);
    assert.equal((await worker.fetch(request(path, 'POST', { ...body, scenario: 'unknown' }), env)).status, 400);
    assert.equal((await worker.fetch(request(path, 'POST', { ...body, clientName: '', scenario: 'tattoo_inquiry' }), env)).status, 400);
    const config = await (await handleBookingPushApi(request('/api/admin/booking-push/config'), env)).json();
    assert.deepEqual(config.sampleTypes, BOOKING_PUSH_SAMPLES);
    for (const sample of BOOKING_PUSH_SAMPLES) {
      const response = await worker.fetch(request(path, 'POST', { ...body, scenario: sample.id }), env);
      assert.equal(response.status, 200, sample.id);
      const message = messages.at(-1);
      assert.equal(message.title, SAMPLE_TITLES[sample.id]);
      assert.match(message.body, /^TEST · .*Sai Solehman/);
      assert.equal(message.url, '/studio/bookings/');
      assert.match(message.tag, /^test:/);
    }
    assert.equal(messages[0].body, 'TEST · Sai Solehman');
    assert.match(messages.find(message => message.title === 'Appointment Booked').body, /^TEST · Sai Solehman · /);
    assert.match(messages.find(message => message.title === 'Appointments Booked').body, /3 appointments · First: /);
    assert.ok(messages.some(message => message.title === 'Appointment Rescheduled'));
    assert.ok(messages.some(message => message.title === 'Appointment Canceled'));
    assert.equal(new Set(messages.map(message => message.tag)).size, 15);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM appointments').get().count, before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM submissions').get().count, 0);
  } finally { globalThis.fetch = original; }
});

test('admin email flow still returns normally when push schema is unavailable', async () => {
  const { env, sqlite } = environment(); sqlite.exec('DROP TABLE booking_push_deliveries; DROP TABLE booking_push_subscriptions;');
  const original = console.error; console.error = () => {};
  try { const result = await notifyAdminSubmissionReceived(env, booking); assert.equal(result.skipped, true); }
  finally { console.error = original; }
});

test('inbox filters and stable pagination work on real submission rows', async () => {
  const { env, sqlite } = environment();
  const insert = sqlite.prepare(`INSERT INTO submissions (id,type,status,contact_name,contact_email,created_at,updated_at,opened_at) VALUES (?,?,'new','Client','client@example.test',?,?,?)`);
  for (let i = 0; i < 35; i++) insert.run(`request-${String(i).padStart(2, '0')}`, 'tattoo_inquiry', '2026-10-07T12:00:00.000Z', '2026-10-07T12:00:00.000Z', i < 5 ? '2026-10-07T13:00:00.000Z' : null);
  insert.run('non-booking', 'art_acquisition', '2026-10-08T12:00:00.000Z', '2026-10-08T12:00:00.000Z', null);
  const page = await (await handleBookingInbox(request('/api/admin/booking-inbox'), env)).json();
  assert.equal(page.submissions.length, 30); assert.ok(!page.submissions.some((row) => row.id === 'non-booking'));
  const next = await (await handleBookingInbox(request(`/api/admin/booking-inbox?${new URLSearchParams(page.nextCursor)}`), env)).json();
  assert.equal(next.submissions.length, 5); assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.submissions, ...next.submissions].map((row) => row.id)).size, 35);
  const unread = await (await handleBookingInbox(request('/api/admin/booking-inbox?filter=unread'), env)).json();
  assert.equal(unread.submissions.length, 30);
  assert.equal((await handleBookingInbox(request('/api/admin/booking-inbox?filter=invalid'), env)).status, 400);
});

test('service worker preserves event wording, uses the requested default title, and restricts navigation to the inbox', async () => {
  const listeners = {}, notices = [], windows = [];
  runInNewContext(readFileSync(new URL('studio/bookings/sw.js', root), 'utf8'), { URL, self: {
    location: { origin: 'https://studio.example.test' }, addEventListener: (name, callback) => { listeners[name] = callback; },
    registration: { showNotification: async (title, options) => notices.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow: async (url) => windows.push(url) },
  } });
  let pending;
  listeners.push({ data: { json: () => ({ url: 'https://attacker.test/' }) }, waitUntil: (value) => { pending = value; } });
  await pending; assert.equal(notices[0].options.data.url, 'https://studio.example.test/studio/bookings/');
  assert.equal(notices[0].title, 'Booking Update');
  listeners.push({ data: { json: () => ({ title: 'New Custom Inquiry', body: 'Jordan' }) }, waitUntil: (value) => { pending = value; } });
  await pending; assert.equal(notices[1].title, 'New Custom Inquiry'); assert.equal(notices[1].options.body, 'Jordan');
  listeners.notificationclick({ notification: { close() {}, data: { url: '/studio/submissions/?token=secret' } }, waitUntil: (value) => { pending = value; } });
  await pending; assert.equal(windows[0], 'https://studio.example.test/studio/bookings/');
  assert.equal(listeners.fetch, undefined);
});
