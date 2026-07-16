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

const ARCHIVE_MATERIAL_TYPES = new Set(["final-image","sketch","process-photo","note","voice-memo","video","document","artifact"]);
const ARCHIVE_DATE_PRECISIONS = new Set(["exact","approximate","year","range","undated"]);
const ARCHIVE_VISIBILITIES = new Set(["public","unlisted","internal","private"]);
const ARCHIVE_STATES = new Set(["draft","published","archived"]);
const ARCHIVE_TIMELINE_STATES = new Set(["draft","published","archived"]);
const MEDIA_PRIVACIES = new Set(["public","unlisted","internal","private"]);
const MEDIA_CONSENT_STATUSES = new Set(["not-required","required","granted","denied","unknown"]);
const MEDIA_TRANSCRIPT_STATUSES = new Set(["not-requested","pending","ready","failed"]);
const MEDIA_PRESENTATIONS = new Set(["inline","hidden"]);

function archiveFragmentPublicSql(alias="af") {
  return `(
    (${alias}.fragment_type='dossier') OR
    (${alias}.fragment_type='material' AND EXISTS(SELECT 1 FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.id=${alias}.source_id AND am.dossier_entity_id=${alias}.dossier_entity_id AND am.state='published' AND am.visibility='public' AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline')))) OR
    (${alias}.fragment_type='activity' AND EXISTS(SELECT 1 FROM entity_activity ea WHERE ea.id=${alias}.source_id AND ea.entity_id=${alias}.dossier_entity_id AND ea.public_visible=1)) OR
    (${alias}.fragment_type='subject' AND EXISTS(SELECT 1 FROM archive_dossier_subjects ads JOIN content_entities subject ON subject.id=ads.subject_entity_id AND subject.visibility='public' LEFT JOIN people p ON p.id=subject.id LEFT JOIN places pl ON pl.id=subject.id LEFT JOIN organizations o ON o.id=subject.id WHERE ads.dossier_entity_id=${alias}.dossier_entity_id AND ${alias}.source_id=ads.subject_entity_id||':'||ads.role AND ads.public_visible=1 AND (p.id IS NULL OR (p.state='published' AND p.privacy='public')) AND (pl.id IS NULL OR (pl.state='published' AND pl.privacy='public')) AND (o.id IS NULL OR o.state='published'))) OR
    (${alias}.fragment_type='relationship' AND EXISTS(SELECT 1 FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id AND rt.public_visible=1 JOIN content_entities source ON source.id=er.source_entity_id AND source.visibility='public' JOIN content_entities target ON target.id=er.target_entity_id AND target.visibility='public' WHERE er.id=${alias}.source_id AND er.public_visible=1 AND (er.source_entity_id=${alias}.dossier_entity_id OR er.target_entity_id=${alias}.dossier_entity_id))) OR
    (${alias}.fragment_type='collection' AND EXISTS(SELECT 1 FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id AND ac.state='published' WHERE adc.dossier_entity_id=${alias}.dossier_entity_id AND adc.collection_id=${alias}.source_id)) OR
    (${alias}.fragment_type='activity-subject' AND EXISTS(SELECT 1 FROM entity_activity_subjects eas JOIN entity_activity ea ON ea.id=eas.activity_id AND ea.public_visible=1 JOIN content_entities subject ON subject.id=eas.subject_entity_id AND subject.visibility='public' LEFT JOIN people p ON p.id=subject.id LEFT JOIN places pl ON pl.id=subject.id LEFT JOIN organizations o ON o.id=subject.id WHERE eas.activity_id||':'||eas.subject_entity_id=${alias}.source_id AND ea.entity_id=${alias}.dossier_entity_id AND eas.public_visible=1 AND (p.id IS NULL OR (p.state='published' AND p.privacy='public')) AND (pl.id IS NULL OR (pl.state='published' AND pl.privacy='public')) AND (o.id IS NULL OR o.state='published')))
  )`;
}

function truthy(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function plainTextFtsQuery(value) {
  const tokens = String(value || "").normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.slice(0, 12).map((token) => token.toLowerCase()))]
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" AND ");
}

function archiveEntitySql(where = "1=1") {
  return `SELECT ad.*,ce.entity_type,ce.node_id,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.title WHEN 'merch_item' THEN mi.title
      WHEN 'portfolio_item' THEN COALESCE(NULLIF(pi.title,''),'Untitled tattoo')
      WHEN 'flash_item' THEN fi.title WHEN 'event' THEN ev.title
      WHEN 'visual_symbol' THEN vs.name ELSE COALESCE(sd.title,ad.archive_slug) END title,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.statement WHEN 'merch_item' THEN mi.product_type
      WHEN 'portfolio_item' THEN pi.caption WHEN 'flash_item' THEN fi.description
      WHEN 'event' THEN ev.description WHEN 'visual_symbol' THEN vs.meaning
      ELSE COALESCE(sd.summary,'') END canonical_summary,
    CASE ce.entity_type
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/?work='||aw.slug)
      WHEN 'merch_item' THEN mi.route
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'event' THEN '/events/'||ev.slug||'/'
      WHEN 'visual_symbol' THEN '/about/legend/?symbol='||vs.slug
      ELSE COALESCE(sd.route,'') END canonical_route,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.year WHEN 'portfolio_item' THEN pi.year
      WHEN 'event' THEN COALESCE(ev.starts_at,'') ELSE COALESCE(sd.date_label,'') END canonical_date,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.medium WHEN 'portfolio_item' THEN pi.primary_style
      WHEN 'flash_item' THEN fi.item_type WHEN 'merch_item' THEN mi.product_type
      WHEN 'event' THEN 'event' WHEN 'visual_symbol' THEN 'symbol' ELSE '' END medium,
    (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
      FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
        AND m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1) primary_image,
    (SELECT group_concat(material_type) FROM (
      SELECT DISTINCT am.material_type material_type FROM archive_materials am
      LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      ORDER BY am.material_type)) material_types
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id
  LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id
  LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id
  LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id
  LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
  LEFT JOIN search_documents sd ON sd.entity_id=ce.id
  WHERE ${where}`;
}

function presentArchiveItem(row) {
  if (!row) return null;
  const materialTypes = String(row.material_types || "").split(",").filter(Boolean);
  const summary = row.orientation || row.canonical_summary || "";
  const archiveRoute = `/archive/records/${encodeURIComponent(row.archive_slug)}/`;
  return {
    entity_id: row.entity_id,
    entityId: row.entity_id,
    archive_slug: row.archive_slug,
    archiveSlug: row.archive_slug,
    slug: row.archive_slug,
    entity_type: row.entity_type,
    entityType: row.entity_type,
    record_type: row.record_type || row.entity_type,
    recordType: row.record_type || row.entity_type,
    title: row.title || row.archive_slug,
    summary,
    orientation: row.orientation || "",
    story: row.story || "",
    story_html: row.story_html || "",
    empty_materials_note: row.empty_materials_note || "No process materials are public yet.",
    date_label: row.canonical_date || "",
    dateLabel: row.canonical_date || "",
    medium: row.medium || "",
    canonical_route: row.canonical_route || "",
    canonicalRoute: row.canonical_route || "",
    active_url: row.canonical_route || "",
    activeUrl: row.canonical_route || "",
    canonical_url: row.canonical_route || "",
    route: row.canonical_route || "",
    archive_route: archiveRoute,
    archiveRoute,
    primary_image: row.primary_image || "",
    primaryImage: row.primary_image || "",
    image_url: row.primary_image || "",
    imageUrl: row.primary_image || "",
    primary_media: row.primary_image ? { url: row.primary_image } : null,
    material_types: materialTypes,
    materialTypes,
    featured: Number(row.featured || 0),
    updated_at: row.updated_at,
  };
}

