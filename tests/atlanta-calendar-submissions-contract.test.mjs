import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleCalendarSubmissionAdminApi,
  handleCalendarSubmissionPublicApi,
  purgeClosedCalendarSubmissions,
} from "../functions/api/calendar-submissions/_lib.js";
import { handleCalendarPublicApi } from "../functions/api/calendar/_lib.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const ADMIN="calendar-submission-admin";

class Statement {
  constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.db,this.sql,values);}
  async first(){return this.db.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:this.db.prepare(this.sql).all(...this.values)};}
  async run(){const result=this.db.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(result.changes||0)}};}
}
class D1 {
  constructor(db){this.db=db;}
  prepare(sql){return new Statement(this.db,sql);}
  async batch(statements){this.db.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.db.exec("COMMIT");return results;}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
class Bucket {
  constructor(){this.objects=new Map();}
  async put(key,value,options={}){if(this.failPut)throw new Error("simulated R2 failure");this.objects.set(key,{bytes:value instanceof Uint8Array?value:new Uint8Array(await new Response(value).arrayBuffer()),options});}
  async get(key){const item=this.objects.get(key);return item?{body:item.bytes}:null;}
  async delete(key){this.objects.delete(key);}
}
function database(){const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");for(const name of readdirSync(join(ROOT,"migrations")).filter((name)=>name.endsWith(".sql")&&!['0147_calendar_creative_scout_import.sql','0160_atlanta_fall_2026_arts_preview.sql','0162_calendar_latest_creative_scout_strong_picks.sql'].includes(name)).sort())db.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));return db;}
function environment(db,bucket=new Bucket()){return {SUBMISSIONS_DB:new D1(db),SUBMISSION_FILES:bucket,SUBMISSIONS_ADMIN_TOKEN:ADMIN,CALENDAR_SUBMISSION_TURNSTILE_TEST_BYPASS:"true",CALENDAR_SUBMISSION_RATE_LIMIT_SALT:"test-rate-salt",PUBLIC_SITE_URL:"https://example.test"};}
function basePayload(overrides={}){return {kind:"new",title:"Community Light Assembly",factualDescription:"An evening of projection, sound, and artist conversation.",eventStructure:"single",dateKind:"timed",startsAt:"2026-10-10T19:00:00-04:00",endsAt:"2026-10-10T21:00:00-04:00",timezone:"America/New_York",organizer:"Atlanta Light Lab",organizerUrl:"https://light.example/",venueName:"South Downtown Room",venueAddress:"50 Lower Alabama Street, Atlanta, GA",venueUrl:"https://venue.example/",city:"Atlanta",region:"GA",atlantaMetroConfirmed:true,sourceUrl:"https://light.example/events/community-assembly",ticketUrl:"",admissionType:"free",subjects:["art","technology"],formats:["performance"],people:[{name:"A. Person",role:"participant",creditRole:"Projection artist",url:"https://artist.example/"}],occurrences:[],submitterName:"Community Organizer",submitterEmail:"organizer@example.test",submitterPhone:"404-555-0100",submitterRelationship:"Organizer",rightsConfirmed:true,editorialConfirmed:true,...overrides};}
function pngFile(){return new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])],"assembly.png",{type:"image/png"});}
function publicRequest(path,{method="GET",payload,files=[],token="test-pass",idempotency=crypto.randomUUID(),manageToken=""}={}){let body;if(payload){body=new FormData();body.set("payload",JSON.stringify(payload));body.set("cf-turnstile-response",token);body.set("website","");files.forEach((file)=>body.append("flyers",file,file.name));}return new Request(`https://example.test${path}`,{method,headers:{...(idempotency?{"Idempotency-Key":idempotency}:{}),...(manageToken?{authorization:`Bearer ${manageToken}`}:{})},body});}
function adminRequest(path,{method="GET",body}={}){return new Request(`https://example.test/api/admin/calendar/submissions${path}`,{method,headers:{authorization:`Bearer ${ADMIN}`,...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});}

test("public intake is private, idempotent, token-hashed, editable, and conversion stays approval-gated",async()=>{
  const db=database(),bucket=new Bucket(),env=environment(db,bucket),idempotency=crypto.randomUUID();
  const first=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload(),files:[pngFile()],idempotency}),env);
  assert.equal(first.status,201,await first.clone().text());
  const receipt=await first.json();
  assert.match(receipt.reference,/^ATL-\d{8}-/);
  const manageToken=new URL(receipt.manageUrl).hash.replace(/^#token=/,"");
  const rawToken=decodeURIComponent(manageToken);
  assert.equal(db.prepare("SELECT status FROM calendar_public_submissions WHERE reference_code=?").get(receipt.reference).status,"received");
  const tokenRow=db.prepare("SELECT token_hash FROM calendar_public_submission_tokens").get();
  assert.equal(tokenRow.token_hash.length,64);
  assert.notEqual(tokenRow.token_hash,rawToken);
  assert.equal(bucket.objects.size,1);
  assert.equal(db.prepare("SELECT privacy FROM media_assets WHERE created_by='calendar-public-submission'").get().privacy,"internal");

  const repeated=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload(),idempotency}),env);
  assert.equal(repeated.status,200);
  assert.deepEqual((await repeated.json()).reference,receipt.reference);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submissions").get().count,1);

  const publicBefore=await handleCalendarPublicApi(new Request("https://example.test/api/calendar/events"),env);
  assert.equal((await publicBefore.json()).events.some((event)=>event.title==="Community Light Assembly"),false);
  const managed=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions/manage",{manageToken:rawToken,idempotency:""}),env);
  const current=(await managed.json()).submission;
  assert.equal(current.editable,true);
  const edited={...current.payload,title:"Community Light Assembly — Updated",media:current.media.map((item,index)=>({id:item.id,altText:item.altText,sortOrder:index}))};
  const update=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions/manage",{method:"PATCH",payload:edited,manageToken:rawToken,idempotency:""}),env);
  assert.equal(update.status,200,await update.clone().text());
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submission_revisions").get().count,2);

  const listing=await handleCalendarSubmissionAdminApi(adminRequest(""),env);
  assert.equal((await listing.json()).submissions.length,1);
  const submissionId=db.prepare("SELECT id FROM calendar_public_submissions").get().id;
  const converted=await handleCalendarSubmissionAdminApi(adminRequest(`/${submissionId}/convert`,{method:"POST",body:{}}),env);
  assert.equal(converted.status,200,await converted.clone().text());
  const candidateId=(await converted.json()).candidateId;
  const candidate=db.prepare("SELECT status,verification_state,source_authority,public_entry_id FROM calendar_candidates WHERE id=?").get(candidateId);
  assert.deepEqual({...candidate},{status:"needs_verification",verification_state:"needs_verification",source_authority:"unresolved",public_entry_id:""});
  assert.deepEqual({...db.prepare("SELECT link_role,credit_role,include_public FROM calendar_candidate_links WHERE candidate_id=?").get(candidateId)},{link_role:"participant",credit_role:"Projection artist",include_public:0});
  const publicAfter=await handleCalendarPublicApi(new Request("https://example.test/api/calendar/events"),env);
  assert.equal((await publicAfter.json()).events.some((event)=>event.title.includes("Community Light Assembly")),false);
});

