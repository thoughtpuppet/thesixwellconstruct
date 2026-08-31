import { db, failure, id, json, readJson, text } from "../_shared/construct.js";

const ENTITY_TYPES = new Set(["art_work", "portfolio_item", "flash_item", "merch_item"]);
const PUBLIC_TYPES = new Set(["painting", "tattoo", "flash", "merch"]);
const STRENGTHS = new Set(["dominant", "supporting", "accent"]);
const STRENGTH_ORDER = new Map([["dominant", 0], ["supporting", 1], ["accent", 2]]);
const PROMPT_VERSION = "visual-colors-v2";
const DEFAULT_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const publicTypeFor = (entityType) => ({ art_work: "painting", portfolio_item: "tattoo", flash_item: "flash", merch_item: "merch" }[entityType] || "");
const entityTypeFor = (publicType) => ({ painting: "art_work", tattoo: "portfolio_item", flash: "flash_item", merch: "merch_item" }[publicType] || "");

function parseJson(value, fallback) {
  try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function bool(value) { return value === true || value === 1 || value === "1"; }
function boundedInteger(value, fallback, min, max) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function publicPath(value, fallback = "") {
  const candidate = text(value, 2000);
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate, "https://the-six-well-construct.invalid");
    return parsed.origin === "https://the-six-well-construct.invalid" ? `${parsed.pathname}${parsed.search}` : parsed.href;
  } catch { return fallback; }
}

function imageFromMedia(row) {
  return {
    id: row.media_id,
    role: row.media_role || "gallery",
    sort_order: Number(row.media_sort_order || 0),
    source_url: row.source_url || "",
    storage_key: row.storage_key || "",
    mime_type: row.mime_type || "",
    byte_size: Number(row.byte_size || 0),
    media_updated_at: row.media_updated_at || "",
    documentation_updated_at: row.documentation_updated_at || "",
    analysis_eligible: row.media_state === "active",
    public_eligible: row.media_state === "active" && row.media_privacy === "public"
      && row.public_presentation === "inline" && bool(row.media_public_visible),
    public_url: publicPath(row.source_url, row.media_id ? `/api/construct/entity-media/${encodeURIComponent(row.media_id)}` : ""),
  };
}

function primaryTattooImage(row) {
  return {
    id: `portfolio-primary:${row.id}`,
    role: "result",
    sort_order: -1,
    source_url: row.primary_source_url || "",
    storage_key: row.primary_storage_key || "",
    mime_type: row.primary_content_type || "",
    byte_size: Number(row.primary_byte_size || 0),
    media_updated_at: row.updated_at || "",
    documentation_updated_at: row.primary_documentation_updated_at || "",
    analysis_eligible: true,
    public_eligible: bool(row.primary_public_visible),
    public_url: publicPath(row.primary_source_url, `/api/portfolio/media/${encodeURIComponent(row.id)}`),
  };
}

function descriptorSuggestions(item) {
  if (item.entity_type === "portfolio_item") return { term_slugs: ["tattoo", "tattoo-ink"], unresolved_medium_text: "" };
  if (item.entity_type === "flash_item") return { term_slugs: ["flash"], unresolved_medium_text: "" };
  if (item.entity_type === "merch_item") return { term_slugs: ["merch"], unresolved_medium_text: "" };
  const medium = text(item.medium, 500);
  const normalized = medium.toLowerCase();
  const termSlugs = ["painting"];
  if (/\bacrylic\b/.test(normalized)) termSlugs.push("acrylic-paint");
  if (/\bwood(?:en)?\s+panel\b|\bpanel\b/.test(normalized)) termSlugs.push("wood-panel");
  if (/\bcanvas\b/.test(normalized)) termSlugs.push("canvas");
  const understood = !medium || /\bpainting\b|\bacrylic\b|\bwood(?:en)?\s+panel\b|\bpanel\b|\bcanvas\b/i.test(medium);
  return { term_slugs: [...new Set(termSlugs)], unresolved_medium_text: understood ? "" : medium };
}

