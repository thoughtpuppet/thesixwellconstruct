// Free, private event registration and later paper-sheet reconciliation.
// Confirmation email uses the shared delivery log; no CRM, marketing or payment.
import { publicPageVisibilityDecision } from '../site-visibility/_lib.js';
import { notifyEventRsvpConfirmed } from '../notifications/_lib.js';
const RECEIVED = 'Your RSVP has been received. A confirmation email will follow. If you already registered, your original RSVP is kept. Contact the organizer for changes.';
const json = (data, status=200) => Response.json(data, {status, headers:{'cache-control':'no-store'}});
const fail = (error, status=400) => json({error}, status);
const text = value => typeof value === 'string' ? value.trim() : '';
const integer = value => (typeof value==='number' || (typeof value==='string' && /^\d+$/.test(value))) && Number.isInteger(Number(value)) ? Number(value) : NaN;

async function payload(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()!=='application/json') return null;
  // Bound the input stream, including chunked requests without Content-Length.
  const reader=request.body?.getReader();
  if (!reader) return null;
  const chunks=[]; let length=0;
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    length+=value.byteLength;
    if(length>8192) {await reader.cancel(); return null;}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length); let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset); offset+=chunk.byteLength;}
  try {const body=JSON.parse(new TextDecoder().decode(bytes)); return body && typeof body==='object' && !Array.isArray(body) ? body : null;} catch {return null;}
}

async function eventDate(db,slug,occurrenceId='') {
  return db.prepare(`SELECT e.id AS event_id,e.private_rsvp_enabled,e.publication_state,e.status AS event_status,
      o.id AS occurrence_id,o.status,o.capacity,o.max_seats_per_order,o.starts_at,o.ends_at
    FROM events e JOIN event_occurrences o ON o.event_id=e.id
    WHERE e.slug=? AND (?='' OR o.id=?)
      AND (SELECT COUNT(*) FROM event_occurrences WHERE event_id=e.id)=1
    ORDER BY o.starts_at LIMIT 1`)
    .bind(slug,occurrenceId,occurrenceId).first();
}

export async function privateRsvpContext(db,event) {
  if(!event.privateRsvpEnabled) return null;
  const date=await eventDate(db,event.slug);
  if(!date) return {open:false,reservedHeadcount:0,remaining:0,maxPartySize:1};
  const row=await db.prepare("SELECT COALESCE(SUM(party_size),0) AS total FROM event_rsvps WHERE occurrence_id=? AND status='confirmed'").bind(date.occurrence_id).first();
  const total=Number(row?.total)||0;
  return {
    occurrenceId:date.occurrence_id,
    reservedHeadcount:total,
    remaining:date.capacity>0 ? Math.max(0,date.capacity-total) : null,
    unlimited:date.capacity===0,
    maxPartySize:date.max_seats_per_order,
    open:date.publication_state==='published' && date.event_status==='open' && date.status==='open'
      && (date.capacity===0 || date.capacity>total) && Date.parse(date.ends_at || date.starts_at)>Date.now(),
  };
}

export async function handlePrivateEventRsvp(request,env,slug,ctx) {
  if((await publicPageVisibilityDecision(`/events/${slug}/`,env)).hidden) return fail('Event not found.',404);
  const body=await payload(request);
  if(!body) return fail('Expected a small JSON registration.');
  if(text(body._gotcha)) return json({ok:true,message:RECEIVED});
  const name=text(body.name),email=text(body.email).toLowerCase();
  const seats=integer(body.partySize);
  if(!name || name.length>120) return fail('Enter your name (up to 120 characters).');
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
  if(!Number.isInteger(seats) || seats<1 || seats>99) return fail('Enter a whole party size of at least 1, including you.');
  const db=env.SUBMISSIONS_DB;
  if(!db) return fail('Registration is unavailable.',503);
  try {
    const date=await eventDate(db,slug,text(body.occurrenceId));
    if(!date || !date.private_rsvp_enabled || date.publication_state!=='published') return fail('Event not found.',404);
    if(date.event_status!=='open' || date.status!=='open'
      || Date.parse(date.ends_at || date.starts_at)<=Date.now()) return fail('RSVP is closed.',409);
    if(seats>date.max_seats_per_order) return fail(`Reserve at most ${date.max_seats_per_order} people per RSVP.`);
    const now=new Date().toISOString();
    // One atomic statement checks current capacity and inserts. Unique identity
    // makes retries/racing duplicate requests keep the first private record.
    const registrationId=crypto.randomUUID();
    const result=await db.prepare(`INSERT INTO event_rsvps
      (id,event_id,occurrence_id,contact_name,contact_email,party_size,food_requirements,status,created_at,updated_at)
      SELECT ?,e.id,o.id,?,?,?,?,'confirmed',?,?
      FROM events e JOIN event_occurrences o ON o.event_id=e.id
      WHERE e.id=? AND o.id=? AND e.private_rsvp_enabled=1 AND e.publication_state='published'
        AND e.status='open' AND o.status='open' AND ?<=o.max_seats_per_order
        AND julianday(COALESCE(o.ends_at,o.starts_at))>julianday(?)
        AND (o.capacity=0 OR ?+COALESCE((SELECT SUM(party_size) FROM event_rsvps WHERE occurrence_id=o.id AND status='confirmed'),0)<=o.capacity)
      ON CONFLICT(event_id,occurrence_id,contact_email) DO NOTHING`)
      .bind(registrationId,name,email,seats,'',now,now,date.event_id,date.occurrence_id,seats,now,seats).run();
    if(!result.meta?.changes) {
      const existing=await db.prepare('SELECT id FROM event_rsvps WHERE event_id=? AND occurrence_id=? AND contact_email=?').bind(date.event_id,date.occurrence_id,email).first();
      if(!existing) return fail('There is not enough space for that party. Please contact the organizer.',409);
    } else {
      const confirmation=deliverPrivateEventRsvpConfirmation(env,registrationId)
        .catch(()=>console.warn('RSVP confirmation queued for retry.'));
      if(ctx?.waitUntil) ctx.waitUntil(confirmation);
      else await confirmation;
    }
    // Identical response for new and repeated submissions: no roster, email,
    // food note, registration ID, or bearer receipt is exposed publicly.
    return json({ok:true,message:RECEIVED});
  } catch {return fail('Unable to save your RSVP. Please try again.',500);}
}