test("validation, Turnstile, file signatures, edit locking, and retention fail safely",async()=>{
  const db=database(),bucket=new Bucket(),env=environment(db,bucket);
  const failedTurnstile=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload(),token:"wrong"}),env);
  assert.equal(failedTurnstile.status,403);
  const invalidFile=new File([new Uint8Array([1,2,3,4])],"fake.png",{type:"image/png"});
  const failedFile=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload(),files:[invalidFile]}),env);
  assert.equal(failedFile.status,413);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submissions").get().count,0);
  assert.equal(bucket.objects.size,0);

  const created=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload()}),env);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_type='calendar_public_submission'").get().count,2);
  const receipt=await created.json(),rawToken=decodeURIComponent(new URL(receipt.manageUrl).hash.replace(/^#token=/,""));
  const submissionId=db.prepare("SELECT id FROM calendar_public_submissions").get().id;
  await handleCalendarSubmissionAdminApi(adminRequest(`/${submissionId}/decline`,{method:"POST",body:{note:"Outside the editorial scope."}}),env);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notification_deliveries WHERE related_type='calendar_public_submission'").get().count,2);
  const locked=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions/manage",{method:"PATCH",payload:basePayload({title:"Should not save"}),manageToken:rawToken,idempotency:""}),env);
  assert.equal(locked.status,409);
  db.prepare("UPDATE calendar_public_submissions SET closed_at='2026-01-01T00:00:00.000Z'").run();
  const purge=await purgeClosedCalendarSubmissions(env,new Date("2026-05-01T00:00:00.000Z"));
  assert.equal(purge.purged,1);
  const purged=db.prepare("SELECT submitter_name,submitter_email,personal_data_purged_at FROM calendar_public_submissions").get();
  assert.equal(purged.submitter_name,"");
  assert.equal(purged.submitter_email,"");
  assert.ok(purged.personal_data_purged_at);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submission_tokens").get().count,0);
});

