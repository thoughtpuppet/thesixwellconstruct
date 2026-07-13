(function () {
  function mountConnections(entityId) {
    const legacy = [...document.querySelectorAll("[data-legacy-connections]")];
    const first = document.querySelector(".related-block[data-legacy-connections],section.related[data-legacy-connections],.related-row[data-legacy-connections]") || legacy[0];
    const footer = document.querySelector("footer");
    const host = first?.matches("section,.related-row") ? first : document.createElement("section");
    if (!host.isConnected) {
      if (first?.parentNode) first.parentNode.insertBefore(host, first);
      else if (footer?.parentNode) footer.parentNode.insertBefore(host, footer);
      else document.body.appendChild(host);
    }
    const run = async () => {
      await window.ConstructConnections?.mount({ entityId, host, embedded: Boolean(first) });
      if (!host.hidden) legacy.forEach((node) => { if (node !== host) node.hidden = true; });
    };
    if (window.ConstructConnections) return run();
    const script = document.createElement("script");
    script.src = "/js/construct-connections.js?v=2";
    script.onload = run;
    document.head.appendChild(script);
  }
  const currentPath = location.pathname.replace(/\/+$/, "");
  fetch("/api/art", { cache: "no-store", headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const record = (payload.records || []).find((item) => String(item.legacy_path || "").replace(/\/+$/, "") === currentPath);
      if (!record) return;
      mountConnections(record.id);
      const media = Array.isArray(record.media) ? record.media[0] : null;
      document.title = `${record.title} · the six.well construct`;
      const title = document.querySelector(".painting-title");
      if (title) title.textContent = record.title || "Untitled work";
      document.querySelectorAll(".painting-frame img,.lightbox img,#lightboxImg").forEach((image) => {
        if (media?.url) image.src = media.url;
        image.alt = media?.alt || record.title || "Artwork";
      });
      const meta = document.querySelectorAll(".painting-meta .meta-item");
      if (meta[0]) meta[0].textContent = record.year || "—";
      if (meta[1]) meta[1].textContent = record.medium || "Artwork";
      if (meta[2]) meta[2].textContent = record.series_id ? "series" : "standalone";
      const statement = document.querySelector(".statement-body");
      if (statement) {
        statement.classList.toggle("placeholder", !record.statement);
        statement.replaceChildren();
        const paragraph = document.createElement("p");
        paragraph.textContent = record.statement || "No public statement has been published for this work.";
        statement.appendChild(paragraph);
      }
      document.querySelectorAll(".painting-badge").forEach((badge) => { badge.textContent = record.availability || "unavailable"; });
      const status = document.querySelector(".avail-status");
      if (status) {
        status.textContent = record.availability || "unavailable";
        status.className = `avail-status ${record.availability === "available" ? "available" : "unavailable"}`;
      }
      const inquiry = document.querySelector(".avail-row .avail-action:not(.disabled)");
      if (inquiry instanceof HTMLAnchorElement) {
        inquiry.href = `/art/acquisitioninquiry.html?work=${encodeURIComponent(record.slug || record.id)}`;
        inquiry.hidden = !(Number(record.acquisition_eligible) === 1 && record.availability === "available");
      }
    })
    .catch(() => {
      // Bundled detail content remains visible during an API outage.
    });
})();
