import { db, entityMedia, failure, id, json, nextRevision, parseJson, readJson, requireStudioAdmin, RESOURCE_CONFIG, slug, text } from "../_shared/construct.js";

function safeLegendUrl(value) {
  const url = text(value, 2000);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

function sanitizeLegendSvg(value) {
  const markup = text(value, 80000);
  if (!markup) return "";
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(markup)) throw new Error("SVG artwork must contain one complete <svg> element.");
  if (/<\/?(?:script|foreignObject|iframe|object|embed|link|style|a|image|animate|set)\b/i.test(markup)) throw new Error("SVG artwork contains an unsupported embedded element.");
  const unsafePaintReference = [...markup.matchAll(/url\s*\(\s*([^)]*)\)/gi)].some((match) => !/^['"]?#[a-zA-Z][\w:.-]*['"]?$/.test(match[1].trim()));
  const unsafeHref = [...markup.matchAll(/\s(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)].some((match) => !/^#[a-zA-Z][\w:.-]*$/.test(match[2].trim()));
  if (/\s(?:on[a-z]+|src)\s*=/i.test(markup) || /(?:javascript:|data:text\/html|expression\s*\(|@import|<!DOCTYPE|<!ENTITY)/i.test(markup) || unsafePaintReference || unsafeHref) throw new Error("SVG artwork contains an external or executable reference.");
  return markup;
}

function legendArray(value, label) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed || "[]"); } catch { throw new Error(`${label} must be valid JSON.`); }
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a list.`);
  return parsed;
}

function legendObject(value, label) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed || "{}"); } catch { throw new Error(`${label} must be valid JSON.`); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be an object.`);
  return parsed;
}

const LEGEND_CONTEXT_MODES = new Set(["cultural", "personal", "reoriented"]);
const LEGEND_REORIENTATION_MODES = new Set(["expanded", "inverted", "contested", "detached", "combined"]);

function normalizeLegendLayers(out) {
  if ("svg_markup" in out) out.svg_markup = sanitizeLegendSvg(out.svg_markup);
  if ("themes_json" in out) {
    const themes = legendArray(out.themes_json, "Themes").slice(0, 40).map((theme) => text(theme, 80)).filter(Boolean);
    out.themes_json = JSON.stringify([...new Set(themes)]);
  }
  if ("context_json" in out) {
    const value = legendObject(out.context_json, "Influence and relationship");
    if ("modes" in value && !Array.isArray(value.modes)) throw new Error("Influence modes must be a list.");
    if ("sources" in value && !Array.isArray(value.sources)) throw new Error("Legend sources must be a list.");
    if ("reorientation" in value && (!value.reorientation || typeof value.reorientation !== "object" || Array.isArray(value.reorientation))) throw new Error("Reorientation must be an object.");
    const culturalContext = text(value.cultural_context, 5000);
    const personalRelationship = text(value.personal_relationship, 5000);
    const overlapOrTension = text(value.overlap_or_tension, 5000);
    const viewerOpening = text(value.viewer_opening, 5000);
    const reorientationMode = text(value.reorientation?.mode, 40).toLowerCase();
    const reorientationStatement = text(value.reorientation?.statement, 5000);
    if (reorientationMode && !LEGEND_REORIENTATION_MODES.has(reorientationMode)) throw new Error("Choose a supported reorientation mode.");
    if (reorientationMode && !reorientationStatement) throw new Error("A reorientation mode needs a first-person explanation.");
    if (reorientationStatement && !reorientationMode) throw new Error("Choose a reorientation mode for the explanation.");
    const rawModes = Array.isArray(value.modes) ? value.modes.map((mode) => text(mode, 40).toLowerCase()).filter(Boolean) : [];
    if (rawModes.some((mode) => !LEGEND_CONTEXT_MODES.has(mode))) throw new Error("Choose supported influence modes.");
    const modes = [...rawModes];
    if (culturalContext) modes.push("cultural");
    if (personalRelationship) modes.push("personal");
    if (reorientationMode) modes.push("reoriented");
    const rawSources = Array.isArray(value.sources) ? value.sources.slice(0, 20) : [];
    const sources = rawSources.map((entry) => {
      const rawUrl = text(entry?.url, 2000);
      const hasAuthoredValue = [entry?.title, entry?.creator, entry?.url, entry?.note].some((field) => text(field, 3000));
      const source = {
        title: text(entry?.title, 300),
        creator: text(entry?.creator, 300),
        url: safeLegendUrl(rawUrl),
        note: text(entry?.note, 3000),
      };
      if (hasAuthoredValue && (!source.title || !rawUrl || !source.url)) throw new Error("Every Legend source needs a title and a valid public or site URL.");
      return source;
    }).filter((entry) => entry.title && entry.url);
    out.context_json = JSON.stringify({
      modes: [...new Set(modes)],
      cultural_context: culturalContext,
      personal_relationship: personalRelationship,
      reorientation: { mode: reorientationMode, statement: reorientationStatement },
      overlap_or_tension: overlapOrTension,
      viewer_opening: viewerOpening,
      sources,
    });
  }
  if ("applications_json" in out) {
    const applications = legendArray(out.applications_json, "Applications").slice(0, 40).map((entry) => ({
      title: text(entry?.title, 160),
      meaning: text(entry?.meaning, 3000),
      note: text(entry?.note, 3000),
      svg_markup: entry?.svg_markup ? sanitizeLegendSvg(entry.svg_markup) : "",
    })).filter((entry) => entry.title && entry.meaning);
    out.applications_json = JSON.stringify(applications);
  }
  if ("variants_json" in out) {
    const variants = legendArray(out.variants_json, "Variants").slice(0, 60).map((entry) => ({
      name: text(entry?.name, 160),
      style: text(entry?.style, 120),
      note: text(entry?.note, 3000),
      svg_markup: entry?.svg_markup ? sanitizeLegendSvg(entry.svg_markup) : "",
      image_url: safeLegendUrl(entry?.image_url),
    })).filter((entry) => entry.name && (entry.svg_markup || entry.image_url));
    out.variants_json = JSON.stringify(variants);
  }
  if ("examples_json" in out) {
    const examples = legendArray(out.examples_json, "Appearances").slice(0, 60).map((entry) => ({
      title: text(entry?.title, 160),
      medium: text(entry?.medium, 120),
      caption: text(entry?.caption, 3000),
      src: safeLegendUrl(entry?.src),
      href: safeLegendUrl(entry?.href),
    })).filter((entry) => entry.title && (entry.src || entry.href));
    out.examples_json = JSON.stringify(examples);
  }
}