function archivePublicConditions(url, alias = "ad") {
  const conditions = ["ce.visibility='public'", `${alias}.state='published'`, `${alias}.public_visible=1`];
  const values = [];
  const q = text(url.searchParams.get("q"), 200);
  if (q) {
    const fts = plainTextFtsQuery(q);
    if (fts) {
      conditions.push(`EXISTS (SELECT 1 FROM archive_search_fragments_fts JOIN archive_search_fragments af ON af.rowid=archive_search_fragments_fts.rowid WHERE archive_search_fragments_fts MATCH ? AND af.dossier_entity_id=${alias}.entity_id AND af.public_visible=1 AND ${archiveFragmentPublicSql("af")})`);
      values.push(fts);
    } else {
      conditions.push(`EXISTS (SELECT 1 FROM archive_search_fragments af WHERE af.dossier_entity_id=${alias}.entity_id AND af.public_visible=1 AND ${archiveFragmentPublicSql("af")} AND lower(af.label||' '||af.body) LIKE ?)`);
      values.push(`%${q.toLowerCase()}%`);
    }
  }
  const facetParams = [
    ["medium","medium"], ["brand","brand"], ["person","person"], ["era","era"],
    ["record_type","record_type"], ["recordType","record_type"],
  ];
  const seenKinds = new Set();
  for (const [param,kind] of facetParams) {
    const value = text(url.searchParams.get(param), 120).toLowerCase();
    if (!value || seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    conditions.push(`EXISTS (SELECT 1 FROM archive_dossier_facets adf JOIN archive_facets f ON f.id=adf.facet_id WHERE adf.dossier_entity_id=${alias}.entity_id AND f.kind=? AND (f.slug=? OR lower(f.name)=?))`);
    values.push(kind,value,value);
  }
  const collection=text(url.searchParams.get("collection"),120).toLowerCase();
  if(collection){conditions.push(`EXISTS (SELECT 1 FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id WHERE adc.dossier_entity_id=${alias}.entity_id AND ac.state='published' AND (ac.slug=? OR lower(ac.name)=?))`);values.push(collection,collection);}
  const materialType = text(url.searchParams.get("material_type") || url.searchParams.get("materialType"), 80).replace(/_/g,"-").toLowerCase();
  if (materialType) {
    conditions.push(`EXISTS (SELECT 1 FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.dossier_entity_id=${alias}.entity_id AND am.material_type=? AND am.state='published' AND am.visibility='public' AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline')))`);
    values.push(materialType);
  }
  return { conditions, values, q };
}

async function publicArchiveItems(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.",405);
  const database = db(env); const url = new URL(request.url);
  const page = Math.max(1,Math.floor(Number(url.searchParams.get("page"))||1));
  const limit = Math.min(100,Math.max(1,Math.floor(Number(url.searchParams.get("limit"))||24)));
  const offset = (page-1)*limit;
  const {conditions,values,q} = archivePublicConditions(url);
  const where = conditions.join(" AND ");
  const itemSql = `${archiveEntitySql(where)} ORDER BY ad.featured DESC,ad.sort_order,ad.published_at DESC,ad.entity_id LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) total FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ${where}`;
  const [itemsResult,countResult,facetResult,materialFacetResult,collectionFacetResult] = await database.batch([
    database.prepare(itemSql).bind(...values,limit,offset),
    database.prepare(countSql).bind(...values),
    database.prepare(`SELECT f.kind,f.name,f.slug,COUNT(DISTINCT adf.dossier_entity_id) count
      FROM archive_facets f JOIN archive_dossier_facets adf ON adf.facet_id=f.id
      JOIN archive_dossiers ad ON ad.entity_id=adf.dossier_entity_id
      JOIN content_entities ce ON ce.id=ad.entity_id
      WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1
      GROUP BY f.id ORDER BY f.kind,f.sort_order,f.name`),
    database.prepare(`SELECT am.material_type slug,am.material_type name,COUNT(DISTINCT am.dossier_entity_id) count
      FROM archive_materials am JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
      JOIN content_entities ce ON ce.id=ad.entity_id LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1
        AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      GROUP BY am.material_type ORDER BY am.material_type`),
    database.prepare(`SELECT ac.slug,ac.name,COUNT(DISTINCT adc.dossier_entity_id) count
      FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id AND ac.state='published'
      JOIN archive_dossiers ad ON ad.entity_id=adc.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      GROUP BY ac.id ORDER BY ac.sort_order,ac.name`),
  ]);
  const items=(itemsResult.results||[]).map(presentArchiveItem);const total=Number(countResult.results?.[0]?.total||0);
  const facets={medium:[],brand:[],person:[],era:[],collection:collectionFacetResult.results||[],record_type:[],material_type:materialFacetResult.results||[]};
  for(const facet of facetResult.results||[]){if(facets[facet.kind])facets[facet.kind].push({name:facet.name,slug:facet.slug,count:Number(facet.count||0)});}
  const pagination={page,limit,total,total_pages:Math.max(1,Math.ceil(total/limit)),totalPages:Math.max(1,Math.ceil(total/limit))};
  return json({items,records:items,facets,pagination,count:items.length,query:q},{cache:"public, max-age=30"});
}

async function publicArchiveDetail(request,env,archiveSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(archiveEntitySql("ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND (ad.archive_slug=? OR ad.entity_id=?)")).bind(archiveSlug,archiveSlug).first();
  if(!row)return failure("Archive item not found.",404);
  const item=presentArchiveItem(row),entityId=row.entity_id;
  const [materialsResult,activitiesResult,subjectsResult,collectionsResult,relationshipsResult]=await database.batch([
    database.prepare(`SELECT am.*,m.mime_type,m.duration_seconds,m.alt_text,m.public_title,m.public_description,
        CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END transcript,m.transcript_status,m.transcript_language,m.public_presentation,
        CASE WHEN m.public_presentation='inline' THEN COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END) ELSE '' END media_url
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=? AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      ORDER BY CASE WHEN am.occurred_at IS NULL THEN 1 ELSE 0 END,am.occurred_at,am.sort_order,am.created_at`).bind(entityId),
    database.prepare(`SELECT ea.*,('history-'||ea.id) anchor FROM entity_activity ea
      WHERE ea.entity_id=? AND ea.public_visible=1
      ORDER BY CASE WHEN ea.occurred_at IS NULL THEN 1 ELSE 0 END,ea.occurred_at,ea.sort_order,ea.created_at`).bind(entityId),
    database.prepare(`SELECT ads.subject_entity_id entity_id,ads.role,ads.sort_order,ce.entity_type,
        COALESCE(o.name,p.name,n.name,ce.id) name,
        COALESCE(o.slug,p.slug,n.slug,'') slug
      FROM archive_dossier_subjects ads JOIN content_entities ce ON ce.id=ads.subject_entity_id AND ce.visibility='public'
      LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
      LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
      LEFT JOIN construct_nodes n ON n.id=ce.id AND n.state='published'
      WHERE ads.dossier_entity_id=? AND ads.public_visible=1
        AND (ce.entity_type<>'person' OR p.id IS NOT NULL) AND (ce.entity_type<>'place' OR EXISTS(SELECT 1 FROM places visible_place WHERE visible_place.id=ce.id AND visible_place.state='published' AND visible_place.privacy='public'))
        AND (ce.entity_type<>'organization' OR o.id IS NOT NULL)
      ORDER BY ads.sort_order,name`).bind(entityId),
    database.prepare(`SELECT ac.id,ac.name,ac.slug,ac.description,adc.sort_order
      FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id
      WHERE adc.dossier_entity_id=? AND ac.state='published' ORDER BY adc.sort_order,ac.name`).bind(entityId),
    database.prepare(`SELECT er.*,rt.slug relationship_slug,rt.forward_label,rt.reverse_label
      FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id
      WHERE er.public_visible=1 AND rt.public_visible=1 AND (er.source_entity_id=? OR er.target_entity_id=?)
      ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId),
  ]);
  const relationshipRows=relationshipsResult.results||[];
  const relatedIds=relationshipRows.map(r=>r.source_entity_id===entityId?r.target_entity_id:r.source_entity_id);
  const relatedMap=await entityRecords(database,relatedIds);
  const relatedDossiers=relatedIds.length?(await database.prepare(`SELECT entity_id,archive_slug FROM archive_dossiers WHERE state='published' AND public_visible=1 AND entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
  const relatedSlugs=new Map(relatedDossiers.map(d=>[d.entity_id,d.archive_slug]));
  const relationships=[];for(const relation of relationshipRows){const outgoing=relation.source_entity_id===entityId;const relatedId=outgoing?relation.target_entity_id:relation.source_entity_id;const related=relatedMap.get(relatedId);if(!related||related.visibility!=="public")continue;const archive_slug=relatedSlugs.get(relatedId)||"";relationships.push({id:relation.id,direction:outgoing?"outgoing":"incoming",label:outgoing?relation.forward_label:relation.reverse_label,relationship_type:relation.relationship_slug,related:{...related,imageUrl:"",archive_slug,archiveRoute:archive_slug?`/archive/records/${encodeURIComponent(archive_slug)}/`:""}});}
  const materials=(materialsResult.results||[]).map(material=>({...material,anchor:`material-${material.id}`,url:material.media_url||"",inline_text:material.body||""}));
  const activities=activitiesResult.results||[];
  return json({item,dossier:item,materials,activities,subjects:subjectsResult.results||[],collections:collectionsResult.results||[],relationships},{cache:"public, max-age=30"});
}

function timelineSubjectName(row){return row.organization_name||row.person_name||row.node_name||row.title||row.slug;}

async function publicArchiveTimeline(request,env,timelineSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const timeline=await database.prepare(`SELECT at.*,ce.entity_type,o.name organization_name,p.name person_name,n.name node_name
    FROM archive_timelines at JOIN content_entities ce ON ce.id=at.subject_entity_id AND ce.visibility='public'
    LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
    LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
    LEFT JOIN construct_nodes n ON n.id=ce.id AND n.state='published'
    WHERE (at.slug=? OR at.id=?) AND at.state='published' AND at.public_visible=1
      AND (ce.entity_type<>'person' OR p.id IS NOT NULL)
      AND (ce.entity_type<>'organization' OR o.id IS NOT NULL)`).bind(timelineSlug,timelineSlug).first();
  if(!timeline)return failure("Timeline not found.",404);
  timeline.subject_name=timelineSubjectName(timeline);timeline.route=`/archive/timelines/${encodeURIComponent(timeline.slug)}/`;
  const [chaptersResult,activitiesResult]=await database.batch([
    database.prepare(`SELECT * FROM archive_timeline_chapters WHERE timeline_id=? AND state='published' AND public_visible=1
      ORDER BY CASE WHEN occurred_at IS NULL THEN 1 ELSE 0 END,occurred_at,sort_order,created_at`).bind(timeline.id),
    database.prepare(`SELECT ea.*,ad.archive_slug,
        CASE ce.entity_type WHEN 'art_work' THEN aw.title WHEN 'merch_item' THEN mi.title WHEN 'portfolio_item' THEN pi.title
          WHEN 'flash_item' THEN fi.title WHEN 'event' THEN ev.title WHEN 'visual_symbol' THEN vs.name ELSE ce.id END item_title
      FROM entity_activity_subjects eas JOIN entity_activity ea ON ea.id=eas.activity_id AND ea.public_visible=1
      JOIN content_entities ce ON ce.id=ea.entity_id AND ce.visibility='public'
      JOIN archive_dossiers ad ON ad.entity_id=ea.entity_id AND ad.state='published' AND ad.public_visible=1
      LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id
      LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id
      LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id
      LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id
      LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id
      LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
      WHERE eas.subject_entity_id=? AND eas.public_visible=1
      ORDER BY CASE WHEN ea.occurred_at IS NULL THEN 1 ELSE 0 END,ea.occurred_at,ea.sort_order,ea.created_at`).bind(timeline.subject_entity_id),
  ]);
  const chapters=(chaptersResult.results||[]).map(row=>({...row,entry_type:"chapter",anchor:row.anchor_slug||`chapter-${row.id}`}));
  const activities=(activitiesResult.results||[]).map(row=>({...row,entry_type:"activity",anchor:`activity-${row.id}`,archive_route:row.archive_slug?`/archive/records/${encodeURIComponent(row.archive_slug)}/`:""}));
  const entries=[...chapters,...activities].sort((a,b)=>{const ad=a.occurred_at||"9999-12-31",bd=b.occurred_at||"9999-12-31";return ad.localeCompare(bd)||Number(a.sort_order||0)-Number(b.sort_order||0);});
  const deduped=[],keys=new Set();for(const entry of entries){const key=entry.dedupe_key||`${String(entry.title||"").toLowerCase()}|${entry.occurred_at||entry.date_label||"undated"}`;if(keys.has(key))continue;keys.add(key);deduped.push(entry);}
  return json({timeline,chapters,activities,entries:deduped},{cache:"public, max-age=60"});
}

async function publicSearch(request, env) {
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env),url=new URL(request.url),q=text(url.searchParams.get("q"),200),type=text(url.searchParams.get("type"),80),node=text(url.searchParams.get("node"),80);
  const archiveFilter=archivePublicConditions(url),archiveConditions=[...archiveFilter.conditions],archiveValues=[...archiveFilter.values];
  if(type){archiveConditions.push("ce.entity_type=?");archiveValues.push(type)}
  if(node){archiveConditions.push("ce.node_id=?");archiveValues.push(node)}
  const archiveRows=(await database.prepare(`${archiveEntitySql(archiveConditions.join(" AND "))} ORDER BY ad.featured DESC,ad.updated_at DESC LIMIT 100`).bind(...archiveValues).all()).results||[];
  const archiveIds=archiveRows.map(row=>row.entity_id);let fragmentRows=[];
  if(archiveIds.length){
    const idClause=archiveIds.map(()=>"?").join(","),fts=plainTextFtsQuery(q);let fragmentSql,fragmentValues;
    if(q&&fts){fragmentSql=`SELECT af.*,bm25(archive_search_fragments_fts) rank FROM archive_search_fragments_fts JOIN archive_search_fragments af ON af.rowid=archive_search_fragments_fts.rowid WHERE archive_search_fragments_fts MATCH ? AND af.public_visible=1 AND ${archiveFragmentPublicSql("af")} AND af.dossier_entity_id IN (${idClause}) ORDER BY rank LIMIT 300`;fragmentValues=[fts,...archiveIds]}
    else if(q){fragmentSql=`SELECT af.*,0 rank FROM archive_search_fragments af WHERE af.public_visible=1 AND ${archiveFragmentPublicSql("af")} AND lower(af.label||' '||af.body) LIKE ? AND af.dossier_entity_id IN (${idClause}) ORDER BY af.updated_at DESC LIMIT 300`;fragmentValues=[`%${q.toLowerCase()}%`,...archiveIds]}
    else{fragmentSql=`SELECT af.*,0 rank FROM archive_search_fragments af WHERE af.public_visible=1 AND af.fragment_type='dossier' AND ${archiveFragmentPublicSql("af")} AND af.dossier_entity_id IN (${idClause}) ORDER BY af.updated_at DESC LIMIT 300`;fragmentValues=archiveIds}
    fragmentRows=(await database.prepare(fragmentSql).bind(...fragmentValues).all()).results||[];
  }
  const fragmentsByEntity=new Map();for(const fragment of fragmentRows){if(!fragmentsByEntity.has(fragment.dossier_entity_id))fragmentsByEntity.set(fragment.dossier_entity_id,[]);const anchor=fragment.anchor||"overview";fragmentsByEntity.get(fragment.dossier_entity_id).push({fragment_type:fragment.fragment_type,source_id:fragment.source_id,label:fragment.label,body:fragment.body,snippet:String(fragment.body||fragment.label||"").slice(0,320),anchor,dossier_anchor:`/archive/records/${encodeURIComponent(archiveRows.find(row=>row.entity_id===fragment.dossier_entity_id)?.archive_slug||fragment.dossier_entity_id)}/#${encodeURIComponent(anchor)}`,rank:Number(fragment.rank||0)});}
  const archiveRecords=archiveRows.map(row=>{const item=presentArchiveItem(row);return {...item,route:item.archive_route,matches:fragmentsByEntity.get(row.entity_id)||[],match_count:(fragmentsByEntity.get(row.entity_id)||[]).length};});

  const legacyFilters=["ce.visibility='public'","ce.search_visibility=1","ad.entity_id IS NULL"],legacyValues=[];
  if(type){legacyFilters.push("d.entity_type=?");legacyValues.push(type)}if(node){legacyFilters.push("d.node_id=?");legacyValues.push(node)}
  for(const [param,column] of [["state","state"],["date","date_label"]]){const value=text(url.searchParams.get(param),120);if(value){legacyFilters.push(`d.${column}=?`);legacyValues.push(value)}}
  for(const [param,column] of [["theme","theme_labels"],["place","place_labels"]]){const value=text(url.searchParams.get(param),120);if(value){legacyFilters.push(`d.${column} LIKE ?`);legacyValues.push(`%${value}%`)}}
  const fts=plainTextFtsQuery(q);let legacySql,legacyArgs;
  if(q&&fts){legacySql=`SELECT d.*,bm25(search_documents_fts) rank FROM search_documents_fts JOIN search_documents d ON d.rowid=search_documents_fts.rowid JOIN content_entities ce ON ce.id=d.entity_id LEFT JOIN archive_dossiers ad ON ad.entity_id=d.entity_id WHERE search_documents_fts MATCH ? AND ${legacyFilters.join(" AND ")} ORDER BY rank LIMIT 100`;legacyArgs=[fts,...legacyValues]}
  else if(q){legacySql=`SELECT d.*,0 rank FROM search_documents d JOIN content_entities ce ON ce.id=d.entity_id LEFT JOIN archive_dossiers ad ON ad.entity_id=d.entity_id WHERE lower(d.title||' '||d.summary||' '||d.body) LIKE ? AND ${legacyFilters.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 100`;legacyArgs=[`%${q.toLowerCase()}%`,...legacyValues]}
  else{legacySql=`SELECT d.*,0 rank FROM search_documents d JOIN content_entities ce ON ce.id=d.entity_id LEFT JOIN archive_dossiers ad ON ad.entity_id=d.entity_id WHERE ${legacyFilters.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 100`;legacyArgs=legacyValues}
  const legacyRows=(await database.prepare(legacySql).bind(...legacyArgs).all()).results||[];
  const legacyRecords=legacyRows.map(row=>({...row,matches:[{fragment_type:"entity",source_id:row.entity_id,label:row.title,body:row.summary||row.body||"",snippet:String(row.summary||row.body||"").slice(0,320),anchor:"",dossier_anchor:row.route}],match_count:1}));
  const records=[...archiveRecords,...legacyRecords];
  return json({records,groups:records,items:records,count:records.length,query:q},{cache:"public, max-age=30"});
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
  const stateVisible = resource === "flash" ? ["available","reserved","placed","retired"].includes(row.state) : row.state === "published";
  const visible = stateVisible && (!['people','places'].includes(resource) || row.privacy === 'public');
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
  const publishStatements=[entityVisibilityStatement(database, resource, created),searchSyncStatement(database, resource, created)];
  if(archiveEligibleEntityType(config.entityType))publishStatements.push(archiveShellStatement(database,recordId,config.entityType,archivePreferredSlug(config.entityType,created),archiveRecordType(config.entityType)));
  await database.batch(publishStatements);
  await nextRevision(database,recordId,"create",null,created); return json({ record: created },{status:201});
}

async function adminUpdate(request, env, resource, recordId, archive = false) {
  const config = RESOURCE_CONFIG[resource]; const body = archive ? { state: "archived" } : await readJson(request); if (!config || !body) return failure("Invalid request.");
  const database = db(env); const before = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first(); if (!before) return failure("Not found.",404);
  const values = normalizeRecord(config,body,before); const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  const projected = { ...before, ...values, id: recordId };
  const updateStatements=[
    database.prepare(`UPDATE ${config.table} SET ${keys.map(k=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...keys.map(k=>values[k]),recordId),
    entityVisibilityStatement(database, resource, projected),
    searchSyncStatement(database, resource, projected),
  ];
  if(archiveEligibleEntityType(config.entityType))updateStatements.push(archiveShellStatement(database,recordId,config.entityType,archivePreferredSlug(config.entityType,projected),archiveRecordType(config.entityType)));
  await database.batch(updateStatements);
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

function normalizedConsent(value, fallback="unknown") {
  const consent=text(value,30).toLowerCase();
  return consent==="approved"?"granted":(consent||fallback);
}

function publicPortfolioMediaEligible(media) {
  return media?.state === "active"
    && media.privacy === "public"
    && ["not-required", "granted"].includes(media.consent_status)
    && media.public_presentation === "inline";
}

function isPortfolioCoverGuardError(error) {
  return String(error?.message || error).includes("published portfolio cover must remain eligible");
}

async function publishedPortfolioCoverUsingMedia(database, mediaId) {
  return database.prepare(`SELECT pi.id, pi.title FROM portfolio_items pi
    JOIN entity_media em ON em.entity_id=pi.id AND em.media_id=? AND em.role='gallery'
    WHERE pi.state='published' AND pi.cover_image_ref=?
    LIMIT 1`).bind(mediaId, mediaId).first();
}

async function publicMediaApi(request,env,mediaId){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      AND EXISTS(SELECT 1 FROM archive_materials am JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
        JOIN content_entities ce ON ce.id=ad.entity_id WHERE am.media_id=m.id AND am.state='published' AND am.visibility='public'
          AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public')`).bind(mediaId).first();
  if(!row)return failure("Not found.",404);
  return servePublicMedia(row,request,env);
}

async function publicEntityMediaApi(request,env,mediaId){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const row=await db(env).prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      AND EXISTS(SELECT 1 FROM entity_media em JOIN content_entities ce ON ce.id=em.entity_id
        WHERE em.media_id=m.id AND em.public_visible=1 AND ce.visibility='public')`).bind(mediaId).first();
  if(!row)return failure("Not found.",404);
  return servePublicMedia(row,request,env);
}

async function servePublicMedia(row,request,env){
  if(row.source_url)return new Response(null,{status:302,headers:{location:new URL(row.source_url,request.url).href,"cache-control":"private, no-store"}});
  const object=await env.SUBMISSION_FILES?.get(row.storage_key);if(!object)return failure("Media unavailable.",404);
  const filename=String(row.original_filename||"media").replace(/[\r\n"]/g,"-");
  return new Response(object.body,{headers:{"content-type":row.mime_type||"application/octet-stream","content-disposition":`inline; filename="${filename}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}

async function adminMediaFileApi(request,env,mediaId){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const row=await db(env).prepare("SELECT * FROM media_assets WHERE id=? AND state='active'").bind(mediaId).first();
  if(!row)return failure("Media not found.",404);
  return servePublicMedia(row,request,env);
}

async function mediaApi(request, env, mediaId="") {
  const database=db(env);
  if(request.method==="GET"){
    if(mediaId){const record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();return record?json({record}):failure("Not found.",404);}
    const rows=(await database.prepare("SELECT * FROM media_assets ORDER BY created_at DESC").all()).results||[];return json({records:rows,count:rows.length});
  }
  if(request.method==="PATCH"&&mediaId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const before=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();if(!before)return failure("Not found.",404);
    const next={
      state:text(body.state??before.state,30),alt_text:text(body.alt_text??before.alt_text,1000),caption:text(body.caption??before.caption,3000),
      privacy:text(body.privacy??before.privacy,30),consent_status:normalizedConsent(body.consent_status??before.consent_status,before.consent_status),
      transcript:text(body.transcript??before.transcript,100000),transcript_status:text(body.transcript_status??before.transcript_status,30),
      transcript_language:text(body.transcript_language??before.transcript_language,40),public_title:text(body.public_title??before.public_title,300),
      public_description:text(body.public_description??before.public_description,3000),public_presentation:text(body.public_presentation??before.public_presentation,30),
    };
    if(!["active","archived"].includes(next.state))return failure("Invalid media state.");
    if(!MEDIA_PRIVACIES.has(next.privacy))return failure("Invalid media privacy.");
    if(!MEDIA_CONSENT_STATUSES.has(next.consent_status))return failure("Invalid consent status.");
    if(!MEDIA_TRANSCRIPT_STATUSES.has(next.transcript_status))return failure("Invalid transcript status.");
    if(!MEDIA_PRESENTATIONS.has(next.public_presentation))return failure("Invalid public presentation.");
    const eligibilityChanged=["state","privacy","consent_status","public_presentation"].some(field=>Object.prototype.hasOwnProperty.call(body,field));
    if(eligibilityChanged&&!publicPortfolioMediaEligible(next)){
      const cover=await publishedPortfolioCoverUsingMedia(database,mediaId);
      if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before making this media private.",409);
    }
    try{
      await database.prepare("UPDATE media_assets SET state=?,alt_text=?,caption=?,privacy=?,consent_status=?,transcript=?,transcript_status=?,transcript_language=?,public_title=?,public_description=?,public_presentation=?,updated_at=datetime('now') WHERE id=?")
        .bind(next.state,next.alt_text,next.caption,next.privacy,next.consent_status,next.transcript,next.transcript_status,next.transcript_language,next.public_title,next.public_description,next.public_presentation,mediaId).run();
    }catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before making this media private.",409);throw error;}
    return json({record:await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first()});
  }
  if(request.method!=="POST"||mediaId)return failure("Method not allowed.",405);
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||!file.size)return failure("A file is required.");
  const mime=(file.type||"application/octet-stream").toLowerCase();const image=["image/jpeg","image/png","image/webp","image/gif"].includes(mime);const doc=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mime);const av=mime.startsWith("audio/")||mime.startsWith("video/");const max=av?50*1024*1024:15*1024*1024;if(!(image||doc||av))return failure("Unsupported media type.",415);if(file.size>max)return failure("File exceeds the allowed size.",413);if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
  const privacy=text(form.get("privacy"),30)||"internal",consent=normalizedConsent(form.get("consent_status")),transcriptStatus=text(form.get("transcript_status"),30)||"not-requested",presentation=text(form.get("public_presentation"),30)||"inline";
  if(!MEDIA_PRIVACIES.has(privacy))return failure("Invalid media privacy.");if(!MEDIA_CONSENT_STATUSES.has(consent))return failure("Invalid consent status.");if(!MEDIA_TRANSCRIPT_STATUSES.has(transcriptStatus))return failure("Invalid transcript status.");if(!MEDIA_PRESENTATIONS.has(presentation))return failure("Invalid public presentation.");
  const newId=id("media");const key=`construct/${newId}/${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.SUBMISSION_FILES.put(key,file.stream(),{httpMetadata:{contentType:mime}});
  try{await database.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,alt_text,caption,privacy,consent_status,state,created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation)
    VALUES(?,?,?,?,?,?,?,?,?,'active','studio',datetime('now'),datetime('now'),?,?,?,?,?,?)`).bind(newId,key,file.name,mime,file.size,text(form.get("alt_text"),1000),text(form.get("caption"),3000),privacy,consent,text(form.get("transcript"),100000),transcriptStatus,text(form.get("transcript_language"),40),text(form.get("public_title"),300),text(form.get("public_description"),3000),presentation).run();}catch(error){await env.SUBMISSION_FILES.delete(key);throw error;}
  return json({record:await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(newId).first()},{status:201});
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
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/entity-media/'||m.id) FROM entity_media em JOIN media_assets m ON m.id=em.media_id
       WHERE em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' AND m.privacy='public'
         AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
       ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order LIMIT 1),
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

async function entityMediaApi(request,env,entityId){const database=db(env);if(request.method==="GET"){const rows=(await database.prepare("SELECT em.*,m.original_filename,m.source_url,m.storage_key,m.mime_type FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.entity_id=? ORDER BY em.sort_order").bind(entityId).all()).results||[];return json({records:rows,count:rows.length});}const b=await readJson(request);if(!b?.media_id)return failure("media_id is required.");const role=text(b.role,60)||"gallery",publicVisible=b.public_visible?1:0;const cover=role==="gallery"&&!publicVisible?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,b.media_id).first():null;if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);try{await database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,b.media_id,role,Number(b.sort_order)||0,publicVisible,text(b.alt_text_override,1000),text(b.caption_override,3000)).run();}catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);throw error;}return json({ok:true},{status:201});}

