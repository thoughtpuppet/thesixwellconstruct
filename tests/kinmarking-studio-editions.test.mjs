import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {fixture,ROOT} from './helpers/kinmarking-editions-fixture.mjs';
import {handleAdminEventUpdate,handleAdminEventsList,handleEventContext} from '../functions/api/events/_lib.js';
const request=(body)=>new Request('https://example.test/api/admin/events/kinmarking',{method:body?'PATCH':'GET',headers:{authorization:'Bearer kinmarking-isolated-qa','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('edition migration preserves occurrence data and admission references while inserting undated Grief at 03',()=>{
  const f=fixture({migrate:false});
  const before=f.db.prepare('SELECT * FROM event_occurrences ORDER BY id').all();
  const admission=f.db.prepare('SELECT * FROM event_admission_options').all();
  f.applyMigration();
  for(const old of before){
    const row=f.db.prepare('SELECT * FROM event_occurrences WHERE id=?').get(old.id);
    for(const key of ['id','event_id','title','starts_at','ends_at','status','capacity','location','created_at']) assert.equal(row[key],old[key],key);
    assert.equal(row.session_number,Number(old.session_number)>=3?String(Number(old.session_number)+1).padStart(2,'0'):old.session_number);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM event_admission_options').all(),admission);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  const grief=f.db.prepare("SELECT * FROM event_occurrences WHERE title='Grief & Tattooing'").get();
  assert.equal(grief.session_number,'03');assert.equal(grief.starts_at,null);assert.equal(grief.status,'closed');
  f.db.close();
});
test('Studio adds multiple undated editions, persists description and order, and protects scheduling rules',async()=>{
  const f=fixture();
  const admin=await (await handleAdminEventsList(request(),f.env)).json();
  const original=admin.events.find(e=>e.slug==='kinmarking').occurrences;
  const added={title:'Future & Tattooing',description:'A Studio-authored description.',status:'closed',startsAt:''};
  const occurrences=[original[0],added,...original.slice(1),{...added,title:'Another & Tattooing'}];
  const saved=await handleAdminEventUpdate(request({occurrences}),f.env,'kinmarking');
  assert.equal(saved.status,200,await saved.clone().text());
  const readback=await (await handleEventContext(new Request('https://example.test/api/events/kinmarking/context'),f.env,'kinmarking')).json();
  assert.deepEqual(readback.event.occurrences.map(o=>o.title),occurrences.map(o=>o.title));
  assert.deepEqual(readback.event.occurrences.map(o=>o.sessionNumber),['01','02','03','04','05','06','07']);
  const future=readback.event.occurrences[1];
  assert.equal(future.description,added.description);assert.equal(future.startsAt,null);assert.equal(future.open,false);
  assert.equal(readback.event.occurrences[4].id,original[3].id);
  const invalid=await handleAdminEventUpdate(request({occurrences:[{...future,status:'open'}]}),f.env,'kinmarking');
  assert.equal(invalid.status,400);assert.match(await invalid.text(),/must stay closed/);
  const reversed=await handleAdminEventUpdate(request({occurrences:[...readback.event.occurrences].reverse()}),f.env,'kinmarking');
  assert.equal(reversed.status,200);
  const reordered=await (await handleEventContext(new Request('https://example.test/api/events/kinmarking/context'),f.env,'kinmarking')).json();
  assert.equal(Date.parse(reordered.event.startsAt),Date.parse(original[0].startsAt), 'Next date remains chronological after edition reordering');
  assert.equal(f.db.prepare("SELECT occurrence_id FROM event_admission_options WHERE id='edition-admission-qa'").get().occurrence_id,'kinmarking-qa-03');
  f.db.close();
});
test('public edition renderer follows Studio titles and descriptions beyond the initial five editions',()=>{
  const context={window:{}};vm.runInNewContext(readFileSync(join(ROOT,'js/kinmarking-series.js'),'utf8'),context);
  const s=context.window.KinmarkingSeries;
  const occurrences=[{id:'new',sessionNumber:'06',title:'Future & Tattooing',description:'Studio description',sortOrder:0},{id:'color',sessionNumber:'07',title:'Color & Tattooing',sortOrder:1}];
  const rows=s.orderedEvents([{slug:'kinmarking',occurrences}]);
  assert.equal(rows[0].description,'Studio description');assert.equal(s.editionHref(rows[0]),'/events/kinmarking-06/');
  assert.equal(s.sessionNumberForSlug('kinmarking-12'),'12');
  assert.match(rows[1].description,/meanings we inherit through color/);
});
