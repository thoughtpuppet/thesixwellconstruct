import { db, failure, id, json, readJson, text } from "../_shared/construct.js";

const WORK_TYPES = new Set(["painting", "tattoo"]);
const STRENGTHS = new Set(["dominant", "supporting", "accent"]);
const STRENGTH_ORDER = new Map([["dominant", 0], ["supporting", 1], ["accent", 2]]);
const REVIEW_FILTERS = new Set(["pending", "approved", "rejected", "failed"]);
const PROMPT_VERSION = "visual-colors-v1";
const DEFAULT_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WORKS_PER_PASS = 1;

export function isAtomicFamilyName(value) {
  const name = text(value, 240);
  return Boolean(name) && !/[\/&+,]/.test(name) && !/(^|\s)and(\s|$)/i.test(name);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function publicPath(value, fallback) {
  const candidate = text(value, 2000);
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate, "https://the-six-well-construct.invalid");
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    if (parsed.origin === "https://the-six-well-construct.invalid") return `${parsed.pathname}${parsed.search}`;
    return parsed.href;
  } catch {
    return fallback;
  }
}

function absoluteImageUrl(value, env) {
  try {
    return new URL(value, text(env.PUBLIC_SITE_URL, 1000) || "https://thesixwellconstruct.com").href;
  } catch {
    return "";
  }
}

function descriptorSuggestions(work) {
  if (work.type === "tattoo") {
    return { term_slugs: ["tattoo", "tattoo-ink"], unresolved_medium_text: "" };
  }
  const medium = text(work.medium, 500);
  const normalized = medium.toLowerCase();
  const termSlugs = ["painting"];
  if (/\bacrylic\b/.test(normalized)) termSlugs.push("acrylic-paint");
  if (/\bwood(?:en)?\s+panel\b|\bpanel\b/.test(normalized)) termSlugs.push("wood-panel");
  if (/\bcanvas\b/.test(normalized)) termSlugs.push("canvas");
  const recognized = !medium || /\bpainting\b|\bacrylic\b|\bwood(?:en)?\s+panel\b|\bpanel\b|\bcanvas\b/i.test(medium);
  return { term_slugs: [...new Set(termSlugs)], unresolved_medium_text: recognized ? "" : medium };
}

function paintingRoute(row) {
  return row.legacy_path || `/art/${encodeURIComponent(row.slug || row.id)}/`;
}

function tattooRoute(row) {
  return `/tattoos/portfolio/?work=${encodeURIComponent(row.id)}`;
}

function paintingImage(row) {
  return {
    id: row.media_id,
    url: publicPath(row.source_url, `/api/construct/entity-media/${encodeURIComponent(row.media_id)}`),
    mime_type: row.mime_type,
    updated_at: row.media_updated_at || "",
    documentation_updated_at: "",
    sort_order: Number(row.media_sort_order || 0),
    is_cover: true,
  };
}

function tattooImage(row, primary = false) {
  const mediaId = primary ? "primary" : row.media_id;
  const fallback = primary
    ? `/api/portfolio/media/${encodeURIComponent(row.id)}`
    : `/api/construct/entity-media/${encodeURIComponent(mediaId)}`;
  return {
    id: mediaId,
    url: publicPath(row.source_url, fallback),
    mime_type: primary ? row.content_type : row.mime_type,
    updated_at: primary ? (row.item_updated_at || "") : (row.media_updated_at || ""),
    documentation_updated_at: row.documentation_updated_at || "",
    sort_order: primary ? 0 : Number(row.media_sort_order || 0),
    is_cover: String(row.cover_image_ref || "primary") === mediaId,
  };
}

