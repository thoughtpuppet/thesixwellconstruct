(function () {
  "use strict";

  const app = document.querySelector("[data-archive-app]");
  const view = document.body.dataset.archiveView;
  if (!app || !view) return;

  const facetDefinitions = [
    ["medium", "Medium"],
    ["brand", "Brand"],
    ["person", "Person"],
    ["era", "Era"],
    ["collection", "Collection"],
    ["record_type", "Record type"],
    ["material_type", "Material type"],
  ];
  const discoveryParams = ["color","match","color_family","pigment","presence","material"];

  const roomLinks = [
    ["art", "Art", "/archive/art/"],
    ["tattoos", "Tattooing", "/archive/tattoos/"],
    ["merch", "Merch", "/archive/merch/"],
    ["events", "Events", "/archive/events/"],
    ["music", "Music", "/archive/music/"],
    ["writings", "Writings", "/archive/writings/"],
    ["film", "Film", "/archive/film/"],
    ["places", "Places", "/archive/places/"],
    ["sixwell-construct", "The Construct", "/archive/sixwell-construct/"],
  ];

  const archiveMediumAliases = new Map(Object.entries({
    art: "art",
    artwork: "art",
    "art-work": "art",
    painting: "art",
    drawing: "art",
    print: "art",
    sculpture: "art",
    photograph: "art",
    photography: "art",
    installation: "art",
    "mixed-media": "art",
    "digital-work": "art",
    tattoo: "tattoos",
    tattoos: "tattoos",
    tattooing: "tattoos",
    "tattoo-design": "tattoos",
    "tattoo-execution": "tattoos",
    flash: "tattoos",
    "flash-item": "tattoos",
    "flash-design": "tattoos",
    "portfolio-item": "tattoos",
    merch: "merch",
    merchandise: "merch",
    "merch-item": "merch",
    legend: "legend",
    legends: "legend",
    symbol: "legend",
    symbols: "legend",
    "visual-symbol": "legend",
    event: "events",
    events: "events",
    music: "music",
    "music-work": "music",
    writing: "writings",
    writings: "writings",
    "writing-work": "writings",
    film: "film",
    "film-work": "film",
    archive: "archive",
    other: "archive",
    "other-cultural-object": "archive",
    "other-website": "archive",
  }));

  const archiveBrandMediumAliases = new Map(Object.entries({
    thoughtpuppet: "art",
    "thought-puppet": "art",
    "org-thoughtpuppet": "art",
    "six-well": "merch",
    sixwell: "merch",
    "six-well-clothing": "merch",
    "art-pill": "tattoos",
    artpill: "tattoos",
    "art-pill-tattoo-house": "tattoos",
    "artpill-tattoo-house": "tattoos",
    "cult-shift": "events",
    "cult-and-shift": "events",
    cultandshift: "events",
    cultiv: "events",
    "the-seventh-room": "events",
    "seventh-room": "events",
    milowalksonwater: "music",
    "mindful-darkness": "writings",
    "the-solehman-letters": "writings",
    "solehman-letters": "writings",
    sloth99: "film",
  }));

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
  const inlineEmphasis = (value) => escapeHtml(value).replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  const text = (...values) => String(first(...values) || "").trim();
  const slugify = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const titleCase = (value) => text(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  function archiveObjectTypeLabel(record) {
    const objectTypeId = slugify(first(record && record.cultural_object_type_id, record && record.culturalObjectTypeId));
    const label = text(record && record.cultural_object_type, record && record.culturalObjectType);
    if (objectTypeId === "tattoo-execution" || slugify(label) === "tattoo-execution") return "Tattoo";
    if (objectTypeId === "tattoo-flash-design" || slugify(label) === "flash-design") return "Tattoo Design";
    return label;
  }
  const truncate = (value, length) => text(value).length > length ? `${text(value).slice(0, length - 1).trim()}…` : text(value);

  function archiveMediumKey(...values) {
    for (const value of values) {
      const key = archiveMediumAliases.get(slugify(value));
      if (key) return key;
    }
    return "";
  }

  function archiveBrandMediumKey(...values) {
    for (const value of values) {
      const key = archiveBrandMediumAliases.get(slugify(value));
      if (key) return key;
    }
    return "";
  }

  function recordMediumKey(record) {
    return archiveMediumKey(
      record && record.catalogue_medium,
      record && record.catalogueMedium,
      record && record.medium_label,
      record && record.medium,
      record && record.record_type,
      record && record.recordType,
      record && record.entity_type,
      record && record.entityType
    );
  }

  function filteredMediumKey(searchParams) {
    const selected = [
      [searchParams.get("medium"), archiveMediumKey],
      [first(searchParams.get("record_type"), searchParams.get("recordType")), archiveMediumKey],
      [searchParams.get("brand"), archiveBrandMediumKey],
    ].filter(([value]) => value);
    if (!selected.length) return "";
    const resolved = selected.map(([value, resolve]) => resolve(value));
    if (resolved.some((value) => !value)) return "";
    const unique = [...new Set(resolved)];
    return unique.length === 1 ? unique[0] : "";
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      const parsed = new URL(String(value), location.origin);
      if (!/^https?:$/.test(parsed.protocol)) return "";
      return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
      return "";
    }
  }

  function slugFromPath(segment) {
    const parts = location.pathname.split("/").filter(Boolean);
    const index = parts.indexOf(segment);
    const candidate = index >= 0 ? parts[index + 1] : "";
    if (candidate && candidate !== "index.html") return decodeURIComponent(candidate);
    return new URL(location.href).searchParams.get(segment === "records" ? "record" : "timeline") || "";
  }

  function mediaObject(record) {
    const candidate = first(
      record && record.primary_media,
      record && record.primaryMedia,
      record && record.primary_image,
      record && record.primaryImage,
      record && record.hero_media,
      record && record.image,
      list(record && record.media)[0],
      record && record.media_url,
      record && record.image_url
    );
    if (!candidate) return null;
    if (typeof candidate === "string") return { url: candidate };
    return candidate;
  }

  function mediaUrl(media) {
    return safeUrl(first(media && media.url, media && media.public_url, media && media.file_url, media && media.src, media && media.path));
  }

  function recordSlug(record) {
    return text(record.archive_slug, record.dossier_slug, record.slug, record.entity_slug, record.id);
  }

  function recordHref(record, match) {
    const supplied = safeUrl(first(record.archive_url, record.dossier_url, record.archive_path));
    const slug = recordSlug(record);
    const base = supplied || (slug ? `/archive/records/${encodeURIComponent(slug)}/` : "/archive/");
    let anchor = text(match && (match.anchor || match.dossier_anchor || match.fragment_anchor));
    if (anchor && !anchor.startsWith("#")) anchor = `#${slugify(anchor)}`;
    return `${base}${anchor}`;
  }

  function dateLabel(record) {
    return text(
      record.display_date,
      record.date_label,
      record.approximate_label,
      record.date_or_period,
      record.timeline_period,
      record.occurred_at,
      record.started_at,
      record.year,
      record.date,
      "Undated"
    );
  }

  function subjectExplorerUrl(subject) {
    const role = text(subject && subject.role).toLowerCase();
    const entityType = text(subject && (subject.entity_type || subject.entityType)).toLowerCase();
    const id = text(subject && (subject.entity_id || subject.id));
    const name = text(subject && (subject.name || subject.title || subject.slug || id));
    let key = "q";
    let value = text(subject && subject.slug, id, name);
    if (entityType === "person" || role.includes("founder") || role.includes("artist")) key = "person";
    else if (entityType === "organization" || id.startsWith("org-")) key = "brand";
    else if (role === "brand") key = "brand";
    else if (entityType === "construct_node" || role === "medium") {
      key = "medium";
      value = id.startsWith("node-") ? id.slice(5) : value;
      if (value === "tattoos") value = "tattoo";
    } else {
      value = name;
    }
    return `/archive/?${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  async function getJson(url, signal) {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal });
    if (!response.ok) {
      const error = new Error(`Archive request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function loading(message) {
    return `<div class="archive-loading" role="status"><span class="archive-loading-mark" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
  }

  function errorState(title, message) {
    return `<section class="archive-error" role="alert"><span class="archive-kicker">Archive unavailable</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><p><button class="archive-button" type="button" data-archive-retry>Try again</button></p></section>`;
  }

  function metadata(record) {
    const entries = [
      { value: text(first(record.medium_label, record.medium)), role: "medium" },
      { value: text(archiveObjectTypeLabel(record), record.record_type_label, record.record_type, record.entity_type, record.type), role: "record-type" },
      { value: text(first(record.brand_name, record.brand)), role: "brand" },
      { value: text(first(record.year, record.date_or_period)), role: "date" },
    ].filter((entry) => entry.value);
    const seen = new Set();
    return entries.filter((entry) => {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    });
  }

  function archiveRecordCardMarkup(record) {
    const media = mediaObject(record);
    const image = mediaUrl(media);
    const symbolMarkup = text(media && (media.svg_markup || media.svgMarkup));
    const match = record._matches && record._matches[0];
    const matchText = text(match && (match.snippet || match.excerpt || match.text || match.value),
      match && match.distance !== undefined ? `${match.color_name || "Color"} · CIEDE2000 distance ${match.distance}` : "",
      match && (match.color_name || match.family_name || match.material_name || match.pigment_code));
    const title = text(record.title, record.name, recordSlug(record), "Untitled record");
    const catalogue = catalogueLabel(record);
    const recordType = titleCase(text(archiveObjectTypeLabel(record), record.record_type_label, record.record_type, record.entity_type, record.type, "Archive record"));
    const medium = text(record.medium_label, record.medium, record.catalogue_medium, record.brand_name, record.brand);
    return `<article class="archive-record-card-shell"><a class="archive-record-card" href="${escapeHtml(recordHref(record, match))}">
      <span class="archive-record-card-media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(text(media.alt, media.alt_text, title))}" loading="lazy" decoding="async">` : symbolMarkup ? `<span class="archive-record-card-symbol" aria-hidden="true">${symbolMarkup}</span>` : `<span class="archive-record-card-placeholder" aria-hidden="true">${escapeHtml(title.slice(0, 2))}</span>`}</span>
      <span class="archive-record-card-badges"><span class="archive-record-card-catalogue">${escapeHtml(catalogue || "Archive record")}</span><span class="archive-record-card-type">${escapeHtml(recordType)}</span>${record.is_current ? `<span class="archive-record-card-current">Current</span>` : ""}</span>
      <span class="archive-record-card-meta"><span class="archive-record-card-date">${escapeHtml(dateLabel(record))}</span><h3>${escapeHtml(title)}</h3>${medium ? `<span class="archive-record-card-medium">${escapeHtml(medium)}</span>` : ""}${matchText ? `<span class="archive-record-card-match"><strong>Matched in ${escapeHtml(titleCase(text(match.type, match.kind, match.field, "record")))}</strong><span>${escapeHtml(truncate(matchText, 150))}</span></span>` : ""}</span>
    </a></article>`;
  }

  function normalizeItems(payload) {
    if (!payload || typeof payload !== "object") return [];
    const candidates = first(payload.items, payload.records, payload.results, payload.dossiers, payload.groups, []);
    return list(candidates).map((entry) => {
      const record = first(entry.item, entry.record, entry.dossier, entry.entity, entry);
      const matches = first(entry.matches, entry.fragments, record.matches, record.fragments, []);
      const merged = {
        ...(entry && entry.entity && typeof entry.entity === "object" ? entry.entity : {}),
        ...(entry && entry.dossier && typeof entry.dossier === "object" ? entry.dossier : {}),
        ...(entry && entry.item && typeof entry.item === "object" ? entry.item : {}),
        ...(entry && entry.record && typeof entry.record === "object" ? entry.record : {}),
      };
      return { ...(Object.keys(merged).length ? merged : record), _matches: list(matches) };
    });
  }

  function normalizeFacet(payload, key) {
    const facets = payload && payload.facets || {};
    const aliases = {
      record_type: ["record_type", "recordType", "types", "type"],
      material_type: ["material_type", "materialType", "material_types", "materials"],
      medium: ["medium", "mediums"],
      brand: ["brand", "brands", "organizations"],
      person: ["person", "people", "persons"],
      era: ["era", "eras", "years"],
      collection: ["collection", "collections"],
    }[key] || [key];
    const raw = first(...aliases.map((alias) => facets[alias]), []);
    if (Array.isArray(raw)) {
      return raw.map((option) => typeof option === "object"
        ? { value: text(option.value, option.slug, option.id, option.name, option.label), label: text(option.label, option.name, option.value, option.slug), count: first(option.count, option.total) }
        : { value: text(option), label: titleCase(option) }
      ).filter((option) => option.value);
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([value, count]) => ({ value, label: titleCase(value), count }));
    }
    return [];
  }

  function paragraphMarkup(value) {
    const paragraphs = text(value).split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  }

  function explorer() {
    const collectionsView = document.body.dataset.archiveRoom === "collections";
    document.title = `${collectionsView ? "Archive Collections" : "Living Archive"} · the six.well construct`;
    app.innerHTML = `
      <section class="archive-hero site-hero ${collectionsView ? "site-hero--supporting" : "site-hero--landing"}" aria-labelledby="archive-title">
        <div><span class="archive-kicker">Public living archive</span><h1 class="hero-title" id="archive-title">${collectionsView ? "Collections." : "Archive."}</h1></div>
        <div class="archive-hero-copy"><p class="hero-descriptor">${collectionsView ? "Move through records gathered around a shared body of work, period, place, or question." : "A dynamic process documenting this creative ecosystem as its history unfolds."}</p></div>
      </section>
      <section class="archive-origin-thread" data-origin-thread hidden></section>
      <section class="archive-search-panel" aria-label="Archive search and resources">
        <form class="archive-search-form" role="search" data-archive-search>
          <label class="archive-label" for="archive-query">Search the archive</label>
          <input id="archive-query" name="q" type="search" autocomplete="off" placeholder="Try a piece, material, person, symbol, or year">
          <button class="archive-search-button" type="submit">Search</button>
        </form>
        ${collectionsView ? "" : '<nav class="archive-actions archive-search-actions" aria-label="Archive resources"><a class="archive-button" href="/archive/notes/">Notes</a><a class="archive-button" href="/archive/timelines/">Timelines</a><a class="archive-button" href="/archive/places/">Places</a><a class="archive-button" href="/archive/maze/">Maze Archive</a><a class="archive-button" href="/archive/failed-experiments/">Failed Experiments</a><a class="archive-button" href="/archive/colors-materials/">Colors &amp; Materials</a><a class="archive-button" href="/archive/art/making-the-canvas/">Making the Canvas</a><a class="archive-button" href="/archive/guide/">Read the Archive Guide</a><a class="archive-button" href="/archive/blackboards/">View blackboards</a><a class="archive-button" href="/archive/compare/">Compare records</a></nav>'}
      </section>
      <section class="archive-explorer" aria-label="Archive explorer">
        <aside class="archive-filter-panel" aria-labelledby="archive-filter-title">
          <div class="archive-filter-heading"><h2 id="archive-filter-title">Refine</h2><button class="archive-clear" type="button" data-clear-filters>Clear all</button></div>
          <div class="archive-facets" data-archive-facets>${facetDefinitions.map(([key, label]) => `<div class="archive-facet"><label for="facet-${key}">${label}</label><select id="facet-${key}" name="${key}" disabled><option value="">Any ${label.toLowerCase()}</option></select></div>`).join("")}</div>
          <nav class="archive-room-list" aria-label="Archive rooms">${roomLinks.map(([key, label, href]) => `<a href="${href}"${location.pathname.includes(`/archive/${key}`) ? ' aria-current="page"' : ""}>${escapeHtml(label)}<span aria-hidden="true">↗</span></a>`).join("")}</nav>
        </aside>
        <div class="archive-results" id="records">
          <header class="archive-results-heading"><h2>${collectionsView ? "Records by collection" : "Published records"}</h2><span class="archive-count" data-archive-count aria-live="polite">Loading</span></header>
          <div class="archive-active-filters" data-active-filters aria-label="Active filters"></div>
          <div data-archive-results aria-live="polite" aria-busy="true">${loading("Reading the public index…")}</div>
          <nav class="archive-pagination" aria-label="Archive pages" data-archive-pagination hidden></nav>
        </div>
      </section>`;

    const searchForm = app.querySelector("[data-archive-search]");
    const queryInput = searchForm.elements.q;
    const facets = app.querySelector("[data-archive-facets]");
    const results = app.querySelector("[data-archive-results]");
    const resultsHeading = app.querySelector(".archive-results-heading");
    const count = app.querySelector("[data-archive-count]");
    const activeFilters = app.querySelector("[data-active-filters]");
    const pagination = app.querySelector("[data-archive-pagination]");
    const originHost = app.querySelector("[data-origin-thread]");
    let controller;
    let searchTimer;
    let lastFacetPayload = {};

    function params() {
      return new URL(location.href).searchParams;
    }

    function syncControls() {
      const current = params();
      const mediumKey = collectionsView ? "" : filteredMediumKey(current);
      if (mediumKey) resultsHeading.dataset.archiveMedium = mediumKey;
      else delete resultsHeading.dataset.archiveMedium;
      queryInput.value = current.get("q") || "";
      facetDefinitions.forEach(([key]) => {
        const select = facets.querySelector(`[name="${key}"]`);
        if (select) select.value = current.get(key) || "";
      });
      activeFilters.innerHTML = [...current.entries()]
        .filter(([key, value]) => value && (key === "q" || discoveryParams.includes(key) || facetDefinitions.some(([facet]) => facet === key)))
        .map(([key, value]) => `<button class="archive-chip" type="button" data-remove-filter="${escapeHtml(key)}"><span>${escapeHtml(key === "q" ? `Search: ${value}` : `${titleCase(key)}: ${titleCase(value)}`)}</span></button>`)
        .join("");
    }

    function navigate(update, mode) {
      const url = new URL(location.href);
      Object.entries(update).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
      if (!("page" in update)) url.searchParams.delete("page");
      history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
      syncControls();
      load();
    }

    function renderFacets(payload) {
      lastFacetPayload = Object.keys(payload && payload.facets || {}).length ? payload : lastFacetPayload;
      const current = params();
      facetDefinitions.forEach(([key, label]) => {
        const select = facets.querySelector(`[name="${key}"]`);
        const options = normalizeFacet(lastFacetPayload, key);
        const selected = current.get(key) || "";
        if (selected && !options.some((option) => option.value === selected)) options.unshift({ value: selected, label: titleCase(selected) });
        select.innerHTML = `<option value="">Any ${label.toLowerCase()}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}${option.count !== undefined ? ` (${escapeHtml(option.count)})` : ""}</option>`).join("")}`;
        select.value = selected;
        select.disabled = false;
      });
    }

    function renderOriginThread(payload) {
      const thread = first(payload.origin_thread, payload.originThread);
      if (!thread) {
        originHost.hidden = true;
        originHost.innerHTML = "";
        return;
      }
      const evidence = list(payload.evidence);
      const notes = list(payload.notes);
      originHost.hidden = false;
      originHost.innerHTML = `<header class="archive-origin-thread-header"><div><span class="archive-kicker">Origin thread</span><h2>${escapeHtml(text(thread.title, thread.slug))}</h2></div><div><p>${escapeHtml(text(thread.summary, "A curated record of the evidence and works that share this inception."))}</p><a class="archive-button" href="/archive/">Leave this thread</a></div></header><section class="archive-origin-evidence" aria-labelledby="origin-evidence-title"><div class="archive-section-heading"><span class="archive-section-index">Inception evidence</span><h2 class="archive-section-title" id="origin-evidence-title">Notes, references, and process</h2></div>${notes.length?`<div class="archive-notebook-grid">${notes.map(archiveNoteThumbnailMarkup).join("")}</div>`:""}${evidence.length?`<div class="archive-notebook">${evidence.map(materialMarkup).join("")}</div>`:notes.length?"":`<div class="archive-note-empty"><p>No public inception evidence has been released for this thread yet.</p></div>`}</section>${notes.length?archiveNoteDialogShellMarkup():""}`;
      setupArchiveNoteQuickView(notes);
    }

    function renderPagination(payload, total) {
      const info = first(payload.pagination, payload.page_info, {});
      const currentPage = Number(first(info.page, payload.page, params().get("page"), 1)) || 1;
      const pageSize = Number(first(info.limit, info.page_size, payload.limit, 24)) || 24;
      const totalPages = Number(first(info.pages, info.total_pages, Math.ceil(total / pageSize), 1)) || 1;
      if (totalPages <= 1) {
        pagination.hidden = true;
        return;
      }
      pagination.hidden = false;
      pagination.innerHTML = `<button class="archive-button" type="button" data-page="${currentPage - 1}"${currentPage <= 1 ? " disabled" : ""}>Previous</button><span>Page ${currentPage} of ${totalPages}</span><button class="archive-button" type="button" data-page="${currentPage + 1}"${currentPage >= totalPages ? " disabled" : ""}>Next</button>`;
    }

    async function load() {
      if (controller) controller.abort();
      controller = new AbortController();
      results.setAttribute("aria-busy", "true");
      results.innerHTML = loading("Reading the public index…");
      pagination.hidden = true;
      const current = params();
      const request = new URLSearchParams();
      ["q", "origin", "from", ...facetDefinitions.map(([key]) => key), ...discoveryParams, "page"].forEach((key) => {
        const value = current.get(key);
        if (value) request.set(key, value);
      });
      request.set("limit", "24");
      try {
        const itemPromise = getJson(`/api/archive/items?${request}`, controller.signal);
        const hasDiscoveryFilter = discoveryParams.some((key) => current.get(key));
        const searchPromise = current.get("q") && !hasDiscoveryFilter ? getJson(`/api/search?${request}`, controller.signal).catch(() => null) : Promise.resolve(null);
        const [itemPayload, searchPayload] = await Promise.all([itemPromise, searchPromise]);
        const itemResults = normalizeItems(itemPayload);
        const searched = normalizeItems(searchPayload);
        const records = searchPayload && (searched.length || Number(first(searchPayload.total, searchPayload.pagination && searchPayload.pagination.total, 0)) === 0) ? searched : itemResults;
        const total = Number(first(searchPayload && searchPayload.total, searchPayload && searchPayload.pagination && searchPayload.pagination.total, itemPayload.total, itemPayload.pagination && itemPayload.pagination.total, records.length)) || 0;
        queryInput.dataset.analyticsResults = String(total);
        renderOriginThread(itemPayload);
        renderFacets(itemPayload);
        count.textContent = `${total} ${total === 1 ? "record" : "records"}`;
        results.innerHTML = records.length ? `<div class="archive-record-card-grid">${records.map(archiveRecordCardMarkup).join("")}</div>` : `<section class="archive-empty"><span class="archive-kicker">No match</span><h2>Nothing public here yet.</h2><p>Try a broader term or clear one of the filters. Internal and unreviewed materials never appear in this index.</p><p><button class="archive-button" type="button" data-empty-clear>Clear filters</button></p></section>`;
        results.setAttribute("aria-busy", "false");
        renderPagination(searchPayload || itemPayload, total);
      } catch (error) {
        if (error.name === "AbortError") return;
        count.textContent = "Unavailable";
        results.setAttribute("aria-busy", "false");
        results.innerHTML = errorState("The index could not be opened.", "The public Archive is still here, but its live index did not answer. Try again in a moment.");
      }
    }

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearTimeout(searchTimer);
      navigate({ q: queryInput.value.trim() });
    });
    queryInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => navigate({ q: queryInput.value.trim() }, "replace"), 500);
    });
    facets.addEventListener("change", (event) => {
      window.SixWellAnalytics?.track("filter_change", { action: event.target.name, itemId: event.target.value || "all" });
      navigate({ [event.target.name]: event.target.value });
    });
    app.querySelector("[data-clear-filters]").addEventListener("click", () => {
      const url = new URL(location.href);
      ["q", "origin", "from", ...facetDefinitions.map(([key]) => key), ...discoveryParams, "page"].forEach((key) => url.searchParams.delete(key));
      history.pushState({}, "", url);
      syncControls();
      load();
    });
    activeFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-filter]");
      if (button) navigate({ [button.dataset.removeFilter]: "" });
    });
    pagination.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (button && !button.disabled) {
        navigate({ page: button.dataset.page });
        app.querySelector(".archive-results-heading").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    results.addEventListener("click", (event) => {
      const record = event.target.closest(".archive-record-card");
      if (record) window.SixWellAnalytics?.track("item_open", { action: "archive-record", itemId: new URL(record.href, location.href).pathname });
      if (event.target.closest("[data-empty-clear]")) app.querySelector("[data-clear-filters]").click();
      if (event.target.closest("[data-archive-retry]")) load();
    });
    window.addEventListener("popstate", () => { syncControls(); load(); });
    syncControls();
    load();
  }

  function normalizeDossier(payload) {
    const dossier = payload && payload.dossier || {};
    const item = { ...(payload && payload.entity || {}), ...(payload && payload.item || payload && payload.record || dossier || {}) };
    return {
      item,
      dossier,
      materials: list(first(payload && payload.materials, dossier.materials, item.materials, [])),
      notes: list(first(payload && payload.notes, dossier.notes, item.notes, [])),
      activities: list(first(payload && payload.activities, payload && payload.history, dossier.activities, item.activities, [])),
      relationships: list(first(payload && payload.relationships, payload && payload.connections, dossier.relationships, item.relationships, [])),
      originThreads: list(first(payload && payload.origin_threads, payload && payload.originThreads, dossier.origin_threads, item.origin_threads, [])),
      primaryOriginThread: first(payload && payload.primary_origin_thread, payload && payload.primaryOriginThread, dossier.primary_origin_thread, item.primary_origin_thread, null),
      subjects: list(first(payload && payload.subjects, dossier.subjects, item.subjects, [])),
      collections: list(first(payload && payload.collections, dossier.collections, item.collections, [])),
      versions: list(first(payload && payload.versions, dossier.versions, item.versions, [])),
      states: list(first(payload && payload.states, dossier.states, item.states, [])),
      documentation: list(first(payload && payload.documentation, dossier.documentation, item.documentation, [])),
      sourceMaterials: list(first(payload && payload.source_materials, payload && payload.sourceMaterials, payload && payload.evidence_sets, payload && payload.evidenceSets, dossier.source_materials, dossier.sourceMaterials, [])),
      colorUsages: list(first(payload && payload.color_usages, payload && payload.colorUsages, dossier.color_usages, item.color_usages, [])),
      materialUsages: list(first(payload && payload.material_usages, payload && payload.materialUsages, dossier.material_usages, item.material_usages, [])),
      paletteMaps: list(first(payload && payload.palette_maps, payload && payload.paletteMaps, dossier.palette_maps, item.palette_maps, [])),
      terms: list(first(payload && payload.terms, dossier.terms, item.terms, [])),
      webSnapshots: list(first(payload && payload.web_snapshots, payload && payload.webSnapshots, dossier.web_snapshots, dossier.webSnapshots, item.web_snapshots, item.webSnapshots, [])),
    };
  }

  function catalogueLabel(item) {
    const supplied = text(item.catalogue_label, item.catalogueLabel, item.record_identifier, item.recordIdentifier, item.event_id, item.eventId);
    if (supplied) return supplied;
    const base = text(item.catalogue_id, item.catalogueId);
    if (!base) return "";
    const version = Math.max(1, Number(first(item.current_version, item.currentVersion, 1)));
    const state = text(item.current_state, item.currentState, "I").toUpperCase();
    const variant = text(item.catalogue_variant, item.variant_label, item.variantLabel);
    return `${base}.${version}/${state}${variant ? `, ${variant}` : ""}`;
  }

  function stateLabel(state, version) {
    const versionNumber = Number(first(version && version.version_number, version && version.versionNumber, state.version_number, 1));
    const roman = text(state.state_roman, state.stateRoman, "I").toUpperCase();
    const variant = text(state.variant_label, state.variantLabel);
    return `Version ${versionNumber}, State ${roman}${variant ? `, ${variant}` : ""}`;
  }

  function safeWebViewerUrl(value) {
    const supplied = safeUrl(value);
    if (!supplied) return "";
    try {
      const parsed = new URL(supplied, location.origin);
      const localHosts = new Set(["127.0.0.1", "localhost"]);
      if (localHosts.has(location.hostname)) {
        return localHosts.has(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
      }
      return parsed.protocol === "https:" && parsed.hostname === "archive-viewer.thesixwellconstruct.com" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function webSnapshotSummary(snapshot) {
    const supplied = first(snapshot.dependency_summary, snapshot.dependencySummary, {});
    if (supplied && typeof supplied === "object" && !Array.isArray(supplied)) return supplied;
    try {
      const parsed = JSON.parse(supplied || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function webSnapshotTitle(snapshot, index) {
    return text(snapshot.title, snapshot.state_label, snapshot.stateLabel, `Website snapshot ${index + 1}`);
  }

  function webSnapshotPlacement(snapshot) {
    const supplied = text(snapshot.version_state_label, snapshot.versionStateLabel, snapshot.state_label, snapshot.stateLabel);
    if (supplied) return supplied;
    const versionNumber = first(snapshot.version_number, snapshot.versionNumber);
    const versionTitle = text(snapshot.version_title, snapshot.versionTitle);
    const stateRoman = text(snapshot.state_roman, snapshot.stateRoman);
    const stateTitle = text(snapshot.state_title, snapshot.stateTitle);
    if (versionNumber || versionTitle || stateRoman || stateTitle) return [versionNumber ? `Version ${versionNumber}` : versionTitle, stateRoman ? `State ${stateRoman}` : "", stateTitle].filter(Boolean).join(" · ");
    return "Documented website state";
  }

  function webSnapshotProvenanceMarkup(snapshot) {
    const commit = text(snapshot.git_commit_sha, snapshot.gitCommitSha);
    const treeHash = text(snapshot.tree_sha256, snapshot.tree_hash, snapshot.treeSha256, snapshot.treeHash);
    const committedAt = text(snapshot.git_commit_date, snapshot.gitCommitDate, snapshot.git_commit_at, snapshot.gitCommitAt);
    const facts = [
      ["Archive placement", webSnapshotPlacement(snapshot)],
      ["Lineage role", titleCase(text(snapshot.lineage_role, snapshot.lineageRole, "canonical-state"))],
      ["Entry path", text(snapshot.entry_path, snapshot.entryPath, "index.html")],
      ...(commit ? [["Git commit", commit]] : []),
      ...(committedAt ? [["Committed", dateLabel({ date: committedAt })]] : []),
      ...(treeHash ? [["Tree SHA-256", treeHash]] : []),
    ];
    return `<dl class="archive-web-provenance">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${label.includes("path") || label.includes("commit") || label.includes("SHA") ? `<code title="${escapeHtml(value)}">${escapeHtml(value)}</code>` : escapeHtml(value)}</dd></div>`).join("")}</dl>`;
  }

  function webSnapshotDependencyMarkup(snapshot) {
    const summary = webSnapshotSummary(snapshot);
    const labels = [
      ["resolved", "Resolved"],
      ["missing", "Missing"],
      ["case-mismatch", "Case mismatch"],
      ["case_mismatch", "Case mismatch"],
      ["external-blocked", "External blocked"],
      ["external_blocked", "External blocked"],
      ["navigation", "Navigation paths"],
      ["embedded", "Embedded"],
      ["unverifiable", "Unverifiable"],
      ["accepted-missing", "Accepted missing"],
      ["accepted_missing", "Accepted missing"],
    ];
    const seenLabels = new Set();
    const entries = labels.flatMap(([key, label]) => {
      const count = Number(summary[key] || 0);
      if (!count || seenLabels.has(label)) return [];
      seenLabels.add(label);
      return [[label, count]];
    });
    return entries.length ? `<div class="archive-web-dependency-summary" aria-label="Dependency summary">${entries.map(([label, count]) => `<span>${count} ${escapeHtml(label)}</span>`).join("")}</div>` : "";
  }

  function webSnapshotBehaviorMarkup(snapshot) {
    const behaviors = list(first(snapshot.behaviors, snapshot.interaction_behaviors, snapshot.interactionBehaviors, []));
    if (!behaviors.length) return "";
    return `<section class="archive-web-behaviors"><header><span class="archive-label">Interaction evidence</span><h4>What to watch in this state</h4><p>The motion and response are part of the archived work. These notes distinguish observable mechanics from the maker's stated meaning.</p></header><div class="archive-web-behavior-list">${behaviors.map((behavior) => {
      const prompt = text(behavior.interaction_prompt, behavior.interactionPrompt);
      const observed = text(behavior.observed_behavior, behavior.observedBehavior);
      const meaning = text(behavior.authored_meaning, behavior.authoredMeaning);
      const meaningStatus = text(behavior.meaning_status, behavior.meaningStatus, "pending-interpretation");
      const sourcePath = text(behavior.source_path, behavior.sourcePath);
      const sourceSymbol = text(behavior.source_symbol, behavior.sourceSymbol);
      const behaviorKey = text(behavior.behavior_key, behavior.behaviorKey);
      const focusedStudy = ["ring-node-opening", "breathing-eyes", "node-orbits-pathways", "six-living-cultures"].includes(behaviorKey);
      return `<article class="archive-web-behavior"><div class="archive-web-behavior-heading"><span>${escapeHtml(titleCase(text(behavior.evolution_role, behavior.evolutionRole, "observed")))}</span><h5>${escapeHtml(text(behavior.title, titleCase(text(behavior.behavior_key, behavior.behaviorKey, "interaction"))))}</h5></div>${prompt ? `<p class="archive-web-interaction-prompt"><strong>Try it</strong>${escapeHtml(prompt)}</p>` : ""}${observed ? `<p><strong>Observed in the source</strong>${escapeHtml(observed)}</p>` : ""}${meaning ? `<p class="archive-web-authored-meaning"><strong>${meaningStatus === "curator-authored" ? "Authored meaning" : "Interpretive note"}</strong>${escapeHtml(meaning)}</p>` : ""}${sourcePath || sourceSymbol ? `<small>Source: ${escapeHtml([sourcePath, sourceSymbol].filter(Boolean).join(" · "))}</small>` : ""}${focusedStudy ? `<button class="archive-button" type="button" data-archive-web-study="${escapeHtml(behaviorKey)}" aria-pressed="false">Watch focused animation</button>` : ""}</article>`;
    }).join("")}</div></section>`;
  }

  function webSnapshotViewerMarkup(snapshots) {
    const publicSnapshots = snapshots.map((snapshot, index) => ({ snapshot, index, viewerUrl: safeWebViewerUrl(first(snapshot.viewer_url, snapshot.viewerUrl)) })).filter((entry) => entry.viewerUrl);
    if (!publicSnapshots.length) return "";
    return `<div class="archive-web-viewer" data-archive-web-viewer data-viewport="desktop">
      <div class="archive-web-viewer-toolbar"><label class="archive-web-viewer-picker">Documented website state<select data-archive-web-snapshot-select>${publicSnapshots.map(({ snapshot, index }) => `<option value="${escapeHtml(text(snapshot.id, index))}">${escapeHtml(webSnapshotTitle(snapshot, index))} · ${escapeHtml(webSnapshotPlacement(snapshot))}</option>`).join("")}</select></label><div class="archive-web-viewer-controls" aria-label="Viewer controls"><button class="archive-button" type="button" data-archive-web-viewport="desktop" aria-pressed="true">Desktop</button><button class="archive-button" type="button" data-archive-web-viewport="mobile" aria-pressed="false">390 px</button><button class="archive-button" type="button" data-archive-web-reset>Reset snapshot</button></div></div>
      ${publicSnapshots.map(({ snapshot, index, viewerUrl }, publicIndex) => {
        const id = text(snapshot.id, index);
        const title = webSnapshotTitle(snapshot, index);
        const screenshot = safeUrl(first(snapshot.screenshot_url, snapshot.screenshotUrl));
        return `<article class="archive-web-snapshot-panel" data-archive-web-snapshot-panel="${escapeHtml(id)}" ${publicIndex ? "hidden" : ""}><header class="archive-web-snapshot-heading"><div><span class="archive-label">Interactive historical source</span><h3>${escapeHtml(title)}</h3></div><p>The original local code runs inside an isolated, network-blocked viewer. External resources and historical navigation remain unavailable by design.</p></header><p class="archive-web-live-cue"><strong>Live historical page</strong> Scroll and interact inside the frame. Motion, timing, and response are archival evidence. <button class="archive-button" type="button" data-archive-web-study="" aria-pressed="true">Show full live site</button></p><div class="archive-web-stage"><iframe title="Historical website snapshot: ${escapeHtml(title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" ${publicIndex ? "" : `src="${escapeHtml(viewerUrl)}" `}data-viewer-src="${escapeHtml(viewerUrl)}" data-viewer-current-src="${escapeHtml(viewerUrl)}" loading="lazy"></iframe></div>${webSnapshotBehaviorMarkup(snapshot)}${webSnapshotProvenanceMarkup(snapshot)}${webSnapshotDependencyMarkup(snapshot)}${screenshot ? `<details class="archive-web-screenshot"><summary>Captured evidence · generated derivative</summary><img src="${escapeHtml(screenshot)}" alt="Generated derivative capture of ${escapeHtml(title)}" loading="lazy"></details>` : ""}</article>`;
      }).join("")}
    </div>`;
  }

  function setupArchiveWebSnapshots() {
    const viewer = app.querySelector("[data-archive-web-viewer]");
    if (!viewer) return;
    const select = viewer.querySelector("[data-archive-web-snapshot-select]");
    const panels = [...viewer.querySelectorAll("[data-archive-web-snapshot-panel]")];
    const activate = (id) => {
      panels.forEach((panel) => {
        const active = panel.dataset.archiveWebSnapshotPanel === id;
        panel.hidden = !active;
        const frame = panel.querySelector("iframe[data-viewer-src]");
        if (!frame) return;
        if (active && !frame.getAttribute("src")) frame.src = frame.dataset.viewerCurrentSrc || frame.dataset.viewerSrc;
        if (!active && frame.getAttribute("src")) frame.removeAttribute("src");
      });
    };
    select?.addEventListener("change", () => activate(select.value));
    viewer.addEventListener("click", (event) => {
      const viewport = event.target.closest("[data-archive-web-viewport]");
      if (viewport) {
        viewer.dataset.viewport = viewport.dataset.archiveWebViewport;
        viewer.querySelectorAll("[data-archive-web-viewport]").forEach((button) => button.setAttribute("aria-pressed", String(button === viewport)));
        return;
      }
      const study = event.target.closest("[data-archive-web-study]");
      if (study) {
        const panel = study.closest("[data-archive-web-snapshot-panel]");
        const frame = panel?.querySelector("iframe[data-viewer-src]");
        if (!frame) return;
        const url = new URL(frame.dataset.viewerSrc, location.origin);
        const studyKey = study.dataset.archiveWebStudy || "";
        if (studyKey) url.searchParams.set("study", studyKey);
        else url.searchParams.delete("study");
        frame.dataset.viewerCurrentSrc = url.href;
        frame.src = url.href;
        panel.querySelectorAll("[data-archive-web-study]").forEach((button) => button.setAttribute("aria-pressed", String(button === study)));
        panel.querySelector(".archive-web-stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (!event.target.closest("[data-archive-web-reset]")) return;
      const frame = panels.find((panel) => !panel.hidden)?.querySelector("iframe[data-viewer-src]");
      if (!frame) return;
      const src = frame.dataset.viewerCurrentSrc || frame.dataset.viewerSrc;
      frame.src = "about:blank";
      requestAnimationFrame(() => { frame.src = src; });
    });
  }

  function evolutionMarkup(data, materials, item) {
    if (!data.versions.length) return "";
    const materialMap = new Map();
    materials.forEach((material) => {
      const stateId = text(material.state_id, material.stateId);
      if (!stateId) return;
      if (!materialMap.has(stateId)) materialMap.set(stateId, []);
      materialMap.get(stateId).push(material);
    });
    const sourceMaterialMap = new Map();
    data.sourceMaterials.forEach((sourceMaterial) => {
      list(first(sourceMaterial.state_links, sourceMaterial.stateLinks, [])).forEach((link) => {
        const stateId = text(link.state_id, link.stateId);
        if (!stateId) return;
        if (!sourceMaterialMap.has(stateId)) sourceMaterialMap.set(stateId, []);
        sourceMaterialMap.get(stateId).push({ sourceMaterial, link });
      });
    });
    return `<div class="archive-evolution">${data.versions.map((version) => {
      const versionId = text(version.id);
      const states = data.states.filter((state) => text(state.version_id, state.versionId) === versionId);
      const versionNumber = Number(first(version.version_number, version.versionNumber, 1));
      return `<article class="archive-version"><header><div><span class="archive-label">Version ${versionNumber}</span><h3>${escapeHtml(text(version.title, `Version ${versionNumber}`))}</h3>${text(version.description) ? `<p>${escapeHtml(text(version.description))}</p>` : ""}</div><span class="archive-version-count">${states.length} state${states.length === 1 ? "" : "s"}</span></header><div class="archive-state-list">${states.map((state) => {
        const linked = materialMap.get(text(state.id)) || [];
        const linkedSources = sourceMaterialMap.get(text(state.id)) || [];
        const lead = first(state.lead_material, state.leadMaterial, null);
        const leadAsset = first(lead && lead.digital_asset, lead && lead.digitalAsset, null);
        const leadUrl = mediaUrl(leadAsset || {});
        const leadMime = text(leadAsset && (leadAsset.mime_type || leadAsset.mimeType));
        const leadAlt = text(leadAsset && (leadAsset.alt_text || leadAsset.altText), lead && lead.title, state.title, "Documented state");
        const anchor = text(state.anchor, `state-${slugify(state.id)}`);
        const current = Boolean(first(state.is_current, state.isCurrent, false));
        const leadMarkup = leadUrl ? (leadMime.startsWith("video/") ? `<video controls playsinline preload="metadata" src="${escapeHtml(leadUrl)}" aria-label="${escapeHtml(leadAlt)}"></video>` : `<img src="${escapeHtml(leadUrl)}" alt="${escapeHtml(leadAlt)}" loading="lazy">`) : `<div class="archive-state-lead-empty"><span>No public lead image</span></div>`;
        const directEvidence = linked.map((material, index) => {
          const reference = text(material.material_reference, material.materialReference, `M${String(index + 1).padStart(2, "0")}`);
          const materialAnchor = `material-${slugify(first(material.slug, material.id, `${reference}-${index + 1}`))}`;
          return `<li><a href="#${escapeHtml(materialAnchor)}"><strong>${escapeHtml(reference)}</strong><span>${escapeHtml(text(material.title, titleCase(first(material.material_type, material.type, "material"))))}</span>${Number(first(material.is_sample, material.isSample, 0)) ? `<em>Sample</em>` : ""}</a></li>`;
        });
        const sourceEvidence = linkedSources.map(({ sourceMaterial, link }) => `<li><a href="#${escapeHtml(text(sourceMaterial.anchor, `source-material-${slugify(sourceMaterial.id)}`))}"><strong>${escapeHtml(text(link.document_reference, link.documentReference, "D"))}</strong><span>${escapeHtml(text(sourceMaterial.title, "Client correspondence"))}</span><em>Source</em></a></li>`);
        const evidenceMarkup = directEvidence.length || sourceEvidence.length
          ? `<ol class="archive-state-materials">${directEvidence.join("")}${sourceEvidence.join("")}</ol>`
          : `<p class="archive-state-empty">No public supporting materials are attached to this state.</p>`;
        const evidenceCount = Number(first(state.material_count, state.materialCount, linked.length + linkedSources.length));
        return `<section class="archive-state-card ${current ? "is-current" : ""}" id="${escapeHtml(anchor)}"><div class="archive-state-lead">${leadMarkup}${lead ? `<span>${escapeHtml(text(lead.material_reference, lead.materialReference, "Lead material"))}</span>` : ""}</div><div class="archive-state-heading"><div class="archive-state-identifiers"><span class="archive-state-roman">${escapeHtml(text(state.state_roman, state.stateRoman, "I").toUpperCase())}</span><span class="archive-label">${escapeHtml(text(state.catalogue_label, state.catalogueLabel, stateLabel(state, version)))}</span>${current ? '<span class="archive-state-current">You are here · current condition</span>' : ""}</div><h4>${escapeHtml(text(state.title, "Documented state"))}</h4><div class="archive-state-facts"><span>${escapeHtml(dateLabel(state))}</span><span>${evidenceCount} material${evidenceCount === 1 ? "" : "s"}</span>${text(state.variant_label, state.variantLabel) ? `<span>Variant ${escapeHtml(text(state.variant_label, state.variantLabel))}</span>` : ""}</div>${text(state.description) ? `<p>${escapeHtml(text(state.description))}</p>` : ""}</div>${evidenceMarkup}</section>`;
      }).join("")}</div></article>`;
    }).join("")}</div>`;
  }

  function contextMarkup(subjects, terms) {
    const groups = new Map();
    subjects.forEach((subject) => {
      const type = text(subject.entity_type, subject.entityType, "context");
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(subject);
    });
    const themeTerms = terms.filter((term) => text(term.kind).toLowerCase() === "theme");
    if (!groups.size && !themeTerms.length) return "";
    const groupMarkup = [...groups].map(([type, records]) => `<section class="archive-context-group"><span class="archive-label">${escapeHtml(titleCase(type === "event" ? "Event or activity" : type))}</span><div>${records.map((subject) => {
      const role = text(subject.role).toLowerCase();
      const entityType = text(subject.entity_type, subject.entityType).toLowerCase();
      const mediumClass = role === "medium" || entityType === "construct_node" ? " archive-medium-mention" : "";
      const brandMediumKey = role === "brand" ? archiveBrandMediumKey(subject.entity_id, subject.slug, subject.name, subject.title) : "";
      const brandClass = brandMediumKey ? " archive-brand-mention" : "";
      const brandData = brandMediumKey ? ` data-archive-medium="${escapeHtml(brandMediumKey)}"` : "";
      return `<a class="archive-context-entry${mediumClass}${brandClass}"${brandData} href="${escapeHtml(subjectExplorerUrl(subject))}"><strong>${escapeHtml(text(subject.name, subject.title, subject.slug, subject.entity_id))}</strong><span>${escapeHtml(titleCase(text(subject.role, "related")))}</span></a>`;
    }).join("")}</div></section>`).join("");
    const themes = themeTerms.length ? `<section class="archive-context-group"><span class="archive-label">Concept or theme</span><div>${themeTerms.map((term) => `<a class="archive-context-entry" href="/archive/?q=${encodeURIComponent(text(term.name, term.slug))}"><strong>${escapeHtml(text(term.name, term.slug))}</strong><span>Theme</span></a>`).join("")}</div></section>` : "";
    return `<div class="archive-context">${groupMarkup}${themes}</div>`;
  }

  const publicDocumentationGroups = [
    ["Identity", ["alternate-title"]],
    ["Physical object", ["object-description", "technique", "support", "dimensions", "inscription"]],
    ["Production", ["edition", "edition-information", "background"]],
    ["Remarks", ["artist-remark", "installation-remark", "curatorial-remark", "other-remark"]],
    ["References", ["bibliography"]],
    ["Institutional history", ["former-catalogue-number", "institutional-identifier", "credit-line", "other-collection"]],
    ["Rights", ["rights-permissions"]],
  ];

  function documentationMarkup(entries) {
    const groups = publicDocumentationGroups.map(([label, keys]) => [label, entries.filter((entry) => keys.includes(text(entry.field_key, entry.fieldKey)))]).filter(([, records]) => records.length);
    if (!groups.length) return "";
    return `<div class="archive-documentation-groups">${groups.map(([label, records]) => `<section class="archive-documentation-group"><h3>${escapeHtml(label)}</h3><dl>${records.map((entry) => {
      const entryLabel = text(entry.label, entry.default_label, entry.defaultLabel, titleCase(text(entry.field_key, entry.fieldKey)));
      const url = safeUrl(entry.url);
      return `<div id="documentation-${escapeHtml(slugify(entry.id))}"><dt>${escapeHtml(entryLabel)}</dt><dd>${paragraphMarkup(entry.value)}${text(entry.citation) ? `<cite>${escapeHtml(entry.citation)}</cite>` : ""}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open source</a>` : ""}</dd></div>`;
    }).join("")}</dl></section>`).join("")}</div>`;
  }

  function materialPresentation(material, index, posterFallback = "") {
    const type = slugify(first(material.material_type, material.type, material.kind, "note"));
    const title = text(material.title, material.name, `${titleCase(type)} ${index + 1}`);
    const id = `material-${slugify(first(material.slug, material.id, `${type}-${index + 1}`))}`;
    const digitalAsset = first(material.digital_asset, material.digitalAsset, null);
    const digitalAssetRecord = digitalAsset && typeof digitalAsset === "object" ? digitalAsset : null;
    const media = first(digitalAssetRecord, material.media, material.file, mediaObject(material), {});
    const url = mediaUrl(typeof media === "string" ? { url: media } : media);
    const caption = text(material.caption, media.caption, material.description);
    const body = text(material.inline_text, material.body, material.text, material.note);
    const transcript = text(material.transcript, media.transcript, material.transcript_text);
    const sourceRoute = safeUrl(first(material.archive_route, material.archiveRoute));
    const reference = text(material.material_reference, material.materialReference);
    const state = text(material.state_label, material.stateLabel);
    const isSample = Number(first(material.is_sample, material.isSample, 0)) === 1;
    const mimeType = text(media.mime_type, media.mimeType);
    const hasDigitalAsset = Boolean(digitalAssetRecord || text(material.media_id, material.mediaId) || url);
    const digitalAssetType = titleCase(text(digitalAssetRecord && digitalAssetRecord.asset_type, digitalAssetRecord && digitalAssetRecord.assetType, mimeType && mimeType.split("/")[0], "file"));
    const poster = safeUrl(first(media.poster, material.poster, posterFallback));
    const imageType = ["image", "photo", "process-photo", "sketch", "final-image", "artifact"].includes(type);
    return {
      body,
      caption,
      date: dateLabel(material),
      digitalAssetType,
      hasDigitalAsset,
      id,
      imageType,
      isSample,
      media,
      mimeType,
      poster,
      reference,
      sourceRoute,
      state,
      title,
      transcript,
      type,
      url,
    };
  }

  function materialViewerMarkup(material) {
    if (material.imageType && material.url) {
      return `<figure class="archive-material-viewer"><img src="${escapeHtml(material.url)}" alt="${escapeHtml(text(material.media.alt, material.media.alt_text, material.title))}" loading="lazy" decoding="async"></figure>`;
    }
    if (["audio", "voice-memo", "voice-note"].includes(material.type) && material.url) {
      return `<div class="archive-material-viewer"><audio controls preload="metadata" src="${escapeHtml(material.url)}">Your browser cannot play this audio.</audio>${material.transcript ? `<details class="archive-transcript"><summary>Read transcript</summary><p>${escapeHtml(material.transcript)}</p></details>` : ""}</div>`;
    }
    if (material.type === "video" && material.url) {
      return `<div class="archive-material-viewer"><video controls playsinline preload="metadata"${material.poster ? ` poster="${escapeHtml(material.poster)}"` : ""}><source src="${escapeHtml(material.url)}"${material.mimeType ? ` type="${escapeHtml(material.mimeType)}"` : ""}>Your browser cannot play this video.</video>${material.transcript ? `<details class="archive-transcript"><summary>Read transcript</summary><p>${escapeHtml(material.transcript)}</p></details>` : ""}</div>`;
    }
    if (["document", "pdf"].includes(material.type) && material.url) {
      return `<div class="archive-material-viewer"><object class="archive-material-document" data="${escapeHtml(material.url)}" type="application/pdf" aria-label="${escapeHtml(material.title)}"><p class="archive-inline-note">This document cannot be shown inline. <a href="${escapeHtml(material.url)}">Open it in a new view</a>.</p></object></div>`;
    }
    if (material.body) {
      return `<div class="archive-material-viewer archive-inline-note">${escapeHtml(material.body)}</div>`;
    }
    return `<div class="archive-material-viewer archive-material-viewer-empty"><span>No public preview is available for this material.</span></div>`;
  }

  function materialMarkup(material, index, posterFallback = "") {
    const presentation = materialPresentation(material, index, posterFallback);
    return `<article class="archive-material" id="${presentation.id}"><div class="archive-material-header"><div><span class="archive-material-type">${escapeHtml(presentation.reference || titleCase(presentation.type))}</span><div class="archive-date">${escapeHtml(presentation.date)}</div>${presentation.isSample ? `<span class="archive-material-badge">Sample</span>` : ""}</div><div class="archive-material-copy">${presentation.reference ? `<span class="archive-label">${escapeHtml(titleCase(presentation.type))}${presentation.state ? ` · ${escapeHtml(presentation.state)}` : ""}</span>` : ""}${presentation.hasDigitalAsset ? `<span class="archive-digital-asset-label">Digital asset · ${escapeHtml(presentation.digitalAssetType)}</span>` : ""}<h3>${escapeHtml(presentation.title)}</h3>${presentation.caption ? `<p>${escapeHtml(presentation.caption)}</p>` : ""}${presentation.sourceRoute ? `<p><a href="${escapeHtml(presentation.sourceRoute)}">Open source dossier</a></p>` : ""}</div></div>${materialViewerMarkup(presentation)}</article>`;
  }

  function materialThumbnailMarkup(material, index, posterFallback = "") {
    const presentation = materialPresentation(material, index, posterFallback);
    const previewImage = presentation.imageType ? presentation.url : presentation.type === "video" ? presentation.poster : "";
    const placeholder = titleCase(["voice-memo", "voice-note"].includes(presentation.type) ? "Audio" : presentation.type);
    return `<article class="archive-notebook-item" id="${presentation.id}">
      <button class="archive-notebook-trigger" type="button" data-archive-material-trigger data-material-index="${index}" aria-haspopup="dialog" aria-controls="archive-material-dialog" aria-label="Open ${escapeHtml(presentation.title)} details">
        <span class="archive-notebook-preview">${previewImage ? `<img src="${escapeHtml(previewImage)}" alt="" loading="lazy" decoding="async">` : `<span class="archive-notebook-placeholder" aria-hidden="true">${escapeHtml(placeholder || "Material")}</span>`}</span>
        <span class="archive-notebook-badges"><span>${escapeHtml(presentation.reference || titleCase(presentation.type))}</span><span>${escapeHtml(titleCase(presentation.type))}</span>${presentation.isSample ? `<span>Sample</span>` : ""}</span>
        <span class="archive-notebook-meta"><span class="archive-date">${escapeHtml(presentation.date)}</span><strong>${escapeHtml(presentation.title)}</strong></span>
      </button>
    </article>`;
  }

  function archiveNoteThumbnailMarkup(note,index){
    const title=text(note.title,"Archive Note"),preview=safeUrl(first(note.preview_url,note.previewUrl)),journal=text(note.note_type,note.noteType)==="journal-entry",label=journal?"Journal moment":"Archive Note",date=text(note.date_label,note.dateLabel),cardLabel=date||label,noteIndex=Number.isInteger(note._noteIndex)?note._noteIndex:index;
    return `<article class="archive-note-quick-card"><button type="button" data-archive-note-trigger data-note-index="${noteIndex}" aria-haspopup="dialog" aria-controls="archive-note-dialog" aria-label="Open ${escapeHtml(title)}"><span class="archive-note-quick-card-preview">${preview?`<img src="${escapeHtml(preview)}" alt="" loading="lazy" decoding="async">`:`<span class="archive-notebook-placeholder" aria-hidden="true">${escapeHtml(label)}</span>`}</span><span class="archive-note-quick-card-copy"><span class="archive-date">${escapeHtml(cardLabel)}</span><strong>${escapeHtml(title)}</strong></span></button></article>`;
  }

  function archiveJournalEntryMarkup(note,index){
    const title=text(note.title,"Untitled Journal moment"),date=text(note.date_label,note.dateLabel,note.source_created_at,note.sourceCreatedAt,"Undated"),excerpt=text(note.excerpt,"Open the complete entry to read this Journal moment."),noteIndex=Number.isInteger(note._noteIndex)?note._noteIndex:index,assets=list(note.assets).slice().sort((a,b)=>Number(first(a.sort_order,a.sortOrder,0))-Number(first(b.sort_order,b.sortOrder,0)));
    const media=assets.length?`<span class="archive-journal-entry-media" aria-label="${assets.length} ordered image${assets.length===1?"":"s"}">${assets.map(asset=>{const url=safeUrl(asset.url),alt=text(asset.alt_text,asset.altText);return url?`<span class="archive-journal-entry-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></span>`:""}).join("")}</span>`:"";
    return `<article class="archive-journal-entry"><button type="button" data-archive-note-trigger data-note-index="${noteIndex}" aria-haspopup="dialog" aria-controls="archive-note-dialog" aria-label="Open Journal moment ${escapeHtml(title)}">${media}<span class="archive-journal-entry-copy"><span class="archive-date">${escapeHtml(date)}</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(excerpt)}</span><em>Open complete Journal moment</em></span></button></article>`;
  }

  function archiveNoteDialogShellMarkup(){return `<dialog class="archive-note-dialog" id="archive-note-dialog" aria-labelledby="archive-note-dialog-title"><div class="archive-note-dialog-shell"><header class="archive-note-dialog-header"><span class="archive-kicker" data-archive-note-dialog-kicker>Complete Archive Note</span><button type="button" data-archive-note-close>Close</button></header><div class="archive-note-dialog-content" data-archive-note-dialog-content><div class="archive-loading" role="status"><p>Opening the Note…</p></div></div></div></dialog>`}

  function setupArchiveNoteQuickView(notes){
    const dialog=app.querySelector("#archive-note-dialog");if(!dialog||!window.ArchiveNoteMarkdown)return;const content=dialog.querySelector("[data-archive-note-dialog-content]"),close=dialog.querySelector("[data-archive-note-close]"),kicker=dialog.querySelector("[data-archive-note-dialog-kicker]");let lastTrigger=null,controller=null;
    async function openNote(index,trigger){const note=notes[index];if(!note)return;const journal=text(note.note_type,note.noteType)==="journal-entry",publicLabel=journal?"Journal moment":"Archive Note";lastTrigger=trigger;controller?.abort();controller=new AbortController();if(kicker)kicker.textContent=`Complete ${publicLabel}`;content.innerHTML=`<div class="archive-loading" role="status"><p>Opening the ${publicLabel}…</p></div>`;if(!dialog.open)dialog.showModal();document.body.classList.add("archive-note-dialog-open");close.focus();try{const payload=await getJson(`/api/archive/notes/${encodeURIComponent(text(note.slug,note.id))}`,controller.signal),record=first(payload.note,payload.record,note),assets=list(payload.assets);content.innerHTML=`<div class="archive-note-reader" tabindex="0" role="region" aria-label="Complete ${escapeHtml(publicLabel)} ${escapeHtml(text(record.title,"Untitled"))}"><h2 id="archive-note-dialog-title">${escapeHtml(text(record.title,"Untitled"))}</h2>${window.ArchiveNoteMarkdown.render(first(record.body_markdown,record.bodyMarkdown),assets)}<p><a class="archive-button" href="${escapeHtml(safeUrl(record.route)||`/archive/notes/${encodeURIComponent(text(record.slug))}/`)}">Open permanent ${escapeHtml(publicLabel)} record</a></p></div>`;window.ArchiveNoteMarkdown.bindImageLightboxes(content);content.querySelector(".archive-note-reader")?.focus()}catch(error){if(error.name!=="AbortError")content.innerHTML=`<div class="archive-note-empty"><p>This ${escapeHtml(publicLabel)} could not be opened.</p></div>`}}
    app.querySelectorAll("[data-archive-note-trigger]").forEach(trigger=>trigger.addEventListener("click",()=>openNote(Number(trigger.dataset.noteIndex),trigger)));close.addEventListener("click",()=>dialog.close());dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});dialog.addEventListener("close",()=>{controller?.abort();document.body.classList.remove("archive-note-dialog-open");lastTrigger?.focus()});
  }

  function materialDialogContentMarkup(material, index, posterFallback = "") {
    const presentation = materialPresentation(material, index, posterFallback);
    return `<div class="archive-material-dialog-layout">
      ${materialViewerMarkup(presentation)}
      <div class="archive-material-dialog-copy">
        <span class="archive-label">${escapeHtml(titleCase(presentation.type))}${presentation.state ? ` · ${escapeHtml(presentation.state)}` : ""}</span>
        ${presentation.reference ? `<span class="archive-material-type">${escapeHtml(presentation.reference)}</span>` : ""}
        ${presentation.hasDigitalAsset ? `<span class="archive-digital-asset-label">Digital asset · ${escapeHtml(presentation.digitalAssetType)}</span>` : ""}
        <h2 id="archive-material-dialog-title">${escapeHtml(presentation.title)}</h2>
        <div class="archive-date">${escapeHtml(presentation.date)}</div>
        ${presentation.caption ? `<p>${escapeHtml(presentation.caption)}</p>` : ""}
        ${presentation.isSample ? `<span class="archive-material-badge">Sample</span>` : ""}
        ${presentation.sourceRoute ? `<p><a class="archive-button" href="${escapeHtml(presentation.sourceRoute)}">Open source dossier</a></p>` : ""}
      </div>
    </div>`;
  }

  function materialDialogShellMarkup() {
    return `<dialog class="archive-material-dialog" id="archive-material-dialog" aria-labelledby="archive-material-dialog-title">
      <div class="archive-material-dialog-shell">
        <header class="archive-material-dialog-header"><span class="archive-kicker">Notebook material</span><button class="archive-material-dialog-close" type="button" data-archive-material-close aria-label="Close material details">Close</button></header>
        <div data-archive-material-dialog-content></div>
      </div>
    </dialog>`;
  }

  function setupMaterialQuickView(materials, posterFallback = "") {
    const dialog = app.querySelector("#archive-material-dialog");
    if (!dialog) return;
    const content = dialog.querySelector("[data-archive-material-dialog-content]");
    const closeButton = dialog.querySelector("[data-archive-material-close]");
    const triggers = [...app.querySelectorAll("[data-archive-material-trigger]")];
    let lastTrigger = null;

    function openMaterial(index, trigger) {
      const material = materials[index];
      if (!material) return;
      lastTrigger = trigger || triggers[index] || null;
      content.innerHTML = materialDialogContentMarkup(material, index, posterFallback);
      if (!dialog.open) dialog.showModal();
      document.body.classList.add("archive-material-dialog-open");
      window.SixWellAnalytics?.track("item_open", { action: "archive-material", itemId: text(material.material_reference, material.materialReference, material.id, index) });
      requestAnimationFrame(() => closeButton.focus());
    }

    function openHashTarget() {
      let id = "";
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (!id.startsWith("material-")) return;
      const item = document.getElementById(id);
      const trigger = item && item.querySelector("[data-archive-material-trigger]");
      if (!trigger) return;
      item.scrollIntoView({ block: "center" });
      openMaterial(Number(trigger.dataset.materialIndex), trigger);
    }

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", () => openMaterial(Number(trigger.dataset.materialIndex), trigger));
    });
    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("archive-material-dialog-open");
      if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
    });
    window.addEventListener("hashchange", openHashTarget);
    requestAnimationFrame(openHashTarget);
  }

  function sourceMaterialPresentation(sourceMaterial, index) {
    const entries = list(first(sourceMaterial.entries, []));
    const stateLinks = list(first(sourceMaterial.state_links, sourceMaterial.stateLinks, []));
    const references = list(first(sourceMaterial.references, [])).filter(Boolean);
    const firstImage = entries.find((entry) => {
      const asset = first(entry.digital_asset, entry.digitalAsset, {});
      return text(asset && (asset.mime_type || asset.mimeType)).startsWith("image/") && mediaUrl(asset);
    });
    const firstImageAsset = firstImage ? first(firstImage.digital_asset, firstImage.digitalAsset, {}) : {};
    return {
      anchor: text(sourceMaterial.anchor, `source-material-${slugify(first(sourceMaterial.id, index + 1))}`),
      caption: text(sourceMaterial.caption),
      date: dateLabel(sourceMaterial),
      entries,
      firstImageUrl: mediaUrl(firstImageAsset),
      firstImageAlt: text(firstImageAsset && (firstImageAsset.alt_text || firstImageAsset.altText), firstImage && firstImage.title, "Client source material"),
      id: text(sourceMaterial.id, index + 1),
      label: text(sourceMaterial.label, "Client correspondence"),
      participant: text(sourceMaterial.participant_label, sourceMaterial.participantLabel, "Client"),
      references,
      stateLinks,
      title: text(sourceMaterial.title, "Client correspondence"),
    };
  }

  function sourceMaterialThumbnailMarkup(sourceMaterial, index) {
    const presentation = sourceMaterialPresentation(sourceMaterial, index);
    const badges = [...presentation.references, presentation.label].map((label) => `<span>${escapeHtml(label)}</span>`).join("");
    return `<article class="archive-notebook-item archive-source-material-card" id="${escapeHtml(presentation.anchor)}">
      <button class="archive-notebook-trigger" type="button" data-archive-source-material-trigger data-source-material-index="${index}" aria-haspopup="dialog" aria-controls="archive-source-material-dialog" aria-label="Open ${escapeHtml(presentation.title)} source material">
        <span class="archive-notebook-preview">${presentation.firstImageUrl ? `<img src="${escapeHtml(presentation.firstImageUrl)}" alt="" loading="lazy" decoding="async">` : `<span class="archive-notebook-placeholder" aria-hidden="true">Source material</span>`}</span>
        <span class="archive-notebook-badges">${badges}</span>
        <span class="archive-notebook-meta"><span class="archive-date">${escapeHtml(presentation.date)}</span><strong>${escapeHtml(presentation.title)}</strong><span class="archive-source-material-attribution">${escapeHtml(presentation.participant)}</span></span>
      </button>
    </article>`;
  }

  function sourceMaterialEntryMarkup(entry, index) {
    const type = text(entry.entry_type, entry.entryType, "correspondence-page");
    const title = text(entry.title, titleCase(type));
    const caption = text(entry.caption);
    const body = text(entry.body);
    const asset = first(entry.digital_asset, entry.digitalAsset, {});
    const mimeType = text(asset && (asset.mime_type || asset.mimeType));
    const url = mediaUrl(asset);
    let viewer = "";
    if (url && mimeType.startsWith("image/")) {
      viewer = `<figure class="archive-source-entry-viewer"><img src="${escapeHtml(url)}" alt="${escapeHtml(text(asset.alt_text, asset.altText, title))}" loading="lazy" decoding="async"></figure>`;
    } else if (url && mimeType === "application/pdf") {
      viewer = `<div class="archive-source-entry-viewer"><object class="archive-material-document" data="${escapeHtml(url)}" type="application/pdf" aria-label="${escapeHtml(title)}"><p class="archive-inline-note">This document cannot be shown inline. <a href="${escapeHtml(url)}">Open it in a new view</a>.</p></object></div>`;
    } else if (url) {
      viewer = `<div class="archive-source-entry-download"><a class="archive-button" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open document</a></div>`;
    } else if (body) {
      viewer = `<div class="archive-source-entry-text">${paragraphMarkup(body)}</div>`;
    } else {
      viewer = `<div class="archive-material-viewer-empty"><span>No public preview is available for this entry.</span></div>`;
    }
    return `<article class="archive-source-entry">
      <header><span class="archive-source-entry-index">${String(index + 1).padStart(2, "0")}</span><div><span class="archive-label">${escapeHtml(titleCase(type))}</span><h3>${escapeHtml(title)}</h3>${caption ? `<p>${escapeHtml(caption)}</p>` : ""}</div></header>
      ${viewer}
    </article>`;
  }

  function sourceMaterialDialogContentMarkup(sourceMaterial, index) {
    const presentation = sourceMaterialPresentation(sourceMaterial, index);
    return `<div class="archive-source-material-dialog-content">
      <div class="archive-source-material-summary">
        <div>
          <span class="archive-label">${escapeHtml(presentation.label)}</span>
          <h2 id="archive-source-material-dialog-title">${escapeHtml(presentation.title)}</h2>
          <div class="archive-date">${escapeHtml(presentation.date)}</div>
        </div>
        <div>
          <span class="archive-label">Participant</span>
          <strong>${escapeHtml(presentation.participant)}</strong>
          ${presentation.caption ? `<p>${escapeHtml(presentation.caption)}</p>` : ""}
        </div>
      </div>
      ${presentation.stateLinks.length ? `<nav class="archive-source-state-links" aria-label="Documented states">${presentation.stateLinks.map((link) => `<a href="#${escapeHtml(text(link.anchor, `state-${slugify(first(link.state_id, link.stateId))}`))}"><strong>${escapeHtml(text(link.document_reference, link.documentReference, "D"))}</strong><span>${escapeHtml(text(link.state_label, link.stateLabel, link.title, "Documented state"))}</span></a>`).join("")}</nav>` : ""}
      <div class="archive-source-entry-list">${presentation.entries.map(sourceMaterialEntryMarkup).join("")}</div>
    </div>`;
  }

  function sourceMaterialDialogShellMarkup() {
    return `<dialog class="archive-material-dialog archive-source-material-dialog" id="archive-source-material-dialog" aria-labelledby="archive-source-material-dialog-title">
      <div class="archive-material-dialog-shell">
        <header class="archive-material-dialog-header"><span class="archive-kicker">Source material · Client correspondence</span><button class="archive-material-dialog-close" type="button" data-archive-source-material-close aria-label="Close source material">Close</button></header>
        <div data-archive-source-material-dialog-content></div>
      </div>
    </dialog>`;
  }

  function setupSourceMaterialQuickView(sourceMaterials) {
    const dialog = app.querySelector("#archive-source-material-dialog");
    if (!dialog) return;
    const content = dialog.querySelector("[data-archive-source-material-dialog-content]");
    const closeButton = dialog.querySelector("[data-archive-source-material-close]");
    const triggers = [...app.querySelectorAll("[data-archive-source-material-trigger]")];
    let lastTrigger = null;

    function openSourceMaterial(index, trigger) {
      const sourceMaterial = sourceMaterials[index];
      if (!sourceMaterial) return;
      lastTrigger = trigger || triggers[index] || null;
      content.innerHTML = sourceMaterialDialogContentMarkup(sourceMaterial, index);
      if (!dialog.open) dialog.showModal();
      document.body.classList.add("archive-material-dialog-open");
      window.SixWellAnalytics?.track("item_open", { action: "archive-source-material", itemId: text(sourceMaterial.id, index) });
      requestAnimationFrame(() => closeButton.focus());
    }

    function openHashTarget() {
      let id = "";
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (!id.startsWith("source-material-")) return;
      const item = document.getElementById(id);
      const trigger = item && item.querySelector("[data-archive-source-material-trigger]");
      if (!trigger) return;
      item.scrollIntoView({ block: "center" });
      openSourceMaterial(Number(trigger.dataset.sourceMaterialIndex), trigger);
    }

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", () => openSourceMaterial(Number(trigger.dataset.sourceMaterialIndex), trigger));
    });
    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("archive-material-dialog-open");
      if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
    });
    window.addEventListener("hashchange", openHashTarget);
    requestAnimationFrame(openHashTarget);
  }

  function historyMarkup(activity, index) {
    const id = `history-${slugify(first(activity.slug, activity.id, `entry-${index + 1}`))}`;
    const title = text(activity.title, activity.label, activity.activity_type, activity.type, "History entry");
    const body = text(activity.summary, activity.description, activity.body, activity.note);
    return `<article class="archive-history-entry" id="${id}"><div class="archive-date">${escapeHtml(dateLabel(activity))}</div><div><h3>${escapeHtml(title)}</h3>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></article>`;
  }

  function connectionRecord(connection) {
    return first(connection.target, connection.related, connection.item, connection.entity, connection);
  }

  function connectionMarkup(connection) {
    const target = connectionRecord(connection);
    const title = text(target.title, target.name, target.slug, "Related record");
    const relation = text(connection.label, connection.relationship_label, connection.relationship_type, connection.type, "Related");
    const summary = text(connection.description, connection.note, target.summary, target.description);
    const href = recordHref(target);
    const catalogue = catalogueLabel(target);
    return `<article class="archive-connection-card-shell"><a class="archive-connection-card" href="${escapeHtml(href)}"><span class="archive-label">${escapeHtml(titleCase(relation))}</span><h3>${escapeHtml(title)}</h3>${catalogue ? `<strong class="archive-connection-catalogue">${escapeHtml(catalogue)}</strong>` : ""}${summary ? `<p>${escapeHtml(truncate(summary, 170))}</p>` : ""}</a></article>`;
  }

  function groupedConnectionsMarkup(item, relationships, originThreads) {
    const itemMedium = text(item.catalogue_medium, item.catalogueMedium, item.medium);
    const groups = [
      ["Same-medium related objects", []],
      ["Cross-medium Construct relationships", []],
      ["Context and provenance", []],
    ];
    relationships.forEach((connection) => {
      const target = connectionRecord(connection),targetMedium=text(target.catalogue_medium, target.catalogueMedium);
      if (itemMedium && targetMedium && targetMedium === itemMedium) groups[0][1].push(connection);
      else if (itemMedium && targetMedium && targetMedium !== itemMedium) groups[1][1].push(connection);
      else groups[2][1].push(connection);
    });
    const relationshipGroups = groups.filter(([, records]) => records.length).map(([label, records]) => `<section class="archive-connection-group"><span class="archive-label">${escapeHtml(label)}</span><div class="archive-connection-grid">${records.map(connectionMarkup).join("")}</div></section>`).join("");
    const origins = originThreads.length ? `<section class="archive-connection-group"><span class="archive-label">Origin threads</span><div class="archive-connection-grid">${originThreads.map((thread) => `<a class="archive-connection-card" href="/archive/?origin=${encodeURIComponent(text(thread.slug, thread.id))}&from=${encodeURIComponent(text(item.entity_id, item.entityId, item.archive_slug, item.slug))}"><span class="archive-label">${Number(first(thread.is_primary, thread.isPrimary, 0)) ? "Primary inception" : "Supporting inception"}</span><h3>${escapeHtml(text(thread.title, thread.slug))}</h3>${text(thread.summary) ? `<p>${escapeHtml(truncate(thread.summary, 170))}</p>` : ""}</a>`).join("")}</div></section>` : "";
    return `${relationshipGroups}${origins}`;
  }

  function relationshipGraph(title, relationships) {
    const nodes = relationships.slice(0, 9).map(connectionRecord);
    if (!nodes.length) return "";
    const centerX = 320;
    const centerY = 180;
    const radiusX = 230;
    const radiusY = 120;
    const points = nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index / nodes.length) - Math.PI / 2;
      return { node, x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
    });
    return `<details class="archive-graph"><summary>View relationship map</summary><svg viewBox="0 0 640 360" role="img" aria-label="A visual map of ${escapeHtml(title)} and ${nodes.length} related records"><g aria-hidden="true">${points.map((point) => `<line x1="${centerX}" y1="${centerY}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}"></line>`).join("")}<circle class="archive-graph-center" cx="${centerX}" cy="${centerY}" r="38"></circle><text x="${centerX}" y="${centerY + 4}">${escapeHtml(truncate(title, 16))}</text>${points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="29"></circle><text x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}">${escapeHtml(truncate(text(point.node.title, point.node.name, point.node.slug), 15))}</text>`).join("")}</g></svg></details>`;
  }

  function paletteUsageMarkup(usage,index) {
    const recipe=usage.recipe,product=usage.product;
    const reference=recipe?`<a href="${escapeHtml(recipe.route)}">${escapeHtml(recipe.name)} · v${Number(recipe.version||0)}</a>`:product?`<a href="${escapeHtml(product.route)}">${escapeHtml([product.brand,product.name,product.color_name].filter(Boolean).join(" · "))}</a>`:"Internal formula";
    return `<li><button type="button" data-palette-usage="${escapeHtml(usage.id)}" aria-pressed="false"><span class="archive-palette-number">${index+1}</span><span class="archive-palette-swatch" style="--palette-color:${escapeHtml(usage.swatch||"#777")}" aria-hidden="true"></span><span><strong>${escapeHtml(usage.label)}</strong><small>${escapeHtml(titleCase(usage.usage_status))}${usage.technique?` · ${escapeHtml(usage.technique)}`:""}</small></span></button><span class="archive-palette-reference">${reference}</span></li>`;
  }

  function paletteMaterialMarkup(usage) {
    const material=usage.material||{};
    return `<li><a href="${escapeHtml(material.route||"#")}"><strong>${escapeHtml(material.name||"Material")}</strong><span>${escapeHtml([titleCase(material.kind),material.brand,material.model_name,usage.usage_role].filter(Boolean).join(" · "))}</span></a></li>`;
  }

  function paletteMapShellMarkup(map,index) {
    return `<section class="archive-palette-map" data-palette-map data-map-id="${escapeHtml(map.id)}" data-map-url="${escapeHtml(map.data_url)}"><header><div><span class="archive-label">${escapeHtml(map.state_label||"Documented state")}</span><h3>${escapeHtml(map.title||`Palette map ${index+1}`)}</h3></div><div class="archive-actions"><button class="archive-button" type="button" data-palette-isolate aria-pressed="false">Isolate diagram</button><a class="archive-button" href="${escapeHtml(map.svg_download)}" data-palette-svg>Download SVG</a><button class="archive-button" type="button" data-palette-png>Download PNG</button></div></header><div class="archive-palette-map-host" data-palette-map-host aria-live="polite">${loading("Opening reviewed geometry…")}</div></section>`;
  }

  function geometryMarkup(region,index) {
    const geometry=region.geometry||{},matrix=Array.isArray(geometry.matrix)&&geometry.matrix.length===6&&geometry.matrix.every(value=>Number.isFinite(Number(value)))?` transform="matrix(${geometry.matrix.map(value=>Number(value)).join(" ")})"`:"",common=`data-palette-region="${escapeHtml(region.id)}" data-palette-usage-id="${escapeHtml(region.usage.id)}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(`${index+1}. ${region.usage.label}`)}"${matrix}`;
    let shape="";
    if(region.geometry_type==="polygon"||region.geometry_type==="polyline")shape=`<${region.geometry_type} points="${escapeHtml(geometry.points||"")}"></${region.geometry_type}>`;
    else if(region.geometry_type==="path")shape=`<path d="${escapeHtml(geometry.d||"")}"></path>`;
    else if(region.geometry_type==="rect")shape=`<rect x="${Number(geometry.x)||0}" y="${Number(geometry.y)||0}" width="${Math.max(0,Number(geometry.width)||0)}" height="${Math.max(0,Number(geometry.height)||0)}"></rect>`;
    else if(region.geometry_type==="circle")shape=`<circle cx="${Number(geometry.cx)||0}" cy="${Number(geometry.cy)||0}" r="${Math.max(0,Number(geometry.r)||0)}"></circle>`;
    else shape=`<ellipse cx="${Number(geometry.cx)||0}" cy="${Number(geometry.cy)||0}" rx="${Math.max(0,Number(geometry.rx)||0)}" ry="${Math.max(0,Number(geometry.ry)||0)}"></ellipse>`;
    let x=Number(geometry.label_x),y=Number(geometry.label_y);
    if(!Number.isFinite(x)||!Number.isFinite(y)){
      if(region.geometry_type==="rect"){x=Number(geometry.x)+Number(geometry.width)/2;y=Number(geometry.y)+Number(geometry.height)/2}
      else if(region.geometry_type==="circle"||region.geometry_type==="ellipse"){x=Number(geometry.cx);y=Number(geometry.cy)}
      else{const pairs=String(geometry.points||geometry.d||"").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)||[];x=Number(pairs[0])||20;y=Number(pairs[1])||20}
    }
    return `<g ${common} style="--palette-color:${escapeHtml(region.usage.swatch||"#777")}"><title>${escapeHtml(`${index+1}. ${region.usage.label}`)}</title>${shape}<text class="archive-palette-region-number" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${index+1}</text></g>`;
  }

  async function setupPaletteMaps() {
    for(const shell of app.querySelectorAll("[data-palette-map]")){
      const host=shell.querySelector("[data-palette-map-host]"),mapId=shell.dataset.mapId||"palette-map";
      try{
        const payload=await getJson(shell.dataset.mapUrl),map=payload.map||{},regions=list(map.regions);
        host.innerHTML=`<figure class="archive-palette-figure"><div class="archive-palette-stage"><img src="${escapeHtml(map.source_url)}" alt=""><svg viewBox="${(map.viewBox||[0,0,map.width,map.height]).map(Number).join(" ")}" role="img" aria-label="${escapeHtml(map.title||"Reviewed palette placement map")}">${regions.map(geometryMarkup).join("")}</svg></div><figcaption>Numbered regions may overlap to document layered color. Select a region or use the equivalent list.</figcaption></figure><ol class="archive-palette-region-list">${regions.map((region,index)=>paletteUsageMarkup(region.usage,index)).join("")}</ol>`;
        window.SixWellAnalytics?.track("interactive_start",{action:"palette-map-open",itemId:mapId,count:regions.length});
        const select=(usageId)=>{
          host.querySelectorAll("[data-palette-region]").forEach(node=>{const selected=node.dataset.paletteUsageId===usageId;node.classList.toggle("is-selected",selected);node.setAttribute("aria-pressed",String(selected))});
          host.querySelectorAll("[data-palette-usage]").forEach(node=>{const selected=node.dataset.paletteUsage===usageId;node.classList.toggle("is-selected",selected);node.setAttribute("aria-pressed",String(selected))});
          window.SixWellAnalytics?.track("item_open",{action:"palette-region",itemId:usageId});
        };
        host.addEventListener("click",event=>{const target=event.target.closest("[data-palette-region],[data-palette-usage]");if(target)select(target.dataset.paletteUsageId||target.dataset.paletteUsage)});
        host.addEventListener("keydown",event=>{const target=event.target.closest("[data-palette-region]");if(target&&(event.key==="Enter"||event.key===" ")){event.preventDefault();select(target.dataset.paletteUsageId)}});
        shell.querySelector("[data-palette-isolate]").addEventListener("click",event=>{const pressed=event.currentTarget.getAttribute("aria-pressed")!=="true";event.currentTarget.setAttribute("aria-pressed",String(pressed));event.currentTarget.textContent=pressed?"Show work image":"Isolate diagram";host.classList.toggle("is-isolated",pressed);window.SixWellAnalytics?.track("filter_change",{action:"palette-isolate",itemId:pressed?"enabled":"disabled"})});
        shell.querySelector("[data-palette-svg]").addEventListener("click",()=>window.SixWellAnalytics?.track("interactive_complete",{action:"palette-svg-download",itemId:mapId,progress:100}));
        shell.querySelector("[data-palette-png]").addEventListener("click",async event=>{
          const button=event.currentTarget;button.disabled=true;button.textContent="Preparing PNG…";
          try{
            const stage=host.querySelector(".archive-palette-stage"),source=stage.querySelector("img"),svg=stage.querySelector("svg"),canvas=document.createElement("canvas"),width=Math.max(1,Math.round(Number(map.width)||source.naturalWidth)),height=Math.max(1,Math.round(Number(map.height)||source.naturalHeight));
            canvas.width=width;canvas.height=height;const context=canvas.getContext("2d");
            if(!host.classList.contains("is-isolated"))context.drawImage(source,0,0,width,height);
            const svgImage=new Image(),markup=new XMLSerializer().serializeToString(svg),blob=new Blob([markup],{type:"image/svg+xml"}),objectUrl=URL.createObjectURL(blob);
            await new Promise((resolve,reject)=>{svgImage.onload=resolve;svgImage.onerror=reject;svgImage.src=objectUrl});context.drawImage(svgImage,0,0,width,height);URL.revokeObjectURL(objectUrl);
            const link=document.createElement("a");link.download=`${slugify(map.title||"palette-map")}.png`;link.href=canvas.toDataURL("image/png");link.click();window.SixWellAnalytics?.track("interactive_complete",{action:"palette-png-download",itemId:mapId,progress:100});
          }catch{button.textContent="PNG unavailable";return}
          button.disabled=false;button.textContent="Download PNG";
        });
      }catch(error){host.innerHTML=`<div class="archive-note-empty"><p>${escapeHtml(error.message||"This reviewed map could not be opened.")}</p></div>`}
    }
  }

  async function dossier() {
    const slug = slugFromPath("records");
    if (!slug) {
      app.innerHTML = errorState("No record was named.", "Return to the Archive and choose a published dossier.");
      app.querySelector("[data-archive-retry]")?.remove();
      return;
    }
    app.innerHTML = loading("Opening this dossier…");
    try {
      const payload = await getJson(`/api/archive/items/${encodeURIComponent(slug)}`);
      const data = normalizeDossier(payload);
      const item = data.item;
      const title = text(item.title, item.name, slug);
      const summary = text(data.dossier.orientation, item.orientation, item.summary, item.description);
      const story = text(data.dossier.story, data.dossier.body, item.story, item.body, item.statement, summary);
      const activeUrl = safeUrl(first(item.active_url, item.canonical_url, item.entity_url, item.source_route, item.legacy_path, item.route, data.dossier.active_url));
      const versionsById = new Map(data.versions.map((version) => [text(version.id), version]));
      const statesById = new Map(data.states.map((state) => [text(state.id), state]));
      const materials = data.materials.map((material) => {
        const state = statesById.get(text(material.state_id, material.stateId));
        return state ? { ...material, state_label: stateLabel(state, versionsById.get(text(state.version_id, state.versionId))) } : material;
      }).sort((a, b) => Number(first(a.sort_order, 9999)) - Number(first(b.sort_order, 9999)) || text(a.sort_date, a.occurred_at, a.date).localeCompare(text(b.sort_date, b.occurred_at, b.date)));
      const primaryMaterial = materials.find((material) => slugify(first(material.material_type, material.type, material.kind)) === "final-image");
      const notebookMaterials = materials.filter((material) => slugify(first(material.material_type, material.type, material.kind)) !== "final-image");
      const notes = data.notes.slice().sort((a,b)=>text(b.source_created_at,b.sourceCreatedAt,b.created_at,b.createdAt).localeCompare(text(a.source_created_at,a.sourceCreatedAt,a.created_at,a.createdAt))||Number(first(a.sort_order,a.sortOrder,9999))-Number(first(b.sort_order,b.sortOrder,9999))).map((note,index)=>({...note,_noteIndex:index}));
      const journalNotes = notes.filter(note=>text(note.note_type,note.noteType)==="journal-entry");
      const supportingNotes = notes.filter(note=>text(note.note_type,note.noteType)!=="journal-entry");
      const sourceMaterials = data.sourceMaterials.slice().sort((a, b) => Number(first(a.sort_order, a.sortOrder, 9999)) - Number(first(b.sort_order, b.sortOrder, 9999)) || text(a.occurred_at, a.occurredAt, a.id).localeCompare(text(b.occurred_at, b.occurredAt, b.id)));
      const hasSupportingEvidence = notebookMaterials.length > 0 || sourceMaterials.length > 0 || supportingNotes.length > 0;
      const media = first(payload.primary_media, data.dossier.primary_media, mediaObject(primaryMaterial), mediaObject(item));
      const image = mediaObject({ primary_media: media });
      const imageUrl = mediaUrl(image);
      const imageMarkup = text(image && (image.svg_markup || image.svgMarkup));
      const primaryMaterialAnchor = primaryMaterial ? `material-${slugify(first(primaryMaterial.slug, primaryMaterial.id, "final-image"))}` : "";
      const activities = data.activities.slice().sort((a, b) => text(a.sort_date, a.occurred_at, a.date_start, a.date, "9999").localeCompare(text(b.sort_date, b.occurred_at, b.date_start, b.date, "9999")));
      const relationships = data.relationships;
      const primaryOriginThread = data.primaryOriginThread;
      const webSnapshotMarkup = webSnapshotViewerMarkup(data.webSnapshots);
      const mediumKey = recordMediumKey(item);
      const browseMediumValue = text(item.catalogue_medium, item.catalogueMedium, item.medium);
      const metadataHtml = metadata(item).map((entry) => {
        if (entry.role === "medium") return `<span class="archive-medium-mention">${escapeHtml(entry.value)}</span>`;
        const brandMediumKey = entry.role === "brand" ? archiveBrandMediumKey(entry.value) : "";
        return `<span${brandMediumKey ? ` class="archive-brand-mention" data-archive-medium="${escapeHtml(brandMediumKey)}"` : ""}>${escapeHtml(entry.value)}</span>`;
      }).join("");
      const relatedActionMarkup = primaryOriginThread
        ? `<a class="archive-button" href="/archive/?origin=${encodeURIComponent(text(primaryOriginThread.slug))}&from=${encodeURIComponent(text(item.entity_id, item.entityId, item.archive_slug, item.slug))}">Find related records</a>`
        : `<a class="archive-button${browseMediumValue ? " archive-medium-mention" : ""}" href="/archive/?${encodeURIComponent(browseMediumValue ? "medium" : "record_type")}=${encodeURIComponent(text(browseMediumValue, item.record_type))}">Browse same ${browseMediumValue ? "medium" : "record type"}</a>`;
      const breadcrumbCurrent = document.querySelector("[data-archive-breadcrumb-current]");
      if (breadcrumbCurrent) breadcrumbCurrent.textContent = title;
      document.title = `${title} · Archive · the six.well construct`;
      app.innerHTML = `
        <article${mediumKey ? ` data-archive-medium="${escapeHtml(mediumKey)}"` : ""}>
          <header class="archive-record-header site-hero site-hero--supporting" id="overview"><div class="archive-record-heading"><div><span class="archive-kicker">${escapeHtml(titleCase(text(archiveObjectTypeLabel(item), item.record_type, item.entity_type, "Cultural object")))}</span>${catalogueLabel(item) ? `<span class="archive-catalogue-identifier">${escapeHtml(catalogueLabel(item))}</span>` : ""}<h1 class="archive-record-title hero-title">${escapeHtml(title)}</h1></div><div class="archive-record-orientation">${summary ? `<p class="archive-record-intro hero-descriptor">${escapeHtml(summary)}</p>` : ""}<div class="archive-meta">${metadataHtml}</div><div class="archive-actions">${activeUrl ? `<a class="archive-button" href="${escapeHtml(activeUrl)}">View active item</a>` : ""}${relatedActionMarkup}</div></div></div>${imageUrl || imageMarkup ? `<figure class="archive-record-figure"${primaryMaterialAnchor ? ` id="${escapeHtml(primaryMaterialAnchor)}"` : ""}>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(text(primaryMaterial && primaryMaterial.alt_text, image.alt, image.alt_text, primaryMaterial && primaryMaterial.title, title))}">` : `<div class="archive-record-symbol" role="img" aria-label="${escapeHtml(title)}">${imageMarkup}</div>`}<figcaption><span>${inlineEmphasis(text(primaryMaterial && primaryMaterial.caption, image.caption, title))}</span><span>${escapeHtml(dateLabel(item))}</span></figcaption></figure>` : ""}</header>
          <nav class="archive-jump-nav" aria-label="On this record"><a href="#overview">Overview</a><a href="#story">Story</a>${data.documentation.length ? `<a href="#documentation">Documentation</a>` : ""}${data.versions.length ? `<a href="#evolution">Evolution</a>` : ""}${webSnapshotMarkup ? `<a href="#website-snapshots">Website snapshots</a>` : ""}${data.colorUsages.length||data.materialUsages.length||data.paletteMaps.length?`<a href="#palette-materials">Palette &amp; Materials</a>`:""}<a href="#notebook">Notebook</a><a href="#history">History</a><a href="#connections">Connections</a></nav>
          <section class="archive-document-section" id="story"><header class="archive-section-heading"><span class="archive-section-index">01 / Context</span><h2 class="archive-section-title">The story</h2></header><div><div class="archive-prose">${story ? paragraphMarkup(story) : "<p>This dossier currently holds the public facts of the work. Its fuller story has not been published yet.</p>"}${data.collections.length ? `<div class="archive-link-chips">${data.collections.map((collection) => `<a class="archive-chip" href="/archive/?collection=${encodeURIComponent(text(collection.slug, collection.id, collection.name))}">${escapeHtml(text(collection.name, collection.title, collection.slug))}</a>`).join("")}</div>` : ""}</div>${contextMarkup(data.subjects, data.terms)}</div></section>
          ${data.documentation.length ? `<section class="archive-document-section" id="documentation"><header class="archive-section-heading"><span class="archive-section-index">02 / Catalogue</span><h2 class="archive-section-title">Documentation</h2></header><div>${documentationMarkup(data.documentation)}</div></section>` : ""}
          ${data.versions.length ? `<section class="archive-document-section" id="evolution"><header class="archive-section-heading"><span class="archive-section-index">03 / Evolution</span><h2 class="archive-section-title">Versions and states</h2></header><div>${evolutionMarkup(data, materials, item)}</div></section>` : ""}
          ${webSnapshotMarkup ? `<section class="archive-document-section" id="website-snapshots"><header class="archive-section-heading"><span class="archive-section-index">04 / Living source</span><h2 class="archive-section-title">Website snapshots</h2></header><div>${webSnapshotMarkup}</div></section>` : ""}
          ${data.colorUsages.length||data.materialUsages.length||data.paletteMaps.length?`<section class="archive-document-section" id="palette-materials"><header class="archive-section-heading"><span class="archive-section-index">04 / Material record</span><h2 class="archive-section-title">Palette &amp; Materials</h2></header><div class="archive-palette-document">${data.colorUsages.length?`<section><h3>Documented colors</h3><ol class="archive-palette-region-list archive-palette-usage-list">${data.colorUsages.map(paletteUsageMarkup).join("")}</ol></section>`:""}${data.materialUsages.length?`<section><h3>Materials, tools &amp; equipment</h3><ul class="archive-material-usage-list">${data.materialUsages.map(paletteMaterialMarkup).join("")}</ul></section>`:""}${data.paletteMaps.map(paletteMapShellMarkup).join("")}</div></section>`:""}
          <section class="archive-document-section" id="notebook"><header class="archive-section-heading"><span class="archive-section-index">04 / Evidence</span><h2 class="archive-section-title">Open notebook</h2></header><div class="archive-open-notebook-groups"><section class="archive-open-notebook-group" aria-labelledby="journal-entries-title"><header><span class="archive-kicker">Authored record</span><h3 id="journal-entries-title">Journal moments</h3><p>Subjective observations from the life of this archived item, with their images kept in authored order.</p></header>${journalNotes.length?`<div class="archive-journal-feed">${journalNotes.map(archiveJournalEntryMarkup).join("")}</div>`:`<div class="archive-note-empty"><p>No Journal moments have been published for this item yet.</p></div>`}</section><section class="archive-open-notebook-group" aria-labelledby="process-evidence-title"><header><span class="archive-kicker">Supporting record</span><h3 id="process-evidence-title">Process Evidence / Source Materials</h3><p>Documentation, references, correspondence, and other supporting records are kept distinct from authored Journal moments.</p></header>${hasSupportingEvidence?`<div class="archive-notebook-grid">${supportingNotes.map(archiveNoteThumbnailMarkup).join("")}${notebookMaterials.map((material,index)=>materialThumbnailMarkup(material,index,imageUrl)).join("")}${sourceMaterials.map(sourceMaterialThumbnailMarkup).join("")}</div>`:`<div class="archive-note-empty"><p>${escapeHtml(text(data.dossier.empty_materials_note, "No process evidence or source materials are public yet."))}</p></div>`}</section></div></section>
          <section class="archive-document-section" id="history"><header class="archive-section-heading"><span class="archive-section-index">05 / Time</span><h2 class="archive-section-title">Item history</h2></header><div>${activities.length ? `<div class="archive-history">${activities.map(historyMarkup).join("")}</div>` : `<div class="archive-note-empty"><p>No dated history entries are public yet.</p></div>`}</div></section>
          <section class="archive-document-section" id="connections"><header class="archive-section-heading"><span class="archive-section-index">06 / Field</span><h2 class="archive-section-title">Connections</h2></header><div>${relationships.length || data.originThreads.length ? `${groupedConnectionsMarkup(item, relationships, data.originThreads)}${relationshipGraph(title, relationships)}` : `<div class="archive-note-empty"><p>No public relationships have been attached to this dossier yet.</p></div>`}</div></section>
        </article>
        ${notebookMaterials.length ? materialDialogShellMarkup() : ""}
        ${sourceMaterials.length ? sourceMaterialDialogShellMarkup() : ""}
        ${notes.length ? archiveNoteDialogShellMarkup() : ""}`;
      setupMaterialQuickView(notebookMaterials, imageUrl);
      setupSourceMaterialQuickView(sourceMaterials);
      setupArchiveNoteQuickView(notes);
      setupPaletteMaps();
      setupArchiveWebSnapshots();
    } catch (error) {
      app.innerHTML = error.status === 404
        ? errorState("This dossier is not public.", "It may be unpublished, unlisted, or no longer available under this address.")
        : errorState("This dossier could not be opened.", "The live record did not answer. Try again in a moment.");
      app.querySelector("[data-archive-retry]")?.addEventListener("click", dossier);
    }
  }

  function timelineDate(entry) {
    return text(entry.sort_date, entry.occurred_at, entry.date_start, entry.start_date, entry.date, entry.year, "9999-12-31");
  }

  function timelineEra(entry) {
    const supplied = text(entry.era, entry.year);
    if (supplied) return supplied;
    const datedText = [
      entry.occurred_at,
      entry.ended_at,
      entry.date_start,
      entry.start_date,
      entry.date,
      entry.date_label,
      entry.display_date,
    ].map((value) => text(value)).join(" ");
    const yearMatch = datedText.match(/(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/);
    if (!yearMatch) return "Undated";
    const year = Number(yearMatch[1]);
    return `${Math.floor(year / 10) * 10}s`;
  }

  function timelineLeadMedia(entry) {
    const media = first(entry.lead_media, entry.leadMedia, entry.primary_media, entry.primaryMedia);
    if (media && typeof media === "object") return media;
    const url = safeUrl(first(entry.lead_media_url, entry.leadMediaUrl, entry.media_url, entry.mediaUrl));
    return url ? {
      url,
      alt: text(entry.lead_media_alt, entry.leadMediaAlt, entry.alt_text, entry.altText),
      width: Number(first(entry.lead_media_width, entry.leadMediaWidth, entry.width, 0)) || null,
      height: Number(first(entry.lead_media_height, entry.leadMediaHeight, entry.height, 0)) || null,
    } : null;
  }

  function timelineEntryMarkup(entry, index) {
    const kind = entry._kind === "chapter" || text(entry.entry_type, entry.type) === "chapter" ? "chapter" : "entry";
    const id = `timeline-${slugify(first(entry.anchor_slug, entry.slug, entry.id, `${kind}-${index + 1}`))}`;
    const title = text(entry.title, entry.label, entry.activity_type, "History entry");
    const summary = text(entry.summary, entry.description, entry.note);
    const body = text(entry.body);
    const source = text(entry.source_note, entry.source, entry.caveat);
    const sourceUrl = safeUrl(entry.source_url);
    const recordRoute = safeUrl(first(entry.archive_route, entry.archiveRoute, entry.record_route, entry.recordRoute));
    const media = timelineLeadMedia(entry);
    const mediaSrc = mediaUrl(media);
    const mediaAlt = text(media && (media.alt_text || media.alt), entry.lead_media_alt, entry.leadMediaAlt, title);
    const mediaWidth = Number(first(media && media.width, 0)) || 0;
    const mediaHeight = Number(first(media && media.height, 0)) || 0;
    const dimensions = mediaWidth && mediaHeight ? ` width="${mediaWidth}" height="${mediaHeight}"` : "";
    const mediaMarkup = mediaSrc ? `<figure class="archive-timeline-media">${recordRoute ? `<a href="${escapeHtml(recordRoute)}" aria-label="Open record for ${escapeHtml(title)}">` : ""}<img src="${escapeHtml(mediaSrc)}" alt="${escapeHtml(mediaAlt)}"${dimensions} loading="lazy">${recordRoute ? "</a>" : ""}${text(media.caption, entry.lead_media_caption, entry.leadMediaCaption) ? `<figcaption>${inlineEmphasis(text(media.caption, entry.lead_media_caption, entry.leadMediaCaption))}</figcaption>` : ""}</figure>` : "";
    return `<article class="archive-${kind === "chapter" ? "chapter" : "timeline-entry"}" id="${id}" data-era="${escapeHtml(timelineEra(entry))}" data-kind="${escapeHtml(slugify(first(entry.activity_type, entry.entry_type, entry.type, kind)))}"><div class="archive-date">${escapeHtml(dateLabel(entry))}</div><div class="archive-timeline-copy"><span class="archive-label">${escapeHtml(titleCase(first(entry.activity_type, entry.entry_type, entry.type, kind)))}</span><h2>${escapeHtml(title)}</h2>${summary ? `<p class="archive-timeline-summary">${escapeHtml(summary)}</p>` : ""}${body && body !== summary ? `<div class="archive-timeline-body">${paragraphMarkup(body)}</div>` : ""}${mediaMarkup}${source ? `<p class="archive-timeline-source">${escapeHtml(source)}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}">View source</a>` : ""}</p>` : ""}${recordRoute ? `<div class="archive-actions"><a class="archive-button" href="${escapeHtml(recordRoute)}">Open record</a></div>` : ""}</div></article>`;
  }

  function mergeTimelineEntries(payload) {
    const combined = [
      ...list(payload.entries),
      ...list(payload.chapters).map((entry) => ({ ...entry, _kind: "chapter" })),
      ...list(payload.activities),
      ...list(payload.events),
    ];
    const seen = new Set();
    return combined.filter((entry) => {
      const key = text(entry.id, entry.slug, `${timelineDate(entry)}|${entry.title}|${entry._kind || entry.type}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => timelineDate(a).localeCompare(timelineDate(b)) || Number(first(a.sort_order, 0)) - Number(first(b.sort_order, 0)));
  }

  function archiveLensCard(record, kind) {
    const title = text(record.title, record.name, record.slug, kind === "timeline" ? "Timeline" : "Origin thread");
    const summary = text(record.summary, record.description);
    const route = safeUrl(record.route) || "/archive/";
    const meta = kind === "timeline"
      ? text(record.subject_name, record.subjectName, "Interactive history")
      : `${Number(record.record_count || record.recordCount || 0)} connected ${Number(record.record_count || record.recordCount || 0) === 1 ? "record" : "records"}`;
    return `<article class="archive-connection-card-shell"><a class="archive-connection-card" href="${escapeHtml(route)}"><span class="archive-label">${escapeHtml(kind === "timeline" ? "Timeline" : "Origin thread")}</span><h3>${escapeHtml(title)}</h3>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}<span class="archive-meta"><span>${escapeHtml(meta)}</span></span></a></article>`;
  }

  async function originThreadIndex() {
    app.innerHTML = loading("Following the threads…");
    try {
      const payload = await getJson("/api/archive/origin-threads");
      const records = list(first(payload.records, payload.origin_threads, payload.originThreads, []));
      document.title = "Origin Threads · Archive · the six.well construct";
      app.innerHTML = `<header class="archive-timeline-header site-hero site-hero--supporting"><div><span class="archive-kicker">Archive lineages</span><h1 class="hero-title">Origin Threads.</h1></div><div><p class="hero-descriptor">Curated paths joining works and evidence that share a source, question, or inception.</p><div class="archive-meta"><span>${records.length} public ${records.length === 1 ? "thread" : "threads"}</span></div></div></header>${records.length ? `<section class="archive-connection-grid" aria-label="Public origin threads">${records.map((record) => archiveLensCard(record, "origin")).join("")}</section>` : `<section class="archive-empty"><span class="archive-kicker">Threads forming</span><h2>No public origin threads yet.</h2><p>Published lineages will appear here after their records and evidence have been reviewed.</p></section>`}`;
    } catch (error) {
      app.innerHTML = errorState("Origin Threads could not be opened.", "The public lineage index did not answer. Try again in a moment.");
      app.querySelector("[data-archive-retry]")?.addEventListener("click", originThreadIndex);
    }
  }

  async function timeline() {
    const slug = slugFromPath("timelines");
    if (!slug) {
      app.innerHTML = loading("Assembling public histories…");
      try {
        const payload = await getJson("/api/archive/timelines");
        const records = list(first(payload.records, payload.timelines, []));
        document.title = "Timelines · Archive · the six.well construct";
        app.innerHTML = `<header class="archive-timeline-header site-hero site-hero--supporting"><div><span class="archive-kicker">Archive histories</span><h1 class="hero-title">Timelines.</h1></div><div><p class="hero-descriptor">Follow documented change across works, people, organizations, and the Construct itself.</p><div class="archive-meta"><span>${records.length} public ${records.length === 1 ? "timeline" : "timelines"}</span></div></div></header>${records.length ? `<section class="archive-connection-grid" aria-label="Public Archive timelines">${records.map((record) => archiveLensCard(record, "timeline")).join("")}</section>` : `<section class="archive-empty"><span class="archive-kicker">Histories forming</span><h2>No public timelines yet.</h2><p>Published histories will appear here as their dated chapters are reviewed.</p></section>`}`;
      } catch (error) {
        app.innerHTML = errorState("Timelines could not be opened.", "The public history index did not answer. Try again in a moment.");
        app.querySelector("[data-archive-retry]")?.addEventListener("click", timeline);
      }
      return;
    }
    app.innerHTML = loading("Assembling this history…");
    try {
      const payload = await getJson(`/api/archive/timelines/${encodeURIComponent(slug)}`);
      const timelineRecord = first(payload.timeline, payload.subject, payload);
      const title = text(timelineRecord.title, timelineRecord.name, titleCase(slug));
      const intro = text(timelineRecord.introduction, timelineRecord.summary, timelineRecord.description);
      const entries = mergeTimelineEntries(payload);
      const eras = [...new Set(entries.map(timelineEra).filter(Boolean))];
      const kinds = [...new Set(entries.map((entry) => slugify(first(entry.activity_type, entry.entry_type, entry.type, entry._kind, "entry"))).filter(Boolean))];
      const breadcrumbCurrent = document.querySelector("[data-archive-breadcrumb-current]");
      if (breadcrumbCurrent) breadcrumbCurrent.textContent = title;
      document.title = `${title} timeline · Archive · the six.well construct`;
      const profileRoute = safeUrl(first(timelineRecord.profile_route, timelineRecord.profileRoute, payload.profile_route, payload.profileRoute));
      const hasUsefulFilters = eras.length > 1 || kinds.length > 1;
      app.innerHTML = `<header class="archive-timeline-header site-hero site-hero--supporting"><div><span class="archive-kicker">Interactive history</span><h1 class="archive-timeline-title hero-title">${escapeHtml(title)}</h1></div><div class="archive-record-orientation">${intro ? `<p class="archive-timeline-intro hero-descriptor">${escapeHtml(intro)}</p>` : ""}<div class="archive-meta"><span>${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span>${timelineRecord.updated_at ? `<span>Updated ${escapeHtml(dateLabel({ date: timelineRecord.updated_at }))}</span>` : ""}</div><div class="archive-actions">${profileRoute ? `<a class="archive-button" href="${escapeHtml(profileRoute)}">Read identity profile</a>` : ""}<a class="archive-button" href="${escapeHtml(subjectExplorerUrl({ ...timelineRecord, slug }))}">Explore related records</a></div></div></header>
        ${entries.length ? `${hasUsefulFilters ? `<div class="archive-timeline-controls" aria-label="Timeline filters">${eras.length > 1 ? `<label>Era<select data-timeline-filter="era"><option value="">All eras</option>${eras.map((era) => `<option value="${escapeHtml(era)}">${escapeHtml(era)}</option>`).join("")}</select></label>` : ""}${kinds.length > 1 ? `<label>Entry type<select data-timeline-filter="kind"><option value="">All types</option>${kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(titleCase(kind))}</option>`).join("")}</select></label>` : ""}<button class="archive-clear" type="button" data-timeline-clear>Clear filters</button></div>` : ""}<section class="archive-timeline-track" aria-label="${escapeHtml(title)} timeline" data-timeline-track>${entries.map(timelineEntryMarkup).join("")}</section><div class="archive-note-empty" data-timeline-empty hidden><p>No public entries match these timeline filters.</p></div>` : `<section class="archive-empty"><span class="archive-kicker">Timeline forming</span><h2>No public entries yet.</h2><p>This permanent timeline address is ready; dated chapters will appear as their evidence is reviewed.</p></section>`}`;
      if (!entries.length) return;
      const eraSelect = app.querySelector('[data-timeline-filter="era"]');
      const kindSelect = app.querySelector('[data-timeline-filter="kind"]');
      const entryElements = [...app.querySelectorAll("[data-era][data-kind]")];
      const empty = app.querySelector("[data-timeline-empty]");
      function filterTimeline(mode) {
        const url = new URL(location.href);
        const era = eraSelect ? eraSelect.value : "";
        const kind = kindSelect ? kindSelect.value : "";
        era ? url.searchParams.set("era", era) : url.searchParams.delete("era");
        kind ? url.searchParams.set("kind", kind) : url.searchParams.delete("kind");
        history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
        let visible = 0;
        entryElements.forEach((entry) => {
          const show = (!era || entry.dataset.era === era) && (!kind || entry.dataset.kind === kind);
          entry.hidden = !show;
          if (show) visible += 1;
        });
        empty.hidden = visible !== 0;
        if (mode !== "replace") window.SixWellAnalytics?.track("filter_change", { action: "archive-timeline", itemId: era || kind || "all", count: visible });
      }
      const initial = new URL(location.href).searchParams;
      if (eraSelect) eraSelect.value = initial.get("era") || "";
      if (kindSelect) kindSelect.value = initial.get("kind") || "";
      eraSelect?.addEventListener("change", () => filterTimeline());
      kindSelect?.addEventListener("change", () => filterTimeline());
      app.querySelector("[data-timeline-clear]")?.addEventListener("click", () => { if (eraSelect) eraSelect.value = ""; if (kindSelect) kindSelect.value = ""; filterTimeline(); });
      window.addEventListener("popstate", () => { const current = new URL(location.href).searchParams; if (eraSelect) eraSelect.value = current.get("era") || ""; if (kindSelect) kindSelect.value = current.get("kind") || ""; filterTimeline("replace"); });
      filterTimeline("replace");
    } catch (error) {
      app.innerHTML = error.status === 404
        ? errorState("This timeline is not public.", "It may still be in preparation or may no longer use this address.")
        : errorState("This timeline could not be opened.", "The public history did not answer. Try again in a moment.");
      app.querySelector("[data-archive-retry]")?.addEventListener("click", timeline);
    }
  }

  if (view === "explorer") explorer();
  if (view === "record") dossier();
  if (view === "origin-threads") originThreadIndex();
  if (view === "timeline") timeline();
})();
