import {db, failure, id, json, requireStudioAdmin, slug} from "../_shared/construct.js";
import {normalizeWritingSnapshot, writingImages, writingPlainText, writingHref, WRITING_ROOT} from "../../../shared/writing-content.js";

const SAMPLE_IMAGE = "writing-layout-sample-image";
const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/webp","image/gif"]);
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
async function payload(database, row, admin, resolveEntities) {
  const snapshot = JSON.parse(admin ? row.draft_json : row.published_json);
  const media = (await assets(database,snapshot)).filter(asset => asset.state === "active" && (admin || (asset.privacy === "public" && asset.public_presentation === "inline" && !asset.variant_master))).map(asset => ({id:asset.id,width:asset.width,height:asset.height,url:admin ? asset.id === SAMPLE_IMAGE ? "/api/admin/writing-entries/sample-image" : `/api/admin/media/${encodeURIComponent(asset.id)}/file` : `/api/construct/entity-media/${encodeURIComponent(asset.id)}`}));
  const related = (await resolveEntities(database,snapshot.relatedIds)).filter(entity => admin || (entity.visibility === "public" && writingHref(entity.route) && !["draft","archived","internal","private"].includes(entity.state))).map(entity => ({id:entity.id,title:entity.title,route:writingHref(entity.route)})).filter(entity=>entity.route);
  return {...summary(row,admin),snapshot,media,related};
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
  const related = await resolveEntities(database,snapshot.relatedIds);
  if (related.length !== snapshot.relatedIds.length || snapshot.relatedIds.includes(entryId)) throw new Error("Choose existing related Construct records other than this entry.");
  if (publish && related.some(entity => entity.visibility !== "public" || !writingHref(entity.route) || ["draft","archived","internal","private"].includes(entity.state))) throw new Error("Publish related records first, or remove them from this entry.");
  return {images,media,related};
}
async function saveDraft(database, before, body, resolveEntities) {
  const snapshot = normalizeWritingSnapshot(body.snapshot), draft = JSON.stringify(snapshot), now = new Date().toISOString();
  // Only creation accepts the editor's first-edit timestamp. Clock skew or an
  // older client must never prevent the author from saving their writing.
  const start = typeof body.startedAt === "string" ? Date.parse(body.startedAt) : NaN;
  const startedAt = before ? before.started_at : Number.isFinite(start) ? new Date(Math.min(start,Date.parse(now))).toISOString() : null;
  const savedAt = new Date(Math.max(Date.parse(now),Date.parse(before?.draft_saved_at || "")+1 || 0)).toISOString();
  const entryId = before?.entity_id || id("writing"), nextSlug = entrySlug(body.slug || before?.slug || slug(snapshot.title) || entryId);
  if (before && Number(body.version) !== before.version) throw new Error("Save conflict: this entry changed in another window. Reload it before saving.");
  if (before?.first_published_at && before.slug !== nextSlug) throw new Error("A published WRKNG URL cannot change.");
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
  const {images,media} = await validateReferences(database,snapshot,{publish:true,resolveEntities,entryId:before.entity_id});
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
  for (const [index,targetId] of snapshot.relatedIds.entries()) writes.push(statement(database,`INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,sort_order,created_by,created_at,updated_at)
    VALUES(?,?,?,'rel-related-to',1,?,'writing-publisher',?,?)
    ON CONFLICT(source_entity_id,target_entity_id,relationship_type_id) DO UPDATE SET public_visible=1,sort_order=excluded.sort_order,updated_at=excluded.updated_at`,id("connection"),before.entity_id,targetId,index,now,now));
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
      if (!["GET","HEAD"].includes(request.method)) return failure("Method not allowed.",405);
      if (!parts.length) {
        const rows = (await database.prepare("SELECT w.* FROM writing_entries w JOIN content_entities ce ON ce.id=w.entity_id WHERE w.state='published' AND ce.visibility='public' AND w.is_sample=0 ORDER BY w.first_published_at DESC,w.entity_id").all()).results || [];
        return json({entries:rows.map(row=>summary(row))});
      }
      if (parts.length !== 1) return failure("Entry not found.",404);
      const row = await statement(database,"SELECT w.* FROM writing_entries w JOIN content_entities ce ON ce.id=w.entity_id WHERE w.slug=? AND w.state='published' AND ce.visibility='public' AND w.is_sample=0",parts[0]).first();
      return row ? json({entry:await payload(database,row,false,resolveEntities)}) : failure("Entry not found.",404);
    }
    if (!parts.length) {
      if (request.method === "GET") return json({entries:((await database.prepare("SELECT * FROM writing_entries ORDER BY updated_at DESC,entity_id").all()).results || []).map(row=>summary(row,true))});
      if (request.method === "POST") return json({entry:await payload(database,await saveDraft(database,null,await bodyJSON(request),resolveEntities),true,resolveEntities)},{status:201});
      return failure("Method not allowed.",405);
    }
    if (parts.length > 2) return failure("Entry not found.",404);
    const before = await rowById(database,parts[0]);
    if (!before) return failure("Entry not found.",404);
    const action = parts[1] || "";
    if (request.method === "GET" && (!action || action === "preview")) return json({entry:await payload(database,before,true,resolveEntities)},{headers:{"cache-control":"private, no-store"}});
    let row;
    if (!action && request.method === "PATCH") row = await saveDraft(database,before,await bodyJSON(request),resolveEntities);
    else if (request.method === "POST" && action === "publish") row = await publish(database,before,await bodyJSON(request),resolveEntities);
    else if (request.method === "POST" && ["unpublish","archive","restore"].includes(action)) row = await withdraw(database,before,await bodyJSON(request),action);
    else return failure("Method not allowed.",405);
    return json({entry:await payload(database,row,true,resolveEntities)});
  } catch (error) { return failure(/UNIQUE constraint failed: writing_entries.slug/i.test(error.message) ? "That URL is already used by another entry. Choose a different URL name." : error.message,errorStatus(error)); }
}
