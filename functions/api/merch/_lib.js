import { fetchCatalog as fetchShopifyCatalog, fetchProductByHandle } from "../shop/_lib.js";
import { captureMarketingConsent } from "../outreach/_lib.js";
import { db, failure, json, readJson, requireStudioAdmin, text } from "../_shared/construct.js";
import {
  publishTemplateDraft,
  saveTemplateDraft,
  templateRevision,
} from "../notifications/_email-template-store.js";

const PUBLIC_STATES = new Set(["published"]);
const PUBLIC_AVAILABILITY = new Set(["coming_soon", "available", "sold_out"]);
const TEMPLATE_KEYS = new Set(["merch_launch_confirmation", "merch_launch_available"]);
const DEFAULT_TEMPLATES = Object.freeze({
  merch_launch_confirmation: {
    subject: "Confirm your {{product_title}} launch alert",
    preheader: "Confirm the one-time alert you requested.",
    heading: "Confirm your launch alert.",
    body: "You asked Six.Well Merch to email you once when {{product_title}} launches. Confirm this request below.",
    buttonLabel: "Confirm launch alert",
    footer: "This confirmation applies only to this product. Newsletter membership is handled separately.",
  },
  merch_launch_available: {
    subject: "{{product_title}} is now available",
    preheader: "The product alert you requested has arrived.",
    heading: "{{product_title}} is now available.",
    body: "This is the one-time launch alert you requested from Six.Well Merch.",
    buttonLabel: "View {{product_title}}",
    footer: "You will not receive another product alert from this request.",
  },
});

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : "";
}

