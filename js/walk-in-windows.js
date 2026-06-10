// Shared walk-in window card renderer for booking, consultation, and
// marketing pages. Fetches the public consultation context (which includes
// active walk-in windows) and renders them as cards into a container.
(function (global) {
  const TIME_ZONE = "America/New_York";

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function renderWalkInCards(container, items, options = {}) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<p class="walkin-cards-empty">${escapeHtml(options.emptyMessage || "No walk-in windows are currently scheduled. Check back soon.")}</p>`;
      return;
    }
    const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long" });
    const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
    container.innerHTML = `<div class="walkin-cards">${items.map((item) => {
      const start = new Date(item.startsAt);
      const end = new Date(item.endsAt);
      const title = escapeHtml(item.title || "Walk-in Window");
      const note = escapeHtml(item.note || "");
      return `
        <div class="walkin-card">
          <span class="walkin-card-day">${escapeHtml(dayFmt.format(start))}</span>
          <span class="walkin-card-date">${escapeHtml(dateFmt.format(start))}</span>
          <span class="walkin-card-time">${escapeHtml(timeFmt.format(start))} - ${escapeHtml(timeFmt.format(end))} ET</span>
          <span class="walkin-card-note">${title}${note ? ` - ${note}` : ""}</span>
          <span class="walkin-card-meta">Updated daily</span>
        </div>
      `;
    }).join("")}</div>`;
  }

  async function loadWalkInCards(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<p class="walkin-cards-loading">Loading walk-in windows...</p>';
    try {
      const response = await fetch("/api/booking/public-consultation/context", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to load walk-in windows.");
      renderWalkInCards(container, payload.walkInWindows || [], options);
    } catch (error) {
      container.innerHTML = `<p class="walkin-cards-empty">${escapeHtml(options.errorMessage || "Walk-in availability is currently unavailable.")}</p>`;
    }
  }

  global.loadWalkInCards = loadWalkInCards;
  global.renderWalkInCards = renderWalkInCards;
})(window);
