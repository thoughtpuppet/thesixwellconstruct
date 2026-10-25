import test, { after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ENGAGEMENT_CATEGORIES, normalizeEngagementRequest } from "../shared/engagement-requests.js";
import { handleCreateSubmission, handleGetSubmission } from "../functions/api/submissions/_lib.js";
import { handleBookingInbox } from "../functions/api/booking-inbox/_lib.js";
import { notifySubmissionReceived, notifyAdminSubmissionReceived } from "../functions/api/notifications/_lib.js";
import { handlePublicStudioContext, handlePublicStudioCheckout, handlePublicSessionCheckout, handleAdminCreateBookingToken } from "../functions/api/booking/_lib.js";
import { checkIcloudCalendarConflict } from "../functions/api/booking/_calendar-sync.js";
import { fixture, windowFixture, appointmentFixture, request, studioBody, cleanupFixtures, clearCalendarResponse } from "./helpers/booking-hub-fixture.mjs";

after(cleanupFixtures);
let originalNetwork;
beforeEach(() => {
  originalNetwork=globalThis.fetch;
  globalThis.fetch=async (url) => {
    if(String(url).startsWith('https://p123-caldav.icloud.com/fixture/')) return clearCalendarResponse();
    throw new Error('Unexpected external request in local fixture');
  };
});
afterEach(() => {globalThis.fetch=originalNetwork;});
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const inquiry = (changes={}) => ({ type:"engagement_request", category:"general_consultation", name:"Fixture Person", email:"fixture@example.test", phone:"555-0100", project_title:"Research conversation", message:"Discuss an artistic research project.", request_consent:"yes", ...changes });

test("no-token visitors enter the hub; private, legacy, error and preview entries retain the original flow", () => {
  const html = source("booking/index.html");
  const script = html.match(/<script>([\s\S]*?data\.bookingView[\s\S]*?)<\/script>/)?.[1]
    || [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((script) => script.includes("dataset.bookingView = privateEntry"));
  assert.ok(script);
  for (const [url, expected] of [
    ["/booking/","public"], ["/booking/?category=interview","public"],
    ["/booking/?token=","private"], ["/booking/?token=invalid","private"],
    ["/booking/?token=" + "a".repeat(64),"private"], ["/b/AbCdEfGhI_12","private"],
    ["/booking/?preview=1","private"], ["/booking/?preview=1&hub=1","public"],
    ["/booking/?entry=tattoo-special-request","private"], ["/booking/?checkout=unavailable","private"],
  ]) {
    const document = { documentElement:{ dataset:{} } };
    runInNewContext(script, { document, location:new URL(url,"https://example.test"), URLSearchParams });
    assert.equal(document.documentElement.dataset.bookingView, expected, url);
  }
  const privateScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("async function loadContext()"));
  runInNewContext(privateScript, { document:{documentElement:{dataset:{bookingView:"public"}}} });
  for (const route of ["/booking/studio-visit/","/booking/studio/","/tattoos/inquire/","/tattoos/inquire/consultation/"]) assert.ok(html.includes(`href="${route}"`));
});

test("engagement payloads allow only supported categories and bounded inquiry fields", () => {
  for (const category of Object.keys(ENGAGEMENT_CATEGORIES)) assert.ok(normalizeEngagementRequest(inquiry({category})).payload);
  for (const changes of [{category:"consultation"},{category:"tattoo"},{category:"__proto__"},{message:""},{name:"x".repeat(161)},{request_consent:"no"},{website:"javascript:alert(1)"},{website:"https://user:secret@example.test"},{message:{text:"bad"}}]) {
    assert.ok(normalizeEngagementRequest(inquiry(changes)).error, JSON.stringify(changes));
  }
  const normalized = normalizeEngagementRequest(inquiry({ status:"booked", booking_url:"/b/private", source_path:"/tattoos/", dob:"2000-01-01" })).payload;
  assert.equal(normalized.source_path,"/booking/");
  for (const name of ["booking_url","status","dob"]) assert.equal(normalized[name],undefined);
});

