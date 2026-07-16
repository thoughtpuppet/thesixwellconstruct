const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_DELETE_ROLLBACK_BYTES = 60 * 1024 * 1024;
const ALLOWED_UPLOADS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const HEALING_STATES = new Set(["fresh", "healed", "in-progress", "unspecified"]);
const IMAGE_PRESENTATIONS = new Set(["standard", "compare", "grouped"]);
const PROJECT_TYPES = new Set(["standard", "cover_up"]);
const IMAGE_ROLES = new Set(["result", "before", "process", "detail"]);
const CONSENT_STATUSES = new Set(["not-required", "required", "granted", "denied", "unknown"]);
const PUBLIC_CONSENT_STATUSES = new Set(["not-required", "granted"]);
const EDITABLE_FIELDS = new Map([
  ["title", "title"],
  ["altText", "alt_text"],
  ["year", "year"],
  ["placement", "placement"],
  ["primaryStyle", "primary_style"],
  ["collection", "collection"],
  ["caption", "caption"],
  ["statement", "statement"],
  ["processNotes", "process_notes"],
  ["techniques", "techniques"],
  ["sessionNote", "session_note"],
  ["similarInquiryNote", "similar_inquiry_note"],
]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function errorResponse(message, status = 400, detail = "") {
  return json({ error: message, ...(detail ? { detail } : {}) }, { status });
}

function requireDb(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Portfolio database is not configured.");
  return env.SUBMISSIONS_DB;
}

function adminError(request, env) {
  const expected = env.SUBMISSIONS_ADMIN_TOKEN || "";
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!expected) return errorResponse("Portfolio administration is not configured.", 503);
  if (supplied !== expected) return errorResponse("Unauthorized.", 401);
  return null;
}

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function hasPublicConsent(value) {
  return PUBLIC_CONSENT_STATUSES.has(String(value || ""));
}

