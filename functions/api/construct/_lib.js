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
import { loadPublicCalendarSearchEvents } from "../calendar/_lib.js";
import { handleArchiveWebSnapshotsAdmin, loadPublicArchiveWebSnapshots } from "./_web-snapshots.js";
import { enqueueVisualColorEntity, enqueueVisualColorEntityById } from "./_automatic-visual-colors.js";
import { handleGalleryAdmin, handleGalleryPublic, handleMediaCatalogueAdmin } from "./_gallery.js";
import {
  ArchiveDossierEnsureError,
  archiveDossierEligibleOwner,
  archiveDossierRecordType,
  archiveEligibleEntityType,
  ensureEditableArchiveDossier,
} from "../_shared/archive-dossiers.js";

function mediaIsNotVariantMasterSql(alias = "m") {
  return `NOT EXISTS(SELECT 1 FROM media_asset_variants public_variant_guard WHERE public_variant_guard.master_media_id=${alias}.id)`;
}

async function publicEntityMedia(database, entityIds) {
  if (!entityIds.length) return new Map();
  const placeholders = entityIds.map(() => "?").join(",");
  const result = await database.prepare(`SELECT DISTINCT em.entity_id,em.role,em.sort_order,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) caption,
      m.id,m.source_url,m.storage_key,m.mime_type
    FROM entity_media em
    JOIN media_assets m ON m.id=em.media_id
    JOIN content_entities ce ON ce.id=em.entity_id AND ce.visibility='public'
    WHERE em.public_visible=1 AND m.state='active' AND m.privacy='public'
      AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}
      AND ${publicEntityMediaOwnerSql("ce")}
      AND em.entity_id IN (${placeholders})
    ORDER BY em.entity_id,CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(...entityIds).all();
  const map = new Map();
  for (const row of result.results || []) {
    if (!map.has(row.entity_id)) map.set(row.entity_id, []);
    map.get(row.entity_id).push({ id: row.id, role: row.role, url: row.source_url || `/api/construct/entity-media/${row.id}`, alt: row.alt_text, caption: row.caption, mimeType: row.mime_type });
  }
  return map;
}

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
const LEGEND_ENTRY_PUBLICATION_STATES = new Set(["draft", "published", "archived"]);

function normalizeLegendEntryPublication(entry = {}) {
  const publicationState = text(entry.publication_state ?? entry.publicationState, 30) || "published";
  if (!LEGEND_ENTRY_PUBLICATION_STATES.has(publicationState)) throw new Error("Choose a valid Legend entry publication state.");
  const hasVisibility = Object.prototype.hasOwnProperty.call(entry, "public_visible") || Object.prototype.hasOwnProperty.call(entry, "publicVisible");
  return {
    publication_state: publicationState,
    public_visible: hasVisibility ? (truthy(entry.public_visible ?? entry.publicVisible) ? 1 : 0) : 1,
  };
}

function publicLegendEntries(value) {
  return parseJson(value).filter((entry) => {
    const explicitState = text(entry?.publication_state ?? entry?.publicationState, 30);
    const explicitVisibility = Object.prototype.hasOwnProperty.call(entry || {}, "public_visible")
      || Object.prototype.hasOwnProperty.call(entry || {}, "publicVisible");
    return (!explicitState || explicitState === "published")
      && (!explicitVisibility || truthy(entry.public_visible ?? entry.publicVisible));
  });
}

function publicLegendInlineEntries(value){
  return publicLegendEntries(value).filter(entry=>
    !text(entry?.record_entity_id??entry?.recordEntityId,200)
    && !text(entry?.media_id??entry?.mediaId,200)
  );
}

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
      media_id: text(entry?.media_id ?? entry?.mediaId, 200),
      href: safeLegendUrl(entry?.href),
      record_entity_id: text(entry?.record_entity_id ?? entry?.recordEntityId, 200),
      ...normalizeLegendEntryPublication(entry),
    })).filter((entry) => entry.name && (entry.svg_markup || entry.image_url || entry.media_id || entry.href));
    out.variants_json = JSON.stringify(variants);
  }
  if ("examples_json" in out) {
    const examples = legendArray(out.examples_json, "Appearances").slice(0, 60).map((entry) => ({
      title: text(entry?.title, 160),
      medium: text(entry?.medium, 120),
      caption: text(entry?.caption, 3000),
      src: safeLegendUrl(entry?.src),
      href: safeLegendUrl(entry?.href),
      record_entity_id: text(entry?.record_entity_id ?? entry?.recordEntityId, 200),
      ...normalizeLegendEntryPublication(entry),
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
    if (["sort_order","claimable","acquisition_eligible","homepage_enabled","collage_slot","focal_x","focal_y"].includes(field)) out[field] = Number(body[field]) || 0;
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
  if (out.whereabouts_status && !["known","unknown"].includes(out.whereabouts_status)) throw new Error("Invalid whereabouts status.");
  const merged = { ...existing, ...out };
  if (config.entityType === "current_project") {
    if ("items_json" in out) {
      const rawItems = parseJson(out.items_json);
      if (!Array.isArray(rawItems) || rawItems.length > 6) throw new Error("Current Works entries can have up to six structured items.");
      const items = rawItems.map((entry) => {
        const title = text(entry?.title, 160);
        const description = text(entry?.description, 1200);
        if (!title || !description) throw new Error("Each Current Works item needs a title and description.");
        return { title, description };
      });
      out.items_json = JSON.stringify(items);
    }
    if ("links_json" in out) {
      const rawLinks = parseJson(out.links_json);
      if (!Array.isArray(rawLinks) || rawLinks.length > 3) throw new Error("Current Works entries can have up to three links.");
      const links = rawLinks.map((entry) => {
        const label = text(entry?.label, 100);
        const url = text(entry?.url, 1000);
        if (!label || !(url.startsWith("/") || /^https:\/\//i.test(url))) throw new Error("Each Current Works link needs a label and an internal or HTTPS URL.");
        return { label, url };
      });
      out.links_json = JSON.stringify(links);
    }
    if (!(Number(merged.collage_slot) >= 0 && Number(merged.collage_slot) <= 5)) throw new Error("Collage slot must be between 0 and 5.");
    if (!(Number(merged.focal_x) >= 0 && Number(merged.focal_x) <= 100) || !(Number(merged.focal_y) >= 0 && Number(merged.focal_y) <= 100)) throw new Error("Crop focal coordinates must be between 0 and 100.");
    if (merged.medium_key && !["about","art","merch","tattooing","events","writings","archive","film","music"].includes(merged.medium_key)) throw new Error("Invalid Current Works medium key.");
  }
  if (config.entityType === "archive_record" && merged.record_type === "practice") {
    const rawSections = "practice_sections_json" in out
      ? legendArray(out.practice_sections_json, "Practice sections")
      : parseJson(existing.practice_sections_json);
    const sectionIds = new Set();
    const sections = rawSections.slice(0, 12).map((entry, index) => {
      const section = {
        id: slug(entry?.id || entry?.title || `section-${index + 1}`),
        eyebrow: text(entry?.eyebrow, 120),
        title: text(entry?.title, 200),
        body: text(entry?.body, 8000),
        mediaRole: text(entry?.mediaRole ?? entry?.media_role, 60),
      };
      if (!section.id || sectionIds.has(section.id)) throw new Error("Every practice section needs a unique ID.");
      if (!section.title || !section.body) throw new Error("Every practice section needs a title and body.");
      sectionIds.add(section.id);
      return section;
    });
    if ("practice_sections_json" in out) {
      out.practice_sections_json = JSON.stringify(sections);
      out.body = sections.map((section) => section.body).join("\n\n");
    }
  }
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

function archiveCanonicalRoute(row = {}) {
  if (row.record_type === "practice" && String(row.room || "").toLowerCase() === "art") {
    return `/archive/art/${encodeURIComponent(String(row.slug || row.id || ""))}/`;
  }
  return `/archive/?record=${encodeURIComponent(String(row.slug || row.id || ""))}`;
}

const ART_RESERVED_SLUGS = new Set(["acquisitioninquiry", "detail", "index"]);
const ART_AVAILABILITY_VALUES = new Set(["available", "not-for-sale", "sold", "unavailable"]);

function catalogOrderBy(config) {
  return config.fields.includes("sort_order") ? "sort_order,id" : "name COLLATE NOCASE,id";
}

function appendUniqueLegendEntry(entries,entry){
  const recordId=text(entry?.record_entity_id,200),mediaId=text(entry?.media_id??entry?.mediaId,200),href=text(entry?.href,2000);
  if(entries.some(existing=>(recordId&&text(existing?.record_entity_id,200)===recordId)||(mediaId&&text(existing?.media_id??existing?.mediaId,200)===mediaId)||(href&&text(existing?.href,2000)===href)))return;
  entries.push(entry);
}

function appendPublicLegendMediaVariants(entries,mediaEntries,symbol){
  const symbolName=text(symbol?.name,160);
  for(const media of mediaEntries){
    if(media.role!=="legend-variant"||!String(media.mimeType||"").toLowerCase().startsWith("image/"))continue;
    const authoredAlt=text(media.alt,300),emDashPrefix=`${symbolName} — `,hyphenPrefix=`${symbolName} - `;
    let variantName=authoredAlt;
    if(symbolName&&variantName.toLowerCase().startsWith(emDashPrefix.toLowerCase()))variantName=variantName.slice(emDashPrefix.length);
    else if(symbolName&&variantName.toLowerCase().startsWith(hyphenPrefix.toLowerCase()))variantName=variantName.slice(hyphenPrefix.length);
    variantName=variantName.replace(/\s+variant$/i,"").trim()||"Image variant";
    appendUniqueLegendEntry(entries,{
      name:variantName,
      style:"Uploaded variant",
      note:text(media.caption,3000),
      image_url:media.url,
      media_id:media.id,
      publication_state:"published",
      public_visible:1,
    });
  }
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
  const [media, tattooStyles, flashSheetDesigns, appearanceSubjects, legendArchiveAppearances, legendIdentityLinks] = await Promise.all([
    publicEntityMedia(database, entityIds),
    resource === "flash" ? loadTattooStyleAssignments(database, entityIds) : Promise.resolve(new Map()),
    resource === "flash" ? loadFlashSheetDesigns(database, entityIds) : Promise.resolve(new Map()),
    resource === "appearances" && entityIds.length
      ? database.prepare(`SELECT ads.dossier_entity_id,ads.subject_entity_id,ads.role,ads.sort_order,ce.entity_type,
          COALESCE(p.name,o.name,pl.name,ev.title,ce.id) name,
          COALESCE(o.website_url,'') website_url,COALESCE(o.social_url,'') social_url,
          COALESCE(pl.public_location,'') public_location
        FROM archive_dossier_subjects ads
        JOIN content_entities ce ON ce.id=ads.subject_entity_id AND ce.visibility='public'
        LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
        LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
        LEFT JOIN places pl ON pl.id=ce.id AND pl.state='published' AND pl.privacy='public'
        LEFT JOIN events ev ON ev.id=ce.id
        WHERE ads.public_visible=1 AND ads.dossier_entity_id IN (${entityIds.map(()=>"?").join(",")})
        ORDER BY ads.dossier_entity_id,ads.sort_order`).bind(...entityIds).all()
      : Promise.resolve({results:[]}),
    config.entityType === "visual_symbol" && entityIds.length
      ? database.prepare(`SELECT vsa.*,ad.archive_slug,ar.title record_title
          FROM visual_symbol_archive_appearances vsa
          JOIN content_entities ce ON ce.id=vsa.record_entity_id AND ce.visibility='public'
          JOIN archive_dossiers ad ON ad.entity_id=vsa.record_entity_id AND ad.state='published' AND ad.public_visible=1
          LEFT JOIN archive_records ar ON ar.id=vsa.record_entity_id
          WHERE vsa.symbol_entity_id IN (${entityIds.map(()=>"?").join(",")})
            AND vsa.publication_state='published' AND vsa.public_visible=1
            AND ${archiveIdentityProfilePublicSql("ce")}
            AND ${archiveCanonicalOwnerPublicSql("ce")}
          ORDER BY vsa.symbol_entity_id,vsa.sort_order,vsa.created_at`).bind(...entityIds).all()
      : Promise.resolve({results:[]}),
    config.entityType === "visual_symbol" && entityIds.length
      ? database.prepare(`SELECT profile.current_symbol_id symbol_entity_id,profile.slug profile_slug,
          organization.name organization_name,timeline.slug timeline_slug,timeline.title timeline_title
        FROM about_identity_profiles profile
        JOIN organizations organization ON organization.id=profile.organization_id AND organization.state='published'
        JOIN content_entities owner ON owner.id=organization.id AND owner.visibility='public'
        LEFT JOIN archive_timelines timeline ON timeline.id=profile.timeline_id AND timeline.state='published' AND timeline.public_visible=1
        WHERE profile.current_symbol_id IN (${entityIds.map(()=>"?").join(",")})
          AND profile.publication_state='published' AND profile.visibility='public'
          AND ${publicIdentityProfileLinkGateSql("profile")}
        ORDER BY profile.sort_order,organization.name`).bind(...entityIds).all()
      : Promise.resolve({results:[]}),
  ]);
  const subjectsByAppearance=new Map();
  for(const subject of appearanceSubjects.results||[]){if(!subjectsByAppearance.has(subject.dossier_entity_id))subjectsByAppearance.set(subject.dossier_entity_id,[]);subjectsByAppearance.get(subject.dossier_entity_id).push(subject)}
  const legendAppearancesBySymbol=new Map();
  for(const appearance of legendArchiveAppearances.results||[]){if(!legendAppearancesBySymbol.has(appearance.symbol_entity_id))legendAppearancesBySymbol.set(appearance.symbol_entity_id,[]);legendAppearancesBySymbol.get(appearance.symbol_entity_id).push(appearance)}
  const records = rows.map((row) => {
    const { reserved_submission_id: _reservationOwner, ...publicRow } = row;
    const publicMedia=media.get(row.id)||[];
    const archiveAppearances=config.entityType === "visual_symbol"?(legendAppearancesBySymbol.get(row.id)||[]):[];
    const publicVariants=config.entityType === "visual_symbol"?publicLegendInlineEntries(row.variants_json):parseJson(row.variants_json);
    const publicExamples=config.entityType === "visual_symbol"?publicLegendInlineEntries(row.examples_json):parseJson(row.examples_json);
    if(config.entityType === "visual_symbol")appendPublicLegendMediaVariants(publicVariants,publicMedia,row);
    for(const appearance of archiveAppearances){const href=`/archive/records/${encodeURIComponent(appearance.archive_slug)}/`;if(appearance.appearance_role==="variant")appendUniqueLegendEntry(publicVariants,{name:appearance.title,style:"Historical identity",note:appearance.caption,href,record_entity_id:appearance.record_entity_id,publication_state:"published",public_visible:1});else appendUniqueLegendEntry(publicExamples,{title:appearance.title||appearance.record_title,medium:"Archive",caption:appearance.caption,src:"",href,record_entity_id:appearance.record_entity_id,publication_state:"published",public_visible:1})}
    for(const identityLink of legendIdentityLinks.results||[]){if(identityLink.symbol_entity_id!==row.id)continue;appendUniqueLegendEntry(publicExamples,{title:`${identityLink.organization_name} creative identity`,medium:"About",caption:`The current profile and origin story for ${identityLink.organization_name}.`,src:"",href:`/about/identities/${encodeURIComponent(identityLink.profile_slug)}/`,publication_state:"published",public_visible:1});if(identityLink.timeline_slug)appendUniqueLegendEntry(publicExamples,{title:identityLink.timeline_title||`${identityLink.organization_name} full Archive history`,medium:"Archive",caption:`The authoritative chronology for ${identityLink.organization_name}.`,src:"",href:`/archive/timelines/${encodeURIComponent(identityLink.timeline_slug)}/`,publication_state:"published",public_visible:1})}
    const safePublicRow=config.entityType === "visual_symbol"?{...publicRow,applications_json:JSON.stringify(publicLegendEntries(row.applications_json)),variants_json:JSON.stringify(publicVariants),examples_json:JSON.stringify(publicExamples)}:publicRow;
    const stylePayload = resource === "flash"
      ? tattooStylePayload(tattooStyles.get(row.id), { fallbackValue: "unclassified", fallbackLabel: "Unclassified" })
      : {};
    const record = {
      ...safePublicRow,
      ...stylePayload,
      themes: parseJson(row.themes_json),
      context: parseJson(row.context_json, {}),
      applications: config.entityType === "visual_symbol" ? publicLegendEntries(row.applications_json) : parseJson(row.applications_json),
      variants: publicVariants,
      examples: publicExamples,
      buildGuidance: (() => {
        const guidance = parseJson(row.build_guidance_json, {});
        return {
          essence: text(guidance.essence, 500),
          emotionalTones: Array.isArray(guidance.emotional_tones) ? guidance.emotional_tones : [],
          reflectionQuestions: Array.isArray(guidance.reflection_questions) ? guidance.reflection_questions : [],
        };
      })(),
      media: publicMedia,
      ...(config.entityType === "visual_symbol" ? { archive_appearances: archiveAppearances.map(appearance=>({id:appearance.id,role:appearance.appearance_role,title:appearance.title,caption:appearance.caption,record_entity_id:appearance.record_entity_id,route:`/archive/records/${encodeURIComponent(appearance.archive_slug)}/`})) } : {}),
      ...(resource === "appearances" ? { subjects: subjectsByAppearance.get(row.id) || [], archiveRoute: `/archive/records/${encodeURIComponent(row.slug)}/` } : {}),
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
    if (resource === "archive") {
      const practiceSections = row.record_type === "practice" ? parseJson(row.practice_sections_json) : [];
      const canonicalRoute = archiveCanonicalRoute(row);
      delete record.practice_sections_json;
      return {
        ...record,
        practiceSections,
        practice_sections: practiceSections,
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
  const [nodeResult,pathResult,utilityResult]=await Promise.all([
    database.prepare("SELECT id,name,slug,route,color,sort_order,updated_at FROM construct_nodes WHERE state='published' AND homepage_enabled=1 ORDER BY sort_order").all(),
    database.prepare("SELECT id,node_id,name,route,color,sort_order,updated_at FROM construct_pathways WHERE state='published' AND homepage_enabled=1 ORDER BY node_id,sort_order").all(),
    database.prepare("SELECT id,label,route,color,sort_order,updated_at FROM construct_utility_links WHERE state='published' ORDER BY sort_order,label").all(),
  ]),nodes=nodeResult.results||[],paths=pathResult.results||[],utilityLinks=utilityResult.results||[];
  for (const node of nodes) node.pathways = paths.filter((p) => p.node_id === node.id);
  return json({ revision: [...nodes,...utilityLinks].reduce((value,item) => item.updated_at > value ? item.updated_at : value, ""), nodes, utilityLinks });
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
const ARCHIVE_BULK_PUBLICATION_LIMIT = 100;
function publicationPublicFlag(state){return state==="published"?1:0}
function publicationVisibility(state){return state==="published"?"public":"internal"}
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
const ARCHIVE_FAILED_EXPERIMENT_KINDS = new Set(["concept","material-test","process-test","prototype","other"]);
const ARCHIVE_FAILED_EXPERIMENT_RESULTS = new Set(["failed","abandoned","inconclusive","superseded"]);
const ARCHIVE_FAILED_EXPERIMENT_AFTERLIVES = new Set(["none","recovered","reused"]);
const ARCHIVE_FAILED_EXPERIMENT_MEDIA = new Set(["art","merch","tattoos","film","music","writings","legend","other"]);

function originThreadIds(value){
  const source=Array.isArray(value)?value:String(value||"").split(",");
  return [...new Set(source.map(item=>text(typeof item==="object"?(item.id||item.thread_id||item.threadId):item,200)).filter(Boolean))].slice(0,50);
}

async function validateOriginThreadIds(database,ids){
  if(!ids.length)return true;
  const rows=(await database.prepare(`SELECT id FROM archive_origin_threads WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all()).results||[];
  return rows.length===ids.length;
}

async function replaceEntityOriginThreads(database,entityId,ids,primaryId=""){
  if(primaryId&&!ids.includes(primaryId))throw new Error("The primary origin thread must also be assigned to this entity.");
  if(!await validateOriginThreadIds(database,ids))throw new Error("Choose valid origin threads.");
  const statements=[database.prepare("DELETE FROM archive_origin_thread_entities WHERE entity_id=?").bind(entityId)];
  ids.forEach((threadId,index)=>statements.push(database.prepare("INSERT INTO archive_origin_thread_entities(thread_id,entity_id,is_primary,sort_order,created_at) VALUES(?,?,?,?,datetime('now'))").bind(threadId,entityId,threadId===primaryId?1:0,index+1)));
  await database.batch(statements);
}

async function replaceMaterialOriginThreads(database,materialId,ids){
  if(!await validateOriginThreadIds(database,ids))throw new Error("Choose valid origin threads.");
  const statements=[database.prepare("DELETE FROM archive_origin_thread_materials WHERE material_id=?").bind(materialId)];
  ids.forEach((threadId,index)=>statements.push(database.prepare("INSERT INTO archive_origin_thread_materials(thread_id,material_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(threadId,materialId,index+1)));
  await database.batch(statements);
}
const MEDIA_PRIVACIES = new Set(["public","unlisted","internal","private"]);
const MEDIA_TRANSCRIPT_STATUSES = new Set(["not-requested","pending","ready","failed"]);
const MEDIA_PRESENTATIONS = new Set(["inline","hidden"]);
const ARCHIVAL_SVG_MIME = "image/svg+xml";
const RESUMABLE_UPLOAD_MIMES = {
  video:new Set(["video/mp4","video/webm"]),
  "archive-master":new Set(["image/tiff","image/jpeg","image/png","image/webp","image/heic","image/heif"]),
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
    (${alias}.fragment_type='material' AND EXISTS(SELECT 1 FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.id=${alias}.source_id AND am.dossier_entity_id=${alias}.dossier_entity_id AND am.state='published' AND am.visibility='public' AND ${archiveMaterialPublicStateSql("am")} AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")})))) OR
    (${alias}.fragment_type='source-material' AND EXISTS(
      SELECT 1 FROM archive_source_material_sets sms
      WHERE sms.id=${alias}.source_id AND sms.dossier_entity_id=${alias}.dossier_entity_id
        AND sms.publication_state='published' AND sms.visibility='public'
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
              OR smse_media.public_presentation<>'inline'
              OR NOT ${mediaIsNotVariantMasterSql("smse_media")}
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
      WHEN 'appearance' THEN app.title
      WHEN 'visual_symbol' THEN vs.name WHEN 'organization' THEN org.name ELSE COALESCE(ar.title,sd.title,ad.archive_slug) END title,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.statement WHEN 'merch_item' THEN mi.product_type
      WHEN 'portfolio_item' THEN pi.caption WHEN 'flash_item' THEN fi.description
      WHEN 'tattoo_design' THEN td.description
      WHEN 'event' THEN ev.description WHEN 'appearance' THEN app.summary WHEN 'visual_symbol' THEN vs.meaning
      WHEN 'organization' THEN org.description
      ELSE COALESCE(ar.summary,sd.summary,'') END canonical_summary,
    CASE ce.entity_type
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/'||aw.slug||'/')
      WHEN 'merch_item' THEN mi.route
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'tattoo_design' THEN ''
      WHEN 'event' THEN '/events/'||ev.slug||'/'
      WHEN 'appearance' THEN '/about/exhibitions-appearances/'||app.slug||'/'
      WHEN 'visual_symbol' THEN '/about/legend/'||vs.slug||'/'
      WHEN 'organization' THEN CASE WHEN identity_profile.publication_state='published' AND identity_profile.visibility='public' AND ${publicIdentityProfileLinkGateSql("identity_profile")} THEN '/about/identities/'||identity_profile.slug||'/' ELSE '' END
      ELSE COALESCE(sd.route,'') END canonical_route,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.year WHEN 'portfolio_item' THEN pi.year
      WHEN 'event' THEN COALESCE(ev.starts_at,'') WHEN 'appearance' THEN COALESCE(app.starts_at,'')
      WHEN 'organization' THEN COALESCE(identity_profile.origin_date_label,'') ELSE COALESCE(ar.date_or_period,sd.date_label,'') END canonical_date,
    CASE WHEN ar.record_type='community-maze' THEN ar.node_label ELSE COALESCE(ar.creator_label,'') END public_credit,
    CASE ce.entity_type
      WHEN 'art_work' THEN aw.medium WHEN 'portfolio_item' THEN pi.primary_style
      WHEN 'flash_item' THEN fi.item_type WHEN 'merch_item' THEN mi.product_type
      WHEN 'tattoo_design' THEN td.design_type
      WHEN 'event' THEN 'event' WHEN 'appearance' THEN 'appearance' WHEN 'visual_symbol' THEN 'symbol'
      WHEN 'organization' THEN COALESCE(NULLIF(identity_profile.kind_label,''),'Creative identity') ELSE COALESCE(ar.medium_label,'') END medium,
    COALESCE(NULLIF(ar.date_precision,''),'undated') canonical_date_precision,
    COALESCE(
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id
          AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        LIMIT 1),
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      CASE WHEN ce.entity_type='portfolio_item' AND pi.state='published' THEN
        CASE WHEN COALESCE(NULLIF(pi.cover_image_ref,''),'primary')='primary'
          AND pi.primary_public_visible=1
          THEN COALESCE(NULLIF(pi.source_url,''),CASE WHEN pi.storage_key<>'' THEN '/api/portfolio/media/'||pi.id END)
        ELSE (SELECT COALESCE(NULLIF(cover.source_url,''),'/api/construct/entity-media/'||cover.id)
          FROM entity_media cover_attachment JOIN media_assets cover ON cover.id=cover_attachment.media_id
          LEFT JOIN portfolio_image_details cover_details ON cover_details.portfolio_item_id=cover_attachment.entity_id AND cover_details.image_ref=cover_attachment.media_id
          WHERE cover_attachment.entity_id=pi.id AND cover_attachment.media_id=pi.cover_image_ref
            AND cover_attachment.role='gallery' AND cover_attachment.public_visible=1
            AND cover.state='active' AND cover.privacy='public'
            AND cover.public_presentation='inline' AND cover.mime_type LIKE 'image/%'
            AND ${mediaIsNotVariantMasterSql("cover")}
            AND COALESCE(cover_details.image_role,'result')='result'
          LIMIT 1) END END,
      CASE WHEN ce.entity_type='merch_item' THEN NULLIF(mi.image_url,'') END,
      CASE WHEN ce.entity_type='event' THEN NULLIF(ev.image_url,'') END,
      CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(NULLIF(vs.image_url,''),NULLIF(json_extract(vs.examples_json,'$[0].src'),'')) END,
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/entity-media/'||m.id)
        FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1
          AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),
      ''
    ) primary_image,
    COALESCE(
      (SELECT m.alt_text FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id
          AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        LIMIT 1),
      (SELECT m.alt_text FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      (SELECT COALESCE(NULLIF(em.alt_text_override,''),m.alt_text)
        FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1
          AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),
      ''
    ) primary_image_alt,
    COALESCE(
      (SELECT COALESCE(NULLIF(am.caption,''),NULLIF(m.caption,''),NULLIF(m.public_description,''))
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id
          AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        LIMIT 1),
      (SELECT COALESCE(NULLIF(am.caption,''),NULLIF(m.caption,''),NULLIF(m.public_description,''))
        FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      (SELECT COALESCE(NULLIF(em.caption_override,''),NULLIF(m.caption,''),NULLIF(m.public_description,''))
        FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1
          AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),
      ''
    ) primary_image_caption,
    COALESCE(
      (SELECT m.width FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")} LIMIT 1),
      (SELECT m.width FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      (SELECT m.width FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%' AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),0
    ) primary_image_width,
    COALESCE(
      (SELECT m.height FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.id=current_state_row.lead_material_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")} LIMIT 1),
      (SELECT m.height FROM archive_materials am JOIN media_assets m ON m.id=am.media_id
        WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
          AND ${archiveMaterialPublicStateSql("am")}
          AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' AND am.material_type IN ('final-image','process-photo','sketch','artifact')
          AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE am.material_type WHEN 'final-image' THEN 0 ELSE 1 END,am.sort_order,am.created_at LIMIT 1),
      (SELECT m.height FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%' AND ${mediaIsNotVariantMasterSql("m")}
        ORDER BY CASE em.role WHEN 'primary' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END,em.sort_order,em.created_at LIMIT 1),0
    ) primary_image_height,
    CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(vs.svg_markup,'') ELSE '' END primary_svg_markup,
    (SELECT group_concat(material_type) FROM (
      SELECT DISTINCT am.material_type material_type FROM archive_materials am
      LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=ad.entity_id AND am.state='published' AND am.visibility='public'
        AND ${archiveMaterialPublicStateSql("am")}
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}))
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
  LEFT JOIN artist_appearances app ON ce.entity_type='appearance' AND app.id=ce.id
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
  LEFT JOIN organizations org ON ce.entity_type='organization' AND org.id=ce.id
  LEFT JOIN about_identity_profiles identity_profile ON identity_profile.organization_id=org.id
  LEFT JOIN archive_records ar ON ce.entity_type='archive_record' AND ar.id=ce.id
  LEFT JOIN search_documents sd ON sd.entity_id=ce.id
  LEFT JOIN archive_catalogue_entries ace ON ace.entity_id=ad.entity_id
  LEFT JOIN archive_object_states current_state_row ON current_state_row.id=ace.current_state_id
  LEFT JOIN archive_object_versions current_version_row ON current_version_row.id=current_state_row.version_id
  LEFT JOIN archive_cultural_object_types cot ON cot.id=ace.object_type_id
  LEFT JOIN archive_catalogue_media acm ON acm.id=ace.medium_id
  LEFT JOIN archive_event_identifiers aei ON aei.entity_id=ad.entity_id
  WHERE ${where}`;
}

function publicIdentityProfileLinkGateSql(profileAlias="profile"){
  return `(
    EXISTS(
      SELECT 1 FROM organizations eligible_identity_organization
      JOIN content_entities eligible_identity_owner ON eligible_identity_owner.id=eligible_identity_organization.id AND eligible_identity_owner.visibility='public'
      WHERE eligible_identity_organization.id=${profileAlias}.organization_id AND eligible_identity_organization.state='published'
    )
    AND EXISTS(SELECT 1 FROM archive_dossiers eligible_identity_dossier WHERE eligible_identity_dossier.entity_id=${profileAlias}.organization_id AND eligible_identity_dossier.state='published' AND eligible_identity_dossier.public_visible=1)
    AND (${profileAlias}.timeline_id IS NULL OR EXISTS(SELECT 1 FROM archive_timelines eligible_identity_timeline WHERE eligible_identity_timeline.id=${profileAlias}.timeline_id AND eligible_identity_timeline.subject_entity_id=${profileAlias}.organization_id AND eligible_identity_timeline.state='published' AND eligible_identity_timeline.public_visible=1))
    AND (${profileAlias}.current_symbol_id IS NULL OR EXISTS(SELECT 1 FROM visual_symbols eligible_identity_symbol JOIN content_entities eligible_identity_symbol_entity ON eligible_identity_symbol_entity.id=eligible_identity_symbol.id AND eligible_identity_symbol_entity.visibility='public' WHERE eligible_identity_symbol.id=${profileAlias}.current_symbol_id AND eligible_identity_symbol.state='published'))
    AND (${profileAlias}.origin_thread_id IS NULL OR EXISTS(SELECT 1 FROM archive_origin_threads eligible_identity_origin JOIN archive_origin_thread_entities eligible_identity_member ON eligible_identity_member.thread_id=eligible_identity_origin.id AND eligible_identity_member.entity_id=${profileAlias}.organization_id WHERE eligible_identity_origin.id=${profileAlias}.origin_thread_id AND eligible_identity_origin.state='published' AND eligible_identity_origin.public_visible=1))
    AND (${profileAlias}.featured_origin_entity_id IS NULL OR EXISTS(
      SELECT 1 FROM archive_records eligible_identity_featured
      JOIN content_entities eligible_identity_featured_entity ON eligible_identity_featured_entity.id=eligible_identity_featured.id AND eligible_identity_featured_entity.visibility='public'
      JOIN archive_dossiers eligible_identity_featured_dossier ON eligible_identity_featured_dossier.entity_id=eligible_identity_featured.id AND eligible_identity_featured_dossier.state='published' AND eligible_identity_featured_dossier.public_visible=1
      WHERE eligible_identity_featured.id=${profileAlias}.featured_origin_entity_id AND eligible_identity_featured.state='published'
    ))
  )`;
}

function archiveIdentityProfilePublicSql(entityAlias = "ce") {
  return `(${entityAlias}.entity_type<>'organization' OR EXISTS(
    SELECT 1 FROM about_identity_profiles public_identity_profile
    WHERE public_identity_profile.organization_id=${entityAlias}.id
      AND public_identity_profile.publication_state='published'
      AND public_identity_profile.visibility='public'
      AND ${publicIdentityProfileLinkGateSql("public_identity_profile")}
  ))`;
}

function archiveCanonicalOwnerPublicSql(entityAlias="ce"){
  return `(${entityAlias}.entity_type<>'archive_record' OR EXISTS(
    SELECT 1 FROM archive_records public_archive_owner
    WHERE public_archive_owner.id=${entityAlias}.id AND public_archive_owner.state='published'
  ))`;
}

function publicEntityMediaOwnerSql(entityAlias="ce"){
  return `(
    (${entityAlias}.entity_type<>'organization' OR EXISTS(
      SELECT 1 FROM organizations public_media_organization
      JOIN about_identity_profiles public_media_identity ON public_media_identity.organization_id=public_media_organization.id
      WHERE public_media_organization.id=${entityAlias}.id
        AND public_media_organization.state='published'
        AND public_media_identity.publication_state='published' AND public_media_identity.visibility='public'
        AND ${publicIdentityProfileLinkGateSql("public_media_identity")}
    ))
    AND (${entityAlias}.entity_type<>'archive_record' OR EXISTS(
      SELECT 1 FROM archive_records public_media_archive_record
      WHERE public_media_archive_record.id=${entityAlias}.id AND public_media_archive_record.state='published'
    ))
  )`;
}

function archiveMaterialPublicStateSql(materialAlias="am"){
  return `(
    ${materialAlias}.state_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM archive_catalogue_entries material_catalogue WHERE material_catalogue.entity_id=${materialAlias}.dossier_entity_id)
    OR EXISTS(
      SELECT 1 FROM archive_object_states material_public_state
      JOIN archive_object_versions material_public_version ON material_public_version.id=material_public_state.version_id
      WHERE material_public_state.id=${materialAlias}.state_id
        AND material_public_version.entity_id=${materialAlias}.dossier_entity_id
        AND material_public_state.publication_state='published' AND material_public_state.public_visible=1
        AND material_public_version.publication_state='published' AND material_public_version.public_visible=1
    )
  )`;
}

function archiveCollectionIds(value){
  const source=Array.isArray(value)?value:String(value||"").split(",");
  return [...new Set(source.map(item=>text(typeof item==="object"?(item.id||item.collection_id||item.collectionId):item,200)).filter(Boolean))].slice(0,50);
}

async function replaceDossierCollections(database,entityId,ids){
  if(ids.length){
    const rows=(await database.prepare(`SELECT id FROM archive_collections WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all()).results||[];
    if(rows.length!==ids.length)throw new Error("Choose valid Archive collections.");
  }
  const statements=[database.prepare("DELETE FROM archive_dossier_collections WHERE dossier_entity_id=?").bind(entityId)];
  ids.forEach((collectionId,index)=>statements.push(database.prepare("INSERT INTO archive_dossier_collections(dossier_entity_id,collection_id,sort_order,created_at) VALUES(?,?,?,datetime('now'))").bind(entityId,collectionId,index+1)));
  await database.batch(statements);
}

function archiveCatalogueLabel(row) {
  if (!row?.catalogue_id) return "";
  if (!row.current_state_id) return row.catalogue_id;
  const version = Math.max(1, Number(row.current_version || 1));
  const state = text(row.current_state, 20).toUpperCase() || "I";
  const variant = text(row.catalogue_variant || row.variant_label, 120);
  return `${row.catalogue_id}.${version}/${state}${variant ? `, ${variant}` : ""}`;
}

function archiveCulturalObjectTypeLabel(objectTypeId, label) {
  if (objectTypeId === "tattoo-execution") return "Tattoo";
  if (objectTypeId === "tattoo-flash-design") return "Tattoo Design";
  return label || "";
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
  const primaryImage = primarySvgMarkup ? "" : row.primary_image || "";
  const primaryImageAlt = primaryImage ? row.primary_image_alt || row.title || "" : "";
  const primaryImageCaption = primaryImage ? row.primary_image_caption || "" : "";
  const primaryImageWidth = primaryImage ? Number(row.primary_image_width || 0) : 0;
  const primaryImageHeight = primaryImage ? Number(row.primary_image_height || 0) : 0;
  const primaryMedia = primarySvgMarkup
    ? { svg_markup: primarySvgMarkup, svgMarkup: primarySvgMarkup, kind: "symbol" }
    : primaryImage
      ? {
          url: primaryImage,
          alt_text: primaryImageAlt,
          altText: primaryImageAlt,
          caption: primaryImageCaption,
          width: primaryImageWidth,
          height: primaryImageHeight,
          kind: "image",
        }
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
    public_credit: row.public_credit || "",
    publicCredit: row.public_credit || "",
    title: row.title || row.archive_slug,
    summary,
    orientation: row.orientation || "",
    story: row.story || "",
    story_html: row.story_html || "",
    empty_materials_note: row.empty_materials_note || "No process materials are public yet.",
    date_label: row.canonical_date || "",
    dateLabel: row.canonical_date || "",
    date_precision: row.canonical_date_precision || "undated",
    datePrecision: row.canonical_date_precision || "undated",
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
    cultural_object_type: archiveCulturalObjectTypeLabel(row.cultural_object_type_id, row.cultural_object_type),
    culturalObjectType: archiveCulturalObjectTypeLabel(row.cultural_object_type_id, row.cultural_object_type),
    cultural_object_type_id: row.cultural_object_type_id || "",
    current_version: row.catalogue_id ? Number(row.current_version || 1) : null,
    current_state: row.catalogue_id ? (row.current_state || "I") : "",
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
    primary_image: primaryImage,
    primaryImage,
    image_url: primaryImage,
    imageUrl: primaryImage,
    primary_image_alt: primaryImageAlt,
    primaryImageAlt,
    primary_image_caption: primaryImageCaption,
    primaryImageCaption,
    primary_image_width: primaryImageWidth,
    primaryImageWidth,
    primary_image_height: primaryImageHeight,
    primaryImageHeight,
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
  const conditions = ["ce.visibility='public'", `${alias}.state='published'`, `${alias}.public_visible=1`, archiveIdentityProfilePublicSql("ce"), archiveCanonicalOwnerPublicSql("ce")];
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
  const catalogueMedium=text(url.searchParams.get("medium"),120).toLowerCase();
  if(catalogueMedium){
    conditions.push(`EXISTS(
      SELECT 1 FROM archive_catalogue_entries ace
      JOIN archive_catalogue_media acm ON acm.id=ace.medium_id
      WHERE ace.entity_id=${alias}.entity_id AND (ace.medium_id=? OR lower(acm.label)=?)
    )`);
    values.push(catalogueMedium,catalogueMedium);
  }
  const facetParams = [
    ["brand","brand"], ["person","person"], ["era","era"],
    ["record_type","record_type"], ["recordType","record_type"],
  ];
  const seenKinds = new Set();
  for (const [param,kind] of facetParams) {
    const value = text(url.searchParams.get(param), 120).toLowerCase();
    if (!value || seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    if(kind==="brand"){
      conditions.push(`(
        EXISTS (SELECT 1 FROM archive_dossier_facets adf JOIN archive_facets f ON f.id=adf.facet_id
          WHERE adf.dossier_entity_id=${alias}.entity_id AND f.kind='brand' AND (f.slug=? OR lower(f.name)=?))
        OR EXISTS (SELECT 1 FROM archive_dossier_subjects ads
          JOIN content_entities brand_entity ON brand_entity.id=ads.subject_entity_id AND brand_entity.visibility='public'
          JOIN organizations brand ON brand.id=brand_entity.id AND brand.state='published'
          WHERE ads.dossier_entity_id=${alias}.entity_id AND ads.public_visible=1 AND ads.role='brand'
            AND (brand.slug=? OR lower(brand.name)=?))
      )`);
      values.push(value,value,value,value);
    }else{
      conditions.push(`EXISTS (SELECT 1 FROM archive_dossier_facets adf JOIN archive_facets f ON f.id=adf.facet_id WHERE adf.dossier_entity_id=${alias}.entity_id AND f.kind=? AND (f.slug=? OR lower(f.name)=?))`);
      values.push(kind,value,value);
    }
  }
  const collection=text(url.searchParams.get("collection"),120).toLowerCase();
  if(collection){conditions.push(`EXISTS (SELECT 1 FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id WHERE adc.dossier_entity_id=${alias}.entity_id AND ac.state='published' AND (ac.slug=? OR lower(ac.name)=?))`);values.push(collection,collection);}
  const materialType = text(url.searchParams.get("material_type") || url.searchParams.get("materialType"), 80).replace(/_/g,"-").toLowerCase();
  if (materialType) {
    conditions.push(`EXISTS (SELECT 1 FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.dossier_entity_id=${alias}.entity_id AND am.material_type=? AND am.state='published' AND am.visibility='public' AND ${archiveMaterialPublicStateSql("am")} AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")})))`);
    values.push(materialType);
  }
  const origin=text(url.searchParams.get("origin"),160).toLowerCase();
  if(origin){
    conditions.push(`EXISTS (SELECT 1 FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id WHERE ote.entity_id=${alias}.entity_id AND ot.slug=? AND ot.state='published' AND ot.public_visible=1)`);
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
  const itemSql = `${archiveEntitySql(where)} ORDER BY ${originThread?"COALESCE((SELECT ote.sort_order FROM archive_origin_thread_entities ote WHERE ote.thread_id=? AND ote.entity_id=ad.entity_id),999999),":""}ad.featured DESC,ad.sort_order,ad.published_at DESC,ad.entity_id LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) total FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ${where}`;
  const [itemsResult,countResult,facetResult,catalogueMediumFacetResult,materialFacetResult,collectionFacetResult,brandFacetResult] = await database.batch([
    database.prepare(itemSql).bind(...values,...(originThread?[originThread.id]:[]),limit,offset),
    database.prepare(countSql).bind(...values),
    database.prepare(`SELECT f.kind,f.name,f.slug,COUNT(DISTINCT adf.dossier_entity_id) count
      FROM archive_facets f JOIN archive_dossier_facets adf ON adf.facet_id=f.id
      JOIN archive_dossiers ad ON ad.entity_id=adf.dossier_entity_id
      JOIN content_entities ce ON ce.id=ad.entity_id
      WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1
        AND ${archiveIdentityProfilePublicSql("ce")}
      GROUP BY f.id ORDER BY f.kind,f.sort_order,f.name`),
    database.prepare(`SELECT 'medium' kind,acm.label,acm.id slug,COUNT(DISTINCT ad.entity_id) count
      FROM archive_catalogue_entries ace
      JOIN archive_catalogue_media acm ON acm.id=ace.medium_id
      JOIN archive_dossiers ad ON ad.entity_id=ace.entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      WHERE ${archiveIdentityProfilePublicSql("ce")}
      GROUP BY acm.id,acm.label ORDER BY acm.sort_order,acm.label`),
    database.prepare(`SELECT am.material_type slug,am.material_type name,COUNT(DISTINCT am.dossier_entity_id) count
      FROM archive_materials am JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
      JOIN content_entities ce ON ce.id=ad.entity_id LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE ce.visibility='public' AND ad.state='published' AND ad.public_visible=1
        AND ${archiveIdentityProfilePublicSql("ce")}
        AND am.state='published' AND am.visibility='public'
        AND ${archiveMaterialPublicStateSql("am")}
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}))
      GROUP BY am.material_type ORDER BY am.material_type`),
    database.prepare(`SELECT ac.slug,ac.name,COUNT(DISTINCT adc.dossier_entity_id) count
      FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id AND ac.state='published'
      JOIN archive_dossiers ad ON ad.entity_id=adc.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      WHERE ${archiveIdentityProfilePublicSql("ce")}
      GROUP BY ac.id ORDER BY ac.sort_order,ac.name`),
    database.prepare(`SELECT brand.slug,brand.name,COUNT(DISTINCT brand.dossier_entity_id) count
      FROM (
        SELECT ads.dossier_entity_id,o.slug,o.name
        FROM archive_dossier_subjects ads
        JOIN organizations o ON o.id=ads.subject_entity_id AND o.state='published'
        JOIN content_entities subject ON subject.id=o.id AND subject.visibility='public'
        JOIN archive_dossiers ad ON ad.entity_id=ads.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
        JOIN content_entities owner ON owner.id=ad.entity_id AND owner.visibility='public'
        WHERE ads.public_visible=1 AND ads.role='brand'
          AND ${archiveIdentityProfilePublicSql("owner")}
        UNION
        SELECT adf.dossier_entity_id,f.slug,f.name
        FROM archive_dossier_facets adf JOIN archive_facets f ON f.id=adf.facet_id AND f.kind='brand'
        JOIN archive_dossiers ad ON ad.entity_id=adf.dossier_entity_id AND ad.state='published' AND ad.public_visible=1
        JOIN content_entities owner ON owner.id=ad.entity_id AND owner.visibility='public'
        WHERE ${archiveIdentityProfilePublicSql("owner")}
      ) brand
      GROUP BY brand.slug,brand.name ORDER BY brand.name`),
  ]);
  let items=(itemsResult.results||[]).map(presentArchiveItem);const total=Number(countResult.results?.[0]?.total||0);
  const usageMatches=await archiveUsageMatchProvenance(database,items,url);
  items=items.map(item=>({...item,matches:usageMatches.get(item.entity_id)||[]}));
  let evidence=[],notes=[],currentRecordPosition=null;
  if(originThread){
    const assignments=items.length?(await database.prepare(`SELECT entity_id,is_primary,sort_order FROM archive_origin_thread_entities WHERE thread_id=? AND entity_id IN (${items.map(()=>"?").join(",")})`).bind(originThread.id,...items.map(item=>item.entity_id)).all()).results||[]:[];
    const assignmentMap=new Map(assignments.map(row=>[row.entity_id,row]));
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
      WHERE otm.thread_id=? AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}))
        AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveMaterialPublicStateSql("am")}
      ORDER BY CASE WHEN am.occurred_at IS NULL THEN 1 ELSE 0 END,am.occurred_at,otm.sort_order,am.sort_order,am.created_at`).bind(originThread.id).all()).results||[];
    evidence=evidenceRows.map((row,index)=>presentArchiveMaterial({...row,url:row.media_url||"",archive_route:`/archive/records/${encodeURIComponent(row.archive_slug)}/#material-${encodeURIComponent(row.id)}`,origin_position:index+1}));
    notes=await publicNotesForOriginThread(database,originThread.id);
  }
  const facets={medium:[],brand:[],person:[],era:[],collection:collectionFacetResult.results||[],record_type:[],material_type:materialFacetResult.results||[]};
  facets.medium=(catalogueMediumFacetResult.results||[]).map(facet=>({name:facet.label,slug:facet.slug,count:Number(facet.count||0)}));
  facets.brand=(brandFacetResult.results||[]).map(facet=>({name:facet.name,slug:facet.slug,count:Number(facet.count||0)}));
  for(const facet of facetResult.results||[]){if(!["medium","brand"].includes(facet.kind)&&facets[facet.kind])facets[facet.kind].push({name:facet.name,slug:facet.slug,count:Number(facet.count||0)});}
  const pagination={page,limit,total,total_pages:Math.max(1,Math.ceil(total/limit)),totalPages:Math.max(1,Math.ceil(total/limit))};
  const groups={
    paintings:items.filter(item=>item.catalogue_medium==="art"),
    tattoo_designs:items.filter(item=>item.catalogue_prefix==="TAT-DES"),
    tattoo_executions:items.filter(item=>item.catalogue_prefix==="TAT-EXE"),
    other:items.filter(item=>item.catalogue_medium!=="art"&&!['TAT-DES','TAT-EXE'].includes(item.catalogue_prefix)),
  };
  return json({items,records:items,groups,facets,pagination,count:items.length,query:q,origin_thread:originThread,originThread,evidence,notes,current_record_position:currentRecordPosition,currentRecordPosition},{cache:"public, max-age=30"});
}

async function publicArchiveDetail(request,env,archiveSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(archiveEntitySql(`ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")} AND (ad.archive_slug=? OR ad.entity_id=?)`)).bind(archiveSlug,archiveSlug).first();
  if(!row)return failure("Archive item not found.",404);
  const item=presentArchiveItem(row),entityId=row.entity_id;
  const [materialsResult,activitiesResult,subjectsResult,collectionsResult,relationshipsResult,originThreadsResult,versionsResult,statesResult,termsResult,documentationResult,sourceMaterialSetsResult,sourceMaterialEntriesResult,sourceMaterialStatesResult]=await database.batch([
    database.prepare(`SELECT am.*,m.mime_type,m.width,m.height,m.duration_seconds,m.alt_text,m.public_title,m.public_description,
        CASE WHEN m.transcript_status='ready' THEN m.transcript ELSE '' END transcript,m.transcript_status,m.transcript_language,m.public_presentation,
        CASE WHEN m.public_presentation='inline' THEN COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END) ELSE '' END media_url
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id
      WHERE am.dossier_entity_id=? AND am.state='published' AND am.visibility='public'
        AND (am.media_id IS NULL OR (m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}))
        AND ${archiveMaterialPublicStateSql("am")}
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
    database.prepare(`SELECT ot.id,ot.slug,ot.title,ot.summary,ote.is_primary,ote.sort_order
      FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id
      WHERE ote.entity_id=? AND ot.state='published' AND ot.public_visible=1
      ORDER BY ote.is_primary DESC,ote.sort_order,ot.sort_order,ot.title`).bind(entityId),
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
              AND counted_media.public_presentation='inline'
              AND ${mediaIsNotVariantMasterSql("counted_media")}
            )))
          + (SELECT COUNT(DISTINCT source_set.id)
            FROM archive_source_material_states source_link
            JOIN archive_source_material_sets source_set ON source_set.id=source_link.source_material_set_id
            WHERE source_link.state_id=aos.id
              AND source_set.publication_state='published' AND source_set.visibility='public'
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
                    OR source_media.public_presentation<>'inline'
                    OR NOT ${mediaIsNotVariantMasterSql("source_media")}
                  )
              )
          )) material_count
      FROM archive_object_states aos
      JOIN archive_object_versions aov ON aov.id=aos.version_id
      LEFT JOIN archive_materials lead ON lead.id=aos.lead_material_id
        AND lead.state_id=aos.id AND lead.state='published' AND lead.visibility='public'
      LEFT JOIN media_assets lead_media ON lead_media.id=lead.media_id
        AND lead_media.state='active' AND lead_media.privacy='public'
        AND lead_media.public_presentation='inline'
        AND (lead_media.mime_type LIKE 'image/%' OR lead_media.mime_type LIKE 'video/%')
        AND ${mediaIsNotVariantMasterSql("lead_media")}
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
        AND smse.public_included=1
        AND (smse.media_id IS NULL OR (
          m.state='active' AND m.privacy='public'
          AND m.public_presentation='inline'
          AND ${mediaIsNotVariantMasterSql("m")}
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
              OR required_media.public_presentation<>'inline'
              OR NOT ${mediaIsNotVariantMasterSql("required_media")}
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
        AND aos.publication_state='published' AND aos.public_visible=1
        AND aov.publication_state='published' AND aov.public_visible=1
      ORDER BY smss.source_material_set_id,smss.sort_order,aov.sort_order,aov.version_number,aos.sort_order,aos.state_order`).bind(entityId),
  ]);
  const relationshipRows=relationshipsResult.results||[];
  const relatedIds=relationshipRows.map(r=>r.source_entity_id===entityId?r.target_entity_id:r.source_entity_id);
  const relatedMap=await entityRecords(database,relatedIds);
  const relatedDossiers=relatedIds.length?(await database.prepare(`SELECT entity_id,archive_slug,
      COALESCE((SELECT record_type FROM archive_records WHERE id=archive_dossiers.entity_id),'') record_type
      FROM archive_dossiers WHERE state='published' AND public_visible=1 AND entity_id IN (${relatedIds.map(()=>"?").join(",")})`).bind(...relatedIds).all()).results||[]:[];
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
  const relatedSlugs=new Map(relatedDossiers.map(d=>[d.entity_id,d]));
  const relatedCatalogueMap=new Map(relatedCatalogue.map(record=>[record.entity_id,{...record,catalogue_label:archiveCatalogueLabel(record)}]));
  const relatedEventMap=new Map(relatedEvents.map(record=>[record.entity_id,{...record,record_identifier:record.event_id}]));
  const relationships=[];for(const relation of relationshipRows){const outgoing=relation.source_entity_id===entityId;const relatedId=outgoing?relation.target_entity_id:relation.source_entity_id;const related=relatedMap.get(relatedId);if(!related||related.visibility!=="public")continue;const relatedDossier=relatedSlugs.get(relatedId)||{},archive_slug=relatedDossier.archive_slug||"",catalogue=relatedCatalogueMap.get(relatedId)||{},eventIdentity=relatedEventMap.get(relatedId)||{},archiveRoute=archive_slug?(relatedDossier.record_type==="blackboard"?`/archive/blackboards/${encodeURIComponent(archive_slug)}/`:`/archive/records/${encodeURIComponent(archive_slug)}/`):"";relationships.push({id:relation.id,direction:outgoing?"outgoing":"incoming",label:outgoing?relation.forward_label:relation.reverse_label,relationship_type:relation.relationship_slug,related:{...related,...catalogue,...eventIdentity,imageUrl:"",archive_slug,archiveRoute}});}
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
  const activities=(activitiesResult.results||[]).map(redactPublicArchiveActivity);
  const notes=await publicNotesForTarget(database,entityId);
  const originThreads=originThreadsResult.results||[],primaryOriginThread=originThreads.find(thread=>Number(thread.is_primary))||null;
  const webSnapshots=await loadPublicArchiveWebSnapshots(database,entityId,env.ARCHIVE_VIEWER_ORIGIN);
  return json({item,dossier:item,materials,notes,color_usages:colorUsages,colorUsages,material_usages:materialUsages,materialUsages,palette_maps:paletteMaps,paletteMaps,source_materials:sourceMaterials,sourceMaterials,evidence_sets:sourceMaterials,evidenceSets:sourceMaterials,web_snapshots:webSnapshots,webSnapshots,activities,subjects:subjectsResult.results||[],collections:collectionsResult.results||[],relationships,versions:versionsResult.results||[],states,documentation,terms:termsResult.results||[],origin_threads:originThreads,originThreads,primary_origin_thread:primaryOriginThread,primaryOriginThread},{cache:"public, max-age=30"});
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

function timelineEra(entry={}){
  const start=String(entry.occurred_at||"").slice(0,4),end=String(entry.ended_at||"").slice(0,4);
  const key=start?(end&&end!==start?`${start}-${end}`:start):"undated";
  const label=text(entry.date_label,160)||(key==="undated"?"Undated":key.replace("-","–"));
  return {key,label};
}

function redactPublicArchiveActivity(row={}){
  const {source_note:_sourceNote,created_by:_createdBy,...safe}=row;
  return safe;
}

function redactPublicArchiveTimelineRecord(row={}){
  const {created_by:_createdBy,updated_by:_updatedBy,...safe}=row;
  return safe;
}

function presentPublicArchiveActivity(row={}){
  const {primary_image:_primaryImage,primary_image_alt:_primaryImageAlt,primary_image_caption:_primaryImageCaption,primary_image_width:_primaryImageWidth,primary_image_height:_primaryImageHeight,...safe}=redactPublicArchiveActivity(row);
  const leadMedia=row.primary_image?{url:row.primary_image,alt_text:row.primary_image_alt||row.item_title||row.title||"",altText:row.primary_image_alt||row.item_title||row.title||"",caption:row.primary_image_caption||"",width:Number(row.primary_image_width||0),height:Number(row.primary_image_height||0),kind:"image"}:null;
  const era=timelineEra(row);
  return {...safe,entry_type:"activity",anchor:`activity-${row.id}`,archive_route:row.archive_slug?`/archive/records/${encodeURIComponent(row.archive_slug)}/`:"",archiveRoute:row.archive_slug?`/archive/records/${encodeURIComponent(row.archive_slug)}/`:"",primary_image:row.primary_image||"",primary_image_alt:row.primary_image_alt||"",primary_image_caption:row.primary_image_caption||"",primary_image_width:Number(row.primary_image_width||0),primary_image_height:Number(row.primary_image_height||0),lead_media:leadMedia,leadMedia,era_key:era.key,eraKey:era.key};
}

function timelineProfileJoinSql(){return `LEFT JOIN about_identity_profiles aip ON aip.organization_id=at.subject_entity_id AND aip.publication_state='published' AND aip.visibility='public' AND ${publicIdentityProfileLinkGateSql("aip")}`;}

async function loadPublicArchiveTimeline(database,timelineSlug){
  const timelineRow=await database.prepare(`SELECT at.*,ce.entity_type,o.name organization_name,p.name person_name,n.name node_name,
      CASE WHEN aip.organization_id IS NOT NULL THEN '/about/identities/'||aip.slug||'/' ELSE '' END profile_route
    FROM archive_timelines at JOIN content_entities ce ON ce.id=at.subject_entity_id AND ce.visibility='public'
    LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
    LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
    LEFT JOIN construct_nodes n ON n.id=ce.id AND n.state='published'
    ${timelineProfileJoinSql()}
    WHERE (at.slug=? OR at.id=?) AND at.state='published' AND at.public_visible=1
      AND (ce.entity_type<>'person' OR p.id IS NOT NULL)
      AND (ce.entity_type<>'organization' OR o.id IS NOT NULL)`).bind(timelineSlug,timelineSlug).first();
  if(!timelineRow)return null;
  const timeline=redactPublicArchiveTimelineRecord(timelineRow);
  timeline.subject_name=timelineSubjectName(timeline);timeline.route=`/archive/timelines/${encodeURIComponent(timeline.slug)}/`;timeline.profileRoute=timeline.profile_route||"";
  const publicOwnerSql=archiveEntitySql(`ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")}`);
  const [chaptersResult,activitiesResult]=await database.batch([
    database.prepare(`SELECT * FROM archive_timeline_chapters WHERE timeline_id=? AND state='published' AND public_visible=1
      ORDER BY CASE WHEN occurred_at IS NULL THEN 1 ELSE 0 END,occurred_at,sort_order,created_at`).bind(timeline.id),
    database.prepare(`SELECT ea.*,owner.archive_slug,owner.title item_title,owner.primary_image,owner.primary_image_alt,owner.primary_image_caption,owner.primary_image_width,owner.primary_image_height
      FROM entity_activity_subjects eas JOIN entity_activity ea ON ea.id=eas.activity_id AND ea.public_visible=1
      JOIN (${publicOwnerSql}) owner ON owner.entity_id=ea.entity_id
      WHERE eas.subject_entity_id=? AND eas.public_visible=1
      ORDER BY CASE WHEN ea.occurred_at IS NULL THEN 1 ELSE 0 END,ea.occurred_at,ea.sort_order,ea.created_at`).bind(timeline.subject_entity_id),
  ]);
  const chapters=(chaptersResult.results||[]).map(row=>{const era=timelineEra(row);return {...redactPublicArchiveTimelineRecord(row),entry_type:"chapter",anchor:row.anchor_slug||`chapter-${row.id}`,era_key:era.key,eraKey:era.key}});
  const activities=(activitiesResult.results||[]).map(presentPublicArchiveActivity);
  const entries=[...chapters,...activities].sort((a,b)=>{const ad=a.occurred_at||"9999-12-31",bd=b.occurred_at||"9999-12-31";return ad.localeCompare(bd)||Number(a.sort_order||0)-Number(b.sort_order||0);});
  const deduped=[],keys=new Set();for(const entry of entries){const key=entry.dedupe_key||`${String(entry.title||"").toLowerCase()}|${entry.occurred_at||entry.date_label||"undated"}`;if(keys.has(key))continue;keys.add(key);deduped.push(entry)}
  const eraMap=new Map();for(const entry of deduped){const era=timelineEra(entry),current=eraMap.get(era.key)||{key:era.key,label:era.label,count:0};current.count+=1;eraMap.set(era.key,current)}
  return {timeline,chapters,activities,entries:deduped,eras:[...eraMap.values()]};
}

async function publicArchiveOriginThreads(request,env){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const rows=(await db(env).prepare(`SELECT ot.id,ot.slug,ot.title,ot.summary,ot.sort_order,ot.updated_at,
      COUNT(DISTINCT CASE WHEN ce.visibility='public' AND (
        (ce.entity_type='organization' AND EXISTS(
          SELECT 1 FROM about_identity_profiles eligible_origin_identity
          WHERE eligible_origin_identity.organization_id=ce.id
            AND eligible_origin_identity.publication_state='published' AND eligible_origin_identity.visibility='public'
            AND ${publicIdentityProfileLinkGateSql("eligible_origin_identity")}
        ))
        OR (ce.entity_type='visual_symbol' AND EXISTS(SELECT 1 FROM visual_symbols eligible_origin_symbol WHERE eligible_origin_symbol.id=ce.id AND eligible_origin_symbol.state='published'))
        OR (ce.entity_type='archive_record' AND EXISTS(
          SELECT 1 FROM archive_records eligible_origin_record JOIN archive_dossiers eligible_origin_dossier ON eligible_origin_dossier.entity_id=eligible_origin_record.id
          WHERE eligible_origin_record.id=ce.id AND eligible_origin_record.state='published' AND eligible_origin_dossier.state='published' AND eligible_origin_dossier.public_visible=1
        ))
        OR (ce.entity_type NOT IN ('organization','visual_symbol','archive_record') AND EXISTS(SELECT 1 FROM archive_dossiers eligible_origin_dossier WHERE eligible_origin_dossier.entity_id=ce.id AND eligible_origin_dossier.state='published' AND eligible_origin_dossier.public_visible=1))
      ) THEN ote.entity_id END) record_count
    FROM archive_origin_threads ot
    LEFT JOIN archive_origin_thread_entities ote ON ote.thread_id=ot.id
    LEFT JOIN content_entities ce ON ce.id=ote.entity_id
    WHERE ot.state='published' AND ot.public_visible=1
    GROUP BY ot.id,ot.slug,ot.title,ot.summary,ot.sort_order,ot.updated_at
    ORDER BY ot.sort_order,ot.title`).all()).results||[];
  const records=rows.map(row=>({...row,route:`/archive/?origin=${encodeURIComponent(row.slug)}`}));
  return json({records,origin_threads:records,count:records.length},{cache:"public, max-age=60"});
}

async function publicArchiveTimeline(request,env,timelineSlug){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  if(!timelineSlug){
    const rows=(await database.prepare(`SELECT at.*,ce.entity_type,o.name organization_name,p.name person_name,n.name node_name,
        CASE WHEN aip.organization_id IS NOT NULL THEN '/about/identities/'||aip.slug||'/' ELSE '' END profile_route
      FROM archive_timelines at JOIN content_entities ce ON ce.id=at.subject_entity_id AND ce.visibility='public'
      LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
      LEFT JOIN people p ON p.id=ce.id AND p.state='published' AND p.privacy='public'
      LEFT JOIN construct_nodes n ON n.id=ce.id AND n.state='published'
      ${timelineProfileJoinSql()}
      WHERE at.state='published' AND at.public_visible=1
        AND (ce.entity_type<>'person' OR p.id IS NOT NULL)
        AND (ce.entity_type<>'organization' OR o.id IS NOT NULL)
      ORDER BY at.sort_order,at.title`).all()).results||[];
    const records=rows.map(row=>({...redactPublicArchiveTimelineRecord(row),subject_name:timelineSubjectName(row),route:`/archive/timelines/${encodeURIComponent(row.slug)}/`,profileRoute:row.profile_route||""}));
    return json({records,timelines:records,count:records.length},{cache:"public, max-age=60"});
  }
  const payload=await loadPublicArchiveTimeline(database,timelineSlug);
  return payload?json(payload,{cache:"public, max-age=60"}):failure("Timeline not found.",404);
}

const IDENTITY_LIFECYCLE_STATES=new Set(["forming","active","dormant","retired","evolved"]);
const IDENTITY_PUBLICATION_STATES=new Set(["draft","published","archived"]);
const IDENTITY_VISIBILITIES=new Set(["public","unlisted","internal","private"]);

function identityProfileSql(where="1=1"){
  return `SELECT profile.*,organization.name organization_name,organization.slug organization_slug,
      organization.description organization_description,organization.state organization_state,
      owner.visibility organization_visibility,
      dossier.archive_slug dossier_archive_slug,dossier.state dossier_state,dossier.public_visible dossier_public_visible,
      timeline.slug timeline_slug,timeline.title timeline_title,timeline.state timeline_state,timeline.public_visible timeline_public_visible,
      symbol.slug current_symbol_slug,symbol.name current_symbol_name,symbol.meaning current_symbol_meaning,
      symbol.svg_markup current_symbol_svg_markup,symbol.state current_symbol_state,
      origin.slug origin_thread_slug,origin.title origin_thread_title,origin.state origin_thread_state,origin.public_visible origin_thread_public_visible,
      featured_dossier.archive_slug featured_archive_slug,featured_dossier.state featured_dossier_state,
      featured_dossier.public_visible featured_dossier_public_visible,
      COALESCE(featured_record.title,featured_search.title,profile.featured_origin_entity_id) featured_title
    FROM about_identity_profiles profile
    JOIN organizations organization ON organization.id=profile.organization_id
    JOIN content_entities owner ON owner.id=profile.organization_id AND owner.entity_type='organization'
    LEFT JOIN archive_dossiers dossier ON dossier.entity_id=profile.organization_id
    LEFT JOIN archive_timelines timeline ON timeline.id=profile.timeline_id
    LEFT JOIN visual_symbols symbol ON symbol.id=profile.current_symbol_id
    LEFT JOIN archive_origin_threads origin ON origin.id=profile.origin_thread_id
    LEFT JOIN archive_dossiers featured_dossier ON featured_dossier.entity_id=profile.featured_origin_entity_id
    LEFT JOIN archive_records featured_record ON featured_record.id=profile.featured_origin_entity_id
    LEFT JOIN search_documents featured_search ON featured_search.entity_id=profile.featured_origin_entity_id
    WHERE ${where}`;
}

function publicIdentityProfileWhereSql(){
  return `profile.publication_state='published' AND profile.visibility='public'
    AND ${publicIdentityProfileLinkGateSql("profile")}`;
}

function presentIdentityProfile(row,admin=false){
  if(!row)return null;
  const canonicalRoute=`/about/identities/${encodeURIComponent(row.slug)}/`;
  const profile={
    organization_id:row.organization_id,organizationId:row.organization_id,slug:row.slug,name:row.organization_name,
    kind_label:row.kind_label,kindLabel:row.kind_label,lifecycle_status:row.lifecycle_status,lifecycleStatus:row.lifecycle_status,
    origin_date_label:row.origin_date_label,originDateLabel:row.origin_date_label,hero_descriptor:row.hero_descriptor,heroDescriptor:row.hero_descriptor,
    current_role:row.current_role,currentRole:row.current_role,origin_body:row.origin_body,originBody:row.origin_body,
    return_body:row.return_body,returnBody:row.return_body,canonical_route:canonicalRoute,canonicalRoute,
    sort_order:Number(row.sort_order||0),sortOrder:Number(row.sort_order||0),
  };
  if(!admin)return profile;
  return {...profile,
    timeline_id:row.timeline_id||"",timelineId:row.timeline_id||"",current_symbol_id:row.current_symbol_id||"",currentSymbolId:row.current_symbol_id||"",
    origin_thread_id:row.origin_thread_id||"",originThreadId:row.origin_thread_id||"",featured_origin_entity_id:row.featured_origin_entity_id||"",featuredOriginEntityId:row.featured_origin_entity_id||"",
    publication_state:row.publication_state,publicationState:row.publication_state,visibility:row.visibility,
    public_visible:row.visibility==="public",publicVisible:row.visibility==="public",published_at:row.published_at||null,publishedAt:row.published_at||null,
    organization:{id:row.organization_id,slug:row.organization_slug,name:row.organization_name,state:row.organization_state,visibility:row.organization_visibility},
    dossier:row.dossier_archive_slug?{entity_id:row.organization_id,archive_slug:row.dossier_archive_slug,state:row.dossier_state,public_visible:Boolean(Number(row.dossier_public_visible)),route:`/archive/records/${encodeURIComponent(row.dossier_archive_slug)}/`}:null,
    timeline:row.timeline_id?{id:row.timeline_id,slug:row.timeline_slug,title:row.timeline_title,state:row.timeline_state,public_visible:Boolean(Number(row.timeline_public_visible)),route:`/archive/timelines/${encodeURIComponent(row.timeline_slug)}/`}:null,
    current_symbol:row.current_symbol_id?{id:row.current_symbol_id,slug:row.current_symbol_slug,name:row.current_symbol_name,state:row.current_symbol_state,route:legendCanonicalRoute(row.current_symbol_slug||row.current_symbol_id)}:null,
    origin_thread:row.origin_thread_id?{id:row.origin_thread_id,slug:row.origin_thread_slug,title:row.origin_thread_title,state:row.origin_thread_state,public_visible:Boolean(Number(row.origin_thread_public_visible)),route:`/archive/?origin=${encodeURIComponent(row.origin_thread_slug)}`}:null,
    featured_origin_record:row.featured_origin_entity_id?{entity_id:row.featured_origin_entity_id,archive_slug:row.featured_archive_slug||"",title:row.featured_title,state:row.featured_dossier_state||"",public_visible:Boolean(Number(row.featured_dossier_public_visible)),route:row.featured_archive_slug?`/archive/records/${encodeURIComponent(row.featured_archive_slug)}/`:""}:null,
  };
}

function normalizeIdentityProfile(body={},existing={}){
  const linkedValue=(keys,existingKey)=>{
    for(const key of keys)if(Object.prototype.hasOwnProperty.call(body,key))return text(body[key],200)||null;
    return text(existing[existingKey],200)||null;
  };
  const publicationState=text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft";
  return {
    organization_id:text(body.organization_id??body.organization_entity_id??body.subject_entity_id??body.organizationId??existing.organization_id,200),
    slug:slug(body.slug??existing.slug),
    kind_label:text(body.kind_label??body.public_kind_label??body.kindLabel??existing.kind_label,120)||"Creative identity",
    lifecycle_status:text(body.lifecycle_status??body.lifecycleStatus??existing.lifecycle_status,30)||"forming",
    origin_date_label:text(body.origin_date_label??body.originDateLabel??existing.origin_date_label,160),
    hero_descriptor:text(body.hero_descriptor??body.heroDescriptor??existing.hero_descriptor,5000),
    current_role:text(body.current_role??body.currentRole??existing.current_role,5000),
    origin_body:text(body.origin_body??body.originBody??existing.origin_body,50000),
    return_body:text(body.return_body??body.returnBody??existing.return_body,50000),
    timeline_id:linkedValue(["timeline_id","timelineId"],"timeline_id"),
    current_symbol_id:linkedValue(["current_symbol_id","current_symbol_entity_id","currentSymbolId"],"current_symbol_id"),
    origin_thread_id:linkedValue(["origin_thread_id","originThreadId"],"origin_thread_id"),
    featured_origin_entity_id:linkedValue(["featured_origin_entity_id","featured_origin_record_entity_id","featuredOriginEntityId"],"featured_origin_entity_id"),
    publication_state:publicationState,
    visibility:publicationVisibility(publicationState),
    sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,
  };
}

async function validateIdentityProfile(database,profile){
  if(!profile.organization_id||!profile.slug)return "organization_id and slug are required.";
  if(!IDENTITY_LIFECYCLE_STATES.has(profile.lifecycle_status))return "Choose a valid lifecycle status.";
  if(!IDENTITY_PUBLICATION_STATES.has(profile.publication_state))return "Choose a valid publication state.";
  if(!IDENTITY_VISIBILITIES.has(profile.visibility))return "Choose a valid visibility.";
  const organization=await database.prepare(`SELECT organization.id,organization.state,owner.visibility
    FROM organizations organization JOIN content_entities owner ON owner.id=organization.id AND owner.entity_type='organization'
    WHERE organization.id=?`).bind(profile.organization_id).first();
  if(!organization)return "Choose an organization for this identity.";
  if(profile.timeline_id&&!await database.prepare("SELECT id FROM archive_timelines WHERE id=? AND subject_entity_id=?").bind(profile.timeline_id,profile.organization_id).first())return "Choose a timeline owned by this organization.";
  if(profile.current_symbol_id&&!await database.prepare("SELECT id FROM visual_symbols WHERE id=? AND state<>'archived'").bind(profile.current_symbol_id).first())return "Choose an active Legend symbol.";
  if(profile.origin_thread_id&&!await database.prepare("SELECT id FROM archive_origin_threads WHERE id=? AND state<>'archived'").bind(profile.origin_thread_id).first())return "Choose an active Origin Thread.";
  if(profile.featured_origin_entity_id&&!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(profile.featured_origin_entity_id).first())return "Choose an Archive record as the featured origin artifact.";
  if(profile.publication_state==="published"&&profile.visibility==="public"){
    if(organization.state!=="published"||organization.visibility!=="public")return "Publish the organization record before publishing its identity profile.";
    if(!profile.hero_descriptor||!profile.current_role||!profile.origin_body)return "A public identity needs a hero descriptor, current role, and origin account.";
    if(!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=? AND state='published' AND public_visible=1").bind(profile.organization_id).first())return "Publish the Creative Identity Archive dossier before publishing its About profile.";
    if(profile.timeline_id&&!await database.prepare("SELECT id FROM archive_timelines WHERE id=? AND subject_entity_id=? AND state='published' AND public_visible=1").bind(profile.timeline_id,profile.organization_id).first())return "Publish the selected identity timeline before publishing its About profile.";
    if(profile.current_symbol_id&&!await database.prepare(`SELECT symbol.id FROM visual_symbols symbol JOIN content_entities entity ON entity.id=symbol.id AND entity.visibility='public' WHERE symbol.id=? AND symbol.state='published'`).bind(profile.current_symbol_id).first())return "Publish the selected current mark before publishing its About profile.";
    if(profile.origin_thread_id&&!await database.prepare(`SELECT thread.id FROM archive_origin_threads thread JOIN archive_origin_thread_entities member ON member.thread_id=thread.id AND member.entity_id=? WHERE thread.id=? AND thread.state='published' AND thread.public_visible=1`).bind(profile.organization_id,profile.origin_thread_id).first())return "Publish the selected Origin Thread and include this identity before publishing its About profile.";
    if(profile.featured_origin_entity_id&&!await database.prepare(`SELECT record.id FROM archive_records record JOIN content_entities entity ON entity.id=record.id AND entity.entity_type='archive_record' AND entity.visibility='public' JOIN archive_dossiers dossier ON dossier.entity_id=record.id AND dossier.state='published' AND dossier.public_visible=1 WHERE record.id=? AND record.state='published'`).bind(profile.featured_origin_entity_id).first())return "Publish the selected origin artifact as an Archive record before publishing its About profile.";
  }
  return "";
}

async function adminIdentityProfilePayload(database,key){
  const row=await database.prepare(identityProfileSql("profile.organization_id=? OR profile.slug=?")).bind(key,key).first();
  if(!row)return null;
  const record=presentIdentityProfile(row,true);
  if(record.current_symbol){
    record.current_symbol.archive_appearances=(await database.prepare(`SELECT * FROM visual_symbol_archive_appearances WHERE symbol_entity_id=? ORDER BY sort_order,created_at`).bind(record.current_symbol.id).all()).results||[];
  }
  return record;
}

function identityPublicationComponent(key,label,id,state,publicVisible,ready=true){
  return {key,label,id:id||"",entity_id:id||"",state:state||"missing",public_visible:Boolean(publicVisible),ready:Boolean(ready)};
}

async function identityPublicationReview(database,key){
  const profile=await database.prepare(identityProfileSql("profile.organization_id=? OR profile.slug=?")).bind(key,key).first();
  if(!profile)return null;
  const organizationId=profile.organization_id,featuredId=profile.featured_origin_entity_id||"",timelineId=profile.timeline_id||"",symbolId=profile.current_symbol_id||"",threadId=profile.origin_thread_id||"";
  const [organizationDossierResult,timelineResult,chaptersResult,symbolResult,threadResult,membersResult,threadSymbolsResult,featuredResult,featuredRecordResult,subjectsResult,currentMarkBrandResult,appearancesResult,relationshipsResult,activitiesResult]=await database.batch([
    database.prepare("SELECT entity_id,archive_slug,orientation,story,state,public_visible FROM archive_dossiers WHERE entity_id=?").bind(organizationId),
    database.prepare("SELECT id,subject_entity_id,slug,title,description,state,public_visible FROM archive_timelines WHERE id=?").bind(timelineId),
    database.prepare("SELECT id,title,summary,body,date_label,state,public_visible FROM archive_timeline_chapters WHERE timeline_id=? AND state<>'archived' ORDER BY sort_order,created_at").bind(timelineId),
    database.prepare(`SELECT symbol.*,entity.visibility
      FROM visual_symbols symbol JOIN content_entities entity ON entity.id=symbol.id WHERE symbol.id=?`).bind(symbolId),
    database.prepare("SELECT id,slug,title,summary,state,public_visible FROM archive_origin_threads WHERE id=?").bind(threadId),
    database.prepare(`SELECT member.entity_id,entity.entity_type,entity.visibility,symbol.state symbol_state,record.state record_state,dossier.state dossier_state,dossier.public_visible dossier_public
      FROM archive_origin_thread_entities member JOIN content_entities entity ON entity.id=member.entity_id
      LEFT JOIN visual_symbols symbol ON symbol.id=member.entity_id
      LEFT JOIN archive_records record ON record.id=member.entity_id
      LEFT JOIN archive_dossiers dossier ON dossier.entity_id=member.entity_id
      WHERE member.thread_id=? ORDER BY member.is_primary DESC,member.sort_order`).bind(threadId),
    database.prepare(`SELECT symbol.*,entity.visibility
      FROM archive_origin_thread_entities member
      JOIN visual_symbols symbol ON symbol.id=member.entity_id
      JOIN content_entities entity ON entity.id=symbol.id
      WHERE member.thread_id=? ORDER BY member.sort_order`).bind(threadId),
    database.prepare(`SELECT record.id,record.title,record.slug,record.state record_state,record.creator_entity_id,record.record_status,
        entity.visibility entity_visibility,dossier.archive_slug,dossier.state dossier_state,dossier.public_visible dossier_public,
        catalogue.current_state_id,catalogue.medium_id catalogue_medium_id,catalogue.object_type_id catalogue_object_type_id,
        state.id state_id,state.publication_state state_publication,state.public_visible state_public,
        version.id version_id,version.entity_id version_entity_id,version.publication_state version_publication,version.public_visible version_public,
        material.id lead_material_id,material.dossier_entity_id lead_material_entity_id,material.state material_state,material.visibility material_visibility,
        media.id derivative_media_id,media.state media_state,media.privacy media_privacy,media.public_presentation media_presentation,
        media.mime_type,media.alt_text,media.caption,pair.master_media_id,
        master.state master_state,master.privacy master_privacy,master.public_presentation master_presentation
      FROM archive_records record
      JOIN content_entities entity ON entity.id=record.id
      JOIN archive_dossiers dossier ON dossier.entity_id=record.id
      LEFT JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=record.id
      LEFT JOIN archive_object_states state ON state.id=catalogue.current_state_id
      LEFT JOIN archive_object_versions version ON version.id=state.version_id
      LEFT JOIN archive_materials material ON material.id=state.lead_material_id AND material.state_id=state.id
      LEFT JOIN media_assets media ON media.id=material.media_id
      LEFT JOIN media_asset_variants pair ON pair.derivative_media_id=media.id AND pair.purpose='public-display'
      LEFT JOIN media_assets master ON master.id=pair.master_media_id
      WHERE record.id=?`).bind(featuredId),
    database.prepare("SELECT * FROM archive_records WHERE id=?").bind(featuredId),
    database.prepare(`SELECT subject.subject_entity_id,subject.role,subject.public_visible,entity.entity_type,entity.visibility,
        person.state person_state,person.privacy person_privacy,organization.state organization_state,
        place.state place_state,place.privacy place_privacy,symbol.state symbol_state
      FROM archive_dossier_subjects subject JOIN content_entities entity ON entity.id=subject.subject_entity_id
      LEFT JOIN people person ON person.id=entity.id
      LEFT JOIN organizations organization ON organization.id=entity.id
      LEFT JOIN places place ON place.id=entity.id
      LEFT JOIN visual_symbols symbol ON symbol.id=entity.id
      WHERE subject.dossier_entity_id=? ORDER BY subject.sort_order`).bind(featuredId),
    database.prepare(`SELECT subject.subject_entity_id,subject.public_visible
      FROM archive_dossier_subjects subject
      WHERE subject.dossier_entity_id=? AND subject.subject_entity_id=? AND subject.role='brand'`).bind(symbolId,organizationId),
    database.prepare(`SELECT appearance.id,appearance.symbol_entity_id,appearance.appearance_role,appearance.title,appearance.caption,appearance.publication_state,appearance.public_visible,
        symbol.state symbol_state,entity.visibility symbol_visibility
      FROM visual_symbol_archive_appearances appearance
      JOIN visual_symbols symbol ON symbol.id=appearance.symbol_entity_id
      JOIN content_entities entity ON entity.id=symbol.id
      WHERE appearance.record_entity_id=? ORDER BY appearance.sort_order,appearance.created_at`).bind(featuredId),
    database.prepare(`SELECT relationship.id,relationship.source_entity_id,relationship.target_entity_id,relationship.relationship_type_id,relationship.public_visible,
        target.entity_type target_type,target.visibility target_visibility,symbol.state target_symbol_state
      FROM entity_relationships relationship
      JOIN content_entities target ON target.id=relationship.target_entity_id
      LEFT JOIN visual_symbols symbol ON symbol.id=relationship.target_entity_id
      WHERE relationship.relationship_type_id='rel-uses-symbol' AND relationship.source_entity_id IN (?,?)
      ORDER BY relationship.sort_order,relationship.created_at`).bind(organizationId,featuredId),
    database.prepare(`SELECT activity.id,activity.title,activity.summary,activity.body,activity.date_label,activity.public_visible,
        (SELECT MIN(subject.public_visible) FROM entity_activity_subjects subject
          WHERE subject.activity_id=activity.id AND subject.subject_entity_id=?) subject_public_visible
      FROM entity_activity activity
      WHERE activity.entity_id=? AND EXISTS(
        SELECT 1 FROM entity_activity_subjects subject WHERE subject.activity_id=activity.id AND subject.subject_entity_id=?
      ) ORDER BY activity.sort_order,activity.created_at`).bind(organizationId,featuredId,organizationId),
  ]);
  const rows=result=>result?.results||[],organizationDossier=rows(organizationDossierResult)[0]||null,timeline=rows(timelineResult)[0]||null,chapters=rows(chaptersResult),symbol=rows(symbolResult)[0]||null,thread=rows(threadResult)[0]||null,members=rows(membersResult),threadSymbols=rows(threadSymbolsResult),featured=rows(featuredResult)[0]||null,featuredRecord=rows(featuredRecordResult)[0]||null,subjects=rows(subjectsResult),currentMarkBrand=rows(currentMarkBrandResult)[0]||null,appearanceRows=rows(appearancesResult),relationshipRows=rows(relationshipsResult),activities=rows(activitiesResult);
  const blockers=[];
  const block=(component,code,message)=>blockers.push({component,code,message});
  if(!profile.origin_date_label||!profile.hero_descriptor||!profile.current_role||!profile.origin_body||!profile.return_body)block("profile","profile-copy","Add the origin date, hero descriptor, current role, origin account, and return account before publishing.");
  if(!organizationDossier)block("identity-dossier","identity-dossier-missing","Prepare the Creative Identity Archive record before publishing.");
  else if(!organizationDossier.orientation||!organizationDossier.story)block("identity-dossier","identity-dossier-copy","Complete the Creative Identity Archive orientation and story before publishing.");
  if(!timeline||timeline.subject_entity_id!==organizationId)block("timeline","timeline-missing","Link a timeline owned by this identity before publishing.");
  else if(!timeline.slug||!timeline.title||!timeline.description)block("timeline","timeline-copy","Complete the identity timeline title, introduction, and route before publishing.");
  if(timeline&&(!chapters.length||chapters.some(chapter=>!chapter.title||!chapter.summary||!chapter.body||!chapter.date_label)))block("timeline","timeline-chapters","Complete the title, summary, history, and visitor-facing date for every included timeline chapter.");
  if(!symbol)block("current-mark","current-mark-missing","Link the current Legend mark before publishing.");
  else if(symbol.state==="archived"||!symbol.slug||!symbol.name||!symbol.category_id||!symbol.meaning||!symbol.svg_markup)block("current-mark","current-mark-incomplete","Complete the selected current Legend mark before releasing this identity history.");
  if(!thread)block("origin-thread","origin-thread-missing","Link an Origin Thread before publishing.");
  else if(!thread.slug||!thread.title||!thread.summary)block("origin-thread","origin-thread-copy","Complete the Origin Thread title, introduction, and route before publishing.");
  const memberIds=new Set(members.map(member=>member.entity_id));
  const relationships=relationshipRows.filter(relationship=>(relationship.source_entity_id===organizationId&&relationship.target_entity_id===symbolId)||(relationship.source_entity_id===featuredId&&relationship.target_type==="visual_symbol"&&memberIds.has(relationship.target_entity_id)));
  if(thread&&(!memberIds.has(organizationId)||!memberIds.has(featuredId)||!memberIds.has(symbolId)))block("origin-thread","origin-thread-members","The Origin Thread must include the identity, its origin record, and its current mark.");
  if(!featured||!featuredRecord)block("origin-record","origin-record-missing","Link a complete Archive origin record before publishing.");
  else{
    if(!featuredRecord.title||!featuredRecord.slug||!featuredRecord.summary||!featuredRecord.body||!featuredRecord.cultural_object_type_id||!featuredRecord.medium_label||!featuredRecord.creator_entity_id||!featuredRecord.date_precision||!featuredRecord.date_or_period||featured.catalogue_object_type_id!==featuredRecord.cultural_object_type_id||!featured.catalogue_medium_id)block("origin-record","origin-record-copy","Complete the origin record title, description, catalogue type, medium, creator, and visitor-facing date before publishing.");
    if(!featured.state_id||!featured.version_id||!featured.lead_material_id||featured.version_entity_id!==featuredId||featured.lead_material_entity_id!==featuredId)block("origin-record","origin-record-structure","Choose the current version, current state, and lead public image owned by the origin record.");
    if(!featured.derivative_media_id||featured.media_state!=="active"||featured.media_privacy!=="public"||featured.media_presentation!=="inline"||!/^image\//i.test(featured.mime_type||"")||!featured.alt_text||!featured.caption)block("origin-record","origin-record-media","The origin record needs an active public display image with alt text and caption.");
    if(!featured.master_media_id)block("origin-record","origin-record-media-pair","Pair the public display image with its private archival master before publishing.");
    else if(featured.master_state!=="active"||!['internal','private'].includes(featured.master_privacy)||featured.master_presentation!=="hidden")block("origin-record","origin-record-master-privacy","The archival master must remain active, private, and hidden before publishing.");
  }
  const brandSubject=subjects.find(subject=>subject.subject_entity_id===organizationId&&subject.role==="brand"),creatorSubject=subjects.find(subject=>subject.subject_entity_id===featured?.creator_entity_id&&subject.role==="creator");
  if(!brandSubject||!creatorSubject)block("origin-record","origin-record-subjects","Connect the identity and credited creator to the origin record before publishing.");
  const identityRelationship=relationships.find(relationship=>relationship.source_entity_id===organizationId&&relationship.target_entity_id===symbolId);
  const originSymbolRelationships=relationships.filter(relationship=>relationship.source_entity_id===featuredId&&relationship.target_type==="visual_symbol");
  const appearanceSymbolIds=new Set([symbolId,...originSymbolRelationships.map(relationship=>relationship.target_entity_id)]),packageSymbols=threadSymbols.filter(item=>appearanceSymbolIds.has(item.id)),appearances=appearanceRows.filter(appearance=>appearanceSymbolIds.has(appearance.symbol_entity_id));
  if(!identityRelationship)block("connections","identity-mark-connection","Connect the identity to its current mark before publishing.");
  if(!originSymbolRelationships.length)block("connections","origin-symbol-connection","Connect the origin record to its documented symbol before publishing.");
  if(packageSymbols.length!==appearanceSymbolIds.size||packageSymbols.some(item=>item.state==="archived"||!item.slug||!item.name||!item.category_id||!item.meaning||!item.svg_markup)||originSymbolRelationships.some(relationship=>!memberIds.has(relationship.target_entity_id)))block("connections","origin-symbol-review","Complete every documented symbol and include it in the Origin Thread before publishing.");
  const currentAppearance=appearances.find(appearance=>appearance.symbol_entity_id===symbolId&&appearance.appearance_role==="variant"),documentedTargets=new Set(originSymbolRelationships.map(relationship=>relationship.target_entity_id));
  if(!currentAppearance||[...documentedTargets].some(target=>!appearances.some(appearance=>appearance.symbol_entity_id===target))||appearances.some(appearance=>!appearance.title||!appearance.caption))block("legend-appearances","legend-appearances-missing","Complete the origin artifact appearance on the current mark and each documented historical symbol before publishing.");
  if(!currentMarkBrand)block("connections","current-mark-brand-missing","Connect the current mark to this identity before publishing.");
  if(!activities.length)block("timeline","origin-activity-missing","Add the origin record activity to the identity timeline before publishing.");
  else if(activities.some(activity=>!activity.title||!activity.summary||!activity.body||!activity.date_label))block("timeline","origin-activity-copy","Complete the origin activity title, summary, history, and visitor-facing date before publishing.");
  const packageSubjectRoles=new Set(["brand","creator","signature"]),packageSubjects=subjects.filter(subject=>packageSubjectRoles.has(subject.role));
  const subjectPublic=subject=>subject.visibility==="public"
    &&(subject.entity_type!=="person"||(subject.person_state==="published"&&subject.person_privacy==="public"))
    &&(subject.entity_type!=="organization"||subject.organization_state==="published")
    &&(subject.entity_type!=="place"||(subject.place_state==="published"&&subject.place_privacy==="public"))
    &&(subject.entity_type!=="visual_symbol"||subject.symbol_state==="published");
  const corePublic=profile.publication_state==="published"&&profile.visibility==="public"&&profile.organization_state==="published"&&profile.organization_visibility==="public"&&organizationDossier?.state==="published"&&Number(organizationDossier?.public_visible)===1&&timeline?.state==="published"&&Number(timeline?.public_visible)===1&&chapters.every(chapter=>chapter.state==="published"&&Number(chapter.public_visible)===1)&&thread?.state==="published"&&Number(thread?.public_visible)===1&&featured?.record_state==="published"&&featured?.entity_visibility==="public"&&featured?.dossier_state==="published"&&Number(featured?.dossier_public)===1&&featured?.version_publication==="published"&&Number(featured?.version_public)===1&&featured?.state_publication==="published"&&Number(featured?.state_public)===1&&featured?.material_state==="published"&&featured?.material_visibility==="public"&&packageSymbols.length===appearanceSymbolIds.size&&packageSymbols.every(item=>item.state==="published"&&item.visibility==="public")&&packageSubjects.every(subject=>Number(subject.public_visible)===1&&subjectPublic(subject))&&Number(currentMarkBrand?.public_visible)===1&&appearances.every(appearance=>appearance.publication_state==="published"&&Number(appearance.public_visible)===1)&&relationships.every(relationship=>Number(relationship.public_visible)===1)&&activities.every(activity=>Number(activity.public_visible)===1&&Number(activity.subject_public_visible)===1);
  const components=[
    identityPublicationComponent("profile","About profile",organizationId,profile.publication_state,profile.visibility==="public",!blockers.some(item=>item.component==="profile")),
    identityPublicationComponent("identity-dossier","Identity Archive record",organizationId,organizationDossier?.state,organizationDossier?.public_visible,!blockers.some(item=>item.component==="identity-dossier")),
    identityPublicationComponent("timeline","Timeline and chapters",timelineId,timeline?.state,timeline?.public_visible,!blockers.some(item=>item.component==="timeline")),
    identityPublicationComponent("origin-thread","Origin Thread",threadId,thread?.state,thread?.public_visible,!blockers.some(item=>item.component==="origin-thread")),
    identityPublicationComponent("current-mark","Current Legend mark",symbolId,symbol?.state,symbol?.visibility==="public",!blockers.some(item=>item.component==="current-mark")),
    identityPublicationComponent("origin-record","Origin Archive record",featuredId,featured?.record_state,featured?.entity_visibility==="public"&&Number(featured?.dossier_public)===1,!blockers.some(item=>item.component==="origin-record")),
    identityPublicationComponent("legend-appearances","Legend appearances",featuredId,appearances.every(item=>item.publication_state==="published")?"published":"draft",appearances.length>0&&appearances.every(item=>Number(item.public_visible)===1),!blockers.some(item=>item.component==="legend-appearances")),
    identityPublicationComponent("connections","Approved identity connections",organizationId,relationships.every(item=>Number(item.public_visible)===1)?"published":"draft",relationships.length>0&&relationships.every(item=>Number(item.public_visible)===1),!blockers.some(item=>item.component==="connections")),
  ];
  const fullyPublic=blockers.length===0&&corePublic;
  return {profile,featuredRecord,chapters,members,subjects,packageSubjects,packageSymbols,appearances,relationships,activities,featured,review:{slug:profile.slug,status:blockers.length?"blocked":fullyPublic?"already-published":"ready",publishable:blockers.length===0,ready:blockers.length===0,public:fullyPublic,components,blockers}};
}

async function identityPublicationApi(request,env,key,action){
  const database=db(env),graph=await identityPublicationReview(database,key);
  if(!graph)return failure("Creative identity not found.",404);
  if(request.method==="GET"&&action==="publication-review")return json({publication_review:graph.review,publicationReview:graph.review,review:graph.review});
  if(request.method!=="POST"||action!=="publish-package")return failure("Method not allowed.",405);
  if(!graph.review.publishable)return failure("This identity history needs review before it can publish.",409,{blockers:graph.review.blockers,components:graph.review.components});
  if(graph.review.status==="already-published")return json({publication_review:graph.review,publicationReview:graph.review,review:graph.review,record:await adminIdentityProfilePayload(database,key)});
  const profile=graph.profile,organizationId=profile.organization_id,featuredId=profile.featured_origin_entity_id,timelineId=profile.timeline_id,threadId=profile.origin_thread_id,versionId=graph.featured.version_id,stateId=graph.featured.state_id,materialId=graph.featured.lead_material_id,masterId=graph.featured.master_media_id;
  const appearanceIds=graph.appearances.map(item=>item.id),relationshipIds=graph.relationships.map(item=>item.id),activityIds=graph.activities.map(item=>item.id),chapterIds=graph.chapters.map(item=>item.id);
  const packageSubjectIds=[...new Set(graph.packageSubjects.map(item=>item.subject_entity_id))];
  const packageSymbolStatements=graph.packageSymbols.flatMap(item=>[
    database.prepare("UPDATE visual_symbols SET state='published',updated_at=datetime('now') WHERE id=?").bind(item.id),
    database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(item.id),
    database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(item.id),
    searchSyncStatement(database,"visual-language",{...item,state:"published"}),
  ]);
  const packageSubjectStatements=graph.packageSubjects.flatMap(item=>{
    const rows=[database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(item.subject_entity_id)];
    if(item.entity_type==="person")rows.push(database.prepare("UPDATE people SET state='published',privacy='public',updated_at=datetime('now') WHERE id=?").bind(item.subject_entity_id));
    if(item.entity_type==="organization")rows.push(database.prepare("UPDATE organizations SET state='published',updated_at=datetime('now') WHERE id=?").bind(item.subject_entity_id));
    if(item.entity_type==="place")rows.push(database.prepare("UPDATE places SET state='published',privacy='public',updated_at=datetime('now') WHERE id=?").bind(item.subject_entity_id));
    return rows;
  });
  const beforeSummary={publication_state:profile.publication_state,visibility:profile.visibility,origin_record_state:graph.featured.record_state,origin_record_visibility:graph.featured.entity_visibility};
  const afterSummary={publication_state:"published",visibility:"public",origin_record_state:"published",origin_record_visibility:"public",package:"approved linked identity history"};
  const statements=[
    database.prepare("UPDATE organizations SET state='published',updated_at=datetime('now') WHERE id=?").bind(organizationId),
    database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(organizationId),
    database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(organizationId),
    database.prepare("UPDATE archive_records SET state='published',record_status=CASE WHEN lower(record_status) LIKE '%private%' OR lower(record_status) LIKE '%draft%' THEN 'published Archive record' ELSE record_status END,updated_at=datetime('now') WHERE id=?").bind(featuredId),
    database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(featuredId),
    searchSyncStatement(database,"archive",{...graph.featuredRecord,state:"published"}),
    database.prepare("UPDATE archive_object_versions SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=? AND entity_id=?").bind(versionId,featuredId),
    database.prepare("UPDATE archive_object_states SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=? AND version_id=?").bind(stateId,versionId),
    database.prepare("UPDATE archive_materials SET state='published',visibility='public',updated_by='studio',updated_at=datetime('now') WHERE id=? AND dossier_entity_id=? AND state_id=?").bind(materialId,featuredId,stateId),
    database.prepare("UPDATE archive_materials SET state='draft',visibility='internal',updated_by='studio',updated_at=datetime('now') WHERE dossier_entity_id=? AND media_id=? AND id<>?").bind(featuredId,masterId,materialId),
    database.prepare("UPDATE entity_media SET public_visible=0 WHERE entity_id IN (?,?) AND media_id=?").bind(organizationId,featuredId,masterId),
    database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,empty_materials_note=CASE WHEN lower(empty_materials_note) LIKE '%private%' OR lower(empty_materials_note) LIKE '%draft%' THEN 'No additional process materials are public yet.' ELSE empty_materials_note END,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(featuredId),
    database.prepare(`UPDATE archive_dossier_subjects SET public_visible=1 WHERE dossier_entity_id=? AND subject_entity_id IN (${packageSubjectIds.map(()=>"?").join(",")})`).bind(featuredId,...packageSubjectIds),
    database.prepare("UPDATE archive_dossier_subjects SET public_visible=1 WHERE dossier_entity_id=? AND subject_entity_id=? AND role='brand'").bind(profile.current_symbol_id,organizationId),
    ...packageSymbolStatements,
    ...packageSubjectStatements,
    database.prepare("UPDATE archive_origin_threads SET state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(threadId),
    database.prepare("UPDATE archive_timelines SET state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=? AND subject_entity_id=?").bind(timelineId,organizationId),
    database.prepare("UPDATE about_identity_profiles SET publication_state='published',visibility='public',published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE organization_id=?").bind(organizationId),
  ];
  if(chapterIds.length)statements.splice(statements.length-1,0,database.prepare(`UPDATE archive_timeline_chapters SET state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE timeline_id=? AND id IN (${chapterIds.map(()=>"?").join(",")})`).bind(timelineId,...chapterIds));
  if(appearanceIds.length)statements.splice(statements.length-1,0,database.prepare(`UPDATE visual_symbol_archive_appearances SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE record_entity_id=? AND id IN (${appearanceIds.map(()=>"?").join(",")})`).bind(featuredId,...appearanceIds));
  if(relationshipIds.length)statements.splice(statements.length-1,0,database.prepare(`UPDATE entity_relationships SET public_visible=1,internal_notes=replace(internal_notes,'; publication review pending.','.'),updated_at=datetime('now') WHERE id IN (${relationshipIds.map(()=>"?").join(",")})`).bind(...relationshipIds));
  if(activityIds.length)statements.splice(statements.length-1,0,
    database.prepare(`UPDATE entity_activity SET public_visible=1,updated_at=datetime('now') WHERE id IN (${activityIds.map(()=>"?").join(",")})`).bind(...activityIds),
    database.prepare(`UPDATE entity_activity_subjects SET public_visible=1 WHERE subject_entity_id=? AND activity_id IN (${activityIds.map(()=>"?").join(",")})`).bind(organizationId,...activityIds));
  statements.push(
    database.prepare(`INSERT INTO entity_revisions(id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
      SELECT ?,?,COALESCE(MAX(revision_number),0)+1,'creative-identity-publication',?,?, 'studio',datetime('now') FROM entity_revisions WHERE entity_id=?`).bind(id("revision"),organizationId,JSON.stringify(beforeSummary),JSON.stringify(afterSummary),organizationId),
    database.prepare(`INSERT INTO entity_revisions(id,entity_id,revision_number,action,before_json,after_json,created_by,created_at)
      SELECT ?,?,COALESCE(MAX(revision_number),0)+1,'archive-publication',?,?, 'studio',datetime('now') FROM entity_revisions WHERE entity_id=?`).bind(id("revision"),featuredId,JSON.stringify(beforeSummary),JSON.stringify(afterSummary),featuredId),
  );
  try{await database.batch(statements)}catch(error){console.error(JSON.stringify({message:"Creative identity package publication failed.",identity:profile.slug,error:String(error?.message||error)}));return failure("The identity history could not be published as one complete package.",500)}
  const published=await identityPublicationReview(database,organizationId);
  if(!published||!published.review.publishable||!published.review.public)return failure("The identity history was saved but did not pass the final public verification.",500,{blockers:published?.review?.blockers||[]});
  const review={...published.review,status:"published"};
  return json({record:await adminIdentityProfilePayload(database,organizationId),publication_review:review,publicationReview:review,review});
}

async function adminIdentitiesApi(request,env,key=""){
  const database=db(env);
  if(request.method==="GET"){
    if(key){const record=await adminIdentityProfilePayload(database,key);return record?json({record,profile:record,identity:record}):failure("Creative identity not found.",404)}
    const rows=(await database.prepare(`${identityProfileSql("1=1")} ORDER BY profile.sort_order,organization.name`).all()).results||[];
    const records=[];for(const row of rows)records.push(await adminIdentityProfilePayload(database,row.organization_id));
    return json({records,identities:records,count:records.length});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!key){
    const profile=normalizeIdentityProfile(body);profile.publication_state="draft";profile.visibility="internal";
    const invalid=await validateIdentityProfile(database,profile);if(invalid)return failure(invalid,invalid.startsWith("Choose a canonical")?404:409);
    if(await database.prepare("SELECT organization_id FROM about_identity_profiles WHERE organization_id=? OR slug=?").bind(profile.organization_id,profile.slug).first())return failure("That organization or identity slug already has a profile.",409);
    if(await database.prepare("SELECT entity_id FROM archive_dossiers WHERE archive_slug=? AND entity_id<>?").bind(profile.slug,profile.organization_id).first())return failure("That Archive slug is already in use.",409);
    const statements=[
      database.prepare(`INSERT INTO about_identity_profiles(
        organization_id,slug,kind_label,lifecycle_status,origin_date_label,hero_descriptor,current_role,origin_body,return_body,
        timeline_id,current_symbol_id,origin_thread_id,featured_origin_entity_id,publication_state,visibility,sort_order,published_at,
        created_by,updated_by,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft','internal',?,NULL,'studio','studio',datetime('now'),datetime('now'))`).bind(
        profile.organization_id,profile.slug,profile.kind_label,profile.lifecycle_status,profile.origin_date_label,profile.hero_descriptor,profile.current_role,profile.origin_body,profile.return_body,
        profile.timeline_id,profile.current_symbol_id,profile.origin_thread_id,profile.featured_origin_entity_id,profile.sort_order,
      ),
      database.prepare(`INSERT OR IGNORE INTO archive_dossiers(entity_id,archive_slug,record_type,state,public_visible,published_at,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,'creative-identity','draft',0,NULL,'studio','studio',datetime('now'),datetime('now'))`).bind(profile.organization_id,profile.slug),
      database.prepare("DELETE FROM archive_catalogue_entries WHERE entity_id=?").bind(profile.organization_id),
    ];
    try{await database.batch(statements)}catch(error){return failure(/UNIQUE constraint failed/i.test(String(error?.message||error))?"That organization or identity slug already has a profile.":String(error?.message||error),409)}
    const record=await adminIdentityProfilePayload(database,profile.organization_id);await nextRevision(database,profile.organization_id,"creative-identity-create",null,record);
    return json({record,profile:record,identity:record,archive_dossier:record.dossier},{status:201});
  }
  if(request.method==="PATCH"&&key){
    const before=await database.prepare("SELECT * FROM about_identity_profiles WHERE organization_id=? OR slug=?").bind(key,key).first();if(!before)return failure("Creative identity not found.",404);
    const profile=normalizeIdentityProfile(body,before);profile.organization_id=before.organization_id;
    const publishPackage=profile.publication_state==="published"&&before.publication_state!=="published";
    if(publishPackage){profile.publication_state="draft";profile.visibility="internal"}
    const invalid=await validateIdentityProfile(database,profile);if(invalid)return failure(invalid,409);
    try{await database.prepare(`UPDATE about_identity_profiles SET slug=?,kind_label=?,lifecycle_status=?,origin_date_label=?,hero_descriptor=?,current_role=?,origin_body=?,return_body=?,timeline_id=?,current_symbol_id=?,origin_thread_id=?,featured_origin_entity_id=?,publication_state=?,visibility=?,sort_order=?,published_at=CASE WHEN ?='published' AND ?='public' THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE organization_id=?`).bind(
      profile.slug,profile.kind_label,profile.lifecycle_status,profile.origin_date_label,profile.hero_descriptor,profile.current_role,profile.origin_body,profile.return_body,profile.timeline_id,profile.current_symbol_id,profile.origin_thread_id,profile.featured_origin_entity_id,profile.publication_state,profile.visibility,profile.sort_order,profile.publication_state,profile.visibility,before.organization_id,
    ).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(String(error?.message||error))?"That identity slug is already in use.":String(error?.message||error),409)}
    const record=await adminIdentityProfilePayload(database,before.organization_id);await nextRevision(database,before.organization_id,"creative-identity-update",before,record);
    if(publishPackage)return identityPublicationApi(new Request(request.url,{method:"POST",headers:request.headers}),env,before.organization_id,"publish-package");
    return json({record,profile:record,identity:record});
  }
  return failure("Method not allowed.",405);
}

const LEGEND_ARCHIVE_APPEARANCE_ROLES=new Set(["variant","appearance"]);

function normalizeLegendArchiveAppearance(body={},existing={}){
  const publicationState=text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft";
  return {
    symbol_entity_id:text(body.symbol_entity_id??body.symbolEntityId??existing.symbol_entity_id,200),
    record_entity_id:text(body.record_entity_id??body.recordEntityId??existing.record_entity_id,200),
    appearance_role:text(body.appearance_role??body.appearanceRole??existing.appearance_role,40).toLowerCase(),
    title:text(body.title??existing.title,300),caption:text(body.caption??existing.caption,3000),
    publication_state:publicationState,
    public_visible:publicationPublicFlag(publicationState),
    sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,
  };
}

function presentLegendArchiveAppearance(row){
  if(!row)return null;
  const route=row.archive_slug?`/archive/records/${encodeURIComponent(row.archive_slug)}/`:"";
  return {...row,public_visible:Boolean(Number(row.public_visible)),publicVisible:Boolean(Number(row.public_visible)),symbolEntityId:row.symbol_entity_id,recordEntityId:row.record_entity_id,appearanceRole:row.appearance_role,publicationState:row.publication_state,sortOrder:Number(row.sort_order||0),route};
}

async function legendArchiveAppearanceRow(database,appearanceId){
  return database.prepare(`SELECT appearance.*,symbol.name symbol_name,dossier.archive_slug,
      COALESCE(record.title,search.title,appearance.record_entity_id) record_title
    FROM visual_symbol_archive_appearances appearance
    JOIN visual_symbols symbol ON symbol.id=appearance.symbol_entity_id
    JOIN archive_dossiers dossier ON dossier.entity_id=appearance.record_entity_id
    LEFT JOIN archive_records record ON record.id=appearance.record_entity_id
    LEFT JOIN search_documents search ON search.entity_id=appearance.record_entity_id
    WHERE appearance.id=?`).bind(appearanceId).first();
}

async function validateLegendArchiveAppearance(database,record){
  if(!record.symbol_entity_id||!record.record_entity_id||!record.title||!LEGEND_ARCHIVE_APPEARANCE_ROLES.has(record.appearance_role))return "Choose a Legend symbol, Archive record, role, and title.";
  if(!IDENTITY_PUBLICATION_STATES.has(record.publication_state))return "Choose a valid publication state.";
  if(!await database.prepare("SELECT id FROM visual_symbols WHERE id=?").bind(record.symbol_entity_id).first())return "Choose a canonical Legend symbol.";
  if(!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(record.record_entity_id).first())return "Choose a canonical Archive record.";
  if(record.publication_state==="published"&&record.public_visible){
    if(!await database.prepare(`SELECT symbol.id FROM visual_symbols symbol JOIN content_entities entity ON entity.id=symbol.id AND entity.visibility='public' WHERE symbol.id=? AND symbol.state='published'`).bind(record.symbol_entity_id).first())return "Publish the Legend symbol before publishing its Archive appearance.";
    if(!await database.prepare(`SELECT dossier.entity_id FROM archive_dossiers dossier
      JOIN content_entities entity ON entity.id=dossier.entity_id AND entity.visibility='public'
      LEFT JOIN archive_records archive_record ON archive_record.id=entity.id
      WHERE dossier.entity_id=? AND dossier.state='published' AND dossier.public_visible=1
        AND ${archiveIdentityProfilePublicSql("entity")}
        AND (entity.entity_type<>'archive_record' OR archive_record.state='published')`).bind(record.record_entity_id).first())return "Publish the linked Archive record before publishing this Legend appearance.";
  }
  return "";
}

async function legendArchiveAppearancesAdminApi(request,env,appearanceId=""){
  const database=db(env);
  if(request.method==="GET"){
    if(appearanceId){const row=await legendArchiveAppearanceRow(database,appearanceId);return row?json({record:presentLegendArchiveAppearance(row)}):failure("Legend Archive appearance not found.",404)}
    const url=new URL(request.url),symbolId=text(url.searchParams.get("symbol_entity_id")||url.searchParams.get("symbolId"),200),recordId=text(url.searchParams.get("record_entity_id")||url.searchParams.get("recordId"),200),conditions=[],values=[];
    if(symbolId){conditions.push("appearance.symbol_entity_id=?");values.push(symbolId)}if(recordId){conditions.push("appearance.record_entity_id=?");values.push(recordId)}
    const where=conditions.length?` WHERE ${conditions.join(" AND ")}`:"",rows=(await database.prepare(`SELECT appearance.*,symbol.name symbol_name,dossier.archive_slug,
        COALESCE(record.title,search.title,appearance.record_entity_id) record_title
      FROM visual_symbol_archive_appearances appearance JOIN visual_symbols symbol ON symbol.id=appearance.symbol_entity_id
      JOIN archive_dossiers dossier ON dossier.entity_id=appearance.record_entity_id
      LEFT JOIN archive_records record ON record.id=appearance.record_entity_id LEFT JOIN search_documents search ON search.entity_id=appearance.record_entity_id
      ${where} ORDER BY appearance.symbol_entity_id,appearance.sort_order,appearance.created_at`).bind(...values).all()).results||[];
    const records=rows.map(presentLegendArchiveAppearance);return json({records,appearances:records,count:records.length});
  }
  if(request.method==="POST"&&!appearanceId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const record=normalizeLegendArchiveAppearance(body);record.publication_state="draft";record.public_visible=0;
    const invalid=await validateLegendArchiveAppearance(database,record);if(invalid)return failure(invalid,409);
    const newId=text(body.id,200)||id("legend-appearance");
    try{await database.prepare(`INSERT INTO visual_symbol_archive_appearances(id,symbol_entity_id,record_entity_id,appearance_role,title,caption,publication_state,public_visible,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'draft',0,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.symbol_entity_id,record.record_entity_id,record.appearance_role,record.title,record.caption,record.sort_order).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(String(error?.message||error))?"That Legend appearance is already recorded.":error.message,409)}
    return json({record:presentLegendArchiveAppearance(await legendArchiveAppearanceRow(database,newId))},{status:201});
  }
  const before=appearanceId?await legendArchiveAppearanceRow(database,appearanceId):null;if(!before)return failure("Legend Archive appearance not found.",404);
  if(request.method==="DELETE"){await database.prepare("DELETE FROM visual_symbol_archive_appearances WHERE id=?").bind(appearanceId).run();return json({ok:true,removed:true})}
  if(request.method!=="PATCH")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");const record=normalizeLegendArchiveAppearance(body,before),invalid=await validateLegendArchiveAppearance(database,record);if(invalid)return failure(invalid,409);
  try{await database.prepare(`UPDATE visual_symbol_archive_appearances SET symbol_entity_id=?,record_entity_id=?,appearance_role=?,title=?,caption=?,publication_state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(record.symbol_entity_id,record.record_entity_id,record.appearance_role,record.title,record.caption,record.publication_state,record.public_visible,record.sort_order,appearanceId).run()}catch(error){return failure(/UNIQUE constraint failed/i.test(String(error?.message||error))?"That Legend appearance is already recorded.":error.message,409)}
  return json({record:presentLegendArchiveAppearance(await legendArchiveAppearanceRow(database,appearanceId))});
}

async function publicIdentityOriginThread(database,threadId){
  if(!threadId)return null;
  const thread=await database.prepare("SELECT id,slug,title,summary,sort_order FROM archive_origin_threads WHERE id=? AND state='published' AND public_visible=1").bind(threadId).first();if(!thread)return null;
  const members=(await database.prepare(`SELECT member.entity_id,member.is_primary,member.sort_order,ce.entity_type,
      COALESCE(o.name,vs.name,ar.title,sd.title,ce.id) name,ad.archive_slug,
      CASE WHEN ce.entity_type='organization' AND aip.publication_state='published' AND aip.visibility='public' AND ${publicIdentityProfileLinkGateSql("aip")} THEN '/about/identities/'||aip.slug||'/'
        WHEN ce.entity_type='visual_symbol' AND vs.state='published' THEN '/about/legend/'||vs.slug||'/'
        WHEN ad.archive_slug IS NOT NULL AND ad.state='published' AND ad.public_visible=1 THEN '/archive/records/'||ad.archive_slug||'/' ELSE '' END route
    FROM archive_origin_thread_entities member JOIN content_entities ce ON ce.id=member.entity_id AND ce.visibility='public'
    LEFT JOIN organizations o ON o.id=ce.id AND o.state='published'
    LEFT JOIN about_identity_profiles aip ON aip.organization_id=o.id
    LEFT JOIN visual_symbols vs ON vs.id=ce.id AND vs.state='published'
    LEFT JOIN archive_records ar ON ar.id=ce.id AND ar.state='published'
    LEFT JOIN search_documents sd ON sd.entity_id=ce.id
    LEFT JOIN archive_dossiers ad ON ad.entity_id=ce.id
    WHERE member.thread_id=?
      AND (ce.entity_type<>'organization' OR o.id IS NOT NULL)
      AND (ce.entity_type<>'visual_symbol' OR vs.id IS NOT NULL)
      AND (ce.entity_type<>'archive_record' OR ar.id IS NOT NULL)
    ORDER BY member.is_primary DESC,member.sort_order,member.entity_id`).bind(thread.id).all()).results||[];
  const publicMembers=members.filter(member=>member.route).map(member=>({entity_id:member.entity_id,entity_type:member.entity_type,name:member.name,archive_route:String(member.route).startsWith("/archive/records/")?member.route:"",route:member.route,is_primary:Boolean(Number(member.is_primary)),sort_order:Number(member.sort_order||0)}));
  return {...thread,route:`/archive/?origin=${encodeURIComponent(thread.slug)}`,members:publicMembers};
}

async function publicIdentitySymbols(database,profileRow,originThread){
  const ids=new Set([profileRow.current_symbol_id].filter(Boolean));
  for(const member of originThread?.members||[])if(member.entity_type==="visual_symbol")ids.add(member.entity_id);
  const relationshipRows=(await database.prepare(`SELECT CASE WHEN er.source_entity_id IN (?,?) THEN er.target_entity_id ELSE er.source_entity_id END symbol_id
    FROM entity_relationships er JOIN content_entities candidate ON candidate.id=CASE WHEN er.source_entity_id IN (?,?) THEN er.target_entity_id ELSE er.source_entity_id END
    WHERE er.relationship_type_id='rel-uses-symbol' AND er.public_visible=1 AND candidate.entity_type='visual_symbol'
      AND (er.source_entity_id IN (?,?) OR er.target_entity_id IN (?,?))`).bind(profileRow.organization_id,profileRow.featured_origin_entity_id||"",profileRow.organization_id,profileRow.featured_origin_entity_id||"",profileRow.organization_id,profileRow.featured_origin_entity_id||"",profileRow.organization_id,profileRow.featured_origin_entity_id||"").all()).results||[];
  relationshipRows.forEach(row=>ids.add(row.symbol_id));
  const symbolIds=[...ids];if(!symbolIds.length)return[];
  const rows=(await database.prepare(`SELECT vs.* FROM visual_symbols vs JOIN content_entities ce ON ce.id=vs.id AND ce.visibility='public' WHERE vs.id IN (${symbolIds.map(()=>"?").join(",")}) AND vs.state='published' ORDER BY vs.sort_order,vs.name`).bind(...symbolIds).all()).results||[];
  const appearanceRows=(await database.prepare(`SELECT vsa.*,ad.archive_slug FROM visual_symbol_archive_appearances vsa
    JOIN content_entities ce ON ce.id=vsa.record_entity_id AND ce.visibility='public'
    JOIN archive_dossiers ad ON ad.entity_id=vsa.record_entity_id AND ad.state='published' AND ad.public_visible=1
    WHERE vsa.symbol_entity_id IN (${symbolIds.map(()=>"?").join(",")}) AND vsa.publication_state='published' AND vsa.public_visible=1
      AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")}
    ORDER BY vsa.symbol_entity_id,vsa.sort_order`).bind(...symbolIds).all()).results||[];
  return rows.map(row=>({id:row.id,slug:row.slug,name:row.name,meaning:row.meaning,svg_markup:sanitizeLegendSvg(row.svg_markup),role:row.id===profileRow.current_symbol_id?"current mark":"cross-identity lineage",route:legendCanonicalRoute(row.slug),variants:publicLegendInlineEntries(row.variants_json),examples:publicLegendInlineEntries(row.examples_json),archive_appearances:appearanceRows.filter(appearance=>appearance.symbol_entity_id===row.id).map(appearance=>({id:appearance.id,role:appearance.appearance_role,title:appearance.title,caption:appearance.caption,record_entity_id:appearance.record_entity_id,route:`/archive/records/${encodeURIComponent(appearance.archive_slug)}/`}))}));
}

async function publicIdentitiesApi(request,env,profileSlug=""){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env),publicWhere=publicIdentityProfileWhereSql();
  if(!profileSlug){const rows=(await database.prepare(`${identityProfileSql(publicWhere)} ORDER BY profile.sort_order,organization.name`).all()).results||[],records=rows.map(row=>presentIdentityProfile(row));return json({records,identities:records,count:records.length},{cache:"public, max-age=60"})}
  const row=await database.prepare(identityProfileSql(`${publicWhere} AND profile.slug=?`)).bind(profileSlug).first();if(!row)return failure("Creative identity not found.",404);
  const profile=presentIdentityProfile(row),organization={id:row.organization_id,slug:row.organization_slug,name:row.organization_name,description:row.organization_description};
  const dossierRow=await database.prepare(archiveEntitySql(`ad.entity_id=? AND ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")}`)).bind(row.organization_id).first();
  const featuredRow=row.featured_origin_entity_id?await database.prepare(archiveEntitySql(`ad.entity_id=? AND ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")}`)).bind(row.featured_origin_entity_id).first():null;
  const relatedRows=(await database.prepare(`${archiveEntitySql(`ce.visibility='public' AND ad.state='published' AND ad.public_visible=1 AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveCanonicalOwnerPublicSql("ce")} AND ad.entity_id<>? AND ad.entity_id<>? AND EXISTS(SELECT 1 FROM archive_dossier_subjects identity_subject WHERE identity_subject.dossier_entity_id=ad.entity_id AND identity_subject.subject_entity_id=? AND identity_subject.public_visible=1)`)} ORDER BY ad.featured DESC,ad.sort_order,ad.published_at DESC LIMIT 24`).bind(row.organization_id,row.featured_origin_entity_id||"",row.organization_id).all()).results||[];
  const originThread=await publicIdentityOriginThread(database,row.origin_thread_id),symbols=await publicIdentitySymbols(database,row,originThread);
  const timeline=row.timeline_id?await loadPublicArchiveTimeline(database,row.timeline_id):null;if(timeline)timeline.timeline.profile_route=profile.canonical_route,timeline.timeline.profileRoute=profile.canonical_route;
  const currentSymbol=symbols.find(symbol=>symbol.id===row.current_symbol_id)||null,dossier=dossierRow?presentArchiveItem(dossierRow):null,featuredOriginRecord=featuredRow?presentArchiveItem(featuredRow):null,relatedRecords=relatedRows.map(presentArchiveItem);
  return json({record:profile,profile,identity:profile,organization,dossier,timeline,origin_thread:originThread,originThread,symbols,current_symbol:currentSymbol,currentSymbol,featured_origin_record:featuredOriginRecord,featuredOriginRecord,related_records:relatedRecords,relatedRecords},{cache:"public, max-age=60"});
}

function culturalObjectSubjects(value,creatorEntityId=""){
  const raw=Array.isArray(value)?value:[],map=new Map();
  for(const item of raw){const entityId=text(typeof item==="object"?(item.entity_id||item.id):item,200),role=text(typeof item==="object"?item.role:"related",100)||"related";if(entityId)map.set(`${entityId}|${role}`,{entity_id:entityId,role})}
  if(creatorEntityId)map.set(`${creatorEntityId}|creator`,{entity_id:creatorEntityId,role:"creator"});
  return [...map.values()].slice(0,60);
}

async function createCulturalObjectAdminApi(request,env){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const database=db(env),recordId=text(body.id,200)||id("archive-record"),recordSlug=slug(body.slug||body.title),title=text(body.title,300),room=text(body.room,120)||"Archive",recordType=slug(body.record_type??body.recordType)||"cultural-object";
  const objectTypeId=text(body.cultural_object_type_id??body.culturalObjectTypeId??body.object_type_id,120),mediumLabel=text(body.medium_label??body.medium,500),creatorEntityId=text(body.creator_entity_id??body.creatorEntityId,200)||null;
  let creatorLabel=text(body.creator_label??body.creator,300);
  const datePrecision=text(body.date_precision??body.datePrecision,30)||"undated",dateLabel=text(body.date_label??body.date_or_period??body.dateLabel,160),occurredAt=text(body.occurred_at??body.occurredAt,80)||null;
  if(!recordId||!recordSlug||!title||!objectTypeId)return failure("slug, title, and cultural_object_type_id are required.");
  if(!ARCHIVE_DATE_PRECISIONS.has(datePrecision))return failure("Choose a valid date precision.");
  const objectType=await database.prepare("SELECT * FROM archive_cultural_object_types WHERE id=?").bind(objectTypeId).first();if(!objectType)return failure("Choose a valid cultural object type.",409);
  if(creatorEntityId){
    const creator=await database.prepare(`SELECT entity.entity_type,COALESCE(person.name,organization.name,'') canonical_name
      FROM content_entities entity
      LEFT JOIN people person ON person.id=entity.id
      LEFT JOIN organizations organization ON organization.id=entity.id
      WHERE entity.id=? AND entity.entity_type IN ('person','organization')`).bind(creatorEntityId).first();
    if(!creator||!creator.canonical_name)return failure("Choose a canonical person or organization as creator.",409);
    creatorLabel=creator.canonical_name;
  }
  const subjects=culturalObjectSubjects(body.subject_entity_ids??body.subjectEntityIds,creatorEntityId),subjectIds=[...new Set(subjects.map(subject=>subject.entity_id))];
  if(subjectIds.length){const found=(await database.prepare(`SELECT id FROM content_entities WHERE id IN (${subjectIds.map(()=>"?").join(",")})`).bind(...subjectIds).all()).results||[];if(found.length!==subjectIds.length)return failure("Choose valid canonical subjects and creator.",409)}
  const versionId=id("archive-version"),stateId=id("archive-state"),summary=text(body.summary,8000),recordBody=text(body.body,50000),orientation=text(body.orientation,8000)||summary,story=text(body.story,50000)||recordBody;
  const versionTitle=text(body.version_title??body.versionTitle,300)||"Version 1",versionDescription=text(body.version_description??body.versionDescription,8000),stateTitle=text(body.state_title??body.stateTitle,300)||"State I",stateDescription=text(body.state_description??body.stateDescription,8000);
  for(let attempt=0;attempt<3;attempt+=1){
    const number=await nextArchiveCatalogueNumber(database,objectType.catalogue_prefix),catalogueId=`${objectType.catalogue_prefix}-${String(number).padStart(3,"0")}`;
    const statements=[
      database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_record','node-archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId),
      database.prepare(`INSERT INTO archive_records(id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,sort_order,cultural_object_type_id,medium_label,creator_entity_id,creator_label,date_precision,created_at,updated_at)
        VALUES(?, ?,?,'The Six.Well Construct',?,?,?,?,?,?,'private cultural-object draft','draft',?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(recordId,recordSlug,title,recordType,room,dateLabel,text(body.timeline_period??body.timelinePeriod,160)||dateLabel,summary,recordBody,Number(body.sort_order??body.sortOrder)||0,objectTypeId,mediumLabel,creatorEntityId,creatorLabel,datePrecision),
      database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?, 'draft',0,0,?,NULL,'studio','studio',datetime('now'),datetime('now'))`).bind(recordId,recordSlug,orientation,story,text(body.empty_materials_note,3000)||"No reviewed public materials are available yet.",recordType,Number(body.sort_order??body.sortOrder)||0),
      database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,1,'I','',?,'studio','studio',datetime('now'),datetime('now'))`).bind(recordId,objectType.medium_id,objectType.id,objectType.catalogue_prefix,number,catalogueId,stateId),
      database.prepare(`INSERT INTO archive_object_versions(id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,1,?,?,?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(versionId,recordId,versionTitle,versionDescription,occurredAt,datePrecision,dateLabel),
      database.prepare(`INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,'I',1,?,?,'',?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(stateId,versionId,stateTitle,stateDescription,occurredAt,datePrecision,dateLabel),
      ...subjects.map((subject,index)=>database.prepare("INSERT INTO archive_dossier_subjects(dossier_entity_id,subject_entity_id,role,public_visible,sort_order,created_at) VALUES(?,?,?,0,?,datetime('now'))").bind(recordId,subject.entity_id,subject.role,index+1)),
    ];
    try{
      await database.batch(statements);
      const [record,dossier,catalogue,version,state]=await Promise.all([database.prepare("SELECT * FROM archive_records WHERE id=?").bind(recordId).first(),database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(recordId).first(),database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(recordId).first(),database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(versionId).first(),database.prepare("SELECT * FROM archive_object_states WHERE id=?").bind(stateId).first()]);
      await nextRevision(database,recordId,"cultural-object-create",null,{record,dossier,catalogue,version,state});
      return json({record:{...record,canonical_route:`/archive/records/${encodeURIComponent(recordSlug)}/`},dossier,catalogue,version,state},{status:201});
    }catch(error){
      const message=String(error?.message||error);if(/UNIQUE constraint failed.*catalogue/i.test(message)&&attempt<2)continue;
      if(/UNIQUE constraint failed/i.test(message))return failure("That cultural-object ID or slug is already in use.",409);
      return failure(message,400);
    }
  }
  return failure("A unique catalogue number could not be allocated. Try again.",409);
}

async function mediaVariantsAdminApi(request,env,masterMediaId){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const database=db(env),derivativeMediaId=text(body.derivative_media_id??body.derivativeMediaId,200),purpose=text(body.purpose,80)||"public-display",activateDerivative=body.activate_derivative!==false&&body.activateDerivative!==false;
  if(!masterMediaId||!derivativeMediaId||masterMediaId===derivativeMediaId)return failure("Choose distinct archival-master and derivative assets.");
  if(purpose!=="public-display")return failure("Only the public-display variant purpose is supported.",409);
  const [master,derivative]=await Promise.all([database.prepare("SELECT * FROM media_assets WHERE id=?").bind(masterMediaId).first(),database.prepare("SELECT * FROM media_assets WHERE id=?").bind(derivativeMediaId).first()]);
  if(!master||!derivative)return failure("One of the selected Digital Assets does not exist.",404);
  if(!String(master.mime_type||"").startsWith("image/")||!["image/jpeg","image/png","image/webp"].includes(String(derivative.mime_type||"").toLowerCase()))return failure("Public-display pairing requires an image master and a browser-safe JPEG, PNG, or WebP derivative.",409);
  if(master.state!=="active"||!["internal","private"].includes(master.privacy)||master.public_presentation!=="hidden")return failure("The archival master must remain active, private or internal, and hidden.",409);
  if(derivative.state!=="active")return failure("The derivative must be active.",409);
  if(activateDerivative&&(derivative.privacy!=="public"||derivative.public_presentation!=="inline"||!text(derivative.alt_text,1000)))return failure("Prepare an active, public, inline derivative with alt text before pairing it.",409);
  if(!activateDerivative&&(!["internal","private","unlisted"].includes(derivative.privacy)||derivative.public_presentation!=="hidden"))return failure("An automatic derivative must remain non-public and hidden until its record is published.",409);
  if(await database.prepare("SELECT 1 paired FROM media_asset_variants WHERE master_media_id=? LIMIT 1").bind(derivativeMediaId).first())return failure("An archival master cannot also serve as a public derivative.",409);
  try{await database.prepare(`INSERT INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
    VALUES(?,?,?,'studio',datetime('now'),datetime('now')) ON CONFLICT(master_media_id,purpose) DO UPDATE SET derivative_media_id=excluded.derivative_media_id,updated_at=datetime('now')`).bind(masterMediaId,derivativeMediaId,purpose).run()}catch(error){return failure(String(error?.message||error),409)}
  const variant={master_media_id:masterMediaId,masterMediaId,derivative_media_id:derivativeMediaId,derivativeMediaId,purpose};
  return json({ok:true,record:variant,variant},{status:201});
}

const SEARCH_ROUTE_BLOCKED_PREFIXES = ["/api", "/admin", "/b", "/studio", "/submissions", "/tools"];
const SEARCH_ROUTE_BLOCKED_PATHS = [
  "/booking/confirmed", "/events/confirmed", "/tattoos/approved", "/tattoos/submission-received",
];

function safePublicSearchRoute(value) {
  const route = String(value || "").trim();
  if (!route.startsWith("/") || route.startsWith("//") || route.length > 1200) return "";
  let parsed;
  try { parsed = new URL(route, "https://the-six-well-construct.invalid"); } catch { return ""; }
  if (parsed.origin !== "https://the-six-well-construct.invalid") return "";
  const pathname = parsed.pathname.toLowerCase();
  if (SEARCH_ROUTE_BLOCKED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "";
  if (SEARCH_ROUTE_BLOCKED_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "";
  if (pathname.includes("managed-preview")) return "";
  for (const key of parsed.searchParams.keys()) {
    if (/^(?:token|preview|preview_token|access_token|cart|cart_id|checkout|session|secret)$/i.test(key)) return "";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function searchMediumKey(record) {
  const type = String(record?.entity_type || "").toLowerCase();
  const node = String(record?.node_id || "").toLowerCase();
  if (type === "creative_identity") return "pages";
  if (type === "archive_timeline") return "archive";
  if (["construct_node", "construct_pathway"].includes(type)) return "pages";
  if (["art_work"].includes(type) || node === "art" || node === "node-art") return "art";
  if (["portfolio_item", "flash_item", "flash_series", "tattoo_design"].includes(type) || ["tattooing", "tattoos", "node-tattoos"].includes(node)) return "tattoo";
  if (type === "merch_item" || node === "merch" || node === "node-merch") return "merch";
  if (["event", "appearance"].includes(type) || node === "events" || node === "node-events") return "events";
  if (type === "visual_symbol") return "symbols";
  if (["archive_record", "archive_note"].includes(type) || node === "archive" || node === "node-archive") return "archive";
  return "archive";
}

function searchMatchKind(fragmentType) {
  const type = String(fragmentType || "").toLowerCase();
  if (type === "calendar-description") return "Description";
  if (type === "calendar-venue") return "Venue";
  if (type === "calendar-organizer") return "Organizer";
  if (type === "calendar-subject") return "Subject";
  if (type === "calendar-format") return "Format";
  if (type === "calendar-date") return "Date";
  if (type === "calendar-program") return "Related program";
  if (type === "theme") return "Theme";
  if (type === "material") return "Material";
  if (type === "relationship" || type === "activity-subject") return "Relationship";
  if (type === "activity") return "History";
  if (type === "page") return "Page";
  if (type === "entity" || type === "dossier") return "Record";
  return type ? type.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Record";
}

function primarySearchMatch(record, query) {
  const q = String(query || "").trim().toLowerCase();
  const title = String(record?.title || "").trim();
  const normalizedTitle = title.toLowerCase();
  if (q && normalizedTitle === q) return { kind: "Title", label: "Exact title", snippet: title };
  if (q && normalizedTitle.startsWith(q)) return { kind: "Title", label: "Title begins with search", snippet: title };
  if (q && normalizedTitle.includes(q)) return { kind: "Title", label: "Title contains search", snippet: title };
  const directText = `${record?.summary || ""} ${record?.body || ""}`.trim();
  if (q && directText.toLowerCase().includes(q)) return { kind: "Record", label: "Record text", snippet: directText.slice(0, 320) };
  const matches = Array.isArray(record?.matches) ? record.matches : [];
  const match = matches.find((entry) => {
    if (!q) return true;
    return `${entry?.label || ""} ${entry?.body || ""} ${entry?.snippet || ""}`.toLowerCase().includes(q);
  }) || matches[0];
  if (!match) return { kind: "Record", label: title || "Published record", snippet: "" };
  return {
    kind: searchMatchKind(match.fragment_type),
    label: String(match.label || title || "Published record"),
    snippet: String(match.snippet || match.body || "").slice(0, 320),
  };
}

function searchRelevance(record, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 6;
  const title = String(record?.title || "").trim().toLowerCase();
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;
  if (`${record?.summary || ""} ${record?.body || ""}`.toLowerCase().includes(q)) return 3;
  return 4;
}

function normalizedCalendarSearchText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function calendarSearchDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function calendarSearchDateParts(value, timezone = "America/New_York") {
  const date = calendarSearchDate(value);
  if (!date) return { display: "", search: "" };
  const formats = [
    { year: "numeric", month: "long", day: "numeric" },
    { year: "numeric", month: "long" },
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ];
  const labels = formats.map((options) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(date));
  return { display: labels[3], search: [String(value || ""), ...labels].join(" ") };
}

function calendarSearchDateContext(event) {
  const timezone = String(event?.timezone || "America/New_York");
  const start = calendarSearchDateParts(event?.startsAt, timezone);
  const end = calendarSearchDateParts(event?.endsAt || event?.confirmedThrough, timezone);
  return {
    display: [start.display, end.display].filter(Boolean).join(" – "),
    search: [start.search, end.search].filter(Boolean).join(" "),
  };
}

function calendarSearchTemporalState(event, now = Date.now()) {
  if (String(event?.status || "").toLowerCase() === "cancelled" || String(event?.scheduleStatus || "").toLowerCase() === "cancelled") return "cancelled";
  const timezone = String(event?.timezone || "America/New_York");
  const startRaw = String(event?.startsAt || "");
  const endRaw = String(event?.endsAt || event?.confirmedThrough || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    const part = (type) => todayParts.find((item) => item.type === type)?.value || "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const finalDate = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : startRaw;
    if (startRaw > today) return "upcoming";
    if (finalDate >= today) return event?.dateKind === "date_range" ? "on_view" : "upcoming";
    return "past";
  }
  const start = calendarSearchDate(event?.startsAt)?.getTime();
  const end = calendarSearchDate(event?.endsAt || event?.confirmedThrough)?.getTime();
  if (Number.isFinite(start) && start > now) return "upcoming";
  if (Number.isFinite(end) && end >= now) return event?.dateKind === "date_range" ? "on_view" : "upcoming";
  return "past";
}

function calendarSearchMatchRecord(event, query, parent) {
  const q = normalizedCalendarSearchText(query);
  if (!q) return null;
  const title = String(event?.title || "").trim();
  const normalizedTitle = normalizedCalendarSearchText(title);
  const normalizedParentTitle = normalizedCalendarSearchText(event?.parentTitle);
  const occurrenceLabel = String(event?.occurrenceLabel || "").trim();
  const dateContext = calendarSearchDateContext(event);
  const parentVenue = normalizedCalendarSearchText(parent?.venueName);
  const eventVenue = normalizedCalendarSearchText(event?.venueName);
  const occurrenceSpecific = [
    occurrenceLabel,
    event?.description,
    event?.occurrenceType,
    dateContext.search,
    eventVenue && eventVenue !== parentVenue ? event?.venueName : "",
  ].some((value) => normalizedCalendarSearchText(value).includes(q));
  if (event?.isOccurrence && normalizedTitle !== q && (normalizedParentTitle.includes(q) || !occurrenceSpecific)) return null;

  let relevance = 5;
  let primaryMatch = null;
  const matches = [];
  if (normalizedTitle === q) {
    relevance = 0;
    primaryMatch = { kind: "Title", label: "Exact title", snippet: title };
  } else if (normalizedTitle.startsWith(q)) {
    relevance = 1;
    primaryMatch = { kind: "Title", label: "Title begins with search", snippet: title };
  } else if (normalizedTitle.includes(q)) {
    relevance = 2;
    primaryMatch = { kind: "Title", label: "Title contains search", snippet: title };
  }

  const addMatch = (fragmentType, label, value, rank) => {
    const searchable = normalizedCalendarSearchText(value);
    if (!searchable || !searchable.includes(q)) return;
    const snippet = String(value || "").trim().slice(0, 320);
    const match = { fragment_type: fragmentType, source_id: event.id, label: String(label || snippet), body: snippet, snippet, anchor: "", dossier_anchor: event.detailUrl };
    matches.push(match);
    if (!primaryMatch || rank < relevance) {
      relevance = rank;
      primaryMatch = { kind: searchMatchKind(fragmentType), label: match.label, snippet };
    }
  };

  addMatch("calendar-description", "Event description", event?.description, 3);
  addMatch("calendar-venue", event?.venueName || "Event venue", event?.venueName, 4);
  addMatch("calendar-organizer", event?.organizer || "Event organizer", event?.organizer, 4);
  for (const subject of event?.subjects || []) addMatch("calendar-subject", String(subject).replace(/[-_]+/g, " "), subject, 4);
  for (const format of event?.formats || []) addMatch("calendar-format", String(format).replace(/[-_]+/g, " "), format, 4);
  addMatch("calendar-date", dateContext.display || "Event date", dateContext.search, 4);
  for (const occurrence of event?.relatedOccurrences || []) {
    const relatedDate = calendarSearchDateContext({ ...occurrence, timezone: event.timezone });
    addMatch("calendar-program", occurrence.title || "Related program", `${occurrence.title || ""} ${occurrence.occurrenceType || ""} ${relatedDate.search}`, 5);
  }
  if (!primaryMatch) return null;

  const temporalState = calendarSearchTemporalState(event);
  return {
    entity_id: `calendar:${event.id}`,
    entity_type: event.isOccurrence ? "calendar_program" : "calendar_event",
    node_id: "node-events",
    title,
    summary: String(event.description || ""),
    body: "",
    route: event.detailUrl,
    state: "published",
    updated_at: event.lastModified || "",
    matches,
    match_count: matches.length,
    medium_key: "events",
    primary_match: primaryMatch,
    result_kind: event.origin === "sixwell" ? "Six.Well event" : "Calendar event",
    event_context: {
      origin: event.origin,
      startsAt: event.startsAt,
      endsAt: event.endsAt || null,
      confirmedThrough: event.confirmedThrough || null,
      dateKind: event.dateKind,
      timezone: event.timezone || "America/New_York",
      venueName: event.venueName || "",
      organizer: event.organizer || "",
      status: event.status,
      scheduleStatus: event.scheduleStatus || "scheduled",
      temporalState,
      isOccurrence: Boolean(event.isOccurrence),
      seriesId: event.seriesId || "",
      parentTitle: event.parentTitle || "",
      occurrenceType: event.occurrenceType || "",
    },
    search_relevance: relevance,
  };
}

function publicCalendarSearchRecords(events, query) {
  const parents = new Map((events || []).filter((event) => !event.isOccurrence).map((event) => [event.seriesId || event.id, event]));
  return (events || []).map((event) => calendarSearchMatchRecord(event, query, parents.get(event.seriesId))).filter(Boolean);
}

function publicSearchRouteIdentity(value) {
  const route = safePublicSearchRoute(value);
  if (!route) return "";
  const parsed = new URL(route, "https://the-six-well-construct.invalid");
  const pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "").toLowerCase();
  parsed.searchParams.sort();
  return `${pathname}${parsed.search}`;
}

function mergeCalendarSearchRecords(baseRecords, calendarRecords, query) {
  const merged = [...baseRecords];
  const byRoute = new Map(merged.map((record, index) => [publicSearchRouteIdentity(record.route), index]).filter(([route]) => route));
  for (const calendarRecord of calendarRecords) {
    const routeKey = publicSearchRouteIdentity(calendarRecord.route);
    const existingIndex = calendarRecord.event_context?.origin === "sixwell" ? byRoute.get(routeKey) : undefined;
    if (existingIndex === undefined) {
      byRoute.set(routeKey, merged.length);
      merged.push(calendarRecord);
      continue;
    }
    const existing = merged[existingIndex];
    const existingRelevance = searchRelevance(existing, query);
    const useCalendarMatch = Number(calendarRecord.search_relevance) <= existingRelevance;
    merged[existingIndex] = {
      ...existing,
      result_kind: calendarRecord.result_kind,
      event_context: calendarRecord.event_context,
      matches: [...(existing.matches || []), ...(calendarRecord.matches || [])],
      match_count: (existing.matches || []).length + (calendarRecord.matches || []).length,
      ...(useCalendarMatch ? { primary_match: calendarRecord.primary_match, search_relevance: calendarRecord.search_relevance } : {}),
    };
  }
  return merged;
}

function specialProjectSearchRecord(row, media, query) {
  const q = String(query || "").trim().toLowerCase();
  const title = String(row.title || "").trim();
  const descriptionParts = [row.summary, row.artist_statement, row.series_name, row.series_statement]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const description = descriptionParts.join(" ");
  const publicMedia = (media || []).map((item) => ({
    role: item.role === "primary" ? "primary" : "gallery",
    url: item.source_url || (item.storage_key ? `/api/construct/media/${encodeURIComponent(item.media_id)}` : ""),
    alt: String(item.alt_text_override || item.alt_text || "").trim(),
    caption: String(item.caption || "").trim(),
  })).filter((item) => item.url);
  const titleText = title.toLowerCase();
  const descriptionMatch = descriptionParts.find((value) => !q || value.toLowerCase().includes(q));
  const mediaMatch = publicMedia.find((item) => !q || `${item.alt} ${item.caption}`.toLowerCase().includes(q));
  const titleMatches = !q || titleText.includes(q);
  if (q && !titleMatches && !descriptionMatch && !mediaMatch) return null;

  const route = `/tattoos/special-projects/${encodeURIComponent(String(row.slug || row.entity_id || ""))}/`;
  const matches = [];
  if (titleMatches) matches.push({
    fragment_type: "page", source_id: row.entity_id, label: "Special Project title",
    body: title, snippet: title, anchor: "", dossier_anchor: route,
  });
  if (descriptionMatch) matches.push({
    fragment_type: "description", source_id: row.entity_id, label: "Special Project description",
    body: descriptionMatch, snippet: descriptionMatch.slice(0, 320), anchor: "", dossier_anchor: route,
  });
  if (mediaMatch) matches.push({
    fragment_type: "media", source_id: row.entity_id, label: mediaMatch.alt || "Special Project media",
    body: `${mediaMatch.alt} ${mediaMatch.caption}`.trim(),
    snippet: `${mediaMatch.alt} ${mediaMatch.caption}`.trim().slice(0, 320), anchor: "", dossier_anchor: route,
  });

  let primaryMatch;
  let relevance;
  if (titleMatches) {
    relevance = !q ? 6 : titleText === q ? 0 : titleText.startsWith(q) ? 1 : 2;
    primaryMatch = !q
      ? { kind: "Title", label: "Special Project title", snippet: title }
      : primarySearchMatch({ title, matches }, query);
  } else if (descriptionMatch) {
    relevance = 3;
    primaryMatch = { kind: "Description", label: "Special Project description", snippet: descriptionMatch.slice(0, 320) };
  } else {
    relevance = 4;
    primaryMatch = { kind: "Media", label: mediaMatch.alt || "Special Project media", snippet: `${mediaMatch.alt} ${mediaMatch.caption}`.trim().slice(0, 320) };
  }
  const leadMedia = publicMedia.find((item) => item.role === "primary") || publicMedia[0] || null;
  return {
    entity_id: row.entity_id,
    entity_type: "special_project",
    node_id: "node-tattoos",
    title,
    description,
    summary: description,
    body: "",
    route,
    state: "published",
    updated_at: row.updated_at,
    image_url: leadMedia?.url || "",
    image_alt: leadMedia?.alt || "",
    media_context: publicMedia,
    result_kind: "Special Project",
    matches,
    match_count: matches.length,
    primary_match: primaryMatch,
    search_relevance: relevance,
  };
}

async function publicSearchPages(database, query) {
  const pattern = `%${String(query || "").trim().toLowerCase()}%`;
  const [nodesResult, pathwaysResult, identitiesResult, timelinesResult, specialProjectsResult, specialProjectMediaResult] = await database.batch([
    database.prepare(`SELECT cn.id entity_id,'construct_node' entity_type,cn.id node_id,cn.name title,cn.route,cn.updated_at
      FROM construct_nodes cn JOIN content_entities ce ON ce.id=cn.id
      WHERE cn.state='published' AND cn.homepage_enabled=1 AND ce.visibility='public' AND lower(cn.name) LIKE ?
      ORDER BY cn.sort_order,cn.name`).bind(pattern),
    database.prepare(`SELECT cp.id entity_id,'construct_pathway' entity_type,cp.node_id,cp.name title,cp.route,cp.updated_at,cn.name node_name
      FROM construct_pathways cp JOIN construct_nodes cn ON cn.id=cp.node_id AND cn.state='published'
      JOIN content_entities ce ON ce.id=cp.id
      WHERE cp.state='published' AND cp.homepage_enabled=1 AND ce.visibility='public' AND lower(cp.name||' '||cn.name) LIKE ?
      ORDER BY cn.sort_order,cp.sort_order,cp.name`).bind(pattern),
    database.prepare(`SELECT 'identity-profile:'||profile.organization_id entity_id,'creative_identity' entity_type,'node-about' node_id,
        organization.name title,profile.hero_descriptor summary,
        profile.origin_body||' '||profile.return_body||' '||profile.current_role body,
        '/about/identities/'||profile.slug||'/' route,profile.updated_at
      FROM about_identity_profiles profile
      JOIN organizations organization ON organization.id=profile.organization_id AND organization.state='published'
      JOIN content_entities ce ON ce.id=profile.organization_id AND ce.visibility='public'
      WHERE profile.publication_state='published' AND profile.visibility='public'
        AND ${publicIdentityProfileLinkGateSql("profile")}
        AND lower(organization.name||' '||profile.kind_label||' '||profile.hero_descriptor||' '||profile.origin_body||' '||profile.return_body||' '||profile.current_role) LIKE ?
      ORDER BY profile.sort_order,organization.name`).bind(pattern),
    database.prepare(`SELECT 'archive-timeline:'||timeline.id entity_id,'archive_timeline' entity_type,'node-archive' node_id,
        timeline.title,timeline.description summary,'' body,
        '/archive/timelines/'||timeline.slug||'/' route,timeline.updated_at
      FROM archive_timelines timeline
      JOIN content_entities ce ON ce.id=timeline.subject_entity_id AND ce.visibility='public'
      LEFT JOIN organizations organization ON organization.id=ce.id AND organization.state='published'
      LEFT JOIN people person ON person.id=ce.id AND person.state='published' AND person.privacy='public'
      LEFT JOIN construct_nodes node ON node.id=ce.id AND node.state='published'
      WHERE timeline.state='published' AND timeline.public_visible=1
        AND (ce.entity_type<>'organization' OR organization.id IS NOT NULL)
        AND (ce.entity_type<>'person' OR person.id IS NOT NULL)
        AND lower(timeline.title||' '||timeline.description||' '||COALESCE(organization.name,person.name,node.name,'')) LIKE ?
      ORDER BY timeline.sort_order,timeline.title`).bind(pattern),
    database.prepare(`SELECT spc.id entity_id,spc.slug,spc.title,spc.summary,spc.artist_statement,spc.updated_at,
        CASE WHEN series_entity.id IS NOT NULL THEN series.name ELSE '' END series_name,
        CASE WHEN series_entity.id IS NOT NULL THEN series.statement ELSE '' END series_statement
      FROM special_project_calls spc
      JOIN content_entities ce ON ce.id=spc.id AND ce.entity_type='special_project' AND ce.visibility='public'
      LEFT JOIN special_project_series series ON series.id=spc.series_id AND series.state='published'
      LEFT JOIN content_entities series_entity ON series_entity.id=series.id
        AND series_entity.entity_type='special_project_series' AND series_entity.visibility='public'
      WHERE spc.publication_state='published'
      ORDER BY spc.sort_order,spc.title`),
    database.prepare(`SELECT spm.project_id,spm.media_id,spm.role,spm.alt_text_override,
        media.source_url,media.storage_key,media.alt_text,media.caption
      FROM special_project_call_media spm
      JOIN special_project_calls spc ON spc.id=spm.project_id AND spc.publication_state='published'
      JOIN content_entities ce ON ce.id=spc.id AND ce.entity_type='special_project' AND ce.visibility='public'
      JOIN media_assets media ON media.id=spm.media_id
      WHERE media.state='active' AND media.privacy='public' AND media.public_presentation='inline'
        AND media.mime_type LIKE 'image/%'
      ORDER BY spm.project_id,CASE spm.role WHEN 'primary' THEN 0 ELSE 1 END,spm.sort_order,spm.media_id`),
  ]);
  const mediaByProject = new Map();
  for (const item of specialProjectMediaResult.results || []) {
    if (!mediaByProject.has(item.project_id)) mediaByProject.set(item.project_id, []);
    mediaByProject.get(item.project_id).push(item);
  }
  return [
    ...(nodesResult.results || []).map((row) => ({
      ...row, summary: "Construct node", body: "", state: "published",
      matches: [{ fragment_type: "page", source_id: row.entity_id, label: row.title, body: "Construct node", snippet: "Construct node", anchor: "", dossier_anchor: row.route }],
      match_count: 1,
    })),
    ...(pathwaysResult.results || []).map((row) => ({
      ...row, summary: `Pathway in ${row.node_name}`, body: "", state: "published",
      matches: [{ fragment_type: "page", source_id: row.entity_id, label: row.title, body: `Pathway in ${row.node_name}`, snippet: `Pathway in ${row.node_name}`, anchor: "", dossier_anchor: row.route }],
      match_count: 1,
    })),
    ...(identitiesResult.results || []).map((row) => ({
      ...row, state: "published", result_kind: "Creative identity",
      matches: [{ fragment_type: "page", source_id: row.entity_id, label: "Creative identity", body: row.summary, snippet: row.summary, anchor: "", dossier_anchor: row.route }],
      match_count: 1,
    })),
    ...(timelinesResult.results || []).map((row) => ({
      ...row, state: "published", result_kind: "Archive timeline",
      matches: [{ fragment_type: "page", source_id: row.entity_id, label: "Archive timeline", body: row.summary, snippet: row.summary, anchor: "", dossier_anchor: row.route }],
      match_count: 1,
    })),
    ...(specialProjectsResult.results || []).map((row) => specialProjectSearchRecord(row, mediaByProject.get(row.entity_id) || [], query)).filter(Boolean),
  ];
}

function sitewideSearchRecords(records, query) {
  const sorted = records.map((record) => {
    const route = safePublicSearchRoute(record.route);
    if (!route) return null;
    const relevance = Number.isFinite(Number(record.search_relevance)) ? Number(record.search_relevance) : searchRelevance(record, query);
    if (String(query || "").trim() && relevance === 4 && !(record.matches || []).length) return null;
    return {
      ...record,
      route,
      medium_key: searchMediumKey(record),
      primary_match: record.primary_match || primarySearchMatch(record, query),
      __search_relevance: relevance,
    };
  }).filter(Boolean).sort((left, right) => {
    if (left.__search_relevance !== right.__search_relevance) return left.__search_relevance - right.__search_relevance;
    if (left.event_context && right.event_context) {
      const temporalRank = { on_view: 0, upcoming: 0, past: 1, cancelled: 2 };
      const leftTemporal = temporalRank[left.event_context.temporalState] ?? 1;
      const rightTemporal = temporalRank[right.event_context.temporalState] ?? 1;
      if (leftTemporal !== rightTemporal) return leftTemporal - rightTemporal;
    }
    return String(right.updated_at || "").localeCompare(String(left.updated_at || "")) || String(left.title || "").localeCompare(String(right.title || ""));
  });
  const seen = new Set(),seenRoutes=new Set();
  return sorted.filter((record) => {
    const key = String(record.entity_id || ""),routeKey=publicSearchRouteIdentity(record.route);
    if (!key || seen.has(key) || (routeKey && seenRoutes.has(routeKey))) return false;
    seen.add(key);
    if(routeKey)seenRoutes.add(routeKey);
    delete record.__search_relevance;
    delete record.search_relevance;
    return true;
  });
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
  const includeSet=new Set(String(url.searchParams.get("include")||"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean));
  const includes=["pages","calendar"].filter(value=>includeSet.has(value));
  if(!includes.length)return json({records,groups:records,items:records,count:records.length,query:q},{cache:"public, max-age=30"});
  const [pageRecords,calendarEvents]=await Promise.all([
    includeSet.has("pages")?publicSearchPages(database,q):[],
    includeSet.has("calendar")&&q?loadPublicCalendarSearchEvents(env):[],
  ]);
  const calendarRecords=publicCalendarSearchRecords(calendarEvents,q);
  const combinedRecords=mergeCalendarSearchRecords([...records,...pageRecords],calendarRecords,q);
  const sitewideRecords=sitewideSearchRecords(combinedRecords,q);
  return json({records:sitewideRecords,groups:sitewideRecords,items:sitewideRecords,count:sitewideRecords.length,query:q,includes},{cache:"public, max-age=30"});
}

const EXPLORE_SCOPES = new Set(["all", "works", "process", "pages"]);
const EXPLORE_WEIGHTS = { works: 0.5, process: 0.3, pages: 0.2 };
const EXPLORE_WORK_TYPES = new Set([
  "art_work", "portfolio_item", "flash_item", "flash_series", "tattoo_design",
  "merch_item", "event", "visual_symbol",
]);
const EXPLORE_BLOCKED_PATHS = [
  "/api", "/studio", "/tools", "/booking", "/preferences", "/search", "/adventure", "/explore",
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
  if (resource === "archive") return { ...common, node_id: "archive", summary: row.summary || "", body: row.body || "", date_label: row.date_or_period || "", route: archiveCanonicalRoute(row) };
  if (resource === "appearances") return { ...common, node_id: "about", summary: row.summary || "", body: row.description || "", date_label: row.starts_at || "", route: `/about/exhibitions-appearances/${encodeURIComponent(row.slug || row.id)}/` };
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
  const searchVisible = visible && resource !== "current-projects";
  return database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,archived_at=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(visible ? "public" : "internal", searchVisible ? 1 : 0, row.state === "archived" ? new Date().toISOString() : null, visible ? 1 : 0, row.id);
}

async function currentProjectHasEligibleMedia(database, entityId, collageSlot) {
  const row = await database.prepare(`SELECT 1 ok
    FROM entity_media em
    JOIN media_assets m ON m.id=em.media_id
    WHERE em.entity_id=? AND em.public_visible=1
      AND m.state='active' AND m.privacy='public'
      AND m.public_presentation='inline'
      AND (m.mime_type LIKE 'image/%' OR (?=1 AND lower(m.mime_type) IN ('video/mp4','video/webm')))
      AND ${mediaIsNotVariantMasterSql("m")}
      AND TRIM(COALESCE(NULLIF(em.alt_text_override,''),m.alt_text))<>''
    LIMIT 1`).bind(entityId, Number(collageSlot) || 0).first();
  return Boolean(row);
}

async function publicCurrentProjects(env) {
  const database = db(env);
  const rows = (await database.prepare(`SELECT p.* FROM about_current_projects p
    JOIN content_entities ce ON ce.id=p.id
    WHERE p.state='published' AND ce.visibility='public'
    ORDER BY p.sort_order,p.id`).all()).results || [];
  const mediaByEntity = await publicEntityMedia(database, rows.map((row) => row.id));
  const projects = rows.map((row) => {
    const collageSlot = Number(row.collage_slot) || 0;
    const media = (mediaByEntity.get(row.id) || []).filter((item) => {
      const mimeType = String(item.mimeType || "").toLowerCase();
      return text(item.alt, 1000) && (mimeType.startsWith("image/") || (collageSlot === 1 && ["video/mp4","video/webm"].includes(mimeType)));
    });
    const items = parseJson(row.items_json).slice(0, 6).map((entry) => ({
      title: text(entry?.title, 160),
      description: text(entry?.description, 1200),
    })).filter((entry) => entry.title && entry.description);
    const links = parseJson(row.links_json).slice(0, 3).map((entry) => ({ label: text(entry?.label, 100), url: text(entry?.url, 1000) }))
      .filter((entry) => entry.label && (entry.url.startsWith("/") || /^https:\/\//i.test(entry.url)));
    return {
      id: row.id,
      slug: row.slug,
      category: row.category,
      title: row.title,
      contextLine: row.context_line,
      summary: row.summary,
      items,
      status: row.status_label,
      accent: row.medium_key,
      links,
      collageSlot,
      focal: { x: Number.isFinite(Number(row.focal_x)) ? Number(row.focal_x) : 50, y: Number.isFinite(Number(row.focal_y)) ? Number(row.focal_y) : 50 },
      media,
      sortOrder: Number(row.sort_order) || 0,
    };
  });
  const collage = projects
    .filter((project) => project.collageSlot > 0 && project.media[0])
    .sort((a, b) => a.collageSlot - b.collageSlot)
    .map((project) => ({
      slot: project.collageSlot,
      projectId: project.id,
      projectSlug: project.slug,
      projectTitle: project.title,
      src: project.media[0].url,
      alt: project.media[0].alt,
      mimeType: project.media[0].mimeType,
      kind: project.media[0].mimeType?.startsWith("video/") ? "video" : "image",
      focal: project.focal,
    }));
  return json({ revision: rows.reduce((value, row) => row.updated_at > value ? row.updated_at : value, ""), projects, collage }, { cache: "public, max-age=60" });
}

const PUBLIC_FLASH_STATES = new Set(["available","reserved","placed","retired"]);

function eligibleFlashMedia(row) {
  return row?.media_state === "active"
    && row.media_privacy === "public"
    && row.media_presentation === "inline"
    && Number(row.public_visible) === 1;
}

async function flashMediaRows(database, entityId) {
  const result = await database.prepare(`SELECT em.*,
      m.state media_state,m.privacy media_privacy,
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
      AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
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
      em.alt_text_override,em.caption_override,m.id,m.original_filename,m.source_url,m.storage_key,m.mime_type,
      m.privacy,m.public_presentation,m.state media_state
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
      privacy: row.privacy,
      publicPresentation: row.public_presentation,
      state: row.media_state,
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
    resource === "flash" || resource === "art" || resource === "archive" || resource === "current-projects" ? adminEntityMedia(database, entityIds) : entityMedia(database, entityIds),
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
      ...(resource === "archive" ? {
        practiceSections: row.record_type === "practice" ? parseJson(row.practice_sections_json) : [],
        practice_sections: row.record_type === "practice" ? parseJson(row.practice_sections_json) : [],
        canonicalRoute: archiveCanonicalRoute(row),
        canonical_route: archiveCanonicalRoute(row),
      } : {}),
      media: media.get(row.id) || [],
    })),
    count: rows.length,
  });
}

async function adminCreate(request, env, resource) {
  const config = RESOURCE_CONFIG[resource]; const body = await readJson(request); if (!config || !body) return failure("Invalid request.");
  if(resource==="art"&&body.print_intent!==undefined&&!["unavailable","planned"].includes(body.print_intent))return failure("Print plan must be unavailable or planned.");
  const database = db(env); const recordId = text(body.id, 160) || id(config.entityType); let values;
  try { values = normalizeRecord(config, body); } catch (error) { return failure(error.message, 400); }
  if (resource === "current-projects" && Number(values.collage_slot) > 0) return failure("Create the entry, attach eligible public media with descriptive text, then assign its collage slot.", 409);
  let styleSelection = [];
  if (resource === "art") {
    if ((values.state || "draft") !== "draft") return failure("New artwork must begin as Draft. Attach the primary image before publishing.", 409);
    values.availability = text(values.availability, 80) || "unavailable";
    if (!ART_AVAILABILITY_VALUES.has(values.availability)) return failure("Availability must be available, not-for-sale, sold, or unavailable.");
    values.state = "draft";
  }
  if (resource === "archive" && values.record_type === "practice") {
    if ((values.state || "draft") !== "draft") return failure("New practice pages must begin as drafts. Attach the primary process image before publishing.", 409);
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
    database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId,config.entityType,values.node_id || (config.entityType==="visual_symbol"?"node-legend":config.entityType==="appearance"||config.entityType==="organization"||config.entityType==="current_project"?"node-about":null),"internal"),
    database.prepare(`INSERT INTO ${config.table}(id,${keys.join(",")},created_at,updated_at) VALUES(?,${keys.map(()=>"?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...keys.map(k=>values[k])),
  ];
  if (resource === "flash") createStatements.push(...replaceTattooStyleAssignmentStatements(database, recordId, styleSelection));
  await database.batch(createStatements);
  const createdRow = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  const created = resource === "flash" ? { ...createdRow, ...tattooStylePayload(styleSelection) } : createdRow;
  const publishStatements=[entityVisibilityStatement(database, resource, created),searchSyncStatement(database, resource, created)];
  await database.batch(publishStatements);
  let archiveDossier=null,archiveDossierError="";
  if(archiveEligibleEntityType(config.entityType)){
    try{
      const ensured=await ensureEditableArchiveDossier(database,recordId,{actor:"studio"});
      await ensureArchiveEventStructure(database,ensured.owner);
      await ensureArchiveCatalogueEntry(database,ensured.owner);
      archiveDossier={entity_id:ensured.record.entity_id,archive_slug:ensured.record.archive_slug,created:ensured.created};
    }catch(error){archiveDossierError=text(error?.message||error,1000)||"The Archive record could not be prepared."}
  }
  await nextRevision(database,recordId,"create",null,created); return json({record:created,...(archiveDossier?{archive_dossier:archiveDossier}:{}),...(archiveDossierError?{archive_dossier_error:archiveDossierError}:{})},{status:201});
}

async function adminUpdate(request, env, resource, recordId, archive = false) {
  const config = RESOURCE_CONFIG[resource]; const body = archive ? { state: "archived" } : await readJson(request); if (!config || !body) return failure("Invalid request.");
  if(resource==="art"&&body.print_intent!==undefined&&!["unavailable","planned"].includes(body.print_intent))return failure("Print plan must be unavailable or planned.");
  if(resource==="art"&&body.availability!==undefined&&!ART_AVAILABILITY_VALUES.has(text(body.availability,80)))return failure("Availability must be available, not-for-sale, sold, or unavailable.");
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
  let values; try { values = normalizeRecord(config,body,beforeRow); } catch (error) { return failure(error.message,400); } const keys = Object.keys(values); if (!keys.length && !hasStyleUpdate) return failure("No editable fields supplied.");
  const projectedRow = { ...beforeRow, ...values, id: recordId };
  const projected = resource === "flash" ? { ...projectedRow, ...tattooStylePayload(nextStyleSelection) } : projectedRow;
  if (resource === "current-projects" && Number(projected.collage_slot) > 0) {
    if (!await currentProjectHasEligibleMedia(database, recordId, projected.collage_slot)) return failure("A collage slot requires active public inline media with alt text. Video is supported for the center anchor only.", 409);
    const conflict = await database.prepare("SELECT id FROM about_current_projects WHERE collage_slot=? AND id<>? AND state<>'archived' LIMIT 1").bind(Number(projected.collage_slot), recordId).first();
    if (conflict) return failure(`Collage slot ${Number(projected.collage_slot)} is already assigned.`, 409);
  }
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
  if (resource === "archive" && projected.state === "published" && projected.record_type === "practice") {
    const sections = parseJson(projected.practice_sections_json);
    if (!text(projected.title, 8000) || !text(projected.slug, 8000) || !text(projected.summary, 8000) || !Array.isArray(sections) || !sections.length) {
      return failure("A practice page needs a title, slug, descriptor, and authored sections before publishing.", 409);
    }
    if (!await artHasEligiblePrimary(database, recordId)) {
      return failure("Attach an eligible primary practice image before publishing.", 409);
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
  if(resource==="archive"){
    const dossierState=projected.state==="published"?"published":projected.state==="archived"||projected.state==="retired"?"archived":"draft",dossierPublic=publicationPublicFlag(dossierState);
    updateStatements.push(database.prepare("UPDATE archive_dossiers SET state=?,public_visible=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(dossierState,dossierPublic,dossierState,recordId));
  }
  await database.batch(updateStatements);
  let archiveDossier=null,archiveDossierError="";
  if(!archive&&projected.state!=="archived"&&archiveEligibleEntityType(config.entityType)){
    try{
      const ensured=await ensureEditableArchiveDossier(database,recordId,{actor:"studio"});
      await ensureArchiveEventStructure(database,ensured.owner);
      await ensureArchiveCatalogueEntry(database,ensured.owner);
      archiveDossier={entity_id:ensured.record.entity_id,archive_slug:ensured.record.archive_slug,created:ensured.created};
    }catch(error){archiveDossierError=text(error?.message||error,1000)||"The Archive record could not be prepared."}
  }
  const afterRow = await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(recordId).first();
  const after = resource === "flash" ? { ...afterRow, ...tattooStylePayload(nextStyleSelection) } : afterRow;
  await nextRevision(database,recordId,archive?"archive":"update",before,after); return json({record:after,...(archiveDossier?{archive_dossier:archiveDossier}:{}),...(archiveDossierError?{archive_dossier_error:archiveDossierError}:{})});
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

function publicPortfolioMediaEligible(media) {
  return media?.state === "active"
    && media.privacy === "public"
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

async function publishedArchiveNoteUsingMedia(database,mediaId){
  return database.prepare(`SELECT an.entity_id,an.title
    FROM archive_note_assets ana JOIN archive_notes an ON an.entity_id=ana.note_entity_id
    JOIN content_entities ce ON ce.id=an.entity_id
    WHERE ana.media_id=? AND ana.public_visible=1
      AND an.state='published' AND an.public_visible=1 AND ce.visibility='public'
    LIMIT 1`).bind(mediaId).first();
}

async function publicMediaApi(request,env,mediaId){
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const database=db(env);
  const row=await database.prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
      AND (
        EXISTS(SELECT 1 FROM archive_materials am JOIN archive_dossiers ad ON ad.entity_id=am.dossier_entity_id
          JOIN content_entities ce ON ce.id=ad.entity_id WHERE am.media_id=m.id AND am.state='published' AND am.visibility='public'
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
            AND ${archiveIdentityProfilePublicSql("ce")} AND ${archiveMaterialPublicStateSql("am")}
            AND (ce.entity_type<>'archive_record' OR EXISTS(SELECT 1 FROM archive_records public_media_record WHERE public_media_record.id=ce.id AND public_media_record.state='published')))
        OR EXISTS(
          SELECT 1 FROM archive_source_material_entries smse
          JOIN archive_source_material_sets sms ON sms.id=smse.source_material_set_id
          JOIN archive_dossiers ad ON ad.entity_id=sms.dossier_entity_id
          JOIN content_entities ce ON ce.id=ad.entity_id
          WHERE smse.media_id=m.id AND smse.public_included=1
            AND sms.publication_state='published' AND sms.visibility='public'
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND ${archiveIdentityProfilePublicSql("ce")}
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
            AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND ${archiveIdentityProfilePublicSql("ce")}
        )
        OR EXISTS(
          SELECT 1 FROM special_project_call_media spm
          JOIN special_project_calls spc ON spc.id=spm.project_id
          JOIN content_entities ce ON ce.id=spc.id AND ce.entity_type='special_project'
          WHERE spm.media_id=m.id
            AND spc.publication_state='published' AND ce.visibility='public'
        )
        OR EXISTS(
          SELECT 1 FROM calendar_entries calendar_entry
          WHERE calendar_entry.flyer_media_id=m.id
            AND calendar_entry.status IN ('published','cancelled')
        )
        OR EXISTS(
          SELECT 1 FROM archive_note_assets note_asset
          JOIN archive_notes note ON note.entity_id=note_asset.note_entity_id
          JOIN content_entities note_entity ON note_entity.id=note.entity_id
          WHERE note_asset.media_id=m.id AND note_asset.public_visible=1
            AND note.state='published' AND note.public_visible=1 AND note_entity.visibility='public'
        )
        OR EXISTS(
          SELECT 1 FROM archive_blackboard_fragments fragment
          JOIN archive_blackboard_records blackboard ON blackboard.record_entity_id=fragment.record_entity_id
          JOIN archive_dossiers dossier ON dossier.entity_id=blackboard.record_entity_id
          JOIN content_entities owner ON owner.id=dossier.entity_id
          JOIN content_entities fragment_entity ON fragment_entity.id=fragment.id
          WHERE fragment.derivative_media_id=m.id
            AND fragment.state='published' AND fragment.public_visible=1
            AND fragment_entity.visibility='public'
            AND dossier.state='published' AND dossier.public_visible=1 AND owner.visibility='public' AND ${archiveIdentityProfilePublicSql("owner")}
            AND EXISTS(
              SELECT 1 FROM archive_blackboard_fragment_states public_link
              JOIN archive_blackboard_fragment_placements public_placement ON public_placement.fragment_id=public_link.fragment_id AND public_placement.state_id=public_link.state_id
              JOIN archive_object_states public_state ON public_state.id=public_link.state_id
              JOIN archive_object_versions public_version ON public_version.id=public_state.version_id
              WHERE public_link.fragment_id=fragment.id AND public_version.entity_id=blackboard.record_entity_id
                AND public_state.publication_state='published' AND public_state.public_visible=1
                AND public_version.publication_state='published' AND public_version.public_visible=1
            )
        )
        OR EXISTS(
          SELECT 1 FROM archive_blackboard_fragment_placements placement
          JOIN archive_blackboard_fragment_states fragment_state
            ON fragment_state.fragment_id=placement.fragment_id AND fragment_state.state_id=placement.state_id
          JOIN archive_blackboard_fragments fragment ON fragment.id=placement.fragment_id
          JOIN archive_blackboard_records blackboard ON blackboard.record_entity_id=fragment.record_entity_id
          JOIN archive_object_states object_state ON object_state.id=placement.state_id
          JOIN archive_object_versions version ON version.id=object_state.version_id AND version.entity_id=blackboard.record_entity_id
          JOIN archive_dossiers dossier ON dossier.entity_id=blackboard.record_entity_id
          JOIN content_entities owner ON owner.id=dossier.entity_id
          JOIN content_entities fragment_entity ON fragment_entity.id=fragment.id
          WHERE placement.hotspot_mask_media_id=m.id
            AND fragment.state='published' AND fragment.public_visible=1
            AND fragment_entity.visibility='public'
            AND object_state.publication_state='published' AND object_state.public_visible=1
            AND version.publication_state='published' AND version.public_visible=1
            AND dossier.state='published' AND dossier.public_visible=1 AND owner.visibility='public' AND ${archiveIdentityProfilePublicSql("owner")}
        )
      )`).bind(mediaId).first();
  if(!row)return failure("Not found.",404);
  return servePublicMedia(row,request,env);
}

async function publicEntityMediaApi(request,env,mediaId){
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const row=await db(env).prepare(`SELECT m.* FROM media_assets m
    WHERE m.id=? AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
      AND EXISTS(SELECT 1 FROM entity_media em JOIN content_entities ce ON ce.id=em.entity_id
        WHERE em.media_id=m.id AND em.public_visible=1 AND ce.visibility='public'
          AND ${publicEntityMediaOwnerSql("ce")})`).bind(mediaId).first();
  if(!row)return failure("Not found.",404);
  return servePublicMedia(row,request,env);
}

async function servePublicMedia(row,request,env){
  if(isArchivalSvgMedia(row))return failure("Media unavailable.",404);
  return serveR2Media(request,env.SUBMISSION_FILES,row,()=>failure("Media unavailable.",404));
}

async function adminMediaFileApi(request,env,mediaId){
  if(!["GET","HEAD"].includes(request.method))return failure("Method not allowed.",405);
  const row=await db(env).prepare("SELECT * FROM media_assets WHERE id=? AND state='active'").bind(mediaId).first();
  if(!row)return failure("Media not found.",404);
  const response=await serveR2Media(request,env.SUBMISSION_FILES,row,()=>failure("Media unavailable.",404));
  if(!isArchivalSvgMedia(row)||response.status>=300)return response;
  const headers=new Headers(response.headers),filename=String(row.original_filename||"archive.svg").replace(/[\r\n"]/g,"-");
  headers.set("content-disposition",`attachment; filename="${filename}"`);
  headers.set("content-security-policy","sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'");
  headers.set("x-content-type-options","nosniff");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
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

function presentMediaRecord(row){
  if(!row)return row;
  const record={...row};
  delete record[["consent","status"].join("_")];
  return record;
}

function digestHex(value){return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}

function isArchivalSvgMedia(row){return String(row?.mime_type||row?.content_type||"").toLowerCase()===ARCHIVAL_SVG_MIME}

function hasSvgDocumentRoot(value){
  const source=new TextDecoder("utf-8").decode(value);
  if(!source||source.includes("\0"))return false;
  return source.match(/<([a-zA-Z][\w:.-]*)\b/)?.[1]?.toLowerCase()==="svg";
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
    if(!allowed.has(mime))return failure(uploadKind==="archive-master"?"Use a TIFF, JPEG, PNG, WebP, HEIC, or HEIF archival master.":"Use an MP4 or WebM video.",415);
    if(!Number.isSafeInteger(byteSize)||byteSize<=0)return failure("A valid media size is required.");
    if(byteSize>RESUMABLE_MEDIA_MAX_BYTES)return failure("Resumable media must be 2 GiB or smaller.",413);
    const privacy=uploadKind==="archive-master"?"internal":text(body.privacy,30)||"internal";
    const sourceClass=text(body.sourceClass??body.source_class,40)||"creative",suppliedHash=text(body.sha256,64).toLowerCase();
    const transcriptStatus=uploadKind==="archive-master"?"not-requested":text(body.transcriptStatus??body.transcript_status,30)||"not-requested";
    const presentation=uploadKind==="archive-master"?"hidden":text(body.publicPresentation??body.public_presentation,30)||"inline";
    if(!MEDIA_PRIVACIES.has(privacy))return failure("Invalid media privacy.");
    if(!["creative","site_asset"].includes(sourceClass))return failure("Invalid media source class.");
    if(suppliedHash&&!/^[0-9a-f]{64}$/.test(suppliedHash))return failure("SHA-256 must contain 64 lowercase hexadecimal characters.");
    if(!MEDIA_TRANSCRIPT_STATUSES.has(transcriptStatus))return failure("Invalid transcript status.");
    if(!MEDIA_PRESENTATIONS.has(presentation))return failure("Invalid public presentation.");
    if(suppliedHash){
      const duplicate=await database.prepare("SELECT media_id FROM media_asset_provenance WHERE sha256=?").bind(suppliedHash).first();
      if(duplicate){
        const record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(duplicate.media_id).first();
        if(record)return json({record:presentMediaRecord(record),deduplicated:true,sha256:suppliedHash});
      }
    }
    const sessionNewId=id("media-upload"),mediaId=id("media"),filename=text(body.filename??body.original_filename,255)||"media",storageFilename=resumableUploadFilename(filename);
    const archiveScope=text(body.archiveScope??body.archive_scope,40).toLowerCase();
    const genericArchiveMaster=new Set(["archive","creative-identity","cultural-object"]).has(archiveScope);
    const key=uploadKind==="archive-master"
      ? `${genericArchiveMaster?"archive/masters":"archive/blackboards/masters"}/${mediaId}/${storageFilename}`
      : `construct/${mediaId}/${storageFilename}`;
    const upload=await env.SUBMISSION_FILES.createMultipartUpload(key,{
      httpMetadata:{contentType:mime,cacheControl:"private, no-store"},
      customMetadata:{mediaId,sessionId:sessionNewId,originalFilename:filename,uploadKind,...(archiveScope?{archiveScope}:{})},
    });
    try{
      await database.prepare(`INSERT INTO media_upload_sessions(
        id,upload_id,storage_key,original_filename,mime_type,upload_kind,byte_size,part_size,media_id,
        alt_text,caption,rights_notes,privacy,transcript,transcript_status,transcript_language,
        public_title,public_description,public_presentation,state,error_message,expires_at,
        created_by,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','',datetime('now','+24 hours'),'studio',datetime('now'),datetime('now'))`)
        .bind(sessionNewId,upload.uploadId,key,filename,mime,uploadKind,byteSize,RESUMABLE_MEDIA_PART_BYTES,mediaId,
          text(body.altText??body.alt_text,1000),text(body.caption,3000),text(body.rightsNotes??body.rights_notes,10000),privacy,text(body.transcript,100000),
          transcriptStatus,text(body.transcriptLanguage??body.transcript_language,40)||"en",text(body.publicTitle??body.public_title,300),
          text(body.publicDescription??body.public_description,3000),presentation).run();
      if(suppliedHash||sourceClass!=="creative")await database.prepare("UPDATE media_upload_sessions SET sha256=?,source_class=?,updated_at=datetime('now') WHERE id=?").bind(suppliedHash||null,sourceClass,sessionNewId).run();
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
      return json({record:presentMediaRecord(record),upload:presentUploadSession(session,await parts()),completed:true});
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
        id,storage_key,original_filename,mime_type,byte_size,alt_text,caption,rights_notes,privacy,state,
        created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation
      ) VALUES(?,?,?,?,?,?,?,?,?,'active','studio',datetime('now'),datetime('now'),?,?,?,?,?,?)`)
        .bind(session.media_id,session.storage_key,session.original_filename,session.mime_type,session.byte_size,session.alt_text,session.caption,session.rights_notes,session.privacy,
          session.transcript,session.transcript_status,session.transcript_language,session.public_title,session.public_description,session.public_presentation),
      database.prepare("UPDATE media_upload_sessions SET state='completed',completed_at=datetime('now'),error_message='',updated_at=datetime('now') WHERE id=?").bind(sessionId),
    ]);
    if(session.sha256)await database.prepare("UPDATE media_asset_provenance SET sha256=?,updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(session.sha256,session.media_id).run();
    const completed=await uploadSession(database,sessionId),record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(session.media_id).first();
    return json({record:presentMediaRecord(record),upload:presentUploadSession(completed,uploadedParts),completed:true});
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
    if(mediaId){const record=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();return record?json({record:presentMediaRecord(record)}):failure("Not found.",404);}
    const rows=(await database.prepare("SELECT * FROM media_assets ORDER BY created_at DESC").all()).results||[];return json({records:rows.map(presentMediaRecord),count:rows.length});
  }
  if(request.method==="DELETE"&&mediaId){
    const before=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();if(!before)return failure("Not found.",404);
    if(!["active","archived"].includes(before.state)||!["internal","private"].includes(before.privacy)||before.public_presentation!=="hidden")return failure("Only internal or private hidden media can be permanently deleted.",409);
    if(before.storage_key&&!env.SUBMISSION_FILES?.delete)return failure("Media storage is unavailable; the media record was not deleted.",503);
    try{await database.prepare("DELETE FROM media_assets WHERE id=?").bind(mediaId).run()}
    catch(error){if(/FOREIGN KEY constraint failed/i.test(String(error?.message||error)))return failure("This media is still referenced and cannot be deleted.",409);throw error}
    if(before.storage_key){try{await env.SUBMISSION_FILES.delete(before.storage_key)}catch{return json({error:"The media record was deleted, but its stored object could not be removed.",deleted:true,deleted_id:mediaId,deletedId:mediaId,storage_deleted:false,storageDeleted:false},{status:502})}}
    return json({ok:true,deleted:true,deleted_id:mediaId,deletedId:mediaId,storage_deleted:Boolean(before.storage_key),storageDeleted:Boolean(before.storage_key)});
  }
  if(request.method==="PATCH"&&mediaId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const before=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();if(!before)return failure("Not found.",404);
    const next={
      state:text(body.state??before.state,30),alt_text:text(body.alt_text??before.alt_text,1000),caption:text(body.caption??before.caption,3000),
      rights_notes:text(body.rights_notes??body.rightsNotes??before.rights_notes,10000),
      privacy:text(body.privacy??before.privacy,30),
      transcript:text(body.transcript??before.transcript,100000),transcript_status:text(body.transcript_status??before.transcript_status,30),
      transcript_language:text(body.transcript_language??before.transcript_language,40),public_title:text(body.public_title??before.public_title,300),
      public_description:text(body.public_description??before.public_description,3000),public_presentation:text(body.public_presentation??before.public_presentation,30),
    };
    if(!["active","archived"].includes(next.state))return failure("Invalid media state.");
    if(!MEDIA_PRIVACIES.has(next.privacy))return failure("Invalid media privacy.");
    if(!MEDIA_TRANSCRIPT_STATUSES.has(next.transcript_status))return failure("Invalid transcript status.");
    if(!MEDIA_PRESENTATIONS.has(next.public_presentation))return failure("Invalid public presentation.");
    if(isArchivalSvgMedia(before)&&(next.privacy!=="internal"||next.public_presentation!=="hidden"))return failure("Archival SVG media must remain internal and hidden.",409);
    const pairedAsMaster=await database.prepare("SELECT 1 paired FROM media_asset_variants WHERE master_media_id=? LIMIT 1").bind(mediaId).first();
    if(pairedAsMaster&&(next.state!=="active"||!["internal","private"].includes(next.privacy)||next.public_presentation!=="hidden"))return failure("A paired archival master must remain active, private or internal, and hidden.",409);
    const eligibilityChanged=["state","privacy","public_presentation"].some(field=>Object.prototype.hasOwnProperty.call(body,field));
    if(eligibilityChanged&&!publicPortfolioMediaEligible(next)){
      const cover=await publishedPortfolioCoverUsingMedia(database,mediaId);
      if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before making this media private.",409);
      const sourceMaterial=await publishedSourceMaterialUsingMedia(database,mediaId);
      if(sourceMaterial)return failure("Return the client source material to an internal draft before making one of its public files ineligible.",409);
      const note=await publishedArchiveNoteUsingMedia(database,mediaId);
      if(note)return failure("Unpublish the Archive Note or remove this asset token before making its media private.",409);
    }
    try{
      await database.prepare("UPDATE media_assets SET state=?,alt_text=?,caption=?,rights_notes=?,privacy=?,transcript=?,transcript_status=?,transcript_language=?,public_title=?,public_description=?,public_presentation=?,updated_at=datetime('now') WHERE id=?")
        .bind(next.state,next.alt_text,next.caption,next.rights_notes,next.privacy,next.transcript,next.transcript_status,next.transcript_language,next.public_title,next.public_description,next.public_presentation,mediaId).run();
    }catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before making this media private.",409);throw error;}
    await syncFailedExperimentsForMedia(database,mediaId);
    return json({record:presentMediaRecord(await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first())});
  }
  if(request.method!=="POST"||mediaId)return failure("Method not allowed.",405);
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||!file.size)return failure("A file is required.");
  const mime=(file.type||"application/octet-stream").toLowerCase(),archivalSvg=mime===ARCHIVAL_SVG_MIME;const image=["image/jpeg","image/png","image/webp","image/gif"].includes(mime);const doc=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mime);const audio=mime.startsWith("audio/"),video=RESUMABLE_UPLOAD_MIMES.video.has(mime);const av=audio||video,max=av?50*1024*1024:15*1024*1024;if(mime.startsWith("video/")&&!video)return failure("Use an MP4 or WebM video.",415);if(!(image||archivalSvg||doc||av))return failure("Unsupported media type.",415);if(file.size>max)return failure("File exceeds the allowed size.",413);if(!env.SUBMISSION_FILES)return failure("Media storage is unavailable.",503);
  const requestedPrivacy=text(form.get("privacy"),30)||"internal",transcriptStatus=text(form.get("transcript_status"),30)||"not-requested",requestedPresentation=text(form.get("public_presentation"),30)||(requestedPrivacy==="public"?"inline":"hidden"),sourceClass=text(form.get("source_class"),40)||"creative",catalogueEligibility=text(form.get("archive_catalogue_eligible"),20).toLowerCase(),archiveCatalogueEligible=!new Set(["0","false","no","off"]).has(catalogueEligibility),privacy=archivalSvg?"internal":requestedPrivacy,presentation=archivalSvg?"hidden":requestedPresentation;
  if(!MEDIA_PRIVACIES.has(privacy))return failure("Invalid media privacy.");if(!MEDIA_TRANSCRIPT_STATUSES.has(transcriptStatus))return failure("Invalid transcript status.");if(!MEDIA_PRESENTATIONS.has(presentation))return failure("Invalid public presentation.");
  if(!["creative","site_asset"].includes(sourceClass))return failure("Invalid media source class.");
  const fileBytes=await file.arrayBuffer();if(archivalSvg&&!hasSvgDocumentRoot(fileBytes))return failure("The selected file is not a valid SVG document.",415);
  const hash=digestHex(await crypto.subtle.digest("SHA-256",fileBytes)),duplicate=await database.prepare("SELECT media_id FROM media_asset_provenance WHERE sha256=?").bind(hash).first();
  if(duplicate){const existing=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(duplicate.media_id).first();if(archivalSvg&&(!isArchivalSvgMedia(existing)||existing.privacy!=="internal"||existing.public_presentation!=="hidden"))return failure("A matching file already exists but is not a protected archival SVG.",409);return json({record:presentMediaRecord(existing),deduplicated:true});}
  const newId=id("media");const key=`construct/${newId}/${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.SUBMISSION_FILES.put(key,fileBytes,{httpMetadata:{contentType:mime,cacheControl:"private, no-store"}});
  try{await database.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,alt_text,caption,rights_notes,privacy,state,created_by,created_at,updated_at,transcript,transcript_status,transcript_language,public_title,public_description,public_presentation,archive_catalogue_eligible)
    VALUES(?,?,?,?,?,?,?,?,?,'active','studio',datetime('now'),datetime('now'),?,?,?,?,?,?,?)`).bind(newId,key,file.name,mime,file.size,text(form.get("alt_text"),1000),text(form.get("caption"),3000),text(form.get("rights_notes"),10000),privacy,text(form.get("transcript"),100000),transcriptStatus,text(form.get("transcript_language"),40),text(form.get("public_title"),300),text(form.get("public_description"),3000),presentation,archiveCatalogueEligible?1:0).run();await database.prepare("UPDATE media_asset_provenance SET sha256=?,asset_role=CASE WHEN ?='site_asset' THEN 'site_asset' ELSE asset_role END,updated_by='studio',updated_at=datetime('now') WHERE media_id=?").bind(hash,sourceClass,newId).run();}catch(error){await database.prepare("DELETE FROM media_assets WHERE id=?").bind(newId).run().catch(()=>{});await env.SUBMISSION_FILES.delete(key);throw error;}
  return json({record:presentMediaRecord(await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(newId).first())},{status:201});
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
  if(entityType==="archive_failed_experiment"&&raw==="other")return"node-archive";
  if(["legend","visual-language","visual_language","node-legend"].includes(raw)||entityType==="visual_symbol")return"node-legend";
  if(["tattooing","tattoo","tattoos","node-tattoos"].includes(raw)||["flash_item","flash_series","portfolio_item","tattoo_design","special_project","special_project_series"].includes(entityType))return"node-tattoos";
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
      WHEN 'flash_item' THEN fi.title WHEN 'flash_series' THEN fs.name WHEN 'special_project' THEN spc.title WHEN 'special_project_series' THEN sps.name WHEN 'art_work' THEN aw.title WHEN 'portfolio_item' THEN pi.title WHEN 'merch_item' THEN mi.title
      WHEN 'visual_symbol' THEN vs.name WHEN 'archive_record' THEN ar.title WHEN 'archive_collection' THEN ac.name
      WHEN 'archive_failed_experiment' THEN afe.title
      WHEN 'archive_blackboard_fragment' THEN abf.title
      WHEN 'construct_node' THEN own.name WHEN 'construct_pathway' THEN cp.name WHEN 'person' THEN pe.name
      WHEN 'organization' THEN org.name WHEN 'place' THEN pl.name WHEN 'event' THEN ev.title WHEN 'appearance' THEN app.title ELSE ce.id END title,
    CASE ce.entity_type
      WHEN 'flash_item' THEN fi.state WHEN 'flash_series' THEN fs.state WHEN 'special_project' THEN spc.publication_state WHEN 'special_project_series' THEN sps.state WHEN 'art_work' THEN aw.state WHEN 'portfolio_item' THEN pi.state WHEN 'merch_item' THEN mi.state
      WHEN 'visual_symbol' THEN vs.state WHEN 'archive_record' THEN ar.state WHEN 'archive_collection' THEN ac.state
      WHEN 'archive_failed_experiment' THEN afe.state
      WHEN 'archive_blackboard_fragment' THEN abf.state
      WHEN 'construct_node' THEN own.state WHEN 'construct_pathway' THEN cp.state WHEN 'person' THEN pe.state
      WHEN 'organization' THEN org.state WHEN 'place' THEN pl.state WHEN 'event' THEN ev.status WHEN 'appearance' THEN app.state ELSE ce.visibility END state,
    CASE ce.entity_type
      WHEN 'flash_item' THEN COALESCE(NULLIF(fi.legacy_path,''),'/tattoos/flash/'||fi.slug||'/')
      WHEN 'flash_series' THEN '/tattoos/flash/?series='||fs.slug
      WHEN 'special_project' THEN '/tattoos/special-projects/'||spc.slug||'/'
      WHEN 'special_project_series' THEN '/tattoos/special-projects/?series='||sps.slug
      WHEN 'art_work' THEN COALESCE(NULLIF(aw.legacy_path,''),'/art/'||aw.slug||'/')
      WHEN 'portfolio_item' THEN '/tattoos/portfolio/?work='||pi.id
      WHEN 'merch_item' THEN mi.route
      WHEN 'visual_symbol' THEN '/about/legend/'||vs.slug||'/'
      WHEN 'archive_record' THEN CASE
        WHEN ar.record_type='practice' AND lower(ar.room)='art' THEN '/archive/art/'||ar.slug||'/'
        ELSE '/archive/?record='||ar.slug END
      WHEN 'archive_collection' THEN '/archive/?collection='||ac.slug
      WHEN 'archive_failed_experiment' THEN '/archive/failed-experiments/'||afe.slug||'/'
      WHEN 'archive_blackboard_fragment' THEN '/archive/blackboards/'||abfd.archive_slug||'/#fragment-'||abf.slug
      WHEN 'construct_node' THEN own.route WHEN 'construct_pathway' THEN cp.route
      WHEN 'organization' THEN CASE WHEN aip.publication_state='published' AND aip.visibility='public' AND ${publicIdentityProfileLinkGateSql("aip")} THEN '/about/identities/'||aip.slug||'/' ELSE '' END
      WHEN 'event' THEN '/events/'||ev.slug||'/' WHEN 'appearance' THEN '/about/exhibitions-appearances/'||app.slug||'/' ELSE '' END route,
    COALESCE(NULLIF(mi.image_url,''),NULLIF(pi.source_url,''),
      CASE WHEN ce.entity_type='archive_blackboard_fragment' AND abf.derivative_media_id IS NOT NULL
        THEN '/api/construct/media/'||abf.derivative_media_id ELSE NULL END,
      CASE WHEN ce.entity_type='visual_symbol' THEN NULLIF(vs.image_url,'') ELSE NULL END,
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id)
       FROM special_project_call_media spm JOIN media_assets m ON m.id=spm.media_id
       WHERE ce.entity_type='special_project' AND spm.project_id=ce.id
         AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
         AND m.mime_type LIKE 'image/%'
         AND ${mediaIsNotVariantMasterSql("m")}
       ORDER BY CASE spm.role WHEN 'primary' THEN 0 ELSE 1 END,spm.sort_order,spm.media_id LIMIT 1),
      (SELECT COALESCE(NULLIF(m.source_url,''),'/api/construct/entity-media/'||m.id) FROM entity_media em JOIN media_assets m ON m.id=em.media_id
       WHERE ce.entity_type<>'visual_symbol' AND em.entity_id=ce.id AND em.public_visible=1 AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%'
          AND ${mediaIsNotVariantMasterSql("m")}
          AND (ce.entity_type<>'archive_failed_experiment' OR trim(COALESCE(NULLIF(em.alt_text_override,''),m.alt_text))<>'')
       ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order LIMIT 1),
      CASE WHEN ce.entity_type='portfolio_item' THEN '/api/portfolio/media/'||pi.id ELSE '' END) image_url,
    CASE WHEN ce.entity_type='visual_symbol' THEN COALESCE(vs.svg_markup,'') ELSE '' END media_markup,
    CASE ce.entity_type
      WHEN 'flash_item' THEN CASE WHEN fi.item_type='sheet' THEN 'Flash sheet' ELSE 'Flash' END
      WHEN 'flash_series' THEN 'Flash series' WHEN 'special_project' THEN 'Special Project' WHEN 'special_project_series' THEN 'Special Project series' WHEN 'art_work' THEN 'Painting' WHEN 'portfolio_item' THEN 'Tattoo'
      WHEN 'merch_item' THEN COALESCE(NULLIF(mi.product_type,''),'Product') WHEN 'visual_symbol' THEN 'Legend symbol'
      WHEN 'archive_record' THEN COALESCE(NULLIF(ar.record_type,''),'Archive record') WHEN 'archive_collection' THEN 'Archive collection'
      WHEN 'archive_failed_experiment' THEN 'Failed experiment'
      WHEN 'archive_blackboard_fragment' THEN 'Blackboard fragment'
      WHEN 'construct_node' THEN 'Construct node' WHEN 'construct_pathway' THEN 'Pathway'
      WHEN 'person' THEN 'Person' WHEN 'organization' THEN COALESCE(NULLIF(aip.kind_label,''),'Organization') WHEN 'place' THEN 'Place' WHEN 'event' THEN 'Event' WHEN 'appearance' THEN 'Appearance' ELSE ce.entity_type END kind_label,
    CASE ce.entity_type
      WHEN 'art_work' THEN trim(COALESCE(aw.year,'')||CASE WHEN aw.year<>'' AND aw.medium<>'' THEN ' · ' ELSE '' END||COALESCE(aw.medium,''))
      WHEN 'portfolio_item' THEN trim(COALESCE(pi.year,'')||CASE WHEN pi.year<>'' AND pi.placement<>'' THEN ' · ' ELSE '' END||COALESCE(pi.placement,'')||CASE WHEN (pi.year<>'' OR pi.placement<>'') AND pi.primary_style<>'' THEN ' · ' ELSE '' END||COALESCE(pi.primary_style,''))
      WHEN 'flash_item' THEN trim(COALESCE(fi.size_bucket,'')||CASE WHEN fi.size_bucket<>'' AND fi.process_category<>'' THEN ' · ' ELSE '' END||COALESCE(fi.process_category,''))
      WHEN 'special_project' THEN CASE spc.profile WHEN 'experimental' THEN 'Experimental' ELSE 'Extended' END
      WHEN 'archive_record' THEN trim(COALESCE(ar.date_or_period,'')||CASE WHEN ar.date_or_period<>'' AND ar.room<>'' THEN ' · ' ELSE '' END||COALESCE(ar.room,''))
      WHEN 'event' THEN trim(COALESCE(ev.starts_at,'')||CASE WHEN ev.starts_at IS NOT NULL AND ev.starts_at<>'' AND ev.location<>'' THEN ' · ' ELSE '' END||COALESCE(ev.location,''))
      WHEN 'archive_failed_experiment' THEN trim(COALESCE(afe.result,'')||CASE WHEN afe.result<>'' AND afe.process_phase<>'' THEN ' / ' ELSE '' END||COALESCE(afe.process_phase,''))
      WHEN 'archive_blackboard_fragment' THEN COALESCE(NULLIF(abf.date_label,''),abf.occurred_at,'')
      WHEN 'place' THEN COALESCE(pl.public_location,'') ELSE '' END detail_label,
    COALESCE(cn.id,'') node_resolved_id,COALESCE(cn.name,'') node_name,COALESCE(cn.slug,'') node_slug,COALESCE(cn.color,'') node_color,
    COALESCE(fi.claimable,0) claimable,COALESCE(mi.shopify_handle,'') shopify_handle
  FROM content_entities ce
  LEFT JOIN flash_items fi ON ce.entity_type='flash_item' AND fi.id=ce.id
  LEFT JOIN flash_series fs ON ce.entity_type='flash_series' AND fs.id=ce.id
  LEFT JOIN special_project_calls spc ON ce.entity_type='special_project' AND spc.id=ce.id
  LEFT JOIN special_project_series sps ON ce.entity_type='special_project_series' AND sps.id=ce.id
  LEFT JOIN art_works aw ON ce.entity_type='art_work' AND aw.id=ce.id
  LEFT JOIN portfolio_items pi ON ce.entity_type='portfolio_item' AND pi.id=ce.id
  LEFT JOIN merch_items mi ON ce.entity_type='merch_item' AND mi.id=ce.id
  LEFT JOIN visual_symbols vs ON ce.entity_type='visual_symbol' AND vs.id=ce.id
  LEFT JOIN archive_records ar ON ce.entity_type='archive_record' AND ar.id=ce.id
  LEFT JOIN archive_collections ac ON ce.entity_type='archive_collection' AND ac.id=ce.id
  LEFT JOIN archive_failed_experiments afe ON ce.entity_type='archive_failed_experiment' AND afe.entity_id=ce.id
  LEFT JOIN archive_blackboard_fragments abf ON ce.entity_type='archive_blackboard_fragment' AND abf.id=ce.id
  LEFT JOIN archive_dossiers abfd ON abfd.entity_id=abf.record_entity_id
  LEFT JOIN construct_nodes own ON ce.entity_type='construct_node' AND own.id=ce.id
  LEFT JOIN construct_pathways cp ON ce.entity_type='construct_pathway' AND cp.id=ce.id
  LEFT JOIN people pe ON ce.entity_type='person' AND pe.id=ce.id
  LEFT JOIN organizations org ON ce.entity_type='organization' AND org.id=ce.id
  LEFT JOIN about_identity_profiles aip ON aip.organization_id=org.id
  LEFT JOIN places pl ON ce.entity_type='place' AND pl.id=ce.id
  LEFT JOIN events ev ON ce.entity_type='event' AND ev.id=ce.id
  LEFT JOIN artist_appearances app ON ce.entity_type='appearance' AND app.id=ce.id
  LEFT JOIN construct_nodes cn ON cn.id=CASE
    WHEN ce.entity_type='archive_failed_experiment' THEN CASE ce.node_id
      WHEN 'art' THEN 'node-art' WHEN 'merch' THEN 'node-merch' WHEN 'tattoos' THEN 'node-tattoos'
      WHEN 'film' THEN 'node-film' WHEN 'music' THEN 'node-music' WHEN 'writings' THEN 'node-writings'
      WHEN 'legend' THEN 'node-legend' ELSE 'node-archive' END
    WHEN ce.entity_type='visual_symbol' OR ce.node_id IN ('legend','visual-language','visual_language') THEN 'node-legend'
    WHEN ce.entity_type IN ('flash_item','flash_series','special_project','special_project_series','portfolio_item') OR ce.node_id IN ('tattoo','tattoos','tattooing') THEN 'node-tattoos'
    WHEN ce.entity_type='art_work' OR ce.node_id IN ('art','art-making') THEN 'node-art'
    WHEN ce.entity_type='merch_item' OR ce.node_id='merch' THEN 'node-merch'
    WHEN ce.entity_type='event' OR ce.node_id='events' THEN 'node-events'
    WHEN ce.entity_type LIKE 'archive_%' OR ce.node_id='archive' THEN 'node-archive'
    WHEN ce.entity_type='construct_node' THEN ce.id ELSE ce.node_id END
  WHERE ${where}`;
}

function presentEntity(row){
  if(!row)return null;const nodeId=row.node_resolved_id||canonicalNodeAlias(row.legacy_node_id,row.entity_type);const fallback=nodeFallback(nodeId);
  return {id:row.id,entityType:row.entity_type,title:row.title||row.id,state:row.state||row.visibility,visibility:row.visibility,route:row.route||"",canonical_route:row.route||"",canonicalRoute:row.route||"",imageUrl:row.image_url||"",mediaMarkup:row.media_markup||"",kindLabel:row.kind_label||row.entity_type,detailLabel:row.detail_label||"",claimable:Number(row.claimable||0),shopifyHandle:row.shopify_handle||"",node:{id:nodeId,name:row.node_name||fallback.name,slug:row.node_slug||fallback.slug,color:row.node_color||fallback.color}};
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
  if(request.method==="DELETE"&&relationshipId){const found=await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relationshipId).first();if(!found)return failure("Connection not found.",404);await database.prepare("DELETE FROM entity_relationships WHERE id=?").bind(relationshipId).run();for(const entityId of new Set([found.source_entity_id,found.target_entity_id]))await nextRevision(database,entityId,"relationship-delete",found,{deleted:true,relationship_id:relationshipId});return json({ok:true})}
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"){const valid=await validateRelationship(database,body);if(valid instanceof Response)return valid;const relId=id("relationship");await database.prepare("INSERT INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'studio',datetime('now'),datetime('now'))").bind(relId,valid.source,valid.target,valid.type,body.public_visible?1:0,text(body.internal_notes,5000),Number(body.sort_order)||0).run();const created=await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relId).first();for(const entityId of new Set([created.source_entity_id,created.target_entity_id]))await nextRevision(database,entityId,"relationship-create",null,created);return json({record:created},{status:201})}
  if(request.method==="PATCH"&&relationshipId){const before=await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relationshipId).first();if(!before)return failure("Connection not found.",404);const next={...before,...body};const valid=await validateRelationship(database,next,relationshipId);if(valid instanceof Response)return valid;try{await database.prepare("UPDATE entity_relationships SET source_entity_id=?,target_entity_id=?,relationship_type_id=?,public_visible=?,internal_notes=?,sort_order=?,updated_at=datetime('now') WHERE id=?").bind(valid.source,valid.target,valid.type,next.public_visible?1:0,text(next.internal_notes,5000),Number(next.sort_order)||0,relationshipId).run()}catch(error){if(/Failed experiment|detach/i.test(String(error?.message||error)))return failure("Remove or update the documented experiment state before changing this connection's endpoints.",409);throw error}const after=await database.prepare("SELECT * FROM entity_relationships WHERE id=?").bind(relationshipId).first();for(const entityId of new Set([before.source_entity_id,before.target_entity_id,after.source_entity_id,after.target_entity_id]))await nextRevision(database,entityId,"relationship-update",before,after);return json({record:after})}
  return failure("Method not allowed.",405);
}

async function publicArchiveCard(database,current){
  const row=await database.prepare(`SELECT ad.archive_slug,ad.state,
    COALESCE(cn.id,'') node_id,COALESCE(cn.name,'') node_name,COALESCE(cn.slug,'') node_slug,COALESCE(cn.color,'') node_color
    FROM archive_dossiers ad
    JOIN content_entities ce ON ce.id=ad.entity_id
    LEFT JOIN construct_nodes cn ON cn.id='node-archive'
    WHERE ad.entity_id=? AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
      AND ${archiveIdentityProfilePublicSql("ce")}
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
  const [relationshipResult,archiveCard,originThreadResult]=await Promise.all([
    database.prepare(`SELECT er.id,er.source_entity_id,er.target_entity_id,er.relationship_type_id,er.sort_order,
      rt.slug relationshipSlug,rt.forward_label,rt.reverse_label,
      state.id linked_state_id,version.id linked_state_version_id,state.state_roman linked_state_roman,state.title linked_state_title,
      state.variant_label linked_state_variant,catalogue.catalogue_id linked_state_catalogue_id
      FROM entity_relationships er
      JOIN relationship_types rt ON rt.id=er.relationship_type_id
      LEFT JOIN archive_failed_experiment_state_links failed_state ON failed_state.relationship_id=er.id
      LEFT JOIN archive_object_states state ON state.id=failed_state.state_id
        AND state.publication_state='published' AND state.public_visible=1
      LEFT JOIN archive_object_versions version ON version.id=state.version_id
        AND version.publication_state='published' AND version.public_visible=1
      LEFT JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=version.entity_id
      WHERE er.public_visible=1 AND rt.public_visible=1 AND (er.source_entity_id=? OR er.target_entity_id=?)
      ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId).all(),
    publicArchiveCard(database,current),
    database.prepare(`SELECT ot.id,ot.slug,ot.title,ot.summary,ote.is_primary,ote.sort_order
      FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id
      WHERE ote.entity_id=? AND ot.state='published' AND ot.public_visible=1
      ORDER BY ote.is_primary DESC,ote.sort_order,ot.sort_order,ot.title`).bind(entityId).all(),
  ]);
  const rows=relationshipResult.results||[];
  const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));const records=[];for(const row of rows){const outgoing=row.source_entity_id===entityId,related=entities.get(outgoing?row.target_entity_id:row.source_entity_id);if(!related||related.visibility!=="public"||!related.route)continue;const stateParts=[row.linked_state_catalogue_id,row.linked_state_roman?`State ${row.linked_state_roman}`:"",row.linked_state_title,row.linked_state_variant].filter(Boolean);records.push({id:row.id,direction:outgoing?"outgoing":"incoming",label:outgoing?row.forward_label:row.reverse_label,relationshipType:{id:row.relationship_type_id,slug:row.relationshipSlug},related,sortOrder:Number(row.sort_order||0),stateLink:row.linked_state_id&&row.linked_state_version_id?{id:row.linked_state_id,roman:row.linked_state_roman||"",title:row.linked_state_title||"",variant:row.linked_state_variant||"",catalogueId:row.linked_state_catalogue_id||"",label:stateParts.join(" / ")}:null})}
  const includesFailedExperiment=current.entityType==="archive_failed_experiment"||records.some(record=>record.related.entityType==="archive_failed_experiment");
  const originThreads=originThreadResult.results||[],primaryOriginThread=originThreads.find(thread=>Number(thread.is_primary))||null;
  return json({entity:current,records,archiveCard,originThreads,origin_threads:originThreads,primaryOriginThread,primary_origin_thread:primaryOriginThread,count:records.length,cardCount:records.length+originThreads.length+(archiveCard?1:0)},{cache:includesFailedExperiment?"no-store":"public, max-age=60"});
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
  const entity=await database.prepare("SELECT ce.entity_type,fi.state flash_state,afe.state failed_experiment_state,ar.state archive_state,ar.record_type archive_record_type FROM content_entities ce LEFT JOIN flash_items fi ON fi.id=ce.id AND ce.entity_type='flash_item' LEFT JOIN archive_failed_experiments afe ON afe.entity_id=ce.id AND ce.entity_type='archive_failed_experiment' LEFT JOIN archive_records ar ON ar.id=ce.id AND ce.entity_type='archive_record' WHERE ce.id=?").bind(entityId).first();
  if(!entity)return failure("Entity not found.",404);
  const isFlash=entity.entity_type==="flash_item",isMerch=entity.entity_type==="merch_item",isFailedExperiment=entity.entity_type==="archive_failed_experiment",isPractice=entity.entity_type==="archive_record"&&entity.archive_record_type==="practice",managedPrimary=isFlash||isMerch;
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
    if(managedPrimary&&!["primary","gallery"].includes(role))return failure(`${isFlash?"Flash":"Merch"} media must be primary or gallery artwork.`);
    if(isPractice&&!["primary","process-photo","process-video"].includes(role))return failure("Practice media must be a primary photograph, process photograph, or process video.");
    const mediaAsset=await database.prepare("SELECT *,state media_state,privacy media_privacy,public_presentation media_presentation FROM media_assets WHERE id=?").bind(b.media_id).first();
    if(!mediaAsset)return failure("Media not found.",404);
    if(isPractice&&((role==="process-video")!==String(mediaAsset.mime_type||"").startsWith("video/")))return failure(role==="process-video"?"The process-video role requires an MP4 or WebM file.":"Practice photographs require an image file.");
    if(isPractice&&entity.archive_state==="published"&&role==="primary"&&!eligibleFlashMedia({...mediaAsset,public_visible:publicVisible}))return failure("A published practice page needs an eligible public primary photograph.",409);
    if(isFlash&&role==="primary"&&PUBLIC_FLASH_STATES.has(entity.flash_state)&&!eligibleFlashMedia({...mediaAsset,public_visible:publicVisible}))return failure("A published Flash design needs an eligible public primary image.",409);
    if(isFailedExperiment&&entity.failed_experiment_state==="published"&&publicVisible){const projected={...mediaAsset,public_visible:1,resolved_alt_text:text(b.alt_text_override??mediaAsset.alt_text,1000),resolved_caption:text(b.caption_override??mediaAsset.caption,3000)};if(!failedExperimentMediaEligible(projected)||!failedExperimentMediaAccessible(projected))return failure("Published experiment evidence must be eligible and accessible.",409)}
    const cover=role==="gallery"&&!publicVisible?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,b.media_id).first():null;
    if(cover)return failure("Unpublish this tattoo or choose another public result image as its cover before hiding this attachment.",409);
    const statements=[];
    if((managedPrimary||isPractice)&&role==="primary")statements.push(database.prepare(`UPDATE entity_media SET role=CASE WHEN ?=1 THEN 'process-photo' ELSE 'gallery' END WHERE entity_id=? AND role='primary' AND media_id<>?`).bind(isPractice?1:0,entityId,b.media_id));
    statements.push(database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,b.media_id,role,Number(b.sort_order)||0,publicVisible,text(b.alt_text_override,1000),text(b.caption_override,3000)));
    if(isMerch&&role==="primary")statements.push(database.prepare("UPDATE merch_items SET image_url=?,alt_text=?,updated_at=datetime('now') WHERE id=?")
      .bind(`/api/construct/entity-media/${encodeURIComponent(b.media_id)}`,text(b.alt_text_override||mediaAsset.alt_text,1000),entityId));
    try{await database.batch(statements);}catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another public result image as its cover before hiding this attachment.",409);throw error;}
    if(isFailedExperiment)await syncFailedExperimentVisibility(database,entityId);
    return json({ok:true},{status:201});
  }
  const attachment=mediaId?await database.prepare(`SELECT em.*,m.state media_state,m.privacy media_privacy,m.public_presentation media_presentation,
    m.mime_type,m.alt_text,m.caption,m.public_title,m.public_description,m.transcript,
    COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) resolved_alt_text,
    COALESCE(NULLIF(em.caption_override,''),m.caption) resolved_caption
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
    if(managedPrimary&&!["primary","gallery"].includes(next.role))return failure(`${isFlash?"Flash":"Merch"} media must be primary or gallery artwork.`);
    if(isPractice&&!["primary","process-photo","process-video"].includes(next.role))return failure("Practice media must be a primary photograph, process photograph, or process video.");
    if(isPractice&&((next.role==="process-video")!==String(next.mime_type||"").startsWith("video/")))return failure(next.role==="process-video"?"The process-video role requires an MP4 or WebM file.":"Practice photographs require an image file.");
    if(isPractice&&entity.archive_state==="published"&&attachment.role==="primary"&&(next.role!=="primary"||!next.public_visible)){
      const replacement=await database.prepare(`SELECT 1 ok FROM entity_media em JOIN media_assets m ON m.id=em.media_id WHERE em.entity_id=? AND em.media_id<>? AND em.role='primary' AND em.public_visible=1 AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND m.mime_type LIKE 'image/%' LIMIT 1`).bind(entityId,mediaId).first();
      if(!replacement)return failure("A published practice page must keep an eligible primary photograph.",409);
    }
    if(isFailedExperiment&&entity.failed_experiment_state==="published"&&next.public_visible){
      const projected={...next,resolved_alt_text:text(next.alt_text_override||next.alt_text,1000),resolved_caption:text(next.caption_override||next.caption,3000)};
      if(!failedExperimentMediaEligible(projected)||!failedExperimentMediaAccessible(projected))return failure("Published experiment evidence must be eligible and accessible.",409);
    }
    const cover=next.role==="gallery"&&!next.public_visible?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,mediaId).first():null;
    if(cover)return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);
    if(isFlash&&PUBLIC_FLASH_STATES.has(entity.flash_state)){
      const projected=(await flashMediaRows(database,entityId)).map(row=>row.media_id===mediaId?next:(next.role==="primary"&&row.role==="primary"?{...row,role:"gallery"}:row));
      if(!projected.some(row=>row.role==="primary"&&eligibleFlashMedia(row)))return failure("A published Flash design must keep an eligible primary image.",409);
    }
    const statements=[];
    if((managedPrimary||isPractice)&&next.role==="primary")statements.push(database.prepare(`UPDATE entity_media SET role=CASE WHEN ?=1 THEN 'process-photo' ELSE 'gallery' END WHERE entity_id=? AND role='primary' AND media_id<>?`).bind(isPractice?1:0,entityId,mediaId));
    statements.push(database.prepare("UPDATE entity_media SET role=?,sort_order=?,public_visible=?,alt_text_override=?,caption_override=? WHERE entity_id=? AND media_id=?")
      .bind(next.role,next.sort_order,next.public_visible,next.alt_text_override,next.caption_override,entityId,mediaId));
    if(isMerch&&next.role==="primary")statements.push(database.prepare("UPDATE merch_items SET image_url=?,alt_text=?,updated_at=datetime('now') WHERE id=?")
      .bind(`/api/construct/entity-media/${encodeURIComponent(mediaId)}`,text(next.alt_text_override||next.alt_text,1000),entityId));
    try{await database.batch(statements);}catch(error){if(isPortfolioCoverGuardError(error))return failure("Unpublish this tattoo or choose another permitted result image as its cover before hiding this attachment.",409);throw error;}
    if(isFailedExperiment)await syncFailedExperimentVisibility(database,entityId);
    return json({record:await database.prepare("SELECT * FROM entity_media WHERE entity_id=? AND media_id=?").bind(entityId,mediaId).first()});
  }
  if(request.method==="DELETE"){
    if(isPractice&&entity.archive_state==="published"&&attachment.role==="primary")return failure("Return the practice page to draft before removing its primary photograph.",409);
    const portfolioCover=attachment.role==="gallery"?await database.prepare("SELECT id FROM portfolio_items WHERE id=? AND state='published' AND cover_image_ref=?").bind(entityId,mediaId).first():null;
    if(portfolioCover)return failure("Unpublish this tattoo or choose another permitted result image before removing its cover.",409);
    let promoted=null;
    if(managedPrimary&&attachment.role==="primary"){
      const rows=isFlash?await flashMediaRows(database,entityId):(await database.prepare(`SELECT em.*,m.alt_text,
        COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) resolved_alt_text
        FROM entity_media em JOIN media_assets m ON m.id=em.media_id
        WHERE em.entity_id=? AND em.public_visible=1 AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
          AND m.mime_type LIKE 'image/%' ORDER BY em.sort_order,em.created_at`).bind(entityId).all()).results||[];
      promoted=rows.find(row=>row.media_id!==mediaId&&row.role==="gallery"&&(!isFlash||!PUBLIC_FLASH_STATES.has(entity.flash_state)||eligibleFlashMedia(row)))||null;
    }
    if(isFlash&&PUBLIC_FLASH_STATES.has(entity.flash_state)&&attachment.role==="primary"&&!promoted)return failure("A published Flash design must keep an eligible primary image.",409);
    const statements=[database.prepare("DELETE FROM entity_media WHERE entity_id=? AND media_id=?").bind(entityId,mediaId)];
    if(promoted)statements.push(database.prepare("UPDATE entity_media SET role='primary',sort_order=1 WHERE entity_id=? AND media_id=?").bind(entityId,promoted.media_id));
    if(isMerch)statements.push(promoted
      ?database.prepare("UPDATE merch_items SET image_url=?,alt_text=?,updated_at=datetime('now') WHERE id=?").bind(`/api/construct/entity-media/${encodeURIComponent(promoted.media_id)}`,text(promoted.resolved_alt_text||promoted.alt_text,1000),entityId)
      :database.prepare("UPDATE merch_items SET image_url=CASE WHEN image_url=? THEN '' ELSE image_url END,updated_at=datetime('now') WHERE id=?").bind(`/api/construct/entity-media/${encodeURIComponent(mediaId)}`,entityId));
    await database.batch(statements);
    if(isFailedExperiment)await syncFailedExperimentVisibility(database,entityId);
    return json({ok:true,promoted_media_id:promoted?.media_id||null});
  }
  return failure("Method not allowed.",405);
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
  if(!owner?.id||["event","appearance","organization"].includes(owner.entity_type))return null;
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
    if(!catalogue)throw new ArchiveDossierEnsureError("A unique catalogue number could not be allocated. Try again.",409);
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

async function ensureArchiveEventStructure(database,owner){
  if(!["event","appearance"].includes(owner?.entity_type))return null;
  if(!await database.prepare("SELECT entity_id FROM archive_dossiers WHERE entity_id=?").bind(owner.id).first())return null;
  await database.prepare(`INSERT OR IGNORE INTO archive_event_identifiers(entity_id,event_number,event_id,created_by,updated_by,created_at,updated_at)
    SELECT ?,COALESCE(MAX(event_number),0)+1,'EVT-'||printf('%03d',COALESCE(MAX(event_number),0)+1),'studio','studio',datetime('now'),datetime('now')
    FROM archive_event_identifiers`).bind(owner.id).run();
  return database.prepare("SELECT * FROM archive_event_identifiers WHERE entity_id=?").bind(owner.id).first();
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
      JOIN archive_cultural_object_types cot ON cot.id=ace.object_type_id
      JOIN content_entities owner ON owner.id=ace.entity_id AND owner.entity_type<>'organization'
      WHERE ace.entity_id=?`).bind(entityId).first();
    return record?json({record:{...record,catalogue_label:archiveCatalogueLabel(record),catalogueLabel:archiveCatalogueLabel(record)}}):failure("Catalogue entry not found.",404);
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const before=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).first();
    const owner=await database.prepare(`SELECT ce.* FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id WHERE ad.entity_id=?`).bind(entityId).first();if(!owner)return failure("Dossier not found.",404);
    if(owner.entity_type==="organization"){
      await database.prepare("DELETE FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).run();
      return failure("Creative Identity organization dossiers do not receive cultural-object catalogue identities.",409);
    }
    const mediumId=text(body.medium_id??body.mediumId??before?.medium_id,80),objectTypeId=text(body.object_type_id??body.objectTypeId??before?.object_type_id,120);
    const type=await database.prepare("SELECT * FROM archive_cultural_object_types WHERE id=? AND medium_id=?").bind(objectTypeId,mediumId).first();
    if(!type)return failure("Choose a cultural object type that belongs to the selected medium.",409);
    const requestedCatalogueNumber=Math.floor(Number(body.catalogue_number??body.catalogueNumber));
    let catalogueNumber=Number(before?.catalogue_number)||0;
    if(!before)catalogueNumber=await nextArchiveCatalogueNumber(database,type.catalogue_prefix);
    if(before&&((requestedCatalogueNumber>0&&requestedCatalogueNumber!==Number(before.catalogue_number))||type.catalogue_prefix!==before.catalogue_prefix))return failure("Catalogue prefixes and sequence numbers are workflow-assigned. Use the re-identification action for a prefix change.",409);
    const hasCurrentState=Object.prototype.hasOwnProperty.call(body,"current_state_id")||Object.prototype.hasOwnProperty.call(body,"currentStateId");
    let currentStateId=hasCurrentState?text(body.current_state_id??body.currentStateId,200):text(before?.current_state_id,200);
    let currentVersion=Number(before?.current_version||1),currentState=archiveRoman(before?.current_state||"I")||"I",variantLabel=text(before?.variant_label,120);
    if(currentStateId){
      const selected=await database.prepare(`SELECT aos.id,aos.state_roman,aos.variant_label,aos.publication_state,aos.public_visible,aos.lead_material_id,
          aov.entity_id,aov.version_number,aov.publication_state version_publication,aov.public_visible version_public_visible,
          lead.state lead_state,lead.visibility lead_visibility,
          lead_media.state lead_media_state,lead_media.privacy lead_media_privacy,
          lead_media.public_presentation lead_public_presentation,lead_media.mime_type lead_mime_type
        FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
        LEFT JOIN archive_materials lead ON lead.id=aos.lead_material_id AND lead.state_id=aos.id
        LEFT JOIN media_assets lead_media ON lead_media.id=lead.media_id
        WHERE aos.id=? AND aov.entity_id=?`).bind(currentStateId,entityId).first();
      if(!selected)return failure("Choose a state that belongs to this cultural object.",409);
      if(selected.publication_state!=="published"||!Number(selected.public_visible)||selected.version_publication!=="published"||!Number(selected.version_public_visible))return failure("The current public condition must be a published, public version and state.",409);
      const currentSelectionChanged=hasCurrentState&&String(currentStateId||"")!==String(before?.current_state_id||"");
      if(currentSelectionChanged&&(!selected.lead_material_id||selected.lead_state!=="published"||selected.lead_visibility!=="public"||selected.lead_media_state!=="active"||selected.lead_media_privacy!=="public"||selected.lead_public_presentation!=="inline"||!/^(image|video)\//i.test(selected.lead_mime_type||"")))return failure("The current public condition needs an eligible public image or video lead.",409);
      currentVersion=Number(selected.version_number);currentState=archiveRoman(selected.state_roman);variantLabel=text(selected.variant_label,120);
    }else if(hasCurrentState){
      currentStateId=null;currentVersion=1;currentState="I";variantLabel="";
    }
    const catalogueId=`${type.catalogue_prefix}-${String(catalogueNumber).padStart(3,"0")}`;
    try{
      if(before)await database.prepare(`UPDATE archive_catalogue_entries SET medium_id=?,object_type_id=?,catalogue_prefix=?,catalogue_number=?,catalogue_id=?,current_version=?,current_state=?,variant_label=?,current_state_id=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(mediumId,objectTypeId,type.catalogue_prefix,catalogueNumber,catalogueId,currentVersion,currentState,variantLabel,currentStateId,entityId).run();
      else await database.prepare(`INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,variant_label,current_state_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(entityId,mediumId,objectTypeId,type.catalogue_prefix,catalogueNumber,catalogueId,currentVersion,currentState,variantLabel,currentStateId).run();
    }catch(error){const duplicate=/UNIQUE constraint failed/i.test(error.message);return failure(duplicate?"A catalogue number was assigned at the same time. Save again to allocate the next number.":error.message,duplicate?409:400)}
    try{await ensureArchiveEventStructure(database,owner);await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
    return archiveCatalogueAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
  }
  return failure("Method not allowed.",405);
}

async function archiveCatalogueReidentifyAdminApi(request,env,entityId=""){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const database=db(env),body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const owner=await database.prepare(`SELECT ce.id,ce.entity_type FROM archive_dossiers dossier JOIN content_entities ce ON ce.id=dossier.entity_id WHERE dossier.entity_id=?`).bind(entityId).first();
  if(!owner)return failure("Dossier not found.",404);
  if(owner.entity_type==="organization"){
    await database.prepare("DELETE FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).run();
    return failure("Creative Identity organization dossiers do not receive cultural-object catalogue identities.",409);
  }
  const before=await database.prepare("SELECT * FROM archive_catalogue_entries WHERE entity_id=?").bind(entityId).first();
  if(!before)return failure("Catalogue entry not found.",404);
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
  if(!["event","appearance"].includes(owner.entity_type))return failure("Event identifiers are available only for Event and Appearance records.",409);
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
  const publicationState=text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft";
  return {entity_id:text(body.entity_id??body.entityId??existing.entity_id,200),version_number:Math.floor(Number(body.version_number??body.versionNumber??existing.version_number??1)),title:text(body.title??existing.title,300),description:text(body.description??existing.description,5000),occurred_at:text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||"undated",date_label:text(body.date_label??body.dateLabel??existing.date_label,160),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,publication_state:publicationState,public_visible:publicationPublicFlag(publicationState)};
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
  const publicationState=text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft";
  return {version_id:text(body.version_id??body.versionId??existing.version_id,200),state_roman:archiveRoman(body.state_roman??body.stateRoman??existing.state_roman),state_order:Math.floor(Number(body.state_order??body.stateOrder??existing.state_order??1)),title:text(body.title??existing.title,300),description:text(body.description??existing.description,5000),variant_label:text(body.variant_label??body.variantLabel??existing.variant_label,120),occurred_at:text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||"undated",date_label:text(body.date_label??body.dateLabel??existing.date_label,160),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0,publication_state:publicationState,public_visible:publicationPublicFlag(publicationState),lead_material_id:text(body.lead_material_id??body.leadMaterialId??existing.lead_material_id,200)||null};
}

async function validateArchiveObjectState(database,record,stateId=""){
  if(!record.version_id||!record.state_roman||record.state_order<1||!ARCHIVE_DATE_PRECISIONS.has(record.date_precision)||!ARCHIVE_STATES.has(record.publication_state))return failure("A version, Roman numeral, positive order, valid date precision, and publication state are required.",409);
  const version=await database.prepare("SELECT * FROM archive_object_versions WHERE id=?").bind(record.version_id).first();if(!version)return failure("Version not found.",404);
  let lead=null;
  if(record.lead_material_id){
    lead=await database.prepare(`SELECT am.*,m.state media_state,m.privacy media_privacy,m.public_presentation,m.mime_type
      FROM archive_materials am LEFT JOIN media_assets m ON m.id=am.media_id WHERE am.id=?`).bind(record.lead_material_id).first();
    if(!lead||!stateId||lead.state_id!==stateId)return failure("The lead material must belong to this state.",409);
    if(!/^(image|video)\//i.test(lead.mime_type||""))return failure("A state lead must be an image or video Digital asset.",409);
  }
  if(record.publication_state==="published"&&record.public_visible){
    if(version.publication_state!=="published"||!Number(version.public_visible))return failure("Publish the parent version before publishing this state.",409);
    if(!stateId||!lead)return failure("Save the state as an internal draft, attach an eligible visual material, and choose it as the lead before publishing.",409);
    if(lead&&(lead.state!=="published"||lead.visibility!=="public"||lead.media_state!=="active"||lead.media_privacy!=="public"||lead.public_presentation!=="inline"))return failure("A public state lead must be a published public material with an eligible Digital asset.",409);
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
    if(current&&before.publication_state==="published"&&Number(before.public_visible)&&(record.publication_state!=="published"||!record.public_visible))return failure("Choose another current public condition before hiding this state.",409);
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

async function validateArchiveOwnerPublication(database,owner,state){
  if(state!=="published")return "";
  if(!["archive_record","organization"].includes(owner.entity_type))return owner.visibility==="public"?"":"Publish the item from its Studio editor before adding it to the public Archive.";
  if(owner.entity_type!=="archive_record")return "";
  const record=await database.prepare("SELECT * FROM archive_records WHERE id=?").bind(owner.id).first();
  if(!record)return "The Archive item attached to this dossier no longer exists.";
  if(record.record_type==="practice"){
    const sections=parseJson(record.practice_sections_json);
    if(!record.title||!record.slug||!record.summary||!Array.isArray(sections)||!sections.length)return "A practice page needs a title, slug, descriptor, and authored sections before publishing.";
    if(!await artHasEligiblePrimary(database,owner.id))return "Attach an eligible primary practice image before publishing.";
  }
  return "";
}

async function archiveOwnerPublicationStatements(database,owner,state){
  if(!["archive_record","organization"].includes(owner.entity_type))return[];
  const visible=state==="published",statements=[database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,archived_at=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(visible?"public":"internal",visible?1:0,state==="archived"?new Date().toISOString():null,visible?1:0,owner.id)];
  const resourceEntry=Object.entries(RESOURCE_CONFIG).find(([,config])=>config.entityType===owner.entity_type&&config.fields.includes("state"));
  if(resourceEntry&&resourceEntry[1].states.includes(state)){
    const [resource,config]=resourceEntry,record=await database.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(owner.id).first();
    statements.push(database.prepare(`UPDATE ${config.table} SET state=?,updated_at=datetime('now') WHERE id=?`).bind(state,owner.id));
    if(record&&resource==="archive")statements.push(searchSyncStatement(database,resource,{...record,state}));
  }
  return statements;
}

async function archiveDossierPublicationReview(database,entityId){
  const dossier=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();
  if(!dossier)return{entity_id:entityId,ready:false,status:"blocked",reason:"Archive dossier not found."};
  const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(entityId).first();
  if(!owner)return{entity_id:entityId,archive_slug:dossier.archive_slug,state:dossier.state,ready:false,status:"blocked",reason:"The item attached to this Archive record no longer exists."};
  const base={entity_id:entityId,entity_type:owner.entity_type,archive_slug:dossier.archive_slug,state:dossier.state};
  if(dossier.state==="published")return{...base,ready:true,status:"already-published",reason:"Already published."};
  if(dossier.state==="archived")return{...base,ready:false,status:"blocked",reason:"Restore this Archive dossier to Draft before bulk publishing."};
  if(owner.entity_type==="organization")return{...base,ready:false,status:"blocked",reason:"Publish this Creative Identity from its coordinated Studio editor."};
  const ownerPublicationProblem=await validateArchiveOwnerPublication(database,owner,"published");
  if(ownerPublicationProblem)return{...base,ready:false,status:"blocked",reason:ownerPublicationProblem};
  return{...base,ready:true,status:"ready",reason:"Ready to publish."};
}

function archiveBulkPublicationSummary(results){
  return results.reduce((summary,result)=>{
    summary.requested+=1;
    if(result.status==="ready")summary.ready+=1;
    else if(result.status==="published")summary.published+=1;
    else if(result.status==="already-published")summary.already_published+=1;
    else if(result.status==="failed")summary.failed+=1;
    else summary.blocked+=1;
    return summary;
  },{requested:0,ready:0,published:0,already_published:0,blocked:0,failed:0});
}

async function archiveDossierBulkPublicationApi(request,env){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const mode=text(body.mode,30)||"preflight";
  if(!["preflight","publish"].includes(mode))return failure("Mode must be preflight or publish.");
  const submittedIds=body.entity_ids??body.entityIds;
  if(!Array.isArray(submittedIds))return failure("entity_ids must be an array.");
  const entityIds=[...new Set(submittedIds.map(value=>text(value,200)).filter(Boolean))];
  if(!entityIds.length)return failure("Choose at least one Archive dossier.");
  if(entityIds.length>ARCHIVE_BULK_PUBLICATION_LIMIT)return failure(`Choose no more than ${ARCHIVE_BULK_PUBLICATION_LIMIT} Archive dossiers at once.`,409);
  const database=db(env),results=[];
  for(const entityId of entityIds){
    const review=await archiveDossierPublicationReview(database,entityId);
    if(mode==="preflight"||!review.ready||review.status==="already-published"){
      results.push(review);
      continue;
    }
    try{
      const before=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();
      const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(entityId).first();
      await ensureArchiveEventStructure(database,owner);
      await ensureArchiveCatalogueEntry(database,owner);
      await database.batch([
        database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(entityId),
        ...await archiveOwnerPublicationStatements(database,owner,"published"),
      ]);
      const after=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();
      await nextRevision(database,entityId,"archive-dossier-update",before,after);
      results.push({...review,state:"published",status:"published",reason:"Published."});
    }catch(error){
      console.error(JSON.stringify({message:"Bulk Archive dossier publication failed.",entityId,error:String(error?.message||error)}));
      results.push({...review,ready:false,status:"failed",reason:text(error?.message||error,1000)||"Publication failed."});
    }
  }
  return json({mode,results,summary:archiveBulkPublicationSummary(results)});
}

async function enrichArchiveDossierAdminCounts(database,rows){
  const entityIds=[...new Set(rows.map(row=>String(row.entity_id||"")).filter(Boolean))];
  if(!entityIds.length)return rows;
  const chunks=[];for(let index=0;index<entityIds.length;index+=80)chunks.push(entityIds.slice(index,index+80));
  const groupedResults=await Promise.all(chunks.flatMap(ids=>{const placeholders=ids.map(()=>"?").join(",");return[
    database.prepare(`SELECT dossier_entity_id entity_id,COUNT(*) count FROM archive_materials WHERE dossier_entity_id IN (${placeholders}) GROUP BY dossier_entity_id`).bind(...ids).all(),
    database.prepare(`SELECT entity_id,COUNT(*) count FROM entity_activity WHERE entity_id IN (${placeholders}) GROUP BY entity_id`).bind(...ids).all(),
  ]})),materialCounts=new Map(),activityCounts=new Map();
  groupedResults.forEach((result,index)=>{const counts=index%2?activityCounts:materialCounts;(result.results||[]).forEach(row=>counts.set(row.entity_id,Number(row.count)||0))});
  return rows.map(row=>({...row,material_count:materialCounts.get(row.entity_id)||0,activity_count:activityCounts.get(row.entity_id)||0}));
}

async function archiveDossiersAdminApi(request,env,entityId=""){
  const database=db(env);
  if(request.method==="GET"){
    const where=entityId?"ad.entity_id=?":"1=1",order=entityId?"ad.entity_id":`COALESCE(
      (SELECT MAX(identity_change.created_at) FROM archive_catalogue_identity_changes identity_change WHERE identity_change.entity_id=ad.entity_id),
      ace.created_at,aei.created_at,ad.created_at
    ) DESC,COALESCE(ace.catalogue_prefix,'EVT'),COALESCE(ace.catalogue_number,aei.event_number,0) DESC,ad.entity_id`;
    const statement=database.prepare(`${archiveEntitySql(where)} ORDER BY ${order}`);const result=entityId?await statement.bind(entityId).all():await statement.all();const countedRows=await enrichArchiveDossierAdminCounts(database,result.results||[]),records=countedRows.map(row=>({...row,...presentArchiveItem(row)}));
    if(entityId&&!records[0])return failure("Dossier not found.",404);
    if(entityId){
      const [originResult,contextResult,themeResult,versionResult,stateResult,documentationResult,collectionResult]=await database.batch([
        database.prepare(`SELECT ot.*,ote.is_primary,ote.sort_order assignment_sort_order FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id WHERE ote.entity_id=? ORDER BY ote.is_primary DESC,ote.sort_order,ot.title`).bind(entityId),
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
        database.prepare(`SELECT ac.*,adc.sort_order assignment_sort_order FROM archive_dossier_collections adc JOIN archive_collections ac ON ac.id=adc.collection_id WHERE adc.dossier_entity_id=? ORDER BY adc.sort_order,ac.name`).bind(entityId),
      ]);
      const originThreads=originResult.results||[],contextAssignments=contextResult.results||[],themes=themeResult.results||[],versions=versionResult.results||[],states=stateResult.results||[],documentation=(documentationResult.results||[]).map(presentArchiveDocumentation),collections=collectionResult.results||[];
      const enriched={...records[0],origin_threads:originThreads,origin_thread_ids:originThreads.map(thread=>thread.id),primary_origin_thread_id:originThreads.find(thread=>Number(thread.is_primary))?.id||"",context_assignments:contextAssignments,themes,theme_names:themes.map(theme=>theme.name),versions,states,documentation,collections,collection_ids:collections.map(collection=>collection.id)};
      return json({record:enriched,dossier:enriched,origin_threads:originThreads,context_assignments:contextAssignments,themes,versions,states,documentation,collections});
    }
    return json({records,count:records.length});
  }
  if(request.method==="POST"&&!entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const ownerId=text(body.entity_id||body.entityId,200);if(!ownerId)return failure("entity_id is required.");
    const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(ownerId).first();if(!owner)return failure("The item attached to this Archive record no longer exists.",404);if(!await archiveDossierEligibleOwner(database,owner))return failure("That item type is not eligible for an Archive record.",409);
    const archiveSlug=slug(body.archive_slug||body.archiveSlug||body.slug||ownerId);if(!archiveSlug)return failure("archive_slug is required.");const state=text(body.state,30)||"draft",publicVisible=publicationPublicFlag(state);if(!ARCHIVE_STATES.has(state))return failure("Invalid dossier state.");const ownerPublicationProblem=await validateArchiveOwnerPublication(database,owner,state);if(ownerPublicationProblem)return failure(ownerPublicationProblem,409);
    await database.batch([
      database.prepare(`INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,story_html,empty_materials_note,record_type,state,public_visible,featured,sort_order,published_at,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' AND ?=1 THEN datetime('now') ELSE NULL END,'studio','studio',datetime('now'),datetime('now'))`).bind(ownerId,archiveSlug,text(body.orientation,8000),text(body.story,50000),text(body.story_html,50000),text(body.empty_materials_note,3000)||"No process materials are public yet.",text(body.record_type,100)||archiveDossierRecordType(owner.entity_type),state,publicVisible,truthy(body.featured)?1:0,Number(body.sort_order)||0,state,publicVisible),
      ...await archiveOwnerPublicationStatements(database,owner,state),
    ]);
    try{await ensureArchiveEventStructure(database,owner);await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
    return archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,ownerId);
  }
  if(request.method==="PATCH"&&entityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();if(!before)return failure("Dossier not found.",404);const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(entityId).first();
    const next={archive_slug:slug(body.archive_slug??body.archiveSlug??body.slug??before.archive_slug),orientation:text(body.orientation??before.orientation,8000),story:text(body.story??before.story,50000),story_html:text(body.story_html??before.story_html,50000),empty_materials_note:text(body.empty_materials_note??before.empty_materials_note,3000),record_type:text(body.record_type??body.recordType??before.record_type,100),state:text(body.state??before.state,30),featured:body.featured===undefined?Number(before.featured):truthy(body.featured)?1:0,sort_order:Number(body.sort_order??before.sort_order)||0};
    next.public_visible=publicationPublicFlag(next.state);
    if(!next.archive_slug)return failure("archive_slug is required.");if(!ARCHIVE_STATES.has(next.state))return failure("Invalid dossier state.");if(!owner)return failure("The item attached to this Archive record no longer exists.",404);const ownerPublicationProblem=await validateArchiveOwnerPublication(database,owner,next.state);if(ownerPublicationProblem)return failure(ownerPublicationProblem,409);
    const hasCollectionUpdate=Object.prototype.hasOwnProperty.call(body,"collection_ids")||Object.prototype.hasOwnProperty.call(body,"collectionIds"),collectionIds=hasCollectionUpdate?archiveCollectionIds(body.collection_ids??body.collectionIds):[];
    await database.batch([
      database.prepare(`UPDATE archive_dossiers SET archive_slug=?,orientation=?,story=?,story_html=?,empty_materials_note=?,record_type=?,state=?,public_visible=?,featured=?,sort_order=?,published_at=CASE WHEN ?='published' AND ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`).bind(next.archive_slug,next.orientation,next.story,next.story_html,next.empty_materials_note,next.record_type,next.state,next.public_visible,next.featured,next.sort_order,next.state,next.public_visible,entityId),
      ...await archiveOwnerPublicationStatements(database,owner,next.state),
    ]);
    if(hasCollectionUpdate)try{await replaceDossierCollections(database,entityId,collectionIds)}catch(error){return failure(error.message,409)}
    try{
      await replaceArchiveContext(database,entityId,archiveContextAssignments(body.context_assignments??body.contextAssignments));
      await replaceArchiveThemes(database,entityId,body.theme_names??body.themeNames);
    }catch(error){return failure(error.message,409)}
    try{await ensureArchiveEventStructure(database,owner);await ensureArchiveCatalogueEntry(database,owner)}catch(error){return failure(error.message,409)}
    const after=await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(entityId).first();await nextRevision(database,entityId,"archive-dossier-update",before,after);return archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
  }
  if(request.method==="DELETE"&&entityId){const owner=await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(entityId).first();if(!owner)return failure("The item attached to this Archive record no longer exists.",404);await database.batch([database.prepare("UPDATE archive_dossiers SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(entityId),...await archiveOwnerPublicationStatements(database,owner,"archived")]);return json({ok:true});}
  return failure("Method not allowed.",405);
}

async function editableArchiveDossierAdminApi(request,env,entityId){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const database=db(env);
  let ensured;
  try{
    ensured=await ensureEditableArchiveDossier(database,entityId,{actor:"studio"});
  }catch(error){
    if(error instanceof ArchiveDossierEnsureError&&[404,409].includes(error.status))return failure(error.message,error.status);
    console.error(JSON.stringify({message:"Editable Archive dossier ensure failed.",entityId,error:String(error?.message||error)}));
    return failure("The Archive dossier could not be prepared.",500);
  }
  try{
    if(await archiveDossierEligibleOwner(database,ensured.owner)){
      await ensureArchiveEventStructure(database,ensured.owner);
      await ensureArchiveCatalogueEntry(database,ensured.owner);
    }
  }catch(error){
    if(error instanceof ArchiveDossierEnsureError&&error.status===409)return failure(error.message,409);
    console.error(JSON.stringify({message:"Editable Archive dossier structure failed.",entityId,error:String(error?.message||error)}));
    return failure("The Archive dossier could not be prepared.",500);
  }
  let detailResponse;
  try{
    detailResponse=await archiveDossiersAdminApi(new Request(request.url,{method:"GET",headers:request.headers}),env,entityId);
  }catch(error){
    console.error(JSON.stringify({message:"Editable Archive dossier detail load failed.",entityId,error:String(error?.message||error)}));
    return failure("The Archive dossier could not be prepared.",500);
  }
  if(!detailResponse.ok)return detailResponse;
  const payload=await detailResponse.json();
  return json({...payload,created:ensured.created},{status:ensured.created?201:200});
}

function normalizeArchiveMaterial(body,existing={}){
  const materialType=text(body.material_type??body.materialType??existing.material_type,80).replace(/_/g,"-").toLowerCase()||"note";
  const state=text(body.state??existing.state,30).toLowerCase()||"draft";
  const visibility=publicationVisibility(state);
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
    if(leadState.publication_state==="published"&&Number(leadState.public_visible)&&(material.state!=="published"||material.visibility!=="public"||!media||media.state!=="active"||media.privacy!=="public"||media.public_presentation!=="inline"))return failure("Choose another state lead before hiding or archiving this public material.",409);
  }
  if(material.state==="published"&&material.visibility==="public"){
    if(dossier.state!=="published"||!Number(dossier.public_visible)||dossier.canonical_visibility!=="public")return failure("Publish the Archive record before publishing this material.",409);
    if(media&&(media.state!=="active"||media.privacy!=="public"||media.public_presentation!=="inline"))return failure("The attached Digital asset must be active, public, and shown inline.",409);
  }
  return {dossier,media};
}

function archiveMaterialAdminSql(where="1=1"){
  return `SELECT am.*,m.original_filename,m.mime_type,m.byte_size,m.width,m.height,m.duration_seconds,m.source_url,m.storage_key,
    m.alt_text,m.caption media_caption,m.privacy media_privacy,m.state media_state,
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
  const publicationState=text(body.publication_state??body.publicationState??existing.publication_state,30)||"draft";
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
    visibility:publicationVisibility(publicationState),
    publication_state:publicationState,
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
    m.state media_state,m.public_title,m.public_description,m.public_presentation,
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
    if(dossier.state!=="published"||!Number(dossier.public_visible)||dossier.canonical_visibility!=="public")return failure("Publish the Archive record before publishing this source material.",409);
    const publicStates=stateRows.filter(state=>state.publication_state==="published"&&Number(state.public_visible)&&state.version_publication_state==="published"&&Number(state.version_public_visible));
    if(!publicStates.length)return failure("Link at least one published public state before publishing this source material.",409);
    if(!setId)return failure("Create the source material as a draft, add its entries, and then publish it.",409);
    const entries=(await database.prepare(`${archiveSourceEntryAdminSql("smse.source_material_set_id=? AND smse.public_included=1")}
      ORDER BY smse.sort_order,smse.created_at`).bind(setId).all()).results||[];
    if(!entries.length)return failure("Include at least one source entry before publishing.",409);
    const invalid=entries.find(entry=>entry.media_id&&(
      entry.media_state!=="active"||entry.media_privacy!=="public"
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
    SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now')
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
         visibility,publication_state,sort_order,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`)
        .bind(newId,record.dossier_entity_id,record.source_kind,record.board_entity_id,record.title,record.caption,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.visibility,record.publication_state,record.sort_order).run();
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
      if(owner?.dossier_state!=="published"||!Number(owner?.dossier_public)||owner?.canonical_visibility!=="public")return failure("Publish the Archive record before publishing this source material.",409);
      const stateRows=await archiveSourceMaterialStateRows(database,record.dossier_entity_id,stateIds);
      const publicStates=stateRows.filter(state=>state.publication_state==="published"&&Number(state.public_visible)&&state.version_publication_state==="published"&&Number(state.version_public_visible));
      if(!publicStates.length)return failure("Link at least one published public state before publishing this source material.",409);
      if(!(await database.prepare("SELECT 1 FROM archive_source_material_entries WHERE source_material_set_id=? AND public_included=1 LIMIT 1").bind(setId).first()))return failure("Include at least one correspondence or reference entry before publishing.",409);
      await prepareArchiveSourceMaterialMedia(database,setId);
      valid=await validateArchiveSourceMaterialSet(database,record,stateIds,setId);if(valid instanceof Response)return valid;
    }else if(valid instanceof Response)return valid;
    try{
      if(hasStateUpdate)await replaceArchiveSourceMaterialStates(database,setId,record.dossier_entity_id,stateIds);
      await database.prepare(`UPDATE archive_source_material_sets
        SET source_kind=?,board_entity_id=?,title=?,caption=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,
          visibility=?,publication_state=?,sort_order=?,updated_by='studio',updated_at=datetime('now')
        WHERE id=?`)
        .bind(record.source_kind,record.board_entity_id,record.title,record.caption,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.visibility,record.publication_state,record.sort_order,setId).run();
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
    surface_id:row.surface_id||null,
    surfaceId:row.surface_id||null,
    surface_slug:row.surface_slug||"",
    surfaceSlug:row.surface_slug||"",
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
    AND derivative.public_presentation='inline'
    AND master.state='active' AND master.privacy IN ('internal','private')
    AND master.public_presentation='hidden'`:"";
  return `SELECT ar.id entity_id,ar.title,ar.summary,ar.date_or_period,ar.state record_state,ar.updated_at,
      ad.archive_slug,ad.orientation,ad.state dossier_state,ad.public_visible dossier_public_visible,
      ace.catalogue_id,ace.catalogue_prefix,ace.catalogue_number,ace.current_state_id,
      aov.id version_id,aov.version_number current_version,
      aos.id state_id,aos.state_roman current_state,aos.variant_label catalogue_variant,aos.date_label,aos.occurred_at,
      am.id material_id,amsc.board_entity_id,abcs.surface_id,abs.slug surface_slug,
      derivative.id derivative_media_id,derivative.source_url derivative_source_url,
      derivative.mime_type derivative_mime_type,derivative.alt_text derivative_alt_text,
      derivative.width derivative_width,derivative.height derivative_height,
      derivative.state derivative_state,derivative.privacy derivative_privacy,
      derivative.public_presentation derivative_presentation,
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
    LEFT JOIN archive_blackboard_capture_surfaces abcs ON abcs.capture_entity_id=ar.id
    LEFT JOIN archive_blackboard_surfaces abs ON abs.id=abcs.surface_id
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

const BLACKBOARD_RELATIONSHIP_IDS=new Set(["rel-source-for","rel-study-for","rel-informed","rel-planning-for"]);

function presentBlackboardSurface(row){
  if(!row)return null;
  return {id:row.id,slug:row.slug,title:row.title,studio_location:row.studio_location,studioLocation:row.studio_location,
    wall_designation:row.wall_designation,wallDesignation:row.wall_designation,orientation_note:row.orientation_note,orientationNote:row.orientation_note,
    summary:row.summary||"",state:row.state,public_visible:Number(row.public_visible||0),publicVisible:Boolean(row.public_visible),
    route:`/archive/blackboards/${encodeURIComponent(row.slug)}/`,capture_count:Number(row.capture_count||0),captureCount:Number(row.capture_count||0),
    fragment_count:Number(row.fragment_count||0),fragmentCount:Number(row.fragment_count||0),updated_at:row.updated_at};
}

function blackboardSurfaceSql(publicOnly=false){
  const gates=publicOnly?"WHERE surface.state='published' AND surface.public_visible=1 AND ce.visibility='public'":"";
  return `SELECT surface.*,
    (SELECT COUNT(*) FROM archive_blackboard_capture_surfaces link WHERE link.surface_id=surface.id) capture_count,
    (SELECT COUNT(*) FROM archive_blackboard_fragments fragment WHERE fragment.surface_id=surface.id AND fragment.state<>'archived') fragment_count
    FROM archive_blackboard_surfaces surface JOIN content_entities ce ON ce.id=surface.id ${gates}`;
}

function publicBlackboardMedia(row){
  if(!row?.derivative_media_id)return null;
  return {id:row.derivative_media_id,url:blackboardMediaUrl({media_id:row.derivative_media_id,source_url:row.derivative_source_url}),
    alt_text:row.derivative_alt_text||row.title||"Blackboard image",mime_type:row.derivative_mime_type||"",
    width:Number(row.derivative_width||0)||null,height:Number(row.derivative_height||0)||null};
}

function blackboardElapsedDays(earlier,later){
  const a=Date.parse(earlier||""),b=Date.parse(later||"");
  return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/86400000):null;
}

async function publicBlackboardSurfaceDetail(database,slugValue){
  const surfaceRow=await database.prepare(`${blackboardSurfaceSql(true)} AND surface.slug=?`).bind(slugValue).first();
  if(!surfaceRow)return null;
  const surface=presentBlackboardSurface(surfaceRow);
  const captureRows=(await database.prepare(`${blackboardBoardSql(true)} AND abcs.surface_id=?
    ORDER BY COALESCE(aos.occurred_at,ar.date_or_period,ar.created_at),ar.created_at`).bind(surface.id).all()).results||[];
  const captures=captureRows.map(row=>presentBlackboardBoard(row));
  for(let index=0;index<captures.length;index++)captures[index].elapsed_days=index?blackboardElapsedDays(captureRows[index-1].occurred_at,captureRows[index].occurred_at):null;
  const contextRows=(await database.prepare(`SELECT item.*,derivative.source_url derivative_source_url,derivative.mime_type derivative_mime_type,
      derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height
    FROM archive_blackboard_surface_media item
    JOIN media_assets derivative ON derivative.id=item.derivative_media_id
    JOIN media_assets master ON master.id=item.master_media_id
    WHERE item.surface_id=? AND item.state='published' AND item.public_visible=1
      AND derivative.state='active' AND derivative.privacy='public' AND derivative.public_presentation='inline'
      AND master.state='active' AND master.privacy IN ('internal','private') AND master.public_presentation='hidden'
    ORDER BY item.sort_order,item.occurred_at,item.created_at`).bind(surface.id).all()).results||[];
  const fragmentRows=(await database.prepare(`SELECT fragment.*,derivative.source_url derivative_source_url,derivative.mime_type derivative_mime_type,
      derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height
    FROM archive_blackboard_fragments fragment
    JOIN content_entities ce ON ce.id=fragment.id
    JOIN media_assets derivative ON derivative.id=fragment.derivative_media_id
    LEFT JOIN media_assets master ON master.id=fragment.master_media_id
    WHERE fragment.surface_id=? AND fragment.state='published' AND fragment.public_visible=1 AND ce.visibility='public'
      AND derivative.state='active' AND derivative.privacy='public' AND derivative.public_presentation='inline'
      AND (fragment.master_media_id IS NULL OR (master.state='active' AND master.privacy IN ('internal','private') AND master.public_presentation='hidden'))
    ORDER BY CASE WHEN fragment.occurred_at IS NULL THEN 1 ELSE 0 END,fragment.occurred_at,fragment.sort_order,fragment.created_at`).bind(surface.id).all()).results||[];
  const fragments=[];
  for(const row of fragmentRows){
    const matches=(await database.prepare(`SELECT board.entity_id,board.title,board.date_label,board.occurred_at,board.archive_slug,board.catalogue_id,board.catalogue_prefix,board.catalogue_number
      FROM archive_blackboard_fragment_captures match
      JOIN (${blackboardBoardSql(true)}) board ON board.entity_id=match.capture_entity_id
      WHERE match.fragment_id=? ORDER BY match.sort_order,board.occurred_at`).bind(row.id).all()).results||[];
    const relationRows=(await database.prepare(`SELECT er.target_entity_id,rt.forward_label,rt.slug
      FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id
      JOIN content_entities target ON target.id=er.target_entity_id
      WHERE er.source_entity_id=? AND er.public_visible=1 AND rt.public_visible=1
        AND er.relationship_type_id IN ('rel-source-for','rel-study-for','rel-informed','rel-planning-for')
        AND target.visibility='public' ORDER BY er.sort_order,er.created_at`).bind(row.id).all()).results||[];
    const targets=await entityRecords(database,relationRows.map(item=>item.target_entity_id));
    const manifestations=relationRows.map(item=>({relationship:item.forward_label,relationshipSlug:item.slug,target:targets.get(item.target_entity_id)})).filter(item=>item.target?.route);
    const threads=(await database.prepare(`SELECT thread.id,thread.slug,thread.title,thread.summary
      FROM archive_origin_thread_entities member JOIN archive_origin_threads thread ON thread.id=member.thread_id
      WHERE member.entity_id=? AND thread.state='published' AND thread.public_visible=1
      ORDER BY member.is_primary DESC,member.sort_order,thread.sort_order`).bind(row.id).all()).results||[];
    fragments.push({id:row.id,slug:row.slug,title:row.title,caption:row.caption||"",body:row.body||"",date:row.date_label||row.occurred_at||"",
      occurred_at:row.occurred_at,image:publicBlackboardMedia(row),visible_in:matches.map(match=>presentBlackboardBoard(match)),visibleIn:matches.map(match=>presentBlackboardBoard(match)),manifestations,origin_threads:threads,originThreads:threads});
  }
  const contextMedia=contextRows.map(row=>({id:row.id,title:row.title||"Studio context",caption:row.caption||"",date:row.date_label||row.occurred_at||"",image:publicBlackboardMedia(row)}));
  return {surface,latest_capture:captures.at(-1)||null,latestCapture:captures.at(-1)||null,captures,context_media:contextMedia,contextMedia,fragments};
}

async function publicArchiveBlackboards(request,env,surfaceSlug=""){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  if(surfaceSlug){const detail=await publicBlackboardSurfaceDetail(database,surfaceSlug);return detail?json(detail):failure("Blackboard surface not found.",404)}
  const surfaceRows=(await database.prepare(`${blackboardSurfaceSql(true)} ORDER BY surface.sort_order,surface.title`).all()).results||[];
  const surfaces=[];
  for(const row of surfaceRows){
    const surface=presentBlackboardSurface(row);
    const latest=await database.prepare(`${blackboardBoardSql(true)} AND abcs.surface_id=? ORDER BY COALESCE(aos.occurred_at,ar.date_or_period,ar.created_at) DESC LIMIT 1`).bind(surface.id).first();
    surface.latest_capture=presentBlackboardBoard(latest);surface.latestCapture=surface.latest_capture;surfaces.push(surface);
  }
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
        AND owner_dossier.state='published' AND owner_dossier.public_visible=1 AND owner_entity.visibility='public'
        AND media.state='active' AND media.privacy='public' AND media.public_presentation='inline'
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
        AND media.state='active' AND media.privacy='public' AND media.public_presentation='inline'`),
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
  return json({surfaces,boards,fragments:[...grouped.values()],count:{surfaces:surfaces.length,boards:boards.length,fragments:grouped.size}});
}

async function archiveBlackboardsAdminRecord(database,entityId){
  const row=await database.prepare(`${blackboardBoardSql(false)} AND ar.id=?`).bind(entityId).first();
  return presentBlackboardBoard(row,true);
}

async function blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired=true}={}){
  if(!masterId)return failure("Choose an archival master.",409);
  if(derivativeRequired&&!derivativeId)return failure("Choose a public derivative.",409);
  if(derivativeId&&masterId===derivativeId)return failure("The master and derivative must be separate Digital assets.",409);
  const master=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(masterId).first();
  const derivative=derivativeId?await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(derivativeId).first():null;
  if(!master||(derivativeId&&!derivative))return failure("One of the selected Digital assets does not exist.",404);
  if(!RESUMABLE_UPLOAD_MIMES["archive-master"].has(String(master.mime_type||"").toLowerCase()))return failure("The archival master must be TIFF, JPEG, PNG, WebP, HEIC, or HEIF.",409);
  if(derivative&&!['image/jpeg','image/png','image/webp'].includes(String(derivative.mime_type||"").toLowerCase()))return failure("The public derivative must be JPEG, PNG, or WebP.",409);
  return {master,derivative};
}

async function prepareBlackboardMediaPair(database,masterId,derivativeId){
  const statements=[database.prepare("UPDATE media_assets SET state='active',privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(masterId)];
  if(derivativeId)statements.push(
    database.prepare(`INSERT OR IGNORE INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at) VALUES(?,?,'public-display','studio',datetime('now'),datetime('now'))`).bind(masterId,derivativeId),
    database.prepare("UPDATE media_assets SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(derivativeId),
  );
  await database.batch(statements);
}

async function blackboardSurfaceAdminPayload(database,surfaceId=""){
  const where=surfaceId?" AND surface.id=?":"";
  const statement=database.prepare(`${blackboardSurfaceSql(false)} WHERE 1=1${where} ORDER BY surface.sort_order,surface.title`);
  const rows=(surfaceId?await statement.bind(surfaceId).all():await statement.all()).results||[];
  const records=[];
  for(const row of rows){
    const surface=presentBlackboardSurface(row);
    const captures=(await database.prepare(`${blackboardBoardSql(false)} AND abcs.surface_id=? ORDER BY COALESCE(aos.occurred_at,ar.date_or_period,ar.created_at),ar.created_at`).bind(surface.id).all()).results.map(item=>presentBlackboardBoard(item,true));
    const context=(await database.prepare(`SELECT item.*,master.original_filename master_filename,master.mime_type master_mime_type,
      derivative.original_filename derivative_filename,derivative.mime_type derivative_mime_type
      FROM archive_blackboard_surface_media item JOIN media_assets master ON master.id=item.master_media_id
      LEFT JOIN media_assets derivative ON derivative.id=item.derivative_media_id WHERE item.surface_id=? ORDER BY item.sort_order,item.created_at`).bind(surface.id).all()).results||[];
    const fragments=(await database.prepare(`SELECT fragment.*,master.original_filename master_filename,derivative.original_filename derivative_filename,
      (SELECT COUNT(*) FROM archive_blackboard_fragment_captures match WHERE match.fragment_id=fragment.id) capture_match_count,
      (SELECT COUNT(*) FROM entity_relationships rel WHERE rel.source_entity_id=fragment.id AND rel.relationship_type_id IN ('rel-source-for','rel-study-for','rel-informed','rel-planning-for')) manifestation_count
      FROM archive_blackboard_fragments fragment LEFT JOIN media_assets master ON master.id=fragment.master_media_id
      LEFT JOIN media_assets derivative ON derivative.id=fragment.derivative_media_id WHERE fragment.surface_id=? AND fragment.state<>'archived'
      ORDER BY CASE WHEN fragment.occurred_at IS NULL THEN 1 ELSE 0 END,fragment.occurred_at,fragment.sort_order,fragment.created_at`).bind(surface.id).all()).results||[];
    for(const fragment of fragments){fragment.capture_ids=((await database.prepare("SELECT capture_entity_id FROM archive_blackboard_fragment_captures WHERE fragment_id=? ORDER BY sort_order").bind(fragment.id).all()).results||[]).map(item=>item.capture_entity_id)}
    records.push({...surface,captures,context_media:context,contextMedia:context,fragments});
  }
  return surfaceId?records[0]||null:records;
}

async function archiveBlackboardSurfacesAdminApi(request,env,surfaceId=""){
  const database=db(env);
  if(request.method==="GET"){const records=await blackboardSurfaceAdminPayload(database,surfaceId);if(surfaceId&&!records)return failure("Blackboard surface not found.",404);return json(surfaceId?{record:records,surface:records}:{records,surfaces:records,count:records.length})}
  if(request.method==="POST"&&!surfaceId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const title=text(body.title,300),surfaceSlug=slug(body.slug||title);if(!title||!surfaceSlug)return failure("A surface title and slug are required.",409);
    const newId=text(body.id,200)||id("blackboard-surface"),state=text(body.state,30)||"draft",publicVisible=state==="published"&&truthy(body.public_visible??body.publicVisible)?1:0;
    try{await database.batch([
      database.prepare(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_blackboard_surface','archive',?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,publicVisible?"public":"internal",publicVisible),
      database.prepare(`INSERT INTO archive_blackboard_surfaces(id,slug,title,studio_location,wall_designation,orientation_note,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'),CASE WHEN ?=1 THEN datetime('now') END)`).bind(newId,surfaceSlug,title,text(body.studio_location??body.studioLocation,200),text(body.wall_designation??body.wallDesignation,120),text(body.orientation_note??body.orientationNote,1000),text(body.summary,8000),state,publicVisible,Number(body.sort_order??body.sortOrder)||0,publicVisible),
    ])}catch(error){return failure(error.message,409)}
    return json({record:await blackboardSurfaceAdminPayload(database,newId)},{status:201});
  }
  if(request.method==="PATCH"&&surfaceId){
    const body=await readJson(request),before=await database.prepare("SELECT * FROM archive_blackboard_surfaces WHERE id=?").bind(surfaceId).first();if(!body)return failure("Send a JSON object.");if(!before)return failure("Blackboard surface not found.",404);
    const state=text(body.state??before.state,30),publicVisible=state==="published"&&(body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible))?1:0;
    await database.batch([
      database.prepare(`UPDATE archive_blackboard_surfaces SET slug=?,title=?,studio_location=?,wall_designation=?,orientation_note=?,summary=?,state=?,public_visible=?,sort_order=?,published_at=CASE WHEN ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(slug(body.slug??before.slug),text(body.title??before.title,300),text(body.studio_location??body.studioLocation??before.studio_location,200),text(body.wall_designation??body.wallDesignation??before.wall_designation,120),text(body.orientation_note??body.orientationNote??before.orientation_note,1000),text(body.summary??before.summary,8000),state,publicVisible,Number(body.sort_order??body.sortOrder??before.sort_order)||0,publicVisible,surfaceId),
      database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(publicVisible?"public":"internal",publicVisible,publicVisible,surfaceId),
    ]);
    return json({record:await blackboardSurfaceAdminPayload(database,surfaceId)});
  }
  return failure("Method not allowed.",405);
}

async function archiveBlackboardContextAdminApi(request,env,surfaceId,contextId=""){
  const database=db(env),surface=await database.prepare("SELECT * FROM archive_blackboard_surfaces WHERE id=?").bind(surfaceId).first();if(!surface)return failure("Blackboard surface not found.",404);
  const before=contextId?await database.prepare("SELECT * FROM archive_blackboard_surface_media WHERE id=? AND surface_id=?").bind(contextId,surfaceId).first():null;
  if(request.method==="POST"&&!contextId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const masterId=text(body.master_media_id??body.masterMediaId,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200)||null;
    const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:false});if(pair instanceof Response)return pair;
    const state=text(body.state,30)||"draft",publicVisible=state==="published"&&truthy(body.public_visible??body.publicVisible)&&derivativeId?1:0,newId=text(body.id,200)||id("blackboard-context");
    await prepareBlackboardMediaPair(database,masterId,derivativeId);
    await database.prepare(`INSERT INTO archive_blackboard_surface_media(id,surface_id,role,master_media_id,derivative_media_id,title,caption,occurred_at,date_precision,date_label,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,'context',?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,surfaceId,masterId,derivativeId,text(body.title,300),text(body.caption,5000),text(body.occurred_at??body.occurredAt,80)||null,text(body.date_precision??body.datePrecision,30)||(body.occurred_at||body.occurredAt?"exact":"undated"),text(body.date_label??body.dateLabel,160),state,publicVisible,Number(body.sort_order??body.sortOrder)||0).run();
    return json({record:await database.prepare("SELECT * FROM archive_blackboard_surface_media WHERE id=?").bind(newId).first()},{status:201});
  }
  if(request.method==="PATCH"&&before){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const masterId=text(body.master_media_id??body.masterMediaId??before.master_media_id,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId??before.derivative_media_id,200)||null;
    const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:false});if(pair instanceof Response)return pair;const state=text(body.state??before.state,30),publicVisible=state==="published"&&(body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible))&&derivativeId?1:0;
    await prepareBlackboardMediaPair(database,masterId,derivativeId);await database.prepare(`UPDATE archive_blackboard_surface_media SET master_media_id=?,derivative_media_id=?,title=?,caption=?,occurred_at=?,date_precision=?,date_label=?,state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(masterId,derivativeId,text(body.title??before.title,300),text(body.caption??before.caption,5000),text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null,text(body.date_precision??body.datePrecision??before.date_precision,30),text(body.date_label??body.dateLabel??before.date_label,160),state,publicVisible,Number(body.sort_order??body.sortOrder??before.sort_order)||0,contextId).run();
    return json({record:await database.prepare("SELECT * FROM archive_blackboard_surface_media WHERE id=?").bind(contextId).first()});
  }
  return failure("Method not allowed.",405);
}

async function archiveBlackboardFragmentsAdminApi(request,env,surfaceId,fragmentId="",action=""){
  const database=db(env),surface=await database.prepare("SELECT * FROM archive_blackboard_surfaces WHERE id=?").bind(surfaceId).first();if(!surface)return failure("Blackboard surface not found.",404);
  const before=fragmentId?await database.prepare("SELECT * FROM archive_blackboard_fragments WHERE id=? AND surface_id=?").bind(fragmentId,surfaceId).first():null;
  if(request.method==="POST"&&!fragmentId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const title=text(body.title,300),fragmentSlug=slug(body.slug||title);if(!title||!fragmentSlug)return failure("A fragment title and slug are required.",409);
    const masterId=text(body.master_media_id??body.masterMediaId,200)||null,derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200)||null;if(masterId||derivativeId){const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:true});if(pair instanceof Response)return pair;await prepareBlackboardMediaPair(database,masterId,derivativeId)}
    const state=text(body.state,30)||"draft",publicVisible=state==="published"&&truthy(body.public_visible??body.publicVisible)&&derivativeId?1:0,newId=text(body.id,200)||id("blackboard-fragment");
    try{await database.batch([
      database.prepare(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_blackboard_fragment','archive',?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,publicVisible?"public":"internal",publicVisible),
      database.prepare(`INSERT INTO archive_blackboard_fragments(id,surface_id,slug,title,caption,body,master_media_id,derivative_media_id,occurred_at,date_precision,date_label,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'),CASE WHEN ?=1 THEN datetime('now') END)`).bind(newId,surfaceId,fragmentSlug,title,text(body.caption,5000),text(body.body,20000),masterId,derivativeId,text(body.occurred_at??body.occurredAt,80)||null,text(body.date_precision??body.datePrecision,30)||(body.occurred_at||body.occurredAt?"exact":"undated"),text(body.date_label??body.dateLabel,160),state,publicVisible,Number(body.sort_order??body.sortOrder)||0,publicVisible),
    ])}catch(error){return failure(error.message,409)}return json({record:await database.prepare("SELECT * FROM archive_blackboard_fragments WHERE id=?").bind(newId).first()},{status:201});
  }
  if(request.method==="PUT"&&before&&action==="captures"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const captureIds=[...new Set((body.capture_ids??body.captureIds??[]).map(value=>text(value,200)).filter(Boolean))];
    if(captureIds.length){const valid=(await database.prepare(`SELECT capture_entity_id id FROM archive_blackboard_capture_surfaces WHERE surface_id=? AND capture_entity_id IN (${captureIds.map(()=>"?").join(",")})`).bind(surfaceId,...captureIds).all()).results||[];if(valid.length!==captureIds.length)return failure("Every Visible in capture must belong to this surface.",409)}
    await database.batch([database.prepare("DELETE FROM archive_blackboard_fragment_captures WHERE fragment_id=?").bind(fragmentId),...captureIds.map((captureId,index)=>database.prepare("INSERT INTO archive_blackboard_fragment_captures(fragment_id,capture_entity_id,sort_order,created_by,created_at) VALUES(?,?,?,'studio',datetime('now'))").bind(fragmentId,captureId,index+1))]);return json({ok:true,capture_ids:captureIds});
  }
  if(request.method==="PATCH"&&before){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const masterId=text(body.master_media_id??body.masterMediaId??before.master_media_id,200)||null,derivativeId=text(body.derivative_media_id??body.derivativeMediaId??before.derivative_media_id,200)||null;if(masterId||derivativeId){const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:true});if(pair instanceof Response)return pair;await prepareBlackboardMediaPair(database,masterId,derivativeId)}
    const state=text(body.state??before.state,30),requestedPublic=body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible),publicVisible=state==="published"&&requestedPublic&&derivativeId?1:0;
    await database.batch([
      database.prepare(`UPDATE archive_blackboard_fragments SET slug=?,title=?,caption=?,body=?,master_media_id=?,derivative_media_id=?,occurred_at=?,date_precision=?,date_label=?,state=?,public_visible=?,sort_order=?,published_at=CASE WHEN ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?`).bind(slug(body.slug??before.slug),text(body.title??before.title,300),text(body.caption??before.caption,5000),text(body.body??before.body,20000),masterId,derivativeId,text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null,text(body.date_precision??body.datePrecision??before.date_precision,30),text(body.date_label??body.dateLabel??before.date_label,160),state,publicVisible,Number(body.sort_order??body.sortOrder??before.sort_order)||0,publicVisible,fragmentId),
      database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(publicVisible?"public":"internal",publicVisible,publicVisible,fragmentId),
    ]);return json({record:await database.prepare("SELECT * FROM archive_blackboard_fragments WHERE id=?").bind(fragmentId).first()});
  }
  return failure("Method not allowed.",405);
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
    const surfaceId=text(body.surface_id??body.surfaceId,200);if(!surfaceId)return failure("surface_id is required for every Blackboard capture.",409);
    if(!await database.prepare("SELECT id FROM archive_blackboard_surfaces WHERE id=? AND state<>'archived'").bind(surfaceId).first())return failure("Choose an active Blackboard surface.",409);
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
        database.prepare(`INSERT INTO archive_source_material_sets(id,dossier_entity_id,source_kind,board_entity_id,title,caption,occurred_at,date_precision,date_label,visibility,publication_state,sort_order,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,'blackboard',?,'Complete blackboard scan','',?,?,?,'internal','draft',1,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(setId,recordId,recordId,occurredAt,datePrecision,dateLabel),
        database.prepare(`INSERT INTO archive_source_material_states(source_material_set_id,state_id,document_reference,sort_order,created_at)
          VALUES(?,?,'D01',1,datetime('now'))`).bind(setId,stateId),
        database.prepare(`INSERT INTO archive_blackboard_capture_surfaces(capture_entity_id,surface_id,sort_order,created_by,created_at,updated_at)
          VALUES(?,?,?,'studio',datetime('now'),datetime('now'))`).bind(recordId,surfaceId,Number(body.sort_order??body.sortOrder)||0),
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
    if(!RESUMABLE_UPLOAD_MIMES["archive-master"].has(String(master.mime_type||"").toLowerCase()))return failure("The archival master must be TIFF, JPEG, PNG, WebP, HEIC, or HEIF.",409);
    if(master.privacy!=="internal"||master.public_presentation!=="hidden")return failure("The archival master must remain internal and hidden.",409);
    if(!["image/jpeg","image/png","image/webp"].includes(String(derivative.mime_type||"").toLowerCase()))return failure("The public derivative must be JPEG, PNG, or WebP.",409);
    const materialId=board.material_id||id("archive-material"),entryId=id("archive-source-entry");
    const statements=[
      database.prepare(`INSERT OR IGNORE INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
        VALUES(?,?,'public-display','studio',datetime('now'),datetime('now'))`).bind(masterId,derivativeId),
      database.prepare(`UPDATE media_assets SET state='active',privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?`).bind(masterId),
      database.prepare(`UPDATE media_assets SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?`).bind(derivativeId),
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
    if(row.derivative_state!=="active"||row.derivative_privacy!=="public"||row.derivative_presentation!=="inline")return failure("Prepare the web derivative as an active, public, inline Digital asset before publishing.",409);
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
      database.prepare("UPDATE archive_source_material_sets SET publication_state='published',visibility='public',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(row.source_material_set_id),
      database.prepare("UPDATE media_assets SET state='active',privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(row.derivative_media_id),
      database.prepare("UPDATE media_assets SET state='active',privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(row.master_media_id),
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

// Blackboard record/state model. The earlier surface/capture implementation is
// retained above only so migration 0176 can interpret already-created local
// data; all current routes use the record model below.
function blackboardStateRoman(order){
  const values=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];
  return values[order]||String(order);
}

function blackboardRecordSqlV2(publicOnly=false){
  const gates=publicOnly?` AND ce.visibility='public' AND ar.state='published' AND ad.state='published' AND ad.public_visible=1
    AND current_version.publication_state='published' AND current_version.public_visible=1
    AND current_state.publication_state='published' AND current_state.public_visible=1`:"";
  return `SELECT profile.record_entity_id entity_id,profile.studio_location,profile.wall_designation,profile.orientation_note,profile.sort_order,
      ar.title,ar.summary,ar.body,ar.date_or_period,ar.state record_state,ar.updated_at,
      ad.archive_slug,ad.orientation,ad.story,ad.state dossier_state,ad.public_visible dossier_public_visible,
      catalogue.catalogue_id,catalogue.catalogue_prefix,catalogue.catalogue_number,catalogue.current_version,catalogue.current_state,catalogue.current_state_id,
      current_version.id current_version_id,current_state.title current_state_title,current_state.occurred_at current_occurred_at,
      current_state.date_label current_date_label,current_state.lead_material_id current_lead_material_id,
      lead.media_id derivative_media_id,derivative.source_url derivative_source_url,derivative.mime_type derivative_mime_type,
      derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height,
      pair.master_media_id,master.privacy master_privacy,master.public_presentation master_presentation,
      (SELECT COUNT(*) FROM archive_object_states state_count JOIN archive_object_versions version_count ON version_count.id=state_count.version_id
        WHERE version_count.entity_id=profile.record_entity_id AND state_count.publication_state<>'archived') state_count,
      (SELECT COUNT(*) FROM archive_blackboard_fragments fragment WHERE fragment.record_entity_id=profile.record_entity_id AND fragment.state<>'archived') fragment_count
    FROM archive_blackboard_records profile
    JOIN archive_records ar ON ar.id=profile.record_entity_id AND ar.record_type='blackboard'
    JOIN content_entities ce ON ce.id=ar.id
    JOIN archive_dossiers ad ON ad.entity_id=ar.id AND ad.record_type='blackboard'
    JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=ar.id AND catalogue.object_type_id='other-blackboard'
    JOIN archive_object_states current_state ON current_state.id=catalogue.current_state_id
    JOIN archive_object_versions current_version ON current_version.id=current_state.version_id
    LEFT JOIN archive_materials lead ON lead.id=current_state.lead_material_id
    LEFT JOIN media_assets derivative ON derivative.id=lead.media_id
    LEFT JOIN media_asset_variants pair ON pair.derivative_media_id=derivative.id AND pair.purpose='public-display'
    LEFT JOIN media_assets master ON master.id=pair.master_media_id
    WHERE 1=1${gates}`;
}

function presentBlackboardRecordV2(row,admin=false){
  if(!row)return null;
  const record={id:row.entity_id,entity_id:row.entity_id,entityId:row.entity_id,slug:row.archive_slug,title:row.title,
    summary:row.summary||row.orientation||"",studio_location:row.studio_location,studioLocation:row.studio_location,
    wall_designation:row.wall_designation,wallDesignation:row.wall_designation,orientation_note:row.orientation_note,orientationNote:row.orientation_note,
    catalogue_id:row.catalogue_id,catalogueId:row.catalogue_id,catalogue_label:`${row.catalogue_id}.${row.current_version}/${row.current_state}`,
    catalogueLabel:`${row.catalogue_id}.${row.current_version}/${row.current_state}`,current_version:Number(row.current_version)||1,currentVersion:Number(row.current_version)||1,
    current_state:row.current_state,currentState:row.current_state,current_state_id:row.current_state_id,currentStateId:row.current_state_id,
    state_count:Number(row.state_count||0),stateCount:Number(row.state_count||0),fragment_count:Number(row.fragment_count||0),fragmentCount:Number(row.fragment_count||0),
    route:`/archive/blackboards/${encodeURIComponent(row.archive_slug)}/`,record_route:`/archive/records/${encodeURIComponent(row.archive_slug)}/`,
    recordRoute:`/archive/records/${encodeURIComponent(row.archive_slug)}/`,updated_at:row.updated_at};
  if(admin)Object.assign(record,{state:row.record_state,dossier_state:row.dossier_state,public_visible:Number(row.dossier_public_visible||0),
    publicVisible:Boolean(row.dossier_public_visible),sort_order:Number(row.sort_order||0)});
  return record;
}

async function blackboardStateRowsV2(database,recordId,publicOnly=false){
  const gates=publicOnly?` AND version.publication_state='published' AND version.public_visible=1
    AND object_state.publication_state='published' AND object_state.public_visible=1
    AND material.state='published' AND material.visibility='public'
    AND derivative.state='active' AND derivative.privacy='public' AND derivative.public_presentation='inline'
    AND master.state='active' AND master.privacy IN ('internal','private') AND master.public_presentation='hidden'`:"";
  const rows=(await database.prepare(`SELECT object_state.*,version.entity_id,version.version_number,version.title version_title,
      version.publication_state version_publication_state,version.public_visible version_public_visible,
      material.id material_id,material.title material_title,material.caption material_caption,
      derivative.id derivative_media_id,derivative.source_url derivative_source_url,derivative.mime_type derivative_mime_type,
      derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height,
      pair.master_media_id,master.original_filename master_filename,derivative.original_filename derivative_filename
    FROM archive_object_versions version
    JOIN archive_object_states object_state ON object_state.version_id=version.id
    LEFT JOIN archive_materials material ON material.id=object_state.lead_material_id
    LEFT JOIN media_assets derivative ON derivative.id=material.media_id
    LEFT JOIN media_asset_variants pair ON pair.derivative_media_id=derivative.id AND pair.purpose='public-display'
    LEFT JOIN media_assets master ON master.id=pair.master_media_id
    WHERE version.entity_id=? AND object_state.publication_state<>'archived'${gates}
    ORDER BY version.sort_order,version.version_number,object_state.sort_order,object_state.state_order`).bind(recordId).all()).results||[];
  const states=rows.map(row=>{
    const state={id:row.id,state_id:row.id,stateId:row.id,version_id:row.version_id,versionId:row.version_id,
      version_number:Number(row.version_number)||1,versionNumber:Number(row.version_number)||1,state_roman:row.state_roman,stateRoman:row.state_roman,
      state_order:Number(row.state_order)||0,title:row.title||`State ${row.state_roman}`,description:row.description||"",
      occurred_at:row.occurred_at,occurredAt:row.occurred_at,date_label:row.date_label||row.occurred_at||"",dateLabel:row.date_label||row.occurred_at||"",
      catalogue_label:"",catalogueLabel:"",scan:publicBlackboardMedia(row),publication_state:row.publication_state,public_visible:Number(row.public_visible||0)};
    if(!publicOnly)Object.assign(state,{material_id:row.material_id||null,master_media_id:row.master_media_id||null,derivative_media_id:row.derivative_media_id||null,
      master_filename:row.master_filename||"",derivative_filename:row.derivative_filename||""});
    return state;
  });
  const catalogue=await database.prepare("SELECT catalogue_id FROM archive_catalogue_entries WHERE entity_id=?").bind(recordId).first();
  for(let index=0;index<states.length;index++){
    const state=states[index];state.catalogue_label=`${catalogue?.catalogue_id||"OBJ"}.${state.version_number}/${state.state_roman}`;state.catalogueLabel=state.catalogue_label;
    state.elapsed_days=index?blackboardElapsedDays(states[index-1].occurred_at,state.occurred_at):null;state.elapsedDays=state.elapsed_days;
  }
  return states;
}

async function blackboardNotebookRowsV2(database,recordId,publicOnly=false){
  const gates=publicOnly?` AND material.state='published' AND material.visibility='public'
    AND derivative.state='active' AND derivative.privacy='public' AND derivative.public_presentation='inline'
    AND master.state='active' AND master.privacy IN ('internal','private') AND master.public_presentation='hidden'`:"";
  const rows=(await database.prepare(`SELECT material.*,derivative.id derivative_media_id,derivative.source_url derivative_source_url,
      derivative.mime_type derivative_mime_type,derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height,
      pair.master_media_id,master.original_filename master_filename,derivative.original_filename derivative_filename
    FROM archive_materials material
    JOIN media_assets derivative ON derivative.id=material.media_id
    JOIN media_asset_variants pair ON pair.derivative_media_id=derivative.id AND pair.purpose='public-display'
    JOIN media_assets master ON master.id=pair.master_media_id
    WHERE material.dossier_entity_id=? AND material.state_id IS NULL AND material.role='notebook'${gates}
    ORDER BY CASE WHEN material.occurred_at IS NULL THEN 1 ELSE 0 END,material.occurred_at,material.sort_order,material.created_at`).bind(recordId).all()).results||[];
  return rows.map(row=>{
    const item={id:row.id,title:row.title||"Notebook entry",caption:row.caption||"",body:row.body||"",date:row.date_label||row.occurred_at||"",
      occurred_at:row.occurred_at,occurredAt:row.occurred_at,image:publicBlackboardMedia(row),state:row.state,visibility:row.visibility};
    if(!publicOnly)Object.assign(item,{master_media_id:row.master_media_id,derivative_media_id:row.derivative_media_id,master_filename:row.master_filename,derivative_filename:row.derivative_filename});
    return item;
  });
}

async function blackboardFragmentsV2(database,recordId,states,publicOnly=false){
  if(!publicOnly)return blackboardFragmentAdminRecordsV3(database,{recordId,states});
  const gates=publicOnly?` AND fragment.state='published' AND fragment.public_visible=1 AND ce.visibility='public'
    AND derivative.state='active' AND derivative.privacy='public' AND derivative.public_presentation='inline'
    AND (fragment.master_media_id IS NULL OR (master.state='active' AND master.privacy IN ('internal','private') AND master.public_presentation='hidden'))
    AND EXISTS(
      SELECT 1 FROM archive_blackboard_fragment_states public_link
      JOIN archive_blackboard_fragment_placements public_placement ON public_placement.fragment_id=public_link.fragment_id AND public_placement.state_id=public_link.state_id
      JOIN archive_object_states public_state ON public_state.id=public_link.state_id
      JOIN archive_object_versions public_version ON public_version.id=public_state.version_id
      WHERE public_link.fragment_id=fragment.id AND public_version.entity_id=fragment.record_entity_id
        AND public_state.publication_state='published' AND public_state.public_visible=1
        AND public_version.publication_state='published' AND public_version.public_visible=1
    )`:" AND fragment.state<>'archived'";
  const rows=(await database.prepare(`SELECT fragment.*,derivative.source_url derivative_source_url,derivative.mime_type derivative_mime_type,
      derivative.alt_text derivative_alt_text,derivative.width derivative_width,derivative.height derivative_height,
      master.original_filename master_filename,derivative.original_filename derivative_filename
    FROM archive_blackboard_fragments fragment JOIN content_entities ce ON ce.id=fragment.id
    LEFT JOIN media_assets derivative ON derivative.id=fragment.derivative_media_id
    LEFT JOIN media_assets master ON master.id=fragment.master_media_id
    WHERE fragment.record_entity_id=?${gates}
    ORDER BY CASE WHEN fragment.occurred_at IS NULL THEN 1 ELSE 0 END,fragment.occurred_at,fragment.sort_order,fragment.created_at`).bind(recordId).all()).results||[];
  const stateMap=new Map(states.map(state=>[state.id,state])),fragments=[];
  for(const row of rows){
    const stateLinks=(await database.prepare(`SELECT link.state_id,placement.x_percent,placement.y_percent,
        placement.width_percent,placement.height_percent,placement.sort_order placement_sort_order,
        placement.hotspot_mask_media_id,hotspot_mask.source_url hotspot_mask_source_url,
        hotspot_mask.mime_type hotspot_mask_mime_type,hotspot_mask.width hotspot_mask_width,hotspot_mask.height hotspot_mask_height,
        hotspot_mask.state hotspot_mask_state,hotspot_mask.privacy hotspot_mask_privacy,
        hotspot_mask.public_presentation hotspot_mask_presentation
      FROM archive_blackboard_fragment_states link
      LEFT JOIN archive_blackboard_fragment_placements placement ON placement.fragment_id=link.fragment_id AND placement.state_id=link.state_id
      LEFT JOIN media_assets hotspot_mask ON hotspot_mask.id=placement.hotspot_mask_media_id
      WHERE link.fragment_id=? ORDER BY link.sort_order,link.created_at`).bind(row.id).all()).results||[];
    let manifestations=[],threads=[];
    if(publicOnly){
      const relationRows=(await database.prepare(`SELECT er.target_entity_id,rt.forward_label,rt.slug FROM entity_relationships er
        JOIN relationship_types rt ON rt.id=er.relationship_type_id JOIN content_entities target ON target.id=er.target_entity_id
        WHERE er.source_entity_id=? AND er.public_visible=1 AND rt.public_visible=1
          AND er.relationship_type_id IN ('rel-source-for','rel-study-for','rel-informed','rel-planning-for') AND target.visibility='public'
        ORDER BY er.sort_order,er.created_at`).bind(row.id).all()).results||[];
      const targets=await entityRecords(database,relationRows.map(item=>item.target_entity_id));
      manifestations=relationRows.map(item=>({relationship:item.forward_label,relationshipSlug:item.slug,target:targets.get(item.target_entity_id)})).filter(item=>item.target?.route);
      threads=(await database.prepare(`SELECT thread.id,thread.slug,thread.title,thread.summary FROM archive_origin_thread_entities member
        JOIN archive_origin_threads thread ON thread.id=member.thread_id WHERE member.entity_id=? AND thread.state='published' AND thread.public_visible=1
        ORDER BY member.is_primary DESC,member.sort_order,thread.sort_order`).bind(row.id).all()).results||[];
    }
    const publicLinks=stateLinks.filter(link=>stateMap.has(link.state_id)),visible=publicLinks.map(link=>stateMap.get(link.state_id)).filter(Boolean),placements=publicLinks.filter(link=>link.x_percent!==null&&link.x_percent!==undefined).map(link=>{
      const maskEligible=Boolean(link.hotspot_mask_media_id&&link.hotspot_mask_state==="active"&&link.hotspot_mask_privacy==="public"&&link.hotspot_mask_presentation==="inline"&&String(link.hotspot_mask_mime_type||"").toLowerCase()==="image/png");
      const hotspotMask=maskEligible?{id:link.hotspot_mask_media_id,url:blackboardMediaUrl({media_id:link.hotspot_mask_media_id,source_url:link.hotspot_mask_source_url}),mime_type:link.hotspot_mask_mime_type,
        width:Number(link.hotspot_mask_width||0)||null,height:Number(link.hotspot_mask_height||0)||null}:null;
      const bounds={x_pct:Number(link.x_percent),y_pct:Number(link.y_percent),width_pct:Number(link.width_percent),height_pct:Number(link.height_percent)};
      return {state_id:link.state_id,stateId:link.state_id,x_percent:bounds.x_pct,xPercent:bounds.x_pct,x_pct:bounds.x_pct,y_percent:bounds.y_pct,yPercent:bounds.y_pct,y_pct:bounds.y_pct,
        width_percent:bounds.width_pct,widthPercent:bounds.width_pct,width_pct:bounds.width_pct,height_percent:bounds.height_pct,heightPercent:bounds.height_pct,height_pct:bounds.height_pct,sort_order:Number(link.placement_sort_order)||0,sortOrder:Number(link.placement_sort_order)||0,
        hotspot_mask_media_id:hotspotMask?.id||null,hotspotMaskMediaId:hotspotMask?.id||null,hotspot_mask:hotspotMask,hotspotMask,mask_url:hotspotMask?.url||null,maskUrl:hotspotMask?.url||null,bounds};
    });
    fragments.push({id:row.id,slug:row.slug,title:row.title,caption:row.caption||"",body:row.body||"",date:row.date_label||row.occurred_at||"",
      occurred_at:row.occurred_at,image:publicBlackboardMedia(row),visible_in:visible,visibleIn:visible,state_ids:publicLinks.map(item=>item.state_id),
      stateIds:publicLinks.map(item=>item.state_id),placements,manifestations,origin_threads:threads,originThreads:threads,state:row.state,public_visible:Number(row.public_visible||0)});
  }
  return fragments;
}

function blackboardFragmentAdminMedia(mediaId,row,prefix){
  if(!mediaId)return null;
  return {id:mediaId,url:`/api/admin/media/${encodeURIComponent(mediaId)}/file`,mime_type:row[`${prefix}_mime_type`]||"",
    original_filename:row[`${prefix}_filename`]||"",width:Number(row[`${prefix}_width`]||0)||null,height:Number(row[`${prefix}_height`]||0)||null};
}

function parsedBlackboardFragmentJson(value){
  if(!value)return null;
  try{return JSON.parse(value)}catch{return null}
}

async function blackboardFragmentAdminRecordsV3(database,{recordId="",fragmentId="",states=null}={}){
  const conditions=["fragment.state<>'archived'"];const values=[];
  if(recordId){conditions.push("fragment.record_entity_id=?");values.push(recordId)}
  if(fragmentId){conditions.push("fragment.id=?");values.push(fragmentId)}
  const rows=(await database.prepare(`SELECT fragment.*,
      board.title board_title,dossier.archive_slug board_slug,catalogue.catalogue_id board_catalogue_id,
      master.original_filename master_filename,master.mime_type master_mime_type,master.width master_width,master.height master_height,
      edit_source.original_filename edit_source_filename,edit_source.mime_type edit_source_mime_type,edit_source.width edit_source_width,edit_source.height edit_source_height,
      derivative.original_filename derivative_filename,derivative.mime_type derivative_mime_type,derivative.width derivative_width,derivative.height derivative_height,
      current_edit.id current_edit_id,current_edit.revision_number current_edit_revision_number,current_edit.source_media_id current_edit_source_media_id,
      current_edit.alpha_mask_media_id current_edit_alpha_mask_media_id,current_edit.output_media_id current_edit_output_media_id,
      current_edit.recipe_json current_edit_recipe_json,current_edit.created_at current_edit_created_at,current_edit.updated_at current_edit_updated_at,
      alpha_mask.original_filename current_edit_alpha_mask_filename,alpha_mask.mime_type current_edit_alpha_mask_mime_type,
      alpha_mask.width current_edit_alpha_mask_width,alpha_mask.height current_edit_alpha_mask_height,
      (SELECT COUNT(*) FROM archive_blackboard_fragment_edits edit_count WHERE edit_count.fragment_id=fragment.id) edit_revision_count
    FROM archive_blackboard_fragments fragment
    JOIN content_entities entity ON entity.id=fragment.id
    LEFT JOIN archive_records board ON board.id=fragment.record_entity_id AND board.record_type='blackboard'
    LEFT JOIN archive_dossiers dossier ON dossier.entity_id=fragment.record_entity_id
    LEFT JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=fragment.record_entity_id
    LEFT JOIN media_assets master ON master.id=fragment.master_media_id
    LEFT JOIN media_assets edit_source ON edit_source.id=fragment.edit_source_media_id
    LEFT JOIN media_assets derivative ON derivative.id=fragment.derivative_media_id
    LEFT JOIN archive_blackboard_fragment_edits current_edit ON current_edit.fragment_id=fragment.id AND current_edit.is_current=1
    LEFT JOIN media_assets alpha_mask ON alpha_mask.id=current_edit.alpha_mask_media_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY CASE WHEN fragment.record_entity_id IS NULL THEN 0 ELSE 1 END,fragment.updated_at DESC,fragment.sort_order,fragment.created_at`).bind(...values).all()).results||[];
  const statesByRecord=new Map();if(recordId&&states)statesByRecord.set(recordId,states);const fragments=[];
  for(const row of rows){
    if(row.record_entity_id&&!statesByRecord.has(row.record_entity_id))statesByRecord.set(row.record_entity_id,await blackboardStateRowsV2(database,row.record_entity_id,false));
    const boardStates=statesByRecord.get(row.record_entity_id)||[],stateMap=new Map(boardStates.map(state=>[state.id,state]));
    const links=(await database.prepare(`SELECT link.*,placement.x_percent,placement.y_percent,placement.width_percent,placement.height_percent,
        placement.hotspot_mask_media_id,placement.hotspot_recipe_json,placement.sort_order placement_sort_order,
        hotspot_mask.original_filename hotspot_mask_filename,hotspot_mask.mime_type hotspot_mask_mime_type,
        hotspot_mask.width hotspot_mask_width,hotspot_mask.height hotspot_mask_height
      FROM archive_blackboard_fragment_states link
      LEFT JOIN archive_blackboard_fragment_placements placement ON placement.fragment_id=link.fragment_id AND placement.state_id=link.state_id
      LEFT JOIN media_assets hotspot_mask ON hotspot_mask.id=placement.hotspot_mask_media_id
      WHERE link.fragment_id=? ORDER BY link.sort_order,link.created_at`).bind(row.id).all()).results||[];
    const placements=links.filter(link=>link.x_percent!==null&&link.x_percent!==undefined).map(link=>{
      const hotspotMask=blackboardFragmentAdminMedia(link.hotspot_mask_media_id,link,"hotspot_mask");
      const bounds={x_pct:Number(link.x_percent),y_pct:Number(link.y_percent),width_pct:Number(link.width_percent),height_pct:Number(link.height_percent)};
      return {state_id:link.state_id,stateId:link.state_id,x_percent:bounds.x_pct,xPercent:bounds.x_pct,x_pct:bounds.x_pct,y_percent:bounds.y_pct,yPercent:bounds.y_pct,y_pct:bounds.y_pct,
        width_percent:bounds.width_pct,widthPercent:bounds.width_pct,width_pct:bounds.width_pct,height_percent:bounds.height_pct,heightPercent:bounds.height_pct,height_pct:bounds.height_pct,
        sort_order:Number(link.placement_sort_order)||0,sortOrder:Number(link.placement_sort_order)||0,hotspot_mask_media_id:link.hotspot_mask_media_id||null,
        hotspotMaskMediaId:link.hotspot_mask_media_id||null,hotspot_mask:hotspotMask,hotspotMask,mask_url:hotspotMask?.url||null,maskUrl:hotspotMask?.url||null,bounds,hotspot_recipe_json:link.hotspot_recipe_json||null,
        hotspotRecipeJson:link.hotspot_recipe_json||null,hotspot_recipe:parsedBlackboardFragmentJson(link.hotspot_recipe_json),hotspotRecipe:parsedBlackboardFragmentJson(link.hotspot_recipe_json)};
    });
    const editRows=(await database.prepare(`SELECT edit.*,
        source.original_filename source_filename,source.mime_type source_mime_type,source.width source_width,source.height source_height,
        alpha_mask.original_filename alpha_mask_filename,alpha_mask.mime_type alpha_mask_mime_type,alpha_mask.width alpha_mask_width,alpha_mask.height alpha_mask_height,
        output.original_filename output_filename,output.mime_type output_mime_type,output.width output_width,output.height output_height
      FROM archive_blackboard_fragment_edits edit
      JOIN media_assets source ON source.id=edit.source_media_id
      LEFT JOIN media_assets alpha_mask ON alpha_mask.id=edit.alpha_mask_media_id
      JOIN media_assets output ON output.id=edit.output_media_id
      WHERE edit.fragment_id=? ORDER BY edit.revision_number DESC`).bind(row.id).all()).results||[];
    const edits=editRows.map(edit=>({id:edit.id,revision_number:Number(edit.revision_number)||1,revisionNumber:Number(edit.revision_number)||1,
      source_media_id:edit.source_media_id,sourceMediaId:edit.source_media_id,source:blackboardFragmentAdminMedia(edit.source_media_id,edit,"source"),
      alpha_mask_media_id:edit.alpha_mask_media_id||null,alphaMaskMediaId:edit.alpha_mask_media_id||null,alpha_mask:blackboardFragmentAdminMedia(edit.alpha_mask_media_id,edit,"alpha_mask"),
      alphaMask:blackboardFragmentAdminMedia(edit.alpha_mask_media_id,edit,"alpha_mask"),output_media_id:edit.output_media_id,outputMediaId:edit.output_media_id,
      output:blackboardFragmentAdminMedia(edit.output_media_id,edit,"output"),recipe_json:edit.recipe_json,recipeJson:edit.recipe_json,recipe:parsedBlackboardFragmentJson(edit.recipe_json),
      is_current:Number(edit.is_current)===1,isCurrent:Number(edit.is_current)===1,created_at:edit.created_at,updated_at:edit.updated_at}));
    const currentEdit=edits.find(edit=>edit.is_current)||null;
    const board=row.record_entity_id?{id:row.record_entity_id,entity_id:row.record_entity_id,entityId:row.record_entity_id,title:row.board_title||row.record_entity_id,
      slug:row.board_slug||"",catalogue_id:row.board_catalogue_id||"",catalogueId:row.board_catalogue_id||"",states:boardStates}:null;
    const stateIds=links.map(link=>link.state_id),fragment={id:row.id,slug:row.slug,title:row.title,caption:row.caption||"",body:row.body||"",date:row.date_label||row.occurred_at||"",
      occurred_at:row.occurred_at,date_precision:row.date_precision,date_label:row.date_label||"",state:row.state,public_visible:Number(row.public_visible||0),sort_order:Number(row.sort_order)||0,
      record_entity_id:row.record_entity_id||null,recordEntityId:row.record_entity_id||null,board,master_media_id:row.master_media_id||null,masterMediaId:row.master_media_id||null,
      edit_source_media_id:row.edit_source_media_id||null,editSourceMediaId:row.edit_source_media_id||null,derivative_media_id:row.derivative_media_id||null,
      derivativeMediaId:row.derivative_media_id||null,master:blackboardFragmentAdminMedia(row.master_media_id,row,"master"),edit_source:blackboardFragmentAdminMedia(row.edit_source_media_id,row,"edit_source"),
      editSource:blackboardFragmentAdminMedia(row.edit_source_media_id,row,"edit_source"),image:blackboardFragmentAdminMedia(row.derivative_media_id,row,"derivative"),current_edit:currentEdit,currentEdit,edits,
      edit_revision_count:edits.length,editRevisionCount:edits.length,edit_status:currentEdit?"edited":"unedited",editStatus:currentEdit?"edited":"unedited",
      mapping_status:row.record_entity_id?(placements.length?"placed":"board-selected"):"unmapped",mappingStatus:row.record_entity_id?(placements.length?"placed":"board-selected"):"unmapped",
      visible_in:stateIds.map(stateId=>stateMap.get(stateId)).filter(Boolean),visibleIn:stateIds.map(stateId=>stateMap.get(stateId)).filter(Boolean),state_ids:stateIds,stateIds,placements,
      created_at:row.created_at,updated_at:row.updated_at};
    fragments.push(fragment);
  }
  return fragments;
}

async function publicBlackboardRecordDetailV2(database,slugValue){
  const row=await database.prepare(`${blackboardRecordSqlV2(true)} AND ad.archive_slug=?`).bind(slugValue).first();
  if(!row)return null;
  const record=presentBlackboardRecordV2(row),states=await blackboardStateRowsV2(database,record.id,true),notebook=await blackboardNotebookRowsV2(database,record.id,true);
  const fragments=await blackboardFragmentsV2(database,record.id,states,true);
  record.state_count=states.length;record.stateCount=states.length;record.fragment_count=fragments.length;record.fragmentCount=fragments.length;
  const activities=(await database.prepare(`SELECT activity.*,('history-'||activity.id) anchor FROM entity_activity activity
    WHERE activity.entity_id=? AND activity.public_visible=1 ORDER BY CASE WHEN activity.occurred_at IS NULL THEN 1 ELSE 0 END,activity.occurred_at,activity.sort_order,activity.created_at`).bind(record.id).all()).results||[];
  const versions=[];
  for(const state of states){let version=versions.find(item=>item.version_number===state.version_number);if(!version){version={version_number:state.version_number,versionNumber:state.version_number,title:`Version ${state.version_number}`,states:[]};versions.push(version)}version.states.push(state)}
  const latest=states.at(-1)||null;
  return {record,surface:record,versions,states,captures:states,latest_state:latest,latestState:latest,latest_capture:latest,latestCapture:latest,
    notebook,context_media:notebook,contextMedia:notebook,fragments,activities,item_history:activities,itemHistory:activities};
}

async function publicArchiveBlackboardsV2(request,env,recordSlug=""){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env);
  if(recordSlug){const detail=await publicBlackboardRecordDetailV2(database,recordSlug);return detail?json(detail):failure("Blackboard record not found.",404)}
  const rows=(await database.prepare(`${blackboardRecordSqlV2(true)} ORDER BY profile.sort_order,ar.title`).all()).results||[],records=[],fragments=[];
  for(const row of rows){
    const record=presentBlackboardRecordV2(row),states=await blackboardStateRowsV2(database,record.id,true),recordFragments=await blackboardFragmentsV2(database,record.id,states,true);
    record.latest_state=states.at(-1)||null;record.latestState=record.latest_state;record.latest_capture=record.latest_state;record.latestCapture=record.latest_state;
    record.state_count=states.length;record.stateCount=states.length;record.fragment_count=recordFragments.length;record.fragmentCount=recordFragments.length;
    const board={id:record.id,entity_id:record.id,entityId:record.id,slug:record.slug,title:record.title,route:record.route,
      catalogue_id:record.catalogue_id,catalogueId:record.catalogue_id,catalogue_label:record.catalogue_label,catalogueLabel:record.catalogue_label};
    fragments.push(...recordFragments.map(fragment=>({...fragment,board})));
    records.push(record);
  }
  fragments.sort((left,right)=>{
    const leftDate=Date.parse(left.occurred_at||""),rightDate=Date.parse(right.occurred_at||"");
    if(Number.isFinite(leftDate)&&Number.isFinite(rightDate)&&leftDate!==rightDate)return rightDate-leftDate;
    if(Number.isFinite(rightDate))return 1;if(Number.isFinite(leftDate))return -1;
    return String(left.title||"").localeCompare(String(right.title||""));
  });
  return json({records,surfaces:records,boards:records,fragments,count:{records:records.length,surfaces:records.length,boards:records.length,fragments:fragments.length}});
}

async function blackboardRecordAdminPayloadV2(database,recordId=""){
  const where=recordId?" AND profile.record_entity_id=?":"",statement=database.prepare(`${blackboardRecordSqlV2(false)}${where} ORDER BY profile.sort_order,ar.title`);
  const rows=(recordId?await statement.bind(recordId).all():await statement.all()).results||[],records=[];
  for(const row of rows){const record=presentBlackboardRecordV2(row,true),states=await blackboardStateRowsV2(database,record.id,false),notebook=await blackboardNotebookRowsV2(database,record.id,false),fragments=await blackboardFragmentsV2(database,record.id,states,false);records.push({...record,states,captures:states,notebook,context_media:notebook,contextMedia:notebook,fragments})}
  return recordId?records[0]||null:records;
}

async function attachBlackboardStateMediaV2(database,recordId,stateId,body){
  const state=await database.prepare(`SELECT object_state.*,version.entity_id FROM archive_object_states object_state JOIN archive_object_versions version ON version.id=object_state.version_id WHERE object_state.id=? AND version.entity_id=?`).bind(stateId,recordId).first();
  if(!state)return failure("Blackboard state not found.",404);
  const masterId=text(body.master_media_id??body.masterMediaId,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200);
  const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:true});if(pair instanceof Response)return pair;
  await prepareBlackboardMediaPair(database,masterId,derivativeId);
  const materialId=state.lead_material_id||id("archive-material"),reference=`M${String(Number(state.state_order)||1).padStart(2,"0")}`;
  const existing=state.lead_material_id?await database.prepare("SELECT id FROM archive_materials WHERE id=?").bind(state.lead_material_id).first():null;
  if(existing)await database.prepare(`UPDATE archive_materials SET media_id=?,role='blackboard-whole',material_type='artifact',title=?,caption=?,process_phase='captured state',occurred_at=?,date_precision=?,date_label=?,state='draft',visibility='internal',state_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?`)
    .bind(derivativeId,state.title||`State ${state.state_roman}`,text(body.caption,5000),state.occurred_at,state.date_precision,state.date_label,stateId,materialId).run();
  else await database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,date_precision,date_label,visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,'blackboard-whole','artifact',?,?,'','captured state',?,?,?,'internal','draft',?,?,?,0,'studio','studio',datetime('now'),datetime('now'))`)
    .bind(materialId,recordId,derivativeId,state.title||`State ${state.state_roman}`,text(body.caption,5000),state.occurred_at,state.date_precision,state.date_label,Number(state.state_order)||1,stateId,reference).run();
  await database.batch([
    database.prepare("UPDATE archive_object_states SET lead_material_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(materialId,stateId),
    database.prepare(`INSERT INTO archive_material_source_contexts(material_id,source_kind,capture_scope,board_entity_id,created_by,updated_by,created_at,updated_at)
      VALUES(?,'blackboard','whole',?,'studio','studio',datetime('now'),datetime('now'))
      ON CONFLICT(material_id) DO UPDATE SET board_entity_id=excluded.board_entity_id,updated_by='studio',updated_at=datetime('now')`).bind(materialId,recordId),
  ]);
  return {materialId,masterId,derivativeId};
}

async function archiveBlackboardStatesAdminApiV2(request,env,recordId,stateId=""){
  const database=db(env),record=await database.prepare("SELECT record_entity_id FROM archive_blackboard_records WHERE record_entity_id=?").bind(recordId).first();
  if(!record)return failure("Blackboard record not found.",404);
  if(request.method==="POST"&&!stateId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const version=await database.prepare("SELECT * FROM archive_object_versions WHERE entity_id=? ORDER BY version_number LIMIT 1").bind(recordId).first();
    const max=await database.prepare("SELECT COALESCE(MAX(state_order),0) state_order FROM archive_object_states WHERE version_id=?").bind(version.id).first(),order=Number(max?.state_order||0)+1,roman=blackboardStateRoman(order),newId=text(body.id,200)||id("archive-state");
    const occurredAt=text(body.occurred_at??body.occurredAt,80)||null,dateLabel=text(body.date_label??body.dateLabel,160),datePrecision=text(body.date_precision??body.datePrecision,30)||(occurredAt?"exact":"undated");
    if(!ARCHIVE_DATE_PRECISIONS.has(datePrecision))return failure("Invalid date precision.",409);
    await database.prepare(`INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,variant_label,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'',?,?,?,?, 'draft',0,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,version.id,roman,order,text(body.title,300)||`State ${roman}`,text(body.description,5000)||`Complete Blackboard state documented on ${dateLabel||"an undated capture"}`,occurredAt,datePrecision,dateLabel,order).run();
    if(body.master_media_id||body.masterMediaId){const attached=await attachBlackboardStateMediaV2(database,recordId,newId,body);if(attached instanceof Response)return attached}
    await database.prepare("UPDATE archive_catalogue_entries SET current_state=?,current_state_id=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(roman,newId,recordId).run();
    return json({record:(await blackboardStateRowsV2(database,recordId,false)).find(item=>item.id===newId)},{status:201});
  }
  const before=stateId?await database.prepare(`SELECT object_state.*,version.entity_id FROM archive_object_states object_state JOIN archive_object_versions version ON version.id=object_state.version_id WHERE object_state.id=? AND version.entity_id=?`).bind(stateId,recordId).first():null;
  if(!before)return failure("Blackboard state not found.",404);
  if(request.method==="POST"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const attached=await attachBlackboardStateMediaV2(database,recordId,stateId,body);if(attached instanceof Response)return attached;
    return json({record:(await blackboardStateRowsV2(database,recordId,false)).find(item=>item.id===stateId)});
  }
  if(request.method==="PATCH"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const occurredAt=text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null,dateLabel=text(body.date_label??body.dateLabel??before.date_label,160),datePrecision=text(body.date_precision??body.datePrecision??before.date_precision,30);
    const publication=text(body.publication_state??body.publicationState??before.publication_state,30),requested=body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible),publicVisible=publication==="published"&&requested?1:0;
    if(publicVisible&&!before.lead_material_id)return failure("Attach a complete scan before publishing this state.",409);
    await database.batch([
      database.prepare("UPDATE archive_object_states SET title=?,description=?,occurred_at=?,date_precision=?,date_label=?,publication_state=?,public_visible=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(text(body.title??before.title,300),text(body.description??before.description,5000),occurredAt,datePrecision,dateLabel,publication,publicVisible,stateId),
      ...(before.lead_material_id?[database.prepare("UPDATE archive_materials SET state=?,visibility=?,occurred_at=?,date_precision=?,date_label=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(publicVisible?"published":"draft",publicVisible?"public":"internal",occurredAt,datePrecision,dateLabel,before.lead_material_id)]:[]),
    ]);
    return json({record:(await blackboardStateRowsV2(database,recordId,false)).find(item=>item.id===stateId)});
  }
  return failure("Method not allowed.",405);
}

async function archiveBlackboardNotebookAdminApiV2(request,env,recordId,materialId=""){
  const database=db(env),owner=await database.prepare("SELECT record_entity_id FROM archive_blackboard_records WHERE record_entity_id=?").bind(recordId).first();if(!owner)return failure("Blackboard record not found.",404);
  const before=materialId?await database.prepare("SELECT * FROM archive_materials WHERE id=? AND dossier_entity_id=? AND role='notebook'").bind(materialId,recordId).first():null;
  if(request.method==="POST"&&!materialId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const masterId=text(body.master_media_id??body.masterMediaId,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200);
    const pair=await blackboardMediaPair(database,masterId,derivativeId,{derivativeRequired:true});if(pair instanceof Response)return pair;await prepareBlackboardMediaPair(database,masterId,derivativeId);
    const state=text(body.state,30)||"draft",visibility=state==="published"&&truthy(body.public_visible??body.publicVisible)?"public":"internal",newId=text(body.id,200)||id("archive-material-notebook"),occurredAt=text(body.occurred_at??body.occurredAt,80)||null,dateLabel=text(body.date_label??body.dateLabel,160);
    await database.prepare(`INSERT INTO archive_materials(id,dossier_entity_id,media_id,role,material_type,title,caption,body,process_phase,occurred_at,date_precision,date_label,visibility,state,sort_order,state_id,material_reference,is_sample,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,'notebook','process-photo',?,?,'','studio context',?,?,?, ?,?, ?,NULL,'',0,'studio','studio',datetime('now'),datetime('now'))`)
      .bind(newId,recordId,derivativeId,text(body.title,300)||"Blackboard in the studio",text(body.caption,5000),occurredAt,occurredAt?"exact":"undated",dateLabel,visibility,state,Number(body.sort_order??body.sortOrder)||0).run();
    return json({record:(await blackboardNotebookRowsV2(database,recordId,false)).find(item=>item.id===newId)},{status:201});
  }
  if(request.method==="PATCH"&&before){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const state=text(body.state??before.state,30),requested=body.public_visible===undefined&&body.publicVisible===undefined?before.visibility==="public":truthy(body.public_visible??body.publicVisible),visibility=state==="published"&&requested?"public":"internal";
    await database.prepare("UPDATE archive_materials SET title=?,caption=?,occurred_at=?,date_precision=?,date_label=?,state=?,visibility=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?")
      .bind(text(body.title??before.title,300),text(body.caption??before.caption,5000),text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null,text(body.date_precision??body.datePrecision??before.date_precision,30),text(body.date_label??body.dateLabel??before.date_label,160),state,visibility,Number(body.sort_order??body.sortOrder??before.sort_order)||0,materialId).run();
    return json({record:(await blackboardNotebookRowsV2(database,recordId,false)).find(item=>item.id===materialId)});
  }
  return failure("Method not allowed.",405);
}

function normalizedBlackboardFragmentJson(value,label,{nullable=false}={}){
  if(value===undefined||value===null||value==="")return nullable?null:"{}";
  const encoded=typeof value==="string"?value:JSON.stringify(value);
  if(new TextEncoder().encode(encoded).byteLength>262144)throw new Error(`${label} exceeds the 256 KiB limit.`);
  try{const parsed=JSON.parse(encoded);if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")throw new Error()}catch{throw new Error(`${label} must be a JSON object.`)}
  return encoded;
}

async function blackboardFragmentImage(database,mediaId,label,{mimes=null,privateOnly=false,publicOnly=false}={}){
  if(!mediaId)return null;const media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();
  if(!media)throw new Error(`${label} Digital Asset was not found.`);if(!String(media.mime_type||"").startsWith("image/"))throw new Error(`${label} must be an image.`);
  if(mimes&&!mimes.has(String(media.mime_type||"").toLowerCase()))throw new Error(`${label} has an unsupported image format.`);
  if(media.state!=="active")throw new Error(`${label} must be active.`);
  if(privateOnly&&(!["internal","private"].includes(media.privacy)||media.public_presentation!=="hidden"))throw new Error(`${label} must remain internal or private and hidden.`);
  if(publicOnly&&(media.privacy!=="public"||media.public_presentation!=="inline"))throw new Error(`${label} must be public and inline.`);
  return media;
}

async function archiveBlackboardFragmentsGlobalAdminApi(request,env,fragmentId="",action="",compatibilityRecordId=""){
  const database=db(env);let compatibilityOwner=null;
  if(compatibilityRecordId){compatibilityOwner=await database.prepare("SELECT record_entity_id FROM archive_blackboard_records WHERE record_entity_id=?").bind(compatibilityRecordId).first();if(!compatibilityOwner)return failure("Blackboard record not found.",404)}
  const before=fragmentId?await database.prepare("SELECT * FROM archive_blackboard_fragments WHERE id=?").bind(fragmentId).first():null;
  if(fragmentId&&!before)return failure("Blackboard fragment not found.",404);
  if(before&&compatibilityRecordId&&before.record_entity_id!==compatibilityRecordId)return failure("Blackboard fragment not found in this record.",404);
  if(request.method==="GET"){
    const records=await blackboardFragmentAdminRecordsV3(database,{fragmentId,recordId:compatibilityRecordId});
    if(fragmentId&&!records.length)return failure("Blackboard fragment not found.",404);
    return json(fragmentId?{record:records[0],fragment:records[0]}:{records,fragments:records,count:records.length});
  }
  if(request.method==="POST"&&!fragmentId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const title=text(body.title,300),fragmentSlug=slug(body.slug||title);if(!title||!fragmentSlug)return failure("A fragment title and slug are required.",409);
    const recordId=compatibilityRecordId||text(body.record_entity_id??body.recordEntityId??body.board_entity_id??body.boardEntityId,200)||null;
    if(recordId&&!await database.prepare("SELECT record_entity_id FROM archive_blackboard_records WHERE record_entity_id=?").bind(recordId).first())return failure("Choose an existing Blackboard record.",409);
    const masterId=text(body.master_media_id??body.masterMediaId,200)||null,legacyDerivativeId=text(body.derivative_media_id??body.derivativeMediaId,200)||null;
    let editSourceId=text(body.edit_source_media_id??body.editSourceMediaId,200)||null;const mediaStatements=[];
    try{
      const master=masterId?await blackboardFragmentImage(database,masterId,"Archival master",{mimes:RESUMABLE_UPLOAD_MIMES["archive-master"]}):null;
      if(!editSourceId&&master&&["image/jpeg","image/png","image/webp"].includes(String(master.mime_type||"").toLowerCase()))editSourceId=masterId;
      if(editSourceId)await blackboardFragmentImage(database,editSourceId,"Edit source",{mimes:new Set(["image/jpeg","image/png","image/webp"])});
      if(editSourceId&&legacyDerivativeId&&editSourceId===legacyDerivativeId)throw new Error("The private edit source and public derivative must be different Digital Assets.");
      if(legacyDerivativeId){const pair=await blackboardMediaPair(database,masterId,legacyDerivativeId,{derivativeRequired:true});if(pair instanceof Response)return pair;await prepareBlackboardMediaPair(database,masterId,legacyDerivativeId);if(editSourceId&&editSourceId!==masterId)mediaStatements.push(database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(editSourceId))}
      else for(const mediaId of new Set([masterId,editSourceId].filter(Boolean)))mediaStatements.push(database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(mediaId));
      if(master&&editSourceId&&["image/heic","image/heif"].includes(String(master.mime_type||"").toLowerCase()))mediaStatements.push(database.prepare(`INSERT INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
        VALUES(?,?,'public-display','studio',datetime('now'),datetime('now')) ON CONFLICT(master_media_id,purpose) DO UPDATE SET derivative_media_id=excluded.derivative_media_id,updated_at=datetime('now')`).bind(masterId,editSourceId));
    }catch(error){return failure(error.message,409)}
    const state=text(body.state,30)||"draft",requested=truthy(body.public_visible??body.publicVisible),publicVisible=state==="published"&&requested&&legacyDerivativeId?1:0,newId=text(body.id,200)||id("blackboard-fragment");
    try{await database.batch([...mediaStatements,
      database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_blackboard_fragment','archive',?,?,'studio','studio',datetime('now'),datetime('now'))").bind(newId,publicVisible?"public":"internal",publicVisible),
      database.prepare(`INSERT INTO archive_blackboard_fragments(id,record_entity_id,slug,title,caption,body,master_media_id,edit_source_media_id,derivative_media_id,occurred_at,date_precision,date_label,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'),CASE WHEN ?=1 THEN datetime('now') END)`).bind(newId,recordId,fragmentSlug,title,text(body.caption,5000),text(body.body,20000),masterId,editSourceId,legacyDerivativeId,text(body.occurred_at??body.occurredAt,80)||null,text(body.date_precision??body.datePrecision,30)||(body.occurred_at||body.occurredAt?"exact":"undated"),text(body.date_label??body.dateLabel,160),state,publicVisible,Number(body.sort_order??body.sortOrder)||0,publicVisible),
    ])}catch(error){return failure(/archive_blackboard_fragments\.slug|UNIQUE constraint failed/i.test(String(error?.message||error))?"That fragment slug is already in use.":String(error?.message||error),409)}
    const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId:newId}))[0];return json({record,fragment:record},{status:201});
  }
  if(request.method==="PUT"&&before&&action==="board"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const recordId=text(body.record_entity_id??body.recordEntityId??body.board_entity_id??body.boardEntityId,200)||null;
    if(recordId&&!await database.prepare("SELECT record_entity_id FROM archive_blackboard_records WHERE record_entity_id=?").bind(recordId).first())return failure("Choose an existing Blackboard record.",409);
    const changed=(before.record_entity_id||null)!==recordId,mappingRow=changed?await database.prepare("SELECT COUNT(*) mapping_count FROM archive_blackboard_fragment_states WHERE fragment_id=?").bind(fragmentId).first():null,mappingCount=Number(mappingRow?.mapping_count||0);
    if(changed&&mappingCount&&!truthy(body.confirm_reset_mappings??body.confirmResetMappings)){const details={mapping_count:mappingCount,mappingCount,confirm_required:true,confirmRequired:true};return json({error:"Changing this fragment's Blackboard will clear its saved state mappings.",...details,details},{status:409})}
    const statements=[];if(changed)statements.push(database.prepare("DELETE FROM archive_blackboard_fragment_states WHERE fragment_id=?").bind(fragmentId));
    statements.push(database.prepare("UPDATE archive_blackboard_fragments SET record_entity_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(recordId,fragmentId));
    await database.batch(statements);const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0];return json({record,fragment:record,cleared_state_mappings:changed&&mappingCount>0,clearedStateMappings:changed&&mappingCount>0});
  }
  if(request.method==="POST"&&before&&action==="edits"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const editId=text(body.id,200)||id("blackboard-fragment-edit");
    const existing=await database.prepare("SELECT id,fragment_id FROM archive_blackboard_fragment_edits WHERE id=?").bind(editId).first();
    if(existing&&existing.fragment_id!==fragmentId)return failure("That edit revision id already belongs to another fragment.",409);
    if(existing){const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0];return json({record,fragment:record,idempotent:true})}
    const sourceId=text(body.source_media_id??body.sourceMediaId??before.edit_source_media_id??before.master_media_id,200),maskId=text(body.alpha_mask_media_id??body.alphaMaskMediaId,200)||null,outputId=text(body.output_media_id??body.outputMediaId,200);
    if(!sourceId||!outputId)return failure("An edit source and rendered output are required.",409);
    if(sourceId===outputId||maskId&&(maskId===sourceId||maskId===outputId))return failure("Edit source, alpha mask, and rendered output must use distinct Digital Assets.",409);
    let recipeJson;try{recipeJson=normalizedBlackboardFragmentJson(body.recipe_json??body.recipeJson??body.recipe,"Edit recipe");
      await blackboardFragmentImage(database,sourceId,"Edit source",{mimes:new Set(["image/jpeg","image/png","image/webp"])});
      if(maskId)await blackboardFragmentImage(database,maskId,"Alpha mask",{mimes:new Set(["image/png"])});
      await blackboardFragmentImage(database,outputId,"Rendered output",{mimes:new Set(["image/png","image/webp"])});
    }catch(error){return failure(error.message,409)}
    const latest=await database.prepare("SELECT COALESCE(MAX(revision_number),0) revision_number FROM archive_blackboard_fragment_edits WHERE fragment_id=?").bind(fragmentId).first(),revision=Number(latest?.revision_number||0)+1,
      previousCurrent=await database.prepare("SELECT output_media_id FROM archive_blackboard_fragment_edits WHERE fragment_id=? AND is_current=1").bind(fragmentId).first();
    const outputPublic=before.state==="published"&&Number(before.public_visible)===1;
    const statements=[
      database.prepare("UPDATE archive_blackboard_fragment_edits SET is_current=0,updated_at=datetime('now') WHERE fragment_id=? AND is_current=1").bind(fragmentId),
      database.prepare(`INSERT INTO archive_blackboard_fragment_edits(id,fragment_id,revision_number,source_media_id,alpha_mask_media_id,output_media_id,recipe_json,is_current,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))`).bind(editId,fragmentId,revision,sourceId,maskId,outputId,recipeJson),
      database.prepare("UPDATE archive_blackboard_fragments SET edit_source_media_id=?,derivative_media_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(sourceId,outputId,fragmentId),
      database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(sourceId),
      database.prepare("UPDATE media_assets SET privacy=?,public_presentation=?,updated_at=datetime('now') WHERE id=?").bind(outputPublic?"public":"internal",outputPublic?"inline":"hidden",outputId),
    ];if(previousCurrent?.output_media_id&&previousCurrent.output_media_id!==outputId)statements.push(database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(previousCurrent.output_media_id));if(maskId)statements.push(database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(maskId));
    try{await database.batch(statements)}catch(error){return failure(String(error?.message||error),409)}
    const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0];return json({record,fragment:record,edit:record.current_edit},{status:201});
  }
  if(request.method==="DELETE"&&before&&action.startsWith("edits/")){
    const editId=decodeURIComponent(action.slice(6)),edit=await database.prepare("SELECT * FROM archive_blackboard_fragment_edits WHERE id=? AND fragment_id=?").bind(editId,fragmentId).first();
    if(!edit)return failure("Blackboard fragment edit revision not found.",404);
    const fallback=Number(edit.is_current)===1?await database.prepare("SELECT * FROM archive_blackboard_fragment_edits WHERE fragment_id=? AND id<>? ORDER BY revision_number DESC LIMIT 1").bind(fragmentId,editId).first():null;
    const outputPublic=before.state==="published"&&Number(before.public_visible)===1&&Boolean(fallback),statements=[
      database.prepare("DELETE FROM archive_blackboard_fragment_edits WHERE id=? AND fragment_id=?").bind(editId,fragmentId),
      database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=?").bind(edit.alpha_mask_media_id||""),
      database.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden',updated_at=datetime('now') WHERE id=? AND NOT EXISTS (SELECT 1 FROM archive_blackboard_fragment_edits current_edit WHERE current_edit.output_media_id=? AND current_edit.is_current=1)").bind(edit.output_media_id,edit.output_media_id),
    ];
    if(Number(edit.is_current)===1){
      statements.push(database.prepare("UPDATE archive_blackboard_fragment_edits SET is_current=0,updated_at=datetime('now') WHERE fragment_id=?").bind(fragmentId));
      if(fallback)statements.push(
        database.prepare("UPDATE archive_blackboard_fragment_edits SET is_current=1,updated_at=datetime('now') WHERE id=? AND fragment_id=?").bind(fallback.id,fragmentId),
        database.prepare("UPDATE archive_blackboard_fragments SET derivative_media_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(fallback.output_media_id,fragmentId),
        database.prepare("UPDATE media_assets SET privacy=?,public_presentation=?,updated_at=datetime('now') WHERE id=?").bind(outputPublic?"public":"internal",outputPublic?"inline":"hidden",fallback.output_media_id),
      );else statements.push(
        database.prepare("UPDATE archive_blackboard_fragments SET derivative_media_id=NULL,public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(fragmentId),
        database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(fragmentId),
      );
    }
    try{await database.batch(statements)}catch(error){return failure(String(error?.message||error),409)}
    const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0],released=[edit.alpha_mask_media_id,edit.output_media_id].filter(Boolean);
    return json({record,fragment:record,deleted_edit_id:editId,deletedEditId:editId,released_media_ids:released,releasedMediaIds:released});
  }
  if(request.method==="PUT"&&before&&action==="mappings"){
    if(!before.record_entity_id)return failure("Choose a Blackboard before mapping this fragment.",409);
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const source=body.mappings??[];if(!Array.isArray(source))return failure("Mappings must be an array.",409);if(source.length>100)return failure("A fragment may have at most 100 state mappings.",409);
    const seen=new Set(),mappings=[];
    for(let index=0;index<source.length;index++){
      const item=source[index]||{},stateId=text(item.state_id??item.stateId,200),x=Number(item.x_pct??item.x_percent??item.xPercent??item.x),y=Number(item.y_pct??item.y_percent??item.yPercent??item.y),width=Number(item.width_pct??item.width_percent??item.widthPercent??item.width),height=Number(item.height_pct??item.height_percent??item.heightPercent??item.height),maskId=text(item.hotspot_mask_media_id??item.hotspotMaskMediaId,200)||null;
      if(!stateId||seen.has(stateId))return failure("Each mapping needs one unique Blackboard state.",409);seen.add(stateId);
      if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100.000001||y+height>100.000001)return failure("Mapping bounds must form a positive rectangle inside the full scan.",409);
      let hotspotRecipeJson=null;try{hotspotRecipeJson=normalizedBlackboardFragmentJson(item.hotspot_recipe_json??item.hotspotRecipeJson??item.hotspot_recipe??item.hotspotRecipe,"Hotspot recipe",{nullable:true});if(maskId)await blackboardFragmentImage(database,maskId,"Hotspot mask",{mimes:new Set(["image/png"])})}catch(error){return failure(error.message,409)}
      mappings.push({state_id:stateId,x_percent:x,y_percent:y,width_percent:width,height_percent:height,hotspot_mask_media_id:maskId,hotspot_recipe_json:hotspotRecipeJson,sort_order:Number(item.sort_order??item.sortOrder)||index+1});
    }
    if(mappings.length){const ids=mappings.map(item=>item.state_id),valid=(await database.prepare(`SELECT object_state.id FROM archive_object_states object_state JOIN archive_object_versions version ON version.id=object_state.version_id WHERE version.entity_id=? AND object_state.id IN (${ids.map(()=>"?").join(",")})`).bind(before.record_entity_id,...ids).all()).results||[];if(valid.length!==mappings.length)return failure("Every mapping state must belong to the selected Blackboard.",409)}
    const statements=[database.prepare("DELETE FROM archive_blackboard_fragment_placements WHERE fragment_id=?").bind(fragmentId),database.prepare("DELETE FROM archive_blackboard_fragment_states WHERE fragment_id=?").bind(fragmentId)];
    for(const item of mappings){statements.push(
      database.prepare("INSERT INTO archive_blackboard_fragment_states(fragment_id,state_id,sort_order,created_by,created_at) VALUES(?,?,?,'studio',datetime('now'))").bind(fragmentId,item.state_id,item.sort_order),
      database.prepare(`INSERT INTO archive_blackboard_fragment_placements(fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,hotspot_mask_media_id,hotspot_recipe_json,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(fragmentId,item.state_id,item.x_percent,item.y_percent,item.width_percent,item.height_percent,item.hotspot_mask_media_id,item.hotspot_recipe_json,item.sort_order),
    );if(item.hotspot_mask_media_id)statements.push(database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(item.hotspot_mask_media_id))}
    await database.batch(statements);const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0];return json({record,fragment:record,mappings:record.placements});
  }
  if(request.method==="PUT"&&before&&action==="states"){
    if(!before.record_entity_id)return failure("Choose a Blackboard before linking this fragment to states.",409);
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const stateIds=[...new Set((body.state_ids??body.stateIds??[]).map(value=>text(value,200)).filter(Boolean))];
    if(stateIds.length){const valid=(await database.prepare(`SELECT object_state.id FROM archive_object_states object_state JOIN archive_object_versions version ON version.id=object_state.version_id WHERE version.entity_id=? AND object_state.id IN (${stateIds.map(()=>"?").join(",")})`).bind(before.record_entity_id,...stateIds).all()).results||[];if(valid.length!==stateIds.length)return failure("Every Visible in state must belong to this Blackboard record.",409)}
    const remove=stateIds.length?database.prepare(`DELETE FROM archive_blackboard_fragment_states WHERE fragment_id=? AND state_id NOT IN (${stateIds.map(()=>"?").join(",")})`).bind(fragmentId,...stateIds):database.prepare("DELETE FROM archive_blackboard_fragment_states WHERE fragment_id=?").bind(fragmentId);
    await database.batch([remove,...stateIds.flatMap((linkedId,index)=>[
      database.prepare("INSERT OR IGNORE INTO archive_blackboard_fragment_states(fragment_id,state_id,sort_order,created_by,created_at) VALUES(?,?,?,'studio',datetime('now'))").bind(fragmentId,linkedId,index+1),
      database.prepare("UPDATE archive_blackboard_fragment_states SET sort_order=? WHERE fragment_id=? AND state_id=?").bind(index+1,fragmentId,linkedId),
    ])]);return json({ok:true,state_ids:stateIds,stateIds});
  }
  if(request.method==="PUT"&&before&&action==="placements"){
    if(!before.record_entity_id)return failure("Choose a Blackboard before placing this fragment.",409);
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const source=body.placements??[];if(!Array.isArray(source))return failure("Placements must be an array.",409);if(source.length>100)return failure("A fragment may have at most 100 state placements.",409);
    const seen=new Set(),placements=[];
    for(let index=0;index<source.length;index++){
      const item=source[index]||{},stateId=text(item.state_id??item.stateId,200),x=Number(item.x_pct??item.x_percent??item.xPercent??item.x),y=Number(item.y_pct??item.y_percent??item.yPercent??item.y),width=Number(item.width_pct??item.width_percent??item.widthPercent??item.width),height=Number(item.height_pct??item.height_percent??item.heightPercent??item.height),maskId=text(item.hotspot_mask_media_id??item.hotspotMaskMediaId,200)||null;
      if(!stateId||seen.has(stateId))return failure("Each placement needs one unique Blackboard state.",409);seen.add(stateId);
      if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100.000001||y+height>100.000001)return failure("Placement coordinates must form a positive rectangle inside the full scan.",409);
      let hotspotRecipeJson=null;try{hotspotRecipeJson=normalizedBlackboardFragmentJson(item.hotspot_recipe_json??item.hotspotRecipeJson??item.hotspot_recipe??item.hotspotRecipe,"Hotspot recipe",{nullable:true});if(maskId)await blackboardFragmentImage(database,maskId,"Hotspot mask",{mimes:new Set(["image/png"])})}catch(error){return failure(error.message,409)}
      placements.push({state_id:stateId,x_percent:x,y_percent:y,width_percent:width,height_percent:height,hotspot_mask_media_id:maskId,hotspot_recipe_json:hotspotRecipeJson,sort_order:Number(item.sort_order??item.sortOrder)||index+1});
    }
    if(placements.length){const ids=placements.map(item=>item.state_id),valid=(await database.prepare(`SELECT link.state_id FROM archive_blackboard_fragment_states link JOIN archive_object_states object_state ON object_state.id=link.state_id JOIN archive_object_versions version ON version.id=object_state.version_id WHERE link.fragment_id=? AND version.entity_id=? AND link.state_id IN (${ids.map(()=>"?").join(",")})`).bind(fragmentId,before.record_entity_id,...ids).all()).results||[];if(valid.length!==placements.length)return failure("Confirm every placement with a Visible in state match first.",409)}
    await database.batch([database.prepare("DELETE FROM archive_blackboard_fragment_placements WHERE fragment_id=?").bind(fragmentId),...placements.flatMap(item=>[
      database.prepare(`INSERT INTO archive_blackboard_fragment_placements(fragment_id,state_id,x_percent,y_percent,width_percent,height_percent,hotspot_mask_media_id,hotspot_recipe_json,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(fragmentId,item.state_id,item.x_percent,item.y_percent,item.width_percent,item.height_percent,item.hotspot_mask_media_id,item.hotspot_recipe_json,item.sort_order),
      ...(item.hotspot_mask_media_id?[database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(item.hotspot_mask_media_id)]:[]),
    ])]);
    return json({ok:true,placements});
  }
  if(request.method==="PATCH"&&before&&!action){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const state=text(body.state??before.state,30),requested=body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible):truthy(body.public_visible??body.publicVisible),publicVisible=state==="published"&&requested&&before.derivative_media_id?1:0,nextSlug=slug(body.slug??before.slug);
    if(!nextSlug)return failure("A fragment slug is required.",409);
    try{await database.batch([
      database.prepare("UPDATE archive_blackboard_fragments SET slug=?,title=?,caption=?,body=?,occurred_at=?,date_precision=?,date_label=?,state=?,public_visible=?,sort_order=?,published_at=CASE WHEN ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(nextSlug,text(body.title??before.title,300),text(body.caption??before.caption,5000),text(body.body??before.body,20000),text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null,text(body.date_precision??body.datePrecision??before.date_precision,30),text(body.date_label??body.dateLabel??before.date_label,160),state,publicVisible,Number(body.sort_order??body.sortOrder??before.sort_order)||0,publicVisible,fragmentId),
      database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(publicVisible?"public":"internal",publicVisible,fragmentId),
      ...(publicVisible?[database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline',updated_at=datetime('now') WHERE id=?").bind(before.derivative_media_id)]:[]),
    ])}catch(error){return failure(/archive_blackboard_fragments\.slug|UNIQUE constraint failed/i.test(String(error?.message||error))?"That fragment slug is already in use.":String(error?.message||error),409)}
    const record=(await blackboardFragmentAdminRecordsV3(database,{fragmentId}))[0];return json({record,fragment:record});
  }
  return failure("Method not allowed.",405);
}

async function archiveBlackboardFragmentsAdminApiV2(request,env,recordId,fragmentId="",action=""){
  return archiveBlackboardFragmentsGlobalAdminApi(request,env,fragmentId,action,recordId);
}

async function archiveBlackboardRecordsAdminApiV2(request,env,recordId="",action=""){
  const database=db(env);
  if(request.method==="GET"){const records=await blackboardRecordAdminPayloadV2(database,recordId);if(recordId&&!records)return failure("Blackboard record not found.",404);return json(recordId?{record:records}:{records,count:records.length})}
  if(request.method==="POST"&&!recordId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const title=text(body.title,300),archiveSlug=slug(body.slug??body.archive_slug??body.archiveSlug??title);if(!title||!archiveSlug)return failure("A Blackboard title and slug are required.",409);
    if(await database.prepare("SELECT entity_id FROM archive_dossiers WHERE archive_slug=?").bind(archiveSlug).first())return failure("That Archive slug is already in use.",409);
    const newId=text(body.id,200)||id("archive-blackboard"),versionId=id("archive-version"),stateId=id("archive-state"),type=await database.prepare("SELECT medium_id,catalogue_prefix FROM archive_cultural_object_types WHERE id='other-blackboard'").first(),number=await nextArchiveCatalogueNumber(database,type.catalogue_prefix),catalogueId=`${type.catalogue_prefix}-${String(number).padStart(3,"0")}`;
    const occurredAt=text(body.occurred_at??body.occurredAt,80)||null,dateLabel=text(body.date_label??body.dateLabel,160),datePrecision=occurredAt?"exact":"undated";
    await database.batch([
      database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_record','archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(newId),
      database.prepare("INSERT INTO archive_records(id,slug,title,node_label,record_type,room,date_or_period,timeline_period,summary,body,record_status,state,created_at,updated_at) VALUES(?,?,?,'The Six.Well Construct','blackboard','Studio',?,'',?,?,'active evolving Blackboard','draft',datetime('now'),datetime('now'))").bind(newId,archiveSlug,title,dateLabel,text(body.summary,5000),text(body.body,50000)),
      database.prepare("INSERT INTO archive_dossiers(entity_id,archive_slug,orientation,story,empty_materials_note,record_type,state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'blackboard','draft',0,'studio','studio',datetime('now'),datetime('now'))").bind(newId,archiveSlug,text(body.summary,8000),text(body.story??body.body,50000),"No Notebook materials are public yet."),
      database.prepare("INSERT INTO archive_catalogue_entries(entity_id,medium_id,object_type_id,catalogue_prefix,catalogue_number,catalogue_id,current_version,current_state,current_state_id,variant_label,created_by,updated_by,created_at,updated_at) VALUES(?,?,'other-blackboard',?,?,?,1,'I',?,'','studio','studio',datetime('now'),datetime('now'))").bind(newId,type.medium_id,type.catalogue_prefix,number,catalogueId,stateId),
      database.prepare("INSERT INTO archive_object_versions(id,entity_id,version_number,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,1,'Version 1','The first documented physical incarnation of this Blackboard.',?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))").bind(versionId,newId,occurredAt,datePrecision,dateLabel),
      database.prepare("INSERT INTO archive_object_states(id,version_id,state_roman,state_order,title,description,occurred_at,date_precision,date_label,sort_order,publication_state,public_visible,created_by,updated_by,created_at,updated_at) VALUES(?,?,'I',1,'State I','First documented complete Blackboard state',?,?,?,1,'draft',0,'studio','studio',datetime('now'),datetime('now'))").bind(stateId,versionId,occurredAt,datePrecision,dateLabel),
      database.prepare("INSERT INTO archive_blackboard_records(record_entity_id,studio_location,wall_designation,orientation_note,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))").bind(newId,text(body.studio_location??body.studioLocation,200),text(body.wall_designation??body.wallDesignation,120),text(body.orientation_note??body.orientationNote,1000),Number(body.sort_order??body.sortOrder)||0),
    ]);return json({record:await blackboardRecordAdminPayloadV2(database,newId)},{status:201});
  }
  const record=recordId?await blackboardRecordAdminPayloadV2(database,recordId):null;if(recordId&&!record)return failure("Blackboard record not found.",404);
  if(request.method==="POST"&&action==="publish"){
    const states=await blackboardStateRowsV2(database,recordId,false),ready=states.filter(state=>state.material_id&&state.master_media_id&&state.derivative_media_id);if(!ready.length)return failure("Attach a private master and public derivative to at least one state before publishing.",409);
    const statements=[
      database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(recordId),
      database.prepare("UPDATE archive_records SET state='published',record_status='active evolving Blackboard',updated_at=datetime('now') WHERE id=?").bind(recordId),
      database.prepare("UPDATE archive_dossiers SET state='published',public_visible=1,published_at=COALESCE(published_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(recordId),
    ];
    const versions=[...new Set(ready.map(state=>state.version_id))];for(const versionId of versions)statements.push(database.prepare("UPDATE archive_object_versions SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(versionId));
    for(const state of ready)statements.push(database.prepare("UPDATE archive_object_states SET publication_state='published',public_visible=1,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(state.id),database.prepare("UPDATE archive_materials SET state='published',visibility='public',updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(state.material_id));
    await database.batch(statements);return json({record:await blackboardRecordAdminPayloadV2(database,recordId)});
  }
  if(request.method==="POST"&&action==="scan"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const attached=await attachBlackboardStateMediaV2(database,recordId,record.current_state_id,body);if(attached instanceof Response)return attached;return json({record:await blackboardRecordAdminPayloadV2(database,recordId)});
  }
  if(request.method==="PATCH"){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");const title=text(body.title??record.title,300),archiveSlug=slug(body.slug??record.slug),summary=text(body.summary??record.summary,8000),state=text(body.state??record.state,30),requested=body.public_visible===undefined&&body.publicVisible===undefined?Number(record.public_visible):truthy(body.public_visible??body.publicVisible),publicVisible=state==="published"&&requested?1:0;
    await database.batch([
      database.prepare("UPDATE archive_records SET slug=?,title=?,summary=?,state=?,updated_at=datetime('now') WHERE id=?").bind(archiveSlug,title,summary,state,recordId),
      database.prepare("UPDATE archive_dossiers SET archive_slug=?,orientation=?,state=?,public_visible=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(archiveSlug,summary,state,publicVisible,recordId),
      database.prepare("UPDATE archive_blackboard_records SET studio_location=?,wall_designation=?,orientation_note=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE record_entity_id=?").bind(text(body.studio_location??body.studioLocation??record.studio_location,200),text(body.wall_designation??body.wallDesignation??record.wall_designation,120),text(body.orientation_note??body.orientationNote??record.orientation_note,1000),Number(body.sort_order??body.sortOrder??record.sort_order)||0,recordId),
      database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(publicVisible?"public":"internal",publicVisible,recordId),
    ]);return json({record:await blackboardRecordAdminPayloadV2(database,recordId)});
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

function normalizeArchiveTimeline(body,existing={}){const state=text(body.state??existing.state,30)||"draft";return {subject_entity_id:text(body.subject_entity_id??body.subjectEntityId??existing.subject_entity_id,200),slug:slug(body.slug??existing.slug),title:text(body.title??existing.title,300),description:text(body.description??existing.description,8000),state,public_visible:publicationPublicFlag(state),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}
function normalizeArchiveChapter(body,existing={}){const occurredAt=text(body.occurred_at??body.start_date??body.start??existing.occurred_at,80)||null,state=text(body.state??existing.state,30)||"draft";return {title:text(body.title??existing.title,300),summary:text(body.summary??existing.summary,5000),body:text(body.body??body.inline_text??body.inlineText??existing.body,50000),occurred_at:occurredAt,ended_at:text(body.ended_at??body.end_date??body.end??existing.ended_at,80)||null,date_precision:text(body.date_precision??body.datePrecision??existing.date_precision,30)||(occurredAt?"exact":"undated"),date_label:text(body.date_label??body.display_date??body.displayDate??existing.date_label,160),anchor_slug:slug(body.anchor_slug??body.anchor??existing.anchor_slug),dedupe_key:text(body.dedupe_key??body.dedupeKey??existing.dedupe_key,200),state,public_visible:publicationPublicFlag(state),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}

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

function normalizeOriginThread(body,existing={}){const state=text(body.state??existing.state,30)||"draft";return {slug:slug(body.slug??existing.slug),title:text(body.title??existing.title,300),summary:text(body.summary??existing.summary,8000),state,public_visible:publicationPublicFlag(state),sort_order:Number(body.sort_order??body.sortOrder??existing.sort_order)||0};}

async function entityOriginThreadPayload(database,entityId){
  const entity=await database.prepare("SELECT id,entity_type,node_id,visibility FROM content_entities WHERE id=?").bind(entityId).first();
  if(!entity)return null;
  const records=(await database.prepare(`SELECT ot.*,CASE WHEN ote.entity_id IS NULL THEN 0 ELSE 1 END assigned,
    COALESCE(ote.is_primary,0) is_primary,ote.sort_order assignment_sort_order
    FROM archive_origin_threads ot
    LEFT JOIN archive_origin_thread_entities ote ON ote.thread_id=ot.id AND ote.entity_id=?
    ORDER BY CASE WHEN ote.entity_id IS NULL THEN 1 ELSE 0 END,ote.is_primary DESC,ote.sort_order,ot.sort_order,ot.title`).bind(entityId).all()).results||[];
  const assigned=records.filter(record=>Number(record.assigned));
  return {entity,records,origin_threads:records,origin_thread_ids:assigned.map(record=>record.id),primary_origin_thread_id:assigned.find(record=>Number(record.is_primary))?.id||""};
}

async function entityOriginThreadsAdminApi(request,env,entityId){
  const database=db(env),current=await entityOriginThreadPayload(database,entityId);
  if(!current)return failure("Entity not found.",404);
  if(request.method==="GET")return json(current);
  if(request.method!=="PUT")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const requestedIds=originThreadIds(body.origin_thread_ids??body.originThreadIds),primaryId=text(body.primary_origin_thread_id??body.primaryOriginThreadId,200);
  if(primaryId&&!requestedIds.includes(primaryId))return failure("Choose the primary thread as an entity assignment first.",409);
  const activeRows=requestedIds.length?(await database.prepare(`SELECT id FROM archive_origin_threads WHERE state<>'archived' AND id IN (${requestedIds.map(()=>"?").join(",")})`).bind(...requestedIds).all()).results||[]:[];
  if(activeRows.length!==requestedIds.length)return failure("Choose valid, active origin threads.",409);
  const archivedAssignments=(await database.prepare(`SELECT ote.thread_id FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id WHERE ote.entity_id=? AND ot.state='archived' ORDER BY ote.sort_order,ot.sort_order,ot.title`).bind(entityId).all()).results||[];
  const finalIds=[...requestedIds,...archivedAssignments.map(record=>record.thread_id).filter(id=>!requestedIds.includes(id))];
  await replaceEntityOriginThreads(database,entityId,finalIds,primaryId);
  return json(await entityOriginThreadPayload(database,entityId));
}

async function archiveOriginThreadsAdminApi(request,env,threadId=""){
  const database=db(env);
  if(request.method==="GET"){
    const where=threadId?"WHERE ot.id=?":"";const statement=database.prepare(`SELECT ot.*,
      (SELECT COUNT(*) FROM archive_origin_thread_entities ote WHERE ote.thread_id=ot.id) entity_count,
      (SELECT COUNT(*) FROM archive_origin_thread_entities ote WHERE ote.thread_id=ot.id) dossier_count,
      (SELECT COUNT(*) FROM archive_origin_thread_entities ote JOIN archive_dossiers ad ON ad.entity_id=ote.entity_id WHERE ote.thread_id=ot.id) archive_dossier_count,
      (SELECT COUNT(*) FROM archive_origin_thread_materials otm WHERE otm.thread_id=ot.id) material_count
      FROM archive_origin_threads ot ${where} ORDER BY ot.sort_order,ot.title`);const result=threadId?await statement.bind(threadId).all():await statement.all();const records=result.results||[];if(threadId&&!records[0])return failure("Origin thread not found.",404);return json(threadId?{record:records[0],origin_thread:records[0]}:{records,origin_threads:records,count:records.length});
  }
  if(request.method==="POST"&&!threadId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const thread=normalizeOriginThread(body);if(!thread.slug||!thread.title||!ARCHIVE_STATES.has(thread.state))return failure("Slug, title, and a valid state are required.");const newId=text(body.id,200)||id("origin-thread");await database.prepare("INSERT INTO archive_origin_threads(id,slug,title,summary,state,public_visible,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))").bind(newId,thread.slug,thread.title,thread.summary,thread.state,thread.public_visible,thread.sort_order).run();return json({record:await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(newId).first()},{status:201});}
  if(request.method==="PATCH"&&threadId){const body=await readJson(request);if(!body)return failure("Send a JSON object.");const before=await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(threadId).first();if(!before)return failure("Origin thread not found.",404);const thread=normalizeOriginThread(body,before);if(!thread.slug||!thread.title||!ARCHIVE_STATES.has(thread.state))return failure("Slug, title, and a valid state are required.");await database.prepare("UPDATE archive_origin_threads SET slug=?,title=?,summary=?,state=?,public_visible=?,sort_order=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(thread.slug,thread.title,thread.summary,thread.state,thread.public_visible,thread.sort_order,threadId).run();return json({record:await database.prepare("SELECT * FROM archive_origin_threads WHERE id=?").bind(threadId).first()});}
  if(request.method==="DELETE"&&threadId){const found=await database.prepare("SELECT id FROM archive_origin_threads WHERE id=?").bind(threadId).first();if(!found)return failure("Origin thread not found.",404);await database.prepare("UPDATE archive_origin_threads SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(threadId).run();return json({ok:true,archived:true});}
  return failure("Method not allowed.",405);
}

function normalizeFailedExperiment(body,existing={}){
  const rawOccurredAt=text(body.occurred_at??body.occurredAt??existing.occurred_at,80)||null;
  const datePrecision=text(body.date_precision??body.datePrecision??existing.date_precision,30)||(rawOccurredAt?"exact":"undated");
  const occurredAt=datePrecision==="undated"?null:rawOccurredAt;
  const endedAt=datePrecision==="undated"?null:(text(body.ended_at??body.endedAt??existing.ended_at,80)||null);
  return {
    entity_id:text(body.entity_id??body.entityId??body.id??existing.entity_id,200),
    node_id:text(body.node_id??body.nodeId??body.medium??existing.node_id,80)||"other",
    slug:slug(body.slug??existing.slug??body.title),
    title:text(body.title??existing.title,300),
    public_note:text(body.public_note??body.publicNote??body.summary??existing.public_note,3000),
    expanded_context:text(body.expanded_context??body.expandedContext??body.body??existing.expanded_context,50000),
    learning:text(body.learning??existing.learning,20000),
    experiment_kind:text(body.experiment_kind??body.experimentKind??body.kind??existing.experiment_kind,40)||"other",
    result:text(body.result??existing.result,40),
    afterlife:text(body.afterlife??existing.afterlife,40)||"none",
    process_phase:text(body.process_phase??body.processPhase??existing.process_phase,160),
    occurred_at:occurredAt,
    ended_at:endedAt,
    date_precision:datePrecision,
    date_label:text(body.date_label??body.dateLabel??existing.date_label,160),
    state:text(body.state??existing.state,30)||"draft",
  };
}

function validFailedExperimentDate(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

function validateFailedExperimentRecord(record){
  if(!record.title||!record.slug||!record.result)return "Title, slug, and result are required.";
  if(!ARCHIVE_FAILED_EXPERIMENT_MEDIA.has(record.node_id))return "Choose an existing Archive medium.";
  if(!ARCHIVE_FAILED_EXPERIMENT_KINDS.has(record.experiment_kind))return "Choose a valid experiment kind.";
  if(!ARCHIVE_FAILED_EXPERIMENT_RESULTS.has(record.result))return "Choose a valid original result.";
  if(!ARCHIVE_FAILED_EXPERIMENT_AFTERLIVES.has(record.afterlife))return "Choose a valid afterlife.";
  if(!ARCHIVE_DATE_PRECISIONS.has(record.date_precision))return "Choose a valid date precision.";
  if(!ARCHIVE_STATES.has(record.state))return "Choose a valid publication state.";
  if(record.date_precision!=="undated"&&!record.occurred_at)return "Choose a start date for this date precision.";
  if(record.occurred_at&&!validFailedExperimentDate(record.occurred_at))return "Choose a valid start date in YYYY-MM-DD format.";
  if(record.ended_at&&!validFailedExperimentDate(record.ended_at))return "Choose a valid end date in YYYY-MM-DD format.";
  if(record.date_precision==="range"&&(!record.occurred_at||!record.ended_at))return "A date range needs both a start and end date.";
  if(record.ended_at&&record.occurred_at&&record.ended_at<record.occurred_at)return "The end date cannot precede the start date.";
  return "";
}

function failedExperimentHasPublicText(record){
  return Boolean(String(record?.public_note||"").trim());
}

function failedExperimentMediaEligible(row){
  return row?.media_state==="active"
    && row.media_privacy==="public"
    && row.media_presentation==="inline"
    && Number(row.public_visible)===1;
}

function failedExperimentMediaAccessible(row){
  const mime=String(row?.mime_type||"").toLowerCase();
  const alt=String(row?.resolved_alt_text??row?.alt_text_override??row?.alt_text??"").trim();
  const caption=String(row?.resolved_caption??row?.caption_override??row?.caption??"").trim();
  const publicDescription=String(row?.public_description||"").trim();
  const publicTitle=String(row?.public_title||"").trim();
  const transcript=String(row?.transcript||"").trim();
  if(mime.startsWith("image/"))return Boolean(alt);
  if(mime.startsWith("audio/")||mime.startsWith("video/"))return Boolean(caption||publicDescription||transcript);
  return Boolean(caption||publicTitle);
}

async function failedExperimentAttachmentRows(database,entityId){
  const result=await database.prepare(`SELECT em.*,m.state media_state,m.privacy media_privacy,
      m.public_presentation media_presentation,
      m.mime_type,m.alt_text,m.caption,m.public_title,m.public_description,m.transcript,
      m.original_filename,m.source_url,m.storage_key,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) resolved_alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) resolved_caption
    FROM entity_media em JOIN media_assets m ON m.id=em.media_id
    WHERE em.entity_id=?
    ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(entityId).all();
  return result.results||[];
}

async function validateFailedExperimentPublication(database,record,entityId){
  if(record.state!=="published")return "";
  const attachments=await failedExperimentAttachmentRows(database,entityId);
  const publicAttachments=attachments.filter(item=>Number(item.public_visible)===1);
  if(publicAttachments.some(item=>!failedExperimentMediaEligible(item)))return "Every public evidence item must be active, public, and inline.";
  if(publicAttachments.some(item=>!failedExperimentMediaAccessible(item)))return "Every public evidence item needs accessible alt text or visitor-facing context.";
  if(!failedExperimentHasPublicText(record)&&!publicAttachments.length)return "Add a short public note or one eligible public evidence item before publishing.";
  return "";
}

async function failedExperimentPublicMedia(database,entityIds){
  if(!entityIds.length)return new Map();
  const result=await database.prepare(`SELECT em.entity_id,em.role,em.sort_order,m.id,m.source_url,m.storage_key,m.mime_type,m.original_filename,
      COALESCE(NULLIF(em.alt_text_override,''),m.alt_text) alt_text,
      COALESCE(NULLIF(em.caption_override,''),m.caption) caption,m.public_title,m.public_description,m.transcript
    FROM entity_media em JOIN media_assets m ON m.id=em.media_id
    WHERE em.entity_id IN (${entityIds.map(()=>"?").join(",")}) AND em.public_visible=1
      AND m.state='active' AND m.privacy='public'
      AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
      AND (
        (m.mime_type LIKE 'image/%' AND trim(COALESCE(NULLIF(em.alt_text_override,''),m.alt_text))<>'')
        OR ((m.mime_type LIKE 'audio/%' OR m.mime_type LIKE 'video/%') AND trim(COALESCE(NULLIF(em.caption_override,''),NULLIF(m.caption,''),NULLIF(m.public_description,''),NULLIF(m.transcript,'')))<>'')
        OR (m.mime_type NOT LIKE 'image/%' AND m.mime_type NOT LIKE 'audio/%' AND m.mime_type NOT LIKE 'video/%' AND trim(COALESCE(NULLIF(em.caption_override,''),NULLIF(m.caption,''),NULLIF(m.public_title,'')))<>'')
      )
    ORDER BY em.entity_id,CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(...entityIds).all();
  const map=new Map();
  for(const row of result.results||[]){
    if(!map.has(row.entity_id))map.set(row.entity_id,[]);
    const isRecording=String(row.mime_type||"").startsWith("audio/")||String(row.mime_type||"").startsWith("video/");
    map.get(row.entity_id).push({id:row.id,role:row.role,sort_order:Number(row.sort_order)||0,url:row.source_url||`/api/construct/entity-media/${encodeURIComponent(row.id)}`,alt:row.alt_text||"",title:row.public_title||row.original_filename||"",caption:row.caption||row.public_description||"",transcript:isRecording?(row.transcript||""):"",mimeType:row.mime_type||""});
  }
  return map;
}

function failedExperimentPublicPredicate(){
  return `afe.state='published' AND ce.visibility='public' AND (
    trim(afe.public_note)<>'' OR EXISTS(
      SELECT 1 FROM entity_media public_em JOIN media_assets public_m ON public_m.id=public_em.media_id
      WHERE public_em.entity_id=afe.entity_id AND public_em.public_visible=1
        AND public_m.state='active' AND public_m.privacy='public' AND public_m.public_presentation='inline'
        AND ${mediaIsNotVariantMasterSql("public_m")}
        AND (
          (public_m.mime_type LIKE 'image/%' AND trim(COALESCE(NULLIF(public_em.alt_text_override,''),public_m.alt_text))<>'')
          OR ((public_m.mime_type LIKE 'audio/%' OR public_m.mime_type LIKE 'video/%') AND trim(COALESCE(NULLIF(public_em.caption_override,''),NULLIF(public_m.caption,''),NULLIF(public_m.public_description,''),NULLIF(public_m.transcript,'')))<>'')
          OR (public_m.mime_type NOT LIKE 'image/%' AND public_m.mime_type NOT LIKE 'audio/%' AND public_m.mime_type NOT LIKE 'video/%' AND trim(COALESCE(NULLIF(public_em.caption_override,''),NULLIF(public_m.caption,''),NULLIF(public_m.public_title,'')))<>'')
        )
    )
  )`;
}

function failedExperimentRoute(record){return `/archive/failed-experiments/${encodeURIComponent(record.slug)}/`;}

function presentFailedExperiment(record,media=[]){
  return {
    ...record,
    id:record.entity_id,
    kind:record.experiment_kind,
    medium:record.node_id,
    route:failedExperimentRoute(record),
    media,
    cover_media:media.find(item=>String(item.mimeType||"").startsWith("image/"))||media[0]||null,
  };
}

async function syncFailedExperimentVisibility(database,entityId){
  const record=await database.prepare(`SELECT afe.*,ce.node_id FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE afe.entity_id=?`).bind(entityId).first();
  if(!record)return;
  const attachments=await failedExperimentAttachmentRows(database,entityId);
  const hasEvidence=attachments.some(item=>failedExperimentMediaEligible(item)&&failedExperimentMediaAccessible(item));
  const visible=record.state==="published"&&(failedExperimentHasPublicText(record)||hasEvidence);
  await database.prepare(`UPDATE content_entities SET visibility=?,search_visibility=?,
      archived_at=CASE WHEN ?='archived' THEN COALESCE(archived_at,datetime('now')) ELSE NULL END,
      public_at=CASE WHEN ?=1 THEN COALESCE(public_at,datetime('now')) ELSE public_at END,
      updated_by='studio',updated_at=datetime('now') WHERE id=?`)
    .bind(visible?"public":"internal",visible?1:0,record.state,visible?1:0,entityId).run();
  if(!visible){await database.prepare("DELETE FROM search_documents WHERE entity_id=?").bind(entityId).run();return;}
  const fields=["entity_id","entity_type","node_id","slug","title","summary","body","state","collection_labels","theme_labels","person_labels","place_labels","date_label","route"];
  const publicMediaText=attachments.filter(item=>failedExperimentMediaEligible(item)&&failedExperimentMediaAccessible(item)).flatMap(item=>[item.resolved_alt_text,item.resolved_caption,item.public_title,item.public_description]).map(value=>String(value||"").trim()).filter(Boolean);
  const authoredBody=[record.expanded_context,record.learning,record.experiment_kind,record.result,record.afterlife,record.process_phase,...new Set(publicMediaText)].filter(Boolean).join(" ");
  const document={entity_id:entityId,entity_type:"archive_failed_experiment",node_id:record.node_id,slug:record.slug,title:record.title,summary:record.public_note,body:authoredBody,state:"published",collection_labels:"",theme_labels:"",person_labels:"",place_labels:"",date_label:record.date_label||"",route:failedExperimentRoute(record)};
  await database.prepare(`INSERT INTO search_documents(${fields.join(",")},updated_at) VALUES(${fields.map(()=>"?").join(",")},datetime('now'))
    ON CONFLICT(entity_id) DO UPDATE SET ${fields.slice(1).map(field=>`${field}=excluded.${field}`).join(",")},updated_at=datetime('now')`)
    .bind(...fields.map(field=>document[field])).run();
}

async function syncFailedExperimentsForMedia(database,mediaId){
  const rows=(await database.prepare(`SELECT DISTINCT em.entity_id FROM entity_media em JOIN archive_failed_experiments afe ON afe.entity_id=em.entity_id WHERE em.media_id=?`).bind(mediaId).all()).results||[];
  for(const row of rows)await syncFailedExperimentVisibility(database,row.entity_id);
}

async function loadFailedExperimentStateLinks(database,entityId,{publicOnly=false}={}){
  const visibility=publicOnly?`AND er.public_visible=1 AND rt.public_visible=1 AND owner.visibility='public' AND state.publication_state='published' AND state.public_visible=1 AND version.publication_state='published' AND version.public_visible=1`:"";
  const result=await database.prepare(`SELECT link.relationship_id,link.state_id,link.created_at,
      state.state_roman,state.title state_title,state.variant_label,state.date_label state_date_label,
      version.entity_id owner_entity_id,version.version_number,catalogue.catalogue_id
    FROM archive_failed_experiment_state_links link
    JOIN entity_relationships er ON er.id=link.relationship_id
    JOIN relationship_types rt ON rt.id=er.relationship_type_id
    JOIN archive_object_states state ON state.id=link.state_id
    JOIN archive_object_versions version ON version.id=state.version_id
    JOIN content_entities owner ON owner.id=version.entity_id
    LEFT JOIN archive_catalogue_entries catalogue ON catalogue.entity_id=version.entity_id
    WHERE (er.source_entity_id=? OR er.target_entity_id=?) ${visibility}
    ORDER BY er.sort_order,link.created_at`).bind(entityId,entityId).all();
  return result.results||[];
}

async function publicFailedExperimentRelationships(database,entityId){
  const rows=(await database.prepare(`SELECT er.id,er.source_entity_id,er.target_entity_id,er.relationship_type_id,er.sort_order,
      rt.slug relationship_slug,rt.forward_label,rt.reverse_label
    FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id
    WHERE er.public_visible=1 AND rt.public_visible=1 AND (er.source_entity_id=? OR er.target_entity_id=?)
    ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId).all()).results||[];
  const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));
  return rows.flatMap(row=>{
    const outgoing=row.source_entity_id===entityId,related=entities.get(outgoing?row.target_entity_id:row.source_entity_id);
    if(!related||related.visibility!=="public"||!related.route)return [];
    return [{id:row.id,direction:outgoing?"outgoing":"incoming",label:outgoing?row.forward_label:row.reverse_label,relationshipType:{id:row.relationship_type_id,slug:row.relationship_slug},related,sortOrder:Number(row.sort_order)||0}];
  });
}

async function failedExperimentFacets(database){
  const predicate=failedExperimentPublicPredicate();
  const [mediumResult,phaseResult,kindResult,resultResult,afterlifeResult]=await Promise.all([
    database.prepare(`SELECT ce.node_id value,COALESCE(acm.label,ce.node_id) label,COUNT(*) count FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id LEFT JOIN archive_catalogue_media acm ON acm.id=ce.node_id WHERE ${predicate} GROUP BY ce.node_id,acm.label ORDER BY acm.sort_order,acm.label`).all(),
    database.prepare(`SELECT lower(trim(afe.process_phase)) value,MIN(afe.process_phase) label,COUNT(*) count FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE ${predicate} AND trim(afe.process_phase)<>'' GROUP BY lower(trim(afe.process_phase)) ORDER BY lower(trim(afe.process_phase))`).all(),
    database.prepare(`SELECT afe.experiment_kind value,afe.experiment_kind label,COUNT(*) count FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE ${predicate} GROUP BY afe.experiment_kind ORDER BY afe.experiment_kind`).all(),
    database.prepare(`SELECT afe.result value,afe.result label,COUNT(*) count FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE ${predicate} GROUP BY afe.result ORDER BY afe.result`).all(),
    database.prepare(`SELECT afe.afterlife value,afe.afterlife label,COUNT(*) count FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE ${predicate} GROUP BY afe.afterlife ORDER BY afe.afterlife`).all(),
  ]);
  const present=result=>(result.results||[]).map(row=>({...row,count:Number(row.count)||0}));
  return {medium:present(mediumResult),phase:present(phaseResult),kind:present(kindResult),result:present(resultResult),afterlife:present(afterlifeResult)};
}

async function publicFailedExperimentsApi(request,env,recordSlug=""){
  if(request.method!=="GET")return failure("Method not allowed.",405);
  const database=db(env),predicate=failedExperimentPublicPredicate();
  if(recordSlug){
    const record=await database.prepare(`SELECT afe.*,ce.node_id,acm.label medium_label FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id LEFT JOIN archive_catalogue_media acm ON acm.id=ce.node_id WHERE afe.slug=? AND ${predicate}`).bind(recordSlug).first();
    if(!record)return failure("Failed experiment not found.",404);
    const [mediaMap,relationships,stateLinks]=await Promise.all([failedExperimentPublicMedia(database,[record.entity_id]),publicFailedExperimentRelationships(database,record.entity_id),loadFailedExperimentStateLinks(database,record.entity_id,{publicOnly:true})]);
    const experiment=presentFailedExperiment(record,mediaMap.get(record.entity_id)||[]);
    return json({experiment,item:experiment,media:experiment.media,relationships,state_links:stateLinks},{cache:"no-store"});
  }
  const url=new URL(request.url),q=text(url.searchParams.get("q"),200).toLowerCase(),date=text(url.searchParams.get("date"),20),medium=text(url.searchParams.get("medium"),80),phase=text(url.searchParams.get("phase"),160),kind=text(url.searchParams.get("kind"),40),resultFilter=text(url.searchParams.get("result"),40),afterlife=text(url.searchParams.get("afterlife"),40);
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return failure("Use an exact date in YYYY-MM-DD format.");
  if(medium&&!ARCHIVE_FAILED_EXPERIMENT_MEDIA.has(medium))return failure("Invalid medium filter.");
  if(kind&&!ARCHIVE_FAILED_EXPERIMENT_KINDS.has(kind))return failure("Invalid kind filter.");
  if(resultFilter&&!ARCHIVE_FAILED_EXPERIMENT_RESULTS.has(resultFilter))return failure("Invalid result filter.");
  if(afterlife&&!ARCHIVE_FAILED_EXPERIMENT_AFTERLIVES.has(afterlife))return failure("Invalid afterlife filter.");
  const conditions=[predicate],values=[];
  if(q){conditions.push("(lower(COALESCE(afe.title,'')||' '||COALESCE(afe.public_note,'')||' '||COALESCE(afe.expanded_context,'')||' '||COALESCE(afe.learning,'')||' '||COALESCE(afe.process_phase,'')||' '||COALESCE(afe.date_label,'')) LIKE ? OR EXISTS(SELECT 1 FROM search_documents failed_search WHERE failed_search.entity_id=afe.entity_id AND lower(COALESCE(failed_search.title,'')||' '||COALESCE(failed_search.summary,'')||' '||COALESCE(failed_search.body,'')||' '||COALESCE(failed_search.date_label,'')) LIKE ?))");values.push(`%${q}%`,`%${q}%`)}
  if(date){conditions.push("((afe.date_precision='exact' AND substr(afe.occurred_at,1,10)=?) OR (afe.date_precision='range' AND substr(afe.occurred_at,1,10)<=? AND substr(COALESCE(afe.ended_at,afe.occurred_at),1,10)>=?))");values.push(date,date,date)}
  if(medium){conditions.push("ce.node_id=?");values.push(medium)}
  if(phase){conditions.push("lower(afe.process_phase)=lower(?)");values.push(phase)}
  if(kind){conditions.push("afe.experiment_kind=?");values.push(kind)}
  if(resultFilter){conditions.push("afe.result=?");values.push(resultFilter)}
  if(afterlife){conditions.push("afe.afterlife=?");values.push(afterlife)}
  const page=Math.max(1,Math.floor(Number(url.searchParams.get("page"))||1)),limit=24,offset=(page-1)*limit,where=conditions.join(" AND ");
  const [countRow,rowResult,facets]=await Promise.all([
    database.prepare(`SELECT COUNT(*) total FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE ${where}`).bind(...values).first(),
    database.prepare(`SELECT afe.*,ce.node_id,acm.label medium_label FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id LEFT JOIN archive_catalogue_media acm ON acm.id=ce.node_id WHERE ${where} ORDER BY CASE WHEN afe.date_precision='undated' OR afe.occurred_at IS NULL OR afe.occurred_at='' THEN 1 ELSE 0 END,afe.occurred_at DESC,afe.created_at DESC LIMIT ? OFFSET ?`).bind(...values,limit,offset).all(),
    failedExperimentFacets(database),
  ]);
  const rows=rowResult.results||[],media=await failedExperimentPublicMedia(database,rows.map(row=>row.entity_id)),items=rows.map(row=>presentFailedExperiment(row,media.get(row.entity_id)||[])),total=Number(countRow?.total)||0;
  return json({items,records:items,facets,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))},count:items.length},{cache:"no-store"});
}

async function failedExperimentAdminRelationships(database,entityId){
  const rows=(await database.prepare(`SELECT er.*,rt.slug relationship_slug,rt.forward_label,rt.reverse_label
    FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id
    WHERE er.source_entity_id=? OR er.target_entity_id=? ORDER BY er.sort_order,er.created_at`).bind(entityId,entityId).all()).results||[];
  const entities=await entityRecords(database,rows.flatMap(row=>[row.source_entity_id,row.target_entity_id]));
  return rows.map(row=>({...row,source:entities.get(row.source_entity_id)||null,target:entities.get(row.target_entity_id)||null}));
}

async function failedExperimentAdminPayload(database,entityId){
  const record=await database.prepare(`SELECT afe.*,afe.entity_id id,ce.node_id,ce.visibility,ce.search_visibility,ce.public_at,ce.archived_at
    FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE afe.entity_id=?`).bind(entityId).first();
  if(!record)return null;
  const [mediaMap,relationships,stateLinks]=await Promise.all([adminEntityMedia(database,[entityId]),failedExperimentAdminRelationships(database,entityId),loadFailedExperimentStateLinks(database,entityId)]);
  return {record:{...record,media:mediaMap.get(entityId)||[]},media:mediaMap.get(entityId)||[],relationships,state_links:stateLinks,relationship_defaults:{relationship_type_id:"rel-predecessor-of",public_visible:false}};
}

async function archiveFailedExperimentsAdminApi(request,env,entityId=""){
  const database=db(env);
  if(request.method==="GET"){
    if(entityId){const payload=await failedExperimentAdminPayload(database,entityId);return payload?json({...payload,experiment:payload.record}):failure("Failed experiment not found.",404)}
    const rows=(await database.prepare(`SELECT afe.*,afe.entity_id id,ce.node_id,ce.visibility,ce.search_visibility,
        (SELECT COUNT(*) FROM entity_media em WHERE em.entity_id=afe.entity_id) media_count,
        (SELECT COUNT(*) FROM entity_relationships er WHERE er.source_entity_id=afe.entity_id OR er.target_entity_id=afe.entity_id) relationship_count
      FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id
      ORDER BY CASE WHEN afe.date_precision='undated' OR afe.occurred_at IS NULL OR afe.occurred_at='' THEN 1 ELSE 0 END,afe.occurred_at DESC,afe.updated_at DESC`).all()).results||[];
    return json({records:rows,experiments:rows,count:rows.length});
  }
  const body=request.method==="DELETE"?{}:await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!entityId){
    const newId=text(body.id,200)||id("failed-experiment"),record=normalizeFailedExperiment({...body,entity_id:newId});record.entity_id=newId;
    const invalid=validateFailedExperimentRecord(record);if(invalid)return failure(invalid);
    const publicationProblem=await validateFailedExperimentPublication(database,record,newId);if(publicationProblem)return failure(publicationProblem,409);
    try{
      await database.batch([
        database.prepare(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at)
          VALUES(?,'archive_failed_experiment',?,'internal',0,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.node_id),
        database.prepare(`INSERT INTO archive_failed_experiments(entity_id,slug,title,public_note,expanded_context,learning,experiment_kind,result,afterlife,process_phase,occurred_at,ended_at,date_precision,date_label,state,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'studio','studio',datetime('now'),datetime('now'))`).bind(newId,record.slug,record.title,record.public_note,record.expanded_context,record.learning,record.experiment_kind,record.result,record.afterlife,record.process_phase,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.state),
      ]);
    }catch(error){return failure(/UNIQUE constraint failed.*slug/i.test(String(error?.message||error))?"That failed-experiment slug is already in use.":String(error?.message||error),/UNIQUE constraint failed/i.test(String(error?.message||error))?409:400)}
    await syncFailedExperimentVisibility(database,newId);
    const after=(await failedExperimentAdminPayload(database,newId)).record;await nextRevision(database,newId,"archive-failed-experiment-create",null,after);
    return json({record:after,experiment:after},{status:201});
  }
  const before=await database.prepare(`SELECT afe.*,ce.node_id,ce.visibility,ce.search_visibility FROM archive_failed_experiments afe JOIN content_entities ce ON ce.id=afe.entity_id WHERE afe.entity_id=?`).bind(entityId).first();
  if(!before)return failure("Failed experiment not found.",404);
  if(request.method==="DELETE"){
    await database.batch([
      database.prepare("UPDATE archive_failed_experiments SET state='archived',updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(entityId),
      database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=COALESCE(archived_at,datetime('now')),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(entityId),
      database.prepare("DELETE FROM search_documents WHERE entity_id=?").bind(entityId),
    ]);
    const after=await database.prepare("SELECT * FROM archive_failed_experiments WHERE entity_id=?").bind(entityId).first();await nextRevision(database,entityId,"archive-failed-experiment-archive",before,after);
    return json({ok:true,archived:true,record:{...after,id:entityId}});
  }
  if(request.method==="PATCH"){
    const record=normalizeFailedExperiment(body,before);record.entity_id=entityId;
    const invalid=validateFailedExperimentRecord(record);if(invalid)return failure(invalid);
    const publicationProblem=await validateFailedExperimentPublication(database,record,entityId);if(publicationProblem)return failure(publicationProblem,409);
    try{
      await database.batch([
        database.prepare("UPDATE content_entities SET node_id=?,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(record.node_id,entityId),
        database.prepare(`UPDATE archive_failed_experiments SET slug=?,title=?,public_note=?,expanded_context=?,learning=?,experiment_kind=?,result=?,afterlife=?,process_phase=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,state=?,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`)
          .bind(record.slug,record.title,record.public_note,record.expanded_context,record.learning,record.experiment_kind,record.result,record.afterlife,record.process_phase,record.occurred_at,record.ended_at,record.date_precision,record.date_label,record.state,entityId),
      ]);
    }catch(error){return failure(/UNIQUE constraint failed.*slug/i.test(String(error?.message||error))?"That failed-experiment slug is already in use.":String(error?.message||error),/UNIQUE constraint failed/i.test(String(error?.message||error))?409:400)}
    await syncFailedExperimentVisibility(database,entityId);
    const payload=await failedExperimentAdminPayload(database,entityId);await nextRevision(database,entityId,"archive-failed-experiment-update",before,payload.record);
    return json({...payload,experiment:payload.record});
  }
  return failure("Method not allowed.",405);
}

async function archiveFailedExperimentStateLinksAdminApi(request,env,entityId){
  const database=db(env),experiment=await database.prepare("SELECT entity_id FROM archive_failed_experiments WHERE entity_id=?").bind(entityId).first();if(!experiment)return failure("Failed experiment not found.",404);
  if(request.method==="GET"){const records=await loadFailedExperimentStateLinks(database,entityId);return json({records,state_links:records,count:records.length})}
  if(request.method!=="PATCH")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!Array.isArray(body?.links))return failure("links must be an array.");
  if(body.links.length>100)return failure("Choose at most 100 documented state links.",409);
  const links=[],seen=new Set();
  for(const item of body.links){
    const relationshipId=text(item?.relationship_id??item?.relationshipId,200),stateId=text(item?.state_id??item?.stateId,200);if(!relationshipId||!stateId)return failure("Every documented state link needs a relationship_id and state_id.",409);
    if(seen.has(relationshipId))return failure("Choose at most one documented state for each relationship.",409);seen.add(relationshipId);
    const match=await database.prepare(`SELECT er.id FROM entity_relationships er JOIN archive_object_states state ON state.id=? JOIN archive_object_versions version ON version.id=state.version_id
      WHERE er.id=? AND ((er.source_entity_id=? AND er.target_entity_id=version.entity_id) OR (er.target_entity_id=? AND er.source_entity_id=version.entity_id))`).bind(stateId,relationshipId,entityId,entityId).first();
    if(!match)return failure("A documented state must belong to the work at the other end of its experiment relationship.",409);
    links.push({relationship_id:relationshipId,state_id:stateId});
  }
  const statements=[database.prepare("DELETE FROM archive_failed_experiment_state_links WHERE relationship_id IN (SELECT id FROM entity_relationships WHERE source_entity_id=? OR target_entity_id=?)").bind(entityId,entityId),...links.map(item=>database.prepare("INSERT INTO archive_failed_experiment_state_links(relationship_id,state_id,created_at) VALUES(?,?,datetime('now'))").bind(item.relationship_id,item.state_id))];
  try{await database.batch(statements)}catch(error){return failure(String(error?.message||error),409)}
  const records=await loadFailedExperimentStateLinks(database,entityId);await nextRevision(database,entityId,"archive-failed-experiment-state-links",null,{links:records});
  return json({records,state_links:records,count:records.length});
}

async function archiveFailedExperimentMediaPairAdminApi(request,env,entityId){
  if(request.method!=="POST")return failure("Method not allowed.",405);
  const database=db(env),experiment=await database.prepare("SELECT entity_id,state FROM archive_failed_experiments WHERE entity_id=?").bind(entityId).first();if(!experiment)return failure("Failed experiment not found.",404);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const masterId=text(body.master_media_id??body.masterMediaId,200),derivativeId=text(body.derivative_media_id??body.derivativeMediaId,200),role=text(body.role,60)||"evidence",publicVisible=truthy(body.public_visible??body.publicVisible)?1:0;
  if(!masterId||!derivativeId||masterId===derivativeId)return failure("Choose distinct internal-master and public-derivative assets.");
  if(!["primary","evidence","document","audio-note","process-video"].includes(role))return failure("Choose a valid evidence role.");
  const [master,derivative]=await Promise.all([database.prepare("SELECT * FROM media_assets WHERE id=?").bind(masterId).first(),database.prepare("SELECT * FROM media_assets WHERE id=?").bind(derivativeId).first()]);
  if(!master||!derivative)return failure("One of the selected Digital Assets does not exist.",404);
  if(!String(master.mime_type||"").startsWith("image/")||!String(derivative.mime_type||"").startsWith("image/"))return failure("Image pairing requires two image assets.",409);
  if(master.state!=="active"||master.privacy!=="internal"||master.public_presentation!=="hidden")return failure("The archival master must be active, internal, and hidden.",409);
  const projected={...derivative,media_state:derivative.state,media_privacy:derivative.privacy,media_presentation:derivative.public_presentation,public_visible:publicVisible,resolved_alt_text:text(body.alt_text_override??derivative.alt_text,1000),resolved_caption:text(body.caption_override??derivative.caption,3000)};
  if(publicVisible&&(!failedExperimentMediaEligible(projected)||!failedExperimentMediaAccessible(projected)))return failure("Prepare an accessible, active, public, inline derivative before attaching it publicly.",409);
  const statements=[];if(role==="primary")statements.push(database.prepare("UPDATE entity_media SET role='evidence' WHERE entity_id=? AND role='primary' AND media_id<>?").bind(entityId,derivativeId));
  statements.push(
    database.prepare(`INSERT INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at) VALUES(?,?,'public-display','studio',datetime('now'),datetime('now')) ON CONFLICT(master_media_id,purpose) DO UPDATE SET derivative_media_id=excluded.derivative_media_id,updated_at=datetime('now')`).bind(masterId,derivativeId),
    database.prepare("INSERT OR REPLACE INTO entity_media(entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))").bind(entityId,derivativeId,role,Number(body.sort_order)||0,publicVisible,text(body.alt_text_override,1000),text(body.caption_override,3000)),
  );
  try{await database.batch(statements)}catch(error){return failure(String(error?.message||error),409)}
  await syncFailedExperimentVisibility(database,entityId);
  const attachment=await database.prepare("SELECT * FROM entity_media WHERE entity_id=? AND media_id=?").bind(entityId,derivativeId).first();await nextRevision(database,entityId,"archive-failed-experiment-media-pair",null,{master_media_id:masterId,derivative_media_id:derivativeId,attachment});
  return json({ok:true,record:attachment},{status:201});
}

const ARCHIVE_NOTE_STATES=new Set(["draft","published","archived"]);
const ARCHIVE_NOTE_ROLES=new Set(["inline-image","inline-document","source-provenance"]);
const ARCHIVE_NOTE_LINK_ROLES=new Set(["inception","development","reference","context"]);
const ARCHIVE_NOTE_TOKEN=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function archiveNotePlainText(markdown=""){
  return String(markdown||"")
    .replace(/\{\{asset:[a-z0-9-]+\}\}/gi," ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
    .replace(/^#{1,6}\s+/gm,"")
    .replace(/^\s*[-*+]\s+/gm,"")
    .replace(/[*_`~>]/g,"")
    .replace(/\s+/g," ").trim();
}

function archiveNoteTokens(markdown=""){
  return [...new Set([...String(markdown||"").matchAll(/\{\{asset:([a-z0-9-]+)\}\}/gi)].map(match=>match[1].toLowerCase()))];
}

function archiveNoteMediaEligible(row){
  return row&&row.state==="active"&&row.privacy==="public"&&row.public_presentation==="inline";
}

function archiveNoteRoute(slugValue){return `/archive/notes/${encodeURIComponent(slugValue)}/`}

function archiveNoteFrontmatterValue(value=""){
  const source=String(value||"").trim();if(!source)return"";
  if(/^[\[{\"]/.test(source)){try{return JSON.parse(source)}catch{}}
  return source.replace(/^'(.*)'$/,"$1");
}

function archiveNoteImportDocument(markdown=""){
  const source=String(markdown||"").replace(/\r\n?/g,"\n"),match=source.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/),frontmatter={};
  if(match)for(const line of match[1].split("\n")){const field=line.match(/^([a-zA-Z0-9_-]+):[ \t]*(.*)$/);if(field)frontmatter[field[1]]=archiveNoteFrontmatterValue(field[2])}
  return{frontmatter,body:match?source.slice(match[0].length):source};
}

function archiveNoteUniqueToken(filename,used){
  const withoutExtension=String(filename||"").replace(/\.[^.]+$/,""),base=slug(withoutExtension)||`attachment-${used.size+1}`;let token=base,suffix=2;
  while(used.has(token))token=`${base}-${suffix++}`;used.add(token);return token;
}

function archiveNoteImportPlan(body={}){
  const markdown=String(body.markdown??body.body_markdown??body.bodyMarkdown??"");
  if(!markdown||markdown.length>100000)return{error:"Choose a Markdown file no larger than 100,000 characters."};
  const document=archiveNoteImportDocument(markdown),front=document.frontmatter,filename=text(body.filename,500)||"archive-note.md",supplied=Array.isArray(body.attachments)?body.attachments.slice(0,100):[];
  const usedTokens=new Set(),seenNames=new Set(),attachments=supplied.map((item,index)=>{
    const name=text(item?.name??item?.filename,500),key=name.toLowerCase();if(!name||seenNames.has(key))throw new Error("Every imported attachment needs one unique filename.");seenNames.add(key);
    return{filename:name,mime_type:text(item?.mime_type??item?.mimeType??item?.type,200)||"application/octet-stream",token:"",referenced:false,alt_text:"",sort_order:index+1};
  }),byName=new Map(attachments.map(item=>[item.filename.toLowerCase(),item]));
  const bodyMarkdown=document.body.replace(/!\[([^\]]*)\]\((?:\.\/)?Attachments\/([^)]+)\)/gi,(whole,alt,encodedName)=>{
    let name=String(encodedName||"").trim();try{name=decodeURIComponent(name)}catch{}
    const attachment=byName.get(name.split(/[\\/]/).pop().toLowerCase());if(!attachment)return whole;
    if(!attachment.token)attachment.token=archiveNoteUniqueToken(attachment.filename,usedTokens);attachment.referenced=true;attachment.alt_text=attachment.alt_text||alt;return`{{asset:${attachment.token}}}`;
  });
  for(const attachment of attachments){if(!attachment.token)attachment.token=archiveNoteUniqueToken(attachment.filename,usedTokens);const image=attachment.mime_type.startsWith("image/");attachment.role=attachment.referenced&&image?"inline-image":"source-provenance";attachment.public_visible=Boolean(attachment.referenced&&image)}
  const title=text(body.title??front.title,300)||filename.replace(/\.md$/i,"")||"Imported Archive Note",links=Array.isArray(body.links)?body.links:(Array.isArray(front.links)?front.links:[]),originIds=Array.isArray(body.origin_thread_ids??body.originThreadIds)?(body.origin_thread_ids??body.originThreadIds):(Array.isArray(front.origin_threads)?front.origin_threads:[]);
  return{note:{title,slug:slug(body.slug??front.slug??title),note_type:text(body.note_type??body.noteType??front.note_type,80)||"concept-note",source_app:text(body.source_app??body.sourceApp??front.source,120)||"Obsidian",body_markdown:bodyMarkdown,excerpt:text(body.excerpt??front.excerpt,1000),source_created_at:text(body.source_created_at??body.sourceCreatedAt??front.source_created_at,80)||null,source_modified_at:text(body.source_modified_at??body.sourceModifiedAt??front.source_modified_at,80)||null,date_label:text(body.date_label??body.dateLabel??front.date_label,500),provenance_note:text(body.provenance_note??body.provenanceNote??front.provenance_note,3000),state:"draft",public_visible:false,links,origin_thread_ids:originIds,primary_origin_thread_id:text(body.primary_origin_thread_id??body.primaryOriginThreadId??front.primary_origin_thread,200)},attachments};
}

function presentArchiveNoteAsset(row,{admin=false}={}){
  const publicUrl=row.source_url||((row.storage_key&&row.public_visible)?`/api/construct/media/${encodeURIComponent(row.media_id)}`:"");
  return {
    id:row.id,note_entity_id:row.note_entity_id,noteEntityId:row.note_entity_id,media_id:row.media_id,mediaId:row.media_id,
    token:row.asset_token,asset_token:row.asset_token,role:row.role,sort_order:Number(row.sort_order||0),sortOrder:Number(row.sort_order||0),
    public_visible:Number(row.public_visible||0)===1,publicVisible:Number(row.public_visible||0)===1,
    alt_text:row.alt_text_override||row.alt_text||"",altText:row.alt_text_override||row.alt_text||"",
    caption:row.caption_override||row.caption||"",mime_type:row.mime_type||"",mimeType:row.mime_type||"",
    original_filename:row.original_filename||"",originalFilename:row.original_filename||"",byte_size:Number(row.byte_size||0),
    url:admin?`/api/admin/media/${encodeURIComponent(row.media_id)}/file`:publicUrl,
  };
}

async function archiveNoteAssets(database,noteEntityId,{publicOnly=false,admin=false}={}){
  const rows=(await database.prepare(`SELECT ana.*,m.source_url,m.storage_key,m.original_filename,m.mime_type,m.byte_size,
      m.alt_text,m.caption,m.privacy,m.state,m.public_presentation
    FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
    WHERE ana.note_entity_id=? ${publicOnly?`AND ana.public_visible=1 AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline' AND ${mediaIsNotVariantMasterSql("m")}`:""}
    ORDER BY ana.sort_order,ana.created_at,ana.id`).bind(noteEntityId).all()).results||[];
  return rows.map(row=>presentArchiveNoteAsset(row,{admin}));
}

async function archiveNoteLinks(database,noteEntityId,{publicOnly=false}={}){
  const rows=(await database.prepare(`SELECT anl.*,ce.entity_type,ce.visibility,sd.title,sd.route,
      COALESCE(aw.title,mi.title,ar.title,vs.name,spc.title,sd.title,anl.target_entity_id) target_title
    FROM archive_note_links anl JOIN content_entities ce ON ce.id=anl.target_entity_id
    LEFT JOIN search_documents sd ON sd.entity_id=anl.target_entity_id
    LEFT JOIN art_works aw ON aw.id=anl.target_entity_id
    LEFT JOIN merch_items mi ON mi.id=anl.target_entity_id
    LEFT JOIN archive_records ar ON ar.id=anl.target_entity_id
    LEFT JOIN visual_symbols vs ON vs.id=anl.target_entity_id
    LEFT JOIN special_project_calls spc ON spc.id=anl.target_entity_id
    WHERE anl.note_entity_id=? ${publicOnly?"AND anl.public_visible=1 AND ce.visibility='public'":""}
    ORDER BY anl.is_primary DESC,anl.sort_order,anl.created_at`).bind(noteEntityId).all()).results||[];
  return rows.map(row=>({
    target_entity_id:row.target_entity_id,targetEntityId:row.target_entity_id,title:row.target_title,
    entity_type:row.entity_type,entityType:row.entity_type,relationship_role:row.relationship_role,relationshipRole:row.relationship_role,
    is_primary:Number(row.is_primary||0)===1,isPrimary:Number(row.is_primary||0)===1,
    public_visible:Number(row.public_visible||0)===1,publicVisible:Number(row.public_visible||0)===1,
    sort_order:Number(row.sort_order||0),sortOrder:Number(row.sort_order||0),route:row.route||"",
  }));
}

async function archiveNoteOrigins(database,noteEntityId,{publicOnly=false}={}){
  const rows=(await database.prepare(`SELECT ot.id,ot.slug,ot.title,ot.summary,ote.is_primary,ote.sort_order,ot.state,ot.public_visible
    FROM archive_origin_thread_entities ote JOIN archive_origin_threads ot ON ot.id=ote.thread_id
    WHERE ote.entity_id=? ${publicOnly?"AND ot.state='published' AND ot.public_visible=1":""}
    ORDER BY ote.is_primary DESC,ote.sort_order,ot.sort_order,ot.title`).bind(noteEntityId).all()).results||[];
  return rows.map(row=>({...row,is_primary:Number(row.is_primary||0)===1,isPrimary:Number(row.is_primary||0)===1,sort_order:Number(row.sort_order||0),route:`/archive/?origin=${encodeURIComponent(row.slug)}`}));
}

function archiveNoteHistorySourceSignature(note){
  const source=[note.title,note.body_markdown,note.excerpt,note.source_created_at,note.source_modified_at,note.date_label].map(value=>String(value||"")).join("\u001f");let hash=2166136261;
  for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
  return `${source.length}:${(hash>>>0).toString(16)}`;
}

function presentArchiveNoteHistorySuggestion(row){
  const currentSignature=archiveNoteHistorySourceSignature({title:row.note_title,body_markdown:row.note_body_markdown,excerpt:row.note_excerpt,source_created_at:row.note_source_created_at,source_modified_at:row.note_source_modified_at,date_label:row.note_date_label});
  const stale=row.source_note_signature!==currentSignature;
  const authoritative=row.activity_id?{
    id:row.activity_id,activity_type:row.authoritative_activity_type||"",title:row.authoritative_title||"",
    summary:row.authoritative_summary||"",body:row.authoritative_body||"",occurred_at:row.authoritative_occurred_at||null,
    ended_at:row.authoritative_ended_at||null,date_precision:row.authoritative_date_precision||"undated",
    date_label:row.authoritative_date_label||"",public_visible:Number(row.authoritative_public_visible||0)===1,
    updated_at:row.authoritative_updated_at||null,
  }:null;
  return {
    id:row.id,note_entity_id:row.note_entity_id,noteEntityId:row.note_entity_id,target_entity_id:row.target_entity_id,targetEntityId:row.target_entity_id,
    target_title:row.target_title||row.target_entity_id,targetTitle:row.target_title||row.target_entity_id,activity_id:row.activity_id||null,activityId:row.activity_id||null,
    activity_type:row.activity_type,activityType:row.activity_type,title:row.title,summary:row.summary,body:row.body,
    occurred_at:row.occurred_at||null,occurredAt:row.occurred_at||null,ended_at:row.ended_at||null,endedAt:row.ended_at||null,
    date_precision:row.date_precision,datePrecision:row.date_precision,date_label:row.date_label,dateLabel:row.date_label,
    public_visible:Number(row.public_visible||0)===1,publicVisible:Number(row.public_visible||0)===1,status:row.status,
    source_note_updated_at:row.source_note_updated_at,sourceNoteUpdatedAt:row.source_note_updated_at,
    reviewed_by:row.reviewed_by||"",reviewedBy:row.reviewed_by||"",reviewed_at:row.reviewed_at||null,reviewedAt:row.reviewed_at||null,
    created_at:row.created_at,updated_at:row.updated_at,is_stale:stale,isStale:stale,authoritative,
  };
}

async function archiveNoteHistorySuggestions(database,noteEntityId){
  const rows=(await database.prepare(`SELECT suggestion.*,note.updated_at note_updated_at,note.title note_title,note.body_markdown note_body_markdown,
      note.excerpt note_excerpt,note.source_created_at note_source_created_at,note.source_modified_at note_source_modified_at,note.date_label note_date_label,
      COALESCE(art.title,merch.title,record.title,symbol.name,project.title,search.title,suggestion.target_entity_id) target_title,
      activity.activity_type authoritative_activity_type,activity.title authoritative_title,activity.summary authoritative_summary,
      activity.body authoritative_body,activity.occurred_at authoritative_occurred_at,activity.ended_at authoritative_ended_at,
      activity.date_precision authoritative_date_precision,activity.date_label authoritative_date_label,
      activity.public_visible authoritative_public_visible,activity.updated_at authoritative_updated_at
    FROM archive_note_history_suggestions suggestion
    JOIN archive_notes note ON note.entity_id=suggestion.note_entity_id
    LEFT JOIN entity_activity activity ON activity.id=suggestion.activity_id
    LEFT JOIN search_documents search ON search.entity_id=suggestion.target_entity_id
    LEFT JOIN art_works art ON art.id=suggestion.target_entity_id
    LEFT JOIN merch_items merch ON merch.id=suggestion.target_entity_id
    LEFT JOIN archive_records record ON record.id=suggestion.target_entity_id
    LEFT JOIN visual_symbols symbol ON symbol.id=suggestion.target_entity_id
    LEFT JOIN special_project_calls project ON project.id=suggestion.target_entity_id
    WHERE suggestion.note_entity_id=? ORDER BY suggestion.created_at,suggestion.id`).bind(noteEntityId).all()).results||[];
  return rows.map(presentArchiveNoteHistorySuggestion);
}

function presentArchiveNote(row){
  return {
    ...row,id:row.entity_id,entityId:row.entity_id,noteType:row.note_type,sourceApp:row.source_app,
    bodyMarkdown:row.body_markdown,sourceCreatedAt:row.source_created_at,sourceModifiedAt:row.source_modified_at,
    dateLabel:row.date_label,provenanceNote:row.provenance_note||"",publicVisible:Number(row.public_visible||0)===1,sortOrder:Number(row.sort_order||0),
    route:archiveNoteRoute(row.slug),preview_url:row.preview_url||"",previewUrl:row.preview_url||"",
  };
}

async function archiveNoteByKey(database,key,{publicOnly=false}={}){
  return database.prepare(`SELECT an.*,
      (SELECT COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
       FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
       WHERE ana.note_entity_id=an.entity_id AND ana.public_visible=1 AND ana.role='inline-image'
         AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
         AND ${mediaIsNotVariantMasterSql("m")}
       ORDER BY ana.sort_order,ana.created_at LIMIT 1) preview_url
    FROM archive_notes an JOIN content_entities ce ON ce.id=an.entity_id
    WHERE (an.entity_id=? OR an.slug=?) ${publicOnly?"AND an.state='published' AND an.public_visible=1 AND ce.visibility='public'":""}`).bind(key,key).first();
}

async function archiveNotePayload(database,row,{publicOnly=false,admin=false}={}){
  const [assets,links,originThreads,historySuggestions]=await Promise.all([
    archiveNoteAssets(database,row.entity_id,{publicOnly,admin}),archiveNoteLinks(database,row.entity_id,{publicOnly}),archiveNoteOrigins(database,row.entity_id,{publicOnly}),
    admin?archiveNoteHistorySuggestions(database,row.entity_id):Promise.resolve([]),
  ]);
  return {note:presentArchiveNote(row),record:presentArchiveNote(row),assets,links,origin_threads:originThreads,originThreads,history_suggestions:historySuggestions,historySuggestions};
}

async function validateArchiveNotePublication(database,note,assets=null,links=null){
  if(note.state!=="published"||!Number(note.public_visible))return;
  if(!note.title||!note.slug||!note.body_markdown)throw new Error("A public Note needs a title, stable slug, and Markdown body.");
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(note.slug))throw new Error("Use a lowercase, URL-safe Note slug.");
  if(/!\[[^\]]*\]\(\s*(?:https?:|\/\/|data:)/i.test(note.body_markdown))throw new Error("Public Note images must use managed asset tokens, not external image URLs.");
  if(/(?:javascript:|<\s*(?:script|iframe|object|embed|style)\b|\son[a-z]+\s*=)/i.test(note.body_markdown))throw new Error("The Note contains executable or unsupported markup.");
  const rows=assets||await archiveNoteAssets(database,note.entity_id,{admin:true});
  const byToken=new Map(rows.map(asset=>[asset.token,asset]));
  for(const token of archiveNoteTokens(note.body_markdown)){
    const asset=byToken.get(token);if(!asset)throw new Error(`The Note references missing asset token ${token}.`);
    if(!asset.public_visible)throw new Error(`Asset ${token} must be public before this Note can be published.`);
    const media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(asset.media_id).first();
    if(!archiveNoteMediaEligible(media))throw new Error(`Asset ${token} is not eligible for public inline presentation.`);
  }
  const authoredLinks=links||await archiveNoteLinks(database,note.entity_id);
  for(const link of authoredLinks.filter(item=>item.public_visible)){
    const target=await database.prepare("SELECT visibility FROM content_entities WHERE id=?").bind(link.target_entity_id).first();
    if(!target||target.visibility!=="public")throw new Error("Every public Note link must point to a public Construct entity.");
  }
}

async function syncArchiveNoteSearch(database,noteEntityId){
  const row=await archiveNoteByKey(database,noteEntityId);
  if(!row||row.state!=="published"||!Number(row.public_visible)){
    await database.batch([
      database.prepare("DELETE FROM search_documents WHERE entity_id=?").bind(noteEntityId),
      database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(noteEntityId),
    ]);return;
  }
  const captions=(await database.prepare(`SELECT COALESCE(NULLIF(ana.caption_override,''),m.caption) caption
    FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
    WHERE ana.note_entity_id=? AND ana.public_visible=1 AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
    ORDER BY ana.sort_order`).bind(noteEntityId).all()).results||[];
  const body=[archiveNotePlainText(row.body_markdown),row.provenance_note,...captions.map(item=>item.caption)].filter(Boolean).join("\n");
  await database.batch([
    database.prepare("UPDATE content_entities SET visibility='public',search_visibility=1,public_at=COALESCE(public_at,datetime('now')),archived_at=NULL,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(noteEntityId),
    database.prepare(`INSERT INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,collection_labels,theme_labels,person_labels,place_labels,date_label,route,updated_at)
      VALUES(?,'archive_note','archive',?,?,?,?, 'published','','','','',?,?,datetime('now'))
      ON CONFLICT(entity_id) DO UPDATE SET entity_type=excluded.entity_type,node_id=excluded.node_id,slug=excluded.slug,title=excluded.title,
        summary=excluded.summary,body=excluded.body,state=excluded.state,date_label=excluded.date_label,route=excluded.route,updated_at=excluded.updated_at`)
      .bind(row.entity_id,row.slug,row.title,row.excerpt||archiveNotePlainText(row.body_markdown).slice(0,320),body,row.date_label,archiveNoteRoute(row.slug)),
  ]);
}

function normalizedArchiveNote(body={},before={}){
  const next={
    entity_id:before.entity_id||text(body.entity_id??body.entityId,200),slug:slug(body.slug??before.slug),title:text(body.title??before.title,300),
    note_type:text(body.note_type??body.noteType??before.note_type??"concept-note",80)||"concept-note",source_app:text(body.source_app??body.sourceApp??before.source_app,120),
    body_markdown:text(body.body_markdown??body.bodyMarkdown??before.body_markdown,100000),excerpt:text(body.excerpt??before.excerpt,1000),
    source_created_at:text(body.source_created_at??body.sourceCreatedAt??before.source_created_at,80)||null,
    source_modified_at:text(body.source_modified_at??body.sourceModifiedAt??before.source_modified_at,80)||null,
    date_label:text(body.date_label??body.dateLabel??before.date_label,500),provenance_note:text(body.provenance_note??body.provenanceNote??before.provenance_note,3000),state:text(body.state??before.state??"draft",30),
    public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible||0):(body.public_visible??body.publicVisible)?1:0,
    sort_order:Number(body.sort_order??body.sortOrder??before.sort_order)||0,
  };
  if(!ARCHIVE_NOTE_STATES.has(next.state))throw new Error("Choose draft, published, or archived.");
  if(!next.slug||!next.title)throw new Error("A Note needs a title and URL-safe slug.");
  return next;
}

function normalizedArchiveNoteLinks(value,publicDefault=false){
  if(value===undefined)return null;if(!Array.isArray(value))throw new Error("Note links must be a list.");
  const records=value.slice(0,100).map((item,index)=>({
    target_entity_id:text(item?.target_entity_id??item?.targetEntityId??item,200),relationship_role:text(item?.relationship_role??item?.relationshipRole??"context",40),
    is_primary:(item?.is_primary??item?.isPrimary)?1:0,public_visible:item&&typeof item==="object"&&(item.public_visible!==undefined||item.publicVisible!==undefined)?(item.public_visible??item.publicVisible?1:0):(publicDefault?1:0),
    sort_order:Number(item?.sort_order??item?.sortOrder)||index+1,
  })).filter(item=>item.target_entity_id);
  if(records.some(item=>!ARCHIVE_NOTE_LINK_ROLES.has(item.relationship_role)))throw new Error("Choose a supported Note relationship role.");
  if(records.filter(item=>item.is_primary).length>1)throw new Error("A Note can have only one primary linked record.");
  return records;
}

async function replaceArchiveNoteLinks(database,noteEntityId,links){
  if(links===null)return;
  const ids=[...new Set(links.map(link=>link.target_entity_id))];
  if(ids.length){const count=await database.prepare(`SELECT COUNT(*) count FROM content_entities WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).first();if(Number(count?.count||0)!==ids.length)throw new Error("Choose registered Construct entities for every Note link.");}
  await database.batch([
    database.prepare("DELETE FROM archive_note_links WHERE note_entity_id=?").bind(noteEntityId),
    ...links.map(link=>database.prepare(`INSERT INTO archive_note_links(note_entity_id,target_entity_id,relationship_role,is_primary,sort_order,public_visible,created_at)
      VALUES(?,?,?,?,?,?,datetime('now'))`).bind(noteEntityId,link.target_entity_id,link.relationship_role,link.is_primary,link.sort_order,link.public_visible)),
  ]);
}

function inferredArchiveNoteHistory(note){
  const plain=archiveNotePlainText(note.body_markdown||"").trim(),occurredAt=text(note.source_created_at,80)||null;
  const firstParagraph=plain.split(/\n\s*\n/).map(value=>value.trim()).find(Boolean)||plain;
  return {
    activity_type:"milestone",title:text(note.title,300),summary:text(note.excerpt||firstParagraph,5000),body:text(plain,50000),
    occurred_at:occurredAt,ended_at:null,date_precision:occurredAt?"exact":"undated",date_label:text(note.date_label,160),public_visible:0,
  };
}

function normalizedArchiveNoteHistorySuggestion(body={},before={}){
  const occurredAt=text(body.occurred_at??body.occurredAt??before.occurred_at,80)||null;
  return {
    activity_type:text(body.activity_type??body.activityType??before.activity_type??"milestone",100)||"milestone",
    title:text(body.title??before.title,300),summary:text(body.summary??before.summary,5000),body:text(body.body??before.body,50000),
    occurred_at:occurredAt,ended_at:text(body.ended_at??body.endedAt??before.ended_at,80)||null,
    date_precision:text(body.date_precision??body.datePrecision??before.date_precision,30)||(occurredAt?"exact":"undated"),
    date_label:text(body.date_label??body.dateLabel??before.date_label,160),
    public_visible:body.public_visible===undefined&&body.publicVisible===undefined?Number(before.public_visible||0):((body.public_visible??body.publicVisible)?1:0),
  };
}

async function adminArchiveNoteHistorySuggestionsApi(request,env,noteEntityId,suggestionId=""){
  const database=db(env),note=await archiveNoteByKey(database,noteEntityId);if(!note)return failure("Archive Note not found.",404);
  if(note.note_type!=="journal-entry")return failure("Item History can be inferred only from a Journal moment.",409);
  if(request.method==="GET"&&!suggestionId)return json({records:await archiveNoteHistorySuggestions(database,note.entity_id)});
  if(request.method==="POST"&&!suggestionId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const targetEntityId=text(body.target_entity_id??body.targetEntityId,200);if(!targetEntityId)return failure("Choose the Archive record that this history would describe.");
    const target=await database.prepare(`SELECT dossier.entity_id FROM archive_note_links link
      JOIN archive_dossiers dossier ON dossier.entity_id=link.target_entity_id
      WHERE link.note_entity_id=? AND link.target_entity_id=?`).bind(note.entity_id,targetEntityId).first();
    if(!target)return failure("History can be suggested only for an Archive record already linked to this Journal moment.",409);
    const existing=await database.prepare("SELECT id FROM archive_note_history_suggestions WHERE note_entity_id=? AND target_entity_id=?").bind(note.entity_id,targetEntityId).first();
    if(existing)return failure("A history suggestion already exists for this Journal moment and Archive record.",409);
    const candidate=inferredArchiveNoteHistory(note),newId=text(body.id,200)||id("archive-note-history"),signature=archiveNoteHistorySourceSignature(note);
    await database.prepare(`INSERT INTO archive_note_history_suggestions
      (id,note_entity_id,target_entity_id,activity_type,title,summary,body,occurred_at,ended_at,date_precision,date_label,public_visible,status,source_note_updated_at,source_note_signature,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,datetime('now'),datetime('now'))`)
      .bind(newId,note.entity_id,targetEntityId,candidate.activity_type,candidate.title,candidate.summary,candidate.body,candidate.occurred_at,candidate.ended_at,candidate.date_precision,candidate.date_label,candidate.public_visible,note.updated_at,signature).run();
    const record=(await archiveNoteHistorySuggestions(database,note.entity_id)).find(item=>item.id===newId);return json({record},{status:201});
  }
  if(!suggestionId)return failure("Method not allowed.",405);
  const before=await database.prepare("SELECT * FROM archive_note_history_suggestions WHERE id=? AND note_entity_id=?").bind(suggestionId,note.entity_id).first();
  if(!before)return failure("History suggestion not found.",404);
  if(request.method!=="PATCH")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const action=text(body.action,30).toLowerCase()||"save",candidate=normalizedArchiveNoteHistorySuggestion(body,before),signature=archiveNoteHistorySourceSignature(note);
  if(!candidate.title||!candidate.summary||!ARCHIVE_DATE_PRECISIONS.has(candidate.date_precision))return failure("A history suggestion needs a title, summary, and valid date precision.");
  if(action==="reject"){
    await database.prepare("UPDATE archive_note_history_suggestions SET status='rejected',reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(before.id).run();
    return json({record:(await archiveNoteHistorySuggestions(database,note.entity_id)).find(item=>item.id===before.id)});
  }
  if(action==="save"){
    await database.prepare(`UPDATE archive_note_history_suggestions SET activity_type=?,title=?,summary=?,body=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,public_visible=?,status='pending',source_note_updated_at=?,source_note_signature=?,reviewed_by='',reviewed_at=NULL,updated_at=datetime('now') WHERE id=?`)
      .bind(candidate.activity_type,candidate.title,candidate.summary,candidate.body,candidate.occurred_at,candidate.ended_at,candidate.date_precision,candidate.date_label,candidate.public_visible,note.updated_at,signature,before.id).run();
    return json({record:(await archiveNoteHistorySuggestions(database,note.entity_id)).find(item=>item.id===before.id)});
  }
  if(!["approve","approve-replace"].includes(action))return failure("Choose save, approve, approve-replace, or reject.");
  if(before.activity_id&&action!=="approve-replace")return failure("Approved Item History is authoritative. Use Approve and replace to overwrite it deliberately.",409);
  if(!before.activity_id&&action==="approve-replace")return failure("There is no approved Item History record to replace.",409);
  const owner=await database.prepare(`SELECT entity.visibility,dossier.state dossier_state,dossier.public_visible dossier_public
    FROM content_entities entity JOIN archive_dossiers dossier ON dossier.entity_id=entity.id WHERE entity.id=?`).bind(before.target_entity_id).first();
  if(!owner)return failure("The linked Archive record is unavailable.",404);
  if(candidate.public_visible&&(owner.visibility!=="public"||owner.dossier_state!=="published"||!Number(owner.dossier_public)))return failure("Publish the canonical entity and dossier before approving public Item History.",409);
  const sourceNote=`Approved from Journal moment: ${note.title} (${archiveNoteRoute(note.slug)})`,activityId=before.activity_id||id("archive-activity");
  const beforeActivity=before.activity_id?await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(before.activity_id).first():null;
  if(before.activity_id&&(!beforeActivity||beforeActivity.entity_id!==before.target_entity_id))return failure("The linked authoritative Item History record is unavailable.",409);
  const activityStatement=beforeActivity
    ?database.prepare(`UPDATE entity_activity SET activity_type=?,title=?,occurred_at=?,ended_at=?,public_visible=?,summary=?,body=?,date_precision=?,date_label=?,source_note=?,updated_at=datetime('now') WHERE id=? AND entity_id=?`)
      .bind(candidate.activity_type,candidate.title,candidate.occurred_at,candidate.ended_at,candidate.public_visible,candidate.summary,candidate.body,candidate.date_precision,candidate.date_label,sourceNote,activityId,before.target_entity_id)
    :database.prepare(`INSERT INTO entity_activity
      (id,entity_id,activity_type,title,notes,occurred_at,ended_at,place_entity_id,public_visible,sort_order,created_by,created_at,updated_at,summary,body,date_precision,date_label,source_note)
      VALUES(?,?,?,?,'',?,?,NULL,?,0,'studio',datetime('now'),datetime('now'),?,?,?,?,?)`)
      .bind(activityId,before.target_entity_id,candidate.activity_type,candidate.title,candidate.occurred_at,candidate.ended_at,candidate.public_visible,candidate.summary,candidate.body,candidate.date_precision,candidate.date_label,sourceNote);
  await database.batch([
    activityStatement,
    database.prepare(`INSERT INTO entity_activity_subjects(activity_id,subject_entity_id,public_visible,sort_order,created_at)
      VALUES(?,?,?,1,datetime('now')) ON CONFLICT(activity_id,subject_entity_id) DO UPDATE SET public_visible=excluded.public_visible`).bind(activityId,before.target_entity_id,candidate.public_visible),
    database.prepare(`UPDATE archive_note_history_suggestions SET activity_id=?,activity_type=?,title=?,summary=?,body=?,occurred_at=?,ended_at=?,date_precision=?,date_label=?,public_visible=?,status='approved',source_note_updated_at=?,source_note_signature=?,reviewed_by='studio',reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .bind(activityId,candidate.activity_type,candidate.title,candidate.summary,candidate.body,candidate.occurred_at,candidate.ended_at,candidate.date_precision,candidate.date_label,candidate.public_visible,note.updated_at,signature,before.id),
  ]);
  const afterActivity=await database.prepare("SELECT * FROM entity_activity WHERE id=?").bind(activityId).first();await nextRevision(database,before.target_entity_id,"archive-note-history-approve",beforeActivity,afterActivity);
  return json({record:(await archiveNoteHistorySuggestions(database,note.entity_id)).find(item=>item.id===before.id),activity:afterActivity});
}

function archiveNoteExportFilename(asset,used){
  const original=String(asset.original_filename||asset.originalFilename||asset.token||"attachment").replace(/[^a-zA-Z0-9._-]/g,"-")||"attachment";let filename=original,suffix=2;
  while(used.has(filename.toLowerCase())){const dot=original.lastIndexOf(".");filename=dot>0?`${original.slice(0,dot)}-${suffix++}${original.slice(dot)}`:`${original}-${suffix++}`}
  used.add(filename.toLowerCase());return filename;
}

async function archiveNoteExportPayload(database,note){
  const payload=await archiveNotePayload(database,note,{admin:true}),used=new Set(),exported=payload.assets.filter(asset=>asset.public_visible&&asset.role!=="source-provenance").map(asset=>({...asset,export_filename:archiveNoteExportFilename(asset,used)}));
  let markdown=note.body_markdown;
  for(const asset of exported){const replacement=asset.mime_type.startsWith("image/")?`![${asset.alt_text||""}](Attachments/${asset.export_filename})`:`[${asset.export_filename}](Attachments/${asset.export_filename})`;markdown=markdown.replaceAll(`{{asset:${asset.token}}}`,replacement)}
  for(const asset of payload.assets.filter(asset=>!exported.some(item=>item.id===asset.id)))markdown=markdown.replaceAll(`{{asset:${asset.token}}}`,"");
  const frontmatter=["---",`id: ${JSON.stringify(note.entity_id)}`,`title: ${JSON.stringify(note.title)}`,`slug: ${JSON.stringify(note.slug)}`,`note_type: ${JSON.stringify(note.note_type)}`,`source: ${JSON.stringify(note.source_app||"")}`,`source_created_at: ${JSON.stringify(note.source_created_at||"")}`,`source_modified_at: ${JSON.stringify(note.source_modified_at||"")}`,`date_label: ${JSON.stringify(note.date_label||"")}`,`provenance_note: ${JSON.stringify(note.provenance_note||"")}`,`visibility: ${note.state==="published"&&Number(note.public_visible)?"public":"private"}`,`links: ${JSON.stringify(payload.links.map(link=>({target_entity_id:link.target_entity_id,relationship_role:link.relationship_role,is_primary:link.is_primary,public_visible:link.public_visible,sort_order:link.sort_order})))}`,`origin_threads: ${JSON.stringify(payload.origin_threads.map(origin=>origin.id))}`,`primary_origin_thread: ${JSON.stringify(payload.origin_threads.find(origin=>origin.is_primary)?.id||"")}`,"---",""].join("\n");
  return{filename:`${note.slug}.zip`,markdown_filename:`${note.slug}.md`,markdown:`${frontmatter}${markdown.trim()}\n`,attachments:exported.map(asset=>({token:asset.token,filename:asset.export_filename,mime_type:asset.mime_type,byte_size:asset.byte_size,download_url:asset.url}))};
}

async function adminArchiveNoteImportApi(request,env){
  if(request.method!=="POST")return failure("Method not allowed.",405);const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  try{const plan=archiveNoteImportPlan(body);if(plan.error)return failure(plan.error);const createRequest=new Request(request.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(plan.note)}),response=await adminArchiveNotesApi(createRequest,env),payload=await response.json();return json({...payload,import_plan:{attachments:plan.attachments}},{status:response.status})}catch(error){return failure(error.message,400)}
}

async function adminArchiveNoteExportApi(request,env,noteEntityId){
  if(request.method!=="GET")return failure("Method not allowed.",405);const database=db(env),note=await archiveNoteByKey(database,noteEntityId);if(!note)return failure("Archive Note not found.",404);return json(await archiveNoteExportPayload(database,note));
}

async function adminArchiveNoteLinksApi(request,env,noteEntityId){
  const database=db(env),note=await archiveNoteByKey(database,noteEntityId);if(!note)return failure("Archive Note not found.",404);
  if(request.method==="GET")return json({records:await archiveNoteLinks(database,note.entity_id)});
  if(!["PUT","PATCH"].includes(request.method))return failure("Method not allowed.",405);const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  try{const links=normalizedArchiveNoteLinks(Array.isArray(body)?body:body.links,note.public_visible);if(links===null)return failure("Send a links list.");await validateArchiveNotePublication(database,note,null,links);await replaceArchiveNoteLinks(database,note.entity_id,links);await syncArchiveNoteSearch(database,note.entity_id);return json({records:await archiveNoteLinks(database,note.entity_id)})}catch(error){return failure(error.message,/UNIQUE constraint failed/i.test(error.message)?409:400)}
}

async function publicArchiveNotesApi(request,env,key=""){
  if(request.method!=="GET")return failure("Method not allowed.",405);const database=db(env);
  if(key){const row=await archiveNoteByKey(database,key,{publicOnly:true});if(!row)return failure("Archive Note not found.",404);return json(await archiveNotePayload(database,row,{publicOnly:true}),{cache:"public, max-age=30"});}
  const rows=(await database.prepare(`SELECT an.*,
      (SELECT COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
       FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
       WHERE ana.note_entity_id=an.entity_id AND ana.public_visible=1 AND ana.role='inline-image'
         AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
         AND ${mediaIsNotVariantMasterSql("m")}
       ORDER BY ana.sort_order,ana.created_at LIMIT 1) preview_url,
      (SELECT COUNT(*) FROM archive_note_links anl WHERE anl.note_entity_id=an.entity_id AND anl.public_visible=1) linked_record_count
    FROM archive_notes an JOIN content_entities ce ON ce.id=an.entity_id
    WHERE an.state='published' AND an.public_visible=1 AND ce.visibility='public'
    ORDER BY an.sort_order,COALESCE(an.source_created_at,an.created_at),an.created_at`).all()).results||[];
  return json({records:rows.map(presentArchiveNote),notes:rows.map(presentArchiveNote),count:rows.length},{cache:"public, max-age=30"});
}

async function adminArchiveNotesApi(request,env,noteEntityId="",action=""){
  const database=db(env);
  if(request.method==="GET"&&!noteEntityId){
    const url=new URL(request.url),targetEntityId=text(url.searchParams.get("target_entity_id")||url.searchParams.get("targetEntityId"),200),where=targetEntityId?"WHERE EXISTS(SELECT 1 FROM archive_note_links scoped_link WHERE scoped_link.note_entity_id=an.entity_id AND scoped_link.target_entity_id=?)":"";
    const statement=database.prepare(`SELECT an.*,(SELECT COUNT(*) FROM archive_note_assets WHERE note_entity_id=an.entity_id) asset_count,(SELECT COUNT(*) FROM archive_note_links WHERE note_entity_id=an.entity_id) link_count,(SELECT COUNT(*) FROM archive_note_history_suggestions WHERE note_entity_id=an.entity_id) history_suggestion_count FROM archive_notes an ${where} ORDER BY COALESCE(an.source_created_at,an.created_at) DESC,an.updated_at DESC`),result=targetEntityId?await statement.bind(targetEntityId).all():await statement.all(),rows=result.results||[];
    return json({records:rows.map(presentArchiveNote),count:rows.length,target_entity_id:targetEntityId||null});
  }
  if(request.method==="POST"&&!noteEntityId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    try{
      const note=normalizedArchiveNote(body),newId=note.entity_id||id("archive-note"),links=normalizedArchiveNoteLinks(body.links,note.public_visible);
      note.entity_id=newId;await validateArchiveNotePublication(database,note,[],links||[]);
      await database.batch([
        database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'archive_note','node-archive','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(newId),
        database.prepare(`INSERT INTO archive_notes(entity_id,slug,title,note_type,source_app,body_markdown,excerpt,source_created_at,source_modified_at,date_label,provenance_note,state,public_visible,sort_order,published_at,created_by,updated_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' AND ?=1 THEN datetime('now') ELSE NULL END,'studio','studio',datetime('now'),datetime('now'))`)
          .bind(newId,note.slug,note.title,note.note_type,note.source_app,note.body_markdown,note.excerpt,note.source_created_at,note.source_modified_at,note.date_label,note.provenance_note,note.state,note.public_visible,note.sort_order,note.state,note.public_visible),
      ]);
      await replaceArchiveNoteLinks(database,newId,links||[]);
      if(Array.isArray(body.origin_thread_ids??body.originThreadIds))await replaceEntityOriginThreads(database,newId,originThreadIds(body.origin_thread_ids??body.originThreadIds),text(body.primary_origin_thread_id??body.primaryOriginThreadId,200));
      await syncArchiveNoteSearch(database,newId);const row=await archiveNoteByKey(database,newId);await nextRevision(database,newId,"archive-note-create",null,row);
      return json(await archiveNotePayload(database,row,{admin:true}),{status:201});
    }catch(error){return failure(error.message,/UNIQUE constraint failed/i.test(error.message)?409:400)}
  }
  const before=noteEntityId?await archiveNoteByKey(database,noteEntityId):null;if(!before)return failure("Archive Note not found.",404);
  if(request.method==="GET")return json(await archiveNotePayload(database,before,{admin:true}));
  if(request.method==="DELETE"){
    await database.batch([
      database.prepare("UPDATE archive_notes SET state='archived',public_visible=0,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?").bind(before.entity_id),
      database.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=datetime('now'),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(before.entity_id),
      database.prepare("DELETE FROM search_documents WHERE entity_id=?").bind(before.entity_id),
    ]);return json({ok:true,archived:true});
  }
  if(request.method!=="PATCH")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  try{
    const note=normalizedArchiveNote(body,before),links=normalizedArchiveNoteLinks(body.links,note.public_visible);
    await validateArchiveNotePublication(database,{...note,entity_id:before.entity_id},null,links);
    if(links!==null)await replaceArchiveNoteLinks(database,before.entity_id,links);
    if(Array.isArray(body.origin_thread_ids??body.originThreadIds))await replaceEntityOriginThreads(database,before.entity_id,originThreadIds(body.origin_thread_ids??body.originThreadIds),text(body.primary_origin_thread_id??body.primaryOriginThreadId,200));
    await database.prepare(`UPDATE archive_notes SET slug=?,title=?,note_type=?,source_app=?,body_markdown=?,excerpt=?,source_created_at=?,source_modified_at=?,date_label=?,provenance_note=?,state=?,public_visible=?,sort_order=?,
      published_at=CASE WHEN ?='published' AND ?=1 THEN COALESCE(published_at,datetime('now')) ELSE published_at END,updated_by='studio',updated_at=datetime('now') WHERE entity_id=?`)
      .bind(note.slug,note.title,note.note_type,note.source_app,note.body_markdown,note.excerpt,note.source_created_at,note.source_modified_at,note.date_label,note.provenance_note,note.state,note.public_visible,note.sort_order,note.state,note.public_visible,before.entity_id).run();
    await syncArchiveNoteSearch(database,before.entity_id);const row=await archiveNoteByKey(database,before.entity_id);await nextRevision(database,before.entity_id,"archive-note-update",before,row);
    return json(await archiveNotePayload(database,row,{admin:true}));
  }catch(error){return failure(error.message,/UNIQUE constraint failed/i.test(error.message)?409:400)}
}

async function adminArchiveNoteAssetsApi(request,env,noteEntityId,assetId=""){
  const database=db(env),note=await archiveNoteByKey(database,noteEntityId);if(!note)return failure("Archive Note not found.",404);
  if(request.method==="GET")return json({records:await archiveNoteAssets(database,note.entity_id,{admin:true})});
  if(request.method==="POST"&&!assetId){
    const body=await readJson(request);if(!body)return failure("Send a JSON object.");
    const mediaId=text(body.media_id??body.mediaId,200),token=text(body.asset_token??body.token,120).toLowerCase(),role=text(body.role??"inline-image",40),publicVisible=(body.public_visible??body.publicVisible)?1:0;
    if(!mediaId||!ARCHIVE_NOTE_TOKEN.test(token)||!ARCHIVE_NOTE_ROLES.has(role))return failure("Choose media, a lowercase asset token, and a supported role.");
    const media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(mediaId).first();if(!media)return failure("Media asset not found.",404);
    if(note.state==="published"&&Number(note.public_visible)&&publicVisible&&!archiveNoteMediaEligible(media))return failure("Public Note assets must be active, public, permitted, and inline.",409);
    try{const newId=text(body.id,200)||id("archive-note-asset");await database.prepare(`INSERT INTO archive_note_assets(id,note_entity_id,media_id,asset_token,role,sort_order,alt_text_override,caption_override,public_visible,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(newId,note.entity_id,mediaId,token,role,Number(body.sort_order??body.sortOrder)||0,text(body.alt_text??body.altText,1000),text(body.caption,3000),publicVisible).run();await syncArchiveNoteSearch(database,note.entity_id);return json({record:(await archiveNoteAssets(database,note.entity_id,{admin:true})).find(item=>item.id===newId)},{status:201})}catch(error){return failure(error.message,/UNIQUE constraint failed/i.test(error.message)?409:400)}
  }
  const before=(await archiveNoteAssets(database,note.entity_id,{admin:true})).find(item=>item.id===assetId);if(!before)return failure("Note asset not found.",404);
  if(request.method==="DELETE"){
    if(note.state==="published"&&Number(note.public_visible)&&archiveNoteTokens(note.body_markdown).includes(before.token))return failure("Remove this asset token from the public Note or unpublish the Note before detaching it.",409);
    await database.prepare("DELETE FROM archive_note_assets WHERE id=? AND note_entity_id=?").bind(assetId,note.entity_id).run();await syncArchiveNoteSearch(database,note.entity_id);return json({ok:true,removed:true});
  }
  if(request.method!=="PATCH")return failure("Method not allowed.",405);
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const token=text(body.asset_token??body.token??before.token,120).toLowerCase(),role=text(body.role??before.role,40),publicVisible=body.public_visible===undefined&&body.publicVisible===undefined?(before.public_visible?1:0):((body.public_visible??body.publicVisible)?1:0);
  if(!ARCHIVE_NOTE_TOKEN.test(token)||!ARCHIVE_NOTE_ROLES.has(role))return failure("Choose a lowercase asset token and supported role.");
  const media=await database.prepare("SELECT * FROM media_assets WHERE id=?").bind(before.media_id).first();if(note.state==="published"&&Number(note.public_visible)&&publicVisible&&!archiveNoteMediaEligible(media))return failure("Public Note assets must be active, public, permitted, and inline.",409);
  if(note.state==="published"&&Number(note.public_visible)&&!publicVisible&&archiveNoteTokens(note.body_markdown).includes(before.token))return failure("A referenced asset cannot be hidden while its Note is public.",409);
  try{await database.prepare("UPDATE archive_note_assets SET asset_token=?,role=?,sort_order=?,alt_text_override=?,caption_override=?,public_visible=?,updated_at=datetime('now') WHERE id=? AND note_entity_id=?")
    .bind(token,role,Number(body.sort_order??body.sortOrder??before.sort_order)||0,text(body.alt_text??body.altText??before.alt_text,1000),text(body.caption??before.caption,3000),publicVisible,assetId,note.entity_id).run();await syncArchiveNoteSearch(database,note.entity_id);return json({record:(await archiveNoteAssets(database,note.entity_id,{admin:true})).find(item=>item.id===assetId)})}catch(error){return failure(error.message,/UNIQUE constraint failed/i.test(error.message)?409:400)}
}

async function publicNotesForTarget(database,targetEntityId){
  const rows=(await database.prepare(`SELECT an.*,anl.relationship_role,anl.is_primary,anl.sort_order link_sort_order,
      (SELECT COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
       FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
       WHERE ana.note_entity_id=an.entity_id AND ana.public_visible=1 AND ana.role='inline-image'
         AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
         AND ${mediaIsNotVariantMasterSql("m")}
       ORDER BY ana.sort_order,ana.created_at LIMIT 1) preview_url
    FROM archive_note_links anl JOIN archive_notes an ON an.entity_id=anl.note_entity_id
    JOIN content_entities ce ON ce.id=an.entity_id
    WHERE anl.target_entity_id=? AND anl.public_visible=1 AND an.state='published' AND an.public_visible=1 AND ce.visibility='public'
    ORDER BY COALESCE(an.source_created_at,an.created_at) DESC,anl.is_primary DESC,anl.sort_order,an.sort_order`).bind(targetEntityId).all()).results||[];
  if(!rows.length)return[];
  const noteIds=rows.map(row=>row.entity_id),assetRows=(await database.prepare(`SELECT ana.*,m.source_url,m.storage_key,m.original_filename,m.mime_type,m.byte_size,m.alt_text,m.caption
    FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
    WHERE ana.note_entity_id IN (${noteIds.map(()=>"?").join(",")}) AND ana.public_visible=1 AND ana.role='inline-image'
      AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
      AND ${mediaIsNotVariantMasterSql("m")}
    ORDER BY ana.note_entity_id,ana.sort_order,ana.created_at,ana.id`).bind(...noteIds).all()).results||[],assetsByNote=new Map();
  for(const row of assetRows){const assets=assetsByNote.get(row.note_entity_id)||[];assets.push(presentArchiveNoteAsset(row));assetsByNote.set(row.note_entity_id,assets)}
  return rows.map(row=>({...presentArchiveNote(row),assets:assetsByNote.get(row.entity_id)||[],asset_count:(assetsByNote.get(row.entity_id)||[]).length}));
}

async function publicNotesForOriginThread(database,threadId){
  const rows=(await database.prepare(`SELECT an.*,ote.is_primary origin_is_primary,ote.sort_order origin_sort_order,
      (SELECT COALESCE(NULLIF(m.source_url,''),CASE WHEN m.storage_key<>'' THEN '/api/construct/media/'||m.id ELSE '' END)
       FROM archive_note_assets ana JOIN media_assets m ON m.id=ana.media_id
       WHERE ana.note_entity_id=an.entity_id AND ana.public_visible=1 AND ana.role='inline-image'
         AND m.state='active' AND m.privacy='public' AND m.public_presentation='inline'
         AND ${mediaIsNotVariantMasterSql("m")}
       ORDER BY ana.sort_order,ana.created_at LIMIT 1) preview_url
    FROM archive_origin_thread_entities ote JOIN archive_notes an ON an.entity_id=ote.entity_id
    JOIN content_entities ce ON ce.id=an.entity_id
    WHERE ote.thread_id=? AND an.state='published' AND an.public_visible=1 AND ce.visibility='public'
    ORDER BY ote.is_primary DESC,ote.sort_order,an.sort_order`).bind(threadId).all()).results||[];
  return rows.map(presentArchiveNote);
}

async function eventArchive(request,env,eventId){
  return editableArchiveDossierAdminApi(request,env,eventId);
}

export async function handleConstructApi(request,env){
  const url=new URL(request.url);const path=url.pathname;
  const galleryPublic=await handleGalleryPublic(request,env,path);if(galleryPublic)return galleryPublic;
  const colorMaterialsPublic=await handleArchiveColorMaterialsPublic(request,env,path);if(colorMaterialsPublic)return colorMaterialsPublic;
  if(path==="/api/site/navigation")return publicNavigation(env);
  if(path==="/api/current-projects"&&request.method==="GET")return publicCurrentProjects(env);
  if(path==="/api/site/explore")return publicExplore(request,env);
  if(path==="/api/search")return publicSearch(request,env);
  if(path==="/api/identities")return publicIdentitiesApi(request,env);
  const identityPublicMatch=path.match(/^\/api\/identities\/([^/]+)$/);if(identityPublicMatch)return publicIdentitiesApi(request,env,decodeURIComponent(identityPublicMatch[1]));
  if(path==="/api/archive/failed-experiments")return publicFailedExperimentsApi(request,env);
  const failedExperimentPublicMatch=path.match(/^\/api\/archive\/failed-experiments\/([^/]+)$/);if(failedExperimentPublicMatch)return publicFailedExperimentsApi(request,env,decodeURIComponent(failedExperimentPublicMatch[1]));
  if(path==="/api/archive/blackboards")return publicArchiveBlackboardsV2(request,env);
  const blackboardSurfacePublicMatch=path.match(/^\/api\/archive\/blackboards\/([^/]+)$/);if(blackboardSurfacePublicMatch)return publicArchiveBlackboardsV2(request,env,decodeURIComponent(blackboardSurfacePublicMatch[1]));
  if(path==="/api/archive/origin-threads")return publicArchiveOriginThreads(request,env);
  if(path==="/api/archive/notes")return publicArchiveNotesApi(request,env);
  const archiveNotePublicMatch=path.match(/^\/api\/archive\/notes\/([^/]+)$/);if(archiveNotePublicMatch)return publicArchiveNotesApi(request,env,decodeURIComponent(archiveNotePublicMatch[1]));
  if(path==="/api/archive/items")return publicArchiveItems(request,env);
  if(path==="/api/archive/compare")return publicArchiveCompare(request,env);
  const archiveItemMatch=path.match(/^\/api\/archive\/items\/([^/]+)$/);if(archiveItemMatch)return publicArchiveDetail(request,env,decodeURIComponent(archiveItemMatch[1]));
  if(path==="/api/archive/timelines")return publicArchiveTimeline(request,env,"");
  const archiveTimelinePublicMatch=path.match(/^\/api\/archive\/timelines\/([^/]+)$/);if(archiveTimelinePublicMatch)return publicArchiveTimeline(request,env,decodeURIComponent(archiveTimelinePublicMatch[1]));
  const connectionsMatch=path.match(/^\/api\/connections\/([^/]+)$/);if(connectionsMatch&&request.method==="GET")return publicConnections(env,decodeURIComponent(connectionsMatch[1]));
  const mediaPublic=path.match(/^\/api\/construct\/media\/([^/]+)$/);if(mediaPublic)return publicMediaApi(request,env,decodeURIComponent(mediaPublic[1]));
  const entityMediaPublic=path.match(/^\/api\/construct\/entity-media\/([^/]+)$/);if(entityMediaPublic)return publicEntityMediaApi(request,env,decodeURIComponent(entityMediaPublic[1]));
  if(path==="/api/legend/categories")return publicLegendCategories(env);
  if(path==="/api/legend/composition-rules")return publicCompositionRules(request,env);
  const publicMatch=path.match(/^\/api\/(flash|legend|visual-language|art|archive|archive-collections|appearances)(?:\/([^/]+))?$/);if(publicMatch)return publicCatalog(request,env,canonicalResource(publicMatch[1]),publicMatch[2]?decodeURIComponent(publicMatch[2]):"");
  const auth=requireStudioAdmin(request,env);if(auth)return auth;
  const mediaCatalogueAdmin=await handleMediaCatalogueAdmin(request,env,path);if(mediaCatalogueAdmin)return mediaCatalogueAdmin;
  const galleryAdmin=await handleGalleryAdmin(request,env,path);if(galleryAdmin)return galleryAdmin;
  const colorMaterialsAdmin=await handleArchiveColorMaterialsAdmin(request,env,path);if(colorMaterialsAdmin)return colorMaterialsAdmin;
  const archiveWebSnapshotsAdmin=await handleArchiveWebSnapshotsAdmin(request,env,path);if(archiveWebSnapshotsAdmin)return archiveWebSnapshotsAdmin;
  if(path==="/api/admin/identities")return adminIdentitiesApi(request,env);
  const identityPublicationMatch=path.match(/^\/api\/admin\/identities\/([^/]+)\/(publication-review|publish-package)$/);if(identityPublicationMatch)return identityPublicationApi(request,env,decodeURIComponent(identityPublicationMatch[1]),identityPublicationMatch[2]);
  const identityAdminMatch=path.match(/^\/api\/admin\/identities\/([^/]+)$/);if(identityAdminMatch)return adminIdentitiesApi(request,env,decodeURIComponent(identityAdminMatch[1]));
  if(path==="/api/admin/archive-records/create-cultural-object"||path==="/api/admin/archive-cultural-objects")return createCulturalObjectAdminApi(request,env);
  const failedExperimentMediaPairMatch=path.match(/^\/api\/admin\/archive-failed-experiments\/([^/]+)\/media-pair$/);if(failedExperimentMediaPairMatch)return archiveFailedExperimentMediaPairAdminApi(request,env,decodeURIComponent(failedExperimentMediaPairMatch[1]));
  const failedExperimentStateLinksMatch=path.match(/^\/api\/admin\/archive-failed-experiments\/([^/]+)\/state-links$/);if(failedExperimentStateLinksMatch)return archiveFailedExperimentStateLinksAdminApi(request,env,decodeURIComponent(failedExperimentStateLinksMatch[1]));
  const failedExperimentAdminMatch=path.match(/^\/api\/admin\/archive-failed-experiments(?:\/([^/]+))?$/);if(failedExperimentAdminMatch)return archiveFailedExperimentsAdminApi(request,env,failedExperimentAdminMatch[1]?decodeURIComponent(failedExperimentAdminMatch[1]):"");
  const legendArchiveAppearanceMatch=path.match(/^\/api\/admin\/legend\/archive-appearances(?:\/([^/]+))?$/);if(legendArchiveAppearanceMatch)return legendArchiveAppearancesAdminApi(request,env,legendArchiveAppearanceMatch[1]?decodeURIComponent(legendArchiveAppearanceMatch[1]):"");
  const legendCompositionMatch=path.match(/^\/api\/admin\/legend\/composition-rules(?:\/([^/]+))?$/);if(legendCompositionMatch)return adminCompositionRules(request,env,legendCompositionMatch[1]?decodeURIComponent(legendCompositionMatch[1]):"");
  const legendCategoryMatch=path.match(/^\/api\/admin\/legend\/categories(?:\/([^/]+))?$/);if(legendCategoryMatch)return legendCategoryApi(request,env,legendCategoryMatch[1]?decodeURIComponent(legendCategoryMatch[1]):"");
  const eventMatch=path.match(/^\/api\/admin\/events\/([^/]+)\/create-archive-record$/);if(eventMatch&&request.method==="POST")return eventArchive(request,env,decodeURIComponent(eventMatch[1]));
  if(path==="/api/admin/media/uploads")return mediaUploadsApi(request,env);
  const mediaUploadPartMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/parts\/(\d+)$/);if(mediaUploadPartMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadPartMatch[1]),"part",Number(mediaUploadPartMatch[2]));
  const mediaUploadCompleteMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)\/complete$/);if(mediaUploadCompleteMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadCompleteMatch[1]),"complete");
  const mediaUploadSessionMatch=path.match(/^\/api\/admin\/media\/uploads\/([^/]+)$/);if(mediaUploadSessionMatch)return mediaUploadsApi(request,env,decodeURIComponent(mediaUploadSessionMatch[1]));
  const mediaVariantMatch=path.match(/^\/api\/admin\/media\/([^/]+)\/variants$/);if(mediaVariantMatch)return mediaVariantsAdminApi(request,env,decodeURIComponent(mediaVariantMatch[1]));
  const mediaFileMatch=path.match(/^\/api\/admin\/media\/([^/]+)\/file$/);if(mediaFileMatch)return adminMediaFileApi(request,env,decodeURIComponent(mediaFileMatch[1]));
  const mediaMatch=path.match(/^\/api\/admin\/media(?:\/([^/]+))?$/);if(mediaMatch)return mediaApi(request,env,mediaMatch[1]?decodeURIComponent(mediaMatch[1]):"");
  const catalogueReidentifyMatch=path.match(/^\/api\/admin\/archive-catalogue\/([^/]+)\/reidentify$/);if(catalogueReidentifyMatch)return archiveCatalogueReidentifyAdminApi(request,env,decodeURIComponent(catalogueReidentifyMatch[1]));
  const catalogueMatch=path.match(/^\/api\/admin\/archive-catalogue(?:\/([^/]+))?$/);if(catalogueMatch)return archiveCatalogueAdminApi(request,env,catalogueMatch[1]?decodeURIComponent(catalogueMatch[1]):"");
  const documentationMatch=path.match(/^\/api\/admin\/archive-documentation(?:\/([^/]+))?$/);if(documentationMatch)return archiveDocumentationAdminApi(request,env,documentationMatch[1]?decodeURIComponent(documentationMatch[1]):"");
  const eventIdentifierMatch=path.match(/^\/api\/admin\/archive-event-identifiers\/([^/]+)$/);if(eventIdentifierMatch)return archiveEventIdentifierAdminApi(request,env,decodeURIComponent(eventIdentifierMatch[1]));
  const versionMatch=path.match(/^\/api\/admin\/archive-versions(?:\/([^/]+))?$/);if(versionMatch)return archiveVersionsAdminApi(request,env,versionMatch[1]?decodeURIComponent(versionMatch[1]):"");
  const stateMatch=path.match(/^\/api\/admin\/archive-states(?:\/([^/]+))?$/);if(stateMatch)return archiveStatesAdminApi(request,env,stateMatch[1]?decodeURIComponent(stateMatch[1]):"");
  if(path==="/api/admin/archive-dossiers/bulk-publication")return archiveDossierBulkPublicationApi(request,env);
  const dossierMatch=path.match(/^\/api\/admin\/archive-dossiers(?:\/([^/]+))?$/);if(dossierMatch)return archiveDossiersAdminApi(request,env,dossierMatch[1]?decodeURIComponent(dossierMatch[1]):"");
  if(path==="/api/admin/archive-blackboards/fragments")return archiveBlackboardFragmentsGlobalAdminApi(request,env);
  const blackboardFragmentEditMatch=path.match(/^\/api\/admin\/archive-blackboards\/fragments\/([^/]+)\/edits\/([^/]+)$/);if(blackboardFragmentEditMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(blackboardFragmentEditMatch[1]),`edits/${encodeURIComponent(decodeURIComponent(blackboardFragmentEditMatch[2]))}`);
  const blackboardFragmentLibraryActionMatch=path.match(/^\/api\/admin\/archive-blackboards\/fragments\/([^/]+)\/(edits|board|mappings|states|placements)$/);if(blackboardFragmentLibraryActionMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(blackboardFragmentLibraryActionMatch[1]),blackboardFragmentLibraryActionMatch[2]);
  const blackboardFragmentLibraryMatch=path.match(/^\/api\/admin\/archive-blackboards\/fragments\/([^/]+)$/);if(blackboardFragmentLibraryMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(blackboardFragmentLibraryMatch[1]));
  // Temporary aliases for early Fragment Library clients; the canonical base is /api/admin/archive-blackboards/fragments.
  if(path==="/api/admin/archive-blackboard-fragments")return archiveBlackboardFragmentsGlobalAdminApi(request,env);
  const globalBlackboardFragmentEditMatch=path.match(/^\/api\/admin\/archive-blackboard-fragments\/([^/]+)\/edits\/([^/]+)$/);if(globalBlackboardFragmentEditMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(globalBlackboardFragmentEditMatch[1]),`edits/${encodeURIComponent(decodeURIComponent(globalBlackboardFragmentEditMatch[2]))}`);
  const globalBlackboardFragmentActionMatch=path.match(/^\/api\/admin\/archive-blackboard-fragments\/([^/]+)\/(edits|board|mappings|states|placements)$/);if(globalBlackboardFragmentActionMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(globalBlackboardFragmentActionMatch[1]),globalBlackboardFragmentActionMatch[2]);
  const globalBlackboardFragmentMatch=path.match(/^\/api\/admin\/archive-blackboard-fragments\/([^/]+)$/);if(globalBlackboardFragmentMatch)return archiveBlackboardFragmentsGlobalAdminApi(request,env,decodeURIComponent(globalBlackboardFragmentMatch[1]));
  const blackboardFragmentPlacementsMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)\/([^/]+)\/fragments\/([^/]+)\/placements$/);if(blackboardFragmentPlacementsMatch)return archiveBlackboardFragmentsAdminApiV2(request,env,decodeURIComponent(blackboardFragmentPlacementsMatch[1]),decodeURIComponent(blackboardFragmentPlacementsMatch[2]),"placements");
  const blackboardFragmentStatesMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)\/([^/]+)\/fragments\/([^/]+)\/(?:states|captures)$/);if(blackboardFragmentStatesMatch)return archiveBlackboardFragmentsAdminApiV2(request,env,decodeURIComponent(blackboardFragmentStatesMatch[1]),decodeURIComponent(blackboardFragmentStatesMatch[2]),"states");
  const blackboardFragmentMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)\/([^/]+)\/fragments(?:\/([^/]+))?$/);if(blackboardFragmentMatch)return archiveBlackboardFragmentsAdminApiV2(request,env,decodeURIComponent(blackboardFragmentMatch[1]),blackboardFragmentMatch[2]?decodeURIComponent(blackboardFragmentMatch[2]):"");
  const blackboardNotebookMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)\/([^/]+)\/(?:notebook|context)(?:\/([^/]+))?$/);if(blackboardNotebookMatch)return archiveBlackboardNotebookAdminApiV2(request,env,decodeURIComponent(blackboardNotebookMatch[1]),blackboardNotebookMatch[2]?decodeURIComponent(blackboardNotebookMatch[2]):"");
  const blackboardStateMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)\/([^/]+)\/states(?:\/([^/]+))?$/);if(blackboardStateMatch)return archiveBlackboardStatesAdminApiV2(request,env,decodeURIComponent(blackboardStateMatch[1]),blackboardStateMatch[2]?decodeURIComponent(blackboardStateMatch[2]):"");
  const blackboardRecordAdminMatch=path.match(/^\/api\/admin\/archive-blackboards\/(?:records|surfaces)(?:\/([^/]+))?$/);if(blackboardRecordAdminMatch)return archiveBlackboardRecordsAdminApiV2(request,env,blackboardRecordAdminMatch[1]?decodeURIComponent(blackboardRecordAdminMatch[1]):"");
  const blackboardContextMatch=path.match(/^\/api\/admin\/archive-blackboards\/materials\/([^/]+)$/);if(blackboardContextMatch)return archiveBlackboardMaterialContextApi(request,env,decodeURIComponent(blackboardContextMatch[1]));
  const blackboardActionMatch=path.match(/^\/api\/admin\/archive-blackboards\/([^/]+)\/(scan|publish)$/);if(blackboardActionMatch)return archiveBlackboardRecordsAdminApiV2(request,env,decodeURIComponent(blackboardActionMatch[1]),blackboardActionMatch[2]);
  const blackboardMatch=path.match(/^\/api\/admin\/archive-blackboards(?:\/([^/]+))?$/);if(blackboardMatch)return archiveBlackboardRecordsAdminApiV2(request,env,blackboardMatch[1]?decodeURIComponent(blackboardMatch[1]):"");
  const materialMatch=path.match(/^\/api\/admin\/archive-materials(?:\/([^/]+))?$/);if(materialMatch)return archiveMaterialsAdminApi(request,env,materialMatch[1]?decodeURIComponent(materialMatch[1]):"");
  if(path==="/api/admin/archive-notes/import")return adminArchiveNoteImportApi(request,env);
  const noteExportMatch=path.match(/^\/api\/admin\/archive-notes\/([^/]+)\/export$/);if(noteExportMatch)return adminArchiveNoteExportApi(request,env,decodeURIComponent(noteExportMatch[1]));
  const noteLinksMatch=path.match(/^\/api\/admin\/archive-notes\/([^/]+)\/links$/);if(noteLinksMatch)return adminArchiveNoteLinksApi(request,env,decodeURIComponent(noteLinksMatch[1]));
  const noteHistorySuggestionMatch=path.match(/^\/api\/admin\/archive-notes\/([^/]+)\/history-suggestions(?:\/([^/]+))?$/);if(noteHistorySuggestionMatch)return adminArchiveNoteHistorySuggestionsApi(request,env,decodeURIComponent(noteHistorySuggestionMatch[1]),noteHistorySuggestionMatch[2]?decodeURIComponent(noteHistorySuggestionMatch[2]):"");
  const noteAssetMatch=path.match(/^\/api\/admin\/archive-notes\/([^/]+)\/assets(?:\/([^/]+))?$/);if(noteAssetMatch)return adminArchiveNoteAssetsApi(request,env,decodeURIComponent(noteAssetMatch[1]),noteAssetMatch[2]?decodeURIComponent(noteAssetMatch[2]):"");
  const noteMatch=path.match(/^\/api\/admin\/archive-notes(?:\/([^/]+))?$/);if(noteMatch)return adminArchiveNotesApi(request,env,noteMatch[1]?decodeURIComponent(noteMatch[1]):"");
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
  const editableArchiveDossierMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/archive-dossier$/);if(editableArchiveDossierMatch)return editableArchiveDossierAdminApi(request,env,decodeURIComponent(editableArchiveDossierMatch[1]));
  const entityOriginThreadsMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/origin-threads$/);if(entityOriginThreadsMatch)return entityOriginThreadsAdminApi(request,env,decodeURIComponent(entityOriginThreadsMatch[1]));
  const relationshipTypeMatch=path.match(/^\/api\/admin\/relationship-types(?:\/([^/]+))?$/);if(relationshipTypeMatch)return relationshipTypesApi(request,env,relationshipTypeMatch[1]?decodeURIComponent(relationshipTypeMatch[1]):"");
  const relationshipMatch=path.match(/^\/api\/admin\/relationships(?:\/([^/]+))?$/);if(relationshipMatch)return relationshipApi(request,env,relationshipMatch[1]?decodeURIComponent(relationshipMatch[1]):"");
  if(path==="/api/admin/taxonomy")return taxonomyApi(request,env);
  const entityMediaItemMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media\/([^/]+)$/);if(entityMediaItemMatch){const entityId=decodeURIComponent(entityMediaItemMatch[1]),response=await entityMediaApi(request,env,entityId,decodeURIComponent(entityMediaItemMatch[2]));if(response.ok&&request.method!=="GET")await enqueueVisualColorEntityById(env,entityId);return response;}
  const entityMediaMatch=path.match(/^\/api\/admin\/entities\/([^/]+)\/media$/);if(entityMediaMatch){const entityId=decodeURIComponent(entityMediaMatch[1]),response=await entityMediaApi(request,env,entityId);if(response.ok&&request.method!=="GET")await enqueueVisualColorEntityById(env,entityId);return response;}
  if(path==="/api/admin/revisions"&&request.method==="GET"){const rows=(await db(env).prepare("SELECT * FROM entity_revisions ORDER BY created_at DESC LIMIT 250").all()).results||[];return json({records:rows,count:rows.length});}
  if(path==="/api/admin/search/status"&&request.method==="GET"){const counts=await db(env).prepare("SELECT COUNT(*) documents FROM search_documents").first();const failures=await db(env).prepare("SELECT COUNT(*) failures FROM search_index_failures WHERE resolved_at IS NULL").first();return json({...counts,...failures});}
  const reorderMatch=path.match(/^\/api\/admin\/([^/]+)\/reorder$/);if(reorderMatch&&request.method==="POST")return reorder(request,env,canonicalResource(reorderMatch[1]));
  const match=path.match(/^\/api\/admin\/([^/]+)(?:\/([^/]+))?$/);if(!match)return failure("Unknown Construct API route.",404);const resource=match[1],recordId=match[2]?decodeURIComponent(match[2]):"";
  const canonical=canonicalResource(resource);if(!recordId&&request.method==="GET")return adminList(env,canonical);
  if(!recordId&&request.method==="POST"){
    const response=await adminCreate(request,env,canonical),entityType=RESOURCE_CONFIG[canonical]?.entityType;
    if(response.ok&&["art_work","flash_item","merch_item"].includes(entityType)){
      const payload=await response.clone().json().catch(()=>({})),entityId=payload?.record?.id;
      if(entityId)await enqueueVisualColorEntity(env,entityType,entityId);
    }
    return response;
  }
  if(recordId&&(request.method==="PATCH"||request.method==="DELETE")){
    const response=await adminUpdate(request,env,canonical,recordId,request.method==="DELETE"),entityType=RESOURCE_CONFIG[canonical]?.entityType;
    if(response.ok&&["art_work","flash_item","merch_item"].includes(entityType))await enqueueVisualColorEntity(env,entityType,recordId);
    return response;
  }
  return failure("Method not allowed.",405);
}