function slugify(value) {
  return text(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicBaseUrl(env, request) {
  return String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
}

function sourceLabel(source) {
  return ({
    "six.well": "six.well clothing",
    thoughtpuppet: "thoughtpuppet",
    "art.pill": "art.pill Tattoo Supply",
  })[source] || source || "six.well clothing";
}

function normalizeOptions(value) {
  const source = safeJson(value, {});
  return Object.entries(source).map(([name, values]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    values: Array.isArray(values) ? values.map(String) : [],
  })).filter((entry) => entry.values.length);
}

function productMediaUrl(mediaId, sourceUrl = "") {
  return sourceUrl || `/api/construct/entity-media/${encodeURIComponent(mediaId)}`;
}

async function productMedia(database, entityIds, { publicOnly = false } = {}) {
  const ids = [...new Set((entityIds || []).filter(Boolean))];
  const map = new Map(ids.map((entityId) => [entityId, []]));
  if (!ids.length) return map;
  const conditions = [
    `em.entity_id IN (${ids.map(() => "?").join(",")})`,
    "m.state='active'",
    "m.mime_type LIKE 'image/%'",
  ];
  if (publicOnly) conditions.push(
    "em.public_visible=1",
    "m.privacy='public'",
    "m.consent_status IN ('not-required','granted')",
    "m.public_presentation='inline'",
  );
  const result = await database.prepare(`SELECT em.entity_id,em.media_id,em.role,em.sort_order,em.public_visible,
      em.alt_text_override,m.source_url,m.original_filename,m.mime_type,m.alt_text
    FROM entity_media em JOIN media_assets m ON m.id=em.media_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY em.entity_id,CASE em.role WHEN 'primary' THEN 0 ELSE 1 END,em.sort_order,em.created_at`).bind(...ids).all();
  for (const row of result.results || []) {
    if (!map.has(row.entity_id)) map.set(row.entity_id, []);
    map.get(row.entity_id).push({
      id: row.media_id,
      role: row.role,
      sortOrder: Number(row.sort_order) || 0,
      publicVisible: Number(row.public_visible) === 1,
      url: productMediaUrl(row.media_id, row.source_url),
      adminUrl: `/api/admin/media/${encodeURIComponent(row.media_id)}/file`,
      altText: row.alt_text_override || row.alt_text || "",
      filename: row.original_filename || "",
      mimeType: row.mime_type || "",
    });
  }
  return map;
}

function publicProduct(row, shopify = null, media = []) {
  const live = row.availability_state === "available" && shopify ? shopify : null;
  const handle = row.shopify_handle || row.slug;
  const primaryMedia = media.find((item) => item.role === "primary") || media[0] || null;
  const studioImages = media.map((item) => ({ url: item.url, altText: item.altText || row.alt_text || row.title }));
  return {
    ...(live || {}),
    id: row.id,
    slug: row.slug,
    handle,
    shopifyHandle: row.shopify_handle || null,
    title: row.title,
    productType: row.product_type || live?.productType || "other",
    publicationState: row.state,
    availabilityState: row.availability_state,
    sourceVenture: row.source_venture,
    sourceLabel: sourceLabel(row.source_venture),
    statement: row.statement || "",
    description: row.description || "",
    price: live?.price || null,
    availableForSale: Boolean(live?.availableForSale && live?.variants?.some((variant) => variant.availableForSale)),
    options: live?.options?.length ? live.options : normalizeOptions(row.options_json),
    variants: live?.variants || [],
    images: studioImages.length ? studioImages : live?.images || [],
    heroImage: primaryMedia?.url || row.image_url || live?.heroImage || null,
    heroImageAlt: primaryMedia?.altText || row.alt_text || live?.heroImageAlt || row.title,
    pagePath: row.route || `/merch/${encodeURIComponent(row.slug)}/`,
    canonicalRoute: row.route || `/merch/${encodeURIComponent(row.slug)}/`,
    catalogNumber: row.catalog_number || null,
    editionText: row.edition_text || (row.availability_state === "coming_soon" ? "coming soon" : null),
    shippingNote: row.shipping_note || "",
    priceNote: row.price_note || "",
    originTitle: row.origin_title || "",
    originPath: row.origin_path || "",
    originThumb: row.origin_thumb || "",
    originMeta: row.origin_meta || "",
    notifyEnabled: row.availability_state === "coming_soon" && Number(row.notify_enabled) === 1,
  };
}

async function shopifyProducts(env) {
  try { return { products: await fetchShopifyCatalog(env, { signal: AbortSignal.timeout(4000) }), error: "" }; }
  catch (error) {
    console.warn(JSON.stringify({ event: "merch_shopify_catalog_unavailable", error: error.message }));
    return { products: [], error: error.message || "Shopify is unavailable." };
  }
}

async function publicRows(env, slug = "") {
  const database = db(env);
  if (slug) {
    const row = await database.prepare(
      "SELECT * FROM merch_items WHERE slug=? AND state='published' LIMIT 1",
    ).bind(slug).first();
    return row ? [row] : [];
  }
  const result = await database.prepare(
    "SELECT * FROM merch_items WHERE state='published' ORDER BY sort_order,id",
  ).all();
  return result.results || [];
}

export async function handleMerchCatalog(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const [rows, shopify] = await Promise.all([publicRows(env), shopifyProducts(env)]);
  const media = await productMedia(db(env), rows.map((row) => row.id), { publicOnly: true });
  const byHandle = new Map(shopify.products.map((product) => [product.handle, product]));
  return json({
    products: rows.map((row) => publicProduct(row, row.shopify_handle ? byHandle.get(row.shopify_handle) : null, media.get(row.id) || [])),
    commerceAvailable: !shopify.error,
  });
}

export async function handleMerchItem(request, env, itemSlug) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const rows = await publicRows(env, itemSlug);
  const row = rows[0];
  if (!row) return failure("Not found.", 404);
  let shopify = null;
  if (row.shopify_handle) {
    try { shopify = await fetchProductByHandle(env, row.shopify_handle, { signal: AbortSignal.timeout(4000) }); }
    catch (error) { console.warn(JSON.stringify({ event: "merch_shopify_product_unavailable", slug: row.slug, error: error.message })); }
  }
  const media = await productMedia(db(env), [row.id], { publicOnly: true });
  return json({ product: publicProduct(row, shopify, media.get(row.id) || []) });
}

function substitute(template, values) {
  return String(template || "").replace(/\{\{([a-z_]+)\}\}/g, (_match, key) => String(values[key] || ""));
}

async function resolvedTemplate(database, templateKey) {
  const published = await templateRevision(database, templateKey, "default", "published");
  return { revision: published?.revision || 0, content: { ...DEFAULT_TEMPLATES[templateKey], ...(published?.content || {}) } };
}

