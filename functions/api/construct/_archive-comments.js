import {db,id,json,failure,readJson,requireStudioAdmin} from '../_shared/construct.js';
import {commentText,commentFingerprint,textAnchor,anchorMatches,commentTargetKey} from '../../../shared/archive-comment-targets.js';
import {archiveIdentityProfilePublicSql,archiveCanonicalOwnerPublicSql,archiveMaterialPublicStateSql} from './_archive-publication.js';

const SOURCE_FIELDS = ['body_markdown','source_created_at','source_modified_at','date_label'];
const AUTHOR = 'Saiel Dauhn Solehman';
const AUTHOR_ID = 'person-saiel-dauhn-solehman';
const SOURCE_LIMIT = 200000;
const parse = value => {try{return JSON.parse(value);}catch{return {};}};
const statement = (database,sql,...values) => database.prepare(sql).bind(...values);
const all = async (database,sql,...values) => (await statement(database,sql,...values).all()).results || [];
function error(message,status=400){return Object.assign(new Error(message),{status});}
function bounded(value,name,max,required=false){const s=String(value ?? '').trim();if(s.length>max || (required&&!s))throw error(`${name} must contain ${required?'1':'0'}–${max} characters.`);return s;}

export async function commentOwner(database,entityId) {
  return statement(database,`SELECT e.id,e.visibility,e.entity_type,n.state note_state,n.public_visible note_public,
    d.state dossier_state,d.public_visible dossier_public,(${archiveIdentityProfilePublicSql('e')} AND ${archiveCanonicalOwnerPublicSql('e')}) canonical_public FROM content_entities e
    LEFT JOIN archive_notes n ON n.entity_id=e.id LEFT JOIN archive_dossiers d ON d.entity_id=e.id WHERE e.id=?`,entityId).first();
}
function ownerPublic(owner){return Boolean(owner?.visibility==='public'&&owner.canonical_public===1&&((owner.note_state==='published'&&owner.note_public===1)||(owner.dossier_state==='published'&&owner.dossier_public===1)));}

async function mediaAttached(database,ownerId,mediaId,publicOnly=false) {
  const note = await statement(database,`SELECT a.id FROM archive_note_assets a WHERE a.note_entity_id=? AND a.media_id=?
    AND a.role<>'source-provenance' ${publicOnly?'AND a.public_visible=1':''} LIMIT 1`,ownerId,mediaId).first();
  if(note)return true;
  const material=await statement(database,`SELECT am.id FROM archive_materials am WHERE am.dossier_entity_id=? AND am.media_id=?
    ${publicOnly?`AND am.state='published' AND am.visibility='public' AND ${archiveMaterialPublicStateSql('am')}`:''} LIMIT 1`,ownerId,mediaId).first();
  if(material)return true;
  const source=await statement(database,`SELECT x.id FROM archive_source_material_entries x JOIN archive_source_material_sets s ON s.id=x.source_material_set_id WHERE s.dossier_entity_id=? AND x.media_id=?
    ${publicOnly?`AND x.public_included=1 AND s.publication_state='published' AND s.visibility='public'
      AND EXISTS(SELECT 1 FROM archive_source_material_states ss JOIN archive_object_states os ON os.id=ss.state_id JOIN archive_object_versions ov ON ov.id=os.version_id WHERE ss.source_material_set_id=s.id AND ov.entity_id=s.dossier_entity_id AND os.publication_state='published' AND os.public_visible=1 AND ov.publication_state='published' AND ov.public_visible=1)
      AND NOT EXISTS(SELECT 1 FROM archive_source_material_entries required LEFT JOIN media_assets rm ON rm.id=required.media_id WHERE required.source_material_set_id=s.id AND required.public_included=1 AND required.media_id IS NOT NULL AND (rm.id IS NULL OR rm.state<>'active' OR rm.privacy<>'public' OR rm.public_presentation<>'inline'))`:''} LIMIT 1`,ownerId,mediaId).first();
  if(source)return true;
  return Boolean(await statement(database,`SELECT media_id FROM entity_media WHERE entity_id=? AND media_id=? ${publicOnly?'AND public_visible=1':''} LIMIT 1`,ownerId,mediaId).first());
}

