import {
  addCartLines,
  badRequest,
  createCart,
  fetchCartById,
  fetchProductByHandle,
  json,
  readJsonBody,
  removeCartLines,
  serverError,
  updateCartLines,
} from "./functions/api/shop/_lib.js";
import {
  handleAdminMerchApi,
  handleLaunchAlertSignup,
  handleLaunchAlertToken,
  handleMerchCatalog,
  handleMerchItem,
} from "./functions/api/merch/_lib.js";
import {
  handleCreateSubmission,
  handleDeleteSubmission,
  handleGetSubmission,
  handleGetSubmissionFile,
  handleListSubmissions,
  handleOpenSubmission,
  handlePromoteMazeArchiveSubmission,
  handleSubmissionDecision,
  handleSubmissionDecisionNotification,
  handleUpdateMazeArchiveSubmission,
  handleUpdateSubmission,
} from "./functions/api/submissions/_lib.js";
import {
  handleAdminCreateAvailability,
  handleAdminCreateAppointmentMeeting,
  handleAdminCreateTattooRenderingRequest,
  handleAdminCancelAppointment,
  handleAdminDeleteAppointment,
  handleAdminCompleteAppointment,
  handleAdminCreateBookingToken,
  handleAdminDeleteAvailability,
  handleAdminGetBookingReadiness,
  handleAdminGetAvailabilityPreview,
  handleAdminGetSchedule,
  handleAdminTattooSessionPlan,
  handleAdminListAppointments,
  handleAdminListAvailability,
  handleAdminListBookingTypes,
  handleAdminListSubmissionTokens,
  handleAdminListWalkIns,
  handleAdminReleasePendingAppointment,
  handleAdminResendTattooRenderingRequest,
  handleAdminCancelTattooRenderingRequest,
  handleAdminRescheduleAppointment,
  handleAdminResolveTattooLifecycleReview,
  handleAdminRevokeBookingToken,
  handleAdminRevokeSubmissionBookingTokens,
  handleAdminCreateDirectBookingInvite,
  handleAdminCreateWalkIn,
  handleAdminDeleteWalkIn,
  handleAdminUpdateBookingType,
  handleAdminUpdateWalkIn,
  handleAdminUpdateSchedule,
  handleAdminUpdateAvailability,
  handleBookingCalendar,
  handleBookingAccessEvent,
  handleBookingContext,
  handleAdminTattooSettings,
  handleSaveBookingSessionPlan,
  handleCancelAppointment,
  handleConfirmBooking,
  handleCreateBookingCheckout,
  handleCreateBookingHold,
  handleCreateReplacementCheckout,
  handleGetPendingBookingHold,
  handleReleasePendingBookingHold,
  handlePublicTattooSettings,
  handlePublicConsultationCheckout,
  handlePublicConsultationContext,
  handlePublicSessionCheckout,
  handlePublicSessionContext,
  handlePublicStudioCheckout,
  handlePublicStudioContext,
  handleRescheduleAppointment,
  handleRescheduleContext,
  reapExpiredBookingHolds,
  reapExpiredTattooRenderingRequests,
  reconcileExperimentalDepositRefunds,
  handleSquareWebhook,
  handleSquareCheckoutRedirect,
  handleStudioSquareWebhook,
  handleAdminExperimentalAppointmentAction,
} from "./functions/api/booking/_lib.js";
import { shortBookingTokenFromPath } from "./functions/api/booking-links.js";
import {
  handleEventsApi,
  handleAdminEventsApi,
  handleEventsSquareWebhook,
  reapStalePendingTickets,
} from "./functions/api/events/_lib.js";
import {
  handleAdminEmailDesign,
  handleAdminEmailTemplates,
  handleAdminPreviewNotification,
  handleAdminResendNotification,
  retryPendingAdminAppointmentNotifications,
  sendDueAppointmentReminders,
  sendDueEventTicketReminders,
  sendDueExperimentalHealedReminders,
} from "./functions/api/notifications/_lib.js";
import {
  handleAdminSpecialProjectHealed,
  handlePublicSpecialProjectHealed,
} from "./functions/api/special-projects/_lib.js";
import { handlePortfolioApi } from "./functions/api/portfolio/_lib.js";
import { handleConstructApi, reapStaleMediaUploads } from "./functions/api/construct/_lib.js";
import { handleAdminCrmApi } from "./functions/api/crm/_lib.js";
import {
  handleAdminOutreachApi,
  handlePublicOutreachApi,
  processDueOutreach,
} from "./functions/api/outreach/_lib.js";
import {
  handleCreateBuildDraft,
  handleDeleteBuildDraft,
  handleEmailBuildDraft,
  handleGetBuildDraft,
  handleUpdateBuildDraft,
  reapExpiredTattooBuildDrafts,
} from "./functions/api/build-drafts/_lib.js";
import {
  handleAdminAnalytics,
  handleAnalyticsEvents,
  rollupSiteAnalytics,
} from "./functions/api/analytics/_lib.js";
import {
  handleAdminBriefTemplates,
  handleAdminSubmissionBriefDocument,
  handlePublicBriefDownload,
} from "./functions/api/brief-documents/_lib.js";
import {
  handleAdminTattooSpecialOffer,
  handleAdminTattooSpecialCampaign,
  handleAdminTattooSpecialDeposit,
  handleAdminTattooSpecialReview,
  handleAdminTattooSpecials,
  handleCreateTattooSpecialSubmission,
  handlePublicTattooSpecials,
} from "./functions/api/tattoo-specials/_lib.js";
import { handleAdminManualTextTemplates } from "./functions/api/communications/_lib.js";

const HIDDEN_PUBLIC_PATHS = [
  "/film",
  "/music",
  "/writings"
];
const CLOSED_PUBLIC_PAGE_PATHS = ["/about", "/archive", "/tattoos/build"];
const OPEN_PUBLIC_PAGE_PATHS = new Set(["/tattoos/build/maze"]);

