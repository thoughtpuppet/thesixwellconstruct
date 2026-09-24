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
  handleGetMazeRevisionFile,
  handleGetMazeSubmissionEdit,
  handleGetSubmission,
  handleGetSubmissionFile,
  handleListSubmissions,
  handleOpenSubmission,
  handlePromoteMazeArchiveSubmission,
  handleSubmissionDecision,
  handleSubmissionDecisionNotification,
  handleSubmitMazeRevision,
  handleUpdateMazeArchiveSubmission,
  handleUpdateSubmission,
} from "./functions/api/submissions/_lib.js";
import {
  handleAdminCreateAvailability,
  handleAdminCreateAppointmentMeeting,
  handleAdminCreateAppointment,
  handleAdminCreateTattooRenderingRequest,
  handleAdminCancelAppointment,
  handleAdminDeleteAppointment,
  handleAdminCompleteAppointment,
  handleAdminCreateBookingToken,
  handleAdminDeleteAvailability,
  handleAdminDeleteDateOverride,
  handleAdminDeleteSchedulePeriod,
  handleAdminGetBookingReadiness,
  handleAdminGetAvailabilityPreview,
  handleAdminGetSchedule,
  handleAdminTattooSessionPlan,
  handleAdminListAppointments,
  handleAdminListAvailability,
  handleAdminListDateOverrides,
  handleAdminListSchedulePeriods,
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
  handleAdminPutDateOverride,
  handleAdminCreateSchedulePeriod,
  handleAdminPutSchedulePeriod,
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
import {
  handleAdminDiscoverCalendars,
  handleAdminGetCalendarSync,
  handleAdminRunCalendarSync,
  handleAdminUpdateCalendarSync,
  runIcloudCalendarSync,
} from "./functions/api/booking/_calendar-sync.js";
import { shortBookingTokenFromPath } from "./functions/api/booking-links.js";
import {
  handleEventsApi,
  handleAdminEventsApi,
  handleEventsSquareWebhook,
  reapStalePendingTickets,
} from "./functions/api/events/_lib.js";
import {
  handleCalendarAdminApi,
  handleCalendarFeed,
  handleCalendarPublicApi,
  runDueCalendarScout,
} from "./functions/api/calendar/_lib.js";
import {
  handleCalendarSubmissionAdminApi,
  handleCalendarSubmissionPublicApi,
  purgeClosedCalendarSubmissions,
} from "./functions/api/calendar-submissions/_lib.js";
import {
  handleAdminEmailDesign,
  handleAdminEmailTemplates,
  handleAdminPreviewNotification,
  handleAdminResendNotification,
  retryPendingAdjustedOfferNotifications,
  retryPendingAdminAppointmentNotifications,
  sendDueAppointmentReminders,
  sendDueEventTicketReminders,
  sendDueExperimentalHealedReminders,
} from "./functions/api/notifications/_lib.js";
import {
  handleAdminAcceptAdjustedOffer,
  handleAdminCreateAdjustedOffer,
  handleAdminDeclineAdjustedOffer,
  handleAdminGetAdjustedOfferLink,
  handleAdminResendAdjustedOffer,
  handleAdminWithdrawAdjustedOffer,
  handlePublicAdjustedOfferContext,
  handlePublicAdjustedOfferResponse,
  reapExpiredAdjustedOffers,
} from "./functions/api/tattoo-adjusted-offers/_lib.js";
import {
  handleAdminSpecialProjectHealed,
  handlePublicSpecialProjectHealed,
} from "./functions/api/special-projects/_lib.js";
import { handlePortfolioApi } from "./functions/api/portfolio/_lib.js";
import { handleConstructApi, reapStaleMediaUploads } from "./functions/api/construct/_lib.js";
import { writingPageSlug, renderWritingPageTemplate } from "./functions/api/_shared/writing-pages.js";
import { runVisualColorAnalysisPass } from "./functions/api/construct/_colors-materials.js";
import { handleVisualColorQueue } from "./functions/api/construct/_automatic-visual-colors.js";
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
  analyticsExcluded,
  handleAdminAnalytics,
  handleAdminAnalyticsExclusion,
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
import {
  handleAdminSiteVisibility,
  handlePublicSiteVisibility,
  publicPageVisibilityDecision,
} from "./functions/api/site-visibility/_lib.js";
import { isPageVisibilityOperationalExemptPath } from "./shared/page-visibility.js";
import {
  applySeoDocument,
  applySeoResponse,
  canonicalOrigin,
  canonicalRedirect,
  dynamicStructuredGraph,
  handleRobots,
  handleSitemap,
  normalizeSeoPath,
} from "./functions/api/seo/_lib.js";

const PUBLIC_FRONT_DOOR_PATHS = new Set(["/", "/index", "/index/", "/index.html"]);
const PUBLIC_ENTRY_ROOM_ALIAS_PATHS = new Set(["/entry-room", "/entry-room/", "/entry-room/index.html"]);
const PUBLIC_HOME_PATHS = new Set(["/home", "/home/", "/home/index.html"]);
const LEGACY_BESPOKE_EVENT_SLUGS = new Set(["kinmarking", "open-studios"]);

function notFound(message = "Not found.") {
  return json({ error: message }, { status: 404 });
}

async function notFoundPage(request, env) {
  const url = new URL(request.url);
  url.pathname = "/404.html";
  url.search = "";
  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: 404,
    headers,
  });
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

export function shouldInjectSiteAnalytics(request, response) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const contentType = response.headers.get("content-type") || "";
  if (request.method !== "GET" || response.status !== 200 || !contentType.includes("text/html")) return false;
  if (analyticsExcluded(request)) return false;
  if (isLocalPreview(url) || url.searchParams.has("preview")) return false;
  if (
    pathname.startsWith("/api/") || pathname.startsWith("/studio/") || pathname.startsWith("/tools/") ||
    pathname.startsWith("/sixwellconstruct/") || pathname.includes("managed-preview") ||
    pathname.includes("connections-preview") || pathname.includes("/previews/")
  ) return false;
  return !(response.headers.get("x-robots-tag") || "").toLowerCase().includes("noindex");
}

