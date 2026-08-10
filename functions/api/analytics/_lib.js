import { failure, json, requireStudioAdmin } from "../_shared/construct.js";

const DATASET = "swc_site_analytics";
const EVENT_SCHEMA_VERSION = "1";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 32;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The account currently exposes a little over 26 weeks of Cloudflare RUM data.
// Stay below that boundary so initial backfill and 12-month views request only
// the history the source can actually return; D1 continues retaining 366 days.
const RUM_LIVE_DAYS = 180;
const ANALYTICS_EXCLUSION_COOKIE = "swc_analytics_excluded";
const ANALYTICS_EXCLUSION_MAX_AGE = 365 * 24 * 60 * 60;
const TATTOO_SPECIALS_PATH = "/tattoos/specials/";
const TATTOO_SPECIAL_ACTIVITY_LIMIT = 10001;
const TATTOO_SPECIAL_STAGES = [
  ["campaign_opened", "Campaign opened"],
  ["offer_viewed", "Offer viewed"],
  ["offer_selected", "Offer selected"],
  ["form_started", "Form started"],
  ["purchaser_completed", "Purchaser completed"],
  ["project_started", "Project started"],
  ["project_completed", "Project completed"],
  ["submit_attempted", "Submit attempted"],
  ["request_accepted", "Request accepted"],
];
const TATTOO_SPECIAL_ACTIONS = new Set([
  ...TATTOO_SPECIAL_STAGES.map(([action]) => action),
  "reference_added",
]);

const ALLOWED_EVENTS = new Set([
  "page_view", "page_exit", "section_view", "navigation", "outbound_link", "cta",
  "media_start", "media_progress", "media_complete", "search", "filter_change",
  "item_open", "form_start", "form_submit", "form_error", "form_complete",
  "interactive_start", "interactive_milestone", "interactive_complete", "node_open",
  "pathway_open",
]);

const EVENT_FIELDS = new Set([
  "name", "path", "previousPath", "targetPath", "targetHost", "action", "sectionId",
  "itemId", "referrerHost", "utmSource", "utmMedium", "utmCampaign", "utmContent",
  "contentGroup", "device", "resultBucket", "formId", "mediaId", "activeSeconds",
  "maxScroll", "progress", "count", "sequence", "viewportWidth",
]);

const RANGE_WINDOWS = {
  "1h": { durationMs: HOUR_MS, rolling: true },
  "24h": { durationMs: 24 * HOUR_MS, rolling: true },
  "36h": { durationMs: 36 * HOUR_MS, rolling: true },
  "48h": { durationMs: 48 * HOUR_MS, rolling: true },
  "5d": { durationMs: 5 * DAY_MS, rolling: true },
  "7d": { days: 7 },
  "30d": { days: 30 },
  "90d": { days: 90 },
  "12m": { days: 366 },
};
const VIEWS = new Set(["overview", "journeys", "acquisition", "performance", "tattoo-specials"]);
const DEVICES = new Set(["all", "desktop", "mobile", "tablet"]);

