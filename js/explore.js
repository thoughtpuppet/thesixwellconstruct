(function () {
  "use strict";

  var STORAGE_KEY = "sixwell_explore_history_v1";
  var HISTORY_LIMIT = 12;
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-explore-scope]"));
  var status = document.querySelector("[data-explore-status]");
  if (!buttons.length || !status) return;

  function emptyHistory() {
    return { all: [], works: [], process: [], pages: [] };
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

  function setBusy(busy) {
    buttons.forEach(function (button) { button.disabled = busy; });
    document.querySelector("[data-explore-actions]").setAttribute("aria-busy", String(busy));
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

  async function choose(scope) {
    var history = readHistory();
    var query = new URLSearchParams({ scope: scope });
    if (history[scope].length) query.set("exclude", history[scope].join(","));
    setBusy(true);
    announce("Finding somewhere…", "loading");
    track("interactive_start", { action: "explore-random", itemId: scope });

    try {
      var response = await fetch("/api/site/explore?" + query.toString(), {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.destination || !payload.destination.route) {
        throw new Error(payload.error || "Explore could not find a public destination.");
      }
      remember(history, scope, payload.destination, Boolean(payload.restarted));
      track("interactive_complete", {
        action: "explore-random",
        itemId: payload.destination.key,
        progress: 100,
      });
      if (typeof window._constructFade === "function") window._constructFade(payload.destination.route);
      else window.location.href = payload.destination.route;
    } catch (error) {
      setBusy(false);
      announce((error && error.message ? error.message : "Explore could not find a destination.") + " Try again.", "error");
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () { choose(button.dataset.exploreScope); });
  });
})();
