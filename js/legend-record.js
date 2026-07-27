(function () {
  const host = document.querySelector("[data-live-legend-record]");
  const current = document.querySelector("[data-legend-breadcrumb-current]");
  const embedded = document.getElementById("legend-record-data");
  const legend = window.SixWellLegend;
  if (!host || !legend) return;

  function requestedSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length === 3 && parts[0] === "about" && parts[1] === "legend"
      ? decodeURIComponent(parts[2])
      : "";
  }

  function readEmbeddedPayload() {
    const source = embedded?.textContent?.trim();
    if (!source) return null;
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }

  function synchronizeDocument(payload) {
    const record = payload.record;
    const title = `${record.name} · The Legend · the six.well construct`;
    const canonical = new URL(legend.canonicalRoute(record), location.origin).href;
    document.title = title;
    document.querySelector('[data-legend-record-description]')?.setAttribute("content", record.meaning || "");
    document.querySelector('[data-legend-record-canonical]')?.setAttribute("href", canonical);
    if (current) current.textContent = record.name;
  }

  function paint(payload) {
    if (!payload?.record) throw new Error("Missing Legend record.");
    synchronizeDocument(payload);
    legend.renderRecord(host, payload);
  }

  const initial = readEmbeddedPayload();
  if (initial?.record) {
    paint(initial);
    return;
  }

  const slug = requestedSlug();
  if (!slug) {
    host.innerHTML = '<div class="legend-record-state" role="alert"><h1 class="band-title section-title">This Legend record is unavailable.</h1><a class="btn legend-record-back" href="/about/legend/">Return to the Legend</a></div>';
    return;
  }

  fetch(`/api/legend/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error("Legend record unavailable.");
    paint(await response.json());
  }).catch(() => {
    host.innerHTML = '<div class="legend-record-state" role="alert"><h1 class="band-title section-title">This Legend record is unavailable.</h1><p>It may be unpublished, renamed, or temporarily unavailable.</p><a class="btn legend-record-back" href="/about/legend/">Return to the Legend</a></div>';
  });
})();
