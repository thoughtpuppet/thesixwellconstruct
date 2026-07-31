import { db, entityMedia, failure, id, json, nextRevision, parseJson, readJson, requireStudioAdmin, RESOURCE_CONFIG, slug, text } from "../_shared/construct.js";
import { handleArchiveColorMaterialsAdmin, handleArchiveColorMaterialsPublic, projectPublicPalette } from "./_colors-materials.js";
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

function catalogOrderBy(config) {
  return config.fields.includes("sort_order") ? "sort_order,id" : "name COLLATE NOCASE,id";
}

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
  const statement = database.prepare(`SELECT * FROM ${config.table} WHERE ${where} ORDER BY ${catalogOrderBy(config)}`);
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
const ARCHIVE_CONTEXT_TYPES = new Set(["person","organization","place","event"]);
const ARCHIVE_DOCUMENTATION_FIELDS = new Set([
  "alternate-title","object-description","technique","support","dimensions","inscription",
  "edition","edition-information","background","artist-remark","installation-remark",
  "curatorial-remark","other-remark","bibliography","former-catalogue-number",
  "institutional-identifier","credit-line","other-collection","rights-permissions",
]);
const ARCHIVE_DOCUMENTATION_LABELS = {
  "alternate-title":"Alternate title",
  "object-description":"Description",
  technique:"Technique",
  support:"Support",
  dimensions:"Dimensions",
  inscription:"Inscription",
  edition:"Edition",
  "edition-information":"Edition information",
  background:"Background",
  "artist-remark":"Artist remark",
  "installation-remark":"Installation remark",
  "curatorial-remark":"Curatorial remark",
  "other-remark":"Other remark",
  bibliography:"Bibliography",
  "former-catalogue-number":"Former catalogue number",
  "institutional-identifier":"Institutional identifier",
  "credit-line":"Credit line",
  "other-collection":"Other collection",
  "rights-permissions":"Rights and permissions",
};
const ARCHIVE_SOURCE_MATERIAL_KINDS = new Set(["client-correspondence","blackboard"]);
const ARCHIVE_SOURCE_ENTRY_TYPES = new Set([
  "correspondence-page",
  "correspondence-document",
  "correspondence-text",
  "client-reference-image",
  "blackboard-whole",
  "blackboard-detail",
]);

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
const RESUMABLE_UPLOAD_MIMES = {
  video:new Set(["video/mp4","video/webm"]),
  "archive-master":new Set(["image/tiff","image/jpeg","image/png","image/webp"]),
};
const RESUMABLE_MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const RESUMABLE_MEDIA_PART_BYTES = 32 * 1024 * 1024;

function archiveFragmentPublicSql(alias="af") {
  return `(
    (${alias}.fragment_type='dossier') OR
    (${alias}.fragment_type='catalogue' AND EXISTS(SELECT 1 FROM archive_catalogue_entries ace WHERE ace.entity_id=${alias}.dossier_entity_id AND ace.entity_id=${alias}.source_id)) OR
    (${alias}.fragment_type='catalogue-documentation' AND EXISTS(SELECT 1 FROM archive_catalogue_documentation acd WHERE acd.id=${alias}.source_id AND acd.dossier_entity_id=${alias}.dossier_entity_id AND acd.public_visible=1)) OR
    (${alias}.fragment_type='event-identifier' AND EXISTS(SELECT 1 FROM archive_event_identifiers aei WHERE aei.entity_id=${alias}.dossier_entity_id AND aei.entity_id=${alias}.source_id)) OR
    (${alias}.fragment_type='theme' AND EXISTS(SELECT 1 FROM entity_terms et JOIN taxonomy_terms tt ON tt.id=et.term_id AND tt.kind='theme' AND tt.public_visible=1 WHERE et.entity_id=${alias}.dossier_entity_id AND et.term_id=${alias}.source_id)) OR
    (${alias}.fragment_type='palette-color' AND EXISTS(
      SELECT 1 FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      WHERE cu.id=${alias}.source_id AND aov.entity_id=${alias}.dossier_entity_id
        AND cu.publication_state='published' AND cu.public_visible=1
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
    )) OR
    (${alias}.fragment_type='palette-material' AND EXISTS(
      SELECT 1 FROM archive_general_material_usages gu
      JOIN archive_material_definitions md ON md.id=gu.material_id
      JOIN archive_object_states aos ON aos.id=gu.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      WHERE gu.id=${alias}.source_id AND aov.entity_id=${alias}.dossier_entity_id
        AND gu.publication_state='published' AND gu.public_visible=1
        AND md.publication_state='published' AND md.public_visible=1
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
    )) OR
    (${alias}.fragment_type='material' AND EXISTS(SELECT 1 FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.id=${alias}.source_id AND am.dossier_entity_id=${alias}.dossier_entity_id AND am.state='published' AND am.visibility='public' AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline')))) OR
    (${alias}.fragment_type='source-material' AND EXISTS(
      SELECT 1 FROM archive_source_material_sets sms
      WHERE sms.id=${alias}.source_id AND sms.dossier_entity_id=${alias}.dossier_entity_id
        AND sms.publication_state='published' AND sms.visibility='public'
        AND sms.permission_status IN ('not-required','granted')
        AND EXISTS(
          SELECT 1 FROM archive_source_material_states smss
          JOIN archive_object_states aos ON aos.id=smss.state_id
          JOIN archive_object_versions aov ON aov.id=aos.version_id
          WHERE smss.source_material_set_id=sms.id AND aov.entity_id=sms.dossier_entity_id
            AND aos.publication_state='published' AND aos.public_visible=1
            AND aov.publication_state='published' AND aov.public_visible=1
        )
        AND EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          WHERE smse.source_material_set_id=sms.id AND smse.public_included=1
        )
        AND NOT EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          LEFT JOIN media_assets smse_media ON smse_media.id=smse.media_id
          WHERE smse.source_material_set_id=sms.id AND smse.public_included=1
            AND smse.media_id IS NOT NULL
            AND (
              smse_media.id IS NULL OR smse_media.state<>'active' OR smse_media.privacy<>'public'
              OR smse_media.consent_status NOT IN ('not-required','granted')
              OR smse_media.public_presentation<>'inline'
            )
        )
    )) OR
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
    ace.catalogue_id,ace.catalogue_prefix,ace.catalogue_number,ace.current_state_id,
    COALESCE(current_version_row.version_number,ace.current_version) current_version,
    COALESCE(current_state_row.state_roman,ace.current_state) current_state,
    COALESCE(current_state_row.variant_label,ace.variant_label) catalogue_variant,
    current_state_row.publication_state current_state_publication,
    current_state_row.public_visible current_state_public_visible,
    ace.medium_id catalogue_medium,cot.label cultural_object_type,cot.id cultural_object_type_id,cot.state_guidance,
    acm.label catalogue_medium_label,
    aei.event_id,aei.event_number,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.title WHEN 'merch_item' THEN mi.title
      WHEN 'portfolio_item' THEN COALESCE(NULLIF(pi.title,''),'Untitled tattoo')
      WHEN 'flash_item' THEN fi.title WHEN 'tattoo_design' THEN td.title WHEN 'event' THEN ev.title
      WHEN 'visual_symbol' THEN vs.name ELSE COALESCE(sd.title,ad.archive_slug) END title,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.statement WHEN 'merch_item' THEN mi.product_type
      WHEN 'portfolio_item' THEN pi.caption WHEN 'flash_item' THEN fi.description
      WHEN 'tattoo_design' THEN td.description
      WHEN 'event' THEN ev.description WHEN 'visual_symbol' THEN vs.meaning
      ELSE COALESCE(sd.summary,'') END canonical_summary,
    CASE ce.entity_type
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/'||aw.slug||'/')
      WHEN 'merch_item' THEN mi.route
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'tattoo_design' THEN ''
      WHEN 'event' THEN '/events/'||ev.slug||'/'
      WHEN 'visual_symbol' THEN '/about/legend/'||vs.slug||'/'
      ELSE COALESCE(sd.route,'') END canonical_route,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.year WHEN 'portfolio_item' THEN pi.year
      WHEN 'event' THEN COALESCE(ev.starts_at,'') ELSE COALESCE(sd.date_label,'') END canonical_date,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.medium WHEN 'portfolio_item' THEN pi.primary_style
      WHEN 'flash_item' THEN fi.item_type WHEN 'merch_item' THEN mi.product_type
      WHEN 'tattoo_design' THEN td.design_type
      WHEN 'event' THEN 'event' WHEN 'visual_symbol' THEN 'symbol' ELSE '' END medium,
    COALESCE(
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id
          AND am.state='published' AND am.visibility='public'
          AND m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted')
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
        LIMIT 1),
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      CASE WHEN ce.entity_type='portfolio_item' AND pi.state='published' THEN
        CASE WHEN COALESCE(NULLIF(pi.cover_image_ref,''),'primary')='primary'
          AND pi.primary_consent_status IN ('not-required','granted')
          THEN COALESCE(NULLIF(pi.source_url,''),CASE WHEN pi.storage_key<>'' THEN '/api/portfolio/media/'||pi.id END)
        ELSE (SELECT COALESCE(NULLIF(cover.source_url,''),'/api/construct/entity-media/'||cover.id)
          FROM entity_media cover_attachment JOIN media_assets cover ON cover.id=cover_attachment.media_id
          LEFT JOIN portfolio_image_details cover_details ON cover_details.portfolio_item_id=cover_attachment.entity_id AND cover_details.image_ref=cover_attachment.media_id
          WHERE cover_attachment.entity_id=pi.id AND cover_attachment.media_id=pi.cover_image_ref
            AND cover_attachment.role='gallery' AND cover_attachment.public_visible=1
            AND cover.state='active' AND cover.privacy='public' AND cover.consent_status IN ('not-required','granted')
            AND cover.public_presentation='inline' AND cover.mime_type LIKE 'image/%'
            AND COALESCE(cover_details.image_role,'result')='result'
          LIMIT 1) END END,
      CASE WHEN ce.entity_type='merch_item' THEN NULLIF(mi.image_url,'') END,
      CASE WHEN ce.entity_type='event' THEN NULLIF(ev.image_url,'') END,
      CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(NULLIF(vs.image_url,''),NULLIF(json_extract(vs.examples_json,'$[0].src'),'')) END,
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/entity-media/'||m.id)
        FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1
          AND m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted')
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),
      ''
    ) primary_image,
    CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(vs.svg_markup,'') ELSE '' END primary_svg_markup,
    (SELECT group_concat(material_type) FROM (
      SELECT DISTINCT am.material_type material_type FROM archive_materials am
      LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      ORDER BY am.material_type)) material_types,
    (SELECT COUNT(*) FROM archive_object_states public_state_counted
      JOIN archive_object_versions public_version_counted ON public_version_counted.id=public_state_counted.version_id
      WHERE public_version_counted.entity_id=ad.entity_id
        AND public_version_counted.publication_state='published' AND public_version_counted.public_visible=1
        AND public_state_counted.publication_state='published' AND public_state_counted.public_visible=1) public_state_count
  FROM archive_dossiers ad
  JOIN content_entities ce ON ce.id=ad.entity_id
  LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id
  LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id
  LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id
  LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id
  LEFT JOIN tattoo_designs td ON ce.entity_type='tattoo_design' AND td.id=ce.id
  LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
  LEFT JOIN search_documents sd ON sd.entity_id=ce.id
  LEFT JOIN archive_catalogue_entries ace ON ace.entity_id=ad.entity_id
  LEFT JOIN archive_object_states current_state_row ON current_state_row.id=ace.current_state_id
  LEFT JOIN archive_object_versions current_version_row ON current_version_row.id=current_state_row.version_id
  LEFT JOIN archive_cultural_object_types cot ON cot.id=ace.object_type_id
  LEFT JOIN archive_catalogue_media acm ON acm.id=ace.medium_id
  LEFT JOIN archive_event_identifiers aei ON aei.entity_id=ad.entity_id
  WHERE ${where}`;
}

function archiveCatalogueLabel(row) {
  if (!row?.catalogue_id) return "";
  if (!row.current_state_id) return row.catalogue_id;
  const version = Math.max(1, Number(row.current_version || 1));
  const state = text(row.current_state, 20).toUpperCase() || "I";
  const variant = text(row.catalogue_variant || row.variant_label, 120);
  return `${row.catalogue_id}.${version}/${state}${variant ? `, ${variant}` : ""}`;
}

function archiveDigitalAssetType(mimeType="") {
  const mime=String(mimeType||"").toLowerCase();
  if(mime.startsWith("image/"))return "image";
  if(mime.startsWith("video/"))return "video";
  if(mime.startsWith("audio/"))return "audio";
  if(mime==="application/pdf"||mime.includes("document")||mime.includes("word"))return "document";
  return "file";
}

function presentArchiveMaterial(row,admin=false) {
  if(!row)return null;
  const digitalAsset=row.media_id?{
    id:row.media_id,
    kind:"digital-asset",
    asset_type:archiveDigitalAssetType(row.mime_type),
    mime_type:row.mime_type||"",
    width:Number(row.width||0)||null,
    height:Number(row.height||0)||null,
    duration_seconds:Number(row.duration_seconds||0)||null,
    alt_text:row.alt_text||"",
    title:row.public_title||row.title||"",
    description:row.public_description||row.media_caption||row.caption||"",
    presentation:row.public_presentation||"inline",
    transcript:row.transcript_status==="ready"?(row.transcript||""):"",
    transcript_language:row.transcript_status==="ready"?(row.transcript_language||""):"",
    url:row.media_url||row.url||"",
    ...(admin?{
      original_filename:row.original_filename||"",
      byte_size:Number(row.byte_size||0),
      privacy:row.media_privacy||"internal",
      consent_status:row.consent_status||"not-required",
      state:row.media_state||"active",
      transcript_status:row.transcript_status||"not-requested",
      transcript_language:row.transcript_language||"",
    }:{})
  }:null;
  return {...row,digital_asset:digitalAsset,digitalAsset};
}

function presentArchiveSourceEntry(row,admin=false){
  if(!row)return null;
  const digitalAsset=row.media_id?{
    id:row.media_id,
    kind:"digital-asset",
    asset_type:archiveDigitalAssetType(row.mime_type),
    mime_type:row.mime_type||"",
    width:Number(row.width||0)||null,
    height:Number(row.height||0)||null,
    duration_seconds:Number(row.duration_seconds||0)||null,
    alt_text:row.alt_text||"",
    title:row.public_title||row.title||"",
    description:row.public_description||row.media_caption||row.caption||"",
    presentation:row.public_presentation||"inline",
    url:row.media_url||row.url||"",
    ...(admin?{
      original_filename:row.original_filename||"",
      byte_size:Number(row.byte_size||0),
      privacy:row.media_privacy||"internal",
      consent_status:row.consent_status||"not-required",
      state:row.media_state||"active",
    }:{}),
  }:null;
  const entry={
    id:row.id,
    entry_type:row.entry_type,
    entryType:row.entry_type,
    title:row.title||"",
    caption:row.caption||"",
    body:row.body||"",
    sort_order:Number(row.sort_order||0),
    sortOrder:Number(row.sort_order||0),
    digital_asset:digitalAsset,
    digitalAsset,
  };
  if(admin){
    entry.source_material_set_id=row.source_material_set_id;
    entry.sourceMaterialSetId=row.source_material_set_id;
    entry.media_id=row.media_id||null;
    entry.mediaId=row.media_id||null;
    entry.public_included=Number(row.public_included)!==0;
    entry.publicIncluded=Number(row.public_included)!==0;
  }
  return entry;
}

function presentArchiveSourceMaterialSet(row,entries=[],stateLinks=[],admin=false){
  if(!row)return null;
  const references=stateLinks.map(link=>link.document_reference).filter(Boolean);
  const blackboard=row.source_kind==="blackboard";
  const record={
    id:row.id,
    kind:"source-material-set",
    source_kind:row.source_kind||"client-correspondence",
    sourceKind:row.source_kind||"client-correspondence",
    label:blackboard?"Blackboard source":"Client correspondence",
    participant_label:blackboard?"Studio":"Client",
    participantLabel:blackboard?"Studio":"Client",
    title:row.title||(blackboard?"Blackboard source":"Client correspondence"),
    board_entity_id:row.board_entity_id||null,
    boardEntityId:row.board_entity_id||null,
    caption:row.caption||"",
    occurred_at:row.occurred_at||null,
    occurredAt:row.occurred_at||null,
    ended_at:row.ended_at||null,
    endedAt:row.ended_at||null,
    date_precision:row.date_precision||"undated",
    datePrecision:row.date_precision||"undated",
    date_label:row.date_label||"",
    dateLabel:row.date_label||"",
    sort_order:Number(row.sort_order||0),
    sortOrder:Number(row.sort_order||0),
    anchor:`source-material-${String(row.id||"").replace(/[^a-zA-Z0-9_-]+/g,"-")}`,
    references,
    state_links:stateLinks,
    stateLinks,
    entries,
  };
  if(admin){
    record.dossier_entity_id=row.dossier_entity_id;
    record.dossierEntityId=row.dossier_entity_id;
    record.visibility=row.visibility||"internal";
    record.publication_state=row.publication_state||"draft";
    record.publicationState=row.publication_state||"draft";
    record.permission_status=row.permission_status||"not-required";
    record.permissionStatus=row.permission_status||"not-required";
  }
  return record;
}

function archiveStateAnchor(stateId="") {
  return `state-${String(stateId||"").replace(/[^a-zA-Z0-9_-]+/g,"-")}`;
}

function presentArchiveState(row,item=null) {
  if(!row)return null;
  const versionNumber=Number(row.version_number||1);
  const roman=text(row.state_roman,20).toUpperCase()||"I";
  const variant=text(row.variant_label,120);
  const base=item?.catalogue_id||row.catalogue_id||"";
  const catalogueLabel=base?`${base}.${versionNumber}/${roman}${variant?`, ${variant}`:""}`:`Version ${versionNumber}, State ${roman}${variant?`, ${variant}`:""}`;
  let leadMaterial=null;
  if(row.lead_id){
    leadMaterial=presentArchiveMaterial({
      id:row.lead_id,
      dossier_entity_id:row.entity_id,
      media_id:row.lead_media_id,
      material_reference:row.lead_material_reference,
      material_type:row.lead_material_type,
      title:row.lead_title,
      caption:row.lead_caption,
      body:row.lead_body,
      mime_type:row.lead_mime_type,
      width:row.lead_width,
      height:row.lead_height,
      duration_seconds:row.lead_duration_seconds,
      alt_text:row.lead_alt_text,
      public_title:row.lead_public_title,
      public_description:row.lead_public_description,
      public_presentation:row.lead_public_presentation,
      transcript:row.lead_transcript,
      transcript_status:row.lead_transcript_status,
      transcript_language:row.lead_transcript_language,
      media_url:row.lead_media_url||"",
      url:row.lead_media_url||"",
    });
  }
  return {
    ...row,
    anchor:archiveStateAnchor(row.id),
    catalogue_label:catalogueLabel,
    catalogueLabel,
    is_current:Boolean(item?.current_state_id&&item.current_state_id===row.id),
    isCurrent:Boolean(item?.current_state_id&&item.current_state_id===row.id),
    lead_material:leadMaterial,
    leadMaterial,
  };
}

function presentArchiveDocumentation(row) {
  if(!row)return null;
  const fieldKey=text(row.field_key,80);
  return {
    id:row.id,
    dossier_entity_id:row.dossier_entity_id,
    dossierEntityId:row.dossier_entity_id,
    field_key:fieldKey,
    fieldKey,
    default_label:ARCHIVE_DOCUMENTATION_LABELS[fieldKey]||fieldKey.replace(/-/g," "),
    defaultLabel:ARCHIVE_DOCUMENTATION_LABELS[fieldKey]||fieldKey.replace(/-/g," "),
    label:row.label||"",
    value:row.value||"",
    citation:row.citation||"",
    url:row.url||"",
    public_visible:Boolean(Number(row.public_visible)),
    publicVisible:Boolean(Number(row.public_visible)),
    sort_order:Number(row.sort_order||0),
    sortOrder:Number(row.sort_order||0),
  };
}

function presentArchiveItem(row) {
  if (!row) return null;
  const materialTypes = String(row.material_types || "").split(",").filter(Boolean);
  const summary = row.orientation || row.canonical_summary || "";
  const archiveRoute = `/archive/records/${encodeURIComponent(row.archive_slug)}/`;
  const primarySvgMarkup = row.primary_svg_markup ? sanitizeLegendSvg(row.primary_svg_markup) : "";
  const primaryMedia = row.primary_image
    ? { url: row.primary_image, kind: "image" }
    : primarySvgMarkup
      ? { svg_markup: primarySvgMarkup, svgMarkup: primarySvgMarkup, kind: "symbol" }
      : null;
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
    catalogue_id: row.catalogue_id || "",
    catalogueId: row.catalogue_id || "",
    catalogue_label: archiveCatalogueLabel(row),
    catalogueLabel: archiveCatalogueLabel(row),
    catalogue_prefix: row.catalogue_prefix || "",
    catalogue_number: Number(row.catalogue_number || 0),
    catalogue_medium: row.catalogue_medium || "",
    catalogueMedium: row.catalogue_medium || "",
    catalogue_medium_label: row.catalogue_medium_label || "",
    cultural_object_type: row.cultural_object_type || "",
    culturalObjectType: row.cultural_object_type || "",
    cultural_object_type_id: row.cultural_object_type_id || "",
    current_version: Number(row.current_version || 1),
    current_state: row.current_state || "I",
    current_state_id: row.current_state_id || "",
    currentStateId: row.current_state_id || "",
    catalogue_variant: row.catalogue_variant || "",
    state_guidance: row.state_guidance || "",
    event_id: row.event_id || "",
    eventId: row.event_id || "",
    event_number: Number(row.event_number || 0),
    eventNumber: Number(row.event_number || 0),
    record_identifier: row.catalogue_id ? archiveCatalogueLabel(row) : row.event_id || "",
    recordIdentifier: row.catalogue_id ? archiveCatalogueLabel(row) : row.event_id || "",
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
    primary_svg_markup: primarySvgMarkup,
    primarySvgMarkup,
    primary_media: primaryMedia,
    material_types: materialTypes,
    materialTypes,
    featured: Number(row.featured || 0),
    updated_at: row.updated_at,
  };
}