export async function discoverVisualColorWorkSources(database, env = {}) {
  const [paintingResult, tattooPrimaryResult, tattooGalleryResult] = await database.batch([
    database.prepare(`SELECT aw.id,aw.slug,aw.title,aw.year,aw.medium,aw.legacy_path,aw.sort_order,aw.updated_at item_updated_at,
        em.media_id,em.sort_order media_sort_order,m.source_url,m.storage_key,m.mime_type,m.updated_at media_updated_at
      FROM art_works aw
      JOIN content_entities ce ON ce.id=aw.id AND ce.visibility='public'
      JOIN entity_media em ON em.entity_id=aw.id AND em.role='primary' AND em.public_visible=1
      JOIN media_assets m ON m.id=em.media_id
      WHERE aw.state='published' AND m.state='active' AND m.privacy='public'
        AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
        AND m.mime_type LIKE 'image/%'
      ORDER BY aw.sort_order,aw.id,em.sort_order,em.created_at`),
    database.prepare(`SELECT pi.id,pi.title,pi.year,pi.cover_image_ref,pi.source_url,pi.storage_key,pi.content_type,
        pi.updated_at item_updated_at,pid.updated_at documentation_updated_at
      FROM portfolio_items pi
      JOIN content_entities ce ON ce.id=pi.id AND ce.visibility='public'
      LEFT JOIN portfolio_image_details pid ON pid.portfolio_item_id=pi.id AND pid.image_ref='primary'
      WHERE pi.state='published' AND pi.primary_consent_status IN ('not-required','granted')
        AND pi.content_type LIKE 'image/%' AND (pi.source_url<>'' OR pi.storage_key<>'')
        AND COALESCE(pid.image_role,'result')='result'
      ORDER BY pi.created_at DESC,pi.id`),
    database.prepare(`SELECT pi.id,pi.title,pi.year,pi.cover_image_ref,pi.updated_at item_updated_at,
        em.media_id,em.sort_order media_sort_order,m.source_url,m.storage_key,m.mime_type,m.updated_at media_updated_at,
        pid.updated_at documentation_updated_at
      FROM portfolio_items pi
      JOIN content_entities ce ON ce.id=pi.id AND ce.visibility='public'
      JOIN entity_media em ON em.entity_id=pi.id AND em.role='gallery' AND em.public_visible=1
      JOIN media_assets m ON m.id=em.media_id
      JOIN portfolio_image_details pid ON pid.portfolio_item_id=pi.id AND pid.image_ref=em.media_id AND pid.image_role='result'
      WHERE pi.state='published' AND m.state='active' AND m.privacy='public'
        AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
        AND m.mime_type LIKE 'image/%'
      ORDER BY pi.created_at DESC,pi.id,em.sort_order,em.created_at`),
  ]);

  const works = new Map();
  for (const row of paintingResult.results || []) {
    if (works.has(`painting:${row.id}`)) continue;
    const work = {
      type: "painting",
      id: row.id,
      title: row.title || "Untitled painting",
      date_label: row.year || "",
      date_sort: row.year || row.item_updated_at || "",
      medium: row.medium || "",
      route: paintingRoute(row),
      images: [paintingImage(row)],
      source_updated_at: row.item_updated_at || "",
    };
    work.descriptor_suggestions = descriptorSuggestions(work);
    works.set(`painting:${row.id}`, work);
  }
  const tattooRows = new Map();
  for (const row of tattooPrimaryResult.results || []) {
    tattooRows.set(row.id, {
      type: "tattoo",
      id: row.id,
      title: row.title || "Untitled tattoo",
      date_label: row.year || "",
      date_sort: row.year || row.item_updated_at || "",
      medium: "Tattoo",
      route: tattooRoute(row),
      images: [tattooImage(row, true)],
      source_updated_at: row.item_updated_at || "",
    });
  }
  for (const row of tattooGalleryResult.results || []) {
    const work = tattooRows.get(row.id) || {
      type: "tattoo",
      id: row.id,
      title: row.title || "Untitled tattoo",
      date_label: row.year || "",
      date_sort: row.year || row.item_updated_at || "",
      medium: "Tattoo",
      route: tattooRoute(row),
      images: [],
      source_updated_at: row.item_updated_at || "",
    };
    work.images.push(tattooImage(row));
    tattooRows.set(row.id, work);
  }
  for (const work of tattooRows.values()) {
    work.images.sort((left, right) => Number(right.is_cover) - Number(left.is_cover) || left.sort_order - right.sort_order || left.id.localeCompare(right.id));
    work.descriptor_suggestions = descriptorSuggestions(work);
    works.set(`tattoo:${work.id}`, work);
  }
  return works;
}

