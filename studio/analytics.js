(function studioAnalytics(global) {
  "use strict";

  var CACHE_MS = 5 * 60 * 1000;
  var cache = new Map();
  var lastByView = new Map();
  var currentContext = null;
  var currentState = { view: "overview", range: "30d", device: "all", group: "", campaign: "" };
  var exclusionState = null;
  var chartSequence = 0;
  var RANGES = [["1h", "Last hour"], ["24h", "Last 24 hours"], ["36h", "Last 36 hours"], ["48h", "Last 48 hours"], ["5d", "Last 5 days"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["12m", "Last 12 months"]];
  var RANGE_VALUES = RANGES.map(function (option) { return option[0]; });
  var GROUPS = [["", "All content"], ["entry", "Entry"], ["home", "Home"], ["tattoos", "Tattoos"], ["art", "Art"], ["merch", "Merch"], ["events", "Events"], ["archive", "Archive"], ["about", "About"], ["booking", "Booking"]];
  var VIEW_TITLES = { overview: "Site overview", journeys: "Visitor journeys", acquisition: "Audience acquisition", performance: "Site performance", "tattoo-specials": "Tattoo Specials interest" };
  var VIEW_KEYS = {
    overview: {
      summary: "Traffic and attention during the selected range. One person can create several page views, and no persistent visitor identity is used.",
      items: [
        ["Visits", "Entry visits reported by Cloudflare. This is not a permanent count of unique people."],
        ["Page views", "Public page loads reported by Cloudflare. One visit can include several page views."],
        ["Sampled estimate", "Cloudflare retains unsampled Web Analytics data for seven days, then may estimate older totals from a sample. Estimated values are already adjusted by Cloudflare and may appear in round increments."],
        ["Engaged sessions", "Anonymous browser-tab sessions with at least 10 seconds of active page time."],
        ["Average active time", "Average time a page remained visible in the active tab before exit."],
        ["Previous period", "The immediately preceding window of the same length as the selected range."],
        ["Content groups", "Page views grouped into major public areas such as Tattoos, Archive, or Events."],
        ["Activity hour", "First-party page views grouped by Eastern clock hour and ranked from busiest to quietest."],
        ["Anonymous sessions", "Distinct browser-tab sessions active in a group. This is not a persistent count of people."],
      ],
    },
    journeys: {
      summary: "Anonymous movement through public pages. A session lasts only within one browser tab and is not connected to a contact or booking record.",
      items: [
        ["Entry page", "The first public page recorded in an anonymous tab session."],
        ["Recorded exit", "A page that was hidden or unloaded. It may be an internal navigation, not the session's final page."],
        ["Page-to-page move", "A recorded previous page followed by the next public page in the same tab."],
        ["Active", "Visible-tab time recorded for that page before exit."],
        ["Scroll", "The average deepest percentage of the page reached before exit."],
        ["Section reach", "A section visible by at least 50% for at least one second."],
        ["Milestone", "A deliberately tracked interaction such as opening, starting, or completing an experience."],
      ],
    },
    acquisition: {
      summary: "How public page views arrived. Campaign tags remain attached only within the anonymous browser-tab session that opened the tagged link.",
      items: [
        ["Count", "The number of attributed page views, not individual people, ad clicks, leads, or bookings."],
        ["Referrer", "The external website domain that sent the visit. Full referring URLs are not retained."],
        ["UTM source", "The value of utm_source, usually the platform or sender, such as instagram or newsletter."],
        ["UTM medium", "The value of utm_medium, describing the channel type. For example, paid means the link was tagged as paid traffic."],
        ["UTM campaign", "The value of utm_campaign, naming the promotion. For example, aug_specials identifies that campaign."],
        ["Audience attributes", "Country, device, browser, and operating system are aggregate Cloudflare page-load measurements."],
      ],
    },
    performance: {
      summary: "Real-user loading, responsiveness, and visual-stability measurements from Cloudflare. Lower values are better for every metric shown.",
      items: [
        ["P75", "The 75th percentile: 75% of recorded experiences were at or below this value."],
        ["LCP", "Largest Contentful Paint: how quickly the main visible content appeared."],
        ["INP", "Interaction to Next Paint: how quickly the page responded to an interaction."],
        ["CLS", "Cumulative Layout Shift: how much visible content moved unexpectedly. This score is unitless."],
        ["FCP", "First Contentful Paint: how quickly the first visible content appeared."],
        ["Page load", "Time until the browser reported the page load complete."],
        ["Samples", "The number of Cloudflare measurements supporting a page row."],
        ["Status colors", "Green is good, amber needs improvement, red is poor, and gray means no rating is available."],
      ],
    },
    "tattoo-specials": {
      summary: "Anonymous interest in each published Tattoo Specials campaign. Recognition ends with the browser tab and is never connected to a contact, request, booking, or payment record.",
      items: [
        ["Campaign visitor", "A browser-tab session in which a current internal Tattoo Specials campaign was loaded."],
        ["Interested session", "A browser-tab session that selected at least one special. Repeated clicks do not create another session."],
        ["Offer view", "A special card that remained at least 50% visible for one second."],
        ["Selection clicks", "Every click selecting a special, including repeated clicks. Selecting sessions count each tab once per special."],
        ["Form started", "The first actual edit to the request form after selecting a special."],
        ["Step conversion", "The share of sessions at one stage that reached the next stage. A later stage can occasionally exceed an earlier one when browser events are blocked or interrupted."],
        ["Deepest point", "The last recorded stage reached in each anonymous tab session. It indicates where interest stopped, not why."],
        ["Compared specials", "A tab session that selected two or more different specials. Paths combine only the ordered special titles; tab IDs are never returned."],
        ["Request accepted", "A successful Tattoo Specials API response also recorded by browser analytics. Authoritative request, deposit, booking, and cancellation totals remain in the campaign manager."],
        ["Internal campaign", "The stable campaign record managed in Studio. This is separate from the optional utm_campaign label attached to an incoming promotional link."],
        ["Identity boundary", "One anonymous ID exists only in sessionStorage for the current browser tab. Closing the tab ends recognition; another tab or browser counts separately."],
        ["Privacy boundary", "No names, contact details, dates of birth, answers, URLs, filenames, reference files, or uploads are collected here."],
      ],
    },
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, function (char) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]; });
  }

  function number(value, digits) {
    if (value == null || value === "") return "\u2014";
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "\u2014";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits == null ? 0 : digits }).format(amount);
  }

  function duration(value) {
    if (value == null || value === "") return "\u2014";
    var seconds = Number(value);
    if (seconds < 60) return number(seconds, 1) + "s";
    return number(seconds / 60, 1) + "m";
  }

  function hourLabel(value) {
    var hour = Math.max(0, Math.min(23, Number(value) || 0));
    return (hour % 12 || 12) + " " + (hour >= 12 ? "PM" : "AM") + " ET";
  }

  function dataThrough(value) {
    if (!value) return "not available";
    if (!String(value).includes("T")) return String(value);
    var timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? String(value) : timestamp.toLocaleString();
  }

  function pctChange(current, previous) {
    if (current == null || previous == null || previous === "") return { text: "Previous period unavailable", direction: "" };
    current = Number(current); previous = Number(previous);
    if (!previous) return { text: "No previous-period baseline", direction: "" };
    var amount = ((current - previous) / previous) * 100;
    return { text: (amount >= 0 ? "+" : "") + number(amount, 1) + "% from previous period", direction: amount > 0 ? "up" : amount < 0 ? "down" : "" };
  }

  function readHash() {
    var match = location.hash.match(/^#analytics\/(overview|journeys|acquisition|performance|tattoo-specials)(?:\?(.*))?$/);
    var params = new URLSearchParams(match?.[2] || "");
    return {
      active: Boolean(match), view: match?.[1] || "overview",
      range: RANGE_VALUES.includes(params.get("range")) ? params.get("range") : "30d",
      device: ["all", "desktop", "mobile", "tablet"].includes(params.get("device")) ? params.get("device") : "all",
      group: /^[a-z0-9-]{0,48}$/.test(params.get("group") || "") ? params.get("group") || "" : "",
      campaign: /^[a-z0-9_-]{0,120}$/.test(params.get("campaign") || "") ? params.get("campaign") || "" : "",
    };
  }

  function clearHash() {
    if (!readHash().active) return;
    history.replaceState(history.state, "", location.pathname + location.search);
  }

  function sourceMarkup(payload) {
    var sources = Object.entries(payload.sources || {});
    if (!sources.length) return "";
    return '<div class="analytics-source-list">' + sources.map(function ([name, source]) {
      var state = source.state || (source.ready ? "current" : "unavailable");
      var updated = source.dataThrough ? " through " + dataThrough(source.dataThrough) : "";
      return '<span class="analytics-source" data-ready="' + Boolean(source.ready) + '" title="' + escapeHtml(source.error || "Data source ready") + '">' + escapeHtml(name === "rum" ? "Cloudflare RUM" : "Site engagement") + ": " + escapeHtml(state + updated) + "</span>";
    }).join("") + "</div>";
  }

  function stateMarkup(payload, stale) {
    var state = stale ? "stale" : payload.state || "unavailable";
    var copy = stale ? "Showing the last successful snapshot because the refresh failed." : state === "current" ? "All requested analytics sources are current." : state === "partial" ? "Some sources are unavailable; available data remains visible." : state === "stale" ? "Showing the last stored daily aggregates; live sources are unavailable." : "Analytics sources are not configured or currently unavailable.";
    return '<div class="analytics-state" data-state="' + state + '" role="status"><div><strong>' + escapeHtml(state) + "</strong><br>" + escapeHtml(copy) + "</div>" + sourceMarkup(payload) + "</div>";
  }

  function filtersMarkup(state, payload) {
    var thirdFilter = state.view === "tattoo-specials"
      ? select("analyticsCampaign", "Internal campaign", [["", "All campaigns"]].concat((payload.catalog?.campaigns || payload.custom?.campaigns || []).map(function (item) { return [item.id, item.title || item.id]; })), state.campaign)
      : select("analyticsGroup", "Content", GROUPS, state.group);
    return '<div class="analytics-filters" aria-label="Analytics filters">' +
      select("analyticsRange", "Range", RANGES, state.range) +
      select("analyticsDevice", "Device", [["all", "All devices"], ["desktop", "Desktop"], ["mobile", "Mobile"], ["tablet", "Tablet"]], state.device) +
      thirdFilter +
      '<div class="analytics-updated">Data through ' + escapeHtml(dataThrough(payload.dataThrough)) + "<br>Updated " + escapeHtml(new Date(payload.generatedAt || Date.now()).toLocaleString()) + "</div></div>";
  }

  function select(id, label, options, selected) {
    return '<div class="analytics-filter"><label for="' + id + '">' + escapeHtml(label) + '</label><select id="' + id + '" data-select-menu-skip>' + options.map(function (option) { return '<option value="' + escapeHtml(option[0]) + '"' + (option[0] === selected ? " selected" : "") + ">" + escapeHtml(option[1]) + "</option>"; }).join("") + "</select></div>";
  }

  function kpi(label, value, current, previous, formatter) {
    var comparison = pctChange(current, previous);
    return '<div class="analytics-kpi"><span class="analytics-kpi-label">' + escapeHtml(label) + '</span><strong class="analytics-kpi-value">' + escapeHtml(formatter ? formatter(value) : number(value)) + '</strong><span class="analytics-kpi-compare" data-direction="' + comparison.direction + '">' + escapeHtml(comparison.text) + "</span></div>";
  }

  function panel(title, note, body, extraClass) {
    return '<section class="analytics-panel ' + (extraClass || "") + '"><div class="analytics-panel-head"><div><h3>' + escapeHtml(title) + '</h3><p class="analytics-panel-note">' + escapeHtml(note || "") + "</p></div></div>" + body + "</section>";
  }

  function analyticsKey(view) {
    var key = VIEW_KEYS[view] || VIEW_KEYS.overview;
    var titleId = "analytics-key-title-" + view;
    return '<aside class="analytics-key" aria-labelledby="' + titleId + '"><div class="analytics-key-head"><p class="analytics-key-eyebrow">Data key</p><h3 id="' + titleId + '">How to read this tab</h3><p>' + escapeHtml(key.summary) + '</p></div><dl class="analytics-key-grid">' + key.items.map(function (item) {
      return '<div class="analytics-key-item"><dt>' + escapeHtml(item[0]) + '</dt><dd>' + escapeHtml(item[1]) + '</dd></div>';
    }).join("") + "</dl></aside>";
  }

  function barList(items, empty) {
    items = (items || []).filter(function (item) { return Number(item.value || 0) > 0; }).slice(0, 12);
    if (!items.length) return '<p class="analytics-empty">' + escapeHtml(empty || "No data in this range.") + "</p>";
    var max = Math.max.apply(null, items.map(function (item) { return Number(item.value || 0); }));
    return '<div class="analytics-bars">' + items.map(function (item) {
      var width = Math.max(2, (Number(item.value || 0) / max) * 100);
      return '<div class="analytics-bar-row"><span class="analytics-bar-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label || "Unknown") + '</span><span class="analytics-bar-track" aria-hidden="true"><span class="analytics-bar-fill" style="width:' + width.toFixed(2) + '%"></span></span><strong class="analytics-bar-value">' + number(item.value) + "</strong></div>";
    }).join("") + "</div>";
  }

  function interestKpi(label, value, note) {
    return '<div class="analytics-kpi"><span class="analytics-kpi-label">' + escapeHtml(label) + '</span><strong class="analytics-kpi-value">' + escapeHtml(number(value)) + '</strong><span class="analytics-kpi-compare">' + escapeHtml(note) + "</span></div>";
  }

  function interestStages(items, valueKey, empty) {
    items = items || [];
    if (!items.length) return '<p class="analytics-empty">' + escapeHtml(empty || "No stage activity in this range.") + "</p>";
    var max = Math.max(1, ...items.map(function (item) { return Number(item[valueKey] || 0); }));
    return '<div class="analytics-stage-list">' + items.map(function (item, index) {
      var value = Number(item[valueKey] || 0);
      var width = value ? Math.max(2, (value / max) * 100) : 0;
      var conversion = valueKey === "sessions" && index ? number(item.fromPreviousPercent, 1) + "% from prior stage" : valueKey === "sessions" ? "Journey entry" : "sessions stopped here";
      return '<div class="analytics-stage-row"><div class="analytics-stage-copy"><strong>' + escapeHtml(item.label) + '</strong><span>' + escapeHtml(conversion) + '</span></div><span class="analytics-stage-track" aria-hidden="true"><span style="width:' + width.toFixed(2) + '%"></span></span><strong class="analytics-stage-value">' + number(value) + "</strong></div>";
    }).join("") + "</div>";
  }

  function lineChart(points, series, title) {
    points = points || [];
    if (!points.length) return '<p class="analytics-empty">No time-series data is available for this range.</p>';
    var width = 760, height = 250, left = 42, right = 72, top = 24, bottom = 36;
    var allValues = [];
    series.forEach(function (item) { points.forEach(function (point) { allValues.push(Number(point[item.key] || 0)); }); });
    var max = Math.max(1, Math.max.apply(null, allValues));
    var plotWidth = width - left - right, plotHeight = height - top - bottom;
    function x(index) { return left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth); }
    function y(value) { return top + plotHeight - (Number(value || 0) / max) * plotHeight; }
    var paths = series.map(function (item, seriesIndex) {
      var d = points.map(function (point, index) { return (index ? "L" : "M") + x(index).toFixed(1) + " " + y(point[item.key]).toFixed(1); }).join(" ");
      var last = points[points.length - 1];
      return '<path class="analytics-chart-line ' + (seriesIndex ? "compare" : "") + '" d="' + d + '"></path><text class="analytics-chart-value" x="' + (width - right + 10) + '" y="' + (y(last[item.key]) + 4) + '">' + escapeHtml(item.label) + " " + number(last[item.key]) + "</text>";
    }).join("");
    var grid = [0, .5, 1].map(function (ratio) { var yy = top + plotHeight * ratio; return '<line class="analytics-chart-grid" x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '"></line><text class="analytics-chart-label" x="0" y="' + (yy + 4) + '">' + number(max * (1 - ratio)) + "</text>"; }).join("");
    var labels = '<text class="analytics-chart-label" x="' + left + '" y="' + (height - 7) + '">' + escapeHtml(points[0].date || "") + '</text><text class="analytics-chart-label" text-anchor="end" x="' + (width - right) + '" y="' + (height - 7) + '">' + escapeHtml(points[points.length - 1].date || "") + "</text>";
    var titleId = "analytics-chart-title-" + (++chartSequence);
    return '<div class="analytics-chart"><svg role="img" aria-labelledby="' + titleId + '" viewBox="0 0 ' + width + " " + height + '"><title id="' + titleId + '">' + escapeHtml(title) + "</title>" + grid + paths + labels + "</svg></div>";
  }

  function dataTable(headers, rows, empty) {
    if (!rows?.length) return '<p class="analytics-empty">' + escapeHtml(empty || "No data in this range.") + "</p>";
    return '<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr>' + headers.map(function (header) { return "<th>" + escapeHtml(header) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (row) {
      return "<tr>" + row.map(function (cell, index) { return '<td data-label="' + escapeHtml(headers[index]) + '">' + cell + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  }

  function sourceTable(points, columns) {
    return '<details class="analytics-details"><summary>Accessible data table</summary>' + dataTable(columns.map(function (column) { return column.label; }), points.map(function (point) { return columns.map(function (column) { return escapeHtml(column.format ? column.format(point[column.key]) : point[column.key]); }); })) + "</details>";
  }

  function renderOverview(payload) {
    var rum = payload.rum || {}, custom = payload.custom || {}, previous = payload.comparison || {};
    var series = rum.series || [];
    var sampling = rum.sampling || {};
    var trafficDescription = sampling.sampled
      ? "Cloudflare-reported page views and entry visits. Older rows marked Sampled estimate are extrapolated by Cloudflare and may appear in round increments; the dashboard does not multiply them again."
      : "Cloudflare-reported page views and entry visits. Rows in this range were not sampled.";
    var pages = (custom.pageActivity || []).map(function (item) { return ["<strong>" + escapeHtml(item.path) + "</strong>", number(item.pageViews), number(item.sessions)]; });
    var hours = (custom.activityByHour || []).map(function (item) { return ["<strong>" + escapeHtml(hourLabel(item.hour)) + "</strong>", number(item.pageViews), number(item.sessions)]; });
    var pageHours = (custom.activityByPageHour || []).map(function (item) { return ["<strong>" + escapeHtml(hourLabel(item.hour)) + "</strong>", escapeHtml(item.path), number(item.pageViews), number(item.sessions)]; });
    return analyticsKey("overview") + '<div class="analytics-kpis">' +
      kpi("Visits", rum.visits, rum.visits, previous.visits) +
      kpi("Page views", rum.pageViews, rum.pageViews, previous.pageViews) +
      kpi("Engaged sessions", custom.engagedSessions, custom.engagedSessions, previous.engagedSessions) +
      kpi("Average active time", custom.avgActiveSeconds, custom.avgActiveSeconds, previous.avgActiveSeconds, duration) +
      '</div><div class="analytics-grid">' +
      panel("Traffic over time", trafficDescription, lineChart(series, [{ key: "pageViews", label: "Views" }, { key: "visits", label: "Visits" }], "Page views and visits over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "pageViews", label: "Page views" }, { key: "visits", label: "Visits" }, { key: "sampled", label: "Data quality", format: function (sampled) { return sampled ? "Sampled estimate" : "Unsampled"; } }])) +
      '<div class="analytics-stack">' + panel("Content groups", "The public areas receiving the most attention.", barList(rum.contentGroups?.length ? rum.contentGroups : custom.contentGroups, "Content activity will appear after collection begins.")) + vitalPanel(rum.vitals || {}) + "</div></div>" +
      '<div class="analytics-grid equal" style="margin-top:16px">' +
      panel("Most-viewed pages", "First-party page views and anonymous browser-tab sessions during the selected range.", dataTable(["Page", "Page views", "Anonymous sessions"], pages, "Page activity will appear after collection begins.")) +
      panel("Activity by time of day", "First-party page-view activity grouped by Eastern clock hour and ranked busiest first.", dataTable(["Time (ET)", "Page views", "Anonymous sessions"], hours, "Hourly activity will appear after collection begins.")) + "</div>" +
      '<div style="margin-top:16px">' + panel("Busiest page and time combinations", "The pages and Eastern clock hours receiving the most activity. Counts are page views and anonymous tab sessions, not identified people.", dataTable(["Time (ET)", "Page", "Page views", "Anonymous sessions"], pageHours, "Page-and-time activity will appear after collection begins.")) + "</div>";
  }

  function rating(metric, value) {
    value = Number(value || 0);
    if (!value) return "unknown";
    if (metric === "cls") return value <= .1 ? "good" : value <= .25 ? "needs" : "poor";
    if (metric === "inp") return value <= 200 ? "good" : value <= 500 ? "needs" : "poor";
    if (metric === "fcp") return value <= 1800 ? "good" : value <= 3000 ? "needs" : "poor";
    if (metric === "load") return "unknown";
    return value <= 2500 ? "good" : value <= 4000 ? "needs" : "poor";
  }

  function vitalPanel(vitals) {
    var items = [["LCP", "lcp", "ms"], ["INP", "inp", "ms"], ["CLS", "cls", ""]];
    return panel("Core Web Vitals", "P75 real-user experience from Cloudflare Web Analytics.", '<div class="analytics-bars">' + items.map(function (item) { var value = Number(vitals[item[1]] || 0); return '<div class="analytics-bar-row"><span class="analytics-vital" data-rating="' + rating(item[1], value) + '">' + item[0] + '</span><span></span><strong class="analytics-bar-value">' + (value ? number(value, item[1] === "cls" ? 3 : 0) + item[2] : "—") + "</strong></div>"; }).join("") + "</div>");
  }

  function renderJourneys(payload) {
    var data = payload.custom || {};
    var transitions = (data.transitions || []).map(function (item) { return ["<strong>" + escapeHtml(item.source) + "</strong>", escapeHtml(item.destination), number(item.value)]; });
    var engagement = (data.engagement || []).map(function (item) { return ["<strong>" + escapeHtml(item.path) + "</strong>", duration(item.activeSeconds), number(item.scroll, 0) + "%", number(item.value)]; });
    var milestones = (data.milestones || []).map(function (item) { return ["<strong>" + escapeHtml(item.group || "Interactive") + "</strong>", escapeHtml(item.action || item.item || "milestone"), number(item.value)]; });
    return analyticsKey("journeys") + '<div class="analytics-grid equal">' +
      panel("Entry pages", "Where anonymous tab sessions begin.", barList(data.entries, "Journey data begins after the collector is deployed.")) +
      panel("Recorded exits", "Pages that were hidden or unloaded; an exit can be an internal navigation rather than the end of a session.", barList(data.exits, "Exit data begins after the collector is deployed.")) +
      panel("Page-to-page movement", "Ranked transitions; no persistent visitor identity is used.", dataTable(["From", "To", "Moves"], transitions, "No transitions recorded yet.")) +
      panel("Page engagement", "Average active time and maximum scroll recorded when each page exits.", dataTable(["Page", "Active", "Scroll", "Recorded exits"], engagement, "No engagement summaries recorded yet.")) +
      panel("Section reach", "Sections seen at least 50% for one second.", barList((data.sections || []).map(function (item) { return { label: item.path + " · " + item.label, value: item.value }; }), "No declared sections recorded yet.")) +
      panel("Interactive milestones", "Entry, homepage, Archive, Legend, Portfolio, and Build activity.", dataTable(["Surface", "Milestone", "Count"], milestones, "No interactive milestones recorded yet.")) + "</div>";
  }

  function renderAcquisition(payload) {
    var rum = payload.rum || {}, custom = payload.custom || {};
    var series = rum.series || [];
    return analyticsKey("acquisition") + '<div class="analytics-grid">' +
      panel("Audience trend", "Real-user page loads captured by Cloudflare Web Analytics.", lineChart(series, [{ key: "views", label: "Views" }], "Audience page loads over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "views", label: "Views" }])) +
      '<div class="analytics-stack">' + panel("Referrer domains", "External domains that sent page loads; complete referring URLs are not retained.", barList(rum.referrers)) + panel("Campaign sources", "utm_source values. Each number is an attributed page-view count, not a visitor or click count.", barList(custom.utmSources, "No UTM-tagged page views recorded yet.")) + "</div></div>" +
      '<div class="analytics-grid equal" style="margin-top:16px">' + panel("Countries", "Country-level page-load aggregate only.", barList(rum.countries)) + panel("Devices", "Cloudflare page loads grouped by device classification.", barList(rum.devices)) + panel("Browsers", "Cloudflare page loads grouped by browser.", barList(rum.browsers)) + panel("Operating systems", "Cloudflare page loads grouped by operating system.", barList(rum.operatingSystems)) + panel("UTM media", "utm_medium values such as paid. Each number is an attributed page-view count, not people, clicks, leads, or bookings.", barList(custom.utmMedia)) + panel("UTM campaigns", "utm_campaign labels such as aug_specials. Each number is an attributed page-view count; click identifiers are never retained.", barList(custom.campaigns)) + "</div>";
  }

  function renderPerformance(payload) {
    var rum = payload.rum || {}, summary = rum.summary || {}, series = rum.series || [];
    var paths = (rum.paths || []).map(function (item) { return ["<strong>" + escapeHtml(item.path) + "</strong>", vitalValue("lcp", item.lcp), vitalValue("inp", item.inp), vitalValue("cls", item.cls), item.fcp ? number(item.fcp) + "ms" : "—", item.pageLoad ? number(item.pageLoad) + "ms" : "—", number(item.samples)]; });
    return analyticsKey("performance") + '<div class="analytics-kpis analytics-kpis-performance">' +
      performanceKpi("LCP P75", "lcp", summary.lcp) + performanceKpi("INP P75", "inp", summary.inp) + performanceKpi("CLS P75", "cls", summary.cls) + performanceKpi("FCP P75", "fcp", summary.fcp) + performanceKpi("Page load P75", "load", summary.pageLoad) +
      '</div><div class="analytics-grid">' +
      panel("Core Web Vitals trend", "P75 values from real visitor sessions. LCP and INP use milliseconds; CLS is unitless.", lineChart(series, [{ key: "lcp", label: "LCP" }, { key: "inp", label: "INP" }], "Core Web Vitals over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "lcp", label: "LCP", format: function (value) { return number(value) + "ms"; } }, { key: "inp", label: "INP", format: function (value) { return number(value) + "ms"; } }, { key: "cls", label: "CLS", format: function (value) { return number(value, 3); } }])) +
      vitalPanel(summary) + "</div>" +
      '<div style="margin-top:16px">' + panel("Performance by page", "Ranked by P75 LCP. Essential values remain available without hover.", dataTable(["Page", "LCP", "INP", "CLS", "FCP", "Load", "Samples"], paths, "Performance detail is not available for this range.")) + "</div>" +
      '<p class="analytics-caveat">Cloudflare may adaptively sample Web Analytics data. Detailed problematic-element selectors are shown only when the account dataset exposes them; page-level diagnostics remain available otherwise.</p>';
  }

  function renderTattooSpecials(payload) {
    var data = payload.custom || {};
    var campaignFilter = payload.filters?.campaign || "";
    var campaignNames = new Map((payload.catalog?.campaigns || data.campaigns || []).map(function (item) { return [item.id, item.title || item.id]; }));
    var offers = (data.offers || []).filter(function (item) { return !campaignFilter || item.campaignId === campaignFilter; });
    var offerRows = offers.map(function (item) {
      return ["<strong>" + escapeHtml(item.title || item.id) + "</strong>", escapeHtml(campaignNames.get(item.campaignId) || item.campaignId || "Unknown"), number(item.viewedSessions), number(item.selectionClicks), number(item.selectingSessions), number(item.formStarts), number(item.acceptedRequests), number(item.selectionRatePercent, 1) + "%"];
    });
    var pathRows = (data.paths || []).filter(function (item) { return !campaignFilter || item.campaignId === campaignFilter; }).map(function (item) {
      return ["<strong>" + escapeHtml(item.label) + "</strong>", escapeHtml(campaignNames.get(item.campaignId) || item.campaignId || "Unknown"), number(item.sessions)];
    });
    var campaignRows = (data.campaigns || []).filter(function (item) { return !campaignFilter || item.id === campaignFilter; }).map(function (item) {
      return ["<strong>" + escapeHtml(item.title || item.id) + "</strong>", number(item.visitors), number(item.interestedSessions), number(item.formStarts), number(item.acceptedRequests), number(item.comparedSessions)];
    });
    return analyticsKey("tattoo-specials") + '<div class="analytics-kpis analytics-kpis-interest">' +
      interestKpi("Page entries", data.pageEntries, "Anonymous tabs entering this page") +
      interestKpi("Campaign visitors", data.campaignVisitors, "Campaign opened in a tab") +
      interestKpi("Interested sessions", data.interestedSessions, "Selected at least one special") +
      interestKpi("Form starts", data.formStarts, "First actual form edit") +
      interestKpi("Accepted requests", data.acceptedRequests, "Successful API response observed") +
      '</div><div class="analytics-grid equal">' +
      panel("Interest stages", "Unique anonymous tab sessions at each recorded stage. Conversion is measured from the immediately prior stage.", interestStages(data.stages, "sessions")) +
      panel("Deepest point reached", "Each tab session appears once at its last recorded stage, showing where the journey stopped.", interestStages(data.deepest, "sessions")) +
      '</div><div class="analytics-grid equal analytics-interest-grid">' +
      panel("Campaign summary", "Internal Studio campaign records during the selected range.", dataTable(["Campaign", "Visitors", "Interested", "Form starts", "Accepted", "Compared"], campaignRows, "No campaign activity is recorded in this range.")) +
      panel("Page engagement context", "Visible-tab time, maximum scroll, and supporting interest signals for the Tattoo Specials page.", '<dl class="analytics-context-list"><div><dt>Average active time</dt><dd>' + duration(data.avgActiveSeconds) + '</dd></div><div><dt>Average maximum scroll</dt><dd>' + number(data.avgScroll, 0) + '%</dd></div><div><dt>Recorded exits</dt><dd>' + number(data.recordedExits) + '</dd></div><div><dt>Compared multiple specials</dt><dd>' + number(data.comparedSessions) + '</dd></div><div><dt>Added a reference</dt><dd>' + number(data.referenceAddedSessions) + '</dd></div></dl>') +
      '</div><div class="analytics-interest-section">' +
      panel("Per-special interest", "Views and selecting sessions are unique tab-session counts; selection clicks include repeat clicks.", dataTable(["Special", "Campaign", "Views", "Selection clicks", "Selecting sessions", "Initial form starts", "Accepted", "Selection rate"], offerRows, "No per-special activity is recorded in this range.")) +
      '</div><div class="analytics-interest-section">' +
      panel("Selection paths", "Ordered combinations from sessions that selected two or more different specials. No tab identifiers are returned.", dataTable(["Path", "Campaign", "Sessions"], pathRows, "No sessions compared multiple specials in this range.")) +
      '</div>' + (data.truncated ? '<p class="analytics-caveat">This view reached its activity-row safety limit. Displayed aggregate detail is partial for the selected range.</p>' : "");
  }

  function vitalValue(metric, value) {
    value = Number(value || 0);
    return '<span class="analytics-vital" data-rating="' + rating(metric, value) + '">' + (value ? number(value, metric === "cls" ? 3 : 0) + (metric === "cls" ? "" : "ms") : "—") + "</span>";
  }

  function performanceKpi(label, metric, value) {
    return '<div class="analytics-kpi"><span class="analytics-kpi-label">' + label + '</span><strong class="analytics-kpi-value"><span class="analytics-vital" data-rating="' + rating(metric, value) + '">' + (value ? number(value, metric === "cls" ? 3 : 0) : "—") + '</span></strong><span class="analytics-kpi-compare">' + (metric === "cls" ? "Unitless score" : "Milliseconds") + "</span></div>";
  }

  function renderBody(payload) {
    if (payload.view === "tattoo-specials") return renderTattooSpecials(payload);
    if (payload.view === "journeys") return renderJourneys(payload);
    if (payload.view === "acquisition") return renderAcquisition(payload);
    if (payload.view === "performance") return renderPerformance(payload);
    return renderOverview(payload);
  }

  function exclusionMarkup() {
    if (exclusionState == null) return '<div class="analytics-exclusion"><span>Browser exclusion status unavailable</span></div>';
    return '<div class="analytics-exclusion" data-excluded="' + String(Boolean(exclusionState)) + '"><button class="button" type="button" data-analytics-exclusion>' + (exclusionState ? "This browser is excluded" : "Exclude this browser") + '</button><span>' + (exclusionState ? "Select to resume future browser analytics." : "Stops future first-party, RUM, and Meta browser tracking here.") + '</span><small>Each browser or profile must be marked separately. Existing analytics are not removed.</small></div>';
  }

  async function requestExclusion(context) {
    try {
      var response = await fetch("/api/admin/analytics/exclusion", { headers: { authorization: "Bearer " + context.token }, cache: "no-store" });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || "Exclusion status failed.");
      exclusionState = Boolean(payload.excluded);
    } catch (_) { exclusionState = null; }
  }

  async function setExclusion(context, excluded, button) {
    button.disabled = true;
    try {
      var response = await fetch("/api/admin/analytics/exclusion", {
        method: "PUT", headers: { authorization: "Bearer " + context.token, "content-type": "application/json" },
        body: JSON.stringify({ excluded: excluded }),
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || "Exclusion update failed.");
      exclusionState = Boolean(payload.excluded);
      render(context, false);
    } catch (error) {
      button.disabled = false;
      context.setStatus?.(error.message);
    }
  }

  function shellMarkup(state, payload, stale) {
    return '<div class="analytics-shell"><div class="analytics-head"><div><p class="analytics-eyebrow">Public website · anonymous aggregate</p><h2>' + escapeHtml(VIEW_TITLES[state.view]) + '</h2><p>Site behavior, audience, and performance only. This area does not read contacts, bookings, payments, revenue, or CRM records.</p></div><div class="analytics-head-actions"><button class="button analytics-refresh" type="button" data-analytics-refresh>Refresh analytics</button>' + exclusionMarkup() + "</div></div>" + stateMarkup(payload, stale) + '<div class="analytics-body">' + renderBody(payload) + "</div>" + filtersMarkup(state, payload) + "</div>";
  }

  function cacheKey(state) { return [state.view, state.range, state.device, state.group, state.campaign].join("|"); }

  async function requestPayload(context, state, force) {
    var key = cacheKey(state), cached = cache.get(key);
    if (!force && cached && Date.now() - cached.time < CACHE_MS) return { payload: cached.payload, stale: false };
    var params = new URLSearchParams({ view: state.view, range: state.range, device: state.device });
    if (state.group) params.set("group", state.group);
    if (state.view === "tattoo-specials" && state.campaign) params.set("campaign", state.campaign);
    try {
      var response = await fetch("/api/admin/analytics?" + params.toString(), { headers: { authorization: "Bearer " + context.token }, cache: "no-store" });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || "Analytics request failed.");
      cache.set(key, { time: Date.now(), payload: payload }); lastByView.set(key, payload);
      return { payload: payload, stale: false };
    } catch (error) {
      var last = lastByView.get(key);
      if (last) return { payload: last, stale: true, error: error };
      throw error;
    }
  }

  function bind(root, context, state) {
    root.querySelector("[data-analytics-refresh]")?.addEventListener("click", function () { render(context, true); });
    root.querySelector("[data-analytics-exclusion]")?.addEventListener("click", function (event) { setExclusion(context, !exclusionState, event.currentTarget); });
    ["analyticsRange", "analyticsDevice", "analyticsGroup", "analyticsCampaign"].forEach(function (id) {
      root.querySelector("#" + id)?.addEventListener("change", function () {
        var next = { ...state, range: root.querySelector("#analyticsRange").value, device: root.querySelector("#analyticsDevice").value, group: root.querySelector("#analyticsGroup")?.value || "", campaign: root.querySelector("#analyticsCampaign")?.value || "" };
        currentState = next;
        clearHash();
        render({ ...context, view: next.view }, false);
      });
    });
  }

  async function render(context, force) {
    currentContext = context;
    var hash = readHash();
    var state = {
      view: context.view || (hash.active ? hash.view : currentState.view) || "overview",
      range: hash.active ? hash.range : currentState.range,
      device: hash.active ? hash.device : currentState.device,
      group: hash.active ? hash.group : currentState.group,
      campaign: hash.active ? hash.campaign : currentState.campaign,
    };
    currentState = state;
    clearHash();
    context.root.innerHTML = '<div class="analytics-shell"><div class="analytics-head"><div><p class="analytics-eyebrow">Public website · anonymous aggregate</p><h2>' + escapeHtml(VIEW_TITLES[state.view]) + '</h2></div></div><p class="analytics-loading" role="status">Loading analytics…</p></div>';
    context.setStatus?.("Loading analytics");
    try {
      var results = await Promise.all([requestPayload(context, state, Boolean(force)), requestExclusion(context)]);
      var result = results[0];
      context.root.innerHTML = shellMarkup(state, result.payload, result.stale);
      bind(context.root, context, state);
      context.setStatus?.(result.stale ? "Analytics stale" : "Analytics ready");
    } catch (error) {
      context.root.innerHTML = '<div class="analytics-shell"><div class="analytics-head"><div><p class="analytics-eyebrow">Public website · anonymous aggregate</p><h2>' + escapeHtml(VIEW_TITLES[state.view]) + '</h2></div><button class="button analytics-refresh" type="button" data-analytics-refresh>Try again</button></div><div class="analytics-error" role="alert"><strong>Analytics unavailable</strong><p>' + escapeHtml(error.message) + "</p><p>Configure the Analytics Engine binding and the three Cloudflare analytics environment values, then refresh.</p></div></div>";
      context.root.querySelector("[data-analytics-refresh]")?.addEventListener("click", function () { render(context, true); });
      context.setStatus?.("Analytics unavailable");
    }
  }

  global.StudioAnalytics = {
    render: render,
    refresh: function () { return currentContext ? render(currentContext, true) : Promise.resolve(); },
    hashState: readHash,
    clearHash: clearHash,
  };
})(window);