test("API stores a private Construct inquiry, protects duplicates and never creates an appointment or booking token", async () => {
  const {sqlite,env} = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected network request in local fixture"); };
  try {
    const responses = await Promise.all([1,2].map(() => handleCreateSubmission(request("/api/submissions",inquiry()),env)));
    const payloads = await Promise.all(responses.map((response) => response.json()));
    assert.ok(payloads.every((payload) => payload.ok),JSON.stringify(payloads));
    assert.equal(new Set(payloads.map((payload) => payload.submissionId)).size,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM submissions WHERE type='engagement_request'").get().n,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM appointments").get().n,0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM booking_tokens").get().n,0);
    const id = payloads[0].submissionId;
    const row = sqlite.prepare("SELECT * FROM submissions WHERE id=?").get(id);
    assert.equal(row.status,"new"); assert.equal(row.tattoo_stage,null);
    assert.equal(JSON.parse(row.payload_json).category,"general_consultation");
    assert.equal((await handleGetSubmission(request(`/api/admin/submissions/${id}`),env,id)).status,401);
    const inbox = await (await handleBookingInbox(request("/api/admin/booking-inbox",undefined,{admin:true}),env)).json();
    assert.equal(inbox.submissions.find((item) => item.id === id)?.type,"engagement_request");
    assert.equal((await handleBookingInbox(request("/api/admin/booking-inbox"),env)).status,401);
    const mismatch = await handleCreateSubmission(request("/api/submissions",inquiry({category:"interview"})),env);
    assert.equal(mismatch.status,409);
    const tokenResponse = await handleAdminCreateBookingToken(request("/api/admin/booking/tokens",{submissionId:id,allowedBookingTypes:["tattoo_quarter"]},{admin:true}),env);
    assert.notEqual(tokenResponse.status,200);
  } finally { globalThis.fetch = originalFetch; }
});

test("API rejects missing idempotency, invalid aliases and malformed contact data before saving", async () => {
  const {sqlite,env} = fixture();
  for (const [body,key] of [[inquiry(),""],[inquiry({category:"tattoo"}),"bad-category"],[inquiry({type:"new_engagement_request",category:"tattoo"}),"bad-alias"],[inquiry({email:"invalid"}),"bad-email"],[inquiry({phone:""}),"bad-phone"]]) {
    const response = await handleCreateSubmission(request("/api/submissions",body,{key}),env);
    assert.equal(response.status,400,await response.text());
  }
  assert.equal(sqlite.prepare("SELECT count(*) n FROM submissions").get().n,0);
});

test("existing authorized notification functions render a Construct inquiry receipt and admin alert with mocked delivery", async () => {
  const {env} = fixture();
  const sent = [];
  const notifyEnv = {...env,ADMIN_NOTIFICATION_EMAIL:"admin@example.test",NOTIFICATION_FROM_EMAIL:"sender@example.test",NOTIFICATION_REPLY_TO:"reply@example.test",ADMIN_NOTIFICATION_FROM_EMAIL:"sender@example.test",EMAIL:{send:async (message) => sent.push(message)}};
  const submission = {id:"notification-fixture",type:"engagement_request",contact:{name:"Fixture",email:"fixture@example.test",phone:"555-0100"},payload:inquiry()};
  const client = await notifySubmissionReceived(notifyEnv,submission);
  const admin = await notifyAdminSubmissionReceived(notifyEnv,submission);
  assert.ok(client.ok,JSON.stringify(client)); assert.ok(admin.ok,JSON.stringify(admin));
  assert.equal(sent.length,2);
  const rendered = JSON.stringify(sent);
  assert.match(rendered,/six.well construct/i);
  assert.match(rendered,/No appointment/);
  assert.doesNotMatch(rendered,/art\.pill TATTOO HOUSE|Custom tattoo project|private tattoo-booking link/);
});

for (const [type,purpose] of [["tattoo_quarter","tattoo"],["tattoo_half","tattoo"],["tattoo_three_quarter","tattoo"],["tattoo_full","tattoo"],["tattoo_extended","tattoo"],["consult_in_person","prerequisite_consultation"],["consult_virtual","standalone_consultation"],["build_in_person","build_session"],["studio_visit","studio"],["studio_gathering","studio"],["studio_rental","studio"]]) {
  test(`studio events reject overlap with ${type}, regardless of room capacity`,async () => {
    const {sqlite,env} = fixture(); windowFixture(sqlite); appointmentFixture(sqlite,{type,purpose});
    const context = await (await handlePublicStudioContext(request("/api/booking/public-studio/context?type=studio_gathering&type=studio_rental"),env)).json();
    assert.ok(!context.availabilityWindows.some((window) => window.id === "room"));
    const response = await handlePublicStudioCheckout(request("/api/booking/public-studio/checkout",studioBody()),env);
    assert.equal(response.status,400,await response.text());
    assert.equal(sqlite.prepare("SELECT count(*) n FROM appointments").get().n,1);
  });
}

