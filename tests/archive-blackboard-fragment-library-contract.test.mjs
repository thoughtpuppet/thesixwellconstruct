import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN="archive-blackboard-fragment-library-test-token";
const MIGRATION="0197_archive_blackboard_fragment_library_editor.sql";

class D1Statement{
  constructor(database,sql,values=[]){this.database=database;this.sql=sql;this.values=values}
  bind(...values){return new D1Statement(this.database,this.sql,values)}
  async first(){return this.database.prepare(this.sql).get(...this.values)||null}
  async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}
  async run(){const statement=this.database.prepare(this.sql);if(statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT"))return{results:statement.all(...this.values)};const result=statement.run(...this.values);return{success:true,meta:{changes:Number(result.changes||0)}}}
}

class LocalD1{
  constructor(database){this.database=database}
  prepare(sql){return new D1Statement(this.database,sql)}
  async batch(statements){this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}}
}

class DeletionBucket{
  constructor(database,keys=[]){this.database=database;this.objects=new Set(keys);this.deleted=[]}
  async delete(key){assert.equal(this.database.prepare("SELECT id FROM media_assets WHERE storage_key=?").get(key),undefined,"D1 media row must be deleted before its R2 object");this.deleted.push(key);this.objects.delete(key)}
}

function migratedDatabase({beforeFragmentLibrary=false}={}){
  const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");
  for(const name of readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort()){
    if(beforeFragmentLibrary&&name>=MIGRATION)break;
    database.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
  }
  return database;
}

function env(database){return{SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:TOKEN}}
function request(path,{method="GET",body,admin=false}={}){return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:`Bearer ${TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function json(response){return{status:response.status,body:await response.json()}}

function insertAsset(database,id,mimeType,{privacy="internal",presentation="hidden",sourceUrl=`https://assets.example.test/${id}`,storageKey=""}={}){
  const extension=mimeType==="image/tiff"?"tif":mimeType.split("/")[1]||"bin";
  database.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,width,height,alt_text,privacy,state,public_presentation,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,1200,900,?,?,'active',?,'test',datetime('now'),datetime('now'))`).run(id,sourceUrl,storageKey,`${id}.${extension}`,mimeType,`${id} test image`,privacy,presentation);
  return id;
}

function insertScanPair(database,key){
  insertAsset(database,`${key}-master`,"image/tiff");
  insertAsset(database,`${key}-web`,"image/jpeg",{privacy:"public",presentation:"inline"});
  return{master_media_id:`${key}-master`,derivative_media_id:`${key}-web`};
}

async function createBoard(runtime,{id,title,slug}){
  const response=await json(await handleConstructApi(request("/api/admin/archive-blackboards/records",{method:"POST",admin:true,body:{id,title,slug,summary:`${title} record`}}),runtime));
  assert.equal(response.status,201,response.body.error);return response.body.record;
}

async function publishBoard(database,runtime,board,key){
  const pair=insertScanPair(database,key),stateId=board.states[0].id;
  const attached=await handleConstructApi(request(`/api/admin/archive-blackboards/records/${board.id}/states/${stateId}`,{method:"POST",admin:true,body:pair}),runtime);
  assert.equal(attached.status,200);
  const published=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/${board.id}/publish`,{method:"POST",admin:true,body:{}}),runtime));
  assert.equal(published.status,200,published.body.error);return stateId;
}

