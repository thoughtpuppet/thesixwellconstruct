import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/archive-comments-fixture.mjs';
import {commentText,textAnchor} from '../shared/archive-comment-targets.js';
import {prepareLostMarbles,INTERVENING,ORIGINAL,COMMENT,IMAGE_COMMENTS} from '../tools/archive-lost-marbles-retrospective.mjs';
import {saveArchiveComment,correctArchiveSource} from '../functions/api/construct/_archive-comments.js';
const management='/api/admin/archive-comments';
async function target(f,owner,kind='note',id){const r=await f.call(`${management}?owner_entity_id=${owner}`);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.targets.find(t=>t.target_kind===kind&&(!id||t.target_id===id));}
function input(owner,t,anchor){return {owner_entity_id:owner,target_kind:t.target_kind,target_id:t.target_id,field_key:t.field_key,source_fingerprint:t.source_fingerprint,anchor:anchor||textAnchor(t.text,0,17),body:'Later thought about *this source*.',state:'published'};}
test('separate comment lifecycle, immutable audits, authentication, duplicate passages and preserved source dates',async()=>{
  const f=fixture(),payload=await f.note(),owner=payload.note.id,t=await target(f,owner),before={...f.sql.prepare('SELECT * FROM archive_notes WHERE entity_id=?').get(owner)};
  assert.equal((await f.call(management,'POST',input(owner,t),false)).status,401);
  const one=await f.call(management,'POST',input(owner,t));assert.equal(one.status,201,JSON.stringify(one.body));const c=one.body.record;
  const two=await f.call(management,'POST',input(owner,t,textAnchor(t.text,t.text.lastIndexOf('Repeated'),t.text.length)));assert.equal(two.status,201);
  const three=await f.call(management,'POST',input(owner,t));assert.equal(three.status,201);
  let publicResult=await f.call('/api/archive/notes/retrospective-fixture','GET',undefined,false);assert.equal(publicResult.body.retrospective_comments.length,3);assert.notEqual(publicResult.body.retrospective_comments[0].anchor.start,publicResult.body.retrospective_comments[1].anchor.start);
  const updated=await f.call(`${management}/${c.id}`,'PATCH',{expected_revision:1,body:'An edited retrospective thought.'});assert.equal(updated.status,200);assert.equal(updated.body.record.created_at,c.created_at);assert.ok(updated.body.record.edited_at);
  assert.equal((await f.call(`${management}/${c.id}`,'PATCH',{expected_revision:1,body:'stale'})).status,409);
  assert.equal((await f.call(`${management}/${c.id}`,'DELETE',{expected_revision:2})).status,200);
  const history=await f.call(`${management}/${c.id}`);assert.equal(history.body.revisions.length,3);
  assert.throws(()=>f.sql.prepare('UPDATE archive_comment_revisions SET actor=?').run('rewrite'),/append-only/);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM archive_notes WHERE entity_id=?').get(owner)},before);
  publicResult=await f.call('/api/archive/notes/retrospective-fixture','GET',undefined,false);assert.equal(publicResult.body.retrospective_comments.length,2);assert.doesNotMatch(JSON.stringify(publicResult.body),/source_fingerprint|before_json|after_json|prefix|source_preservation/);
});
test('explicit concurrent source corrections, date evidence, stale markers and reattachment',async()=>{
  const f=fixture(),p=await f.note(),owner=p.note.id,t=await target(f,owner),c=(await f.call(management,'POST',input(owner,t))).body.record;
  assert.equal((await f.call(`/api/admin/archive-notes/${owner}`,'PATCH',{body_markdown:'An ordinary edit'})).status,409);
  assert.throws(()=>f.sql.prepare('UPDATE archive_notes SET body_markdown=? WHERE entity_id=?').run('bypass',owner),/Correct source/);
  const correction={body_markdown:'Corrected source. Repeated passage.',reason:'Restore original wording',expected_revision:p.source_preservation.source_revision,expected_fingerprint:p.source_preservation.source_fingerprint};
  const corrected=await f.call(`/api/admin/archive-notes/${owner}/source-corrections`,'POST',correction);assert.equal(corrected.status,200,JSON.stringify(corrected.body));assert.equal(corrected.body.note.source_created_at,p.note.source_created_at);assert.equal(corrected.body.note.source_modified_at,p.note.source_modified_at);
  assert.equal((await f.call(`/api/admin/archive-notes/${owner}/source-corrections`,'POST',correction)).status,409);
  assert.equal((await f.call('/api/archive/notes/retrospective-fixture','GET',undefined,false)).body.retrospective_comments.length,0);
  assert.equal((await f.call(`${management}/${c.id}`)).body.record.is_stale,true);
  const current=await target(f,owner);assert.equal((await f.call(`${management}/${c.id}`,'PATCH',{...input(owner,current,textAnchor(current.text,0,17)),expected_revision:1,reattach:true})).status,200);
  assert.equal((await f.call('/api/archive/notes/retrospective-fixture','GET',undefined,false)).body.retrospective_comments.length,1);
  assert.equal((await f.call(`/api/admin/archive-notes/${owner}/source-corrections`,'POST',{...correction,body_markdown:corrected.body.note.body_markdown,source_created_at:'2020-01-01',expected_revision:1,expected_fingerprint:corrected.body.source_preservation.source_fingerprint})).status,400);
  await f.call(`/api/admin/archive-notes/${owner}`,'DELETE');assert.equal((await f.call(`/api/admin/archive-notes/${owner}`,'PATCH',{state:'draft',body_markdown:'Bypass prior publication'})).status,409);
});
test('managed image, audio/video times, private media, owner gates and same-asset reuse',async()=>{
  const f=fixture(),p=await f.note(),owner=p.note.id;
  for(const [id,mime] of [['image','image/png'],['video','video/mp4'],['audio','audio/wav']]){f.media(owner,id,mime);const t=await target(f,owner,'media',id);assert.ok(t);assert.equal((await f.call(management,'POST',input(owner,t,{}))).status,201);if(id!=='image'){assert.equal((await f.call(management,'POST',input(owner,t,{start_seconds:10,end_seconds:20}))).status,201);for(const anchor of [{start_seconds:-1},{start_seconds:70},{start_seconds:10,end_seconds:5},{end_seconds:20},{start_seconds:'10'}])assert.equal((await f.call(management,'POST',input(owner,t,anchor))).status,400);}}
  const image=await target(f,owner,'media','image');assert.equal((await f.call(management,'POST',input(owner,image,{start_seconds:1}))).status,400);
  f.media(owner,'unknown-duration','audio/wav');f.sql.prepare("UPDATE media_assets SET duration_seconds=NULL WHERE id='unknown-duration'").run();const unknown=await target(f,owner,'media','unknown-duration');
  assert.equal((await f.call(management,'POST',input(owner,unknown,{start_seconds:3}))).status,400);
  assert.equal((await f.call(management,'POST',{...input(owner,unknown,{start_seconds:3,end_seconds:5}),observed_duration_seconds:4})).status,400);
  assert.equal((await f.call(management,'POST',{...input(owner,unknown,{start_seconds:3}),observed_duration_seconds:4})).status,201);
  f.media(owner,'private','image/png',{privacy:'private'});f.media(owner,'provenance','image/png',{role:'source-provenance'});
  const privateTarget=await target(f,owner,'media','private');assert.equal((await f.call(management,'POST',input(owner,privateTarget,{}))).status,409);assert.equal(await target(f,owner,'media','provenance'),undefined);
  f.sql.prepare("INSERT INTO entity_media(entity_id,media_id,role,public_visible,sort_order,created_at) VALUES('art-marbles','image','gallery',1,0,datetime('now'))").run();
  let reused=await f.call('/api/archive/items/lostmarbles','GET',undefined,false);assert.ok(reused.body.retrospective_comments.some(c=>c.target_id==='image'));
  f.sql.prepare("UPDATE content_entities SET visibility='internal' WHERE id=?").run(owner);reused=await f.call('/api/archive/items/lostmarbles','GET',undefined,false);assert.equal(reused.body.retrospective_comments.length,0);
  f.sql.prepare("UPDATE content_entities SET visibility='public' WHERE id=?").run(owner);f.sql.prepare("UPDATE media_assets SET source_url='/changed-image' WHERE id='image'").run();assert.equal((await f.call('/api/archive/notes/retrospective-fixture','GET',undefined,false)).body.retrospective_comments.some(c=>c.target_id==='image'),false);
});
test('exports and imports retain independent comment metadata without rewriting source',async()=>{
  const f=fixture(),p=await f.note(),t=await target(f,p.note.id);await f.call(management,'POST',input(p.note.id,t));
  const exported=(await f.call(`/api/admin/archive-notes/${p.note.id}/export`)).body;assert.equal(exported.retrospective_metadata.comments.length,1);assert.doesNotMatch(exported.markdown,/Later thought/);
  const imported=await f.call('/api/admin/archive-notes/import','POST',{slug:'imported-retro',title:'Imported',filename:exported.markdown_filename,markdown:exported.markdown});assert.equal(imported.status,201);
  const request={owner_entity_id:imported.body.note.id,metadata:exported.retrospective_metadata};assert.equal((await f.call(`${management}/import`,'POST',request)).status,200);assert.equal((await f.call(`${management}/import`,'POST',request)).status,200);
  const comments=(await f.call(`${management}?owner_entity_id=${request.owner_entity_id}`)).body.records;assert.equal(comments.length,1);assert.equal(comments[0].state,'draft');assert.equal(comments[0].is_stale,true);assert.equal(imported.body.note.body_markdown,p.note.body_markdown);
});
test('text projection respects markup and anchor context',()=>{assert.equal(commentText('## Title\n\nA **bold** and *quiet* idea.\n\n{{asset:sketch}}',true),'Title A bold and quiet idea.');});
test('Lost Marbles release is guarded, dry-run by default, date-preserving and idempotent',async()=>{
  const f=fixture(),p=await f.note('lost-marbles-inception-note',`Original preceding text, ${INTERVENING}, original following text.`);
  const api=async(...args)=>{const r=await f.call(...args);if(r.status>=400)throw Error(r.body.error);return r.body;};
  const dry=await prepareLostMarbles(api);assert.equal(dry.dry_run,true);assert.equal(f.sql.prepare('SELECT count(*) n FROM archive_source_corrections').get().n,0);
  const first=await prepareLostMarbles(api,{apply:true});assert.equal(first.correction_recorded,true);assert.equal(first.source_dates_preserved,true);
  const second=await prepareLostMarbles(api,{apply:true});assert.equal(second.correction_recorded,false);assert.equal(second.comment_created,false);
  const after=await api(`/api/admin/archive-notes/${p.note.id}`);assert.ok(after.note.body_markdown.includes(ORIGINAL));assert.equal(after.retrospective_comments[0].body,COMMENT);assert.equal(after.source_preservation.history.length,1);assert.ok(after.source_preservation.history[0].before_json.includes(INTERVENING));
  const changed={...after,note:{...after.note,body_markdown:'Unexpected source'}};await assert.rejects(prepareLostMarbles(async()=>changed,{apply:true}),/differs/);
});
test('Lost Marbles image explanations move to audited comments without changing source dates or media',async()=>{
  const f=fixture(),p=(await f.call('/api/admin/archive-notes','POST',{title:'Lost Marbles',slug:'lost-marbles-inception-note',body_markdown:`${INTERVENING}\n\n{{asset:original-sketch}}\n\n{{asset:process-experiment}}`,state:'draft',source_created_at:'2022-12-23T19:54:00-05:00',source_modified_at:'2023-11-26'})).body,owner=p.note.id;
  for(const spec of IMAGE_COMMENTS){f.media(owner,spec.token);f.sql.prepare('UPDATE archive_note_assets SET caption_override=? WHERE media_id=?').run(spec.body,spec.token);}
  assert.equal((await f.call(`/api/admin/archive-notes/${owner}`,'PATCH',{state:'published',public_visible:true})).status,200);
  const api=async(...args)=>{const r=await f.call(...args);if(r.status>=400)throw Error(r.body.error);return r.body;};
  const original=await api(`/api/admin/archive-notes/${owner}`);
  const dry=await prepareLostMarbles(api,{moveImageCaptions:true});assert.equal(dry.image_comments.length,2);assert.equal(f.sql.prepare('SELECT count(*) n FROM archive_retrospective_comments').get().n,0);
  const first=await prepareLostMarbles(api,{apply:true,moveImageCaptions:true});assert.equal(first.image_comments_created,2);assert.equal(first.captions_moved,2);
  const after=await api(`/api/admin/archive-notes/${owner}`);assert.equal(after.retrospective_comments.length,3);assert.equal(after.note.body_markdown,original.note.body_markdown.replace(INTERVENING,ORIGINAL));
  for(const key of ['source_created_at','source_modified_at','date_label','created_at'])assert.equal(after.note[key],original.note[key]);
  for(const spec of IMAGE_COMMENTS){const a=after.assets.find(a=>a.token===spec.token),before=original.assets.find(a=>a.token===spec.token);assert.equal(a.caption,spec.label);for(const key of ['id','media_id','alt_text','sort_order','public_visible'])assert.equal(a[key],before[key]);}
  const second=await prepareLostMarbles(api,{apply:true,moveImageCaptions:true});assert.equal(second.image_comments_created,0);assert.equal(second.captions_moved,0);assert.equal(second.comment_created,false);
  assert.equal((await f.call(`/api/admin/archive-notes/${owner}/assets/${after.assets[0].id}`,'PATCH',{expected_caption:'outdated',caption:'overwrite'})).status,409);
  f.sql.prepare('UPDATE archive_note_assets SET caption_override=? WHERE media_id=?').run('Unexpected caption','original-sketch');
  await assert.rejects(prepareLostMarbles(api,{apply:true,moveImageCaptions:true}),/differs/);
});