function fingerprintManifest(work) {
  return {
    work_type: work.type,
    work_id: work.id,
    title: work.title,
    date_label: work.date_label,
    medium: work.medium,
    route: work.route,
    source_updated_at: work.source_updated_at,
    images: work.images.map(({ id: mediaId, url, mime_type, updated_at, documentation_updated_at }) => ({
      id: mediaId, url, mime_type, updated_at, documentation_updated_at,
    })),
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function visualColorFingerprint(work) {
  return sha256(JSON.stringify(fingerprintManifest(work)));
}

function modelConfig(env) {
  return {
    modelName: text(env.VISUAL_COLOR_MODEL, 300) || DEFAULT_MODEL,
    modelVersion: text(env.VISUAL_COLOR_MODEL_VERSION, 120) || DEFAULT_MODEL,
    promptVersion: text(env.VISUAL_COLOR_PROMPT_VERSION, 120) || PROMPT_VERSION,
  };
}

export async function syncVisualColorQueue(env, options = {}) {
  const database = db(env);
  const works = await discoverVisualColorWorkSources(database, env);
  const config = modelConfig(env);
  const statements = [];
  for (const work of works.values()) {
    const manifest = fingerprintManifest(work);
    const fingerprint = await sha256(JSON.stringify(manifest));
    statements.push(database.prepare(`INSERT OR IGNORE INTO archive_visual_color_runs(
        id,work_type,work_id,source_manifest_json,source_fingerprint,model_name,model_version,prompt_version,
        status,attempts,descriptor_suggestions_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,'pending',0,?,datetime('now'),datetime('now'))`).bind(
      id("visual-color-run"), work.type, work.id, JSON.stringify(manifest), fingerprint,
      config.modelName, config.modelVersion, config.promptVersion, JSON.stringify(work.descriptor_suggestions),
    ));
  }
  if (statements.length) await database.batch(statements);
  const queued = await database.prepare("SELECT COUNT(*) count FROM archive_visual_color_runs WHERE status='pending'").first();
  return { eligible: works.size, pending: Number(queued?.count || 0), discovered: statements.length, ...(options.includeWorks ? { works } : {}) };
}

function visualPrompt(families) {
  return `Classify the colors intentionally used in this finished artwork or tattoo result.\n\nAllowed atomic color families only: ${families.map((family) => family.slug).join(", ")}. Never combine names and never invent a family.\n\nChoose only 2 to 8 families that are visibly meaningful in the created work; do not repeat or echo the full vocabulary. Return dominant colors, supporting colors, and clearly intentional accent colors. Omit a family when its presence is uncertain or incidental. Exclude tiny noise, skin, photographic backgrounds, frames, glare, shadows, reflections, and compression artifacts. Judge the created work, not its surroundings.\n\nReturn only one minified JSON object in exactly this shape: {"colors":[{"family":"blue","strength":"dominant"}]}. Use only the allowed family slugs and the strengths dominant, supporting, or accent. Do not use Markdown, explanatory prose, or punctuation outside the JSON object.`;
}

function responseObject(raw) {
  const candidate = raw?.response ?? raw?.result ?? raw;
  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") return {};
  const stripped = candidate.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const direct = parseJson(stripped, null);
  if (direct && typeof direct === "object") return direct;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(stripped.slice(start, end + 1), {}) : {};
}

async function analysisImageData(imageUrl, env) {
  const request = new Request(imageUrl, { headers: { accept: "image/*" } });
  let response;
  if (typeof env.VISUAL_COLOR_FETCH === "function") {
    response = await env.VISUAL_COLOR_FETCH(imageUrl, { headers: { accept: "image/*" } });
  } else {
    const imageOrigin = new URL(imageUrl).origin;
    const publicOrigin = new URL(env.PUBLIC_SITE_URL || "https://thesixwellconstruct.com").origin;
    response = imageOrigin === publicOrigin && env.ASSETS?.fetch
      ? await env.ASSETS.fetch(request)
      : await fetch(request);
  }
  if (!response?.ok) throw new Error(`Eligible image fetch failed (${Number(response?.status || 0)}).`);
  const contentType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Eligible image response was not an image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Eligible image response was empty.");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Eligible image exceeds the 12 MB analysis limit.");
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:${contentType};base64,${btoa(chunks.join(""))}`;
}

export function normalizeVisualColorResult(raw, allowedFamilies) {
  const bySlug = allowedFamilies instanceof Map
    ? allowedFamilies
    : new Map((allowedFamilies || []).map((family) => [String(family.slug || "").toLowerCase(), family]));
  const payload = responseObject(raw);
  const rows = Array.isArray(payload.colors) ? payload.colors : [];
  const normalized = new Map();
  for (const row of rows) {
    const slug = text(row?.family ?? row?.slug ?? row?.name, 120).toLowerCase();
    const strength = text(row?.strength, 30).toLowerCase();
    const family = bySlug.get(slug);
    if (!family || !STRENGTHS.has(strength)) continue;
    const previous = normalized.get(slug);
    if (!previous || STRENGTH_ORDER.get(strength) < STRENGTH_ORDER.get(previous.strength)) {
      normalized.set(slug, { family_id: family.id, family_slug: family.slug, family_name: family.name, strength });
    }
  }
  return [...normalized.values()].sort((left, right) => STRENGTH_ORDER.get(left.strength) - STRENGTH_ORDER.get(right.strength) || left.family_name.localeCompare(right.family_name));
}

export function mergeVisualColorSuggestions(suggestionSets) {
  const merged = new Map();
  for (const suggestions of suggestionSets || []) {
    for (const suggestion of suggestions || []) {
      const previous = merged.get(suggestion.family_id);
      if (!previous || STRENGTH_ORDER.get(suggestion.strength) < STRENGTH_ORDER.get(previous.strength)) merged.set(suggestion.family_id, suggestion);
    }
  }
  return [...merged.values()].sort((left, right) => STRENGTH_ORDER.get(left.strength) - STRENGTH_ORDER.get(right.strength) || left.family_name.localeCompare(right.family_name));
}

async function runOneAnalysis(database, env, run, families, maxAttempts) {
  const attempt = Number(run.attempts || 0) + 1;
  await database.prepare(`UPDATE archive_visual_color_runs
    SET status='running',attempts=?,started_at=datetime('now'),error_text='',updated_at=datetime('now') WHERE id=?`).bind(attempt, run.id).run();
  try {
    if (!env.AI?.run) throw new Error("Workers AI binding is not configured.");
    const manifest = parseJson(run.source_manifest_json, {});
    const images = Array.isArray(manifest.images) ? manifest.images : [];
    if (!images.length) throw new Error("No eligible public result image remains in this analysis manifest.");
    const allowed = new Map(families.map((family) => [family.slug, family]));
    const rawResults = [];
    const normalizedSets = [];
    for (const image of images) {
      const imageUrl = absoluteImageUrl(image.url, env);
      if (!imageUrl) throw new Error("An eligible image URL could not be resolved.");
      const imageData = await analysisImageData(imageUrl, env);
      const raw = await env.AI.run(run.model_name, {
        prompt: visualPrompt(families),
        image: imageData,
        max_tokens: 512,
        temperature: 0,
      });
      rawResults.push({ image_id: image.id, response: raw });
      normalizedSets.push(normalizeVisualColorResult(raw, allowed));
    }
    const suggestions = mergeVisualColorSuggestions(normalizedSets).map((suggestion, index) => ({ ...suggestion, display_order: index }));
    await database.prepare(`UPDATE archive_visual_color_runs SET status='ready',raw_result_json=?,
      normalized_suggestions_json=?,completed_at=datetime('now'),error_text='',updated_at=datetime('now') WHERE id=?`)
      .bind(JSON.stringify(rawResults), JSON.stringify(suggestions), run.id).run();
    return { id: run.id, status: "ready", suggestions: suggestions.length };
  } catch (error) {
    const message = text(error?.message || error, 4000);
    const missingBinding = message.includes("binding is not configured");
    const nextStatus = missingBinding || attempt >= maxAttempts ? "failed" : "pending";
    await database.prepare(`UPDATE archive_visual_color_runs SET status=?,error_text=?,completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .bind(nextStatus, message, run.id).run();
    return { id: run.id, status: nextStatus, error: message };
  }
}

