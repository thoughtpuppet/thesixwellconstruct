import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN="archive-blackboard-test-token";

class D1Statement {
  constructor(database,sql,values=[]){this.database=database;this.sql=sql;this.values=values}
  bind(...values){return new D1Statement(this.database,this.sql,values)}
  async first(){return this.database.prepare(this.sql).get(...this.values)||null}
  async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}
  async run(){const statement=this.database.prepare(this.sql);if(statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT"))return{results:statement.all(...this.values)};const result=statement.run(...this.values);return{success:true,meta:{changes:Number(result.changes||0)}}}
}
class LocalD1 {
  constructor(database){this.database=database}
  prepare(sql){return new D1Statement(this.database,sql)}
  async batch(statements){this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}}
}
function database(){
  const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");
  for(const name of readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort())db.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
  return db;
}
function env(db){return{SUBMISSIONS_DB:new LocalD1(db),SUBMISSIONS_ADMIN_TOKEN:TOKEN}}
function request(path,{method="GET",body,admin=false}={}){
  return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:`Bearer ${TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function json(response){return{status:response.status,body:await response.json()}}

class MockBucket {
  constructor(){this.uploads=new Map();this.objects=new Map();this.sequence=0}
  async createMultipartUpload(key){
    const uploadId=`upload-${++this.sequence}`;this.uploads.set(uploadId,{key,parts:new Map(),aborted:false});
    return{uploadId,abort:async()=>{this.uploads.get(uploadId).aborted=true}};
  }
  resumeMultipartUpload(key,uploadId){
    const state=this.uploads.get(uploadId);
    return{
      uploadPart:async(partNumber,body)=>{const bytes=new Uint8Array(await new Response(body).arrayBuffer());state.parts.set(partNumber,bytes);return{partNumber,etag:`etag-${partNumber}`}},
      complete:async parts=>{const size=parts.reduce((sum,part)=>sum+(state.parts.get(part.partNumber)?.byteLength||0),0);const object={size};this.objects.set(key,object);return object},
      abort:async()=>{state.aborted=true},
    };
  }
  async head(key){return this.objects.get(key)||null}
}

test("complete Blackboard records require a private master and public derivative pair",async()=>{
  const db=database(),runtime=env(db);
  const created=await json(await handleConstructApi(request("/api/admin/archive-blackboards",{method:"POST",admin:true,body:{title:"North wall board",occurred_at:"2026-07-20",date_label:"July 2026",summary:"A captured working field."}}),runtime));
  assert.equal(created.status,201);
  assert.match(created.body.record.catalogue_id,/^OBJ-\d{3}$/);
  assert.equal(created.body.record.state,"draft");
  assert.equal(created.body.record.publish_ready,false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id=?").get(created.body.record.id).count,1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id WHERE aov.entity_id=?").get(created.body.record.id).count,1);

  const rejected=await handleConstructApi(request(`/api/admin/archive-blackboards/${created.body.record.id}/publish`,{method:"POST",admin:true,body:{}}),runtime);
  assert.equal(rejected.status,409);

  db.exec(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at) VALUES
    ('board-master','https://private.example.test/board.tif','board.tif','image/tiff','Archival Blackboard master','internal','not-required','active','hidden','test',datetime('now'),datetime('now')),
    ('board-derivative','https://cdn.example.test/board.jpg','board.jpg','image/jpeg','Complete Blackboard scan','public','not-required','active','inline','test',datetime('now'),datetime('now'));`);
  const paired=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/${created.body.record.id}/scan`,{method:"POST",admin:true,body:{master_media_id:"board-master",derivative_media_id:"board-derivative",caption:"Complete captured state."}}),runtime));
  assert.equal(paired.status,200,paired.body.error);
  assert.equal(paired.body.record.publish_ready,true);
  assert.ok(paired.body.record.material_id);

  const published=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/${created.body.record.id}/publish`,{method:"POST",admin:true,body:{}}),runtime));
  assert.equal(published.status,200);
  assert.equal(published.body.record.state,"published");
  assert.deepEqual({...db.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id='board-master'").get()},{privacy:"internal",public_presentation:"hidden"});

  const publicPayload=await json(await handleConstructApi(request("/api/archive/blackboards"),runtime));
  assert.equal(publicPayload.status,200);
  assert.equal(publicPayload.body.boards.length,1);
  assert.equal(publicPayload.body.boards[0].scan.id,"board-derivative");
  assert.equal(JSON.stringify(publicPayload.body).includes("board-master"),false);
  const detail=await json(await handleConstructApi(request(`/api/archive/items/${created.body.record.archive_slug}`),runtime));
  assert.equal(detail.status,200);
  assert.equal(detail.body.record?.title||detail.body.item?.title,"North wall board");
  const privateMaster=await handleConstructApi(request("/api/construct/media/board-master"),runtime);
  assert.equal(privateMaster.status,404);
});