test("fragment-library migration preserves legacy ownership and backfills global slugs and edit lineage",()=>{
  const database=migratedDatabase({beforeFragmentLibrary:true}),boardType=database.prepare("SELECT medium_id,catalogue_prefix FROM archive_cultural_object_types WHERE id='other-blackboard'").get();
  for(const [index,suffix] of ["a","b"].entries()){
    database.prepare("INSERT INTO content_entities(id,entity_type,created_at,updated_at) VALUES(?,'archive_record',datetime('now'),datetime('now'))").run(`legacy-board-${suffix}`);
    database.prepare("INSERT INTO archive_records(id,slug,title,record_type,created_at,updated_at) VALUES(?,?,?,'blackboard',datetime('now'),datetime('now'))").run(`legacy-board-${suffix}`,`legacy-board-${suffix}`,`Legacy board ${suffix}`);
    database.prepare("INSERT INTO archive_dossiers(entity_id,archive_slug,record_type,created_at,updated_at) VALUES(?,?,'blackboard',datetime('now'),datetime('now'))").run(`legacy-board-${suffix}`,`legacy-board-${suffix}`);
    database.prepare("INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,created_at,updated_at) VALUES(?,?,'other-blackboard',?,?,?,datetime('now'),datetime('now'))").run(`legacy-board-${suffix}`,boardType.medium_id,boardType.catalogue_prefix,9001+index,`${boardType.catalogue_prefix}-${9001+index}`);
    database.prepare("INSERT INTO archive_blackboard_records(record_entity_id,studio_location,wall_designation,orientation_note,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))").run(`legacy-board-${suffix}`,"Studio",suffix==="a"?"South Wall":"North Wall",suffix==="a"?"Viewer faces south.":"Viewer faces north.");
    database.prepare("INSERT INTO content_entities(id,entity_type,created_at,updated_at) VALUES(?,'archive_blackboard_fragment',datetime('now'),datetime('now'))").run(`legacy-fragment-${suffix}`);
    insertAsset(database,`legacy-master-${suffix}`,"image/tiff");insertAsset(database,`legacy-web-${suffix}`,"image/png",{privacy:"public",presentation:"inline"});
    database.prepare(`INSERT INTO archive_blackboard_fragments(id,record_entity_id,slug,title,master_media_id,derivative_media_id,created_at,updated_at)
      VALUES(?,?,'shared-legacy-slug',?,?,?,datetime('now',?),datetime('now',?))`).run(`legacy-fragment-${suffix}`,`legacy-board-${suffix}`,`Legacy fragment ${suffix}`,`legacy-master-${suffix}`,`legacy-web-${suffix}`,suffix==="a"?"-2 seconds":"-1 seconds",suffix==="a"?"-2 seconds":"-1 seconds");
  }
  database.prepare("INSERT INTO archive_object_versions(id,entity_id,version_number,title,created_at,updated_at) VALUES('legacy-board-a-version','legacy-board-a',1,'Version 1',datetime('now'),datetime('now'))").run();
  database.prepare("INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,created_at,updated_at) VALUES('legacy-board-a-state-i','legacy-board-a-version','I',1,'State I',datetime('now'),datetime('now'))").run();
  database.prepare("INSERT INTO archive_blackboard_fragment_states(fragment_id,state_id,note,sort_order,created_by,created_at) VALUES('legacy-fragment-a','legacy-board-a-state-i','South Wall detail',1,'test',datetime('now'))").run();
  database.prepare(`INSERT INTO archive_blackboard_fragment_placements(fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,sort_order,created_by,updated_by,created_at,updated_at)
    VALUES('legacy-fragment-a','legacy-board-a-state-i',11.25,22.5,31.75,40.5,1,'test','test',datetime('now'),datetime('now'))`).run();
  database.prepare("INSERT INTO archive_origin_thread_entities(thread_id,entity_id,is_primary,sort_order,created_at) VALUES('origin-thread-lost-marbles','legacy-fragment-a',1,7,datetime('now'))").run();
  database.prepare(`INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
    VALUES('legacy-fragment-manifestation','legacy-fragment-a','art-marbles','rel-study-for',1,'Controlled manifestation link',3,'test',datetime('now'),datetime('now'))`).run();

  database.exec(readFileSync(join(ROOT,"migrations",MIGRATION),"utf8"));
  const columns=database.prepare("PRAGMA table_info(archive_blackboard_fragments)").all(),recordOwner=columns.find(column=>column.name==="record_entity_id");
  assert.equal(recordOwner.notnull,0);assert.ok(columns.some(column=>column.name==="edit_source_media_id"));
  assert.ok(database.prepare("PRAGMA table_info(archive_blackboard_fragment_placements)").all().some(column=>column.name==="hotspot_mask_media_id"));
  const fragments=database.prepare("SELECT id,record_entity_id,slug,master_media_id,edit_source_media_id,derivative_media_id FROM archive_blackboard_fragments ORDER BY id").all();
  assert.deepEqual(fragments.map(row=>row.record_entity_id),["legacy-board-a","legacy-board-b"]);
  assert.equal(new Set(fragments.map(row=>row.slug)).size,2);assert.equal(fragments[0].slug,"shared-legacy-slug");assert.match(fragments[1].slug,/^shared-legacy-slug-legacy-/);
  assert.deepEqual(fragments.map(row=>row.edit_source_media_id),["legacy-web-a","legacy-web-b"]);assert.deepEqual(fragments.map(row=>[row.master_media_id,row.derivative_media_id]),[["legacy-master-a","legacy-web-a"],["legacy-master-b","legacy-web-b"]]);
  const edits=database.prepare("SELECT fragment_id,revision_number,source_media_id,output_media_id,is_current,recipe_json FROM archive_blackboard_fragment_edits ORDER BY fragment_id").all();
  assert.equal(edits.length,2);assert.ok(edits.every(edit=>edit.revision_number===1&&edit.is_current===1));assert.ok(edits.every(edit=>edit.source_media_id===edit.output_media_id));
  assert.deepEqual({...database.prepare("SELECT record_entity_id,studio_location,wall_designation,orientation_note FROM archive_blackboard_records WHERE record_entity_id='legacy-board-a'").get()},{record_entity_id:"legacy-board-a",studio_location:"Studio",wall_designation:"South Wall",orientation_note:"Viewer faces south."});
  assert.deepEqual({...database.prepare("SELECT fragment_id,state_id,note,sort_order FROM archive_blackboard_fragment_states WHERE fragment_id='legacy-fragment-a'").get()},{fragment_id:"legacy-fragment-a",state_id:"legacy-board-a-state-i",note:"South Wall detail",sort_order:1});
  assert.deepEqual({...database.prepare("SELECT fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,hotspot_mask_media_id,hotspot_recipe_json,sort_order FROM archive_blackboard_fragment_placements WHERE fragment_id='legacy-fragment-a'").get()},{fragment_id:"legacy-fragment-a",state_id:"legacy-board-a-state-i",x_percent:11.25,y_percent:22.5,width_percent:31.75,height_percent:40.5,hotspot_mask_media_id:null,hotspot_recipe_json:null,sort_order:1});
  assert.deepEqual({...database.prepare("SELECT thread_id,entity_id,is_primary,sort_order FROM archive_origin_thread_entities WHERE entity_id='legacy-fragment-a'").get()},{thread_id:"origin-thread-lost-marbles",entity_id:"legacy-fragment-a",is_primary:1,sort_order:7});
  assert.deepEqual({...database.prepare("SELECT id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order FROM entity_relationships WHERE id='legacy-fragment-manifestation'").get()},{id:"legacy-fragment-manifestation",source_entity_id:"legacy-fragment-a",target_entity_id:"art-marbles",relationship_type_id:"rel-study-for",public_visible:1,internal_notes:"Controlled manifestation link",sort_order:3});
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("independent fragments keep versioned private edits, then map atomically to one Blackboard",async()=>{
  const database=migratedDatabase(),runtime=env(database),boardOne=await createBoard(runtime,{id:"fragment-board-one",title:"Fragment board one",slug:"fragment-board-one"}),boardTwo=await createBoard(runtime,{id:"fragment-board-two",title:"Fragment board two",slug:"fragment-board-two"});
  const stateId=await publishBoard(database,runtime,boardOne,"fragment-board-state");
  const draftStateResponse=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${boardOne.id}/states`,{method:"POST",admin:true,body:{title:"Unpublished working state",date_label:"Working state"}}),runtime));assert.equal(draftStateResponse.status,201,draftStateResponse.body.error);const draftStateId=draftStateResponse.body.record.id;
  database.prepare("UPDATE archive_catalogue_entries SET current_state='I',current_state_id=? WHERE entity_id=?").run(stateId,boardOne.id);
  insertAsset(database,"fragment-master","image/tiff");insertAsset(database,"fragment-source","image/jpeg",{privacy:"public",presentation:"inline"});
  const created=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments",{method:"POST",admin:true,body:{id:"library-fragment-one",slug:"library-fragment-one",title:"Library fragment one",master_media_id:"fragment-master",edit_source_media_id:"fragment-source"}}),runtime));
  assert.equal(created.status,201,created.body.error);assert.equal(created.body.record.record_entity_id,null);assert.equal(created.body.record.mapping_status,"unmapped");assert.equal(created.body.record.edit_status,"unedited");
  assert.deepEqual({...database.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id='fragment-source'").get()},{privacy:"internal",public_presentation:"hidden"});

  insertAsset(database,"fragment-alpha-one","image/png",{privacy:"public",presentation:"inline"});insertAsset(database,"fragment-output-one","image/webp");
  const recipeOne={version:1,crop:{x:0.08,y:0.12,width:0.76,height:0.7},output:{width:1000,height:800},strokes:[{mode:"erase",x:0.2,y:0.4,radius:0.04,softness:0.7,opacity:0.8}]};
  const firstEdit=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/edits",{method:"POST",admin:true,body:{id:"fragment-edit-one",source_media_id:"fragment-source",alpha_mask_media_id:"fragment-alpha-one",output_media_id:"fragment-output-one",recipe:recipeOne}}),runtime));
  assert.equal(firstEdit.status,201,firstEdit.body.error);assert.equal(firstEdit.body.edit.revision_number,1);assert.deepEqual(firstEdit.body.edit.recipe,recipeOne);
  for(const assetId of ["fragment-source","fragment-alpha-one","fragment-output-one"]){assert.deepEqual({...database.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id=?").get(assetId)},{privacy:"internal",public_presentation:"hidden"})}

  insertAsset(database,"fragment-alpha-two","image/png");insertAsset(database,"fragment-output-two","image/png");
  const recipeTwo={version:1,crop:{x:0,y:0,width:1,height:1},output:{width:1200,height:900},strokes:[{mode:"restore",x:0.3,y:0.5,radius:0.02,softness:0.4,opacity:1}]};
  const secondEdit=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/edits",{method:"POST",admin:true,body:{id:"fragment-edit-two",source_media_id:"fragment-source",alpha_mask_media_id:"fragment-alpha-two",output_media_id:"fragment-output-two",recipe:recipeTwo}}),runtime));
  assert.equal(secondEdit.status,201,secondEdit.body.error);assert.equal(secondEdit.body.edit.revision_number,2);assert.equal(secondEdit.body.record.edits.length,2);assert.equal(secondEdit.body.record.edits.filter(edit=>edit.is_current).length,1);
  assert.equal(database.prepare("SELECT derivative_media_id FROM archive_blackboard_fragments WHERE id='library-fragment-one'").get().derivative_media_id,"fragment-output-two");
  const library=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments",{admin:true}),runtime)),detail=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one",{admin:true}),runtime));
  assert.equal(library.status,200);assert.ok(library.body.fragments.some(fragment=>fragment.id==="library-fragment-one"));assert.equal(detail.body.record.current_edit.id,"fragment-edit-two");assert.deepEqual(detail.body.record.current_edit.recipe,recipeTwo);
  const idempotent=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/edits",{method:"POST",admin:true,body:{id:"fragment-edit-two",source_media_id:"fragment-source",output_media_id:"fragment-output-one",recipe:{version:2}}}),runtime));
  assert.equal(idempotent.status,200);assert.equal(idempotent.body.idempotent,true);assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_edits WHERE fragment_id='library-fragment-one'").get().count,2);

  const published=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one",{method:"PATCH",admin:true,body:{state:"published",public_visible:true}}),runtime));
  assert.equal(published.status,200,published.body.error);assert.equal(published.body.record.public_visible,1);assert.equal(published.body.record.record_entity_id,null);
  const beforeAssignment=await json(await handleConstructApi(request("/api/archive/blackboards/fragment-board-one"),runtime));assert.equal(beforeAssignment.body.fragments.length,0);

  const assigned=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/board",{method:"PUT",admin:true,body:{record_entity_id:boardOne.id}}),runtime));
  assert.equal(assigned.status,200,assigned.body.error);assert.equal(assigned.body.record.record_entity_id,boardOne.id);
  const foreignState=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/mappings",{method:"PUT",admin:true,body:{mappings:[{state_id:boardTwo.states[0].id,x_pct:1,y_pct:2,width_pct:10,height_pct:12}]}}),runtime));
  assert.equal(foreignState.status,409);assert.match(foreignState.body.error,/selected Blackboard/);assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_states WHERE fragment_id='library-fragment-one'").get().count,0);
  insertAsset(database,"fragment-hotspot","image/png");const hotspotRecipe={version:1,coordinate_space:"placement-bounds",strokes:[{mode:"restore",x:0.5,y:0.5,radius:0.25,softness:0.8,opacity:1}]};
  const mapped=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/mappings",{method:"PUT",admin:true,body:{mappings:[{state_id:stateId,x_pct:12.5,y_pct:18,width_pct:32,height_pct:41,hotspot_mask_media_id:"fragment-hotspot",hotspot_recipe:hotspotRecipe},{state_id:draftStateId,x_pct:4,y_pct:6,width_pct:12,height_pct:14}]}}),runtime));
  assert.equal(mapped.status,200,mapped.body.error);assert.equal(mapped.body.record.mapping_status,"placed");assert.equal(mapped.body.mappings.length,2);assert.deepEqual(mapped.body.mappings[0].bounds,{x_pct:12.5,y_pct:18,width_pct:32,height_pct:41});assert.deepEqual(mapped.body.mappings[0].hotspot_recipe,hotspotRecipe);
  assert.deepEqual({...database.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id='fragment-hotspot'").get()},{privacy:"public",public_presentation:"inline"});

  const publicDetail=await json(await handleConstructApi(request("/api/archive/blackboards/fragment-board-one"),runtime));assert.equal(publicDetail.status,200,publicDetail.body.error);assert.equal(publicDetail.body.fragments.length,1);
  const publicFragment=publicDetail.body.fragments[0],publicPlacement=publicFragment.placements[0],serialized=JSON.stringify(publicDetail.body);
  assert.equal(publicFragment.image.id,"fragment-output-two");assert.deepEqual(publicFragment.state_ids,[stateId]);assert.equal(publicFragment.placements.length,1);assert.deepEqual(publicPlacement.bounds,{x_pct:12.5,y_pct:18,width_pct:32,height_pct:41});assert.equal(publicPlacement.mask_url,"https://assets.example.test/fragment-hotspot");
  assert.equal(/recipe/i.test(serialized),false);assert.equal(serialized.includes("fragment-source"),false);assert.equal(serialized.includes("fragment-alpha"),false);assert.equal((await handleConstructApi(request("/api/construct/media/fragment-source"),runtime)).status,404);

  const blocked=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/board",{method:"PUT",admin:true,body:{record_entity_id:boardTwo.id}}),runtime));
  assert.equal(blocked.status,409);assert.equal(blocked.body.mapping_count,2);assert.equal(blocked.body.confirm_required,true);assert.equal(blocked.body.details.mapping_count,2);assert.equal(database.prepare("SELECT record_entity_id FROM archive_blackboard_fragments WHERE id='library-fragment-one'").get().record_entity_id,boardOne.id);
  const reassigned=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/library-fragment-one/board",{method:"PUT",admin:true,body:{record_entity_id:boardTwo.id,confirm_reset_mappings:true}}),runtime));
  assert.equal(reassigned.status,200,reassigned.body.error);assert.equal(reassigned.body.cleared_state_mappings,true);assert.equal(reassigned.body.record.record_entity_id,boardTwo.id);assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_states WHERE fragment_id='library-fragment-one'").get().count,0);assert.equal(database.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_placements WHERE fragment_id='library-fragment-one'").get().count,0);
});

test("global fragment validation enforces global slugs, private edit roles, image formats, recipe size, and nested compatibility",async()=>{
  const database=migratedDatabase(),runtime=env(database),board=await createBoard(runtime,{id:"fragment-compat-board",title:"Fragment compatibility board",slug:"fragment-compat-board"});
  insertAsset(database,"validation-master","image/tiff");insertAsset(database,"validation-source","image/webp");
  const created=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments",{method:"POST",admin:true,body:{id:"validation-fragment",slug:"one-global-slug",title:"Validation fragment",master_media_id:"validation-master",edit_source_media_id:"validation-source"}}),runtime));assert.equal(created.status,201,created.body.error);
  insertAsset(database,"duplicate-master","image/tiff");insertAsset(database,"duplicate-source","image/jpeg");
  const duplicate=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments",{method:"POST",admin:true,body:{id:"duplicate-fragment",slug:"one-global-slug",title:"Duplicate fragment",master_media_id:"duplicate-master",edit_source_media_id:"duplicate-source"}}),runtime));assert.equal(duplicate.status,409);assert.match(duplicate.body.error,/slug is already in use/i);

  insertAsset(database,"validation-output","image/png");
  const roleCollision=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/validation-fragment/edits",{method:"POST",admin:true,body:{source_media_id:"validation-source",alpha_mask_media_id:"validation-output",output_media_id:"validation-output",recipe:{version:1}}}),runtime));assert.equal(roleCollision.status,409);assert.match(roleCollision.body.error,/distinct Digital Assets/);
  insertAsset(database,"validation-output-jpeg","image/jpeg");
  const badOutput=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/validation-fragment/edits",{method:"POST",admin:true,body:{source_media_id:"validation-source",output_media_id:"validation-output-jpeg",recipe:{version:1}}}),runtime));assert.equal(badOutput.status,409);assert.match(badOutput.body.error,/unsupported image format/);
  const oversizedRecipe={payload:"é".repeat(131070)};
  const oversized=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments/validation-fragment/edits",{method:"POST",admin:true,body:{source_media_id:"validation-source",output_media_id:"validation-output",recipe:oversizedRecipe}}),runtime));assert.equal(oversized.status,409);assert.match(oversized.body.error,/256 KiB/);

  const legacyPair=insertScanPair(database,"compat-fragment");
  const compatible=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${board.id}/fragments`,{method:"POST",admin:true,body:{id:"compat-fragment",slug:"compat-fragment",title:"Compatibility fragment",...legacyPair}}),runtime));
  assert.equal(compatible.status,201,compatible.body.error);assert.equal(compatible.body.record.record_entity_id,board.id);
  const nested=await json(await handleConstructApi(request(`/api/admin/archive-blackboards/records/${board.id}/fragments`,{admin:true}),runtime));assert.ok(nested.body.records.some(fragment=>fragment.id==="compat-fragment"));
});