test("simultaneous studio attempts atomically create one unpaid hold, with no review gate",async () => {
  const {sqlite,env} = fixture(); windowFixture(sqlite);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if(String(url).startsWith('https://p123-caldav.icloud.com/fixture/')) return clearCalendarResponse();
    throw new Error("Unexpected network request");
  };
  try {
    const responses = await Promise.all(["one","two"].map((key) => handlePublicStudioCheckout(request("/api/booking/public-studio/checkout",studioBody({email:`${key}@example.test`}),{key}),env)));
    assert.deepEqual(responses.map((r) => r.status).sort(),[400,503]);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM appointments").get().n,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM submissions").get().n,1);
    const appointment = sqlite.prepare("SELECT * FROM appointments").get();
    assert.equal(appointment.status,"deposit_pending");
    assert.equal(appointment.hold_state,"active");
    assert.equal(appointment.approval_state,"not_required");
    const expiryMinutes = (new Date(appointment.hold_expires_at)-Date.now())/60000;
    assert.ok(expiryMinutes > 29 && expiryMinutes <=30);
  } finally { globalThis.fetch = originalFetch; }
});

test("a conflict-free studio event goes straight to mocked Square checkout and retries resume that hold",async () => {
  const {sqlite,env} = fixture(); windowFixture(sqlite);
  const originalFetch = globalThis.fetch;
  let calls=0;
  globalThis.fetch = async (url,init) => {
    if(String(url).startsWith('https://p123-caldav.icloud.com/fixture/')) return clearCalendarResponse();
    assert.ok(String(url).endsWith('/v2/online-checkout/payment-links'));
    assert.equal(init.method,'POST'); calls++;
    return Response.json({payment_link:{id:'fixture-link',order_id:'fixture-order',url:'https://square.example.test/fixture'}});
  };
  const squareEnv={...env,SQUARE_ACCESS_TOKEN:'fixture-only',SQUARE_STUDIO_LOCATION_ID:'fixture-studio'};
  try {
    const first = await handlePublicStudioCheckout(request('/api/booking/public-studio/checkout',studioBody()),squareEnv);
    assert.equal(first.status,200);
    const booked = await first.json();
    assert.equal(booked.checkoutUrl,'https://square.example.test/fixture');
    const retry = await (await handlePublicStudioCheckout(request('/api/booking/public-studio/checkout',studioBody()),squareEnv)).json();
    assert.equal(retry.resumed,true); assert.equal(retry.appointmentId,booked.appointmentId);
    assert.equal(calls,1);
    const row=sqlite.prepare('SELECT * FROM appointments').get();
    assert.equal(row.approval_state,'not_required'); assert.equal(row.status,'deposit_pending');
    assert.equal(sqlite.prepare('SELECT count(*) n FROM deposit_payments').get().n,1);
  } finally {globalThis.fetch=originalFetch;}
});

test("simultaneous consultation and room requests cannot claim overlapping shared time",async () => {
  const {sqlite,env}=fixture();
  windowFixture(sqlite);
  windowFixture(sqlite,{id:'consult',type:'consult_in_person',scope:'tattoo'});
  const results=await Promise.all([
    handlePublicStudioCheckout(request('/api/booking/public-studio/checkout',studioBody(),{key:'room-race'}),env),
    handlePublicSessionCheckout(request('/api/booking/public-session/checkout',studioBody({bookingTypeId:'consult_in_person',availabilityWindowId:'consult',age_confirmed:'yes',dob:'1990-01-01'}),{key:'consult-race'}),env),
  ]);
  assert.deepEqual(results.map((r)=>r.status).sort(),[400,503]);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM appointments').get().n,1);
});

test("a room event also blocks a later high-capacity consultation claim",async () => {
  const {sqlite,env} = fixture();
  windowFixture(sqlite,{id:"consult",type:"consult_in_person",scope:"tattoo"});
  appointmentFixture(sqlite,{type:"studio_rental",purpose:"studio"});
  const response = await handlePublicSessionCheckout(request("/api/booking/public-session/checkout",studioBody({bookingTypeId:"consult_in_person",availabilityWindowId:"consult",age_confirmed:"yes",dob:"1990-01-01"})),env);
  assert.equal(response.status,400,await response.text());
  assert.equal(sqlite.prepare("SELECT count(*) n FROM appointments").get().n,1);
});