function archivePublicColorUsageSourceSql(alias = "cu") {
  return `((
    ${alias}.recipe_version_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM archive_color_recipe_versions eligible_rv
      JOIN archive_color_recipes eligible_r ON eligible_r.id=eligible_rv.recipe_id
      WHERE eligible_rv.id=${alias}.recipe_version_id
        AND eligible_rv.publication_state='published' AND eligible_rv.public_visible=1
        AND eligible_r.publication_state='published' AND eligible_r.public_visible=1
    )
  ) OR (
    ${alias}.formulation_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM archive_material_formulations eligible_mf
      JOIN archive_material_definitions eligible_md ON eligible_md.id=eligible_mf.material_id
      WHERE eligible_mf.id=${alias}.formulation_id
        AND eligible_mf.publication_state='published' AND eligible_mf.public_visible=1
        AND eligible_md.publication_state='published' AND eligible_md.public_visible=1
    )
  ))`;
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
  const color=text(url.searchParams.get("color"),160).toLowerCase();
  const colorMatch=["exact","lineage","similar"].includes(url.searchParams.get("match"))?url.searchParams.get("match"):"exact";
  if(color){
    const requestedVersion=`SELECT rv_target.id
      FROM archive_color_recipes r_target
      JOIN archive_color_recipe_versions rv_target ON rv_target.recipe_id=r_target.id
      WHERE r_target.slug=? AND r_target.publication_state='published' AND r_target.public_visible=1
        AND rv_target.publication_state='published' AND rv_target.public_visible=1
      ORDER BY rv_target.version_number DESC LIMIT 1`;
    if(colorMatch==="exact"){
      conditions.push(`EXISTS(
        SELECT 1 FROM archive_color_usages cu
        JOIN archive_object_states aos ON aos.id=cu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        WHERE aov.entity_id=${alias}.entity_id AND cu.recipe_version_id=(${requestedVersion})
          AND cu.publication_state='published' AND cu.public_visible=1
          AND ${archivePublicColorUsageSourceSql("cu")}
          AND aos.publication_state='published' AND aos.public_visible=1
          AND aov.publication_state='published' AND aov.public_visible=1
      )`);
      values.push(color);
    }else if(colorMatch==="lineage"){
      conditions.push(`EXISTS(
        SELECT 1 FROM archive_color_usages cu
        JOIN archive_object_states aos ON aos.id=cu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        JOIN archive_color_recipe_versions rv ON rv.id=cu.recipe_version_id
        JOIN archive_color_recipes r ON r.id=rv.recipe_id
        WHERE aov.entity_id=${alias}.entity_id AND r.slug=?
          AND rv.publication_state='published' AND rv.public_visible=1
          AND r.publication_state='published' AND r.public_visible=1
          AND cu.publication_state='published' AND cu.public_visible=1
          AND ${archivePublicColorUsageSourceSql("cu")}
          AND aos.publication_state='published' AND aos.public_visible=1
          AND aov.publication_state='published' AND aov.public_visible=1
      )`);
      values.push(color);
    }else{
      conditions.push(`EXISTS(
        SELECT 1 FROM archive_color_usages cu
        JOIN archive_object_states aos ON aos.id=cu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        JOIN archive_color_profiles used_profile ON
          (used_profile.source_type='recipe-version' AND used_profile.source_id=cu.recipe_version_id)
          OR (used_profile.source_type='material-formulation' AND used_profile.source_id=cu.formulation_id)
        JOIN archive_color_profiles target_profile ON target_profile.source_type='recipe-version'
          AND target_profile.source_id=(${requestedVersion})
        JOIN archive_color_neighbors neighbor ON neighbor.profile_id=target_profile.id
          AND neighbor.neighbor_profile_id=used_profile.id AND neighbor.delta_e<=10
        WHERE aov.entity_id=${alias}.entity_id
          AND cu.publication_state='published' AND cu.public_visible=1
          AND ${archivePublicColorUsageSourceSql("cu")}
          AND aos.publication_state='published' AND aos.public_visible=1
          AND aov.publication_state='published' AND aov.public_visible=1
      )`);
      values.push(color);
    }
  }
  const colorFamily=text(url.searchParams.get("color_family"),160).toLowerCase();
  if(colorFamily){
    conditions.push(`EXISTS(
      SELECT 1 FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      JOIN archive_color_profiles cp ON
        (cp.source_type='recipe-version' AND cp.source_id=cu.recipe_version_id)
        OR (cp.source_type='material-formulation' AND cp.source_id=cu.formulation_id)
      JOIN archive_color_profile_families cpf ON cpf.profile_id=cp.id
      JOIN archive_color_families cf ON cf.id=cpf.family_id
      WHERE aov.entity_id=${alias}.entity_id AND cf.slug=?
        AND cf.publication_state='published' AND cf.public_visible=1
        AND cu.publication_state='published' AND cu.public_visible=1
        AND ${archivePublicColorUsageSourceSql("cu")}
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
    )`);
    values.push(colorFamily);
  }
  const pigment=text(url.searchParams.get("pigment"),120).toUpperCase();
  const pigmentPresence=["direct","declared","any"].includes(url.searchParams.get("presence"))?url.searchParams.get("presence"):"any";
  if(pigment){
    const directSql=`EXISTS(
      SELECT 1 FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      JOIN archive_color_recipe_components rc ON rc.recipe_version_id=cu.recipe_version_id
      JOIN archive_material_definitions pigment_material ON pigment_material.id=rc.raw_pigment_material_id
      WHERE aov.entity_id=${alias}.entity_id AND upper(pigment_material.pigment_code)=?
        AND cu.publication_state='published' AND cu.public_visible=1
        AND ${archivePublicColorUsageSourceSql("cu")}
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
    )`;
    const declaredSql=`EXISTS(
      SELECT 1 FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      LEFT JOIN archive_color_recipe_components rc ON rc.recipe_version_id=cu.recipe_version_id
      JOIN archive_material_declared_pigments dp ON dp.formulation_id=COALESCE(cu.formulation_id,rc.formulation_id)
      WHERE aov.entity_id=${alias}.entity_id AND upper(dp.normalized_pigment_code)=?
        AND cu.publication_state='published' AND cu.public_visible=1
        AND ${archivePublicColorUsageSourceSql("cu")}
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
    )`;
    if(pigmentPresence==="direct"){conditions.push(directSql);values.push(pigment)}
    else if(pigmentPresence==="declared"){conditions.push(declaredSql);values.push(pigment)}
    else{conditions.push(`(${directSql} OR ${declaredSql})`);values.push(pigment,pigment)}
  }
  const material=text(url.searchParams.get("material"),160).toLowerCase();
  if(material){
    conditions.push(`(
      EXISTS(
        SELECT 1 FROM archive_general_material_usages gu
        JOIN archive_object_states aos ON aos.id=gu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        JOIN archive_material_definitions md ON md.id=gu.material_id
        WHERE aov.entity_id=${alias}.entity_id AND md.slug=?
          AND gu.publication_state='published' AND gu.public_visible=1
          AND md.publication_state='published' AND md.public_visible=1
          AND aos.publication_state='published' AND aos.public_visible=1
          AND aov.publication_state='published' AND aov.public_visible=1
      )
      OR EXISTS(
        SELECT 1 FROM archive_color_usages cu
        JOIN archive_object_states aos ON aos.id=cu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        LEFT JOIN archive_color_recipe_components rc ON rc.recipe_version_id=cu.recipe_version_id
        LEFT JOIN archive_material_formulations mf ON mf.id=COALESCE(cu.formulation_id,rc.formulation_id)
        LEFT JOIN archive_material_definitions md ON md.id=COALESCE(mf.material_id,rc.raw_pigment_material_id)
        WHERE aov.entity_id=${alias}.entity_id AND md.slug=?
          AND cu.publication_state='published' AND cu.public_visible=1
          AND ${archivePublicColorUsageSourceSql("cu")}
          AND aos.publication_state='published' AND aos.public_visible=1
          AND aov.publication_state='published' AND aov.public_visible=1
      )
    )`);
    values.push(material,material);
  }
  return { conditions, values, q };
}

async function archiveUsageMatchProvenance(database,items,url){
  const byEntity=new Map(items.map(item=>[item.entity_id,[]])),ids=[...byEntity.keys()];
  if(!ids.length)return byEntity;
  const color=text(url.searchParams.get("color"),160).toLowerCase(),match=["exact","lineage","similar"].includes(url.searchParams.get("match"))?url.searchParams.get("match"):"exact";
  if(color){
    const target=await database.prepare(`SELECT r.name,rv.id version_id,rv.version_number,cp.id profile_id
      FROM archive_color_recipes r JOIN archive_color_recipe_versions rv ON rv.recipe_id=r.id
      LEFT JOIN archive_color_profiles cp ON cp.source_type='recipe-version' AND cp.source_id=rv.id
      WHERE r.slug=? AND r.publication_state='published' AND r.public_visible=1
        AND rv.publication_state='published' AND rv.public_visible=1
      ORDER BY rv.version_number DESC LIMIT 1`).bind(color).first();
    if(target){
      if(match==="similar"){
        const rows=(await database.prepare(`SELECT aov.entity_id,MIN(n.delta_e) distance
          FROM archive_color_usages cu
          JOIN archive_object_states aos ON aos.id=cu.state_id
          JOIN archive_object_versions aov ON aov.id=aos.version_id
          JOIN archive_color_profiles cp ON
            (cp.source_type='recipe-version' AND cp.source_id=cu.recipe_version_id)
            OR (cp.source_type='material-formulation' AND cp.source_id=cu.formulation_id)
          JOIN archive_color_neighbors n ON n.profile_id=? AND n.neighbor_profile_id=cp.id
          WHERE aov.entity_id IN (${ids.map(()=>"?").join(",")}) AND n.delta_e<=10
            AND cu.publication_state='published' AND cu.public_visible=1
            AND ${archivePublicColorUsageSourceSql("cu")}
            AND aos.publication_state='published' AND aos.public_visible=1
            AND aov.publication_state='published' AND aov.public_visible=1
          GROUP BY aov.entity_id`).bind(target.profile_id,...ids).all()).results||[];
        rows.forEach(row=>byEntity.get(row.entity_id)?.push({type:"perceptually-similar",color_slug:color,color_name:target.name,distance:Number(Number(row.distance).toFixed(3)),metric:"CIEDE2000"}));
      }else{
        items.forEach(item=>byEntity.get(item.entity_id)?.push({type:match==="exact"?"exact-recipe-version":"same-named-recipe",color_slug:color,color_name:target.name,version:match==="exact"?Number(target.version_number):undefined}));
      }
    }
  }
  const family=text(url.searchParams.get("color_family"),160).toLowerCase();
  if(family){const found=await database.prepare("SELECT name FROM archive_color_families WHERE slug=? AND publication_state='published' AND public_visible=1").bind(family).first();items.forEach(item=>byEntity.get(item.entity_id)?.push({type:"curated-family",family_slug:family,family_name:found?.name||family,human_confirmed:true}))}
  const pigment=text(url.searchParams.get("pigment"),120).toUpperCase(),presence=["direct","declared","any"].includes(url.searchParams.get("presence"))?url.searchParams.get("presence"):"any";
  if(pigment){
    const direct=(await database.prepare(`SELECT DISTINCT aov.entity_id
      FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id JOIN archive_object_versions aov ON aov.id=aos.version_id
      JOIN archive_color_recipe_components rc ON rc.recipe_version_id=cu.recipe_version_id
      JOIN archive_material_definitions md ON md.id=rc.raw_pigment_material_id
      WHERE aov.entity_id IN (${ids.map(()=>"?").join(",")}) AND upper(md.pigment_code)=?
        AND cu.publication_state='published' AND cu.public_visible=1
        AND ${archivePublicColorUsageSourceSql("cu")}
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1`).bind(...ids,pigment).all()).results||[];
    const declared=(await database.prepare(`SELECT DISTINCT aov.entity_id
      FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id JOIN archive_object_versions aov ON aov.id=aos.version_id
      LEFT JOIN archive_color_recipe_components rc ON rc.recipe_version_id=cu.recipe_version_id
      JOIN archive_material_declared_pigments dp ON dp.formulation_id=COALESCE(cu.formulation_id,rc.formulation_id)
      WHERE aov.entity_id IN (${ids.map(()=>"?").join(",")}) AND upper(dp.normalized_pigment_code)=?
        AND cu.publication_state='published' AND cu.public_visible=1
        AND ${archivePublicColorUsageSourceSql("cu")}
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1`).bind(...ids,pigment).all()).results||[];
    if(presence!=="declared")direct.forEach(row=>byEntity.get(row.entity_id)?.push({type:"direct-raw-pigment",pigment_code:pigment,provenance:"artist-added"}));
    if(presence!=="direct")declared.forEach(row=>byEntity.get(row.entity_id)?.push({type:"manufacturer-declared-pigment",pigment_code:pigment,provenance:"product-metadata"}));
  }
  const material=text(url.searchParams.get("material"),160).toLowerCase();
  if(material){const found=await database.prepare("SELECT name,material_kind FROM archive_material_definitions WHERE slug=? AND publication_state='published' AND public_visible=1").bind(material).first();items.forEach(item=>byEntity.get(item.entity_id)?.push({type:"material-usage",material_slug:material,material_name:found?.name||material,material_kind:found?.material_kind||""}))}
  return byEntity;
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
  const usageMatches=await archiveUsageMatchProvenance(database,items,url);
  items=items.map(item=>({...item,matches:usageMatches.get(item.entity_id)||[]}));
  let evidence=[],currentRecordPosition=null;
  if(originThread){
    const assignments=items.length?(await database.prepare(`SELECT dossier_entity_id,is_primary,sort_order FROM archive_origin_thread_dossiers WHERE thread_id=? AND dossier_entity_id IN (${items.map(()=>"?").join(",")})`).bind(originThread.id,...items.map(item=>item.entity_id)).all()).results||[]:[];
    const assignmentMap=new Map(assignments.map(row=>[row.dossier_entity_id,row]));
    const currentId=text(url.searchParams.get("from"),200);
    items=items.map(item=>{const assignment=assignmentMap.get(item.entity_id)||{},isCurrent=Boolean(currentId&&(currentId===item.entity_id||currentId===item.archive_slug));return {...item,origin_thread_role:Number(assignment.is_primary)?"primary":"supporting",origin_position:Number(assignment.sort_order||0),is_current:isCurrent}}).sort((a,b)=>a.origin_position-b.origin_position||a.title.localeCompare(b.title));
    const currentItem=items.find(item=>item.is_current);if(currentItem)currentRecordPosition=currentItem.origin_position;
    const evidenceRows=(await database.prepare(`SELECT am.*,otm.sort_order origin_sort_order,ad.archive_slug,
        COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END) media_url,
        m.mime_type,m.width,m.height,m.duration_seconds,m.alt_text,m.public_title,m.public_description,
        m.transcript,m.transcript_status,m.transcript_language,m.public_presentation
      FROM archive_origin_thread_materials otm
      JOIN archive_materials am ON am.id=otm.material_id AND am.state='published' AND am.visibility='public'
      JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE otm.thread_id=? AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
      ORDER BY CASE WHEN am.occurred_at IS NULL THEN 1 ELSE 0 END,am.occurred_at,otm.sort_order,am.sort_order,am.created_at`).bind(originThread.id).all()).results||[];
    evidence=evidenceRows.map((row,index)=>presentArchiveMaterial({...row,url:row.media_url||"",archive_route:`/archive/records/${encodeURIComponent(row.archive_slug)}/#material-${encodeURIComponent(row.id)}`,origin_position:index+1}));
  }
  const facets={medium:[],brand:[],person:[],era:[],collection:collectionFacetResult.results||[],record_type:[],material_type:materialFacetResult.results||[]};
  for(const facet of facetResult.results||[]){if(facets[facet.kind])facets[facet.kind].push({name:facet.name,slug:facet.slug,count:Number(facet.count||0)});}
  const pagination={page,limit,total,total_pages:Math.max(1,Math.ceil(total/limit)),totalPages:Math.max(1,Math.ceil(total/limit))};
  const groups={
    paintings:items.filter(item=>item.catalogue_medium==="art"),
    tattoo_designs:items.filter(item=>item.catalogue_prefix==="TAT-DES"),
    tattoo_executions:items.filter(item=>item.catalogue_prefix==="TAT-EXE"),
    other:items.filter(item=>item.catalogue_medium!=="art"&&!['TAT-DES','TAT-EXE'].includes(item.catalogue_prefix)),
  };
  return json({items,records:items,groups,facets,pagination,count:items.length,query:q,origin_thread:originThread,originThread,evidence,current_record_position:currentRecordPosition,currentRecordPosition},{cache:"public, max-age=30"});
}

