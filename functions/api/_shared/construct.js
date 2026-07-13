export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": init.cache || "no-store", ...(init.headers || {}) },
  });
}

export function failure(message, status = 400, details = undefined) {
  return json({ error: message, ...(details ? { details } : {}) }, { status });
}

export function db(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  return env.SUBMISSIONS_DB;
}

export function requireStudioAdmin(request, env) {
  const expected = String(env.SUBMISSIONS_ADMIN_TOKEN || "").trim();
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!expected) return failure("Studio authorization is not configured.", 503);
  if (!supplied || supplied !== expected) return failure("Unauthorized.", 401);
  return null;
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export function text(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

export function slug(value) {
  return text(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function id(prefix = "entity") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseJson(value, fallback = []) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

export async function nextRevision(database, entityId, action, before, after, actor = "studio") {
  const row = await database.prepare("SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM entity_revisions WHERE entity_id=?").bind(entityId).first();
  await database.prepare("INSERT INTO entity_revisions(id,entity_id,revision_number,action,before_json,after_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))")
    .bind(id("revision"), entityId, Number(row?.n || 1), action, before ? JSON.stringify(before) : null, JSON.stringify(after || {}), actor).run();
}

export async function entityMedia(database, entityIds) {
  if (!entityIds.length) return new Map();
  const placeholders = entityIds.map(() => "?").join(",");
  const result = await database.prepare(`SELECT em.entity_id,em.role,em.sort_order,COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) alt_text,COALESCE(NULLIF(em.caption_override,''),m.caption) caption,m.id,m.source_url,m.storage_key,m.mime_type FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.public_visible=1 AND m.state='active' AND m.privacy IN ('public','unlisted') AND em.entity_id IN (${placeholders}) ORDER BY em.entity_id,em.sort_order`).bind(...entityIds).all();
  const map = new Map();
  for (const row of result.results || []) {
    if (!map.has(row.entity_id)) map.set(row.entity_id, []);
    map.get(row.entity_id).push({ id: row.id, role: row.role, url: row.source_url || `/api/construct/media/${row.id}`, alt: row.alt_text, caption: row.caption, mimeType: row.mime_type });
  }
  return map;
}

export const RESOURCE_CONFIG = {
  flash: { table: "flash_items", entityType: "flash_item", states: ["draft","available","reserved","placed","retired","archived"], fields: ["series_id","slug","title","description","state","size_bucket","price_label","item_type","process_category","claimable","sheet_code","design_code","legacy_path","merch_status","merch_url","related_nodes_json","session_category","split_policy","estimated_sessions_min","estimated_sessions_max","estimated_total_minutes_min","estimated_total_minutes_max","session_plan_note","sort_order"] },
  "flash-series": { table: "flash_series", entityType: "flash_series", states: ["draft","published","retired","archived"], fields: ["name","slug","description","state","merch_status","merch_url","related_nodes_json","sort_order"] },
  "visual-language": { table: "visual_symbols", entityType: "visual_symbol", states: ["draft","published","retired","archived"], fields: ["category_id","slug","name","meaning","svg_markup","themes_json","examples_json","state","sort_order"] },
  art: { table: "art_works", entityType: "art_work", states: ["draft","published","retired","archived"], fields: ["series_id","slug","title","statement","year","medium","dimensions","availability","acquisition_eligible","state","legacy_path","sort_order"] },
  archive: { table: "archive_records", entityType: "archive_record", states: ["draft","published","retired","archived"], fields: ["title","slug","node_label","record_type","room","date_or_period","timeline_period","summary","body","body_html","record_status","state","why_it_matters","source_note","related_notes_json","related_routes_json","sort_order"] },
  "archive-collections": { table: "archive_collections", entityType: "archive_collection", states: ["draft","published","retired","archived"], fields: ["name","slug","description","state","sort_order"] },
  people: { table: "people", entityType: "person", states: ["draft","published","retired","archived"], fields: ["name","slug","bio","privacy","state"] },
  places: { table: "places", entityType: "place", states: ["draft","published","retired","archived"], fields: ["name","slug","public_location","private_location","privacy","state"] },
  nodes: { table: "construct_nodes", entityType: "construct_node", states: ["draft","published","retired","archived"], fields: ["name","slug","route","color","state","homepage_enabled","sort_order"] },
  pathways: { table: "construct_pathways", entityType: "construct_pathway", states: ["draft","published","retired","archived"], fields: ["node_id","name","route","color","state","homepage_enabled","sort_order"] },
};