function normalizeRecord(config, body, existing = {}) {
  const out = {};
  for (const field of config.fields) {
    if (!(field in body)) continue;
    if (["sort_order","claimable","acquisition_eligible","homepage_enabled"].includes(field)) out[field] = Number(body[field]) || 0;
    else if (["estimated_sessions_min","estimated_sessions_max","estimated_total_minutes_min","estimated_total_minutes_max"].includes(field)) {
      const value = body[field] === "" || body[field] === null ? null : Number(body[field]);
      out[field] = Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
    }
    else if (field.endsWith("_json")) out[field] = typeof body[field] === "string" ? body[field] : JSON.stringify(body[field] ?? []);
    else out[field] = text(body[field], field === "svg_markup" || field === "body" || field === "body_html" ? 50000 : 8000);
  }
  if (config.fields.includes("slug") && !out.slug && !existing.slug) out.slug = slug(body.title || body.name);
  if (out.state && !config.states.includes(out.state)) throw new Error(`Invalid state: ${out.state}`);
  if (out.session_category && !["artist_review","one_session","multiple_sessions"].includes(out.session_category)) throw new Error("Invalid session category.");
  if (out.split_policy && !["artist_review","required","client_choice","not_available"].includes(out.split_policy)) throw new Error("Invalid split policy.");
  if (out.process_category && !["standard","experimental"].includes(out.process_category)) throw new Error("Invalid flash process category.");
  const merged = { ...existing, ...out };
  for (const [minimum,maximum,label] of [["estimated_sessions_min","estimated_sessions_max","session count"],["estimated_total_minutes_min","estimated_total_minutes_max","total time"]]) {
    if (merged[minimum] !== null && merged[maximum] !== null && Number(merged[minimum]) > Number(merged[maximum])) throw new Error(`Minimum ${label} cannot exceed maximum.`);
  }
  if (config.entityType === "flash_item") {
    if (merged.split_policy === "required" && merged.session_category !== "multiple_sessions") throw new Error("Required splitting must use the multiple-sessions category.");
    if (merged.split_policy === "not_available" && merged.session_category !== "one_session") throw new Error("Splitting unavailable must use the one-session category.");
    if (merged.session_category === "one_session") {
      out.estimated_sessions_min = 1;
      out.estimated_sessions_max = 1;
    }
    if (merged.session_category === "multiple_sessions" && Number(merged.estimated_sessions_min) < 2) throw new Error("Multiple-session flash requires a minimum of at least two sessions.");
    if (merged.session_category !== "artist_review" && (!Number(merged.estimated_sessions_max) || Number(merged.estimated_sessions_max) < Number(merged.estimated_sessions_min))) throw new Error("Enter a valid maximum session count.");
  }
  if (config.entityType === "construct_node" && out.homepage_enabled && out.state === "published") out.homepage_enabled = 1;
  if (config.entityType === "visual_symbol") {
    if (!("state" in out) && !existing.id) out.state = "draft";
    normalizeLegendLayers(out);
    const symbol = { ...existing, ...out };
    if (!symbol.name || !symbol.category_id || !symbol.meaning) throw new Error("A Legend symbol needs a name, category, and core meaning.");
    if (symbol.state === "published" && !symbol.svg_markup) throw new Error("Upload the final canonical SVG before publishing a Legend symbol.");
  }
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
  const isFlashRecord = resource === "flash" && Boolean(recordSlug);
  const where = isFlashRecord
    ? `${baseWhere} AND (id=? OR slug=? OR legacy_path=? OR legacy_path=?)`
    : recordSlug
      ? `${baseWhere} AND slug=?`
      : baseWhere;
  const statement = database.prepare(`SELECT * FROM ${config.table} WHERE ${where} ORDER BY sort_order,id`);
  const legacyPath = `/tattoos/flash/${String(recordSlug).replace(/^\/+|\/+$/g, "")}/`;
  const result = isFlashRecord
    ? await statement.bind(recordSlug, recordSlug, recordSlug, legacyPath).all()
    : recordSlug
      ? await statement.bind(recordSlug).all()
      : await statement.all();
  const rows = result.results || [];
  const media = await entityMedia(database, rows.map((row) => row.id));
  const records = rows.map((row) => {
    const { reserved_submission_id: _reservationOwner, ...publicRow } = row;
    const record = {
      ...publicRow,
      themes: parseJson(row.themes_json),
      context: parseJson(row.context_json, {}),
      applications: parseJson(row.applications_json),
      variants: parseJson(row.variants_json),
      examples: parseJson(row.examples_json),
      media: media.get(row.id) || [],
    };
    if (resource !== "flash") return record;
    const canonicalRoute = `/tattoos/flash/${encodeURIComponent(row.slug || row.id)}/`;
    const claimableNow = row.state === "available" && Number(row.claimable) === 1 && !row.reserved_submission_id;
    return {
      ...record,
      claimable: claimableNow ? 1 : 0,
      canonicalRoute,
      canonical_route: canonicalRoute,
      claimableNow,
      claimable_now: claimableNow,
      pricingNote: row.price_label || "Quoted from the managed flash record after review.",
      pricing_note: row.price_label || "Quoted from the managed flash record after review.",
      artistSessionPlan: {
        category: row.session_category || "artist_review",
        splitPolicy: row.split_policy || "artist_review",
        estimatedSessionsMin: row.estimated_sessions_min ?? null,
        estimatedSessionsMax: row.estimated_sessions_max ?? null,
        estimatedTotalMinutesMin: row.estimated_total_minutes_min ?? null,
        estimatedTotalMinutesMax: row.estimated_total_minutes_max ?? null,
        note: row.session_plan_note || "",
        acknowledgementRequired: Boolean(row.session_plan_note || (row.session_category && row.session_category !== "artist_review")),
      },
    };
  });
  if (recordSlug && !records[0]) return failure("Not found.", 404);
  return json(recordSlug ? { record: records[0] } : { records, count: records.length });
}

