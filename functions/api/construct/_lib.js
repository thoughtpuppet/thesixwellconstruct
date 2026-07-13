import { db, entityMedia, failure, id, json, nextRevision, parseJson, readJson, requireStudioAdmin, RESOURCE_CONFIG, slug, text } from "../_shared/construct.js";

function normalizeRecord(config, body, existing = {}) {
  const out = {};
  for (const field of config.fields) {
    if (!(field in body)) continue;
    if (["sort_order","claimable","acquisition_eligible","homepage_enabled"].includes(field)) out[field] = Number(body[field]) || 0;
    else if (field.endsWith("_json")) out[field] = typeof body[field] === "string" ? body[field] : JSON.stringify(body[field] ?? []);
    else out[field] = text(body[field], field === "svg_markup" || field === "body" || field === "body_html" ? 50000 : 8000);
  }
  if (config.fields.includes("slug") && !out.slug && !existing.slug) out.slug = slug(body.title || body.name);
  if (out.state && !config.states.includes(out.state)) throw new Error(`Invalid state: ${out.state}`);
  if (config.entityType === "construct_node" && out.homepage_enabled && out.state === "published") out.homepage_enabled = 1;
  return out;
}

function publicState(resource) {
  if (resource === "flash") return "state IN ('available','reserved','placed','retired')";
  return "state='published'";
}

async function publicCatalog(request, env, resource, recordSlug = "") {
  const config = RESOURCE_CONFIG[resource];
  if (!config) return failure("Unknown catalog.", 404);
  const database = db(env);
  const acquisitionOnly = resource === "art" && new URL(request.url).searchParams.get("acquisition") === "1";
  const baseWhere = `${publicState(resource)}${acquisitionOnly ? " AND acquisition_eligible=1 AND availability='available'" : ""}`;
  const where = recordSlug ? `${baseWhere} AND slug=?` : baseWhere;
  const statement = database.prepare(`SELECT * FROM ${config.table} WHERE ${where} ORDER BY sort_order,id`);
  const result = recordSlug ? await statement.bind(recordSlug).all() : await statement.all();
  const rows = result.results || [];
  const media = await entityMedia(database, rows.map((row) => row.id));
  const records = rows.map((row) => ({ ...row, themes: parseJson(row.themes_json), examples: parseJson(row.examples_json), media: media.get(row.id) || [] }));
  if (recordSlug && !records[0]) return failure("Not found.", 404);
  return json(recordSlug ? { record: records[0] } : { records, count: records.length }, { cache: "public, max-age=60" });
}

async function publicNavigation(env) {
  const database = db(env);
  const nodes = (await database.prepare("SELECT id,name,slug,route,color,sort_order,updated_at FROM construct_nodes WHERE state='published' AND homepage_enabled=1 ORDER BY sort_order").all()).results || [];
  const paths = (await database.prepare("SELECT id,node_id,name,route,color,sort_order,updated_at FROM construct_pathways WHERE state='published' AND homepage_enabled=1 ORDER BY node_id,sort_order").all()).results || [];
  for (const node of nodes) node.pathways = paths.filter((p) => p.node_id === node.id);
  return json({ revision: nodes.reduce((v,n) => n.updated_at > v ? n.updated_at : v, ""), nodes }, { cache: "public, max-age=60" });
}

async function publicSearch(request, env) {
  const url = new URL(request.url); const q = text(url.searchParams.get("q"), 200); const type = text(url.searchParams.get("type"), 80); const node = text(url.searchParams.get("node"), 80);
  const filters = []; const values = [];
  if (type) { filters.push("d.entity_type=?"); values.push(type); }
  if (node) { filters.push("d.node_id=?"); values.push(node); }
  for (const [param,column] of [["state","state"],["date","date_label"]]) { const value=text(url.searchParams.get(param),120); if(value){filters.push(`d.${column}=?`);values.push(value);} }
  for (const [param,column] of [["collection","collection_labels"],["theme","theme_labels"],["person","person_labels"],["place","place_labels"]]) { const value=text(url.searchParams.get(param),120); if(value){filters.push(`d.${column} LIKE ?`);values.push(`%${value}%`);} }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const sql = q ? `SELECT d.*,bm25(search_documents_fts) rank FROM search_documents_fts f JOIN search_documents d ON d.rowid=f.rowid WHERE search_documents_fts MATCH ? ${where} ORDER BY rank LIMIT 100` : `SELECT d.*,0 rank FROM search_documents d WHERE 1=1 ${where} ORDER BY updated_at DESC LIMIT 100`;
  const args = q ? [q, ...values] : values;
  const rows = (await db(env).prepare(sql).bind(...args).all()).results || [];
  return json({ records: rows, count: rows.length, query: q }, { cache: "public, max-age=30" });
}

async function adminList(env, resource) {
  const config = RESOURCE_CONFIG[resource]; if (!config) return failure("Unknown resource.", 404);
  const rows = (await db(env).prepare(`SELECT * FROM ${config.table} ORDER BY sort_order,id`).all()).results || [];
  const media = await entityMedia(db(env), rows.map((row) => row.id));
  return json({ records: rows.map((row) => ({ ...row, media: media.get(row.id) || [] })), count: rows.length });
}