export function browserAnalyticsMarkup(env, pathname) {
  const scripts = ['<script src="/js/site-analytics.js?v=2" defer></script>'];
  const rumToken = String(env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG || "").trim();
  if (/^[A-Za-z0-9_-]{8,200}$/.test(rumToken)) {
    const config = escapeHtml(JSON.stringify({ token: rumToken }));
    scripts.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="${config}"></script>`);
  }
  if (normalizePath(pathname) === "/tattoos/specials") {
    scripts.push('<script src="/js/tattoo-specials-meta.js?v=1" defer></script>');
  }
  return scripts.join("");
}

async function servePublicAsset(request, env, pathname, { seo = true } = {}) {
  let response = await env.ASSETS.fetch(assetRequest(request, pathname));
  if (shouldInjectSiteAnalytics(request, response) && typeof HTMLRewriter !== "undefined") {
    response = new HTMLRewriter().on("body", {
      element(element) {
        element.append(browserAnalyticsMarkup(env, new URL(request.url).pathname), { html: true });
      },
    }).transform(response);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!seo || response.status !== 200 || !contentType.includes("text/html") || !["GET", "HEAD"].includes(request.method)) return response;
  return applySeoResponse(request, env, response);
}

function privateLinkResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    pathname === "/js/live-text-editor.js"
  );
}

function normalizePath(pathname) {
  let normalized = pathname || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  return normalized || "/";
}

function hasFileExtension(pathname) {
  return /\/[^/]+\.[^/]+$/.test(pathname);
}

function isPageVisibilityExemptPath(pathname) {
  return isPageVisibilityOperationalExemptPath(pathname) || isLocalOnlyPath(pathname);
}

async function pageVisibilityResponse(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const pathname = new URL(request.url).pathname;
  if (!isPublicPagePath(pathname) || isPageVisibilityExemptPath(pathname)) return null;
  const decision = await publicPageVisibilityDecision(pathname, env);
  return decision.hidden ? notFoundPage(request, env) : null;
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

function calendarEventDetailReference(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "calendar" || parts[1] !== "events" || hasFileExtension(pathname)) return null;
  let key = "";
  try { key = decodeURIComponent(parts[2]); }
  catch { return null; }
  const separator = key.indexOf("--");
  if (separator < 1) return null;
  const titleSlug = key.slice(0, separator);
  const eventId = key.slice(separator + 2);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(titleSlug) || !eventId || eventId.length > 500) return null;
  return { titleSlug, eventId };
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
  if (parts[1] === "notes") return "/archive/notes/index.html";
  if (parts[1] === "timelines") return "/archive/timelines/index.html";
  if (parts[1] === "colors") return "/archive/colors/index.html";
  if (parts[1] === "materials") return "/archive/materials/index.html";
  if (parts[1] === "blackboards") return "/archive/blackboards/index.html";
  if (parts[1] === "failed-experiments") return "/archive/failed-experiments/index.html";
  return "";
}

function appearanceDetailSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "exhibitions-appearances") return "";
  return hasFileExtension(pathname) || parts[2] === "detail" ? "" : parts[2];
}

function identityProfileSlug(pathname) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "about" || parts[1] !== "identities") return "";
  if (hasFileExtension(pathname) || parts[2] === "detail") return "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2]) ? parts[2] : "";
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

function seoRecordSummary({ title, description = "", eyebrow = "", meta = [], links = [], headingTag = "h1" }) {
  const heading = headingTag === "h2" ? "h2" : "h1";
  const rows = meta
    .filter((item) => item?.label && item?.value)
    .map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`)
    .join("");
  const actions = links
    .filter((item) => item?.href && item?.label)
    .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`)
    .join("");
  return `<div data-seo-record-summary>${eyebrow ? `<p>${escapeHtml(eyebrow)}</p>` : ""}<${heading}>${escapeHtml(title)}</${heading}>${description ? `<p>${escapeHtml(description)}</p>` : ""}${rows ? `<dl>${rows}</dl>` : ""}${actions ? `<nav aria-label="Record pathways">${actions}</nav>` : ""}</div>`;
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

  const assetResponse = await servePublicAsset(request, env, "/about/legend/detail/index.html", { seo: false });
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${payload.record.canonicalRoute}`;
  const title = `${payload.record.name} · The Legend · the six.well construct`;
  const description = payload.record.meaning || "A published symbol record from the living Legend.";
  const seo = {
    title,
    description,
    canonicalUrl,
    structuredData: dynamicStructuredGraph({
      type: "DefinedTerm",
      canonicalUrl,
      title: payload.record.name,
      description,
      origin: siteOrigin,
      extra: { inDefinedTermSet: `${siteOrigin}/about/legend/`, creator: { "@id": `${siteOrigin}/about/saieldauhnsolehman/#person` } },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
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
    )
    .replace(
      /<article class="legend-record" data-live-legend-record[^>]*>[\s\S]*?<\/article>/,
      `<article class="legend-record" data-live-legend-record aria-live="polite">${seoRecordSummary({
        title: payload.record.name,
        description,
        eyebrow: "The living Legend",
        links: [
          { href: "/about/legend/", label: "Explore the Legend" },
          { href: "/tattoos/build/", label: "Build with symbols" },
          { href: "/archive/", label: "Search the living Archive" },
        ],
      })}</article>`,
    );
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
}

async function publicSpecialProjectRecord(env, reference) {
  const value = String(reference || "").trim();
  if (!value) return null;
  return env.SUBMISSIONS_DB.prepare(
    `SELECT spc.id,spc.slug,spc.title,COALESCE(spc.summary,'') summary,
            COALESCE(spc.artist_statement,'') artist_statement,
            COALESCE(spc.application_instructions,'') application_instructions,
            COALESCE(spc.rate_text,'') rate_text,
            spc.status,spc.opens_at,spc.closes_at
     FROM special_project_calls spc
     JOIN content_entities ce ON ce.id=spc.id AND ce.entity_type='special_project'
     WHERE (spc.slug=?1 OR spc.id=?1)
       AND spc.publication_state='published' AND ce.visibility='public'
     LIMIT 1`
  ).bind(value).first();
}

function specialProjectStatus(record, now = Date.now()) {
  if (record.status !== "open") return "closed";
  const opensAt = record.opens_at ? Date.parse(record.opens_at) : NaN;
  const closesAt = record.closes_at ? Date.parse(record.closes_at) : NaN;
  if (Number.isFinite(opensAt) && opensAt > now) return "opening soon";
  if (Number.isFinite(closesAt) && closesAt <= now) return "closed";
  return "open";
}

function specialProjectWindow(record) {
  const opens = record.opens_at ? publicEventDateText(record.opens_at) : "";
  const closes = record.closes_at ? publicEventDateText(record.closes_at) : "";
  if (opens && closes) return `${opens} – ${closes}`;
  if (closes) return `Through ${closes}`;
  if (opens) return `Opens ${opens}`;
  return "Dates set in Studio";
}

async function serveSpecialProjectRecordPage(request, env, slug) {
  const record = await publicSpecialProjectRecord(env, slug);
  if (!record || record.slug !== slug) return notFoundPage(request, env);

  const assetResponse = await servePublicAsset(request, env, "/tattoos/special-projects/index.html", { seo: false });
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}/tattoos/special-projects/${encodeURIComponent(record.slug)}/`;
  const title = `${record.title} · Special Projects · Art.Pill Tattoo House`;
  const description = record.summary || record.artist_statement || `Special Project detail for ${record.title}.`;
  const effectiveStatus = specialProjectStatus(record);
  const availability = effectiveStatus === "open"
    ? "Open for review"
    : effectiveStatus === "opening soon" ? "Opening soon" : "Closed";
  const applicationCopy = record.application_instructions
    || "Special Projects are reviewed before booking. Open-call applications receive call-specific next steps if accepted.";
  const seo = {
    title,
    description,
    canonicalUrl,
    structuredData: dynamicStructuredGraph({
      type: "CreativeWork",
      canonicalUrl,
      title: record.title,
      description,
      origin: siteOrigin,
      extra: { creator: { "@id": `${siteOrigin}/about/saieldauhnsolehman/#person` } },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
  let html = (await assetResponse.text())
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
  html = html
    .replace('data-special-project-page="overview"', 'data-special-project-page="detail"')
    .replace(
      '<h1 class="page-title hero-title" data-copy-id="special-projects-page-title">Special Projects</h1>',
      '<h2 class="page-title hero-title" data-copy-id="special-projects-page-title">Special Projects</h2>',
    )
    .replace('<span id="projectBreadcrumbTitle">Project</span>', `<span id="projectBreadcrumbTitle">${escapeHtml(record.title)}</span>`)
    .replace('<p class="detail-kicker" id="projectKicker">Loading / Current status</p>', `<p class="detail-kicker" id="projectKicker">Special Project / ${escapeHtml(availability)}</p>`)
    .replace('<h1 class="detail-title" id="projectTitle">Current Calls</h1>', `<h1 class="detail-title" id="projectTitle">${escapeHtml(record.title)}</h1>`)
    .replace('<p class="detail-summary" id="projectSummary">Loading Special Project records from Studio.</p>', `<p class="detail-summary" id="projectSummary">${escapeHtml(description)}</p>`)
    .replace('<p class="meta-value" id="projectStyle">Confirmed after review</p>', `<p class="meta-value" id="projectStyle">${escapeHtml(record.rate_text || "Confirmed after review")}</p>`)
    .replace('<p class="meta-value" id="projectFormat">Managed in Studio</p>', `<p class="meta-value" id="projectFormat">${escapeHtml(specialProjectWindow(record))}</p>`)
    .replace('<p class="meta-value" id="projectAvailability">Checking</p>', `<p class="meta-value" id="projectAvailability">${escapeHtml(availability)}</p>`)
    .replace('<p class="intention-body" id="projectIntention">Open calls accept applications for review. Closed calls remain visible as context but cannot be submitted.</p>', `<p class="intention-body" id="projectIntention">${escapeHtml(applicationCopy)}</p>`)
    .replace('<p class="application-copy" id="applicationCopy">Special Projects are reviewed before booking. Open-call applications receive call-specific next steps if accepted.</p>', `<p class="application-copy" id="applicationCopy">${escapeHtml(applicationCopy)}</p>`)
    .replace(
      '<a class="cta-primary is-disabled" id="projectApply" aria-disabled="true">Loading call status</a>',
      effectiveStatus === "open"
        ? '<a class="cta-primary" id="projectApply" href="#application">Apply for review</a>'
        : `<a class="cta-primary is-disabled" id="projectApply" aria-disabled="true">${escapeHtml(availability)}</a>`,
    )
    .replace(
      '<script src="/js/tattoo-before-booking.js"></script>',
      `<script id="special-project-record-data" type="application/json">${legendRecordJson({ record: { ...record, effectiveStatus } })}</script>\n  <script src="/js/tattoo-before-booking.js"></script>`,
    );
  if (record.artist_statement) {
    html = html
      .replace('<section class="artist-statement" id="projectArtistStatement" hidden>', '<section class="artist-statement" id="projectArtistStatement">')
      .replace('<p class="artist-statement-copy" id="projectArtistStatementCopy"></p>', `<p class="artist-statement-copy" id="projectArtistStatementCopy">${escapeHtml(record.artist_statement)}</p>`);
  }
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
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

  const assetResponse = await servePublicAsset(request, env, "/art/detail/index.html", { seo: false });
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${record.canonicalRoute}`;
  const title = `${record.title} · art · the six.well construct`;
  const description = record.statement || `Artwork detail for ${record.title}.`;
  const primaryImage = record.primaryMedia?.url || record.imageUrl || record.media?.[0]?.url || "";
  const seo = {
    title,
    description,
    canonicalUrl,
    image: primaryImage,
    structuredData: dynamicStructuredGraph({
      type: "VisualArtwork",
      canonicalUrl,
      title: record.title,
      description,
      image: primaryImage,
      origin: siteOrigin,
      extra: {
        creator: { "@id": `${siteOrigin}/about/saieldauhnsolehman/#person` },
        ...(record.year ? { dateCreated: record.year } : {}),
        ...(record.medium ? { artMedium: record.medium } : {}),
      },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
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
    )
    .replace(
      /<main class="art-detail-state" data-art-detail-state role="status">[\s\S]*?<\/main>/,
      `<main class="art-detail-state" data-art-detail-state role="status">${seoRecordSummary({
        title: record.title,
        description,
        eyebrow: "Artwork by Saiel Dauhn Solehman",
        headingTag: "h2",
        meta: [
          { label: "Year", value: record.year },
          { label: "Medium", value: record.medium },
          { label: "Dimensions", value: record.dimensions },
        ],
        links: [
          { href: "/art/", label: "Explore more artwork" },
          { href: "/about/contact-press/", label: "Ask about collecting or exhibitions" },
        ],
      })}</main>`,
    )
    .replace(/(<h1 class="painting-title hero-title" data-art-field="title">)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(record.title)}$2`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
}

async function serveWritingRecordPage(request, env, slug) {
  if (!slug) return notFoundPage(request,env);
  const response = await handleConstructApi(new Request(new URL(`/api/writings/entries/${encodeURIComponent(slug)}`,request.url)),env);
  if (response.status === 404) return notFoundPage(request,env);
  if (!response.ok) return response;
  const {entry} = await response.json();
  const asset = await servePublicAsset(request,env,"/writings/mindful-darkness/wrkng/detail/index.html", { seo: false });
  if (!asset.ok) return asset;
  const origin = String(env.PUBLIC_SITE_URL || "https://thesixwellconstruct.com").replace(/\/+$/, "");
  const headers = new Headers(asset.headers); headers.delete("content-length"); headers.delete("etag"); headers.set("cache-control","no-store");
  const canonicalUrl = `${origin}/writings/mindful-darkness/wrkng/${encodeURIComponent(entry.slug)}/`;
  const title = `${entry.snapshot.title} · WRKNG* · the six.well construct`;
  const description = entry.snapshot.excerpt || `Writing by ${entry.snapshot.author || "Saiel Dauhn Solehman"}.`;
  const seo = {
    title,
    description,
    canonicalUrl,
    ogType: "article",
    structuredData: dynamicStructuredGraph({
      type: "Article",
      canonicalUrl,
      title: entry.snapshot.title,
      description,
      origin,
      extra: {
        author: { "@id": `${origin}/about/saieldauhnsolehman/#person` },
        ...(entry.firstPublishedAt ? { datePublished: entry.firstPublishedAt } : {}),
        ...(entry.publishedUpdatedAt ? { dateModified: entry.publishedUpdatedAt } : {}),
      },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, new Response(null,{status:200,headers}), seo);
  return applySeoResponse(request, env, new Response(renderWritingPageTemplate(await asset.text(),entry,origin),{headers}), seo);
}