for (const [status,hold,expiry,blocks] of [
  ["pending_deposit","active","2030-11-03T20:00:00.000Z",true],
  ["deposit_pending","active","2000-01-01T00:00:00.000Z",true],
  ["deposit_pending","expiry_attention","2000-01-01T00:00:00.000Z",true],
  ["cancelled","released","2000-01-01T00:00:00.000Z",false],
  ["archived","released","2000-01-01T00:00:00.000Z",false],
]) test(`hold behavior retains ${status}/${hold} blocking=${blocks}`,async () => {
  const {sqlite,env} = fixture(); windowFixture(sqlite); appointmentFixture(sqlite,{status,hold,expiry});
  const context = await (await handlePublicStudioContext(request("/api/booking/public-studio/context?type=studio_gathering"),env)).json();
  assert.equal(!context.availabilityWindows.some((window) => window.id === "room"),blocks);
});

test("buffers block overlaps; adjacent absolute instants remain available across the DST fall-back",async () => {
  for (const [after,blocks] of [[0,false],[1,true]]) {
    const {sqlite,env} = fixture();
    windowFixture(sqlite,{start:"2030-11-03T07:00:00.000Z",end:"2030-11-03T09:00:00.000Z"});
    windowFixture(sqlite,{id:"tattoo",type:"tattoo_quarter",scope:"tattoo",start:"2030-11-03T05:00:00.000Z",end:"2030-11-03T07:00:00.000Z",after});
    appointmentFixture(sqlite,{windowId:"tattoo",start:"2030-11-03T05:00:00.000Z",end:"2030-11-03T07:00:00.000Z"});
    const context = await (await handlePublicStudioContext(request("/api/booking/public-studio/context?type=studio_gathering"),env)).json();
    assert.equal(!context.availabilityWindows.some((window) => window.id === "room"),blocks);
  }
});

test("the two 01:30 instants on the New York DST fall-back day are distinct absolute appointment times",async () => {
  const {sqlite,env}=fixture();
  windowFixture(sqlite,{start:'2030-11-03T06:30:00.000Z',end:'2030-11-03T07:00:00.000Z'});
  appointmentFixture(sqlite,{start:'2030-11-03T05:30:00.000Z',end:'2030-11-03T06:00:00.000Z'});
  const context=await (await handlePublicStudioContext(request('/api/booking/public-studio/context?type=studio_gathering'),env)).json();
  assert.ok(context.availabilityWindows.some((window)=>window.id==='room'));
});

test("calendar audit fixture shows that a ticketed studio event is not automatically a room reservation",async () => {
  const {sqlite,env}=fixture(); windowFixture(sqlite);
  sqlite.prepare(`INSERT INTO events(id,slug,title,starts_at,ends_at,location,status,publication_state,created_at,updated_at)
    VALUES ('fixture-event','fixture-event','Local fixture event','2030-11-03T18:00:00.000Z','2030-11-03T20:00:00.000Z','Studio','open','published',?,?)`).run(new Date().toISOString(),new Date().toISOString());
  const context=await (await handlePublicStudioContext(request('/api/booking/public-studio/context?type=studio_gathering'),env)).json();
  assert.ok(context.availabilityWindows.some((window)=>window.id==='room'));
  // This test records a deployment blocker, not a guarantee of full resource coverage.
});

test("required studio calendar reads do not accept the old tattoo-scope cache shortcut",async () => {
  const {db,env,sqlite} = fixture();
  sqlite.prepare("UPDATE booking_calendar_sync_settings SET last_inbound_succeeded_at=? WHERE id='icloud'").run(new Date().toISOString());
  const originalFetch = globalThis.fetch;
  let calls=0; globalThis.fetch=async () => { calls++; return clearCalendarResponse(); };
  try {
    const result = await checkIcloudCalendarConflict(env,db,{availability_scope:"studio",start_at:"2030-11-03T18:00:00.000Z",end_at:"2030-11-03T20:00:00.000Z"},{required:true});
    assert.deepEqual(result,{conflict:false,checked:true,unknown:false});
    assert.equal(calls,1);
  } finally { globalThis.fetch=originalFetch; }
});