function renderTemplate(templateKey, content, values) {
  const subject = substitute(content.subject, values);
  const heading = substitute(content.heading, values);
  const body = substitute(content.body, values);
  const buttonLabel = substitute(content.buttonLabel, values);
  const footer = substitute(content.footer, values);
  const actionUrl = templateKey === "merch_launch_confirmation" ? values.confirm_url : values.product_url;
  const image = templateKey === "merch_launch_available" && values.image_url
    ? `<img src="${escapeHtml(values.image_url)}" alt="${escapeHtml(values.product_title)}" style="display:block;width:100%;height:auto;margin:0 0 24px">`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#090909;color:#fcb867;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px">${image}<p style="font-size:12px;letter-spacing:.18em;text-transform:uppercase">Six.Well Merch</p><h1 style="font-family:Georgia,serif;font-size:34px;color:#f08f00">${escapeHtml(heading)}</h1><p style="line-height:1.7">${escapeHtml(body)}</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#f08f00;color:#090909;padding:14px 18px;font-weight:700;text-decoration:none">${escapeHtml(buttonLabel)}</a></p>${values.cancel_url ? `<p style="font-size:12px"><a href="${escapeHtml(values.cancel_url)}" style="color:#fcb867">Cancel this product alert</a></p>` : ""}<p style="font-size:12px;line-height:1.6;color:#b87a32">${escapeHtml(footer)}</p></div></body></html>`;
  const textBody = ["Six.Well Merch", heading, body, `${buttonLabel}: ${actionUrl}`, values.cancel_url ? `Cancel this product alert: ${values.cancel_url}` : "", footer].filter(Boolean).join("\n\n");
  return { subject, html, text: textBody };
}

