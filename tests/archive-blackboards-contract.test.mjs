import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { __blackboardManagerTest as manager } from "../studio/archive-blackboards-manager.js";

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
function request(path,{method="GET",body,admin=false}={}){return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:`Bearer ${TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function json(response){return{status:response.status,body:await response.json()}}

async function createRecord(runtime,overrides={}){
  return json(await handleConstructApi(request("/api/admin/archive-blackboards/records",{method:"POST",admin:true,body:{
    title:"Studio Blackboard — South Wall",slug:"studio-blackboard-south-wall",studio_location:"Studio",wall_designation:"South Wall",
    orientation_note:"viewer faces south when looking at the board.",summary:"One evolving Blackboard record.",occurred_at:"2026-08-01T09:07:00-04:00",date_label:"August 1, 2026",...overrides,
  }}),runtime));
}
function insertPair(db,key,label){
  db.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,privacy,state,public_presentation,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'internal','active','hidden','test',datetime('now'),datetime('now'))`).run(`${key}-master`,`https://private.example.test/${key}.tif`,`${key}-master.tif`,`image/tiff`,`${label} private master`);
  db.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,privacy,state,public_presentation,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'public','active','inline','test',datetime('now'),datetime('now'))`).run(`${key}-web`,`https://cdn.example.test/${key}.jpg`,`${key}.jpg`,`image/jpeg`,label);
  return {master_media_id:`${key}-master`,derivative_media_id:`${key}-web`};
}

class MockBucket {
  constructor(){this.uploads=new Map();this.objects=new Map();this.sequence=0}
  async createMultipartUpload(key){const uploadId=`upload-${++this.sequence}`;this.uploads.set(uploadId,{key,parts:new Map(),aborted:false});return{uploadId,abort:async()=>{this.uploads.get(uploadId).aborted=true}}}
  resumeMultipartUpload(key,uploadId){const state=this.uploads.get(uploadId);return{uploadPart:async(partNumber,body)=>{const bytes=new Uint8Array(await new Response(body).arrayBuffer());state.parts.set(partNumber,bytes);return{partNumber,etag:`etag-${partNumber}`}},complete:async parts=>{const size=parts.reduce((sum,part)=>sum+(state.parts.get(part.partNumber)?.byteLength||0),0);const object={size};this.objects.set(key,object);return object},abort:async()=>{state.aborted=true}}}
  async head(key){return this.objects.get(key)||null}
}