export async function resolveCommentTarget(database,ownerId,target) {
  const owner=await commentOwner(database,ownerId);
  if(!owner || (!owner.note_state&&!owner.dossier_state))throw error('Choose an existing Archive Note or item.',404);
  const kind=target.target_kind,key=String(target.field_key||''),targetId=String(target.target_id||'');
  let row,raw='',publicEligible=ownerPublic(owner),markdown=false;
  if(kind==='note'&&targetId===ownerId&&key==='body_markdown') {
    row=await statement(database,'SELECT * FROM archive_notes WHERE entity_id=?',ownerId).first();
    raw=row?.body_markdown;markdown=true;
  } else if(kind==='dossier'&&targetId===ownerId&&['story','orientation'].includes(key)) {
    row=await statement(database,'SELECT * FROM archive_dossiers WHERE entity_id=?',ownerId).first();raw=row?.[key];
  } else if(kind==='documentation'&&key==='value') {
    row=await statement(database,'SELECT * FROM archive_catalogue_documentation WHERE id=? AND dossier_entity_id=?',targetId,ownerId).first();
    raw=row?.value;publicEligible=publicEligible&&row?.public_visible===1;
  } else if(kind==='material'&&key==='body') {
    row=await statement(database,`SELECT am.*,${archiveMaterialPublicStateSql('am')} public_state FROM archive_materials am WHERE id=? AND dossier_entity_id=?`,targetId,ownerId).first();
    if(row?.media_id)throw error('Select the managed asset; this material body is not displayed separately.');
    raw=row?.body;publicEligible=publicEligible&&row?.state==='published'&&row?.visibility==='public'&&row?.public_state===1;
    if(publicEligible&&row.media_id)publicEligible=Boolean(await statement(database,"SELECT id FROM media_assets m WHERE id=? AND state='active' AND privacy='public' AND public_presentation='inline' AND NOT EXISTS(SELECT 1 FROM media_asset_variants v WHERE v.master_media_id=m.id)",row.media_id).first());
  } else if(kind==='media'&&!key) {
    row=await statement(database,`SELECT m.*,EXISTS(SELECT 1 FROM media_asset_variants v WHERE v.master_media_id=m.id) is_master FROM media_assets m WHERE m.id=?`,targetId).first();
    if(!row||!await mediaAttached(database,ownerId,targetId))throw error('This media is not attached to the owning Archive record.');
    if(!/^(image|video|audio)\//.test(row.mime_type))throw error('Choose an image, video, or audio asset.');
    publicEligible=publicEligible&&row.state==='active'&&row.privacy==='public'&&row.public_presentation==='inline'&&!row.is_master&&await mediaAttached(database,ownerId,targetId,true);
    // Location + media identity evidence, not captions or publication toggles.
    raw=JSON.stringify([row.id,row.storage_key,row.source_url,row.mime_type,row.byte_size,row.width,row.height,row.duration_seconds]);
  } else throw error('Unsupported retrospective-comment target.');
  if(!row)throw error('The selected source no longer exists.',404);
  const projection=kind==='media'?'':commentText(raw,markdown);
  return {target_kind:kind,target_id:targetId,field_key:key,text:projection,markdown,
    source_fingerprint:await commentFingerprint(raw||''),public_eligible:Boolean(publicEligible),
    label:kind==='media'?(row.public_title||row.original_filename||targetId):`${kind} · ${key}`,
    ...(kind==='media'?{mime_type:row.mime_type,duration_seconds:row.duration_seconds,url:row.source_url||`/api/construct/media/${row.id}`,preview_requires_auth:row.privacy!=='public'||row.public_presentation!=='inline'}:{})};
}

export async function archiveCommentTargets(database,ownerId) {
  const owner=await commentOwner(database,ownerId);if(!owner)throw error('Archive record not found.',404);
  const specs=[];
  if(owner.note_state)specs.push({target_kind:'note',target_id:ownerId,field_key:'body_markdown'});
  if(owner.dossier_state){
    specs.push(...['story','orientation'].map(field_key=>({target_kind:'dossier',target_id:ownerId,field_key})));
    for(const row of await all(database,'SELECT id FROM archive_catalogue_documentation WHERE dossier_entity_id=?',ownerId))specs.push({target_kind:'documentation',target_id:row.id,field_key:'value'});
    for(const row of await all(database,"SELECT id FROM archive_materials WHERE dossier_entity_id=? AND body<>''",ownerId))specs.push({target_kind:'material',target_id:row.id,field_key:'body'});
  }
  const media=await all(database,`SELECT media_id FROM archive_note_assets WHERE note_entity_id=? AND role<>'source-provenance'
    UNION SELECT media_id FROM archive_materials WHERE dossier_entity_id=? AND media_id IS NOT NULL
    UNION SELECT media_id FROM entity_media WHERE entity_id=?
    UNION SELECT x.media_id FROM archive_source_material_entries x JOIN archive_source_material_sets s ON s.id=x.source_material_set_id WHERE s.dossier_entity_id=? AND x.media_id IS NOT NULL`,ownerId,ownerId,ownerId,ownerId);
  for(const row of media)specs.push({target_kind:'media',target_id:row.media_id,field_key:''});
  const targets=[];
  for(const spec of specs){try{const target=await resolveCommentTarget(database,ownerId,spec);if(target.text||target.target_kind==='media')targets.push(target);}catch(e){if(e.status!==400&&e.status!==404)throw e;}}
  return targets;
}

function present(row){return {...row,anchor:parse(row.anchor_json),anchor_json:undefined};}
async function assess(database,row,cache=new Map()){
  const key=`${row.owner_entity_id}:${commentTargetKey(row)}`;
  let target=cache.get(key);
  if(!cache.has(key)){try{target=await resolveCommentTarget(database,row.owner_entity_id,row);}catch(e){if(e.status!==404&&e.status!==400)throw e;target=null;}cache.set(key,target);}
  const anchor=parse(row.anchor_json);
  const stale=Boolean(row.review_required_at)||!target||target.source_fingerprint!==row.source_fingerprint||(row.target_kind!=='media'&&!anchorMatches(target.text,anchor));
  return {...present(row),is_stale:stale,public_eligible:Boolean(target?.public_eligible&&!stale)};
}

export async function loadArchiveComments(database,ownerId,{publicOnly=false,mediaIds=[]}={}) {
  if(publicOnly&&!ownerPublic(await commentOwner(database,ownerId)))return [];
  const ids=[...new Set(mediaIds.filter(Boolean))];
  const rows=await all(database,`SELECT * FROM archive_retrospective_comments WHERE (owner_entity_id=?
    ${publicOnly&&ids.length?`OR (target_kind='media' AND target_id IN (${ids.map(()=>'?').join(',')}))`:''})
    ${publicOnly?"AND state='published'":''} ORDER BY created_at,id`,ownerId,...(publicOnly?ids:[]));
  const cache=new Map(),attachments=new Map(),result=[];
  for(const row of rows){const value=await assess(database,row,cache);if(publicOnly){
    if(!value.public_eligible)continue;
    if(row.target_kind==='media'&&row.owner_entity_id!==ownerId){if(!attachments.has(row.target_id))attachments.set(row.target_id,await mediaAttached(database,ownerId,row.target_id,true));if(!attachments.get(row.target_id))continue;}
    // Public DTO excludes fingerprints, anchor context, private revision snapshots and actor data.
    result.push({id:row.id,owner_entity_id:row.owner_entity_id,target_kind:row.target_kind,target_id:row.target_id,field_key:row.field_key,
      anchor:row.target_kind==='media'?{...(value.anchor.start_seconds==null?{}:{start_seconds:value.anchor.start_seconds}),...(value.anchor.end_seconds==null?{}:{end_seconds:value.anchor.end_seconds})}:{start:value.anchor.start,end:value.anchor.end,quote:value.anchor.quote},
      body:row.body,author_name:row.author_name,created_at:row.created_at,edited_at:row.edited_at});
  }else result.push(value);}
  return result;
}

async function normalizedComment(database,input,before=null){
  if(before&&input.state==='archived')return {...Object.fromEntries(['owner_entity_id','target_kind','target_id','field_key','anchor_json','source_fingerprint','body','author_name','author_entity_id','state'].map(k=>[k,k==='state'?'archived':before[k]])),body:bounded(input.body??before.body,'Comment',12000,true)};
  const ownerId=before?.owner_entity_id||bounded(input.owner_entity_id,'Owner',200,true);
  const spec={target_kind:input.target_kind??before?.target_kind,target_id:input.target_id??before?.target_id,field_key:input.field_key??before?.field_key??''};
  const target=await resolveCommentTarget(database,ownerId,spec);
  const oldAnchor=before?parse(before.anchor_json):{};
  const reattach=!before||input.reattach===true;
  if(before&&!reattach&&commentTargetKey(spec)!==commentTargetKey(before))throw error('Use Reattach to change a comment target.');
  let anchor=reattach?(input.anchor||{}):oldAnchor;
  const fingerprint=reattach?input.source_fingerprint:before.source_fingerprint;
  if(reattach&&fingerprint!==target.source_fingerprint)throw error('The source changed. Reload and select the target again.',409);
  if(spec.target_kind==='media'){
    const start=anchor.start_seconds??null,end=anchor.end_seconds??null;
    const observedDuration=reattach?input.observed_duration_seconds:oldAnchor.observed_duration_seconds;
    const duration=target.duration_seconds||observedDuration;
    if(start!==null){
      if(!/^(video|audio)\//.test(target.mime_type)||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||duration>604800||start>duration)throw error('A timed comment needs a loaded recording duration and an in-range start.');
      if(end!==null&&(!Number.isFinite(end)||end<=start||end>duration))throw error('End must be after start and within the recording.');
    }else if(end!==null)throw error('A range needs a start time.');
    anchor=start===null?{}:{start_seconds:start,...(end===null?{}:{end_seconds:end}),...(!target.duration_seconds?{observed_duration_seconds:duration,duration_source:'studio-media-preview'}:{})};
  }else if(reattach){
    const canonical=textAnchor(target.text,anchor.start,anchor.end);
    if(canonical.quote!==anchor.quote)throw error('Selected text does not match the source.',409);
    anchor=canonical;
  }
  const state=input.state??before?.state??(target.public_eligible?'published':'draft');
  if(!['draft','published','archived'].includes(state))throw error('Invalid comment state.');
  if(state==='published'&&(!target.public_eligible||fingerprint!==target.source_fingerprint||(!reattach&&before?.review_required_at)))throw error('Publish the owner and target, and review stale attachments before publishing this comment.',409);
  const authorId=input.author_entity_id??before?.author_entity_id??AUTHOR_ID;
  if(authorId&&!await statement(database,"SELECT id FROM content_entities WHERE id=? AND entity_type='person'",authorId).first())throw error('Choose an existing person as the comment author.');
  return {owner_entity_id:ownerId,...spec,anchor_json:JSON.stringify(anchor),source_fingerprint:fingerprint,
    body:bounded(input.body??before?.body,'Comment',12000,true),author_name:bounded(input.author_name??before?.author_name??AUTHOR,'Author',160,true),author_entity_id:authorId||null,state};
}

export async function saveArchiveComment(database,input,before=null){
  if(before&&input.expected_revision!==before.revision)throw error('The comment changed. Reload before saving.',409);
  const data=await normalizedComment(database,input,before),now=new Date().toISOString();
  const row={...data,id:before?.id||id('archive-comment'),revision:(before?.revision||0)+1,target_revision:before?.target_revision||0,created_at:before?.created_at||now,updated_at:now,review_required_at:input.reattach?null:before?.review_required_at||null,
    published_at:before?.published_at||(data.state==='published'?now:null),edited_at:before?(['body','anchor_json','target_id','field_key','author_name','author_entity_id'].some(key=>data[key]!==before[key])?now:before.edited_at):null};
  const columns=Object.keys(row),values=columns.map(key=>row[key]);
  const mutation=before?statement(database,`UPDATE archive_retrospective_comments SET ${columns.filter(k=>k!=='id').map(k=>`${k}=?`).join(',')} WHERE id=? AND revision=? AND target_revision=?`,...columns.filter(k=>k!=='id').map(k=>row[k]),row.id,before.revision,before.target_revision||0)
    :statement(database,`INSERT INTO archive_retrospective_comments(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...values);
  const audit=statement(database,`INSERT INTO archive_comment_revisions(id,comment_id,revision,action,before_json,after_json,actor,created_at)
    SELECT ?,?,?,?,?,?,'studio',? WHERE changes()=1`,
    id('comment-revision'),row.id,row.revision,before?(input.reattach?'reattach':row.state==='archived'?'archive':'edit'):'create',before?JSON.stringify(before):null,JSON.stringify(row),now);
  const results=await database.batch([mutation,audit]);
  if(!results[0].meta?.changes)throw error('The comment changed. Reload before saving.',409);
  return assess(database,row);
}

export async function archiveCommentsAdmin(request,env,commentId=''){
  const denied=requireStudioAdmin(request,env);if(denied)return denied;
  const database=db(env);
  try{
    if(commentId==='import'&&request.method==='POST'){
      const input=await readJson(request),ownerId=input?.owner_entity_id,metadata=input?.metadata;
      const owner=await commentOwner(database,ownerId);if(!owner?.note_state)throw error('Choose an existing Note.');
      if(metadata?.schema!=='archive-retrospective-comments/v1'||!Array.isArray(metadata.comments)||metadata.comments.length>500)throw error('Invalid retrospective-comment metadata.');
      const imported=[];
      for(const original of metadata.comments){
        if(!['note','media'].includes(original.target_kind))throw error('Invalid Note comment target.');
        const originalId=bounded(original.id,'Original comment ID',200,true),newId=`imported-comment-${await commentFingerprint(`${ownerId}:${originalId}`)}`;
        if(await statement(database,'SELECT id FROM archive_retrospective_comments WHERE id=?',newId).first()){imported.push(newId);continue;}
        const now=new Date().toISOString(),row={id:newId,owner_entity_id:ownerId,target_kind:original.target_kind,target_id:original.target_kind==='note'?ownerId:bounded(original.target_id,'Media ID',200,true),field_key:original.target_kind==='note'?'body_markdown':'',anchor_json:JSON.stringify(original.anchor||{}),source_fingerprint:`imported:${bounded(original.source_fingerprint,'Fingerprint',100)}`,body:bounded(original.body,'Comment',12000,true),author_name:bounded(original.author_name,'Author',160,true),author_entity_id:null,state:'draft',revision:1,created_at:now,updated_at:now};
        if(row.anchor_json.length>4000)throw error('Imported anchor is too large.');
        const columns=Object.keys(row);
        await database.batch([statement(database,`INSERT INTO archive_retrospective_comments(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(k=>row[k])),statement(database,"INSERT INTO archive_comment_revisions(id,comment_id,revision,action,before_json,after_json,actor,created_at) VALUES(?,?,1,'import',?,?,'studio',?)",id('comment-revision'),newId,JSON.stringify(original),JSON.stringify(row),now)]);imported.push(newId);
      }
      return json({imported,review_required:true});
    }
    if(request.method==='GET'&&!commentId){const owner=new URL(request.url).searchParams.get('owner_entity_id');if(!owner)throw error('Choose an Archive owner.');return json({records:await loadArchiveComments(database,owner),targets:await archiveCommentTargets(database,owner)});}
    const before=commentId?await statement(database,'SELECT * FROM archive_retrospective_comments WHERE id=?',commentId).first():null;
    if(commentId&&!before)return failure('Comment not found.',404);
    if(request.method==='GET')return json({record:await assess(database,before),revisions:await all(database,'SELECT * FROM archive_comment_revisions WHERE comment_id=? ORDER BY revision DESC',commentId)});
    if(!['POST','PATCH','DELETE'].includes(request.method)||(!commentId&&request.method!=='POST')||(commentId&&request.method==='POST'))return failure('Method not allowed.',405);
    const input=await readJson(request);if(!input||typeof input!=='object')throw error('Send a JSON object.');
    const record=await saveArchiveComment(database,{...input,...(request.method==='DELETE'?{state:'archived'}:{})},before);
    return json({record},{status:before?200:201});
  }catch(e){return failure(e.message,e.status||400);}
}

