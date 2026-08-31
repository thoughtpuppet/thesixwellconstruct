import { db, failure, id, json, readJson, slug, text } from "../_shared/construct.js";
import { serveR2Media } from "../_shared/r2-media.js";

const GALLERY_STATES = new Set(["draft", "published", "hidden", "archived"]);
const RIGHTS_STATES = new Set(["unreviewed", "owned", "permission", "licensed", "public-domain", "restricted"]);
const DATE_PRECISIONS = new Set(["unreviewed", "undated", "year", "approximate", "exact", "range"]);
const ACCESSIBILITY_STATES = new Set(["unreviewed", "described", "captioned", "transcribed", "silent", "ambient"]);
const SET_TYPES = new Set(["series", "session"]);
const SET_STATES = new Set(["draft", "published", "archived"]);
const SOURCE_CLASSES = new Set(["creative", "site_asset"]);
const REVIEW_STATES = new Set(["unreviewed", "reviewed", "redacted"]);
const ORIGINALITY_STATES = new Set(["sixwell_original", "collaborative_original", "external_source", "unknown"]);
const ASSET_ROLES = new Set(["creative_master", "editorial_fragment", "technical_derivative", "site_asset", "operational", "reference", "unclassified"]);
const CREATOR_HANDOFF_TYPES = new Set([
  "cultural-object", "art", "merch", "tattoo-design", "flash", "event", "legend-symbol", "person",
  "place", "organization", "note", "failed-experiment", "blackboard", "origin-thread", "collection", "timeline",
]);

function accession(number) {
  const value = Number(number);
  return value > 0 ? `MED-${String(value).padStart(6, "0")}` : "";
}

function accessionNumber(value) {
  const match = /^MED-(\d{6,})$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) : 0;
}

function fileStem(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mediaType(mime = "") {
  const value = String(mime).toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (value === "application/pdf") return "pdf";
  return "document";
}

function safeJson(value, fallback = {}) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function uniqueIds(value, maximum = 100) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 200)).filter(Boolean))].slice(0, maximum);
}

const ADMIN_MEDIA_SQL = `SELECT
  m.*,catalogue.catalogue_id,catalogue.entity_id media_entity_id,catalogue.source_class,catalogue.catalogue_state,
  catalogue.admission_basis,catalogue.source_entity_id,catalogue.manual_gallery_approved,
  provenance.sha256,provenance.originality,provenance.asset_role,provenance.creator_credit,
  provenance.original_format,provenance.import_source,provenance.embedded_capture_at,provenance.embedded_capture_timezone,
  provenance.camera_make,provenance.camera_model,provenance.editing_software,provenance.orientation,provenance.color_profile,
  provenance.metadata_review_state,provenance.raw_metadata_json,provenance.updated_at catalogue_updated_at,
  gallery.display_media_id,gallery.poster_media_id,gallery.title gallery_title,
  gallery.accessibility_text,gallery.accessibility_status,gallery.caption gallery_caption,gallery.credit gallery_credit,
  gallery.rights_status,gallery.date_precision gallery_date_precision,gallery.date_label gallery_date_label,
  gallery.occurred_at gallery_occurred_at,gallery.ended_at gallery_ended_at,gallery.focal_x,gallery.focal_y,
  gallery.state gallery_state,gallery.published_at gallery_published_at,gallery.updated_at gallery_updated_at,
  (SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=m.id AND purpose='public-display') variant_derivative_media_id,
  (SELECT COUNT(*) FROM entity_media attachment WHERE attachment.media_id=m.id) attachment_count,
  (SELECT COUNT(*) FROM entity_relationships relation WHERE relation.source_entity_id=catalogue.entity_id OR relation.target_entity_id=catalogue.entity_id) relationship_count
FROM media_assets m
LEFT JOIN media_asset_provenance provenance ON provenance.media_id=m.id
LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=m.id AND catalogue.catalogue_state='active'
LEFT JOIN gallery_entries gallery ON gallery.media_id=m.id`;

function presentAdminMedia(row) {
  if (!row) return null;
  const previewMediaId = row.display_media_id || row.variant_derivative_media_id || row.id;
  const record = {
    ...row,
    accession: accession(row.catalogue_id),
    media_type: mediaType(row.mime_type),
    admin_url: `/api/admin/media/${encodeURIComponent(previewMediaId)}/file`,
    raw_metadata: safeJson(row.raw_metadata_json),
    gallery: row.gallery_state ? {
      media_id: row.id,
      display_media_id: row.display_media_id,
      poster_media_id: row.poster_media_id,
      title: row.gallery_title,
      accessibility_text: row.accessibility_text,
      accessibility_status: row.accessibility_status,
      caption: row.gallery_caption,
      credit: row.gallery_credit,
      rights_status: row.rights_status,
      date_precision: row.gallery_date_precision,
      date_label: row.gallery_date_label,
      occurred_at: row.gallery_occurred_at,
      ended_at: row.gallery_ended_at,
      focal_x: Number(row.focal_x ?? 0.5),
      focal_y: Number(row.focal_y ?? 0.5),
      state: row.gallery_state,
      published_at: row.gallery_published_at,
      updated_at: row.gallery_updated_at,
    } : null,
  };
  for (const key of ["raw_metadata_json", "gallery_title", "gallery_caption", "gallery_credit", "gallery_date_precision", "gallery_date_label", "gallery_occurred_at", "gallery_ended_at", "gallery_state", "gallery_published_at", "gallery_updated_at"]) delete record[key];
  return record;
}

async function adminMediaRow(database, mediaId) {
  return database.prepare(`${ADMIN_MEDIA_SQL} WHERE m.id=?`).bind(mediaId).first();
}

function canAdmitOriginal(row, manualApproval = false) {
  if (!row || !["creative_master", "editorial_fragment"].includes(row.asset_role)) return false;
  if (row.originality === "sixwell_original") return true;
  return row.originality === "collaborative_original" && manualApproval && Boolean(text(row.creator_credit || row.credit, 500));
}