test("Blackboard fragments deduplicate by Digital Asset and retain every source context",async()=>{
  const db=database(),runtime=env(db);
  const publicStates=db.prepare(`SELECT aov.entity_id,aos.id state_id
    FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE aov.publication_state='published' AND aov.public_visible=1
      AND aos.publication_state='published' AND aos.public_visible=1
      AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    GROUP BY aov.entity_id ORDER BY aov.entity_id LIMIT 2`).all();
  assert.equal(publicStates.length,2);
  db.exec(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,public_presentation,created_by,created_at,updated_at)
    VALUES('shared-board-detail','https://cdn.example.test/shared-detail.jpg','shared-detail.jpg','image/jpeg','Blackboard sketch detail','public','not-required','active','inline','test',datetime('now'),datetime('now'));`);
  for(const [index,state] of publicStates.entries()){
    const created=await json(await handleConstructApi(request("/api/admin/archive-source-materials",{method:"POST",admin:true,body:{entity_id:state.entity_id,source_kind:"blackboard",title:`Blackboard source ${index+1}`,state_ids:[state.state_id]}}),runtime));
    assert.equal(created.status,201);
    const entry=await handleConstructApi(request(`/api/admin/archive-source-materials/${created.body.record.id}/entries`,{method:"POST",admin:true,body:{media_id:"shared-board-detail",entry_type:"blackboard-detail",title:"Shared sketch",public_included:true}}),runtime);
    assert.equal(entry.status,201);
    const publish=await handleConstructApi(request(`/api/admin/archive-source-materials/${created.body.record.id}`,{method:"PATCH",admin:true,body:{visibility:"public",publication_state:"published",permission_status:"not-required"}}),runtime);
    assert.equal(publish.status,200);
  }
  const publicPayload=await json(await handleConstructApi(request("/api/archive/blackboards"),runtime));
  assert.equal(publicPayload.status,200);
  assert.equal(publicPayload.body.fragments.length,1);
  assert.equal(publicPayload.body.fragments[0].id,"shared-board-detail");
  assert.equal(publicPayload.body.fragments[0].contexts.length,2);
  assert.equal(publicPayload.body.fragments[0].board,null);
});

test("Blackboard migration preserves client correspondence kinds and generalizes resumable media",()=>{
  const migration80=readFileSync(join(ROOT,"migrations","0080_archive_client_correspondence_sets.sql"),"utf8");
  const migration81=readFileSync(join(ROOT,"migrations","0081_archive_blackboards.sql"),"utf8");
  assert.match(migration80,/'client-correspondence','blackboard'/);
  assert.match(migration80,/'blackboard-whole',\s*'blackboard-detail'/);
  assert.match(migration81,/media_asset_variants/);
  assert.match(migration81,/archive_material_source_contexts/);
  assert.match(migration81,/upload_kind TEXT NOT NULL DEFAULT 'video'/);
  assert.match(migration81,/'other-blackboard','other','Blackboard','OBJ'/);
});

test("archival master uploads resume, complete privately, and cancel without recreating a board",async()=>{
  const db=database(),bucket=new MockBucket(),runtime={...env(db),SUBMISSION_FILES:bucket};
  const createBody={uploadKind:"archive-master",filename:"board-master.tif",mimeType:"image/tiff",byteSize:10,privacy:"public",publicPresentation:"inline"};
  const created=await json(await handleConstructApi(request("/api/admin/media/uploads",{method:"POST",admin:true,body:createBody}),runtime));
  assert.equal(created.status,201);
  assert.equal(created.body.upload.uploadKind,"archive-master");
  const sessionId=created.body.upload.id;

  const partRequest=new Request(`https://example.test/api/admin/media/uploads/${sessionId}/parts/1`,{
    method:"PUT",
    headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/octet-stream","content-length":"10"},
    body:new Uint8Array(10),
  });
  const part=await handleConstructApi(partRequest,runtime);
  assert.equal(part.status,200);
  const resumed=await json(await handleConstructApi(request(`/api/admin/media/uploads/${sessionId}`,{admin:true}),runtime));
  assert.equal(resumed.body.upload.parts.length,1);
  assert.equal(resumed.body.upload.parts[0].byteSize,10);

  const completed=await json(await handleConstructApi(request(`/api/admin/media/uploads/${sessionId}/complete`,{method:"POST",admin:true}),runtime));
  assert.equal(completed.status,200);
  assert.equal(completed.body.record.privacy,"internal");
  assert.equal(completed.body.record.public_presentation,"hidden");
  assert.equal(completed.body.record.storage_key.startsWith("archive/blackboards/masters/"),true);

  const second=await json(await handleConstructApi(request("/api/admin/media/uploads",{method:"POST",admin:true,body:{...createBody,filename:"other-board.tif"}}),runtime));
  const cancelled=await json(await handleConstructApi(request(`/api/admin/media/uploads/${second.body.upload.id}`,{method:"DELETE",admin:true}),runtime));
  assert.equal(cancelled.status,200);
  assert.equal(cancelled.body.aborted,true);
  assert.equal(bucket.uploads.get(second.body.upload.uploadId).aborted,true);
});
