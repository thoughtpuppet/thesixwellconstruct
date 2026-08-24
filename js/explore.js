(function () {
  "use strict";

  var STORAGE_KEY = "sixwell_explore_history_v1";
  var PORTAL_STORAGE_KEY = "sixwell_explore_portal_v1";
  var HISTORY_LIMIT = 12;
  var VALID_SCOPES = ["all", "works", "process", "pages"];
  var room = document.querySelector("[data-explore-room]");
  var actionGroup = document.querySelector("[data-explore-actions]");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-explore-scope]"));
  var status = document.querySelector("[data-explore-status]");
  var portal = document.querySelector("[data-explore-portal]");
  var previewFrame = document.querySelector("[data-explore-preview-frame]");
  var previewStatus = document.querySelector("[data-explore-preview-status]");
  var previewMedium = document.querySelector("[data-explore-preview-medium]");
  var previewTitle = document.querySelector("[data-explore-preview-title]");
  var diveAgainButton = document.querySelector("[data-explore-dive-again]");
  var enterPageButton = document.querySelector("[data-explore-enter-page]");
  var backToBoardButton = document.querySelector("[data-explore-back-to-board]");
  var currentPortal = null;
  var previewTimer = 0;

  if (!room || !buttons.length || !status || !portal || !previewFrame || !previewMedium || !previewTitle || !diveAgainButton || !enterPageButton || !backToBoardButton) return;

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
    var preview = previewFrame.parentElement;
    if (preview) preview.dataset.explorePreviewState = state;
    if (previewStatus) previewStatus.textContent = message || "";
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