function archiveRecordType(entityType){return {art_work:"artwork",merch_item:"merchandise",portfolio_item:"tattoo",flash_item:"flash",event:"event",visual_symbol:"symbol"}[entityType]||String(entityType||"").replace(/_/g,"-");}
function archivePreferredSlug(entityType,row){return slug(row?.archive_slug||row?.slug||row?.shopify_handle||row?.id)||String(row?.id||"");}
function archiveEligibleEntityType(entityType){return ["art_work","merch_item","portfolio_item","flash_item","event","visual_symbol","writing_work","film_work","music_work"].includes(entityType);}

function archiveShellStatement(database,entityId,entityType,preferredSlug,recordType){
  const base=slug(preferredSlug)||entityId,prefixed=`${String(entityType||"item").replace(/_/g,"-")}-${base}`;
  return database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
    SELECT ce.id,CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=? AND other.entity_id<>ce.id) THEN ? ELSE ? END,
      ?,'published',1,COALESCE(ce.public_at,datetime('now')),'studio','studio',datetime('now'),datetime('now')
    FROM content_entities ce WHERE ce.id=? AND ce.visibility='public'
    ON CONFLICT(entity_id) DO UPDATE SET
      archive_slug=CASE WHEN archive_dossiers.archive_slug=archive_dossiers.entity_id THEN excluded.archive_slug ELSE archive_dossiers.archive_slug END,
      record_type=CASE WHEN archive_dossiers.record_type='' THEN excluded.record_type ELSE archive_dossiers.record_type END,
      updated_by='studio',updated_at=datetime('now')`).bind(base,prefixed,base,recordType,entityId);
}

async function archiveDossiersAdminApi(request,env,entityId=""){
  const database=db(env);
  if(request.method==="GET"){
    const where=entityId?"ad.entity_id=?":"1=1";const statement=database.prepare(`${archiveEntitySql(where)} ORDER BY ad.updated_at DESC,ad.entity_id`);const result=entityId?await statement.bind(entityId).all():await statement.all();const records=(result.results||[]).map(row=>({...row,...presentArchiveItem(row)}));
    if(entityId&&!records[0])return failure("Dossier not found.",404);return json(entityId?{record:records[0],dossier:records[0]}:{records,count:records.length});
  }
  if(request.method==="POST"&&!entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const ownerId=text(body.entity_id||body.entityId,200);if(!ownerId)return failure("entity_id is required.");
    const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(ownerId).first();if(!owner)return failure("Canonical entity not found.",404);if(!archiveEligibleEntityType(owner.entity_type))return failure("That entity type is not eligible for an Archive dossier.",409);
    const archiveSlug=slug(body.archive_slug||body.archiveSlug||body.slug||ownerId);if(!archiveSlug)return failure("archive_slug is required.");const state=text(body.state,30)||"draft",publicVisible=truthy(body.public_visible??body.publicVisible)?1:0;if(!ARCHIVE_STATES.has(state))return failure("Invalid dossier state.");if(state==="published"&&publicVisible&&owner.visibility!=="public")return failure("The canonical entity must be public before its dossier can publish.",409);
    await database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' AND ?=1 THEN datetime('now') ELSE NULL END,'studio','studio',datetime('now'),datetime('now'))`).bind(ownerId,archiveSlug,text(body.orientation,8000),text(body.story,50000),text(body.story_html,50000),text(body.empty_materials_note,3000)||"No process materials are public yet.",text(body.record_type,100)||archiveRecordType(owner.entity_type),state,publicVisible,truthy(body.featured)?1:0,Number(body.sort_order)||0,state,publicVisible).run();
    return archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,ownerId);
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();if(!before)return failure("Dossier not found.",404);const owner=await database.prepare("SELECT visibility FROM content_entities WHERE id=?").bind(entityId).first();
    const next={archive_slug:slug(body.archive_slug??body.archiveSlug??body.slug??before.archive_slug),orientation:text(body.orientation??before.orientation,8000),story:text(body.story??before.story,50000),story_html:text(body.story_html??before.story_html,50000),empty_materials_note:text(body.empty_materials_note??before.empty_materials_note,3000),record_type:text(body.record_type??body.recordType??before.record_type,100),state:text(body.state??before.state,30),public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible)?1:0,featured:body.featured===undefined?Number(before.featured):truthy(body.featured)?1:0,sort_order:Number(body.sort_order??before.sort_order)||0};
    if(!next.archive_slug)return failure("archive_slug is required.");if(!ARCHIVE_STATES.has(next.state))return failure("Invalid dossier state.");if(next.state==="published"&&next.public_visible&&owner?.visibility!=="public")return failure("The canonical entity must be public before its dossier can publish.",409);
    await database.prepare(`UPDATE archive_dossiers SET archive_slug=?,orientation=?,story=?,story_html=?,empty_materials_note=?,record_type=?,state=?,public_visible=?,featured=?,sort_order=?,published_at=CASE WHEN ?='published' AND ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(next.archive_slug,next.orientation,next.story,next.story_html,next.empty_materials_note,next.record_type,next.state,next.public_visible,next.featured,next.sort_order,next.state,next.public_visible,entityId).run();
    const after=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();await nextRevision(database,entityId,"archive-dossier-update",before,after);return json({record:after,dossier:after});
  }
  if(request.method==="DELETE"&&entityId){await database.prepare("UPDATE archive_dossiers SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(entityId).run();return json({ok:true});}
  return failure("Method not allowed.",405);
}

function normalizeArchiveMaterial(body,existing={}){
  const materialType=text(body.material_type??body.materialType??existing.material_type,80).replace(/_/g,"-").toLowerCase()||"note";
  const visibility=text(body.visibility??body.privacy??existing.visibility,30).toLowerCase()||"internal";
  const state=text(body.state??existing.state,30).toLowerCase()||"draft";
  const occurredAt=text(body.occurred_at??body.start_date??body.start??existing.occurred_at,80)||null;
  const endedAt=text(body.ended_at??body.end_date??body.end??existing.ended_at,80)||null;
  const datePrecision=text(body.date_precision??body.datePrecision??existing.date_precision,30).toLowerCase()||(occurredAt?"exact":"undated");
  return {dossier_entity_id:text(body.dossier_entity_id??body.entity_id??body.entityId??existing.dossier_entity_id,200),media_id:text(body.media_id??body.mediaId??existing.media_id,200)||null,role:text(body.role??existing.role,80)||"notebook",material_type:materialType,title:text(body.title??existing.title,300),caption:text(body.caption??existing.caption,5000),body:text(body.body??body.inline_text??body.inlineText??existing.body,100000),process_phase:text(body.process_phase??body.processPhase??existing.process_phase,120),occurred_at:occurredAt,ended_at:endedAt,date_precision:datePrecision,date_label:text(body.date_label??body.display_date??body.displayDate??existing.date_label,160),visibility,state,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};
}

async function validateArchiveMaterial(database,material){
  if(!material.dossier_entity_id)return failure("entity_id is required.");if(!ARCHIVE_MATERIAL_TYPES.has(material.material_type))return failure("Invalid material type.");if(!ARCHIVE_VISIBILITIES.has(material.visibility))return failure("Invalid material visibility.");if(!ARCHIVE_STATES.has(material.state))return failure("Invalid material state.");if(!ARCHIVE_DATE_PRECISIONS.has(material.date_precision))return failure("Invalid date precision.");if(!material.media_id&&!material.body)return failure("A material needs media_id or inline_text.");
  const dossier=await database.prepare("SELECT ad.*,ce.visibility canonical_visibility FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ad.entity_id=?").bind(material.dossier_entity_id).first();if(!dossier)return failure("Dossier not found.",404);
  let media=null;if(material.media_id){media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(material.media_id).first();if(!media)return failure("Media not found.",404)}
  if(material.state==="published"&&material.visibility==="public"){
    if(dossier.state!=="published"||!Number(dossier.public_visible)||dossier.canonical_visibility!=="public")return failure("Publish the canonical entity and dossier before publishing this material.",409);
    if(media&&(media.state!=="active"||media.privacy!=="public"||!["not-required","granted"].includes(media.consent_status)||media.public_presentation!=="inline"))return failure("Public media must be active, public, inline, and have granted or not-required consent.",409);
  }
  return {dossier,media};
}

async function archiveMaterialsAdminApi(request,env,materialId=""){
  const database=db(env);
  if(request.method==="GET"&&!materialId){const url=new URL(request.url),entityId=text(url.searchParams.get("entity_id")||url.searchParams.get("entityId"),200);const where=entityId?"WHERE am.dossier_entity_id=?":"";const statement=database.prepare(`SELECT am.*,m.original_filename,m.mime_type,m.byte_size,m.duration_seconds,m.source_url,m.storage_key,
      m.alt_text,m.caption media_caption,m.privacy media_privacy,m.consent_status,m.state media_state,
      m.transcript,m.transcript_status,m.transcript_language,m.public_title,m.public_description,m.public_presentation
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id ${where}
      ORDER BY am.dossier_entity_id,am.sort_order,am.created_at`);const result=entityId?await statement.bind(entityId).all():await statement.all();return json({records:result.results||[],materials:result.results||[],count:(result.results||[]).length});}
  if(request.method==="POST"&&materialId==="reorder"){const body=await readJson(request);const entityId=text(body?.entity_id||body?.entityId,200),ids=body?.ids;if(!entityId||!Array.isArray(ids))return failure("entity_id and ids are required.");const current=(await database.prepare("SELECT id FROM archive_materials WHERE dossier_entity_id=? ORDER BY sort_order,id").bind(entityId).all()).results||[];const set=new Set(ids);if(ids.length!==current.length||set.size!==current.length||current.some(row=>!set.has(row.id)))return failure("The material list changed. Refresh before reordering.",409);await database.batch(ids.map((recordId,index)=>database.prepare("UPDATE archive_materials SET sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=? AND dossier_entity_id=?").bind(index+1,recordId,entityId)));return json({ok:true});}
  if(request.method==="POST"&&!materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const material=normalizeArchiveMaterial(body);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;const materialIdNew=text(body.id,200)||id("archive-material");await database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))`).bind(materialIdNew,material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,"studio").run();return json({record:await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialIdNew).first()},{status:201});}
  if(request.method==="PATCH"&&materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialId).first();if(!before)return failure("Material not found.",404);const material=normalizeArchiveMaterial(body,before);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;await database.prepare(`UPDATE archive_materials SET dossier_entity_id=?,media_id=?,role=?,material_type=?,title=?,caption=?,body=?,process_phase=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,visibility=?,state=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,materialId).run();return json({record:await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialId).first()});}
  if(request.method==="DELETE"&&materialId){const before=await database.prepare("SELECT id FROM archive_materials WHERE id=?").bind(materialId).first();if(!before)return failure("Material not found.",404);await database.prepare("UPDATE archive_materials SET state='archived',visibility='internal',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(materialId).run();return json({ok:true,archived:true});}
  return failure("Method not allowed.",405);
}

function normalizeArchiveActivity(body,existing={}){const occurredAt=text(body.occurred_at??body.start_date??body.start??existing.occurred_at,80)||null,endedAt=text(body.ended_at??body.end_date??body.end??existing.ended_at,80)||null;return {entity_id:text(body.entity_id??body.entityId??existing.entity_id,200),activity_type:text(body.activity_type??body.activityType??existing.activity_type,100)||"milestone",title:text(body.title??existing.title,300),notes:text(body.notes??existing.notes,8000),summary:text(body.summary??existing.summary,5000),body:text(body.body??body.inline_text??body.inlineText??existing.body,50000),occurred_at:occurredAt,ended_at:endedAt,place_entity_id:text(body.place_entity_id??body.placeEntityId??existing.place_entity_id,200)||null,public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):truthy(body.public_visible??body.publicVisible)?1:0,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||(occurredAt?"exact":"undated"),date_label:text(body.date_label??body.display_date??body.displayDate??existing.date_label,160),source_note:text(body.source_note??body.sourceNote??existing.source_note,3000)};}
function archiveActivitySubjects(body){const raw=body.subject_entity_ids??body.subjectEntityIds??body.subject_ids??body.subjects;if(raw===undefined)return null;if(!Array.isArray(raw))return [];return [...new Set(raw.map(value=>text(typeof value==="object"?value.entity_id||value.id:value,200)).filter(Boolean))];}

async function archiveActivitiesAdminApi(request,env,activityId=""){
  const database=db(env);
  if(request.method==="GET"&&!activityId){const url=new URL(request.url),entityId=text(url.searchParams.get("entity_id")||url.searchParams.get("entityId"),200);const where=entityId?"WHERE ea.entity_id=?":"";const statement=database.prepare(`SELECT ea.* FROM entity_activity ea ${where} ORDER BY CASE WHEN ea.occurred_at IS NULL THEN 1 ELSE 0 END,ea.occurred_at,ea.sort_order,ea.created_at`);const result=entityId?await statement.bind(entityId).all():await statement.all();const records=result.results||[];if(records.length){const ids=records.map(row=>row.id),subjects=(await database.prepare(`SELECT activity_id,subject_entity_id FROM entity_activity_subjects WHERE activity_id IN (${ids.map(()=>"?").join(",")}) ORDER BY sort_order`).bind(...ids).all()).results||[];for(const record of records)record.subject_entity_ids=subjects.filter(subject=>subject.activity_id===record.id).map(subject=>subject.subject_entity_id)}return json({records,activities:records,count:records.length});}
  if(request.method==="POST"&&!activityId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const activity=normalizeArchiveActivity(body),subjects=archiveActivitySubjects(body)||[];if(!activity.entity_id||!activity.title)return failure("entity_id and title are required.");if(!ARCHIVE_DATE_PRECISIONS.has(activity.date_precision))return failure("Invalid date precision.");const owner=await database.prepare("SELECT ce.visibility,ad.state dossier_state,ad.public_visible dossier_public FROM content_entities ce LEFT JOIN archive_dossiers ad ON ad.entity_id=ce.id WHERE ce.id=?").bind(activity.entity_id).first();if(!owner)return failure("Canonical entity not found.",404);if(activity.public_visible&&(owner.visibility!=="public"||owner.dossier_state!=="published"||!Number(owner.dossier_public)))return failure("Publish the canonical entity and dossier before publishing this activity.",409);const newId=text(body.id,200)||id("archive-activity");const statements=[database.prepare(`INSERT INTO entity_activity(id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note) VALUES(?,?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'),?,?,?,?,?)`).bind(newId,activity.entity_id,activity.activity_type,activity.title,activity.notes,activity.occurred_at,activity.ended_at,activity.place_entity_id,activity.public_visible,activity.sort_order,activity.summary,activity.body,activity.date_precision,activity.date_label,activity.source_note),...subjects.map((subject,index)=>database.prepare("INSERT INTO entity_activity_subjects(activity_id,subject_entity_id,public_visible,sort_order,created_at) VALUES(?,?,?,?,datetime('now'))").bind(newId,subject,activity.public_visible?1:0,index+1))];await database.batch(statements);return json({record:await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(newId).first()},{status:201});}
  if(request.method==="PATCH"&&activityId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(activityId).first();if(!before)return failure("Activity not found.",404);const activity=normalizeArchiveActivity(body,before),subjects=archiveActivitySubjects(body);if(!activity.title||!ARCHIVE_DATE_PRECISIONS.has(activity.date_precision))return failure("A title and valid date precision are required.");const owner=await database.prepare("SELECT ce.visibility,ad.state dossier_state,ad.public_visible dossier_public FROM content_entities ce LEFT JOIN archive_dossiers ad ON ad.entity_id=ce.id WHERE ce.id=?").bind(activity.entity_id).first();if(activity.public_visible&&(owner?.visibility!=="public"||owner?.dossier_state!=="published"||!Number(owner?.dossier_public)))return failure("Publish the canonical entity and dossier before publishing this activity.",409);const statements=[database.prepare(`UPDATE entity_activity SET entity_id=?,activity_type=?,title=?,notes=?,occurred_at=?,ended_at=?,place_entity_id=?,public_visible=?,sort_order=?,updated_at=datetime('now'),summary=?,body=?,date_precision=?,date_label=?,source_note=? WHERE id=?`).bind(activity.entity_id,activity.activity_type,activity.title,activity.notes,activity.occurred_at,activity.ended_at,activity.place_entity_id,activity.public_visible,activity.sort_order,activity.summary,activity.body,activity.date_precision,activity.date_label,activity.source_note,activityId)];if(subjects!==null){statements.push(database.prepare("DELETE FROM entity_activity_subjects WHERE activity_id=?").bind(activityId),...subjects.map((subject,index)=>database.prepare("INSERT INTO entity_activity_subjects(activity_id,subject_entity_id,public_visible,sort_order,created_at) VALUES(?,?,?,?,datetime('now'))").bind(activityId,subject,activity.public_visible?1:0,index+1)))}else{statements.push(database.prepare("UPDATE entity_activity_subjects SET public_visible=? WHERE activity_id=?").bind(activity.public_visible?1:0,activityId))}await database.batch(statements);return json({record:await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(activityId).first()});}
  if(request.method==="DELETE"&&activityId){const found=await database.prepare("SELECT id FROM entity_activity WHERE id=?").bind(activityId).first();if(!found)return failure("Activity not found.",404);await database.batch([database.prepare("UPDATE entity_activity SET public_visible=0,updated_at=datetime('now') WHERE id=?").bind(activityId),database.prepare("UPDATE entity_activity_subjects SET public_visible=0 WHERE activity_id=?").bind(activityId)]);return json({ok:true,archived:true});}
  return failure("Method not allowed.",405);
}

function normalizeArchiveTimeline(body,existing={}){return {subject_entity_id:text(body.subject_entity_id??body.subjectEntityId??existing.subject_entity_id,200),slug:slug(body.slug??existing.slug),title:text(body.title??existing.title,300),description:text(body.description??existing.description,8000),state:text(body.state??existing.state,30)||"draft",public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):truthy(body.public_visible??body.publicVisible)?1:0,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}
function normalizeArchiveChapter(body,existing={}){const occurredAt=text(body.occurred_at??body.start_date??body.start??existing.occurred_at,80)||null;return {title:text(body.title??existing.title,300),summary:text(body.summary??existing.summary,5000),body:text(body.body??body.inline_text??body.inlineText??existing.body,50000),occurred_at:occurredAt,ended_at:text(body.ended_at??body.end_date??body.end??existing.ended_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||(occurredAt?"exact":"undated"),date_label:text(body.date_label??body.display_date??body.displayDate??existing.date_label,160),anchor_slug:slug(body.anchor_slug??body.anchor??existing.anchor_slug),dedupe_key:text(body.dedupe_key??body.dedupeKey??existing.dedupe_key,200),state:text(body.state??existing.state,30)||"draft",public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):truthy(body.public_visible??body.publicVisible)?1:0,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}

async function archiveTimelinesAdminApi(request,env,timelineId="",chapterId=""){
  const database=db(env);
  if(chapterId){const before=await database.prepare("SELECT * FROM archive_timeline_chapters WHERE id=? AND timeline_id=?").bind(chapterId,timelineId).first();if(!before)return failure("Timeline chapter not found.",404);if(request.method==="PATCH"){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const chapter=normalizeArchiveChapter(body,before);if(!chapter.title||!ARCHIVE_DATE_PRECISIONS.has(chapter.date_precision)||!ARCHIVE_TIMELINE_STATES.has(chapter.state))return failure("Invalid timeline chapter.");await database.prepare(`UPDATE archive_timeline_chapters SET title=?,summary=?,body=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,anchor_slug=?,dedupe_key=?,state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=? AND timeline_id=?`).bind(chapter.title,chapter.summary,chapter.body,chapter.occurred_at,chapter.ended_at,chapter.date_precision,chapter.date_label,chapter.anchor_slug,chapter.dedupe_key,chapter.state,chapter.public_visible,chapter.sort_order,chapterId,timelineId).run();return json({record:await database.prepare("SELECT * FROM archive_timeline_chapters WHERE id=?").bind(chapterId).first()});}if(request.method==="DELETE"){await database.prepare("UPDATE archive_timeline_chapters SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE id=? AND timeline_id=?").bind(chapterId,timelineId).run();return json({ok:true,archived:true});}return failure("Method not allowed.",405);}
  const chapterRoute=/\/chapters$/.test(new URL(request.url).pathname);
  if(chapterRoute&&timelineId&&request.method==="POST"){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const timeline=await database.prepare("SELECT id FROM archive_timelines WHERE id=?").bind(timelineId).first();if(!timeline)return failure("Timeline not found.",404);const chapter=normalizeArchiveChapter(body);if(!chapter.title||!ARCHIVE_DATE_PRECISIONS.has(chapter.date_precision)||!ARCHIVE_TIMELINE_STATES.has(chapter.state))return failure("Invalid timeline chapter.");const newId=text(body.id,200)||id("archive-chapter");await database.prepare(`INSERT INTO archive_timeline_chapters(id,timeline_id,title,summary,body,occurred_at,ended_at,date_precision,date_label,anchor_slug,dedupe_key,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,timelineId,chapter.title,chapter.summary,chapter.body,chapter.occurred_at,chapter.ended_at,chapter.date_precision,chapter.date_label,chapter.anchor_slug,chapter.dedupe_key,chapter.state,chapter.public_visible,chapter.sort_order).run();return json({record:await database.prepare("SELECT * FROM archive_timeline_chapters WHERE id=?").bind(newId).first()},{status:201});}
  if(request.method==="GET"){const timelineIdFilter=timelineId?"WHERE at.id=?":"";const statement=database.prepare(`SELECT at.*,ce.entity_type,COALESCE(o.name,p.name,n.name,ce.id) subject_name FROM archive_timelines at JOIN content_entities ce ON ce.id=at.subject_entity_id LEFT JOIN organizations o ON o.id=ce.id LEFT JOIN people p ON p.id=ce.id LEFT JOIN construct_nodes n ON n.id=ce.id ${timelineIdFilter} ORDER BY at.sort_order,at.title`);const result=timelineId?await statement.bind(timelineId).all():await statement.all();const records=result.results||[];if(timelineId&&!records[0])return failure("Timeline not found.",404);if(timelineId){const chapters=(await database.prepare("SELECT * FROM archive_timeline_chapters WHERE timeline_id=? ORDER BY occurred_at,sort_order,created_at").bind(timelineId).all()).results||[];return json({record:records[0],timeline:records[0],chapters});}return json({records,count:records.length});}
  if(request.method==="POST"&&!timelineId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const timeline=normalizeArchiveTimeline(body);if(!timeline.subject_entity_id||!timeline.slug||!timeline.title||!ARCHIVE_TIMELINE_STATES.has(timeline.state))return failure("subject_entity_id, slug, title, and a valid state are required.");const subject=await database.prepare("SELECT visibility FROM content_entities WHERE id=?").bind(timeline.subject_entity_id).first();if(!subject)return failure("Timeline subject not found.",404);if(timeline.state==="published"&&timeline.public_visible&&subject.visibility!=="public")return failure("The timeline subject must be public before publishing.",409);const newId=text(body.id,200)||id("archive-timeline");await database.prepare(`INSERT INTO archive_timelines(id,subject_entity_id,slug,title,description,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'studio','studio',datetime('now'),datetime('now'))`).bind(newId,timeline.subject_entity_id,timeline.slug,timeline.title,timeline.description,timeline.state,timeline.public_visible,timeline.sort_order).run();return json({record:await database.prepare("SELECT * FROM archive_timelines WHERE id=?").bind(newId).first()},{status:201});}
  if(request.method==="PATCH"&&timelineId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_timelines WHERE id=?").bind(timelineId).first();if(!before)return failure("Timeline not found.",404);const timeline=normalizeArchiveTimeline(body,before);if(!timeline.subject_entity_id||!timeline.slug||!timeline.title||!ARCHIVE_TIMELINE_STATES.has(timeline.state))return failure("Invalid timeline.");const subject=await database.prepare("SELECT visibility FROM content_entities WHERE id=?").bind(timeline.subject_entity_id).first();if(!subject)return failure("Timeline subject not found.",404);if(timeline.state==="published"&&timeline.public_visible&&subject.visibility!=="public")return failure("The timeline subject must be public before publishing.",409);await database.prepare(`UPDATE archive_timelines SET subject_entity_id=?,slug=?,title=?,description=?,state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(timeline.subject_entity_id,timeline.slug,timeline.title,timeline.description,timeline.state,timeline.public_visible,timeline.sort_order,timelineId).run();return json({record:await database.prepare("SELECT * FROM archive_timelines WHERE id=?").bind(timelineId).first()});}
  if(request.method==="DELETE"&&timelineId){await database.prepare("UPDATE archive_timelines SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(timelineId).run();return json({ok:true});}
  return failure("Method not allowed.",405);
}

async function eventArchive(request,env,eventId){const database=db(env);const existing=await database.prepare("SELECT * FROM archive_records WHERE source_event_id=?").bind(eventId).first();if(existing)return json({record:existing,created:false});const event=await database.prepare("SELECT id,slug,title,description,starts_at,ends_at,location,status FROM events WHERE id=?").bind(eventId).first();if(!event)return failure("Event not found.",404);const attendance=await database.prepare("SELECT COALESCE(SUM(seats),0) total FROM event_tickets WHERE event_id=? AND status='paid'").bind(eventId).first();const recordId=`archive-event-${event.id}`;await database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_record','archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId).run();await database.prepare("INSERT INTO archive_records(id,slug,source_event_id,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,aggregate_attendance,created_at,updated_at) VALUES(?,?,?,?,?,'event','Events',?,?,?,?,'event handoff','draft',?,datetime('now'),datetime('now'))").bind(recordId,`event-${event.slug}`,event.id,event.title,'The Six.Well Construct',event.starts_at||'',event.starts_at||'',event.description||'',event.description||'',Number(attendance?.total||0)).run();const record=await database.prepare("SELECT * FROM archive_records WHERE id=?").bind(recordId).first();await nextRevision(database,recordId,"event-archive-handoff",null,record);return json({record,created:true},{status:201});}

export async function handleConstructApi(request,env){
  const url=new URL(request.url);const path=url.pathname;
  if(path==="/api/site/navigation")return publicNavigation(env);
  if(path==="/api/search")return publicSearch(request,env);
  if(path==="/api/archive/items")return publicArchiveItems(request,env);
  const archiveItemMatch=path.match(/^\/api\/archive\/items\/([^/]+)$/);if(archiveItemMatch)return publicArchiveDetail(request,env,decodeURIComponent(archiveItemMatch[1]));
  const archiveTimelinePublicMatch=path.match(/^\/api\/archive\/timelines\/([^/]+)$/);if(archiveTimelinePublicMatch)return publicArchiveTimeline(request,env,decodeURIComponent(archiveTimelinePublicMatch[1]));
  const connectionsMatch=path.match(/^\/api\/connections\/([^/]+)$/);if(connectionsMatch&&request.method==="GET")return publicConnections(env,decodeURIComponent(connectionsMatch[1]));
  const mediaPublic=path.match(/^\/api\/construct\/media\/([^/]+)$/);if(mediaPublic)return publicMediaApi(request,env,decodeURIComponent(mediaPublic[1]));
  const entityMediaPublic=path.match(/^\/api\/construct\/entity-media\/([^/]+)$/);if(entityMediaPublic)return publicEntityMediaApi(request,env,decodeURIComponent(entityMediaPublic[1]));
  if(path==="/api/legend/categories")return publicLegendCategories(env);
  const publicMatch=path.match(/^\/api\/(flash|legend|visual-language|art|archive|archive-collections)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,canonicalResource(publicMatch[1]),publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const legendCategoryMatch=path.match(/^\/api\/admin\/legend\/categories(?:\/([^/]+))?$/);if(legendCategoryMatch)return legendCategoryApi(request,env,legendCategoryMatch[1]?decodeURIComponent(legendCategoryMatch[1]):"");
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  const mediaFileMatch=path.match(/^\/api\/admin\/media\/([^/]+)\/file$/);if(mediaFileMatch)return adminMediaFileApi(request,env,decodeURIComponent(mediaFileMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  const dossierMatch=path.match(/^\/api\/admin\/archive-dossiers(?:\/([^/]+))?$/);if(dossierMatch)return archiveDossiersAdminApi(request,env,dossierMatch[1]?decodeURIComponent(dossierMatch[1]):"");
  const materialMatch=path.match(/^\/api\/admin\/archive-materials(?:\/([^/]+))?$/);if(materialMatch)return archiveMaterialsAdminApi(request,env,materialMatch[1]?decodeURIComponent(materialMatch[1]):"");
  const activityMatch=path.match(/^\/api\/admin\/archive-activities(?:\/([^/]+))?$/);if(activityMatch)return archiveActivitiesAdminApi(request,env,activityMatch[1]?decodeURIComponent(activityMatch[1]):"");
  const timelineChapterMatch=path.match(/^\/api\/admin\/archive-timelines\/([^/]+)\/chapters\/([^/]+)$/);if(timelineChapterMatch)return archiveTimelinesAdminApi(request,env,decodeURIComponent(timelineChapterMatch[1]),decodeURIComponent(timelineChapterMatch[2]));
  const timelineChaptersMatch=path.match(/^\/api\/admin\/archive-timelines\/([^/]+)\/chapters$/);if(timelineChaptersMatch)return archiveTimelinesAdminApi(request,env,decodeURIComponent(timelineChaptersMatch[1]),"");
  const timelineMatch=path.match(/^\/api\/admin\/archive-timelines(?:\/([^/]+))?$/);if(timelineMatch)return archiveTimelinesAdminApi(request,env,timelineMatch[1]?decodeURIComponent(timelineMatch[1]):"");
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