test("one Blackboard record owns its catalogue identity and state scans",async()=>{
  const db=database(),runtime=env(db),created=await createRecord(runtime);
  assert.equal(created.status,201,created.body.error);const recordId=created.body.record.id;
  assert.match(created.body.record.catalogue_id,/^OBJ-\d{3}$/);
  assert.equal(created.body.record.states.length,1);
  assert.equal(created.body.record.states[0].state_roman,"I");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_records WHERE record_type='blackboard'").get().count,1);

  const rejected=await handleConstructApi(request(`/api/admin/archive-blackboards/${recordId}/publish`,{method:"POST",admin:true,body:{}}),runtime);
  assert.equal(rejected.status,409);
  const pair=insertPair(db,"aug-01","August 1 Blackboard state"),stateId=created.body.record.states[0].id;
  assert.deepEqual({...db.prepare("SELECT privacy,state,public_presentation FROM media_assets WHERE id='aug-01-master'").get()},{privacy:"internal",state:"active",public_presentation:"hidden"});
  assert.deepEqual({...db.prepare("SELECT privacy,state,public_presentation FROM media_assets WHERE id='aug-01-web'").get()},{privacy:"public",state:"active",public_presentation:"inline"});
  assert.equal((await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/states/${stateId}`,{method:"POST",admin:true,body:pair}),runtime)).status,200);
  const published=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/${recordId}/publish`,{method:"POST",admin:true,body:{}}),runtime));
  assert.equal(published.status,200,published.body.error);
  assert.deepEqual({...db.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id=?").get(recordId)},{state:"published",public_visible:1});

  const index=await json(await handleConstructApi(request("/api/archive/blackboards"),runtime));
  assert.equal(index.body.records.length,1);
  assert.equal(index.body.records[0].state_count,1);
  const detail=await json(await handleConstructApi(request("/api/archive/blackboards/studio-blackboard-south-wall"),runtime));
  assert.deepEqual(detail.body.states.map(state=>state.catalogue_label),[`${created.body.record.catalogue_id}.1/I`]);
  assert.equal(detail.body.states[0].scan.id,"aug-01-web");
  assert.equal(JSON.stringify(detail.body).includes("aug-01-master"),false);
});

test("South Wall scans become Version 1 States I through III and studio context becomes Notebook evidence",async()=>{
  const db=database(),runtime=env(db),created=await createRecord(runtime);assert.equal(created.status,201,created.body.error);const recordId=created.body.record.id;
  const firstState=created.body.record.states[0];insertPair(db,"aug-01","August 1 Blackboard state");
  await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/states/${firstState.id}`,{method:"POST",admin:true,body:{master_media_id:"aug-01-master",derivative_media_id:"aug-01-web",caption:"August 1 state"}}),runtime);
  const specs=[
    ["aug-12","2026-08-12T19:00:00-04:00","August 12, 2026"],
    ["aug-25","2026-08-25T21:28:00-04:00","August 25, 2026"],
  ];
  const added=[];
  for(const [key,occurredAt,dateLabel] of specs){const pair=insertPair(db,key,`${dateLabel} Blackboard state`);const state=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/states`,{method:"POST",admin:true,body:{occurred_at:occurredAt,date_label:dateLabel,...pair}}),runtime));assert.equal(state.status,201,state.body.error);added.push(state.body.record)}
  await handleConstructApi(request(`/api/admin/archive-blackboards/${recordId}/publish`,{method:"POST",admin:true,body:{}}),runtime);

  const contextPair=insertPair(db,"studio-context","Blackboard in the studio"),notebook=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/notebook`,{method:"POST",admin:true,body:{...contextPair,title:"South Wall blackboard in the studio",caption:"The Blackboard in its studio setting.",occurred_at:"2026-08-25T21:32:00-04:00",date_label:"August 25, 2026 at 9:32 PM",state:"published",public_visible:true}}),runtime));
  assert.equal(notebook.status,201,notebook.body.error);

  const fragmentPair=insertPair(db,"fragment","Tentacle and marbles fragment"),fragment=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments`,{method:"POST",admin:true,body:{...fragmentPair,title:"Tentacle and marbles study",slug:"tentacle-marbles-study"}}),runtime));
  assert.equal(fragment.status,201,fragment.body.error);const fragmentId=fragment.body.record.id;
  await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}`,{method:"PATCH",admin:true,body:{state:"published",public_visible:true}}),runtime);
  const stateIds=[firstState.id,added[1].id];
  const links=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}/states`,{method:"PUT",admin:true,body:{state_ids:stateIds}}),runtime));assert.equal(links.status,200,links.body.error);
  const invalidPlacement=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}/placements`,{method:"PUT",admin:true,body:{placements:[{state_id:added[0].id,x_percent:10,y_percent:10,width_percent:20,height_percent:20}]}}),runtime));assert.equal(invalidPlacement.status,409);
  const placementRows=[
    {state_id:firstState.id,x_percent:34.5,y_percent:17.2,width_percent:24.1,height_percent:31.8,sort_order:1},
    {state_id:added[1].id,x_percent:35.1,y_percent:16.8,width_percent:23.7,height_percent:32.4,sort_order:2},
  ];
  const placements=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}/placements`,{method:"PUT",admin:true,body:{placements:placementRows}}),runtime));assert.equal(placements.status,200,placements.body.error);
  assert.equal(placements.body.placements.length,2);
  const sameLinks=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}/states`,{method:"PUT",admin:true,body:{state_ids:stateIds}}),runtime));assert.equal(sameLinks.status,200,sameLinks.body.error);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_placements WHERE fragment_id=?").get(fragmentId).count,2);

  const targetRows=db.prepare(`SELECT ce.id FROM content_entities ce WHERE ce.visibility='public' AND ce.entity_type IN ('art_work','merch_item') ORDER BY ce.entity_type LIMIT 2`).all();assert.equal(targetRows.length,2);
  for(const [index,target] of targetRows.entries()){const response=await handleConstructApi(request("/api/admin/relationships",{method:"POST",admin:true,body:{source_entity_id:fragmentId,target_entity_id:target.id,relationship_type_id:index?"rel-study-for":"rel-source-for",public_visible:true}}),runtime);assert.equal(response.status,201,JSON.stringify(await response.json()))}
  await handleConstructApi(request(`/api/admin/entities/${fragmentId}/origin-threads`,{method:"PUT",admin:true,body:{origin_thread_ids:["origin-thread-lost-marbles"],primary_origin_thread_id:"origin-thread-lost-marbles"}}),runtime);

  const detail=await json(await handleConstructApi(request("/api/archive/blackboards/studio-blackboard-south-wall"),runtime));assert.equal(detail.status,200,detail.body.error);
  assert.equal(detail.body.record.id,recordId);
  assert.deepEqual(detail.body.states.map(state=>state.state_roman),["I","II","III"]);
  assert.deepEqual(detail.body.states.map(state=>state.date_label),["August 1, 2026","August 12, 2026","August 25, 2026"]);
  assert.deepEqual(detail.body.states.map(state=>state.elapsed_days),[null,11,13]);
  assert.equal(detail.body.latestState.state_roman,"III");
  assert.equal(detail.body.notebook.length,1);
  assert.equal(detail.body.notebook[0].image.id,"studio-context-web");
  assert.equal(detail.body.fragments[0].visibleIn.length,2);
  assert.deepEqual(detail.body.fragments[0].placements.map(item=>item.state_id),stateIds);
  assert.deepEqual(detail.body.fragments[0].placements.map(item=>item.x_percent),[34.5,35.1]);
  assert.deepEqual(detail.body.fragments[0].manifestations.map(item=>item.relationship),["Source for","Study for"]);
  assert.equal(detail.body.fragments[0].originThreads[0].slug,"lost-marbles");
  assert.equal(detail.body.itemHistory.length,0);
  assert.equal(JSON.stringify(detail.body).includes("-master"),false);

  const reused=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments`,{method:"POST",admin:true,body:{...fragmentPair,title:"Second reading",slug:"second-reading"}}),runtime));
  assert.equal(reused.status,201,reused.body.error);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_assets WHERE id IN ('fragment-master','fragment-web')").get().count,2);
  assert.equal((await blackboardDetail(runtime)).fragments.find(item=>item.id===reused.body.record.id)?.placements.length,0);

  await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/fragments/${fragmentId}/states`,{method:"PUT",admin:true,body:{state_ids:[firstState.id]}}),runtime);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_placements WHERE fragment_id=?").get(fragmentId).count,1);
});

async function blackboardDetail(runtime){return (await json(await handleConstructApi(request("/api/admin/archive-blackboards/records" ,{admin:true}),runtime))).body.records[0]}

test("Open Notebook materials on catalogued records remain visible without a state assignment",async()=>{
  const db=database(),runtime=env(db),created=await createRecord(runtime),recordId=created.body.record.id,stateId=created.body.record.states[0].id;
  const statePair=insertPair(db,"state","Blackboard state");await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/states/${stateId}`,{method:"POST",admin:true,body:statePair}),runtime);await handleConstructApi(request(`/api/admin/archive-blackboards/${recordId}/publish`,{method:"POST",admin:true,body:{}}),runtime);
  const notebookPair=insertPair(db,"notebook","Studio view");await handleConstructApi(request(`/api/admin/archive-blackboards/records/${recordId}/notebook`,{method:"POST",admin:true,body:{...notebookPair,title:"Studio view",state:"published",public_visible:true}}),runtime);
  const archive=await json(await handleConstructApi(request("/api/archive/items/studio-blackboard-south-wall"),runtime));
  assert.equal(archive.status,200,archive.body.error);
  assert.ok(archive.body.materials.some(material=>material.role==="notebook"&&material.media_id==="notebook-web"));
});

