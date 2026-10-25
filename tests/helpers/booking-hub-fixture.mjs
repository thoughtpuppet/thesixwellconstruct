import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "swc-booking-fixtures-"));
const template = join(directory, "template.sqlite");
const database = new DatabaseSync(template);
database.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync(new URL("../../migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
  database.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
}
database.close();
let index = 0;
const openDatabases = [];

class Statement {
  constructor(database, sql, values = []) { Object.assign(this, { database, sql, values }); }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results:this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results:statement.all(...this.values) };
    const result = statement.run(...this.values);
    return { success:true, meta:{ changes:Number(result.changes || 0) } };
  }
}

export function fixture() {
  const filename = join(directory, `${index++}.sqlite`);
  copyFileSync(template, filename);
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys=ON");
  // Independent D1 atomic batches serialize; preflight reads may interleave.
  let tail = Promise.resolve();
  const db = { prepare:(sql) => new Statement(sqlite, sql), batch(statements) {
    const work = tail.then(async () => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    });
    tail = work.catch(() => {});
    return work;
  } };
  sqlite.exec("UPDATE booking_settings SET max_bookings_per_day=99");
  sqlite.prepare("UPDATE booking_calendar_sync_settings SET inbound_enabled=1,blocking_calendars_json=? WHERE id='icloud'")
    .run(JSON.stringify([{href:'https://p123-caldav.icloud.com/fixture/calendar/',name:'Fixture busy calendar'}]));
  openDatabases.push(sqlite);
  return { sqlite, db, env:{ SUBMISSIONS_DB:db, SUBMISSIONS_ADMIN_TOKEN:"fixture-admin", PUBLIC_SITE_URL:"http://localhost:4186", ICLOUD_CALDAV_USERNAME:'fixture@example.test', ICLOUD_CALDAV_APP_PASSWORD:'fixture-only' } };
}

export function clearCalendarResponse() {
  return new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"></d:multistatus>',{status:207});
}

export function windowFixture(sqlite, { id="room", type="studio_gathering", start="2030-11-03T18:00:00.000Z", end="2030-11-03T20:00:00.000Z", before=0, after=0, capacity=5, scope="studio", blackout=0 } = {}) {
  sqlite.prepare(`INSERT INTO availability_windows
    (id,venture,booking_type_id,start_at,end_at,capacity,buffer_before_minutes,buffer_after_minutes,availability_scope,is_blackout,active,created_at,updated_at)
    VALUES (?,'tattooing',?,?,?,?,?,?,?,?,1,?,?)`).run(id,type,start,end,capacity,before,after,scope,blackout,new Date().toISOString(),new Date().toISOString());
  return id;
}

export function appointmentFixture(sqlite, { id="busy", type="tattoo_quarter", purpose="tattoo", start="2030-11-03T18:30:00.000Z", end="2030-11-03T19:30:00.000Z", status="confirmed", hold="active", expiry="2030-11-03T20:00:00.000Z", windowId=null } = {}) {
  sqlite.prepare(`INSERT INTO appointments
    (id,booking_type_id,availability_window_id,purpose,status,client_name,client_email,start_at,end_at,deposit_cents,hold_state,hold_expires_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'Fixture Person','fixture@example.test',?,?,0,?,?,?,?)`).run(id,type,windowId,purpose,status,start,end,hold,expiry,new Date().toISOString(),new Date().toISOString());
}

export function request(path, body, { admin=false, key="fixture-request", method=body ? "POST" : "GET" } = {}) {
  return new Request(`http://localhost:4186${path}`, { method, headers:{
    ...(body ? { "content-type":"application/json" } : {}),
    ...(key ? { "idempotency-key":key } : {}),
    ...(admin ? { authorization:"Bearer fixture-admin" } : {}),
  }, ...(body ? { body:JSON.stringify(body) } : {}) });
}

export const studioBody = (changes={}) => ({ firstName:"Fixture", lastName:"Visitor", email:"fixture@example.test", phone:"555-0100", understand:"yes", bookingTypeId:"studio_gathering", availabilityWindowId:"room", ...changes });

export function cleanupFixtures() {
  for (const sqlite of openDatabases) sqlite.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + "\\") && !resolve(directory).startsWith(resolve(tmpdir()) + "/")) throw new Error("Unexpected fixture path");
  rmSync(directory, { recursive:true, force:true });
}