function optionSlug(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function optionFromRow(row, admin = false) {
  return {
    value: row.value,
    label: row.label,
    sortOrder: Number(row.sort_order || 0),
    ...(admin ? {
      id: row.id,
      kind: row.kind,
      description: row.description || "",
      enabled: Number(row.enabled || 0) === 1,
      usageCount: Number(row.usage_count || 0),
    } : {}),
  };
}

async function portfolioOptions(db, admin = false) {
  const usage = admin ? `,
    CASE kind
      WHEN 'style' THEN (SELECT COUNT(*) FROM portfolio_items p WHERE COALESCE(NULLIF(p.primary_style, ''), 'unclassified') = portfolio_options.value)
      ELSE (SELECT COUNT(*) FROM portfolio_items p WHERE p.collection = portfolio_options.value)
    END AS usage_count` : "";
  const result = await db.prepare(`
    SELECT portfolio_options.*${usage}
    FROM portfolio_options
    ORDER BY kind, sort_order, label COLLATE NOCASE
  `).all();
  const options = { styles: [], collections: [] };
  for (const row of result.results || []) {
    options[row.kind === "style" ? "styles" : "collections"].push(optionFromRow(row, admin));
  }
  return options;
}

function decorateItem(item, options) {
  const style = options.styles.find((entry) => entry.value === item.primaryStyle);
  const collection = options.collections.find((entry) => entry.value === item.collection);
  return {
    ...item,
    primaryStyleLabel: style?.label || item.primaryStyle,
    collectionLabel: collection?.label || item.collection,
  };
}

async function resolveOptionValue(db, kind, value, currentValue = "") {
  if (kind === "collection" && !value) return "";
  const normalized = kind === "style" && !value ? "unclassified" : value;
  const row = await db.prepare("SELECT value, enabled FROM portfolio_options WHERE kind = ? AND value = ? COLLATE NOCASE")
    .bind(kind, normalized).first();
  return row && (Number(row.enabled) === 1 || row.value === currentValue) ? row.value : null;
}

function itemFromRow(row, admin = false, detail = false) {
  const item = {
    id: row.id,
    imageUrl: row.source_url || `/api/portfolio/media/${encodeURIComponent(row.id)}`,
    originalFilename: row.original_filename || "",
    title: row.title || "",
    altText: row.alt_text || "",
    year: row.year || "",
    placement: row.placement || "",
    primaryStyle: row.primary_style || "unclassified",
    collection: row.collection || "",
    caption: row.caption || "",
    projectType: row.project_type || "standard",
    imagePresentation: row.image_presentation || "standard",
    coverImageRef: row.cover_image_ref || "primary",
    state: row.state,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (admin || detail) {
    item.statement = row.statement || "";
    item.processNotes = row.process_notes || "";
    item.techniques = row.techniques || "";
    item.sessionCount = row.session_count == null ? null : Number(row.session_count);
    item.sessionNote = row.session_note || "";
    item.similarInquiriesEnabled = Number(row.similar_inquiries_enabled || 0) === 1;
    item.similarInquiryNote = row.similar_inquiry_note || "";
    item.detailUrl = `/tattoos/portfolio/?work=${encodeURIComponent(row.id)}`;
  }
  if (admin) {
    item.sourceUrl = row.source_url || "";
    item.storageKey = row.storage_key || "";
    item.contentType = row.content_type || "";
    item.primaryConsentStatus = row.primary_consent_status || "unknown";
    if (row.storage_key) item.imageUrl = `/api/admin/portfolio/media/${encodeURIComponent(row.id)}`;
  }
  return item;
}

function mediaItem(row, admin = false) {
  const item = {
    id: row.media_id,
    role: row.role,
    sortOrder: Number(row.sort_order || 0),
    imageUrl: admin
      ? `/api/admin/media/${encodeURIComponent(row.media_id)}/file`
      : row.source_url || `/api/construct/entity-media/${encodeURIComponent(row.media_id)}`,
    altText: row.alt_text_override || row.alt_text || "",
    caption: row.caption_override || row.caption || "",
    originalFilename: row.original_filename || "",
  };
  if (admin) {
    item.consentStatus = row.consent_status || "unknown";
    item.publicVisible = Number(row.public_visible || 0) === 1;
    item.privacy = row.privacy || "internal";
  }
  return item;
}

async function galleryMedia(db, entityIds, admin = false) {
  if (!entityIds.length) return new Map();
  const placeholders = entityIds.map(() => "?").join(",");
  const visibility = admin
    ? ""
    : `AND em.public_visible = 1
       AND m.state = 'active'
       AND m.privacy = 'public'
       AND m.consent_status IN ('not-required','granted')
       AND COALESCE(m.public_presentation, 'inline') = 'inline'
       AND EXISTS (
         SELECT 1 FROM content_entities ce
         WHERE ce.id = em.entity_id AND ce.visibility = 'public'
       )`;
  const result = await db.prepare(`
    SELECT em.entity_id, em.media_id, em.role, em.sort_order, em.alt_text_override,
      em.caption_override, em.public_visible, m.source_url, m.original_filename,
      m.alt_text, m.caption, m.privacy, m.consent_status, m.public_presentation
    FROM entity_media em
    JOIN media_assets m ON m.id = em.media_id
    WHERE em.entity_id IN (${placeholders}) AND em.role = 'gallery' ${visibility}
    ORDER BY em.entity_id, em.sort_order, em.created_at
  `).bind(...entityIds).all();
  const grouped = new Map(entityIds.map((id) => [id, []]));
  for (const row of result.results || []) grouped.get(row.entity_id)?.push(mediaItem(row, admin));
  return grouped;
}

async function imageDetails(db, entityIds) {
  if (!entityIds.length) return new Map();
  const placeholders = entityIds.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT portfolio_item_id, image_ref, healing_state, image_role, timing_note, caption
    FROM portfolio_image_details
    WHERE portfolio_item_id IN (${placeholders})
  `).bind(...entityIds).all();
  const grouped = new Map(entityIds.map((id) => [id, new Map()]));
  for (const row of result.results || []) grouped.get(row.portfolio_item_id)?.set(row.image_ref, row);
  return grouped;
}

function documentedImage(image, imageRef, details, coverImageRef) {
  const documentation = details?.get(imageRef);
  return {
    ...image,
    imageRef,
    healingState: documentation?.healing_state || "unspecified",
    imageRole: documentation?.image_role || "result",
    timingNote: documentation?.timing_note || "",
    documentationCaption: documentation?.caption || "",
    isCover: imageRef === coverImageRef,
  };
}

function applyImageDocumentation(item, angles, details, options = {}) {
  const includeImages = options.includeImages === true;
  const admin = options.admin === true;
  const primaryConsentStatus = options.primaryConsentStatus || "unknown";
  const primary = documentedImage({
    id: "primary",
    imageUrl: item.imageUrl,
    altText: item.altText,
    caption: "",
    originalFilename: item.originalFilename,
    ...(admin ? { consentStatus: primaryConsentStatus, publicVisible: hasPublicConsent(primaryConsentStatus) } : {}),
  }, "primary", details, item.coverImageRef);
  const documentedAngles = angles.map((angle) => documentedImage(angle, angle.id, details, item.coverImageRef));
  const images = [
    ...(admin || hasPublicConsent(primaryConsentStatus) ? [primary] : []),
    ...documentedAngles,
  ];
  let cover = images.find((image) => image.isCover && image.imageRole === "result");
  if (!cover) {
    cover = images.find((image) => image.imageRole === "result") || images[0] || null;
    if (cover) {
      primary.isCover = cover.imageRef === "primary";
      documentedAngles.forEach((image) => { image.isCover = image.imageRef === cover.imageRef; });
      item.coverImageRef = cover.imageRef;
    }
  }
  const resultImages = images.filter((image) => image.imageRole === "result");
  const states = [...new Set(resultImages.map((image) => image.healingState).filter((state) => state !== "unspecified"))];
  if (cover) item.imageUrl = cover.imageUrl;
  item.documentationStates = states;
  item.hasFreshAndHealed = states.includes("fresh") && states.includes("healed");
  if (includeImages) {
    item.primaryImage = admin || hasPublicConsent(primaryConsentStatus) ? primary : null;
    item.angles = documentedAngles;
  }
  return item;
}

async function nextSortOrder(db, state) {
  const row = await db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM portfolio_items WHERE state = ?")
    .bind(state)
    .first();
  return Number(row?.max_order || 0) + 1;
}

async function listPublic(env) {
  const db = requireDb(env);
  const [result, options] = await Promise.all([
    db.prepare(`
      SELECT * FROM portfolio_items
      WHERE state = 'published'
        AND primary_consent_status IN ('not-required','granted')
        AND EXISTS (SELECT 1 FROM content_entities ce WHERE ce.id = portfolio_items.id AND ce.visibility = 'public')
      ORDER BY sort_order ASC, created_at ASC
    `).all(),
    portfolioOptions(db),
  ]);
  const rows = result.results || [];
  const ids = rows.map((row) => row.id);
  const [media, documentation] = await Promise.all([galleryMedia(db, ids), imageDetails(db, ids)]);
  return json({
    items: rows.map((row) => applyImageDocumentation(
      decorateItem(itemFromRow(row), options),
      media.get(row.id) || [],
      documentation.get(row.id),
      { primaryConsentStatus: row.primary_consent_status }
    )),
    options,
  });
}

async function listAdmin(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const [result, options] = await Promise.all([
    db.prepare("SELECT * FROM portfolio_items ORDER BY CASE state WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, sort_order ASC, created_at ASC").all(),
    portfolioOptions(db, true),
  ]);
  const rows = result.results || [];
  const ids = rows.map((row) => row.id);
  const [media, documentation] = await Promise.all([galleryMedia(db, ids, true), imageDetails(db, ids)]);
  return json({
    items: rows.map((row) => applyImageDocumentation(
      decorateItem(itemFromRow(row, true), options),
      media.get(row.id) || [],
      documentation.get(row.id),
      { includeImages: true, admin: true, primaryConsentStatus: row.primary_consent_status }
    )),
    options,
  });
}

async function getPublicItem(env, id) {
  const db = requireDb(env);
  const row = await db.prepare(`
    SELECT * FROM portfolio_items
    WHERE id = ? AND state = 'published'
      AND primary_consent_status IN ('not-required','granted')
      AND EXISTS (SELECT 1 FROM content_entities ce WHERE ce.id = portfolio_items.id AND ce.visibility = 'public')
  `).bind(id).first();
  if (!row) return errorResponse("Portfolio item not found.", 404);
  const [media, options, documentation] = await Promise.all([galleryMedia(db, [id]), portfolioOptions(db), imageDetails(db, [id])]);
  const item = applyImageDocumentation(
    decorateItem(itemFromRow(row, false, true), options),
    media.get(id) || [],
    documentation.get(id),
    { includeImages: true, primaryConsentStatus: row.primary_consent_status }
  );
  return json({ item, options });
}

async function mediaResponse(request, env, id, admin = false) {
  if (admin) {
    const authError = adminError(request, env);
    if (authError) return authError;
  }
  const db = requireDb(env);
  const row = await db.prepare(
    `SELECT storage_key, content_type, original_filename FROM portfolio_items WHERE id = ?${admin ? "" : `
      AND state = 'published'
      AND primary_consent_status IN ('not-required','granted')
      AND EXISTS (SELECT 1 FROM content_entities ce WHERE ce.id = portfolio_items.id AND ce.visibility = 'public')
    `}`
  ).bind(id).first();
  if (!row?.storage_key) return errorResponse("Portfolio image not found.", 404);
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);
  const object = await env.SUBMISSION_FILES.get(row.storage_key);
  if (!object) return errorResponse("Portfolio image not found in storage.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.content_type || headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${String(row.original_filename || "portfolio-image").replace(/["\\]/g, "")}"`);
  headers.set("cache-control", "private, no-store");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

async function createUpload(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return errorResponse("Choose an image to upload.");
  const extension = ALLOWED_UPLOADS.get(String(file.type || "").toLowerCase());
  if (!extension) return errorResponse("Use a JPEG, PNG, or WebP image.", 415);
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("Images must be 15 MB or smaller.", 413);

  const db = requireDb(env);
  const id = crypto.randomUUID();
  const key = `portfolio/${id}.${extension}`;
  const order = await nextSortOrder(db, "draft");
  const originalFilename = cleanText(file.name, 255) || `portfolio.${extension}`;
  const title = cleanText(form.get("title"), 160);
  const altText = cleanText(form.get("altText"), 300);

  await env.SUBMISSION_FILES.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "private, no-store",
    },
    customMetadata: { itemId: id, originalFilename },
  });

  try {
    await db.batch([db.prepare(`
      INSERT INTO portfolio_items (
        id, storage_key, original_filename, content_type, title, alt_text,
        state, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
    `).bind(id, key, originalFilename, file.type, title, altText, order),
    db.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'portfolio_item','node-tattoos','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(id),
    db.prepare("INSERT INTO portfolio_image_details(portfolio_item_id,image_ref,healing_state,timing_note,caption,created_at,updated_at) VALUES(?,'primary','unspecified','','',datetime('now'),datetime('now'))").bind(id)]);
  } catch (error) {
    await env.SUBMISSION_FILES.delete(key);
    throw error;
  }

  const row = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  return json({ item: itemFromRow(row, true) }, { status: 201 });
}

