import {db, failure, id, json, requireStudioAdmin, slug} from "../_shared/construct.js";
import {serveR2Media} from "../_shared/r2-media.js";
import {normalizeWritingSnapshot, renderWritingResponse, writingImages, writingPlainText, writingHref, WRITING_AUTHOR, WRITING_ROOT} from "../../../shared/writing-content.js";

const SAMPLE_IMAGE = "writing-layout-sample-image";
const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/webp","image/gif"]);
const RESPONSE_TYPES = new Set([...IMAGE_TYPES,"application/pdf","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const MAX_RESPONSE_FILES = 4;
const MAX_RESPONSE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_REQUEST_BYTES = 22 * 1024 * 1024;
const statement = (database, sql, ...args) => database.prepare(sql).bind(...args);
const errorStatus = error => /conflict|UNIQUE|cannot change|Unpublish|before detaching/i.test(error.message) ? 409 : 400;
async function bodyJSON(request) {
  if (Number(request.headers.get("content-length")) > 250000) throw new Error("The entry is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Send an entry to save.");
  const chunks = []; let size = 0;
  while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 250000) { await reader.cancel(); throw new Error("The entry is too large."); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Send a valid entry."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Send a valid entry.");
  return value;
}
function entrySlug(value) {
  const candidate = String(value || "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) || candidate.length > 160 || ["detail","index"].includes(candidate)) throw new Error("Use a unique URL name with lowercase letters, numbers, and hyphens.");
  return candidate;
}
async function rowById(database, entryId) { return statement(database,"SELECT * FROM writing_entries WHERE entity_id=?",entryId).first(); }
function snapshotConnections(snapshot) {
  return Array.isArray(snapshot.connections) ? snapshot.connections : (snapshot.relatedIds || []).map(targetId=>({targetId,relationshipTypeId:"rel-related-to",note:""}));
}
function summary(row, admin = false) {
  const snapshot = JSON.parse(admin ? row.draft_json : row.published_json);
  return {id:row.entity_id,slug:row.slug,title:snapshot.title,excerpt:snapshot.excerpt,author:snapshot.author,startedAt:row.started_at || null,firstSavedAt:row.created_at,firstPublishedAt:row.first_published_at,publishedUpdatedAt:row.published_updated_at,
    ...(admin ? {state:row.state,version:row.version,isSample:Boolean(row.is_sample),draftSavedAt:row.draft_saved_at || row.created_at,updatedAt:row.updated_at,hasUnpublishedChanges:row.draft_json !== row.published_json} : {})};
}
async function assets(database, snapshot) {
  const ids = [...new Set(writingImages(snapshot).map(image => image.mediaId))];
  if (!ids.length) return [];
  return (await statement(database,`SELECT m.*,EXISTS(SELECT 1 FROM media_asset_variants v WHERE v.master_media_id=m.id) variant_master FROM media_assets m WHERE m.id IN (${ids.map(()=>"?").join(",")})`,...ids).all()).results || [];
}
async function connectionCards(database, connections, resolveEntities, {admin = false, entryId = ""} = {}) {
  const targetIds=[...new Set(connections.map(connection=>connection.targetId))];
  const typeIds=[...new Set(connections.map(connection=>connection.relationshipTypeId))];
  const entities=await resolveEntities(database,targetIds),byEntity=new Map(entities.map(entity=>[entity.id,entity]));
  const types=typeIds.length?(await statement(database,`SELECT * FROM relationship_types WHERE id IN (${typeIds.map(()=>"?").join(",")})`,...typeIds).all()).results||[]:[];
  const byType=new Map(types.map(type=>[type.id,type]));
  if(admin){
    if(entities.length!==targetIds.length || targetIds.includes(entryId))throw new Error("Choose existing Construct records other than this entry.");
    if(types.length!==typeIds.length)throw new Error("Choose an existing relationship type.");
  }
  return connections.flatMap(connection=>{
    const entity=byEntity.get(connection.targetId),type=byType.get(connection.relationshipTypeId);
    if(!entity||!type)return [];
    if(!admin&&(entity.visibility!=="public"||!writingHref(entity.route)||["draft","archived","internal","private"].includes(entity.state)||!type.public_visible))return [];
    return [{id:entity.id,title:entity.title,route:writingHref(entity.route),kindLabel:entity.kindLabel||entity.entityType||"",relationshipTypeId:type.id,relationshipLabel:type.forward_label,note:connection.note||""}];
  }).filter(connection=>connection.route);
}
async function responseRecords(database,entry,admin,resolveEntities){
  const rows=(await statement(database,`SELECT * FROM writing_responses response WHERE entry_id=? ${admin?"":"AND state='published' AND (parent_response_id IS NULL OR EXISTS(SELECT 1 FROM writing_responses parent WHERE parent.id=response.parent_response_id AND parent.state='published'))"} ORDER BY created_at,id`,entry.entity_id).all()).results||[];
  if(!rows.length)return [];
  const responseIds=rows.map(row=>row.id),marks=responseIds.map(()=>"?").join(",");
  const [linkResult,attachmentResult,connectionResult]=await Promise.all([
    statement(database,`SELECT * FROM writing_response_links WHERE response_id IN (${marks}) ORDER BY response_id,sort_order,id`,...responseIds).all(),
    statement(database,`SELECT * FROM writing_response_attachments WHERE response_id IN (${marks}) ORDER BY response_id,sort_order,id`,...responseIds).all(),
    statement(database,`SELECT * FROM writing_response_connections WHERE response_id IN (${marks}) ORDER BY response_id,sort_order,id`,...responseIds).all(),
  ]);
  const connectionRows=connectionResult.results||[],cardsByResponse=new Map();
  for(const responseId of responseIds){
    const own=connectionRows.filter(row=>row.response_id===responseId).map(row=>({targetId:row.target_entity_id,relationshipTypeId:row.relationship_type_id,note:row.note}));
    cardsByResponse.set(responseId,await connectionCards(database,own,resolveEntities,{admin}));
  }
  const records=rows.map(row=>({
    id:row.id,parentResponseId:row.parent_response_id||null,authorKind:row.author_kind,authorName:row.author_name,body:row.body,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,
    links:(linkResult.results||[]).filter(link=>link.response_id===row.id).map(link=>({id:link.id,url:link.url,kind:link.link_kind,youtubeId:link.youtube_id||"",label:new URL(link.url).hostname.replace(/^www\./,"")})),
    attachments:(attachmentResult.results||[]).filter(item=>item.response_id===row.id).map(item=>({id:item.id,filename:item.original_filename,mimeType:item.mime_type,byteSize:Number(item.byte_size),sha256:admin?item.sha256:undefined,kind:item.attachment_kind,url:`${admin?`/api/admin/writing-entries/${encodeURIComponent(entry.entity_id)}`:`/api/writings/entries/${encodeURIComponent(entry.slug)}`}/responses/media/${encodeURIComponent(item.id)}`})),
    connections:cardsByResponse.get(row.id)||[],replies:[],
  }));
  const byId=new Map(records.map(record=>[record.id,record])),roots=[];
  for(const record of records){if(record.parentResponseId&&byId.has(record.parentResponseId))byId.get(record.parentResponseId).replies.push(record);else roots.push(record)}
  return roots;
}
async function payload(database, row, admin, resolveEntities) {
  const snapshot = JSON.parse(admin ? row.draft_json : row.published_json);
  const media = (await assets(database,snapshot)).filter(asset => asset.state === "active" && (admin || (asset.privacy === "public" && asset.public_presentation === "inline" && !asset.variant_master))).map(asset => ({id:asset.id,width:asset.width,height:asset.height,url:admin ? asset.id === SAMPLE_IMAGE ? "/api/admin/writing-entries/sample-image" : `/api/admin/media/${encodeURIComponent(asset.id)}/file` : `/api/construct/entity-media/${encodeURIComponent(asset.id)}`}));
  const related = await connectionCards(database,snapshotConnections(snapshot),resolveEntities,{admin,entryId:row.entity_id});
  const responses=await responseRecords(database,row,admin,resolveEntities);
  return {...summary(row,admin),snapshot,media,related,responses};
}
function revision(database, entryId, action, before, after, now) {
  return statement(database,`INSERT INTO entity_revisions(id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
    SELECT ?,?,COALESCE(MAX(revision_number),0)+1,?,?,?,'studio',? FROM entity_revisions WHERE entity_id=?`,id("revision"),entryId,action,before ? JSON.stringify(before) : null,JSON.stringify(after),now,entryId);
}
function draftAttachments(database, entryId, snapshot, now) {
  return [statement(database,"DELETE FROM entity_media WHERE entity_id=? AND role='writing-draft'",entryId), ...[...new Set(writingImages(snapshot).map(image=>image.mediaId))].map(mediaId=>statement(database,"INSERT INTO entity_media(entity_id,media_id,role,public_visible,created_at) VALUES(?,?,'writing-draft',0,?)",entryId,mediaId,now))];
}
async function validateReferences(database, snapshot, {publish = false, resolveEntities, entryId = ""} = {}) {
  const images = writingImages(snapshot), media = await assets(database,snapshot), byId = new Map(media.map(asset=>[asset.id,asset]));
  for (const image of images) {
    const asset = byId.get(image.mediaId);
    if (!asset || asset.state !== "active" || (!IMAGE_TYPES.has(asset.mime_type) && image.mediaId !== SAMPLE_IMAGE) || asset.variant_master) throw new Error("Choose an active JPEG, PNG, WebP, or GIF image from the media library.");
    if (publish && (!image.alt.trim() || asset.privacy === "private" || image.mediaId === SAMPLE_IMAGE)) throw new Error("Every published image needs alt text and permission for public use. Replace private or sample images first.");
  }
  const connections=snapshotConnections(snapshot);
  const related=await connectionCards(database,connections,resolveEntities,{admin:true,entryId});
  if (publish && related.some(entity => !entity.route)) throw new Error("Publish connected records first, or remove them from this entry.");
  if(publish){
    const sourceEntities=await resolveEntities(database,connections.map(connection=>connection.targetId));
    if(sourceEntities.some(entity=>entity.visibility!=="public"||!writingHref(entity.route)||["draft","archived","internal","private"].includes(entity.state)))throw new Error("Publish connected records first, or remove them from this entry.");
    const typeIds=[...new Set(connections.map(connection=>connection.relationshipTypeId))];
    if(typeIds.length){const types=(await statement(database,`SELECT id,public_visible FROM relationship_types WHERE id IN (${typeIds.map(()=>"?").join(",")})`,...typeIds).all()).results||[];if(types.some(type=>!type.public_visible))throw new Error("Enable each relationship type before publishing this entry.")}
  }
  return {images,media,related,connections};
}
async function saveDraft(database, before, body, resolveEntities) {
  const snapshot = normalizeWritingSnapshot(body.snapshot), draft = JSON.stringify(snapshot), now = new Date().toISOString();
  // Only creation accepts the editor's first-edit timestamp. Clock skew or an
  // older client must never prevent the author from saving their writing.
  const start = typeof body.startedAt === "string" ? Date.parse(body.startedAt) : NaN;
  const startedAt = before ? before.started_at : Number.isFinite(start) ? new Date(Math.min(start,Date.parse(now))).toISOString() : null;
  const savedAt = new Date(Math.max(Date.parse(now),Date.parse(before?.draft_saved_at || "")+1 || 0)).toISOString();
  const entryId = before?.entity_id || id("writing");
  const slugProvided = Object.prototype.hasOwnProperty.call(body, "slug");
  const requestedSlug = String(body.slug ?? "").trim();
  const draftSlug = requestedSlug || slug(snapshot.title) || before?.slug || entryId;
  const nextSlug = entrySlug(before?.first_published_at ? before.slug : draftSlug);
  if (before && Number(body.version) !== before.version) throw new Error("Save conflict: this entry changed in another window. Reload it before saving.");
  if (before?.first_published_at && slugProvided && before.slug !== requestedSlug) throw new Error("A published WRKNG URL cannot change.");
  await validateReferences(database,snapshot,{resolveEntities,entryId});
  const writes = before ? [statement(database,"UPDATE writing_entries SET slug=?,draft_json=?,version=?,updated_at=?,draft_saved_at=? WHERE entity_id=?",nextSlug,draft,before.version+1,now,savedAt,entryId)] : [
    statement(database,"INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'writing_work','node-writings','internal',0,'studio','studio',?,?)",entryId,now,now),
    statement(database,"INSERT INTO writing_entries(entity_id,slug,draft_json,started_at,created_at,updated_at,draft_saved_at) VALUES(?,?,?,?,?,?,?)",entryId,nextSlug,draft,startedAt,now,now,savedAt),
  ];
  writes.push(...draftAttachments(database,entryId,snapshot,now),revision(database,entryId,before?"writing-save-draft":"writing-create",before,{slug:nextSlug,snapshot,startedAt:startedAt || null,draftSavedAt:savedAt},now));
  await database.batch(writes);
  return rowById(database,entryId);
}
async function publish(database, before, body, resolveEntities) {
  if (Number(body.version) !== before.version) throw new Error("Publish conflict: this entry changed in another window. Reload it first.");
  if (before.is_sample) throw new Error("This layout sample stays private. Create a new entry for publication.");
  if (before.state === "archived") throw new Error("This entry is archived. Restore it to a draft before publishing.");
  const snapshot = normalizeWritingSnapshot(JSON.parse(before.draft_json));
  if (!snapshot.title || !writingPlainText(snapshot).trim()) throw new Error("Add a title and some writing before publishing.");
  const {images,media,connections} = await validateReferences(database,snapshot,{publish:true,resolveEntities,entryId:before.entity_id});
  const now = new Date(Math.max(Date.now(),Date.parse(before.published_updated_at || "")+1 || 0)).toISOString(), published = JSON.stringify(snapshot), first = before.first_published_at || now;
  const writes = media.map(asset=>statement(database,"UPDATE media_assets SET privacy='public',public_presentation='inline',updated_at=? WHERE id=? AND state='active' AND privacy<>'private'",now,asset.id));
  writes.push(statement(database,"UPDATE writing_entries SET published_json=?,state='published',first_published_at=?,published_updated_at=?,version=?,updated_at=? WHERE entity_id=?",published,first,now,before.version+1,now,before.entity_id));
  writes.push(statement(database,"UPDATE content_entities SET visibility='public',search_visibility=1,public_at=?,archived_at=NULL,updated_by='studio',updated_at=? WHERE id=?",first,now,before.entity_id));
  // The snapshot is updated first, so only obsolete placements may be removed.
  const mediaIds = [...new Set(images.map(image=>image.mediaId))];
  writes.push(statement(database,`DELETE FROM entity_media WHERE entity_id=? AND role='writing-inline'${mediaIds.length ? ` AND media_id NOT IN (${mediaIds.map(()=>"?").join(",")})` : ""}`,before.entity_id,...mediaIds));
  for (const asset of media) {
    const image = images.find(image=>image.mediaId === asset.id);
    writes.push(statement(database,`INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,'writing-inline',?,1,?,?,?)
      ON CONFLICT(entity_id,media_id,role) DO UPDATE SET sort_order=excluded.sort_order,public_visible=1,alt_text_override=excluded.alt_text_override,caption_override=excluded.caption_override`,before.entity_id,asset.id,mediaIds.indexOf(asset.id),image.alt,image.caption,now));
  }
  writes.push(statement(database,"DELETE FROM entity_relationships WHERE source_entity_id=? AND created_by='writing-publisher'",before.entity_id));
  for (const [index,connection] of connections.entries()) writes.push(statement(database,`INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
    VALUES(?,?,?,?,1,?,?,'writing-publisher',?,?)
    ON CONFLICT(source_entity_id,target_entity_id,relationship_type_id) DO UPDATE SET public_visible=1,internal_notes=excluded.internal_notes,sort_order=excluded.sort_order,updated_at=excluded.updated_at`,id("connection"),before.entity_id,connection.targetId,connection.relationshipTypeId,connection.note,index,now,now));
  writes.push(statement(database,`INSERT INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
    VALUES(?,'writing_work','writings',?,?,?,?,'published',?,?,?) ON CONFLICT(entity_id) DO UPDATE SET slug=excluded.slug,title=excluded.title,summary=excluded.summary,body=excluded.body,state='published',date_label=excluded.date_label,route=excluded.route,updated_at=excluded.updated_at`,before.entity_id,before.slug,snapshot.title,snapshot.excerpt,writingPlainText(snapshot),first,`${WRITING_ROOT}${before.slug}/`,now));
  writes.push(revision(database,before.entity_id,"writing-publish",before,{snapshot,firstPublishedAt:first,publishedUpdatedAt:now},now));
  await database.batch(writes);
  return rowById(database,before.entity_id);
}
async function withdraw(database, before, body, action) {
  if (Number(body.version) !== before.version) throw new Error("Save conflict: reload the entry before changing publication.");
  const now = new Date().toISOString(), state = action === "archive" ? "archived" : "draft";
  await database.batch([
    statement(database,"UPDATE writing_entries SET state=?,version=?,updated_at=? WHERE entity_id=?",state,before.version+1,now,before.entity_id),
    statement(database,"UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=?,updated_by='studio',updated_at=? WHERE id=?",state === "archived" ? now : null,now,before.entity_id),
    statement(database,"DELETE FROM search_documents WHERE entity_id=?",before.entity_id),
    statement(database,"UPDATE entity_media SET public_visible=0 WHERE entity_id=? AND role='writing-inline'",before.entity_id),
    statement(database,"UPDATE entity_relationships SET public_visible=0,updated_at=? WHERE source_entity_id=? AND created_by='writing-publisher'",now,before.entity_id),
    revision(database,before.entity_id,`writing-${action}`,before,{state},now),
  ]);
  return rowById(database,before.entity_id);
}

const responseText=(value,max=12000)=>String(value??"").trim().slice(0,max);
function safeFilename(value){return responseText(value,180).replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"attachment"}
async function sha256Bytes(bytes){const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
function requestIp(request){return responseText(request.headers.get("CF-Connecting-IP")||request.headers.get("x-forwarded-for")?.split(",")[0]||"unknown",128)}
function imageSignature(bytes){
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return "image/jpeg";
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return "image/png";
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return "image/webp";
  if(bytes.length>=6&&["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.slice(0,6))))return "image/gif";
  return "";
}
function detectedResponseType(bytes,claimed){
  const image=imageSignature(bytes);if(image)return image;
  if(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==="%PDF-")return "application/pdf";
  if(bytes.length>=8&&[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((value,index)=>bytes[index]===value))return "application/msword";
  if(bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&[0x03,0x05,0x07].includes(bytes[2]))return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if(claimed==="text/plain"&&!bytes.slice(0,4096).includes(0))return "text/plain";
  return "";
}
function youtubeId(url){
  try{const parsed=new URL(url),host=parsed.hostname.replace(/^www\./,"").toLowerCase();let value="";
    if(host==="youtu.be")value=parsed.pathname.split("/").filter(Boolean)[0]||"";
    else if(["youtube.com","m.youtube.com","music.youtube.com"].includes(host))value=parsed.pathname==="/watch"?parsed.searchParams.get("v")||"":parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]||"";
    return /^[a-zA-Z0-9_-]{11}$/.test(value)?value:"";
  }catch{return ""}
}
function normalizeResponseLinks(values){
  const seen=new Set(),links=[];
  for(const value of values){const href=writingHref(value);if(!href)continue;let parsed;try{parsed=new URL(href)}catch{throw new Error("Use complete http or https links.")}if(!["http:","https:"].includes(parsed.protocol))throw new Error("Use complete http or https links.");if(seen.has(parsed.href))continue;seen.add(parsed.href);const videoId=youtubeId(parsed.href);links.push({url:parsed.href,kind:videoId?"youtube":"external",youtubeId:videoId});if(links.length>5)throw new Error("Add no more than 5 links.")}
  return links;
}
async function responseFiles(form){
  const files=form.getAll("attachments").filter(item=>item instanceof File&&item.size>0);
  if(files.length>MAX_RESPONSE_FILES)throw new Error(`Upload no more than ${MAX_RESPONSE_FILES} files.`);
  if(files.reduce((sum,file)=>sum+file.size,0)>MAX_RESPONSE_TOTAL_BYTES)throw new Error("Attachments may total no more than 20 MB.");
  const validated=[];
  for(const file of files){
    if(file.size>MAX_RESPONSE_FILE_BYTES)throw new Error("Each attachment must be 10 MB or smaller.");
    const claimed=String(file.type||"").toLowerCase(),bytes=new Uint8Array(await file.arrayBuffer()),detected=detectedResponseType(bytes,claimed);
    if(!RESPONSE_TYPES.has(claimed)||!detected||detected!==claimed)throw new Error("Use a valid JPEG, PNG, WebP, GIF, PDF, text, DOC, or DOCX file.");
    validated.push({file,bytes,mimeType:detected,sha256:await sha256Bytes(bytes),kind:IMAGE_TYPES.has(detected)?"image":"file"});
  }
  return validated;
}
function responseSecurity(env){return {siteKey:responseText(env.WRITING_RESPONSE_TURNSTILE_SITE_KEY||env.CALENDAR_SUBMISSION_TURNSTILE_SITE_KEY,200),secret:responseText(env.WRITING_RESPONSE_TURNSTILE_SECRET||env.CALENDAR_SUBMISSION_TURNSTILE_SECRET,4096),hostnames:responseText(env.WRITING_RESPONSE_TURNSTILE_HOSTNAMES||env.CALENDAR_SUBMISSION_TURNSTILE_HOSTNAMES,2000),salt:responseText(env.WRITING_RESPONSE_RATE_LIMIT_SALT||env.CALENDAR_SUBMISSION_RATE_LIMIT_SALT,500)}}
async function validateResponseTurnstile(request,env,form){
  const hostname=new URL(request.url).hostname,token=responseText(form.get("cf-turnstile-response"),2048);
  if(env.WRITING_RESPONSE_TURNSTILE_TEST_BYPASS==="true"&&["localhost","127.0.0.1","example.test"].includes(hostname))return token==="test-pass";
  const security=responseSecurity(env),expected=new Set(security.hostnames.split(",").map(value=>value.trim()).filter(Boolean));
  if(!security.secret||!token||!expected.size)return false;
  try{const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:security.secret,response:token,remoteip:requestIp(request),idempotency_key:crypto.randomUUID()})});if(!response.ok)return false;const result=await response.json();return result.success===true&&result.action==="writing_respond"&&expected.has(result.hostname)}catch{return false}
}
async function enforceResponseRateLimit(database,request,env){
  const {salt}=responseSecurity(env);if(!salt)return false;
  const now=new Date(),windowStartedAt=new Date(Math.floor(now.getTime()/3_600_000)*3_600_000).toISOString(),identity=await sha256Bytes(new TextEncoder().encode(`${salt}:writing-response:${requestIp(request)}`));
  await statement(database,"DELETE FROM writing_response_rate_limits WHERE window_started_at<?",new Date(now.getTime()-86_400_000).toISOString()).run();
  await statement(database,`INSERT INTO writing_response_rate_limits(identity_hash,window_started_at,request_count,updated_at) VALUES(?,?,1,?) ON CONFLICT(identity_hash,window_started_at) DO UPDATE SET request_count=request_count+1,updated_at=excluded.updated_at`,identity,windowStartedAt,now.toISOString()).run();
  const row=await statement(database,"SELECT request_count FROM writing_response_rate_limits WHERE identity_hash=? AND window_started_at=?",identity,windowStartedAt).first();return Number(row?.request_count)<=8;
}
async function createResponse(request,env,database,entry,resolveEntities){
  const suppliedLength=Number(request.headers.get("content-length")||0);if(!suppliedLength||suppliedLength>MAX_RESPONSE_REQUEST_BYTES)return failure("The response upload is too large.",413);
  let form;try{form=await request.formData()}catch{return failure("Expected a response form.",415)}
  if(responseText(form.get("website"),500))return failure("Unable to accept this response.");
  const authorName=responseText(form.get("authorName"),160),body=responseText(form.get("body"),12000),idempotencyKey=responseText(request.headers.get("Idempotency-Key")||form.get("idempotencyKey"),200);
  if(!authorName)return failure("Add your name or alias.");if(!idempotencyKey)return failure("Refresh the page and try again.");
  const existing=await statement(database,"SELECT id FROM writing_responses WHERE idempotency_key=? AND entry_id=?",idempotencyKey,entry.entity_id).first();
  if(existing){const records=await responseRecords(database,entry,false,resolveEntities),record=records.find(item=>item.id===existing.id);return json({response:record,html:record?renderWritingResponse(record):"",repeated:true})}
  let links,files;try{links=normalizeResponseLinks(form.getAll("links"));files=await responseFiles(form)}catch(error){return failure(error.message,413)}
  if(!body&&!links.length&&!files.length)return failure("Write a response, add a link, or attach a file.");
  if(!(await validateResponseTurnstile(request,env,form)))return failure("Verification failed. Refresh and try again.",403);
  if(!(await enforceResponseRateLimit(database,request,env)))return failure("Too many responses. Try again later.",429);
  if(files.length&&!env.SUBMISSION_FILES)return failure("File storage is unavailable.",503);
  let responseId=id("writing-response");const now=new Date().toISOString(),stored=[];
  try{
    for(const [index,item] of files.entries()){
      const attachmentId=id("writing-attachment"),filename=safeFilename(item.file.name),key=`writing-responses/${entry.entity_id}/${responseId}/${attachmentId}-${filename}`;
      await env.SUBMISSION_FILES.put(key,item.bytes,{httpMetadata:{contentType:item.mimeType,cacheControl:"public, max-age=300"}});stored.push({attachmentId,key,filename,item,index});
    }
    const writes=[statement(database,`INSERT INTO writing_responses(id,entry_id,author_kind,author_name,body,state,idempotency_key,created_by,created_at,updated_at) VALUES(?,?,'visitor',?,?,'published',?,'public-response',?,?)`,responseId,entry.entity_id,authorName,body,idempotencyKey,now,now)];
    links.forEach((link,index)=>writes.push(statement(database,"INSERT INTO writing_response_links(id,response_id,url,link_kind,youtube_id,sort_order,created_at) VALUES(?,?,?,?,?,?,?)",id("writing-link"),responseId,link.url,link.kind,link.youtubeId||null,index,now)));
    stored.forEach(({attachmentId,key,filename,item,index})=>writes.push(statement(database,"INSERT INTO writing_response_attachments(id,response_id,storage_key,original_filename,mime_type,byte_size,sha256,attachment_kind,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",attachmentId,responseId,key,filename,item.mimeType,item.file.size,item.sha256,item.kind,index,now)));
    await database.batch(writes);
  }catch(error){for(const item of stored)await env.SUBMISSION_FILES?.delete(item.key).catch(()=>{});const concurrent=await statement(database,"SELECT id FROM writing_responses WHERE idempotency_key=?",idempotencyKey).first().catch(()=>null);if(!concurrent)return failure("The response could not be published. Nothing was saved.",500);responseId=concurrent.id}
  const records=await responseRecords(database,entry,false,resolveEntities),record=records.find(item=>item.id===responseId);return json({response:record,html:record?renderWritingResponse(record):""},{status:201});
}
async function responseMedia(request,env,database,entry,attachmentId,admin){
  const row=await statement(database,`SELECT attachment.* FROM writing_response_attachments attachment JOIN writing_responses response ON response.id=attachment.response_id WHERE attachment.id=? AND response.entry_id=? ${admin?"":"AND response.state='published' AND (response.parent_response_id IS NULL OR EXISTS(SELECT 1 FROM writing_responses parent WHERE parent.id=response.parent_response_id AND parent.state='published'))"}`,attachmentId,entry.entity_id).first();
  if(!row)return failure("Attachment not found.",404);const inline=IMAGE_TYPES.has(row.mime_type)||row.mime_type==="application/pdf";
  return serveR2Media(request,env.SUBMISSION_FILES,row,()=>failure("Attachment unavailable.",404),{cacheControl:admin?"private, no-store":"public, max-age=300",disposition:inline?"inline":"attachment"});
}
async function saveAuthorReply(database,entry,parentId,body,resolveEntities){
  const parent=await statement(database,"SELECT * FROM writing_responses WHERE id=? AND entry_id=? AND author_kind='visitor'",parentId,entry.entity_id).first();if(!parent)throw new Error("Visitor response not found.");
  const message=responseText(body.body,12000),authorName=responseText(body.authorName,160)||WRITING_AUTHOR,connections=Array.isArray(body.connections)?body.connections.slice(0,30):[];
  const normalized=connections.map(connection=>({targetId:responseText(connection.targetId,200),relationshipTypeId:responseText(connection.relationshipTypeId,200),note:responseText(connection.note,1000)}));
  if(!message&&!normalized.length)throw new Error("Write an author response or add a connection.");
  const cards=await connectionCards(database,normalized,resolveEntities,{admin:true,entryId:entry.entity_id});if(cards.length!==normalized.length)throw new Error("Choose valid Construct connections.");
  const targets=await resolveEntities(database,normalized.map(connection=>connection.targetId));if(targets.some(target=>target.visibility!=="public"||!writingHref(target.route)||["draft","archived","internal","private"].includes(target.state)))throw new Error("Author response connections need public destinations.");
  const typeIds=[...new Set(normalized.map(connection=>connection.relationshipTypeId))];if(typeIds.length){const types=(await statement(database,`SELECT id,public_visible FROM relationship_types WHERE id IN (${typeIds.map(()=>"?").join(",")})`,...typeIds).all()).results||[];if(types.length!==typeIds.length||types.some(type=>!type.public_visible))throw new Error("Choose public relationship types for author response connections.")}
  const existing=await statement(database,"SELECT * FROM writing_responses WHERE parent_response_id=? AND author_kind='author'",parentId).first(),replyId=existing?.id||id("writing-response"),now=new Date().toISOString();
  const writes=existing?[statement(database,"UPDATE writing_responses SET author_name=?,body=?,state='published',hidden_at=NULL,updated_at=? WHERE id=?",authorName,message,now,replyId)]:[statement(database,`INSERT INTO writing_responses(id,entry_id,parent_response_id,author_kind,author_name,body,state,created_by,created_at,updated_at) VALUES(?,?,?,'author',?,?,'published','studio',?,?)`,replyId,entry.entity_id,parentId,authorName,message,now,now)];
  writes.push(statement(database,"DELETE FROM writing_response_connections WHERE response_id=?",replyId));
  normalized.forEach((connection,index)=>writes.push(statement(database,"INSERT INTO writing_response_connections(id,response_id,target_entity_id,relationship_type_id,note,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'studio',?,?)",id("writing-response-connection"),replyId,connection.targetId,connection.relationshipTypeId,connection.note,index,now,now)));
  await database.batch(writes);return replyId;
}

export async function handleWritingApi(request, env, {resolveEntities = async()=>[]} = {}) {
  const path = new URL(request.url).pathname.replace(/\/$/,"");
  const isAdmin = path === "/api/admin/writing-entries" || path.startsWith("/api/admin/writing-entries/");
  if (!isAdmin && path !== "/api/writings/entries" && !path.startsWith("/api/writings/entries/")) return null;
  if (isAdmin) { const denied = requireStudioAdmin(request,env); if (denied) return denied; }
  const database = db(env);
  try {
    if (isAdmin && path === "/api/admin/writing-entries/sample-image" && ["GET","HEAD"].includes(request.method)) return new Response(request.method === "HEAD" ? null : '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#161616"/><rect x="40" y="40" width="920" height="520" fill="none" stroke="#fbdab1" stroke-width="5"/><text x="80" y="130" fill="#fbdab1" font-family="Georgia,serif" font-size="42">WRKNG*</text><text x="80" y="490" fill="#fbdab1" font-family="Georgia,serif" font-size="24">Reading layout sample · image placement</text></svg>',{headers:{"content-type":"image/svg+xml","cache-control":"private, no-store","x-content-type-options":"nosniff"}});
    const base = isAdmin ? "/api/admin/writing-entries" : "/api/writings/entries";
    const parts = path.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
    if (!isAdmin) {
      if (!parts.length) {
        if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
        const rows = (await database.prepare("SELECT w.* FROM writing_entries w JOIN content_entities ce ON ce.id=w.entity_id WHERE w.state='published' AND ce.visibility='public' AND w.is_sample=0 ORDER BY w.first_published_at DESC,w.entity_id").all()).results || [];
        return json({entries:rows.map(row=>summary(row))});
      }
      const row = await statement(database,"SELECT w.* FROM writing_entries w JOIN content_entities ce ON ce.id=w.entity_id WHERE w.slug=? AND w.state='published' AND ce.visibility='public' AND w.is_sample=0",parts[0]).first();
      if(!row)return failure("Entry not found.",404);
      if(parts.length===1&&["GET","HEAD"].includes(request.method))return json({entry:await payload(database,row,false,resolveEntities)});
      if(parts[1]==="responses"&&parts[2]==="config"&&parts.length===3&&request.method==="GET"){const security=responseSecurity(env);return json({siteKey:security.siteKey,action:"writing_respond",configured:Boolean(security.siteKey)})}
      if(parts[1]==="responses"&&parts[2]==="media"&&parts[3]&&parts.length===4&&["GET","HEAD"].includes(request.method))return responseMedia(request,env,database,row,parts[3],false);
      if(parts[1]==="responses"&&parts.length===2&&request.method==="POST")return createResponse(request,env,database,row,resolveEntities);
      return failure("Method not allowed.",405);
    }
    if (!parts.length) {
      if (request.method === "GET") return json({entries:((await database.prepare("SELECT * FROM writing_entries ORDER BY updated_at DESC,entity_id").all()).results || []).map(row=>summary(row,true))});
      if (request.method === "POST") return json({entry:await payload(database,await saveDraft(database,null,await bodyJSON(request),resolveEntities),true,resolveEntities)},{status:201});
      return failure("Method not allowed.",405);
    }
    const before = await rowById(database,parts[0]);
    if (!before) return failure("Entry not found.",404);
    const action = parts[1] || "";
    if(action==="responses"){
      if(parts[2]==="media"&&parts[3]&&parts.length===4&&["GET","HEAD"].includes(request.method))return responseMedia(request,env,database,before,parts[3],true);
      if(parts.length===2&&request.method==="GET")return json({responses:await responseRecords(database,before,true,resolveEntities)},{headers:{"cache-control":"private, no-store"}});
      const responseId=parts[2];if(!responseId)return failure("Response not found.",404);
      const response=await statement(database,"SELECT * FROM writing_responses WHERE id=? AND entry_id=?",responseId,before.entity_id).first();if(!response)return failure("Response not found.",404);
      if(parts.length===3&&request.method==="PATCH"){
        const body=await bodyJSON(request),state=body.state==="hidden"?"hidden":body.state==="published"?"published":"";if(!state)return failure("Choose published or hidden.");const now=new Date().toISOString();await statement(database,"UPDATE writing_responses SET state=?,hidden_at=?,updated_at=? WHERE id=?",state,state==="hidden"?now:null,now,responseId).run();return json({responses:await responseRecords(database,before,true,resolveEntities)});
      }
      if(parts.length===4&&parts[3]==="reply"&&request.method==="PUT"){
        if(response.author_kind!=="visitor")return failure("Choose a visitor response.",409);await saveAuthorReply(database,before,responseId,await bodyJSON(request),resolveEntities);return json({responses:await responseRecords(database,before,true,resolveEntities)});
      }
      return failure("Method not allowed.",405);
    }
    if(parts.length>2)return failure("Entry not found.",404);
    if (request.method === "GET" && (!action || action === "preview")) return json({entry:await payload(database,before,true,resolveEntities)},{headers:{"cache-control":"private, no-store"}});
    let row;
    if (!action && request.method === "PATCH") row = await saveDraft(database,before,await bodyJSON(request),resolveEntities);
    else if (request.method === "POST" && action === "publish") row = await publish(database,before,await bodyJSON(request),resolveEntities);
    else if (request.method === "POST" && ["unpublish","archive","restore"].includes(action)) row = await withdraw(database,before,await bodyJSON(request),action);
    else return failure("Method not allowed.",405);
    return json({entry:await payload(database,row,true,resolveEntities)});
  } catch (error) { return failure(/UNIQUE constraint failed: writing_entries.slug/i.test(error.message) ? "That URL is already used by another entry. Choose a different URL name." : error.message,errorStatus(error)); }
}
