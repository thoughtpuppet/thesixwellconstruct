import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runInNewContext } from "node:vm";

import {
  ANALYTICS_EVENT_NAMES,
  aggregateTattooSpecialInterest,
  analyticsExcluded,
  analyticsContentGroup,
  handleAdminAnalytics,
  handleAdminAnalyticsExclusion,
  handleAnalyticsEvents,
  normalizeAnalyticsPath,
  rollupSiteAnalytics,
  sanitizeAnalyticsEvent,
} from "../functions/api/analytics/_lib.js";
import { browserAnalyticsMarkup, shouldInjectSiteAnalytics } from "../_worker.js";

const ROOT = process.cwd();

test("analytics paths discard query data and normalize public routes", () => {
  assert.equal(normalizeAnalyticsPath("https://example.com/booking/index.html?token=secret&ref=abc"), "/booking/");
  assert.equal(normalizeAnalyticsPath("https://example.com/b/Ab3dE7xQ9wK2"), "/booking/");
  assert.equal(normalizeAnalyticsPath("/archive//events?search=private"), "/archive/events/");
  assert.equal(analyticsContentGroup("/tattoos/portfolio/?gclid=private"), "tattoos");
});

test("event validation allowlists fields and never accepts PII-shaped extras", () => {
  assert.ok(ANALYTICS_EVENT_NAMES.includes("interactive_complete"));
  const good = sanitizeAnalyticsEvent({
    name: "page_view",
    path: "/archive/?token=secret",
    utmSource: "Newsletter Summer",
    utmCampaign: "Open Studio",
    device: "mobile",
  });
  assert.equal(good.error, undefined);
  assert.equal(good.event.path, "/archive/");
  assert.equal(good.event.utmSource, "newsletter-summer");
  assert.equal(good.event.utmCampaign, "open-studio");
  assert.equal(sanitizeAnalyticsEvent({ name: "page_view", path: "/", email: "person@example.com" }).error, "Unknown analytics field: email.");
  assert.equal(sanitizeAnalyticsEvent({ name: "made_up", path: "/" }).error, "Unknown analytics event.");
});

test("browser event endpoint enforces same origin and writes only validated points", async () => {
  const points = [];
  const env = { SITE_ANALYTICS: { writeDataPoint(point) { points.push(point); } } };
  const payload = JSON.stringify({
    sessionId: "tab_session_123456",
    events: [{ name: "page_view", path: "/home/?ref=protected", previousPath: "/entry-room/?token=x", device: "desktop" }],
  });
  const rejected = await handleAnalyticsEvents(new Request("https://example.com/api/analytics/events", {
    method: "POST", headers: { origin: "https://other.example", "content-type": "application/json" }, body: payload,
  }), env);
  assert.equal(rejected.status, 403);

  const accepted = await handleAnalyticsEvents(new Request("https://example.com/api/analytics/events", {
    method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: payload,
  }), env);
  assert.equal(accepted.status, 204);
  assert.equal(points.length, 1);
  assert.equal(points[0].indexes[0], "tab_session_123456");
  assert.equal(points[0].blobs[1], "/home/");
  assert.equal(points[0].blobs[2], "/entry-room/");
  assert.equal(JSON.stringify(points[0]).includes("protected"), false);
});

