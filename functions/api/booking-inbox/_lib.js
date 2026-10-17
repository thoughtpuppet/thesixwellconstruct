import { BOOKING_REQUEST_TYPES, requireBookingAdmin } from '../booking-push/_lib.js';

export async function handleBookingInbox(request, env) {
  const auth = requireBookingAdmin(request, env);
  if (auth) return auth;
  const headers = { 'cache-control': 'no-store' };
  if (request.method !== 'GET') return Response.json({ error: 'Use GET for the booking inbox.' }, { status: 405, headers });
  try {
    const params = new URL(request.url).searchParams;
    const filter = params.get('filter') || 'active';
    if (!['active', 'unread', 'all'].includes(filter)) return Response.json({ error: 'Unknown inbox filter.' }, { status: 400, headers });
    const conditions = [`type IN (${BOOKING_REQUEST_TYPES.map(() => '?').join(',')})`];
    const bindings = [...BOOKING_REQUEST_TYPES];
    if (filter !== 'all') conditions.push("status NOT IN ('archived', 'cancelled', 'declined')");
    if (filter === 'unread') conditions.push("COALESCE(opened_at, '') = ''");
    if (params.has('before') || params.has('beforeId')) {
      const before = params.get('before') || '';
      const beforeId = params.get('beforeId') || '';
      if (!/^\d{4}-\d{2}-\d{2}T/.test(before) || beforeId.length > 100 || !beforeId) {
        return Response.json({ error: 'Invalid inbox cursor.' }, { status: 400, headers });
      }
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      bindings.push(before, before, beforeId);
    }
    const rows = (await env.SUBMISSIONS_DB.prepare(`SELECT id, type, status, subject, contact_name, contact_email,
      opened_at, created_at FROM submissions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 31`)
      .bind(...bindings).all()).results || [];
    const page = rows.slice(0, 30);
    const last = page.at(-1);
    return Response.json({ submissions: page.map((row) => ({ id: row.id, type: row.type, status: row.status,
      subject: row.subject || '', contactName: row.contact_name || '', contactEmail: row.contact_email || '',
      openedAt: row.opened_at || '', createdAt: row.created_at })),
      nextCursor: rows.length > 30 ? { before: last.created_at, beforeId: last.id } : null }, { headers });
  } catch (error) {
    console.error('Booking inbox unavailable.', error);
    return Response.json({ error: 'The booking inbox is temporarily unavailable.' }, { status: 503, headers });
  }
}