async function serveArtPreviewPage(request, env) {
  const response = await servePublicAsset(request, env, "/art/detail/index.html", { seo: false });
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
  const assetResponse = await servePublicAsset(request, env, "/merch/detail/index.html", { seo: false });
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${product.canonicalRoute}`;
  const title = `${product.title} · merch · the six.well construct`;
  const description = product.description || product.statement || `Merch detail for ${product.title}.`;
  const purchasable = product.availableForSale === true && product.price?.amount != null && Boolean(product.price?.currencyCode);
  const structuredType = purchasable ? "Product" : "CreativeWork";
  const productExtra = purchasable ? {
    brand: { "@type": "Brand", name: product.sourceLabel || "Six.Well Clothing" },
    sku: product.catalogNumber || product.slug,
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      availability: "https://schema.org/InStock",
      price: String(product.price.amount),
      priceCurrency: product.price.currencyCode,
      seller: { "@type": "Organization", "@id": `${siteOrigin}/#organization`, name: "The Six.Well Construct", url: `${siteOrigin}/` },
    },
  } : { creator: { "@id": `${siteOrigin}/about/saieldauhnsolehman/#person` } };
  const seo = {
    title,
    description,
    canonicalUrl,
    image: product.heroImage || "",
    structuredData: dynamicStructuredGraph({
      type: structuredType,
      canonicalUrl,
      title: product.title,
      description,
      image: product.heroImage || "",
      origin: siteOrigin,
      extra: productExtra,
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
  const html = (await assetResponse.text())
    .replace(/<title data-merch-record-title>[\s\S]*?<\/title>/, `<title data-merch-record-title>${escapeHtml(title)}</title>`)
    .replace(/<meta data-merch-record-description name="description" content="[^"]*">/, `<meta data-merch-record-description name="description" content="${escapeHtml(description)}">`)
    .replace(/<link data-merch-record-canonical rel="canonical" href="[^"]*">/, `<link data-merch-record-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`)
    .replace(/(<h1 class="product-name hero-title" id="productName">)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(product.title)}$2`)
    .replace(/(<p class="hero-descriptor" id="productDescription">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(description)}$2`)
    .replace(/(<p class="product-price" id="productPrice">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(product.price?.formatted || product.priceNote || "")}$2`)
    .replace(/(<p class="product-edition" id="productEdition">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(product.editionText || "")}$2`)
    .replace(/<img id="productHeroImage"[^>]*>/, product.heroImage
      ? `<img id="productHeroImage" src="${escapeHtml(product.heroImage)}" alt="${escapeHtml(product.heroImageAlt || product.title)}">`
      : '<img id="productHeroImage" alt="">')
    .replace('<script id="merch-record-data" type="application/json"></script>', `<script id="merch-record-data" type="application/json">${legendRecordJson(payload)}</script>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
}

async function serveIdentityProfilePage(request, env, slug) {
  const apiUrl = new URL(`/api/identities/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleConstructApi(new Request(apiUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const profile = payload.profile || payload.record || payload.identity;
  if (!profile) return notFoundPage(request, env);
  const assetResponse = await servePublicAsset(request, env, "/about/identities/detail/index.html", { seo: false });
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, {
    title: `${profile.name || profile.title || slug} · Creative Identity · the six.well construct`,
    description: profile.heroDescriptor || profile.currentRole || profile.originBody || "A published creative identity within the Six.Well Construct.",
    canonicalPath: `/about/identities/${encodeURIComponent(slug)}/`,
  });
  const origin = canonicalOrigin(env, request.url);
  const canonicalUrl = `${origin}/about/identities/${encodeURIComponent(slug)}/`;
  const title = `${profile.name || profile.title || slug} · Creative Identity · the six.well construct`;
  const description = profile.heroDescriptor || profile.currentRole || profile.originBody || "A published creative identity within the Six.Well Construct.";
  const html = (await assetResponse.text())
    .replace(
      /<article class="identity-profile" data-identity-detail[^>]*>[\s\S]*?<\/article>/,
      `<article class="identity-profile" data-identity-detail aria-live="polite" aria-busy="true">${seoRecordSummary({
        title: profile.name || profile.title || slug,
        description,
        eyebrow: "Creative identity within the Six.Well Construct",
        meta: [
          { label: "Current role", value: profile.currentRole },
          { label: "Origin", value: profile.originTitle },
        ],
        links: [
          { href: "/about/identities/", label: "Explore creative identities" },
          { href: "/archive/", label: "Search the living Archive" },
        ],
      })}</article>`,
    )
    .replace('<script src="/js/about-identities.js"></script>', `<script id="identity-record-data" type="application/json">${legendRecordJson(payload)}</script>\n<script src="/js/about-identities.js"></script>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  const response = new Response(html, { status: assetResponse.status, headers });
  return applySeoResponse(request, env, response, {
    title,
    description,
    canonicalUrl,
    structuredData: dynamicStructuredGraph({
      type: "CreativeWork",
      canonicalUrl,
      title: profile.name || profile.title || slug,
      description,
      origin,
      extra: { creator: { "@id": `${origin}/about/saieldauhnsolehman/#person` } },
    }),
  });
}

