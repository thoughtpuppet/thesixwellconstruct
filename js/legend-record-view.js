(function (global) {
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));

  function parseList(value) {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function safeUrl(value) {
    const url = String(value || "").trim();
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) ? url : "";
    } catch {
      return "";
    }
  }

  function safeSvg(markup) {
    const source = String(markup || "").trim();
    if (!source || /<!DOCTYPE|<!ENTITY/i.test(source)) return "";
    const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
    if (documentNode.querySelector("parsererror") || documentNode.documentElement.localName !== "svg") return "";
    const svg = documentNode.documentElement;
    documentNode.querySelectorAll("script,foreignObject,iframe,object,embed,link,style,a,image,animate,set,metadata").forEach((element) => element.remove());
    [svg, ...svg.querySelectorAll("*")].forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const unsafePaint = [...value.matchAll(/url\s*\(\s*([^)]*)\)/gi)]
          .some((match) => !/^['"]?#[a-zA-Z][\w:.-]*['"]?$/.test(match[1].trim()));
        const unsafeHref = ["href", "xlink:href"].includes(name) && !/^#[a-zA-Z][\w:.-]*$/.test(value.trim());
        if (
          name.startsWith("on") ||
          ["src", "style"].includes(name) ||
          unsafeHref ||
          /javascript:|data:text\/html|expression\s*\(|@import/i.test(value) ||
          unsafePaint
        ) element.removeAttribute(attribute.name);
      });
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return new XMLSerializer().serializeToString(svg);
  }

  function canonicalRoute(record) {
    const supplied = safeUrl(record?.canonicalRoute || record?.canonical_route);
    if (supplied) return supplied;
    return `/about/legend/${encodeURIComponent(record?.slug || record?.id || "")}/`;
  }

  function recordLayers(record) {
    const rawContext = parseObject(record?.context || record?.context_json);
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
    context.authored = Boolean(
      context.cultural_context ||
      context.personal_relationship ||
      context.reorientation.statement ||
      context.overlap_or_tension ||
      context.viewer_opening ||
      context.sources.length
    );
    return {
      themes: parseList(record?.themes || record?.themes_json),
      context,
      applications: parseList(record?.applications || record?.applications_json),
      variants: parseList(record?.variants || record?.variants_json),
      appearances: parseList(record?.examples || record?.examples_json),
    };
  }

  function contextSearchText(context) {
    return [
      context.cultural_context,
      context.personal_relationship,
      context.reorientation.mode,
      context.reorientation.statement,
      context.overlap_or_tension,
      context.viewer_opening,
      ...context.sources.flatMap((source) => [source.title, source.creator, source.note]),
    ];
  }

  function layerCount(record) {
    const layers = recordLayers(record);
    return (layers.context.authored ? 1 : 0) +
      layers.applications.length +
      layers.variants.length +
      layers.appearances.length;
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
    if (context.cultural_context) cards.push(`<article class="influence-card"><span class="influence-label metadata legend-accent-meta">Cultural or inherited</span><h3 class="legend-item-title">Inherited and shared associations</h3><p>${escapeHtml(context.cultural_context)}</p></article>`);
    if (context.personal_relationship) cards.push(`<article class="influence-card"><span class="influence-label metadata legend-accent-meta">Personal or lived</span><h3 class="legend-item-title">My relationship</h3><p>${escapeHtml(context.personal_relationship)}</p></article>`);
    if (context.reorientation.statement) cards.push(`<article class="influence-card influence-card--reoriented"><span class="influence-label metadata legend-accent-meta">Reoriented · ${escapeHtml(REORIENTATION_LABELS[context.reorientation.mode] || context.reorientation.mode)}</span><h3 class="legend-item-title">My interpretive move</h3><p>${escapeHtml(context.reorientation.statement)}</p></article>`);
    if (context.overlap_or_tension) cards.push(`<article class="influence-card"><span class="influence-label metadata legend-accent-meta">Overlap and tension</span><h3 class="legend-item-title">Where the meanings meet</h3><p>${escapeHtml(context.overlap_or_tension)}</p></article>`);
    if (context.viewer_opening) cards.push(`<article class="influence-card"><span class="influence-label metadata legend-accent-meta">Open reading</span><h3 class="legend-item-title">Room for the viewer</h3><p>${escapeHtml(context.viewer_opening)}</p></article>`);
    const sources = context.sources.length ? `<div class="influence-sources"><span class="influence-label metadata legend-accent-meta">Curated sources</span><ul>${context.sources.map((source) => {
      const external = /^https?:/i.test(source.url);
      return `<li><a href="${escapeHtml(source.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}><strong class="legend-source-title">${escapeHtml(source.title)}</strong>${source.creator ? `<span class="metadata legend-accent-meta">${escapeHtml(source.creator)}</span>` : ""}</a>${source.note ? `<p>${escapeHtml(source.note)}</p>` : ""}</li>`;
    }).join("")}</ul></div>` : "";
    return `<div class="influence-grid">${cards.join("")}</div>${sources}`;
  }

  function renderApplications(applications) {
    if (!applications.length) return undocumented("Context-dependent readings are still being mapped for this symbol.");
    return `<div class="application-list">${applications.map((application) => {
      const visual = safeSvg(application.svg_markup);
      return `<article class="application${visual ? "" : " application--text"}">${visual ? `<div class="application-visual">${visual}</div>` : ""}<div><h3 class="legend-item-title">${escapeHtml(application.title)}</h3><p class="meaning-shift">${escapeHtml(application.meaning)}</p>${application.note ? `<p class="context-note">${escapeHtml(application.note)}</p>` : ""}</div></article>`;
    }).join("")}</div>`;
  }

  function renderVariants(variants) {
    if (!variants.length) return undocumented("Formal and material variants are still being documented for this symbol.");
    return `<div class="variant-grid">${variants.map((variant) => {
      const visual = safeSvg(variant.svg_markup);
      const image = safeUrl(variant.image_url);
      const href = safeUrl(variant.href);
      if (!visual && !image) return "";
      const tag = href ? "a" : "article";
      return `<${tag} class="variant"${href ? ` href="${escapeHtml(href)}"` : ""}><div class="variant-visual">${visual || `<img src="${escapeHtml(image)}" alt="${escapeHtml(`${variant.name || "Symbol"} variant`)}" loading="lazy">`}</div><div class="variant-copy">${variant.style ? `<span class="variant-style metadata legend-accent-meta">${escapeHtml(variant.style)}</span>` : ""}<h3 class="legend-item-title">${escapeHtml(variant.name)}</h3>${variant.note ? `<p>${escapeHtml(variant.note)}</p>` : ""}</div></${tag}>`;
    }).join("")}</div>`;
  }

  function renderAppearances(appearances) {
    if (!appearances.length) return undocumented("Image-led appearances will gather here as work is documented.");
    return `<div class="appearance-grid">${appearances.map((appearance) => {
      const src = safeUrl(appearance.src);
      const href = safeUrl(appearance.href);
      const tag = href ? "a" : "article";
      return `<${tag} class="appearance"${href ? ` href="${escapeHtml(href)}"` : ""}>${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(appearance.title || "Documented symbol appearance")}" loading="lazy">` : ""}<div class="appearance-copy">${appearance.medium ? `<span class="appearance-medium metadata legend-accent-meta">${escapeHtml(appearance.medium)}</span>` : ""}<h3 class="legend-item-title">${escapeHtml(appearance.title)}</h3>${appearance.caption ? `<p>${escapeHtml(appearance.caption)}</p>` : ""}</div></${tag}>`;
    }).join("")}</div>`;
  }

  function recordNavigation(navigation) {
    const previous = navigation?.previous;
    const next = navigation?.next;
    const neighbor = (record, label, relation) => record
      ? `<a class="legend-neighbor legend-neighbor--${relation}" href="${escapeHtml(record.canonicalRoute)}" rel="${relation}"><span class="metadata legend-ghost">${label}</span><strong>${escapeHtml(record.name)}</strong></a>`
      : "";
    return `<nav class="legend-record-navigation" aria-label="Browse Legend records"><a class="btn legend-record-back" href="/about/legend/">← Back to the Legend</a><div class="legend-neighbors">${neighbor(previous, "Previous symbol", "prev")}${neighbor(next, "Next symbol", "next")}</div></nav>`;
  }

  function mountConnections(record, host) {
    const connectionHost = host.querySelector("[data-detail-connections]");
    if (!connectionHost) return;
    const mount = () => Promise.resolve(global.ConstructConnections?.mount({
      entityId: record.id,
      host: connectionHost,
      embedded: true,
    })).then(() => {
      if (connectionHost.hidden || !connectionHost.hasChildNodes()) {
        connectionHost.hidden = false;
        connectionHost.innerHTML = '<p class="layer-undocumented">No connected works have been published for this symbol yet.</p>';
      }
    });
    if (global.ConstructConnections) mount();
    else {
      const existing = document.querySelector('script[src^="/js/construct-connections.js"]');
      if (existing) existing.addEventListener("load", mount, { once: true });
      else {
        const script = document.createElement("script");
        script.src = "/js/construct-connections.js?v=7";
        script.addEventListener("load", mount, { once: true });
        document.head.appendChild(script);
      }
    }
  }

  function renderRecord(host, payload) {
    const record = payload?.record;
    if (!host || !record) return false;
    const category = payload.category || {};
    const categoryName = category.name || record.category_id || "Legend";
    const layers = recordLayers(record);
    const canonical = safeSvg(record.svg_markup);
    const influenceOffset = layers.context.authored ? 1 : 0;
    host.innerHTML = `<header class="legend-record-hero site-hero site-hero--supporting" aria-labelledby="legend-record-title">
        <div class="detail-mark">${canonical}</div>
        <div class="detail-copy">
          <span class="section-kicker">about / legend / ${escapeHtml(categoryName)}</span>
          <h1 class="hero-title detail-title" id="legend-record-title">${escapeHtml(record.name)}</h1>
          <p class="section-intro hero-descriptor">A ${escapeHtml(categoryName)} record from the living Legend</p>
          <p class="core-meaning">${escapeHtml(record.meaning)}</p>
          ${layers.themes.length ? `<div class="theme-list" aria-label="Themes">${layers.themes.map((theme) => `<span class="metadata legend-accent-meta">${escapeHtml(theme)}</span>`).join("")}</div>` : ""}
        </div>
        <nav class="section-nav" aria-label="about sections">
          <a href="/about/#orientation">ABOUT</a>
          <a href="/about/visual-language/">Visual language</a>
          <a href="/about/breakdown/">Breakdown</a>
          <a href="/about/founder/">Founder</a>
          <a href="/about/mediums/">Mediums</a>
          <a href="/about/ways-in/">Ways in</a>
          <a href="/about/current-state/">Current state</a>
          <a href="/about/contact-press/">Contact / press</a>
        </nav>
      </header>
      <div class="legend-record-layers">
        ${layers.context.authored ? `<section class="detail-layer detail-layer--influence" aria-labelledby="legend-influence-title"><div class="layer-heading"><div><span class="kicker">01 · Influence</span><h2 class="band-title section-title legend-layer-title" id="legend-influence-title">Influence &amp; relationship</h2></div><p>Where inherited associations, lived experience, and deliberate reorientation meet. These lenses can overlap without changing the symbol's category.</p></div>${renderInfluence(layers.context)}</section>` : ""}
        <section class="detail-layer" aria-labelledby="legend-application-title"><div class="layer-heading"><div><span class="kicker">${String(1 + influenceOffset).padStart(2, "0")} · Application</span><h2 class="band-title section-title legend-layer-title" id="legend-application-title">Meaning in application</h2></div><p>These readings belong to particular operations or conditions. They extend the core meaning without replacing it.</p></div>${renderApplications(layers.applications)}</section>
        <section class="detail-layer" aria-labelledby="legend-form-title"><div class="layer-heading"><div><span class="kicker">${String(2 + influenceOffset).padStart(2, "0")} · Form</span><h2 class="band-title section-title legend-layer-title" id="legend-form-title">Visual versions</h2></div><p>The identity translated through different styles, dimensions, colors, materials, and systems.</p></div>${renderVariants(layers.variants)}</section>
        <section class="detail-layer" aria-labelledby="legend-trace-title"><div class="layer-heading"><div><span class="kicker">${String(3 + influenceOffset).padStart(2, "0")} · Trace</span><h2 class="band-title section-title legend-layer-title" id="legend-trace-title">Documented appearances</h2></div><p>Image-led evidence of the mark moving through the work.</p></div>${renderAppearances(layers.appearances)}</section>
        <section class="detail-connections" aria-labelledby="legend-system-title"><div class="layer-heading"><div><span class="kicker">${String(4 + influenceOffset).padStart(2, "0")} · System</span><h2 class="band-title section-title legend-layer-title" id="legend-system-title">Connected work</h2></div><p>Live relationships to tattoos, artworks, archive records, events, objects, and other parts of the Construct.</p></div><div data-detail-connections></div></section>
      </div>
      ${recordNavigation(payload.navigation)}`;
    mountConnections(record, host);
    return true;
  }

  global.SixWellLegend = Object.freeze({
    canonicalRoute,
    contextSearchText,
    escapeHtml,
    layerCount,
    recordLayers,
    renderRecord,
    safeSvg,
    safeUrl,
  });
})(window);