async function admitOriginalMedia(database, mediaId, options = {}) {
  const source = await adminMediaRow(database, mediaId);
  if (!source) throw new Error("Media Asset not found.");
  const manualApproval = Boolean(options.manualApproval || Number(source.manual_gallery_approved));
  if (!canAdmitOriginal(source, manualApproval)) {
    throw new Error("Classify this as a Six.Well original, or credit and manually approve a collaborative original, before admitting it.");
  }
  const basis = ["direct", "record", "editorial", "manual"].includes(options.basis) ? options.basis : "manual";
  const sourceEntityId = text(options.sourceEntityId, 200) || null;
  const entityId = source.media_entity_id || `media-catalogue-${mediaId}`;
  const display = await database.prepare("SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=? AND purpose='public-display'").bind(mediaId).first();
  const displayMediaId = display?.derivative_media_id || mediaId;
  const suggestedTitle = text(source.public_title, 300) || fileStem(source.original_filename) || `Untitled ${mediaType(source.mime_type)}`;
  const state = options.publish === false ? "draft" : "published";
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO content_entities
      (id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
      VALUES(?,'media_asset',NULL,'internal',0,0,'','studio','studio',datetime('now'),datetime('now'))`).bind(entityId),
    database.prepare(`INSERT INTO media_catalogue_entries
      (media_id,entity_id,source_class,sha256,original_format,import_source,embedded_capture_at,embedded_capture_timezone,
       camera_make,camera_model,editing_software,orientation,color_profile,metadata_review_state,raw_metadata_json,
       catalogue_state,admission_basis,source_entity_id,manual_gallery_approved,created_by,updated_by,created_at,updated_at)
      SELECT provenance.media_id,?,'creative',provenance.sha256,provenance.original_format,provenance.import_source,
       provenance.embedded_capture_at,provenance.embedded_capture_timezone,provenance.camera_make,provenance.camera_model,
       provenance.editing_software,provenance.orientation,provenance.color_profile,provenance.metadata_review_state,
       provenance.raw_metadata_json,'active',?,?,?,'studio','studio',datetime('now'),datetime('now')
      FROM media_asset_provenance provenance WHERE provenance.media_id=?
      ON CONFLICT(media_id) DO UPDATE SET catalogue_state='active',admission_basis=excluded.admission_basis,
       source_entity_id=COALESCE(excluded.source_entity_id,media_catalogue_entries.source_entity_id),
       manual_gallery_approved=MAX(media_catalogue_entries.manual_gallery_approved,excluded.manual_gallery_approved),
       updated_by='studio',updated_at=datetime('now')`).bind(entityId,basis,sourceEntityId,manualApproval?1:0,mediaId),
    database.prepare(`INSERT INTO gallery_entries
      (media_id,display_media_id,title,accessibility_text,caption,credit,date_precision,state,published_at,
       publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
      SELECT media.id,?,COALESCE(NULLIF(trim(media.public_title),''),?),media.alt_text,media.caption,
       COALESCE(NULLIF(trim(provenance.creator_credit),''),media.credit),'undated',?,
       CASE WHEN ?='published' THEN datetime('now') ELSE NULL END,?,?,'studio','studio',datetime('now'),datetime('now')
      FROM media_assets media JOIN media_asset_provenance provenance ON provenance.media_id=media.id WHERE media.id=?
      ON CONFLICT(media_id) DO UPDATE SET display_media_id=excluded.display_media_id,
       title=CASE WHEN trim(gallery_entries.title)='' THEN excluded.title ELSE gallery_entries.title END,
       credit=CASE WHEN trim(gallery_entries.credit)='' THEN excluded.credit ELSE gallery_entries.credit END,
       state=excluded.state,published_at=CASE WHEN excluded.state='published' THEN COALESCE(gallery_entries.published_at,datetime('now')) ELSE gallery_entries.published_at END,
       publication_basis=excluded.publication_basis,source_entity_id=COALESCE(excluded.source_entity_id,gallery_entries.source_entity_id),
       updated_by='studio',updated_at=datetime('now')`).bind(displayMediaId,suggestedTitle,state,state,basis,sourceEntityId,mediaId),
    database.prepare(`INSERT INTO media_archive_admission_reviews
      (media_id,prior_catalogue_id,prior_gallery_state,review_state,suggested_reason,reviewed_by,reviewed_at,created_at,updated_at)
      VALUES(?,NULL,NULL,'admitted','Admitted as original Gallery media','studio',datetime('now'),datetime('now'),datetime('now'))
      ON CONFLICT(media_id) DO UPDATE SET review_state='admitted',suggested_reason=excluded.suggested_reason,
       reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now')`).bind(mediaId),
  ]);
  if (sourceEntityId) {
    await database.prepare(`INSERT INTO entity_relationships
      (id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
      VALUES(?,?,?,'rel-documents',?,'Original media admitted through its owning Archive record.',0,'studio',datetime('now'),datetime('now'))
      ON CONFLICT(source_entity_id,target_entity_id,relationship_type_id) DO UPDATE SET
       public_visible=MAX(entity_relationships.public_visible,excluded.public_visible),updated_at=datetime('now')`)
      .bind(id("relationship"),entityId,sourceEntityId,options.publicVisible?1:0).run();
  }
  return presentAdminMedia(await adminMediaRow(database, mediaId));
}

async function recordAdmissionSource(database, mediaId) {
  return database.prepare(`SELECT entity_id,public_visible FROM (
      SELECT attachment.entity_id,attachment.public_visible FROM entity_media attachment WHERE attachment.media_id=?
      UNION ALL
      SELECT material.dossier_entity_id,CASE WHEN material.state='published' AND material.visibility='public' THEN 1 ELSE 0 END
        FROM archive_materials material WHERE material.media_id=?
      UNION ALL
      SELECT note_asset.note_entity_id,note_asset.public_visible FROM archive_note_assets note_asset WHERE note_asset.media_id=?
    ) ORDER BY public_visible DESC,entity_id LIMIT 1`).bind(mediaId,mediaId,mediaId).first();
}

async function hydrateAdminAssociations(database, records) {
  if (!records.length) return records;
  const lensRows=[],setRows=[],relationRows=[];
  for(let offset=0;offset<records.length;offset+=75){
    const mediaIds=records.slice(offset,offset+75).map((record)=>record.id),placeholders=mediaIds.map(()=>"?").join(",");
    const [lensResult,setResult,relationResult]=await Promise.all([
      database.prepare(`SELECT assignment.media_id,lens.id,lens.slug,lens.name,lens.sort_order
        FROM gallery_entry_lenses assignment JOIN gallery_lenses lens ON lens.id=assignment.lens_id
        WHERE assignment.media_id IN (${placeholders}) ORDER BY assignment.media_id,assignment.sort_order,lens.sort_order`).bind(...mediaIds).all(),
      database.prepare(`SELECT item.media_id,set_record.id,set_record.slug,set_record.title,set_record.set_type,set_record.state,item.sort_order
        FROM gallery_set_items item JOIN gallery_sets set_record ON set_record.id=item.set_id
        WHERE item.media_id IN (${placeholders}) ORDER BY item.media_id,item.sort_order,set_record.title`).bind(...mediaIds).all(),
      database.prepare(`SELECT catalogue.media_id,relation.id,relation.source_entity_id,relation.target_entity_id,
          relation.relationship_type_id,relation.public_visible,relation.sort_order,
          type.forward_label,type.reverse_label,
          CASE WHEN relation.source_entity_id=catalogue.entity_id THEN relation.target_entity_id ELSE relation.source_entity_id END connected_entity_id
        FROM media_catalogue_entries catalogue JOIN entity_relationships relation
          ON relation.source_entity_id=catalogue.entity_id OR relation.target_entity_id=catalogue.entity_id
        JOIN relationship_types type ON type.id=relation.relationship_type_id
        WHERE catalogue.media_id IN (${placeholders}) ORDER BY catalogue.media_id,relation.sort_order,relation.created_at`).bind(...mediaIds).all(),
    ]);
    lensRows.push(...(lensResult.results||[]));setRows.push(...(setResult.results||[]));relationRows.push(...(relationResult.results||[]));
  }
  const byMedia = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.media_id) || [];
      list.push(row);
      map.set(row.media_id, list);
    }
    return map;
  };
  const lenses = byMedia(lensRows), sets = byMedia(setRows), relationships = byMedia(relationRows);
  return records.map((record) => ({ ...record, lenses: lenses.get(record.id) || [], sets: sets.get(record.id) || [], relationships: relationships.get(record.id) || [] }));
}