function clamp(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeString(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function safeDimension(value, max = 160) {
  return safeString(value, max)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ");
}

function safeSlug(value, max = 96) {
  return safeString(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function analyticsSqlDate(value) {
  return new Date(value).toISOString().slice(0, 19);
}

export function normalizeAnalyticsPath(value) {
  let pathname = "/";
  try { pathname = new URL(String(value || "/"), "https://analytics.invalid").pathname; } catch {}
  if (/^\/b\/[A-Za-z0-9_-]{12}\/?$/.test(pathname)) pathname = "/booking/";
  pathname = pathname.replace(/\/{2,}/g, "/");
  pathname = pathname.replace(/\/index\.html$/i, "/");
  if (pathname !== "/" && !/\.[a-z0-9]{1,8}$/i.test(pathname)) pathname = `${pathname.replace(/\/+$/, "")}/`;
  return pathname.slice(0, 300) || "/";
}

export function analyticsContentGroup(pathname) {
  const path = normalizeAnalyticsPath(pathname);
  if (["/", "/entry-room/"].includes(path)) return "entry";
  if (path === "/home/") return "home";
  const first = path.split("/").filter(Boolean)[0] || "home";
  return safeSlug(first, 48) || "other";
}

function safeHost(value) {
  if (!value) return "";
  try { return new URL(String(value), "https://analytics.invalid").hostname.toLowerCase().slice(0, 160); }
  catch { return safeSlug(value, 160); }
}

function safeSessionId(value) {
  const id = safeString(value, 96);
  return /^[a-zA-Z0-9_-]{12,96}$/.test(id) ? id : "";
}

function unknownKeys(value, allowed) {
  return Object.keys(value || {}).filter((key) => !allowed.has(key));
}

export function analyticsExcluded(request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").some((part) => {
    const [name, ...value] = part.trim().split("=");
    return name === ANALYTICS_EXCLUSION_COOKIE && value.join("=") === "1";
  });
}

function exclusionCookie(excluded) {
  const parts = [
    `${ANALYTICS_EXCLUSION_COOKIE}=${excluded ? "1" : ""}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${excluded ? ANALYTICS_EXCLUSION_MAX_AGE : 0}`,
  ];
  if (!excluded) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

export async function handleAdminAnalyticsExclusion(request, env) {
  const auth = requireStudioAdmin(request, env);
  if (auth) return auth;
  if (request.method === "GET") return json({ excluded: analyticsExcluded(request) });
  if (request.method !== "PUT") return failure("Method not allowed.", 405);
  let body;
  try { body = await request.json(); } catch { return failure("Expected JSON body.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Expected JSON body.", 400);
  const extras = unknownKeys(body, new Set(["excluded"]));
  if (extras.length) return failure(`Unknown exclusion field: ${extras[0]}.`, 400);
  if (typeof body.excluded !== "boolean") return failure("excluded must be true or false.", 400);
  return json({ excluded: body.excluded }, { headers: { "set-cookie": exclusionCookie(body.excluded) } });
}

export function sanitizeAnalyticsEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Invalid analytics event." };
  const extras = unknownKeys(value, EVENT_FIELDS);
  if (extras.length) return { error: `Unknown analytics field: ${extras[0]}.` };
  const name = safeSlug(value.name, 64);
  if (!ALLOWED_EVENTS.has(name)) return { error: "Unknown analytics event." };
  const path = normalizeAnalyticsPath(value.path);
  const device = safeSlug(value.device, 24);
  return {
    event: {
      name,
      path,
      previousPath: value.previousPath ? normalizeAnalyticsPath(value.previousPath) : "",
      targetPath: value.targetPath ? normalizeAnalyticsPath(value.targetPath) : "",
      targetHost: safeHost(value.targetHost),
      action: safeSlug(value.action, 96),
      sectionId: safeSlug(value.sectionId, 120),
      itemId: safeSlug(value.itemId, 160),
      referrerHost: safeHost(value.referrerHost),
      utmSource: safeSlug(value.utmSource, 80),
      utmMedium: safeSlug(value.utmMedium, 80),
      utmCampaign: safeSlug(value.utmCampaign, 120),
      utmContent: safeSlug(value.utmContent, 120),
      contentGroup: safeSlug(value.contentGroup, 48) || analyticsContentGroup(path),
      device: DEVICES.has(device) && device !== "all" ? device : "other",
      resultBucket: safeSlug(value.resultBucket, 48),
      formId: safeSlug(value.formId, 120),
      mediaId: safeSlug(value.mediaId, 160),
      activeSeconds: clamp(value.activeSeconds, 0, 24 * 60 * 60),
      maxScroll: clamp(value.maxScroll, 0, 100),
      progress: clamp(value.progress, 0, 100),
      count: clamp(value.count, 0, 100000),
      sequence: clamp(value.sequence, 0, 1000000),
      viewportWidth: clamp(value.viewportWidth, 0, 10000),
    },
  };
}

function sameOriginRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (origin) {
    try { if (new URL(origin).origin !== url.origin) return false; } catch { return false; }
  }
  return Boolean(origin) || fetchSite === "same-origin";
}

function analyticsPoint(event, sessionId, country) {
  return {
    indexes: [sessionId],
    blobs: [
      event.name, event.path, event.previousPath, event.targetPath || event.targetHost,
      event.contentGroup, event.action, event.sectionId, event.itemId, event.referrerHost,
      event.utmSource, event.utmMedium, event.utmCampaign, event.utmContent, event.device,
      country, event.resultBucket, event.formId, event.mediaId, EVENT_SCHEMA_VERSION, "",
    ],
    doubles: [
      event.activeSeconds, event.maxScroll, event.progress, event.count, event.sequence,
      event.viewportWidth,
    ],
  };
}

export async function handleAnalyticsEvents(request, env) {
  if (request.method !== "POST") return failure("Method not allowed.", 405);
  if (!sameOriginRequest(request)) return failure("Same-origin analytics requests only.", 403);
  if (analyticsExcluded(request)) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return failure("Analytics events require JSON.", 415);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return failure("Analytics payload is too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return failure("Analytics payload is too large.", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return failure("Invalid analytics JSON.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Invalid analytics payload.", 400);
  const payloadExtras = unknownKeys(body, new Set(["sessionId", "events"]));
  if (payloadExtras.length) return failure(`Unknown analytics payload field: ${payloadExtras[0]}.`, 400);
  const sessionId = safeSessionId(body.sessionId);
  if (!sessionId) return failure("Invalid analytics session.", 400);
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > MAX_EVENTS) {
    return failure(`Analytics payload must contain 1-${MAX_EVENTS} events.`, 400);
  }
  if (!env.SITE_ANALYTICS?.writeDataPoint) return failure("Site analytics is not configured.", 503);
  const country = safeSlug(request.cf?.country || "unknown", 8) || "unknown";
  for (const candidate of body.events) {
    const normalized = sanitizeAnalyticsEvent(candidate);
    if (normalized.error) return failure(normalized.error, 400);
    env.SITE_ANALYTICS.writeDataPoint(analyticsPoint(normalized.event, sessionId, country));
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function dateRange(range, endDate = new Date()) {
  const window = RANGE_WINDOWS[range] || RANGE_WINDOWS["30d"];
  if (window.rolling) {
    const end = new Date(endDate);
    const start = new Date(end.getTime() - window.durationMs);
    return {
      days: window.durationMs / DAY_MS, rolling: true, start, end,
      startIso: start.toISOString(), endIso: end.toISOString(),
    };
  }
  const days = window.days;
  const end = new Date(endDate);
  const endExclusive = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
  const start = new Date(endExclusive.getTime() - days * DAY_MS);
  return { days, rolling: false, start, end: endExclusive, startIso: start.toISOString(), endIso: endExclusive.toISOString() };
}

function rangeCoverage(range) {
  if (range.rolling) return { from: range.start.toISOString(), through: range.end.toISOString() };
  return { from: isoDate(range.start), through: isoDate(new Date(range.end.getTime() - DAY_MS)) };
}

function sourceState(ready, error = "", dataThrough = "") {
  return { state: ready ? "current" : "unavailable", ready, error, dataThrough, lastUpdated: ready ? new Date().toISOString() : "" };
}

function rumQueryWindow(range, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const availableFrom = new Date(today.getTime() - RUM_LIVE_DAYS * DAY_MS);
  if (range.end <= availableFrom) throw new Error("Cloudflare RUM history is outside the account retention window.");
  const start = range.start < availableFrom ? availableFrom : range.start;
  return {
    range: { ...range, start, startIso: start.toISOString() },
    partial: start > range.start,
    coverageFrom: isoDate(start),
  };
}

function readyRumState(data, dataThrough) {
  const state = sourceState(true, "", dataThrough);
  if (data?.sourcePartial) state.state = "partial";
  state.coverage = { from: data?.sourceCoverageFrom || "", through: dataThrough };
  if (data) {
    delete data.sourcePartial;
    delete data.sourceCoverageFrom;
  }
  return state;
}

function graphqlConfig(env) {
  const accountId = safeString(env.CLOUDFLARE_ACCOUNT_ID, 64);
  const siteTag = safeString(env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG, 160);
  const token = safeString(env.CLOUDFLARE_ANALYTICS_API_TOKEN, 512);
  let requestHost = "";
  try { requestHost = new URL(safeString(env.PUBLIC_SITE_URL, 300)).hostname.toLowerCase(); } catch {}
  const scope = requestHost ? { requestHost } : siteTag ? { siteTag } : {};
  return { accountId, token, scope, ready: Boolean(accountId && token && Object.keys(scope).length) };
}

async function cloudflareGraphQL(env, query, variables) {
  const config = graphqlConfig(env);
  if (!config.ready) throw new Error("Cloudflare Web Analytics credentials are not configured.");
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { ...variables, accountTag: config.accountId } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || payload.error || `Cloudflare GraphQL returned ${response.status}.`);
  }
  return payload.data?.viewer?.accounts?.[0] || {};
}

function sampleInterval(row) {
  return Math.max(1, Number(row?.avg?.sampleInterval || 1));
}

function reportedCount(row) {
  // Adaptive GraphQL datasets already return an extrapolated estimate in
  // `count`. sampleInterval describes the sampling applied to that estimate;
  // multiplying by it again inflates older Web Analytics data.
  return Math.round(Number(row?.count || 0));
}

function reportedVisits(row) {
  return Math.round(Number(row?.sum?.visits || 0));
}

function sumBy(rows, key, value = reportedCount) {
  const totals = new Map();
  for (const row of rows || []) {
    const name = safeDimension(key(row) || "Unknown", 300);
    totals.set(name, (totals.get(name) || 0) + Number(value(row) || 0));
  }
  return [...totals].map(([label, amount]) => ({ label, value: amount })).sort((a, b) => b.value - a.value);
}

function timeValue(value) {
  const number = Number(value || 0);
  if (number < 0) return 0;
  return number > 10000 ? number / 1000 : number;
}

function scoreValue(value) {
  const number = Number(value || 0);
  return number < 0 ? 0 : number;
}

function rumFilter(range, filters, scope) {
  return {
    datetime_geq: range.startIso,
    datetime_lt: range.endIso,
    ...scope,
    ...(filters.device !== "all" ? { deviceType: filters.device } : {}),
  };
}

const OVERVIEW_QUERY = `query SiteOverview($accountTag: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!, $vitalsFilter: AccountRumWebVitalsEventsAdaptiveGroupsFilter_InputObject!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    pageloads: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10000, orderBy: [date_ASC]) {
      count avg { sampleInterval } sum { visits } dimensions { date requestPath }
    }
    vitals: rumWebVitalsEventsAdaptiveGroups(filter: $vitalsFilter, limit: 1, orderBy: [count_DESC]) {
      count quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 }
    }
  } }
}`;

const ACQUISITION_QUERY = `query SiteAcquisition($accountTag: String!, $filter: AccountRumPerformanceEventsAdaptiveGroupsFilter_InputObject!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    daily: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 10000, orderBy: [date_ASC]) { count avg { sampleInterval } dimensions { date requestPath } }
    referrers: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [count_DESC]) { count avg { sampleInterval } dimensions { refererHost requestPath } }
    countries: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [count_DESC]) { count avg { sampleInterval } dimensions { countryName requestPath } }
    devices: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [count_DESC]) { count avg { sampleInterval } dimensions { deviceType requestPath } }
    browsers: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [count_DESC]) { count avg { sampleInterval } dimensions { userAgentBrowser requestPath } }
    operatingSystems: rumPerformanceEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [count_DESC]) { count avg { sampleInterval } dimensions { userAgentOS requestPath } }
  } }
}`;

const PERFORMANCE_QUERY = `query SitePerformance($accountTag: String!, $vitalsFilter: AccountRumWebVitalsEventsAdaptiveGroupsFilter_InputObject!, $performanceFilter: AccountRumPerformanceEventsAdaptiveGroupsFilter_InputObject!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    vitalsDaily: rumWebVitalsEventsAdaptiveGroups(filter: $vitalsFilter, limit: 1000, orderBy: [date_ASC]) {
      count dimensions { date } quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 firstContentfulPaintP75 }
    }
    vitalsByPath: rumWebVitalsEventsAdaptiveGroups(filter: $vitalsFilter, limit: 100, orderBy: [count_DESC]) {
      count dimensions { requestPath } quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 firstContentfulPaintP75 }
    }
    timingsByPath: rumPerformanceEventsAdaptiveGroups(filter: $performanceFilter, limit: 100, orderBy: [count_DESC]) {
      count dimensions { requestPath } quantiles { firstContentfulPaintP75 pageLoadTimeP75 }
    }
  } }
}`;

async function fetchRumOverview(env, range, filters) {
  const window = rumQueryWindow(range);
  const scope = graphqlConfig(env).scope;
  const account = await cloudflareGraphQL(env, OVERVIEW_QUERY, {
    filter: rumFilter(window.range, filters, scope),
    vitalsFilter: rumFilter(window.range, filters, scope),
  });
  const allRows = account.pageloads || [];
  const rows = filters.group ? allRows.filter((row) => analyticsContentGroup(row.dimensions?.requestPath) === filters.group) : allRows;
  const byDate = new Map();
  for (const row of rows) {
    const date = row.dimensions?.date || "";
    const interval = sampleInterval(row);
    const point = byDate.get(date) || { date, pageViews: 0, visits: 0, sampled: false, maxSampleInterval: 1 };
    point.pageViews += reportedCount(row);
    point.visits += reportedVisits(row);
    point.sampled ||= interval > 1;
    point.maxSampleInterval = Math.max(point.maxSampleInterval, interval);
    byDate.set(date, point);
  }
  const paths = sumBy(rows, (row) => normalizeAnalyticsPath(row.dimensions?.requestPath));
  const pageViews = [...byDate.values()].reduce((sum, row) => sum + row.pageViews, 0);
  const visits = [...byDate.values()].reduce((sum, row) => sum + row.visits, 0);
  const vitals = filters.group ? {} : account.vitals?.[0]?.quantiles || {};
  return {
    pageViews, visits, series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    sampling: {
      sampled: rows.some((row) => sampleInterval(row) > 1),
      maxInterval: rows.reduce((max, row) => Math.max(max, sampleInterval(row)), 1),
    },
    paths: paths.slice(0, 25),
    contentGroups: sumBy(paths, (row) => analyticsContentGroup(row.label), (row) => row.value).slice(0, 12),
    sourcePartial: window.partial,
    sourceCoverageFrom: window.coverageFrom,
    vitals: {
      lcp: timeValue(vitals.largestContentfulPaintP75),
      inp: timeValue(vitals.interactionToNextPaintP75),
      cls: scoreValue(vitals.cumulativeLayoutShiftP75),
    },
  };
}

async function fetchRumAcquisition(env, range, filters) {
  const window = rumQueryWindow(range);
  const scope = graphqlConfig(env).scope;
  const account = await cloudflareGraphQL(env, ACQUISITION_QUERY, { filter: rumFilter(window.range, filters, scope) });
  const selected = (rows) => filters.group ? (rows || []).filter((row) => analyticsContentGroup(row.dimensions?.requestPath) === filters.group) : rows || [];
  const list = (key, field) => sumBy(selected(account[key]), (row) => row.dimensions?.[field]).slice(0, 25);
  return {
    series: sumBy(selected(account.daily), (row) => row.dimensions?.date).map((row) => ({ date: row.label, views: row.value })).sort((a, b) => a.date.localeCompare(b.date)),
    referrers: list("referrers", "refererHost"), countries: list("countries", "countryName"),
    devices: list("devices", "deviceType"), browsers: list("browsers", "userAgentBrowser"),
    operatingSystems: list("operatingSystems", "userAgentOS"),
    sourcePartial: window.partial, sourceCoverageFrom: window.coverageFrom,
  };
}

async function fetchRumPerformance(env, range, filters) {
  const window = rumQueryWindow(range);
  const scope = graphqlConfig(env).scope;
  const filter = rumFilter(window.range, filters, scope);
  const account = await cloudflareGraphQL(env, PERFORMANCE_QUERY, { vitalsFilter: filter, performanceFilter: filter });
  const timingByPath = new Map((account.timingsByPath || []).map((row) => [normalizeAnalyticsPath(row.dimensions?.requestPath), row.quantiles || {}]));
  const paths = (account.vitalsByPath || []).map((row) => {
    const path = normalizeAnalyticsPath(row.dimensions?.requestPath);
    const q = row.quantiles || {};
    const timing = timingByPath.get(path) || {};
    return {
      path, samples: Number(row.count || 0), lcp: timeValue(q.largestContentfulPaintP75),
      inp: timeValue(q.interactionToNextPaintP75), cls: scoreValue(q.cumulativeLayoutShiftP75),
      fcp: timeValue(q.firstContentfulPaintP75 || timing.firstContentfulPaintP75),
      pageLoad: timeValue(timing.pageLoadTimeP75),
    };
  }).filter((row) => !filters.group || analyticsContentGroup(row.path) === filters.group)
    .sort((a, b) => b.lcp - a.lcp).slice(0, 25);
  const series = (filters.group ? [] : account.vitalsDaily || []).map((row) => {
    const q = row.quantiles || {};
    return { date: row.dimensions?.date || "", lcp: timeValue(q.largestContentfulPaintP75), inp: timeValue(q.interactionToNextPaintP75), cls: scoreValue(q.cumulativeLayoutShiftP75), fcp: timeValue(q.firstContentfulPaintP75) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const summaryPath = [...paths].sort((a, b) => Number(b.samples || 0) - Number(a.samples || 0))[0] || {};
  return {
    summary: { lcp: summaryPath.lcp || 0, inp: summaryPath.inp || 0, cls: summaryPath.cls || 0, fcp: summaryPath.fcp || 0, pageLoad: summaryPath.pageLoad || 0 },
    series, paths, elements: [], sourcePartial: window.partial, sourceCoverageFrom: window.coverageFrom,
  };
}

function analyticsSqlConfig(env) {
  const accountId = safeString(env.CLOUDFLARE_ACCOUNT_ID, 64);
  const token = safeString(env.CLOUDFLARE_ANALYTICS_API_TOKEN, 512);
  return { accountId, token, ready: Boolean(accountId && token) };
}

async function analyticsSql(env, query) {
  const config = analyticsSqlConfig(env);
  if (!config.ready) throw new Error("Analytics Engine read credentials are not configured.");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/analytics_engine/sql`, {
    method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "text/plain; charset=utf-8" }, body: `${query}\nFORMAT JSON`,
  });
  const raw = await response.text();
  let payload = {};
  try { payload = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const detail = payload.error || payload.errors?.[0]?.message || safeString(raw, 1000);
    throw new Error(detail || `Analytics Engine returned ${response.status}.`);
  }
  return Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
}

function customWhere(range, filters, eventNames = []) {
  const conditions = [
    `timestamp >= toDateTime(${sqlString(analyticsSqlDate(range.startIso))})`,
    `timestamp < toDateTime(${sqlString(analyticsSqlDate(range.endIso))})`,
  ];
  if (eventNames.length === 1) conditions.push(`blob1 = ${sqlString(eventNames[0])}`);
  else if (eventNames.length) conditions.push(`blob1 IN (${eventNames.map(sqlString).join(",")})`);
  if (filters.device !== "all") conditions.push(`blob14 = ${sqlString(filters.device)}`);
  if (filters.group) conditions.push(`blob5 = ${sqlString(filters.group)}`);
  return conditions.join(" AND ");
}

function queryList(rows, label, value = "value", secondary = "") {
  return (rows || []).map((row) => ({
    label: safeDimension(row[label] || "Unknown", 300), value: Number(row[value] || 0),
    ...(secondary ? { secondary: safeDimension(row[secondary] || "", 300) } : {}),
  })).sort((a, b) => b.value - a.value);
}

async function loadTattooSpecialCatalog(env) {
  if (!env.SUBMISSIONS_DB) return { campaigns: [], offers: [] };
  try {
    const [campaignRows, offerRows] = await Promise.all([
      d1All(env.SUBMISSIONS_DB, `SELECT id,title,slug,is_public,archived_at
        FROM tattoo_special_campaigns ORDER BY is_public DESC,sort_order,sales_opens_at DESC,created_at DESC`),
      d1All(env.SUBMISSIONS_DB, `SELECT id,campaign_id,title,slug,archived_at
        FROM tattoo_special_offers ORDER BY sort_order,created_at`),
    ]);
    return {
      campaigns: campaignRows.map((row) => ({
        id: safeSlug(row.id, 120), title: safeDimension(row.title || row.slug || row.id, 200),
        isPublic: Boolean(row.is_public), archived: Boolean(row.archived_at),
      })).filter((row) => row.id),
      offers: offerRows.map((row) => ({
        id: safeSlug(row.id, 160), campaignId: safeSlug(row.campaign_id, 120),
        title: safeDimension(row.title || row.slug || row.id, 200), archived: Boolean(row.archived_at),
      })).filter((row) => row.id),
    };
  } catch {
    return { campaigns: [], offers: [] };
  }
}

function tattooCatalogMaps(catalog = {}) {
  return {
    campaigns: new Map((catalog.campaigns || []).map((item) => [item.id, item])),
    offers: new Map((catalog.offers || []).map((item) => [item.id, item])),
  };
}

function stageIndex(action) {
  return TATTOO_SPECIAL_STAGES.findIndex(([name]) => name === action);
}

function percent(value, total) {
  return total > 0 ? Math.round((Number(value || 0) / total) * 1000) / 10 : 0;
}

export function aggregateTattooSpecialInterest(activityRows = [], page = {}, catalog = {}, truncated = false) {
  const maps = tattooCatalogMaps(catalog);
  const stageSessions = new Map(TATTOO_SPECIAL_STAGES.map(([action]) => [action, new Set()]));
  const stageEvents = new Map(TATTOO_SPECIAL_STAGES.map(([action]) => [action, 0]));
  const deepestBySession = new Map();
  const campaignState = new Map();
  const offerState = new Map();
  const selections = new Map();
  const comparedSessions = new Set();
  const pathCounts = new Map();

  function campaignFor(id) {
    const campaignId = safeSlug(id, 120);
    if (!campaignId) return null;
    if (!campaignState.has(campaignId)) {
      campaignState.set(campaignId, {
        id: campaignId,
        sessions: new Map(TATTOO_SPECIAL_STAGES.map(([action]) => [action, new Set()])),
        compared: new Set(), references: new Set(),
      });
    }
    return campaignState.get(campaignId);
  }

  function offerFor(id, campaignId = "") {
    const offerId = safeSlug(id, 160);
    if (!offerId) return null;
    if (!offerState.has(offerId)) {
      offerState.set(offerId, {
        id: offerId, campaignId: safeSlug(campaignId, 120),
        sessions: new Map(TATTOO_SPECIAL_STAGES.map(([action]) => [action, new Set()])),
        events: new Map(), compared: new Set(),
      });
    }
    const state = offerState.get(offerId);
    if (!state.campaignId && campaignId) state.campaignId = safeSlug(campaignId, 120);
    return state;
  }

  for (const row of activityRows || []) {
    const sessionId = safeSessionId(row.session_id);
    const action = safeSlug(row.action_name, 96);
    const campaignId = safeSlug(row.campaign_id, 120);
    const offerId = safeSlug(row.offer_id, 160);
    if (!sessionId || !TATTOO_SPECIAL_ACTIONS.has(action)) continue;
    const events = Math.max(0, Number(row.event_count || 0));
    const index = stageIndex(action);
    const campaign = campaignFor(campaignId);
    const offer = offerFor(offerId, campaignId);
    if (index >= 0) {
      stageSessions.get(action).add(sessionId);
      stageEvents.set(action, (stageEvents.get(action) || 0) + events);
      if (campaign) campaign.sessions.get(action).add(sessionId);
      if (offer) {
        offer.sessions.get(action).add(sessionId);
        offer.events.set(action, (offer.events.get(action) || 0) + events);
      }
      const deepest = deepestBySession.get(sessionId);
      if (!deepest || index > deepest.index) deepestBySession.set(sessionId, { index, action });
    }
    if (action === "offer_selected" && campaign && offer) {
      const key = `${sessionId}\u0000${campaignId}`;
      if (!selections.has(key)) selections.set(key, { sessionId, campaignId, offers: new Map() });
      const selected = selections.get(key).offers.get(offerId) || { offerId, sequence: Number(row.first_sequence || 0), clicks: 0 };
      selected.sequence = Math.min(selected.sequence || Number.MAX_SAFE_INTEGER, Number(row.first_sequence || 0) || Number.MAX_SAFE_INTEGER);
      selected.clicks += events;
      selections.get(key).offers.set(offerId, selected);
    }
    if (action === "reference_added" && campaign) campaign.references.add(sessionId);
  }

  for (const selection of selections.values()) {
    const ordered = [...selection.offers.values()].sort((a, b) => a.sequence - b.sequence || a.offerId.localeCompare(b.offerId));
    if (ordered.length < 2) continue;
    comparedSessions.add(selection.sessionId);
    campaignFor(selection.campaignId)?.compared.add(selection.sessionId);
    for (const item of ordered) offerFor(item.offerId, selection.campaignId)?.compared.add(selection.sessionId);
    const offerIds = ordered.map((item) => item.offerId);
    const key = `${selection.campaignId}\u0000${offerIds.join(">")}`;
    const current = pathCounts.get(key) || { campaignId: selection.campaignId, offerIds, sessions: 0 };
    current.sessions += 1;
    pathCounts.set(key, current);
  }

  for (const campaign of catalog.campaigns || []) campaignFor(campaign.id);
  for (const offer of catalog.offers || []) offerFor(offer.id, offer.campaignId);

  const stages = TATTOO_SPECIAL_STAGES.map(([action, label], index) => {
    const sessions = stageSessions.get(action)?.size || 0;
    const previous = index ? stageSessions.get(TATTOO_SPECIAL_STAGES[index - 1][0])?.size || 0 : sessions;
    return { action, label, sessions, events: stageEvents.get(action) || 0, fromPreviousPercent: index ? percent(sessions, previous) : 100 };
  });
  const deepestCounts = new Map(TATTOO_SPECIAL_STAGES.map(([action]) => [action, 0]));
  for (const item of deepestBySession.values()) deepestCounts.set(item.action, (deepestCounts.get(item.action) || 0) + 1);
  const deepest = TATTOO_SPECIAL_STAGES.map(([action, label]) => ({ action, label, sessions: deepestCounts.get(action) || 0 }));
  const campaigns = [...campaignState.values()].map((state) => {
    const details = maps.campaigns.get(state.id) || {};
    return {
      id: state.id, title: details.title || state.id, isPublic: Boolean(details.isPublic), archived: Boolean(details.archived),
      visitors: state.sessions.get("campaign_opened")?.size || 0,
      interestedSessions: state.sessions.get("offer_selected")?.size || 0,
      formStarts: state.sessions.get("form_started")?.size || 0,
      acceptedRequests: state.sessions.get("request_accepted")?.size || 0,
      comparedSessions: state.compared.size, referenceAddedSessions: state.references.size,
    };
  }).sort((a, b) => Number(b.isPublic) - Number(a.isPublic) || b.visitors - a.visitors || a.title.localeCompare(b.title));
  const offers = [...offerState.values()].map((state) => {
    const details = maps.offers.get(state.id) || {};
    const viewedSessions = state.sessions.get("offer_viewed")?.size || 0;
    const selectingSessions = state.sessions.get("offer_selected")?.size || 0;
    return {
      id: state.id, campaignId: state.campaignId || details.campaignId || "", title: details.title || state.id,
      viewedSessions, selectionClicks: state.events.get("offer_selected") || 0, selectingSessions,
      formStarts: state.sessions.get("form_started")?.size || 0,
      acceptedRequests: state.sessions.get("request_accepted")?.size || 0,
      comparedSessions: state.compared.size, selectionRatePercent: percent(selectingSessions, viewedSessions),
    };
  }).sort((a, b) => b.selectingSessions - a.selectingSessions || b.viewedSessions - a.viewedSessions || a.title.localeCompare(b.title));
  const paths = [...pathCounts.values()].map((item) => ({
    ...item,
    label: item.offerIds.map((id) => maps.offers.get(id)?.title || id).join(" → "),
  })).sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
  const stageBreakdown = [];
  const deepestBreakdown = [];
  for (const campaign of campaignState.values()) {
    const campaignDeepest = new Map();
    for (const [action] of TATTOO_SPECIAL_STAGES) {
      stageBreakdown.push({ campaignId: campaign.id, offerId: "", action, sessions: campaign.sessions.get(action)?.size || 0 });
      for (const sessionId of campaign.sessions.get(action) || []) {
        const index = stageIndex(action);
        if (!campaignDeepest.has(sessionId) || index > campaignDeepest.get(sessionId).index) campaignDeepest.set(sessionId, { action, index });
      }
    }
    for (const [action] of TATTOO_SPECIAL_STAGES) {
      deepestBreakdown.push({ campaignId: campaign.id, action, sessions: [...campaignDeepest.values()].filter((item) => item.action === action).length });
    }
  }

  return {
    pageEntries: Number(page.sessions || 0), pageViews: Number(page.page_views || 0),
    campaignVisitors: stageSessions.get("campaign_opened")?.size || 0,
    interestedSessions: stageSessions.get("offer_selected")?.size || 0,
    formStarts: stageSessions.get("form_started")?.size || 0,
    acceptedRequests: stageSessions.get("request_accepted")?.size || 0,
    comparedSessions: comparedSessions.size,
    referenceAddedSessions: new Set((activityRows || []).filter((row) => safeSlug(row.action_name, 96) === "reference_added").map((row) => safeSessionId(row.session_id)).filter(Boolean)).size,
    avgActiveSeconds: Number(page.avg_active_seconds || 0), avgScroll: Number(page.avg_scroll || 0), recordedExits: Number(page.recorded_exits || 0),
    stages, deepest, campaigns, offers, paths, stageBreakdown, deepestBreakdown, truncated: Boolean(truncated),
  };
}

async function fetchCustomTattooSpecials(env, range, filters, catalog = null) {
  const base = customWhere(range, { device: filters.device || "all", group: "" }, ["interactive_start", "interactive_milestone", "interactive_complete"]);
  const campaignCondition = filters.campaign ? ` AND blob7 = ${sqlString(filters.campaign)}` : "";
  const actionList = [...TATTOO_SPECIAL_ACTIONS].map(sqlString).join(",");
  const pageWhere = `${customWhere(range, { device: filters.device || "all", group: "" }, ["page_view"])} AND blob2 = ${sqlString(TATTOO_SPECIALS_PATH)}`;
  const exitWhere = `${customWhere(range, { device: filters.device || "all", group: "" }, ["page_exit"])} AND blob2 = ${sqlString(TATTOO_SPECIALS_PATH)}`;
  const [activity, pageRows, engagementRows, loadedCatalog] = await Promise.all([
    analyticsSql(env, `SELECT index1 session_id,blob6 action_name,blob7 campaign_id,blob8 offer_id,min(double5) first_sequence,sum(_sample_interval) event_count
      FROM ${DATASET} WHERE ${base} AND blob2 = ${sqlString(TATTOO_SPECIALS_PATH)} AND blob6 IN (${actionList})${campaignCondition}
      GROUP BY session_id,action_name,campaign_id,offer_id ORDER BY session_id,first_sequence LIMIT ${TATTOO_SPECIAL_ACTIVITY_LIMIT}`),
    analyticsSql(env, `SELECT count(DISTINCT index1) sessions,sum(_sample_interval) page_views FROM ${DATASET} WHERE ${pageWhere}`),
    analyticsSql(env, `SELECT sum(_sample_interval * double1) / sum(_sample_interval) avg_active_seconds,
      sum(_sample_interval * double2) / sum(_sample_interval) avg_scroll,sum(_sample_interval) recorded_exits
      FROM ${DATASET} WHERE ${exitWhere}`),
    catalog ? Promise.resolve(catalog) : loadTattooSpecialCatalog(env),
  ]);
  const truncated = activity.length >= TATTOO_SPECIAL_ACTIVITY_LIMIT;
  const selectedCatalog = filters.campaign ? {
    campaigns: loadedCatalog.campaigns.filter((item) => item.id === filters.campaign),
    offers: loadedCatalog.offers.filter((item) => item.campaignId === filters.campaign),
  } : loadedCatalog;
  return aggregateTattooSpecialInterest(activity.slice(0, TATTOO_SPECIAL_ACTIVITY_LIMIT - 1), { ...(pageRows[0] || {}), ...(engagementRows[0] || {}) }, selectedCatalog, truncated);
}

async function fetchCustomOverview(env, range, filters) {
  const [sessions, engagement, daily, groups, pages, hours, pageHours] = await Promise.all([
    analyticsSql(env, `SELECT count(DISTINCT index1) sessions FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])}`),
    analyticsSql(env, `SELECT count(DISTINCT index1) engaged_sessions, sum(_sample_interval * double1) / sum(_sample_interval) avg_active_seconds FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_exit"])} AND double1 >= 10`),
    analyticsSql(env, `SELECT formatDateTime(timestamp, '%Y-%m-%d', 'Etc/UTC') date, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} GROUP BY date ORDER BY date`),
    analyticsSql(env, `SELECT blob5 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} GROUP BY label ORDER BY value DESC LIMIT 20`),
    analyticsSql(env, `SELECT blob2 path, sum(_sample_interval) page_views, count(DISTINCT index1) sessions FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} GROUP BY path ORDER BY page_views DESC LIMIT 30`),
    analyticsSql(env, `SELECT formatDateTime(timestamp, '%H', 'America/New_York') hour_of_day, sum(_sample_interval) page_views, count(DISTINCT index1) sessions FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} GROUP BY hour_of_day ORDER BY page_views DESC`),
    analyticsSql(env, `SELECT formatDateTime(timestamp, '%H', 'America/New_York') hour_of_day, blob2 path, sum(_sample_interval) page_views, count(DISTINCT index1) sessions FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} GROUP BY hour_of_day,path ORDER BY page_views DESC LIMIT 50`),
  ]);
  return {
    sessions: Number(sessions[0]?.sessions || 0), engagedSessions: Number(engagement[0]?.engaged_sessions || 0),
    avgActiveSeconds: Number(engagement[0]?.avg_active_seconds || 0),
    series: (daily || []).map((row) => ({ date: row.date, views: Number(row.value || 0) })),
    contentGroups: queryList(groups, "label").slice(0, 12),
    pageActivity: (pages || []).map((row) => ({ path: normalizeAnalyticsPath(row.path), pageViews: Number(row.page_views || 0), sessions: Number(row.sessions || 0) })),
    activityByHour: (hours || []).map((row) => ({ hour: Number(row.hour_of_day), pageViews: Number(row.page_views || 0), sessions: Number(row.sessions || 0) })),
    activityByPageHour: (pageHours || []).map((row) => ({ hour: Number(row.hour_of_day), path: normalizeAnalyticsPath(row.path), pageViews: Number(row.page_views || 0), sessions: Number(row.sessions || 0) })),
  };
}