function finishItem(item) {
  item.images = item.images
    .filter((image) => image && image.analysis_eligible !== false && /^image\//i.test(image.mime_type || "") && (image.storage_key || image.source_url))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  item.analysis_ready = item.images.length > 0;
  item.blocking_reason = item.analysis_ready ? "" : "Waiting for a usable image.";
  item.public_eligible = item.item_public_eligible && item.images.some((image) => image.public_eligible);
  item.descriptor_suggestions = descriptorSuggestions(item);
  return item;
}

export async function discoverVisualColorInventory(database) {
  const [artRows, tattooRows, tattooGalleryRows, flashRows, merchRows] = await database.batch([
    database.prepare(`SELECT aw.*,ce.visibility entity_visibility,
      em.media_id,em.role media_role,em.sort_order media_sort_order,em.public_visible media_public_visible,
      m.source_url,m.storage_key,m.mime_type,m.byte_size,m.state media_state,m.privacy media_privacy,
      m.public_presentation,m.updated_at media_updated_at
      FROM art_works aw JOIN content_entities ce ON ce.id=aw.id
      LEFT JOIN entity_media em ON em.entity_id=aw.id AND em.role='primary'
      LEFT JOIN media_assets m ON m.id=em.media_id
      WHERE aw.state<>'archived' ORDER BY aw.sort_order,aw.id,em.sort_order`),
    database.prepare(`SELECT pi.*,ce.visibility entity_visibility,
      pi.source_url primary_source_url,pi.storage_key primary_storage_key,pi.content_type primary_content_type,
      0 primary_byte_size,pid.image_role primary_image_role,
      pid.updated_at primary_documentation_updated_at
      FROM portfolio_items pi JOIN content_entities ce ON ce.id=pi.id
      LEFT JOIN portfolio_image_details pid ON pid.portfolio_item_id=pi.id AND pid.image_ref='primary'
      WHERE pi.state<>'archived' ORDER BY pi.sort_order,pi.id`),
    database.prepare(`SELECT pi.id,em.media_id,em.role media_role,em.sort_order media_sort_order,
      em.public_visible media_public_visible,m.source_url,m.storage_key,m.mime_type,m.byte_size,
      m.state media_state,m.privacy media_privacy,m.public_presentation,m.updated_at media_updated_at,
      pid.image_role,pid.updated_at documentation_updated_at
      FROM portfolio_items pi JOIN entity_media em ON em.entity_id=pi.id AND em.role='gallery'
      JOIN media_assets m ON m.id=em.media_id
      LEFT JOIN portfolio_image_details pid ON pid.portfolio_item_id=pi.id AND pid.image_ref=em.media_id
      WHERE pi.state<>'archived' ORDER BY pi.id,em.sort_order,em.created_at`),
    database.prepare(`SELECT fi.*,ce.visibility entity_visibility,
      em.media_id,em.role media_role,em.sort_order media_sort_order,em.public_visible media_public_visible,
      m.source_url,m.storage_key,m.mime_type,m.byte_size,m.state media_state,m.privacy media_privacy,
      m.public_presentation,m.updated_at media_updated_at
      FROM flash_items fi JOIN content_entities ce ON ce.id=fi.id
      LEFT JOIN entity_media em ON em.entity_id=fi.id AND em.role IN ('primary','gallery')
      LEFT JOIN media_assets m ON m.id=em.media_id
      WHERE fi.state<>'archived' ORDER BY fi.sort_order,fi.id,
      CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order`),
    database.prepare(`SELECT mi.*,ce.visibility entity_visibility,
      em.media_id,em.role media_role,em.sort_order media_sort_order,em.public_visible media_public_visible,
      m.source_url,m.storage_key,m.mime_type,m.byte_size,m.state media_state,m.privacy media_privacy,
      m.public_presentation,m.updated_at media_updated_at
      FROM merch_items mi JOIN content_entities ce ON ce.id=mi.id
      LEFT JOIN entity_media em ON em.entity_id=mi.id AND em.role IN ('primary','gallery')
      LEFT JOIN media_assets m ON m.id=em.media_id
      WHERE mi.state<>'archived' ORDER BY mi.sort_order,mi.id,
      CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order`),
  ]);
  const items = new Map();
  const ensure = (key, make) => {
    if (!items.has(key)) items.set(key, make());
    return items.get(key);
  };
  for (const row of artRows.results || []) {
    const item = ensure(`art_work:${row.id}`, () => ({
      entity_type: "art_work", id: row.id, title: row.title || "Untitled painting", date_label: row.year || "",
      date_sort: row.year || row.updated_at || "", medium: row.medium || "", route: row.legacy_path || `/art/${encodeURIComponent(row.slug || row.id)}/`,
      state: row.state, entity_visibility: row.entity_visibility, item_updated_at: row.updated_at, images: [],
      item_public_eligible: row.state === "published" && row.entity_visibility === "public",
    }));
    if (row.media_id && !item.images.length) item.images.push(imageFromMedia(row));
  }
  for (const row of tattooRows.results || []) {
    const item = {
      entity_type: "portfolio_item", id: row.id, title: row.title || "Untitled tattoo", date_label: row.year || "",
      date_sort: row.year || row.updated_at || "", medium: "Tattoo", route: `/tattoos/portfolio/?work=${encodeURIComponent(row.id)}`,
      state: row.state, entity_visibility: row.entity_visibility, item_updated_at: row.updated_at, images: [],
      item_public_eligible: row.state === "published" && row.entity_visibility === "public",
    };
    if ((row.primary_image_role || "result") === "result") item.images.push(primaryTattooImage(row));
    items.set(`portfolio_item:${row.id}`, item);
  }
  for (const row of tattooGalleryRows.results || []) {
    if ((row.image_role || "result") !== "result") continue;
    const item = items.get(`portfolio_item:${row.id}`);
    if (item) item.images.push(imageFromMedia(row));
  }
  for (const row of flashRows.results || []) {
    const item = ensure(`flash_item:${row.id}`, () => ({
      entity_type: "flash_item", id: row.id, title: row.title || "Untitled flash", date_label: "", date_sort: row.updated_at || "",
      medium: "Flash", route: row.legacy_path || `/tattoos/flash/${encodeURIComponent(row.slug || row.id)}/`, state: row.state,
      entity_visibility: row.entity_visibility, item_updated_at: row.updated_at, images: [],
      item_public_eligible: ["available", "reserved", "placed"].includes(row.state) && row.entity_visibility === "public",
    }));
    if (row.media_id) item.images.push(imageFromMedia(row));
  }
  for (const row of merchRows.results || []) {
    const item = ensure(`merch_item:${row.id}`, () => ({
      entity_type: "merch_item", id: row.id, title: row.title || "Untitled merch", date_label: "", date_sort: row.updated_at || "",
      medium: "Merch", route: row.route || `/merch/${encodeURIComponent(row.slug || row.id)}/`, state: row.state,
      entity_visibility: row.entity_visibility, item_updated_at: row.updated_at, images: [], legacy_image_url: row.image_url || "",
      item_public_eligible: row.state === "published" && row.entity_visibility === "public",
    }));
    if (row.media_id) item.images.push(imageFromMedia(row));
  }
  for (const item of items.values()) {
    if (item.entity_type === "merch_item" && !item.images.length && item.legacy_image_url) {
      item.images.push({ id: `merch-image:${item.id}`, role: "primary", sort_order: 0, source_url: item.legacy_image_url,
        storage_key: "", mime_type: /\.png(?:\?|$)/i.test(item.legacy_image_url) ? "image/png" : "image/jpeg", byte_size: 0,
        media_updated_at: item.item_updated_at, documentation_updated_at: "", analysis_eligible: true, public_eligible: item.item_public_eligible,
        public_url: publicPath(item.legacy_image_url) });
    }
    finishItem(item);
  }
  return items;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function atomicVocabulary(database) {
  const rows = (await database.prepare(`SELECT f.id,f.slug,f.name,f.swatch_hex,f.sort_order,f.updated_at
    FROM archive_color_families f JOIN archive_visual_color_vocabulary v ON v.family_id=f.id
    WHERE f.publication_state='published' AND f.public_visible=1 ORDER BY f.sort_order,f.name`).all()).results || [];
  return rows.filter((family) => !/[\x2f&+,]/.test(family.name) && !/(^|\s)and(\s|$)/i.test(family.name));
}

async function vocabularyFingerprint(families) {
  return sha256(JSON.stringify(families.map(({ id: familyId, slug, name, swatch_hex, updated_at }) => ({ id: familyId, slug, name, swatch_hex, updated_at }))));
}

function sourceManifest(item, config, vocabularyFingerprintValue) {
  return {
    entity_type: item.entity_type, entity_id: item.id, title: item.title, date_label: item.date_label,
    medium: item.medium, route: item.route, item_updated_at: item.item_updated_at,
    model_version: config.modelVersion, prompt_version: config.promptVersion, vocabulary_fingerprint: vocabularyFingerprintValue,
    images: item.images.map(({ id: mediaId, role, sort_order, source_url, storage_key, mime_type, byte_size, media_updated_at, documentation_updated_at, public_url }) => ({
      id: mediaId, role, sort_order, source_url, storage_key, mime_type, byte_size, media_updated_at, documentation_updated_at, public_url,
    })),
  };
}

async function fingerprintFor(item, config, vocabularyFingerprintValue) {
  const manifest = sourceManifest(item, config, vocabularyFingerprintValue);
  return { manifest, fingerprint: await sha256(JSON.stringify(manifest)) };
}

function modelConfig(env) {
  return {
    modelName: text(env.VISUAL_COLOR_MODEL, 300) || DEFAULT_MODEL,
    modelVersion: text(env.VISUAL_COLOR_MODEL_VERSION, 160) || DEFAULT_MODEL,
    promptVersion: text(env.VISUAL_COLOR_PROMPT_VERSION, 160) || PROMPT_VERSION,
  };
}

async function ensureControl(database, entityType, entityId) {
  await database.prepare(`INSERT OR IGNORE INTO archive_visual_color_controls
    (entity_type,entity_id,analysis_mode,has_studio_edits,updated_by,created_at,updated_at)
    VALUES(?,?,'automatic',0,'automatic',datetime('now'),datetime('now'))`).bind(entityType, entityId).run();
}

async function createOrFindRun(database, env, item, families, { force = false } = {}) {
  await ensureControl(database, item.entity_type, item.id);
  const control = await database.prepare("SELECT * FROM archive_visual_color_controls WHERE entity_type=? AND entity_id=?").bind(item.entity_type, item.id).first();
  if (control?.analysis_mode === "paused" && !force) return { queued: false, reason: "paused" };
  if (!item.analysis_ready) return { queued: false, reason: "waiting_for_image" };
  const config = modelConfig(env);
  const vocabFingerprint = await vocabularyFingerprint(families);
  const { manifest, fingerprint } = await fingerprintFor(item, config, vocabFingerprint);
  const existing = await database.prepare(`SELECT * FROM archive_visual_analysis_runs
    WHERE entity_type=? AND entity_id=? AND source_fingerprint=? AND model_name=? AND prompt_version=?`).bind(
    item.entity_type, item.id, fingerprint, config.modelName, config.promptVersion,
  ).first();
  if (existing && !force) return { queued: false, run: existing, reason: existing.status };
  if (existing && force) {
    await database.prepare(`UPDATE archive_visual_analysis_runs SET status='pending',attempts=0,raw_result_json='',
      normalized_suggestions_json='[]',error_text='',started_at=NULL,completed_at=NULL,updated_at=datetime('now') WHERE id=?`).bind(existing.id).run();
    return { queued: true, run: { ...existing, status: "pending" } };
  }
  const runId = id("visual-analysis-run");
  await database.prepare(`INSERT INTO archive_visual_analysis_runs
    (id,entity_type,entity_id,source_manifest_json,source_fingerprint,model_name,model_version,prompt_version,status,
      attempts,descriptor_suggestions_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?, 'pending',0,?,datetime('now'),datetime('now'))`).bind(
    runId, item.entity_type, item.id, JSON.stringify(manifest), fingerprint, config.modelName, config.modelVersion,
    config.promptVersion, JSON.stringify(item.descriptor_suggestions),
  ).run();
  return { queued: true, run: { id: runId, entity_type: item.entity_type, entity_id: item.id, status: "pending" } };
}

async function sendQueue(env, run) {
  if (!run?.id || !env.VISUAL_COLOR_QUEUE?.send) return false;
  await env.VISUAL_COLOR_QUEUE.send({ run_id: run.id, entity_type: run.entity_type, entity_id: run.entity_id });
  return true;
}

export async function enqueueVisualColorEntity(env, entityType, entityId, options = {}) {
  if (!ENTITY_TYPES.has(entityType) || !text(entityId, 200)) return { queued: false, reason: "unsupported" };
  try {
    const database = db(env);
    const [inventory, families] = await Promise.all([discoverVisualColorInventory(database), atomicVocabulary(database)]);
    const item = inventory.get(`${entityType}:${entityId}`);
    if (!item) return { queued: false, reason: "archived_or_missing" };
    const result = await createOrFindRun(database, env, item, families, options);
    if (result.queued) await sendQueue(env, result.run);
    return result;
  } catch (error) {
    console.error("visual color enqueue failed", entityType, entityId, error);
    return { queued: false, reason: "error", error: text(error?.message || error, 1000) };
  }
}

export async function enqueueVisualColorEntityById(env, entityId, options = {}) {
  try {
    const row = await db(env).prepare("SELECT entity_type FROM content_entities WHERE id=?").bind(entityId).first();
    return row && ENTITY_TYPES.has(row.entity_type)
      ? enqueueVisualColorEntity(env, row.entity_type, entityId, options)
      : { queued: false, reason: "unsupported" };
  } catch (error) {
    console.error("visual color entity lookup failed", entityId, error);
    return { queued: false, reason: "error" };
  }
}

export async function reconcileVisualColorAnalysis(env, { limit } = {}) {
  const database = db(env);
  const [inventory, families] = await Promise.all([discoverVisualColorInventory(database), atomicVocabulary(database)]);
  const maximum = boundedInteger(limit ?? env.VISUAL_COLOR_RECONCILE_LIMIT, 50, 1, 200);
  const results = [];
  for (const item of inventory.values()) {
    if (results.length >= maximum) break;
    const result = await createOrFindRun(database, env, item, families);
    if (result.queued) {
      await sendQueue(env, result.run);
      results.push({ entity_type: item.entity_type, entity_id: item.id, run_id: result.run.id });
    }
  }
  return { inventory: inventory.size, queued: results.length, results };
}

function visualPrompt(families) {
  return `Classify the intentionally used colors in this created visual work. Allowed atomic color families only: ${families.map((family) => family.slug).join(", ")}. Never combine or invent a family. Choose 1 to 8 visibly meaningful families and label each dominant, supporting, or accent. Exclude skin, photographic backgrounds, frames, glare, shadows, reflections, and compression artifacts. Return only minified JSON: {"colors":[{"family":"blue","strength":"dominant"}]}`;
}

function responseObject(raw) {
  const candidate = raw?.response ?? raw?.result ?? raw;
  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") return {};
  const stripped = candidate.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const direct = parseJson(stripped, null);
  if (direct && typeof direct === "object") return direct;
  const start = stripped.indexOf("{"); const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(stripped.slice(start, end + 1), {}) : {};
}

export function normalizeAutomaticVisualColorResult(raw, families) {
  const allowed = new Map(families.map((family) => [String(family.slug).toLowerCase(), family]));
  const payload = responseObject(raw);
  if (!Array.isArray(payload.colors)) throw new Error("Model result did not contain a colors array.");
  const normalized = new Map();
  for (const row of payload.colors) {
    const slug = text(row?.family, 120).toLowerCase();
    const strength = text(row?.strength, 30).toLowerCase();
    if (!allowed.has(slug)) throw new Error(`Model invented or returned an unavailable family: ${slug || "(empty)"}.`);
    if (!STRENGTHS.has(strength)) throw new Error(`Model returned an invalid strength for ${slug}.`);
    const family = allowed.get(slug);
    const previous = normalized.get(family.id);
    if (!previous || STRENGTH_ORDER.get(strength) < STRENGTH_ORDER.get(previous.strength)) {
      normalized.set(family.id, { family_id: family.id, family_slug: family.slug, family_name: family.name, strength });
    }
  }
  if (!normalized.size) throw new Error("Model returned no usable color families.");
  return [...normalized.values()].sort((a, b) => STRENGTH_ORDER.get(a.strength) - STRENGTH_ORDER.get(b.strength) || a.family_name.localeCompare(b.family_name));
}

function mergeSuggestions(sets) {
  const merged = new Map();
  for (const set of sets) for (const row of set) {
    const prior = merged.get(row.family_id);
    if (!prior || STRENGTH_ORDER.get(row.strength) < STRENGTH_ORDER.get(prior.strength)) merged.set(row.family_id, row);
  }
  return [...merged.values()].sort((a, b) => STRENGTH_ORDER.get(a.strength) - STRENGTH_ORDER.get(b.strength) || a.family_name.localeCompare(b.family_name));
}

async function imageBytes(image, env) {
  let response;
  if (image.storage_key) {
    if (!env.SUBMISSION_FILES?.get) throw new Error("SUBMISSION_FILES R2 binding is not configured.");
    const object = await env.SUBMISSION_FILES.get(image.storage_key);
    if (!object) throw new Error("Eligible R2 image object was not found.");
    const contentType = text(object.httpMetadata?.contentType || image.mime_type, 120).toLowerCase();
    const bytes = new Uint8Array(await object.arrayBuffer());
    response = { contentType, bytes };
  } else {
    const source = text(image.source_url, 2000);
    if (!source || source.startsWith("/api/")) throw new Error("Dynamic media requires a direct R2 storage key.");
    const requestUrl = new URL(source, text(env.PUBLIC_SITE_URL, 1000) || "https://thesixwellconstruct.com");
    const result = requestUrl.origin === new URL(text(env.PUBLIC_SITE_URL, 1000) || "https://thesixwellconstruct.com").origin && env.ASSETS?.fetch
      ? await env.ASSETS.fetch(new Request(requestUrl))
      : await fetch(requestUrl);
    if (!result?.ok) throw new Error(`Eligible static image fetch failed (${Number(result?.status || 0)}).`);
    response = { contentType: text(result.headers.get("content-type"), 120).split(";")[0].toLowerCase(), bytes: new Uint8Array(await result.arrayBuffer()) };
  }
  if (!response.contentType.startsWith("image/")) throw new Error("Eligible source is not an image.");
  if (!response.bytes.length) throw new Error("Eligible image is empty.");
  if (response.bytes.length > MAX_IMAGE_BYTES) throw new Error("Eligible image exceeds the 12 MB analysis limit.");
  let binary = "";
  for (let offset = 0; offset < response.bytes.length; offset += 0x8000) binary += String.fromCharCode(...response.bytes.subarray(offset, offset + 0x8000));
  return `data:${response.contentType};base64,${btoa(binary)}`;
}

async function validateCurrentRun(database, env, run, families) {
  const inventory = await discoverVisualColorInventory(database);
  const item = inventory.get(`${run.entity_type}:${run.entity_id}`);
  if (!item?.analysis_ready) return null;
  const current = await fingerprintFor(item, modelConfig(env), await vocabularyFingerprint(families));
  return current.fingerprint === run.source_fingerprint ? item : null;
}

async function replaceAssignments(database, run, suggestions, descriptorTermIds, origin, actor) {
  const statements = [
    database.prepare("DELETE FROM archive_visual_color_entity_assignments WHERE entity_type=? AND entity_id=?").bind(run.entity_type, run.entity_id),
    database.prepare("DELETE FROM archive_work_descriptor_entity_assignments WHERE entity_type=? AND entity_id=?").bind(run.entity_type, run.entity_id),
  ];
  suggestions.forEach((row, index) => statements.push(database.prepare(`INSERT INTO archive_visual_color_entity_assignments
    (id,entity_type,entity_id,family_id,strength,display_order,source_run_id,origin,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(
    id("visual-color-assignment"), run.entity_type, run.entity_id, row.family_id, row.strength,
    boundedInteger(row.display_order, index, 0, 1000), run.id || null, origin, actor,
  )));
  descriptorTermIds.forEach((termId) => statements.push(database.prepare(`INSERT INTO archive_work_descriptor_entity_assignments
    (id,entity_type,entity_id,term_id,source_run_id,origin,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(
    id("work-descriptor-assignment"), run.entity_type, run.entity_id, termId, run.id || null, origin, actor,
  )));
  await database.batch(statements);
}

async function descriptorTermIds(database, suggestion) {
  const slugs = [...new Set((suggestion?.term_slugs || []).map((slug) => text(slug, 120)).filter(Boolean))];
  if (!slugs.length) return [];
  return ((await database.prepare(`SELECT id FROM archive_work_descriptor_terms WHERE slug IN (${slugs.map(() => "?").join(",")})
    AND publication_state='published' AND public_visible=1`).bind(...slugs).all()).results || []).map((row) => row.id);
}

async function analyzeRun(env, runId) {
  const database = db(env);
  const maxAttempts = boundedInteger(env.VISUAL_COLOR_MAX_ATTEMPTS, 3, 1, 8);
  const [run, families] = await Promise.all([
    database.prepare("SELECT * FROM archive_visual_analysis_runs WHERE id=?").bind(runId).first(), atomicVocabulary(database),
  ]);
  if (!run || !["pending", "failed"].includes(run.status)) return { ignored: true, status: run?.status || "missing" };
  const attempt = Number(run.attempts || 0) + 1;
  await database.prepare("UPDATE archive_visual_analysis_runs SET status='running',attempts=?,started_at=datetime('now'),error_text='',updated_at=datetime('now') WHERE id=?").bind(attempt, run.id).run();
  try {
    if (!env.AI?.run) throw new Error("Workers AI binding is not configured.");
    const item = await validateCurrentRun(database, env, run, families);
    if (!item) {
      await database.prepare("UPDATE archive_visual_analysis_runs SET status='superseded',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(run.id).run();
      return { id: run.id, status: "superseded" };
    }
    const manifest = parseJson(run.source_manifest_json, {});
    const rawResults = []; const sets = [];
    for (const image of manifest.images || []) {
      const data = await imageBytes(image, env);
      const raw = await env.AI.run(run.model_name, { prompt: visualPrompt(families), image: data, max_tokens: 512, temperature: 0 });
      rawResults.push({ image_id: image.id, response: raw });
      sets.push(normalizeAutomaticVisualColorResult(raw, families));
    }
    const suggestions = mergeSuggestions(sets).map((row, index) => ({ ...row, display_order: index }));
    if (!suggestions.length) throw new Error("Analysis returned no usable work-level color set.");
    const control = await database.prepare("SELECT * FROM archive_visual_color_controls WHERE entity_type=? AND entity_id=?").bind(run.entity_type, run.entity_id).first();
    const descriptors = await descriptorTermIds(database, parseJson(run.descriptor_suggestions_json, {}));
    if (bool(control?.has_studio_edits)) {
      await database.batch([
        database.prepare(`UPDATE archive_visual_analysis_runs SET status='needs_confirmation',raw_result_json=?,normalized_suggestions_json=?,
          completed_at=datetime('now'),error_text='',updated_at=datetime('now') WHERE id=?`).bind(JSON.stringify(rawResults), JSON.stringify(suggestions), run.id),
        database.prepare(`UPDATE archive_visual_color_controls SET pending_confirmation_run_id=?,updated_by='automatic',updated_at=datetime('now')
          WHERE entity_type=? AND entity_id=?`).bind(run.id, run.entity_type, run.entity_id),
      ]);
      return { id: run.id, status: "needs_confirmation", suggestions: suggestions.length };
    }
    await replaceAssignments(database, run, suggestions, descriptors, "automatic", "automatic");
    await database.batch([
      database.prepare("UPDATE archive_visual_analysis_runs SET status='superseded',updated_at=datetime('now') WHERE entity_type=? AND entity_id=? AND status='active' AND id<>?").bind(run.entity_type, run.entity_id, run.id),
      database.prepare(`UPDATE archive_visual_analysis_runs SET status='active',raw_result_json=?,normalized_suggestions_json=?,completed_at=datetime('now'),error_text='',updated_at=datetime('now') WHERE id=?`).bind(JSON.stringify(rawResults), JSON.stringify(suggestions), run.id),
      database.prepare(`UPDATE archive_visual_color_controls SET active_run_id=?,pending_confirmation_run_id=NULL,has_studio_edits=0,updated_by='automatic',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?`).bind(run.id, run.entity_type, run.entity_id),
    ]);
    return { id: run.id, status: "active", suggestions: suggestions.length };
  } catch (error) {
    const message = text(error?.message || error, 4000);
    const status = attempt >= maxAttempts || /not configured|invented|no usable|did not contain|not an image|exceeds/i.test(message) ? "failed" : "pending";
    await database.prepare("UPDATE archive_visual_analysis_runs SET status=?,error_text=?,completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(status, message, run.id).run();
    throw Object.assign(new Error(message), { retryable: status === "pending" });
  }
}

export async function handleVisualColorQueue(batch, env) {
  for (const message of batch.messages || []) {
    try {
      await analyzeRun(env, text(message.body?.run_id, 240));
      message.ack?.();
    } catch { message.retry?.(); }
  }
}

export async function runAutomaticVisualColorPass(env) {
  const reconciliation = await reconcileVisualColorAnalysis(env);
  if (env.VISUAL_COLOR_QUEUE?.send) return { ...reconciliation, processed: [] };
  const database = db(env);
  const pending = (await database.prepare("SELECT id FROM archive_visual_analysis_runs WHERE status='pending' ORDER BY created_at LIMIT ?")
    .bind(boundedInteger(env.VISUAL_COLOR_WORKS_PER_PASS, 1, 1, 5)).all()).results || [];
  const processed = [];
  for (const run of pending) {
    try { processed.push(await analyzeRun(env, run.id)); } catch (error) { processed.push({ id: run.id, error: text(error?.message || error, 1000) }); }
  }
  return { ...reconciliation, processed };
}

function workMap(inventory, publicOnly = false) {
  return new Map([...inventory.values()].filter((item) => !publicOnly || item.public_eligible).map((item) => [`${item.entity_type}:${item.id}`, item]));
}

async function publicFamilies(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env); const works = workMap(await discoverVisualColorInventory(database), true);
  const [families, assignments] = await database.batch([
    database.prepare(`SELECT f.* FROM archive_color_families f JOIN archive_visual_color_vocabulary v ON v.family_id=f.id
      WHERE f.publication_state='published' AND f.public_visible=1 ORDER BY f.sort_order,f.name`),
    database.prepare("SELECT entity_type,entity_id,family_id,strength,display_order FROM archive_visual_color_entity_assignments"),
  ]);
  const rows = (families.results || []).map((family) => {
    const eligible = (assignments.results || []).filter((a) => a.family_id === family.id && works.has(`${a.entity_type}:${a.entity_id}`));
    const count = (type) => new Set(eligible.filter((a) => !type || publicTypeFor(a.entity_type) === type).map((a) => `${a.entity_type}:${a.entity_id}`)).size;
    return { slug: family.slug, name: family.name, swatch_hex: family.swatch_hex, count: count(""), total_count: count(""),
      painting_count: count("painting"), tattoo_count: count("tattoo"), flash_count: count("flash"), merch_count: count("merch") };
  }).filter((family) => family.count > 0);
  return json({ families: rows, count: rows.length }, { cache: "public, max-age=60" });
}

function dateSortValue(value) {
  const year = /\b(\d{4})\b/.exec(String(value || ""));
  if (year) return Number(year[1]);
  const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0;
}

async function publicFamilyWorks(request, env, slug) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const type = text(new URL(request.url).searchParams.get("type"), 20) || "all";
  if (type !== "all" && !PUBLIC_TYPES.has(type)) return failure("Choose all, painting, tattoo, flash, or merch.", 400);
  const database = db(env); const works = workMap(await discoverVisualColorInventory(database), true);
  const family = await database.prepare(`SELECT f.id,f.slug,f.name,f.swatch_hex FROM archive_color_families f
    JOIN archive_visual_color_vocabulary v ON v.family_id=f.id WHERE f.slug=? AND f.publication_state='published' AND f.public_visible=1`).bind(slug).first();
  if (!family) return failure("Visual color family not found.", 404);
  const assignments = (await database.prepare("SELECT entity_type,entity_id,strength,display_order FROM archive_visual_color_entity_assignments WHERE family_id=?").bind(family.id).all()).results || [];
  const records = assignments.map((assignment) => ({ assignment, work: works.get(`${assignment.entity_type}:${assignment.entity_id}`) }))
    .filter(({ assignment, work }) => work && (type === "all" || publicTypeFor(assignment.entity_type) === type))
    .map(({ assignment, work }) => ({ id: work.id, title: work.title, image: work.images.find((image) => image.public_eligible)?.public_url || "",
      route: work.route, type: publicTypeFor(work.entity_type), date_label: work.date_label, strength: assignment.strength }))
    .sort((a, b) => STRENGTH_ORDER.get(a.strength) - STRENGTH_ORDER.get(b.strength) || dateSortValue(b.date_label) - dateSortValue(a.date_label) || a.title.localeCompare(b.title));
  return json({ family: { slug: family.slug, name: family.name, swatch_hex: family.swatch_hex }, works: records, count: records.length, type }, { cache: "public, max-age=60" });
}

async function publicDescriptors(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env); const works = workMap(await discoverVisualColorInventory(database), true);
  const [terms, assignments] = await database.batch([
    database.prepare("SELECT * FROM archive_work_descriptor_terms WHERE publication_state='published' AND public_visible=1 ORDER BY sort_order,name"),
    database.prepare("SELECT entity_type,entity_id,term_id FROM archive_work_descriptor_entity_assignments"),
  ]);
  const descriptors = (terms.results || []).map((term) => {
    const eligible = (assignments.results || []).filter((a) => a.term_id === term.id && works.has(`${a.entity_type}:${a.entity_id}`));
    const count = (type) => new Set(eligible.filter((a) => !type || publicTypeFor(a.entity_type) === type).map((a) => `${a.entity_type}:${a.entity_id}`)).size;
    return { slug: term.slug, name: term.name, kind: term.descriptor_kind, description: term.description || "", count: count(""),
      painting_count: count("painting"), tattoo_count: count("tattoo"), flash_count: count("flash"), merch_count: count("merch") };
  }).filter((term) => term.count > 0);
  return json({ descriptors, count: descriptors.length }, { cache: "public, max-age=60" });
}

async function itemAssignments(database, item) {
  const [colors, descriptors] = await database.batch([
    database.prepare(`SELECT a.*,f.slug family_slug,f.name family_name,f.swatch_hex FROM archive_visual_color_entity_assignments a
      JOIN archive_color_families f ON f.id=a.family_id WHERE a.entity_type=? AND a.entity_id=? ORDER BY a.display_order,f.name`).bind(item.entity_type, item.id),
    database.prepare(`SELECT a.*,t.slug term_slug,t.name term_name,t.descriptor_kind FROM archive_work_descriptor_entity_assignments a
      JOIN archive_work_descriptor_terms t ON t.id=a.term_id WHERE a.entity_type=? AND a.entity_id=? ORDER BY t.sort_order,t.name`).bind(item.entity_type, item.id),
  ]);
  return { colors: colors.results || [], descriptors: descriptors.results || [] };
}

function inventoryStatus(item, control = {}, run = null) {
  if (control.analysis_mode === "paused") return "paused";
  if (!item.analysis_ready) return "waiting_for_image";
  if (bool(control.has_studio_edits) && control.pending_confirmation_run_id) return "needs_confirmation";
  if (bool(control.has_studio_edits)) return "studio_edited";
  if (run?.status === "pending") return "queued";
  if (run?.status === "running") return "analyzing";
  if (run?.status === "needs_confirmation") return "needs_confirmation";
  if (run?.status === "active" || control.active_run_id) return "live";
  if (run?.status === "failed") return "failed";
  return "queued";
}

async function analysisInventory(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env); const inventory = await discoverVisualColorInventory(database);
  const url = new URL(request.url); const filter = text(url.searchParams.get("filter"), 40) || "all";
  const [families, terms, controls, runs] = await database.batch([
    database.prepare(`SELECT f.* FROM archive_color_families f JOIN archive_visual_color_vocabulary v ON v.family_id=f.id WHERE f.publication_state<>'archived' ORDER BY f.sort_order,f.name`),
    database.prepare("SELECT * FROM archive_work_descriptor_terms WHERE publication_state<>'archived' ORDER BY sort_order,name"),
    database.prepare("SELECT * FROM archive_visual_color_controls"),
    database.prepare(`SELECT r.* FROM archive_visual_analysis_runs r WHERE rowid=(SELECT MAX(n.rowid) FROM archive_visual_analysis_runs n WHERE n.entity_type=r.entity_type AND n.entity_id=r.entity_id)`),
  ]);
  const controlMap = new Map((controls.results || []).map((row) => [`${row.entity_type}:${row.entity_id}`, row]));
  const runMap = new Map((runs.results || []).map((row) => [`${row.entity_type}:${row.entity_id}`, row]));
  const rows = [];
  for (const item of inventory.values()) {
    const key = `${item.entity_type}:${item.id}`; const control = controlMap.get(key) || {}; const run = runMap.get(key) || null;
    const assignments = await itemAssignments(database, item);
    const status = inventoryStatus(item, control, run);
    const type = publicTypeFor(item.entity_type);
    if (filter !== "all" && filter !== status && filter !== type && !(filter === "art" && type === "painting") && !(filter === "tattoos" && type === "tattoo")) continue;
    const images = item.images.map((image) => ({
      id: image.id, role: image.role, sort_order: image.sort_order, mime_type: image.mime_type,
      preview_url: image.source_url && !String(image.source_url).startsWith("/api/") ? publicPath(image.source_url)
        : image.id.startsWith("portfolio-primary:") ? `/api/admin/portfolio/media/${encodeURIComponent(item.id)}`
        : `/api/admin/media/${encodeURIComponent(image.id)}/file`,
    }));
    rows.push({ entity_type: item.entity_type, id: item.id, title: item.title, date_label: item.date_label, medium: item.medium,
      route: item.route, state: item.state, public_eligible: item.public_eligible, analysis_ready: item.analysis_ready,
      blocking_reason: item.blocking_reason, images, type, control: { analysis_mode: control.analysis_mode || "automatic", has_studio_edits: bool(control.has_studio_edits),
      active_run_id: control.active_run_id || null, pending_confirmation_run_id: control.pending_confirmation_run_id || null }, status,
      run: run ? { ...run, suggestions: parseJson(run.normalized_suggestions_json, []), descriptor_suggestions: parseJson(run.descriptor_suggestions_json, {}), raw_result_json: undefined } : null,
      current_assignments: assignments.colors, current_descriptors: assignments.descriptors });
  }
  const counts = {};
  for (const item of rows) counts[item.status] = (counts[item.status] || 0) + 1;
  return json({ items: rows, count: rows.length, counts, filter, families: families.results || [], descriptor_terms: terms.results || [] });
}

async function validateManualSet(database, body) {
  const colors = Array.isArray(body.colors) ? body.colors : [];
  const familyIds = colors.map((row) => text(row.family_id, 200)).filter(Boolean);
  if (new Set(familyIds).size !== familyIds.length || familyIds.length !== colors.length) return { error: "Each atomic family may appear only once." };
  if (colors.some((row) => !STRENGTHS.has(text(row.strength, 30)))) return { error: "Choose dominant, supporting, or accent for every family." };
  if (familyIds.length) {
    const found = (await database.prepare(`SELECT f.id FROM archive_color_families f JOIN archive_visual_color_vocabulary v ON v.family_id=f.id
      WHERE f.id IN (${familyIds.map(() => "?").join(",")}) AND f.publication_state='published'`).bind(...familyIds).all()).results || [];
    if (found.length !== familyIds.length) return { error: "Every color must belong to the current atomic vocabulary." };
  }
  const termIds = [...new Set((Array.isArray(body.descriptor_term_ids) ? body.descriptor_term_ids : []).map((value) => text(value, 200)).filter(Boolean))];
  if (termIds.length) {
    const found = (await database.prepare(`SELECT id FROM archive_work_descriptor_terms WHERE id IN (${termIds.map(() => "?").join(",")}) AND publication_state='published'`).bind(...termIds).all()).results || [];
    if (found.length !== termIds.length) return { error: "Every descriptor must belong to the controlled vocabulary." };
  }
  return { colors: colors.map((row, index) => ({ family_id: row.family_id, strength: row.strength, display_order: boundedInteger(row.display_order, index, 0, 1000) })), termIds };
}

async function patchAnalysisItem(request, env, entityType, entityId) {
  if (request.method !== "PATCH") return failure("Method not allowed.", 405);
  if (!ENTITY_TYPES.has(entityType)) return failure("Unsupported visual item type.", 400);
  const body = await readJson(request); if (!body) return failure("Send a JSON object.");
  const database = db(env); await ensureControl(database, entityType, entityId);
  if (body.analysis_mode) {
    if (!["automatic", "paused"].includes(body.analysis_mode)) return failure("Choose automatic or paused.");
    await database.prepare("UPDATE archive_visual_color_controls SET analysis_mode=?,updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(body.analysis_mode, entityType, entityId).run();
  }
  if (Array.isArray(body.colors) || Array.isArray(body.descriptor_term_ids)) {
    const validated = await validateManualSet(database, body); if (validated.error) return failure(validated.error, 409);
    const control = await database.prepare("SELECT active_run_id FROM archive_visual_color_controls WHERE entity_type=? AND entity_id=?").bind(entityType, entityId).first();
    await replaceAssignments(database, { id: control?.active_run_id || null, entity_type: entityType, entity_id: entityId }, validated.colors, validated.termIds, "studio", "studio");
    await database.prepare("UPDATE archive_visual_color_controls SET has_studio_edits=1,updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(entityType, entityId).run();
  }
  return json({ ok: true });
}

async function reanalyzeItem(request, env, entityType, entityId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const result = await enqueueVisualColorEntity(env, entityType, entityId, { force: true });
  return result.queued ? json({ ok: true, ...result }) : failure(`Analysis was not queued: ${result.reason}.`, 409);
}

async function activateRun(request, env, runId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env); const run = await database.prepare("SELECT * FROM archive_visual_analysis_runs WHERE id=?").bind(runId).first();
  if (!run || run.status !== "needs_confirmation") return failure("Pending replacement was not found.", 409);
  const suggestions = parseJson(run.normalized_suggestions_json, []); if (!suggestions.length) return failure("Pending replacement has no valid colors.", 409);
  const families = await atomicVocabulary(database); if (!await validateCurrentRun(database, env, run, families)) return failure("The item or vocabulary changed. Reanalyze first.", 409);
  const descriptors = await descriptorTermIds(database, parseJson(run.descriptor_suggestions_json, {}));
  await replaceAssignments(database, run, suggestions, descriptors, "automatic", "studio");
  await database.batch([
    database.prepare("UPDATE archive_visual_analysis_runs SET status='superseded',updated_at=datetime('now') WHERE entity_type=? AND entity_id=? AND status='active'").bind(run.entity_type, run.entity_id),
    database.prepare("UPDATE archive_visual_analysis_runs SET status='active',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(run.id),
    database.prepare("UPDATE archive_visual_color_controls SET active_run_id=?,pending_confirmation_run_id=NULL,has_studio_edits=0,updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(run.id, run.entity_type, run.entity_id),
  ]);
  return json({ ok: true, active: true });
}

async function dismissRun(request, env, runId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env); const run = await database.prepare("SELECT * FROM archive_visual_analysis_runs WHERE id=?").bind(runId).first();
  if (!run || run.status !== "needs_confirmation") return failure("Pending replacement was not found.", 409);
  await database.batch([
    database.prepare("UPDATE archive_visual_analysis_runs SET status='rejected',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(run.id),
    database.prepare("UPDATE archive_visual_color_controls SET pending_confirmation_run_id=NULL,updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(run.entity_type, run.entity_id),
  ]);
  return json({ ok: true, dismissed: true });
}

async function restoreAutomatic(request, env, entityType, entityId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env); await ensureControl(database, entityType, entityId);
  const control = await database.prepare("SELECT * FROM archive_visual_color_controls WHERE entity_type=? AND entity_id=?").bind(entityType, entityId).first();
  if (control?.pending_confirmation_run_id) return activateRun(new Request(request.url, { method: "POST" }), env, control.pending_confirmation_run_id);
  const run = control?.active_run_id ? await database.prepare("SELECT * FROM archive_visual_analysis_runs WHERE id=?").bind(control.active_run_id).first() : null;
  const suggestions = run ? parseJson(run.normalized_suggestions_json, []) : [];
  if (run && suggestions.length) {
    const descriptors = await descriptorTermIds(database, parseJson(run.descriptor_suggestions_json, {}));
    await replaceAssignments(database, run, suggestions, descriptors, "automatic", "studio");
    await database.prepare("UPDATE archive_visual_color_controls SET has_studio_edits=0,analysis_mode='automatic',updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(entityType, entityId).run();
    return json({ ok: true, restored: true });
  }
  await database.prepare("UPDATE archive_visual_color_controls SET has_studio_edits=0,analysis_mode='automatic',updated_by='studio',updated_at=datetime('now') WHERE entity_type=? AND entity_id=?").bind(entityType, entityId).run();
  return reanalyzeItem(request, env, entityType, entityId);
}

export async function handleAutomaticVisualColorPublic(request, env, path) {
  if (path === "/api/archive/visual-color-families") return publicFamilies(request, env);
  const works = path.match(/^\/api\/archive\/visual-color-families\/([^/]+)\/works$/);
  if (works) return publicFamilyWorks(request, env, decodeURIComponent(works[1]));
  if (path === "/api/archive/work-descriptors") return publicDescriptors(request, env);
  return null;
}

export async function handleAutomaticVisualColorAdmin(request, env, path) {
  if (path === "/api/admin/archive-color-materials/visual-analysis") return analysisInventory(request, env);
  if (path === "/api/admin/archive-color-materials/visual-review") return analysisInventory(request, env);
  if (path === "/api/admin/archive-color-materials/visual-review/enqueue") {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    return json({ ok: true, ...(await reconcileVisualColorAnalysis(env)) });
  }
  const legacyAction = path.match(/^\/api\/admin\/archive-color-materials\/visual-review\/([^/]+)\/(approve|reject|retry)$/);
  if (legacyAction) {
    const runId = decodeURIComponent(legacyAction[1]);
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    const database = db(env); const run = await database.prepare("SELECT * FROM archive_visual_analysis_runs WHERE id=?").bind(runId).first();
    if (!run) return failure("Analysis run not found.", 404);
    if (legacyAction[2] === "approve") {
      if (run.status === "active") return json({ ok: true, active: true });
      if (run.status === "needs_confirmation") return activateRun(request, env, runId);
      return reanalyzeItem(request, env, run.entity_type, run.entity_id);
    }
    if (legacyAction[2] === "reject") {
      if (run.status === "needs_confirmation") return dismissRun(request, env, runId);
      await database.prepare("UPDATE archive_visual_analysis_runs SET status='rejected',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(runId).run();
      return json({ ok: true, rejected: true });
    }
    return reanalyzeItem(request, env, run.entity_type, run.entity_id);
  }
  if (path === "/api/admin/archive-color-materials/visual-analysis/reconcile") {
    if (request.method !== "POST") return failure("Method not allowed.", 405);
    return json({ ok: true, ...(await reconcileVisualColorAnalysis(env)) });
  }
  const itemAction = path.match(/^\/api\/admin\/archive-color-materials\/visual-analysis\/items\/(art_work|portfolio_item|flash_item|merch_item)\/([^/]+)(?:\/(reanalyze|restore-automatic))?$/);
  if (itemAction) {
    const [, entityType, encodedId, action] = itemAction; const entityId = decodeURIComponent(encodedId);
    if (!action) return patchAnalysisItem(request, env, entityType, entityId);
    return action === "reanalyze" ? reanalyzeItem(request, env, entityType, entityId) : restoreAutomatic(request, env, entityType, entityId);
  }
  const runAction = path.match(/^\/api\/admin\/archive-color-materials\/visual-analysis\/runs\/([^/]+)\/(activate|dismiss)$/);
  if (runAction) return runAction[2] === "activate" ? activateRun(request, env, decodeURIComponent(runAction[1])) : dismissRun(request, env, decodeURIComponent(runAction[1]));
  return null;
}