async function publicLegendCategories(env) {
  const rows = (await db(env).prepare("SELECT id,name,slug,description,state,sort_order,updated_at FROM visual_symbol_categories WHERE state='published' ORDER BY sort_order,id").all()).results || [];
  return json({ records: rows, count: rows.length });
}

async function publicNavigation(env) {
  const database = db(env);
  const nodes = (await database.prepare("SELECT id,name,slug,route,color,sort_order,updated_at FROM construct_nodes WHERE state='published' AND homepage_enabled=1 ORDER BY sort_order").all()).results || [];
  const paths = (await database.prepare("SELECT id,node_id,name,route,color,sort_order,updated_at FROM construct_pathways WHERE state='published' AND homepage_enabled=1 ORDER BY node_id,sort_order").all()).results || [];
  for (const node of nodes) node.pathways = paths.filter((p) => p.node_id === node.id);
  return json({ revision: nodes.reduce((v,n) => n.updated_at > v ? n.updated_at : v, ""), nodes });
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
  return json({ records: rows, count: rows.length, query: q });
}

function searchDocument(resource, row) {
  const common = {
    entity_id: row.id,
    entity_type: RESOURCE_CONFIG[resource]?.entityType || resource,
    node_id: "",
    slug: row.slug || "",
    title: row.title || row.name || row.slug || row.id,
    summary: "",
    body: "",
    state: row.state || "published",
    collection_labels: "",
    theme_labels: "",
    person_labels: "",
    place_labels: "",
    date_label: "",
    route: row.route || "",
  };
  if (resource === "flash") return { ...common, node_id: "tattooing", summary: row.description || "", route: row.legacy_path || "/tattoos/flash/" };
  if (resource === "art") return { ...common, node_id: "art", summary: row.statement || "", date_label: row.year || "", route: row.legacy_path || `/art/?work=${encodeURIComponent(row.slug || row.id)}` };
  if (resource === "archive") return { ...common, node_id: "archive", summary: row.summary || "", body: row.body || "", date_label: row.date_or_period || "", route: `/archive/?record=${encodeURIComponent(row.slug || row.id)}` };
  if (resource === "visual-language") {
    const context = parseJson(row.context_json, {});
    const applications = parseJson(row.applications_json).flatMap((entry) => [entry.title, entry.meaning, entry.note]);
    const variants = parseJson(row.variants_json).flatMap((entry) => [entry.name, entry.style, entry.note]);
    const appearances = parseJson(row.examples_json).flatMap((entry) => [entry.title, entry.medium, entry.caption]);
    const influence = [
      context.cultural_context,
      context.personal_relationship,
      context.reorientation?.mode,
      context.reorientation?.statement,
      context.overlap_or_tension,
      context.viewer_opening,
      ...(Array.isArray(context.sources) ? context.sources.flatMap((entry) => [entry.title, entry.creator, entry.note]) : []),
    ];
    return { ...common, summary: row.meaning || "", body: [...influence, ...applications, ...variants, ...appearances].filter(Boolean).join(" "), theme_labels: parseJson(row.themes_json).join(", "), route: `/about/legend/?symbol=${encodeURIComponent(row.slug || row.id)}` };
  }
  return null;
}

function isPubliclySearchable(resource, row) {
  if (!searchDocument(resource, row)) return false;
  return resource === "flash" ? ["available","reserved","placed","retired"].includes(row.state) : row.state === "published";
}

function searchSyncStatement(database, resource, row) {
  if (!isPubliclySearchable(resource, row)) return database.prepare("DELETE FROM search_documents WHERE entity_id=?").bind(row.id);
  const document = searchDocument(resource, row);
  const fields = ["entity_id","entity_type","node_id","slug","title","summary","body","state","collection_labels","theme_labels","person_labels","place_labels","date_label","route"];
  return database.prepare(`INSERT INTO search_documents(${fields.join(",")},updated_at) VALUES(${fields.map(() => "?").join(",")},datetime('now')) ON CONFLICT(entity_id) DO UPDATE SET ${fields.slice(1).map((field) => `${field}=excluded.${field}`).join(",")},updated_at=datetime('now')`).bind(...fields.map((field) => document[field]));
}