async function fetchCustomJourneys(env, range, filters) {
  const [entries, transitions, exits, sections, milestones, engagement] = await Promise.all([
    analyticsSql(env, `SELECT blob2 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} AND blob3 = '' GROUP BY label ORDER BY value DESC LIMIT 30`),
    analyticsSql(env, `SELECT blob3 source, blob2 destination, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} AND blob3 != '' GROUP BY source,destination ORDER BY value DESC LIMIT 50`),
    analyticsSql(env, `SELECT blob2 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_exit"])} GROUP BY label ORDER BY value DESC LIMIT 30`),
    analyticsSql(env, `SELECT blob7 label, blob2 path, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["section_view"])} GROUP BY label,path ORDER BY value DESC LIMIT 50`),
    analyticsSql(env, `SELECT blob5 group_name, blob6 action_name, blob8 item_id, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["interactive_start", "interactive_milestone", "interactive_complete", "node_open", "pathway_open"])} GROUP BY group_name,action_name,item_id ORDER BY value DESC LIMIT 60`),
    analyticsSql(env, `SELECT blob2 path, sum(_sample_interval * double1) / sum(_sample_interval) avg_active_seconds, sum(_sample_interval * double2) / sum(_sample_interval) avg_scroll, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_exit"])} GROUP BY path ORDER BY value DESC LIMIT 30`),
  ]);
  return {
    entries: queryList(entries, "label"),
    transitions: (transitions || []).map((row) => ({ source: normalizeAnalyticsPath(row.source), destination: normalizeAnalyticsPath(row.destination), value: Number(row.value || 0) })),
    exits: queryList(exits, "label"),
    sections: (sections || []).map((row) => ({ label: safeDimension(row.label), path: normalizeAnalyticsPath(row.path), value: Number(row.value || 0) })),
    milestones: (milestones || []).map((row) => ({ group: safeDimension(row.group_name), action: safeDimension(row.action_name), item: safeDimension(row.item_id), value: Number(row.value || 0) })),
    engagement: (engagement || []).map((row) => ({ path: normalizeAnalyticsPath(row.path), activeSeconds: Number(row.avg_active_seconds || 0), scroll: Number(row.avg_scroll || 0), value: Number(row.value || 0) })),
  };
}

