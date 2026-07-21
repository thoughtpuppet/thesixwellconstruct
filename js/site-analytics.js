(function siteAnalytics(global) {
  "use strict";

  var ENDPOINT = "/api/analytics/events";
  var SESSION_KEY = "swc_site_analytics_session_v1";
  var PREVIOUS_KEY = "swc_site_analytics_previous_path_v1";
  var CAMPAIGN_KEY = "swc_site_analytics_campaign_v1";
  var SEQUENCE_KEY = "swc_site_analytics_sequence_v1";
  var MAX_BATCH = 32;
  var queue = [];
  var flushTimer = 0;
  var exitSent = false;
  var visibleStartedAt = document.visibilityState === "visible" ? performance.now() : 0;
  var activeMilliseconds = 0;
  var maxScroll = 0;
  var interactionCount = 0;
  var mediaProgress = new WeakMap();
  var startedForms = new WeakSet();
  var visibleSections = new WeakSet();
  var invalidForms = new WeakMap();
  var actionCounts = new Map();

  function normalizePath(value) {
    var pathname = "/";
    try { pathname = new URL(String(value || "/"), location.origin).pathname; } catch (_) {}
    pathname = pathname.replace(/\/{2,}/g, "/").replace(/\/index\.html$/i, "/");
    if (pathname !== "/" && !/\.[a-z0-9]{1,8}$/i.test(pathname)) pathname = pathname.replace(/\/+$/, "") + "/";
    return pathname.slice(0, 300) || "/";
  }

  function slug(value, max) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max || 120);
  }

  function host(value) {
    if (!value) return "";
    try { return new URL(value, location.href).hostname.toLowerCase().slice(0, 160); } catch (_) { return ""; }
  }

  function contentGroup(path) {
    path = normalizePath(path);
    if (path === "/" || path === "/entry-room/") return "entry";
    if (path === "/home/") return "home";
    return slug(path.split("/").filter(Boolean)[0] || "other", 48);
  }

  function disabled() {
    var path = location.pathname.toLowerCase();
    if (location.protocol !== "https:" && !/\.test$/.test(location.hostname)) return true;
    if (/^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname)) return true;
    if (new URLSearchParams(location.search).has("preview")) return true;
    if (path.indexOf("/studio/") === 0 || path.indexOf("/tools/") === 0 || path.indexOf("/api/") === 0) return true;
    if (path.indexOf("managed-preview") >= 0 || path.indexOf("connections-preview") >= 0 || path.indexOf("/previews/") >= 0) return true;
    return Boolean(document.querySelector('meta[name="robots"][content*="noindex" i]'));
  }

  if (disabled()) return;

  function sessionId() {
    var existing = "";
    try { existing = sessionStorage.getItem(SESSION_KEY) || ""; } catch (_) {}
    if (/^[a-zA-Z0-9_-]{12,96}$/.test(existing)) return existing;
    var value = global.crypto && crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(18)), function (byte) { return byte.toString(36); }).join("");
    try { sessionStorage.setItem(SESSION_KEY, value); } catch (_) {}
    return value;
  }

  var session = sessionId();

  function nextSequence() {
    var sequence = 0;
    try { sequence = Number(sessionStorage.getItem(SEQUENCE_KEY) || 0) + 1; sessionStorage.setItem(SEQUENCE_KEY, String(sequence)); } catch (_) { sequence += 1; }
    return sequence;
  }

  function currentCampaign() {
    var params = new URLSearchParams(location.search);
    var fresh = {
      utmSource: slug(params.get("utm_source"), 80),
      utmMedium: slug(params.get("utm_medium"), 80),
      utmCampaign: slug(params.get("utm_campaign"), 120),
      utmContent: slug(params.get("utm_content"), 120),
    };
    if (fresh.utmSource || fresh.utmMedium || fresh.utmCampaign || fresh.utmContent) {
      try { sessionStorage.setItem(CAMPAIGN_KEY, JSON.stringify(fresh)); } catch (_) {}
      return fresh;
    }
    try {
      var stored = JSON.parse(sessionStorage.getItem(CAMPAIGN_KEY) || "{}");
      return { utmSource: slug(stored.utmSource, 80), utmMedium: slug(stored.utmMedium, 80), utmCampaign: slug(stored.utmCampaign, 120), utmContent: slug(stored.utmContent, 120) };
    } catch (_) { return fresh; }
  }

  var campaign = currentCampaign();

  function deviceType() {
    var width = Math.max(document.documentElement.clientWidth || 0, global.innerWidth || 0);
    if (width <= 767) return "mobile";
    if (width <= 1024) return "tablet";
    return "desktop";
  }

  function previousPath() {
    try { return sessionStorage.getItem(PREVIOUS_KEY) || ""; } catch (_) { return ""; }
  }

  function rememberPath(path) {
    try { sessionStorage.setItem(PREVIOUS_KEY, path); } catch (_) {}
  }

  function cleanEvent(name, properties) {
    properties = properties || {};
    var path = normalizePath(properties.path || location.pathname);
    return {
      name: slug(name, 64), path: path,
      previousPath: properties.previousPath ? normalizePath(properties.previousPath) : "",
      targetPath: properties.targetPath ? normalizePath(properties.targetPath) : "",
      targetHost: host(properties.targetHost), action: slug(properties.action, 96),
      sectionId: slug(properties.sectionId, 120), itemId: slug(properties.itemId, 160),
      referrerHost: host(properties.referrerHost), utmSource: slug(properties.utmSource, 80),
      utmMedium: slug(properties.utmMedium, 80), utmCampaign: slug(properties.utmCampaign, 120),
      utmContent: slug(properties.utmContent, 120), contentGroup: slug(properties.contentGroup || contentGroup(path), 48),
      device: properties.device || deviceType(), resultBucket: slug(properties.resultBucket, 48),
      formId: slug(properties.formId, 120), mediaId: slug(properties.mediaId, 160),
      activeSeconds: Number(properties.activeSeconds || 0), maxScroll: Number(properties.maxScroll || 0),
      progress: Number(properties.progress || 0), count: Number(properties.count || 0),
      sequence: nextSequence(), viewportWidth: Math.round(global.innerWidth || 0),
    };
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = global.setTimeout(function () { flush(false); }, 10000);
  }

  function payload(events) {
    return JSON.stringify({ sessionId: session, events: events });
  }

  function flush(beacon) {
    if (flushTimer) { global.clearTimeout(flushTimer); flushTimer = 0; }
    if (!queue.length) return Promise.resolve();
    var events = queue.splice(0, MAX_BATCH);
    var body = payload(events);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    } else {
      fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: body, credentials: "same-origin", keepalive: true }).catch(function () {});
    }
    if (queue.length) scheduleFlush();
    return Promise.resolve();
  }

  function track(name, properties) {
    if (!name) return;
    properties = properties || {};
    if (/^(interactive_|node_open|pathway_open)/.test(name) && properties.count == null) {
      var repeatKey = name + ":" + String(properties.action || "") + ":" + String(properties.itemId || "");
      var repeats = (actionCounts.get(repeatKey) || 0) + 1;
      actionCounts.set(repeatKey, repeats); properties.count = repeats;
    }
    interactionCount += name === "page_view" || name === "page_exit" ? 0 : 1;
    queue.push(cleanEvent(name, properties));
    if (queue.length >= 10) flush(false); else scheduleFlush();
  }

  function markPageView() {
    var path = normalizePath(location.pathname);
    var previous = previousPath();
    track("page_view", {
      path: path, previousPath: previous && previous !== path ? previous : "",
      referrerHost: document.referrer, utmSource: campaign.utmSource, utmMedium: campaign.utmMedium,
      utmCampaign: campaign.utmCampaign, utmContent: campaign.utmContent,
    });
    rememberPath(path);
  }

  function activeNow() {
    var total = activeMilliseconds;
    if (visibleStartedAt) total += Math.max(0, performance.now() - visibleStartedAt);
    return total;
  }

  function updateScroll() {
    var root = document.documentElement;
    var available = Math.max(1, root.scrollHeight - global.innerHeight);
    maxScroll = Math.max(maxScroll, Math.min(100, Math.round((global.scrollY / available) * 100)));
  }

  function markExit() {
    if (exitSent) return;
    exitSent = true;
    updateScroll();
    track("page_exit", { activeSeconds: Math.round(activeNow() / 100) / 10, maxScroll: maxScroll, count: interactionCount });
    flush(true);
  }

  function elementId(element, fallback) {
    if (!element) return slug(fallback, 160);
    return slug(element.dataset.analyticsId || element.id || element.getAttribute("name") || fallback, 160);
  }

  function declarativeClick(element) {
    var owner = element.closest("[data-analytics-event]");
    if (!owner) return false;
    track(owner.dataset.analyticsEvent, {
      action: owner.dataset.analyticsAction || "activate",
      sectionId: owner.closest("[data-analytics-section]")?.dataset.analyticsSection || "",
      itemId: elementId(owner, "item"),
    });
    return true;
  }

  document.addEventListener("click", function (event) {
    var element = event.target.closest("a,button,[role='button'],[data-analytics-event]");
    if (!element || declarativeClick(element)) return;
    var anchor = element.closest("a[href]");
    if (anchor) {
      var target;
      try { target = new URL(anchor.href, location.href); } catch (_) { return; }
      if (!/^https?:$/.test(target.protocol)) return;
      if (target.origin === location.origin) track("navigation", { targetPath: target.pathname, action: elementId(anchor, "link") });
      else track("outbound_link", { targetHost: target.hostname, action: elementId(anchor, "outbound") });
      return;
    }
    if (element.matches(".button,.btn,.cta,[class*='cta']")) track("cta", { action: elementId(element, "cta") });
  }, true);

  document.addEventListener("input", function (event) {
    var form = event.target.closest("form");
    if (form && !startedForms.has(form)) {
      startedForms.add(form); track("form_start", { formId: elementId(form, "form") });
    }
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var formId = elementId(form, "form");
    track("form_submit", { formId: formId });
    if (!form.checkValidity()) track("form_error", { formId: formId, count: form.querySelectorAll(":invalid").length });
  }, true);

  document.addEventListener("invalid", function (event) {
    var form = event.target.closest?.("form");
    if (!form) return;
    global.clearTimeout(invalidForms.get(form));
    invalidForms.set(form, global.setTimeout(function () {
      track("form_error", { formId: elementId(form, "form"), count: form.querySelectorAll(":invalid").length });
    }, 0));
  }, true);

  var searchTimers = new WeakMap();
  document.addEventListener("input", function (event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "search") return;
    global.clearTimeout(searchTimers.get(input));
    searchTimers.set(input, global.setTimeout(function () {
      if (!input.value.trim()) return;
      var count = Number(input.dataset.analyticsResults || 0);
      var bucket = count <= 0 ? "unknown" : count < 5 ? "1-4" : count < 20 ? "5-19" : "20-plus";
      track("search", { action: elementId(input, "search"), resultBucket: bucket });
    }, 700));
  }, true);

  document.addEventListener("change", function (event) {
    var input = event.target;
    var filter = input.closest("[data-analytics-filter],.filters,.filter-row,[class*='filters']");
    if (!filter || input.type === "search") return;
    track("filter_change", { action: elementId(input, "filter"), itemId: /^(SELECT|OPTION)$/.test(input.tagName) ? slug(input.value, 120) : "changed" });
  }, true);

  document.addEventListener("play", function (event) {
    if (event.target instanceof HTMLMediaElement) track("media_start", { mediaId: elementId(event.target, event.target.currentSrc || "media") });
  }, true);

  document.addEventListener("timeupdate", function (event) {
    var media = event.target;
    if (!(media instanceof HTMLMediaElement) || !Number.isFinite(media.duration) || media.duration <= 0) return;
    var reached = mediaProgress.get(media) || new Set();
    var percent = Math.round((media.currentTime / media.duration) * 100);
    [25, 50, 75].forEach(function (threshold) {
      if (percent >= threshold && !reached.has(threshold)) { reached.add(threshold); track("media_progress", { mediaId: elementId(media, media.currentSrc || "media"), progress: threshold }); }
    });
    mediaProgress.set(media, reached);
  }, true);

  document.addEventListener("ended", function (event) {
    if (event.target instanceof HTMLMediaElement) track("media_complete", { mediaId: elementId(event.target, event.target.currentSrc || "media"), progress: 100 });
  }, true);

  if ("IntersectionObserver" in global) {
    var sectionTimers = new WeakMap();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var section = entry.target;
        if (visibleSections.has(section)) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          sectionTimers.set(section, global.setTimeout(function () {
            visibleSections.add(section);
            track("section_view", { sectionId: elementId(section, "section") });
          }, 1000));
        } else {
          global.clearTimeout(sectionTimers.get(section)); sectionTimers.delete(section);
        }
      });
    }, { threshold: [0.5] });
    function observeSections(root) {
      if (root.matches?.("[data-analytics-section],main section[id]")) observer.observe(root);
      root.querySelectorAll?.("[data-analytics-section],main section[id]").forEach(function (section) { observer.observe(section); });
    }
    observeSections(document);
    if ("MutationObserver" in global) new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) { mutation.addedNodes.forEach(function (node) { if (node.nodeType === 1) observeSections(node); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  var scrollQueued = false;
  global.addEventListener("scroll", function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () { updateScroll(); scrollQueued = false; });
  }, { passive: true });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      if (visibleStartedAt) activeMilliseconds += Math.max(0, performance.now() - visibleStartedAt);
      visibleStartedAt = 0; flush(true);
    } else if (!visibleStartedAt) visibleStartedAt = performance.now();
  });

  global.addEventListener("pagehide", markExit);
  global.addEventListener("beforeunload", markExit);
  global.addEventListener("sixwell:form-complete", function (event) { track("form_complete", { formId: slug(event.detail?.formId || "form", 120) }); });

  global.SixWellAnalytics = { track: track, flush: function (beacon) { return flush(Boolean(beacon)); }, normalizePath: normalizePath };
  markPageView();
})(window);