export function sourceSnapshot(note){return Object.fromEntries(SOURCE_FIELDS.map(field=>[field,note[field]??null]));}
export function sourceChanged(before,after){return SOURCE_FIELDS.some(field=>(before[field]??null)!==(after[field]??null));}
export function protectedNote(note){return Boolean(note.source_ever_published||note.published_at||note.state==='published');}

export async function sourceCorrectionInfo(database,note){
  return {locked:protectedNote(note),source_revision:note.source_revision,source_fingerprint:await commentFingerprint(JSON.stringify(sourceSnapshot(note))),
    history:await all(database,'SELECT * FROM archive_source_corrections WHERE note_entity_id=? ORDER BY source_revision DESC',note.entity_id)};
}

export async function correctArchiveSource(database,note,input,validate){
  const snapshot=sourceSnapshot(note),fingerprint=await commentFingerprint(JSON.stringify(snapshot));
  if(input.expected_revision!==note.source_revision||input.expected_fingerprint!==fingerprint)throw error('The source changed. Reload before correcting it.',409);
  const reason=bounded(input.reason,'Correction reason',3000,true),evidence=bounded(input.date_evidence,'Date evidence',3000);
  const after={...snapshot};
  for(const field of SOURCE_FIELDS)if(Object.hasOwn(input,field))after[field]=input[field]===null?null:String(input[field]);
  for(const field of SOURCE_FIELDS.slice(1))if(after[field]!=null&&after[field].length>(field==='date_label'?500:80))throw error('Historical date fields exceed the supported length.');
  if(!after.body_markdown||after.body_markdown.length>SOURCE_LIMIT)throw error('Source body must be non-empty and at most 200,000 characters.');
  if(!sourceChanged(snapshot,after))throw error('The source has not changed.');
  if(SOURCE_FIELDS.slice(1).some(field=>after[field]!==snapshot[field])&&!evidence)throw error('Changing historical dates requires date evidence.');
  if(validate)await validate({...note,...after});
  const revision=note.source_revision+1,now=new Date().toISOString();
  const match='entity_id=? AND source_revision=? AND body_markdown IS ? AND source_created_at IS ? AND source_modified_at IS ? AND date_label IS ?';
  const matchValues=[note.entity_id,note.source_revision,...SOURCE_FIELDS.map(f=>snapshot[f])];
  const result=await database.batch([
    statement(database,`INSERT INTO archive_source_corrections(id,note_entity_id,source_revision,reason,date_evidence,before_json,after_json,actor,created_at)
      SELECT ?,?,?,?,?,?,?,'studio',? FROM archive_notes WHERE ${match}`,id('source-correction'),note.entity_id,revision,reason,evidence,JSON.stringify(snapshot),JSON.stringify(after),now,...matchValues),
    statement(database,`UPDATE archive_notes SET body_markdown=?,source_created_at=?,source_modified_at=?,date_label=?,source_revision=?,updated_by='studio',updated_at=? WHERE ${match}`,...SOURCE_FIELDS.map(f=>after[f]),revision,now,...matchValues)
  ]);
  if(!result[1].meta?.changes)throw error('The source changed. Reload before correcting it.',409);
  return {...note,...after,source_revision:revision,updated_at:now};
}