export async function runVisualColorAnalysisPass(env) {
  const database = db(env);
  const queue = await syncVisualColorQueue(env);
  const maxAttempts = boundedInteger(env.VISUAL_COLOR_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 8);
  const limit = boundedInteger(env.VISUAL_COLOR_WORKS_PER_PASS, DEFAULT_WORKS_PER_PASS, 1, 5);
  const [runResult, familyResult] = await database.batch([
    database.prepare(`SELECT * FROM archive_visual_color_runs
      WHERE status='pending' AND attempts<? ORDER BY created_at,rowid LIMIT ?`).bind(maxAttempts, limit),
    database.prepare(`SELECT id,slug,name,swatch_hex,sort_order FROM archive_color_families
      WHERE publication_state='published' AND public_visible=1 ORDER BY sort_order,name`),
  ]);
  const families = (familyResult.results || []).filter((family) => isAtomicFamilyName(family.name));
  if (!families.length) return { ...queue, processed: [], error: "No published atomic color vocabulary is available." };
  const processed = [];
  for (const run of runResult.results || []) processed.push(await runOneAnalysis(database, env, run, families, maxAttempts));
  return { ...queue, processed };
}

function currentWorkMap(works) {
  return new Map([...works.values()].map((work) => [`${work.type}:${work.id}`, work]));
}

