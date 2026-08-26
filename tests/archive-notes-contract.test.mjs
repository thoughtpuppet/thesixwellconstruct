import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { dirname,join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),TOKEN="archive-note-test";
class Statement{constructor(database,sql,values=[]){this.database=database;this.sql=sql;this.values=values}bind(...values){return new Statement(this.database,this.sql,values)}async first(){return this.database.prepare(this.sql).get(...this.values)||null}async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}async run(){const statement=this.database.prepare(this.sql);if(statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT"))return{results:statement.all(...this.values)};const result=statement.run(...this.values);return{success:true,meta:{changes:Number(result.changes||0)}}}}
class LocalD1{constructor(database){this.database=database}prepare(sql){return new Statement(this.database,sql)}async batch(statements){this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}}}
function database(){const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");for(const name of readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort())db.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));return db}
function env(db){return{SUBMISSIONS_DB:new LocalD1(db),SUBMISSIONS_ADMIN_TOKEN:TOKEN}}
function request(path,{method="GET",body,admin=false}={}){return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:`Bearer ${TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function json(response){return{status:response.status,body:await response.json()}}
function insertMedia(db,{id,mime="image/png",privacy="public",presentation="inline",alt="",caption=""}){db.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,alt_text,caption,privacy,consent_status,state,created_by,created_at,updated_at,public_presentation) VALUES(?,?,?,?,1,?,?,?,'not-required','active','test',datetime('now'),datetime('now'),?)`).run(id,`/assets/${id}`,`${id}.${mime==="application/pdf"?"pdf":"png"}`,mime,alt,caption,privacy,presentation)}

test("Lost Marbles Note is one public identity across Notes, Notebook, Origin Thread, and search",async()=>{
  const db=database(),runtime=env(db);
  const body=`{{asset:original-sketch}}\n\nWanting to lose certain marbles purposely wanting some screws loose. Having some embedded in the body , based off the book the body keeps score with trauma, so I can replace, put the marbles back when healing/when I need to heal.\n\nSome of them I hid in the subconscious pit\n\nAdd a drain instead of a pit and add some water around it being drained\n\n{{asset:process-experiment}}`;
  const created=await json(await handleConstructApi(request("/api/admin/archive-notes",{method:"POST",admin:true,body:{title:"Lost Marbles Inception Note",slug:"lost-marbles-inception-note",note_type:"concept-note",source_app:"Apple Notes",body_markdown:body,excerpt:"The original sketch and written inception of Lost Marbles.",source_created_at:"2022-12-23T19:54:00-05:00",source_modified_at:"2023-11-26",date_label:"Created December 23, 2022 at 7:54 PM · Last edited November 26, 2023",provenance_note:"Archived as Markdown and reconstructed here to preserve the sequence, rhythm, and appearance of the original Apple Notes entry as it appeared on my iPhone.",state:"draft",public_visible:false,links:[{target_entity_id:"art-marbles",relationship_role:"inception",is_primary:true,public_visible:true}],origin_thread_ids:["origin-thread-lost-marbles"],primary_origin_thread_id:"origin-thread-lost-marbles"}}),runtime));
  assert.equal(created.status,201,created.body.error);const noteId=created.body.note.id;
  insertMedia(db,{id:"note-sketch",alt:"Original handwritten sketch",caption:"Original handwritten sketch from the Lost Marbles inception note."});
  insertMedia(db,{id:"note-process",alt:"Process experiment drawn over a photograph",caption:"Process experiment"});
  insertMedia(db,{id:"note-source-pdf",mime:"application/pdf",privacy:"internal",presentation:"hidden",alt:"Apple Notes source PDF"});
  const assets=[
    {media_id:"note-sketch",asset_token:"original-sketch",role:"inline-image",sort_order:1,alt_text:"Original handwritten sketch",caption:"Original handwritten sketch from the Lost Marbles inception note.",public_visible:true},
    {media_id:"note-process",asset_token:"process-experiment",role:"inline-image",sort_order:2,alt_text:"A process experiment drawn over a photograph of the painting",caption:"Process experiment added to this note later. I drew over a photograph of the painting to test an idea. I did not use it for this painting, but kept it as a possible reference for another work.",public_visible:true},
    {media_id:"note-source-pdf",asset_token:"apple-notes-source",role:"source-provenance",sort_order:3,alt_text:"Apple Notes source PDF",caption:"Private source provenance",public_visible:false},
  ];
  for(const asset of assets){const response=await handleConstructApi(request(`/api/admin/archive-notes/${noteId}/assets`,{method:"POST",admin:true,body:asset}),runtime);assert.equal(response.status,201,JSON.stringify(await response.json()))}
  const published=await json(await handleConstructApi(request(`/api/admin/archive-notes/${noteId}`,{method:"PATCH",admin:true,body:{state:"published",public_visible:true,links:[{target_entity_id:"art-marbles",relationship_role:"inception",is_primary:true,public_visible:true}],origin_thread_ids:["origin-thread-lost-marbles"],primary_origin_thread_id:"origin-thread-lost-marbles"}}),runtime));
  assert.equal(published.status,200,published.body.error);

  const index=await json(await handleConstructApi(request("/api/archive/notes"),runtime));assert.equal(index.status,200);assert.deepEqual(index.body.records.map(note=>note.slug),["lost-marbles-inception-note"]);
  const detail=await json(await handleConstructApi(request("/api/archive/notes/lost-marbles-inception-note"),runtime));assert.equal(detail.status,200);assert.equal(detail.body.note.source_created_at,"2022-12-23T19:54:00-05:00");assert.equal(detail.body.note.provenance_note,"Archived as Markdown and reconstructed here to preserve the sequence, rhythm, and appearance of the original Apple Notes entry as it appeared on my iPhone.");assert.equal(detail.body.assets.length,2);assert.deepEqual(detail.body.assets.map(asset=>asset.token),["original-sketch","process-experiment"]);assert.equal(JSON.stringify(detail.body).includes("note-source-pdf"),false);assert.match(detail.body.assets[1].caption,/possible reference for another work/);
  const dossier=await json(await handleConstructApi(request("/api/archive/items/lostmarbles"),runtime));assert.equal(dossier.status,200);assert.deepEqual(dossier.body.notes.map(note=>note.id),[noteId]);
  const origin=await json(await handleConstructApi(request("/api/archive/items?origin=lost-marbles&limit=100"),runtime));assert.equal(origin.status,200);assert.deepEqual(origin.body.notes.map(note=>note.id),[noteId]);
  const search=await json(await handleConstructApi(request("/api/search?q=subconscious%20pit"),runtime));assert.ok(search.body.records.some(record=>record.entity_id===noteId&&record.route==="/archive/notes/lost-marbles-inception-note/"));
  const searchDocument=db.prepare("SELECT * FROM search_documents WHERE entity_id=?").get(noteId);assert.equal(searchDocument.entity_type,"archive_note");assert.match(searchDocument.body,/possible reference for another work/);assert.match(searchDocument.body,/reconstructed here/);

  const guarded=await json(await handleConstructApi(request("/api/admin/media/note-process",{method:"PATCH",admin:true,body:{privacy:"internal"}}),runtime));assert.equal(guarded.status,409);assert.match(guarded.body.error,/Unpublish the Archive Note/);
});

test("public Notes reject unsafe Markdown and unresolved managed assets",async()=>{
  const db=database(),runtime=env(db);
  const unsafe=await json(await handleConstructApi(request("/api/admin/archive-notes",{method:"POST",admin:true,body:{title:"Unsafe",slug:"unsafe",body_markdown:'<script>alert(1)</script> ![x](https://example.test/x.jpg)',state:"published",public_visible:true}}),runtime));assert.equal(unsafe.status,400);assert.match(unsafe.body.error,/executable|external image/i);
  const missing=await json(await handleConstructApi(request("/api/admin/archive-notes",{method:"POST",admin:true,body:{title:"Missing",slug:"missing",body_markdown:"{{asset:not-there}}",state:"published",public_visible:true}}),runtime));assert.equal(missing.status,400);assert.match(missing.body.error,/missing asset token/i);
});

test("Archive Notes UI keeps the Apple date reminder, bounded reader, and clean export boundary",()=>{
  const studio=readFileSync(join(ROOT,"studio","archive-notes-manager.js"),"utf8"),styles=readFileSync(join(ROOT,"css","archive-notes.css"),"utf8"),page=readFileSync(join(ROOT,"archive","notes","index.html"),"utf8"),renderer=readFileSync(join(ROOT,"js","archive-note-markdown.js"),"utf8"),notesPage=readFileSync(join(ROOT,"js","archive-notes.js"),"utf8"),archivePublic=readFileSync(join(ROOT,"js","archive-public.js"),"utf8"),migration=readFileSync(join(ROOT,"migrations","0177_archive_notes.sql"),"utf8");
  assert.match(studio,/On a Mac using upgraded iCloud Notes, click the date at the top of the note to view its Created and Last Edited dates/);assert.match(studio,/support\.apple\.com\/guide\/notes\/view-your-notes/);assert.match(studio,/source-provenance/);assert.match(studio,/Export Obsidian ZIP/);assert.match(studio,/asset\.public_visible&&asset\.role!=="source-provenance"/);
  assert.match(styles,/max-height:min\(72dvh,900px\)/);assert.match(styles,/overflow-y:auto/);assert.match(styles,/border:5px/);assert.match(styles,/archive-note-provenance/);assert.match(styles,/color:var\(--color-text-dim\)/);assert.match(styles,/archive-note-image-dialog/);assert.match(renderer,/data-note-image-trigger/);assert.match(renderer,/bindImageLightboxes/);assert.match(notesPage,/bindImageLightboxes\(app\)/);assert.match(archivePublic,/bindImageLightboxes\(content\)/);assert.match(page,/data-archive-view="notes"/);assert.match(page,/archive-note-markdown\.js/);assert.match(migration,/archive_note_assets/);assert.match(migration,/archive_note_links/);
});
