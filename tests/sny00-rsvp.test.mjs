import test, {before,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,request,ROOT} from './helpers/sny00-fixture.mjs';
import {handleEventsApi,handleAdminEventsApi} from '../functions/api/events/_lib.js';
import worker from '../_worker.js';
import {handleAdminSiteVisibility} from '../functions/api/site-visibility/_lib.js';
const signup={name:'Test Guest',email:'guest@example.test',partySize:2,foodRequirements:'No peanuts, please.'};
before(()=>mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-21T12:00:00Z')}));
after(()=>mock.timers.reset());
const send=(env,body=signup)=>handleEventsApi(request('/api/events/sny-00/rsvp',{method:'POST',body}),env);
const admin=(env,path='',method='GET',body)=>handleAdminEventsApi(request('/api/admin/events/sny-00'+path,{method,body,admin:true}),env);

test('draft seed preserves other events, exact EST times, empty location and closed publication; seed is idempotent',()=>{
  const {db}=fixture();
  const event=db.prepare("SELECT * FROM events WHERE slug='sny-00'").get();
  assert.equal(event.title,'SNY 00');assert.equal(event.publication_state,'draft');assert.equal(event.status,'closed');assert.equal(event.location,'');
  assert.equal(event.starts_at,'2026-11-06T18:30:00-05:00');assert.equal(event.ends_at,'2026-11-06T21:30:00-05:00');assert.equal(event.capacity,0);
  assert.equal(new Date(event.starts_at).toISOString(),'2026-11-06T23:30:00.000Z');
  const identity=db.prepare("SELECT visibility,search_visibility FROM content_entities WHERE id='evt_sny_00'").get();
  assert.equal(identity.visibility,'internal');assert.equal(identity.search_visibility,0);
  assert.ok(db.prepare("SELECT id FROM events WHERE slug='solehmans-new-year'").get());
  assert.ok(db.prepare("SELECT id FROM events WHERE slug='signal-symbol'").get());
  db.exec(readFileSync(join(ROOT,'migrations/0245_sny00_draft.sql'),'utf8'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE slug='sny-00'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM event_occurrences WHERE event_id='evt_sny_00'").get().n,1);
});

test('draft seed stops for an existing matching title or instant under another slug',()=>{
  for(const [title,date] of [['SNY 00',null],['A differently named gathering','2026-11-06T23:30:00Z']]){
    const {db}=fixture({beforeDraft:true});
    db.prepare("INSERT INTO events(id,slug,title,starts_at,created_at,updated_at) VALUES('existing-qa','already-here',?,?,datetime('now'),datetime('now'))").run(title,date);
    db.exec(readFileSync(join(ROOT,'migrations/0245_sny00_draft.sql'),'utf8'));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE slug='sny-00'").get().n,0);
  }
});

test('draft/announced/closed/ended/unknown capacity stay nontransactional; private admin auth is required',async()=>{
  const {db,env}=fixture();
  assert.equal((await handleEventsApi(request('/api/events/sny-00/context'),env)).status,404);
  assert.equal((await send(env)).status,404);
  assert.equal((await handleAdminEventsApi(request('/api/admin/events/sny-00/rsvps'),env)).status,401);
  assert.equal((await handleAdminEventsApi(request('/api/admin/events/sny-00/attendance',{method:'POST',body:{}}),env)).status,401);
  db.prepare("UPDATE site_visibility_rules SET visibility='public' WHERE path='/events/sny-00'").run();
  for(const state of ['announced','published']){
    db.prepare('UPDATE events SET publication_state=? WHERE id=?').run(state,'evt_sny_00');
    assert.equal((await send(env)).status,state==='announced'?404:409);
  }
  db.exec("UPDATE events SET status='open' WHERE id='evt_sny_00'; UPDATE event_occurrences SET status='open' WHERE event_id='evt_sny_00'");
  assert.equal((await send(env)).status,409);
  db.exec("UPDATE event_occurrences SET capacity=6,ends_at='2020-01-01T00:00:00Z' WHERE event_id='evt_sny_00'");
  assert.equal((await send(env)).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_rsvps').get().n,0);
});

test('RSVP uses minimal fields, keeps food private, confirms on page, and retries never change the original',async()=>{
  const {db,env}=fixture({open:true});
  const first=await send(env);assert.equal(first.status,200);
  const result=await first.json();assert.deepEqual(Object.keys(result).sort(),['message','ok']);assert.equal(result.ok,true);
  const retry=await send(env,{...signup,email:' GUEST@EXAMPLE.TEST ',name:'Other name',partySize:3,foodRequirements:'changed'});
  assert.deepEqual(await retry.json(),result);
  const row=db.prepare('SELECT * FROM event_rsvps').get();assert.equal(row.contact_name,'Test Guest');assert.equal(row.party_size,2);assert.equal(row.food_requirements,signup.foodRequirements);
  const context=await handleEventsApi(request('/api/events/sny-00/context'),env);const publicText=await context.text();
  assert.ok(!publicText.includes(signup.email));assert.ok(!publicText.includes(signup.name));assert.ok(!publicText.includes(signup.foodRequirements));
  assert.equal(JSON.parse(publicText).event.rsvp.reservedHeadcount,2);
  for(const path of ['/api/events/sny-00/rsvps','/api/events/sny-00/attendance','/api/events/tickets/'+row.id]) assert.equal((await handleEventsApi(request(path),env)).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_attendance').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_tickets').get().n,0);
  for(const [action,body] of [['checkout',{name:signup.name,email:signup.email,phone:'000-000-0000',seats:1}],['waitlist',{name:signup.name,email:signup.email,phone:'000-000-0000'}],['open-mic',{performerName:signup.name,performerEmail:signup.email,performerPhone:'000-000-0000',actType:'Other',pieceTitle:'Test'}]]) assert.equal((await handleEventsApi(request('/api/events/sny-00/'+action,{method:'POST',body}),env)).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notification_deliveries').get().n,0);
  const privateData=await (await admin(env,'/rsvps')).json();assert.equal(privateData.registrations[0].food_requirements,signup.foodRequirements);
});

test('validation rejects malformed, fractional, zero, overlarge and cross-event submissions',async()=>{
  const {env,db}=fixture({open:true});
  for(const body of [{...signup,name:''},{...signup,email:'invalid'},{...signup,partySize:0},{...signup,partySize:-1},{...signup,partySize:1.2},{...signup,partySize:'2people'},{...signup,partySize:5},{...signup,foodRequirements:'x'.repeat(501)},{...signup,foodRequirements:{}},{...signup,name:'x'.repeat(121)}]) assert.equal((await send(env,body)).status,400,JSON.stringify(body));
  assert.equal((await send(env,{...signup,occurrenceId:'occ_evt_signal_symbol'})).status,404);
  assert.equal((await send(env,{...signup,_gotcha:'bot'})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_rsvps').get().n,0);
});

test('atomic capacity and duplicate guards hold under concurrent requests; cancellations release planned space',async()=>{
  const {env,db}=fixture({open:true,capacity:3,maxParty:3});
  const results=await Promise.all([send(env,{...signup,email:'a@example.test'}),send(env,{...signup,email:'b@example.test'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(db.prepare("SELECT SUM(party_size) n FROM event_rsvps WHERE status='confirmed'").get().n,2);
  const duplicates=await Promise.all(Array.from({length:5},()=>send(env,{...signup,email:'last@example.test',partySize:1})));
  assert.ok(duplicates.every(r=>r.status===200));assert.equal(db.prepare('SELECT COUNT(*) n FROM event_rsvps').get().n,2);
  assert.equal((await send(env,{...signup,email:'extra@example.test',partySize:1})).status,409);
  const row=db.prepare('SELECT id FROM event_rsvps WHERE contact_email=?').get('a@example.test') || db.prepare('SELECT id FROM event_rsvps WHERE contact_email=?').get('b@example.test');
  assert.equal((await admin(env,'/rsvps/'+row.id,'PATCH',{status:'cancelled'})).status,200);
  assert.equal((await send(env,{...signup,email:'extra@example.test',partySize:2})).status,200);
  assert.equal((await admin(env,'/rsvps/'+row.id,'PATCH',{status:'confirmed'})).status,409);
});

test('paper reconciliation records actual guests and walk-ins separately; paper/RSVP repeats cannot double count',async()=>{
  const {env,db}=fixture({open:true});await send(env);
  const row=db.prepare('SELECT * FROM event_rsvps').get();
  const body={paperReference:'sheet 1 / row 1',rsvpId:row.id,attendedCount:1};
  assert.equal((await admin(env,'/attendance','POST',body)).status,200);
  assert.equal((await admin(env,'/attendance','POST',body)).status,200);
  assert.equal((await admin(env,'/attendance','POST',{...body,paperReference:'sheet 1 / row 2'})).status,409);
  assert.equal((await admin(env,'/attendance','POST',{...body,attendedCount:3})).status,400);
  assert.equal((await admin(env,'/attendance','POST',{paperReference:'sheet 1 / row 2',name:'Test Walk-in',attendedCount:1})).status,200);
  const data=await (await admin(env,'/rsvps')).json();
  assert.equal(data.summary.rsvpHeadcount,2);assert.equal(data.summary.attendedHeadcount,2);assert.equal(data.summary.walkInHeadcount,1);
  assert.equal(data.attendance[0].source,'paper_sign_in');
  assert.equal((await admin(env,'/attendance/'+data.attendance[1].id,'DELETE')).status,200);
  const final=await (await admin(env,'/rsvps')).json();assert.equal(final.summary.attendedHeadcount,1);assert.equal(final.summary.rsvpHeadcount,2);
  await send(env,{...signup,email:'second@example.test',partySize:1});
  const second=db.prepare('SELECT id FROM event_rsvps WHERE contact_email=?').get('second@example.test');
  const race=await Promise.all([
    admin(env,'/attendance','POST',{paperReference:'sheet 2 / row 1',name:'TEST walk-in',attendedCount:1}),
    admin(env,'/attendance','POST',{paperReference:'sheet 2 / row 1',rsvpId:second.id,attendedCount:1}),
  ]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
});

test('real Worker keeps draft page and sitemap private, regardless of preview query',async()=>{
  const {env}=fixture();
  env.ASSETS={fetch:async req=>new Response(readFileSync(join(ROOT,new URL(req.url).pathname==='/404.html'?'404.html':'events/sny-00/index.html'),'utf8'),{headers:{'content-type':'text/html'}})};
  for(const path of ['/events/sny-00/','/events/sny-00/?preview=1']){
    const response=await worker.fetch(request(path),env,{});assert.equal(response.status,404);assert.ok(!(await response.text()).includes('id="rsvpForm"'));
  }
  const sitemap=await worker.fetch(request('/sitemap.xml'),env,{});assert.ok(!(await sitemap.text()).includes('/events/sny-00/'));
  const alias=await worker.fetch(request('/events/sny-00/index.html'),env,{});assert.equal(alias.status,404);assert.ok(!(await alias.text()).includes('id="rsvpForm"'));
  await env.SUBMISSIONS_DB.prepare("UPDATE events SET publication_state='published' WHERE slug='sny-00'").run();
  await env.SUBMISSIONS_DB.prepare("UPDATE site_visibility_rules SET visibility='public' WHERE path='/events/sny-00'").run();
  const published=await worker.fetch(request('/events/sny-00/'),env,{});assert.equal(published.status,200);
  const html=await published.text();assert.match(html,/6:30–9:30 PM/);
  assert.equal(html.match(/<p id="recordingNotice">([^<]*)<\/p>/)[1],'Promo and archive footage capture is planned. If you do not wish to be recorded, do not attend. RSVPing is also an acknowledgement and consent to being recorded.');
  assert.ok(html.indexOf('id="recordingNotice"')<html.indexOf('id="rsvpForm"'));
});

test('existing Studio visibility controls hide SNY 00 and its RSVP lane even if event operations are open',async()=>{
  const {db,env}=fixture({open:true});
  env.ASSETS={fetch:async()=>new Response('<html><title>404 test</title><body>Existing 404 page</body></html>',{headers:{'content-type':'text/html'}})};
  const change=visibility=>handleAdminSiteVisibility(request('/api/admin/site-visibility',{method:'PATCH',admin:true,body:{action:'set',path:'/events/sny-00/',visibility,scope:'descendants'}}),env);
  assert.equal((await change('hidden')).status,200);
  for(const path of ['/events/sny-00/','/events/sny-00/index.html','/events/sny-00/?preview=1']){
    const visitor=await worker.fetch(request(path),env,{});
    const crawler=await worker.fetch(new Request(request(path),{headers:{'user-agent':'Googlebot'}}),env,{});
    assert.equal(visitor.status,404);assert.equal(crawler.status,404);
    assert.equal(visitor.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
    assert.equal(await visitor.text(),await crawler.text());
  }
  assert.equal((await send(env)).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_rsvps').get().n,0);
  assert.equal((await handleEventsApi(request('/api/events/sny-00/context'),env)).status,404);
  assert.ok(!(await (await handleEventsApi(request('/api/events'),env)).text()).includes('sny-00'));
  assert.equal((await admin(env,'/rsvps')).status,200);
  assert.equal((await change('public')).status,200);
  assert.equal((await handleEventsApi(request('/api/events/sny-00/context'),env)).status,200);
});