const HIDE_PUBLIC_PAGES_EXCEPT_HOME = false;
const PUBLIC_FRONT_DOOR_PATHS = new Set(["/", "/index", "/index/", "/index.html"]);
const PUBLIC_ENTRY_ROOM_ALIAS_PATHS = new Set(["/entry-room", "/entry-room/", "/entry-room/index.html"]);
const PUBLIC_HOME_PATHS = new Set(["/home", "/home/", "/home/index.html"]);
const PUBLIC_ERROR_PATHS = new Set(["/404", "/404.html"]);
const PUBLIC_ARCHIVE_PATHS = new Set([
  "/archive",
  "/archive/",
  "/archive/index.html",
  "/archive/failed-experiments",
  "/archive/failed-experiments/",
  "/archive/failed-experiments/index.html",
  "/archive/guide",
  "/archive/guide/",
  "/archive/guide/index.html",
  "/archive/compare",
  "/archive/compare/",
  "/archive/compare/index.html",
  "/archive/about",
  "/archive/about/",
  "/archive/about/index.html",
  "/archive/art",
  "/archive/art/",
  "/archive/art/index.html",
  "/archive/events",
  "/archive/events/",
  "/archive/events/index.html",
  "/archive/film",
  "/archive/film/",
  "/archive/film/index.html",
  "/archive/merch",
  "/archive/merch/",
  "/archive/merch/index.html",
  "/archive/music",
  "/archive/music/",
  "/archive/music/index.html",
  "/archive/sixwell-construct",
  "/archive/sixwell-construct/",
  "/archive/sixwell-construct/index.html",
  "/archive/tattoos",
  "/archive/tattoos/",
  "/archive/tattoos/index.html",
  "/archive/writings",
  "/archive/writings/",
  "/archive/writings/index.html",
]);
const PUBLIC_CONSTRUCT_MAP_PATHS = new Set(["/construct-map", "/construct-map/", "/construct-map/index.html"]);

function notFound(message = "Not found.") {
  return json({ error: message }, { status: 404 });
}

async function notFoundPage(request, env) {
  const url = new URL(request.url);
  url.pathname = "/404.html";
  url.search = "";
  const response = await env.ASSETS.fetch(new Request(url, request));
  return new Response(response.body, {
    status: 404,
    headers: response.headers,
  });
}

function redirectToNotFoundPage(request) {
  return Response.redirect(new URL("/404.html", request.url), 302);
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return new Request(url, request);
}

function assetPathForRequest(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname.endsWith("/")) return `${pathname}index.html`;
  if (pathname.startsWith("/art/") && !hasFileExtension(pathname)) return `${pathname}.html`;
  if (!hasFileExtension(pathname)) return `${pathname}/index.html`;
  return pathname;
}

function shouldInjectSiteAnalytics(request, response) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const contentType = response.headers.get("content-type") || "";
  if (request.method !== "GET" || response.status !== 200 || !contentType.includes("text/html")) return false;
  if (isLocalPreview(url) || url.searchParams.has("preview")) return false;
  if (
    pathname.startsWith("/api/") || pathname.startsWith("/studio/") || pathname.startsWith("/tools/") ||
    pathname.startsWith("/sixwellconstruct/") || pathname.includes("managed-preview") ||
    pathname.includes("connections-preview") || pathname.includes("/previews/")
  ) return false;
  return !(response.headers.get("x-robots-tag") || "").toLowerCase().includes("noindex");
}

async function servePublicAsset(request, env, pathname) {
  const response = await env.ASSETS.fetch(assetRequest(request, pathname));
  if (!shouldInjectSiteAnalytics(request, response) || typeof HTMLRewriter === "undefined") return response;
  return new HTMLRewriter().on("body", {
    element(element) {
      element.append('<script src="/js/site-analytics.js?v=1" defer></script>', { html: true });
    },
  }).transform(response);
}

function isFrontDoorPath(pathname) {
  return PUBLIC_FRONT_DOOR_PATHS.has(pathname) || PUBLIC_ENTRY_ROOM_ALIAS_PATHS.has(pathname);
}

function isHomePath(pathname) {
  return PUBLIC_HOME_PATHS.has(pathname);
}

function methodNotAllowed(method, allowed) {
  return json(
    { error: `Method ${method} not allowed.` },
    { status: 405, headers: { allow: allowed.join(", ") } }
  );
}

function isLocalPreview(url) {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

function isLocalOnlyPath(pathname) {
  return (
    pathname === "/edit-links" ||
    pathname === "/edit-links/" ||
    pathname === "/edit-links.html" ||
    pathname === "/tools/edit-links.html" ||
    pathname === "/edit-links-mac" ||
    pathname === "/edit-links-mac/" ||
    pathname === "/edit-links-mac.html" ||
    pathname === "/tools/edit-links-mac.html" ||
    pathname === "/page-visibility" ||
    pathname === "/page-visibility/" ||
    pathname === "/page-visibility.html" ||
    pathname === "/tools/page-visibility.html" ||
    pathname === "/tools/live-text-editor.js" ||
    pathname === "/js/live-text-editor.js" ||
    pathname === "/shared/page-visibility.js"
  );
}

function normalizePath(pathname) {
  let normalized = pathname || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  return normalized || "/";
}

function isHiddenPublicPath(pathname) {
  const normalizedPath = normalizePath(pathname);
  return HIDDEN_PUBLIC_PATHS.some((hiddenPath) => {
    const normalizedHidden = normalizePath(hiddenPath);
    return (
      normalizedPath === normalizedHidden ||
      normalizedPath.startsWith(`${normalizedHidden}/`)
    );
  });
}

function hasFileExtension(pathname) {
  return /\/[^/]+\.[^/]+$/.test(pathname);
}

function isPublicPagePath(pathname) {
  const normalizedPath = normalizePath(pathname);
  return (
    PUBLIC_HOME_PATHS.has(pathname) ||
    normalizedPath === "/404" ||
    pathname.endsWith(".html") ||
    !hasFileExtension(pathname)
  );
}

function isEventDetailPagePath(pathname) {
  const normalizedPath = normalizePath(pathname);
  const parts = normalizedPath.split("/").filter(Boolean);
  return (
    parts.length === 2 &&
    parts[0] === "events" &&
    parts[1] !== "confirmed" &&
    !hasFileExtension(pathname)
  );
}

function eventDetailAssetPath(pathname) {
  const normalizedPath = normalizePath(pathname);
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "events") return "/events/index.html";
  return `/events/${parts[1]}/index.html`;
}

function isFlashDetailPagePath(pathname) {
  const normalizedPath = normalizePath(pathname);
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "tattoos" || parts[1] !== "flash") return false;
  return !new Set(["claim", "detail", "maze"]).has(parts[2]) && !hasFileExtension(pathname);
}

function archiveDynamicAssetPath(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "archive" || hasFileExtension(pathname)) return "";
  if (parts[1] === "records") return "/archive/records/index.html";
  if (parts[1] === "timelines") return "/archive/timelines/index.html";
  if (parts[1] === "colors") return "/archive/colors/index.html";
  if (parts[1] === "materials") return "/archive/materials/index.html";
  if (parts[1] === "failed-experiments") return "/archive/failed-experiments/index.html";
  return "";
}