function entityVisibilityStatement(database, resource, row) {
  const visible = resource === "flash" ? ["available","reserved","placed","retired"].includes(row.state) : row.state === "published";
  return database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,archived_at=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(visible ? "public" : "internal", visible ? 1 : 0, row.state === "archived" ? new Date().toISOString() : null, visible ? 1 : 0, row.id);
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
  if (config.fields.includes("sort_order") && (!Number.isFinite(Number(values.sort_order)) || Number(values.sort_order) <= 0)) {
    const last = await database.prepare(`SELECT COALESCE(MAX(sort_order),0) AS max_order FROM ${config.table}`).first();
    values.sort_order = Number(last?.max_order || 0) + 1;
  }
  if (resource === "nodes" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_nodes WHERE homepage_enabled=1").first(); if (Number(c?.c || 0) >= 9) return failure("Homepage node capacity is 9.", 409); }
  if (resource === "pathways" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_pathways WHERE node_id=? AND homepage_enabled=1").bind(values.node_id).first(); if (Number(c?.c || 0) >= 9) return failure("Pathway capacity is 9 per node.", 409); }
  const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  const initial = { id: recordId, ...values };
  await database.batch([
    database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId,config.entityType,values.node_id || (config.entityType==="visual_symbol"?"node-legend":null),"internal"),
    database.prepare(`INSERT INTO ${config.table}(id,${keys.join(",")},created_at,updated_at) VALUES(?,${keys.map(()=>"?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...keys.map(k=>values[k])),
  ]);
  const created = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  await database.batch([entityVisibilityStatement(database, resource, created), searchSyncStatement(database, resource, created)]);
  await nextRevision(database,recordId,"create",null,created); return json({ record: created },{status:201});
}

async function adminUpdate(request, env, resource, recordId, archive = false) {
  const config = RESOURCE_CONFIG[resource]; const body = archive ? { state: "archived" } : await readJson(request); if (!config || !body) return failure("Invalid request.");
  const database = db(env); const before = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first(); if (!before) return failure("Not found.",404);
  const values = normalizeRecord(config,body,before); const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  const projected = { ...before, ...values, id: recordId };
  await database.batch([
    database.prepare(`UPDATE ${config.table} SET ${keys.map(k=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...keys.map(k=>values[k]),recordId),
    entityVisibilityStatement(database, resource, projected),
    searchSyncStatement(database, resource, projected),
  ]);
  const after = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  await nextRevision(database,recordId,archive?"archive":"update",before,after); return json({record:after});
}

async function reorder(request, env, resource) {
  const config=RESOURCE_CONFIG[resource]; const body=await readJson(request); if(!config||!Array.isArray(body?.ids)) return failure("ids must be an array.");
  const database=db(env); const current=(await database.prepare(`SELECT id FROM ${config.table} ORDER BY sort_order,id`).all()).results||[];const currentIds=current.map(row=>row.id);const requested=new Set(body.ids);if(body.ids.length!==currentIds.length||requested.size!==currentIds.length||currentIds.some(recordId=>!requested.has(recordId)))return failure("The catalog changed. Refresh before reordering.",409);
  if(body.expected_updated_at){const latest=await database.prepare(`SELECT MAX(updated_at) v FROM ${config.table}`).first();if(latest?.v&&latest.v!==body.expected_updated_at)return failure("Order changed in another session. Refresh and retry.",409,{latest:latest.v});}
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

const NODE_FALLBACKS={
  tattoos:{id:"node-tattoos",name:"TATTOOS",slug:"tattoos",color:"#6E0404"},
  legend:{id:"node-legend",name:"LEGEND",slug:"legend",color:"#FCB467"},
  art:{id:"node-art",name:"ART MAKING",slug:"art-making",color:"#0039BD"},
  merch:{id:"node-merch",name:"MERCH",slug:"merch",color:"#F08000"},
  about:{id:"node-about",name:"ABOUT",slug:"about",color:"#FCB467"},
  events:{id:"node-events",name:"EVENTS",slug:"events",color:"#005D25"},
  music:{id:"node-music",name:"MUSIC",slug:"music",color:"#A22F8D"},
  writings:{id:"node-writings",name:"WRITINGS",slug:"writings",color:"#FFE7CA"},
  archive:{id:"node-archive",name:"ARCHIVE",slug:"archive",color:"#6D3D15"},
  film:{id:"node-film",name:"FILM",slug:"film",color:"#00857A"},
};

function canonicalNodeAlias(value,entityType=""){
  const raw=String(value||"").toLowerCase();
  if(["legend","visual-language","visual_language","node-legend"].includes(raw)||entityType==="visual_symbol")return"node-legend";
  if(["tattooing","tattoo","tattoos","node-tattoos"].includes(raw)||["flash_item","flash_series","portfolio_item"].includes(entityType))return"node-tattoos";
  if(["art","art-making","node-art"].includes(raw)||entityType==="art_work")return"node-art";
  if(["merch","node-merch"].includes(raw)||entityType==="merch_item")return"node-merch";
  if(["event","events","node-events"].includes(raw)||entityType==="event")return"node-events";
  if(["archive","node-archive"].includes(raw)||entityType.startsWith("archive_"))return"node-archive";
  if(raw.startsWith("node-"))return raw;
  return raw?`node-${raw}`:"node-about";
}

function nodeFallback(nodeId){return Object.values(NODE_FALLBACKS).find(node=>node.id===nodeId)||NODE_FALLBACKS.about;}

function entityDirectorySql(where="1=1"){
  return `SELECT ce.id,ce.entity_type,ce.node_id legacy_node_id,ce.visibility,
    CASE ce.entity_type
      WHEN 'flash_item' THEN fi.title WHEN 'flash_series' THEN fs.name WHEN 'art_work' THEN aw.title WHEN 'portfolio_item' THEN pi.title WHEN 'merch_item' THEN mi.title
      WHEN 'visual_symbol' THEN vs.name WHEN 'archive_record' THEN ar.title WHEN 'archive_collection' THEN ac.name
      WHEN 'construct_node' THEN own.name WHEN 'construct_pathway' THEN cp.name WHEN 'person' THEN pe.name
      WHEN 'place' THEN pl.name WHEN 'event' THEN ev.title ELSE ce.id END title,
    CASE ce.entity_type
      WHEN 'flash_item' THEN fi.state WHEN 'flash_series' THEN fs.state WHEN 'art_work' THEN aw.state WHEN 'portfolio_item' THEN pi.state WHEN 'merch_item' THEN mi.state
      WHEN 'visual_symbol' THEN vs.state WHEN 'archive_record' THEN ar.state WHEN 'archive_collection' THEN ac.state
      WHEN 'construct_node' THEN own.state WHEN 'construct_pathway' THEN cp.state WHEN 'person' THEN pe.state
      WHEN 'place' THEN pl.state WHEN 'event' THEN ev.status ELSE ce.visibility END state,
    CASE ce.entity_type
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'flash_series' THEN '/tattoos/flash/?series='||fs.slug
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/?work='||aw.slug)
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'merch_item' THEN mi.route
      WHEN 'visual_symbol' THEN '/about/legend/?symbol='||vs.slug
      WHEN 'archive_record' THEN '/archive/?record='||ar.slug
      WHEN 'archive_collection' THEN '/archive/?collection='||ac.slug
      WHEN 'construct_node' THEN own.route WHEN 'construct_pathway' THEN cp.route
      WHEN 'event' THEN '/events/'||ev.slug||'/' ELSE '' END route,
    COALESCE(NULLIF(mi.image_url,''),NULLIF(pi.source_url,''),
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id) FROM entity_media em JOIN media_assets m ON m.id=em.media_id
       WHERE em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order LIMIT 1),
      CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(json_extract(vs.examples_json,'$[0].src'),'') ELSE '' END,
      CASE WHEN ce.entity_type='portfolio_item' THEN '/api/portfolio/media/'||pi.id ELSE '' END) image_url,
    CASE ce.entity_type
      WHEN 'flash_item' THEN CASE WHEN fi.item_type='sheet' THEN 'Flash sheet' ELSE 'Flash' END
      WHEN 'flash_series' THEN 'Flash series' WHEN 'art_work' THEN 'Painting' WHEN 'portfolio_item' THEN 'Tattoo'
      WHEN 'merch_item' THEN COALESCE(NULLIF(mi.product_type,''),'Product') WHEN 'visual_symbol' THEN 'Legend symbol'
      WHEN 'archive_record' THEN COALESCE(NULLIF(ar.record_type,''),'Archive record') WHEN 'archive_collection' THEN 'Archive collection'
      WHEN 'construct_node' THEN 'Construct node' WHEN 'construct_pathway' THEN 'Pathway'
      WHEN 'person' THEN 'Person' WHEN 'place' THEN 'Place' WHEN 'event' THEN 'Event' ELSE ce.entity_type END kind_label,
    CASE ce.entity_type
      WHEN 'art_work' THEN trim(COALESCE(aw.year,'')||CASE WHEN aw.year<>'' AND aw.medium<>'' THEN ' · ' ELSE '' END||COALESCE(aw.medium,''))
      WHEN 'portfolio_item' THEN trim(COALESCE(pi.year,'')||CASE WHEN pi.year<>'' AND pi.placement<>'' THEN ' · ' ELSE '' END||COALESCE(pi.placement,'')||CASE WHEN (pi.year<>'' OR pi.placement<>'') AND pi.primary_style<>'' THEN ' · ' ELSE '' END||COALESCE(pi.primary_style,''))
      WHEN 'flash_item' THEN trim(COALESCE(fi.size_bucket,'')||CASE WHEN fi.size_bucket<>'' AND fi.process_category<>'' THEN ' · ' ELSE '' END||COALESCE(fi.process_category,''))
      WHEN 'archive_record' THEN trim(COALESCE(ar.date_or_period,'')||CASE WHEN ar.date_or_period<>'' AND ar.room<>'' THEN ' · ' ELSE '' END||COALESCE(ar.room,''))
      WHEN 'event' THEN trim(COALESCE(ev.starts_at,'')||CASE WHEN ev.starts_at IS NOT NULL AND ev.starts_at<>'' AND ev.location<>'' THEN ' · ' ELSE '' END||COALESCE(ev.location,''))
      WHEN 'place' THEN COALESCE(pl.public_location,'') ELSE '' END detail_label,
    COALESCE(cn.id,'') node_resolved_id,COALESCE(cn.name,'') node_name,COALESCE(cn.slug,'') node_slug,COALESCE(cn.color,'') node_color,
    COALESCE(fi.claimable,0) claimable
  FROM content_entities ce
  LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id
  LEFT JOIN flash_series fs ON ce.entity_type='flash_series' AND fs.id=ce.id
  LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id
  LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id
  LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
  LEFT JOIN archive_records ar ON ce.entity_type='archive_record' AND ar.id=ce.id
  LEFT JOIN archive_collections ac ON ce.entity_type='archive_collection' AND ac.id=ce.id
  LEFT JOIN construct_nodes own ON ce.entity_type='construct_node' AND own.id=ce.id
  LEFT JOIN construct_pathways cp ON ce.entity_type='construct_pathway' AND cp.id=ce.id
  LEFT JOIN people pe ON ce.entity_type='person' AND pe.id=ce.id
  LEFT JOIN places pl ON ce.entity_type='place' AND pl.id=ce.id
  LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id
  LEFT JOIN construct_nodes cn ON cn.id=CASE
    WHEN ce.entity_type='visual_symbol' OR ce.node_id IN ('legend','visual-language','visual_language') THEN 'node-legend'
    WHEN ce.entity_type IN ('flash_item','flash_series','portfolio_item') OR ce.node_id IN ('tattoo','tattoos','tattooing') THEN 'node-tattoos'
    WHEN ce.entity_type='art_work' OR ce.node_id IN ('art','art-making') THEN 'node-art'
    WHEN ce.entity_type='merch_item' OR ce.node_id='merch' THEN 'node-merch'
    WHEN ce.entity_type='event' OR ce.node_id='events' THEN 'node-events'
    WHEN ce.entity_type LIKE 'archive_%' OR ce.node_id='archive' THEN 'node-archive'
    WHEN ce.entity_type='construct_node' THEN ce.id ELSE ce.node_id END
  WHERE ${where}`;
}

function presentEntity(row){
  if(!row)return null;const nodeId=row.node_resolved_id||canonicalNodeAlias(row.legacy_node_id,row.entity_type);const fallback=nodeFallback(nodeId);
  return {id:row.id,entityType:row.entity_type,title:row.title||row.id,state:row.state||row.visibility,visibility:row.visibility,route:row.route||"",imageUrl:row.image_url||"",kindLabel:row.kind_label||row.entity_type,detailLabel:row.detail_label||"",claimable:Number(row.claimable||0),node:{id:nodeId,name:row.node_name||fallback.name,slug:row.node_slug||fallback.slug,color:row.node_color||fallback.color}};
}

async function entityRecords(database,ids){
  if(!ids.length)return new Map();const unique=[...new Set(ids)];const placeholders=unique.map(()=>"?").join(",");
  const rows=(await database.prepare(entityDirectorySql(`ce.id IN (${placeholders})`)).bind(...unique).all()).results||[];
  return new Map(rows.map(row=>[row.id,presentEntity(row)]));
}

async function entityDirectory(request,env){
  const database=db(env),url=new URL(request.url),q=text(url.searchParams.get("q"),160).toLowerCase(),type=text(url.searchParams.get("type"),80),node=text(url.searchParams.get("node"),80);const conditions=["1=1"],values=[];
  if(type){conditions.push("ce.entity_type=?");values.push(type)}
  if(node){conditions.push("(ce.node_id=? OR cn.id=?)");values.push(node,canonicalNodeAlias(node))}
  const rows=(await database.prepare(`${entityDirectorySql(conditions.join(" AND "))} ORDER BY title COLLATE NOCASE LIMIT 500`).bind(...values).all()).results||[];
  const records=rows.map(presentEntity).filter(record=>!q||record.title.toLowerCase().includes(q)||record.id.toLowerCase().includes(q));
  return json({records:records.slice(0,q?100:500),count:records.length});
}

async function relationshipTypesApi(request,env,typeId=""){
  const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT rt.*,(SELECT COUNT(*) FROM entity_relationships er WHERE er.relationship_type_id=rt.id) usage_count FROM relationship_types rt ORDER BY sort_order,forward_label").all()).results||[];return json({records:rows,count:rows.length})}
  const body=request.method==="DELETE"?{}:await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"){const forward=text(body.forward_label,160),reverse=text(body.reverse_label,160);if(!forward||!reverse)return failure("Forward and reverse labels are required.");const type=id("relationship-type");await database.prepare("INSERT INTO relationship_types(id,slug,forward_label,reverse_label,description,public_visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(type,slug(body.slug||forward),forward,reverse,text(body.description,2000),body.public_visible===false?0:1,Number(body.sort_order)||0).run();return json({record:await database.prepare("SELECT * FROM relationship_types WHERE id=?").bind(type).first()},{status:201})}
  const before=await database.prepare("SELECT * FROM relationship_types WHERE id=?").bind(typeId).first();if(!before)return failure("Relationship type not found.",404);
  if(request.method==="DELETE"){const used=await database.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE relationship_type_id=?").bind(typeId).first();if(Number(used?.count||0))return failure("Referenced relationship types cannot be deleted. Disable it instead.",409);await database.prepare("DELETE FROM relationship_types WHERE id=?").bind(typeId).run();return json({ok:true})}
  if(request.method==="PATCH"){await database.prepare("UPDATE relationship_types SET slug=?,forward_label=?,reverse_label=?,description=?,public_visible=?,sort_order=?,updated_at=datetime('now') WHERE id=?").bind(slug(body.slug??before.slug),text(body.forward_label??before.forward_label,160),text(body.reverse_label??before.reverse_label,160),text(body.description??before.description,2000),body.public_visible===undefined?before.public_visible:(body.public_visible?1:0),Number(body.sort_order??before.sort_order)||0,typeId).run();return json({record:await database.prepare("SELECT * FROM relationship_types WHERE id=?").bind(typeId).first()})}
  return failure("Method not allowed.",405);
}

async function validateRelationship(database,body,ignoreId=""){
  const source=text(body.source_entity_id,200),target=text(body.target_entity_id,200),type=text(body.relationship_type_id,200);if(!source||!target||!type)return failure("Source, target, and relationship type are required.");if(source===target)return failure("An entity cannot connect to itself.",409);
  const entities=await entityRecords(database,[source,target]);if(!entities.has(source)||!entities.has(target))return failure("Choose two registered entities.",404);
  const relType=await database.prepare("SELECT * FROM relationship_types WHERE id=?").bind(type).first();if(!relType)return failure("Relationship type not found.",404);if(!relType.public_visible&&!ignoreId&&body.public_visible)return failure("That relationship type is disabled for new public connections.",409);
  const duplicate=await database.prepare("SELECT id FROM entity_relationships WHERE ((source_entity_id=? AND target_entity_id=?) OR (source_entity_id=? AND target_entity_id=?)) AND relationship_type_id=? AND id<>?").bind(source,target,target,source,type,ignoreId).first();if(duplicate)return failure("That entity/type connection already exists in one direction.",409);
  if(body.public_visible){for(const entity of entities.values())if(entity.visibility!=="public"||!entity.route)return failure(`${entity.title} needs a public destination route before this connection can be public.`,409)}
  return {source,target,type,entities};
}

async function relationshipApi(request,env,relationshipId=""){
  const database=db(env);
  if(request.method==="GET"){const url=new URL(request.url),entityId=text(url.searchParams.get("entity_id"),200),visibility=text(url.searchParams.get("visibility"),30),type=text(url.searchParams.get("type"),100);const conditions=[],values=[];if(entityId){conditions.push("(er.source_entity_id=? OR er.target_entity_id=?)");values.push(entityId,entityId)}if(visibility){conditions.push("er.public_visible=?");values.push(visibility==="public"?1:0)}if(type){conditions.push("er.relationship_type_id=?");values.push(type)}const where=conditions.length?`WHERE ${conditions.join(" AND ")}`:"";const rows=(await database.prepare(`SELECT er.*,rt.slug relationship_slug,rt.forward_label,rt.reverse_label FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id ${where} ORDER BY er.sort_order,er.created_at DESC`).bind(...values).all()).results||[];const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));return json({records:rows.map(row=>({...row,source:entities.get(row.source_entity_id),target:entities.get(row.target_entity_id)})),count:rows.length})}
  if(request.method==="DELETE"&&relationshipId){const found=await database.prepare("SELECT id FROM entity_relationships WHERE id=?").bind(relationshipId).first();if(!found)return failure("Connection not found.",404);await database.prepare("DELETE FROM entity_relationships WHERE id=?").bind(relationshipId).run();return json({ok:true})}
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"){const valid=await validateRelationship(database,body);if(valid instanceof Response)return valid;const relId=id("relationship");await database.prepare("INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))").bind(relId,valid.source,valid.target,valid.type,body.public_visible?1:0,text(body.internal_notes,5000),Number(body.sort_order)||0).run();return json({record:await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relId).first()},{status:201})}
  if(request.method==="PATCH"&&relationshipId){const before=await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relationshipId).first();if(!before)return failure("Connection not found.",404);const next={...before,...body};const valid=await validateRelationship(database,next,relationshipId);if(valid instanceof Response)return valid;await database.prepare("UPDATE entity_relationships SET source_entity_id=?,target_entity_id=?,relationship_type_id=?,public_visible=?,internal_notes=?,sort_order=?,updated_at=datetime('now') WHERE id=?").bind(valid.source,valid.target,valid.type,next.public_visible?1:0,text(next.internal_notes,5000),Number(next.sort_order)||0,relationshipId).run();return json({record:await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relationshipId).first()})}
  return failure("Method not allowed.",405);
}