function publicFamilyRow(family, assignments, works) {
  const eligible = assignments.filter((assignment) => works.has(`${assignment.work_type}:${assignment.work_id}`));
  const keys = new Set(eligible.map((assignment) => `${assignment.work_type}:${assignment.work_id}`));
  const painting = new Set(eligible.filter((assignment) => assignment.work_type === "painting").map((assignment) => assignment.work_id)).size;
  const tattoo = new Set(eligible.filter((assignment) => assignment.work_type === "tattoo").map((assignment) => assignment.work_id)).size;
  return {
    slug: family.slug,
    name: family.name,
    swatch_hex: family.swatch_hex,
    count: keys.size,
    total_count: keys.size,
    painting_count: painting,
    tattoo_count: tattoo,
  };
}

async function publicVisualFamilies(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const works = currentWorkMap(await discoverVisualColorWorkSources(database, env));
  const [familyResult, assignmentResult] = await database.batch([
    database.prepare(`SELECT id,slug,name,swatch_hex,sort_order FROM archive_color_families
      WHERE publication_state='published' AND public_visible=1 ORDER BY sort_order,name`),
    database.prepare("SELECT work_type,work_id,family_id,strength,display_order FROM archive_visual_color_assignments"),
  ]);
  const assignments = assignmentResult.results || [];
  const families = (familyResult.results || []).filter((family) => isAtomicFamilyName(family.name)).map((family) => publicFamilyRow(
    family, assignments.filter((assignment) => assignment.family_id === family.id), works,
  )).filter((family) => family.count > 0);
  return json({ families, count: families.length }, { cache: "public, max-age=60" });
}