function defaultAngleAltText(item, imageRole) {
  const subject = cleanText(item.title, 160) || "this tattoo project";
  if (imageRole === "before") return `Before / existing tattoo photograph for ${subject}`;
  if (imageRole === "process") return `Tattoo process photograph for ${subject}`;
  if (imageRole === "detail") return `Tattoo detail photograph for ${subject}`;
  return cleanText(item.alt_text, 1000) || `Finished tattoo result for ${subject}`;
}

async function createAngleUpload(request, env, itemId) {
  const authError = adminError(request, env);
  if (authError) return authError;
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);

  const db = requireDb(env);
  const item = await db.prepare("SELECT id,title,alt_text,project_type FROM portfolio_items WHERE id = ?").bind(itemId).first();
  if (!item) return errorResponse("Portfolio item not found.", 404);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return errorResponse("Choose an image to upload.");
  const extension = ALLOWED_UPLOADS.get(String(file.type || "").toLowerCase());
  if (!extension) return errorResponse("Use a JPEG, PNG, or WebP image.", 415);
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("Images must be 15 MB or smaller.", 413);
  const imageRole = cleanText(form.get("imageRole"), 20) || "result";
  if (!IMAGE_ROLES.has(imageRole)) return errorResponse("Choose Result, Before / existing tattoo, Process, or Detail.", 422);
  if (imageRole === "before" && (item.project_type || "standard") !== "cover_up") {
    return errorResponse("Save the Project type as Cover-up before uploading Before / existing tattoo photographs.", 409);
  }

  const mediaId = crypto.randomUUID();
  const originalFilename = cleanText(file.name, 255) || `portfolio-angle.${extension}`;
  const storageKey = `portfolio/${itemId}/${mediaId}.${extension}`;
  const altText = cleanText(form.get("altText"), 1000) || defaultAngleAltText(item, imageRole);
  const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM entity_media WHERE entity_id = ? AND role = 'gallery'")
    .bind(itemId).first();

  await env.SUBMISSION_FILES.put(storageKey, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "private, no-store" },
    customMetadata: { portfolioItemId: itemId, mediaId, originalFilename, imageRole },
  });
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO media_assets(
          id,storage_key,original_filename,mime_type,byte_size,alt_text,privacy,
          consent_status,state,created_by,created_at,updated_at,public_presentation
        ) VALUES(?,?,?,?,?,?,'private','unknown','active','studio',datetime('now'),datetime('now'),'inline')
      `).bind(mediaId, storageKey, originalFilename, file.type, file.size, altText),
      db.prepare(`
        INSERT INTO entity_media(
          entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at
        ) VALUES(?,?,'gallery',?,0,?,'',datetime('now'))
      `).bind(itemId, mediaId, Number(order?.next_order || 1), altText),
      db.prepare(`
        INSERT INTO portfolio_image_details(
          portfolio_item_id,image_ref,healing_state,image_role,timing_note,caption,created_at,updated_at
        ) VALUES(?,?,'unspecified',?,'','',datetime('now'),datetime('now'))
      `).bind(itemId, mediaId, imageRole),
    ]);
  } catch (error) {
    await env.SUBMISSION_FILES.delete(storageKey);
    throw error;
  }

  return json({
    image: {
      id: mediaId,
      imageRef: mediaId,
      imageRole,
      consentStatus: "unknown",
      privacy: "private",
      publicVisible: false,
      altText,
      originalFilename,
    },
  }, { status: 201 });
}

async function portfolioCoverImage(db, item) {
  const imageRef = item.cover_image_ref || "primary";
  if (imageRef === "primary") {
    const details = await db.prepare(`
      SELECT image_role FROM portfolio_image_details
      WHERE portfolio_item_id = ? AND image_ref = 'primary'
    `).bind(item.id).first();
    return {
      imageRef,
      imageRole: details?.image_role || "result",
      consentStatus: item.primary_consent_status || "unknown",
      publicVisible: true,
      privacy: "public",
      state: "active",
      publicPresentation: "inline",
    };
  }
  const row = await db.prepare(`
    SELECT COALESCE(pid.image_role, 'result') AS image_role,
      em.public_visible, m.privacy, m.consent_status, m.state,
      COALESCE(m.public_presentation, 'inline') AS public_presentation
    FROM entity_media em
    JOIN media_assets m ON m.id = em.media_id
    LEFT JOIN portfolio_image_details pid
      ON pid.portfolio_item_id = em.entity_id AND pid.image_ref = em.media_id
    WHERE em.entity_id = ? AND em.media_id = ? AND em.role = 'gallery'
  `).bind(item.id, imageRef).first();
  if (!row) return null;
  return {
    imageRef,
    imageRole: row.image_role || "result",
    consentStatus: row.consent_status || "unknown",
    publicVisible: Number(row.public_visible || 0) === 1,
    privacy: row.privacy || "internal",
    state: row.state || "active",
    publicPresentation: row.public_presentation || "inline",
  };
}

async function validatePublishedPortfolioItem(db, item) {
  if (!hasPublicConsent(item.primary_consent_status)) {
    return "Confirm publication permission for the primary result image before publishing.";
  }
  const cover = await portfolioCoverImage(db, item);
  if (!cover) return "Choose an available result image as the portfolio cover before publishing.";
  if (cover.imageRole !== "result") return "The portfolio cover must be a finished result image.";
  if (!hasPublicConsent(cover.consentStatus)) return "Confirm publication permission for the selected cover image before publishing.";
  if (cover.imageRef !== "primary" && (
    !cover.publicVisible
    || cover.privacy !== "public"
    || cover.state !== "active"
    || cover.publicPresentation !== "inline"
  )) return "Make the selected cover image publicly visible before publishing.";
  return "";
}

async function patchItem(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const current = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio item not found.", 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Send a JSON object.");
  const updates = [];
  const values = [];
  let nextProjectType = current.project_type || "standard";
  for (const [apiField, sqlField] of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, apiField)) continue;
    const max = apiField === "statement" || apiField === "processNotes"
      ? 10000
      : apiField === "caption" || apiField === "techniques" || apiField === "sessionNote"
        ? 2000
        : apiField === "similarInquiryNote"
          ? 1000
          : apiField === "altText"
            ? 300
            : 160;
    const value = cleanText(body[apiField], max);
    let storedValue = value;
    if (apiField === "primaryStyle") {
      storedValue = await resolveOptionValue(db, "style", value, current.primary_style || "unclassified");
      if (storedValue === null) return errorResponse("Choose an enabled primary style.");
    }
    if (apiField === "collection") {
      storedValue = await resolveOptionValue(db, "collection", value, current.collection || "");
      if (storedValue === null) return errorResponse("Choose an enabled collection.");
    }
    updates.push(`${sqlField} = ?`);
    values.push(storedValue);
  }

  if (Object.prototype.hasOwnProperty.call(body, "sessionCount")) {
    const raw = body.sessionCount;
    const value = raw === "" || raw == null ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 99)) {
      return errorResponse("Session count must be a whole number between 1 and 99.", 422);
    }
    updates.push("session_count = ?");
    values.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(body, "similarInquiriesEnabled")) {
    updates.push("similar_inquiries_enabled = ?");
    values.push(body.similarInquiriesEnabled === true || body.similarInquiriesEnabled === "true" || body.similarInquiriesEnabled === "on" ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(body, "imagePresentation")) {
    const presentation = cleanText(body.imagePresentation, 20);
    if (!IMAGE_PRESENTATIONS.has(presentation)) return errorResponse("Choose a valid image presentation.", 422);
    updates.push("image_presentation = ?");
    values.push(presentation);
  }

  if (Object.prototype.hasOwnProperty.call(body, "projectType")) {
    nextProjectType = cleanText(body.projectType, 20);
    if (!PROJECT_TYPES.has(nextProjectType)) return errorResponse("Choose Standard tattoo or Cover-up.", 422);
    if (nextProjectType === "standard") {
      const before = await db.prepare(`
        SELECT COUNT(*) AS count FROM portfolio_image_details
        WHERE portfolio_item_id = ? AND image_role = 'before'
      `).bind(id).first();
      if (Number(before?.count || 0) > 0) {
        return errorResponse("Reclassify or remove every Before / existing tattoo image before changing this project to Standard tattoo.", 409);
      }
    }
    if (nextProjectType !== (current.project_type || "standard")) {
      updates.push("project_type = ?");
      values.push(nextProjectType);
    }
  }

  let nextState = current.state;
  if (Object.prototype.hasOwnProperty.call(body, "state")) {
    nextState = cleanText(body.state, 20);
    if (!["draft", "published", "archived"].includes(nextState)) return errorResponse("Choose a valid state.");
    const nextTitle = Object.prototype.hasOwnProperty.call(body, "title") ? cleanText(body.title, 160) : current.title;
    const nextAlt = Object.prototype.hasOwnProperty.call(body, "altText") ? cleanText(body.altText, 300) : current.alt_text;
    if (nextState === "published" && current.state !== "published" && (!nextTitle || !nextAlt)) {
      return errorResponse("Title and alt text are required before publishing.", 422);
    }
    if (nextState !== current.state) {
      updates.push("state = ?");
      values.push(nextState);
      updates.push("sort_order = ?");
      values.push(await nextSortOrder(db, nextState));
    }
  }


  if (nextState === "published") {
    const publishError = await validatePublishedPortfolioItem(db, { ...current, project_type: nextProjectType });
    if (publishError) return errorResponse(publishError, 422);
  }

  if (!updates.length) return errorResponse("No portfolio changes were supplied.");
  updates.push("updated_at = datetime('now')");
  values.push(id);
  await db.prepare(`UPDATE portfolio_items SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  await db.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,public_at=CASE WHEN ?='public' THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?")
    .bind(nextState === "published" ? "public" : "internal", nextState === "published" ? 1 : 0, nextState === "published" ? "public" : "internal", id).run();
  const row = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  return json({ item: itemFromRow(row, true) });
}

