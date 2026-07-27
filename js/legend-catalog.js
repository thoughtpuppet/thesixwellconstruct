(function () {
  const root = document.querySelector("[data-live-legend]");
  const filters = document.querySelector("[data-live-legend-filters]");
  const search = document.querySelector("[data-live-legend-search]");
  const legend = window.SixWellLegend;
  if (!root || !filters || !search || !legend) return;

  function render(records, categories) {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    let activeCategory = "all";
    let query = "";

    function paint() {
      const normalizedQuery = query.toLowerCase();
      const visible = records.filter((record) => {
        if (activeCategory !== "all" && record.category_id !== activeCategory) return false;
        if (!normalizedQuery) return true;
        const layers = legend.recordLayers(record);
        return [
          record.name,
          record.meaning,
          categoryById.get(record.category_id)?.name,
          ...layers.themes,
          ...legend.contextSearchText(layers.context),
        ].join(" ").toLowerCase().includes(normalizedQuery);
      });

      root.innerHTML = visible.length ? visible.map((record) => {
        const count = legend.layerCount(record);
        const category = categoryById.get(record.category_id)?.name || record.category_id;
        return `<a class="legend-card" href="${legend.escapeHtml(legend.canonicalRoute(record))}" data-symbol="${legend.escapeHtml(record.slug || record.id)}"><div class="legend-mark" aria-hidden="true">${legend.safeSvg(record.svg_markup)}</div><span class="kicker">${legend.escapeHtml(category)}</span><h3 class="legend-card-title">${legend.escapeHtml(record.name)}</h3><p>${legend.escapeHtml(record.meaning)}</p><span class="card-bottom"><span class="layer-count metadata legend-ghost">${count ? `${count} documented layer${count === 1 ? "" : "s"}` : "Core record"}</span><span class="open-cue" aria-hidden="true">↗</span></span></a>`;
      }).join("") : '<p class="legend-empty">No published symbols match this view.</p>';
      search.dataset.analyticsResults = String(visible.length);
    }

    filters.innerHTML = [{ id: "all", name: "All" }, ...categories]
      .map((category) => `<button class="btn legend-filter" type="button" data-category="${legend.escapeHtml(category.id)}" aria-pressed="${category.id === activeCategory}">${legend.escapeHtml(category.name)}</button>`)
      .join("");
    filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      activeCategory = button.dataset.category;
      window.SixWellAnalytics?.track("filter_change", {
        action: "legend-category",
        itemId: activeCategory,
      });
      filters.querySelectorAll("button").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      paint();
    });
    search.addEventListener("input", () => {
      query = search.value.trim();
      paint();
    });
    paint();
  }

  Promise.all([
    fetch("/api/legend", { cache: "no-store", headers: { accept: "application/json" } }),
    fetch("/api/legend/categories", { cache: "no-store", headers: { accept: "application/json" } }),
  ]).then(async ([symbolsResponse, categoriesResponse]) => {
    if (!symbolsResponse.ok || !categoriesResponse.ok) throw new Error();
    const [symbols, categories] = await Promise.all([
      symbolsResponse.json(),
      categoriesResponse.json(),
    ]);
    render(symbols.records || [], categories.records || []);
  }).catch(() => {
    root.innerHTML = '<p class="legend-empty" role="alert">The Legend is temporarily unavailable.</p>';
  });
})();