function isClosedPublicPagePath(pathname) {
  if (!isPublicPagePath(pathname)) return false;
  const normalizedPath = normalizePath(pathname).toLowerCase();
  if (OPEN_PUBLIC_PAGE_PATHS.has(normalizedPath)) return false;
  return CLOSED_PUBLIC_PAGE_PATHS.some((closedPath) => (
    normalizedPath === closedPath || normalizedPath.startsWith(`${closedPath}/`)
  ));
}

const LEGEND_RECORD_RESERVED_SLUGS = new Set([
  "categories-managed-preview",
  "detail",
  "managed-preview",
]);

const ART_RECORD_RESERVED_SLUGS = new Set(["acquisitioninquiry", "detail", "index"]);
const MERCH_RECORD_RESERVED_SLUGS = new Set(["alerts", "detail", "index"]);
const MERCH_RECORD_ALIASES = {
  lostmarbleshoodie: "lostmarbles-hoodie",
};
const ART_LEGACY_PAGE_SLUGS = new Set([
  "homelandsecuritypainting",
  "lostmarblespainting",
  "lustpainting",
  "paranoiafosteredtraumapainting",
  "slothpainting",
  "thefrustrationsofinnercharospainting",
]);
const SPECIAL_PROJECT_RESERVED_SLUGS = new Set(["apply", "healed"]);

function artRecordSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "art" || hasFileExtension(pathname)) return "";
  let candidate = "";
  try {
    candidate = decodeURIComponent(parts[1]);
  } catch {
    return "";
  }
  if (
    ART_RECORD_RESERVED_SLUGS.has(candidate) ||
    ART_LEGACY_PAGE_SLUGS.has(candidate) ||
    !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(candidate)
  ) return "";
  return candidate;
}

function merchRecordSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "merch" || hasFileExtension(pathname)) return "";
  let candidate = "";
  try { candidate = decodeURIComponent(parts[1]); } catch { return ""; }
  if (MERCH_RECORD_RESERVED_SLUGS.has(candidate) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) return "";
  return candidate;
}

function specialProjectRecordSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "tattoos" || parts[1] !== "special-projects" || hasFileExtension(pathname)) return "";
  let candidate = "";
  try { candidate = decodeURIComponent(parts[2]); } catch { return ""; }
  if (SPECIAL_PROJECT_RESERVED_SLUGS.has(candidate) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) return "";
  return candidate;
}

function legendRecordSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "legend" || hasFileExtension(pathname)) return "";
  let candidate = "";
  try {
    candidate = decodeURIComponent(parts[2]);
  } catch {
    return "";
  }
  if (
    LEGEND_RECORD_RESERVED_SLUGS.has(candidate) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)
  ) return "";
  return candidate;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function legendRecordJson(payload) {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function serveLegendRecordPage(request, env, slug) {
  const apiUrl = new URL(`/api/legend/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleConstructApi(new Request(apiUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;

  const payload = await apiResponse.json();
  if (!payload.record || payload.record.slug !== slug) return notFoundPage(request, env);

  const assetResponse = await servePublicAsset(request, env, "/about/legend/detail/index.html");
  if (request.method === "HEAD") return assetResponse;

  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${payload.record.canonicalRoute}`;
  const title = `${payload.record.name} · The Legend · the six.well construct`;
  const description = payload.record.meaning || "A published symbol record from the living Legend.";
  const html = (await assetResponse.text())
    .replace(
      /<title data-legend-record-title>[\s\S]*?<\/title>/,
      `<title data-legend-record-title>${escapeHtml(title)}</title>`,
    )
    .replace(
      /<meta data-legend-record-description name="description" content="[^"]*">/,
      `<meta data-legend-record-description name="description" content="${escapeHtml(description)}">`,
    )
    .replace(
      /<link data-legend-record-canonical rel="canonical" href="[^"]*">/,
      `<link data-legend-record-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    )
    .replace(
      '<script id="legend-record-data" type="application/json"></script>',
      `<script id="legend-record-data" type="application/json">${legendRecordJson(payload)}</script>`,
    );
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: assetResponse.status, headers });
}

async function publicSpecialProjectRecord(env, reference) {
  const value = String(reference || "").trim();
  if (!value) return null;
  return env.SUBMISSIONS_DB.prepare(
    `SELECT spc.id,spc.slug,spc.title,COALESCE(spc.summary,'') summary
     FROM special_project_calls spc
     JOIN content_entities ce ON ce.id=spc.id AND ce.entity_type='special_project'
     WHERE (spc.slug=?1 OR spc.id=?1)
       AND spc.publication_state='published' AND ce.visibility='public'
     LIMIT 1`
  ).bind(value).first();
}

async function serveSpecialProjectRecordPage(request, env, slug) {
  const record = await publicSpecialProjectRecord(env, slug);
  if (!record || record.slug !== slug) return notFoundPage(request, env);

  const assetResponse = await servePublicAsset(request, env, "/tattoos/special-projects/index.html");
  if (request.method === "HEAD") return assetResponse;

  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}/tattoos/special-projects/${encodeURIComponent(record.slug)}/`;
  const title = `${record.title} · Special Projects · Art.Pill Tattoo House`;
  const description = record.summary || `Special Project detail for ${record.title}.`;
  const html = (await assetResponse.text())
    .replace(
      /<title data-special-project-title>[\s\S]*?<\/title>/,
      `<title data-special-project-title>${escapeHtml(title)}</title>`,
    )
    .replace(
      /<meta data-special-project-description name="description" content="[^"]*">/,
      `<meta data-special-project-description name="description" content="${escapeHtml(description)}">`,
    )
    .replace(
      /<link data-special-project-canonical rel="canonical" href="[^"]*">/,
      `<link data-special-project-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    );
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: assetResponse.status, headers });
}

async function serveArtRecordPage(request, env, slug) {
  const apiUrl = new URL(`/api/art/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleConstructApi(new Request(apiUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;

  const payload = await apiResponse.json();
  const record = payload.record;
  if (!record || record.slug !== slug || record.legacy_path) return notFoundPage(request, env);

  const assetResponse = await servePublicAsset(request, env, "/art/detail/index.html");
  if (request.method === "HEAD") return assetResponse;

  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${record.canonicalRoute}`;
  const title = `${record.title} · art · the six.well construct`;
  const description = record.statement || `Artwork detail for ${record.title}.`;
  const html = (await assetResponse.text())
    .replace(
      /<title data-art-record-title>[\s\S]*?<\/title>/,
      `<title data-art-record-title>${escapeHtml(title)}</title>`,
    )
    .replace(
      /<meta data-art-record-description name="description" content="[^"]*">/,
      `<meta data-art-record-description name="description" content="${escapeHtml(description)}">`,
    )
    .replace(
      /<meta data-art-record-robots name="robots" content="[^"]*">/,
      '<meta data-art-record-robots name="robots" content="index,follow">',
    )
    .replace(
      /<link data-art-record-canonical rel="canonical" href="[^"]*">/,
      `<link data-art-record-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    )
    .replace(
      '<script id="art-record-data" type="application/json"></script>',
      `<script id="art-record-data" type="application/json">${legendRecordJson(payload)}</script>`,
    );
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: assetResponse.status, headers });
}