async function patchImageDocumentation(request, env, itemId, imageRef) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Send a JSON object.");
  const db = requireDb(env);
  const item = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(itemId).first();
  if (!item) return errorResponse("Portfolio item not found.", 404);
  let attached = null;
  if (imageRef !== "primary") {
    attached = await db.prepare(`
      SELECT em.public_visible, m.privacy, m.consent_status, m.state,
        COALESCE(m.public_presentation, 'inline') AS public_presentation
      FROM entity_media em JOIN media_assets m ON m.id = em.media_id
      WHERE em.entity_id = ? AND em.media_id = ? AND em.role = 'gallery'
    `)
      .bind(itemId, imageRef).first();
    if (!attached) return errorResponse("Portfolio image not found.", 404);
  }
  const currentDetails = await db.prepare(`
    SELECT healing_state, image_role, timing_note, caption
    FROM portfolio_image_details WHERE portfolio_item_id = ? AND image_ref = ?
  `).bind(itemId, imageRef).first();
  const healingState = cleanText(body.healingState, 20) || "unspecified";
  if (!HEALING_STATES.has(healingState)) return errorResponse("Choose Fresh, Healed, In progress, or Unspecified.", 422);
  const imageRole = imageRef === "primary"
    ? "result"
    : cleanText(body.imageRole ?? currentDetails?.image_role ?? "result", 20);
  if (!IMAGE_ROLES.has(imageRole)) return errorResponse("Choose Result, Before / existing tattoo, Process, or Detail.", 422);
  if (imageRole === "before" && (item.project_type || "standard") !== "cover_up") {
    return errorResponse("Change this project to Cover-up before labeling an image Before / existing tattoo.", 409);
  }
  if ((item.cover_image_ref || "primary") === imageRef && imageRole !== "result") {
    return errorResponse("Choose another result image as the cover before changing this image role.", 409);
  }
  const currentConsent = imageRef === "primary"
    ? item.primary_consent_status || "unknown"
    : attached.consent_status || "unknown";
  const consentSupplied = Object.prototype.hasOwnProperty.call(body, "consentStatus");
  const consentStatus = cleanText(body.consentStatus ?? currentConsent, 30) || "unknown";
  if (!CONSENT_STATUSES.has(consentStatus)) return errorResponse("Choose a valid publication-permission status.", 422);
  const isCover = body.isCover === true || body.isCover === "true" || body.isCover === "on";
  if (isCover && imageRole !== "result") return errorResponse("Only a finished result image can be the portfolio cover.", 422);
  if (item.state === "published" && imageRef === "primary" && !hasPublicConsent(consentStatus)) {
    return errorResponse("Unpublish this portfolio item before removing permission from its primary result image.", 409);
  }
  if (item.state === "published" && (item.cover_image_ref || "primary") === imageRef && !hasPublicConsent(consentStatus)) {
    return errorResponse("Unpublish this portfolio item or choose another permitted result image before removing permission from its cover.", 409);
  }
  if (item.state === "published" && isCover && !hasPublicConsent(consentStatus)) {
    return errorResponse("Confirm publication permission before using this image as the cover.", 409);
  }
  if (item.state === "published" && isCover && imageRef !== "primary") {
    const nextPublicVisible = consentSupplied ? hasPublicConsent(consentStatus) : Number(attached.public_visible || 0) === 1;
    const nextPrivacy = consentSupplied ? (hasPublicConsent(consentStatus) ? "public" : "private") : attached.privacy;
    const nextPresentation = consentSupplied ? "inline" : attached.public_presentation;
    if (
      !nextPublicVisible
      || nextPrivacy !== "public"
      || attached.state !== "active"
      || nextPresentation !== "inline"
    ) {
      return errorResponse("Make this permitted result image publicly visible before using it as the cover.", 409);
    }
  }
  const timingNote = cleanText(body.timingNote, 160);
  const caption = cleanText(body.caption, 1000);
  const statements = [db.prepare(`
    INSERT INTO portfolio_image_details(portfolio_item_id, image_ref, healing_state, image_role, timing_note, caption, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(portfolio_item_id, image_ref) DO UPDATE SET
      healing_state = excluded.healing_state,
      image_role = excluded.image_role,
      timing_note = excluded.timing_note,
      caption = excluded.caption,
      updated_at = datetime('now')
  `).bind(itemId, imageRef, healingState, imageRole, timingNote, caption)];
  if (consentSupplied && imageRef === "primary") {
    statements.push(db.prepare("UPDATE portfolio_items SET primary_consent_status = ?, updated_at = datetime('now') WHERE id = ?").bind(consentStatus, itemId));
  } else if (consentSupplied) {
    const publicAllowed = hasPublicConsent(consentStatus);
    statements.push(
      db.prepare("UPDATE media_assets SET consent_status = ?, privacy = ?, public_presentation = 'inline', updated_at = datetime('now') WHERE id = ?")
        .bind(consentStatus, publicAllowed ? "public" : "private", imageRef),
      db.prepare("UPDATE entity_media SET public_visible = ? WHERE entity_id = ? AND media_id = ? AND role = 'gallery'")
        .bind(publicAllowed ? 1 : 0, itemId, imageRef)
    );
  }
  if (isCover) {
    statements.push(db.prepare("UPDATE portfolio_items SET cover_image_ref = ?, updated_at = datetime('now') WHERE id = ?").bind(imageRef, itemId));
  }
  await db.batch(statements);
  return json({ ok: true, itemId, imageRef });
}