function busyCalendarResponse({start='20301103T183000Z',end='20301103T193000Z',extra=''}={}) {
  const ics=`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fixture-busy\r\nDTSTART:${start}\r\n${end ? `DTEND:${end}\r\n` : ''}${extra}END:VEVENT\r\nEND:VCALENDAR`;
  const escaped=ics.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/fixture.ics</d:href><d:propstat><d:prop><c:calendar-data>${escaped}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207});
}

test('configured external calendar busy time removes studio windows and rejects direct checkout without a hold',async () => {
  const {sqlite,env}=fixture(); windowFixture(sqlite);
  globalThis.fetch=async()=>busyCalendarResponse();
  const context=await (await handlePublicStudioContext(request('/api/booking/public-studio/context?type=studio_gathering'),env)).json();
  assert.equal(context.availabilityWindows.length,0);
  const response=await handlePublicStudioCheckout(request('/api/booking/public-studio/checkout',studioBody()),env);
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'EXTERNAL_CALENDAR_CONFLICT');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM appointments').get().n,0);
});

for (const failure of ['missing-credentials','disabled','no-selection','denied','transport','timeout','malformed','truncated-root','truncated-resource','partial-resource','unexpanded-recurrence','unresolved-end']) {
  test(`required calendar ${failure} means unknown studio availability and creates no hold`,async () => {
    const {sqlite,env}=fixture(); windowFixture(sqlite);
    if(failure==='missing-credentials') delete env.ICLOUD_CALDAV_APP_PASSWORD;
    if(failure==='disabled') sqlite.exec("UPDATE booking_calendar_sync_settings SET inbound_enabled=0");
    if(failure==='no-selection') sqlite.exec("UPDATE booking_calendar_sync_settings SET blocking_calendars_json='[]'");
    if(failure==='denied') globalThis.fetch=async()=>new Response('',{status:403});
    if(failure==='transport') globalThis.fetch=async()=>{throw new Error('Fixture transport failed');};
    if(failure==='timeout') globalThis.fetch=async()=>{throw new DOMException('Fixture timeout','AbortError');};
    if(failure==='malformed') globalThis.fetch=async()=>new Response('<html>Login required</html>');
    if(failure==='truncated-root') globalThis.fetch=async()=>new Response('<d:multistatus xmlns:d="DAV:">',{status:207});
    if(failure==='truncated-resource') globalThis.fetch=async()=>new Response('<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus>',{status:207});
    if(failure==='partial-resource') globalThis.fetch=async()=>new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:status>HTTP/1.1 403 Forbidden</d:status></d:response></d:multistatus>',{status:207});
    if(failure==='unexpanded-recurrence') globalThis.fetch=async()=>busyCalendarResponse({extra:'RRULE:FREQ=DAILY\r\n'});
    if(failure==='unresolved-end') globalThis.fetch=async()=>busyCalendarResponse({end:''});
    const context=await handlePublicStudioContext(request('/api/booking/public-studio/context?type=studio_gathering'),env);
    assert.equal(context.status,503);
    assert.equal((await context.json()).code,'EXTERNAL_CALENDAR_UNAVAILABLE');
    const response=await handlePublicStudioCheckout(request('/api/booking/public-studio/checkout',studioBody()),env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).code,'EXTERNAL_CALENDAR_UNAVAILABLE');
    assert.equal(sqlite.prepare('SELECT count(*) n FROM appointments').get().n,0);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM submissions').get().n,0);
  });
}

test('one inaccessible calendar makes the combined studio result unknown even when another calendar is clear',async () => {
  const {sqlite,env}=fixture(); windowFixture(sqlite);
  sqlite.prepare("UPDATE booking_calendar_sync_settings SET blocking_calendars_json=? WHERE id='icloud'").run(JSON.stringify([
    {href:'https://p123-caldav.icloud.com/fixture/one/',name:'One'},
    {href:'https://p123-caldav.icloud.com/fixture/two/',name:'Two'},
  ]));
  globalThis.fetch=async(url)=>String(url).includes('/one/') ? clearCalendarResponse() : new Response('',{status:401});
  assert.equal((await handlePublicStudioContext(request('/api/booking/public-studio/context?type=studio_gathering'),env)).status,503);
});
