(function () {
  const root = document.querySelector("[data-live-legend]");
  const filters = document.querySelector("[data-live-legend-filters]");
  const detail = document.querySelector("[data-live-legend-detail]");
  const search = document.querySelector("[data-live-legend-search]");
  if (!root || !filters || !detail || !search) return;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));

  const parseList = (value) => {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  };

  const parseObject = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  };

  function safeUrl(value) {
    const url = String(value || "").trim();
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? url : ""; } catch { return ""; }
  }

  function safeSvg(markup) {
    const source = String(markup || "").trim();
    if (!source || /<!DOCTYPE|<!ENTITY/i.test(source)) return "";
    const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
    if (documentNode.querySelector("parsererror") || documentNode.documentElement.localName !== "svg") return "";
    const svg = documentNode.documentElement;
    documentNode.querySelectorAll("script,foreignObject,iframe,object,embed,link,style,a,image,animate,set,metadata").forEach((element) => element.remove());
    svg.querySelectorAll("*").forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const unsafePaint = [...value.matchAll(/url\s*\(\s*([^)]*)\)/gi)].some((match) => !/^['"]?#[a-zA-Z][\w:.-]*['"]?$/.test(match[1].trim()));
        const unsafeHref = ["href", "xlink:href"].includes(name) && !/^#[a-zA-Z][\w:.-]*$/.test(value.trim());
        if (name.startsWith("on") || ["src", "style"].includes(name) || unsafeHref || /javascript:|data:text\/html|expression\s*\(|@import/i.test(value) || unsafePaint) element.removeAttribute(attribute.name);
      });
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return new XMLSerializer().serializeToString(svg);
  }

  function recordsFor(record) {
    const rawContext = parseObject(record.context || record.context_json);
    const sources = Array.isArray(rawContext.sources) ? rawContext.sources.map((source) => ({
      title: String(source?.title || "").trim(),
      creator: String(source?.creator || "").trim(),
      url: safeUrl(source?.url),
      note: String(source?.note || "").trim(),
    })).filter((source) => source.title && source.url) : [];
    const context = {
      modes: parseList(rawContext.modes),
      cultural_context: String(rawContext.cultural_context || "").trim(),
      personal_relationship: String(rawContext.personal_relationship || "").trim(),
      reorientation: {
        mode: String(rawContext.reorientation?.mode || "").trim(),
        statement: String(rawContext.reorientation?.statement || "").trim(),
      },
      overlap_or_tension: String(rawContext.overlap_or_tension || "").trim(),
      viewer_opening: String(rawContext.viewer_opening || "").trim(),
      sources,
    };
    context.authored = Boolean(context.cultural_context || context.personal_relationship || context.reorientation.statement || context.overlap_or_tension || context.viewer_opening || context.sources.length);
    return {
      themes: parseList(record.themes || record.themes_json),
      context,
      applications: parseList(record.applications || record.applications_json),
      variants: parseList(record.variants || record.variants_json),
      appearances: parseList(record.examples || record.examples_json),
    };
  }

  function undocumented(copy) {
    return `<p class="layer-undocumented">${escapeHtml(copy)}</p>`;
  }

  const REORIENTATION_LABELS = {
    expanded: "Expanded",
    inverted: "Inverted",
    contested: "Contested",
    detached: "Detached",
    combined: "Combined",
  };

  function renderInfluence(context) {
    if (!context.authored) return "";
    const cards = [];
    if (context.cultural_context) cards.push(`<article class="influence-card"><span class="influence-label">Cultural or inherited</span><h5>Inherited and shared associations</h5><p>${escapeHtml(context.cultural_context)}</p></article>`);
    if (context.personal_relationship) cards.push(`<article class="influence-card"><span class="influence-label">Personal or lived</span><h5>My relationship</h5><p>${escapeHtml(context.personal_relationship)}</p></article>`);
    if (context.reorientation.statement) cards.push(`<article class="influence-card influence-card--reoriented"><span class="influence-label">Reoriented · ${escapeHtml(REORIENTATION_LABELS[context.reorientation.mode] || context.reorientation.mode)}</span><h5>My interpretive move</h5><p>${escapeHtml(context.reorientation.statement)}</p></article>`);
    if (context.overlap_or_tension) cards.push(`<article class="influence-card"><span class="influence-label">Overlap and tension</span><h5>Where the meanings meet</h5><p>${escapeHtml(context.overlap_or_tension)}</p></article>`);
    if (context.viewer_opening) cards.push(`<article class="influence-card"><span class="influence-label">Open reading</span><h5>Room for the viewer</h5><p>${escapeHtml(context.viewer_opening)}</p></article>`);
    const sources = context.sources.length ? `<div class="influence-sources"><span class="influence-label">Curated sources</span><ul>${context.sources.map((source) => {
      const external = /^https?:/i.test(source.url);
      return `<li><a href="${escapeHtml(source.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}><strong>${escapeHtml(source.title)}</strong>${source.creator ? `<span>${escapeHtml(source.creator)}</span>` : ""}</a>${source.note ? `<p>${escapeHtml(source.note)}</p>` : ""}</li>`;
    }).join("")}</ul></div>` : "";
    return `<div class="influence-grid">${cards.join("")}</div>${sources}`;
  }

  function contextSearchText(context) {
    return [context.cultural_context, context.personal_relationship, context.reorientation.mode, context.reorientation.statement, context.overlap_or_tension, context.viewer_opening, ...context.sources.flatMap((source) => [source.title, source.creator, source.note])];
  }

  function renderApplications(applications) {
    if (!applications.length) return undocumented("Context-dependent readings are still being mapped for this symbol.");
    return `<div class="application-list">${applications.map((application) => {
      const visual = safeSvg(application.svg_markup);
      return `<article class="application${visual ? "" : " application--text"}">${visual ? `<div class="application-visual">${visual}</div>` : ""}<div><h5>${escapeHtml(application.title)}</h5><p class="meaning-shift">${escapeHtml(application.meaning)}</p>${application.note ? `<p class="context-note">${escapeHtml(application.note)}</p>` : ""}</div></article>`;
    }).join("")}</div>`;
  }

  function renderVariants(variants) {
    if (!variants.length) return undocumented("Formal and material variants are still being documented for this symbol.");
    return `<div class="variant-grid">${variants.map((variant) => {
      const visual = safeSvg(variant.svg_markup);
      const image = safeUrl(variant.image_url);
      if (!visual && !image) return "";
      return `<article class="variant"><div class="variant-visual">${visual || `<img src="${escapeHtml(image)}" alt="${escapeHtml(`${variant.name || "Symbol"} variant`)}" loading="lazy">`}</div><div class="variant-copy">${variant.style ? `<span class="variant-style">${escapeHtml(variant.style)}</span>` : ""}<h5>${escapeHtml(variant.name)}</h5>${variant.note ? `<p>${escapeHtml(variant.note)}</p>` : ""}</div></article>`;
    }).join("")}</div>`;
  }

  function renderAppearances(appearances) {
    if (!appearances.length) return undocumented("Image-led appearances will gather here as work is documented.");
    return `<div class="appearance-grid">${appearances.map((appearance) => {
      const src = safeUrl(appearance.src);
      const href = safeUrl(appearance.href);
      const tag = href ? "a" : "article";
      return `<${tag} class="appearance"${href ? ` href="${escapeHtml(href)}"` : ""}>${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(appearance.title || "Documented symbol appearance")}" loading="lazy">` : ""}<div class="appearance-copy">${appearance.medium ? `<span class="appearance-medium">${escapeHtml(appearance.medium)}</span>` : ""}<h5>${escapeHtml(appearance.title)}</h5>${appearance.caption ? `<p>${escapeHtml(appearance.caption)}</p>` : ""}</div></${tag}>`;
    }).join("")}</div>`;
  }

  function mountConnections(record) {
    const host = detail.querySelector("[data-detail-connections]");
    if (!host) return;
    const mount = () => Promise.resolve(window.ConstructConnections?.mount({ entityId: record.id, host })).then(() => {
      if (host.hidden || !host.hasChildNodes()) {
        host.hidden = false;
        host.innerHTML = '<p class="layer-undocumented">No connected works have been published for this symbol yet.</p>';
      }
    });
    if (window.ConstructConnections) mount();
    else {
      const existing = document.querySelector('script[src^="/js/construct-connections.js"]');
      if (existing) existing.addEventListener("load", mount, { once: true });
      else { const script = document.createElement("script"); script.src = "/js/construct-connections.js?v=1"; script.addEventListener("load", mount, { once: true }); document.head.appendChild(script); }
    }
  }

  function render(records, categories) {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    let activeCategory = "all";
    let query = "";
    let selectedId = "";

    function closeSymbol({ push = true, restoreFocus = true } = {}) {
      const previous = selectedId;
      selectedId = "";
      detail.hidden = true;
      detail.innerHTML = "";
      root.querySelectorAll("[data-symbol]").forEach((card) => card.removeAttribute("aria-current"));
      if (push) { const url = new URL(location.href); url.searchParams.delete("symbol"); history.pushState({}, "", url); }
      if (restoreFocus && previous) root.querySelector(`[data-symbol="${CSS.escape(previous)}"]`)?.focus();
    }

    function openSymbol(record, { push = true, move = true } = {}) {
      if (!record) return;
      selectedId = record.slug || record.id;
      const layers = recordsFor(record);
      const category = categoryById.get(record.category_id)?.name || record.category_id;
      const canonical = safeSvg(record.svg_markup);
      const influenceOffset = layers.context.authored ? 1 : 0;
      root.querySelectorAll("[data-symbol]").forEach((card) => {
        if (card.dataset.symbol === selectedId) card.setAttribute("aria-current", "true");
        else card.removeAttribute("aria-current");
      });
      detail.innerHTML = `<div class="detail-topline"><span class="section-index">Symbol record · ${escapeHtml(category)}</span><button type="button" data-close-symbol>Close</button></div><div class="detail-hero"><div class="detail-mark">${canonical}</div><div class="detail-copy"><span class="index">${escapeHtml(category)} · Canonical mark</span><h3 tabindex="-1">${escapeHtml(record.name)}</h3><p class="core-meaning">${escapeHtml(record.meaning)}</p>${layers.themes.length ? `<div class="theme-list" aria-label="Themes">${layers.themes.map((theme) => `<span>${escapeHtml(theme)}</span>`).join("")}</div>` : ""}</div></div>
        ${layers.context.authored ? `<section class="detail-layer detail-layer--influence"><div class="layer-heading"><div><span class="section-index">01 · Influence</span><h4>Influence &amp; relationship</h4></div><p>Where inherited associations, lived experience, and deliberate reorientation meet. These lenses can overlap without changing the symbol's category.</p></div>${renderInfluence(layers.context)}</section>` : ""}
        <section class="detail-layer"><div class="layer-heading"><div><span class="section-index">${String(1 + influenceOffset).padStart(2, "0")} · Application</span><h4>Meaning in application</h4></div><p>These readings belong to particular operations or conditions. They extend the core meaning without replacing it.</p></div>${renderApplications(layers.applications)}</section>
        <section class="detail-layer"><div class="layer-heading"><div><span class="section-index">${String(2 + influenceOffset).padStart(2, "0")} · Form</span><h4>Visual versions</h4></div><p>The identity translated through different styles, dimensions, colors, materials, and systems.</p></div>${renderVariants(layers.variants)}</section>
        <section class="detail-layer"><div class="layer-heading"><div><span class="section-index">${String(3 + influenceOffset).padStart(2, "0")} · Trace</span><h4>Documented appearances</h4></div><p>Image-led evidence of the mark moving through the work.</p></div>${renderAppearances(layers.appearances)}</section>
        <section class="detail-connections"><div class="layer-heading"><div><span class="section-index">${String(4 + influenceOffset).padStart(2, "0")} · System</span><h4>Connected work</h4></div><p>Live relationships to tattoos, artworks, archive records, events, objects, and other parts of the Construct.</p></div><div data-detail-connections></div></section>`;
      detail.hidden = false;
      detail.querySelector("[data-close-symbol]").addEventListener("click", () => closeSymbol());
      mountConnections(record);
      if (push) { const url = new URL(location.href); url.searchParams.set("symbol", selectedId); history.pushState({ symbol: record.id }, "", url); }
      if (move) requestAnimationFrame(() => { detail.scrollIntoView({ block: "start" }); detail.querySelector("h3")?.focus({ preventScroll: true }); });
    }

    function paint() {
      const normalizedQuery = query.toLowerCase();
      const visible = records.filter((record) => {
        if (activeCategory !== "all" && record.category_id !== activeCategory) return false;
        if (!normalizedQuery) return true;
        const layers = recordsFor(record);
        return [record.name, record.meaning, categoryById.get(record.category_id)?.name, ...layers.themes, ...contextSearchText(layers.context)].join(" ").toLowerCase().includes(normalizedQuery);
      });
      root.innerHTML = visible.length ? visible.map((record) => {
        const layers = recordsFor(record);
        const layerCount = (layers.context.authored ? 1 : 0) + layers.applications.length + layers.variants.length + layers.appearances.length;
        const symbol = safeSvg(record.svg_markup);
        return `<button class="legend-card" type="button" data-symbol="${escapeHtml(record.slug || record.id)}"${selectedId === (record.slug || record.id) ? ' aria-current="true"' : ""}><div class="legend-mark" aria-hidden="true">${symbol}</div><span class="index">${escapeHtml(categoryById.get(record.category_id)?.name || record.category_id)}</span><h3>${escapeHtml(record.name)}</h3><p>${escapeHtml(record.meaning)}</p><span class="card-bottom"><span class="layer-count">${layerCount ? `${layerCount} documented layer${layerCount === 1 ? "" : "s"}` : "Core record"}</span><span class="open-cue" aria-hidden="true">↗</span></span></button>`;
      }).join("") : '<p class="legend-empty">No published symbols match this view.</p>';
    }

    filters.innerHTML = [{ id: "all", name: "All" }, ...categories].map((category) => `<button type="button" data-category="${escapeHtml(category.id)}" aria-pressed="${category.id === activeCategory}">${escapeHtml(category.name)}</button>`).join("");
    filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      activeCategory = button.dataset.category;
      filters.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      paint();
    });
    search.addEventListener("input", () => { query = search.value.trim(); paint(); });
    root.addEventListener("click", (event) => {
      const card = event.target.closest("[data-symbol]");
      if (!card) return;
      const record = records.find((item) => (item.slug || item.id) === card.dataset.symbol);
      openSymbol(record);
    });
    paint();
    const selected = new URL(location.href).searchParams.get("symbol");
    const selectedRecord = selected ? records.find((record) => (record.slug || record.id) === selected) : null;
    if (selectedRecord) openSymbol(selectedRecord, { push: false, move: true });
    window.addEventListener("popstate", () => {
      const symbol = new URL(location.href).searchParams.get("symbol");
      const record = symbol ? records.find((item) => (item.slug || item.id) === symbol) : null;
      if (record) openSymbol(record, { push: false, move: false });
      else closeSymbol({ push: false, restoreFocus: false });
    });
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