async function createOption(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const kind = cleanText(body?.kind, 20);
  const label = cleanText(body?.label, 80);
  const value = optionSlug(body?.value || label);
  const description = cleanText(body?.description, 500);
  if (!['style', 'collection'].includes(kind)) return errorResponse("Choose styles or collections.", 422);
  if (!label) return errorResponse("Name is required.", 422);
  if (!value) return errorResponse("Add a valid key using letters or numbers.", 422);
  const db = requireDb(env);
  const existing = await db.prepare("SELECT id, value, label FROM portfolio_options WHERE kind = ? AND (value = ? COLLATE NOCASE OR label = ? COLLATE NOCASE)")
    .bind(kind, value, label).first();
  if (existing) return errorResponse(existing.value.toLowerCase() === value.toLowerCase() ? "That option key already exists." : "That option name already exists.", 409);
  const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM portfolio_options WHERE kind = ?")
    .bind(kind).first();
  const id = `portfolio-${kind}-${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO portfolio_options(id, kind, value, label, description, enabled, sort_order, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
  `).bind(id, kind, value, label, description, Number(order?.next_order || 1)).run();
  const row = await db.prepare("SELECT *, 0 AS usage_count FROM portfolio_options WHERE id = ?").bind(id).first();
  return json({ option: optionFromRow(row, true) }, { status: 201 });
}

