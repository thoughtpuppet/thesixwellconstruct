import {
  addCartLines,
  badRequest,
  createCart,
  fetchCartById,
  fetchCatalog,
  fetchProductByHandle,
  json,
  readJsonBody,
  removeCartLines,
  serverError,
  updateCartLines,
} from "./functions/api/shop/_lib.js";
import {
  handleCreateSubmission,
  handleDeleteSubmission,
  handleGetSubmission,
  handleGetSubmissionFile,
  handleListSubmissions,
  handleUpdateSubmission,
} from "./functions/api/submissions/_lib.js";
import {
  handleAdminCreateAvailability,
  handleAdminCreateAppointmentMeeting,
  handleAdminCancelAppointment,
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
  handleSquareWebhook,
  handleStudioSquareWebhook,
} from "./functions/api/booking/_lib.js";
import {
  handleEventsApi,
  handleAdminEventsApi,
  handleEventsSquareWebhook,
  reapStalePendingTickets,
} from "./functions/api/events/_lib.js";
import {
  handleAdminResendNotification,
  retryPendingAdminAppointmentNotifications,
  sendDueAppointmentReminders,
  sendDueEventTicketReminders,
} from "./functions/api/notifications/_lib.js";
import { handlePortfolioApi } from "./functions/api/portfolio/_lib.js";
import { handleConstructApi } from "./functions/api/construct/_lib.js";
import { handleAdminCrmApi } from "./functions/api/crm/_lib.js";

const HIDDEN_PUBLIC_PATHS = [
  "/film",
  "/music",
  "/writings"
];

const HIDE_PUBLIC_PAGES_EXCEPT_HOME = false;
const PUBLIC_FRONT_DOOR_PATHS = new Set(["/", "/index", "/index/", "/index.html"]);
const PUBLIC_ENTRY_ROOM_ALIAS_PATHS = new Set(["/entry-room", "/entry-room/", "/entry-room/index.html"]);
const PUBLIC_HOME_PATHS = new Set(["/home", "/home/", "/home/index.html"]);
const PUBLIC_ERROR_PATHS = new Set(["/404", "/404.html"]);
const PUBLIC_ARCHIVE_PATHS = new Set([
  "/archive",
  "/archive/",
  "/archive/index.html",
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
  return "";
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

async function handleCatalog(env) {
  try {
    const products = await fetchCatalog(env);
    return json({ products });
  } catch (error) {
    return serverError("Unable to load Shopify catalog.", {
      detail: error.message,
    });
  }
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
    return handleCatalog(env);
  }

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

    if (
      url.pathname === "/api/search" ||
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

    if (url.pathname === "/api/admin/crm" || url.pathname.startsWith("/api/admin/crm/")) {
      return handleAdminCrmApi(request, env);
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

    if (url.pathname.startsWith("/api/admin/notifications/")) {
      return handleNotificationsApi(request, env);
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

    if (url.pathname === "/legend" || url.pathname.startsWith("/legend/")) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = url.pathname === "/legend" ? "/about/legend/" : `/about${url.pathname}`;
      return Response.redirect(redirectUrl, 308);
    }

    if (isFrontDoorPath(url.pathname)) {
      return env.ASSETS.fetch(assetRequest(request, "/index.html"));
    }

    if (isHomePath(url.pathname)) {
      return env.ASSETS.fetch(assetRequest(request, "/home/index.html"));
    }

    if (
      !isLocalOnlyPath(url.pathname) &&
      (isHiddenPublicPath(url.pathname) || isHiddenByHomeOnlyMode(url.pathname))
    ) {
      return redirectToNotFoundPage(request);
    }

    if (isEventDetailPagePath(url.pathname)) {
      return env.ASSETS.fetch(assetRequest(request, eventDetailAssetPath(url.pathname)));
    }

    if (isFlashDetailPagePath(url.pathname)) {
      return env.ASSETS.fetch(assetRequest(request, "/tattoos/flash/detail/index.html"));
    }

    const archiveAssetPath = archiveDynamicAssetPath(url.pathname);
    if (archiveAssetPath) {
      return env.ASSETS.fetch(assetRequest(request, archiveAssetPath));
    }

    return env.ASSETS.fetch(assetRequest(request, assetPathForRequest(url.pathname)));
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(retryPendingAdminAppointmentNotifications(env));
    ctx.waitUntil(sendDueAppointmentReminders(env));
    ctx.waitUntil(sendDueEventTicketReminders(env));
    ctx.waitUntil(reapStalePendingTickets(env));
    ctx.waitUntil(reapExpiredBookingHolds(env));
  },
};
