(function () {
  "use strict";

  var STORAGE_KEY = "sixwell_explore_history_v1";
  var PORTAL_STORAGE_KEY = "sixwell_explore_portal_v1";
  var HISTORY_LIMIT = 12;
  var VALID_SCOPES = ["all", "works", "process", "pages"];
  var SCOPE_LABELS = {
    all: "Browsing entire site",
    works: "Browsing works & objects",
    process: "Browsing process & evidence",
    pages: "Browsing pages & pathways",
  };
  var room = document.querySelector("[data-explore-room]");
  var actionGroup = document.querySelector("[data-explore-actions]");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-explore-scope]"));
  var status = document.querySelector("[data-explore-status]");
  var portal = document.querySelector("[data-explore-portal]");
  var browsingLabel = document.querySelector("[data-explore-browsing-label]");
  var previewSurface = document.querySelector("[data-explore-preview-scroll]");
  var previewFrame = document.querySelector("[data-explore-preview-frame]");
  var previewStatus = document.querySelector("[data-explore-preview-status]");
  var previewMedium = document.querySelector("[data-explore-preview-medium]");
  var previewTitle = document.querySelector("[data-explore-preview-title]");
  var diveAgainButton = document.querySelector("[data-explore-dive-again]");
  var enterPageButton = document.querySelector("[data-explore-enter-page]");
  var backToBoardButton = document.querySelector("[data-explore-back-to-board]");
  var currentPortal = null;
  var previewTimer = 0;
  var previewTouchX = null;
  var previewTouchY = null;

  if (!room || !buttons.length || !status || !portal || !browsingLabel || !previewSurface || !previewFrame || !previewMedium || !previewTitle || !diveAgainButton || !enterPageButton || !backToBoardButton) return;

  function emptyHistory() {
    return { all: [], works: [], process: [], pages: [] };
  }

  function validScope(value) {
    return VALID_SCOPES.indexOf(String(value || "")) >= 0;
  }

  function normalizeDestination(value) {
    if (!value || typeof value !== "object") return null;
    var route = String(value.route || "").trim();
    var title = String(value.title || "").trim();
    if (!route || route.charAt(0) !== "/" || route.slice(0, 2) === "//" || !title) return null;
    return {
      key: String(value.key || route),
      scope: validScope(value.scope) ? String(value.scope) : "pages",
      kind: String(value.kind || "destination"),
      medium: {
        id: String(value.medium && value.medium.id || "about"),
        label: String(value.medium && value.medium.label || "Construct destination"),
      },
      title: title,
      route: route,
    };
  }

  function destinationNode(value) {
    var node = String(value || "about").trim().toLowerCase();
    if (node === "legend") return "about";
    if (node === "tattoo" || node === "tattooing") return "tattoos";
    return ["tattoos", "art", "merch", "about", "events", "music", "writings", "archive", "film"].indexOf(node) >= 0
      ? node
      : "about";
  }

  function readHistory() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return emptyHistory();
      var history = emptyHistory();
      Object.keys(history).forEach(function (scope) {
        history[scope] = Array.isArray(parsed[scope]) ? parsed[scope].map(String).slice(-HISTORY_LIMIT) : [];
      });
      return history;
    } catch (error) {
      return emptyHistory();
    }
  }

  function writeHistory(history) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (error) { /* storage is optional */ }
  }

  function remember(history, requestedScope, destination, restarted) {
    if (restarted) history[requestedScope] = [];
    var scopes = requestedScope === "all" ? ["all", destination.scope] : [requestedScope, "all"];
    scopes.forEach(function (scope) {
      history[scope] = (history[scope] || []).filter(function (key) { return key !== destination.key; });
      history[scope].push(destination.key);
      history[scope] = history[scope].slice(-HISTORY_LIMIT);
    });
    writeHistory(history);
  }

  function readPortalState() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(PORTAL_STORAGE_KEY) || "null");
      var destination = normalizeDestination(parsed && parsed.destination);
      if (!parsed || !validScope(parsed.scope) || !destination) return null;
      return { scope: String(parsed.scope), destination: destination };
    } catch (error) {
      return null;
    }
  }

  function writePortalState(value) {
    try {
      if (value) sessionStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(PORTAL_STORAGE_KEY);
    } catch (error) { /* storage is optional */ }
  }

  function setRoomState(state, scope) {
    room.dataset.exploreState = state;
    if ((state === "loading" || state === "preview") && validScope(scope)) room.dataset.exploreActiveScope = scope;
    else delete room.dataset.exploreActiveScope;
    buttons.forEach(function (button) {
      button.dataset.exploreSelected = String(state === "loading" && button.dataset.exploreScope === scope);
    });
  }

  function setControlsBusy(busy) {
    buttons.forEach(function (button) { button.disabled = busy; });
    diveAgainButton.disabled = busy;
    enterPageButton.disabled = busy;
    backToBoardButton.disabled = busy;
    if (actionGroup) actionGroup.setAttribute("aria-busy", String(busy));
    portal.setAttribute("aria-busy", String(busy));
  }

  function announce(message, state) {
    status.textContent = message;
    status.dataset.state = state || "idle";
    if (state === "error") status.setAttribute("role", "alert");
    else status.removeAttribute("role");
  }

  function track(name, properties) {
    if (window.SixWellAnalytics && typeof window.SixWellAnalytics.track === "function") {
      window.SixWellAnalytics.track(name, properties);
    }
  }

  function setPreviewLoadState(state, message) {
    previewSurface.dataset.explorePreviewState = state;
    if (previewStatus) previewStatus.textContent = message || "";
  }

  function previewScrollContext() {
    try {
      var frameWindow = previewFrame.contentWindow;
      var frameDocument = previewFrame.contentDocument || (frameWindow && frameWindow.document);
      if (!frameWindow || !frameDocument) return null;
      return { document: frameDocument, window: frameWindow };
    } catch (error) {
      return null;
    }
  }

  function canScrollPreviewElement(element, deltaX, deltaY) {
    if (!element) return false;
    var maxX = Math.max(0, Number(element.scrollWidth || 0) - Number(element.clientWidth || 0));
    var maxY = Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0));
    var left = Number(element.scrollLeft || 0);
    var top = Number(element.scrollTop || 0);
    var canX = deltaX < 0 ? left > 1 : deltaX > 0 ? left < maxX - 1 : false;
    var canY = deltaY < 0 ? top > 1 : deltaY > 0 ? top < maxY - 1 : false;
    return canX || canY;
  }

  function previewScrollTarget(context, clientX, clientY, deltaX, deltaY) {
    var frameRect = previewFrame.getBoundingClientRect();
    var x = Number.isFinite(clientX) ? clientX - frameRect.left : frameRect.width / 2;
    var y = Number.isFinite(clientY) ? clientY - frameRect.top : frameRect.height / 2;
    x = Math.max(0, Math.min(frameRect.width - 1, x));
    y = Math.max(0, Math.min(frameRect.height - 1, y));
    var target = typeof context.document.elementFromPoint === "function"
      ? context.document.elementFromPoint(x, y)
      : null;
    while (target && target !== context.document.documentElement) {
      var style = context.window.getComputedStyle(target);
      var scrollableX = /^(auto|scroll|overlay)$/.test(String(style.overflowX || ""));
      var scrollableY = /^(auto|scroll|overlay)$/.test(String(style.overflowY || ""));
      if (canScrollPreviewElement(target, scrollableX ? deltaX : 0, scrollableY ? deltaY : 0)) return target;
      target = target.parentElement;
    }
    var documentScroller = context.document.scrollingElement || context.document.documentElement || context.document.body;
    return canScrollPreviewElement(documentScroller, deltaX, deltaY) ? documentScroller : null;
  }

  function scrollPreviewAt(clientX, clientY, deltaX, deltaY) {
    var context = previewScrollContext();
    if (!context) return false;
    var target = previewScrollTarget(context, clientX, clientY, deltaX, deltaY);
    if (!target) return false;
    var maxX = Math.max(0, Number(target.scrollWidth || 0) - Number(target.clientWidth || 0));
    var maxY = Math.max(0, Number(target.scrollHeight || 0) - Number(target.clientHeight || 0));
    var beforeX = Number(target.scrollLeft || 0);
    var beforeY = Number(target.scrollTop || 0);
    target.scrollLeft = Math.max(0, Math.min(maxX, beforeX + deltaX));
    target.scrollTop = Math.max(0, Math.min(maxY, beforeY + deltaY));
    return target.scrollLeft !== beforeX || target.scrollTop !== beforeY;
  }

  function wheelPixels(event) {
    if (event.deltaMode === 1) return 16;
    if (event.deltaMode === 2) return Math.max(1, previewSurface.clientHeight || 1);
    return 1;
  }

  function resetPreviewTouch() {
    previewTouchX = null;
    previewTouchY = null;
  }

  function clearPreviewTimer() {
    if (!previewTimer) return;
    window.clearTimeout(previewTimer);
    previewTimer = 0;
  }

  function loadPreview(destination) {
    clearPreviewTimer();
    previewFrame.title = "Preview of " + destination.title;
    setPreviewLoadState("loading", "Loading destination preview…");
    previewFrame.setAttribute("src", destination.route);
    previewTimer = window.setTimeout(function () {
      previewTimer = 0;
      setPreviewLoadState("unavailable", "Preview unavailable. You can still enter this page or dive again.");
    }, 8000);
  }

  function showPreview(scope, destination, persist) {
    currentPortal = { scope: scope, destination: destination };
    if (persist !== false) writePortalState(currentPortal);
    portal.hidden = false;
    if (actionGroup) {
      actionGroup.setAttribute("aria-hidden", "true");
      actionGroup.setAttribute("inert", "");
    }
    portal.dataset.exploreDestinationNode = destinationNode(destination.medium.id);
    browsingLabel.textContent = SCOPE_LABELS[scope];
    previewSurface.setAttribute("aria-label", "Scrollable preview of " + destination.title + ". Page interactions are disabled; use Enter page to interact.");
    previewMedium.textContent = destination.medium.label;
    previewTitle.textContent = destination.title;
    setControlsBusy(false);
    setRoomState("preview", scope);
    announce("", "idle");
    loadPreview(destination);
  }

  function returnToBoard() {
    clearPreviewTimer();
    currentPortal = null;
    writePortalState(null);
    previewFrame.setAttribute("src", "about:blank");
    previewFrame.title = "Adventure destination preview";
    setPreviewLoadState("idle", "");
    delete portal.dataset.exploreDestinationNode;
    portal.hidden = true;
    if (actionGroup) {
      actionGroup.removeAttribute("aria-hidden");
      actionGroup.removeAttribute("inert");
    }
    setControlsBusy(false);
    setRoomState("idle", "");
    announce("", "idle");
  }

  async function choose(scope) {
    if (!validScope(scope)) return;
    var history = readHistory();
    var query = new URLSearchParams({ scope: scope });
    if (history[scope].length) query.set("exclude", history[scope].join(","));
    setControlsBusy(true);
    setRoomState("loading", scope);
    announce("Finding somewhere…", "loading");
    track("interactive_start", { action: "explore-random", itemId: scope });

    try {
      var response = await fetch("/api/site/explore?" + query.toString(), {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      var payload = await response.json().catch(function () { return {}; });
      var destination = normalizeDestination(payload.destination);
      if (!response.ok || !destination) {
        throw new Error(payload.error || "Explore could not find a public destination.");
      }
      remember(history, scope, destination, Boolean(payload.restarted));
      track("interactive_complete", {
        action: "explore-random",
        itemId: destination.key,
        progress: 100,
      });
      showPreview(scope, destination);
    } catch (error) {
      setControlsBusy(false);
      if (currentPortal) setRoomState("preview", currentPortal.scope);
      else setRoomState("error", "");
      announce((error && error.message ? error.message : "Explore could not find a destination.") + " Try again.", "error");
    }
  }

  function enterCurrentPage() {
    if (!currentPortal || !currentPortal.destination.route) return;
    writePortalState(currentPortal);
    track("interactive_enter", {
      action: "explore-random",
      itemId: currentPortal.destination.key,
      scope: currentPortal.scope,
    });
    if (typeof window._constructFade === "function") window._constructFade(currentPortal.destination.route);
    else window.location.href = currentPortal.destination.route;
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () { choose(button.dataset.exploreScope); });
  });
  diveAgainButton.addEventListener("click", function () {
    if (currentPortal) choose(currentPortal.scope);
  });
  enterPageButton.addEventListener("click", enterCurrentPage);
  backToBoardButton.addEventListener("click", returnToBoard);
  previewSurface.addEventListener("wheel", function (event) {
    var scale = wheelPixels(event);
    if (scrollPreviewAt(event.clientX, event.clientY, event.deltaX * scale, event.deltaY * scale)) event.preventDefault();
  }, { passive: false });
  previewSurface.addEventListener("touchstart", function (event) {
    if (!event.touches || event.touches.length !== 1) return resetPreviewTouch();
    previewTouchX = event.touches[0].clientX;
    previewTouchY = event.touches[0].clientY;
  }, { passive: true });
  previewSurface.addEventListener("touchmove", function (event) {
    if (previewTouchX === null || previewTouchY === null || !event.touches || event.touches.length !== 1) return;
    var touch = event.touches[0];
    var deltaX = previewTouchX - touch.clientX;
    var deltaY = previewTouchY - touch.clientY;
    previewTouchX = touch.clientX;
    previewTouchY = touch.clientY;
    if (scrollPreviewAt(touch.clientX, touch.clientY, deltaX, deltaY)) event.preventDefault();
  }, { passive: false });
  previewSurface.addEventListener("touchend", resetPreviewTouch);
  previewSurface.addEventListener("touchcancel", resetPreviewTouch);
  previewSurface.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var amount = 0;
    if (event.key === "ArrowUp") amount = -48;
    else if (event.key === "ArrowDown") amount = 48;
    else if (event.key === "PageUp") amount = -Math.max(1, previewSurface.clientHeight * 0.85);
    else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) amount = Math.max(1, previewSurface.clientHeight * 0.85);
    else if (event.key === " " && event.shiftKey) amount = -Math.max(1, previewSurface.clientHeight * 0.85);
    else if (event.key === "Home") amount = -Number.MAX_SAFE_INTEGER;
    else if (event.key === "End") amount = Number.MAX_SAFE_INTEGER;
    if (amount && scrollPreviewAt(undefined, undefined, 0, amount)) event.preventDefault();
  });
  previewFrame.addEventListener("load", function () {
    if (previewFrame.getAttribute("src") === "about:blank") return;
    clearPreviewTimer();
    setPreviewLoadState("loaded", "");
  });

  var restoredPortal = readPortalState();
  if (restoredPortal) showPreview(restoredPortal.scope, restoredPortal.destination, false);
  else returnToBoard();

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    setControlsBusy(false);
    if (currentPortal) {
      portal.hidden = false;
      if (actionGroup) {
        actionGroup.setAttribute("aria-hidden", "true");
        actionGroup.setAttribute("inert", "");
      }
      setRoomState("preview", currentPortal.scope);
      announce("", "idle");
      return;
    }
    returnToBoard();
  });
})();