async function patchOption(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Send a JSON object.");
  const db = requireDb(env);
  const current = await db.prepare("SELECT * FROM portfolio_options WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio option not found.", 404);
  const updates = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(body, "label")) {
    const label = cleanText(body.label, 80);
    if (!label) return errorResponse("Name is required.", 422);
    const duplicate = await db.prepare("SELECT id FROM portfolio_options WHERE kind = ? AND label = ? COLLATE NOCASE AND id <> ?")
      .bind(current.kind, label, id).first();
    if (duplicate) return errorResponse("That option name already exists.", 409);
    updates.push("label = ?"); values.push(label);
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    updates.push("description = ?"); values.push(cleanText(body.description, 500));
  }
  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    const enabled = body.enabled === true || body.enabled === "true" || body.enabled === "on";
    if (current.kind === "style" && current.value === "unclassified" && !enabled) {
      return errorResponse("Unclassified must remain enabled because it is the portfolio fallback.", 409);
    }
    updates.push("enabled = ?"); values.push(enabled ? 1 : 0);
  }
  if (!updates.length) return errorResponse("No option changes were supplied.");
  updates.push("updated_at = datetime('now')"); values.push(id);
  await db.prepare(`UPDATE portfolio_options SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return json({ ok: true, id });
}

async function deleteOption(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const option = await db.prepare("SELECT * FROM portfolio_options WHERE id = ?").bind(id).first();
  if (!option) return errorResponse("Portfolio option not found.", 404);
  if (option.kind === "style" && option.value === "unclassified") return errorResponse("Unclassified cannot be deleted.", 409);
  const usage = option.kind === "style"
    ? await db.prepare("SELECT COUNT(*) AS count FROM portfolio_items WHERE COALESCE(NULLIF(primary_style, ''), 'unclassified') = ?").bind(option.value).first()
    : await db.prepare("SELECT COUNT(*) AS count FROM portfolio_items WHERE collection = ?").bind(option.value).first();
  if (Number(usage?.count || 0) > 0) return errorResponse("This option is assigned to portfolio work. Disable it instead.", 409);
  await db.prepare("DELETE FROM portfolio_options WHERE id = ?").bind(id).run();
  return json({ ok: true, deletedId: id });
}

async function reorderOptions(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const kind = cleanText(body?.kind, 20);
  const ids = Array.isArray(body?.ids) ? body.ids.map((id) => cleanText(id, 160)) : [];
  if (!['style', 'collection'].includes(kind)) return errorResponse("Choose styles or collections.", 422);
  if (!ids.length || new Set(ids).size !== ids.length) return errorResponse("Send every option exactly once.");
  const db = requireDb(env);
  const current = await db.prepare("SELECT id FROM portfolio_options WHERE kind = ? ORDER BY sort_order, label COLLATE NOCASE").bind(kind).all();
  const expected = (current.results || []).map((row) => row.id);
  if (expected.length !== ids.length || expected.some((entry) => !ids.includes(entry))) {
    return errorResponse("The option list changed. Refresh before reordering.", 409);
  }
  await db.batch(ids.map((optionId, index) => db.prepare(
    "UPDATE portfolio_options SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND kind = ?"
  ).bind(index + 1, optionId, kind)));
  return json({ ok: true, ids });
}

async function archiveItem(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const current = await db.prepare("SELECT id, state FROM portfolio_items WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio item not found.", 404);
  const order = current.state === "archived" ? null : await nextSortOrder(db, "archived");
  if (order !== null) {
    await db.prepare("UPDATE portfolio_items SET state = 'archived', sort_order = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(order, id).run();
    await db.prepare("UPDATE content_entities SET visibility='internal',search_visibility=0,archived_at=datetime('now'),updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(id).run();
  }
  return json({ ok: true, archivedId: id });
}

async function permanentlyDeleteItem(request, env, id) {
  const authError = adminError(request, env);
  if (authError) return authError;
  if (!env.SUBMISSION_FILES) return errorResponse("Portfolio storage is not configured.", 503);

  const db = requireDb(env);
  const current = await db.prepare("SELECT * FROM portfolio_items WHERE id = ?").bind(id).first();
  if (!current) return errorResponse("Portfolio item not found.", 404);
  if (!current.storage_key) {
    return errorResponse("This image is not in managed storage yet. Migrate it before permanent deletion.", 409);
  }

  const attached = await db.prepare(`
    SELECT m.id, m.storage_key, m.mime_type
    FROM entity_media em JOIN media_assets m ON m.id = em.media_id
    WHERE em.entity_id = ? AND m.storage_key <> ''
  `).bind(id).all();
  const storedMedia = new Map([
    [current.storage_key, { id: `media-${id}`, storage_key: current.storage_key, mime_type: current.content_type }],
  ]);
  for (const media of attached.results || []) storedMedia.set(media.storage_key, media);
  const backups = [];
  let rollbackBytes = 0;
  for (const media of storedMedia.values()) {
    const object = await env.SUBMISSION_FILES.get(media.storage_key);
    if (object) {
      const objectBytes = Number(object.size || 0);
      if (rollbackBytes + objectBytes > MAX_DELETE_ROLLBACK_BYTES) {
        return errorResponse(
          "This entry has too much attached media to delete safely in one request. Remove some additional angles first.",
          409
        );
      }
      rollbackBytes += objectBytes;
      backups.push({
        media,
        body: await object.arrayBuffer(),
        options: { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata },
      });
    }
  }
  if (!backups.some((backup) => backup.media.storage_key === current.storage_key)) {
    return errorResponse("The stored image is missing. The portfolio entry was not deleted.", 409);
  }

  // Bounded rollback copies let us restore every angle if the D1 transaction
  // fails after the R2 deletions without exhausting the Worker's memory.
  await Promise.all(backups.map((backup) => env.SUBMISSION_FILES.delete(backup.media.storage_key)));
  try {
    await db.batch([
      db.prepare("DELETE FROM portfolio_image_details WHERE portfolio_item_id = ?").bind(id),
      db.prepare("DELETE FROM content_entities WHERE id = ?").bind(id),
      db.prepare("DELETE FROM portfolio_items WHERE id = ?").bind(id),
      ...[...storedMedia.values()].map((media) => db.prepare(
        "DELETE FROM media_assets WHERE id = ? AND NOT EXISTS (SELECT 1 FROM entity_media WHERE entity_media.media_id = media_assets.id)"
      ).bind(media.id)),
    ]);
  } catch (error) {
    await Promise.all(backups.map((backup) => env.SUBMISSION_FILES.put(
      backup.media.storage_key,
      backup.body,
      backup.options
    )));
    throw error;
  }

  return json({ ok: true, deletedId: id, deletedStorageKey: current.storage_key });
}

async function deleteAngle(request, env, itemId, mediaId) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const db = requireDb(env);
  const media = await db.prepare(`
    SELECT m.* FROM entity_media em JOIN media_assets m ON m.id = em.media_id
    WHERE em.entity_id = ? AND em.media_id = ? AND em.role = 'gallery'
  `).bind(itemId, mediaId).first();
  if (!media) return errorResponse("Portfolio angle not found.", 404);
  const object = media.storage_key && env.SUBMISSION_FILES
    ? await env.SUBMISSION_FILES.get(media.storage_key)
    : null;
  const rollback = object ? {
    body: await object.arrayBuffer(),
    options: { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata },
  } : null;
  if (object) await env.SUBMISSION_FILES.delete(media.storage_key);
  try {
    await db.batch([
      db.prepare("DELETE FROM portfolio_image_details WHERE portfolio_item_id = ? AND image_ref = ?").bind(itemId, mediaId),
      db.prepare("UPDATE portfolio_items SET cover_image_ref = 'primary', updated_at = datetime('now') WHERE id = ? AND cover_image_ref = ?").bind(itemId, mediaId),
      db.prepare("DELETE FROM entity_media WHERE entity_id = ? AND media_id = ? AND role = 'gallery'").bind(itemId, mediaId),
      db.prepare("DELETE FROM media_assets WHERE id = ? AND NOT EXISTS (SELECT 1 FROM entity_media WHERE entity_media.media_id = media_assets.id)").bind(mediaId),
    ]);
  } catch (error) {
    if (rollback && media.storage_key) await env.SUBMISSION_FILES.put(media.storage_key, rollback.body, rollback.options);
    throw error;
  }
  return json({ ok: true, deletedMediaId: mediaId });
}

async function reorderAngles(request, env, itemId) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map((id) => cleanText(id, 160)) : [];
  if (new Set(ids).size !== ids.length) return errorResponse("Send each angle exactly once.");
  const db = requireDb(env);
  const current = await db.prepare("SELECT media_id FROM entity_media WHERE entity_id = ? AND role = 'gallery'").bind(itemId).all();
  const expected = (current.results || []).map((row) => row.media_id);
  if (ids.length !== expected.length || expected.some((id) => !ids.includes(id))) {
    return errorResponse("The image list changed. Refresh before reordering.", 409);
  }
  await db.batch(ids.map((mediaId, index) => db.prepare(
    "UPDATE entity_media SET sort_order = ? WHERE entity_id = ? AND media_id = ? AND role = 'gallery'"
  ).bind(index + 1, itemId, mediaId)));
  return json({ ok: true, ids });
}

async function reorderItems(request, env) {
  const authError = adminError(request, env);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const state = cleanText(body?.state, 20);
  const ids = Array.isArray(body?.ids) ? body.ids.map((id) => cleanText(id, 80)) : [];
  if (!["published", "draft"].includes(state)) return errorResponse("Only published or draft items can be reordered.");
  if (!ids.length || new Set(ids).size !== ids.length) return errorResponse("Send each item ID exactly once.");

  const db = requireDb(env);
  const result = await db.prepare("SELECT id FROM portfolio_items WHERE state = ? ORDER BY sort_order ASC").bind(state).all();
  const expected = (result.results || []).map((row) => row.id);
  if (expected.length !== ids.length || expected.some((id) => !ids.includes(id))) {
    return errorResponse("The portfolio changed. Refresh before reordering.", 409);
  }
  await db.batch(ids.map((id, index) => db.prepare(
    "UPDATE portfolio_items SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND state = ?"
  ).bind(index + 1, id, state)));
  return json({ ok: true, ids });
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", allow: allowed.join(", ") },
  });
}

export async function handlePortfolioApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path === "/api/portfolio") {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return listPublic(env);
    }
    if (path.startsWith("/api/portfolio/media/")) {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return mediaResponse(request, env, decodeURIComponent(path.slice("/api/portfolio/media/".length)));
    }
    const publicItemMatch = path.match(/^\/api\/portfolio\/([^/]+)$/);
    if (publicItemMatch) {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return getPublicItem(env, decodeURIComponent(publicItemMatch[1]));
    }
    if (path === "/api/admin/portfolio") {
      if (method === "GET") return listAdmin(request, env);
      if (method === "POST") return createUpload(request, env);
      return methodNotAllowed(["GET", "POST"]);
    }
    if (path === "/api/admin/portfolio/reorder") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return reorderItems(request, env);
    }
    if (path === "/api/admin/portfolio/settings") {
      if (method === "GET") {
        const authError = adminError(request, env);
        if (authError) return authError;
        return json({ options: await portfolioOptions(requireDb(env), true) });
      }
      if (method === "POST") return createOption(request, env);
      return methodNotAllowed(["GET", "POST"]);
    }
    if (path === "/api/admin/portfolio/settings/reorder") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return reorderOptions(request, env);
    }
    const settingsMatch = path.match(/^\/api\/admin\/portfolio\/settings\/([^/]+)$/);
    if (settingsMatch) {
      const id = decodeURIComponent(settingsMatch[1]);
      if (method === "PATCH") return patchOption(request, env, id);
      if (method === "DELETE") return deleteOption(request, env, id);
      return methodNotAllowed(["PATCH", "DELETE"]);
    }
    if (path.startsWith("/api/admin/portfolio/media/")) {
      if (method !== "GET") return methodNotAllowed(["GET"]);
      return mediaResponse(request, env, decodeURIComponent(path.slice("/api/admin/portfolio/media/".length)), true);
    }
    const imageUploadMatch = path.match(/^\/api\/admin\/portfolio\/([^/]+)\/images$/);
    if (imageUploadMatch) {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return createAngleUpload(request, env, decodeURIComponent(imageUploadMatch[1]));
    }
    const imageDocumentationMatch = path.match(/^\/api\/admin\/portfolio\/([^/]+)\/images\/([^/]+)$/);
    if (imageDocumentationMatch) {
      if (method !== "PATCH") return methodNotAllowed(["PATCH"]);
      return patchImageDocumentation(request, env, decodeURIComponent(imageDocumentationMatch[1]), decodeURIComponent(imageDocumentationMatch[2]));
    }
    const angleOrderMatch = path.match(/^\/api\/admin\/portfolio\/([^/]+)\/angles\/reorder$/);
    if (angleOrderMatch) {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return reorderAngles(request, env, decodeURIComponent(angleOrderMatch[1]));
    }
    const angleMatch = path.match(/^\/api\/admin\/portfolio\/([^/]+)\/angles\/([^/]+)$/);
    if (angleMatch) {
      if (method !== "DELETE") return methodNotAllowed(["DELETE"]);
      return deleteAngle(request, env, decodeURIComponent(angleMatch[1]), decodeURIComponent(angleMatch[2]));
    }
    const permanentMatch = path.match(/^\/api\/admin\/portfolio\/([^/]+)\/permanent$/);
    if (permanentMatch) {
      if (method !== "DELETE") return methodNotAllowed(["DELETE"]);
      return await permanentlyDeleteItem(request, env, decodeURIComponent(permanentMatch[1]));
    }
    if (path.startsWith("/api/admin/portfolio/")) {
      const id = decodeURIComponent(path.slice("/api/admin/portfolio/".length));
      if (method === "PATCH") return patchItem(request, env, id);
      if (method === "DELETE") return archiveItem(request, env, id);
      return methodNotAllowed(["PATCH", "DELETE"]);
    }
    return errorResponse("Unknown portfolio API route.", 404);
  } catch (error) {
    if (String(error?.message || error).includes("published portfolio cover must remain eligible")) {
      return errorResponse("Unpublish this tattoo or choose another permitted result image before changing its published cover.", 409);
    }
    if (String(error?.message || error).includes("before images require a cover-up portfolio project")) {
      return errorResponse("Save the Project type as Cover-up before adding Before / existing tattoo images.", 409);
    }
    return errorResponse("Unable to process the portfolio request.", 500, error.message);
  }
}