function dateSortValue(value) {
  const year = /\b(\d{4})\b/.exec(String(value || ""));
  if (year) return Number(year[1]);
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function publicFamilyWorks(request, env, slug) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const url = new URL(request.url);
  const type = text(url.searchParams.get("type"), 20) || "all";
  if (type !== "all" && !WORK_TYPES.has(type)) return failure("Choose all, painting, or tattoo.", 400);
  const database = db(env);
  const family = await database.prepare(`SELECT id,slug,name,swatch_hex FROM archive_color_families
    WHERE slug=? AND publication_state='published' AND public_visible=1`).bind(slug).first();
  if (!family || !isAtomicFamilyName(family.name)) return failure("Visual color family not found.", 404);
  const works = currentWorkMap(await discoverVisualColorWorkSources(database, env));
  const assignments = (await database.prepare(`SELECT work_type,work_id,strength,display_order
    FROM archive_visual_color_assignments WHERE family_id=?`).bind(family.id).all()).results || [];
  const records = assignments.map((assignment) => ({ assignment, work: works.get(`${assignment.work_type}:${assignment.work_id}`) }))
    .filter(({ assignment, work }) => work && (type === "all" || assignment.work_type === type))
    .map(({ assignment, work }) => ({
      id: work.id,
      title: work.title,
      image: work.images[0]?.url || "",
      route: work.route,
      type: work.type,
      date_label: work.date_label,
      strength: assignment.strength,
    }))
    .sort((left, right) => STRENGTH_ORDER.get(left.strength) - STRENGTH_ORDER.get(right.strength)
      || dateSortValue(right.date_label) - dateSortValue(left.date_label)
      || left.title.localeCompare(right.title));
  return json({ family: { slug: family.slug, name: family.name, swatch_hex: family.swatch_hex }, works: records, count: records.length, type }, { cache: "public, max-age=60" });
}

async function publicWorkDescriptors(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const works = currentWorkMap(await discoverVisualColorWorkSources(database, env));
  const [termResult, assignmentResult] = await database.batch([
    database.prepare(`SELECT id,slug,name,descriptor_kind,description,sort_order FROM archive_work_descriptor_terms
      WHERE publication_state='published' AND public_visible=1 ORDER BY sort_order,name`),
    database.prepare("SELECT work_type,work_id,term_id FROM archive_work_descriptor_assignments"),
  ]);
  const assignments = assignmentResult.results || [];
  const descriptors = (termResult.results || []).map((term) => {
    const eligible = assignments.filter((assignment) => assignment.term_id === term.id && works.has(`${assignment.work_type}:${assignment.work_id}`));
    return {
      slug: term.slug,
      name: term.name,
      kind: term.descriptor_kind,
      description: term.description || "",
      count: new Set(eligible.map((assignment) => `${assignment.work_type}:${assignment.work_id}`)).size,
      painting_count: new Set(eligible.filter((assignment) => assignment.work_type === "painting").map((assignment) => assignment.work_id)).size,
      tattoo_count: new Set(eligible.filter((assignment) => assignment.work_type === "tattoo").map((assignment) => assignment.work_id)).size,
    };
  }).filter((term) => term.count > 0);
  return json({ descriptors, count: descriptors.length }, { cache: "public, max-age=60" });
}

function reviewStatusSql(filter) {
  if (filter === "pending") return "status IN ('pending','running','ready')";
  return "status=?";
}