export async function handleMediaCatalogueAdmin(request, env, path) {
  const libraryView = path.startsWith("/api/admin/media-library");
  const preflight = path === "/api/admin/media-catalogue/preflight" || path === "/api/admin/media-library/preflight";
  const admissionReview = path === "/api/admin/media-admission-review";
  const createHandoffMatch = path.match(/^\/api\/admin\/media-catalogue\/([^/]+)\/handoffs$/);
  const handoffMatch = path.match(/^\/api\/admin\/media-handoffs\/([^/]+)(?:\/(complete))?$/);
  const match = path.match(/^\/api\/admin\/(?:media-catalogue|media-library)(?:\/([^/]+))?(?:\/(link))?$/);
  if (!match && !preflight && !admissionReview && !createHandoffMatch && !handoffMatch) return null;
  const database = db(env);
  if (preflight) {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    const body = await readJson(request); if (!body) return failure("Send a JSON object.");
    const hash = text(body.sha256,64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return failure("SHA-256 must contain 64 lowercase hexadecimal characters.");
    const duplicate = await database.prepare("SELECT media_id FROM media_asset_provenance WHERE sha256=?").bind(hash).first();
    if (!duplicate) return json({ duplicate:false, sha256:hash });
    const record = presentAdminMedia(await adminMediaRow(database,duplicate.media_id));
    return json({ duplicate:true, sha256:hash, record:(await hydrateAdminAssociations(database,[record]))[0] });
  }
  if (admissionReview) {
    if (request.method === "GET") {
      const rows = (await database.prepare(`${ADMIN_MEDIA_SQL}
        JOIN media_archive_admission_reviews review ON review.media_id=m.id
        WHERE review.review_state IN ('pending','deferred')
        ORDER BY review.prior_catalogue_id,m.created_at,m.id LIMIT 1000`).all()).results || [];
      const records = await hydrateAdminAssociations(database, rows.map(presentAdminMedia));
      return json({ records, count:records.length });
    }
    if (request.method === "POST") {
      const body=await readJson(request),mediaIds=uniqueIds(body?.media_ids,500),action=text(body?.action,40);
      if(!mediaIds.length)return failure("Select at least one media item.");
      if(!["admit","exclude","defer"].includes(action))return failure("Choose admit, exclude, or defer.");
      const admitted=[],excluded=[],deferred=[],failed=[];
      for(const mediaId of mediaIds){
        try{
          if(action==="admit"){
            const originality=text(body.originality,40)||"sixwell_original",role=text(body.asset_role,40)||"creative_master",credit=text(body.creator_credit,500);
            if(!ORIGINALITY_STATES.has(originality)||!ASSET_ROLES.has(role))throw new Error("Choose a valid originality and asset role.");
            await database.prepare("UPDATE media_asset_provenance SET originality=?,asset_role=?,creator_credit=CASE WHEN ?<>'' THEN ? ELSE creator_credit END,updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(originality,role,credit,credit,mediaId).run();
            const recordSource=await recordAdmissionSource(database,mediaId);
            await admitOriginalMedia(database,mediaId,{basis:recordSource?"record":"manual",sourceEntityId:recordSource?.entity_id,publicVisible:Number(recordSource?.public_visible)===1,manualApproval:originality==="collaborative_original",publish:body.publish!==false});admitted.push(mediaId);
          }else if(action==="exclude"){
            const originality=text(body.originality,40)||"external_source",role=text(body.asset_role,40)||"reference";
            if(!ORIGINALITY_STATES.has(originality)||!ASSET_ROLES.has(role))throw new Error("Choose a valid originality and asset role.");
            await database.batch([
              database.prepare("UPDATE media_asset_provenance SET originality=?,asset_role=?,updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(originality,role,mediaId),
              database.prepare("UPDATE media_catalogue_entries SET catalogue_state='deaccessioned',updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(mediaId),
              database.prepare("UPDATE gallery_entries SET state='hidden',updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(mediaId),
              database.prepare("UPDATE media_archive_admission_reviews SET review_state='excluded',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE media_id=?").bind(mediaId),
            ]);excluded.push(mediaId);
          }else{
            await database.prepare("UPDATE media_archive_admission_reviews SET review_state='deferred',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE media_id=?").bind(mediaId).run();deferred.push(mediaId);
          }
        }catch(error){failed.push({media_id:mediaId,error:String(error?.message||error)})}
      }
      return json({ok:failed.length===0,admitted,excluded,deferred,failed});
    }
    return failure("Method not allowed.",405);
  }
  if (createHandoffMatch) {
    if (request.method !== "POST") return failure("Method not allowed.",405);
    const mediaId = decodeURIComponent(createHandoffMatch[1]), body = await readJson(request); if (!body) return failure("Send a JSON object.");
    const creatorType = text(body.creator_type,80); if (!CREATOR_HANDOFF_TYPES.has(creatorType)) return failure("Choose a supported record type.");
    const source = await adminMediaRow(database,mediaId); if (!source) return failure("Media Asset not found.",404);
    const handoffId = id("media-handoff"), suggestedTitle = text(source.public_title,300) || text(source.gallery_title,300) || fileStem(source.original_filename) || `Untitled ${mediaType(source.mime_type)} ${accession(source.catalogue_id)}`;
    await database.prepare(`INSERT INTO media_creator_handoffs(id,media_id,creator_type,suggested_title,state,created_by,created_at,expires_at,updated_at)
      VALUES(?,?,?,?,'pending','studio',datetime('now'),datetime('now','+24 hours'),datetime('now'))`).bind(handoffId,mediaId,creatorType,suggestedTitle).run();
    return json({handoff:{id:handoffId,media_id:mediaId,creator_type:creatorType,suggested_title:suggestedTitle,state:"pending",accession:accession(source.catalogue_id),expires_in_hours:24}},{status:201});
  }
  if (handoffMatch) {
    const handoffId = decodeURIComponent(handoffMatch[1]), action = handoffMatch[2] || "";
    let handoff = await database.prepare(`SELECT handoff.*,catalogue.catalogue_id,media.original_filename
      FROM media_creator_handoffs handoff JOIN media_assets media ON media.id=handoff.media_id
      JOIN media_catalogue_entries catalogue ON catalogue.media_id=handoff.media_id WHERE handoff.id=?`).bind(handoffId).first();
    if (!handoff) return failure("Media handoff not found.",404);
    if (handoff.state === "pending" && Date.parse(`${handoff.expires_at}Z`) <= Date.now()) {
      await database.prepare("UPDATE media_creator_handoffs SET state='expired',updated_at=datetime('now') WHERE id=? AND state='pending'").bind(handoffId).run();
      handoff = {...handoff,state:"expired"};
    }
    if (request.method === "GET" && !action) return json({handoff:{...handoff,accession:accession(handoff.catalogue_id)}});
    if (request.method === "DELETE" && !action) {
      if (handoff.state !== "pending") return failure("Only a pending media handoff can be cancelled.",409);
      await database.prepare("UPDATE media_creator_handoffs SET state='cancelled',updated_at=datetime('now') WHERE id=?").bind(handoffId).run();
      return json({ok:true,cancelled:true});
    }
    if (request.method === "POST" && action === "complete") {
      if (handoff.state !== "pending") return failure(`This media handoff is ${handoff.state}.`,409);
      const body = await readJson(request); if (!body) return failure("Send a JSON object.");
      const targetId = text(body.target_entity_id,200), target = await database.prepare("SELECT id FROM content_entities WHERE id=?").bind(targetId).first();
      if (!target) return failure("Connected record not found.",404);
      const defaultRelationship = handoff.creator_type === "legend-symbol" ? "rel-uses-symbol" : handoff.creator_type === "note" ? "rel-source-for" : "rel-depicts";
      const relationshipTypeId = text(body.relationship_type_id,200) || defaultRelationship, relationType = await database.prepare("SELECT id FROM relationship_types WHERE id=?").bind(relationshipTypeId).first();
      if (!relationType) return failure("Relationship type not found.",404);
      const role = text(body.role,100) || (handoff.creator_type === "note" ? "source" : "documentation"), relationshipId = id("relationship");
      await database.batch([
        database.prepare(`INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
          VALUES(?,?,?,?,?,?,?,datetime('now'))
          ON CONFLICT(entity_id,media_id,role) DO UPDATE SET sort_order=excluded.sort_order,public_visible=excluded.public_visible,alt_text_override=excluded.alt_text_override,caption_override=excluded.caption_override`)
          .bind(target.id,handoff.media_id,role,Number(body.sort_order)||0,body.public_visible?1:0,text(body.alt_text_override,1000),text(body.caption_override,3000)),
        database.prepare(`INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
          SELECT ?,catalogue.entity_id,?,?,?,?,?,'studio',datetime('now'),datetime('now') FROM media_catalogue_entries catalogue WHERE catalogue.media_id=?
          ON CONFLICT(source_entity_id,target_entity_id,relationship_type_id) DO UPDATE SET public_visible=excluded.public_visible,internal_notes=excluded.internal_notes,sort_order=excluded.sort_order,updated_at=datetime('now')`)
          .bind(relationshipId,target.id,relationType.id,body.public_visible?1:0,text(body.internal_notes,3000),Number(body.sort_order)||0,handoff.media_id),
        database.prepare("UPDATE media_creator_handoffs SET state='completed',completed_entity_id=?,completed_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND state='pending'").bind(target.id,handoffId),
      ]);
      return json({ok:true,completed:true,handoff_id:handoffId,media_id:handoff.media_id,target_entity_id:target.id});
    }
    return failure("Method not allowed.",405);
  }
  const mediaId = match[1] ? decodeURIComponent(match[1]) : "", action = match[2] || "";
  if (action === "link") {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    const body = await readJson(request); if (!body) return failure("Send a JSON object.");
    const [source, catalogue, target, relationType] = await Promise.all([
      database.prepare("SELECT id FROM media_assets WHERE id=?").bind(mediaId).first(),
      database.prepare("SELECT * FROM media_catalogue_entries WHERE media_id=?").bind(mediaId).first(),
      database.prepare("SELECT id FROM content_entities WHERE id=?").bind(text(body.target_entity_id, 200)).first(),
      database.prepare("SELECT id FROM relationship_types WHERE id=?").bind(text(body.relationship_type_id, 200) || "rel-depicts").first(),
    ]);
    if (!source) return failure("Media Asset not found.", 404);
    if (!target) return failure("Connected record not found.", 404);
    if (!relationType) return failure("Relationship type not found.", 404);
    const role = text(body.role, 100) || "documentation", relationshipId = id("relationship");
    const statements = [
      database.prepare(`INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
        VALUES(?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(entity_id,media_id,role) DO UPDATE SET sort_order=excluded.sort_order,public_visible=excluded.public_visible,alt_text_override=excluded.alt_text_override,caption_override=excluded.caption_override`)
        .bind(target.id, mediaId, role, Number(body.sort_order) || 0, body.public_visible ? 1 : 0, text(body.alt_text_override, 1000), text(body.caption_override, 3000)),
    ];
    if (catalogue) statements.push(database.prepare(`INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))
        ON CONFLICT(source_entity_id,target_entity_id,relationship_type_id) DO UPDATE SET public_visible=excluded.public_visible,internal_notes=excluded.internal_notes,sort_order=excluded.sort_order,updated_at=datetime('now')`)
        .bind(relationshipId, catalogue.entity_id, target.id, relationType.id, body.public_visible ? 1 : 0, text(body.internal_notes, 3000), Number(body.sort_order) || 0));
    await database.batch(statements);
    const record = presentAdminMedia(await adminMediaRow(database, mediaId));
    return json({ record: (await hydrateAdminAssociations(database, [record]))[0], linked: true }, { status: 201 });
  }
  if (request.method === "GET") {
    if (mediaId) {
      const row = await adminMediaRow(database, mediaId); if (!row) return failure("Media Asset not found.", 404);
      return json({ record: (await hydrateAdminAssociations(database, [presentAdminMedia(row)]))[0] });
    }
    const url = new URL(request.url), rows = (await database.prepare(`${ADMIN_MEDIA_SQL}${libraryView ? "" : " WHERE catalogue.catalogue_id IS NOT NULL"} ORDER BY catalogue.catalogue_id IS NULL,catalogue.catalogue_id DESC,m.created_at DESC LIMIT 1000`).all()).results || [];
    let records = rows.map(presentAdminMedia);
    const q = text(url.searchParams.get("q"), 300).toLowerCase(), sourceClass = text(url.searchParams.get("source_class"), 40), galleryState = text(url.searchParams.get("gallery_state"), 40), type = text(url.searchParams.get("type"), 40), originality=text(url.searchParams.get("originality"),40),assetRole=text(url.searchParams.get("asset_role"),40);
    if (q) records = records.filter((record) => [record.accession, record.original_filename, record.public_title, record.alt_text, record.gallery?.title].some((value) => String(value || "").toLowerCase().includes(q)));
    if (sourceClass) records = records.filter((record) => record.source_class === sourceClass);
    if (galleryState === "none") records = records.filter((record) => !record.gallery);
    else if (galleryState) records = records.filter((record) => record.gallery?.state === galleryState);
    if (type) records = records.filter((record) => record.media_type === type);
    if (originality) records = records.filter((record) => record.originality === originality);
    if (assetRole) records = records.filter((record) => record.asset_role === assetRole);
    records = await hydrateAdminAssociations(database, records);
    return json({ records, count: records.length });
  }
  if (request.method === "PATCH" && mediaId) {
    const body = await readJson(request); if (!body) return failure("Send a JSON object.");
    const before = await database.prepare("SELECT * FROM media_asset_provenance WHERE media_id=?").bind(mediaId).first(); if (!before) return failure("Media Asset not found.", 404);
    const review = text(body.metadata_review_state ?? before.metadata_review_state, 40), hash = body.sha256 === null || body.sha256 === "" ? null : text(body.sha256 ?? before.sha256, 64).toLowerCase();
    const originality=text(body.originality??before.originality,40),assetRole=text(body.asset_role??before.asset_role,40),creatorCredit=text(body.creator_credit??before.creator_credit,500);
    if (!REVIEW_STATES.has(review)) return failure("Invalid metadata review state.");
    if (!ORIGINALITY_STATES.has(originality)) return failure("Invalid originality classification.");
    if (!ASSET_ROLES.has(assetRole)) return failure("Invalid asset role.");
    if (hash && !/^[0-9a-f]{64}$/.test(hash)) return failure("SHA-256 must contain 64 lowercase hexadecimal characters.");
    let rawMetadata = before.raw_metadata_json;
    if (Object.prototype.hasOwnProperty.call(body, "raw_metadata")) rawMetadata = JSON.stringify(safeJson(body.raw_metadata));
    try {
      await database.prepare(`UPDATE media_asset_provenance SET originality=?,asset_role=?,creator_credit=?,sha256=?,original_format=?,import_source=?,embedded_capture_at=?,embedded_capture_timezone=?,camera_make=?,camera_model=?,editing_software=?,orientation=?,color_profile=?,metadata_review_state=?,raw_metadata_json=?,updated_by='studio',updated_at=datetime('now') WHERE media_id=?`)
        .bind(originality,assetRole,creatorCredit,hash,text(body.original_format??before.original_format,80),text(body.import_source??before.import_source,300),body.embedded_capture_at??before.embedded_capture_at,text(body.embedded_capture_timezone??before.embedded_capture_timezone,80),text(body.camera_make??before.camera_make,200),text(body.camera_model??before.camera_model,200),text(body.editing_software??before.editing_software,300),text(body.orientation??before.orientation,100),text(body.color_profile??before.color_profile,200),review,rawMetadata,mediaId).run();
    } catch (error) {
      if (/UNIQUE constraint failed.*sha256/i.test(String(error?.message || error))) return failure("That file hash already belongs to another Media Asset.", 409);
      throw error;
    }
    return json({ record: presentAdminMedia(await adminMediaRow(database, mediaId)) });
  }
  return failure("Method not allowed.", 405);
}

async function replaceGalleryAssignments(database, mediaId, lensIds, setIds) {
  const statements = [database.prepare("DELETE FROM gallery_entry_lenses WHERE media_id=?").bind(mediaId), database.prepare("DELETE FROM gallery_set_items WHERE media_id=?").bind(mediaId)];
  lensIds.forEach((lensId, index) => statements.push(database.prepare("INSERT INTO gallery_entry_lenses(media_id,lens_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(mediaId, lensId, index + 1)));
  setIds.forEach((setId, index) => statements.push(database.prepare("INSERT INTO gallery_set_items(set_id,media_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(setId, mediaId, index + 1)));
  await database.batch(statements);
}

async function publishGallerySelection(database, mediaIds) {
  const published = [], failed = [];
  for (const mediaId of mediaIds) {
    const entry = await database.prepare(`SELECT gallery.media_id,gallery.display_media_id,gallery.title,media.original_filename,media.mime_type,
        catalogue.catalogue_id,catalogue.catalogue_state,provenance.originality,provenance.asset_role,catalogue.manual_gallery_approved
      FROM gallery_entries gallery
      JOIN media_assets media ON media.id=gallery.media_id
      JOIN media_catalogue_entries catalogue ON catalogue.media_id=gallery.media_id
      JOIN media_asset_provenance provenance ON provenance.media_id=gallery.media_id
      WHERE gallery.media_id=?`).bind(mediaId).first();
    if (!entry) { failed.push({ media_id: mediaId, error: "Gallery entry not found." }); continue; }
    if (entry.catalogue_state !== "active" || !canAdmitOriginal(entry,Number(entry.manual_gallery_approved)===1)) {
      failed.push({ media_id: mediaId, error: "Only admitted original media can be published to Gallery." });
      continue;
    }
    const derivative = await database.prepare("SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=? AND purpose='public-display'").bind(entry.display_media_id).first();
    const displayMediaId = derivative?.derivative_media_id || entry.display_media_id;
    const title = text(entry.title,300) || fileStem(entry.original_filename) || `Untitled ${mediaType(entry.mime_type)} ${accession(entry.catalogue_id)}`;
    try {
      await database.prepare(`UPDATE gallery_entries SET display_media_id=?,title=?,date_precision=CASE WHEN date_precision='unreviewed' THEN 'undated' ELSE date_precision END,state='published',published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE media_id=?`).bind(displayMediaId,title,mediaId).run();
      published.push(mediaId);
    } catch (error) {
      failed.push({ media_id: mediaId, error: /published gallery entry requires/i.test(String(error?.message||error)) ? "A title and eligible display asset are required." : "Publishing failed." });
    }
  }
  return { published, failed };
}

export async function handleGalleryAdmin(request, env, path) {
  const setItemsMatch = path.match(/^\/api\/admin\/gallery-sets\/([^/]+)\/items$/);
  const setMatch = path.match(/^\/api\/admin\/gallery-sets(?:\/([^/]+))?$/);
  const batchMatch = path === "/api/admin/gallery/batch";
  const entryMatch = path.match(/^\/api\/admin\/gallery(?:\/([^/]+))?(?:\/(publish|hide|archive))?$/);
  if (!setItemsMatch && !setMatch && !entryMatch && !batchMatch && path !== "/api/admin/gallery-lenses") return null;
  const database = db(env);
  if (path === "/api/admin/gallery-lenses") {
    if (request.method !== "GET") return failure("Method not allowed.", 405);
    const records = (await database.prepare("SELECT * FROM gallery_lenses WHERE state='active' ORDER BY sort_order,name").all()).results || [];
    return json({ records, count: records.length });
  }
  if (batchMatch) {
    if (request.method !== "POST") return failure("Method not allowed.",405);
    const body = await readJson(request), mediaIds = uniqueIds(body?.media_ids,500);
    if (!mediaIds.length) return failure("Select at least one Gallery entry.");
    if (text(body?.action,40) !== "publish") return failure("Choose the publish batch action.");
    const result = await publishGallerySelection(database,mediaIds);
    return json({ ok:result.failed.length===0, ...result, count:result.published.length });
  }
  if (setItemsMatch) {
    if (request.method !== "PUT") return failure("Method not allowed.", 405);
    const setId = decodeURIComponent(setItemsMatch[1]), body = await readJson(request), mediaIds = uniqueIds(body?.media_ids);
    if (!await database.prepare("SELECT id FROM gallery_sets WHERE id=?").bind(setId).first()) return failure("Gallery set not found.", 404);
    const statements = [database.prepare("DELETE FROM gallery_set_items WHERE set_id=?").bind(setId)];
    mediaIds.forEach((mediaId, index) => statements.push(database.prepare("INSERT INTO gallery_set_items(set_id,media_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(setId, mediaId, index + 1)));
    await database.batch(statements);
    return json({ ok: true, media_ids: mediaIds });
  }
  if (setMatch) {
    const setId = setMatch[1] ? decodeURIComponent(setMatch[1]) : "";
    if (request.method === "GET") {
      const rows = (await database.prepare(`SELECT set_record.*,(SELECT COUNT(*) FROM gallery_set_items item WHERE item.set_id=set_record.id) item_count FROM gallery_sets set_record ${setId ? "WHERE set_record.id=?" : ""} ORDER BY set_record.sort_order,set_record.title`).bind(...(setId ? [setId] : [])).all()).results || [];
      if (setId && !rows[0]) return failure("Gallery set not found.", 404);
      return json(setId ? { record: rows[0] } : { records: rows, count: rows.length });
    }
    const body = await readJson(request); if (!body) return failure("Send a JSON object.");
    if (request.method === "POST" && !setId) {
      const setType = text(body.set_type, 40), title = text(body.title, 300), setSlug = slug(body.slug || title), state = text(body.state, 40) || "draft";
      if (!SET_TYPES.has(setType) || !title || !setSlug || !SET_STATES.has(state)) return failure("Title, unique slug, and a valid set type are required.");
      const coverMediaId = text(body.cover_media_id,200)||null;
      if (state === "published" && coverMediaId && !(await database.prepare("SELECT 1 ready FROM gallery_entries WHERE media_id=? AND state='published'").bind(coverMediaId).first())) return failure("Publish the selected cover Gallery entry before publishing this set.",409);
      const newId = id("gallery-set");
      try { await database.prepare(`INSERT INTO gallery_sets(id,slug,title,summary,set_type,cover_media_id,date_precision,date_label,occurred_at,ended_at,state,published_at,sort_order,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' THEN datetime('now') ELSE NULL END,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,setSlug,title,text(body.summary,5000),setType,coverMediaId,text(body.date_precision,40)||"undated",text(body.date_label,160),body.occurred_at||null,body.ended_at||null,state,state,Number(body.sort_order)||0).run(); }
      catch (error) { if (/UNIQUE constraint failed.*slug/i.test(String(error?.message || error))) return failure("That Gallery set slug is already in use.",409); throw error; }
      return json({ record: await database.prepare("SELECT * FROM gallery_sets WHERE id=?").bind(newId).first() }, { status: 201 });
    }
    if (request.method === "PATCH" && setId) {
      const before = await database.prepare("SELECT * FROM gallery_sets WHERE id=?").bind(setId).first(); if (!before) return failure("Gallery set not found.",404);
      const title = text(body.title??before.title,300), setSlug = before.slug, setType = text(body.set_type??before.set_type,40), state = text(body.state??before.state,40), coverMediaId = text(body.cover_media_id??before.cover_media_id,200)||null;
      if (!title || !setSlug || !SET_TYPES.has(setType) || !SET_STATES.has(state)) return failure("Invalid Gallery set.");
      if (Object.prototype.hasOwnProperty.call(body,"slug") && slug(body.slug)!==before.slug) return failure("Gallery set slugs are permanent.",409);
      if (state === "published" && coverMediaId && !(await database.prepare("SELECT 1 ready FROM gallery_entries WHERE media_id=? AND state='published'").bind(coverMediaId).first())) return failure("Publish the selected cover Gallery entry before publishing this set.",409);
      await database.prepare(`UPDATE gallery_sets SET slug=?,title=?,summary=?,set_type=?,cover_media_id=?,date_precision=?,date_label=?,occurred_at=?,ended_at=?,state=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,datetime('now')) ELSE published_at END,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`)
        .bind(setSlug,title,text(body.summary??before.summary,5000),setType,coverMediaId,text(body.date_precision??before.date_precision,40),text(body.date_label??before.date_label,160),body.occurred_at??before.occurred_at,body.ended_at??before.ended_at,state,state,Number(body.sort_order??before.sort_order)||0,setId).run();
      return json({ record: await database.prepare("SELECT * FROM gallery_sets WHERE id=?").bind(setId).first() });
    }
    if (request.method === "DELETE" && setId) {
      await database.prepare("UPDATE gallery_sets SET state='archived',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(setId).run();
      return json({ ok: true, archived: true });
    }
    return failure("Method not allowed.",405);
  }
  const mediaId = entryMatch?.[1] ? decodeURIComponent(entryMatch[1]) : "", action = entryMatch?.[2] || "";
  if (request.method === "GET") {
    if (mediaId) {
      const row = await adminMediaRow(database, mediaId); if (!row?.gallery_state) return failure("Gallery entry not found.",404);
      return json({ record: (await hydrateAdminAssociations(database,[presentAdminMedia(row)]))[0] });
    }
    const rows = (await database.prepare(`${ADMIN_MEDIA_SQL} WHERE gallery.media_id IS NOT NULL AND catalogue.catalogue_id IS NOT NULL ORDER BY CASE gallery.state WHEN 'draft' THEN 0 WHEN 'hidden' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,gallery.updated_at DESC`).all()).results || [];
    const records = await hydrateAdminAssociations(database, rows.map(presentAdminMedia));
    return json({ records, count: records.length });
  }
  if (request.method === "POST" && !action && !mediaId) {
    const body = await readJson(request), sourceMediaId = text(body?.media_id,200); if (!sourceMediaId) return failure("Choose a Media Asset.");
    const source = await adminMediaRow(database,sourceMediaId); if (!source) return failure("Media Asset not found.",404);
    if (!canAdmitOriginal(source,Number(source.manual_gallery_approved)===1)) return failure("Classify this as original Gallery media before adding it.",409);
    if (!source.catalogue_id) {
      try { const record=await admitOriginalMedia(database,sourceMediaId,{basis:"direct",manualApproval:source.originality==="collaborative_original",publish:false}); return json({record,created:true},{status:201}); }
      catch(error){return failure(String(error?.message||error),409)}
    }
    const suggestedTitle = text(source.public_title,300) || fileStem(source.original_filename) || `Untitled ${mediaType(source.mime_type)} ${accession(source.catalogue_id)}`;
    const variant = await database.prepare("SELECT derivative_media_id FROM media_asset_variants WHERE master_media_id=? AND purpose='public-display'").bind(sourceMediaId).first();
    await database.prepare(`INSERT OR IGNORE INTO gallery_entries(media_id,display_media_id,title,accessibility_text,caption,credit,state,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'draft','studio','studio',datetime('now'),datetime('now'))`).bind(sourceMediaId,variant?.derivative_media_id||sourceMediaId,suggestedTitle,text(source.alt_text,1000),text(source.caption,3000),text(source.credit,500)).run();
    const record = presentAdminMedia(await adminMediaRow(database,sourceMediaId));
    return json({ record:(await hydrateAdminAssociations(database,[record]))[0], created:!source.gallery_state },{status:source.gallery_state?200:201});
  }
  if (!mediaId) return failure("Choose a Gallery entry.");
  const before = await database.prepare("SELECT * FROM gallery_entries WHERE media_id=?").bind(mediaId).first(); if (!before) return failure("Gallery entry not found.",404);
  if (request.method === "POST" && action) {
    if (action === "publish") {
      const result = await publishGallerySelection(database,[mediaId]);
      if (result.failed.length) return failure(result.failed[0].error,409);
      return json({ record:presentAdminMedia(await adminMediaRow(database,mediaId)) });
    }
    const state = action === "hide" ? "hidden" : "archived";
    try { await database.prepare(`UPDATE gallery_entries SET state=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE media_id=?`).bind(state,state,mediaId).run(); }
    catch (error) { if (/published gallery entry requires/i.test(String(error?.message||error))) return failure("Complete the title, date review, and public display asset before publishing.",409); throw error; }
    return json({ record:presentAdminMedia(await adminMediaRow(database,mediaId)) });
  }
  if (request.method === "PATCH" && !action) {
    const body = await readJson(request); if (!body) return failure("Send a JSON object.");
    const state = text(body.state??before.state,40), rights = text(body.rights_status??before.rights_status,40), precision = text(body.date_precision??before.date_precision,40), accessibility = text(body.accessibility_status??before.accessibility_status,40);
    if (!GALLERY_STATES.has(state)||!RIGHTS_STATES.has(rights)||!DATE_PRECISIONS.has(precision)||!ACCESSIBILITY_STATES.has(accessibility)) return failure("Invalid Gallery editorial state.");
    const lensIds = Object.prototype.hasOwnProperty.call(body,"lens_ids") ? uniqueIds(body.lens_ids,20) : null, setIds = Object.prototype.hasOwnProperty.call(body,"set_ids") ? uniqueIds(body.set_ids,50) : null;
    try {
      await database.prepare(`UPDATE gallery_entries SET display_media_id=?,poster_media_id=?,title=?,accessibility_text=?,accessibility_status=?,caption=?,credit=?,rights_status=?,date_precision=?,date_label=?,occurred_at=?,ended_at=?,focal_x=?,focal_y=?,state=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE media_id=?`)
        .bind(text(body.display_media_id??before.display_media_id,200),text(body.poster_media_id??before.poster_media_id,200)||null,text(body.title??before.title,300),text(body.accessibility_text??before.accessibility_text,1000),accessibility,text(body.caption??before.caption,3000),text(body.credit??before.credit,500),rights,precision,text(body.date_label??before.date_label,160),body.occurred_at??before.occurred_at,body.ended_at??before.ended_at,Math.max(0,Math.min(1,Number(body.focal_x??before.focal_x))),Math.max(0,Math.min(1,Number(body.focal_y??before.focal_y))),state,state,mediaId).run();
      if (lensIds || setIds) {
        const existingLenses = lensIds || (await database.prepare("SELECT lens_id FROM gallery_entry_lenses WHERE media_id=? ORDER BY sort_order").bind(mediaId).all()).results.map((row)=>row.lens_id);
        const existingSets = setIds || (await database.prepare("SELECT set_id FROM gallery_set_items WHERE media_id=? ORDER BY sort_order").bind(mediaId).all()).results.map((row)=>row.set_id);
        await replaceGalleryAssignments(database,mediaId,existingLenses,existingSets);
      }
    } catch (error) { if (/published gallery entry requires/i.test(String(error?.message||error))) return failure("Complete the title, date review, and public display asset before publishing.",409); throw error; }
    const record=presentAdminMedia(await adminMediaRow(database,mediaId));
    return json({record:(await hydrateAdminAssociations(database,[record]))[0]});
  }
  return failure("Method not allowed.",405);
}

const PUBLIC_GALLERY_SQL = `SELECT gallery.*,media.mime_type,media.width,media.height,media.duration_seconds,
  media.original_filename,display.id display_id,display.source_url display_source_url,display.storage_key display_storage_key,
  display.mime_type display_mime_type,display.byte_size display_byte_size,display.original_filename display_filename,
  display.width display_width,display.height display_height,display.duration_seconds display_duration_seconds,
  display.transcript display_transcript,display.transcript_status display_transcript_status,display.transcript_language display_transcript_language,
  poster.id poster_id,poster.source_url poster_source_url,poster.storage_key poster_storage_key,
  poster.mime_type poster_mime_type,poster.byte_size poster_byte_size,poster.original_filename poster_filename,
  catalogue.catalogue_id,catalogue.entity_id media_entity_id
FROM gallery_entries gallery
JOIN media_assets media ON media.id=gallery.media_id AND media.state='active'
JOIN media_catalogue_entries catalogue ON catalogue.media_id=gallery.media_id AND catalogue.catalogue_state='active'
JOIN media_asset_provenance provenance ON provenance.media_id=gallery.media_id
  AND provenance.asset_role IN ('creative_master','editorial_fragment')
  AND (provenance.originality='sixwell_original'
    OR (provenance.originality='collaborative_original' AND catalogue.manual_gallery_approved=1))
JOIN media_assets display ON display.id=gallery.display_media_id AND display.state='active'
LEFT JOIN media_assets poster ON poster.id=gallery.poster_media_id AND poster.state='active'
WHERE gallery.state='published'
  AND (
    gallery.publication_basis IN ('direct','editorial','manual')
    OR (gallery.publication_basis='record' AND (
      EXISTS(SELECT 1 FROM entity_media attachment JOIN content_entities owner ON owner.id=attachment.entity_id
        WHERE attachment.media_id=gallery.media_id AND attachment.public_visible=1 AND owner.visibility='public')
      OR EXISTS(SELECT 1 FROM archive_materials material JOIN archive_dossiers dossier ON dossier.entity_id=material.dossier_entity_id
        WHERE material.media_id=gallery.media_id AND material.state='published' AND material.visibility='public'
          AND dossier.state='published' AND dossier.public_visible=1)
      OR EXISTS(SELECT 1 FROM archive_note_assets note_asset JOIN archive_notes note ON note.entity_id=note_asset.note_entity_id
        WHERE note_asset.media_id=gallery.media_id AND note_asset.public_visible=1 AND note.state='published' AND note.public_visible=1)
    ))
  )
  AND NOT EXISTS(SELECT 1 FROM media_asset_variants variant WHERE variant.derivative_media_id=gallery.media_id)`;

async function publicAssociations(database, rows) {
  if (!rows.length) return rows;
  const lensRows=[],setRows=[],connectionRows=[];
  for(let offset=0;offset<rows.length;offset+=75){
    const chunk=rows.slice(offset,offset+75),mediaIds=chunk.map((row)=>row.media_id),entities=chunk.map((row)=>row.media_entity_id),mediaPlaceholders=mediaIds.map(()=>"?").join(","),entityPlaceholders=entities.map(()=>"?").join(",");
    const [lensResult,setResult,connectionResult]=await Promise.all([
      database.prepare(`SELECT assignment.media_id,lens.slug,lens.name FROM gallery_entry_lenses assignment JOIN gallery_lenses lens ON lens.id=assignment.lens_id WHERE lens.state='active' AND assignment.media_id IN (${mediaPlaceholders}) ORDER BY assignment.sort_order,lens.sort_order`).bind(...mediaIds).all(),
      database.prepare(`SELECT item.media_id,set_record.slug,set_record.title,set_record.set_type FROM gallery_set_items item JOIN gallery_sets set_record ON set_record.id=item.set_id WHERE set_record.state='published' AND item.media_id IN (${mediaPlaceholders}) ORDER BY item.sort_order,set_record.sort_order`).bind(...mediaIds).all(),
      database.prepare(`SELECT catalogue.media_id,relation.id,type.forward_label,type.reverse_label,
          CASE WHEN relation.source_entity_id=catalogue.entity_id THEN relation.target_entity_id ELSE relation.source_entity_id END entity_id,
          CASE WHEN relation.source_entity_id=catalogue.entity_id THEN type.forward_label ELSE type.reverse_label END label,
          COALESCE(document.title,person.name,organization.name,place.name,target.id) title,
          COALESCE(NULLIF(document.route,''),CASE WHEN organization.slug<>'' THEN '/about/identities/'||organization.slug||'/' WHEN place.slug<>'' THEN '/archive/places/'||place.slug||'/' ELSE '' END) route
        FROM media_catalogue_entries catalogue
        JOIN entity_relationships relation ON relation.source_entity_id=catalogue.entity_id OR relation.target_entity_id=catalogue.entity_id
        JOIN relationship_types type ON type.id=relation.relationship_type_id AND type.public_visible=1
        JOIN content_entities target ON target.id=CASE WHEN relation.source_entity_id=catalogue.entity_id THEN relation.target_entity_id ELSE relation.source_entity_id END AND target.visibility='public'
        LEFT JOIN search_documents document ON document.entity_id=target.id AND document.state='published'
        LEFT JOIN people person ON person.id=target.id AND person.state='published' AND person.privacy='public'
        LEFT JOIN organizations organization ON organization.id=target.id AND organization.state='published'
        LEFT JOIN places place ON place.id=target.id AND place.state='published' AND place.privacy='public'
        WHERE relation.public_visible=1 AND catalogue.entity_id IN (${entityPlaceholders})
        ORDER BY relation.sort_order,relation.created_at`).bind(...entities).all(),
    ]);
    lensRows.push(...(lensResult.results||[]));setRows.push(...(setResult.results||[]));connectionRows.push(...(connectionResult.results||[]));
  }
  const group=(records)=>{const map=new Map();for(const row of records){const list=map.get(row.media_id)||[];list.push(row);map.set(row.media_id,list)}return map};
  const lenses=group(lensRows),sets=group(setRows),connections=group(connectionRows);
  return rows.map((row)=>({...row,lenses:lenses.get(row.media_id)||[],sets:sets.get(row.media_id)||[],connections:(connections.get(row.media_id)||[]).filter((item)=>item.route)}));
}

function presentPublicGallery(row) {
  const humanId=accession(row.catalogue_id),resolvedMime=row.display_mime_type||row.mime_type,type=mediaType(resolvedMime);
  const mediaVersion=encodeURIComponent(row.display_id||row.media_id);
  const posterVersion=row.poster_id?encodeURIComponent(row.poster_id):"";
  return {
    accession:humanId,title:row.title,accessibilityText:row.accessibility_text,caption:row.caption,credit:row.credit,
    datePrecision:row.date_precision,dateLabel:row.date_label,occurredAt:row.occurred_at,endedAt:row.ended_at,
    mediaType:type,mimeType:resolvedMime,width:row.display_width??row.width,height:row.display_height??row.height,durationSeconds:row.display_duration_seconds??row.duration_seconds,
    focalX:Number(row.focal_x??0.5),focalY:Number(row.focal_y??0.5),publishedAt:row.published_at,
    transcript:row.display_transcript_status==="ready"?row.display_transcript:"",transcriptLanguage:row.display_transcript_status==="ready"?row.display_transcript_language:"",
    route:`/gallery/${humanId}/`,mediaUrl:`/api/gallery/media/${humanId}?asset=${mediaVersion}`,
    posterUrl:row.poster_id?`/api/gallery/media/${humanId}?variant=poster&asset=${posterVersion}`:"",
    lenses:(row.lenses||[]).map(({slug:recordSlug,name})=>({slug:recordSlug,name})),
    sets:(row.sets||[]).map(({slug:recordSlug,title,set_type})=>({slug:recordSlug,title,setType:set_type,route:`/gallery/sets/${recordSlug}/`})),
    connections:(row.connections||[]).map(({entity_id,label,title,route})=>({entityId:entity_id,label,title,route})),
  };
}

export async function handleGalleryPublic(request,env,path){
  const mediaMatch=path.match(/^\/api\/gallery\/media\/([^/]+)$/),itemMatch=path.match(/^\/api\/gallery\/items\/([^/]+)$/),setMatch=path.match(/^\/api\/gallery\/sets(?:\/([^/]+))?$/);
  if(path!=="/api/gallery"&&!mediaMatch&&!itemMatch&&!setMatch)return null;
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const database=db(env);
  if(mediaMatch){
    const number=accessionNumber(decodeURIComponent(mediaMatch[1]));if(!number)return failure("Gallery item not found.",404);
    const variant=new URL(request.url).searchParams.get("variant")==="poster"?"poster":"display";
    const row=await database.prepare(`${PUBLIC_GALLERY_SQL} AND catalogue.catalogue_id=?`).bind(number).first();if(!row)return failure("Gallery media unavailable.",404);
    const mediaRow=variant==="poster"&&row.poster_id?{id:row.poster_id,source_url:row.poster_source_url,storage_key:row.poster_storage_key,mime_type:row.poster_mime_type,byte_size:row.poster_byte_size,original_filename:row.poster_filename}:{id:row.display_id,source_url:row.display_source_url,storage_key:row.display_storage_key,mime_type:row.display_mime_type,byte_size:row.display_byte_size,original_filename:row.display_filename};
    return serveR2Media(request,env.SUBMISSION_FILES,mediaRow,()=>failure("Gallery media unavailable.",404),{cacheControl:"public, max-age=3600, stale-while-revalidate=86400",disposition:mediaType(mediaRow.mime_type)==="document"?"attachment":"inline"});
  }
  if(itemMatch){
    const number=accessionNumber(decodeURIComponent(itemMatch[1]));if(!number)return failure("Gallery item not found.",404);
    const row=await database.prepare(`${PUBLIC_GALLERY_SQL} AND catalogue.catalogue_id=?`).bind(number).first();if(!row)return failure("Gallery item not found.",404);
    return json({record:presentPublicGallery((await publicAssociations(database,[row]))[0])},{cache:"public, max-age=60"});
  }
  if(setMatch){
    const setSlug=setMatch[1]?decodeURIComponent(setMatch[1]):"";
    if(!setSlug){
      const rows=(await database.prepare("SELECT id,slug,title,summary,set_type,date_label,published_at,cover_media_id FROM gallery_sets WHERE state='published' ORDER BY published_at DESC,sort_order,title").all()).results||[];
      const records=[];
      for(const setRecord of rows){
        let cover=null;
        if(setRecord.cover_media_id){const coverRow=await database.prepare(`${PUBLIC_GALLERY_SQL} AND gallery.media_id=?`).bind(setRecord.cover_media_id).first();if(coverRow)cover=presentPublicGallery(coverRow)}
        records.push({...setRecord,route:`/gallery/sets/${setRecord.slug}/`,cover});
      }
      return json({records,count:records.length},{cache:"public, max-age=60"})
    }
    const setRecord=await database.prepare("SELECT * FROM gallery_sets WHERE slug=? AND state='published'").bind(setSlug).first();if(!setRecord)return failure("Gallery set not found.",404);
    const rows=(await database.prepare(`${PUBLIC_GALLERY_SQL} AND EXISTS(SELECT 1 FROM gallery_set_items member WHERE member.set_id=? AND member.media_id=gallery.media_id) ORDER BY (SELECT member.sort_order FROM gallery_set_items member WHERE member.set_id=? AND member.media_id=gallery.media_id),gallery.published_at DESC`).bind(setRecord.id,setRecord.id).all()).results||[];
    const records=(await publicAssociations(database,rows)).map(presentPublicGallery);
    let cover=null;if(setRecord.cover_media_id){const coverRow=await database.prepare(`${PUBLIC_GALLERY_SQL} AND gallery.media_id=?`).bind(setRecord.cover_media_id).first();if(coverRow)cover=presentPublicGallery(coverRow)}
    return json({set:{...setRecord,route:`/gallery/sets/${setRecord.slug}/`,cover},records,count:records.length},{cache:"public, max-age=60"});
  }
  const url=new URL(request.url),conditions=[],values=[];
  const lens=slug(url.searchParams.get("lens")),type=text(url.searchParams.get("type"),30),node=text(url.searchParams.get("node"),100),setSlug=slug(url.searchParams.get("set"));
  if(lens){conditions.push("EXISTS(SELECT 1 FROM gallery_entry_lenses assignment JOIN gallery_lenses lens ON lens.id=assignment.lens_id WHERE assignment.media_id=gallery.media_id AND lens.slug=? AND lens.state='active')");values.push(lens)}
  if(type){const prefix={image:"image/%",video:"video/%",audio:"audio/%"}[type];if(prefix){conditions.push("media.mime_type LIKE ?");values.push(prefix)}else if(type==="pdf")conditions.push("media.mime_type='application/pdf'");else if(type==="document")conditions.push("media.mime_type NOT LIKE 'image/%' AND media.mime_type NOT LIKE 'video/%' AND media.mime_type NOT LIKE 'audio/%' AND media.mime_type<>'application/pdf'")}
  if(node){conditions.push(`EXISTS(SELECT 1 FROM media_catalogue_entries link_catalogue JOIN entity_relationships relation ON relation.source_entity_id=link_catalogue.entity_id OR relation.target_entity_id=link_catalogue.entity_id JOIN content_entities target ON target.id=CASE WHEN relation.source_entity_id=link_catalogue.entity_id THEN relation.target_entity_id ELSE relation.source_entity_id END WHERE link_catalogue.media_id=gallery.media_id AND relation.public_visible=1 AND target.visibility='public' AND target.node_id=?)`);values.push(node)}
  if(setSlug){conditions.push("EXISTS(SELECT 1 FROM gallery_set_items member JOIN gallery_sets set_record ON set_record.id=member.set_id WHERE member.media_id=gallery.media_id AND set_record.slug=? AND set_record.state='published')");values.push(setSlug)}
  const rows=(await database.prepare(`${PUBLIC_GALLERY_SQL}${conditions.length?` AND ${conditions.join(" AND ")}`:""} ORDER BY gallery.published_at DESC,catalogue.catalogue_id DESC LIMIT 500`).bind(...values).all()).results||[];
  const records=(await publicAssociations(database,rows)).map(presentPublicGallery),lenses=(await database.prepare("SELECT slug,name FROM gallery_lenses WHERE state='active' ORDER BY sort_order").all()).results||[],sets=(await database.prepare("SELECT slug,title,set_type FROM gallery_sets WHERE state='published' ORDER BY published_at DESC,sort_order").all()).results||[],nodes=(await database.prepare(`SELECT DISTINCT node.id,node.name
    FROM construct_nodes node
    JOIN content_entities target ON target.node_id=node.id AND target.visibility='public'
    JOIN entity_relationships relation ON relation.public_visible=1 AND (relation.source_entity_id=target.id OR relation.target_entity_id=target.id)
    JOIN media_catalogue_entries catalogue ON catalogue.entity_id=CASE WHEN relation.source_entity_id=target.id THEN relation.target_entity_id ELSE relation.source_entity_id END
    JOIN gallery_entries connected_gallery ON connected_gallery.media_id=catalogue.media_id AND connected_gallery.state='published'
    WHERE node.state='active' ORDER BY node.name`).all()).results||[];
  return json({records,count:records.length,filters:{lenses,sets,nodes}},{cache:"public, max-age=60"});
}