test("Blackboard migration preserves client correspondence kinds and defines the record/state correction",()=>{
  const migration80=readFileSync(join(ROOT,"migrations","0080_archive_client_correspondence_sets.sql"),"utf8"),migration81=readFileSync(join(ROOT,"migrations","0081_archive_blackboards.sql"),"utf8"),migration176=readFileSync(join(ROOT,"migrations","0176_archive_blackboard_record_states.sql"),"utf8"),migration190=readFileSync(join(ROOT,"migrations","0190_archive_blackboard_fragment_placements.sql"),"utf8");
  assert.match(migration80,/'client-correspondence','blackboard'/);assert.match(migration80,/'blackboard-whole',\s*'blackboard-detail'/);
  assert.match(migration81,/media_asset_variants/);assert.match(migration81,/archive_material_source_contexts/);assert.match(migration81,/upload_kind TEXT NOT NULL DEFAULT 'video'/);
  assert.match(migration176,/archive_blackboard_records/);assert.match(migration176,/archive_blackboard_fragment_states/);assert.match(migration176,/'notebook','process-photo'/);
  assert.match(migration190,/archive_blackboard_fragment_placements/);assert.match(migration190,/FOREIGN KEY\(fragment_id,state_id\)/);assert.match(migration190,/x_percent \+ width_percent <= 100/);
});

test("public Blackboard fragment viewer is driven by stored placements and keeps the full-board return path",()=>{
  const script=readFileSync(join(ROOT,"js","archive-blackboards.js"),"utf8"),styles=readFileSync(join(ROOT,"css","archive-blackboards.css"),"utf8");
  assert.match(script,/statePlacements/);assert.match(script,/data-enter-fragment-view/);assert.match(script,/data-select-board-fragment/);assert.match(script,/data-fragment-full/);assert.match(script,/Return to Blackboard record/);
  assert.match(styles,/\.blackboard-fragment-rail/);assert.match(styles,/border: 5px solid/);assert.match(styles,/data-mode="detail"/);
});