test("event endpoint caps batch count and rejects unknown payload fields", async () => {
  const env = { SITE_ANALYTICS: { writeDataPoint() {} } };
  const request = (body) => new Request("https://example.com/api/analytics/events", {
    method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const events = Array.from({ length: 33 }, () => ({ name: "page_view", path: "/" }));
  assert.equal((await handleAnalyticsEvents(request({ sessionId: "tab_session_123456", events }), env)).status, 400);
  assert.equal((await handleAnalyticsEvents(request({ sessionId: "tab_session_123456", events: events.slice(0, 1), visitorId: "nope" }), env)).status, 400);
});

test("analytics exclusion is authenticated, secure, reversible, and suppresses ingestion", async () => {
  const env = { SUBMISSIONS_ADMIN_TOKEN: "secret", SITE_ANALYTICS: { writeDataPoint() { throw new Error("excluded write"); } } };
  const unauthorized = await handleAdminAnalyticsExclusion(new Request("https://example.com/api/admin/analytics/exclusion"), env);
  assert.equal(unauthorized.status, 401);

  const enabled = await handleAdminAnalyticsExclusion(new Request("https://example.com/api/admin/analytics/exclusion", {
    method: "PUT", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: JSON.stringify({ excluded: true }),
  }), env);
  assert.equal(enabled.status, 200);
  assert.match(enabled.headers.get("set-cookie"), /swc_analytics_excluded=1; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000/);
  const cookie = "swc_analytics_excluded=1";
  assert.equal(analyticsExcluded(new Request("https://example.com/", { headers: { cookie } })), true);

  const status = await handleAdminAnalyticsExclusion(new Request("https://example.com/api/admin/analytics/exclusion", {
    headers: { authorization: "Bearer secret", cookie },
  }), env);
  assert.deepEqual(await status.json(), { excluded: true });

  const suppressed = await handleAnalyticsEvents(new Request("https://example.com/api/analytics/events", {
    method: "POST", headers: { origin: "https://example.com", cookie, "content-type": "application/json" }, body: "{}",
  }), env);
  assert.equal(suppressed.status, 204);

  const cleared = await handleAdminAnalyticsExclusion(new Request("https://example.com/api/admin/analytics/exclusion", {
    method: "PUT", headers: { authorization: "Bearer secret", cookie, "content-type": "application/json" }, body: JSON.stringify({ excluded: false }),
  }), env);
  assert.match(cleared.headers.get("set-cookie"), /swc_analytics_excluded=;[\s\S]*Max-Age=0;[\s\S]*Expires=Thu, 01 Jan 1970/);
});

test("Tattoo Specials aggregation counts tab sessions, repeat clicks, deepest stages, and comparison paths without returning IDs", () => {
  const row = (session_id, action_name, campaign_id = "camp-one", offer_id = "", event_count = 1, first_sequence = 1) => ({ session_id, action_name, campaign_id, offer_id, event_count, first_sequence });
  const rows = [
    row("tab_session_000001", "campaign_opened"), row("tab_session_000001", "offer_viewed", "camp-one", "offer-a", 1, 2),
    row("tab_session_000001", "offer_selected", "camp-one", "offer-a", 2, 3), row("tab_session_000001", "form_started", "camp-one", "offer-a", 1, 4),
    row("tab_session_000001", "purchaser_completed", "camp-one", "offer-a", 1, 5), row("tab_session_000001", "project_started", "camp-one", "offer-a", 1, 6),
    row("tab_session_000001", "project_completed", "camp-one", "offer-a", 1, 7), row("tab_session_000001", "reference_added", "camp-one", "offer-a", 1, 8),
    row("tab_session_000001", "submit_attempted", "camp-one", "offer-a", 1, 9), row("tab_session_000001", "request_accepted", "camp-one", "offer-a", 1, 10),
    row("tab_session_000002", "campaign_opened"), row("tab_session_000002", "offer_viewed", "camp-one", "offer-a", 1, 2),
    row("tab_session_000002", "offer_selected", "camp-one", "offer-a", 1, 3), row("tab_session_000002", "offer_selected", "camp-one", "offer-b", 1, 4),
    row("tab_session_000002", "form_started", "camp-one", "offer-b", 1, 5), row("tab_session_000003", "campaign_opened"),
  ];
  const aggregate = aggregateTattooSpecialInterest(rows, { sessions: 3, page_views: 4, avg_active_seconds: 21.5, avg_scroll: 72, recorded_exits: 3 }, {
    campaigns: [{ id: "camp-one", title: "August Specials", isPublic: true }],
    offers: [{ id: "offer-a", campaignId: "camp-one", title: "Special A" }, { id: "offer-b", campaignId: "camp-one", title: "Special B" }],
  });
  assert.equal(aggregate.campaignVisitors, 3);
  assert.equal(aggregate.interestedSessions, 2);
  assert.equal(aggregate.formStarts, 2);
  assert.equal(aggregate.acceptedRequests, 1);
  assert.equal(aggregate.comparedSessions, 1);
  assert.equal(aggregate.referenceAddedSessions, 1);
  assert.equal(aggregate.offers.find((item) => item.id === "offer-a").selectionClicks, 3);
  assert.equal(aggregate.offers.find((item) => item.id === "offer-a").selectingSessions, 2);
  assert.equal(aggregate.offers.find((item) => item.id === "offer-b").formStarts, 1);
  assert.deepEqual(aggregate.paths.map((item) => [item.label, item.sessions]), [["Special A → Special B", 1]]);
  assert.equal(aggregate.deepest.find((item) => item.action === "request_accepted").sessions, 1);
  assert.equal(aggregate.deepest.find((item) => item.action === "form_started").sessions, 1);
  assert.equal(JSON.stringify(aggregate).includes("tab_session_"), false);
});

test("Tattoo Specials admin view applies rolling range, device, and internal campaign filters", async () => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (_url, options = {}) => {
    const sql = String(options.body || "");
    queries.push(sql);
    const data = sql.includes("GROUP BY session_id")
      ? [{ session_id: "tab_session_123456", action_name: "campaign_opened", campaign_id: "camp-one", offer_id: "", first_sequence: 1, event_count: 1 }]
      : sql.includes("page_views") ? [{ sessions: 1, page_views: 1 }]
        : sql.includes("avg_active_seconds") ? [{ avg_active_seconds: 12, avg_scroll: 50, recorded_exits: 1 }] : [];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const database = {
    prepare(sql) {
      return { bind() { return this; }, async all() {
        if (sql.includes("FROM tattoo_special_campaigns")) return { results: [{ id: "camp-one", title: "Campaign One", slug: "campaign-one", is_public: 1, archived_at: null }] };
        if (sql.includes("FROM tattoo_special_offers")) return { results: [{ id: "offer-a", campaign_id: "camp-one", title: "Offer A", slug: "offer-a", archived_at: null }] };
        return { results: [] };
      } };
    },
  };
  try {
    const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=tattoo-specials&range=36h&device=mobile&campaign=camp-one", {
      headers: { authorization: "Bearer secret" },
    }), { SUBMISSIONS_ADMIN_TOKEN: "secret", SUBMISSIONS_DB: database, CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_ANALYTICS_API_TOKEN: "token" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.range, "36h");
    assert.deepEqual(payload.filters, { device: "mobile", group: "", campaign: "camp-one" });
    assert.equal(payload.custom.campaignVisitors, 1);
    assert.equal(JSON.stringify(payload).includes("tab_session_123456"), false);
    assert.ok(queries.every((sql) => sql.includes("blob14 = 'mobile'")));
    assert.ok(queries.find((sql) => sql.includes("GROUP BY session_id")).includes("blob7 = 'camp-one'"));
    const rangeQuery = queries[0];
    const timestamps = [...rangeQuery.matchAll(/toDateTime\('([^']+)'\)/g)].map((match) => new Date(match[1] + "Z"));
    assert.equal((timestamps[1] - timestamps[0]) / (60 * 60 * 1000), 36);
  } finally { globalThis.fetch = originalFetch; }
});

test("Tattoo Specials stale daily rollups preserve the internal campaign filter", async () => {
  const metric = (metricName, campaign, value, secondary = "") => ({ day: "2026-08-09", source: "custom", metric: metricName, dimension_a: campaign, dimension_b: secondary, value, sample_count: value, updated_at: "2026-08-10T01:00:00Z" });
  const rows = [
    metric("campaign_visitors", "camp-one", 4), metric("campaign_interested", "camp-one", 2), metric("campaign_form_starts", "camp-one", 1),
    metric("campaign_visitors", "camp-two", 9), metric("campaign_interested", "camp-two", 7),
    metric("campaign_stage_sessions", "camp-one", 4, "campaign_opened"), metric("campaign_stage_sessions", "camp-one", 2, "offer_selected"),
    metric("campaign_deepest_sessions", "camp-one", 2, "campaign_opened"), metric("campaign_deepest_sessions", "camp-one", 2, "offer_selected"),
    metric("offer_views", "camp-one", 3, "offer-a"), metric("offer_selecting_sessions", "camp-one", 2, "offer-a"),
    metric("offer_views", "camp-two", 8, "offer-b"), metric("offer_selecting_sessions", "camp-two", 7, "offer-b"),
  ];
  const database = {
    prepare(sql) { return { bind() { return this; }, async all() {
      if (sql.includes("FROM tattoo_special_campaigns")) return { results: [{ id: "camp-one", title: "Campaign One", slug: "one", is_public: 1 }, { id: "camp-two", title: "Campaign Two", slug: "two", is_public: 0 }] };
      if (sql.includes("FROM tattoo_special_offers")) return { results: [{ id: "offer-a", campaign_id: "camp-one", title: "Offer A", slug: "a" }, { id: "offer-b", campaign_id: "camp-two", title: "Offer B", slug: "b" }] };
      if (sql.includes("FROM site_analytics_daily")) return { results: rows };
      return { results: [] };
    } }; },
  };
  const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=tattoo-specials&range=7d&campaign=camp-one", {
    headers: { authorization: "Bearer secret" },
  }), { SUBMISSIONS_ADMIN_TOKEN: "secret", SUBMISSIONS_DB: database });
  const payload = await response.json();
  assert.equal(payload.state, "stale");
  assert.equal(payload.custom.campaignVisitors, 4);
  assert.equal(payload.custom.interestedSessions, 2);
  assert.deepEqual(payload.custom.campaigns.map((item) => item.id), ["camp-one"]);
  assert.deepEqual(payload.custom.offers.map((item) => item.id), ["offer-a"]);
  assert.equal(payload.custom.stages.find((item) => item.action === "offer_selected").sessions, 2);
});