async function reviewSnapshot(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const url = new URL(request.url);
  const filter = REVIEW_FILTERS.has(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
  const [countResult, familyResult, termResult] = await database.batch([
    database.prepare(`SELECT
      SUM(CASE WHEN status IN ('pending','running','ready') THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM archive_visual_color_runs current
      WHERE rowid=(SELECT MAX(newer.rowid) FROM archive_visual_color_runs newer
        WHERE newer.work_type=current.work_type AND newer.work_id=current.work_id)`),
    database.prepare("SELECT * FROM archive_color_families ORDER BY sort_order,name"),
    database.prepare("SELECT * FROM archive_work_descriptor_terms WHERE publication_state<>'archived' ORDER BY sort_order,name"),
  ]);
  const where = reviewStatusSql(filter);
  const runStatement = database.prepare(`SELECT * FROM archive_visual_color_runs current
    WHERE ${where} AND rowid=(SELECT MAX(newer.rowid) FROM archive_visual_color_runs newer
      WHERE newer.work_type=current.work_type AND newer.work_id=current.work_id)
    ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,updated_at DESC LIMIT 100`);
  const runRows = (await (filter === "pending" ? runStatement.all() : runStatement.bind(filter).all())).results || [];
  const runs = [];
  for (const run of runRows) {
    const [colors, descriptors] = await database.batch([
      database.prepare(`SELECT a.*,f.slug family_slug,f.name family_name,f.swatch_hex
        FROM archive_visual_color_assignments a JOIN archive_color_families f ON f.id=a.family_id
        WHERE a.work_type=? AND a.work_id=? ORDER BY a.display_order,f.name`).bind(run.work_type, run.work_id),
      database.prepare(`SELECT a.*,t.slug term_slug,t.name term_name,t.descriptor_kind
        FROM archive_work_descriptor_assignments a JOIN archive_work_descriptor_terms t ON t.id=a.term_id
        WHERE a.work_type=? AND a.work_id=? ORDER BY t.sort_order,t.name`).bind(run.work_type, run.work_id),
    ]);
    const manifest = parseJson(run.source_manifest_json, {});
    runs.push({
      id: run.id,
      work_type: run.work_type,
      work_id: run.work_id,
      title: manifest.title || run.work_id,
      date_label: manifest.date_label || "",
      medium: manifest.medium || "",
      route: manifest.route || "",
      images: manifest.images || [],
      source_fingerprint: run.source_fingerprint,
      model_name: run.model_name,
      model_version: run.model_version,
      prompt_version: run.prompt_version,
      status: run.status,
      attempts: Number(run.attempts || 0),
      suggestions: parseJson(run.normalized_suggestions_json, []),
      descriptor_suggestions: parseJson(run.descriptor_suggestions_json, {}),
      error: run.error_text || "",
      reviewed_by: run.reviewed_by || "",
      reviewed_at: run.reviewed_at || null,
      current_assignments: colors.results || [],
      current_descriptors: descriptors.results || [],
      created_at: run.created_at,
      updated_at: run.updated_at,
    });
  }
  const counts = countResult.results?.[0] || {};
  return json({
    counts: {
      pending: Number(counts.pending || 0), approved: Number(counts.approved || 0),
      rejected: Number(counts.rejected || 0), failed: Number(counts.failed || 0),
    },
    filter,
    runs,
    families: familyResult.results || [],
    descriptor_terms: termResult.results || [],
  });
}

async function approveRun(request, env, runId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env);
  const run = await database.prepare("SELECT * FROM archive_visual_color_runs WHERE id=?").bind(runId).first();
  if (!run) return failure("Analysis run not found.", 404);
  if (run.status !== "ready" && run.status !== "approved") return failure("Only a completed review candidate can be approved.", 409);
  const works = await discoverVisualColorWorkSources(database, env);
  const work = works.get(`${run.work_type}:${run.work_id}`);
  if (!work) return failure("This work no longer has eligible public source media.", 409);
  const currentFingerprint = await visualColorFingerprint(work);
  if (currentFingerprint !== run.source_fingerprint) return failure("The public source images changed. Retry analysis before approving.", 409);

  const colors = Array.isArray(body.colors) ? body.colors : [];
  const descriptorTermIds = [...new Set((Array.isArray(body.descriptor_term_ids) ? body.descriptor_term_ids : []).map((value) => text(value, 200)).filter(Boolean))];
  if (colors.length > 21) return failure("Choose no more than the published color vocabulary.");
  const familyIds = [...new Set(colors.map((row) => text(row.family_id, 200)).filter(Boolean))];
  if (familyIds.length !== colors.length) return failure("Each approved family may appear only once.", 409);
  for (const row of colors) if (!STRENGTHS.has(text(row.strength, 30))) return failure("Choose dominant, supporting, or accent for every family.");
  if (familyIds.length) {
    const found = (await database.prepare(`SELECT id,name FROM archive_color_families WHERE id IN (${familyIds.map(() => "?").join(",")})
      AND publication_state='published' AND public_visible=1`).bind(...familyIds).all()).results || [];
    if (found.length !== familyIds.length || found.some((family) => !isAtomicFamilyName(family.name))) return failure("Every approved family must belong to the published atomic vocabulary.", 409);
  }
  if (descriptorTermIds.length) {
    const found = (await database.prepare(`SELECT id FROM archive_work_descriptor_terms WHERE id IN (${descriptorTermIds.map(() => "?").join(",")})
      AND publication_state='published' AND public_visible=1`).bind(...descriptorTermIds).all()).results || [];
    if (found.length !== descriptorTermIds.length) return failure("Every descriptor must belong to the controlled published vocabulary.", 409);
  }
  const statements = [
    database.prepare("DELETE FROM archive_visual_color_assignments WHERE work_type=? AND work_id=?").bind(run.work_type, run.work_id),
    database.prepare("DELETE FROM archive_work_descriptor_assignments WHERE work_type=? AND work_id=?").bind(run.work_type, run.work_id),
  ];
  colors.forEach((row, index) => statements.push(database.prepare(`INSERT INTO archive_visual_color_assignments(
    id,work_type,work_id,family_id,strength,display_order,source_run_id,reviewed_by,reviewed_at,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'),datetime('now'))`).bind(
    id("visual-color-assignment"), run.work_type, run.work_id, text(row.family_id, 200), text(row.strength, 30),
    boundedInteger(row.display_order, index, 0, 1000), run.id,
  )));
  descriptorTermIds.forEach((termId) => statements.push(database.prepare(`INSERT INTO archive_work_descriptor_assignments(
    id,work_type,work_id,term_id,source_run_id,reviewed_by,reviewed_at,created_at,updated_at
  ) VALUES(?,?,?,?,?,'studio',datetime('now'),datetime('now'),datetime('now'))`).bind(
    id("work-descriptor-assignment"), run.work_type, run.work_id, termId, run.id,
  )));
  statements.push(database.prepare(`UPDATE archive_visual_color_runs SET status='approved',reviewed_by='studio',
    reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(run.id));
  await database.batch(statements);
  return json({ ok: true, approved: true, color_count: colors.length, descriptor_count: descriptorTermIds.length });
}

async function rejectRun(request, env, runId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env);
  const run = await database.prepare("SELECT id,status FROM archive_visual_color_runs WHERE id=?").bind(runId).first();
  if (!run) return failure("Analysis run not found.", 404);
  if (!["ready", "pending", "failed"].includes(run.status)) return failure("This run cannot be rejected.", 409);
  await database.prepare(`UPDATE archive_visual_color_runs SET status='rejected',reviewed_by='studio',
    reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(runId).run();
  return json({ ok: true, rejected: true });
}

async function retryRun(request, env, runId) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const database = db(env);
  const run = await database.prepare("SELECT id,status FROM archive_visual_color_runs WHERE id=?").bind(runId).first();
  if (!run) return failure("Analysis run not found.", 404);
  if (!["failed", "rejected", "ready"].includes(run.status)) return failure("This run is already queued or running.", 409);
  await database.prepare(`UPDATE archive_visual_color_runs SET status='pending',attempts=0,raw_result_json='',
    normalized_suggestions_json='[]',error_text='',started_at=NULL,completed_at=NULL,reviewed_by='',reviewed_at=NULL,
    updated_at=datetime('now') WHERE id=?`).bind(runId).run();
  return json({ ok: true, pending: true });
}

async function enqueueReview(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const result = await syncVisualColorQueue(env);
  return json({ ok: true, ...result });
}

export async function handleVisualColorPublic(request, env, path) {
  if (path === "/api/archive/visual-color-families") return publicVisualFamilies(request, env);
  const familyWorks = path.match(/^\/api\/archive\/visual-color-families\/([^/]+)\/works$/);
  if (familyWorks) return publicFamilyWorks(request, env, decodeURIComponent(familyWorks[1]));
  if (path === "/api/archive/work-descriptors") return publicWorkDescriptors(request, env);
  return null;
}

export async function handleVisualColorAdmin(request, env, path) {
  if (path === "/api/admin/archive-color-materials/visual-review") return reviewSnapshot(request, env);
  if (path === "/api/admin/archive-color-materials/visual-review/enqueue") return enqueueReview(request, env);
  const action = path.match(/^\/api\/admin\/archive-color-materials\/visual-review\/([^/]+)\/(approve|reject|retry)$/);
  if (!action) return null;
  const runId = decodeURIComponent(action[1]);
  if (action[2] === "approve") return approveRun(request, env, runId);
  if (action[2] === "reject") return rejectRun(request, env, runId);
  return retryRun(request, env, runId);
}
