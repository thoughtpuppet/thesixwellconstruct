(function () {
  const root = document.querySelector("[data-live-legend]");
  const filters = document.querySelector("[data-live-legend-filters]");
  if (!root || !filters) return;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));

  function render(records, categories) {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    let active = "all";
    function openSymbol(record, card, push = true) {
      root.querySelectorAll(".legend-card").forEach((item) => { item.style.outline = ""; item.removeAttribute("aria-current"); });
      card.style.outline = "4px solid currentColor";
      card.style.outlineOffset = "6px";
      card.setAttribute("aria-current", "true");
      if (push) { const url = new URL(location.href); url.searchParams.set("symbol", record.slug || record.id); history.pushState({ symbol: record.id }, "", url); }
      document.querySelector("[data-legend-connections]")?.remove();
      const host = document.createElement("section");
      host.dataset.legendConnections = "";
      root.insertAdjacentElement("afterend", host);
      const mount = () => window.ConstructConnections?.mount({ entityId: record.id, host });
      if (window.ConstructConnections) mount();
      else { const script = document.createElement("script"); script.src = "/js/construct-connections.js?v=1"; script.onload = mount; document.head.appendChild(script); }
    }

    const paint = () => {
      const visible = active === "all" ? records : records.filter((record) => record.category_id === active);
      root.innerHTML = visible.length ? visible.map((record) => `
        <article class="legend-card" data-symbol="${escapeHtml(record.slug || record.id)}">
          <div class="legend-mark" aria-hidden="true">${record.svg_markup || ""}</div>
          <span class="index">${escapeHtml(categoryById.get(record.category_id)?.name || record.category_id)}</span>
          <h3>${escapeHtml(record.name)}</h3>
          <p>${escapeHtml(record.meaning)}</p>
        </article>
      `).join("") : '<p class="legend-empty">No published symbols in this category.</p>';
      root.querySelectorAll("[data-symbol]").forEach((card) => {
        const record = records.find((item) => (item.slug || item.id) === card.dataset.symbol);
        card.tabIndex = 0;
        card.setAttribute("role", "link");
        card.addEventListener("click", () => openSymbol(record, card));
        card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openSymbol(record, card); } });
      });
    };

    filters.innerHTML = [{ id: "all", name: "All" }, ...categories].map((category) => `
      <button type="button" data-category="${escapeHtml(category.id)}" aria-pressed="${category.id === active}">${escapeHtml(category.name)}</button>
    `).join("");
    filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      active = button.dataset.category;
      filters.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      paint();
    });
    paint();
    const selected = new URL(location.href).searchParams.get("symbol");
    const selectedCard = selected ? root.querySelector(`[data-symbol="${CSS.escape(selected)}"]`) : null;
    if (selectedCard) {
      const selectedRecord = records.find((record) => (record.slug || record.id) === selected);
      openSymbol(selectedRecord, selectedCard, false);
      requestAnimationFrame(() => { selectedCard.scrollIntoView({ block: "center" }); selectedCard.focus({ preventScroll: true }); });
    }
    window.addEventListener("popstate", () => { const symbol = new URL(location.href).searchParams.get("symbol"), card = symbol ? root.querySelector(`[data-symbol="${CSS.escape(symbol)}"]`) : null, record = records.find((item) => (item.slug || item.id) === symbol); if (card && record) openSymbol(record, card, false); else document.querySelector("[data-legend-connections]")?.remove(); });
  }

  Promise.all([
    fetch("/api/legend", { cache: "no-store", headers: { accept: "application/json" } }),
    fetch("/api/legend/categories", { cache: "no-store", headers: { accept: "application/json" } }),
  ]).then(async ([symbolsResponse, categoriesResponse]) => {
    if (!symbolsResponse.ok || !categoriesResponse.ok) throw new Error();
    const [symbols, categories] = await Promise.all([symbolsResponse.json(), categoriesResponse.json()]);
    render(symbols.records || [], categories.records || []);
  }).catch(() => {
    root.innerHTML = '<p class="legend-empty" role="alert">The Legend is temporarily unavailable.</p>';
  });
})();