async function publicArchiveDetail(request,env,archiveSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(archiveEntitySql("ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND (ad.archive_slug=? OR ad.entity_id=?)")).bind(archiveSlug,archiveSlug).first();
  if(!row)return failure("Archive item not found.",404);
  const item=presentArchiveItem(row),entityId=row.entity_id;
  const [materialsResult,activitiesResult,subjectsResult,collectionsResult,relationshipsResult,originThreadsResult,versionsResult,statesResult,termsResult,documentationResult,sourceMaterialSetsResult,sourceMaterialEntriesResult,sourceMaterialStatesResult]=await database.batch([
    database.prepare(`SELECT am.*,m.mime_type,m.width,m.height,m.duration_seconds,m.alt_text,m.public_title,m.public_description,
        CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END transcript,m.transcript_status,m.transcript_language,m.public_presentation,
        CASE WHEN m.public_presentation='inline' THEN COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END) ELSE '' END media_url
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=? AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'))
        AND (
          NOT EXISTS(SELECT 1 FROM archive_catalogue_entries ace WHERE ace.entity_id=am.dossier_entity_id)
          OR EXISTS(
            SELECT 1 FROM archive_object_states public_state
            JOIN archive_object_versions public_version ON public_version.id=public_state.version_id
            WHERE public_state.id=am.state_id
              AND public_state.publication_state='published' AND public_state.public_visible=1
              AND public_version.publication_state='published' AND public_version.public_visible=1
          )
        )
      ORDER BY CASE WHEN am.occurred_at IS NULL THEN 1 ELSE 0 END,am.occurred_at,am.sort_order,am.created_at`).bind(entityId),
    database.prepare(`SELECT ea.*,('history-'||ea.id) anchor FROM entity_activity ea
      WHERE ea.entity_id=? AND ea.public_visible=1
      ORDER BY CASE WHEN ea.occurred_at IS NULL THEN 1 ELSE 0 END,ea.occurred_at,ea.sort_order,ea.created_at`).bind(entityId),
    database.prepare(`SELECT ads.subject_entity_id entity_id,ads.role,ads.sort_order,ce.entity_type,
        COALESCE(o.name,p.name,pl.name,ev.title,n.name,ce.id) name,
        COALESCE(o.slug,p.slug,pl.slug,ev.slug,n.slug,'') slug
      FROM archive_dossier_subjects ads JOIN content_entities ce ON ce.id=ads.subject_entity_id AND ce.visibility='public'
      LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
      LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
      LEFT JOIN places pl ON pl.id=ce.id AND pl.state='published' AND pl.privacy='public'
      LEFT JOIN events ev ON ev.id=ce.id AND ev.status<>'archived'
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
    database.prepare(`SELECT * FROM archive_object_versions aov
      WHERE aov.entity_id=? AND aov.publication_state='published' AND aov.public_visible=1
        AND EXISTS(SELECT 1 FROM archive_object_states aos WHERE aos.version_id=aov.id AND aos.publication_state='published' AND aos.public_visible=1)
      ORDER BY aov.sort_order,aov.version_number`).bind(entityId),
    database.prepare(`SELECT aos.*,aov.entity_id,aov.version_number,
        CASE WHEN lead_media.id IS NOT NULL THEN lead.id END lead_id,
        lead.media_id lead_media_id,lead.material_reference lead_material_reference,
        lead.material_type lead_material_type,lead.title lead_title,lead.caption lead_caption,lead.body lead_body,
        lead_media.mime_type lead_mime_type,lead_media.width lead_width,lead_media.height lead_height,
        lead_media.duration_seconds lead_duration_seconds,lead_media.alt_text lead_alt_text,
        lead_media.public_title lead_public_title,lead_media.public_description lead_public_description,
        lead_media.public_presentation lead_public_presentation,
        CASE WHEN lead_media.transcript_status='ready' THEN lead_media.transcript ELSE '' END lead_transcript,
        lead_media.transcript_status lead_transcript_status,lead_media.transcript_language lead_transcript_language,
        CASE WHEN lead_media.id IS NOT NULL THEN COALESCE(NULLIF(lead_media.source_url,''),CASE WHEN lead_media.storage_key<>'' THEN '/api/construct/media/'||lead_media.id ELSE '' END) ELSE '' END lead_media_url,
        ((SELECT COUNT(*) FROM archive_materials counted
          LEFT JOIN media_assets counted_media ON counted_media.id=counted.media_id
          WHERE counted.state_id=aos.id AND counted.state='published' AND counted.visibility='public'
            AND (counted.media_id IS NULL OR (
              counted_media.state='active' AND counted_media.privacy='public'
              AND counted_media.consent_status IN ('not-required','granted')
              AND counted_media.public_presentation='inline'
            )))
          + (SELECT COUNT(DISTINCT source_set.id)
            FROM archive_source_material_states source_link
            JOIN archive_source_material_sets source_set ON source_set.id=source_link.source_material_set_id
            WHERE source_link.state_id=aos.id
              AND source_set.publication_state='published' AND source_set.visibility='public'
              AND source_set.permission_status IN ('not-required','granted')
              AND EXISTS(
                SELECT 1 FROM archive_source_material_entries source_entry
                WHERE source_entry.source_material_set_id=source_set.id AND source_entry.public_included=1
              )
              AND NOT EXISTS(
                SELECT 1 FROM archive_source_material_entries source_entry
                LEFT JOIN media_assets source_media ON source_media.id=source_entry.media_id
                WHERE source_entry.source_material_set_id=source_set.id AND source_entry.public_included=1
                  AND source_entry.media_id IS NOT NULL
                  AND (
                    source_media.id IS NULL OR source_media.state<>'active' OR source_media.privacy<>'public'
                    OR source_media.consent_status NOT IN ('not-required','granted')
                    OR source_media.public_presentation<>'inline'
                  )
              )
          )) material_count
      FROM archive_object_states aos
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      LEFT JOIN archive_materials lead ON lead.id=aos.lead_material_id
        AND lead.state_id=aos.id AND lead.state='published' AND lead.visibility='public'
      LEFT JOIN media_assets lead_media ON lead_media.id=lead.media_id
        AND lead_media.state='active' AND lead_media.privacy='public'
        AND lead_media.consent_status IN ('not-required','granted')
        AND lead_media.public_presentation='inline'
        AND (lead_media.mime_type LIKE 'image/%' OR lead_media.mime_type LIKE 'video/%')
      WHERE aov.entity_id=?
        AND aov.publication_state='published' AND aov.public_visible=1
        AND aos.publication_state='published' AND aos.public_visible=1
      ORDER BY aov.sort_order,aov.version_number,aos.sort_order,aos.state_order,aos.variant_label`).bind(entityId),
    database.prepare(`SELECT tt.id,tt.kind,tt.name,tt.slug,tt.description
      FROM entity_terms et JOIN taxonomy_terms tt ON tt.id=et.term_id
      WHERE et.entity_id=? AND tt.public_visible=1 ORDER BY tt.kind,tt.sort_order,tt.name`).bind(entityId),
    database.prepare(`SELECT * FROM archive_catalogue_documentation
      WHERE dossier_entity_id=? AND public_visible=1
      ORDER BY sort_order,field_key,created_at,id`).bind(entityId),
    database.prepare(`SELECT sms.*
      FROM archive_source_material_sets sms
      WHERE sms.dossier_entity_id=?
        AND sms.publication_state='published' AND sms.visibility='public'
        AND sms.permission_status IN ('not-required','granted')
        AND EXISTS(
          SELECT 1 FROM archive_source_material_states smss
          JOIN archive_object_states aos ON aos.id=smss.state_id
          JOIN archive_object_versions aov ON aov.id=aos.version_id
          WHERE smss.source_material_set_id=sms.id AND aov.entity_id=sms.dossier_entity_id
            AND aos.publication_state='published' AND aos.public_visible=1
            AND aov.publication_state='published' AND aov.public_visible=1
        )
        AND EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          WHERE smse.source_material_set_id=sms.id AND smse.public_included=1
        )
        AND NOT EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          LEFT JOIN media_assets smse_media ON smse_media.id=smse.media_id
          WHERE smse.source_material_set_id=sms.id AND smse.public_included=1
            AND smse.media_id IS NOT NULL
            AND (
              smse_media.id IS NULL OR smse_media.state<>'active' OR smse_media.privacy<>'public'
              OR smse_media.consent_status NOT IN ('not-required','granted')
              OR smse_media.public_presentation<>'inline'
            )
        )
      ORDER BY sms.sort_order,sms.occurred_at,sms.created_at,sms.id`).bind(entityId),
    database.prepare(`SELECT smse.*,m.mime_type,m.width,m.height,m.duration_seconds,m.alt_text,
        m.public_title,m.public_description,m.caption media_caption,m.public_presentation,
        CASE WHEN m.public_presentation='inline'
          THEN COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
          ELSE '' END media_url
      FROM archive_source_material_entries smse
      JOIN archive_source_material_sets sms ON sms.id=smse.source_material_set_id
      LEFT JOIN media_assets m ON m.id=smse.media_id
      WHERE sms.dossier_entity_id=?
        AND sms.publication_state='published' AND sms.visibility='public'
        AND sms.permission_status IN ('not-required','granted')
        AND smse.public_included=1
        AND (smse.media_id IS NULL OR (
          m.state='active' AND m.privacy='public'
          AND m.consent_status IN ('not-required','granted')
          AND m.public_presentation='inline'
        ))
        AND EXISTS(
          SELECT 1 FROM archive_source_material_states smss
          JOIN archive_object_states aos ON aos.id=smss.state_id
          JOIN archive_object_versions aov ON aov.id=aos.version_id
          WHERE smss.source_material_set_id=sms.id AND aov.entity_id=sms.dossier_entity_id
            AND aos.publication_state='published' AND aos.public_visible=1
            AND aov.publication_state='published' AND aov.public_visible=1
        )
        AND NOT EXISTS(
          SELECT 1 FROM archive_source_material_entries required_entry
          LEFT JOIN media_assets required_media ON required_media.id=required_entry.media_id
          WHERE required_entry.source_material_set_id=sms.id AND required_entry.public_included=1
            AND required_entry.media_id IS NOT NULL
            AND (
              required_media.id IS NULL OR required_media.state<>'active' OR required_media.privacy<>'public'
              OR required_media.consent_status NOT IN ('not-required','granted')
              OR required_media.public_presentation<>'inline'
            )
        )
      ORDER BY smse.source_material_set_id,smse.sort_order,smse.created_at,smse.id`).bind(entityId),
    database.prepare(`SELECT smss.source_material_set_id,smss.state_id,smss.document_reference,smss.sort_order,
        aos.state_roman,aos.variant_label,aos.title state_title,aov.version_number
      FROM archive_source_material_states smss
      JOIN archive_source_material_sets sms ON sms.id=smss.source_material_set_id
      JOIN archive_object_states aos ON aos.id=smss.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      WHERE sms.dossier_entity_id=?
        AND sms.publication_state='published' AND sms.visibility='public'
        AND sms.permission_status IN ('not-required','granted')
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
      ORDER BY smss.source_material_set_id,smss.sort_order,aov.sort_order,aov.version_number,aos.sort_order,aos.state_order`).bind(entityId),
  ]);
  const relationshipRows=relationshipsResult.results||[];
  const relatedIds=relationshipRows.map(r=>r.source_entity_id===entityId?r.target_entity_id:r.source_entity_id);
  const relatedMap=await entityRecords(database,relatedIds);
  const relatedDossiers=relatedIds.length?(await database.prepare(`SELECT entity_id,archive_slug FROM archive_dossiers WHERE state='published' AND public_visible=1 AND entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
  const relatedCatalogue=relatedIds.length?(await database.prepare(`SELECT ace.entity_id,ace.catalogue_id,ace.current_state_id,ace.medium_id catalogue_medium,
      COALESCE(aov.version_number,ace.current_version) current_version,
      COALESCE(aos.state_roman,ace.current_state) current_state,
      COALESCE(aos.variant_label,ace.variant_label) catalogue_variant,
      (SELECT COUNT(*) FROM archive_object_states counted_state
        JOIN archive_object_versions counted_version ON counted_version.id=counted_state.version_id
        WHERE counted_version.entity_id=ace.entity_id
          AND counted_version.publication_state='published' AND counted_version.public_visible=1
          AND counted_state.publication_state='published' AND counted_state.public_visible=1) public_state_count
      FROM archive_catalogue_entries ace
      LEFT JOIN archive_object_states aos ON aos.id=ace.current_state_id
      LEFT JOIN archive_object_versions aov ON aov.id=aos.version_id
      WHERE ace.entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
  const relatedEvents=relatedIds.length?(await database.prepare(`SELECT entity_id,event_id,event_number FROM archive_event_identifiers WHERE entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
  const relatedSlugs=new Map(relatedDossiers.map(d=>[d.entity_id,d.archive_slug]));
  const relatedCatalogueMap=new Map(relatedCatalogue.map(record=>[record.entity_id,{...record,catalogue_label:archiveCatalogueLabel(record)}]));
  const relatedEventMap=new Map(relatedEvents.map(record=>[record.entity_id,{...record,record_identifier:record.event_id}]));
  const relationships=[];for(const relation of relationshipRows){const outgoing=relation.source_entity_id===entityId;const relatedId=outgoing?relation.target_entity_id:relation.source_entity_id;const related=relatedMap.get(relatedId);if(!related||related.visibility!=="public")continue;const archive_slug=relatedSlugs.get(relatedId)||"",catalogue=relatedCatalogueMap.get(relatedId)||{},eventIdentity=relatedEventMap.get(relatedId)||{};relationships.push({id:relation.id,direction:outgoing?"outgoing":"incoming",label:outgoing?relation.forward_label:relation.reverse_label,relationship_type:relation.relationship_slug,related:{...related,...catalogue,...eventIdentity,imageUrl:"",archive_slug,archiveRoute:archive_slug?`/archive/records/${encodeURIComponent(archive_slug)}/`:""}});}
  const materials=(materialsResult.results||[]).map(material=>presentArchiveMaterial({...material,anchor:`material-${material.id}`,url:material.media_url||"",inline_text:material.body||""}));
  const states=(statesResult.results||[]).map(state=>presentArchiveState(state,item));
  const documentation=(documentationResult.results||[]).map(presentArchiveDocumentation);
  const sourceEntriesBySet=new Map();
  for(const entry of sourceMaterialEntriesResult.results||[]){
    if(!sourceEntriesBySet.has(entry.source_material_set_id))sourceEntriesBySet.set(entry.source_material_set_id,[]);
    sourceEntriesBySet.get(entry.source_material_set_id).push(presentArchiveSourceEntry({...entry,url:entry.media_url||""}));
  }
  const sourceStatesBySet=new Map();
  for(const link of sourceMaterialStatesResult.results||[]){
    if(!sourceStatesBySet.has(link.source_material_set_id))sourceStatesBySet.set(link.source_material_set_id,[]);
    const stateLabel=`${item.catalogue_id||""}.${Number(link.version_number||1)}/${link.state_roman||"I"}${link.variant_label?`, ${link.variant_label}`:""}`;
    sourceStatesBySet.get(link.source_material_set_id).push({
      state_id:link.state_id,
      stateId:link.state_id,
      state_label:stateLabel,
      stateLabel,
      document_reference:link.document_reference,
      documentReference:link.document_reference,
      title:link.state_title||"",
      anchor:archiveStateAnchor(link.state_id),
    });
  }
  const sourceMaterials=(sourceMaterialSetsResult.results||[]).map(record=>presentArchiveSourceMaterialSet(
    record,
    sourceEntriesBySet.get(record.id)||[],
    sourceStatesBySet.get(record.id)||[],
  ));
  const paletteProjection=await projectPublicPalette(database,{entityId,catalogueId:item.catalogue_id||""});
  const colorUsages=paletteProjection.color_usages;
  const materialUsages=paletteProjection.material_usages;
  const paletteMaps=paletteProjection.palette_maps;
  const activities=activitiesResult.results||[];
  const originThreads=originThreadsResult.results||[],primaryOriginThread=originThreads.find(thread=>Number(thread.is_primary))||null;
  return json({item,dossier:item,materials,color_usages:colorUsages,colorUsages,material_usages:materialUsages,materialUsages,palette_maps:paletteMaps,paletteMaps,source_materials:sourceMaterials,sourceMaterials,evidence_sets:sourceMaterials,evidenceSets:sourceMaterials,activities,subjects:subjectsResult.results||[],collections:collectionsResult.results||[],relationships,versions:versionsResult.results||[],states,documentation,terms:termsResult.results||[],origin_threads:originThreads,originThreads,primary_origin_thread:primaryOriginThread,primaryOriginThread},{cache:"public, max-age=30"});
}

function archiveComparisonSubject(payload,stateId=""){
  const item=payload.item||{},states=payload.states||[],documentation=payload.documentation||[];
  const selectedState=stateId?states.find(state=>state.id===stateId):null;
  if(stateId&&!selectedState)return null;
  const currentState=states.find(state=>state.id===item.current_state_id)||null;
  const displayState=selectedState||currentState;
  const documentationValues={};
  for(const entry of documentation){
    if(!documentationValues[entry.field_key])documentationValues[entry.field_key]=[];
    documentationValues[entry.field_key].push(entry);
  }
  const firstDocumentation=(key)=>documentationValues[key]?.[0]?.value||"";
  const media=displayState?.lead_material?.digital_asset
    ? {
        ...displayState.lead_material.digital_asset,
        material_reference:displayState.lead_material.material_reference||"",
        title:displayState.lead_material.title||displayState.lead_material.digital_asset.title||"",
      }
    : item.primary_media||null;
  return {
    kind:selectedState?"state":"record",
    archive_slug:item.archive_slug,
    archiveSlug:item.archive_slug,
    entity_id:item.entity_id,
    entityId:item.entity_id,
    state_id:selectedState?.id||"",
    stateId:selectedState?.id||"",
    route:`${item.archive_route}${selectedState?`#${selectedState.anchor}`:""}`,
    title:item.title,
    subject_title:selectedState?.title||item.title,
    subjectTitle:selectedState?.title||item.title,
    catalogue_id:item.catalogue_id,
    catalogueId:item.catalogue_id,
    catalogue_label:selectedState?.catalogue_label||item.catalogue_label,
    catalogueLabel:selectedState?.catalogue_label||item.catalogue_label,
    medium:item.medium||item.catalogue_medium_label||"",
    catalogue_medium:item.catalogue_medium||"",
    cultural_object_type:item.cultural_object_type||"",
    date_label:selectedState?.date_label||item.date_label||"",
    dateLabel:selectedState?.date_label||item.date_label||"",
    state:selectedState||displayState,
    summary:firstDocumentation("object-description")||selectedState?.description||item.summary||"",
    technique:firstDocumentation("technique"),
    support:firstDocumentation("support"),
    dimensions:firstDocumentation("dimensions"),
    inscriptions:(documentationValues.inscription||[]).map(entry=>entry.value),
    edition:firstDocumentation("edition"),
    credit_line:firstDocumentation("credit-line"),
    themes:(payload.terms||[]).filter(term=>term.kind==="theme").map(term=>term.name),
    relationships:(payload.relationships||[]).map(relation=>({
      label:relation.label,
      title:relation.related?.title||relation.related?.name||"",
      catalogue_label:relation.related?.catalogue_label||relation.related?.record_identifier||"",
    })),
    media,
  };
}

async function publicArchiveCompare(request,env){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const url=new URL(request.url);
  const leftSlug=text(url.searchParams.get("left"),200),rightSlug=text(url.searchParams.get("right"),200);
  const leftState=text(url.searchParams.get("left_state")||url.searchParams.get("leftState"),200);
  const rightState=text(url.searchParams.get("right_state")||url.searchParams.get("rightState"),200);
  if(!leftSlug||!rightSlug)return failure("Choose exactly two public Archive subjects.",400);
  const detailRequest=new Request(request.url,{method:"GET",headers:request.headers});
  const leftResponse=await publicArchiveDetail(detailRequest,env,leftSlug);
  const rightResponse=await publicArchiveDetail(detailRequest,env,rightSlug);
  if(!leftResponse.ok||!rightResponse.ok)return failure("One or both comparison subjects are unavailable.",404);
  const [leftPayload,rightPayload]=await Promise.all([leftResponse.json(),rightResponse.json()]);
  const left=archiveComparisonSubject(leftPayload,leftState),right=archiveComparisonSubject(rightPayload,rightState);
  if(!left||!right)return failure("One or both comparison states are unavailable.",404);
  return json({subjects:[left,right],left,right},{cache:"public, max-age=30"});
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

const EXPLORE_SCOPES = new Set(["all", "works", "process", "pages"]);
const EXPLORE_WEIGHTS = { works: 0.5, process: 0.3, pages: 0.2 };
const EXPLORE_WORK_TYPES = new Set([
  "art_work", "portfolio_item", "flash_item", "flash_series", "tattoo_design",
  "merch_item", "event", "visual_symbol",
]);
const EXPLORE_BLOCKED_PATHS = [
  "/api", "/studio", "/tools", "/booking", "/preferences", "/search", "/explore",
  "/cart", "/checkout",
];
const EXPLORE_BLOCKED_SEGMENTS = [
  "/inquire", "/intake", "/claim", "/apply", "/approved", "/submission-received",
  "/confirmed", "/confirmation", "/day-of", "/location-parking", "/acquisitioninquiry",
];

function safeExploreRoute(value) {
  const route = String(value || "").trim();
  if (!route.startsWith("/") || route.startsWith("//") || route.length > 1200) return "";
  let parsed;
  try { parsed = new URL(route, "https://the-six-well-construct.invalid"); } catch { return ""; }
  if (parsed.origin !== "https://the-six-well-construct.invalid") return "";
  const pathname = parsed.pathname.toLowerCase();
  if (EXPLORE_BLOCKED_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "";
  if (EXPLORE_BLOCKED_SEGMENTS.some((segment) => pathname.includes(segment))) return "";
  if (pathname.includes("managed-preview") || /\.(?:avif|gif|jpe?g|png|svg|webp|mp3|m4a|wav|ogg|mp4|webm|pdf|docx?|zip)$/i.test(pathname)) return "";
  for (const key of parsed.searchParams.keys()) {
    if (/^(?:token|preview_token|access_token|cart|cart_id|checkout|session|secret)$/i.test(key)) return "";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function exploreMedium(nodeId, entityType, fallback = "") {
  const mappedTypes = new Set(["visual_symbol", "flash_item", "flash_series", "portfolio_item", "tattoo_design", "art_work", "merch_item", "event"]);
  let canonical = (!nodeId && entityType && !mappedTypes.has(entityType) && fallback)
    ? canonicalNodeAlias(fallback)
    : canonicalNodeAlias(nodeId, entityType);
  if (!nodeId && !entityType) canonical = fallback ? canonicalNodeAlias(fallback) : "";
  if (!NODE_FALLBACKS || !canonical) return null;
  const record = Object.values(NODE_FALLBACKS).find((node) => node.id === canonical);
  if (!record) return fallback ? nodeFallback(canonicalNodeAlias(fallback)) : null;
  return { id: record.id.replace(/^node-/, ""), label: record.name };
}

function randomIndex(length, random = Math.random) {
  if (length < 2) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(Number(random()) * length)));
}

function pickExploreWeightedScope(scopes, random = Math.random) {
  const total = scopes.reduce((sum, scope) => sum + EXPLORE_WEIGHTS[scope], 0);
  let cursor = Number(random()) * total;
  for (const scope of scopes) {
    cursor -= EXPLORE_WEIGHTS[scope];
    if (cursor < 0) return scope;
  }
  return scopes[scopes.length - 1];
}

function pickExploreBalanced(candidates, random = Math.random) {
  const byMedium = new Map();
  candidates.forEach((candidate) => {
    if (!byMedium.has(candidate.medium.id)) byMedium.set(candidate.medium.id, new Map());
    const byEntity = byMedium.get(candidate.medium.id);
    if (!byEntity.has(candidate.entityKey)) byEntity.set(candidate.entityKey, []);
    byEntity.get(candidate.entityKey).push(candidate);
  });
  const mediumGroups = [...byMedium.values()];
  const entityGroups = [...mediumGroups[randomIndex(mediumGroups.length, random)].values()];
  const destinations = entityGroups[randomIndex(entityGroups.length, random)];
  return destinations[randomIndex(destinations.length, random)];
}

export function selectExploreDestination(pools, requestedScope = "all", excludedKeys = [], random = Math.random) {
  const exclusions = new Set((excludedKeys || []).map(String));
  const scopes = requestedScope === "all" ? ["works", "process", "pages"] : [requestedScope];
  const available = scopes.filter((scope) => Array.isArray(pools[scope]) && pools[scope].length);
  if (!available.length) return { destination: null, restarted: false };
  let filtered = Object.fromEntries(available.map((scope) => [scope, pools[scope].filter((item) => !exclusions.has(item.key))]));
  let eligibleScopes = available.filter((scope) => filtered[scope].length);
  let restarted = false;
  if (!eligibleScopes.length) {
    restarted = true;
    filtered = Object.fromEntries(available.map((scope) => [scope, pools[scope]]));
    eligibleScopes = available;
  }
  const selectedScope = requestedScope === "all" ? pickExploreWeightedScope(eligibleScopes, random) : eligibleScopes[0];
  const picked = pickExploreBalanced(filtered[selectedScope], random);
  const { entityKey, ...destination } = picked;
  return { destination, restarted };
}

function exploreWorkCandidate(row, route, surface = "active") {
  const safeRoute = safeExploreRoute(route);
  const medium = exploreMedium(row.node_id, row.entity_type, surface === "archive" ? "archive" : "");
  if (!safeRoute || !medium || !String(row.title || "").trim()) return null;
  return {
    key: `works:${row.entity_id}:${surface}`,
    scope: "works",
    kind: surface === "archive" ? "archive-dossier" : row.entity_type.replaceAll("_", "-"),
    medium,
    title: String(row.title).trim(),
    route: safeRoute,
    entityKey: row.entity_id,
  };
}

function exploreProcessCandidate(row) {
  const route = safeExploreRoute(`/archive/records/${encodeURIComponent(row.archive_slug)}/#${encodeURIComponent(row.anchor || "materials")}`);
  const medium = exploreMedium(row.node_id, row.entity_type, "archive");
  if (!route || !medium) return null;
  const kind = row.fragment_type === "source-material" ? `source-${row.source_kind || "material"}` : (row.material_type || "process");
  return {
    key: `process:${row.fragment_type}:${row.source_id}`,
    scope: "process",
    kind,
    medium,
    title: String(row.label || row.owner_title || "Process evidence").trim(),
    route,
    entityKey: row.dossier_entity_id,
  };
}

function explorePageCandidate(row, kind) {
  const route = safeExploreRoute(row.route);
  const medium = exploreMedium(kind === "node" ? row.id : row.node_id, "", "about");
  if (!route || !medium || !String(row.title || "").trim()) return null;
  return {
    key: `pages:${kind}:${row.id}`,
    scope: "pages",
    kind: kind === "node" ? "construct-node" : "construct-pathway",
    medium,
    title: String(row.title).trim(),
    route,
    entityKey: row.id,
  };
}

async function publicExplore(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "all").toLowerCase();
  if (!EXPLORE_SCOPES.has(scope)) return failure("Invalid Explore scope.", 400);
  const excluded = String(url.searchParams.get("exclude") || "").split(",").map((key) => key.trim()).filter(Boolean).slice(-12);
  const database = db(env);
  const [worksResult, dossiersResult, processResult, nodesResult, pathwaysResult] = await database.batch([
    database.prepare(`SELECT d.entity_id,d.entity_type,d.node_id,d.title,d.route
      FROM search_documents d JOIN content_entities ce ON ce.id=d.entity_id
      WHERE ce.visibility='public' AND ce.search_visibility=1
        AND d.state NOT IN ('draft','archived','retired','private')
        AND d.entity_type IN ('art_work','portfolio_item','flash_item','flash_series','tattoo_design','merch_item','event','visual_symbol')`),
    database.prepare(`SELECT ad.entity_id,ce.entity_type,ce.node_id,ad.archive_slug,
        COALESCE(NULLIF(sd.title,''),NULLIF(aw.title,''),NULLIF(mi.title,''),NULLIF(pi.title,''),NULLIF(fi.title,''),NULLIF(td.title,''),NULLIF(ev.title,''),NULLIF(vs.name,''),NULLIF(ar.title,''),ad.archive_slug) title
      FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
      LEFT JOIN search_documents sd ON sd.entity_id=ad.entity_id
      LEFT JOIN art_works aw ON aw.id=ad.entity_id LEFT JOIN merch_items mi ON mi.id=ad.entity_id
      LEFT JOIN portfolio_items pi ON pi.id=ad.entity_id LEFT JOIN flash_items fi ON fi.id=ad.entity_id
      LEFT JOIN tattoo_designs td ON td.id=ad.entity_id LEFT JOIN events ev ON ev.id=ad.entity_id
      LEFT JOIN visual_symbols vs ON vs.id=ad.entity_id LEFT JOIN archive_records ar ON ar.id=ad.entity_id
      WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1`),
    database.prepare(`SELECT af.dossier_entity_id,af.fragment_type,af.source_id,af.label,af.anchor,
        ad.archive_slug,ce.entity_type,ce.node_id,COALESCE(sd.title,ad.archive_slug) owner_title,
        am.material_type,sms.source_kind
      FROM archive_search_fragments af
      JOIN archive_dossiers ad ON ad.entity_id=af.dossier_entity_id
      JOIN content_entities ce ON ce.id=ad.entity_id
      LEFT JOIN search_documents sd ON sd.entity_id=ad.entity_id
      LEFT JOIN archive_materials am ON af.fragment_type='material' AND am.id=af.source_id
      LEFT JOIN archive_source_material_sets sms ON af.fragment_type='source-material' AND sms.id=af.source_id
      WHERE af.public_visible=1 AND af.fragment_type IN ('material','source-material')
        AND ce.visibility='public' AND ad.state='published' AND ad.public_visible=1
        AND (am.id IS NULL OR am.material_type<>'final-image') AND ${archiveFragmentPublicSql("af")}`),
    database.prepare(`SELECT cn.id,cn.id node_id,cn.name title,cn.route FROM construct_nodes cn
      JOIN content_entities ce ON ce.id=cn.id
      WHERE cn.state='published' AND cn.homepage_enabled=1 AND ce.visibility='public'`),
    database.prepare(`SELECT cp.id,cp.node_id,cp.name title,cp.route FROM construct_pathways cp
      JOIN content_entities ce ON ce.id=cp.id
      WHERE cp.state='published' AND cp.homepage_enabled=1 AND ce.visibility='public'`),
  ]);
  const works = [];
  for (const row of worksResult.results || []) {
    if (!EXPLORE_WORK_TYPES.has(row.entity_type)) continue;
    const candidate = exploreWorkCandidate(row, row.route, "active");
    if (candidate) works.push(candidate);
  }
  for (const row of dossiersResult.results || []) {
    const candidate = exploreWorkCandidate(row, `/archive/records/${encodeURIComponent(row.archive_slug)}/`, "archive");
    if (candidate) works.push(candidate);
  }
  const process = (processResult.results || []).map(exploreProcessCandidate).filter(Boolean);
  const pages = [
    ...(nodesResult.results || []).map((row) => explorePageCandidate(row, "node")),
    ...(pathwaysResult.results || []).map((row) => explorePageCandidate(row, "pathway")),
  ].filter(Boolean);
  const result = selectExploreDestination({ works, process, pages }, scope, excluded);
  if (!result.destination) return failure("No public Explore destinations are available for that scope.", 404);
  return json(result, { cache: "no-store" });
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
  const rows = (await database.prepare(`SELECT * FROM ${config.table} ORDER BY ${catalogOrderBy(config)}`).all()).results || [];
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
  if(archiveEligibleEntityType(config.entityType))await ensureArchiveCatalogueEntry(database,await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(recordId).first());
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
  if(archiveEligibleEntityType(config.entityType))await ensureArchiveCatalogueEntry(database,await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(recordId).first());
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

async function publishedSourceMaterialUsingMedia(database,mediaId){
  return database.prepare(`SELECT sms.id,sms.title
    FROM archive_source_material_entries smse
    JOIN archive_source_material_sets sms ON sms.id=smse.source_material_set_id
    WHERE smse.media_id=? AND smse.public_included=1
      AND sms.publication_state='published' AND sms.visibility='public'
    LIMIT 1`).bind(mediaId).first();
}

async function publicMediaApi(request,env,mediaId){
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      AND (
        EXISTS(SELECT 1 FROM archive_materials am JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
          JOIN content_entities ce ON ce.id=ad.entity_id WHERE am.media_id=m.id AND am.state='published' AND am.visibility='public'
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public')
        OR EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          JOIN archive_source_material_sets sms ON sms.id=smse.source_material_set_id
          JOIN archive_dossiers ad ON ad.entity_id=sms.dossier_entity_id
          JOIN content_entities ce ON ce.id=ad.entity_id
          WHERE smse.media_id=m.id AND smse.public_included=1
            AND sms.publication_state='published' AND sms.visibility='public'
            AND sms.permission_status IN ('not-required','granted')
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
            AND EXISTS(
              SELECT 1 FROM archive_source_material_states smss
              JOIN archive_object_states aos ON aos.id=smss.state_id
              JOIN archive_object_versions aov ON aov.id=aos.version_id
              WHERE smss.source_material_set_id=sms.id
                AND aov.entity_id=sms.dossier_entity_id
                AND aos.publication_state='published' AND aos.public_visible=1
                AND aov.publication_state='published' AND aov.public_visible=1
            )
        )
        OR EXISTS(
          SELECT 1 FROM archive_palette_maps pm
          JOIN archive_object_states aos ON aos.id=pm.state_id
          JOIN archive_object_versions aov ON aov.id=aos.version_id
          JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
          JOIN content_entities ce ON ce.id=ad.entity_id
          WHERE pm.source_media_id=m.id
            AND pm.publication_state='published' AND pm.public_visible=1
            AND aos.publication_state='published' AND aos.public_visible=1
            AND aov.publication_state='published' AND aov.public_visible=1
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
        )
      )`).bind(mediaId).first();
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
  return text(value,255).replace(/[^a-zA-Z0-9._ -]/g,"-")||"media";
}

function presentUploadSession(row,parts=[]){
  return {
    id:row.id,
    uploadId:row.upload_id,
    mediaId:row.media_id,
    filename:row.original_filename,
    mimeType:row.mime_type,
    uploadKind:row.upload_kind||"video",
    byteSize:Number(row.byte_size)||0,
    partSize:Number(row.part_size)||RESUMABLE_MEDIA_PART_BYTES,
    partCount:Math.ceil((Number(row.byte_size)||0)/(Number(row.part_size)||RESUMABLE_MEDIA_PART_BYTES)),
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
  const partSize=Number(session.part_size)||RESUMABLE_MEDIA_PART_BYTES,total=Number(session.byte_size)||0,count=Math.ceil(total/partSize);
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
    const uploadKind=text(body.uploadKind??body.upload_kind,40)||"video";
    const mime=text(body.mimeType??body.mime_type,100).toLowerCase(),byteSize=Number(body.byteSize??body.byte_size)||0;
    const allowed=RESUMABLE_UPLOAD_MIMES[uploadKind];
    if(!allowed)return failure("Invalid resumable upload kind.");
    if(!allowed.has(mime))return failure(uploadKind==="archive-master"?"Use a TIFF, JPEG, PNG, or WebP archival master.":"Use an MP4 or WebM video.",415);
    if(!Number.isSafeInteger(byteSize)||byteSize<=0)return failure("A valid media size is required.");
    if(byteSize>RESUMABLE_MEDIA_MAX_BYTES)return failure("Resumable media must be 2 GiB or smaller.",413);
    const privacy=uploadKind==="archive-master"?"internal":text(body.privacy,30)||"internal";
    const consent=uploadKind==="archive-master"?"not-required":normalizedConsent(body.consentStatus??body.consent_status);
    const transcriptStatus=uploadKind==="archive-master"?"not-requested":text(body.transcriptStatus??body.transcript_status,30)||"not-requested";
    const presentation=uploadKind==="archive-master"?"hidden":text(body.publicPresentation??body.public_presentation,30)||"inline";
    if(!MEDIA_PRIVACIES.has(privacy))return failure("Invalid media privacy.");
    if(!MEDIA_CONSENT_STATUSES.has(consent))return failure("Invalid consent status.");
    if(!MEDIA_TRANSCRIPT_STATUSES.has(transcriptStatus))return failure("Invalid transcript status.");
    if(!MEDIA_PRESENTATIONS.has(presentation))return failure("Invalid public presentation.");
    const sessionNewId=id("media-upload"),mediaId=id("media"),filename=text(body.filename??body.original_filename,255)||"media",storageFilename=resumableUploadFilename(filename);
    const key=uploadKind==="archive-master"
      ? `archive/blackboards/masters/${mediaId}/${storageFilename}`
      : `construct/${mediaId}/${storageFilename}`;
    const upload=await env.SUBMISSION_FILES.createMultipartUpload(key,{
      httpMetadata:{contentType:mime,cacheControl:"private, no-store"},
      customMetadata:{mediaId,sessionId:sessionNewId,originalFilename:filename,uploadKind},
    });
    try{
      await database.prepare(`INSERT INTO media_upload_sessions(
        id,upload_id,storage_key,original_filename,mime_type,upload_kind,byte_size,part_size,media_id,
        alt_text,caption,privacy,consent_status,transcript,transcript_status,transcript_language,
        public_title,public_description,public_presentation,state,error_message,expires_at,
        created_by,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','',datetime('now','+24 hours'),'studio',datetime('now'),datetime('now'))`)
        .bind(sessionNewId,upload.uploadId,key,filename,mime,uploadKind,byteSize,RESUMABLE_MEDIA_PART_BYTES,mediaId,
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
    if(uploadedParts.length!==count||uploadedParts.some((part,index)=>Number(part.part_number)!==index+1||Number(part.byte_size)!==uploadPartExpectedSize(session,index+1)))return failure("Every media part must finish uploading before completion.",409);
    const upload=env.SUBMISSION_FILES.resumeMultipartUpload(session.storage_key,session.upload_id);
    let object=null;
    try{object=await upload.complete(uploadedParts.map(part=>({partNumber:Number(part.part_number),etag:part.etag})));}
    catch(error){object=await env.SUBMISSION_FILES.head(session.storage_key);if(!object||Number(object.size)!==Number(session.byte_size))return failure("The media could not be finalized. Retry completion.",502);}
    if(Number(object.size)!==Number(session.byte_size))return failure("The completed media size did not match the selected file.",409);
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
      const sourceMaterial=await publishedSourceMaterialUsingMedia(database,mediaId);
      if(sourceMaterial)return failure("Return the client source material to an internal draft before making one of its public files ineligible.",409);
    }
    try{
      await database.prepare("UPDATE media_assets SET state=?,alt_text=?,caption=?,privacy=?,consent_status=?,transcript=?,transcript_status=?,transcript_language=?,public_title=?,public_description=?,public_presentation=?,updated_at=datetime('now') WHERE id=?")
        .bind(next.state,next.alt_text,next.caption,next.privacy,next.consent_status,next.transcript,next.transcript_status,next.transcript_language,next.public_title,next.public_description,next.public_presentation,mediaId).run();
    }catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before making this media private.",409);throw error;}
    return json({record:await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first()});
  }
  if(request.method!=="POST"||mediaId)return failure("Method not allowed.",405);
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||!file.size)return failure("A file is required.");
  const mime=(file.type||"application/octet-stream").toLowerCase();const image=["image/jpeg","image/png","image/webp","image/gif"].includes(mime);const doc=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mime);const audio=mime.startsWith("audio/"),video=RESUMABLE_UPLOAD_MIMES.video.has(mime);const av=audio||video,max=av?50*1024*1024:15*1024*1024;if(mime.startsWith("video/")&&!video)return failure("Use an MP4 or WebM video.",415);if(!(image||doc||av))return failure("Unsupported media type.",415);if(file.size>max)return failure("File exceeds the allowed size.",413);if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
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
  if(["tattooing","tattoo","tattoos","node-tattoos"].includes(raw)||["flash_item","flash_series","portfolio_item","tattoo_design"].includes(entityType))return"node-tattoos";
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

function archiveRecordType(entityType){return {art_work:"artwork",merch_item:"merchandise",portfolio_item:"tattoo",flash_item:"flash",tattoo_design:"tattoo-design",event:"event",visual_symbol:"symbol"}[entityType]||String(entityType||"").replace(/_/g,"-");}
function archivePreferredSlug(entityType,row){return slug(row?.archive_slug||row?.slug||row?.shopify_handle||row?.id)||String(row?.id||"");}
function archiveEligibleEntityType(entityType){return ["art_work","merch_item","portfolio_item","flash_item","tattoo_design","event","visual_symbol","writing_work","film_work","music_work"].includes(entityType);}

async function archiveDossierEligibleOwner(database,owner){
  if(archiveEligibleEntityType(owner?.entity_type))return true;
  if(owner?.entity_type!=="archive_record")return false;
  return Boolean(await database.prepare("SELECT id FROM archive_records WHERE id=? AND record_type='blackboard'").bind(owner.id).first());
}

function archiveShellStatement(database,entityId,entityType,preferredSlug,recordType){
  const base=slug(preferredSlug)||entityId,prefixed=`${String(entityType||"item").replace(/_/g,"-")}-${base}`,designOnly=entityType==="tattoo_design";
  return database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
    SELECT ce.id,CASE WHEN EXISTS(SELECT 1 FROM archive_dossiers other WHERE other.archive_slug=? AND other.entity_id<>ce.id) THEN ? ELSE ? END,
      ?,?,?,CASE WHEN ?=1 THEN NULL ELSE COALESCE(ce.public_at,datetime('now')) END,'studio','studio',datetime('now'),datetime('now')
    FROM content_entities ce WHERE ce.id=? AND ce.visibility='public'
    ON CONFLICT(entity_id) DO UPDATE SET
      archive_slug=CASE WHEN archive_dossiers.archive_slug=archive_dossiers.entity_id THEN excluded.archive_slug ELSE archive_dossiers.archive_slug END,
      record_type=CASE WHEN archive_dossiers.record_type='' THEN excluded.record_type ELSE archive_dossiers.record_type END,
      updated_by='studio',updated_at=datetime('now')`).bind(base,prefixed,base,recordType,designOnly?"draft":"published",designOnly?0:1,designOnly?1:0,entityId);
}

function archiveRoman(value){
  const roman=text(value,20).toUpperCase();
  return /^[IVXLCDM]+$/.test(roman)?roman:"";
}

function archiveContextAssignments(value){
  if(!Array.isArray(value))return null;
  const seen=new Set(),output=[];
  for(const item of value.slice(0,100)){
    const entityId=text(item?.entity_id??item?.entityId??item?.id,200),role=text(item?.role,100)||"related";
    if(!entityId)continue;
    const key=`${entityId}:${role.toLowerCase()}`;if(seen.has(key))continue;seen.add(key);
    output.push({entity_id:entityId,role,public_visible:item?.public_visible===undefined&&item?.publicVisible===undefined?1:(truthy(item.public_visible??item.publicVisible)?1:0)});
  }
  return output;
}

async function replaceArchiveContext(database,entityId,assignments){
  if(assignments===null)return;
  const targetIds=[...new Set(assignments.map(item=>item.entity_id))];
  if(targetIds.length){
    const rows=(await database.prepare(`SELECT id,entity_type FROM content_entities WHERE id IN (${targetIds.map(()=>"?").join(",")})`).bind(...targetIds).all()).results||[];
    const types=new Map(rows.map(row=>[row.id,row.entity_type]));
    if(rows.length!==targetIds.length||targetIds.some(id=>!ARCHIVE_CONTEXT_TYPES.has(types.get(id))))throw new Error("Choose existing people, organizations, places, or events for record context.");
  }
  const statements=[database.prepare("DELETE FROM archive_dossier_subjects WHERE dossier_entity_id=?").bind(entityId)];
  assignments.forEach((item,index)=>statements.push(database.prepare("INSERT INTO archive_dossier_subjects(dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at) VALUES(?,?,?,?,?,datetime('now'))").bind(entityId,item.entity_id,item.role,item.public_visible,index+1)));
  await database.batch(statements);
}

async function replaceArchiveThemes(database,entityId,value){
  if(!Array.isArray(value))return;
  const names=[...new Set(value.map(item=>text(typeof item==="object"?(item.name||item.label):item,160)).filter(Boolean))].slice(0,60),termIds=[];
  for(const name of names){
    const termSlug=slug(name);if(!termSlug)continue;
    let term=await database.prepare("SELECT id FROM taxonomy_terms WHERE kind='theme' AND slug=?").bind(termSlug).first();
    if(!term){
      await database.prepare("INSERT OR IGNORE INTO taxonomy_terms(id,kind,name,slug,description,public_visible,sort_order,created_at,updated_at) VALUES(?,'theme',?,?, '',1,0,datetime('now'),datetime('now'))").bind(`theme-${termSlug}`,name,termSlug).run();
      term=await database.prepare("SELECT id FROM taxonomy_terms WHERE kind='theme' AND slug=?").bind(termSlug).first();
    }
    if(term?.id)termIds.push(term.id);
  }
  const statements=[
    database.prepare("DELETE FROM archive_search_fragments WHERE dossier_entity_id=? AND fragment_type='theme'").bind(entityId),
    database.prepare("DELETE FROM entity_terms WHERE entity_id=? AND term_id IN (SELECT id FROM taxonomy_terms WHERE kind='theme')").bind(entityId),
  ];
  termIds.forEach(termId=>statements.push(database.prepare("INSERT OR IGNORE INTO entity_terms(entity_id,term_id,created_at) VALUES(?,?,datetime('now'))").bind(entityId,termId)));
  termIds.forEach(termId=>statements.push(database.prepare(`INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
    SELECT ?,?,'theme',tt.id,tt.name,tt.description,'story',tt.public_visible,datetime('now') FROM taxonomy_terms tt WHERE tt.id=?`).bind(`archive-fragment-theme-${entityId}-${termId}`,entityId,termId)));
  await database.batch(statements);
}

async function archiveCatalogueObjectTypeId(database,owner){
  let objectTypeId="other-cultural-object";
  if(owner.entity_type==="art_work")objectTypeId="art-other";
  else if(owner.entity_type==="merch_item")objectTypeId="merch-other";
  else if(owner.entity_type==="portfolio_item")objectTypeId="tattoo-execution";
  else if(owner.entity_type==="flash_item")objectTypeId="tattoo-flash-design";
  else if(owner.entity_type==="tattoo_design")objectTypeId="tattoo-design";
  else if(owner.entity_type==="visual_symbol")objectTypeId="legend-symbol";
  else if(owner.entity_type==="film_work"||owner.node_id==="film"||owner.node_id==="node-film")objectTypeId="film-work";
  else if(owner.entity_type==="music_work"||owner.node_id==="music"||owner.node_id==="node-music")objectTypeId="music-work";
  else if(owner.entity_type==="writing_work"||owner.node_id==="writings"||owner.node_id==="node-writings")objectTypeId="writing-work";
  if(owner.entity_type==="archive_record"&&await database.prepare("SELECT id FROM archive_records WHERE id=? AND record_type='blackboard'").bind(owner.id).first())objectTypeId="other-blackboard";
  return objectTypeId;
}

async function nextArchiveCatalogueNumber(database,cataloguePrefix){
  const row=await database.prepare(`SELECT MIN(candidate) next_number
    FROM (
      SELECT 1 candidate
      UNION
      SELECT catalogue_number+1 FROM archive_catalogue_entries WHERE catalogue_prefix=?
    ) candidates
    WHERE NOT EXISTS(
      SELECT 1 FROM archive_catalogue_entries occupied
      WHERE occupied.catalogue_prefix=? AND occupied.catalogue_number=candidates.candidate
    )`).bind(cataloguePrefix,cataloguePrefix).first();
  return Math.max(1,Number(row?.next_number)||1);
}

async function ensureArchiveCatalogueEntry(database,owner){
  if(!owner?.id||owner.entity_type==="event")return null;
  if(!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(owner.id).first())return null;
  let catalogue=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(owner.id).first();
  if(!catalogue){
    const objectTypeId=await archiveCatalogueObjectTypeId(database,owner);
    const type=await database.prepare("SELECT medium_id,catalogue_prefix FROM archive_cultural_object_types WHERE id=?").bind(objectTypeId).first();
    if(!type)throw new Error("The catalogue vocabulary is unavailable.");
    for(let attempt=0;attempt<3&&!catalogue;attempt++){
      const number=await nextArchiveCatalogueNumber(database,type.catalogue_prefix),catalogueId=`${type.catalogue_prefix}-${String(number).padStart(3,"0")}`;
      try{
        await database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'I','','studio','studio',datetime('now'),datetime('now'))`).bind(owner.id,type.medium_id,objectTypeId,type.catalogue_prefix,number,catalogueId).run();
      }catch(error){
        catalogue=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(owner.id).first();
        if(!catalogue&&!/UNIQUE constraint failed/i.test(String(error?.message||error)))throw error;
      }
      catalogue=catalogue||await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(owner.id).first();
    }
    if(!catalogue)throw new Error("A unique catalogue number could not be allocated. Try again.");
  }
  let version=await database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=? ORDER BY sort_order,version_number,id LIMIT 1").bind(owner.id).first();
  if(!version){
    const versionId=id("archive-version");
    await database.prepare(`INSERT INTO archive_object_versions(id,entity_id,version_number,title,description,date_precision,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,1,'Version 1','','undated',1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(versionId,owner.id).run();
    version=await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(versionId).first();
  }
  let state=await database.prepare("SELECT * FROM archive_object_states WHERE version_id=? ORDER BY sort_order,state_order,variant_label,id LIMIT 1").bind(version.id).first();
  if(!state){
    const stateId=id("archive-state");
    await database.prepare(`INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,variant_label,date_precision,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,'I',1,'First documented state','','','undated',1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(stateId,version.id).run();
    state=await database.prepare("SELECT * FROM archive_object_states WHERE id=?").bind(stateId).first();
  }
  return {catalogue,version,state};
}

async function archiveCatalogueAdminApi(request,env,entityId=""){
  const database=db(env);
  if(request.method==="GET"&&!entityId){
    const [mediaResult,typeResult]=await database.batch([
      database.prepare("SELECT * FROM archive_catalogue_media ORDER BY sort_order,label"),
      database.prepare("SELECT * FROM archive_cultural_object_types ORDER BY medium_id,sort_order,label"),
    ]);
    return json({
      media:mediaResult.results||[],
      object_types:typeResult.results||[],
      documentation_fields:[...ARCHIVE_DOCUMENTATION_FIELDS].map((field_key,sort_order)=>({field_key,label:ARCHIVE_DOCUMENTATION_LABELS[field_key],sort_order:sort_order+1})),
    });
  }
  if(request.method==="GET"&&entityId){
    const record=await database.prepare(`SELECT ace.*,acm.label medium_label,cot.label object_type_label,cot.state_guidance
      FROM archive_catalogue_entries ace JOIN archive_catalogue_media acm ON acm.id=ace.medium_id
      JOIN archive_cultural_object_types cot ON cot.id=ace.object_type_id WHERE ace.entity_id=?`).bind(entityId).first();
    return record?json({record:{...record,catalogue_label:archiveCatalogueLabel(record),catalogueLabel:archiveCatalogueLabel(record)}}):failure("Catalogue entry not found.",404);
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const before=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).first();
    const owner=await database.prepare(`SELECT ce.* FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ad.entity_id=?`).bind(entityId).first();if(!owner)return failure("Dossier not found.",404);
    const mediumId=text(body.medium_id??body.mediumId??before?.medium_id,80),objectTypeId=text(body.object_type_id??body.objectTypeId??before?.object_type_id,120);
    const type=await database.prepare("SELECT * FROM archive_cultural_object_types WHERE id=? AND medium_id=?").bind(objectTypeId,mediumId).first();
    if(!type)return failure("Choose a cultural object type that belongs to the selected medium.",409);
    const requestedCatalogueNumber=Math.floor(Number(body.catalogue_number??body.catalogueNumber));
    let catalogueNumber=Number(before?.catalogue_number)||0;
    if(!before)catalogueNumber=await nextArchiveCatalogueNumber(database,type.catalogue_prefix);
    if(before&&((requestedCatalogueNumber>0&&requestedCatalogueNumber!==Number(before.catalogue_number))||type.catalogue_prefix!==before.catalogue_prefix))return failure("Permanent catalogue prefixes and sequence numbers cannot be changed in Studio.",409);
    const hasCurrentState=Object.prototype.hasOwnProperty.call(body,"current_state_id")||Object.prototype.hasOwnProperty.call(body,"currentStateId");
    let currentStateId=hasCurrentState?text(body.current_state_id??body.currentStateId,200):text(before?.current_state_id,200);
    let currentVersion=Number(before?.current_version||1),currentState=archiveRoman(before?.current_state||"I")||"I",variantLabel=text(before?.variant_label,120);
    if(currentStateId){
      const selected=await database.prepare(`SELECT aos.id,aos.state_roman,aos.variant_label,aos.publication_state,aos.public_visible,aos.lead_material_id,
          aov.entity_id,aov.version_number,aov.publication_state version_publication,aov.public_visible version_public_visible,
          lead.state lead_state,lead.visibility lead_visibility,
          lead_media.state lead_media_state,lead_media.privacy lead_media_privacy,lead_media.consent_status lead_consent_status,
          lead_media.public_presentation lead_public_presentation,lead_media.mime_type lead_mime_type
        FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
        LEFT JOIN archive_materials lead ON lead.id=aos.lead_material_id AND lead.state_id=aos.id
        LEFT JOIN media_assets lead_media ON lead_media.id=lead.media_id
        WHERE aos.id=? AND aov.entity_id=?`).bind(currentStateId,entityId).first();
      if(!selected)return failure("Choose a state that belongs to this cultural object.",409);
      if(selected.publication_state!=="published"||!Number(selected.public_visible)||selected.version_publication!=="published"||!Number(selected.version_public_visible))return failure("The current public condition must be a published, public version and state.",409);
      const currentSelectionChanged=hasCurrentState&&String(currentStateId||"")!==String(before?.current_state_id||"");
      if(currentSelectionChanged&&(!selected.lead_material_id||selected.lead_state!=="published"||selected.lead_visibility!=="public"||selected.lead_media_state!=="active"||selected.lead_media_privacy!=="public"||!["not-required","granted"].includes(selected.lead_consent_status)||selected.lead_public_presentation!=="inline"||!/^(image|video)\//i.test(selected.lead_mime_type||"")))return failure("The current public condition needs an eligible public image or video lead.",409);
      currentVersion=Number(selected.version_number);currentState=archiveRoman(selected.state_roman);variantLabel=text(selected.variant_label,120);
    }else if(hasCurrentState){
      currentStateId=null;currentVersion=1;currentState="I";variantLabel="";
    }
    const catalogueId=`${type.catalogue_prefix}-${String(catalogueNumber).padStart(3,"0")}`;
    try{
      if(before)await database.prepare(`UPDATE archive_catalogue_entries SET medium_id=?,object_type_id=?,catalogue_prefix=?,catalogue_number=?,catalogue_id=?,current_version=?,current_state=?,variant_label=?,current_state_id=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(mediumId,objectTypeId,type.catalogue_prefix,catalogueNumber,catalogueId,currentVersion,currentState,variantLabel,currentStateId,entityId).run();
      else await database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(entityId,mediumId,objectTypeId,type.catalogue_prefix,catalogueNumber,catalogueId,currentVersion,currentState,variantLabel,currentStateId).run();
    }catch(error){const duplicate=/UNIQUE constraint failed/i.test(error.message);return failure(duplicate?"A catalogue number was assigned at the same time. Save again to allocate the next number.":error.message,duplicate?409:400)}
    try{await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
    return archiveCatalogueAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
  }
  return failure("Method not allowed.",405);
}

async function archiveCatalogueReidentifyAdminApi(request,env,entityId=""){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const database=db(env),body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const before=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).first();
  if(!before)return failure("Catalogue entry not found.",404);
  const owner=await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();
  if(!owner)return failure("Dossier not found.",404);
  const expectedCatalogueId=text(body.expected_catalogue_id??body.expectedCatalogueId,200);
  if(!expectedCatalogueId)return failure("Confirm the current catalogue identity before re-identifying.",409);
  if(expectedCatalogueId!==before.catalogue_id)return failure("This catalogue identity changed after the dossier was opened. Reload it before re-identifying.",409);
  const mediumId=text(body.medium_id??body.mediumId,80),objectTypeId=text(body.object_type_id??body.objectTypeId,120);
  const type=await database.prepare("SELECT * FROM archive_cultural_object_types WHERE id=? AND medium_id=?").bind(objectTypeId,mediumId).first();
  if(!type)return failure("Choose a cultural object type that belongs to the selected medium.",409);
  if(type.catalogue_prefix===before.catalogue_prefix)return failure("This classification keeps the existing catalogue prefix. Use Save catalogue identity instead.",409);
  const releasedCatalogueId=before.catalogue_id;
  try{
    const updated=await database.prepare(`WITH candidates(candidate) AS (
        SELECT 1
        UNION
        SELECT catalogue_number+1 FROM archive_catalogue_entries WHERE catalogue_prefix=?
      ), next_number(value) AS (
        SELECT MIN(candidate) FROM candidates
        WHERE NOT EXISTS(
          SELECT 1 FROM archive_catalogue_entries occupied
          WHERE occupied.catalogue_prefix=? AND occupied.catalogue_number=candidates.candidate
        )
      )
      UPDATE archive_catalogue_entries
      SET medium_id=?,object_type_id=?,catalogue_prefix=?,
        catalogue_number=(SELECT value FROM next_number),
        catalogue_id=?||'-'||printf('%03d',(SELECT value FROM next_number)),
        updated_by='studio-reidentify',updated_at=datetime('now')
      WHERE entity_id=? AND catalogue_id=?
      RETURNING *`).bind(type.catalogue_prefix,type.catalogue_prefix,mediumId,objectTypeId,type.catalogue_prefix,type.catalogue_prefix,entityId,expectedCatalogueId).first();
    if(!updated)return failure("This catalogue identity changed after the dossier was opened. Reload it before re-identifying.",409);
  }catch(error){
    const duplicate=/UNIQUE constraint failed/i.test(String(error?.message||error));
    return failure(duplicate?"Another catalogue identity was assigned at the same time. Reload and try again.":error.message,duplicate?409:400);
  }
  const response=await archiveCatalogueAdminApi(new Request(request.url.replace(/\/reidentify$/,""),{method:"GET",headers:request.headers}),env,entityId);
  if(!response.ok)return response;
  const payload=await response.json();
  return json({...payload,released_catalogue_id:releasedCatalogueId,releasedCatalogueId});
}

function normalizeArchiveDocumentation(body,existing={}){
  return {
    dossier_entity_id:text(body.dossier_entity_id??body.entity_id??body.entityId??existing.dossier_entity_id,200),
    field_key:text(body.field_key??body.fieldKey??existing.field_key,80).toLowerCase(),
    label:text(body.label??existing.label,160),
    value:text(body.value??existing.value,50000),
    citation:text(body.citation??existing.citation,5000),
    url:text(body.url??existing.url,2000),
    public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):(truthy(body.public_visible??body.publicVisible)?1:0),
    sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,
  };
}

async function archiveDocumentationAdminApi(request,env,entryId=""){
  const database=db(env);
  if(request.method==="GET"&&!entryId){
    const entityId=text(new URL(request.url).searchParams.get("entity_id"),200),where=entityId?" WHERE dossier_entity_id=?":"";
    const statement=database.prepare(`SELECT * FROM archive_catalogue_documentation${where} ORDER BY dossier_entity_id,sort_order,field_key,created_at,id`);
    const result=entityId?await statement.bind(entityId).all():await statement.all();
    return json({records:(result.results||[]).map(presentArchiveDocumentation),documentation:(result.results||[]).map(presentArchiveDocumentation)});
  }
  const before=entryId?await database.prepare("SELECT * FROM archive_catalogue_documentation WHERE id=?").bind(entryId).first():null;
  if(entryId&&!before)return failure("Documentation entry not found.",404);
  if(request.method==="POST"&&!entryId){
    const body=await readJson(request),record=normalizeArchiveDocumentation(body||{});
    if(!record.dossier_entity_id||!ARCHIVE_DOCUMENTATION_FIELDS.has(record.field_key)||!record.value)return failure("Choose a valid documentation field and enter a value.",409);
    if(!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(record.dossier_entity_id).first())return failure("Dossier not found.",404);
    if(record.url&&!/^https?:\/\//i.test(record.url))return failure("Documentation URLs must begin with http:// or https://.",409);
    const newId=text(body?.id,200)||id("archive-documentation");
    await database.prepare(`INSERT INTO archive_catalogue_documentation(id,dossier_entity_id,field_key,label,value,citation,url,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.dossier_entity_id,record.field_key,record.label,record.value,record.citation,record.url,record.public_visible,record.sort_order).run();
    return json({record:presentArchiveDocumentation(await database.prepare("SELECT * FROM archive_catalogue_documentation WHERE id=?").bind(newId).first())},{status:201});
  }
  if(request.method==="PATCH"&&entryId){
    const body=await readJson(request),record=normalizeArchiveDocumentation(body||{},before);
    if(!ARCHIVE_DOCUMENTATION_FIELDS.has(record.field_key)||!record.value)return failure("Choose a valid documentation field and enter a value.",409);
    if(record.dossier_entity_id!==before.dossier_entity_id)return failure("Documentation entries cannot move between dossiers.",409);
    if(record.url&&!/^https?:\/\//i.test(record.url))return failure("Documentation URLs must begin with http:// or https://.",409);
    await database.prepare(`UPDATE archive_catalogue_documentation SET field_key=?,label=?,value=?,citation=?,url=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(record.field_key,record.label,record.value,record.citation,record.url,record.public_visible,record.sort_order,entryId).run();
    return json({record:presentArchiveDocumentation(await database.prepare("SELECT * FROM archive_catalogue_documentation WHERE id=?").bind(entryId).first())});
  }
  if(request.method==="DELETE"&&entryId){
    await database.prepare("DELETE FROM archive_catalogue_documentation WHERE id=?").bind(entryId).run();
    return json({ok:true});
  }
  return failure("Method not allowed.",405);
}

async function archiveEventIdentifierAdminApi(request,env,entityId=""){
  const database=db(env);
  if(!entityId)return failure("Event entity ID is required.");
  const owner=await database.prepare(`SELECT ce.id,ce.entity_type
    FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE ad.entity_id=?`).bind(entityId).first();
  if(!owner)return failure("Event dossier not found.",404);
  if(owner.entity_type!=="event")return failure("Event identifiers are available only for Event records.",409);
  if(request.method==="GET"){
    const record=await database.prepare("SELECT * FROM archive_event_identifiers WHERE entity_id=?").bind(entityId).first();
    return record?json({record}):failure("Event identifier not found.",404);
  }
  if(request.method==="PATCH"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const before=await database.prepare("SELECT * FROM archive_event_identifiers WHERE entity_id=?").bind(entityId).first();
    let eventNumber=Math.floor(Number(body.event_number??body.eventNumber??before?.event_number));
    if(!eventNumber||eventNumber<1){const maximum=await database.prepare("SELECT COALESCE(MAX(event_number),0) maximum FROM archive_event_identifiers").first();eventNumber=Number(maximum?.maximum||0)+1}
    const eventId=`EVT-${String(eventNumber).padStart(3,"0")}`;
    try{
      if(before)await database.prepare("UPDATE archive_event_identifiers SET event_number=?,event_id=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(eventNumber,eventId,entityId).run();
      else await database.prepare(`INSERT INTO archive_event_identifiers(entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(entityId,eventNumber,eventId).run();
    }catch(error){const duplicate=/UNIQUE constraint failed/i.test(error.message);return failure(duplicate?"That Event number is already assigned.":error.message,duplicate?409:400)}
    return archiveEventIdentifierAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
  }
  return failure("Method not allowed.",405);
}

function normalizeArchiveVersion(body,existing={}){
  return {entity_id:text(body.entity_id??body.entityId??existing.entity_id,200),version_number:Math.floor(Number(body.version_number??body.versionNumber??existing.version_number??1)),title:text(body.title??existing.title,300),description:text(body.description??existing.description,5000),occurred_at:text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||"undated",date_label:text(body.date_label??body.dateLabel??existing.date_label,160),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,publication_state:text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft",public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):(truthy(body.public_visible??body.publicVisible)?1:0)};
}

async function archiveVersionsAdminApi(request,env,versionId=""){
  const database=db(env);
  if(request.method==="GET"&&!versionId){
    const entityId=text(new URL(request.url).searchParams.get("entity_id"),200),where=entityId?" WHERE entity_id=?":"";
    const statement=database.prepare(`SELECT * FROM archive_object_versions${where} ORDER BY entity_id,sort_order,version_number`),result=entityId?await statement.bind(entityId).all():await statement.all();
    return json({records:result.results||[]});
  }
  if(request.method==="POST"&&!versionId){
    const body=await readJson(request),record=normalizeArchiveVersion(body||{});
    if(!record.entity_id||record.version_number<1||!ARCHIVE_DATE_PRECISIONS.has(record.date_precision)||!ARCHIVE_STATES.has(record.publication_state))return failure("A cultural object, positive version number, valid date precision, and publication state are required.",409);
    if(!await database.prepare("SELECT entity_id FROM archive_catalogue_entries WHERE entity_id=?").bind(record.entity_id).first())return failure("Catalogue entry not found.",404);
    const newId=text(body?.id,200)||id("archive-version");
    try{await database.prepare(`INSERT INTO archive_object_versions(id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.entity_id,record.version_number,record.title,record.description,record.occurred_at,record.date_precision,record.date_label,record.sort_order,record.publication_state,record.public_visible).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(error.message)?"That version number already exists.":error.message,409)}
    return json({record:await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(newId).first()},{status:201});
  }
  const before=versionId?await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(versionId).first():null;if(versionId&&!before)return failure("Version not found.",404);
  if(request.method==="PATCH"&&versionId){
    const body=await readJson(request),record=normalizeArchiveVersion(body||{},before);if(record.version_number<1||!ARCHIVE_DATE_PRECISIONS.has(record.date_precision)||!ARCHIVE_STATES.has(record.publication_state))return failure("Invalid version.",409);
    if((record.publication_state!=="published"||!record.public_visible)&&await database.prepare(`SELECT ace.entity_id FROM archive_catalogue_entries ace JOIN archive_object_states aos ON aos.id=ace.current_state_id WHERE aos.version_id=?`).bind(versionId).first())return failure("Choose another current public condition before hiding this version.",409);
    try{await database.prepare(`UPDATE archive_object_versions SET version_number=?,title=?,description=?,occurred_at=?,date_precision=?,date_label=?,sort_order=?,publication_state=?,public_visible=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(record.version_number,record.title,record.description,record.occurred_at,record.date_precision,record.date_label,record.sort_order,record.publication_state,record.public_visible,versionId).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(error.message)?"That version number already exists.":error.message,409)}
    return json({record:await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(versionId).first()});
  }
  if(request.method==="DELETE"&&versionId){
    const current=await database.prepare(`SELECT ace.entity_id FROM archive_catalogue_entries ace JOIN archive_object_states aos ON aos.id=ace.current_state_id WHERE aos.version_id=?`).bind(versionId).first();if(current)return failure("Choose another current public condition before removing this version.",409);
    const used=await database.prepare(`SELECT
      (SELECT COUNT(*) FROM archive_object_states aos JOIN archive_materials am ON am.state_id=aos.id WHERE aos.version_id=?)
      + (SELECT COUNT(*) FROM archive_object_states aos JOIN archive_source_material_states smss ON smss.state_id=aos.id WHERE aos.version_id=?) count`).bind(versionId,versionId).first();if(Number(used?.count||0))return failure("Move materials and source materials out of this version before removing it.",409);
    const count=await database.prepare("SELECT COUNT(*) count FROM archive_object_versions WHERE entity_id=?").bind(before.entity_id).first();if(Number(count?.count||0)<=1)return failure("Every cultural object needs at least one version.",409);
    await database.prepare("DELETE FROM archive_object_versions WHERE id=?").bind(versionId).run();return json({ok:true});
  }
  return failure("Method not allowed.",405);
}

function normalizeArchiveObjectState(body,existing={}){
  return {version_id:text(body.version_id??body.versionId??existing.version_id,200),state_roman:archiveRoman(body.state_roman??body.stateRoman??existing.state_roman),state_order:Math.floor(Number(body.state_order??body.stateOrder??existing.state_order??1)),title:text(body.title??existing.title,300),description:text(body.description??existing.description,5000),variant_label:text(body.variant_label??body.variantLabel??existing.variant_label,120),occurred_at:text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||"undated",date_label:text(body.date_label??body.dateLabel??existing.date_label,160),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,publication_state:text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft",public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(existing.public_visible||0):(truthy(body.public_visible??body.publicVisible)?1:0),lead_material_id:text(body.lead_material_id??body.leadMaterialId??existing.lead_material_id,200)||null};
}

async function validateArchiveObjectState(database,record,stateId=""){
  if(!record.version_id||!record.state_roman||record.state_order<1||!ARCHIVE_DATE_PRECISIONS.has(record.date_precision)||!ARCHIVE_STATES.has(record.publication_state))return failure("A version, Roman numeral, positive order, valid date precision, and publication state are required.",409);
  const version=await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(record.version_id).first();if(!version)return failure("Version not found.",404);
  let lead=null;
  if(record.lead_material_id){
    lead=await database.prepare(`SELECT am.*,m.state media_state,m.privacy media_privacy,m.consent_status,m.public_presentation,m.mime_type
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.id=?`).bind(record.lead_material_id).first();
    if(!lead||!stateId||lead.state_id!==stateId)return failure("The lead material must belong to this state.",409);
    if(!/^(image|video)\//i.test(lead.mime_type||""))return failure("A state lead must be an image or video Digital asset.",409);
  }
  if(record.publication_state==="published"&&record.public_visible){
    if(version.publication_state!=="published"||!Number(version.public_visible))return failure("Publish the parent version before publishing this state.",409);
    if(!stateId||!lead)return failure("Save the state as an internal draft, attach an eligible visual material, and choose it as the lead before publishing.",409);
    if(lead&&(lead.state!=="published"||lead.visibility!=="public"||lead.media_state!=="active"||lead.media_privacy!=="public"||!["not-required","granted"].includes(lead.consent_status)||lead.public_presentation!=="inline"))return failure("A public state lead must be a published public material with an eligible Digital asset.",409);
  }
  return {version,lead};
}

async function archiveStatesAdminApi(request,env,stateId=""){
  const database=db(env);
  if(request.method==="GET"&&!stateId){
    const url=new URL(request.url),entityId=text(url.searchParams.get("entity_id"),200),versionId=text(url.searchParams.get("version_id"),200),conditions=[],values=[];
    if(entityId){conditions.push("aov.entity_id=?");values.push(entityId)}if(versionId){conditions.push("aos.version_id=?");values.push(versionId)}
    const where=conditions.length?` WHERE ${conditions.join(" AND ")}`:"",result=await database.prepare(`SELECT aos.*,aov.entity_id,aov.version_number FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id${where} ORDER BY aov.version_number,aos.sort_order,aos.state_order,aos.variant_label`).bind(...values).all();
    return json({records:result.results||[]});
  }
  if(request.method==="POST"&&!stateId){
    const body=await readJson(request),record=normalizeArchiveObjectState(body||{});
    const valid=await validateArchiveObjectState(database,record);if(valid instanceof Response)return valid;
    const newId=text(body?.id,200)||id("archive-state");
    try{await database.prepare(`INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,lead_material_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.version_id,record.state_roman,record.state_order,record.title,record.description,record.variant_label,record.occurred_at,record.date_precision,record.date_label,record.sort_order,record.publication_state,record.public_visible,null).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(error.message)?"That state order and variant already exist in this version.":error.message,409)}
    return json({record:await database.prepare("SELECT * FROM archive_object_states WHERE id=?").bind(newId).first()},{status:201});
  }
  const before=stateId?await database.prepare("SELECT * FROM archive_object_states WHERE id=?").bind(stateId).first():null;if(stateId&&!before)return failure("State not found.",404);
  if(request.method==="PATCH"&&stateId){
    const body=await readJson(request),record=normalizeArchiveObjectState(body||{},before);const valid=await validateArchiveObjectState(database,record,stateId);if(valid instanceof Response)return valid;
    const current=await database.prepare("SELECT entity_id FROM archive_catalogue_entries WHERE current_state_id=?").bind(stateId).first();
    if(current&&(record.publication_state!=="published"||!record.public_visible))return failure("Choose another current public condition before hiding this state.",409);
    try{await database.prepare(`UPDATE archive_object_states SET state_roman=?,state_order=?,title=?,description=?,variant_label=?,occurred_at=?,date_precision=?,date_label=?,sort_order=?,publication_state=?,public_visible=?,lead_material_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(record.state_roman,record.state_order,record.title,record.description,record.variant_label,record.occurred_at,record.date_precision,record.date_label,record.sort_order,record.publication_state,record.public_visible,record.lead_material_id,stateId).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(error.message)?"That state order and variant already exist in this version.":error.message,409)}
    if(current)await database.prepare(`UPDATE archive_catalogue_entries SET current_version=(SELECT version_number FROM archive_object_versions WHERE id=?),current_state=?,variant_label=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(record.version_id,record.state_roman,record.variant_label,current.entity_id).run();
    return json({record:await database.prepare("SELECT * FROM archive_object_states WHERE id=?").bind(stateId).first()});
  }
  if(request.method==="DELETE"&&stateId){
    if(await database.prepare("SELECT entity_id FROM archive_catalogue_entries WHERE current_state_id=?").bind(stateId).first())return failure("Choose another current public condition before removing this state.",409);
    const used=await database.prepare(`SELECT
      (SELECT COUNT(*) FROM archive_materials WHERE state_id=?)
      + (SELECT COUNT(*) FROM archive_source_material_states WHERE state_id=?) count`).bind(stateId,stateId).first();if(Number(used?.count||0))return failure("Move materials and source materials out of this state before removing it.",409);
    const count=await database.prepare("SELECT COUNT(*) count FROM archive_object_states WHERE version_id=?").bind(before.version_id).first();if(Number(count?.count||0)<=1)return failure("Every version needs at least one state.",409);
    await database.prepare("DELETE FROM archive_object_states WHERE id=?").bind(stateId).run();return json({ok:true});
  }
  return failure("Method not allowed.",405);
}

async function archiveDossiersAdminApi(request,env,entityId=""){
  const database=db(env);
  if(request.method==="GET"){
    const where=entityId?"ad.entity_id=?":"1=1";const statement=database.prepare(`${archiveEntitySql(where)} ORDER BY ad.updated_at DESC,ad.entity_id`);const result=entityId?await statement.bind(entityId).all():await statement.all();const records=(result.results||[]).map(row=>({...row,...presentArchiveItem(row)}));
    if(entityId&&!records[0])return failure("Dossier not found.",404);
    if(entityId){
      const [originResult,contextResult,themeResult,versionResult,stateResult,documentationResult]=await database.batch([
        database.prepare(`SELECT ot.*,otd.is_primary,otd.sort_order assignment_sort_order FROM archive_origin_thread_dossiers otd JOIN archive_origin_threads ot ON ot.id=otd.thread_id WHERE otd.dossier_entity_id=? ORDER BY otd.is_primary DESC,otd.sort_order,ot.title`).bind(entityId),
        database.prepare(`SELECT ads.subject_entity_id entity_id,ads.role,ads.public_visible,ads.sort_order,ce.entity_type,
          COALESCE(p.name,o.name,pl.name,ev.title,ce.id) name
          FROM archive_dossier_subjects ads JOIN content_entities ce ON ce.id=ads.subject_entity_id
          LEFT JOIN people p ON p.id=ce.id LEFT JOIN organizations o ON o.id=ce.id
          LEFT JOIN places pl ON pl.id=ce.id LEFT JOIN events ev ON ev.id=ce.id
          WHERE ads.dossier_entity_id=? ORDER BY ads.sort_order,name`).bind(entityId),
        database.prepare(`SELECT tt.id,tt.name,tt.slug,tt.description FROM entity_terms et JOIN taxonomy_terms tt ON tt.id=et.term_id WHERE et.entity_id=? AND tt.kind='theme' ORDER BY tt.sort_order,tt.name`).bind(entityId),
        database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=? ORDER BY sort_order,version_number").bind(entityId),
        database.prepare(`SELECT aos.*,aov.entity_id,aov.version_number FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id WHERE aov.entity_id=? ORDER BY aov.version_number,aos.sort_order,aos.state_order,aos.variant_label`).bind(entityId),
        database.prepare("SELECT * FROM archive_catalogue_documentation WHERE dossier_entity_id=? ORDER BY sort_order,field_key,created_at,id").bind(entityId),
      ]);
      const originThreads=originResult.results||[],contextAssignments=contextResult.results||[],themes=themeResult.results||[],versions=versionResult.results||[],states=stateResult.results||[],documentation=(documentationResult.results||[]).map(presentArchiveDocumentation);
      const enriched={...records[0],origin_threads:originThreads,origin_thread_ids:originThreads.map(thread=>thread.id),primary_origin_thread_id:originThreads.find(thread=>Number(thread.is_primary))?.id||"",context_assignments:contextAssignments,themes,theme_names:themes.map(theme=>theme.name),versions,states,documentation};
      return json({record:enriched,dossier:enriched,origin_threads:originThreads,context_assignments:contextAssignments,themes,versions,states,documentation});
    }
    return json({records,count:records.length});
  }
  if(request.method==="POST"&&!entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const ownerId=text(body.entity_id||body.entityId,200);if(!ownerId)return failure("entity_id is required.");
    const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(ownerId).first();if(!owner)return failure("Canonical entity not found.",404);if(!await archiveDossierEligibleOwner(database,owner))return failure("That entity type is not eligible for an Archive dossier.",409);
    const archiveSlug=slug(body.archive_slug||body.archiveSlug||body.slug||ownerId);if(!archiveSlug)return failure("archive_slug is required.");const state=text(body.state,30)||"draft",publicVisible=truthy(body.public_visible??body.publicVisible)?1:0;if(!ARCHIVE_STATES.has(state))return failure("Invalid dossier state.");if(state==="published"&&publicVisible&&owner.visibility!=="public")return failure("The canonical entity must be public before its dossier can publish.",409);
    await database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' AND ?=1 THEN datetime('now') ELSE NULL END,'studio','studio',datetime('now'),datetime('now'))`).bind(ownerId,archiveSlug,text(body.orientation,8000),text(body.story,50000),text(body.story_html,50000),text(body.empty_materials_note,3000)||"No process materials are public yet.",text(body.record_type,100)||archiveRecordType(owner.entity_type),state,publicVisible,truthy(body.featured)?1:0,Number(body.sort_order)||0,state,publicVisible).run();
    try{await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
    return archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,ownerId);
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();if(!before)return failure("Dossier not found.",404);const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(entityId).first();
    const next={archive_slug:slug(body.archive_slug??body.archiveSlug??body.slug??before.archive_slug),orientation:text(body.orientation??before.orientation,8000),story:text(body.story??before.story,50000),story_html:text(body.story_html??before.story_html,50000),empty_materials_note:text(body.empty_materials_note??before.empty_materials_note,3000),record_type:text(body.record_type??body.recordType??before.record_type,100),state:text(body.state??before.state,30),public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible)?1:0,featured:body.featured===undefined?Number(before.featured):truthy(body.featured)?1:0,sort_order:Number(body.sort_order??before.sort_order)||0};
    if(!next.archive_slug)return failure("archive_slug is required.");if(!ARCHIVE_STATES.has(next.state))return failure("Invalid dossier state.");if(next.state==="published"&&next.public_visible&&owner?.visibility!=="public")return failure("The canonical entity must be public before its dossier can publish.",409);
    const hasOriginUpdate=Object.prototype.hasOwnProperty.call(body,"origin_thread_ids")||Object.prototype.hasOwnProperty.call(body,"originThreadIds"),assignmentIds=hasOriginUpdate?originThreadIds(body.origin_thread_ids??body.originThreadIds):[],primaryOriginId=hasOriginUpdate?text(body.primary_origin_thread_id??body.primaryOriginThreadId,200):"";
    if(hasOriginUpdate&&(primaryOriginId&&!assignmentIds.includes(primaryOriginId)||!await validateOriginThreadIds(database,assignmentIds)))return failure("Choose valid origin threads and make the primary thread part of the dossier assignment.",409);
    await database.prepare(`UPDATE archive_dossiers SET archive_slug=?,orientation=?,story=?,story_html=?,empty_materials_note=?,record_type=?,state=?,public_visible=?,featured=?,sort_order=?,published_at=CASE WHEN ?='published' AND ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(next.archive_slug,next.orientation,next.story,next.story_html,next.empty_materials_note,next.record_type,next.state,next.public_visible,next.featured,next.sort_order,next.state,next.public_visible,entityId).run();
    if(hasOriginUpdate)await replaceDossierOriginThreads(database,entityId,assignmentIds,primaryOriginId);
    try{
      await replaceArchiveContext(database,entityId,archiveContextAssignments(body.context_assignments??body.contextAssignments));
      await replaceArchiveThemes(database,entityId,body.theme_names??body.themeNames);
    }catch(error){return failure(error.message,409)}
    try{await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
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
  return {id:text(existing.id??body.id,200),dossier_entity_id:text(body.dossier_entity_id??body.entity_id??body.entityId??existing.dossier_entity_id,200),media_id:text(body.media_id??body.mediaId??existing.media_id,200)||null,role:text(body.role??existing.role,80)||"notebook",material_type:materialType,title:text(body.title??existing.title,300),caption:text(body.caption??existing.caption,5000),body:text(body.body??body.inline_text??body.inlineText??existing.body,100000),process_phase:text(body.process_phase??body.processPhase??existing.process_phase,120),occurred_at:occurredAt,ended_at:endedAt,date_precision:datePrecision,date_label:text(body.date_label??body.display_date??body.displayDate??existing.date_label,160),visibility,state,sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,state_id:text(body.state_id??body.stateId??existing.state_id,200)||null,material_reference:text(body.material_reference??body.materialReference??existing.material_reference,30).toUpperCase(),is_sample:body.is_sample===undefined&&body.isSample===undefined?Number(existing.is_sample||0):(truthy(body.is_sample??body.isSample)?1:0)};
}

async function validateArchiveMaterial(database,material){
  if(!material.dossier_entity_id)return failure("entity_id is required.");if(!ARCHIVE_MATERIAL_TYPES.has(material.material_type))return failure("Invalid material type.");if(!ARCHIVE_VISIBILITIES.has(material.visibility))return failure("Invalid material visibility.");if(!ARCHIVE_STATES.has(material.state))return failure("Invalid material state.");if(!ARCHIVE_DATE_PRECISIONS.has(material.date_precision))return failure("Invalid date precision.");if(!material.media_id&&!material.body)return failure("A material needs media_id or inline_text.");
  const dossier=await database.prepare("SELECT ad.*,ce.visibility canonical_visibility FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ad.entity_id=?").bind(material.dossier_entity_id).first();if(!dossier)return failure("Dossier not found.",404);
  const catalogue=await database.prepare("SELECT entity_id FROM archive_catalogue_entries WHERE entity_id=?").bind(material.dossier_entity_id).first();
  if(material.state_id){const state=await database.prepare("SELECT aos.id FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id WHERE aos.id=? AND aov.entity_id=?").bind(material.state_id,material.dossier_entity_id).first();if(!state)return failure("Choose a state that belongs to this cultural object.",409)}
  if(catalogue&&material.state==="published"&&material.visibility==="public"&&!material.state_id)return failure("Published cultural-object materials must document a version and state.",409);
  if(material.material_reference&&!/^[MNDS]\d{2,4}$/.test(material.material_reference))return failure("Material references use M, N, D, or S followed by at least two digits.",409);
  if(material.is_sample){const catalogue=await database.prepare("SELECT medium_id FROM archive_catalogue_entries WHERE entity_id=?").bind(material.dossier_entity_id).first();if(catalogue?.medium_id!=="merch")return failure("Samples are available only for Merch cultural objects.",409)}
  let media=null;if(material.media_id){media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(material.media_id).first();if(!media)return failure("Media not found.",404)}
  const leadState=await database.prepare("SELECT * FROM archive_object_states WHERE lead_material_id=?").bind(material.id||"").first();
  if(leadState){
    if(material.state_id!==leadState.id)return failure("Choose another state lead before moving this material.",409);
    if(!media||!/^(image|video)\//i.test(media.mime_type||""))return failure("Choose another state lead before replacing its visual Digital asset.",409);
    if(leadState.publication_state==="published"&&Number(leadState.public_visible)&&(material.state!=="published"||material.visibility!=="public"||!media||media.state!=="active"||media.privacy!=="public"||!["not-required","granted"].includes(media.consent_status)||media.public_presentation!=="inline"))return failure("Choose another state lead before hiding or archiving this public material.",409);
  }
  if(material.state==="published"&&material.visibility==="public"){
    if(dossier.state!=="published"||!Number(dossier.public_visible)||dossier.canonical_visibility!=="public")return failure("Publish the canonical entity and dossier before publishing this material.",409);
    if(media&&(media.state!=="active"||media.privacy!=="public"||!["not-required","granted"].includes(media.consent_status)||media.public_presentation!=="inline"))return failure("The attached Digital asset must be active, public, shown inline, and have granted or not-required consent.",409);
  }
  return {dossier,media};
}

function archiveMaterialAdminSql(where="1=1"){
  return `SELECT am.*,m.original_filename,m.mime_type,m.byte_size,m.width,m.height,m.duration_seconds,m.source_url,m.storage_key,
    m.alt_text,m.caption media_caption,m.privacy media_privacy,m.consent_status,m.state media_state,
    m.transcript,m.transcript_status,m.transcript_language,m.public_title,m.public_description,m.public_presentation
    FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE ${where}`;
}

async function archiveMaterialAdminRecord(database,materialId){
  return presentArchiveMaterial(await database.prepare(archiveMaterialAdminSql("am.id=?")).bind(materialId).first(),true);
}

async function archiveMaterialsAdminApi(request,env,materialId=""){
  const database=db(env);
  if(request.method==="GET"&&!materialId){const url=new URL(request.url),entityId=text(url.searchParams.get("entity_id")||url.searchParams.get("entityId"),200);const statement=database.prepare(`${archiveMaterialAdminSql(entityId?"am.dossier_entity_id=?":"1=1")} ORDER BY am.dossier_entity_id,am.sort_order,am.created_at`);const result=entityId?await statement.bind(entityId).all():await statement.all();const rows=result.results||[],ids=rows.map(row=>row.id),assignmentRows=ids.length?(await database.prepare(`SELECT material_id,thread_id FROM archive_origin_thread_materials WHERE material_id IN (${ids.map(()=>"?").join(",")}) ORDER BY sort_order`).bind(...ids).all()).results||[]:[],byMaterial=new Map();assignmentRows.forEach(row=>{if(!byMaterial.has(row.material_id))byMaterial.set(row.material_id,[]);byMaterial.get(row.material_id).push(row.thread_id)});const records=rows.map(row=>({...presentArchiveMaterial(row,true),origin_thread_ids:byMaterial.get(row.id)||[]}));return json({records,materials:records,count:records.length});}
  if(request.method==="POST"&&materialId==="reorder"){const body=await readJson(request);const entityId=text(body?.entity_id||body?.entityId,200),ids=body?.ids;if(!entityId||!Array.isArray(ids))return failure("entity_id and ids are required.");const current=(await database.prepare("SELECT id FROM archive_materials WHERE dossier_entity_id=? ORDER BY sort_order,id").bind(entityId).all()).results||[];const set=new Set(ids);if(ids.length!==current.length||set.size!==current.length||current.some(row=>!set.has(row.id)))return failure("The material list changed. Refresh before reordering.",409);await database.batch(ids.map((recordId,index)=>database.prepare("UPDATE archive_materials SET sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=? AND dossier_entity_id=?").bind(index+1,recordId,entityId)));return json({ok:true});}
  if(request.method==="POST"&&!materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const material=normalizeArchiveMaterial(body);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;const ids=originThreadIds(body.origin_thread_ids??body.originThreadIds);if(!await validateOriginThreadIds(database,ids))return failure("Choose valid origin threads.",409);if(!material.material_reference){const prefix=material.is_sample?"S":material.material_type==="note"?"N":material.material_type==="document"?"D":"M";if(prefix==="D"&&material.state_id)material.material_reference=await nextArchiveSourceDocumentReference(database,material.state_id);else{const count=await database.prepare("SELECT COUNT(*) count FROM archive_materials WHERE state_id IS ? AND material_reference LIKE ?").bind(material.state_id,`${prefix}%`).first();material.material_reference=`${prefix}${String(Number(count?.count||0)+1).padStart(2,"0")}`}}const materialIdNew=text(body.id,200)||id("archive-material");try{await database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,ended_at,date_precision,date_label,visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(materialIdNew,material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,material.state_id,material.material_reference,material.is_sample).run()}catch(error){return failure(/UNIQUE constraint failed|reference already belongs/i.test(error.message)?"That material reference already exists in this state.":error.message,409)}await replaceMaterialOriginThreads(database,materialIdNew,ids);return json({record:{...await archiveMaterialAdminRecord(database,materialIdNew),origin_thread_ids:ids}},{status:201});}
  if(request.method==="PATCH"&&materialId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_materials WHERE id=?").bind(materialId).first();if(!before)return failure("Material not found.",404);const material=normalizeArchiveMaterial(body,before);const valid=await validateArchiveMaterial(database,material);if(valid instanceof Response)return valid;let ids=null;if(Object.prototype.hasOwnProperty.call(body,"origin_thread_ids")||Object.prototype.hasOwnProperty.call(body,"originThreadIds")){ids=originThreadIds(body.origin_thread_ids??body.originThreadIds);if(!await validateOriginThreadIds(database,ids))return failure("Choose valid origin threads.",409)}try{await database.prepare(`UPDATE archive_materials SET dossier_entity_id=?,media_id=?,role=?,material_type=?,title=?,caption=?,body=?,process_phase=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,visibility=?,state=?,sort_order=?,state_id=?,material_reference=?,is_sample=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(material.dossier_entity_id,material.media_id,material.role,material.material_type,material.title,material.caption,material.body,material.process_phase,material.occurred_at,material.ended_at,material.date_precision,material.date_label,material.visibility,material.state,material.sort_order,material.state_id,material.material_reference,material.is_sample,materialId).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(error.message)?"That material reference already exists in this state.":error.message,409)}if(ids)await replaceMaterialOriginThreads(database,materialId,ids);return json({record:{...await archiveMaterialAdminRecord(database,materialId),...(ids?{origin_thread_ids:ids}:{})}});}
  if(request.method==="DELETE"&&materialId){
    const before=await database.prepare("SELECT id FROM archive_materials WHERE id=?").bind(materialId).first();
    if(!before)return failure("Material not found.",404);
    const leadState=await database.prepare("SELECT id FROM archive_object_states WHERE lead_material_id=? LIMIT 1").bind(materialId).first();
    if(leadState)return failure("Choose another state lead before archiving this material.",409);
    await database.prepare("UPDATE archive_materials SET state='archived',visibility='internal',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(materialId).run();
    return json({ok:true,archived:true});
  }
  return failure("Method not allowed.",405);
}

function archiveSourceMaterialStateIds(value){
  const source=Array.isArray(value)?value:String(value||"").split(",");
  return [...new Set(source.map(item=>text(typeof item==="object"?(item.state_id||item.stateId||item.id):item,200)).filter(Boolean))].slice(0,50);
}

function normalizeArchiveSourceMaterialSet(body,existing={}){
  const occurredAt=text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null;
  const sourceKind=text(body.source_kind??body.sourceKind??existing.source_kind,80)||"client-correspondence";
  return {
    dossier_entity_id:text(body.dossier_entity_id??body.entity_id??body.entityId??existing.dossier_entity_id,200),
    source_kind:sourceKind,
    title:text(body.title??existing.title,300)||(sourceKind==="blackboard"?"Blackboard source":"Client correspondence"),
    board_entity_id:text(body.board_entity_id??body.boardEntityId??existing.board_entity_id,200)||null,
    caption:text(body.caption??existing.caption,5000),
    occurred_at:occurredAt,
    ended_at:text(body.ended_at??body.endedAt??existing.ended_at,80)||null,
    date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||(occurredAt?"exact":"undated"),
    date_label:text(body.date_label??body.dateLabel??existing.date_label,160),
    visibility:text(body.visibility??existing.visibility,30)||"internal",
    publication_state:text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft",
    permission_status:text(body.permission_status??body.permissionStatus??existing.permission_status,30)||"not-required",
    sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,
  };
}

function normalizeArchiveSourceEntry(body,existing={}){
  return {
    source_material_set_id:text(body.source_material_set_id??body.sourceMaterialSetId??existing.source_material_set_id,200),
    media_id:text(body.media_id??body.mediaId??existing.media_id,200)||null,
    entry_type:text(body.entry_type??body.entryType??existing.entry_type,80)||"correspondence-page",
    title:text(body.title??existing.title,300),
    caption:text(body.caption??existing.caption,5000),
    body:text(body.body??body.inline_text??body.inlineText??existing.body,100000),
    public_included:body.public_included===undefined&&body.publicIncluded===undefined
      ? (existing.public_included===undefined?1:Number(existing.public_included)!==0?1:0)
      : (truthy(body.public_included??body.publicIncluded)?1:0),
    sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,
  };
}

function archiveSourceEntryAdminSql(where="1=1"){
  return `SELECT smse.*,m.original_filename,m.mime_type,m.byte_size,m.width,m.height,m.duration_seconds,
    m.source_url,m.storage_key,m.alt_text,m.caption media_caption,m.privacy media_privacy,
    m.consent_status,m.state media_state,m.public_title,m.public_description,m.public_presentation,
    CASE WHEN m.public_presentation='inline'
      THEN COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
      ELSE '' END media_url
    FROM archive_source_material_entries smse
    LEFT JOIN media_assets m ON m.id=smse.media_id
    WHERE ${where}`;
}

async function archiveSourceMaterialAdminRecords(database,{entityId="",setId=""}={}){
  const conditions=[],values=[];
  if(entityId){conditions.push("sms.dossier_entity_id=?");values.push(entityId)}
  if(setId){conditions.push("sms.id=?");values.push(setId)}
  const rows=(await database.prepare(`SELECT sms.* FROM archive_source_material_sets sms
    ${conditions.length?`WHERE ${conditions.join(" AND ")}`:""}
    ORDER BY sms.dossier_entity_id,sms.sort_order,sms.created_at,sms.id`).bind(...values).all()).results||[];
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id),marks=ids.map(()=>"?").join(",");
  const [entriesResult,statesResult]=await database.batch([
    database.prepare(`${archiveSourceEntryAdminSql(`smse.source_material_set_id IN (${marks})`)}
      ORDER BY smse.source_material_set_id,smse.sort_order,smse.created_at,smse.id`).bind(...ids),
    database.prepare(`SELECT smss.*,aos.state_roman,aos.variant_label,aos.title state_title,
        aos.publication_state state_publication_state,aos.public_visible state_public_visible,
        aov.version_number,aov.publication_state version_publication_state,aov.public_visible version_public_visible
      FROM archive_source_material_states smss
      JOIN archive_object_states aos ON aos.id=smss.state_id
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      WHERE smss.source_material_set_id IN (${marks})
      ORDER BY smss.source_material_set_id,smss.sort_order,aov.sort_order,aov.version_number,aos.sort_order,aos.state_order`).bind(...ids),
  ]);
  const entriesBySet=new Map(),statesBySet=new Map();
  for(const entry of entriesResult.results||[]){
    if(!entriesBySet.has(entry.source_material_set_id))entriesBySet.set(entry.source_material_set_id,[]);
    entriesBySet.get(entry.source_material_set_id).push(presentArchiveSourceEntry({...entry,url:entry.media_url||""},true));
  }
  for(const link of statesResult.results||[]){
    if(!statesBySet.has(link.source_material_set_id))statesBySet.set(link.source_material_set_id,[]);
    statesBySet.get(link.source_material_set_id).push({
      ...link,
      state_label:`Version ${Number(link.version_number||1)} / ${link.state_roman||"I"}${link.variant_label?`, ${link.variant_label}`:""}`,
      stateLabel:`Version ${Number(link.version_number||1)} / ${link.state_roman||"I"}${link.variant_label?`, ${link.variant_label}`:""}`,
    });
  }
  return rows.map(row=>presentArchiveSourceMaterialSet(row,entriesBySet.get(row.id)||[],statesBySet.get(row.id)||[],true));
}

async function archiveSourceMaterialStateRows(database,dossierEntityId,stateIds){
  if(!stateIds.length)return [];
  const rows=(await database.prepare(`SELECT aos.*,aov.entity_id,aov.version_number,
      aov.publication_state version_publication_state,aov.public_visible version_public_visible
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    WHERE aov.entity_id=? AND aos.id IN (${stateIds.map(()=>"?").join(",")})`)
    .bind(dossierEntityId,...stateIds).all()).results||[];
  return rows;
}

async function nextArchiveSourceDocumentReference(database,stateId){
  const result=await database.prepare(`SELECT COALESCE(MAX(reference_number),0) maximum FROM (
      SELECT CAST(substr(material_reference,2) AS INTEGER) reference_number
      FROM archive_materials
      WHERE state_id=? AND material_reference GLOB 'D[0-9]*'
      UNION ALL
      SELECT CAST(substr(document_reference,2) AS INTEGER) reference_number
      FROM archive_source_material_states
      WHERE state_id=? AND document_reference GLOB 'D[0-9]*'
    )`).bind(stateId,stateId).first();
  return `D${String(Number(result?.maximum||0)+1).padStart(2,"0")}`;
}

async function replaceArchiveSourceMaterialStates(database,setId,dossierEntityId,stateIds){
  const stateRows=await archiveSourceMaterialStateRows(database,dossierEntityId,stateIds);
  if(stateRows.length!==stateIds.length)throw new Error("Choose states that belong to this cultural object.");
  const current=(await database.prepare("SELECT state_id,document_reference FROM archive_source_material_states WHERE source_material_set_id=?").bind(setId).all()).results||[];
  const currentReferences=new Map(current.map(link=>[link.state_id,link.document_reference]));
  const links=[];
  for(let index=0;index<stateIds.length;index++){
    const stateId=stateIds[index];
    links.push({
      stateId,
      reference:currentReferences.get(stateId)||await nextArchiveSourceDocumentReference(database,stateId),
      sortOrder:index+1,
    });
  }
  await database.batch([
    database.prepare("DELETE FROM archive_source_material_states WHERE source_material_set_id=?").bind(setId),
    ...links.map(link=>database.prepare(`INSERT INTO archive_source_material_states
      (source_material_set_id,state_id,document_reference,sort_order,created_at)
      VALUES(?,?,?,?,datetime('now'))`).bind(setId,link.stateId,link.reference,link.sortOrder)),
  ]);
  return stateRows;
}

async function validateArchiveSourceMaterialSet(database,record,stateIds,setId=""){
  if(!record.dossier_entity_id||!record.title)return failure("A dossier and source-material title are required.",409);
  if(!ARCHIVE_SOURCE_MATERIAL_KINDS.has(record.source_kind))return failure("Invalid source-material kind.",409);
  if(!ARCHIVE_DATE_PRECISIONS.has(record.date_precision))return failure("Invalid date precision.",409);
  if(!ARCHIVE_VISIBILITIES.has(record.visibility))return failure("Invalid source-material visibility.",409);
  if(!ARCHIVE_STATES.has(record.publication_state))return failure("Invalid source-material publication state.",409);
  if(!MEDIA_CONSENT_STATUSES.has(record.permission_status))return failure("Invalid source-material permission status.",409);
  if(record.board_entity_id){
    const board=await database.prepare(`SELECT ar.id
      FROM archive_records ar
      JOIN archive_dossiers ad ON ad.entity_id=ar.id
      WHERE ar.id=? AND ar.record_type='blackboard'`).bind(record.board_entity_id).first();
    if(!board)return failure("Choose a complete Blackboard record.",409);
  }
  const dossier=await database.prepare(`SELECT ad.*,ce.visibility canonical_visibility
    FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE ad.entity_id=?`).bind(record.dossier_entity_id).first();
  if(!dossier)return failure("Dossier not found.",404);
  const stateRows=await archiveSourceMaterialStateRows(database,record.dossier_entity_id,stateIds);
  if(stateRows.length!==stateIds.length)return failure("Choose states that belong to this cultural object.",409);
  if(record.publication_state==="published"){
    if(record.visibility!=="public")return failure("Published source materials must use Public visibility.",409);
    if(!["not-required","granted"].includes(record.permission_status))return failure("Published source materials need Granted or Not required permission.",409);
    if(dossier.state!=="published"||!Number(dossier.public_visible)||dossier.canonical_visibility!=="public")return failure("Publish the canonical entity and dossier before publishing this source material.",409);
    const publicStates=stateRows.filter(state=>state.publication_state==="published"&&Number(state.public_visible)&&state.version_publication_state==="published"&&Number(state.version_public_visible));
    if(!publicStates.length)return failure("Link at least one published public state before publishing this source material.",409);
    if(!setId)return failure("Create the source material as a draft, add its entries, and then publish it.",409);
    const entries=(await database.prepare(`${archiveSourceEntryAdminSql("smse.source_material_set_id=? AND smse.public_included=1")}
      ORDER BY smse.sort_order,smse.created_at`).bind(setId).all()).results||[];
    if(!entries.length)return failure("Include at least one source entry before publishing.",409);
    const invalid=entries.find(entry=>entry.media_id&&(
      entry.media_state!=="active"||entry.media_privacy!=="public"
      ||!["not-required","granted"].includes(entry.consent_status)
      ||entry.public_presentation!=="inline"
    ));
    if(invalid)return failure(`Prepare “${invalid.title||"Untitled source entry"}” as an active, public, inline Digital asset before publishing.`,409);
  }
  return {dossier,stateRows};
}

async function prepareArchiveSourceMaterialMedia(database,setId){
  const rows=(await database.prepare(`SELECT DISTINCT m.id
    FROM archive_source_material_entries smse
    JOIN media_assets m ON m.id=smse.media_id
    WHERE smse.source_material_set_id=? AND smse.public_included=1`).bind(setId).all()).results||[];
  if(!rows.length)return;
  await database.batch(rows.map(row=>database.prepare(`UPDATE media_assets
    SET state='active',privacy='public',
      consent_status=CASE WHEN consent_status='granted' THEN 'granted' ELSE 'not-required' END,
      public_presentation='inline',updated_at=datetime('now')
    WHERE id=?`).bind(row.id)));
}

async function validateArchiveSourceEntry(database,record,setRecord){
  if(!ARCHIVE_SOURCE_ENTRY_TYPES.has(record.entry_type))return failure("Invalid source-material entry type.",409);
  if(!record.media_id&&!record.body)return failure("Attach a file or add correspondence text.",409);
  let media=null;
  if(record.media_id){
    media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(record.media_id).first();
    if(!media)return failure("Digital asset not found.",404);
    const mime=String(media.mime_type||"").toLowerCase();
    if(["blackboard-whole","blackboard-detail"].includes(record.entry_type)&&!mime.startsWith("image/"))return failure("Blackboard entries must use an image.",409);
    if(record.entry_type==="client-reference-image"&&!mime.startsWith("image/"))return failure("Client reference entries must use an image.",409);
    if(record.entry_type==="correspondence-page"&&!mime.startsWith("image/"))return failure("Correspondence pages and screenshots must use an image.",409);
    if(record.entry_type==="correspondence-document"&&!(mime==="application/pdf"||mime.includes("word")||mime.includes("document")||mime==="application/octet-stream"))return failure("Correspondence documents must be PDF, DOC, or DOCX files.",409);
    if(record.entry_type==="correspondence-text")return failure("Pasted correspondence text does not use an uploaded file.",409);
  }else if(record.entry_type!=="correspondence-text"){
    return failure("This source entry type requires an uploaded file.",409);
  }
  if(setRecord.publication_state==="published"&&setRecord.visibility==="public")return failure("Return this source material to an internal draft before changing its entries.",409);
  return {media};
}

async function archiveSourceMaterialsAdminApi(request,env,setId="",entryId="",action=""){
  const database=db(env);
  if(!setId){
    if(request.method==="GET"){
      const entityId=text(new URL(request.url).searchParams.get("entity_id"),200);
      const records=await archiveSourceMaterialAdminRecords(database,{entityId});
      return json({records,source_materials:records,sourceMaterials:records,count:records.length});
    }
    if(request.method==="POST"){
      const body=await readJson(request);if(!body)return failure("Send a JSON object.");
      const record=normalizeArchiveSourceMaterialSet(body),stateIds=archiveSourceMaterialStateIds(body.state_ids??body.stateIds);
      const valid=await validateArchiveSourceMaterialSet(database,record,stateIds);if(valid instanceof Response)return valid;
      const newId=text(body.id,200)||id("archive-source-material");
      await database.prepare(`INSERT INTO archive_source_material_sets
        (id,dossier_entity_id,source_kind,board_entity_id,title,caption,occurred_at,ended_at,date_precision,date_label,
         visibility,publication_state,permission_status,sort_order,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`)
        .bind(newId,record.dossier_entity_id,record.source_kind,record.board_entity_id,record.title,record.caption,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.visibility,record.publication_state,record.permission_status,record.sort_order).run();
      try{await replaceArchiveSourceMaterialStates(database,newId,record.dossier_entity_id,stateIds)}
      catch(error){await database.prepare("DELETE FROM archive_source_material_sets WHERE id=?").bind(newId).run();return failure(error.message,409)}
      const created=(await archiveSourceMaterialAdminRecords(database,{setId:newId}))[0];
      return json({record:created},{status:201});
    }
    return failure("Method not allowed.",405);
  }

  const before=await database.prepare("SELECT * FROM archive_source_material_sets WHERE id=?").bind(setId).first();
  if(!before)return failure("Source material not found.",404);

  if(action==="entries"){
    if(request.method==="POST"&&!entryId){
      const body=await readJson(request);if(!body)return failure("Send a JSON object.");
      const record=normalizeArchiveSourceEntry({...body,source_material_set_id:setId});
      const valid=await validateArchiveSourceEntry(database,record,before);if(valid instanceof Response)return valid;
      const newId=text(body.id,200)||id("archive-source-entry");
      await database.prepare(`INSERT INTO archive_source_material_entries
        (id,source_material_set_id,media_id,entry_type,title,caption,body,public_included,sort_order,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`)
        .bind(newId,setId,record.media_id,record.entry_type,record.title,record.caption,record.body,record.public_included,record.sort_order).run();
      const entry=presentArchiveSourceEntry(await database.prepare(archiveSourceEntryAdminSql("smse.id=?")).bind(newId).first(),true);
      return json({record:entry},{status:201});
    }
    if(request.method==="POST"&&entryId==="reorder"){
      if(before.publication_state==="published"&&before.visibility==="public")return failure("Return this source material to an internal draft before reordering its entries.",409);
      const body=await readJson(request),ids=body?.ids;
      if(!Array.isArray(ids))return failure("ids are required.",409);
      const current=(await database.prepare("SELECT id FROM archive_source_material_entries WHERE source_material_set_id=? ORDER BY sort_order,created_at,id").bind(setId).all()).results||[];
      const unique=new Set(ids);
      if(ids.length!==current.length||unique.size!==current.length||current.some(row=>!unique.has(row.id)))return failure("The source entry list changed. Refresh before reordering.",409);
      await database.batch(ids.map((idValue,index)=>database.prepare(`UPDATE archive_source_material_entries
        SET sort_order=?,updated_by='studio',updated_at=datetime('now')
        WHERE id=? AND source_material_set_id=?`).bind(index+1,idValue,setId)));
      return json({ok:true});
    }
    const entryBefore=entryId&&entryId!=="reorder"
      ? await database.prepare("SELECT * FROM archive_source_material_entries WHERE id=? AND source_material_set_id=?").bind(entryId,setId).first()
      : null;
    if(entryId&&entryId!=="reorder"&&!entryBefore)return failure("Source entry not found.",404);
    if(request.method==="PATCH"&&entryBefore){
      const body=await readJson(request);if(!body)return failure("Send a JSON object.");
      const record=normalizeArchiveSourceEntry(body,entryBefore);
      const valid=await validateArchiveSourceEntry(database,record,before);if(valid instanceof Response)return valid;
      await database.prepare(`UPDATE archive_source_material_entries
        SET media_id=?,entry_type=?,title=?,caption=?,body=?,public_included=?,sort_order=?,updated_by='studio',updated_at=datetime('now')
        WHERE id=? AND source_material_set_id=?`)
        .bind(record.media_id,record.entry_type,record.title,record.caption,record.body,record.public_included,record.sort_order,entryId,setId).run();
      const entry=presentArchiveSourceEntry(await database.prepare(archiveSourceEntryAdminSql("smse.id=?")).bind(entryId).first(),true);
      return json({record:entry});
    }
    if(request.method==="DELETE"&&entryBefore){
      if(before.publication_state==="published"&&before.visibility==="public")return failure("Return this source material to an internal draft before removing entries.",409);
      await database.prepare("DELETE FROM archive_source_material_entries WHERE id=? AND source_material_set_id=?").bind(entryId,setId).run();
      return json({ok:true});
    }
    return failure("Method not allowed.",405);
  }

  if(request.method==="GET"){
    const record=(await archiveSourceMaterialAdminRecords(database,{setId}))[0];
    return json({record,source_material:record,sourceMaterial:record});
  }
  if(request.method==="PATCH"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const record=normalizeArchiveSourceMaterialSet(body,before);
    if(record.dossier_entity_id!==before.dossier_entity_id)return failure("Source materials cannot move between dossiers.",409);
    const hasStateUpdate=Object.prototype.hasOwnProperty.call(body,"state_ids")||Object.prototype.hasOwnProperty.call(body,"stateIds");
    const stateIds=hasStateUpdate
      ? archiveSourceMaterialStateIds(body.state_ids??body.stateIds)
      : (await database.prepare("SELECT state_id FROM archive_source_material_states WHERE source_material_set_id=? ORDER BY sort_order").bind(setId).all()).results.map(row=>row.state_id);
    let valid=await validateArchiveSourceMaterialSet(database,record,stateIds,setId);if(valid instanceof Response&&record.publication_state!=="published")return valid;
    if(record.publication_state==="published"){
      if(record.visibility!=="public")return failure("Published source materials must use Public visibility.",409);
      const structural={...record,publication_state:"draft",visibility:"internal"};
      const structuralValid=await validateArchiveSourceMaterialSet(database,structural,stateIds,setId);if(structuralValid instanceof Response)return structuralValid;
      const owner=await database.prepare(`SELECT ad.state dossier_state,ad.public_visible dossier_public,ce.visibility canonical_visibility
        FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ad.entity_id=?`).bind(record.dossier_entity_id).first();
      if(owner?.dossier_state!=="published"||!Number(owner?.dossier_public)||owner?.canonical_visibility!=="public")return failure("Publish the canonical entity and dossier before publishing this source material.",409);
      const stateRows=await archiveSourceMaterialStateRows(database,record.dossier_entity_id,stateIds);
      const publicStates=stateRows.filter(state=>state.publication_state==="published"&&Number(state.public_visible)&&state.version_publication_state==="published"&&Number(state.version_public_visible));
      if(!publicStates.length)return failure("Link at least one published public state before publishing this source material.",409);
      if(!["not-required","granted"].includes(record.permission_status))return failure("Published source materials need Granted or Not required permission.",409);
      if(!(await database.prepare("SELECT 1 FROM archive_source_material_entries WHERE source_material_set_id=? AND public_included=1 LIMIT 1").bind(setId).first()))return failure("Include at least one correspondence or reference entry before publishing.",409);
      await prepareArchiveSourceMaterialMedia(database,setId);
      valid=await validateArchiveSourceMaterialSet(database,record,stateIds,setId);if(valid instanceof Response)return valid;
    }else if(valid instanceof Response)return valid;
    try{
      if(hasStateUpdate)await replaceArchiveSourceMaterialStates(database,setId,record.dossier_entity_id,stateIds);
      await database.prepare(`UPDATE archive_source_material_sets
        SET source_kind=?,board_entity_id=?,title=?,caption=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,
          visibility=?,publication_state=?,permission_status=?,sort_order=?,updated_by='studio',updated_at=datetime('now')
        WHERE id=?`)
        .bind(record.source_kind,record.board_entity_id,record.title,record.caption,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.visibility,record.publication_state,record.permission_status,record.sort_order,setId).run();
    }catch(error){return failure(error.message,409)}
    const updated=(await archiveSourceMaterialAdminRecords(database,{setId}))[0];
    return json({record:updated});
  }
  if(request.method==="DELETE"){
    await database.prepare(`UPDATE archive_source_material_sets
      SET publication_state='archived',visibility='internal',updated_by='studio',updated_at=datetime('now')
      WHERE id=?`).bind(setId).run();
    return json({ok:true,archived:true});
  }
  return failure("Method not allowed.",405);
}

function blackboardMediaUrl(row){
  return row?.source_url||(`/api/construct/media/${encodeURIComponent(row?.media_id||row?.id||"")}`);
}

function presentBlackboardBoard(row,admin=false){
  if(!row)return null;
  const record={
    id:row.entity_id,
    entity_id:row.entity_id,
    entityId:row.entity_id,
    title:row.title||"Untitled blackboard",
    summary:row.orientation||row.summary||"",
    date:row.date_label||row.occurred_at||row.date_or_period||"",
    date_label:row.date_label||row.date_or_period||"",
    catalogue_id:row.catalogue_id||"",
    catalogueId:row.catalogue_id||"",
    catalogue_label:archiveCatalogueLabel(row),
    catalogueLabel:archiveCatalogueLabel(row),
    archive_slug:row.archive_slug||"",
    archiveSlug:row.archive_slug||"",
    record_route:`/archive/records/${encodeURIComponent(row.archive_slug||"")}/`,
    recordRoute:`/archive/records/${encodeURIComponent(row.archive_slug||"")}/`,
    scan:{
      id:row.derivative_media_id||null,
      url:row.derivative_media_id?blackboardMediaUrl({media_id:row.derivative_media_id,source_url:row.derivative_source_url}):"",
      alt_text:row.derivative_alt_text||row.title||"Blackboard scan",
      mime_type:row.derivative_mime_type||"",
      width:Number(row.derivative_width||0)||null,
      height:Number(row.derivative_height||0)||null,
    },
    fragment_count:Number(row.fragment_count||0),
    fragmentCount:Number(row.fragment_count||0),
  };
  if(admin)Object.assign(record,{
    state:row.record_state||"draft",
    dossier_state:row.dossier_state||"draft",
    dossier_public_visible:Number(row.dossier_public_visible||0),
    version_id:row.version_id||null,
    state_id:row.state_id||null,
    material_id:row.material_id||null,
    source_material_set_id:row.source_material_set_id||null,
    master_media_id:row.master_media_id||null,
    derivative_media_id:row.derivative_media_id||null,
    upload_ready:Boolean(row.master_media_id&&row.derivative_media_id),
    publish_ready:Boolean(row.master_media_id&&row.derivative_media_id),
    updated_at:row.updated_at,
  });
  return record;
}

function blackboardBoardSql(publicOnly=false){
  const gates=publicOnly?`
    AND ce.visibility='public' AND ar.state='published'
    AND ad.state='published' AND ad.public_visible=1
    AND aov.publication_state='published' AND aov.public_visible=1
    AND aos.publication_state='published' AND aos.public_visible=1
    AND am.state='published' AND am.visibility='public'
    AND derivative.state='active' AND derivative.privacy='public'
    AND derivative.consent_status IN ('not-required','granted')
    AND derivative.public_presentation='inline'
    AND master.state='active' AND master.privacy IN ('internal','private')
    AND master.public_presentation='hidden'`:"";
  return `SELECT ar.id entity_id,ar.title,ar.summary,ar.date_or_period,ar.state record_state,ar.updated_at,
      ad.archive_slug,ad.orientation,ad.state dossier_state,ad.public_visible dossier_public_visible,
      ace.catalogue_id,ace.catalogue_prefix,ace.catalogue_number,ace.current_state_id,
      aov.id version_id,aov.version_number current_version,
      aos.id state_id,aos.state_roman current_state,aos.variant_label catalogue_variant,aos.date_label,aos.occurred_at,
      am.id material_id,amsc.board_entity_id,
      derivative.id derivative_media_id,derivative.source_url derivative_source_url,
      derivative.mime_type derivative_mime_type,derivative.alt_text derivative_alt_text,
      derivative.width derivative_width,derivative.height derivative_height,
      derivative.state derivative_state,derivative.privacy derivative_privacy,
      derivative.consent_status derivative_consent_status,derivative.public_presentation derivative_presentation,
      master.id master_media_id,master.state master_state,master.privacy master_privacy,
      master.public_presentation master_presentation,
      (SELECT sms.id FROM archive_source_material_sets sms
        WHERE sms.dossier_entity_id=ar.id AND sms.source_kind='blackboard'
        ORDER BY sms.created_at LIMIT 1) source_material_set_id,
      (SELECT COUNT(DISTINCT board_detail.media_id) FROM (
        SELECT detail_entry.media_id
        FROM archive_source_material_sets detail_set
        JOIN archive_source_material_entries detail_entry ON detail_entry.source_material_set_id=detail_set.id
        WHERE detail_set.source_kind='blackboard' AND detail_set.board_entity_id=ar.id
          AND detail_entry.entry_type='blackboard-detail'
        UNION ALL
        SELECT detail_material.media_id
        FROM archive_material_source_contexts detail_context
        JOIN archive_materials detail_material ON detail_material.id=detail_context.material_id
        WHERE detail_context.source_kind='blackboard' AND detail_context.capture_scope='detail'
          AND detail_context.board_entity_id=ar.id
      ) board_detail) fragment_count
    FROM archive_records ar
    JOIN content_entities ce ON ce.id=ar.id AND ce.entity_type='archive_record'
    JOIN archive_dossiers ad ON ad.entity_id=ar.id AND ad.record_type='blackboard'
    JOIN archive_catalogue_entries ace ON ace.entity_id=ar.id AND ace.object_type_id='other-blackboard'
    JOIN archive_object_states aos ON aos.id=ace.current_state_id
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    LEFT JOIN archive_materials am ON am.id=aos.lead_material_id
    LEFT JOIN archive_material_source_contexts amsc ON amsc.material_id=am.id AND amsc.capture_scope='whole'
    LEFT JOIN media_assets derivative ON derivative.id=am.media_id
    LEFT JOIN media_asset_variants mav ON mav.derivative_media_id=derivative.id AND mav.purpose='public-display'
    LEFT JOIN media_assets master ON master.id=mav.master_media_id
    WHERE ar.record_type='blackboard'${gates}`;
}

async function archiveBlackboardContextMap(database,entityIds,publicOnly=true){
  const ids=[...new Set(entityIds.filter(Boolean))];
  if(!ids.length)return new Map();
  const gates=publicOnly?" AND ce.visibility='public' AND ad.state='published' AND ad.public_visible=1":"";
  const rows=(await database.prepare(`${archiveEntitySql(`ad.entity_id IN (${ids.map(()=>"?").join(",")})${gates}`)}`).bind(...ids).all()).results||[];
  return new Map(rows.map(row=>{
    const item=presentArchiveItem(row);
    return [row.entity_id,{entity_id:row.entity_id,entityId:row.entity_id,title:item.title,record_type:item.record_type,recordType:item.record_type,record_route:item.archive_route,recordRoute:item.archive_route,canonical_route:item.canonical_route,canonicalRoute:item.canonical_route}];
  }));
}

async function publicArchiveBlackboards(request,env){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const boardRows=(await database.prepare(`${blackboardBoardSql(true)}
    ORDER BY COALESCE(aos.occurred_at,ar.date_or_period,ad.published_at,ar.created_at) DESC,ar.created_at DESC`).all()).results||[];
  const boards=boardRows.map(row=>presentBlackboardBoard(row));
  const boardMap=new Map(boards.map(board=>[board.id,{entity_id:board.id,title:board.title,catalogue_id:board.catalogue_id,catalogue_label:board.catalogue_label,record_route:board.record_route}]));
  const [entryResult,materialResult]=await database.batch([
    database.prepare(`SELECT entry.media_id,entry.title,entry.caption,entry.sort_order,set_row.board_entity_id,set_row.dossier_entity_id context_entity_id,
        media.source_url,media.mime_type,media.alt_text,media.public_title,media.public_description,media.width,media.height
      FROM archive_source_material_entries entry
      JOIN archive_source_material_sets set_row ON set_row.id=entry.source_material_set_id
      JOIN archive_dossiers owner_dossier ON owner_dossier.entity_id=set_row.dossier_entity_id
      JOIN content_entities owner_entity ON owner_entity.id=owner_dossier.entity_id
      JOIN media_assets media ON media.id=entry.media_id
      WHERE set_row.source_kind='blackboard' AND entry.entry_type='blackboard-detail'
        AND entry.public_included=1 AND set_row.publication_state='published' AND set_row.visibility='public'
        AND set_row.permission_status IN ('not-required','granted')
        AND owner_dossier.state='published' AND owner_dossier.public_visible=1 AND owner_entity.visibility='public'
        AND media.state='active' AND media.privacy='public'
        AND media.consent_status IN ('not-required','granted') AND media.public_presentation='inline'
        AND EXISTS(SELECT 1 FROM archive_source_material_states link
          JOIN archive_object_states linked_state ON linked_state.id=link.state_id
          JOIN archive_object_versions linked_version ON linked_version.id=linked_state.version_id
          WHERE link.source_material_set_id=set_row.id
            AND linked_state.publication_state='published' AND linked_state.public_visible=1
            AND linked_version.publication_state='published' AND linked_version.public_visible=1)`),
    database.prepare(`SELECT material.media_id,material.title,material.caption,material.sort_order,context.board_entity_id,
        material.dossier_entity_id context_entity_id,media.source_url,media.mime_type,media.alt_text,
        media.public_title,media.public_description,media.width,media.height
      FROM archive_material_source_contexts context
      JOIN archive_materials material ON material.id=context.material_id
      JOIN archive_dossiers owner_dossier ON owner_dossier.entity_id=material.dossier_entity_id
      JOIN content_entities owner_entity ON owner_entity.id=owner_dossier.entity_id
      JOIN media_assets media ON media.id=material.media_id
      WHERE context.source_kind='blackboard' AND context.capture_scope='detail'
        AND material.state='published' AND material.visibility='public'
        AND owner_dossier.state='published' AND owner_dossier.public_visible=1 AND owner_entity.visibility='public'
        AND media.state='active' AND media.privacy='public'
        AND media.consent_status IN ('not-required','granted') AND media.public_presentation='inline'`),
  ]);
  const rows=[...(entryResult.results||[]),...(materialResult.results||[])];
  const contexts=await archiveBlackboardContextMap(database,rows.map(row=>row.context_entity_id),true);
  const grouped=new Map();
  for(const row of rows){
    if(!row.media_id||!contexts.has(row.context_entity_id))continue;
    if(!grouped.has(row.media_id))grouped.set(row.media_id,{
      id:row.media_id,
      title:row.public_title||row.title||"Blackboard detail",
      caption:row.public_description||row.caption||"",
      image:{id:row.media_id,url:blackboardMediaUrl(row),alt_text:row.alt_text||row.title||"Blackboard detail",mime_type:row.mime_type||"",width:Number(row.width||0)||null,height:Number(row.height||0)||null},
      board:row.board_entity_id&&boardMap.has(row.board_entity_id)?boardMap.get(row.board_entity_id):null,
      contexts:[],
    });
    const fragment=grouped.get(row.media_id),context=contexts.get(row.context_entity_id);
    if(row.board_entity_id&&boardMap.has(row.board_entity_id))fragment.board=boardMap.get(row.board_entity_id);
    if(!fragment.contexts.some(item=>item.entity_id===context.entity_id))fragment.contexts.push(context);
  }
  return json({boards,fragments:[...grouped.values()],count:{boards:boards.length,fragments:grouped.size}});
}

async function archiveBlackboardsAdminRecord(database,entityId){
  const row=await database.prepare(`${blackboardBoardSql(false)} AND ar.id=?`).bind(entityId).first();
  return presentBlackboardBoard(row,true);
}

async function archiveBlackboardsAdminApi(request,env,entityId="",action=""){
  const database=db(env);
  if(request.method==="GET"&&!entityId){
    const boards=(await database.prepare(`${blackboardBoardSql(false)} ORDER BY ar.created_at DESC`).all()).results.map(row=>presentBlackboardBoard(row,true));
    const fragments=(await database.prepare(`SELECT context.*,material.title,material.caption,material.dossier_entity_id,
        media.id media_id,media.original_filename,media.mime_type,media.alt_text,media.source_url,
        owner.archive_slug,COALESCE(sd.title,owner.archive_slug) context_title
      FROM archive_material_source_contexts context
      JOIN archive_materials material ON material.id=context.material_id
      JOIN media_assets media ON media.id=material.media_id
      JOIN archive_dossiers owner ON owner.entity_id=material.dossier_entity_id
      LEFT JOIN search_documents sd ON sd.entity_id=material.dossier_entity_id
      WHERE context.source_kind='blackboard' AND context.capture_scope='detail'
      ORDER BY context.board_entity_id IS NOT NULL,material.created_at DESC`).all()).results||[];
    const materials=(await database.prepare(`SELECT material.id,material.title,material.caption,material.state,material.visibility,
        material.dossier_entity_id,media.id media_id,media.original_filename,media.mime_type,media.alt_text,
        context.capture_scope,context.board_entity_id,COALESCE(sd.title,owner.archive_slug) context_title
      FROM archive_materials material
      JOIN media_assets media ON media.id=material.media_id AND media.mime_type LIKE 'image/%'
      JOIN archive_dossiers owner ON owner.entity_id=material.dossier_entity_id
      LEFT JOIN search_documents sd ON sd.entity_id=material.dossier_entity_id
      LEFT JOIN archive_material_source_contexts context ON context.material_id=material.id
      WHERE material.state<>'archived'
      ORDER BY material.created_at DESC LIMIT 500`).all()).results||[];
    const sourceFragments=(await database.prepare(`SELECT entry.id,entry.source_material_set_id,entry.media_id,entry.title,entry.caption,
        set_row.board_entity_id,set_row.dossier_entity_id,media.original_filename,media.mime_type,
        COALESCE(sd.title,owner.archive_slug) context_title
      FROM archive_source_material_entries entry
      JOIN archive_source_material_sets set_row ON set_row.id=entry.source_material_set_id
      JOIN media_assets media ON media.id=entry.media_id
      JOIN archive_dossiers owner ON owner.entity_id=set_row.dossier_entity_id
      LEFT JOIN search_documents sd ON sd.entity_id=set_row.dossier_entity_id
      WHERE set_row.source_kind='blackboard' AND entry.entry_type='blackboard-detail'
      ORDER BY set_row.board_entity_id IS NOT NULL,entry.created_at DESC`).all()).results||[];
    return json({boards,fragments,materials,source_fragments:sourceFragments,sourceFragments,count:{boards:boards.length,fragments:fragments.length,materials:materials.length,source_fragments:sourceFragments.length}});
  }
  if(request.method==="POST"&&!entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const title=text(body.title,300);if(!title)return failure("A Blackboard title is required.",409);
    let archiveSlug=slug(body.archive_slug??body.archiveSlug??body.slug??title);
    if(!archiveSlug)return failure("A Blackboard slug is required.",409);
    if(await database.prepare("SELECT entity_id FROM archive_dossiers WHERE archive_slug=?").bind(archiveSlug).first())return failure("That Archive slug is already in use.",409);
    const recordId=text(body.id,200)||id("archive-blackboard"),versionId=id("archive-version"),stateId=id("archive-state"),setId=id("archive-source-material");
    const type=await database.prepare("SELECT medium_id,catalogue_prefix FROM archive_cultural_object_types WHERE id='other-blackboard'").first();
    if(!type)return failure("Run the Archive Blackboards migration before creating a board.",409);
    const number=await nextArchiveCatalogueNumber(database,type.catalogue_prefix),catalogueId=`${type.catalogue_prefix}-${String(number).padStart(3,"0")}`;
    const occurredAt=text(body.occurred_at??body.occurredAt,80)||null,dateLabel=text(body.date_label??body.dateLabel,160),datePrecision=text(body.date_precision??body.datePrecision,30)||(occurredAt?"exact":"undated");
    if(!ARCHIVE_DATE_PRECISIONS.has(datePrecision))return failure("Invalid date precision.",409);
    try{
      await database.batch([
        database.prepare(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
          VALUES(?,'archive_record','archive','internal',0,'studio','studio',datetime('now'),datetime('now'))`).bind(recordId),
        database.prepare(`INSERT INTO archive_records(id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,created_at,updated_at)
          VALUES(?,?,?,'The Six.Well Construct','blackboard','Studio',?,'',?,?, 'captured blackboard state','draft',datetime('now'),datetime('now'))`)
          .bind(recordId,archiveSlug,title,dateLabel||occurredAt||"",text(body.summary,5000),text(body.body,50000)),
        database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,?,?,?,'blackboard','draft',0,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(recordId,archiveSlug,text(body.summary,8000),text(body.story??body.body,50000),"The complete board scan is not public yet."),
        database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,current_state_id,variant_label,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,'other-blackboard',?,?,?,1,'I',?,'','studio','studio',datetime('now'),datetime('now'))`)
          .bind(recordId,type.medium_id,type.catalogue_prefix,number,catalogueId,stateId),
        database.prepare(`INSERT INTO archive_object_versions(id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,1,'Version 1','Captured blackboard state',?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(versionId,recordId,occurredAt,datePrecision,dateLabel),
        database.prepare(`INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
          VALUES(? ,?,'I',1,'State I','Complete captured blackboard state',?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(stateId,versionId,occurredAt,datePrecision,dateLabel),
        database.prepare(`INSERT INTO archive_source_material_sets(id,dossier_entity_id,source_kind,board_entity_id,title,caption,occurred_at,date_precision,date_label,visibility,publication_state,permission_status,sort_order,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,'blackboard',?,'Complete blackboard scan','',?,?,?,'internal','draft','not-required',1,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(setId,recordId,recordId,occurredAt,datePrecision,dateLabel),
        database.prepare(`INSERT INTO archive_source_material_states(source_material_set_id,state_id,document_reference,sort_order,created_at)
          VALUES(?,?,'D01',1,datetime('now'))`).bind(setId,stateId),
      ]);
    }catch(error){return failure(error.message,409)}
    return json({record:await archiveBlackboardsAdminRecord(database,recordId)},{status:201});
  }
  const board=entityId?await archiveBlackboardsAdminRecord(database,entityId):null;
  if(entityId&&!board)return failure("Blackboard record not found.",404);
  if(request.method==="POST"&&entityId&&action==="scan"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const masterId=text(body.master_media_id??body.masterMediaId,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200);
    if(!masterId||!derivativeId||masterId===derivativeId)return failure("Choose an archival master and a separate public derivative.",409);
    const [master,derivative]=await Promise.all([
      database.prepare("SELECT * FROM media_assets WHERE id=?").bind(masterId).first(),
      database.prepare("SELECT * FROM media_assets WHERE id=?").bind(derivativeId).first(),
    ]);
    if(!master||!derivative)return failure("One of the selected Digital assets does not exist.",404);
    if(!RESUMABLE_UPLOAD_MIMES["archive-master"].has(String(master.mime_type||"").toLowerCase()))return failure("The archival master must be TIFF, JPEG, PNG, or WebP.",409);
    if(master.privacy!=="internal"||master.public_presentation!=="hidden")return failure("The archival master must remain internal and hidden.",409);
    if(!["image/jpeg","image/png","image/webp"].includes(String(derivative.mime_type||"").toLowerCase()))return failure("The public derivative must be JPEG, PNG, or WebP.",409);
    const materialId=board.material_id||id("archive-material"),entryId=id("archive-source-entry");
    const statements=[
      database.prepare(`INSERT OR IGNORE INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
        VALUES(?,?,'public-display','studio',datetime('now'),datetime('now'))`).bind(masterId,derivativeId),
      database.prepare(`UPDATE media_assets SET state='active',privacy='internal',consent_status='not-required',public_presentation='hidden',updated_at=datetime('now') WHERE id=?`).bind(masterId),
      database.prepare(`UPDATE media_assets SET state='active',privacy='public',consent_status=CASE WHEN consent_status='granted' THEN 'granted' ELSE 'not-required' END,public_presentation='inline',updated_at=datetime('now') WHERE id=?`).bind(derivativeId),
    ];
    if(board.material_id)statements.push(database.prepare(`UPDATE archive_materials SET media_id=?,role='blackboard-whole',material_type='artifact',title=?,caption=?,state='draft',visibility='internal',state_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(derivativeId,board.title,text(body.caption,5000),board.state_id,materialId));
    else statements.push(database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,date_precision,visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,'blackboard-whole','artifact',?,?,'','captured state','undated','internal','draft',1,?,'M01',0,'studio','studio',datetime('now'),datetime('now'))`).bind(materialId,entityId,derivativeId,board.title,text(body.caption,5000),board.state_id));
    statements.push(
      database.prepare(`INSERT INTO archive_material_source_contexts(material_id,source_kind,capture_scope,board_entity_id,created_by,updated_by,created_at,updated_at)
        VALUES(?,'blackboard','whole',?,'studio','studio',datetime('now'),datetime('now'))
        ON CONFLICT(material_id) DO UPDATE SET source_kind='blackboard',capture_scope='whole',board_entity_id=excluded.board_entity_id,updated_by='studio',updated_at=datetime('now')`).bind(materialId,entityId),
      database.prepare("UPDATE archive_object_states SET lead_material_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(materialId,board.state_id),
    );
    const existingEntry=await database.prepare("SELECT id FROM archive_source_material_entries WHERE source_material_set_id=? AND entry_type='blackboard-whole' ORDER BY created_at LIMIT 1").bind(board.source_material_set_id).first();
    if(existingEntry)statements.push(database.prepare("UPDATE archive_source_material_entries SET media_id=?,title='Complete blackboard scan',caption=?,public_included=1,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(derivativeId,text(body.caption,5000),existingEntry.id));
    else statements.push(database.prepare(`INSERT INTO archive_source_material_entries(id,source_material_set_id,media_id,entry_type,title,caption,body,public_included,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,'blackboard-whole','Complete blackboard scan',?,'',1,1,'studio','studio',datetime('now'),datetime('now'))`).bind(entryId,board.source_material_set_id,derivativeId,text(body.caption,5000)));
    try{await database.batch(statements)}catch(error){return failure(error.message,409)}
    return json({record:await archiveBlackboardsAdminRecord(database,entityId)});
  }
  if(request.method==="POST"&&entityId&&action==="publish"){
    const row=await database.prepare(`${blackboardBoardSql(false)} AND ar.id=?`).bind(entityId).first();
    if(!row?.material_id||!row?.master_media_id||!row?.derivative_media_id)return failure("Upload and pair both the archival master and public derivative before publishing.",409);
    if(row.derivative_state!=="active"||row.derivative_privacy!=="public"||!["not-required","granted"].includes(row.derivative_consent_status)||row.derivative_presentation!=="inline")return failure("Prepare the web derivative as an active, public, inline Digital asset before publishing.",409);
    if(row.master_state!=="active"||!["internal","private"].includes(row.master_privacy)||row.master_presentation!=="hidden")return failure("Keep the archival master active, internal, and hidden before publishing.",409);
    const setReady=await database.prepare(`SELECT sms.id FROM archive_source_material_sets sms
      JOIN archive_source_material_entries entry ON entry.source_material_set_id=sms.id
      WHERE sms.id=? AND sms.source_kind='blackboard' AND entry.entry_type='blackboard-whole'
        AND entry.media_id=? AND entry.public_included=1`).bind(row.source_material_set_id,row.derivative_media_id).first();
    if(!setReady)return failure("The complete scan must be linked to the Blackboard source set.",409);
    await database.batch([
      database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(entityId),
      database.prepare("UPDATE archive_records SET state='published',record_status='published captured state',updated_at=datetime('now') WHERE id=?").bind(entityId),
      database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(entityId),
      database.prepare("UPDATE archive_object_versions SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(row.version_id),
      database.prepare("UPDATE archive_object_states SET publication_state='published',public_visible=1,lead_material_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(row.material_id,row.state_id),
      database.prepare("UPDATE archive_materials SET state='published',visibility='public',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(row.material_id),
      database.prepare("UPDATE archive_source_material_sets SET publication_state='published',visibility='public',permission_status='not-required',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(row.source_material_set_id),
      database.prepare("UPDATE media_assets SET state='active',privacy='public',consent_status=CASE WHEN consent_status='granted' THEN 'granted' ELSE 'not-required' END,public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(row.derivative_media_id),
      database.prepare("UPDATE media_assets SET state='active',privacy='internal',consent_status='not-required',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(row.master_media_id),
      database.prepare(`INSERT INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
        SELECT ar.id,'archive_record','archive',ar.slug,ar.title,ar.summary,ar.body,'published',ar.date_or_period,
          '/archive/records/'||ad.archive_slug||'/',datetime('now')
        FROM archive_records ar JOIN archive_dossiers ad ON ad.entity_id=ar.id WHERE ar.id=?
        ON CONFLICT(entity_id) DO UPDATE SET slug=excluded.slug,title=excluded.title,summary=excluded.summary,
          body=excluded.body,state='published',date_label=excluded.date_label,route=excluded.route,updated_at=datetime('now')`).bind(entityId),
    ]);
    return json({record:await archiveBlackboardsAdminRecord(database,entityId)});
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const title=text(body.title,300)||board.title,summary=text(body.summary,5000),occurredAt=text(body.occurred_at??body.occurredAt,80)||null,dateLabel=text(body.date_label??body.dateLabel,160);
    await database.batch([
      database.prepare("UPDATE archive_records SET title=?,summary=?,date_or_period=?,updated_at=datetime('now') WHERE id=?").bind(title,summary,dateLabel||occurredAt||"",entityId),
      database.prepare("UPDATE archive_dossiers SET orientation=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(summary,entityId),
      database.prepare("UPDATE archive_object_versions SET occurred_at=?,date_label=?,date_precision=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(occurredAt,dateLabel,occurredAt?"exact":"undated",board.version_id),
      database.prepare("UPDATE archive_object_states SET occurred_at=?,date_label=?,date_precision=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(occurredAt,dateLabel,occurredAt?"exact":"undated",board.state_id),
      database.prepare("UPDATE search_documents SET title=?,summary=?,date_label=?,updated_at=datetime('now') WHERE entity_id=?").bind(title,summary,dateLabel||occurredAt||"",entityId),
    ]);
    return json({record:await archiveBlackboardsAdminRecord(database,entityId)});
  }
  return failure("Method not allowed.",405);
}

async function archiveBlackboardMaterialContextApi(request,env,materialId){
  const database=db(env);
  const material=await database.prepare(`SELECT am.*,m.mime_type FROM archive_materials am
    JOIN media_assets m ON m.id=am.media_id WHERE am.id=?`).bind(materialId).first();
  if(!material)return failure("Choose an Archive Material with a Digital asset.",404);
  if(!String(material.mime_type||"").startsWith("image/"))return failure("Only image Materials can be classified as Blackboard details.",409);
  if(request.method==="DELETE"){
    await database.prepare("DELETE FROM archive_material_source_contexts WHERE material_id=?").bind(materialId).run();
    return json({ok:true});
  }
  if(request.method!=="PATCH"&&request.method!=="POST")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const scope=text(body.capture_scope??body.captureScope,30)||"detail",boardId=text(body.board_entity_id??body.boardEntityId,200)||null;
  if(!["whole","detail"].includes(scope))return failure("Invalid Blackboard capture scope.",409);
  if(boardId&&!await database.prepare("SELECT id FROM archive_records WHERE id=? AND record_type='blackboard'").bind(boardId).first())return failure("Choose an existing Blackboard record.",409);
  if(scope==="whole"&&!boardId)return failure("A whole-board Material must link to its Blackboard record.",409);
  await database.prepare(`INSERT INTO archive_material_source_contexts(material_id,source_kind,capture_scope,board_entity_id,created_by,updated_by,created_at,updated_at)
    VALUES(?,'blackboard',?,?,'studio','studio',datetime('now'),datetime('now'))
    ON CONFLICT(material_id) DO UPDATE SET source_kind='blackboard',capture_scope=excluded.capture_scope,board_entity_id=excluded.board_entity_id,updated_by='studio',updated_at=datetime('now')`)
    .bind(materialId,scope,boardId).run();
  return json({record:await database.prepare("SELECT * FROM archive_material_source_contexts WHERE material_id=?").bind(materialId).first()});
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
  const colorMaterialsPublic=await handleArchiveColorMaterialsPublic(request,env,path);if(colorMaterialsPublic)return colorMaterialsPublic;
  if(path==="/api/site/navigation")return publicNavigation(env);
  if(path==="/api/site/explore")return publicExplore(request,env);
  if(path==="/api/search")return publicSearch(request,env);
  if(path==="/api/archive/blackboards")return publicArchiveBlackboards(request,env);
  if(path==="/api/archive/items")return publicArchiveItems(request,env);
  if(path==="/api/archive/compare")return publicArchiveCompare(request,env);
  const archiveItemMatch=path.match(/^\/api\/archive\/items\/([^/]+)$/);if(archiveItemMatch)return publicArchiveDetail(request,env,decodeURIComponent(archiveItemMatch[1]));
  const archiveTimelinePublicMatch=path.match(/^\/api\/archive\/timelines\/([^/]+)$/);if(archiveTimelinePublicMatch)return publicArchiveTimeline(request,env,decodeURIComponent(archiveTimelinePublicMatch[1]));
  const connectionsMatch=path.match(/^\/api\/connections\/([^/]+)$/);if(connectionsMatch&&request.method==="GET")return publicConnections(env,decodeURIComponent(connectionsMatch[1]));
  const mediaPublic=path.match(/^\/api\/construct\/media\/([^/]+)$/);if(mediaPublic)return publicMediaApi(request,env,decodeURIComponent(mediaPublic[1]));
  const entityMediaPublic=path.match(/^\/api\/construct\/entity-media\/([^/]+)$/);if(entityMediaPublic)return publicEntityMediaApi(request,env,decodeURIComponent(entityMediaPublic[1]));
  if(path==="/api/legend/categories")return publicLegendCategories(env);
  if(path==="/api/legend/composition-rules")return publicCompositionRules(request,env);
  const publicMatch=path.match(/^\/api\/(flash|legend|visual-language|art|archive|archive-collections)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,canonicalResource(publicMatch[1]),publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const colorMaterialsAdmin=await handleArchiveColorMaterialsAdmin(request,env,path);if(colorMaterialsAdmin)return colorMaterialsAdmin;
  const legendCompositionMatch=path.match(/^\/api\/admin\/legend\/composition-rules(?:\/([^/]+))?$/);if(legendCompositionMatch)return adminCompositionRules(request,env,legendCompositionMatch[1]?decodeURIComponent(legendCompositionMatch[1]):"");
  const legendCategoryMatch=path.match(/^\/api\/admin\/legend\/categories(?:\/([^/]+))?$/);if(legendCategoryMatch)return legendCategoryApi(request,env,legendCategoryMatch[1]?decodeURIComponent(legendCategoryMatch[1]):"");
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  if(path==="/api/admin/media/uploads")return mediaUploadsApi(request,env);
  const mediaUploadPartMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/parts\/(\d+)$/);if(mediaUploadPartMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadPartMatch[1]),"part",Number(mediaUploadPartMatch[2]));
  const mediaUploadCompleteMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/complete$/);if(mediaUploadCompleteMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadCompleteMatch[1]),"complete");
  const mediaUploadSessionMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)$/);if(mediaUploadSessionMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadSessionMatch[1]));
  const mediaFileMatch=path.match(/^\/api\/admin\/media\/([^/]+)\/file$/);if(mediaFileMatch)return adminMediaFileApi(request,env,decodeURIComponent(mediaFileMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  const catalogueReidentifyMatch=path.match(/^\/api\/admin\/archive-catalogue\/([^/]+)\/reidentify$/);if(catalogueReidentifyMatch)return archiveCatalogueReidentifyAdminApi(request,env,decodeURIComponent(catalogueReidentifyMatch[1]));
  const catalogueMatch=path.match(/^\/api\/admin\/archive-catalogue(?:\/([^/]+))?$/);if(catalogueMatch)return archiveCatalogueAdminApi(request,env,catalogueMatch[1]?decodeURIComponent(catalogueMatch[1]):"");
  const documentationMatch=path.match(/^\/api\/admin\/archive-documentation(?:\/([^/]+))?$/);if(documentationMatch)return archiveDocumentationAdminApi(request,env,documentationMatch[1]?decodeURIComponent(documentationMatch[1]):"");
  const eventIdentifierMatch=path.match(/^\/api\/admin\/archive-event-identifiers\/([^/]+)$/);if(eventIdentifierMatch)return archiveEventIdentifierAdminApi(request,env,decodeURIComponent(eventIdentifierMatch[1]));
  const versionMatch=path.match(/^\/api\/admin\/archive-versions(?:\/([^/]+))?$/);if(versionMatch)return archiveVersionsAdminApi(request,env,versionMatch[1]?decodeURIComponent(versionMatch[1]):"");
  const stateMatch=path.match(/^\/api\/admin\/archive-states(?:\/([^/]+))?$/);if(stateMatch)return archiveStatesAdminApi(request,env,stateMatch[1]?decodeURIComponent(stateMatch[1]):"");
  const dossierMatch=path.match(/^\/api\/admin\/archive-dossiers(?:\/([^/]+))?$/);if(dossierMatch)return archiveDossiersAdminApi(request,env,dossierMatch[1]?decodeURIComponent(dossierMatch[1]):"");
  const blackboardContextMatch=path.match(/^\/api\/admin\/archive-blackboards\/materials\/([^/]+)$/);if(blackboardContextMatch)return archiveBlackboardMaterialContextApi(request,env,decodeURIComponent(blackboardContextMatch[1]));
  const blackboardActionMatch=path.match(/^\/api\/admin\/archive-blackboards\/([^/]+)\/(scan|publish)$/);if(blackboardActionMatch)return archiveBlackboardsAdminApi(request,env,decodeURIComponent(blackboardActionMatch[1]),blackboardActionMatch[2]);
  const blackboardMatch=path.match(/^\/api\/admin\/archive-blackboards(?:\/([^/]+))?$/);if(blackboardMatch)return archiveBlackboardsAdminApi(request,env,blackboardMatch[1]?decodeURIComponent(blackboardMatch[1]):"");
  const materialMatch=path.match(/^\/api\/admin\/archive-materials(?:\/([^/]+))?$/);if(materialMatch)return archiveMaterialsAdminApi(request,env,materialMatch[1]?decodeURIComponent(materialMatch[1]):"");
  const sourceMaterialEntryMatch=path.match(/^\/api\/admin\/archive-source-materials\/([^/]+)\/entries\/([^/]+)$/);if(sourceMaterialEntryMatch)return archiveSourceMaterialsAdminApi(request,env,decodeURIComponent(sourceMaterialEntryMatch[1]),decodeURIComponent(sourceMaterialEntryMatch[2]),"entries");
  const sourceMaterialEntriesMatch=path.match(/^\/api\/admin\/archive-source-materials\/([^/]+)\/entries$/);if(sourceMaterialEntriesMatch)return archiveSourceMaterialsAdminApi(request,env,decodeURIComponent(sourceMaterialEntriesMatch[1]),"","entries");
  const sourceMaterialMatch=path.match(/^\/api\/admin\/archive-source-materials(?:\/([^/]+))?$/);if(sourceMaterialMatch)return archiveSourceMaterialsAdminApi(request,env,sourceMaterialMatch[1]?decodeURIComponent(sourceMaterialMatch[1]):"");
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