test("Worker conditionally injects manual RUM and Tattoo Specials Meta scripts only for included browsers", () => {
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  const page = readFileSync(join(ROOT, "tattoos", "specials", "index.html"), "utf8");
  assert.match(worker, /analyticsExcluded\(request\)/);
  assert.match(worker, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(worker, /CLOUDFLARE_WEB_ANALYTICS_SITE_TAG/);
  assert.match(worker, /tattoo-specials-meta\.js/);
  assert.doesNotMatch(page, /connect\.facebook\.net|facebook\.com\/tr|fbq\('init'/);
  const htmlResponse = new Response("<html><body></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
  assert.equal(shouldInjectSiteAnalytics(new Request("https://example.com/tattoos/specials/"), htmlResponse), true);
  assert.equal(shouldInjectSiteAnalytics(new Request("https://example.com/tattoos/specials/", { headers: { cookie: "swc_analytics_excluded=1" } }), htmlResponse), false);
  const specialsMarkup = browserAnalyticsMarkup({ CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "valid_beacon_token" }, "/tattoos/specials/");
  assert.match(specialsMarkup, /site-analytics\.js/);
  assert.match(specialsMarkup, /beacon\.min\.js/);
  assert.match(specialsMarkup, /tattoo-specials-meta\.js/);
  assert.doesNotMatch(browserAnalyticsMarkup({ CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "valid_beacon_token" }, "/home/"), /tattoo-specials-meta\.js/);
});

test("Studio analytics auth is protected and reports partial source readiness", async () => {
  const unauthorized = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview"), { SUBMISSIONS_ADMIN_TOKEN: "secret" });
  assert.equal(unauthorized.status, 401);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("/graphql")
    ? new Response(JSON.stringify({ errors: [{ message: "RUM unavailable" }] }), { status: 500, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=7d&device=mobile&group=archive", {
      headers: { authorization: "Bearer secret" },
    }), {
      SUBMISSIONS_ADMIN_TOKEN: "secret",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "site-tag",
      CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state, "partial");
    assert.equal(payload.sources.rum.state, "unavailable");
    assert.equal(payload.sources.custom.state, "current");
    assert.deepEqual(payload.filters, { device: "mobile", group: "archive" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare RUM uses the public hostname instead of the beacon token", async () => {
  const originalFetch = globalThis.fetch;
  const graphqlVariables = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/graphql")) {
      graphqlVariables.push(JSON.parse(options.body).variables);
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ pageloads: [], vitals: [] }] } } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=30d", {
      headers: { authorization: "Bearer secret" },
    }), {
      SUBMISSIONS_ADMIN_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account",
      PUBLIC_SITE_URL: "https://thesixwellconstruct.com", CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "public-beacon-token",
      CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
    });
    assert.ok(graphqlVariables.length > 0);
    for (const variables of graphqlVariables) {
      assert.equal(variables.filter.requestHost, "thesixwellconstruct.com");
      assert.equal("siteTag" in variables.filter, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty RUM result cannot report current beside proven site activity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/graphql")) return new Response(JSON.stringify({ data: { viewer: { accounts: [{ pageloads: [], vitals: [] }] } } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
    const sql = String(options.body || "");
    const data = sql.includes("SELECT blob5 label") ? [{ label: "tattoos", value: 4 }] : [];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=30d", {
      headers: { authorization: "Bearer secret" },
    }), {
      SUBMISSIONS_ADMIN_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account", PUBLIC_SITE_URL: "https://thesixwellconstruct.com",
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "public-beacon-token", CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
    });
    const payload = await response.json();
    assert.equal(payload.state, "partial");
    assert.equal(payload.sources.rum.ready, false);
    assert.match(payload.sources.rum.error, /no page-load rows/);
    assert.equal(payload.rum.pageViews, null);
    assert.equal(payload.rum.visits, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio analytics exposes rolling last-hour, 24-, 36-, 48-hour and 5-day ranges", async () => {
  const studio = readFileSync(join(ROOT, "studio", "analytics.js"), "utf8");
  const consoleHtml = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(consoleHtml, /\/studio\/analytics\.js\?v=tattoo-interest-1/);
  for (const [value, label] of [["1h", "Last hour"], ["24h", "Last 24 hours"], ["36h", "Last 36 hours"], ["48h", "Last 48 hours"], ["5d", "Last 5 days"]]) {
    assert.match(studio, new RegExp(`\\["${value}", "${label}"\\]`));
  }

  const originalFetch = globalThis.fetch;
  const windows = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/graphql")) {
      const variables = JSON.parse(options.body).variables;
      if (variables.filter) windows.push([variables.filter.datetime_geq, variables.filter.datetime_lt]);
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ pageloads: [], vitals: [] }] } } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    for (const value of ["1h", "24h", "36h", "48h", "5d"]) {
      const response = await handleAdminAnalytics(new Request(`https://example.com/api/admin/analytics?view=overview&range=${value}`, {
        headers: { authorization: "Bearer secret" },
      }), {
        SUBMISSIONS_ADMIN_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "site", CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
      });
      assert.equal((await response.json()).range, value);
    }
    const expectedHours = [1, 1, 24, 24, 36, 36, 48, 48, 120, 120];
    assert.deepEqual(windows.map(([start, end]) => (new Date(end) - new Date(start)) / (60 * 60 * 1000)), expectedHours);
    for (let index = 0; index < windows.length; index += 2) assert.equal(windows[index][0], windows[index + 1][1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio Analytics explains every tab and names the unit behind acquisition counts", () => {
  const studio = readFileSync(join(ROOT, "studio", "analytics.js"), "utf8");
  const css = readFileSync(join(ROOT, "studio", "analytics.css"), "utf8");
  for (const view of ["overview", "journeys", "acquisition", "performance", "tattoo-specials"]) {
    assert.match(studio, new RegExp(`analyticsKey\\("${view}"\\)`));
  }
  assert.match(studio, /How to read this tab/);
  assert.match(studio, /utm_medium values such as paid\. Each number is an attributed page-view count, not people, clicks, leads, or bookings\./);
  assert.match(studio, /utm_campaign labels such as aug_specials\. Each number is an attributed page-view count/);
  assert.match(studio, /Recorded exit[\s\S]*internal navigation, not the session's final page/);
  assert.match(studio, /P75[\s\S]*75% of recorded experiences/);
  assert.match(studio, /Sampled estimate[\s\S]*may appear in round increments/);
  assert.match(css, /\.analytics-key-grid\s*\{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:620px\)[\s\S]*\.analytics-key-grid\s*\{\s*grid-template-columns:1fr/);
});

test("overview ranks page activity by Eastern clock hour without identifying people", () => {
  const studio = readFileSync(join(ROOT, "studio", "analytics.js"), "utf8");
  const api = readFileSync(join(ROOT, "functions", "api", "analytics", "_lib.js"), "utf8");
  assert.match(studio, /Most-viewed pages/);
  assert.match(studio, /Activity by time of day/);
  assert.match(studio, /Busiest page and time combinations/);
  assert.match(studio, /Counts are page views and anonymous tab sessions, not identified people/);
  assert.match(api, /formatDateTime\(timestamp, '%H', 'America\/New_York'\) hour_of_day/);
  assert.match(api, /GROUP BY hour_of_day,path ORDER BY page_views DESC/);
  assert.match(api, /count\(DISTINCT index1\) sessions/);
});

test("Cloudflare RUM keeps adaptive estimates without multiplying sample intervals again", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/graphql")) return new Response(JSON.stringify({ data: { viewer: { accounts: [{
      pageloads: [{ count: 10, avg: { sampleInterval: 2 }, sum: { visits: 3 }, dimensions: { date: "2026-07-20", requestPath: "/home/" } }],
      vitals: [{ count: 4, quantiles: { largestContentfulPaintP75: 2100000, interactionToNextPaintP75: 180000, cumulativeLayoutShiftP75: -1 } }],
    }] } } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=7d", {
      headers: { authorization: "Bearer secret" },
    }), {
      SUBMISSIONS_ADMIN_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "site", CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
    });
    const payload = await response.json();
    assert.equal(payload.rum.pageViews, 10);
    assert.equal(payload.rum.visits, 3);
    assert.equal(payload.rum.series[0].sampled, true);
    assert.equal(payload.rum.series[0].maxSampleInterval, 2);
    assert.deepEqual(payload.rum.sampling, { sampled: true, maxInterval: 2 });
    assert.equal(payload.rum.vitals.lcp, 2100);
    assert.equal(payload.rum.vitals.inp, 180);
    assert.equal(payload.rum.vitals.cls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("12-month RUM views clamp live requests to available history and report partial coverage", async () => {
  const originalFetch = globalThis.fetch;
  const starts = [];
  const sqlBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/graphql")) {
      const body = JSON.parse(options.body);
      starts.push(body.variables.filter?.datetime_geq || body.variables.vitalsFilter?.datetime_geq);
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ pageloads: [], vitals: [] }] } } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    sqlBodies.push(String(options.body || ""));
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=12m", {
      headers: { authorization: "Bearer secret" },
    }), {
      SUBMISSIONS_ADMIN_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: "site", CLOUDFLARE_ANALYTICS_API_TOKEN: "token",
    });
    const payload = await response.json();
    assert.equal(payload.sources.rum.state, "partial");
    assert.equal(payload.state, "partial");
    assert.ok(starts.every((value) => !value || Date.now() - new Date(value).getTime() <= 181 * 24 * 60 * 60 * 1000));
    assert.ok(sqlBodies.every((body) => !/toDateTime\('[^']*\.\d{3}Z'\)/.test(body)));
    assert.ok(sqlBodies.every((body) => !/toString\s*\(/i.test(body)));
    assert.ok(sqlBodies.some((body) => body.includes("formatDateTime(timestamp, '%Y-%m-%d', 'Etc/UTC')")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed live sources use stale aggregates and never manufacture zero", async () => {
  const rows = [
    { day: "2026-07-19", source: "rum", metric: "page_views", dimension_a: "", dimension_b: "", value: 42, sample_count: 42, updated_at: "2026-07-20T01:00:00Z" },
    { day: "2026-07-19", source: "rum", metric: "visits", dimension_a: "", dimension_b: "", value: 30, sample_count: 30, updated_at: "2026-07-20T01:00:00Z" },
    { day: "2026-07-19", source: "custom", metric: "engaged_sessions", dimension_a: "", dimension_b: "", value: 18, sample_count: 18, updated_at: "2026-07-20T01:00:00Z" },
  ];
  const database = { prepare() { return { bind() { return this; }, async all() { return { results: rows }; } }; } };
  const response = await handleAdminAnalytics(new Request("https://example.com/api/admin/analytics?view=overview&range=7d", {
    headers: { authorization: "Bearer secret" },
  }), { SUBMISSIONS_ADMIN_TOKEN: "secret", SUBMISSIONS_DB: database });
  const payload = await response.json();
  assert.equal(payload.state, "stale");
  assert.equal(payload.dataThrough, "2026-07-19");
  assert.equal(payload.rum.pageViews, 42);
  assert.equal(payload.rum.visits, 30);
  assert.equal(payload.custom.engagedSessions, 18);
  assert.equal(payload.sources.rum.state, "stale");
});

test("scheduled rollup applies the 366-day retention boundary", async () => {
  const sql = [];
  const today = "2026-07-21";
  const database = {
    prepare(statement) {
      sql.push(statement);
      return {
        bind() { return this; },
        async run() { return { success: true }; },
        async first() { return { last_complete_day: today }; },
      };
    },
  };
  const result = await rollupSiteAnalytics({ SUBMISSIONS_DB: database }, new Date("2026-07-21T12:00:00Z"));
  assert.equal(result.ok, true);
  assert.ok(sql.some((statement) => statement.includes("DELETE FROM site_analytics_daily") && statement.includes("-366 days")));
});

test("scheduled rollup does not advance a source when its live read fails", async () => {
  const database = {
    prepare() {
      return {
        bind() { return this; }, async run() { return { success: true }; }, async first() { return null; },
      };
    },
  };
  const result = await rollupSiteAnalytics({ SUBMISSIONS_DB: database }, new Date("2026-07-21T12:00:00Z"));
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.map((row) => row.state), ["error", "error"]);
  assert.equal(result.results.some((row) => row.state === "complete"), false);
});

test("analytics migration stores aggregates, not session rows", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(join(ROOT, "migrations", "0066_site_analytics.sql"), "utf8"));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["site_analytics_daily", "site_analytics_rollup_state"]);
  const columns = database.prepare("PRAGMA table_info(site_analytics_daily)").all().map((row) => row.name);
  assert.equal(columns.includes("session_id"), false);
  assert.ok(columns.includes("day") && columns.includes("metric") && columns.includes("dimension_a"));
  database.close();
});