// The existing delivery table is the durable queue. An atomic two-minute lease
// prevents concurrent requests/cron runs sending the same confirmation twice.
async function deliverPrivateEventRsvpConfirmation(env,registrationId) {
  const db=env.SUBMISSIONS_DB;
  const registration=await db.prepare(`SELECT r.*,e.title,e.slug,e.description,e.included,e.arrival_notes,e.contact_note,
      COALESCE(o.starts_at,e.starts_at) AS starts_at,COALESCE(o.ends_at,e.ends_at) AS ends_at,
      COALESCE(NULLIF(o.location,''),e.location) AS location
    FROM event_rsvps r JOIN events e ON e.id=r.event_id
    JOIN event_occurrences o ON o.id=r.occurrence_id WHERE r.id=? AND r.status='confirmed'`)
    .bind(registrationId).first();
  if(!registration) return {ok:false,skipped:true};
  const now=new Date().toISOString(),key=`event_rsvp_confirmed:${registration.id}`;
  const claim=await db.prepare(`INSERT INTO notification_deliveries
      (id,channel,template_key,recipient,subject,related_type,related_id,idempotency_key,status,created_at)
    VALUES (?,'email','event_rsvp_confirmed',?,?,'event_rsvp',?,?,'pending',?)
    ON CONFLICT(idempotency_key) DO UPDATE SET status='pending',created_at=excluded.created_at
      WHERE notification_deliveries.status IN ('pending','failed')
        AND julianday(notification_deliveries.created_at)<=julianday(excluded.created_at)-2.0/1440`)
    .bind(crypto.randomUUID(),registration.contact_email,`RSVP confirmed — ${registration.title}`,registration.id,key,now).run();
  if(!claim.meta?.changes) return {ok:true,skipped:true};
  return notifyEventRsvpConfirmed(env,registration);
}

export async function retryPendingPrivateEventRsvpConfirmations(env) {
  const db=env.SUBMISSIONS_DB;
  if(!db) return {sent:0,failed:0};
  const retryBefore=new Date(Date.now()-2*60*1000).toISOString();
  const pending=await db.prepare(`SELECT r.id FROM event_rsvps r
    JOIN events e ON e.id=r.event_id
    LEFT JOIN notification_deliveries n ON n.idempotency_key='event_rsvp_confirmed:'||r.id
    WHERE r.status='confirmed' AND e.private_rsvp_enabled=1
      AND (n.id IS NULL OR (n.status IN ('pending','failed') AND julianday(n.created_at)<=julianday(?)))
    ORDER BY r.created_at LIMIT 25`).bind(retryBefore).all();
  let sent=0,failed=0;
  for(const row of pending.results || []) {
    try {const result=await deliverPrivateEventRsvpConfirmation(env,row.id);if(result.ok&&!result.skipped)sent++;else if(!result.ok)failed++;}
    catch {failed++;}
  }
  return {sent,failed};
}