async function fetchCustomAcquisition(env, range, filters) {
  const [sources, media, campaigns] = await Promise.all([
    analyticsSql(env, `SELECT blob10 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} AND blob10 != '' GROUP BY label ORDER BY value DESC LIMIT 30`),
    analyticsSql(env, `SELECT blob11 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} AND blob11 != '' GROUP BY label ORDER BY value DESC LIMIT 30`),
    analyticsSql(env, `SELECT blob12 label, sum(_sample_interval) value FROM ${DATASET} WHERE ${customWhere(range, filters, ["page_view"])} AND blob12 != '' GROUP BY label ORDER BY value DESC LIMIT 30`),
  ]);
  return { utmSources: queryList(sources, "label"), utmMedia: queryList(media, "label"), campaigns: queryList(campaigns, "label") };
}

async function d1All(database, sql, bindings = []) {
  const result = await database.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

async function loadRollups(env, range, view) {
  if (range.rolling) return [];
  if (!env.SUBMISSIONS_DB) return [];
  try {
    return await d1All(env.SUBMISSIONS_DB, `SELECT day,source,metric,dimension_a,dimension_b,value,sample_count,updated_at
      FROM site_analytics_daily WHERE day >= ? AND day < ? AND view = ? ORDER BY day`, [isoDate(range.start), isoDate(range.end), view]);
  } catch { return []; }
}

function rollupList(rows, source, metric) {
  const totals = new Map();
  for (const row of rows.filter((item) => item.source === source && item.metric === metric)) {
    const key = `${row.dimension_a || ""}\u0000${row.dimension_b || ""}`;
    const current = totals.get(key) || { label: row.dimension_a || "Unknown", secondary: row.dimension_b || "", value: 0 };
    current.value += Number(row.value || 0);
    totals.set(key, current);
  }
  return [...totals.values()].sort((a, b) => b.value - a.value);
}

function applyRollupFallback(view, payload, rows, filters = {}) {
  if (!rows.length) return payload;
  const total = (source, metric) => rows
    .filter((row) => row.source === source && row.metric === metric)
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  const metricRows = (source, metric) => rows.filter((row) => row.source === source && row.metric === metric);
  const sourceThrough = (source) => rows.filter((row) => row.source === source).map((row) => row.day).sort().at(-1) || "";
  for (const source of ["rum", "custom"]) {
    if (rows.some((row) => row.source === source) && !payload.sources[source]?.ready) {
      const lastUpdated = rows.filter((row) => row.source === source).map((row) => row.updated_at || "").sort().at(-1) || "";
      payload.sources[source] = { ...(payload.sources[source] || {}), state: "stale", ready: false, dataThrough: sourceThrough(source), lastUpdated };
    }
  }
  if (view === "overview") {
    if (!payload.sources.rum?.ready && rows.some((row) => row.source === "rum")) {
      payload.rum = { pageViews: total("rum", "page_views"), visits: total("rum", "visits"), series: [], paths: rollupList(rows, "rum", "path_views"), contentGroups: rollupList(rows, "rum", "content_group"), vitals: {} };
      const daily = new Map();
      for (const row of rows.filter((item) => item.source === "rum" && ["page_views", "visits"].includes(item.metric))) {
        const point = daily.get(row.day) || { date: row.day, pageViews: 0, visits: 0, rollup: true };
        point[row.metric === "page_views" ? "pageViews" : "visits"] = Number(row.value || 0);
        daily.set(row.day, point);
      }
      payload.rum.series = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
      for (const metric of ["lcp", "inp", "cls"]) {
        const values = metricRows("rum", `vital_${metric}`);
        if (values.length) payload.rum.vitals[metric] = Number(values.at(-1).value || 0);
      }
    }
    if (!payload.sources.custom?.ready && rows.some((row) => row.source === "custom")) {
      const activeRows = metricRows("custom", "avg_active_seconds");
      payload.custom = {
        sessions: total("custom", "sessions"), engagedSessions: total("custom", "engaged_sessions"),
        avgActiveSeconds: activeRows.length ? activeRows.reduce((sum, row) => sum + Number(row.value || 0), 0) / activeRows.length : null,
        contentGroups: rollupList(rows, "custom", "content_group"), series: [],
      };
    }
  } else if (view === "journeys" && !payload.sources.custom?.ready) {
    const engagement = new Map();
    for (const metric of ["engagement_active", "engagement_scroll", "engagement_views"]) {
      for (const row of metricRows("custom", metric)) {
        const item = engagement.get(row.dimension_a) || { path: row.dimension_a };
        item[metric === "engagement_active" ? "activeSeconds" : metric === "engagement_scroll" ? "scroll" : "value"] = Number(row.value || 0);
        engagement.set(row.dimension_a, item);
      }
    }
    payload.custom = {
      entries: rollupList(rows, "custom", "entry"), exits: rollupList(rows, "custom", "exit"),
      transitions: rollupList(rows, "custom", "transition").map((row) => ({ source: row.label, destination: row.secondary, value: row.value })),
      sections: rollupList(rows, "custom", "section").map((row) => ({ path: row.label, label: row.secondary, value: row.value })),
      milestones: rollupList(rows, "custom", "milestone").map((row) => { const [action, ...item] = row.secondary.split(":"); return { group: row.label, action, item: item.join(":"), value: row.value }; }),
      engagement: [...engagement.values()],
    };
  } else if (view === "acquisition") {
    if (!payload.sources.rum?.ready) payload.rum = {
      referrers: rollupList(rows, "rum", "referrer"), countries: rollupList(rows, "rum", "country"),
      devices: rollupList(rows, "rum", "device"), browsers: rollupList(rows, "rum", "browser"),
      operatingSystems: rollupList(rows, "rum", "os"), series: [],
    };
    if (!payload.sources.custom?.ready) payload.custom = {
      utmSources: rollupList(rows, "custom", "utm_source"), utmMedia: rollupList(rows, "custom", "utm_medium"),
      campaigns: rollupList(rows, "custom", "utm_campaign"),
    };
  } else if (view === "performance" && !payload.sources.rum?.ready) {
    const summary = {};
    for (const metric of ["lcp", "inp", "cls", "fcp", "pageLoad"]) {
      const values = metricRows("rum", `${metric}_p75`);
      if (values.length) summary[metric] = Number(values.at(-1).value || 0);
    }
    const paths = new Map();
    for (const metric of ["lcp", "inp", "cls", "fcp", "pageLoad"]) {
      for (const row of metricRows("rum", `${metric}_p75_path`)) {
        const item = paths.get(row.dimension_a) || { path: row.dimension_a, samples: Number(row.sample_count || 0) };
        item[metric] = Number(row.value || 0); paths.set(row.dimension_a, item);
      }
    }
    payload.rum = { summary, series: [], paths: [...paths.values()].sort((a, b) => Number(b.lcp || 0) - Number(a.lcp || 0)), elements: [] };
  } else if (view === "tattoo-specials" && !payload.sources.custom?.ready) {
    const value = (metric) => total("custom", metric);
    const selectedCampaign = filters.campaign || "";
    const campaignValue = (metric) => rollupList(rows, "custom", metric).find((row) => row.label === selectedCampaign)?.value || 0;
    const stageRows = selectedCampaign
      ? rollupList(rows, "custom", "campaign_stage_sessions").filter((row) => row.label === selectedCampaign).map((row) => ({ label: row.secondary, value: row.value }))
      : rollupList(rows, "custom", "stage_sessions");
    const deepestRows = selectedCampaign
      ? rollupList(rows, "custom", "campaign_deepest_sessions").filter((row) => row.label === selectedCampaign).map((row) => ({ label: row.secondary, value: row.value }))
      : rollupList(rows, "custom", "deepest_sessions");
    const campaignMetrics = new Map();
    const offerMetrics = new Map();
    const catalog = tattooCatalogMaps(payload.catalog || {});
    for (const metric of ["campaign_visitors", "campaign_interested", "campaign_form_starts", "campaign_accepted", "campaign_compared", "campaign_reference_added"]) {
      for (const row of rollupList(rows, "custom", metric)) {
        const item = campaignMetrics.get(row.label) || { id: row.label };
        item[metric] = row.value; campaignMetrics.set(row.label, item);
      }
    }
    for (const metric of ["offer_views", "offer_selection_clicks", "offer_selecting_sessions", "offer_form_starts", "offer_accepted", "offer_compared"]) {
      for (const row of rollupList(rows, "custom", metric)) {
        const key = `${row.label}\u0000${row.secondary}`;
        const item = offerMetrics.get(key) || { campaignId: row.label, id: row.secondary };
        item[metric] = row.value; offerMetrics.set(key, item);
      }
    }
    payload.custom = {
      pageEntries: value("page_entries"), pageViews: value("page_views"),
      campaignVisitors: selectedCampaign ? campaignValue("campaign_visitors") : value("campaign_visitors_total"),
      interestedSessions: selectedCampaign ? campaignValue("campaign_interested") : value("interested_sessions"),
      formStarts: selectedCampaign ? campaignValue("campaign_form_starts") : value("form_starts"),
      acceptedRequests: selectedCampaign ? campaignValue("campaign_accepted") : value("accepted_requests"),
      comparedSessions: selectedCampaign ? campaignValue("campaign_compared") : value("compared_sessions"),
      referenceAddedSessions: selectedCampaign ? campaignValue("campaign_reference_added") : value("reference_added_sessions"),
      avgActiveSeconds: metricRows("custom", "avg_active_seconds").length ? metricRows("custom", "avg_active_seconds").reduce((sum, row) => sum + Number(row.value || 0), 0) / metricRows("custom", "avg_active_seconds").length : 0,
      avgScroll: metricRows("custom", "avg_scroll").length ? metricRows("custom", "avg_scroll").reduce((sum, row) => sum + Number(row.value || 0), 0) / metricRows("custom", "avg_scroll").length : 0,
      recordedExits: value("recorded_exits"),
      stages: TATTOO_SPECIAL_STAGES.map(([action, label], index) => {
        const sessions = stageRows.find((row) => row.label === action)?.value || 0;
        const previous = index ? stageRows.find((row) => row.label === TATTOO_SPECIAL_STAGES[index - 1][0])?.value || 0 : sessions;
        return { action, label, sessions, events: 0, fromPreviousPercent: index ? percent(sessions, previous) : 100 };
      }),
      deepest: TATTOO_SPECIAL_STAGES.map(([action, label]) => ({ action, label, sessions: deepestRows.find((row) => row.label === action)?.value || 0 })),
      campaigns: [...campaignMetrics.values()].filter((item) => !selectedCampaign || item.id === selectedCampaign).map((item) => ({
        id: item.id, title: catalog.campaigns.get(item.id)?.title || item.id,
        isPublic: Boolean(catalog.campaigns.get(item.id)?.isPublic), archived: Boolean(catalog.campaigns.get(item.id)?.archived),
        visitors: item.campaign_visitors || 0, interestedSessions: item.campaign_interested || 0,
        formStarts: item.campaign_form_starts || 0, acceptedRequests: item.campaign_accepted || 0,
        comparedSessions: item.campaign_compared || 0, referenceAddedSessions: item.campaign_reference_added || 0,
      })),
      offers: [...offerMetrics.values()].filter((item) => !selectedCampaign || item.campaignId === selectedCampaign).map((item) => {
        const viewedSessions = item.offer_views || 0;
        const selectingSessions = item.offer_selecting_sessions || 0;
        return {
          id: item.id, campaignId: item.campaignId, title: catalog.offers.get(item.id)?.title || item.id,
          viewedSessions, selectionClicks: item.offer_selection_clicks || 0, selectingSessions,
          formStarts: item.offer_form_starts || 0, acceptedRequests: item.offer_accepted || 0,
          comparedSessions: item.offer_compared || 0, selectionRatePercent: percent(selectingSessions, viewedSessions),
        };
      }),
      paths: rollupList(rows, "custom", "selection_path").filter((row) => !selectedCampaign || row.label === selectedCampaign).map((row) => {
        const offerIds = row.secondary.split(">");
        return { campaignId: row.label, label: offerIds.map((id) => catalog.offers.get(id)?.title || id).join(" → "), offerIds, sessions: row.value };
      }),
      stageBreakdown: [], deepestBreakdown: [], truncated: false,
    };
  }
  payload.rollupCoverage = { from: rows[0]?.day || "", through: rows.at(-1)?.day || "" };
  return payload;
}

function filtersFromUrl(url) {
  const view = VIEWS.has(url.searchParams.get("view")) ? url.searchParams.get("view") : "overview";
  const rangeName = RANGE_WINDOWS[url.searchParams.get("range")] ? url.searchParams.get("range") : "30d";
  const device = DEVICES.has(url.searchParams.get("device")) ? url.searchParams.get("device") : "all";
  const group = safeSlug(url.searchParams.get("group"), 48);
  const campaign = safeSlug(url.searchParams.get("campaign"), 120);
  return { view, rangeName, device, group, campaign };
}

function reconcileOverviewSources(payload) {
  const customShowsActivity = (payload.custom?.pageActivity || []).some((item) => Number(item.pageViews || 0) > 0)
    || (payload.custom?.contentGroups || []).some((item) => Number(item.value || 0) > 0);
  if (!payload.sources.rum?.ready || !payload.sources.custom?.ready || !customShowsActivity || Number(payload.rum?.pageViews || 0) > 0) return;
  payload.sources.rum = sourceState(false, "Cloudflare RUM returned no page-load rows while first-party site engagement recorded activity.");
  payload.rum = { pageViews: null, visits: null, series: [], paths: [], contentGroups: [], vitals: {} };
}

async function buildAnalyticsView(env, options) {
  const range = options.range || dateRange(options.rangeName);
  const filters = { device: options.device || "all", group: options.group || "", ...(options.view === "tattoo-specials" ? { campaign: options.campaign || "" } : {}) };
  const coverage = rangeCoverage(range);
  const payload = {
    view: options.view, range: options.rangeName, filters, generatedAt: new Date().toISOString(),
    dataThrough: coverage.through, sources: {}, coverage,
  };
  const tasks = [];
  if (options.view === "overview") {
    tasks.push(fetchRumOverview(env, range, filters).then((data) => { payload.rum = data; payload.sources.rum = readyRumState(data, payload.dataThrough); }).catch((error) => { payload.sources.rum = sourceState(false, error.message); }));
    tasks.push(fetchCustomOverview(env, range, filters).then((data) => { payload.custom = data; payload.sources.custom = sourceState(true, "", payload.dataThrough); }).catch((error) => { payload.sources.custom = sourceState(false, error.message); }));
  } else if (options.view === "journeys") {
    tasks.push(fetchCustomJourneys(env, range, filters).then((data) => { payload.custom = data; payload.sources.custom = sourceState(true, "", payload.dataThrough); }).catch((error) => { payload.sources.custom = sourceState(false, error.message); }));
  } else if (options.view === "acquisition") {
    tasks.push(fetchRumAcquisition(env, range, filters).then((data) => { payload.rum = data; payload.sources.rum = readyRumState(data, payload.dataThrough); }).catch((error) => { payload.sources.rum = sourceState(false, error.message); }));
    tasks.push(fetchCustomAcquisition(env, range, filters).then((data) => { payload.custom = data; payload.sources.custom = sourceState(true, "", payload.dataThrough); }).catch((error) => { payload.sources.custom = sourceState(false, error.message); }));
  } else if (options.view === "performance") {
    tasks.push(fetchRumPerformance(env, range, filters).then((data) => { payload.rum = data; payload.sources.rum = readyRumState(data, payload.dataThrough); }).catch((error) => { payload.sources.rum = sourceState(false, error.message); }));
  } else if (options.view === "tattoo-specials") {
    const catalogPromise = loadTattooSpecialCatalog(env);
    tasks.push(catalogPromise.then((catalog) => { payload.catalog = catalog; }));
    tasks.push(catalogPromise.then((catalog) => fetchCustomTattooSpecials(env, range, filters, catalog)).then((data) => {
      payload.custom = data;
      payload.sources.custom = sourceState(true, "", payload.dataThrough);
      if (data.truncated) payload.sources.custom.state = "partial";
    }).catch((error) => { payload.sources.custom = sourceState(false, error.message); }));
  }
  await Promise.all(tasks);
  if (options.view === "overview") reconcileOverviewSources(payload);
  const rollups = options.includeRollups === false ? [] : await loadRollups(env, range, options.view);
  applyRollupFallback(options.view, payload, rollups, filters);
  const states = Object.values(payload.sources);
  payload.state = states.length && states.every((state) => state.ready)
    ? (states.some((state) => state.state === "partial") ? "partial" : "current")
    : states.some((state) => state.ready) ? "partial" : rollups.length ? "stale" : "unavailable";
  if (payload.state === "stale" && payload.rollupCoverage?.through) payload.dataThrough = payload.rollupCoverage.through;
  return payload;
}

export async function handleAdminAnalytics(request, env) {
  const auth = requireStudioAdmin(request, env);
  if (auth) return auth;
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const options = filtersFromUrl(new URL(request.url));
  const currentRange = dateRange(options.rangeName);
  const payload = await buildAnalyticsView(env, { ...options, range: currentRange });
  if (options.view === "overview") {
    const previousEnd = currentRange.rolling ? currentRange.start : new Date(currentRange.start.getTime() - DAY_MS);
    const previousRange = dateRange(options.rangeName, previousEnd);
    const previous = await buildAnalyticsView(env, { ...options, range: previousRange });
    payload.comparison = {
      pageViews: previous.sources.rum?.ready ? Number(previous.rum?.pageViews || 0) : null,
      visits: previous.sources.rum?.ready ? Number(previous.rum?.visits || 0) : null,
      sessions: previous.custom ? Number(previous.custom.sessions || 0) : null,
      engagedSessions: previous.custom ? Number(previous.custom.engagedSessions || 0) : null,
      avgActiveSeconds: previous.custom ? Number(previous.custom.avgActiveSeconds || 0) : null,
      coverage: previous.coverage,
    };
  }
  return json(payload);
}

function rowsFromPayload(day, view, payload) {
  const rows = [];
  const add = (source, metric, value, a = "", b = "", samples = 0) => {
    if (!payload.sources?.[source]?.ready) return;
    if (!Number.isFinite(Number(value))) return;
    rows.push({ day, view, source, metric, a: safeDimension(a, 300), b: safeDimension(b, 300), value: Number(value), samples: Number(samples || 0) });
  };
  if (view === "overview") {
    add("rum", "page_views", payload.rum?.pageViews || 0); add("rum", "visits", payload.rum?.visits || 0);
    for (const item of payload.rum?.paths || []) add("rum", "path_views", item.value, item.label);
    for (const item of payload.rum?.contentGroups || []) add("rum", "content_group", item.value, item.label);
    for (const [metric, value] of Object.entries(payload.rum?.vitals || {})) add("rum", `vital_${metric}`, value);
    add("custom", "sessions", payload.custom?.sessions || 0); add("custom", "engaged_sessions", payload.custom?.engagedSessions || 0);
    add("custom", "avg_active_seconds", payload.custom?.avgActiveSeconds || 0);
    for (const item of payload.custom?.contentGroups || []) add("custom", "content_group", item.value, item.label);
  } else if (view === "journeys") {
    for (const item of payload.custom?.entries || []) add("custom", "entry", item.value, item.label);
    for (const item of payload.custom?.transitions || []) add("custom", "transition", item.value, item.source, item.destination);
    for (const item of payload.custom?.exits || []) add("custom", "exit", item.value, item.label);
    for (const item of payload.custom?.sections || []) add("custom", "section", item.value, item.path, item.label);
    for (const item of payload.custom?.milestones || []) add("custom", "milestone", item.value, item.group, `${item.action}:${item.item}`);
    for (const item of payload.custom?.engagement || []) {
      add("custom", "engagement_active", item.activeSeconds, item.path);
      add("custom", "engagement_scroll", item.scroll, item.path);
      add("custom", "engagement_views", item.value, item.path);
    }
  } else if (view === "acquisition") {
    for (const [metric, list] of [["referrer", payload.rum?.referrers], ["country", payload.rum?.countries], ["device", payload.rum?.devices], ["browser", payload.rum?.browsers], ["os", payload.rum?.operatingSystems]]) {
      for (const item of list || []) add("rum", metric, item.value, item.label);
    }
    for (const [metric, list] of [["utm_source", payload.custom?.utmSources], ["utm_medium", payload.custom?.utmMedia], ["utm_campaign", payload.custom?.campaigns]]) {
      for (const item of list || []) add("custom", metric, item.value, item.label);
    }
  } else if (view === "performance") {
    for (const [metric, value] of Object.entries(payload.rum?.summary || {})) add("rum", `${metric}_p75`, value);
    for (const item of payload.rum?.paths || []) {
      for (const metric of ["lcp", "inp", "cls", "fcp", "pageLoad"]) add("rum", `${metric}_p75_path`, item[metric], item.path, "", item.samples);
    }
  } else if (view === "tattoo-specials") {
    const data = payload.custom || {};
    add("custom", "page_entries", data.pageEntries || 0); add("custom", "page_views", data.pageViews || 0);
    add("custom", "campaign_visitors_total", data.campaignVisitors || 0); add("custom", "interested_sessions", data.interestedSessions || 0);
    add("custom", "form_starts", data.formStarts || 0); add("custom", "accepted_requests", data.acceptedRequests || 0);
    add("custom", "compared_sessions", data.comparedSessions || 0); add("custom", "reference_added_sessions", data.referenceAddedSessions || 0);
    add("custom", "avg_active_seconds", data.avgActiveSeconds || 0); add("custom", "avg_scroll", data.avgScroll || 0);
    add("custom", "recorded_exits", data.recordedExits || 0);
    for (const stage of data.stages || []) add("custom", "stage_sessions", stage.sessions || 0, stage.action);
    for (const stage of data.deepest || []) add("custom", "deepest_sessions", stage.sessions || 0, stage.action);
    for (const campaign of data.campaigns || []) {
      add("custom", "campaign_visitors", campaign.visitors || 0, campaign.id);
      add("custom", "campaign_interested", campaign.interestedSessions || 0, campaign.id);
      add("custom", "campaign_form_starts", campaign.formStarts || 0, campaign.id);
      add("custom", "campaign_accepted", campaign.acceptedRequests || 0, campaign.id);
      add("custom", "campaign_compared", campaign.comparedSessions || 0, campaign.id);
      add("custom", "campaign_reference_added", campaign.referenceAddedSessions || 0, campaign.id);
    }
    for (const stage of data.stageBreakdown || []) add("custom", "campaign_stage_sessions", stage.sessions || 0, stage.campaignId, stage.action);
    for (const stage of data.deepestBreakdown || []) add("custom", "campaign_deepest_sessions", stage.sessions || 0, stage.campaignId, stage.action);
    for (const offer of data.offers || []) {
      add("custom", "offer_views", offer.viewedSessions || 0, offer.campaignId, offer.id);
      add("custom", "offer_selection_clicks", offer.selectionClicks || 0, offer.campaignId, offer.id);
      add("custom", "offer_selecting_sessions", offer.selectingSessions || 0, offer.campaignId, offer.id);
      add("custom", "offer_form_starts", offer.formStarts || 0, offer.campaignId, offer.id);
      add("custom", "offer_accepted", offer.acceptedRequests || 0, offer.campaignId, offer.id);
      add("custom", "offer_compared", offer.comparedSessions || 0, offer.campaignId, offer.id);
    }
    for (const path of data.paths || []) add("custom", "selection_path", path.sessions || 0, path.campaignId, (path.offerIds || []).join(">"));
  }
  return rows;
}

async function saveRollupRows(database, rows) {
  if (!rows.length) return;
  const statements = rows.map((row) => database.prepare(`INSERT INTO site_analytics_daily
    (day,view,source,metric,dimension_a,dimension_b,value,sample_count,updated_at)
    VALUES(?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(day,view,source,metric,dimension_a,dimension_b) DO UPDATE SET value=excluded.value,sample_count=excluded.sample_count,updated_at=excluded.updated_at`)
    .bind(row.day, row.view, row.source, row.metric, row.a, row.b, row.value, row.samples));
  for (let index = 0; index < statements.length; index += 50) await database.batch(statements.slice(index, index + 50));
}

async function nextRollupDay(database, source, today) {
  const state = await database.prepare("SELECT last_complete_day FROM site_analytics_rollup_state WHERE source=?").bind(source).first();
  if (state?.last_complete_day) return isoDate(new Date(`${state.last_complete_day}T00:00:00Z`).getTime() + DAY_MS);
  if (source === "rum") return isoDate(new Date(`${today}T00:00:00Z`).getTime() - RUM_LIVE_DAYS * DAY_MS);
  return isoDate(new Date(`${today}T00:00:00Z`).getTime() - DAY_MS);
}

export async function rollupSiteAnalytics(env, now = new Date()) {
  if (!env.SUBMISSIONS_DB) return { ok: false, error: "Missing D1 binding." };
  const database = env.SUBMISSIONS_DB;
  const today = isoDate(now);
  await database.prepare("DELETE FROM site_analytics_daily WHERE day < date('now','-366 days')").run();
  const results = [];
  for (const source of ["rum", "custom"]) {
    const day = await nextRollupDay(database, source, today);
    if (day >= today) { results.push({ source, state: "current" }); continue; }
    const start = new Date(`${day}T00:00:00Z`);
    const range = { days: 1, start, end: new Date(start.getTime() + DAY_MS), startIso: start.toISOString(), endIso: new Date(start.getTime() + DAY_MS).toISOString() };
    try {
      let saved = 0;
      for (const view of ["overview", "journeys", "acquisition", "performance", "tattoo-specials"]) {
        if (source === "rum" && ["journeys", "tattoo-specials"].includes(view)) continue;
        if (source === "custom" && view === "performance") continue;
        const payload = await buildAnalyticsView(env, { view, rangeName: "1d", range, device: "all", group: "", campaign: "", includeRollups: false });
        if (!payload.sources?.[source]?.ready) throw new Error(payload.sources?.[source]?.error || `${source} analytics is unavailable.`);
        const rows = rowsFromPayload(day, view, payload).filter((row) => row.source === source);
        await saveRollupRows(database, rows); saved += rows.length;
      }
      await database.prepare(`INSERT INTO site_analytics_rollup_state(source,last_complete_day,last_attempt_at,last_error)
        VALUES(?,?,datetime('now'),'') ON CONFLICT(source) DO UPDATE SET last_complete_day=excluded.last_complete_day,last_attempt_at=excluded.last_attempt_at,last_error=''`)
        .bind(source, day).run();
      results.push({ source, day, saved, state: "complete" });
    } catch (error) {
      await database.prepare(`INSERT INTO site_analytics_rollup_state(source,last_complete_day,last_attempt_at,last_error)
        VALUES(?,NULL,datetime('now'),?) ON CONFLICT(source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error`)
        .bind(source, safeString(error.message, 1000)).run();
      results.push({ source, day, state: "error", error: error.message });
    }
  }
  return { ok: results.some((row) => row.state === "complete" || row.state === "current"), results };
}

export const ANALYTICS_EVENT_NAMES = [...ALLOWED_EVENTS];
