(function () {
  "use strict";

  const features = [...document.querySelectorAll("[data-practice-feature]")];
  if (!features.length) return;

  fetch("/api/archive/making-the-canvas", { headers: { accept: "application/json" }, cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Practice record unavailable");
      return response.json();
    })
    .then((payload) => {
      const record = payload.record || payload.records?.[0];
      if (!record) return;
      const route = record.canonicalRoute || record.canonical_route || "/archive/art/making-the-canvas/";
      const primary = (record.media || []).find((item) => item.role === "primary") || record.media?.[0];
      for (const feature of features) {
        const title = feature.querySelector("[data-practice-feature-title]");
        const summary = feature.querySelector("[data-practice-feature-summary]");
        if (title) title.textContent = record.title;
        if (summary) summary.textContent = record.summary;
        feature.querySelectorAll("[data-practice-feature-link],[data-practice-feature-media]").forEach((link) => { link.href = route; });
        const media = feature.querySelector("[data-practice-feature-media]");
        const image = feature.querySelector("[data-practice-feature-image]");
        if (primary?.url && media && image) {
          image.src = primary.url;
          image.alt = primary.alt || record.title;
          media.hidden = false;
        }
      }
    })
    .catch(() => {});
})();