test("admin media cleanup deletes D1 before R2 while protecting referenced, public, and inline assets",async()=>{
  const database=migratedDatabase(),keys=["cleanup/unused.webp","cleanup/archived.png","cleanup/referenced.tif","cleanup/public.png","cleanup/inline.png","cleanup/no-binding.png"],bucket=new DeletionBucket(database,keys),runtime={...env(database),SUBMISSION_FILES:bucket};
  insertAsset(database,"cleanup-unused","image/webp",{storageKey:keys[0]});
  const unused=await json(await handleConstructApi(request("/api/admin/media/cleanup-unused",{method:"DELETE",admin:true}),runtime));
  assert.equal(unused.status,200,unused.body.error);assert.equal(unused.body.deleted_id,"cleanup-unused");assert.equal(unused.body.storage_deleted,true);assert.equal(database.prepare("SELECT id FROM media_assets WHERE id='cleanup-unused'").get(),undefined);assert.equal(bucket.objects.has(keys[0]),false);assert.deepEqual(bucket.deleted,[keys[0]]);

  insertAsset(database,"cleanup-archived","image/png",{privacy:"private",storageKey:keys[1]});database.prepare("UPDATE media_assets SET state='archived' WHERE id='cleanup-archived'").run();
  const archived=await json(await handleConstructApi(request("/api/admin/media/cleanup-archived",{method:"DELETE",admin:true}),runtime));assert.equal(archived.status,200,archived.body.error);assert.equal(database.prepare("SELECT id FROM media_assets WHERE id='cleanup-archived'").get(),undefined);assert.equal(bucket.objects.has(keys[1]),false);

  insertAsset(database,"cleanup-referenced","image/tiff",{storageKey:keys[2]});insertAsset(database,"cleanup-reference-source","image/jpeg");
  const fragment=await json(await handleConstructApi(request("/api/admin/archive-blackboards/fragments",{method:"POST",admin:true,body:{id:"cleanup-reference-fragment",slug:"cleanup-reference-fragment",title:"Cleanup reference fragment",master_media_id:"cleanup-referenced",edit_source_media_id:"cleanup-reference-source"}}),runtime));assert.equal(fragment.status,201,fragment.body.error);
  const beforeProtectedDeletes=bucket.deleted.length,referenced=await json(await handleConstructApi(request("/api/admin/media/cleanup-referenced",{method:"DELETE",admin:true}),runtime));
  assert.equal(referenced.status,409);assert.match(referenced.body.error,/still referenced/);assert.equal(database.prepare("SELECT id FROM media_assets WHERE id='cleanup-referenced'").get().id,"cleanup-referenced");assert.equal(bucket.objects.has(keys[2]),true);assert.equal(bucket.deleted.length,beforeProtectedDeletes);

  insertAsset(database,"cleanup-public","image/png",{privacy:"public",presentation:"inline",storageKey:keys[3]});insertAsset(database,"cleanup-inline","image/png",{privacy:"internal",presentation:"inline",storageKey:keys[4]});
  for(const id of ["cleanup-public","cleanup-inline"]){const protectedResponse=await json(await handleConstructApi(request(`/api/admin/media/${id}`,{method:"DELETE",admin:true}),runtime));assert.equal(protectedResponse.status,409);assert.equal(database.prepare("SELECT id FROM media_assets WHERE id=?").get(id).id,id)}
  assert.equal(bucket.objects.has(keys[3]),true);assert.equal(bucket.objects.has(keys[4]),true);assert.equal(bucket.deleted.length,beforeProtectedDeletes);

  insertAsset(database,"cleanup-no-binding","image/png",{storageKey:keys[5]});const unavailable=await json(await handleConstructApi(request("/api/admin/media/cleanup-no-binding",{method:"DELETE",admin:true}),env(database)));
  assert.equal(unavailable.status,503);assert.equal(database.prepare("SELECT id FROM media_assets WHERE id='cleanup-no-binding'").get().id,"cleanup-no-binding");assert.equal(bucket.objects.has(keys[5]),true);
});