async function publicConnections(env,entityId){
  const database=db(env),currentMap=await entityRecords(database,[entityId]),current=currentMap.get(entityId);if(!current||current.visibility!=="public"||!current.route)return failure("Entity not found.",404);
  const rows=(await database.prepare(`SELECT er.id,er.source_entity_id,er.target_entity_id,er.relationship_type_id,er.sort_order,rt.slug relationshipSlug,rt.forward_label,rt.reverse_label FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id WHERE er.public_visible=1 AND rt.public_visible=1 AND (er.source_entity_id=? OR er.target_entity_id=?) ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId).all()).results||[];
  const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));const records=[];for(const row of rows){const outgoing=row.source_entity_id===entityId,related=entities.get(outgoing?row.target_entity_id:row.source_entity_id);if(!related||related.visibility!=="public"||!related.route)continue;records.push({id:row.id,direction:outgoing?"outgoing":"incoming",label:outgoing?row.forward_label:row.reverse_label,relationshipType:{id:row.relationship_type_id,slug:row.relationshipSlug},related,sortOrder:Number(row.sort_order||0)})}
  return json({entity:current,records,count:records.length},{cache:"public, max-age=60"});
}

async function taxonomyApi(request,env){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT * FROM taxonomy_terms ORDER BY kind,sort_order,name").all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);const kind=b?.kind==="theme"?"theme":"tag";const name=text(b?.name,160);if(!name)return failure("A term name is required.");const termId=text(b.id,160)||id("term");await database.prepare("INSERT INTO taxonomy_terms(id,kind,name,slug,description,public_visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(termId,kind,name,slug(b.slug||name),text(b.description,2000),b.public_visible===false?0:1,Number(b.sort_order)||0).run();return json({record:await database.prepare("SELECT * FROM taxonomy_terms WHERE id=?").bind(termId).first()},{status:201});}

async function legendCategoryApi(request,env,categoryId=""){
  const database=db(env);
  if(request.method==="GET"&&!categoryId){const rows=(await database.prepare("SELECT * FROM visual_symbol_categories ORDER BY sort_order,id").all()).results||[];return json({records:rows,count:rows.length});}
  if(request.method==="POST"&&categoryId==="reorder"){const body=await readJson(request);if(!Array.isArray(body?.ids))return failure("ids must be an array.");const current=(await database.prepare("SELECT id FROM visual_symbol_categories").all()).results||[];const requested=new Set(body.ids);if(body.ids.length!==current.length||requested.size!==current.length||current.some(row=>!requested.has(row.id)))return failure("The category list changed. Refresh before reordering.",409);await database.batch(body.ids.map((category,index)=>database.prepare("UPDATE visual_symbol_categories SET sort_order=?,updated_at=datetime('now') WHERE id=?").bind(index+1,category)));return json({ok:true});}
  const body=request.method==="DELETE"?{state:"archived"}:await readJson(request);if(!body)return failure("Invalid request.");
  const states=["draft","published","retired","archived"];
  if(body.state&&!states.includes(body.state))return failure("Invalid category state.");
  if(request.method==="POST"&&!categoryId){const name=text(body.name,160);if(!name)return failure("A category name is required.");const newId=text(body.id,160)||slug(body.slug||name);if(!newId)return failure("A category ID is required.");const last=await database.prepare("SELECT COALESCE(MAX(sort_order),0) max_order FROM visual_symbol_categories").first();const sortOrder=Number(body.sort_order)>0?Number(body.sort_order):Number(last?.max_order||0)+1;await database.prepare("INSERT INTO visual_symbol_categories(id,name,slug,description,state,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(newId,name,slug(body.slug||name),text(body.description,2000),body.state||"draft",sortOrder).run();return json({record:await database.prepare("SELECT * FROM visual_symbol_categories WHERE id=?").bind(newId).first()},{status:201});}
  if(categoryId&&(request.method==="PATCH"||request.method==="DELETE")){const before=await database.prepare("SELECT * FROM visual_symbol_categories WHERE id=?").bind(categoryId).first();if(!before)return failure("Not found.",404);const values={name:text(body.name??before.name,160),slug:slug(body.slug??before.slug),description:text(body.description??before.description,2000),state:body.state||before.state,sort_order:Number(body.sort_order??before.sort_order)||0};await database.prepare("UPDATE visual_symbol_categories SET name=?,slug=?,description=?,state=?,sort_order=?,updated_at=datetime('now') WHERE id=?").bind(values.name,values.slug,values.description,values.state,values.sort_order,categoryId).run();return json({record:await database.prepare("SELECT * FROM visual_symbol_categories WHERE id=?").bind(categoryId).first()});}
  return failure("Method not allowed.",405);
}

function canonicalResource(resource){return resource==="legend"?"visual-language":resource;}

async function entityMediaApi(request,env,entityId){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT em.*,m.original_filename,m.source_url,m.storage_key,m.mime_type FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.entity_id=? ORDER BY em.sort_order").bind(entityId).all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);if(!b?.media_id)return failure("media_id is required.");await database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,b.media_id,text(b.role,60)||"gallery",Number(b.sort_order)||0,b.public_visible?1:0,text(b.alt_text_override,1000),text(b.caption_override,3000)).run();return json({ok:true},{status:201});}

async function eventArchive(request,env,eventId){const database=db(env);const existing=await database.prepare("SELECT * FROM archive_records WHERE source_event_id=?").bind(eventId).first();if(existing)return json({record:existing,created:false});const event=await database.prepare("SELECT id,slug,title,description,starts_at,ends_at,location,status FROM events WHERE id=?").bind(eventId).first();if(!event)return failure("Event not found.",404);const attendance=await database.prepare("SELECT COALESCE(SUM(seats),0) total FROM event_tickets WHERE event_id=? AND status='paid'").bind(eventId).first();const recordId=`archive-event-${event.id}`;await database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_record','archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId).run();await database.prepare("INSERT INTO archive_records(id,slug,source_event_id,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,aggregate_attendance,created_at,updated_at) VALUES(?,?,?,?,?,'event','Events',?,?,?,?,'event handoff','draft',?,datetime('now'),datetime('now'))").bind(recordId,`event-${event.slug}`,event.id,event.title,'The Six.Well Construct',event.starts_at||'',event.starts_at||'',event.description||'',event.description||'',Number(attendance?.total||0)).run();const record=await database.prepare("SELECT * FROM archive_records WHERE id=?").bind(recordId).first();await nextRevision(database,recordId,"event-archive-handoff",null,record);return json({record,created:true},{status:201});}

export async function handleConstructApi(request,env){
  const url=new URL(request.url);const path=url.pathname;
  if(path==="/api/site/navigation")return publicNavigation(env);
  if(path==="/api/search")return publicSearch(request,env);
  const connectionsMatch=path.match(/^\/api\/connections\/([^/]+)$/);if(connectionsMatch&&request.method==="GET")return publicConnections(env,decodeURIComponent(connectionsMatch[1]));
  const mediaPublic=path.match(/^\/api\/construct\/media\/([^/]+)$/);if(mediaPublic)return mediaApi(request,env,decodeURIComponent(mediaPublic[1]));
  if(path==="/api/legend/categories")return publicLegendCategories(env);
  const publicMatch=path.match(/^\/api\/(flash|legend|visual-language|art|archive|archive-collections)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,canonicalResource(publicMatch[1]),publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const legendCategoryMatch=path.match(/^\/api\/admin\/legend\/categories(?:\/([^/]+))?$/);if(legendCategoryMatch)return legendCategoryApi(request,env,legendCategoryMatch[1]?decodeURIComponent(legendCategoryMatch[1]):"");
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  if(path==="/api/admin/entities"&&request.method==="GET")return entityDirectory(request,env);
  const relationshipTypeMatch=path.match(/^\/api\/admin\/relationship-types(?:\/([^/]+))?$/);if(relationshipTypeMatch)return relationshipTypesApi(request,env,relationshipTypeMatch[1]?decodeURIComponent(relationshipTypeMatch[1]):"");
  const relationshipMatch=path.match(/^\/api\/admin\/relationships(?:\/([^/]+))?$/);if(relationshipMatch)return relationshipApi(request,env,relationshipMatch[1]?decodeURIComponent(relationshipMatch[1]):"");
  if(path==="/api/admin/taxonomy")return taxonomyApi(request,env);
  const entityMediaMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media$/);if(entityMediaMatch)return entityMediaApi(request,env,decodeURIComponent(entityMediaMatch[1]));
  if(path==="/api/admin/revisions"&&request.method==="GET"){const rows=(await db(env).prepare("SELECT * FROM entity_revisions ORDER BY created_at DESC LIMIT 250").all()).results||[];return json({records:rows,count:rows.length});}
  if(path==="/api/admin/search/status"&&request.method==="GET"){const counts=await db(env).prepare("SELECT COUNT(*) documents FROM search_documents").first();const failures=await db(env).prepare("SELECT COUNT(*) failures FROM search_index_failures WHERE resolved_at IS NULL").first();return json({...counts,...failures});}
  const reorderMatch=path.match(/^\/api\/admin\/([^/]+)\/reorder$/);if(reorderMatch&&request.method==="POST")return reorder(request,env,canonicalResource(reorderMatch[1]));
  const match=path.match(/^\/api\/admin\/([^/]+)(?:\/([^/]+))?$/);if(!match)return failure("Unknown Construct API route.",404);const resource=match[1],recordId=match[2]?decodeURIComponent(match[2]):"";
  const canonical=canonicalResource(resource);if(!recordId&&request.method==="GET")return adminList(env,canonical);if(!recordId&&request.method==="POST")return adminCreate(request,env,canonical);if(recordId&&request.method==="PATCH")return adminUpdate(request,env,canonical,recordId);if(recordId&&request.method==="DELETE")return adminUpdate(request,env,canonical,recordId,true);return failure("Method not allowed.",405);
}