async function serveFlashRecordPage(request, env, slug) {
  const apiUrl = new URL(`/api/flash/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleConstructApi(new Request(apiUrl, { method: "GET", headers: { accept: "application/json" } }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const record = payload.record;
  if (!record || record.slug !== slug) return notFoundPage(request, env);
  const assetResponse = await servePublicAsset(request, env, "/tattoos/flash/detail/index.html", { seo: false });
  const origin = canonicalOrigin(env, request.url);
  const canonicalUrl = `${origin}${record.canonicalRoute || `/tattoos/flash/${encodeURIComponent(slug)}/`}`;
  const title = `${record.title} · Tattoo Flash · art.pill Tattoo House`;
  const description = record.description || `${record.title}, tattoo flash by Saiel Dauhn Solehman at art.pill Tattoo House in Atlanta.`;
  const image = record.media?.[0]?.url || record.image_url || "";
  const seo = {
    title,
    description,
    canonicalUrl,
    image,
    structuredData: dynamicStructuredGraph({
      type: "VisualArtwork",
      canonicalUrl,
      title: record.title,
      description,
      image,
      origin,
      extra: {
        creator: { "@id": `${origin}/about/saieldauhnsolehman/#person` },
        artform: "Tattoo flash",
      },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
  let html = (await assetResponse.text())
    .replace(
      /<section class="state site-hero site-hero--supporting" id="loadingState"[^>]*>[\s\S]*?<\/section>/,
      `<section class="state site-hero site-hero--supporting" id="loadingState" role="status" aria-live="polite">${seoRecordSummary({
        title: record.title,
        description,
        eyebrow: "Tattoo flash by Saiel Dauhn Solehman",
        headingTag: "h2",
        meta: [
          { label: "Size", value: record.size_bucket || record.sizeBucket },
          { label: "Format", value: record.item_type || record.type },
          { label: "Availability", value: record.claimableNow === true || record.claimable_now === true ? "Available for Studio review" : "Past work or unavailable" },
        ],
        links: [
          { href: "/tattoos/flash/", label: "Explore tattoo flash" },
          { href: "/tattoos/inquire/", label: "Start a tattoo inquiry" },
        ],
      })}</section>`,
    )
    .replace(/(<h1 class="hero-title" id="flashTitle">)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(record.title)}$2`)
    .replace("</body>", `<script id="flash-record-data" type="application/json">${legendRecordJson(payload)}</script>\n</body>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=60");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
}

