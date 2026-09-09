import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createWritingRuntime} from "../tools/writing-local-runtime.mjs";
import {handleConstructApi} from "../functions/api/construct/_lib.js";
import {normalizeWritingSnapshot,renderWritingBody,WRITING_ROOT} from "../shared/writing-content.js";
import {normalizeWritingPathways} from "../shared/writing-navigation.js";
import {writingPageSlug,renderWritingPageTemplate} from "../functions/api/_shared/writing-pages.js";

const snapshot = (title="An open question") => ({schemaVersion:1,title,author:"Saiel Dauhn Solehman",excerpt:"A thought in progress.",body:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"A publicly readable observation about form and memory."}]}]},sources:[{label:"The Archive",url:"/archive/"}],relatedIds:[]});
function setup() {
  const runtime=createWritingRuntime();
  runtime.call=async(path,{admin=false,method="GET",body}={})=>{
    const response=await handleConstructApi(new Request(`https://example.test${path}`,{method,headers:{...(admin?{authorization:`Bearer ${runtime.env.SUBMISSIONS_ADMIN_TOKEN}`}:{ }),...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})}),runtime.env);
    const data=await response.json();return {status:response.status,headers:response.headers,...data};
  };
  runtime.create=async(value=snapshot(),slug="an-open-question")=>{const result=await runtime.call("/api/admin/writing-entries",{admin:true,method:"POST",body:{snapshot:value,slug}});assert.equal(result.status,201,result.error);return result.entry;};
  runtime.action=async(entry,action)=>runtime.call(`/api/admin/writing-entries/${entry.id}/${action}`,{admin:true,method:"POST",body:{version:entry.version}});
  return runtime;
}
test("drafts, published snapshots, revisions, withdrawal, restore, and stable URLs",async()=>{
  const r=setup();let entry=await r.create();
  assert.equal((await r.call(`/api/writings/entries/${entry.slug}`)).status,404);
  assert.equal((await r.call("/api/writings/entries")).entries.length,0);
  assert.equal((await r.call(`/api/admin/writing-entries/${entry.id}/preview`)).status,401);
  const preview=await r.call(`/api/admin/writing-entries/${entry.id}/preview`,{admin:true});assert.equal(preview.status,200);assert.match(preview.headers.get("cache-control"),/no-store/);
  let published=await r.action(entry,"publish");assert.equal(published.status,200,published.error);entry=published.entry;
  const first=entry.firstPublishedAt;assert.ok(first);
  assert.ok((await r.call("/api/search?q=open%20question&include=pages")).records.some(record=>record.entity_id===entry.id));
  const next=snapshot("A private reconsideration");next.body.content[0].content[0].text="UNPUBLISHED-SECRET-PHRASE";
  const saved=await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:next,slug:entry.slug,version:entry.version}});assert.equal(saved.status,200,saved.error);entry=saved.entry;
  const publicEntry=await r.call(`/api/writings/entries/${entry.slug}`);assert.equal(publicEntry.entry.snapshot.title,"An open question");assert.doesNotMatch(JSON.stringify(publicEntry),/UNPUBLISHED-SECRET|private reconsideration/);
  const search=r.database.prepare("SELECT * FROM search_documents WHERE entity_id=?").get(entry.id);assert.equal(search.title,"An open question");assert.doesNotMatch(search.body,/UNPUBLISHED/);
  assert.ok(!(await r.call("/api/search?q=UNPUBLISHED-SECRET-PHRASE&include=pages")).records.some(record=>record.entity_id===entry.id));
  assert.equal((await r.call("/api/admin/entities",{admin:true})).records.find(item=>item.id===entry.id).title,"An open question");
  const badSlug=await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:next,slug:"new-address",version:entry.version}});assert.equal(badSlug.status,409);
  published=await r.action(entry,"publish");assert.equal(published.status,200,published.error);entry=published.entry;assert.equal(entry.firstPublishedAt,first);assert.ok(entry.publishedUpdatedAt>=first);assert.equal((await r.call(`/api/writings/entries/${entry.slug}`)).entry.snapshot.title,next.title);
  assert.match(r.database.prepare("SELECT body FROM search_documents WHERE entity_id=?").get(entry.id).body,/UNPUBLISHED-SECRET/);
  const withdrawn=await r.action(entry,"unpublish");assert.equal(withdrawn.status,200,withdrawn.error);entry=withdrawn.entry;
  assert.equal((await r.call(`/api/writings/entries/${entry.slug}`)).status,404);assert.equal(r.database.prepare("SELECT COUNT(*) n FROM search_documents WHERE entity_id=?").get(entry.id).n,0);
  entry=(await r.action(entry,"archive")).entry;assert.equal(entry.state,"archived");assert.equal((await r.action(entry,"publish")).status,400);
  entry=(await r.action(entry,"restore")).entry;assert.equal(entry.state,"draft");assert.equal((await r.action(entry,"publish")).status,200);
  assert.ok(r.database.prepare("SELECT COUNT(*) n FROM entity_revisions WHERE entity_id=?").get(entry.id).n>=8);
  r.database.close();
});
test("sample entry and sample image are authenticated and cannot be published",async()=>{
  const r=setup(),sample=(await r.call("/api/admin/writing-entries/writing-layout-sample",{admin:true})).entry;
  assert.equal(sample.isSample,true);assert.equal(sample.media[0].url,"/api/admin/writing-entries/sample-image");
  assert.equal((await r.call("/api/admin/writing-entries/sample-image")).status,401);
  assert.equal((await r.call("/api/writings/entries/reading-layout-sample")).status,404);
  assert.equal((await r.action(sample,"publish")).status,400);
  assert.equal((await r.call("/api/construct/entity-media/writing-layout-sample-image")).status,404);
  assert.equal(r.database.prepare("SELECT COUNT(*) n FROM search_documents WHERE entity_id='writing-layout-sample'").get().n,0);r.database.close();
});
test("publishing images is atomic, draft additions remain private, and published dependencies are guarded",async()=>{
  const r=setup();
  for(const mediaId of ["writing-test-image","writing-private-image"])r.database.prepare("INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,public_presentation,archive_catalogue_eligible,created_by,created_at,updated_at) VALUES(?,?,'test.png','image/png',4,'internal','active','hidden',0,'test',datetime('now'),datetime('now'))").run(mediaId,`writing/${mediaId}`);
  const value=snapshot();value.relatedIds=["art-marbles"];value.body.content.push({type:"writingImage",attrs:{mediaId:"writing-test-image",alt:"A test drawing",caption:"First caption"}});
  let entry=await r.create(value);const result=await r.action(entry,"publish");assert.equal(result.status,200,result.error);entry=result.entry;
  assert.equal(r.database.prepare("SELECT privacy FROM media_assets WHERE id='writing-test-image'").get().privacy,"public");
  const publicResult=await r.call(`/api/writings/entries/${entry.slug}`);assert.equal(publicResult.entry.media.length,1);assert.equal(publicResult.entry.related[0].id,"art-marbles");
  const update=structuredClone(value);update.body.content[1].attrs.caption="Private caption edit";update.body.content.push({type:"writingImage",attrs:{mediaId:"writing-private-image",alt:"",caption:"Unpublished second image"}});
  entry=(await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:update,slug:entry.slug,version:entry.version}})).entry;
  const failed=await r.action(entry,"publish");assert.equal(failed.status,400);assert.match(failed.error,/alt text/);
  const stillPublic=await r.call(`/api/writings/entries/${entry.slug}`);assert.equal(stillPublic.entry.snapshot.body.content[1].attrs.caption,"First caption");assert.equal(stillPublic.entry.media.length,1);
  assert.equal(r.database.prepare("SELECT privacy FROM media_assets WHERE id='writing-private-image'").get().privacy,"internal");
  const guard=await r.call("/api/admin/media/writing-test-image",{admin:true,method:"PATCH",body:{privacy:"internal"}});assert.equal(guard.status,409,guard.error);
  assert.throws(()=>r.database.prepare("DELETE FROM entity_media WHERE entity_id=? AND role='writing-inline'").run(entry.id),/WRKNG/);
  entry=(await r.action(entry,"unpublish")).entry;assert.equal((await r.call("/api/admin/media/writing-test-image",{admin:true,method:"PATCH",body:{privacy:"internal"}})).status,200);
  assert.equal((await r.call(`/api/connections/${entry.id}`)).status,404);r.database.close();
});
test("duplicate slugs, stale saves, private relationships, malformed documents, and unsafe links are rejected",async()=>{
  const r=setup(),entry=await r.create();
  const duplicate=await r.call("/api/admin/writing-entries",{admin:true,method:"POST",body:{snapshot:snapshot(),slug:entry.slug}});assert.equal(duplicate.status,409);assert.match(duplicate.error,/already used/);
  const stale=await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:snapshot("Changed"),slug:entry.slug,version:0}});assert.equal(stale.status,409);
  const invalid=snapshot();invalid.sources=[{label:"Bad",url:"javascript:alert(1)"}];assert.throws(()=>normalizeWritingSnapshot(invalid),/valid link/);
  invalid.sources=[];invalid.body.content=[{type:"iframe",attrs:{src:"https://example.com"}}];assert.throws(()=>normalizeWritingSnapshot(invalid),/unsupported block/);
  const privateRelated=snapshot();privateRelated.relatedIds=["writing-layout-sample"];const privateEntry=await r.create(privateRelated,"private-related");assert.equal((await r.action(privateEntry,"publish")).status,400);
  const safe=snapshot();safe.body.content[0].content[0].text='<script>alert("x")</script>';assert.doesNotMatch(renderWritingBody(normalizeWritingSnapshot(safe)),/<script>/);r.database.close();
});
test("navigation migration, cached navigation, and current works agree",async()=>{
  const r=setup(),nav=await r.call("/api/site/navigation");const paths=nav.nodes.find(node=>node.slug==="writings").pathways;
  assert.deepEqual(paths.map(path=>path.name),["Mindful Darkness","WRKNG*","THE SOLEHMAN LETTERS"]);assert.equal(paths[1].route,WRITING_ROOT);
  const old=[{name:"Mindful Darkness",route:"/writings/#reading-paths"},{name:"THE SOLEHMAN LETTERS",route:"https://thesolehmanletters.com"},{name:"essays & notes",route:"/writings/#featured"}];
  assert.deepEqual(normalizeWritingPathways(old).map(path=>path.route),paths.map(path=>path.route));
  assert.deepEqual(normalizeWritingPathways(paths),paths);
  assert.doesNotMatch(r.database.prepare("SELECT links_json FROM about_current_projects WHERE id='current-project-solehman-letters'").get().links_json,/#reading-paths/);
  const page=readFileSync(new URL("../writings/index.html",import.meta.url),"utf8");assert.match(page,/id="reading-paths"/);assert.match(page,/id="featured"/);r.database.close();
});
test("reading routes and metadata use the same safe published document",()=>{
  assert.equal(writingPageSlug(WRITING_ROOT),null);assert.equal(writingPageSlug(`${WRITING_ROOT}detail/index.html`),"");assert.equal(writingPageSlug(`${WRITING_ROOT}an-open-question/`),"an-open-question");
  const entry={id:"entry",slug:"an-open-question",snapshot:normalizeWritingSnapshot(snapshot('Title <with> "characters"')),media:[],related:[],firstPublishedAt:"2026-09-09T02:00:00.000Z",publishedUpdatedAt:"2026-09-09T02:00:00.000Z"};
  const page=renderWritingPageTemplate(readFileSync(new URL("../writings/mindful-darkness/wrkng/detail/index.html",import.meta.url),"utf8"),entry,"https://example.test");
  assert.match(page,/Title &lt;with&gt; &quot;characters&quot;/);assert.match(page,/rel="canonical"/);assert.match(page,/A publicly readable observation/);assert.doesNotMatch(page,/<!--writing-entry-->/);
});

test("a failure inside the publication transaction rolls back every public change",async()=>{
  const r=setup();let entry=(await r.action(await r.create(),"publish")).entry;
  const original=r.database.prepare("SELECT * FROM writing_entries WHERE entity_id=?").get(entry.id);
  const next=snapshot("A revision that must stay private");
  entry=(await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:next,version:entry.version,slug:entry.slug}})).entry;
  r.database.exec("CREATE TRIGGER writing_test_failure BEFORE INSERT ON search_documents WHEN NEW.entity_type='writing_work' BEGIN SELECT RAISE(ABORT,'Test publication failure'); END;");
  const failed=await r.action(entry,"publish");assert.equal(failed.status,400);
  const retained=r.database.prepare("SELECT * FROM writing_entries WHERE entity_id=?").get(entry.id);
  assert.equal(retained.published_json,original.published_json);assert.equal(retained.version,entry.version);assert.equal(retained.published_updated_at,original.published_updated_at);
  assert.equal((await r.call(`/api/writings/entries/${entry.slug}`)).entry.snapshot.title,"An open question");
  assert.equal(r.database.prepare("SELECT title FROM search_documents WHERE entity_id=?").get(entry.id).title,"An open question");r.database.close();
});
