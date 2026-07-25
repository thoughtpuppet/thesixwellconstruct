(function studioAnalytics(global) {
  "use strict";

  var CACHE_MS = 5 * 60 * 1000;
  var cache = new Map();
  var lastByView = new Map();
  var currentContext = null;
  var chartSequence = 0;
  var GROUPS = [["", "All content"], ["entry", "Entry"], ["home", "Home"], ["tattoos", "Tattoos"], ["art", "Art"], ["merch", "Merch"], ["events", "Events"], ["archive", "Archive"], ["about", "About"], ["booking", "Booking"]];
  var VIEW_TITLES = { overview: "Site overview", journeys: "Visitor journeys", acquisition: "Audience acquisition", performance: "Site performance" };

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

  function pctChange(current, previous) {
    if (current == null || previous == null || previous === "") return { text: "Previous period unavailable", direction: "" };
    current = Number(current); previous = Number(previous);
    if (!previous) return { text: "No previous-period baseline", direction: "" };
    var amount = ((current - previous) / previous) * 100;
    return { text: (amount >= 0 ? "+" : "") + number(amount, 1) + "% from previous period", direction: amount > 0 ? "up" : amount < 0 ? "down" : "" };
  }

  function readHash() {
    var match = location.hash.match(/^#analytics\/(overview|journeys|acquisition|performance)(?:\?(.*))?$/);
    var params = new URLSearchParams(match?.[2] || "");
    return {
      active: Boolean(match), view: match?.[1] || "overview",
      range: ["7d", "30d", "90d", "12m"].includes(params.get("range")) ? params.get("range") : "30d",
      device: ["all", "desktop", "mobile", "tablet"].includes(params.get("device")) ? params.get("device") : "all",
      group: /^[a-z0-9-]{0,48}$/.test(params.get("group") || "") ? params.get("group") || "" : "",
    };
  }

  function writeHash(state) {
    var params = new URLSearchParams();
    params.set("range", state.range); params.set("device", state.device);
    if (state.group) params.set("group", state.group);
    history.replaceState(history.state, "", location.pathname + location.search + "#analytics/" + state.view + "?" + params.toString());
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
      var updated = source.dataThrough ? " through " + source.dataThrough : "";
      return '<span class="analytics-source" data-ready="' + Boolean(source.ready) + '" title="' + escapeHtml(source.error || "Data source ready") + '">' + escapeHtml(name === "rum" ? "Cloudflare RUM" : "Site engagement") + ": " + escapeHtml(state + updated) + "</span>";
    }).join("") + "</div>";
  }

  function stateMarkup(payload, stale) {
    var state = stale ? "stale" : payload.state || "unavailable";
    var copy = stale ? "Showing the last successful snapshot because the refresh failed." : state === "current" ? "All requested analytics sources are current." : state === "partial" ? "Some sources are unavailable; available data remains visible." : state === "stale" ? "Showing the last stored daily aggregates; live sources are unavailable." : "Analytics sources are not configured or currently unavailable.";
    return '<div class="analytics-state" data-state="' + state + '" role="status"><div><strong>' + escapeHtml(state) + "</strong><br>" + escapeHtml(copy) + "</div>" + sourceMarkup(payload) + "</div>";
  }

  function filtersMarkup(state, payload) {
    return '<div class="analytics-filters" aria-label="Analytics filters">' +
      select("analyticsRange", "Range", [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["12m", "Last 12 months"]], state.range) +
      select("analyticsDevice", "Device", [["all", "All devices"], ["desktop", "Desktop"], ["mobile", "Mobile"], ["tablet", "Tablet"]], state.device) +
      select("analyticsGroup", "Content", GROUPS, state.group) +
      '<div class="analytics-updated">Data through ' + escapeHtml(payload.dataThrough || "not available") + "<br>Updated " + escapeHtml(new Date(payload.generatedAt || Date.now()).toLocaleString()) + "</div></div>";
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

  function barList(items, empty) {
    items = (items || []).filter(function (item) { return Number(item.value || 0) > 0; }).slice(0, 12);
    if (!items.length) return '<p class="analytics-empty">' + escapeHtml(empty || "No data in this range.") + "</p>";
    var max = Math.max.apply(null, items.map(function (item) { return Number(item.value || 0); }));
    return '<div class="analytics-bars">' + items.map(function (item) {
      var width = Math.max(2, (Number(item.value || 0) / max) * 100);
      return '<div class="analytics-bar-row"><span class="analytics-bar-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label || "Unknown") + '</span><span class="analytics-bar-track" aria-hidden="true"><span class="analytics-bar-fill" style="width:' + width.toFixed(2) + '%"></span></span><strong class="analytics-bar-value">' + number(item.value) + "</strong></div>";
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
    return '<div class="analytics-kpis">' +
      kpi("Visits", rum.visits, rum.visits, previous.visits) +
      kpi("Page views", rum.pageViews, rum.pageViews, previous.pageViews) +
      kpi("Engaged sessions", custom.engagedSessions, custom.engagedSessions, previous.engagedSessions) +
      kpi("Average active time", custom.avgActiveSeconds, custom.avgActiveSeconds, previous.avgActiveSeconds, duration) +
      '</div><div class="analytics-grid">' +
      panel("Traffic over time", "Cloudflare page views and entry visits, sampled when required by the source.", lineChart(series, [{ key: "pageViews", label: "Views" }, { key: "visits", label: "Visits" }], "Page views and visits over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "pageViews", label: "Page views" }, { key: "visits", label: "Visits" }])) +
      '<div class="analytics-stack">' + panel("Content groups", "The public areas receiving the most attention.", barList(rum.contentGroups?.length ? rum.contentGroups : custom.contentGroups, "Content activity will appear after collection begins.")) + vitalPanel(rum.vitals || {}) + "</div></div>";
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
    return '<div class="analytics-grid equal">' +
      panel("Entry pages", "Where anonymous tab sessions begin.", barList(data.entries, "Journey data begins after the collector is deployed.")) +
      panel("Exit pages", "The last recorded public page in a session.", barList(data.exits, "Exit data begins after the collector is deployed.")) +
      panel("Page-to-page movement", "Ranked transitions; no persistent visitor identity is used.", dataTable(["From", "To", "Moves"], transitions, "No transitions recorded yet.")) +
      panel("Page engagement", "Average active time and maximum scroll recorded at page exit.", dataTable(["Page", "Active", "Scroll", "Views"], engagement, "No engagement summaries recorded yet.")) +
      panel("Section reach", "Sections seen at least 50% for one second.", barList((data.sections || []).map(function (item) { return { label: item.path + " · " + item.label, value: item.value }; }), "No declared sections recorded yet.")) +
      panel("Interactive milestones", "Entry, homepage, Archive, Legend, Portfolio, and Build activity.", dataTable(["Surface", "Milestone", "Count"], milestones, "No interactive milestones recorded yet.")) + "</div>";
  }

  function renderAcquisition(payload) {
    var rum = payload.rum || {}, custom = payload.custom || {};
    var series = rum.series || [];
    return '<div class="analytics-grid">' +
      panel("Audience trend", "Real-user page loads captured by Cloudflare Web Analytics.", lineChart(series, [{ key: "views", label: "Views" }], "Audience page loads over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "views", label: "Views" }])) +
      '<div class="analytics-stack">' + panel("Referrer domains", "Direct and external referring hosts; complete URLs are not retained.", barList(rum.referrers)) + panel("Campaign sources", "Whitelisted UTM source values carried only within the anonymous tab session.", barList(custom.utmSources, "No UTM-tagged visits recorded yet.")) + "</div></div>" +
      '<div class="analytics-grid equal" style="margin-top:16px">' + panel("Countries", "Country-level aggregate only.", barList(rum.countries)) + panel("Devices", "Cloudflare device classification.", barList(rum.devices)) + panel("Browsers", "Real-user browser mix.", barList(rum.browsers)) + panel("Operating systems", "Real-user operating-system mix.", barList(rum.operatingSystems)) + panel("UTM media", "Whitelisted campaign medium values.", barList(custom.utmMedia)) + panel("UTM campaigns", "Normalized campaign labels; click identifiers are never retained.", barList(custom.campaigns)) + "</div>";
  }

  function renderPerformance(payload) {
    var rum = payload.rum || {}, summary = rum.summary || {}, series = rum.series || [];
    var paths = (rum.paths || []).map(function (item) { return ["<strong>" + escapeHtml(item.path) + "</strong>", vitalValue("lcp", item.lcp), vitalValue("inp", item.inp), vitalValue("cls", item.cls), item.fcp ? number(item.fcp) + "ms" : "—", item.pageLoad ? number(item.pageLoad) + "ms" : "—", number(item.samples)]; });
    return '<div class="analytics-kpis analytics-kpis-performance">' +
      performanceKpi("LCP P75", "lcp", summary.lcp) + performanceKpi("INP P75", "inp", summary.inp) + performanceKpi("CLS P75", "cls", summary.cls) + performanceKpi("FCP P75", "fcp", summary.fcp) + performanceKpi("Page load P75", "load", summary.pageLoad) +
      '</div><div class="analytics-grid">' +
      panel("Core Web Vitals trend", "P75 values from real visitor sessions. LCP and INP use milliseconds; CLS is unitless.", lineChart(series, [{ key: "lcp", label: "LCP" }, { key: "inp", label: "INP" }], "Core Web Vitals over time") + sourceTable(series, [{ key: "date", label: "Date" }, { key: "lcp", label: "LCP", format: function (value) { return number(value) + "ms"; } }, { key: "inp", label: "INP", format: function (value) { return number(value) + "ms"; } }, { key: "cls", label: "CLS", format: function (value) { return number(value, 3); } }])) +
      vitalPanel(summary) + "</div>" +
      '<div style="margin-top:16px">' + panel("Performance by page", "Ranked by P75 LCP. Essential values remain available without hover.", dataTable(["Page", "LCP", "INP", "CLS", "FCP", "Load", "Samples"], paths, "Performance detail is not available for this range.")) + "</div>" +
      '<p class="analytics-caveat">Cloudflare may adaptively sample Web Analytics data. Detailed problematic-element selectors are shown only when the account dataset exposes them; page-level diagnostics remain available otherwise.</p>';
  }

  function vitalValue(metric, value) {
    value = Number(value || 0);
    return '<span class="analytics-vital" data-rating="' + rating(metric, value) + '">' + (value ? number(value, metric === "cls" ? 3 : 0) + (metric === "cls" ? "" : "ms") : "—") + "</span>";
  }

  function performanceKpi(label, metric, value) {
    return '<div class="analytics-kpi"><span class="analytics-kpi-label">' + label + '</span><strong class="analytics-kpi-value"><span class="analytics-vital" data-rating="' + rating(metric, value) + '">' + (value ? number(value, metric === "cls" ? 3 : 0) : "—") + '</span></strong><span class="analytics-kpi-compare">' + (metric === "cls" ? "Unitless score" : "Milliseconds") + "</span></div>";
  }

  function renderBody(payload) {
    if (payload.view === "journeys") return renderJourneys(payload);
    if (payload.view === "acquisition") return renderAcquisition(payload);
    if (payload.view === "performance") return renderPerformance(payload);
    return renderOverview(payload);
  }

  function shellMarkup(state, payload, stale) {
    return '<div class="analytics-shell"><div class="analytics-head"><div><p class="analytics-eyebrow">Public website · anonymous aggregate</p><h2>' + escapeHtml(VIEW_TITLES[state.view]) + '</h2><p>Site behavior, audience, and performance only. This area does not read contacts, bookings, payments, revenue, or CRM records.</p></div><button class="button analytics-refresh" type="button" data-analytics-refresh>Refresh analytics</button></div>' + stateMarkup(payload, stale) + '<div class="analytics-body">' + renderBody(payload) + "</div>" + filtersMarkup(state, payload) + "</div>";
  }

  function cacheKey(state) { return [state.view, state.range, state.device, state.group].join("|"); }

  async function requestPayload(context, state, force) {
    var key = cacheKey(state), cached = cache.get(key);
    if (!force && cached && Date.now() - cached.time < CACHE_MS) return { payload: cached.payload, stale: false };
    var params = new URLSearchParams({ view: state.view, range: state.range, device: state.device });
    if (state.group) params.set("group", state.group);
    try {
      var response = await fetch("/api/admin/analytics?" + params.toString(), { headers: { authorization: "Bearer " + context.token }, cache: "no-store" });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || "Analytics request failed.");
      cache.set(key, { time: Date.now(), payload: payload }); lastByView.set(state.view, payload);
      return { payload: payload, stale: false };
    } catch (error) {
      var last = lastByView.get(state.view);
      if (last) return { payload: last, stale: true, error: error };
      throw error;
    }
  }

  function bind(root, context, state) {
    root.querySelector("[data-analytics-refresh]")?.addEventListener("click", function () { render(context, true); });
    ["analyticsRange", "analyticsDevice", "analyticsGroup"].forEach(function (id) {
      root.querySelector("#" + id)?.addEventListener("change", function () {
        var next = { ...state, range: root.querySelector("#analyticsRange").value, device: root.querySelector("#analyticsDevice").value, group: root.querySelector("#analyticsGroup").value };
        writeHash(next); render({ ...context, view: next.view }, false);
      });
    });
  }

  async function render(context, force) {
    currentContext = context;
    var hash = readHash();
    var state = { view: context.view || hash.view || "overview", range: hash.range, device: hash.device, group: hash.group };
    writeHash(state);
    context.root.innerHTML = '<div class="analytics-shell"><div class="analytics-head"><div><p class="analytics-eyebrow">Public website · anonymous aggregate</p><h2>' + escapeHtml(VIEW_TITLES[state.view]) + '</h2></div></div><p class="analytics-loading" role="status">Loading analytics…</p></div>';
    context.setStatus?.("Loading analytics");
    try {
      var result = await requestPayload(context, state, Boolean(force));
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