// Caller enforces the existing Studio admin credential before entering here.
export async function handlePrivateEventAdmin(request,env,slug,action,recordId) {
  const db=env.SUBMISSIONS_DB;
  if(!db) return fail('Event records are unavailable.',503);
  try {
    const date=await eventDate(db,slug);
    if(!date || !date.private_rsvp_enabled) return fail('Event not found.',404);
    if(request.method==='GET' && action==='rsvps' && !recordId) {
      const registrations=(await db.prepare('SELECT * FROM event_rsvps WHERE event_id=? AND occurrence_id=? ORDER BY created_at,id').bind(date.event_id,date.occurrence_id).all()).results || [];
      const attendance=(await db.prepare('SELECT * FROM event_attendance WHERE event_id=? AND occurrence_id=? ORDER BY paper_reference,id').bind(date.event_id,date.occurrence_id).all()).results || [];
      return json({registrations,attendance,summary:{
        rsvpHeadcount:registrations.filter(r=>r.status==='confirmed').reduce((sum,r)=>sum+r.party_size,0),
        attendedHeadcount:attendance.reduce((sum,r)=>sum+r.attended_count,0),
        walkInHeadcount:attendance.filter(r=>!r.rsvp_id).reduce((sum,r)=>sum+r.attended_count,0),
        capacity:date.capacity,
      }});
    }
    if(request.method==='PATCH' && action==='rsvps' && recordId) {
      const body=await payload(request);
      const row=await db.prepare('SELECT * FROM event_rsvps WHERE id=? AND event_id=? AND occurrence_id=?').bind(recordId,date.event_id,date.occurrence_id).first();
      if(!row) return fail('RSVP not found.',404);
      if(!body) return fail('Expected JSON.');
      const status=body.status ?? row.status,seats=body.partySize===undefined ? row.party_size : integer(body.partySize);
      if(!['confirmed','cancelled'].includes(status) || !Number.isInteger(seats) || seats<1 || seats>date.max_seats_per_order) return fail('Check status and party size.');
      const update=await db.prepare(`UPDATE event_rsvps SET status=?,party_size=?,food_requirements=?,updated_at=? WHERE id=?
        AND (?='cancelled' OR ?=0 OR ?+COALESCE((SELECT SUM(party_size) FROM event_rsvps WHERE occurrence_id=? AND status='confirmed' AND id<>?),0)<=?)`)
        .bind(status,seats,'',new Date().toISOString(),row.id,status,date.capacity,seats,date.occurrence_id,row.id,date.capacity).run();
      if(!update.meta?.changes) return fail('That change exceeds capacity.',409);
      return json({ok:true});
    }
    if(request.method==='POST' && action==='attendance' && !recordId) {
      const body=await payload(request);
      if(!body) return fail('Expected JSON.');
      const reference=text(body.paperReference),count=integer(body.attendedCount),rsvpId=text(body.rsvpId);
      if(!reference || reference.length>80 || !Number.isInteger(count) || count<1 || count>99) return fail('Enter a paper row reference and whole attendance count (1–99).');
      let name=text(body.name);
      if(rsvpId) {
        const rsvp=await db.prepare('SELECT * FROM event_rsvps WHERE id=? AND event_id=? AND occurrence_id=?').bind(rsvpId,date.event_id,date.occurrence_id).first();
        if(!rsvp) return fail('Matching RSVP not found.',404);
        if(count>rsvp.party_size) return fail('Record additional guests as a separate walk-in row.');
        name=rsvp.contact_name;
      }
      if(!name || name.length>120) return fail('Enter the walk-in name as recorded on the paper sheet.');
      const prior=await db.prepare('SELECT * FROM event_attendance WHERE event_id=? AND occurrence_id=? AND paper_reference=?').bind(date.event_id,date.occurrence_id,reference).first();
      if(prior && (prior.rsvp_id || '')!==rsvpId) return fail('That paper row is already linked differently. Remove the incorrect record first.',409);
      const linked=rsvpId ? await db.prepare('SELECT id,paper_reference FROM event_attendance WHERE rsvp_id=?').bind(rsvpId).first() : null;
      if(linked && linked.paper_reference!==reference) return fail('That RSVP already has a paper attendance record.',409);
      const now=new Date().toISOString();
      const saved=await db.prepare(`INSERT INTO event_attendance
        (id,event_id,occurrence_id,rsvp_id,paper_reference,attendee_name,attended_count,recorded_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,occurrence_id,paper_reference)
        DO UPDATE SET attendee_name=excluded.attendee_name,attended_count=excluded.attended_count,updated_at=excluded.updated_at
        WHERE event_attendance.rsvp_id IS excluded.rsvp_id`)
        .bind(crypto.randomUUID(),date.event_id,date.occurrence_id,rsvpId || null,reference,name,count,now,now).run();
      if(!saved.meta?.changes) return fail('That paper row is already linked differently.',409);
      return json({ok:true});
    }
    if(request.method==='DELETE' && action==='attendance' && recordId) {
      const result=await db.prepare('DELETE FROM event_attendance WHERE id=? AND event_id=? AND occurrence_id=?').bind(recordId,date.event_id,date.occurrence_id).run();
      return result.meta?.changes ? json({ok:true}) : fail('Attendance row not found.',404);
    }
    return fail('Method not allowed.',405);
  } catch {return fail('Unable to update private event records. Check for a duplicate paper row or RSVP link.',409);}
}
