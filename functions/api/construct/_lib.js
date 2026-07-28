import { db, entityMedia, failure, id, json, nextRevision, parseJson, readJson, requireStudioAdmin, RESOURCE_CONFIG, slug, text } from "../_shared/construct.js";
import {
  loadTattooStyleAssignments,
  replaceTattooStyleAssignmentStatements,
  resolveTattooStyleSelection,
  tattooStylePayload,
  TattooStyleValidationError,
} from "../_shared/tattoo-styles.js";
import { serveR2Media } from "../_shared/r2-media.js";

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
      href: safeLegendUrl(entry?.href),
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
  if ("build_guidance_json" in out) {
    const value = legendObject(out.build_guidance_json, "Build guidance");
    const emotionalTones = legendArray(value.emotional_tones ?? value.emotionalTones ?? [], "Emotional tones")
      .slice(0, 12)
      .map((tone) => text(tone, 80))
      .filter(Boolean);
    const reflectionQuestions = legendArray(value.reflection_questions ?? value.reflectionQuestions ?? [], "Reflection questions")
      .slice(0, 8)
      .map((question) => text(question, 500))
      .filter(Boolean);
    out.build_guidance_json = JSON.stringify({
      essence: text(value.essence, 500),
      emotional_tones: [...new Set(emotionalTones)],
      reflection_questions: [...new Set(reflectionQuestions)],
    });
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
  if (out.print_intent && !["unavailable","planned"].includes(out.print_intent)) throw new Error("Invalid print plan.");
  const merged = { ...existing, ...out };
  for (const [minimum,maximum,label] of [["estimated_sessions_min","estimated_sessions_max","session count"],["estimated_total_minutes_min","estimated_total_minutes_max","total time"]]) {
    if (merged[minimum] !== null && merged[maximum] !== null && Number(merged[minimum]) > Number(merged[maximum])) throw new Error(`Minimum ${label} cannot exceed maximum.`);
  }
  if (config.entityType === "flash_item") {
    const sessionCategory = merged.session_category || "artist_review";
    const splitPolicy = merged.split_policy || "artist_review";
    if (splitPolicy === "required" && sessionCategory !== "multiple_sessions") throw new Error("Required splitting must use the multiple-sessions category.");
    if (splitPolicy === "not_available" && sessionCategory !== "one_session") throw new Error("Splitting unavailable must use the one-session category.");
    if (sessionCategory === "one_session") {
      out.estimated_sessions_min = 1;
      out.estimated_sessions_max = 1;
    }
    if (sessionCategory === "multiple_sessions" && Number(merged.estimated_sessions_min) < 2) throw new Error("Multiple-session flash requires a minimum of at least two sessions.");
    if (sessionCategory !== "artist_review" && (!Number(merged.estimated_sessions_max) || Number(merged.estimated_sessions_max) < Number(merged.estimated_sessions_min))) throw new Error("Enter a valid maximum session count.");
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

async function loadFlashSheetDesigns(database, flashItemIds, { admin = false } = {}) {
  if (!flashItemIds.length) return new Map();
  const placeholders = flashItemIds.map(() => "?").join(",");
  const visibility = admin ? "" : "AND state <> 'draft'";
  const rows = (await database.prepare(
    `SELECT id,flash_item_id,code,label,state,reserved_submission_id,sort_order,created_at,updated_at
     FROM flash_sheet_designs
     WHERE flash_item_id IN (${placeholders}) ${visibility}
     ORDER BY flash_item_id,sort_order,code`
  ).bind(...flashItemIds).all()).results || [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.flash_item_id)) map.set(row.flash_item_id, []);
    const design = {
      id: row.id,
      code: row.code,
      label: row.label,
      state: row.state,
      sortOrder: Number(row.sort_order) || 0,
      sort_order: Number(row.sort_order) || 0,
      claimableNow: row.state === "available" && !row.reserved_submission_id,
      claimable_now: row.state === "available" && !row.reserved_submission_id,
    };
    if (admin) design.reservedSubmissionId = row.reserved_submission_id || "";
    map.get(row.flash_item_id).push(design);
  }
  return map;
}

function legendCanonicalRoute(value) {
  return `/about/legend/${encodeURIComponent(String(value || ""))}/`;
}

function artCanonicalRoute(row = {}) {
  return row.legacy_path || `/art/${encodeURIComponent(String(row.slug || row.id || ""))}/`;
}

const ART_RESERVED_SLUGS = new Set(["acquisitioninquiry", "detail", "index"]);