async function serveArchiveRecordPage(request, env, pathname, assetPath) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  const slug = parts[2] || "";
  if (!slug) return notFoundPage(request, env);
  const apiUrl = new URL(`/api/archive/items/${encodeURIComponent(slug)}`, request.url);
  const apiResponse = await handleConstructApi(new Request(apiUrl, { method: "GET", headers: { accept: "application/json" } }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const record = payload.record;
  if (!record) return notFoundPage(request, env);
  const assetResponse = await servePublicAsset(request, env, assetPath, { seo: false });
  const origin = canonicalOrigin(env, request.url);
  const canonicalUrl = `${origin}${record.canonicalRoute || record.canonical_route || normalizeSeoPath(pathname)}`;
  const recordTitle = record.title || record.name || slug.replace(/-/g, " ");
  const title = `${recordTitle} · Living Archive · the six.well construct`;
  const description = record.orientation || record.summary || record.story || `A published record from the living Archive of the Six.Well Construct.`;
  const image = record.media?.[0]?.url || record.image_url || "";
  const seo = {
    title,
    description,
    canonicalUrl,
    image,
    structuredData: dynamicStructuredGraph({
      type: "CreativeWork",
      canonicalUrl,
      title: recordTitle,
      description,
      image,
      origin,
      extra: { creator: { "@id": `${origin}/about/saieldauhnsolehman/#person` } },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
  const html = (await assetResponse.text())
    .replace(
      /<div data-archive-app>[\s\S]*?<\/div>\s*<\/main>/,
      `<div data-archive-app>${seoRecordSummary({
        title: recordTitle,
        description,
        eyebrow: "Published living Archive record",
        meta: [
          { label: "Record type", value: record.recordType || record.record_type },
          { label: "Period", value: record.periodLabel || record.period_label },
        ],
        links: [
          { href: "/archive/", label: "Search the Archive" },
          { href: "/about/saieldauhnsolehman/", label: "About Saiel Dauhn Solehman" },
        ],
      })}</div></main>`,
    )
    .replace("</body>", `<script id="archive-record-seo-data" type="application/json">${legendRecordJson(payload)}</script>\n</body>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=60");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
}

async function serveCalendarEventPage(request, env, reference) {
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed(request.method, ["GET", "HEAD"]);
  const apiUrl = new URL(`/api/calendar/events/${encodeURIComponent(reference.eventId)}`, request.url);
  const apiResponse = await handleCalendarPublicApi(new Request(apiUrl, { method:"GET", headers:{ accept:"application/json" } }), env);
  if (apiResponse.status === 404) return notFoundPage(request, env);
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const event = payload.event;
  if (!event?.detailUrl) return notFoundPage(request, env);

  const canonicalPath = event.detailUrl;
  if (event.origin === "sixwell") return Response.redirect(new URL(canonicalPath, request.url), 308);
  if (new URL(request.url).pathname !== canonicalPath) {
    const canonicalUrl = new URL(canonicalPath, request.url);
    canonicalUrl.search = "";
    canonicalUrl.hash = "";
    return Response.redirect(canonicalUrl, 308);
  }

  const assetResponse = await servePublicAsset(request, env, "/calendar/event/index.html", { seo: false });
  const siteOrigin = String(env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/g, "");
  const canonicalUrl = `${siteOrigin}${canonicalPath}`;
  const title = `${event.title} · Atlanta Creative Calendar`;
  const description = String(event.description || `${event.title}, an approved Atlanta Calendar event.`).slice(0, 320);
  const media = Array.isArray(event.media) && event.media.length ? event.media : (event.flyer?.url ? [event.flyer] : []);
  const imageUrl = media[0]?.url ? new URL(media[0].url, `${siteOrigin}/`).toString() : "";
  const eventStatus = event.status === "cancelled"
    ? "https://schema.org/EventCancelled"
    : event.status === "postponed"
      ? "https://schema.org/EventPostponed"
      : "https://schema.org/EventScheduled";
  const seo = {
    title,
    description,
    canonicalUrl,
    image: imageUrl,
    ogType: "article",
    structuredData: dynamicStructuredGraph({
      type: "Event",
      canonicalUrl,
      title: event.title,
      description,
      image: imageUrl,
      origin: siteOrigin,
      extra: {
        startDate: event.startsAt,
        ...(event.endsAt ? { endDate: event.endsAt } : {}),
        eventStatus,
        eventAttendanceMode: event.virtual ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
        ...(event.organizer ? { organizer: { "@type": "Organization", name: event.organizer, ...(event.sourceUrl ? { url: event.sourceUrl } : {}) } } : {}),
        ...(event.virtual
          ? { location: { "@type": "VirtualLocation", url: event.actionUrl || event.sourceUrl || canonicalUrl } }
          : (event.venueName || event.venueAddress || event.city || event.region) ? {
              location: {
                "@type": "Place",
                ...(event.venueName ? { name: event.venueName } : {}),
                ...(event.venueAddress || event.city || event.region ? { address: event.venueAddress || [event.city, event.region].filter(Boolean).join(", ") } : {}),
              },
            } : {}),
      },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);
  const html = (await assetResponse.text())
    .replace(/<title data-calendar-event-title>[\s\S]*?<\/title>/, `<title data-calendar-event-title>${escapeHtml(title)}</title>`)
    .replace(/<meta data-calendar-event-description name="description" content="[^"]*">/, `<meta data-calendar-event-description name="description" content="${escapeHtml(description)}">`)
    .replace(/<meta data-calendar-event-og-title property="og:title" content="[^"]*">/, `<meta data-calendar-event-og-title property="og:title" content="${escapeHtml(title)}">`)
    .replace(/<meta data-calendar-event-og-description property="og:description" content="[^"]*">/, `<meta data-calendar-event-og-description property="og:description" content="${escapeHtml(description)}">`)
    .replace(/<meta data-calendar-event-og-url property="og:url" content="[^"]*">/, `<meta data-calendar-event-og-url property="og:url" content="${escapeHtml(canonicalUrl)}">`)
    .replace(/<meta data-calendar-event-og-image property="og:image" content="[^"]*">/, `<meta data-calendar-event-og-image property="og:image" content="${escapeHtml(imageUrl)}">`)
    .replace(/<link data-calendar-event-canonical rel="canonical" href="[^"]*">/, `<link data-calendar-event-canonical rel="canonical" href="${escapeHtml(canonicalUrl)}">`)
    .replace(
      /<div id="calendarEventDetail"[^>]*>[\s\S]*?<\/div>/,
      `<div id="calendarEventDetail" aria-live="polite">${seoRecordSummary({
        title: event.title,
        description,
        eyebrow: "Atlanta Creative Calendar",
        meta: [
          { label: "Starts", value: publicEventDateText(event.startsAt) },
          { label: "Venue", value: event.venueName || (event.virtual ? "Online" : "") },
          { label: "Location", value: event.venueAddress || [event.city, event.region].filter(Boolean).join(", ") },
          { label: "Organizer", value: event.organizer },
        ],
        links: [
          { href: event.actionUrl || event.sourceUrl, label: event.actionLabel || "View event source" },
          { href: "/calendar/", label: "Back to Atlanta Creative Calendar" },
          { href: "/events/", label: "Explore Six.Well-produced events" },
        ],
      })}</div>`,
    )
    .replace('<script id="calendar-event-data" type="application/json"></script>', `<script id="calendar-event-data" type="application/json">${legendRecordJson(payload)}</script>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return applySeoResponse(request, env, new Response(html, { status:assetResponse.status, headers }), seo);
}

function publicEventDateText(value) {
  if (!value) return "Date to be announced";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

async function serveEventDetailPage(request, env, pathname) {
  const slug = normalizePath(pathname).split("/").filter(Boolean)[1] || "";
  if (!slug) return notFoundPage(request, env);
  const contextUrl = new URL(`/api/events/${encodeURIComponent(slug)}/context`, request.url);
  const requestedOccurrence = new URL(request.url).searchParams.get("occurrence");
  if (requestedOccurrence) contextUrl.searchParams.set("occurrence", requestedOccurrence);
  const apiResponse = await handleEventsApi(new Request(contextUrl, { method: "GET", headers: { accept: "application/json" } }), env);
  if (apiResponse.status === 404) {
    if (requestedOccurrence) return notFoundPage(request, env);
    const managedEvent = await env.SUBMISSIONS_DB.prepare(
      "SELECT publication_state FROM events WHERE slug=? LIMIT 1",
    ).bind(slug).first();
    if (managedEvent || !LEGACY_BESPOKE_EVENT_SLUGS.has(slug)) return notFoundPage(request, env);
    const bespoke = await servePublicAsset(request, env, eventDetailAssetPath(pathname), { seo: false });
    if (bespoke.status === 404) return notFoundPage(request, env);
    return applySeoResponse(request, env, bespoke, {
      canonicalPath: `/events/${encodeURIComponent(slug)}/`,
      title: `${slug.replace(/-/g, " ")} · Six.Well Events`,
      description: "A public creative program produced through the Six.Well Construct in Atlanta.",
    });
  }
  if (!apiResponse.ok) return apiResponse;
  const payload = await apiResponse.json();
  const event = payload.event;
  if (!event) return notFoundPage(request, env);

  let assetResponse = await servePublicAsset(request, env, eventDetailAssetPath(pathname), { seo: false });
  if (assetResponse.status === 404) assetResponse = await servePublicAsset(request, env, "/events/detail/index.html", { seo: false });
  const origin = canonicalOrigin(env, request.url);
  const canonicalPath = `/events/${encodeURIComponent(slug)}/`;
  const canonicalUrl = `${origin}${canonicalPath}`;
  const selected = payload.occurrence || event.occurrences?.[0] || null;
  const title = `${event.title} · Six.Well Events · Atlanta`;
  const description = event.description || "A public creative program produced through the Six.Well Construct in Atlanta.";
  const image = event.imageUrl || "";
  const eventStatus = event.status === "cancelled"
    ? "https://schema.org/EventCancelled"
    : "https://schema.org/EventScheduled";
  const startDate = selected?.startsAt || event.startsAt || undefined;
  const endDate = selected?.endsAt || event.endsAt || undefined;
  const location = selected?.location || event.location || "";
  const offers = event.publicationState === "published" && event.open ? {
    "@type": "Offer",
    url: canonicalUrl,
    price: String((Number(event.priceCents || 0) / 100).toFixed(2)),
    priceCurrency: event.currency || "USD",
    availability: event.soldOut ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
  } : null;
  const seo = {
    title,
    description,
    canonicalUrl,
    image,
    ogType: "article",
    structuredData: dynamicStructuredGraph({
      type: "Event",
      canonicalUrl,
      title: event.title,
      description,
      image,
      origin,
      extra: {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        eventStatus,
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        organizer: { "@type": "Organization", "@id": `${origin}/#organization`, name: "The Six.Well Construct", url: `${origin}/` },
        ...(location ? { location: { "@type": "Place", name: location, address: location } } : {}),
        ...(offers ? { offers } : {}),
      },
    }),
  };
  if (request.method === "HEAD") return applySeoResponse(request, env, assetResponse, seo);

  const occurrenceMarkup = (event.occurrences || []).map((occurrence) => {
    const href = `${canonicalPath}?occurrence=${encodeURIComponent(occurrence.id)}`;
    return `<a class="event-date${selected?.id === occurrence.id ? " is-selected" : ""}" href="${escapeHtml(href)}"><strong>${escapeHtml(publicEventDateText(occurrence.startsAt))}</strong><span>${escapeHtml(occurrence.location || event.location || "")}</span></a>`;
  }).join("");
  const html = (await assetResponse.text())
    .replace(/(<h1[^>]*id="eventTitle"[^>]*>)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(event.title)}$2`)
    .replace(/(<p[^>]*id="eventDescription"[^>]*>)[\s\S]*?(<\/p>)/, `$1${escapeHtml(description)}$2`)
    .replace(/(<p[^>]*id="eventDetails"[^>]*>)[\s\S]*?(<\/p>)/, `$1${escapeHtml(event.details || event.included || description)}$2`)
    .replace(/(<p[^>]*id="eventStatus"[^>]*>)[\s\S]*?(<\/p>)/, `$1${escapeHtml(startDate ? [publicEventDateText(startDate), location].filter(Boolean).join(" · ") : event.publicationState === "announced" ? "Announced" : "Public event")}$2`)
    .replace(/(<div[^>]*id="eventDates"[^>]*>)[\s\S]*?(<\/div>)/, `$1${occurrenceMarkup}$2`)
    .replace("</body>", `<script id="event-record-data" type="application/json">${legendRecordJson(payload)}</script>\n</body>`);
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "public, max-age=60");
  return applySeoResponse(request, env, new Response(html, { status: assetResponse.status, headers }), seo);
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

  if (pathname === "/api/maze-submissions/current") {
    if (method === "GET") return handleGetMazeSubmissionEdit(request, env);
    if (method === "POST") return handleSubmitMazeRevision(request, env);
    return methodNotAllowed(method, ["GET", "POST"]);
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

  const mazeRevisionFileMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/maze-revisions\/(\d+)\/files\/([^/]+)$/);
  if (mazeRevisionFileMatch) {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleGetMazeRevisionFile(
      request,
      env,
      decodeURIComponent(mazeRevisionFileMatch[1]),
      Number(mazeRevisionFileMatch[2]),
      decodeURIComponent(mazeRevisionFileMatch[3]),
    );
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

  if (pathname === "/api/admin/booking/calendar-sync") {
    if (method === "GET") return handleAdminGetCalendarSync(request, env);
    if (method === "PUT") return handleAdminUpdateCalendarSync(request, env);
    return methodNotAllowed(method, ["GET", "PUT"]);
  }

  if (pathname === "/api/admin/booking/calendar-sync/discover") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminDiscoverCalendars(request, env);
  }

  if (pathname === "/api/admin/booking/calendar-sync/run") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminRunCalendarSync(request, env);
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

  if (pathname === "/api/admin/booking/date-overrides") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminListDateOverrides(request, env);
  }

  if (pathname === "/api/admin/booking/schedule-periods") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleAdminListSchedulePeriods(request, env);
  }

  const schedulePeriodCategoryMatch = pathname.match(/^\/api\/admin\/booking\/schedule-periods\/([^/]+)$/);
  if (schedulePeriodCategoryMatch) {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAdminCreateSchedulePeriod(request, env, decodeURIComponent(schedulePeriodCategoryMatch[1]));
  }

  const schedulePeriodMatch = pathname.match(/^\/api\/admin\/booking\/schedule-periods\/([^/]+)\/([^/]+)$/);
  if (schedulePeriodMatch) {
    const category = decodeURIComponent(schedulePeriodMatch[1]);
    const periodId = decodeURIComponent(schedulePeriodMatch[2]);
    if (method === "PUT") return handleAdminPutSchedulePeriod(request, env, category, periodId);
    if (method === "DELETE") return handleAdminDeleteSchedulePeriod(request, env, category, periodId);
    return methodNotAllowed(method, ["PUT", "DELETE"]);
  }

  const dateOverrideMatch = pathname.match(/^\/api\/admin\/booking\/date-overrides\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (dateOverrideMatch) {
    const category = decodeURIComponent(dateOverrideMatch[1]);
    const localDate = dateOverrideMatch[2];
    if (method === "PUT") return handleAdminPutDateOverride(request, env, category, localDate);
    if (method === "DELETE") return handleAdminDeleteDateOverride(request, env, category, localDate);
    return methodNotAllowed(method, ["PUT", "DELETE"]);
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
    if (method === "GET") return handleAdminListAppointments(request, env);
    if (method === "POST") return handleAdminCreateAppointment(request, env);
    return methodNotAllowed(method, ["GET", "POST"]);
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

    if (shortBookingTokenFromPath(url.pathname)) {
      return servePublicAsset(request, env, "/booking/index.html");
    }

    if (/^\/o\/[A-Za-z0-9_-]{12}\/?$/.test(url.pathname)) {
      return privateLinkResponse(
        await servePublicAsset(request, env, "/tattoos/specials/adjusted-offer/index.html")
      );
    }

    const canonicalResponse = canonicalRedirect(request, env);
    const visibilityRequest = canonicalResponse?.headers.get("location")
      ? new Request(canonicalResponse.headers.get("location"), request)
      : request;
    const visibilityResponse = await pageVisibilityResponse(visibilityRequest, env);
    if (visibilityResponse) return visibilityResponse;
    if (canonicalResponse) return canonicalResponse;

    if (url.pathname === "/robots.txt") return handleRobots(request, env);
    if (url.pathname === "/sitemap.xml") return handleSitemap(request, env);

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

    if (url.pathname === "/api/admin/analytics/exclusion") {
      return handleAdminAnalyticsExclusion(request, env);
    }

    if (url.pathname === "/api/site/visibility") {
      return handlePublicSiteVisibility(request, env);
    }

    if (url.pathname === "/api/admin/site-visibility") {
      return handleAdminSiteVisibility(request, env);
    }

    if (url.pathname === "/api/admin/merch-workflow" || url.pathname.startsWith("/api/admin/merch-workflow/")) {
      return handleAdminMerchApi(request, env);
    }

    if (
      url.pathname === "/api/search" ||
      url.pathname === "/api/writings/entries" || url.pathname.startsWith("/api/writings/entries/") ||
      url.pathname === "/api/admin/writing-entries" || url.pathname.startsWith("/api/admin/writing-entries/") ||
      url.pathname === "/api/gallery" || url.pathname.startsWith("/api/gallery/") ||
      url.pathname === "/api/site/explore" ||
      url.pathname === "/api/site/navigation" ||
      url.pathname === "/api/current-projects" ||
      url.pathname === "/api/identities" || url.pathname.startsWith("/api/identities/") ||
      url.pathname.startsWith("/api/connections/") ||
      url.pathname.startsWith("/api/construct/media/") ||
      url.pathname.startsWith("/api/construct/entity-media/") ||
      url.pathname === "/api/flash" || url.pathname.startsWith("/api/flash/") ||
      url.pathname === "/api/legend" || url.pathname.startsWith("/api/legend/") ||
      url.pathname === "/api/visual-language" || url.pathname.startsWith("/api/visual-language/") ||
      url.pathname === "/api/art" || url.pathname.startsWith("/api/art/") ||
      url.pathname === "/api/archive" || url.pathname.startsWith("/api/archive/") ||
      url.pathname === "/api/archive-collections" || url.pathname.startsWith("/api/archive-collections/") ||
      url.pathname === "/api/appearances" || url.pathname.startsWith("/api/appearances/") ||
      /^\/api\/admin\/events\/[^/]+\/create-archive-record$/.test(url.pathname) ||
      url.pathname.startsWith("/api/admin/flash") ||
      url.pathname.startsWith("/api/admin/legend") ||
      url.pathname.startsWith("/api/admin/visual-language") ||
      url.pathname.startsWith("/api/admin/art") ||
      url.pathname.startsWith("/api/admin/merch") ||
      url.pathname.startsWith("/api/admin/archive") ||
      url.pathname.startsWith("/api/admin/people") ||
      url.pathname.startsWith("/api/admin/appearances") ||
      url.pathname.startsWith("/api/admin/current-projects") ||
      url.pathname.startsWith("/api/admin/identities") ||
      url.pathname.startsWith("/api/admin/organizations") ||
      url.pathname.startsWith("/api/admin/places") ||
      url.pathname.startsWith("/api/admin/nodes") ||
      url.pathname.startsWith("/api/admin/pathways") ||
      url.pathname.startsWith("/api/admin/media") ||
      url.pathname.startsWith("/api/admin/gallery") ||
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

    if (url.pathname === "/api/admin/calendar/submissions" || url.pathname.startsWith("/api/admin/calendar/submissions/")) {
      return handleCalendarSubmissionAdminApi(request, env);
    }

    if (url.pathname === "/api/admin/calendar" || url.pathname.startsWith("/api/admin/calendar/")) {
      return handleCalendarAdminApi(request, env);
    }

    if (url.pathname === "/api/calendar/submissions" || url.pathname.startsWith("/api/calendar/submissions/")) {
      return handleCalendarSubmissionPublicApi(request, env);
    }

    if (url.pathname === "/api/calendar/events" || url.pathname.startsWith("/api/calendar/events/") || url.pathname === "/api/calendar/plan") {
      return handleCalendarPublicApi(request, env);
    }

    if (/^\/calendars\/[a-z-]+\.ics$/.test(url.pathname)) {
      return handleCalendarFeed(request, env);
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
      url.pathname === "/api/maze-submissions/current" ||
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

    if (url.pathname === "/api/tattoo/adjusted-offers/context") {
      if (request.method !== "GET") return methodNotAllowed(request.method, ["GET"]);
      return handlePublicAdjustedOfferContext(request, env);
    }

    if (url.pathname === "/api/tattoo/adjusted-offers/respond") {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handlePublicAdjustedOfferResponse(request, env);
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

    const adjustedOfferCreateMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/submissions\/([^/]+)\/adjusted-offers$/);
    if (adjustedOfferCreateMatch) {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      return handleAdminCreateAdjustedOffer(request, env, decodeURIComponent(adjustedOfferCreateMatch[1]));
    }

    const adjustedOfferActionMatch = url.pathname.match(/^\/api\/admin\/tattoo\/specials\/submissions\/([^/]+)\/adjusted-offers\/([^/]+)\/(link|resend|withdraw|accept|decline)$/);
    if (adjustedOfferActionMatch) {
      if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
      const submissionId = decodeURIComponent(adjustedOfferActionMatch[1]);
      const offerId = decodeURIComponent(adjustedOfferActionMatch[2]);
      const action = adjustedOfferActionMatch[3];
      if (action === "link") return handleAdminGetAdjustedOfferLink(request, env, submissionId, offerId);
      if (action === "resend") return handleAdminResendAdjustedOffer(request, env, submissionId, offerId);
      if (action === "withdraw") return handleAdminWithdrawAdjustedOffer(request, env, submissionId, offerId);
      if (action === "accept") return handleAdminAcceptAdjustedOffer(request, env, submissionId, offerId);
      return handleAdminDeclineAdjustedOffer(request, env, submissionId, offerId);
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
    if (/^\/gallery\/(?:MED-\d{6,}|sets\/[a-z0-9-]+)$/i.test(normalizedPublicPath)) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizedPublicPath}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return servePublicAsset(request, env, "/gallery/index.html");
    }
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
    const requestedWritingSlug = writingPageSlug(url.pathname);
    if (requestedWritingSlug !== null) {
      if (requestedWritingSlug && !url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url); canonicalUrl.pathname += "/";
        return Response.redirect(canonicalUrl,308);
      }
      return serveWritingRecordPage(request,env,requestedWritingSlug);
    }
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

    const requestedCalendarEvent = calendarEventDetailReference(url.pathname);
    if (requestedCalendarEvent) return serveCalendarEventPage(request, env, requestedCalendarEvent);

    if (isFrontDoorPath(url.pathname)) {
      return servePublicAsset(request, env, "/index.html");
    }

    if (isHomePath(url.pathname)) {
      return servePublicAsset(request, env, "/home/index.html");
    }

    if (isEventDetailPagePath(url.pathname)) {
      return serveEventDetailPage(request, env, url.pathname);
    }

    if (appearanceDetailSlug(url.pathname)) {
      return servePublicAsset(request, env, "/about/exhibitions-appearances/detail/index.html");
    }

    const requestedIdentitySlug = identityProfileSlug(url.pathname);
    if (requestedIdentitySlug) {
      if (!url.pathname.endsWith("/")) {
        const canonicalUrl = new URL(request.url);
        canonicalUrl.pathname = `${normalizePath(url.pathname)}/`;
        canonicalUrl.search = "";
        return Response.redirect(canonicalUrl, 308);
      }
      return serveIdentityProfilePage(request, env, requestedIdentitySlug);
    }

    if (isFlashDetailPagePath(url.pathname)) {
      const slug = normalizePath(url.pathname).split("/").filter(Boolean)[2];
      return serveFlashRecordPage(request, env, slug);
    }

    const archiveAssetPath = archiveDynamicAssetPath(url.pathname);
    if (archiveAssetPath) {
      if (normalizePath(url.pathname).startsWith("/archive/records/")) {
        return serveArchiveRecordPage(request, env, url.pathname, archiveAssetPath);
      }
      return servePublicAsset(request, env, archiveAssetPath);
    }

    return servePublicAsset(request, env, assetPathForRequest(url.pathname));
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(retryPendingAdjustedOfferNotifications(env));
    ctx.waitUntil(reapExpiredAdjustedOffers(env));
    ctx.waitUntil(retryPendingAdminAppointmentNotifications(env));
    ctx.waitUntil(runIcloudCalendarSync(env, "scheduled"));
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
    ctx.waitUntil(runDueCalendarScout(env, controller.scheduledTime));
    ctx.waitUntil(purgeClosedCalendarSubmissions(env, new Date(controller.scheduledTime)));
    ctx.waitUntil(runVisualColorAnalysisPass(env));
  },
  async queue(batch, env) {
    await handleVisualColorQueue(batch, env);
  },
};