test("correction conversion creates a selective private revision without mutating candidate facts",async()=>{
  const db=database(),env=environment(db);
  const target=db.prepare("SELECT id,title,source_url FROM calendar_candidates WHERE pending_revision_id='' LIMIT 1").get();
  assert.ok(target);
  const correction=basePayload({kind:"correction",title:`${target.title} corrected`,targetUrl:target.source_url||"https://example.test/calendar/#event",correctionSummary:"Correct the public title after Studio verifies the organizer source.",submitterEmail:"correction@example.test"});
  const response=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:correction}),env);
  assert.equal(response.status,201,await response.clone().text());
  const submissionId=db.prepare("SELECT id FROM calendar_public_submissions WHERE submission_kind='correction'").get().id;
  const converted=await handleCalendarSubmissionAdminApi(adminRequest(`/${submissionId}/convert`,{method:"POST",body:{candidateId:target.id}}),env);
  assert.equal(converted.status,200,await converted.clone().text());
  const conversion=await converted.json();
  assert.ok(conversion.revisionId);
  assert.equal(conversion.submission.convertedRevisionId,conversion.revisionId);
  const after=db.prepare("SELECT title,pending_revision_id FROM calendar_candidates WHERE id=?").get(target.id);
  assert.equal(after.title,target.title);
  assert.ok(after.pending_revision_id);
  const revision=db.prepare("SELECT snapshot_json,created_by,change_set_json FROM calendar_candidate_revisions WHERE id=?").get(after.pending_revision_id);
  assert.equal(revision.created_by,"public-submission");
  assert.equal(JSON.parse(revision.snapshot_json).title,correction.title);
  assert.equal(JSON.parse(revision.change_set_json).some((change)=>change.field==="title"&&change.applied!==true),true);
});

test("a failed edit upload restores the previous immutable revision and media state",async()=>{
  const db=database(),bucket=new Bucket(),env=environment(db,bucket);
  const response=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload(),files:[pngFile()]}),env);
  const receipt=await response.json(),rawToken=decodeURIComponent(new URL(receipt.manageUrl).hash.replace(/^#token=/,""));
  const managed=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions/manage",{manageToken:rawToken,idempotency:""}),env);
  const current=(await managed.json()).submission;
  const before=db.prepare("SELECT latest_revision_id FROM calendar_public_submissions").get().latest_revision_id;
  bucket.failPut=true;
  const changed={...current.payload,title:"This failed edit must roll back",media:current.media.map((item,index)=>({id:item.id,altText:item.altText,sortOrder:index}))};
  const failed=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions/manage",{method:"PATCH",payload:changed,files:[pngFile()],manageToken:rawToken,idempotency:""}),env);
  assert.equal(failed.status,500);
  assert.equal(db.prepare("SELECT latest_revision_id FROM calendar_public_submissions").get().latest_revision_id,before);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submission_revisions").get().count,1);
  assert.equal(JSON.parse(db.prepare("SELECT payload_json FROM calendar_public_submission_revisions WHERE id=?").get(before).payload_json).title,"Community Light Assembly");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_public_submission_media WHERE removed_at IS NULL").get().count,1);
  assert.equal(bucket.objects.size,1);
});

test("privacy-preserving hourly limits reject the sixth accepted identity",async()=>{
  const db=database(),env=environment(db);
  for(let index=0;index<5;index+=1){const response=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload({title:`Rate limit event ${index}`,sourceUrl:`https://light.example/events/rate-${index}`})}),env);assert.equal(response.status,201,await response.clone().text());}
  const limited=await handleCalendarSubmissionPublicApi(publicRequest("/api/calendar/submissions",{method:"POST",payload:basePayload({title:"Rate limit event six",sourceUrl:"https://light.example/events/rate-six"})}),env);
  assert.equal(limited.status,429);
  const hashes=db.prepare("SELECT identity_hash FROM calendar_public_submission_rate_limits").all();
  assert.equal(hashes.length,2);
  assert.equal(hashes.every((row)=>/^[a-f0-9]{64}$/.test(row.identity_hash)),true);
});

test("public and Studio markup expose guided intake without public raw-submission paths",()=>{
  const calendar=readFileSync(join(ROOT,"calendar","index.html"),"utf8");
  const submit=readFileSync(join(ROOT,"calendar","submit","index.html"),"utf8");
  const manage=readFileSync(join(ROOT,"calendar","submit","manage","index.html"),"utf8");
  const client=readFileSync(join(ROOT,"js","calendar-submit.js"),"utf8");
  const studio=readFileSync(join(ROOT,"studio","calendar","index.html"),"utf8");
  assert.match(calendar,/href="\/calendar\/submit\/"/);
  assert.match(submit,/data-submission-mode="create"/);
  assert.match(manage,/data-submission-mode="manage"/);
  assert.match(client,/Event basics[\s\S]*Schedule \+ place[\s\S]*People \+ links[\s\S]*Admission \+ media[\s\S]*Contact \+ consent/);
  assert.match(client,/Idempotency-Key/);
  assert.match(client,/cf-turnstile-response/);
  assert.match(studio,/Community Submissions/);
  assert.doesNotMatch(calendar,/calendar_public_submissions|submitterEmail|contact evidence/i);
});
