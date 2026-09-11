import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createWritingRuntime} from "../tools/writing-local-runtime.mjs";
import {handleConstructApi} from "../functions/api/construct/_lib.js";
import {normalizeWritingSnapshot,renderWritingBody,renderWritingDates,renderWritingEntry,writingDate,writingHref,WRITING_ROOT} from "../shared/writing-content.js";
import {normalizeWritingPathways} from "../shared/writing-navigation.js";
import {writingPageSlug,renderWritingPageTemplate} from "../functions/api/_shared/writing-pages.js";

const snapshot = (title="An open question") => ({schemaVersion:1,title,author:"Saiel Dauhn Solehman",excerpt:"A thought in progress.",body:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"A publicly readable observation about form and memory."}]}]},sources:[{label:"The Archive",url:"/archive/"}],relatedIds:[]});
test("pasted links infer HTTPS and email destinations without requiring protocol syntax",()=>{
  const article="openai.com/index/hugging-face-incident-and-the-road-ahead/";
  for(const [input,expected] of [
    [article,`https://${article}`],
    [`  ${article}\n`,`https://${article}`],
    ["www.example.com/a?b=c#source","https://www.example.com/a?b=c#source"],
    ["//example.com/source","https://example.com/source"],
    ["example.com:8080/source","https://example.com:8080/source"],
    ["example.com/a document.pdf","https://example.com/a%20document.pdf"],
    ["reader@example.com","mailto:reader@example.com"],
    ["mailto:reader@example.com?subject=Hello","mailto:reader@example.com?subject=Hello"],
    ["https://example.com/source","https://example.com/source"],
    ["http://localhost:4193/writings/","http://localhost:4193/writings/"],
    ["/archive/","/archive/"],["#sources","#sources"],
  ]) assert.equal(writingHref(input),expected,input);
  for(const input of ["","not a link","javascript:alert(1)","javascript://example.com","data:text/html,hello","vbscript:msgbox(1)","file:///private/file","java\nscript:alert(1)","/\\example.com"]) assert.equal(writingHref(input),"",input);
});
function setup() {
  const runtime=createWritingRuntime();
  runtime.call=async(path,{admin=false,method="GET",body}={})=>{
    const response=await handleConstructApi(new Request(`https://example.test${path}`,{method,headers:{...(admin?{authorization:`Bearer ${runtime.env.SUBMISSIONS_ADMIN_TOKEN}`}:{ }),...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})}),runtime.env);
    const data=await response.json();return {status:response.status,headers:response.headers,...data};
  };
  runtime.create=async(value=snapshot(),slug="an-open-question",metadata={})=>{const result=await runtime.call("/api/admin/writing-entries",{admin:true,method:"POST",body:{snapshot:value,slug,...metadata}});assert.equal(result.status,201,result.error);return result.entry;};
  runtime.action=async(entry,action)=>runtime.call(`/api/admin/writing-entries/${entry.id}/${action}`,{admin:true,method:"POST",body:{version:entry.version}});
  return runtime;
}
test("creation, draft save, and publication dates retain their distinct lifecycle",async()=>{
  const r=setup(),startedAt="2026-01-10T18:04:00.000Z";
  try {
    let entry=await r.create(snapshot(),"dated-entry",{startedAt});
    assert.equal(entry.startedAt,startedAt);assert.equal(entry.draftSavedAt,entry.firstSavedAt);
    const firstSavedAt=entry.firstSavedAt,firstDraftSavedAt=entry.draftSavedAt;
    entry=(await r.action(entry,"publish")).entry;
    const firstPublishedAt=entry.firstPublishedAt;
    assert.equal(entry.draftSavedAt,firstDraftSavedAt);
    const originalPublic=(await r.call(`/api/writings/entries/${entry.slug}`)).entry;
    assert.equal(originalPublic.startedAt,startedAt);assert.ok(!("draftSavedAt" in originalPublic));
    const saved=await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:snapshot("Private revision"),slug:entry.slug,version:entry.version,startedAt:"2020-01-01T00:00:00Z"}});
    assert.equal(saved.status,200,saved.error);entry=saved.entry;
    assert.equal(entry.startedAt,startedAt);assert.equal(entry.firstSavedAt,firstSavedAt);
    assert.ok(entry.draftSavedAt>firstDraftSavedAt);assert.equal(entry.firstPublishedAt,firstPublishedAt);
    assert.deepEqual((await r.call(`/api/writings/entries/${entry.slug}`)).entry,originalPublic);
    const lastSaved=entry.draftSavedAt;
    const failed=await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true,method:"PATCH",body:{snapshot:snapshot("Must not save"),version:0}});
    assert.equal(failed.status,409);assert.equal((await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true})).entry.draftSavedAt,lastSaved);
    entry=(await r.action(entry,"publish")).entry;
    assert.equal(entry.firstPublishedAt,firstPublishedAt);assert.ok(entry.publishedUpdatedAt>firstPublishedAt);assert.equal(entry.draftSavedAt,lastSaved);
    for(const action of ["unpublish","archive","restore","publish"]){entry=(await r.action(entry,action)).entry;assert.equal(entry.startedAt,startedAt);assert.equal(entry.firstSavedAt,firstSavedAt);assert.equal(entry.firstPublishedAt,firstPublishedAt);assert.equal(entry.draftSavedAt,lastSaved);}
    assert.throws(()=>r.database.prepare("UPDATE writing_entries SET started_at=?,version=version+1 WHERE entity_id=?").run("2000-01-01T00:00:00Z",entry.id),/cannot change/);
    const fallback=await r.create(snapshot(),"older-client",{startedAt:"invalid"});assert.equal(fallback.startedAt,null);assert.ok(fallback.firstSavedAt);
    const skewed=await r.create(snapshot(),"future-clock",{startedAt:"2999-01-01T00:00:00Z"});assert.equal(skewed.startedAt,skewed.firstSavedAt);
  } finally {r.database.close();}
});
test("date migration preserves earlier publication and recovers draft saves from revisions",()=>{
  const r=createWritingRuntime({throughMigration:"0227_mindful_darkness_writing_entries.sql"});
  try {
    const document=JSON.stringify(snapshot()),published="2026-01-12T15:00:00.000Z";
    r.database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES('date-legacy','writing_work','node-writings','public',1,'test','test',?,?)").run(published,published);
    r.database.prepare("INSERT INTO writing_entries(entity_id,slug,draft_json,published_json,state,first_published_at,published_updated_at,created_at,updated_at) VALUES('date-legacy','date-legacy',?,?,'published',?,?,?,?)").run(document,document,published,published,"2026-01-10T18:04:00.000Z",published);
    const before=r.database.prepare("SELECT * FROM writing_entries WHERE entity_id='date-legacy'").get();
    const lastSave="2026-01-11T15:30:00.000Z";
    r.database.prepare("INSERT INTO entity_revisions(id,entity_id,revision_number,action,after_json,created_by,created_at) VALUES('date-test','date-legacy',1,'writing-save-draft','{}','test',?)").run(lastSave);
    r.database.exec(readFileSync(new URL("../migrations/0228_writing_entry_dates.sql",import.meta.url),"utf8"));
    const after=r.database.prepare("SELECT * FROM writing_entries WHERE entity_id='date-legacy'").get();
    assert.equal(after.started_at,null);assert.equal(after.created_at,before.created_at);assert.equal(after.draft_saved_at,lastSave);
    assert.equal(after.draft_json,before.draft_json);assert.equal(after.published_json,before.published_json);assert.equal(after.first_published_at,before.first_published_at);assert.equal(after.updated_at,before.updated_at);
  } finally {r.database.close();}
});
test("publication stays visible while the info control contains other dates and Eastern times",()=>{
  const record={snapshot:snapshot(),startedAt:"2026-01-10T18:04:00Z",firstPublishedAt:"2026-07-01T15:30:00Z",publishedUpdatedAt:"2026-07-02T16:00:00Z",draftSavedAt:"2026-07-03T17:00:00Z"};
  const html=renderWritingDates(record),visible=html.split("<details")[0];
  assert.match(visible,/Published <time[^>]+>July 1, 2026/);assert.doesNotMatch(visible,/Created|updated/);
  assert.match(html,/<details class="writing-date-info" data-writing-dates>/);assert.match(html,/aria-label="Creation and publication dates"/);
  assert.match(html,/1:04 PM EST/);assert.match(html,/11:30 AM EDT/);assert.match(html,/Publication updated/);assert.doesNotMatch(html,/Last draft saved/);
  assert.match(renderWritingEntry(record,{preview:true}),/Last draft saved/);assert.doesNotMatch(renderWritingEntry(record),/Last draft saved/);
  assert.equal(writingDate("2026-01-10 18:04:00",{includeTime:true}),writingDate(record.startedAt,{includeTime:true}));
  assert.match(renderWritingDates({firstSavedAt:record.startedAt}),/Unpublished draft/);assert.match(renderWritingDates({firstSavedAt:record.startedAt}),/First saved/);
});
test("bare inline and source addresses survive draft save, reload, publication, and rendering",async()=>{
  const r=setup();
  try {
    const article="openai.com/index/hugging-face-incident-and-the-road-ahead/",value=snapshot();
    value.body.content[0].content[0].marks=[{type:"link",attrs:{href:article}}];
    value.sources=[{label:"Source",url:article}];
    const entry=await r.create(value,"pasted-source-link");
    const saved=(await r.call(`/api/admin/writing-entries/${entry.id}`,{admin:true})).entry;
    assert.equal(saved.snapshot.sources[0].url,`https://${article}`);
    assert.equal(saved.snapshot.body.content[0].content[0].marks[0].attrs.href,`https://${article}`);
    assert.equal((await r.action(saved,"publish")).status,200);
    const published=(await r.call(`/api/writings/entries/${entry.slug}`)).entry;
    assert.deepEqual(published.snapshot,saved.snapshot);
    assert.ok(renderWritingBody(published.snapshot).includes(`href="https://${article}"`));
  } finally { r.database.close(); }
});
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