async function adminCreate(request, env, resource) {
  const config = RESOURCE_CONFIG[resource]; const body = await readJson(request); if (!config || !body) return failure("Invalid request.");
  const database = db(env); const recordId = text(body.id, 160) || id(config.entityType); const values = normalizeRecord(config, body);
  if (resource === "nodes" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_nodes WHERE homepage_enabled=1").first(); if (Number(c?.c || 0) >= 9) return failure("Homepage node capacity is 9.", 409); }
  if (resource === "pathways" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_pathways WHERE node_id=? AND homepage_enabled=1").bind(values.node_id).first(); if (Number(c?.c || 0) >= 9) return failure("Pathway capacity is 9 per node.", 409); }
  const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  await database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId,config.entityType,values.node_id || null,"internal").run();
  await database.prepare(`INSERT INTO ${config.table}(id,${keys.join(",")},created_at,updated_at) VALUES(?,${keys.map(()=>"?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...keys.map(k=>values[k])).run();
  const created = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first(); await nextRevision(database,recordId,"create",null,created); return json({ record: created },{status:201});
}

async function adminUpdate(request, env, resource, recordId, archive = false) {
  const config = RESOURCE_CONFIG[resource]; const body = archive ? { state: "archived" } : await readJson(request); if (!config || !body) return failure("Invalid request.");
  const database = db(env); const before = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first(); if (!before) return failure("Not found.",404);
  const values = normalizeRecord(config,body,before); const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  await database.prepare(`UPDATE ${config.table} SET ${keys.map(k=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...keys.map(k=>values[k]),recordId).run();
  const after = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  const visible = ["published","available","reserved","placed","retired"].includes(after.state);
  await database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,archived_at=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(visible?"public":"internal",visible?1:0,after.state==="archived"?new Date().toISOString():null,visible?1:0,recordId).run();
  await nextRevision(database,recordId,archive?"archive":"update",before,after); return json({record:after});
}

async function reorder(request, env, resource) {
  const config=RESOURCE_CONFIG[resource]; const body=await readJson(request); if(!config||!Array.isArray(body?.ids)) return failure("ids must be an array.");
  const database=db(env); if(body.expected_updated_at){const latest=await database.prepare(`SELECT MAX(updated_at) v FROM ${config.table}`).first();if(latest?.v&&latest.v!==body.expected_updated_at)return failure("Order changed in another session. Refresh and retry.",409,{latest:latest.v});}
  await database.batch(body.ids.map((recordId,index)=>database.prepare(`UPDATE ${config.table} SET sort_order=?,updated_at=datetime('now') WHERE id=?`).bind(index+1,recordId)));
  return json({ok:true});
}

async function mediaApi(request, env, mediaId="") {
  const database=db(env);
  if(request.method==="GET"){ if(mediaId){const row=await database.prepare("SELECT * FROM media_assets WHERE id=? AND state='active'").bind(mediaId).first();if(!row)return failure("Not found.",404);if(row.source_url)return Response.redirect(new URL(row.source_url,request.url),302);const object=await env.SUBMISSION_FILES?.get(row.storage_key);if(!object)return failure("Media unavailable.",404);return new Response(object.body,{headers:{"content-type":row.mime_type||"application/octet-stream","cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}});} const rows=(await database.prepare("SELECT * FROM media_assets ORDER BY created_at DESC").all()).results||[];return json({records:rows,count:rows.length}); }
  if(request.method==="PATCH"&&mediaId){const body=await readJson(request);const state=body?.state==="active"?"active":"archived";await database.prepare("UPDATE media_assets SET state=?,updated_at=datetime('now') WHERE id=?").bind(state,mediaId).run();return json({record:await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first()});}
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||!file.size)return failure("A file is required.");
  const mime=(file.type||"application/octet-stream").toLowerCase();const image=["image/jpeg","image/png","image/webp"].includes(mime);const doc=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mime);const av=mime.startsWith("audio/")||mime.startsWith("video/");const max=av?50*1024*1024:15*1024*1024;if(!(image||doc||av))return failure("Unsupported media type.",415);if(file.size>max)return failure("File exceeds the allowed size.",413);if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
  const newId=id("media");const key=`construct/${newId}/${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.SUBMISSION_FILES.put(key,file.stream(),{httpMetadata:{contentType:mime}});
  try{await database.prepare("INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,alt_text,caption,privacy,consent_status,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active','studio',datetime('now'),datetime('now'))").bind(newId,key,file.name,mime,file.size,text(form.get("alt_text"),1000),text(form.get("caption"),3000),text(form.get("privacy"),30)||"internal",text(form.get("consent_status"),30)||"unknown").run();}catch(error){await env.SUBMISSION_FILES.delete(key);throw error;}return json({record:await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(newId).first()},{status:201});
}

async function relationshipApi(request,env){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT er.*,rt.forward_label,rt.reverse_label FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id ORDER BY er.created_at DESC").all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);if(!b?.source_entity_id||!b?.target_entity_id||!b?.relationship_type_id)return failure("Source, target, and relationship type are required.");const relId=id("relationship");await database.prepare("INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))").bind(relId,b.source_entity_id,b.target_entity_id,b.relationship_type_id,b.public_visible?1:0,text(b.internal_notes,5000),Number(b.sort_order)||0).run();return json({record:await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relId).first()},{status:201});}

async function taxonomyApi(request,env){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT * FROM taxonomy_terms ORDER BY kind,sort_order,name").all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);const kind=b?.kind==="theme"?"theme":"tag";const name=text(b?.name,160);if(!name)return failure("A term name is required.");const termId=text(b.id,160)||id("term");await database.prepare("INSERT INTO taxonomy_terms(id,kind,name,slug,description,public_visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(termId,kind,name,slug(b.slug||name),text(b.description,2000),b.public_visible===false?0:1,Number(b.sort_order)||0).run();return json({record:await database.prepare("SELECT * FROM taxonomy_terms WHERE id=?").bind(termId).first()},{status:201});}

async function entityMediaApi(request,env,entityId){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT em.*,m.original_filename,m.source_url,m.storage_key,m.mime_type FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.entity_id=? ORDER BY em.sort_order").bind(entityId).all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);if(!b?.media_id)return failure("media_id is required.");await database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,b.media_id,text(b.role,60)||"gallery",Number(b.sort_order)||0,b.public_visible?1:0,text(b.alt_text_override,1000),text(b.caption_override,3000)).run();return json({ok:true},{status:201});}

async function eventArchive(request,env,eventId){const database=db(env);const existing=await database.prepare("SELECT * FROM archive_records WHERE source_event_id=?").bind(eventId).first();if(existing)return json({record:existing,created:false});const event=await database.prepare("SELECT id,slug,title,description,starts_at,ends_at,location,status FROM events WHERE id=?").bind(eventId).first();if(!event)return failure("Event not found.",404);const attendance=await database.prepare("SELECT COALESCE(SUM(seats),0) total FROM event_tickets WHERE event_id=? AND status='paid'").bind(eventId).first();const recordId=`archive-event-${event.id}`;await database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_record','archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId).run();await database.prepare("INSERT INTO archive_records(id,slug,source_event_id,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,aggregate_attendance,created_at,updated_at) VALUES(?,?,?,?,?,'event','Events',?,?,?,?,'event handoff','draft',?,datetime('now'),datetime('now'))").bind(recordId,`event-${event.slug}`,event.id,event.title,'The Six.Well Construct',event.starts_at||'',event.starts_at||'',event.description||'',event.description||'',Number(attendance?.total||0)).run();const record=await database.prepare("SELECT * FROM archive_records WHERE id=?").bind(recordId).first();await nextRevision(database,recordId,"event-archive-handoff",null,record);return json({record,created:true},{status:201});}

export async function handleConstructApi(request,env){
  const url=new URL(request.url);const path=url.pathname;
  if(path==="/api/site/navigation")return publicNavigation(env);
  if(path==="/api/search")return publicSearch(request,env);
  const mediaPublic=path.match(/^\/api\/construct\/media\/([^/]+)$/);if(mediaPublic)return mediaApi(request,env,decodeURIComponent(mediaPublic[1]));
  const publicMatch=path.match(/^\/api\/(flash|visual-language|art|archive)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,publicMatch[1],publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  if(path==="/api/admin/relationships")return relationshipApi(request,env);
  if(path==="/api/admin/taxonomy")return taxonomyApi(request,env);
  const entityMediaMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media$/);if(entityMediaMatch)return entityMediaApi(request,env,decodeURIComponent(entityMediaMatch[1]));
  if(path==="/api/admin/revisions"&&request.method==="GET"){const rows=(await db(env).prepare("SELECT * FROM entity_revisions ORDER BY created_at DESC LIMIT 250").all()).results||[];return json({records:rows,count:rows.length});}
  if(path==="/api/admin/search/status"&&request.method==="GET"){const counts=await db(env).prepare("SELECT COUNT(*) documents FROM search_documents").first();const failures=await db(env).prepare("SELECT COUNT(*) failures FROM search_index_failures WHERE resolved_at IS NULL").first();return json({...counts,...failures});}
  const reorderMatch=path.match(/^\/api\/admin\/([^/]+)\/reorder$/);if(reorderMatch&&request.method==="POST")return reorder(request,env,reorderMatch[1]);
  const match=path.match(/^\/api\/admin\/([^/]+)(?:\/([^/]+))?$/);if(!match)return failure("Unknown Construct API route.",404);const resource=match[1],recordId=match[2]?decodeURIComponent(match[2]):"";
  if(!recordId&&request.method==="GET")return adminList(env,resource);if(!recordId&&request.method==="POST")return adminCreate(request,env,resource);if(recordId&&request.method==="PATCH")return adminUpdate(request,env,resource,recordId);if(recordId&&request.method==="DELETE")return adminUpdate(request,env,resource,recordId,true);return failure("Method not allowed.",405);
}