async function publicCatalog(request, env, resource, recordSlug = "") {
  const config = RESOURCE_CONFIG[resource];
  if (!config) return failure("Unknown catalog.", 404);
  const database = db(env);
  const acquisitionOnly = resource === "art" && new URL(request.url).searchParams.get("acquisition") === "1";
  const baseWhere = `${publicState(resource)}${acquisitionOnly ? " AND acquisition_eligible=1 AND availability='available'" : ""}`;
  const isFlashRecord = resource === "flash" && Boolean(recordSlug);
  const isLegendRecord = config.entityType === "visual_symbol" && Boolean(recordSlug);
  const where = isFlashRecord
    ? `${baseWhere} AND (id=? OR slug=? OR legacy_path=? OR legacy_path=?)`
    : isLegendRecord
      ? `${baseWhere} AND (slug=? OR id=?)`
    : recordSlug
      ? `${baseWhere} AND slug=?`
      : baseWhere;
  const statement = database.prepare(`SELECT * FROM ${config.table} WHERE ${where} ORDER BY sort_order,id`);
  const legacyPath = `/tattoos/flash/${String(recordSlug).replace(/^\/+|\/+$/g, "")}/`;
  const result = isFlashRecord
    ? await statement.bind(recordSlug, recordSlug, recordSlug, legacyPath).all()
    : isLegendRecord
      ? await statement.bind(recordSlug, recordSlug).all()
    : recordSlug
      ? await statement.bind(recordSlug).all()
      : await statement.all();
  const rows = result.results || [];
  const entityIds = rows.map((row) => row.id);
  const [media, tattooStyles, flashSheetDesigns] = await Promise.all([
    entityMedia(database, entityIds),
    resource === "flash" ? loadTattooStyleAssignments(database, entityIds) : Promise.resolve(new Map()),
    resource === "flash" ? loadFlashSheetDesigns(database, entityIds) : Promise.resolve(new Map()),
  ]);
  const records = rows.map((row) => {
    const { reserved_submission_id: _reservationOwner, ...publicRow } = row;
    const stylePayload = resource === "flash"
      ? tattooStylePayload(tattooStyles.get(row.id), { fallbackValue: "unclassified", fallbackLabel: "Unclassified" })
      : {};
    const record = {
      ...publicRow,
      ...stylePayload,
      themes: parseJson(row.themes_json),
      context: parseJson(row.context_json, {}),
      applications: parseJson(row.applications_json),
      variants: parseJson(row.variants_json),
      examples: parseJson(row.examples_json),
      buildGuidance: (() => {
        const guidance = parseJson(row.build_guidance_json, {});
        return {
          essence: text(guidance.essence, 500),
          emotionalTones: Array.isArray(guidance.emotional_tones) ? guidance.emotional_tones : [],
          reflectionQuestions: Array.isArray(guidance.reflection_questions) ? guidance.reflection_questions : [],
        };
      })(),
      media: media.get(row.id) || [],
    };
    if (config.entityType === "visual_symbol") {
      const canonicalRoute = legendCanonicalRoute(row.slug || row.id);
      return {
        ...record,
        canonicalRoute,
        canonical_route: canonicalRoute,
      };
    }
    if (resource === "art") {
      const canonicalRoute = artCanonicalRoute(row);
      return {
        ...record,
        canonicalRoute,
        canonical_route: canonicalRoute,
      };
    }
    if (resource !== "flash") return record;
    const canonicalRoute = `/tattoos/flash/${encodeURIComponent(row.slug || row.id)}/`;
    const sheetDesigns = flashSheetDesigns.get(row.id) || [];
    const publicSheetDesigns = sheetDesigns.map((design) => ({
      ...design,
      claimableNow: row.state === "available" && design.claimableNow,
      claimable_now: row.state === "available" && design.claimableNow,
    }));
    const managedSheet = row.item_type === "sheet" && publicSheetDesigns.length > 0;
    const claimableNow = managedSheet
      ? publicSheetDesigns.some((design) => design.claimableNow)
      : row.state === "available" && Number(row.claimable) === 1 && !row.reserved_submission_id;
    return {
      ...record,
      claimable: claimableNow ? 1 : 0,
      sheetDesigns: publicSheetDesigns,
      sheet_designs: publicSheetDesigns,
      managedSheet,
      managed_sheet: managedSheet,
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
  if (isLegendRecord) {
    const record = records[0];
    const [category, orderedResult] = await Promise.all([
      database.prepare(
        "SELECT id,name,slug,description,state,sort_order,updated_at FROM visual_symbol_categories WHERE id=? AND state='published'",
      ).bind(record.category_id).first(),
      database.prepare(
        "SELECT id,slug,name,sort_order FROM visual_symbols WHERE state='published' ORDER BY sort_order,id",
      ).all(),
    ]);
    const ordered = orderedResult.results || [];
    const currentIndex = ordered.findIndex((entry) => entry.id === record.id);
    const navigationRecord = (entry) => entry ? {
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      canonicalRoute: legendCanonicalRoute(entry.slug || entry.id),
    } : null;
    return json({
      record,
      category: category || null,
      navigation: {
        previous: currentIndex > 0 ? navigationRecord(ordered[currentIndex - 1]) : null,
        next: currentIndex >= 0 && currentIndex < ordered.length - 1
          ? navigationRecord(ordered[currentIndex + 1])
          : null,
      },
    });
  }
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

function compositionRuleRecord(row, members = []) {
  return {
    id: row.id,
    type: row.rule_type,
    interpretation: row.interpretation,
    state: row.state,
    sortOrder: Number(row.sort_order) || 0,
    symbolIds: members.map((member) => member.symbol_id),
    symbols: members.map((member) => ({
      id: member.symbol_id,
      slug: member.symbol_slug,
      name: member.symbol_name,
      meaning: member.symbol_meaning,
      themes: parseJson(member.symbol_themes_json),
      state: member.symbol_state,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadCompositionRules(database, { publicOnly = false } = {}) {
  const rows = (await database.prepare(
    `SELECT r.*,m.symbol_id,m.member_order,
            s.slug symbol_slug,s.name symbol_name,s.meaning symbol_meaning,
            s.themes_json symbol_themes_json,s.state symbol_state
     FROM visual_symbol_composition_rules r
     JOIN visual_symbol_composition_rule_members m ON m.rule_id=r.id
     JOIN visual_symbols s ON s.id=m.symbol_id
     ${publicOnly ? "WHERE r.state='published'" : ""}
     ORDER BY r.sort_order,r.id,m.member_order`
  ).all()).results || [];
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.id)) grouped.set(row.id, { row, members: [] });
    grouped.get(row.id).members.push(row);
  }
  return [...grouped.values()]
    .map(({ row, members }) => compositionRuleRecord(row, members))
    .filter((rule) => !publicOnly || (rule.symbolIds.length >= 2 && rule.symbols.every((symbol) => symbol.state === "published")));
}

async function publicCompositionRules(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const records = await loadCompositionRules(db(env), { publicOnly: true });
  return json({ records, count: records.length });
}

async function normalizeCompositionRule(database, body = {}, existing = {}) {
  const type = text(body.type ?? body.rule_type ?? existing.rule_type, 40).toLowerCase();
  const interpretation = text(body.interpretation ?? existing.interpretation, 5000);
  const state = text(body.state ?? existing.state ?? "draft", 40).toLowerCase();
  const sortOrder = Number(body.sortOrder ?? body.sort_order ?? existing.sort_order) || 0;
  const requestedIds = body.symbolIds ?? body.symbol_ids;
  const rawSymbolIds = Array.isArray(requestedIds)
    ? requestedIds.map((value) => text(value, 200)).filter(Boolean)
    : null;
  if (rawSymbolIds && new Set(rawSymbolIds).size !== rawSymbolIds.length) {
    throw new Error("Composition-rule members must be unique.");
  }
  const symbolIds = rawSymbolIds
    ? rawSymbolIds
    : Array.isArray(existing.symbolIds)
      ? existing.symbolIds
      : [];
  if (!["reading", "tension"].includes(type)) throw new Error("Choose reading or tension.");
  if (!["draft", "published", "retired"].includes(state)) throw new Error("Choose draft, published, or retired.");
  if (!interpretation) throw new Error("Author an approved interpretation.");
  if (symbolIds.length < 2 || symbolIds.length > 12) throw new Error("Composition rules require between 2 and 12 unique symbols.");
  const placeholders = symbolIds.map(() => "?").join(",");
  const symbols = (await database.prepare(
    `SELECT id,state FROM visual_symbols WHERE id IN (${placeholders})`
  ).bind(...symbolIds).all()).results || [];
  if (symbols.length !== symbolIds.length) throw new Error("Every composition-rule member must be a managed Legend symbol.");
  if (state === "published" && symbols.some((symbol) => symbol.state !== "published")) {
    throw new Error("Publish every participating symbol before publishing this composition rule.");
  }
  return {
    type,
    interpretation,
    state,
    sortOrder,
    symbolIds,
    symbolSetKey: [...symbolIds].sort().join("|"),
  };
}

async function adminCompositionRules(request, env, ruleId = "") {
  const database = db(env);
  if (request.method === "GET" && !ruleId) {
    const records = await loadCompositionRules(database);
    return json({ records, count: records.length });
  }
  if (request.method === "POST" && !ruleId) {
    const body = await readJson(request);
    if (!body) return failure("Send a JSON object.");
    try {
      const rule = await normalizeCompositionRule(database, body);
      const newId = text(body.id, 200) || id("legend-composition");
      const now = new Date().toISOString();
      await database.batch([
        database.prepare(
          `INSERT INTO visual_symbol_composition_rules
           (id,rule_type,interpretation,symbol_set_key,state,sort_order,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?)`
        ).bind(newId, rule.type, rule.interpretation, rule.symbolSetKey, rule.state, rule.sortOrder, now, now),
        ...rule.symbolIds.map((symbolId, index) => database.prepare(
          "INSERT INTO visual_symbol_composition_rule_members(rule_id,symbol_id,member_order) VALUES(?,?,?)"
        ).bind(newId, symbolId, index)),
      ]);
      const records = await loadCompositionRules(database);
      return json({ record: records.find((record) => record.id === newId) }, { status: 201 });
    } catch (error) {
      const duplicate = /UNIQUE constraint failed/i.test(error.message);
      return failure(duplicate ? "An active rule already exists for this symbol set and rule type." : error.message, duplicate ? 409 : 400);
    }
  }
  const existingRow = ruleId
    ? await database.prepare("SELECT * FROM visual_symbol_composition_rules WHERE id=?").bind(ruleId).first()
    : null;
  if (!existingRow) return failure("Composition rule not found.", 404);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    if (!body) return failure("Send a JSON object.");
    const currentRecords = await loadCompositionRules(database);
    const existing = currentRecords.find((record) => record.id === ruleId);
    try {
      const rule = await normalizeCompositionRule(database, body, {
        ...existingRow,
        symbolIds: existing?.symbolIds || [],
      });
      const now = new Date().toISOString();
      await database.batch([
        database.prepare(
          `UPDATE visual_symbol_composition_rules
           SET rule_type=?,interpretation=?,symbol_set_key=?,state=?,sort_order=?,updated_at=?
           WHERE id=?`
        ).bind(rule.type, rule.interpretation, rule.symbolSetKey, rule.state, rule.sortOrder, now, ruleId),
        database.prepare("DELETE FROM visual_symbol_composition_rule_members WHERE rule_id=?").bind(ruleId),
        ...rule.symbolIds.map((symbolId, index) => database.prepare(
          "INSERT INTO visual_symbol_composition_rule_members(rule_id,symbol_id,member_order) VALUES(?,?,?)"
        ).bind(ruleId, symbolId, index)),
      ]);
      const records = await loadCompositionRules(database);
      return json({ record: records.find((record) => record.id === ruleId) });
    } catch (error) {
      const duplicate = /UNIQUE constraint failed/i.test(error.message);
      return failure(duplicate ? "An active rule already exists for this symbol set and rule type." : error.message, duplicate ? 409 : 400);
    }
  }
  if (request.method === "DELETE") {
    await database.prepare(
      "UPDATE visual_symbol_composition_rules SET state='retired',updated_at=? WHERE id=?"
    ).bind(new Date().toISOString(), ruleId).run();
    return json({ ok: true, retired: true });
  }
  return failure("Method not allowed.", 405);
}

const ARCHIVE_MATERIAL_TYPES = new Set(["final-image","sketch","process-photo","note","voice-memo","video","document","artifact"]);
const ARCHIVE_DATE_PRECISIONS = new Set(["exact","approximate","year","range","undated"]);
const ARCHIVE_VISIBILITIES = new Set(["public","unlisted","internal","private"]);
const ARCHIVE_STATES = new Set(["draft","published","archived"]);
const ARCHIVE_TIMELINE_STATES = new Set(["draft","published","archived"]);

function originThreadIds(value){
  const source=Array.isArray(value)?value:String(value||"").split(",");
  return [...new Set(source.map(item=>text(typeof item==="object"?(item.id||item.thread_id||item.threadId):item,200)).filter(Boolean))].slice(0,50);
}

async function validateOriginThreadIds(database,ids){
  if(!ids.length)return true;
  const rows=(await database.prepare(`SELECT id FROM archive_origin_threads WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all()).results||[];
  return rows.length===ids.length;
}

async function replaceDossierOriginThreads(database,entityId,ids,primaryId=""){
  if(primaryId&&!ids.includes(primaryId))throw new Error("The primary origin thread must also be assigned to this dossier.");
  if(!await validateOriginThreadIds(database,ids))throw new Error("Choose valid origin threads.");
  const statements=[database.prepare("DELETE FROM archive_origin_thread_dossiers WHERE dossier_entity_id=?").bind(entityId)];
  ids.forEach((threadId,index)=>statements.push(database.prepare("INSERT INTO archive_origin_thread_dossiers(thread_id,dossier_entity_id,is_primary,sort_order,created_at) VALUES(?,?,?,?,datetime('now'))").bind(threadId,entityId,threadId===primaryId?1:0,index+1)));
  await database.batch(statements);
}

async function replaceMaterialOriginThreads(database,materialId,ids){
  if(!await validateOriginThreadIds(database,ids))throw new Error("Choose valid origin threads.");
  const statements=[database.prepare("DELETE FROM archive_origin_thread_materials WHERE material_id=?").bind(materialId)];
  ids.forEach((threadId,index)=>statements.push(database.prepare("INSERT INTO archive_origin_thread_materials(thread_id,material_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(threadId,materialId,index+1)));
  await database.batch(statements);
}
const MEDIA_PRIVACIES = new Set(["public","unlisted","internal","private"]);
const MEDIA_CONSENT_STATUSES = new Set(["not-required","required","granted","denied","unknown"]);
const MEDIA_TRANSCRIPT_STATUSES = new Set(["not-requested","pending","ready","failed"]);
const MEDIA_PRESENTATIONS = new Set(["inline","hidden"]);
const RESUMABLE_VIDEO_MIMES = new Set(["video/mp4","video/webm"]);
const RESUMABLE_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const RESUMABLE_VIDEO_PART_BYTES = 32 * 1024 * 1024;

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
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/'||aw.slug||'/')
      WHEN 'merch_item' THEN mi.route
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'event' THEN '/events/'||ev.slug||'/'
      WHEN 'visual_symbol' THEN '/about/legend/'||vs.slug||'/'
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
        AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
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
  const origin=text(url.searchParams.get("origin"),160).toLowerCase();
  if(origin){
    conditions.push(`EXISTS (SELECT 1 FROM archive_origin_thread_dossiers otd JOIN archive_origin_threads ot ON ot.id=otd.thread_id WHERE otd.dossier_entity_id=${alias}.entity_id AND ot.slug=? AND ot.state='published' AND ot.public_visible=1)`);
    values.push(origin);
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
  const originSlug=text(url.searchParams.get("origin"),160).toLowerCase();
  const originThread=originSlug?await database.prepare("SELECT id,slug,title,summary,sort_order,updated_at FROM archive_origin_threads WHERE slug=? AND state='published' AND public_visible=1").bind(originSlug).first():null;
  if(originSlug&&!originThread)return failure("Origin thread not found.",404);
  const where = conditions.join(" AND ");
  const itemSql = `${archiveEntitySql(where)} ORDER BY ${originThread?"COALESCE((SELECT otd.sort_order FROM archive_origin_thread_dossiers otd WHERE otd.thread_id=? AND otd.dossier_entity_id=ad.entity_id),999999),":""}ad.featured DESC,ad.sort_order,ad.published_at DESC,ad.entity_id LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) total FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ${where}`;
  const [itemsResult,countResult,facetResult,materialFacetResult,collectionFacetResult] = await database.batch([
    database.prepare(itemSql).bind(...values,...(originThread?[originThread.id]:[]),limit,offset),
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
  let items=(itemsResult.results||[]).map(presentArchiveItem);const total=Number(countResult.results?.[0]?.total||0);
  let evidence=[],currentRecordPosition=null;
  if(originThread){
    const assignments=items.length?(await database.prepare(`SELECT dossier_entity_id,is_primary,sort_order FROM archive_origin_thread_dossiers WHERE thread_id=? AND dossier_entity_id IN (${items.map(()=>"?").join(",")})`).bind(originThread.id,...items.map(item=>item.entity_id)).all()).results||[]:[];
    const assignmentMap=new Map(assignments.map(row=>[row.dossier_entity_id,row]));
    const currentId=text(url.searchParams.get("from"),200);
    items=items.map(item=>{const assignment=assignmentMap.get(item.entity_id)||{},isCurrent=Boolean(currentId&&(currentId===item.entity_id||currentId===item.archive_slug));return {...item,origin_thread_role:Number(assignment.is_primary)?"primary":"supporting",origin_position:Number(assignment.sort_order||0),is_current:isCurrent}}).sort((a,b)=>a.origin_position-b.origin_position||a.title.localeCompare(b.title));
    const currentItem=items.find(item=>item.is_current);if(currentItem)currentRecordPosition=currentItem.origin_position;
    const evidenceRows=(await database.prepare(`SELECT am.*,otm.sort_order origin_sort_order,ad.archive_slug,
        COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END) media_url,
        m.mime_type,m.alt_text,m.public_title,m.public_description,m.transcript,m.transcript_status
      FROM archive_origin_thread_materials otm
      JOIN archive_materials am ON am.id=otm.material_id AND am.state='published' AND am.visibility='public'
      JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE otm.thread_id=? AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      ORDER BY CASE WHEN am.occurred_at IS NULL THEN 1 ELSE 0 END,am.occurred_at,otm.sort_order,am.sort_order,am.created_at`).bind(originThread.id).all()).results||[];
    evidence=evidenceRows.map((row,index)=>({...row,url:row.media_url||"",archive_route:`/archive/records/${encodeURIComponent(row.archive_slug)}/#material-${encodeURIComponent(row.id)}`,origin_position:index+1}));
  }
  const facets={medium:[],brand:[],person:[],era:[],collection:collectionFacetResult.results||[],record_type:[],material_type:materialFacetResult.results||[]};
  for(const facet of facetResult.results||[]){if(facets[facet.kind])facets[facet.kind].push({name:facet.name,slug:facet.slug,count:Number(facet.count||0)});}
  const pagination={page,limit,total,total_pages:Math.max(1,Math.ceil(total/limit)),totalPages:Math.max(1,Math.ceil(total/limit))};
  return json({items,records:items,facets,pagination,count:items.length,query:q,origin_thread:originThread,originThread,evidence,current_record_position:currentRecordPosition,currentRecordPosition},{cache:"public, max-age=30"});
}

async function publicArchiveDetail(request,env,archiveSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(archiveEntitySql("ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND (ad.archive_slug=? OR ad.entity_id=?)")).bind(archiveSlug,archiveSlug).first();
  if(!row)return failure("Archive item not found.",404);
  const item=presentArchiveItem(row),entityId=row.entity_id;
  const [materialsResult,activitiesResult,subjectsResult,collectionsResult,relationshipsResult,originThreadsResult]=await database.batch([
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
    database.prepare(`SELECT ot.id,ot.slug,ot.title,ot.summary,otd.is_primary,otd.sort_order
      FROM archive_origin_thread_dossiers otd JOIN archive_origin_threads ot ON ot.id=otd.thread_id
      WHERE otd.dossier_entity_id=? AND ot.state='published' AND ot.public_visible=1
      ORDER BY otd.is_primary DESC,otd.sort_order,ot.sort_order,ot.title`).bind(entityId),
  ]);
  const relationshipRows=relationshipsResult.results||[];
  const relatedIds=relationshipRows.map(r=>r.source_entity_id===entityId?r.target_entity_id:r.source_entity_id);
  const relatedMap=await entityRecords(database,relatedIds);
  const relatedDossiers=relatedIds.length?(await database.prepare(`SELECT entity_id,archive_slug FROM archive_dossiers WHERE state='published' AND public_visible=1 AND entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
  const relatedSlugs=new Map(relatedDossiers.map(d=>[d.entity_id,d.archive_slug]));
  const relationships=[];for(const relation of relationshipRows){const outgoing=relation.source_entity_id===entityId;const relatedId=outgoing?relation.target_entity_id:relation.source_entity_id;const related=relatedMap.get(relatedId);if(!related||related.visibility!=="public")continue;const archive_slug=relatedSlugs.get(relatedId)||"";relationships.push({id:relation.id,direction:outgoing?"outgoing":"incoming",label:outgoing?relation.forward_label:relation.reverse_label,relationship_type:relation.relationship_slug,related:{...related,imageUrl:"",archive_slug,archiveRoute:archive_slug?`/archive/records/${encodeURIComponent(archive_slug)}/`:""}});}
  const materials=(materialsResult.results||[]).map(material=>({...material,anchor:`material-${material.id}`,url:material.media_url||"",inline_text:material.body||""}));
  const activities=activitiesResult.results||[];
  const originThreads=originThreadsResult.results||[],primaryOriginThread=originThreads.find(thread=>Number(thread.is_primary))||null;
  return json({item,dossier:item,materials,activities,subjects:subjectsResult.results||[],collections:collectionsResult.results||[],relationships,origin_threads:originThreads,originThreads,primary_origin_thread:primaryOriginThread,primaryOriginThread},{cache:"public, max-age=30"});
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
  if (resource === "flash") {
    const styles = Array.isArray(row.styles) ? row.styles : [];
    const publicStyleLabels = Array.isArray(row.styleLabels)
      ? row.styleLabels.filter((label, index) => (
        String(styles[index] || "").toLowerCase() !== "unclassified"
        && String(label || "").toLowerCase() !== "unclassified"
      ))
      : [];
    return {
      ...common,
      node_id: "tattooing",
      summary: row.description || "",
      theme_labels: publicStyleLabels.join(", "),
      route: row.legacy_path || "/tattoos/flash/",
    };
  }
  if (resource === "art") return { ...common, node_id: "art", summary: row.statement || "", date_label: row.year || "", route: artCanonicalRoute(row) };
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
    return { ...common, summary: row.meaning || "", body: [...influence, ...applications, ...variants, ...appearances].filter(Boolean).join(" "), theme_labels: parseJson(row.themes_json).join(", "), route: legendCanonicalRoute(row.slug || row.id) };
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

const PUBLIC_FLASH_STATES = new Set(["available","reserved","placed","retired"]);

function eligibleFlashMedia(row) {
  return row?.media_state === "active"
    && row.media_privacy === "public"
    && ["not-required","granted"].includes(row.media_consent_status)
    && row.media_presentation === "inline"
    && Number(row.public_visible) === 1;
}

async function flashMediaRows(database, entityId) {
  const result = await database.prepare(`SELECT em.*,
      m.state media_state,m.privacy media_privacy,m.consent_status media_consent_status,
      m.public_presentation media_presentation,m.original_filename,m.source_url,m.storage_key,m.mime_type,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) resolved_alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) resolved_caption
    FROM entity_media em
    JOIN media_assets m ON m.id=em.media_id
    WHERE em.entity_id=?
    ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(entityId).all();
  return result.results || [];
}

async function flashHasEligiblePrimary(database, entityId) {
  const row = await database.prepare(`SELECT 1 ok
    FROM entity_media em
    JOIN media_assets m ON m.id=em.media_id
    WHERE em.entity_id=? AND em.role='primary' AND em.public_visible=1
      AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted')
      AND m.public_presentation='inline'
    LIMIT 1`).bind(entityId).first();
  return Boolean(row);
}

async function artHasEligiblePrimary(database, entityId) {
  return flashHasEligiblePrimary(database, entityId);
}

async function adminEntityMedia(database, entityIds) {
  if (!entityIds.length) return new Map();
  const placeholders = entityIds.map(() => "?").join(",");
  const result = await database.prepare(`SELECT em.entity_id,em.role,em.sort_order,em.public_visible,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) caption,
      em.alt_text_override,em.caption_override,m.id,m.original_filename,m.source_url,m.storage_key,m.mime_type
    FROM entity_media em
    JOIN media_assets m ON m.id=em.media_id
    WHERE m.state='active' AND em.entity_id IN (${placeholders})
    ORDER BY em.entity_id,CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(...entityIds).all();
  const map = new Map();
  for (const row of result.results || []) {
    if (!map.has(row.entity_id)) map.set(row.entity_id, []);
    map.get(row.entity_id).push({
      id: row.id,
      role: row.role,
      sort_order: Number(row.sort_order) || 0,
      public_visible: Number(row.public_visible) === 1,
      url: row.source_url || `/api/construct/entity-media/${row.id}`,
      adminUrl: `/api/admin/media/${encodeURIComponent(row.id)}/file`,
      alt: row.alt_text,
      caption: row.caption,
      alt_text_override: row.alt_text_override,
      caption_override: row.caption_override,
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
    });
  }
  return map;
}

async function adminList(env, resource) {
  const config = RESOURCE_CONFIG[resource]; if (!config) return failure("Unknown resource.", 404);
  const database = db(env);
  const rows = (await database.prepare(`SELECT * FROM ${config.table} ORDER BY sort_order,id`).all()).results || [];
  const entityIds = rows.map((row) => row.id);
  const publicationRows = resource === "art" && entityIds.length
    ? (await database.prepare(`SELECT id,public_at FROM content_entities WHERE id IN (${entityIds.map(() => "?").join(",")})`).bind(...entityIds).all()).results || []
    : [];
  const publicationById = new Map(publicationRows.map((row) => [row.id, row.public_at || ""]));
  const [media, tattooStyles, flashSheetDesigns] = await Promise.all([
    resource === "flash" || resource === "art" ? adminEntityMedia(database, entityIds) : entityMedia(database, entityIds),
    resource === "flash" ? loadTattooStyleAssignments(database, entityIds) : Promise.resolve(new Map()),
    resource === "flash" ? loadFlashSheetDesigns(database, entityIds, { admin: true }) : Promise.resolve(new Map()),
  ]);
  return json({
    records: rows.map((row) => ({
      ...row,
      ...(resource === "flash" ? tattooStylePayload(tattooStyles.get(row.id), { fallbackValue: "unclassified", fallbackLabel: "Unclassified" }) : {}),
      ...(resource === "flash" ? { sheetDesigns: flashSheetDesigns.get(row.id) || [] } : {}),
      ...(resource === "art" ? {
        canonicalRoute: artCanonicalRoute(row),
        canonical_route: artCanonicalRoute(row),
        public_at: publicationById.get(row.id) || "",
        published_once: Boolean(publicationById.get(row.id)),
      } : {}),
      media: media.get(row.id) || [],
    })),
    count: rows.length,
  });
}

async function adminCreate(request, env, resource) {
  const config = RESOURCE_CONFIG[resource]; const body = await readJson(request); if (!config || !body) return failure("Invalid request.");
  if(resource==="art"&&body.print_intent!==undefined&&!["unavailable","planned"].includes(body.print_intent))return failure("Print plan must be unavailable or planned.");
  const database = db(env); const recordId = text(body.id, 160) || id(config.entityType); const values = normalizeRecord(config, body);
  let styleSelection = [];
  if (resource === "art") {
    if ((values.state || "draft") !== "draft") return failure("New artwork must begin as Draft. Attach the primary image before publishing.", 409);
    values.state = "draft";
  }
  if (resource === "flash") {
    if ((values.state || "draft") !== "draft") return failure("New Flash records must begin as drafts. Attach the design artwork before publishing.", 409);
    values.state = "draft";
    try {
      styleSelection = await resolveTattooStyleSelection(
        database,
        Object.prototype.hasOwnProperty.call(body, "styles") ? body.styles : [],
      );
    } catch (error) {
      if (error instanceof TattooStyleValidationError) return failure(error.message, error.status);
      throw error;
    }
  }
  if (config.fields.includes("sort_order") && (!Number.isFinite(Number(values.sort_order)) || Number(values.sort_order) <= 0)) {
    const last = await database.prepare(`SELECT COALESCE(MAX(sort_order),0) AS max_order FROM ${config.table}`).first();
    values.sort_order = Number(last?.max_order || 0) + 1;
  }
  if (resource === "nodes" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_nodes WHERE homepage_enabled=1").first(); if (Number(c?.c || 0) >= 9) return failure("Homepage node capacity is 9.", 409); }
  if (resource === "pathways" && values.homepage_enabled) { const c = await database.prepare("SELECT COUNT(*) c FROM construct_pathways WHERE node_id=? AND homepage_enabled=1").bind(values.node_id).first(); if (Number(c?.c || 0) >= 9) return failure("Pathway capacity is 9 per node.", 409); }
  const keys = Object.keys(values); if (!keys.length) return failure("No editable fields supplied.");
  const createStatements = [
    database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId,config.entityType,values.node_id || (config.entityType==="visual_symbol"?"node-legend":null),"internal"),
    database.prepare(`INSERT INTO ${config.table}(id,${keys.join(",")},created_at,updated_at) VALUES(?,${keys.map(()=>"?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...keys.map(k=>values[k])),
  ];
  if (resource === "flash") createStatements.push(...replaceTattooStyleAssignmentStatements(database, recordId, styleSelection));
  await database.batch(createStatements);
  const createdRow = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  const created = resource === "flash" ? { ...createdRow, ...tattooStylePayload(styleSelection) } : createdRow;
  const publishStatements=[entityVisibilityStatement(database, resource, created),searchSyncStatement(database, resource, created)];
  if(archiveEligibleEntityType(config.entityType))publishStatements.push(archiveShellStatement(database,recordId,config.entityType,archivePreferredSlug(config.entityType,created),archiveRecordType(config.entityType)));
  await database.batch(publishStatements);
  await nextRevision(database,recordId,"create",null,created); return json({ record: created },{status:201});
}

async function adminUpdate(request, env, resource, recordId, archive = false) {
  const config = RESOURCE_CONFIG[resource]; const body = archive ? { state: "archived" } : await readJson(request); if (!config || !body) return failure("Invalid request.");
  if(resource==="art"&&body.print_intent!==undefined&&!["unavailable","planned"].includes(body.print_intent))return failure("Print plan must be unavailable or planned.");
  const database = db(env); const beforeRow = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first(); if (!beforeRow) return failure("Not found.",404);
  if (resource === "art" && Object.prototype.hasOwnProperty.call(body, "slug")) {
    const publication = await database.prepare("SELECT public_at FROM content_entities WHERE id=?").bind(recordId).first();
    const requestedSlug = text(body.slug, 8000);
    if (publication?.public_at && requestedSlug !== beforeRow.slug) {
      return failure("The artwork slug is permanent after first publication.", 409);
    }
  }
  const hasStyleUpdate = resource === "flash" && Object.prototype.hasOwnProperty.call(body, "styles");
  let beforeStyleSelection = [];
  let nextStyleSelection = [];
  let shouldReplaceStyles = false;
  if (resource === "flash") {
    const styleMap = await loadTattooStyleAssignments(database, [recordId]);
    beforeStyleSelection = styleMap.get(recordId) || [];
    nextStyleSelection = beforeStyleSelection;
    try {
      if (hasStyleUpdate) {
        nextStyleSelection = await resolveTattooStyleSelection(database, body.styles, {
          currentValues: beforeStyleSelection.map((entry) => entry.value),
        });
        shouldReplaceStyles = true;
      } else if (!beforeStyleSelection.length) {
        nextStyleSelection = await resolveTattooStyleSelection(database, []);
        shouldReplaceStyles = true;
      }
    } catch (error) {
      if (error instanceof TattooStyleValidationError) return failure(error.message, error.status);
      throw error;
    }
  }
  const before = resource === "flash" ? { ...beforeRow, ...tattooStylePayload(beforeStyleSelection) } : beforeRow;
  const values = normalizeRecord(config,body,beforeRow); const keys = Object.keys(values); if (!keys.length && !hasStyleUpdate) return failure("No editable fields supplied.");
  const projectedRow = { ...beforeRow, ...values, id: recordId };
  const projected = resource === "flash" ? { ...projectedRow, ...tattooStylePayload(nextStyleSelection) } : projectedRow;
  if (resource === "flash" && PUBLIC_FLASH_STATES.has(projected.state) && !await flashHasEligiblePrimary(database, recordId)) {
    return failure("Attach an eligible primary Flash image before publishing this design.", 409);
  }
  if (resource === "art" && projected.state === "published") {
    const stableSlug = text(projected.slug, 8000);
    if (!text(projected.title, 8000) || !stableSlug) {
      return failure("A title and stable slug are required before publishing artwork.", 409);
    }
    if (ART_RESERVED_SLUGS.has(stableSlug) || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(stableSlug)) {
      return failure("Choose a URL-safe, non-reserved artwork slug before publishing.", 409);
    }
    if (!await artHasEligiblePrimary(database, recordId)) {
      return failure("Attach an eligible primary artwork image before publishing.", 409);
    }
  }
  let managedSheetDesigns = [];
  if (resource === "flash") {
    managedSheetDesigns = (await loadFlashSheetDesigns(database, [recordId], { admin: true })).get(recordId) || [];
    if (
      beforeRow.item_type !== "sheet"
      && projected.item_type === "sheet"
      && ["reserved","placed"].includes(beforeRow.state)
    ) {
      return failure("Reserved or placed Flash records cannot be converted into managed sheets.", 409);
    }
    if (managedSheetDesigns.length && projected.item_type !== "sheet") {
      return failure("A managed Flash sheet cannot be converted back to an individual design.", 409);
    }
  }
  if (resource === "flash" && projected.item_type === "sheet") {
    if (managedSheetDesigns.length && PUBLIC_FLASH_STATES.has(projected.state)) {
      if (managedSheetDesigns.length > 26 || managedSheetDesigns.some((design) => !text(design.label, 300))) {
        return failure("Every managed Flash sheet design needs a label before publishing.", 409);
      }
    }
  }
  const updateStatements=[];
  if (keys.length) updateStatements.push(
    database.prepare(`UPDATE ${config.table} SET ${keys.map(k=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...keys.map(k=>values[k]),recordId)
  );
  else updateStatements.push(database.prepare(`UPDATE ${config.table} SET updated_at=datetime('now') WHERE id=?`).bind(recordId));
  if (shouldReplaceStyles) updateStatements.push(...replaceTattooStyleAssignmentStatements(database, recordId, nextStyleSelection));
  if (
    resource === "flash"
    && projected.item_type === "sheet"
    && managedSheetDesigns.length
    && projected.state === "available"
  ) {
    updateStatements.push(
      database.prepare(
        "UPDATE flash_sheet_designs SET state='available',updated_at=datetime('now') WHERE flash_item_id=? AND state='draft'"
      ).bind(recordId)
    );
  }
  updateStatements.push(
    entityVisibilityStatement(database, resource, projected),
    searchSyncStatement(database, resource, projected),
  );
  if(archiveEligibleEntityType(config.entityType))updateStatements.push(archiveShellStatement(database,recordId,config.entityType,archivePreferredSlug(config.entityType,projected),archiveRecordType(config.entityType)));
  await database.batch(updateStatements);
  const afterRow = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  const after = resource === "flash" ? { ...afterRow, ...tattooStylePayload(nextStyleSelection) } : afterRow;
  await nextRevision(database,recordId,archive?"archive":"update",before,after); return json({record:after});
}

async function reorder(request, env, resource) {
  const config=RESOURCE_CONFIG[resource]; const body=await readJson(request); if(!config||!Array.isArray(body?.ids)) return failure("ids must be an array.");
  const database=db(env); const current=(await database.prepare(`SELECT id FROM ${config.table} ORDER BY sort_order,id`).all()).results||[];const currentIds=current.map(row=>row.id);const requested=new Set(body.ids);if(body.ids.length!==currentIds.length||requested.size!==currentIds.length||currentIds.some(recordId=>!requested.has(recordId)))return failure("The catalog changed. Refresh before reordering.",409);
  if(body.expected_updated_at){const latest=await database.prepare(`SELECT MAX(updated_at) v FROM ${config.table}`).first();if(latest?.v&&latest.v!==body.expected_updated_at)return failure("Order changed in another session. Refresh and retry.",409,{latest:latest.v});}
  await database.batch(body.ids.map((recordId,index)=>database.prepare(`UPDATE ${config.table} SET sort_order=?,updated_at=datetime('now') WHERE id=?`).bind(index+1,recordId)));
  return json({ok:true});
}

async function flashSheetDesignsAdminApi(request, env, flashItemId) {
  if (request.method !== "PUT") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env);
  const parent = await database.prepare(
    "SELECT id,item_type,state FROM flash_items WHERE id=?"
  ).bind(flashItemId).first();
  if (!parent) return failure("Flash record not found.", 404);
  if (parent.item_type !== "sheet") return failure("Change the Flash item type to Sheet before adding lettered designs.", 409);
  if (["reserved","placed"].includes(parent.state)) {
    return failure("Reserved or placed legacy sheets cannot be converted or reconfigured.", 409);
  }
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 26) {
    return failure("Flash sheet design count must be between 1 and 26.");
  }
  const supplied = Array.isArray(body.designs) ? body.designs : [];
  const existing = (await database.prepare(
    "SELECT * FROM flash_sheet_designs WHERE flash_item_id=? ORDER BY sort_order,code"
  ).bind(flashItemId).all()).results || [];
  const existingByCode = new Map(existing.map((row) => [row.code, row]));
  const targetCodes = Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
  const removed = existing.filter((row) => !targetCodes.includes(row.code));
  if (removed.length) {
    const protectedRows = removed.filter((row) => ["reserved","placed"].includes(row.state));
    if (protectedRows.length) {
      return failure(`Cannot remove ${protectedRows.map((row) => row.code).join(", ")} because those designs are ${protectedRows[0].state}.`, 409);
    }
    const placeholders = removed.map(() => "?").join(",");
    const referenced = (await database.prepare(
      `SELECT DISTINCT fsd.code
       FROM submission_flash_designs sfd
       JOIN flash_sheet_designs fsd ON fsd.id=sfd.sheet_design_id
       WHERE sfd.sheet_design_id IN (${placeholders})
       ORDER BY fsd.sort_order`
    ).bind(...removed.map((row) => row.id)).all()).results || [];
    if (referenced.length) {
      return failure(`Cannot remove ${referenced.map((row) => row.code).join(", ")} because existing submissions reference those designs.`, 409);
    }
  }
  const suppliedByCode = new Map();
  for (let index = 0; index < supplied.length; index += 1) {
    const entry = supplied[index] || {};
    const code = text(entry.code, 4).toUpperCase() || targetCodes[index] || "";
    if (!targetCodes.includes(code) || suppliedByCode.has(code)) return failure("Sheet design assignments must match the generated A-Z sequence.");
    suppliedByCode.set(code, entry);
  }
  const publicParent = PUBLIC_FLASH_STATES.has(parent.state);
  const availableParent = parent.state === "available";
  const statements = removed.map((row) =>
    database.prepare("DELETE FROM flash_sheet_designs WHERE id=? AND flash_item_id=?").bind(row.id, flashItemId)
  );
  for (let index = 0; index < targetCodes.length; index += 1) {
    const code = targetCodes[index];
    const before = existingByCode.get(code);
    const entry = suppliedByCode.get(code) || supplied[index] || {};
    if (before && entry.id && entry.id !== before.id) return failure(`${code} already has a stable design identity and cannot be replaced.`, 409);
    if (entry.code && text(entry.code, 4).toUpperCase() !== code) return failure(`${code} cannot be renumbered.`, 409);
    const label = text(entry.label ?? before?.label, 300);
    if (publicParent && !label) return failure(`Design ${code} needs a label before this public sheet can be saved.`, 409);
    let state = text(entry.state ?? before?.state, 30).toLowerCase() || "draft";
    if (before && ["reserved","placed"].includes(before.state)) state = before.state;
    else {
      if (!["draft","available","retired"].includes(state)) return failure(`Design ${code} has an invalid state.`);
      if (!before) state = availableParent ? "available" : "draft";
      else if (availableParent && state === "draft") state = "available";
    }
    if (before) {
      statements.push(
        database.prepare(
          "UPDATE flash_sheet_designs SET label=?,state=?,sort_order=?,updated_at=datetime('now') WHERE id=? AND flash_item_id=?"
        ).bind(label, state, index + 1, before.id, flashItemId)
      );
    } else {
      statements.push(
        database.prepare(
          `INSERT INTO flash_sheet_designs
           (id,flash_item_id,code,label,state,sort_order,created_at,updated_at)
           VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))`
        ).bind(id("flash-sheet-design"), flashItemId, code, label, state, index + 1)
      );
    }
  }
  await database.batch(statements);
  const sheetDesigns = (await loadFlashSheetDesigns(database, [flashItemId], { admin: true })).get(flashItemId) || [];
  return json({ sheetDesigns, sheet_designs: sheetDesigns, count: sheetDesigns.length });
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
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
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
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const row=await db(env).prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      AND EXISTS(SELECT 1 FROM entity_media em JOIN content_entities ce ON ce.id=em.entity_id
        WHERE em.media_id=m.id AND em.public_visible=1 AND ce.visibility='public')`).bind(mediaId).first();
  if(!row)return failure("Not found.",404);
  return servePublicMedia(row,request,env);
}

async function servePublicMedia(row,request,env){
  return serveR2Media(request,env.SUBMISSION_FILES,row,()=>failure("Media unavailable.",404));
}

async function adminMediaFileApi(request,env,mediaId){
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const row=await db(env).prepare("SELECT * FROM media_assets WHERE id=? AND state='active'").bind(mediaId).first();
  if(!row)return failure("Media not found.",404);
  return servePublicMedia(row,request,env);
}

function resumableUploadFilename(value){
  return text(value,255).replace(/[^a-zA-Z0-9._ -]/g,"-")||"video";
}

function presentUploadSession(row,parts=[]){
  return {
    id:row.id,
    uploadId:row.upload_id,
    mediaId:row.media_id,
    filename:row.original_filename,
    mimeType:row.mime_type,
    byteSize:Number(row.byte_size)||0,
    partSize:Number(row.part_size)||RESUMABLE_VIDEO_PART_BYTES,
    partCount:Math.ceil((Number(row.byte_size)||0)/(Number(row.part_size)||RESUMABLE_VIDEO_PART_BYTES)),
    state:row.state,
    error:row.error_message||"",
    expiresAt:row.expires_at,
    completedAt:row.completed_at||null,
    parts:parts.map(part=>({partNumber:Number(part.part_number),etag:part.etag,byteSize:Number(part.byte_size)||0})),
  };
}

async function uploadSession(database,sessionId){
  return database.prepare("SELECT * FROM media_upload_sessions WHERE id=?").bind(sessionId).first();
}

function uploadPartExpectedSize(session,partNumber){
  const partSize=Number(session.part_size)||RESUMABLE_VIDEO_PART_BYTES,total=Number(session.byte_size)||0,count=Math.ceil(total/partSize);
  if(!Number.isInteger(partNumber)||partNumber<1||partNumber>count)return 0;
  return partNumber===count?total-(count-1)*partSize:partSize;
}

async function mediaUploadsApi(request,env,sessionId="",action="",partNumber=0){
  const database=db(env);
  if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
  if(request.method==="GET"&&!sessionId){
    const rows=(await database.prepare("SELECT * FROM media_upload_sessions WHERE state='pending' ORDER BY created_at DESC LIMIT 50").all()).results||[];
    return json({uploads:rows.map(row=>presentUploadSession(row)),count:rows.length});
  }
  if(request.method==="POST"&&!sessionId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const mime=text(body.mimeType??body.mime_type,100).toLowerCase(),byteSize=Number(body.byteSize??body.byte_size)||0;
    if(!RESUMABLE_VIDEO_MIMES.has(mime))return failure("Use an MP4 or WebM video.",415);
    if(!Number.isSafeInteger(byteSize)||byteSize<=0)return failure("A valid video size is required.");
    if(byteSize>RESUMABLE_VIDEO_MAX_BYTES)return failure("Videos must be 2 GiB or smaller.",413);
    const privacy=text(body.privacy,30)||"internal",consent=normalizedConsent(body.consentStatus??body.consent_status),transcriptStatus=text(body.transcriptStatus??body.transcript_status,30)||"not-requested",presentation=text(body.publicPresentation??body.public_presentation,30)||"inline";
    if(!MEDIA_PRIVACIES.has(privacy))return failure("Invalid media privacy.");
    if(!MEDIA_CONSENT_STATUSES.has(consent))return failure("Invalid consent status.");
    if(!MEDIA_TRANSCRIPT_STATUSES.has(transcriptStatus))return failure("Invalid transcript status.");
    if(!MEDIA_PRESENTATIONS.has(presentation))return failure("Invalid public presentation.");
    const sessionNewId=id("media-upload"),mediaId=id("media"),filename=text(body.filename??body.original_filename,255)||"video",storageFilename=resumableUploadFilename(filename);
    const key=`construct/${mediaId}/${storageFilename}`;
    const upload=await env.SUBMISSION_FILES.createMultipartUpload(key,{
      httpMetadata:{contentType:mime,cacheControl:"private, no-store"},
      customMetadata:{mediaId,sessionId:sessionNewId,originalFilename:filename},
    });
    try{
      await database.prepare(`INSERT INTO media_upload_sessions(
        id,upload_id,storage_key,original_filename,mime_type,byte_size,part_size,media_id,
        alt_text,caption,privacy,consent_status,transcript,transcript_status,transcript_language,
        public_title,public_description,public_presentation,state,error_message,expires_at,
        created_by,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','',datetime('now','+24 hours'),'studio',datetime('now'),datetime('now'))`)
        .bind(sessionNewId,upload.uploadId,key,filename,mime,byteSize,RESUMABLE_VIDEO_PART_BYTES,mediaId,
          text(body.altText??body.alt_text,1000),text(body.caption,3000),privacy,consent,text(body.transcript,100000),
          transcriptStatus,text(body.transcriptLanguage??body.transcript_language,40)||"en",text(body.publicTitle??body.public_title,300),
          text(body.publicDescription??body.public_description,3000),presentation).run();
    }catch(error){try{await upload.abort();}catch{}throw error;}
    const created=await uploadSession(database,sessionNewId);
    return json({upload:presentUploadSession(created)},{status:201});
  }
  const session=await uploadSession(database,sessionId);
  if(!session)return failure("Upload session not found.",404);
  const parts=async()=>(await database.prepare("SELECT * FROM media_upload_parts WHERE session_id=? ORDER BY part_number").bind(sessionId).all()).results||[];
  if(request.method==="GET"&&!action)return json({upload:presentUploadSession(session,await parts())});
  if(request.method==="PUT"&&action==="part"){
    if(session.state!=="pending")return failure(session.state==="completed"?"This upload is already complete.":"This upload is no longer active.",409);
    if(Date.parse(`${session.expires_at}Z`)<=Date.now())return failure("This upload session has expired.",410);
    const expectedSize=uploadPartExpectedSize(session,partNumber);if(!expectedSize)return failure("Invalid upload part.");
    const suppliedLength=Number(request.headers.get("content-length")||0);
    if(suppliedLength&&suppliedLength!==expectedSize)return failure(`Part ${partNumber} must contain ${expectedSize} bytes.`,422);
    if(!request.body)return failure("Upload part data is required.");
    const upload=env.SUBMISSION_FILES.resumeMultipartUpload(session.storage_key,session.upload_id);
    let uploaded;
    try{uploaded=await upload.uploadPart(partNumber,request.body);}catch(error){
      await database.prepare("UPDATE media_upload_sessions SET error_message=?,updated_at=datetime('now') WHERE id=?").bind(text(error?.message||error,1000),sessionId).run();
      return failure("The upload part could not be stored. Retry this part.",502);
    }
    await database.prepare(`INSERT INTO media_upload_parts(session_id,part_number,etag,byte_size,created_at,updated_at)
      VALUES(?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(session_id,part_number) DO UPDATE SET etag=excluded.etag,byte_size=excluded.byte_size,updated_at=datetime('now')`)
      .bind(sessionId,partNumber,uploaded.etag,expectedSize).run();
    await database.prepare("UPDATE media_upload_sessions SET error_message='',updated_at=datetime('now') WHERE id=?").bind(sessionId).run();
    return json({part:{partNumber:Number(uploaded.partNumber||partNumber),etag:uploaded.etag,byteSize:expectedSize}});
  }
  if(request.method==="POST"&&action==="complete"){
    if(session.state==="completed"){
      const record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(session.media_id).first();
      return json({record,upload:presentUploadSession(session,await parts()),completed:true});
    }
    if(session.state!=="pending")return failure("This upload is no longer active.",409);
    const uploadedParts=await parts(),count=Math.ceil(Number(session.byte_size)/Number(session.part_size));
    if(uploadedParts.length!==count||uploadedParts.some((part,index)=>Number(part.part_number)!==index+1||Number(part.byte_size)!==uploadPartExpectedSize(session,index+1)))return failure("Every video part must finish uploading before completion.",409);
    const upload=env.SUBMISSION_FILES.resumeMultipartUpload(session.storage_key,session.upload_id);
    let object=null;
    try{object=await upload.complete(uploadedParts.map(part=>({partNumber:Number(part.part_number),etag:part.etag})));}
    catch(error){object=await env.SUBMISSION_FILES.head(session.storage_key);if(!object||Number(object.size)!==Number(session.byte_size))return failure("The video could not be finalized. Retry completion.",502);}
    if(Number(object.size)!==Number(session.byte_size))return failure("The completed video size did not match the selected file.",409);
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO media_assets(
        id,storage_key,original_filename,mime_type,byte_size,alt_text,caption,privacy,consent_status,state,
        created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation
      ) VALUES(?,?,?,?,?,?,?,?,?,'active','studio',datetime('now'),datetime('now'),?,?,?,?,?,?)`)
        .bind(session.media_id,session.storage_key,session.original_filename,session.mime_type,session.byte_size,session.alt_text,session.caption,session.privacy,session.consent_status,
          session.transcript,session.transcript_status,session.transcript_language,session.public_title,session.public_description,session.public_presentation),
      database.prepare("UPDATE media_upload_sessions SET state='completed',completed_at=datetime('now'),error_message='',updated_at=datetime('now') WHERE id=?").bind(sessionId),
    ]);
    const completed=await uploadSession(database,sessionId),record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(session.media_id).first();
    return json({record,upload:presentUploadSession(completed,uploadedParts),completed:true});
  }
  if(request.method==="DELETE"&&!action){
    if(session.state==="completed")return failure("Completed media cannot be cancelled.",409);
    if(session.state==="pending"){try{await env.SUBMISSION_FILES.resumeMultipartUpload(session.storage_key,session.upload_id).abort();}catch(error){return failure("The multipart upload could not be cancelled. Retry cancellation.",502)}}
    await database.batch([
      database.prepare("DELETE FROM media_upload_parts WHERE session_id=?").bind(sessionId),
      database.prepare("UPDATE media_upload_sessions SET state='aborted',error_message='',updated_at=datetime('now') WHERE id=?").bind(sessionId),
    ]);
    return json({ok:true,aborted:true});
  }
  return failure("Method not allowed.",405);
}

export async function reapStaleMediaUploads(env){
  if(!env.SUBMISSIONS_DB||!env.SUBMISSION_FILES)return {aborted:0};
  const database=db(env),rows=(await database.prepare("SELECT * FROM media_upload_sessions WHERE state='pending' AND expires_at<=datetime('now') ORDER BY expires_at LIMIT 50").all()).results||[];
  let aborted=0;
  for(const row of rows){
    try{await env.SUBMISSION_FILES.resumeMultipartUpload(row.storage_key,row.upload_id).abort();}catch(error){
      await database.prepare("UPDATE media_upload_sessions SET error_message=?,updated_at=datetime('now') WHERE id=? AND state='pending'")
        .bind(text(error?.message||"R2 abort failed.",1000),row.id).run();
      continue;
    }
    await database.batch([
      database.prepare("DELETE FROM media_upload_parts WHERE session_id=?").bind(row.id),
      database.prepare("UPDATE media_upload_sessions SET state='aborted',error_message='Upload expired before completion.',updated_at=datetime('now') WHERE id=? AND state='pending'").bind(row.id),
    ]);
    aborted+=1;
  }
  return {aborted};
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
  const mime=(file.type||"application/octet-stream").toLowerCase();const image=["image/jpeg","image/png","image/webp","image/gif"].includes(mime);const doc=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mime);const audio=mime.startsWith("audio/"),video=RESUMABLE_VIDEO_MIMES.has(mime);const av=audio||video,max=av?50*1024*1024:15*1024*1024;if(mime.startsWith("video/")&&!video)return failure("Use an MP4 or WebM video.",415);if(!(image||doc||av))return failure("Unsupported media type.",415);if(file.size>max)return failure("File exceeds the allowed size.",413);if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
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
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/'||aw.slug||'/')
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'merch_item' THEN mi.route
      WHEN 'visual_symbol' THEN '/about/legend/'||vs.slug||'/'
      WHEN 'archive_record' THEN '/archive/?record='||ar.slug
      WHEN 'archive_collection' THEN '/archive/?collection='||ac.slug
      WHEN 'construct_node' THEN own.route WHEN 'construct_pathway' THEN cp.route
      WHEN 'event' THEN '/events/'||ev.slug||'/' ELSE '' END route,
    COALESCE(NULLIF(mi.image_url,''),NULLIF(pi.source_url,''),
      CASE WHEN ce.entity_type='visual_symbol' THEN NULLIF(vs.image_url,'') ELSE '' END,
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/entity-media/'||m.id) FROM entity_media em JOIN media_assets m ON m.id=em.media_id
       WHERE em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' AND m.privacy='public'
         AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
       ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order LIMIT 1),
      CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(json_extract(vs.examples_json,'$[0].src'),'') ELSE '' END,
      CASE WHEN ce.entity_type='portfolio_item' THEN '/api/portfolio/media/'||pi.id ELSE '' END) image_url,
    CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(vs.svg_markup,'') ELSE '' END media_markup,
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
    COALESCE(fi.claimable,0) claimable,COALESCE(mi.shopify_handle,'') shopify_handle
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
  return {id:row.id,entityType:row.entity_type,title:row.title||row.id,state:row.state||row.visibility,visibility:row.visibility,route:row.route||"",imageUrl:row.image_url||"",mediaMarkup:row.media_markup||"",kindLabel:row.kind_label||row.entity_type,detailLabel:row.detail_label||"",claimable:Number(row.claimable||0),shopifyHandle:row.shopify_handle||"",node:{id:nodeId,name:row.node_name||fallback.name,slug:row.node_slug||fallback.slug,color:row.node_color||fallback.color}};
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
  if(body.public_visible){
    for(const entity of entities.values())if(entity.visibility!=="public"||!entity.route)return failure(`${entity.title} needs a public destination route before this connection can be public.`,409);
    const pair=[...entities.values()],art=pair.find(entity=>entity.entityType==="art_work"),print=pair.find(entity=>entity.entityType==="merch_item"&&String(entity.kindLabel||"").toLowerCase()==="print");
    if(art&&print){
      const existingPrint=await database.prepare(`SELECT er.id
        FROM entity_relationships er
        JOIN merch_items mi ON mi.id=CASE WHEN er.source_entity_id=? THEN er.target_entity_id ELSE er.source_entity_id END
        WHERE er.public_visible=1 AND er.id<>? AND (er.source_entity_id=? OR er.target_entity_id=?)
          AND lower(mi.product_type)='print'
        LIMIT 1`).bind(art.id,ignoreId,art.id,art.id).first();
      if(existingPrint)return failure("A painting can have only one public print product. Make the existing print connection private before publishing another.",409);
    }
  }
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

async function publicArchiveCard(database,current){
  const row=await database.prepare(`SELECT ad.archive_slug,ad.state,
    COALESCE(cn.id,'') node_id,COALESCE(cn.name,'') node_name,COALESCE(cn.slug,'') node_slug,COALESCE(cn.color,'') node_color
    FROM archive_dossiers ad
    JOIN content_entities ce ON ce.id=ad.entity_id
    LEFT JOIN construct_nodes cn ON cn.id='node-archive'
    WHERE ad.entity_id=? AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    LIMIT 1`).bind(current.id).first();
  if(!row)return null;
  const fallback=NODE_FALLBACKS.archive;
  return {
    id:`archive-card-${current.id}`,
    label:"Archive record",
    related:{
      id:`archive-dossier-${current.id}`,
      entityType:"archive_dossier",
      title:"Explore the record of this work.",
      state:row.state,
      visibility:"public",
      route:`/archive/records/${encodeURIComponent(row.archive_slug)}/`,
      imageUrl:"",
      kindLabel:"Archive record",
      detailLabel:"Process, history, and documentation",
      claimable:0,
      shopifyHandle:"",
      node:{id:row.node_id||fallback.id,name:row.node_name||fallback.name,slug:row.node_slug||fallback.slug,color:row.node_color||fallback.color},
    },
  };
}

async function publicConnections(env,entityId){
  const database=db(env),currentMap=await entityRecords(database,[entityId]),current=currentMap.get(entityId);if(!current||current.visibility!=="public"||!current.route)return failure("Entity not found.",404);
  const [relationshipResult,archiveCard]=await Promise.all([
    database.prepare(`SELECT er.id,er.source_entity_id,er.target_entity_id,er.relationship_type_id,er.sort_order,rt.slug relationshipSlug,rt.forward_label,rt.reverse_label FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id WHERE er.public_visible=1 AND rt.public_visible=1 AND (er.source_entity_id=? OR er.target_entity_id=?) ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId).all(),
    publicArchiveCard(database,current),
  ]);
  const rows=relationshipResult.results||[];
  const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));const records=[];for(const row of rows){const outgoing=row.source_entity_id===entityId,related=entities.get(outgoing?row.target_entity_id:row.source_entity_id);if(!related||related.visibility!=="public"||!related.route)continue;records.push({id:row.id,direction:outgoing?"outgoing":"incoming",label:outgoing?row.forward_label:row.reverse_label,relationshipType:{id:row.relationship_type_id,slug:row.relationshipSlug},related,sortOrder:Number(row.sort_order||0)})}
  return json({entity:current,records,archiveCard,count:records.length,cardCount:records.length+(archiveCard?1:0)},{cache:"public, max-age=60"});
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

async function entityMediaApi(request,env,entityId,mediaId=""){
  const database=db(env);
  const entity=await database.prepare("SELECT ce.entity_type,fi.state flash_state FROM content_entities ce LEFT JOIN flash_items fi ON fi.id=ce.id AND ce.entity_type='flash_item' WHERE ce.id=?").bind(entityId).first();
  if(!entity)return failure("Entity not found.",404);
  const isFlash=entity.entity_type==="flash_item";
  if(request.method==="GET"&&!mediaId){
    const rows=(await database.prepare(`SELECT em.*,m.original_filename,m.source_url,m.storage_key,m.mime_type,m.state media_state,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) caption
      FROM entity_media em JOIN media_assets m ON m.id=em.media_id
      WHERE em.entity_id=? ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(entityId).all()).results||[];
    return json({records:rows,count:rows.length});
  }
  if(request.method==="POST"&&!mediaId){
    const b=await readJson(request);if(!b?.media_id)return failure("media_id is required.");
    const role=text(b.role,60)||"gallery",publicVisible=b.public_visible?1:0;
    if(isFlash&&!["primary","gallery"].includes(role))return failure("Flash media must be primary or gallery artwork.");
    const mediaAsset=await database.prepare("SELECT state media_state,privacy media_privacy,consent_status media_consent_status,public_presentation media_presentation FROM media_assets WHERE id=?").bind(b.media_id).first();
    if(!mediaAsset)return failure("Media not found.",404);
    if(isFlash&&role==="primary"&&PUBLIC_FLASH_STATES.has(entity.flash_state)&&!eligibleFlashMedia({...mediaAsset,public_visible:publicVisible}))return failure("A published Flash design needs an eligible public primary image.",409);
    const cover=role==="gallery"&&!publicVisible?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,b.media_id).first():null;
    if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);
    const statements=[];
    if(isFlash&&role==="primary")statements.push(database.prepare("UPDATE entity_media SET role='gallery' WHERE entity_id=? AND role='primary' AND media_id<>?").bind(entityId,b.media_id));
    statements.push(database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,b.media_id,role,Number(b.sort_order)||0,publicVisible,text(b.alt_text_override,1000),text(b.caption_override,3000)));
    try{await database.batch(statements);}catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);throw error;}
    return json({ok:true},{status:201});
  }
  const attachment=mediaId?await database.prepare(`SELECT em.*,m.state media_state,m.privacy media_privacy,m.consent_status media_consent_status,m.public_presentation media_presentation
    FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.entity_id=? AND em.media_id=?`).bind(entityId,mediaId).first():null;
  if(!attachment)return failure("Media attachment not found.",404);
  if(request.method==="PATCH"){
    const b=await readJson(request);if(!b)return failure("Send a JSON object.");
    const next={
      ...attachment,
      role:Object.prototype.hasOwnProperty.call(b,"role")?text(b.role,60):attachment.role,
      sort_order:Object.prototype.hasOwnProperty.call(b,"sort_order")?Number(b.sort_order)||0:Number(attachment.sort_order)||0,
      public_visible:Object.prototype.hasOwnProperty.call(b,"public_visible")?(b.public_visible?1:0):Number(attachment.public_visible),
      alt_text_override:Object.prototype.hasOwnProperty.call(b,"alt_text_override")?text(b.alt_text_override,1000):attachment.alt_text_override,
      caption_override:Object.prototype.hasOwnProperty.call(b,"caption_override")?text(b.caption_override,3000):attachment.caption_override,
    };
    if(isFlash&&!["primary","gallery"].includes(next.role))return failure("Flash media must be primary or gallery artwork.");
    const cover=next.role==="gallery"&&!next.public_visible?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,mediaId).first():null;
    if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);
    if(isFlash&&PUBLIC_FLASH_STATES.has(entity.flash_state)){
      const projected=(await flashMediaRows(database,entityId)).map(row=>row.media_id===mediaId?next:(next.role==="primary"&&row.role==="primary"?{...row,role:"gallery"}:row));
      if(!projected.some(row=>row.role==="primary"&&eligibleFlashMedia(row)))return failure("A published Flash design must keep an eligible primary image.",409);
    }
    const statements=[];
    if(isFlash&&next.role==="primary")statements.push(database.prepare("UPDATE entity_media SET role='gallery' WHERE entity_id=? AND role='primary' AND media_id<>?").bind(entityId,mediaId));
    statements.push(database.prepare("UPDATE entity_media SET role=?,sort_order=?,public_visible=?,alt_text_override=?,caption_override=? WHERE entity_id=? AND media_id=?")
      .bind(next.role,next.sort_order,next.public_visible,next.alt_text_override,next.caption_override,entityId,mediaId));
    try{await database.batch(statements);}catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);throw error;}
    return json({record:await database.prepare("SELECT * FROM entity_media WHERE entity_id=? AND media_id=?").bind(entityId,mediaId).first()});
  }
  if(request.method==="DELETE"){
    const portfolioCover=attachment.role==="gallery"?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,mediaId).first():null;
    if(portfolioCover)return failure("Unpublish this tattoo or choose another permitted result image before removing its cover.",409);
    let promoted=null;
    if(isFlash&&attachment.role==="primary"){
      const rows=await flashMediaRows(database,entityId);
      promoted=rows.find(row=>row.media_id!==mediaId&&row.role==="gallery"&&(!PUBLIC_FLASH_STATES.has(entity.flash_state)||eligibleFlashMedia(row)))||null;
    }
    if(isFlash&&PUBLIC_FLASH_STATES.has(entity.flash_state)&&attachment.role==="primary"&&!promoted)return failure("A published Flash design must keep an eligible primary image.",409);
    const statements=[database.prepare("DELETE FROM entity_media WHERE entity_id=? AND media_id=?").bind(entityId,mediaId)];
    if(promoted)statements.push(database.prepare("UPDATE entity_media SET role='primary',sort_order=1 WHERE entity_id=? AND media_id=?").bind(entityId,promoted.media_id));
    await database.batch(statements);
    return json({ok:true,promoted_media_id:promoted?.media_id||null});
  }
  return failure("Method not allowed.",405);
}

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
    if(entityId&&!records[0])return failure("Dossier not found.",404);
    if(entityId){const originThreads=(await database.prepare(`SELECT ot.*,otd.is_primary,otd.sort_order assignment_sort_order FROM archive_origin_thread_dossiers otd JOIN archive_origin_threads ot ON ot.id=otd.thread_id WHERE otd.dossier_entity_id=? ORDER BY otd.is_primary DESC,otd.sort_order,ot.title`).bind(entityId).all()).results||[];const enriched={...records[0],origin_threads:originThreads,origin_thread_ids:originThreads.map(thread=>thread.id),primary_origin_thread_id:originThreads.find(thread=>Number(thread.is_primary))?.id||""};return json({record:enriched,dossier:enriched,origin_threads:originThreads});}
    return json({records,count:records.length});
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
    const hasOriginUpdate=Object.prototype.hasOwnProperty.call(body,"origin_thread_ids")||Object.prototype.hasOwnProperty.call(body,"originThreadIds"),assignmentIds=hasOriginUpdate?originThreadIds(body.origin_thread_ids??body.originThreadIds):[],primaryOriginId=hasOriginUpdate?text(body.primary_origin_thread_id??body.primaryOriginThreadId,200):"";
    if(hasOriginUpdate&&(primaryOriginId&&!assignmentIds.includes(primaryOriginId)||!await validateOriginThreadIds(database,assignmentIds)))return failure("Choose valid origin threads and make the primary thread part of the dossier assignment.",409);
    await database.prepare(`UPDATE archive_dossiers SET archive_slug=?,orientation=?,story=?,story_html=?,empty_materials_note=?,record_type=?,state=?,public_visible=?,featured=?,sort_order=?,published_at=CASE WHEN ?='published' AND ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(next.archive_slug,next.orientation,next.story,next.story_html,next.empty_materials_note,next.record_type,next.state,next.public_visible,next.featured,next.sort_order,next.state,next.public_visible,entityId).run();
    if(hasOriginUpdate)await replaceDossierOriginThreads(database,entityId,assignmentIds,primaryOriginId);
    const after=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();await nextRevision(database,entityId,"archive-dossier-update",before,after);return archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
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
      ORDER BY am.dossier_entity_id,am.sort_order,am.created_at`);const result=entityId?await statement.bind(entityId).all():await statement.all();const rows=result.results||[],ids=rows.map(row=>row.id),assignmentRows=ids.length?(await database.prepare(`SELECT material_id,thread_id FROM archive_origin_thread_materials WHERE material_id IN (${ids.map(()=>"?").join(",")}) ORDER BY sort_order`).bind(...ids).all()).results||[]:[],byMaterial=new Map();assignmentRows.forEach(row=>{if(!byMaterial.has(row.material_id))byMaterial.set(row.material_id,[]);byMaterial.get(row.material_id).push(row.thread_id)});const records=rows.map(row=>({...row,origin_thread_ids:byMaterial.get(row.id)||[]}));return json({records,materials:records,count:records.length});}
  if(request.method==="POST"&&materialId==="reorder"){const body=await readJson(request);const entityId=text(body?.entity_id||body?.entityId,200),ids=body?.ids;if(!entityId||!Array.isArray(ids))return failure("entity_id and ids are required.");const current=(await database.prepare("SELECT id FROM archive_materials WHERE dossier_entity_id=? ORDER BY sort_order,id").bind(entityId).all()).results||[];const set=new Set(ids);if(ids.length!==current.length||set.size!==current.length||current.some(row=>!set.has(row.id)))return failure("The material list changed. Refresh before reordering.",409);await database.batch(ids.map((recordId,index)=>database.prepare("UPDATE archive_materials SET sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=? AND dossier_entity_id=?").bind(index+1,recordId,entityId)));return json({ok:true});}
  if(request.method==="POST"&&!materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const material=normalizeArchiveMaterial(body);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;const ids=originThreadIds(body.origin_thread_ids??body.originThreadIds);if(!await validateOriginThreadIds(database,ids))return failure("Choose valid origin threads.",409);const materialIdNew=text(body.id,200)||id("archive-material");await database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))`).bind(materialIdNew,material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,"studio").run();await replaceMaterialOriginThreads(database,materialIdNew,ids);return json({record:{...await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialIdNew).first(),origin_thread_ids:ids}},{status:201});}
  if(request.method==="PATCH"&&materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialId).first();if(!before)return failure("Material not found.",404);const material=normalizeArchiveMaterial(body,before);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;let ids=null;if(Object.prototype.hasOwnProperty.call(body,"origin_thread_ids")||Object.prototype.hasOwnProperty.call(body,"originThreadIds")){ids=originThreadIds(body.origin_thread_ids??body.originThreadIds);if(!await validateOriginThreadIds(database,ids))return failure("Choose valid origin threads.",409)}await database.prepare(`UPDATE archive_materials SET dossier_entity_id=?,media_id=?,role=?,material_type=?,title=?,caption=?,body=?,process_phase=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,visibility=?,state=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,materialId).run();if(ids)await replaceMaterialOriginThreads(database,materialId,ids);return json({record:{...await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialId).first(),...(ids?{origin_thread_ids:ids}:{})}});}
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

function normalizeOriginThread(body,existing={}){return {slug:slug(body.slug??existing.slug),title:text(body.title??existing.title,300),summary:text(body.summary??existing.summary,8000),state:text(body.state??existing.state,30)||"draft",public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):truthy(body.public_visible??body.publicVisible)?1:0,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}

async function archiveOriginThreadsAdminApi(request,env,threadId=""){
  const database=db(env);
  if(request.method==="GET"){
    const where=threadId?"WHERE ot.id=?":"";const statement=database.prepare(`SELECT ot.*,
      (SELECT COUNT(*) FROM archive_origin_thread_dossiers otd WHERE otd.thread_id=ot.id) dossier_count,
      (SELECT COUNT(*) FROM archive_origin_thread_materials otm WHERE otm.thread_id=ot.id) material_count
      FROM archive_origin_threads ot ${where} ORDER BY ot.sort_order,ot.title`);const result=threadId?await statement.bind(threadId).all():await statement.all();const records=result.results||[];if(threadId&&!records[0])return failure("Origin thread not found.",404);return json(threadId?{record:records[0],origin_thread:records[0]}:{records,origin_threads:records,count:records.length});
  }
  if(request.method==="POST"&&!threadId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const thread=normalizeOriginThread(body);if(!thread.slug||!thread.title||!ARCHIVE_STATES.has(thread.state))return failure("Slug, title, and a valid state are required.");const newId=text(body.id,200)||id("origin-thread");await database.prepare("INSERT INTO archive_origin_threads(id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))").bind(newId,thread.slug,thread.title,thread.summary,thread.state,thread.public_visible,thread.sort_order).run();return json({record:await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(newId).first()},{status:201});}
  if(request.method==="PATCH"&&threadId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(threadId).first();if(!before)return failure("Origin thread not found.",404);const thread=normalizeOriginThread(body,before);if(!thread.slug||!thread.title||!ARCHIVE_STATES.has(thread.state))return failure("Slug, title, and a valid state are required.");await database.prepare("UPDATE archive_origin_threads SET slug=?,title=?,summary=?,state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(thread.slug,thread.title,thread.summary,thread.state,thread.public_visible,thread.sort_order,threadId).run();return json({record:await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(threadId).first()});}
  if(request.method==="DELETE"&&threadId){const found=await database.prepare("SELECT id FROM archive_origin_threads WHERE id=?").bind(threadId).first();if(!found)return failure("Origin thread not found.",404);await database.prepare("UPDATE archive_origin_threads SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(threadId).run();return json({ok:true,archived:true});}
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
  if(path==="/api/legend/composition-rules")return publicCompositionRules(request,env);
  const publicMatch=path.match(/^\/api\/(flash|legend|visual-language|art|archive|archive-collections)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,canonicalResource(publicMatch[1]),publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const legendCompositionMatch=path.match(/^\/api\/admin\/legend\/composition-rules(?:\/([^/]+))?$/);if(legendCompositionMatch)return adminCompositionRules(request,env,legendCompositionMatch[1]?decodeURIComponent(legendCompositionMatch[1]):"");
  const legendCategoryMatch=path.match(/^\/api\/admin\/legend\/categories(?:\/([^/]+))?$/);if(legendCategoryMatch)return legendCategoryApi(request,env,legendCategoryMatch[1]?decodeURIComponent(legendCategoryMatch[1]):"");
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  if(path==="/api/admin/media/uploads")return mediaUploadsApi(request,env);
  const mediaUploadPartMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/parts\/(\d+)$/);if(mediaUploadPartMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadPartMatch[1]),"part",Number(mediaUploadPartMatch[2]));
  const mediaUploadCompleteMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/complete$/);if(mediaUploadCompleteMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadCompleteMatch[1]),"complete");
  const mediaUploadSessionMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)$/);if(mediaUploadSessionMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadSessionMatch[1]));
  const mediaFileMatch=path.match(/^\/api\/admin\/media\/([^/]+)\/file$/);if(mediaFileMatch)return adminMediaFileApi(request,env,decodeURIComponent(mediaFileMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  const dossierMatch=path.match(/^\/api\/admin\/archive-dossiers(?:\/([^/]+))?$/);if(dossierMatch)return archiveDossiersAdminApi(request,env,dossierMatch[1]?decodeURIComponent(dossierMatch[1]):"");
  const materialMatch=path.match(/^\/api\/admin\/archive-materials(?:\/([^/]+))?$/);if(materialMatch)return archiveMaterialsAdminApi(request,env,materialMatch[1]?decodeURIComponent(materialMatch[1]):"");
  const activityMatch=path.match(/^\/api\/admin\/archive-activities(?:\/([^/]+))?$/);if(activityMatch)return archiveActivitiesAdminApi(request,env,activityMatch[1]?decodeURIComponent(activityMatch[1]):"");
  const originThreadMatch=path.match(/^\/api\/admin\/archive-origin-threads(?:\/([^/]+))?$/);if(originThreadMatch)return archiveOriginThreadsAdminApi(request,env,originThreadMatch[1]?decodeURIComponent(originThreadMatch[1]):"");
  const timelineChapterMatch=path.match(/^\/api\/admin\/archive-timelines\/([^/]+)\/chapters\/([^/]+)$/);if(timelineChapterMatch)return archiveTimelinesAdminApi(request,env,decodeURIComponent(timelineChapterMatch[1]),decodeURIComponent(timelineChapterMatch[2]));
  const timelineChaptersMatch=path.match(/^\/api\/admin\/archive-timelines\/([^/]+)\/chapters$/);if(timelineChaptersMatch)return archiveTimelinesAdminApi(request,env,decodeURIComponent(timelineChaptersMatch[1]),"");
  const timelineMatch=path.match(/^\/api\/admin\/archive-timelines(?:\/([^/]+))?$/);if(timelineMatch)return archiveTimelinesAdminApi(request,env,timelineMatch[1]?decodeURIComponent(timelineMatch[1]):"");
  const flashSheetDesignsMatch=path.match(/^\/api\/admin\/flash\/([^/]+)\/sheet-designs$/);if(flashSheetDesignsMatch)return flashSheetDesignsAdminApi(request,env,decodeURIComponent(flashSheetDesignsMatch[1]));
  if(path==="/api/admin/entities"&&request.method==="GET")return entityDirectory(request,env);
  const relationshipTypeMatch=path.match(/^\/api\/admin\/relationship-types(?:\/([^/]+))?$/);if(relationshipTypeMatch)return relationshipTypesApi(request,env,relationshipTypeMatch[1]?decodeURIComponent(relationshipTypeMatch[1]):"");
  const relationshipMatch=path.match(/^\/api\/admin\/relationships(?:\/([^/]+))?$/);if(relationshipMatch)return relationshipApi(request,env,relationshipMatch[1]?decodeURIComponent(relationshipMatch[1]):"");
  if(path==="/api/admin/taxonomy")return taxonomyApi(request,env);
  const entityMediaItemMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media\/([^/]+)$/);if(entityMediaItemMatch)return entityMediaApi(request,env,decodeURIComponent(entityMediaItemMatch[1]),decodeURIComponent(entityMediaItemMatch[2]));
  const entityMediaMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media$/);if(entityMediaMatch)return entityMediaApi(request,env,decodeURIComponent(entityMediaMatch[1]));
  if(path==="/api/admin/revisions"&&request.method==="GET"){const rows=(await db(env).prepare("SELECT * FROM entity_revisions ORDER BY created_at DESC LIMIT 250").all()).results||[];return json({records:rows,count:rows.length});}
  if(path==="/api/admin/search/status"&&request.method==="GET"){const counts=await db(env).prepare("SELECT COUNT(*) documents FROM search_documents").first();const failures=await db(env).prepare("SELECT COUNT(*) failures FROM search_index_failures WHERE resolved_at IS NULL").first();return json({...counts,...failures});}
  const reorderMatch=path.match(/^\/api\/admin\/([^/]+)\/reorder$/);if(reorderMatch&&request.method==="POST")return reorder(request,env,canonicalResource(reorderMatch[1]));
  const match=path.match(/^\/api\/admin\/([^/]+)(?:\/([^/]+))?$/);if(!match)return failure("Unknown Construct API route.",404);const resource=match[1],recordId=match[2]?decodeURIComponent(match[2]):"";
  const canonical=canonicalResource(resource);if(!recordId&&request.method==="GET")return adminList(env,canonical);if(!recordId&&request.method==="POST")return adminCreate(request,env,canonical);if(recordId&&request.method==="PATCH")return adminUpdate(request,env,canonical,recordId);if(recordId&&request.method==="DELETE")return adminUpdate(request,env,canonical,recordId,true);return failure("Method not allowed.",405);
}