test("collector and Studio preserve the privacy and console boundaries", () => {
  const collector = readFileSync(join(ROOT, "js", "site-analytics.js"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "analytics.js"), "utf8");
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  const consoleHtml = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  assert.match(collector, /sessionStorage/);
  assert.doesNotMatch(collector, /localStorage|document\.cookie/);
  assert.match(collector, /\/api\/analytics\/events/);
  assert.match(collector, /preview|noindex|localhost/);
  assert.doesNotMatch(studio, /fetch\([^\n]*(?:api\/submissions|api\/crm|api\/booking)/i);
  assert.match(studio, /api\/admin\/analytics/);
  assert.match(worker, /HTMLRewriter/);
  assert.match(worker, /site-analytics\.js/);
  assert.match(readFileSync(join(ROOT, "functions", "api", "analytics", "_lib.js"), "utf8"), /\$accountTag: String!/);
  assert.match(consoleHtml, />Analytics</);
  for (const view of ["overview", "journeys", "acquisition", "performance", "tattoo-specials"]) assert.match(studio, new RegExp(view));
});

test("Studio keeps analytics state out of the shared console URL", () => {
  const studio = readFileSync(join(ROOT, "studio", "analytics.js"), "utf8");
  const consoleHtml = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const location = {
    hash: "#analytics/overview?range=30d&device=all",
    pathname: "/studio/submissions/",
    search: "?preview=1",
  };
  const replacedUrls = [];
  const history = {
    state: {},
    replaceState(_state, _title, url) {
      replacedUrls.push(url);
      location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    },
  };
  const window = {};

  runInNewContext(studio, { window, location, history, URLSearchParams });
  assert.equal(window.StudioAnalytics.hashState().active, true);
  window.StudioAnalytics.clearHash();
  assert.deepEqual(replacedUrls, ["/studio/submissions/?preview=1"]);
  assert.equal(location.hash, "");

  location.hash = "#unrelated";
  window.StudioAnalytics.clearHash();
  assert.equal(replacedUrls.length, 1);
  assert.doesNotMatch(studio, /function writeHash|writeHash\(/);
  assert.match(studio, /currentState = next/);
  assert.match(consoleHtml, /activeTab !== "analytics"\) window\.StudioAnalytics\?\.clearHash\?\.\(\)/);
});