async function serveArtPreviewPage(request, env) {
  const response = await servePublicAsset(request, env, "/art/detail/index.html");
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, headers });
}

async function serveMerchRecordPage(request, env, slug) {
  slug = MERCH_RECORD_ALIASES[slug] || slug;
  const apiUrl = new URL(`/api/shop/items/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleMerchItem(new Request(apiUrl, { method: "GET", headers: { accept: "application/json" } }), env, slug);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const product = payload.product;
  if (!product || product.slug !== slug) return notFoundPage(request, env);
  const assetResponse = await servePublicAsset(request, env, "/merch/detail/index.html");
  if (request.method === "HEAD") return assetResponse;
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${product.canonicalRoute}`;
  const title = `${product.title} · merch · the six.well construct`;
  const description = product.description || product.statement || `Merch detail for ${product.title}.`;
  const html = (await assetResponse.text())
    .replace(/<title data-merch-record-title>[\s\S]*?<\/title>/, `<title data-merch-record-title>${escapeHtml(title)}</title>`)
    .replace(/<meta data-merch-record-description name="description" content="[^"]*">/, `<meta data-merch-record-description name="description" content="${escapeHtml(description)}">`)
    .replace(/<link data-merch-record-canonical rel="canonical" href="[^"]*">/, `<link data-merch-record-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`)
    .replace('<script id="merch-record-data" type="application/json"></script>', `<script id="merch-record-data" type="application/json">${legendRecordJson(payload)}</script>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: assetResponse.status, headers });
}

async function legacyMerchResponse(request, env, pathname) {
  if (pathname === "/merch/am-i-losing-my-marbles.html") {
    return new Response("Gone", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const legacy = {
    "/merch/lostmarbles-hoodie.html": "lostmarbles-hoodie",
    "/merch/marbles-print.html": "marbles-print",
    "/merch/maze-puffer-jacket.html": "maze-puffer-jacket",
    "/merch/six-well-clothing.html": "six-well-clothing",
  }[pathname];
  if (!legacy) return null;
  const probe = await handleMerchItem(new Request(new URL(`/api/shop/items/${legacy}`, request.url), { method: "GET" }), env, legacy);
  if (!probe.ok) return notFoundPage(request, env);
  const target = new URL(request.url);
  target.pathname = `/merch/${legacy}/`;
  target.search = "";
  return Response.redirect(target, 308);
}

function isHiddenByHomeOnlyMode(pathname) {
  if (!HIDE_PUBLIC_PAGES_EXCEPT_HOME) return false;
  const normalizedPath = normalizePath(pathname);
  if (PUBLIC_HOME_PATHS.has(pathname)) return false;
  if (PUBLIC_ARCHIVE_PATHS.has(pathname) || normalizedPath === "/archive") return false;
  if (archiveDynamicAssetPath(pathname)) return false;
  if (PUBLIC_CONSTRUCT_MAP_PATHS.has(pathname) || normalizedPath === "/construct-map") return false;
  if (PUBLIC_ERROR_PATHS.has(normalizedPath) || PUBLIC_ERROR_PATHS.has(pathname)) {
    return false;
  }
  return isPublicPagePath(pathname);
}

function lineInputs(lines = []) {
  return lines.map((line) => ({
    merchandiseId: line.variantId,
    quantity: Number(line.quantity || 1),
  }));
}

function lineUpdates(lines = []) {
  return lines.map((line) => ({
    id: line.lineId,
    quantity: Number(line.quantity || 0),
  }));
}

async function handleProduct(request, env) {
  const handle = new URL(request.url).searchParams.get("handle");
  if (!handle) {
    return badRequest("Missing required query parameter: handle");
  }

  try {
    const product = await fetchProductByHandle(env, handle);
    if (!product) {
      return json({ product: null }, { status: 404 });
    }
    return json({ product });
  } catch (error) {
    return serverError("Unable to load Shopify product.", {
      detail: error.message,
    });
  }
}

async function handleGetCart(request, env) {
  const cartId = new URL(request.url).searchParams.get("cartId");
  if (!cartId) {
    return badRequest("Missing required query parameter: cartId");
  }

  try {
    const cart = await fetchCartById(env, cartId);
    if (!cart) {
      return json({ cart: null }, { status: 404 });
    }
    return json({ cart });
  } catch (error) {
    return serverError("Unable to load Shopify cart.", {
      detail: error.message,
    });
  }
}

async function handleCreateCart(env) {
  try {
    const cart = await createCart(env);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to create Shopify cart.", {
      detail: error.message,
    });
  }
}

async function handleAddLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await addCartLines(env, body.cartId, lineInputs(body.lines));
    return json({ cart });
  } catch (error) {
    return serverError("Unable to add Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleUpdateLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await updateCartLines(env, body.cartId, lineUpdates(body.lines));
    return json({ cart });
  } catch (error) {
    return serverError("Unable to update Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleRemoveLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lineIds) || body.lineIds.length === 0) {
    return badRequest("Expected cartId and a non-empty lineIds array.");
  }

  try {
    const cart = await removeCartLines(env, body.cartId, body.lineIds);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to remove Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleShopApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/shop/catalog") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleMerchCatalog(request, env);
  }

  const itemMatch = pathname.match(/^\/api\/shop\/items\/([^/]+)$/);
  if (itemMatch) return handleMerchItem(request, env, decodeURIComponent(itemMatch[1]));

  if (pathname === "/api/shop/launch-alerts") return handleLaunchAlertSignup(request, env);
  if (pathname === "/api/shop/launch-alerts/confirm") return handleLaunchAlertToken(request, env, "confirm");
  if (pathname === "/api/shop/launch-alerts/cancel") return handleLaunchAlertToken(request, env, "cancel");

  if (pathname === "/api/shop/product") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleProduct(request, env);
  }

  if (pathname === "/api/shop/cart") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleGetCart(request, env);
  }

  if (pathname === "/api/shop/cart/create") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateCart(env);
  }

  if (pathname === "/api/shop/cart/lines/add") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAddLines(request, env);
  }

  if (pathname === "/api/shop/cart/lines/update") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleUpdateLines(request, env);
  }

  if (pathname === "/api/shop/cart/lines/remove") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleRemoveLines(request, env);
  }

  return notFound("Unknown shop API route.");
}

async function handleSubmissionsApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/submissions") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateSubmission(request, env);
  }

  if (pathname === "/api/admin/submissions") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleListSubmissions(request, env);
  }

  const fileMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/files\/([^/]+)$/);
  if (fileMatch) {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleGetSubmissionFile(request, env, decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]));
  }

  const submissionTokensMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/tokens$/);
  if (submissionTokensMatch) {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminListSubmissionTokens(request, env, decodeURIComponent(submissionTokensMatch[1]));
  }

  const briefDocumentMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/brief-document(?:\/(download|revoke|reissue))?$/);
  if (briefDocumentMatch) {
    const action = briefDocumentMatch[2] || "";
    const allowed = action === "download" ? ["GET"] : action ? ["POST"] : ["GET", "POST"];
    if (!allowed.includes(method)) return methodNotAllowed(method, allowed);
    return handleAdminSubmissionBriefDocument(request, env, decodeURIComponent(briefDocumentMatch[1]), action);
  }

  const mazeArchiveMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/maze-archive(?:\/(promote))?$/);
  if (mazeArchiveMatch) {
    const id = decodeURIComponent(mazeArchiveMatch[1]);
    if (mazeArchiveMatch[2] === "promote") {
      if (method !== "POST") return methodNotAllowed(method, ["POST"]);
      return handlePromoteMazeArchiveSubmission(request, env, id);
    }
    if (method !== "PATCH") return methodNotAllowed(method, ["PATCH"]);
    return handleUpdateMazeArchiveSubmission(request, env, id);
  }

  const decisionMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/decision$/);
  if (decisionMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleSubmissionDecision(request, env, decodeURIComponent(decisionMatch[1]));
  }

  const decisionNotificationMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/decision-notification$/);
  if (decisionNotificationMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleSubmissionDecisionNotification(request, env, decodeURIComponent(decisionNotificationMatch[1]));
  }

  const openMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/open$/);
  if (openMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleOpenSubmission(request, env, decodeURIComponent(openMatch[1]));
  }

  const match = pathname.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (method === "GET") return handleGetSubmission(request, env, id);
    if (method === "PATCH") return handleUpdateSubmission(request, env, id);
    if (method === "DELETE") return handleDeleteSubmission(request, env, id);
    return methodNotAllowed(method, ["GET", "PATCH", "DELETE"]);
  }

  return notFound("Unknown submissions API route.");
}

async function handleBuildDraftsApi(request, env) {
  const { pathname } = new URL(request.url);
  const { method } = request;
  if (pathname === "/api/build-drafts") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateBuildDraft(request, env);
  }

  if (pathname === "/api/build-drafts/current") {
    if (method === "GET") return handleGetBuildDraft(request, env);
    if (method === "PATCH") return handleUpdateBuildDraft(request, env);
    if (method === "DELETE") return handleDeleteBuildDraft(request, env);
    return methodNotAllowed(method, ["GET", "PATCH", "DELETE"]);
  }
  if (pathname === "/api/build-drafts/current/email") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleEmailBuildDraft(request, env);
  }
  return notFound("Unknown Build draft API route.");
}

async function handleBookingApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/booking/calendar") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleBookingCalendar(request, env);
  }

  if (pathname === "/api/booking/context") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleBookingContext(request, env);
  }

  if (pathname === "/api/booking/access-events") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleBookingAccessEvent(request, env);
  }

  if (pathname === "/api/booking/square-redirect") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleSquareCheckoutRedirect(request, env);
  }

  if (pathname === "/api/booking/session-plan") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleSaveBookingSessionPlan(request, env);
  }

  if (pathname === "/api/booking/hold") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateBookingHold(request, env);
  }

  if (pathname === "/api/booking/checkout") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateBookingCheckout(request, env);
  }

  if (pathname === "/api/booking/public-consultation/context") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handlePublicConsultationContext(request, env);
  }

  if (pathname === "/api/booking/public-session/context") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handlePublicSessionContext(request, env);
  }

  if (pathname === "/api/booking/public-consultation/checkout") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handlePublicConsultationCheckout(request, env);
  }

  if (pathname === "/api/booking/public-session/checkout") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handlePublicSessionCheckout(request, env);
  }

  if (pathname === "/api/booking/public-studio/context") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handlePublicStudioContext(request, env);
  }

  if (pathname === "/api/booking/public-studio/checkout") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handlePublicStudioCheckout(request, env);
  }

  if (pathname === "/api/booking/confirm") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleConfirmBooking(request, env);
  }

  if (pathname === "/api/booking/cancel") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCancelAppointment(request, env);
  }

  if (pathname === "/api/booking/pending-hold") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleGetPendingBookingHold(request, env);
  }

  if (pathname === "/api/booking/pending-hold/release") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleReleasePendingBookingHold(request, env);
  }

  if (pathname === "/api/booking/reschedule/context") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleRescheduleContext(request, env);
  }

  if (pathname === "/api/booking/reschedule") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleRescheduleAppointment(request, env);
  }

  if (
    pathname === "/api/booking/replacement-checkout" ||
    pathname === "/api/booking/replacement"
  ) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateReplacementCheckout(request, env);
  }

  if (pathname === "/api/admin/booking/tokens") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCreateBookingToken(request, env);
  }

  if (pathname === "/api/admin/booking/direct-invites") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCreateDirectBookingInvite(request, env);
  }

  if (pathname === "/api/admin/booking/tokens/revoke-submission") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminRevokeSubmissionBookingTokens(request, env);
  }

  const sessionPlanMatch = pathname.match(/^\/api\/admin\/booking\/session-plans\/([^/]+)$/);
  if (sessionPlanMatch) {
    if (!["GET", "PATCH"].includes(method)) return methodNotAllowed(method, ["GET", "PATCH"]);
    return handleAdminTattooSessionPlan(request, env, decodeURIComponent(sessionPlanMatch[1]));
  }

  const tokenMatch = pathname.match(/^\/api\/admin\/booking\/tokens\/([^/]+)$/);
  if (tokenMatch) {
    if (method !== "PATCH") return methodNotAllowed(method, ["PATCH"]);
    return handleAdminRevokeBookingToken(request, env, decodeURIComponent(tokenMatch[1]));
  }

  if (pathname === "/api/admin/booking/availability") {
    if (method === "GET") return handleAdminListAvailability(request, env);
    if (method === "POST") return handleAdminCreateAvailability(request, env);
    return methodNotAllowed(method, ["GET", "POST"]);
  }

  if (pathname === "/api/admin/booking/availability-preview") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminGetAvailabilityPreview(request, env);
  }

  if (pathname === "/api/admin/booking/readiness") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminGetBookingReadiness(request, env);
  }

  if (pathname === "/api/admin/booking/types") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminListBookingTypes(request, env);
  }

  const bookingTypeMatch = pathname.match(/^\/api\/admin\/booking\/types\/([^/]+)$/);
  if (bookingTypeMatch) {
    if (method !== "PATCH") return methodNotAllowed(method, ["PATCH"]);
    return handleAdminUpdateBookingType(request, env, decodeURIComponent(bookingTypeMatch[1]));
  }

  if (pathname === "/api/admin/booking/walk-ins") {
    if (method === "GET") return handleAdminListWalkIns(request, env);
    if (method === "POST") return handleAdminCreateWalkIn(request, env);
    return methodNotAllowed(method, ["GET", "POST"]);
  }

  const walkInMatch = pathname.match(/^\/api\/admin\/booking\/walk-ins\/([^/]+)$/);
  if (walkInMatch) {
    if (method === "DELETE") return handleAdminDeleteWalkIn(request, env, decodeURIComponent(walkInMatch[1]));
    if (method !== "PATCH") return methodNotAllowed(method, ["PATCH", "DELETE"]);
    return handleAdminUpdateWalkIn(request, env, decodeURIComponent(walkInMatch[1]));
  }

  if (pathname === "/api/admin/booking/schedule") {
    if (method === "GET") return handleAdminGetSchedule(request, env);
    if (method === "PATCH") return handleAdminUpdateSchedule(request, env);
    return methodNotAllowed(method, ["GET", "PATCH"]);
  }

  const availabilityMatch = pathname.match(/^\/api\/admin\/booking\/availability\/([^/]+)$/);
  if (availabilityMatch) {
    if (method === "DELETE") return handleAdminDeleteAvailability(request, env, decodeURIComponent(availabilityMatch[1]));
    if (method !== "PATCH") return methodNotAllowed(method, ["PATCH", "DELETE"]);
    return handleAdminUpdateAvailability(request, env, decodeURIComponent(availabilityMatch[1]));
  }

  if (pathname === "/api/admin/booking/appointments") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminListAppointments(request, env);
  }

  const appointmentMeetingMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/meeting$/);
  if (appointmentMeetingMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCreateAppointmentMeeting(request, env, decodeURIComponent(appointmentMeetingMatch[1]));
  }

  if (pathname === "/api/admin/booking/rendering-requests") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCreateTattooRenderingRequest(request, env);
  }

  const renderingRequestMatch = pathname.match(/^\/api\/admin\/booking\/rendering-requests\/([^/]+)\/(resend|cancel)$/);
  if (renderingRequestMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    const requestId = decodeURIComponent(renderingRequestMatch[1]);
    return renderingRequestMatch[2] === "resend"
      ? handleAdminResendTattooRenderingRequest(request, env, requestId)
      : handleAdminCancelTattooRenderingRequest(request, env, requestId);
  }

  const lifecycleReviewResolveMatch = pathname.match(/^\/api\/admin\/booking\/lifecycle-review\/([^/]+)\/resolve$/);
  if (lifecycleReviewResolveMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminResolveTattooLifecycleReview(
      request,
      env,
      decodeURIComponent(lifecycleReviewResolveMatch[1]),
    );
  }

  const appointmentCompleteMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/complete$/);
  if (appointmentCompleteMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCompleteAppointment(request, env, decodeURIComponent(appointmentCompleteMatch[1]));
  }

  const experimentalAppointmentMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/experimental$/);
  if (experimentalAppointmentMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminExperimentalAppointmentAction(request, env, decodeURIComponent(experimentalAppointmentMatch[1]));
  }

  const appointmentDeleteMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)$/);
  if (appointmentDeleteMatch) {
    if (method !== "DELETE") return methodNotAllowed(method, ["DELETE"]);
    return handleAdminDeleteAppointment(request, env, decodeURIComponent(appointmentDeleteMatch[1]));
  }

  const appointmentCancelMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/cancel$/);
  if (appointmentCancelMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCancelAppointment(request, env, decodeURIComponent(appointmentCancelMatch[1]));
  }

  const appointmentRescheduleMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/reschedule$/);
  if (appointmentRescheduleMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminRescheduleAppointment(request, env, decodeURIComponent(appointmentRescheduleMatch[1]));
  }

  const appointmentReleaseMatch = pathname.match(/^\/api\/admin\/booking\/appointments\/([^/]+)\/release-pending$/);
  if (appointmentReleaseMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminReleasePendingAppointment(request, env, decodeURIComponent(appointmentReleaseMatch[1]));
  }

  return notFound("Unknown booking API route.");
}

async function handleNotificationsApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/admin/notifications/resend") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminResendNotification(request, env);
  }

  if (pathname === "/api/admin/notifications/preview") {
    if (!["GET", "POST"].includes(method)) return methodNotAllowed(method, ["GET", "POST"]);
    return handleAdminPreviewNotification(request, env);
  }

  if (pathname === "/api/admin/notifications/design" || pathname.startsWith("/api/admin/notifications/design/")) {
    return handleAdminEmailDesign(request, env);
  }

  if (pathname === "/api/admin/notifications/templates" || pathname.startsWith("/api/admin/notifications/templates/")) {
    return handleAdminEmailTemplates(request, env);
  }

  return notFound("Unknown notifications API route.");
}

async function handleSquareApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/square/webhook") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleSquareWebhook(request, env);
  }

  return notFound("Unknown Square API route.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isLocalOnlyPath(url.pathname) && !isLocalPreview(url)) {
      return notFoundPage(request, env);
    }

    if (isClosedPublicPagePath(url.pathname)) {
      return redirectToNotFoundPage(request);
    }

    if (shortBookingTokenFromPath(url.pathname)) {
      if (
        isClosedPublicPagePath("/booking/") ||
        isHiddenPublicPath("/booking/") ||
        isHiddenByHomeOnlyMode("/booking/")
      ) {
        return redirectToNotFoundPage(request);
      }
      return servePublicAsset(request, env, "/booking/index.html");
    }

    if (url.pathname === "/explore" || url.pathname === "/explore/" || url.pathname === "/explore/index.html") {
      const adventureUrl = new URL(request.url);
      adventureUrl.pathname = "/adventure/";
      return Response.redirect(adventureUrl, 308);
    }

    if (url.pathname === "/adventure" || url.pathname === "/adventure/index.html") {
      const adventureUrl = new URL(request.url);
      adventureUrl.pathname = "/adventure/";
      return Response.redirect(adventureUrl, 308);
    }

    if (url.pathname === "/api/analytics/events") {
      return handleAnalyticsEvents(request, env);
    }

    if (url.pathname === "/api/admin/analytics") {
      return handleAdminAnalytics(request, env);
    }

    if (url.pathname === "/api/admin/merch-workflow" || url.pathname.startsWith("/api/admin/merch-workflow/")) {
      return handleAdminMerchApi(request, env);
    }

    if (
      url.pathname === "/api/search" ||
      url.pathname === "/api/site/explore" ||
      url.pathname === "/api/site/navigation" ||
      url.pathname.startsWith("/api/connections/") ||
      url.pathname.startsWith("/api/construct/media/") ||
      url.pathname.startsWith("/api/construct/entity-media/") ||
      url.pathname === "/api/flash" || url.pathname.startsWith("/api/flash/") ||
      url.pathname === "/api/legend" || url.pathname.startsWith("/api/legend/") ||
      url.pathname === "/api/visual-language" || url.pathname.startsWith("/api/visual-language/") ||
      url.pathname === "/api/art" || url.pathname.startsWith("/api/art/") ||
      url.pathname === "/api/archive" || url.pathname.startsWith("/api/archive/") ||
      url.pathname === "/api/archive-collections" || url.pathname.startsWith("/api/archive-collections/") ||
      /^\/api\/admin\/events\/[^/]+\/create-archive-record$/.test(url.pathname) ||
      url.pathname.startsWith("/api/admin/flash") ||
      url.pathname.startsWith("/api/admin/legend") ||
      url.pathname.startsWith("/api/admin/visual-language") ||
      url.pathname.startsWith("/api/admin/art") ||
      url.pathname.startsWith("/api/admin/merch") ||
      url.pathname.startsWith("/api/admin/archive") ||
      url.pathname.startsWith("/api/admin/people") ||
      url.pathname.startsWith("/api/admin/places") ||
      url.pathname.startsWith("/api/admin/nodes") ||
      url.pathname.startsWith("/api/admin/pathways") ||
      url.pathname.startsWith("/api/admin/media") ||
      url.pathname.startsWith("/api/admin/relationships") ||
      url.pathname.startsWith("/api/admin/relationship-types") ||
      url.pathname === "/api/admin/entities" ||
      url.pathname.startsWith("/api/admin/taxonomy") ||
      url.pathname.startsWith("/api/admin/entities/") ||
      url.pathname.startsWith("/api/admin/revisions") ||
      url.pathname.startsWith("/api/admin/search/status")
    ) {
      return handleConstructApi(request, env);
    }

    if (
      url.pathname === "/api/admin/crm/outreach"
      || url.pathname.startsWith("/api/admin/crm/outreach/")
    ) {
      return handleAdminOutreachApi(request, env);
    }

    if (url.pathname === "/api/admin/crm" || url.pathname.startsWith("/api/admin/crm/")) {
      return handleAdminCrmApi(request, env);
    }

    if (url.pathname === "/api/outreach" || url.pathname.startsWith("/api/outreach/")) {
      return handlePublicOutreachApi(request, env);
    }

    if (url.pathname.startsWith("/api/shop/")) {
      return handleShopApi(request, env);
    }

    if (url.pathname.startsWith("/api/square/")) {
      return handleSquareApi(request, env);
    }

    if (url.pathname === "/api/square-events/webhook") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleEventsSquareWebhook(request, env);
    }

    if (url.pathname === "/api/square-studio/webhook") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleStudioSquareWebhook(request, env);
    }

    if (url.pathname.startsWith("/api/admin/events")) {
      return handleAdminEventsApi(request, env);
    }

    if (url.pathname === "/api/events" || url.pathname.startsWith("/api/events/")) {
      return handleEventsApi(request, env);
    }

    if (
      url.pathname.startsWith("/api/booking/") ||
      url.pathname.startsWith("/api/admin/booking/")
    ) {
      return handleBookingApi(request, env);
    }

    if (url.pathname === "/api/special-projects/healed") {
      if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(request.method, ["GET", "POST"]);
      return handlePublicSpecialProjectHealed(request, env);
    }

    const specialProjectHealedAdminMatch = url.pathname.match(/^\/api\/admin\/special-projects\/healed\/([^/]+)(?:\/(file))?$/);
    if (specialProjectHealedAdminMatch) {
      return handleAdminSpecialProjectHealed(
        request,
        env,
        decodeURIComponent(specialProjectHealedAdminMatch[1]),
        specialProjectHealedAdminMatch[2] || "",
      );
    }

    if (url.pathname === "/api/tattoo/settings") {
      if (request.method !== "GET") return methodNotAllowed(request.method, ["GET"]);
      return handlePublicTattooSettings(request, env);
    }

    if (url.pathname === "/api/admin/tattoo/settings") {
      if (!["GET", "PATCH"].includes(request.method)) {
        return methodNotAllowed(request.method, ["GET", "PATCH"]);
      }
      return handleAdminTattooSettings(request, env);
    }

    if (url.pathname === "/api/admin/communications/text-templates") {
      if (!["GET", "PATCH"].includes(request.method)) {
        return methodNotAllowed(request.method, ["GET", "PATCH"]);
      }
      return handleAdminManualTextTemplates(request, env);
    }

    if (url.pathname.startsWith("/api/admin/notifications/")) {
      return handleNotificationsApi(request, env);
    }

    if (url.pathname === "/api/admin/brief-templates" || url.pathname.startsWith("/api/admin/brief-templates/")) {
      return handleAdminBriefTemplates(request, env);
    }

    const publicBriefMatch = url.pathname.match(/^\/api\/tattoo\/briefs\/([^/]+)$/);
    if (publicBriefMatch) {
      return handlePublicBriefDownload(request, env, decodeURIComponent(publicBriefMatch[1]));
    }

    if (
      url.pathname === "/api/portfolio" ||
      url.pathname.startsWith("/api/portfolio/") ||
      url.pathname === "/api/admin/portfolio" ||
      url.pathname.startsWith("/api/admin/portfolio/")
    ) {
      return handlePortfolioApi(request, env);
    }

    if (
      url.pathname === "/api/submissions" ||
      url.pathname.startsWith("/api/admin/submissions")
    ) {
      return handleSubmissionsApi(request, env);
    }

    if (url.pathname === "/api/build-drafts" || url.pathname.startsWith("/api/build-drafts/")) {
      return handleBuildDraftsApi(request, env);
    }

    if (url.pathname === "/legend" || url.pathname.startsWith("/legend/")) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = url.pathname === "/legend" ? "/about/legend/" : `/about${url.pathname}`;
      return Response.redirect(redirectUrl, 308);
    }

    if (normalizePath(url.pathname) === "/about/legend/detail") {
      return notFoundPage(request, env);
    }

    const requestedLegendSlug = legendRecordSlug(url.pathname);
    if (requestedLegendSlug) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizePath(url.pathname)}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return serveLegendRecordPage(request, env, requestedLegendSlug);
    }

    if (url.pathname === "/api/tattoo/specials") {
      if (request.method !== "GET") return methodNotAllowed(request.method, ["GET"]);
      return handlePublicTattooSpecials(request, env);
    }

    if (url.pathname === "/api/tattoo/specials/submissions") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleCreateTattooSpecialSubmission(request, env);
    }

    if (url.pathname === "/api/admin/tattoo/specials") {
      if (!["GET", "PATCH"].includes(request.method)) return methodNotAllowed(request.method, ["GET", "PATCH"]);
      return handleAdminTattooSpecials(request, env);
    }

    if (url.pathname === "/api/admin/tattoo/specials/offers") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleAdminTattooSpecialOffer(request, env);
    }

    if (url.pathname === "/api/admin/tattoo/specials/campaigns") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleAdminTattooSpecialCampaign(request, env);
    }

    const tattooSpecialCampaignMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/campaigns\/([^/]+)$/);
    if (tattooSpecialCampaignMatch) {
      if (!["PATCH", "DELETE"].includes(request.method)) return methodNotAllowed(request.method, ["PATCH", "DELETE"]);
      return handleAdminTattooSpecialCampaign(request, env, decodeURIComponent(tattooSpecialCampaignMatch[1]));
    }

    const tattooSpecialOfferMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/offers\/([^/]+)$/);
    if (tattooSpecialOfferMatch) {
      if (!["PATCH", "DELETE"].includes(request.method)) return methodNotAllowed(request.method, ["PATCH", "DELETE"]);
      return handleAdminTattooSpecialOffer(request, env, decodeURIComponent(tattooSpecialOfferMatch[1]));
    }

    const tattooSpecialReviewMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/submissions\/([^/]+)\/review$/);
    if (tattooSpecialReviewMatch) {
      if (request.method !== "PATCH") return methodNotAllowed(request.method, ["PATCH"]);
      return handleAdminTattooSpecialReview(request, env, decodeURIComponent(tattooSpecialReviewMatch[1]));
    }

    const tattooSpecialDepositMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/submissions\/([^/]+)\/deposit$/);
    if (tattooSpecialDepositMatch) {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleAdminTattooSpecialDeposit(request, env, decodeURIComponent(tattooSpecialDepositMatch[1]));
    }

    if (normalizePath(url.pathname) === "/studio/art-preview") {
      return serveArtPreviewPage(request, env);
    }

    if (normalizePath(url.pathname) === "/art/detail") {
      return notFoundPage(request, env);
    }

    const normalizedPublicPath = normalizePath(url.pathname);
    if (normalizedPublicPath === "/tattoos/special-projects/apply") {
      const reference = url.searchParams.get("project") || "";
      if (!reference) return Response.redirect(new URL("/tattoos/special-projects/", request.url), 308);
      const project = await publicSpecialProjectRecord(env, reference);
      if (!project) return notFoundPage(request, env);
      const canonicalUrl = new URL(`/tattoos/special-projects/${encodeURIComponent(project.slug)}/`, request.url);
      canonicalUrl.hash = "#application";
      return Response.redirect(canonicalUrl, 308);
    }

    if (normalizedPublicPath === "/tattoos/special-projects" && url.searchParams.has("project")) {
      const project = await publicSpecialProjectRecord(env, url.searchParams.get("project"));
      if (!project) return notFoundPage(request, env);
      return Response.redirect(new URL(`/tattoos/special-projects/${encodeURIComponent(project.slug)}/`, request.url), 308);
    }

    const requestedSpecialProjectSlug = specialProjectRecordSlug(url.pathname);
    if (requestedSpecialProjectSlug) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizePath(url.pathname)}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return serveSpecialProjectRecordPage(request, env, requestedSpecialProjectSlug);
    }

    const legacyMerch = await legacyMerchResponse(request, env, url.pathname);
    if (legacyMerch) return legacyMerch;

    const requestedArtSlug = artRecordSlug(url.pathname);
    if (requestedArtSlug) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizePath(url.pathname)}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return serveArtRecordPage(request, env, requestedArtSlug);
    }

    const requestedMerchSlug = merchRecordSlug(url.pathname);
    if (requestedMerchSlug) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizePath(url.pathname)}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return serveMerchRecordPage(request, env, requestedMerchSlug);
    }

    if (isFrontDoorPath(url.pathname)) {
      return servePublicAsset(request, env, "/index.html");
    }

    if (isHomePath(url.pathname)) {
      return servePublicAsset(request, env, "/home/index.html");
    }

    if (
      !isLocalOnlyPath(url.pathname) &&
      (isHiddenPublicPath(url.pathname) || isHiddenByHomeOnlyMode(url.pathname))
    ) {
      return redirectToNotFoundPage(request);
    }

    if (isEventDetailPagePath(url.pathname)) {
      return servePublicAsset(request, env, eventDetailAssetPath(url.pathname));
    }

    if (isFlashDetailPagePath(url.pathname)) {
      return servePublicAsset(request, env, "/tattoos/flash/detail/index.html");
    }

    const archiveAssetPath = archiveDynamicAssetPath(url.pathname);
    if (archiveAssetPath) {
      return servePublicAsset(request, env, archiveAssetPath);
    }

    return servePublicAsset(request, env, assetPathForRequest(url.pathname));
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(retryPendingAdminAppointmentNotifications(env));
    ctx.waitUntil(sendDueAppointmentReminders(env));
    ctx.waitUntil(sendDueEventTicketReminders(env));
    ctx.waitUntil(sendDueExperimentalHealedReminders(env));
    ctx.waitUntil(reapStalePendingTickets(env));
    ctx.waitUntil(reapExpiredBookingHolds(env));
    ctx.waitUntil(reapExpiredTattooRenderingRequests(env));
    ctx.waitUntil(reconcileExperimentalDepositRefunds(env));
    ctx.waitUntil(reapExpiredTattooBuildDrafts(env));
    ctx.waitUntil(reapStaleMediaUploads(env));
    ctx.waitUntil(processDueOutreach(env));
    ctx.waitUntil(rollupSiteAnalytics(env));
  },
};