async function sendMerchEmail(env, message) {
  if (!env.EMAIL?.send) throw new Error("Cloudflare EMAIL binding is unavailable.");
  const fromEmail = env.MERCH_FROM_EMAIL || env.NOTIFICATION_FROM_EMAIL;
  if (!fromEmail) throw new Error("Merch sender address is not configured.");
  return env.EMAIL.send({
    to: message.to,
    from: { email: fromEmail, name: env.MERCH_FROM_NAME || "Six.Well Merch" },
    replyTo: env.MERCH_REPLY_TO || env.NOTIFICATION_REPLY_TO || fromEmail,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}

async function recordNotification(database, delivery) {
  try {
    await database.prepare(`INSERT INTO notification_deliveries(
      id,channel,template_key,template_variant,template_revision,email_design_revision,email_theme,
      recipient,subject,related_type,related_id,idempotency_key,status,error,sent_at,created_at
    ) VALUES(?,?,?,?,?,0,'construct_studio',?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(idempotency_key) DO UPDATE SET status=excluded.status,error=excluded.error,sent_at=excluded.sent_at`)
      .bind(crypto.randomUUID(),"email",delivery.templateKey,"default",delivery.templateRevision || 0,
        delivery.recipient,delivery.subject,delivery.relatedType,delivery.relatedId,delivery.idempotencyKey,
        delivery.status,delivery.error || "",delivery.status === "sent" ? new Date().toISOString() : null).run();
  } catch (error) {
    console.warn(JSON.stringify({ event: "merch_notification_log_failed", error: error.message }));
  }
}

async function newsletterOptIn(env, input) {
  if (!input.requested) return { requested: false };
  const outcome = await captureMarketingConsent(env, {
    emailOptIn: true,
    email: input.email,
    source: "merch_launch_alert",
    sourceId: input.alertId,
    sourceDetail: input.productTitle,
    formPath: input.formPath,
    requestId: input.requestId,
  }).catch((error) => ({ error: error.message }));
  return { requested: true, accepted: true, outcome };
}

export async function handleLaunchAlertSignup(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  if (!enabled(env.MERCH_ALERTS_ENABLED) || !enabled(env.MERCH_EMAIL_SEND_ENABLED)) {
    return failure("Product launch alerts are not available yet.", 503);
  }
  const body = await readJson(request);
  const productSlug = slugify(body?.slug);
  const email = normalizeEmail(body?.email);
  const consentVersion = text(body?.disclosureVersion, 80);
  if (!productSlug || !email || !consentVersion) return failure("A product, valid email, and disclosure version are required.");
  const database = db(env);
  const product = await database.prepare("SELECT * FROM merch_items WHERE slug=? AND state='published' AND availability_state='coming_soon' AND notify_enabled=1").bind(productSlug).first();
  if (!product) return failure("Launch alerts are not available for this product.", 404);

  const existing = await database.prepare("SELECT * FROM merch_launch_alerts WHERE merch_item_id=? AND email=?").bind(product.id,email).first();
  if (existing?.status === "confirmed" || existing?.status === "sent") return json({ ok: true, message: "Check your email to confirm this product alert." }, { status: 202 });
  if (existing?.last_confirmation_sent_at && Date.now() - Date.parse(existing.last_confirmation_sent_at) < 10 * 60 * 1000) {
    return json({ ok: true, message: "Check your email to confirm this product alert." }, { status: 202 });
  }

  const rawToken = randomToken();
  const tokenHash = await sha256(rawToken);
  const alertId = existing?.id || `merch-alert-${crypto.randomUUID()}`;
  const newsletterRequested = Boolean(body?.newsletterOptIn);
  const evidence = {
    disclosureVersion: consentVersion,
    formPath: text(body?.formPath || new URL(request.url).pathname, 500),
    userAgent: text(request.headers.get("user-agent"), 500),
    ipHash: await sha256(request.headers.get("cf-connecting-ip") || "unknown"),
  };
  await database.prepare(`INSERT INTO merch_launch_alerts(
      id,merch_item_id,email,status,token_hash,consent_version,consent_evidence_json,newsletter_requested,last_confirmation_sent_at,created_at,updated_at
    ) VALUES(?,?,?,'pending',?,?,?,?,?,datetime('now'),datetime('now'))
    ON CONFLICT(merch_item_id,email) DO UPDATE SET status='pending',token_hash=excluded.token_hash,
      consent_version=excluded.consent_version,consent_evidence_json=excluded.consent_evidence_json,
      newsletter_requested=excluded.newsletter_requested,last_confirmation_sent_at=excluded.last_confirmation_sent_at,
      cancelled_at=NULL,updated_at=datetime('now')`)
    .bind(alertId,product.id,email,tokenHash,consentVersion,JSON.stringify(evidence),newsletterRequested ? 1 : 0,new Date().toISOString()).run();

  const base = publicBaseUrl(env, request);
  const confirmUrl = `${base}/merch/alerts/confirm/?token=${encodeURIComponent(rawToken)}`;
  const cancelUrl = `${base}/merch/alerts/cancel/?token=${encodeURIComponent(rawToken)}`;
  const template = await resolvedTemplate(database, "merch_launch_confirmation");
  const rendered = renderTemplate("merch_launch_confirmation", template.content, {
    product_title: product.title, confirm_url: confirmUrl, cancel_url: cancelUrl,
  });
  try {
    await sendMerchEmail(env, { to: email, ...rendered });
    await recordNotification(database, { templateKey: "merch_launch_confirmation", templateRevision: template.revision, recipient: email, subject: rendered.subject, relatedType: "merch_launch_alert", relatedId: alertId, idempotencyKey: `merch-alert-confirm:${alertId}:${tokenHash}`, status: "sent" });
  } catch (error) {
    await recordNotification(database, { templateKey: "merch_launch_confirmation", templateRevision: template.revision, recipient: email, subject: rendered.subject, relatedType: "merch_launch_alert", relatedId: alertId, idempotencyKey: `merch-alert-confirm:${alertId}:${tokenHash}`, status: "failed", error: error.message });
    await database.prepare("UPDATE merch_launch_alerts SET last_confirmation_sent_at=NULL,updated_at=datetime('now') WHERE id=?").bind(alertId).run();
    return failure("Product launch alerts are temporarily unavailable.", 503);
  }
  const newsletter = await newsletterOptIn(env, { requested: newsletterRequested, email, alertId, productTitle: product.title, formPath: evidence.formPath, requestId: request.headers.get("cf-ray") || alertId });
  return json({ ok: true, message: "Check your email to confirm this product alert.", newsletterRequested: newsletter.requested }, { status: 202 });
}

export async function handleLaunchAlertToken(request, env, action) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  const body = await readJson(request);
  const rawToken = text(body?.token, 200);
  if (!rawToken) return failure("Missing confirmation token.");
  const database = db(env);
  const tokenHash = await sha256(rawToken);
  const alert = await database.prepare("SELECT a.*,m.title,m.slug FROM merch_launch_alerts a JOIN merch_items m ON m.id=a.merch_item_id WHERE a.token_hash=?").bind(tokenHash).first();
  if (!alert) return failure("This alert link is invalid or no longer available.", 404);
  if (action === "confirm") {
    if (alert.status === "pending") await database.prepare("UPDATE merch_launch_alerts SET status='confirmed',confirmed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(alert.id).run();
    return json({ ok: true, status: "confirmed", productTitle: alert.title, productPath: `/merch/${encodeURIComponent(alert.slug)}/` });
  }
  if (["pending","confirmed"].includes(alert.status)) await database.prepare("UPDATE merch_launch_alerts SET status='cancelled',cancelled_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(alert.id).run();
  return json({ ok: true, status: "cancelled", productTitle: alert.title });
}

const EDITABLE_FIELDS = [
  "title","product_type","state","availability_state","source_venture","catalog_number","statement","description",
  "edition_text","shipping_note","price_note","image_url","alt_text","origin_title","origin_path","origin_thumb",
  "origin_meta","options_json","notify_enabled","sort_order","shopify_handle",
];

function merchValues(body, current = {}) {
  const values = {};
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (["notify_enabled","sort_order"].includes(field)) values[field] = Number(body[field]) || 0;
    else if (field === "shopify_handle") values[field] = text(body[field], 160) || null;
    else if (field === "options_json") values[field] = JSON.stringify(safeJson(body[field], {}));
    else values[field] = text(body[field], field === "description" ? 12000 : 3000);
  }
  const requestedSlug = slugify(body.slug || current.slug || body.title);
  if (requestedSlug) values.slug = requestedSlug;
  if (values.slug) values.route = `/merch/${values.slug}/`;
  return values;
}

async function alertCounts(database) {
  const result = await database.prepare("SELECT merch_item_id,status,COUNT(*) count FROM merch_launch_alerts GROUP BY merch_item_id,status").all();
  const map = new Map();
  for (const row of result.results || []) {
    if (!map.has(row.merch_item_id)) map.set(row.merch_item_id, {});
    map.get(row.merch_item_id)[row.status] = Number(row.count) || 0;
  }
  return map;
}

async function adminList(database, env) {
  const [rowsResult, counts, shopify] = await Promise.all([
    database.prepare("SELECT m.*,ce.public_at FROM merch_items m JOIN content_entities ce ON ce.id=m.id ORDER BY m.sort_order,m.id").all(),
    alertCounts(database),
    shopifyProducts(env),
  ]);
  const rows = rowsResult.results || [];
  const media = await productMedia(database, rows.map((row) => row.id));
  const connected = new Set(rows.map((row) => row.shopify_handle).filter(Boolean));
  return {
    records: rows.map((row) => ({ ...row, media: media.get(row.id) || [], alert_counts: counts.get(row.id) || {}, canonical_route: row.route })),
    reconciliation: {
      shopifyAvailable: !shopify.error,
      shopifyError: shopify.error,
      shopifyOnly: shopify.products.filter((product) => !connected.has(product.handle)),
      brokenHandles: rows.filter((row) => row.shopify_handle && !shopify.products.some((product) => product.handle === row.shopify_handle)).map((row) => row.id),
    },
  };
}

async function createMerch(request, env) {
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env);
  const values = merchValues({ ...body, state: "draft", availability_state: body.availability_state || "coming_soon" });
  if (!values.slug || !values.title) return failure("A title and stable slug are required.");
  if (!PUBLIC_AVAILABILITY.has(values.availability_state)) return failure("Invalid availability state.");
  const recordId = text(body.id, 160) || `merch-${crypto.randomUUID()}`;
  const fields = Object.keys(values);
  try {
    await database.batch([
      database.prepare("INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_by,updated_by,created_at,updated_at) VALUES(?,'merch_item','node-merch','internal',0,'studio','studio',datetime('now'),datetime('now'))").bind(recordId),
      database.prepare(`INSERT INTO merch_items(id,${fields.join(",")},created_at,updated_at) VALUES(?,${fields.map(() => "?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...fields.map((field) => values[field])),
    ]);
  } catch (error) { return failure(error.message, 409); }
  return json({ record: await database.prepare("SELECT * FROM merch_items WHERE id=?").bind(recordId).first() }, { status: 201 });
}

async function updateMerch(request, env, recordId) {
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  const database = db(env);
  const before = await database.prepare("SELECT m.*,ce.public_at FROM merch_items m JOIN content_entities ce ON ce.id=m.id WHERE m.id=?").bind(recordId).first();
  if (!before) return failure("Merch product not found.", 404);
  const values = merchValues(body, before);
  if (before.public_at && values.slug && values.slug !== before.slug) return failure("The product slug is permanent after first publication.", 409);
  if (values.state && !["draft","published","retired","archived"].includes(values.state)) return failure("Invalid publication state.");
  if (values.availability_state === "available" && before.availability_state !== "available") return failure("Use the confirmed launch action to make a product available.", 409);
  const projected = { ...before, ...values };
  if (projected.state === "published" && (!projected.slug || !projected.title)) return failure("A title and stable slug are required before publication.", 409);
  const fields = Object.keys(values);
  if (!fields.length) return failure("No editable fields supplied.");
  try {
    await database.batch([
      database.prepare(`UPDATE merch_items SET ${fields.map((field) => `${field}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...fields.map((field) => values[field]),recordId),
      database.prepare("UPDATE content_entities SET visibility=?,search_visibility=?,public_at=CASE WHEN ?='published' THEN COALESCE(public_at,datetime('now')) ELSE public_at END,updated_by='studio',updated_at=datetime('now') WHERE id=?")
        .bind(projected.state === "published" ? "public" : "internal",projected.state === "published" ? 1 : 0,projected.state,recordId),
    ]);
  } catch (error) { return failure(error.message, 409); }
  return json({ record: await database.prepare("SELECT * FROM merch_items WHERE id=?").bind(recordId).first() });
}

async function importShopifyProduct(request, env) {
  const body = await readJson(request);
  const handle = text(body?.handle, 160);
  if (!handle) return failure("A Shopify handle is required.");
  let product;
  try { product = await fetchProductByHandle(env, handle); } catch (error) { return failure(error.message, 409); }
  if (!product) return failure("Shopify product not found.", 404);
  return createMerch(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({
    title: product.title, slug: product.handle, shopify_handle: product.handle, product_type: product.productType,
    image_url: product.heroImage || "", alt_text: product.heroImageAlt || product.title, state: "draft", availability_state: "coming_soon",
  }) }), env);
}

async function launchReadiness(database, env, recordId) {
  const product = await database.prepare("SELECT * FROM merch_items WHERE id=?").bind(recordId).first();
  if (!product) return null;
  const media = await productMedia(database, [recordId], { publicOnly: true });
  const primaryMedia = (media.get(recordId) || []).find((item) => item.role === "primary") || (media.get(recordId) || [])[0];
  if (primaryMedia) {
    product.image_url = primaryMedia.url;
    product.alt_text = primaryMedia.altText || product.alt_text;
  }
  const confirmed = await database.prepare("SELECT COUNT(*) count FROM merch_launch_alerts WHERE merch_item_id=? AND status='confirmed'").bind(recordId).first();
  let shopify = null;
  let shopifyError = "";
  if (product.shopify_handle) {
    try { shopify = await fetchProductByHandle(env, product.shopify_handle); }
    catch (error) { shopifyError = error.message; }
  }
  const sellable = Boolean(shopify?.availableForSale && shopify?.variants?.some((variant) => variant.availableForSale));
  const reasons = [];
  if (product.state !== "published") reasons.push("Publish the Studio record first.");
  if (product.availability_state !== "coming_soon") reasons.push("Only Coming Soon products can be launched.");
  if (!product.shopify_handle) reasons.push("Connect a Shopify product.");
  if (!sellable) reasons.push(shopifyError || "Shopify needs at least one sellable variant.");
  return { product, audienceCount: Number(confirmed?.count) || 0, shopify, ready: reasons.length === 0, reasons };
}

async function previewLaunch(request, env, recordId) {
  const database = db(env);
  const readiness = await launchReadiness(database, env, recordId);
  if (!readiness) return failure("Merch product not found.", 404);
  const template = await resolvedTemplate(database, "merch_launch_available");
  const rendered = renderTemplate("merch_launch_available", template.content, {
    product_title: readiness.product.title,
    product_url: `${publicBaseUrl(env, request)}${readiness.product.route}`,
    image_url: readiness.product.image_url,
  });
  return json({ ...readiness, templateRevision: template.revision, preview: rendered });
}

async function sendLaunchDelivery(database, env, request, launch, delivery, product, template) {
  const rendered = renderTemplate("merch_launch_available", template.content, {
    product_title: product.title,
    product_url: `${publicBaseUrl(env, request)}${product.route}`,
    image_url: product.image_url,
  });
  try {
    await sendMerchEmail(env, { to: delivery.email, ...rendered });
    await database.batch([
      database.prepare("UPDATE merch_launch_deliveries SET status='sent',attempt_count=attempt_count+1,error='',sent_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(delivery.delivery_id),
      database.prepare("UPDATE merch_launch_alerts SET status='sent',launch_sent_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(delivery.alert_id),
    ]);
    await recordNotification(database, { templateKey: "merch_launch_available", templateRevision: template.revision, recipient: delivery.email, subject: rendered.subject, relatedType: "merch_launch_event", relatedId: launch.id, idempotencyKey: delivery.idempotency_key, status: "sent" });
    return true;
  } catch (error) {
    await database.prepare("UPDATE merch_launch_deliveries SET status='failed',attempt_count=attempt_count+1,error=?,updated_at=datetime('now') WHERE id=?").bind(text(error.message,2000),delivery.delivery_id).run();
    await recordNotification(database, { templateKey: "merch_launch_available", templateRevision: template.revision, recipient: delivery.email, subject: rendered.subject, relatedType: "merch_launch_event", relatedId: launch.id, idempotencyKey: delivery.idempotency_key, status: "failed", error: error.message });
    return false;
  }
}

async function deliverLaunch(database, env, request, launch, product, failedOnly = false) {
  const template = await resolvedTemplate(database, "merch_launch_available");
  const rows = (await database.prepare(`SELECT d.id delivery_id,d.alert_id,d.idempotency_key,a.email
    FROM merch_launch_deliveries d JOIN merch_launch_alerts a ON a.id=d.alert_id
    WHERE d.launch_event_id=? AND d.status ${failedOnly ? "='failed'" : "IN ('pending','failed')"} ORDER BY d.created_at`)
    .bind(launch.id).all()).results || [];
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < rows.length; index += 10) {
    const outcomes = await Promise.all(rows.slice(index,index + 10).map((delivery) => sendLaunchDelivery(database, env, request, launch, delivery, product, template)));
    sent += outcomes.filter(Boolean).length;
    failed += outcomes.filter((value) => !value).length;
  }
  const remaining = await database.prepare("SELECT COUNT(*) count FROM merch_launch_deliveries WHERE launch_event_id=? AND status='failed'").bind(launch.id).first();
  const status = Number(remaining?.count) ? "partial" : "completed";
  await database.prepare("UPDATE merch_launch_events SET status=?,completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,updated_at=datetime('now') WHERE id=?").bind(status,status,launch.id).run();
  return { sent, failed, status };
}

async function confirmLaunch(request, env, recordId) {
  if (!enabled(env.MERCH_LAUNCH_SEND_ENABLED)) return failure("Merch launch sending is disabled.", 503);
  const body = await readJson(request);
  if (body?.confirmed !== true) return failure("Explicit launch confirmation is required.", 409);
  const database = db(env);
  const readiness = await launchReadiness(database, env, recordId);
  if (!readiness) return failure("Merch product not found.", 404);
  if (!readiness.ready) return failure("This product is not ready to launch.", 409, { reasons: readiness.reasons });
  if (body.expectedUpdatedAt && body.expectedUpdatedAt !== readiness.product.updated_at) return failure("The product changed. Refresh the launch preview.", 409);
  const alerts = (await database.prepare("SELECT id,email FROM merch_launch_alerts WHERE merch_item_id=? AND status='confirmed' ORDER BY created_at,id").bind(recordId).all()).results || [];
  const eventId = `merch-launch-${crypto.randomUUID()}`;
  const subject = `${readiness.product.title} is now available`;
  const launch = { id: eventId };
  const statements = [
    database.prepare("INSERT INTO merch_launch_events(id,merch_item_id,status,audience_count,subject,audience_snapshot_json,confirmed_by,confirmed_at,created_at,updated_at) VALUES(?,?,'sending',?,?,?,?,datetime('now'),datetime('now'),datetime('now'))")
      .bind(eventId,recordId,alerts.length,subject,JSON.stringify(alerts.map((alert) => ({ alertId: alert.id, email: alert.email }))),"studio"),
    database.prepare("UPDATE merch_items SET availability_state='available',launched_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(recordId),
    ...alerts.map((alert) => database.prepare("INSERT INTO merch_launch_deliveries(id,launch_event_id,alert_id,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?, 'pending',datetime('now'),datetime('now'))")
      .bind(`merch-delivery-${crypto.randomUUID()}`,eventId,alert.id,`merch-launch:${eventId}:${alert.id}`)),
  ];
  await database.batch(statements);
  const result = await deliverLaunch(database, env, request, launch, readiness.product);
  return json({ ok: true, launchEventId: eventId, audienceCount: alerts.length, ...result });
}

async function retryLaunch(request, env, eventId) {
  if (!enabled(env.MERCH_LAUNCH_SEND_ENABLED)) return failure("Merch launch sending is disabled.", 503);
  const database = db(env);
  const launch = await database.prepare("SELECT * FROM merch_launch_events WHERE id=?").bind(eventId).first();
  if (!launch) return failure("Launch event not found.", 404);
  const product = await database.prepare("SELECT * FROM merch_items WHERE id=?").bind(launch.merch_item_id).first();
  return json({ ok: true, launchEventId: eventId, ...(await deliverLaunch(database, env, request, launch, product, true)) });
}

async function templateApi(request, env, templateKey, action = "") {
  if (!TEMPLATE_KEYS.has(templateKey)) return failure("Unknown Merch email template.", 404);
  const database = db(env);
  if (request.method === "GET") {
    const [published,draft] = await Promise.all([templateRevision(database,templateKey,"default","published"),templateRevision(database,templateKey,"default","draft")]);
    return json({ templateKey, defaults: DEFAULT_TEMPLATES[templateKey], published, draft });
  }
  if (request.method === "PUT" && !action) {
    const body = await readJson(request);
    const content = { ...DEFAULT_TEMPLATES[templateKey], ...(body?.content || {}) };
    const draft = await saveTemplateDraft(database, { templateKey, variant: "default", content, baseRevision: Number(body?.baseRevision || 0), actor: "studio" });
    if (draft?.conflict) return failure("The template changed. Refresh before saving.", 409, draft);
    return json({ draft });
  }
  if (request.method === "POST" && action === "publish") {
    const body = await readJson(request);
    const published = await publishTemplateDraft(database, { templateKey, variant: "default", revision: Number(body?.revision), actor: "studio" });
    if (published?.conflict) return failure("The template draft changed. Refresh before publishing.", 409, published);
    return json({ published });
  }
  return failure("Method not allowed.", 405);
}

export async function handleAdminMerchApi(request, env) {
  const auth = requireStudioAdmin(request, env);
  if (auth) return auth;
  const path = new URL(request.url).pathname;
  const database = db(env);
  if (path === "/api/admin/merch-workflow") {
    if (request.method === "GET") return json(await adminList(database, env));
    if (request.method === "POST") return createMerch(request, env);
  }
  if (path === "/api/admin/merch-workflow/import-shopify" && request.method === "POST") return importShopifyProduct(request, env);
  const templateMatch = path.match(/^\/api\/admin\/merch-workflow\/templates\/([^/]+)(?:\/(publish))?$/);
  if (templateMatch) return templateApi(request, env, decodeURIComponent(templateMatch[1]), templateMatch[2] || "");
  const retryMatch = path.match(/^\/api\/admin\/merch-workflow\/launch-events\/([^/]+)\/retry$/);
  if (retryMatch && request.method === "POST") return retryLaunch(request, env, decodeURIComponent(retryMatch[1]));
  const actionMatch = path.match(/^\/api\/admin\/merch-workflow\/([^/]+)\/(readiness|preview|launch)$/);
  if (actionMatch) {
    const recordId = decodeURIComponent(actionMatch[1]);
    if (actionMatch[2] === "readiness" && request.method === "GET") return json(await launchReadiness(database,env,recordId));
    if (actionMatch[2] === "preview" && request.method === "GET") return previewLaunch(request,env,recordId);
    if (actionMatch[2] === "launch" && request.method === "POST") return confirmLaunch(request,env,recordId);
    return failure("Method not allowed.", 405);
  }
  const itemMatch = path.match(/^\/api\/admin\/merch-workflow\/([^/]+)$/);
  if (itemMatch && request.method === "PATCH") return updateMerch(request,env,decodeURIComponent(itemMatch[1]));
  return failure("Unknown Merch Studio route.", 404);
}