test("Studio Blackboards opens as a record library before exposing an editor",()=>{
  const manager=readFileSync(join(ROOT,"studio","archive-blackboards-manager.js"),"utf8"),styles=readFileSync(join(ROOT,"studio","archive-blackboards-manager.css"),"utf8");
  assert.match(manager,/function selected\(\)\{return records\.find\(record=>record\.id===selectedId\)\|\|null\}/);
  assert.match(manager,/function libraryMarkup\(items=records\)/);assert.match(manager,/data-select-record/);assert.match(manager,/data-back-record/);
  assert.match(manager,/value="\$\{esc\(record\.title\|\|""\)\}" placeholder="Studio Blackboard — East Wall"/);
  assert.doesNotMatch(manager,/record\.title\|\|"Studio Blackboard — South Wall"/);
  assert.match(manager,/fragment\?fragmentWorkflowMarkup\(fragment\):record\?workspaceMarkup\(record\):libraryView==="fragments"\?fragmentLibraryMarkup\(\):libraryMarkup\(\)/);
  assert.match(manager,/Fragment Library/);assert.match(manager,/data-library-view="fragments"/);
  assert.match(styles,/\.bb-record-grid/);assert.match(styles,/\.bb-workspace-panel/);assert.match(styles,/border: 5px solid/);
});

test("Studio Blackboard library keeps record data out of blank creation fields",()=>{
  const record={id:"board-south",title:"Studio Blackboard — South Wall",slug:"studio-blackboard-south-wall",catalogue_id:"OBJ-002",studio_location:"Studio",wall_designation:"South Wall",orientation_note:"viewer faces south",summary:"One evolving board.",state:"published",public_visible:1,states:[{id:"state-i",state_roman:"I"}],notebook:[{id:"note-1"}],fragments:[]};
  const library=manager.libraryMarkup([record]),blank=manager.recordForm(),workspace=manager.workspaceMarkup(record);
  assert.match(library,/Studio Blackboard — South Wall/);assert.match(library,/data-select-record="board-south"/);
  assert.doesNotMatch(blank,/value="Studio Blackboard — South Wall"/);assert.doesNotMatch(blank,/value="South Wall"/);assert.doesNotMatch(blank,/viewer faces south/);
  assert.doesNotMatch(library,/data-record-form data-id="board-south"/);assert.match(workspace,/data-record-form data-id="board-south"/);assert.match(workspace,/data-back-record/);
});

test("archival master uploads resume, complete privately, and cancel without recreating a board",async()=>{
  const db=database(),bucket=new MockBucket(),runtime={...env(db),SUBMISSION_FILES:bucket};
  const createBody={uploadKind:"archive-master",filename:"board-master.tif",mimeType:"image/tiff",byteSize:10,privacy:"public",publicPresentation:"inline"};
  const created=await json(await handleConstructApi(request("/api/admin/media/uploads",{method:"POST",admin:true,body:createBody}),runtime));assert.equal(created.status,201);assert.equal(created.body.upload.uploadKind,"archive-master");const sessionId=created.body.upload.id;
  const partRequest=new Request(`https://example.test/api/admin/media/uploads/${sessionId}/parts/1`,{method:"PUT",headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/octet-stream","content-length":"10"},body:new Uint8Array(10)});
  assert.equal((await handleConstructApi(partRequest,runtime)).status,200);
  const resumed=await json(await handleConstructApi(request(`/api/admin/media/uploads/${sessionId}`,{admin:true}),runtime));assert.equal(resumed.body.upload.parts.length,1);assert.equal(resumed.body.upload.parts[0].byteSize,10);
  const completed=await json(await handleConstructApi(request(`/api/admin/media/uploads/${sessionId}/complete`,{method:"POST",admin:true}),runtime));assert.equal(completed.status,200);assert.equal(completed.body.record.privacy,"internal");assert.equal(completed.body.record.public_presentation,"hidden");assert.equal(completed.body.record.storage_key.startsWith("archive/blackboards/masters/"),true);
  const second=await json(await handleConstructApi(request("/api/admin/media/uploads",{method:"POST",admin:true,body:{...createBody,filename:"other-board.tif"}}),runtime));const cancelled=await json(await handleConstructApi(request(`/api/admin/media/uploads/${second.body.upload.id}`,{method:"DELETE",admin:true}),runtime));assert.equal(cancelled.status,200);assert.equal(cancelled.body.aborted,true);assert.equal(bucket.uploads.get(second.body.upload.uploadId).aborted,true);
});
