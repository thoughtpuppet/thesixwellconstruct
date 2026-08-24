(function () {
  const paintingGrid = document.getElementById("gridPainting");
  if (!paintingGrid) return;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));

function detailPath(record) {
  return record.canonicalRoute
    || record.canonical_route
    || record.legacy_path
    || `/art/${encodeURIComponent(record.slug || record.id)}/`;
}

  function updateCard(card, record) {
    const media = Array.isArray(record.media) ? record.media[0] : null;
    card.dataset.managedId = record.id;
    card.dataset.id = record.slug || record.id;
    card.dataset.title = record.title || "Untitled work";
    card.dataset.year = record.year || "—";
    card.dataset.mediumLabel = record.medium || "Artwork";
    card.dataset.fragment = record.statement || "";
    card.dataset.series = record.series_id || "";
    card.dataset.type = record.series_id ? "series" : "standalone";
    card.dataset.medium = "painting";
    card.dataset.managedPath = detailPath(record);
    const image = card.querySelector("img");
    if (image) {
      image.src = media?.url || "";
      image.alt = media?.alt || record.title || "Artwork";
    }
    const title = card.querySelector(".work-title");
    if (title) title.textContent = record.title || "Untitled work";
    const info = card.querySelector(".work-info");
    if (info) info.textContent = [record.year, record.medium].filter(Boolean).join(" · ") || "Artwork";
    const badge = card.querySelector(".work-badge");
    if (badge) badge.textContent = record.availability || card.dataset.type;
    const whereabouts = card.querySelector(".work-whereabouts");
    if (whereabouts) {
      whereabouts.hidden = record.whereabouts_status !== "unknown";
      whereabouts.textContent = record.whereabouts_status === "unknown" ? "Whereabouts unknown" : "";
    }
  }

  function createCard(record) {
    const card = document.createElement("div");
    card.className = "work-card entrance-fade";
    card.innerHTML = `
      <img src="" alt="" loading="lazy">
      <span class="work-badge"></span>
      <div class="work-meta"><span class="work-title"></span><span class="work-info"></span><span class="work-whereabouts" hidden></span></div>
    `;
    updateCard(card, record);
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    const open = () => { window.location.href = card.dataset.managedPath; };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
    });
    return card;
  }

  async function loadManagedArt() {
    try {
      const response = await fetch(`/api/art?order=${Date.now()}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const records = Array.isArray(payload.records) ? payload.records : [];
      const existing = new Map([...document.querySelectorAll(".work-card[data-managed-id]")].map((card) => [card.dataset.managedId, card]));
      const cards = records.map((record) => {
        const card = existing.get(record.id) || createCard(record);
        updateCard(card, record);
        return card;
      });

      document.querySelectorAll(".work-grid .work-card").forEach((card) => card.remove());
      paintingGrid.append(...cards);
      document.getElementById("sectionWood")?.remove();
      window.refreshManagedArtIndex?.();
    } catch {
      // Keep the bundled six-work catalog as the outage fallback.
    }
  }

  loadManagedArt();
})();