test('database compare-and-swap protects requests that read the same source/comment revision',async()=>{
  const f=fixture(),p=await f.note(),owner=p.note.id,t=await target(f,owner),created=await f.call(management,'POST',input(owner,t));
  const before=f.sql.prepare('SELECT * FROM archive_retrospective_comments WHERE id=?').get(created.body.record.id);
  await saveArchiveComment(f.env.SUBMISSIONS_DB,{expected_revision:1,body:'First writer'},before);
  await assert.rejects(saveArchiveComment(f.env.SUBMISSIONS_DB,{expected_revision:1,body:'Second writer'},before),e=>e.status===409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM archive_comment_revisions WHERE comment_id=?').get(before.id).n,2);
  const source=f.sql.prepare('SELECT * FROM archive_notes WHERE entity_id=?').get(owner),correction={expected_revision:0,expected_fingerprint:p.source_preservation.source_fingerprint,reason:'Correct the source',body_markdown:'First corrected wording'};
  await correctArchiveSource(f.env.SUBMISSIONS_DB,source,correction);
  await assert.rejects(correctArchiveSource(f.env.SUBMISSIONS_DB,source,{...correction,body_markdown:'Concurrent correction'}),e=>e.status===409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM archive_source_corrections WHERE note_entity_id=?').get(owner).n,1);
});
test('item narrative/documentation targets use owner and subordinate publication gates',async()=>{
  const f=fixture(),owner='art-marbles',t=await target(f,owner,'dossier'),originalStory=f.sql.prepare('SELECT story FROM archive_dossiers WHERE entity_id=?').get(owner).story;
  const story=await f.call(management,'POST',input(owner,t,textAnchor(t.text,0,12)));assert.equal(story.status,201,JSON.stringify(story.body));
  const d=await f.call('/api/admin/archive-documentation','POST',{dossier_entity_id:owner,field_key:'inscription',value:'Original inscription',public_visible:true});assert.equal(d.status,201,JSON.stringify(d.body));
  const doc=await target(f,owner,'documentation',d.body.record.id);assert.equal((await f.call(management,'POST',input(owner,doc,textAnchor(doc.text,0,8)))).status,201);
  assert.equal((await f.call('/api/archive/items/lostmarbles','GET',undefined,false)).body.retrospective_comments.length,2);
  f.sql.prepare('UPDATE archive_catalogue_documentation SET public_visible=0 WHERE id=?').run(doc.target_id);
  assert.equal((await f.call('/api/archive/items/lostmarbles','GET',undefined,false)).body.retrospective_comments.length,1);
  f.sql.prepare("UPDATE archive_dossiers SET story=story||' Changed' WHERE entity_id=?").run(owner);
  assert.equal((await f.call('/api/archive/items/lostmarbles','GET',undefined,false)).body.retrospective_comments.length,0);
  f.sql.prepare('UPDATE archive_dossiers SET story=? WHERE entity_id=?').run(originalStory,owner);
  assert.equal((await f.call('/api/archive/items/lostmarbles','GET',undefined,false)).body.retrospective_comments.length,0,'Returning to identical source text still requires explicit reattachment');
});
