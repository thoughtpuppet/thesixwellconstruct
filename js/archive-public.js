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

  const roomLinks = [
    ["art", "Art", "/archive/art/"],
    ["tattoos", "Tattooing", "/archive/tattoos/"],
    ["merch", "Merch", "/archive/merch/"],
    ["events", "Events", "/archive/events/"],
    ["music", "Music", "/archive/music/"],
    ["writings", "Writings", "/archive/writings/"],
    ["film", "Film", "/archive/film/"],
    ["sixwell-construct", "The Construct", "/archive/sixwell-construct/"],
  ];

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));

  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  const text = (...values) => String(first(...values) || "").trim();
  const slugify = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const titleCase = (value) => text(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const truncate = (value, length) => text(value).length > length ? `${text(value).slice(0, length - 1).trim()}…` : text(value);

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
    const values = [
      first(record.medium_label, record.medium),
      first(record.record_type_label, record.record_type, record.entity_type, record.type),
      first(record.brand_name, record.brand),
      first(record.year, record.date_or_period),
    ].map(text).filter(Boolean);
    return [...new Set(values)];
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
        <div class="archive-hero-copy"><p class="hero-descriptor">${collectionsView ? "Move through records gathered around a shared body of work, period, place, or question." : "Search the work through its process, materials, people, places, and changing history."}</p>${collectionsView ? "" : '<div class="archive-actions"><a class="archive-button" href="/archive/guide/">Read the Archive Guide</a></div>'}</div>
      </section>
      <section class="archive-origin-thread" data-origin-thread hidden></section>
      <form class="archive-search-form archive-search-panel" role="search" data-archive-search>
        <label class="archive-label" for="archive-query">Search the archive</label>
        <input id="archive-query" name="q" type="search" autocomplete="off" placeholder="Try a piece, material, person, symbol, or year">
        <button class="archive-search-button" type="submit">Search</button>
      </form>
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
      queryInput.value = current.get("q") || "";
      facetDefinitions.forEach(([key]) => {
        const select = facets.querySelector(`[name="${key}"]`);
        if (select) select.value = current.get(key) || "";
      });
      activeFilters.innerHTML = [...current.entries()]
        .filter(([key, value]) => value && (key === "q" || facetDefinitions.some(([facet]) => facet === key)))
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

    function card(record) {
      const media = mediaObject(record);
      const image = mediaUrl(media);
      const match = record._matches && record._matches[0];
      const matchText = text(match && (match.snippet || match.excerpt || match.text || match.value));
      const title = text(record.title, record.name, recordSlug(record), "Untitled record");
      const summary = text(record.summary, record.orientation, record.description, record.statement, record.why_it_matters);
      const meta = metadata(record);
      return `<a class="archive-card" href="${escapeHtml(recordHref(record, match))}">
        <span class="archive-card-media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(text(media.alt, media.alt_text, title))}" loading="lazy" decoding="async">` : `<span class="archive-card-placeholder" aria-hidden="true">${escapeHtml(title.slice(0, 2))}</span>`}</span>
        <span class="archive-card-copy"><span class="archive-meta">${record.is_current?"<span>Current record</span>":""}${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</span><h3>${escapeHtml(title)}</h3>${summary ? `<p>${escapeHtml(truncate(summary, 190))}</p>` : ""}${matchText ? `<p class="archive-match"><strong>Matched in ${escapeHtml(titleCase(text(match.type, match.kind, match.field, "record")))}</strong><br>${escapeHtml(truncate(matchText, 180))}</p>` : ""}</span>
      </a>`;
    }

    function renderOriginThread(payload) {
      const thread = first(payload.origin_thread, payload.originThread);
      if (!thread) {
        originHost.hidden = true;
        originHost.innerHTML = "";
        return;
      }
      const evidence = list(payload.evidence);
      originHost.hidden = false;
      originHost.innerHTML = `<header class="archive-origin-thread-header"><div><span class="archive-kicker">Origin thread</span><h2>${escapeHtml(text(thread.title, thread.slug))}</h2></div><div><p>${escapeHtml(text(thread.summary, "A curated record of the evidence and works that share this inception."))}</p><a class="archive-button" href="/archive/">Leave this thread</a></div></header><section class="archive-origin-evidence" aria-labelledby="origin-evidence-title"><div class="archive-section-heading"><span class="archive-section-index">Inception evidence</span><h2 class="archive-section-title" id="origin-evidence-title">Notes, references, and process</h2></div>${evidence.length?`<div class="archive-notebook">${evidence.map(materialMarkup).join("")}</div>`:`<div class="archive-note-empty"><p>No public inception evidence has been released for this thread yet.</p></div>`}</section>`;
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
      ["q", "origin", "from", ...facetDefinitions.map(([key]) => key), "page"].forEach((key) => {
        const value = current.get(key);
        if (value) request.set(key, value);
      });
      request.set("limit", "24");
      try {
        const itemPromise = getJson(`/api/archive/items?${request}`, controller.signal);
        const searchPromise = current.get("q") ? getJson(`/api/search?${request}`, controller.signal).catch(() => null) : Promise.resolve(null);
        const [itemPayload, searchPayload] = await Promise.all([itemPromise, searchPromise]);
        const itemResults = normalizeItems(itemPayload);
        const searched = normalizeItems(searchPayload);
        const records = searchPayload && (searched.length || Number(first(searchPayload.total, searchPayload.pagination && searchPayload.pagination.total, 0)) === 0) ? searched : itemResults;
        const total = Number(first(searchPayload && searchPayload.total, searchPayload && searchPayload.pagination && searchPayload.pagination.total, itemPayload.total, itemPayload.pagination && itemPayload.pagination.total, records.length)) || 0;
        queryInput.dataset.analyticsResults = String(total);
        renderOriginThread(itemPayload);
        renderFacets(itemPayload);
        count.textContent = `${total} ${total === 1 ? "record" : "records"}`;
        results.innerHTML = records.length ? `<div class="archive-card-grid">${records.map(card).join("")}</div>` : `<section class="archive-empty"><span class="archive-kicker">No match</span><h2>Nothing public here yet.</h2><p>Try a broader term or clear one of the filters. Internal and unreviewed materials never appear in this index.</p><p><button class="archive-button" type="button" data-empty-clear>Clear filters</button></p></section>`;
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
      ["q", "origin", "from", ...facetDefinitions.map(([key]) => key), "page"].forEach((key) => url.searchParams.delete(key));
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
      const record = event.target.closest(".archive-card");
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
      activities: list(first(payload && payload.activities, payload && payload.history, dossier.activities, item.activities, [])),
      relationships: list(first(payload && payload.relationships, payload && payload.connections, dossier.relationships, item.relationships, [])),
      originThreads: list(first(payload && payload.origin_threads, payload && payload.originThreads, dossier.origin_threads, item.origin_threads, [])),
      primaryOriginThread: first(payload && payload.primary_origin_thread, payload && payload.primaryOriginThread, dossier.primary_origin_thread, item.primary_origin_thread, null),
      subjects: list(first(payload && payload.subjects, dossier.subjects, item.subjects, [])),
      collections: list(first(payload && payload.collections, dossier.collections, item.collections, [])),
    };
  }

  function materialMarkup(material, index, posterFallback = "") {
    const type = slugify(first(material.material_type, material.type, material.kind, "note"));
    const title = text(material.title, material.name, `${titleCase(type)} ${index + 1}`);
    const id = `material-${slugify(first(material.slug, material.id, `${type}-${index + 1}`))}`;
    const media = first(material.media, material.file, mediaObject(material), {});
    const url = mediaUrl(typeof media === "string" ? { url: media } : media);
    const caption = text(material.caption, media.caption, material.description);
    const body = text(material.inline_text, material.body, material.text, material.note);
    const transcript = text(material.transcript, media.transcript, material.transcript_text);
    let viewer = "";
    if (["image", "photo", "process-photo", "sketch", "final-image", "artifact"].includes(type) && url) {
      viewer = `<figure class="archive-material-viewer"><img src="${escapeHtml(url)}" alt="${escapeHtml(text(media.alt, media.alt_text, title))}" loading="lazy" decoding="async">${caption ? `<figcaption><span>${escapeHtml(caption)}</span></figcaption>` : ""}</figure>`;
    } else if (["audio", "voice-memo", "voice-note"].includes(type) && url) {
      viewer = `<div class="archive-material-viewer"><audio controls preload="metadata" src="${escapeHtml(url)}">Your browser cannot play this audio.</audio>${transcript ? `<details class="archive-transcript"><summary>Read transcript</summary><p>${escapeHtml(transcript)}</p></details>` : ""}</div>`;
    } else if (type === "video" && url) {
      const poster = safeUrl(first(media.poster, material.poster, posterFallback));
      viewer = `<div class="archive-material-viewer"><video controls playsinline preload="metadata"${poster ? ` poster="${escapeHtml(poster)}"` : ""}><source src="${escapeHtml(url)}"${media.mime_type ? ` type="${escapeHtml(media.mime_type)}"` : ""}>Your browser cannot play this video.</video>${transcript ? `<details class="archive-transcript"><summary>Read transcript</summary><p>${escapeHtml(transcript)}</p></details>` : ""}</div>`;
    } else if (["document", "pdf"].includes(type) && url) {
      viewer = `<div class="archive-material-viewer"><object class="archive-material-document" data="${escapeHtml(url)}" type="application/pdf" aria-label="${escapeHtml(title)}"><p class="archive-inline-note">This document cannot be shown inline. <a href="${escapeHtml(url)}">Open it in a new view</a>.</p></object></div>`;
    } else if (body) {
      viewer = `<div class="archive-material-viewer archive-inline-note">${escapeHtml(body)}</div>`;
    }
    const sourceRoute = safeUrl(first(material.archive_route, material.archiveRoute));
    return `<article class="archive-material" id="${id}"><div class="archive-material-header"><div><span class="archive-material-type">${escapeHtml(titleCase(type))}</span><div class="archive-date">${escapeHtml(dateLabel(material))}</div></div><div class="archive-material-copy"><h3>${escapeHtml(title)}</h3>${caption && !viewer.includes("figcaption") ? `<p>${escapeHtml(caption)}</p>` : ""}${sourceRoute?`<p><a href="${escapeHtml(sourceRoute)}">Open source dossier</a></p>`:""}</div></div>${viewer}</article>`;
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
    return `<a class="archive-connection-card" href="${escapeHtml(href)}"><span class="archive-label">${escapeHtml(titleCase(relation))}</span><h3>${escapeHtml(title)}</h3>${summary ? `<p>${escapeHtml(truncate(summary, 170))}</p>` : ""}</a>`;
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
      const materials = data.materials.slice().sort((a, b) => Number(first(a.sort_order, 9999)) - Number(first(b.sort_order, 9999)) || text(a.sort_date, a.occurred_at, a.date).localeCompare(text(b.sort_date, b.occurred_at, b.date)));
      const primaryMaterial = materials.find((material) => slugify(first(material.material_type, material.type, material.kind)) === "final-image");
      const notebookMaterials = materials.filter((material) => slugify(first(material.material_type, material.type, material.kind)) !== "final-image");
      const media = first(payload.primary_media, data.dossier.primary_media, mediaObject(primaryMaterial), mediaObject(item));
      const image = mediaObject({ primary_media: media });
      const imageUrl = mediaUrl(image);
      const primaryMaterialAnchor = primaryMaterial ? `material-${slugify(first(primaryMaterial.slug, primaryMaterial.id, "final-image"))}` : "";
      const activities = data.activities.slice().sort((a, b) => text(a.sort_date, a.occurred_at, a.date_start, a.date, "9999").localeCompare(text(b.sort_date, b.occurred_at, b.date_start, b.date, "9999")));
      const relationships = data.relationships;
      const primaryOriginThread = data.primaryOriginThread;
      const breadcrumbCurrent = document.querySelector("[data-archive-breadcrumb-current]");
      if (breadcrumbCurrent) breadcrumbCurrent.textContent = title;
      document.title = `${title} · Archive · the six.well construct`;
      app.innerHTML = `
        <article>
          <header class="archive-record-header site-hero site-hero--supporting" id="overview"><div class="archive-record-heading"><div><span class="archive-kicker">${escapeHtml(titleCase(text(item.record_type, item.entity_type, "Archive dossier")))}</span><h1 class="archive-record-title hero-title">${escapeHtml(title)}</h1></div><div class="archive-record-orientation">${summary ? `<p class="archive-record-intro hero-descriptor">${escapeHtml(summary)}</p>` : ""}<div class="archive-meta">${metadata(item).map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div><div class="archive-actions">${activeUrl ? `<a class="archive-button" href="${escapeHtml(activeUrl)}">View active item</a>` : ""}${primaryOriginThread?`<a class="archive-button" href="/archive/?origin=${encodeURIComponent(text(primaryOriginThread.slug))}&from=${encodeURIComponent(text(item.entity_id,item.entityId,item.archive_slug,item.slug))}">Find related records</a>`:`<a class="archive-button" href="/archive/?${encodeURIComponent(text(item.medium) ? "medium" : "record_type")}=${encodeURIComponent(text(item.medium, item.record_type))}">Browse same ${escapeHtml(text(item.medium)?"medium":"record type")}</a>`}</div></div></div>${imageUrl ? `<figure class="archive-record-figure"${primaryMaterialAnchor ? ` id="${escapeHtml(primaryMaterialAnchor)}"` : ""}><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(text(primaryMaterial && primaryMaterial.alt_text, image.alt, image.alt_text, primaryMaterial && primaryMaterial.title, title))}"><figcaption><span>${escapeHtml(text(primaryMaterial && primaryMaterial.caption, image.caption, title))}</span><span>${escapeHtml(dateLabel(item))}</span></figcaption></figure>` : ""}</header>
          <nav class="archive-jump-nav" aria-label="On this record"><a href="#overview">Overview</a><a href="#story">Story</a><a href="#notebook">Notebook</a><a href="#history">History</a><a href="#connections">Connections</a></nav>
          <section class="archive-document-section" id="story"><header class="archive-section-heading"><span class="archive-section-index">01 / Context</span><h2 class="archive-section-title">The story</h2></header><div class="archive-prose">${story ? paragraphMarkup(story) : "<p>This dossier currently holds the public facts of the work. Its fuller story has not been published yet.</p>"}${data.subjects.length || data.collections.length ? `<div class="archive-link-chips">${data.subjects.map((subject) => `<a class="archive-chip" href="${escapeHtml(subjectExplorerUrl(subject))}">${escapeHtml(text(subject.name, subject.title, subject.slug))}</a>`).join("")}${data.collections.map((collection) => `<a class="archive-chip" href="/archive/?collection=${encodeURIComponent(text(collection.slug, collection.id, collection.name))}">${escapeHtml(text(collection.name, collection.title, collection.slug))}</a>`).join("")}</div>` : ""}</div></section>
          <section class="archive-document-section" id="notebook"><header class="archive-section-heading"><span class="archive-section-index">02 / Evidence</span><h2 class="archive-section-title">Open notebook</h2></header><div>${notebookMaterials.length ? `<div class="archive-notebook">${notebookMaterials.map((material,index)=>materialMarkup(material,index,imageUrl)).join("")}</div>` : `<div class="archive-note-empty"><p>${escapeHtml(text(data.dossier.empty_materials_note, "No process materials are public yet. The completed work and known history remain available here while sketches, notes, audio, and process images are reviewed."))}</p></div>`}</div></section>
          <section class="archive-document-section" id="history"><header class="archive-section-heading"><span class="archive-section-index">03 / Time</span><h2 class="archive-section-title">Item history</h2></header><div>${activities.length ? `<div class="archive-history">${activities.map(historyMarkup).join("")}</div>` : `<div class="archive-note-empty"><p>No dated history entries are public yet.</p></div>`}</div></section>
          <section class="archive-document-section" id="connections"><header class="archive-section-heading"><span class="archive-section-index">04 / Field</span><h2 class="archive-section-title">Connections</h2></header><div>${relationships.length ? `<div class="archive-connection-grid">${relationships.map(connectionMarkup).join("")}</div>${relationshipGraph(title, relationships)}` : `<div class="archive-note-empty"><p>No public relationships have been attached to this dossier yet.</p></div>`}</div></section>
        </article>`;
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

  function timelineEntryMarkup(entry, index) {
    const kind = entry._kind === "chapter" || text(entry.entry_type, entry.type) === "chapter" ? "chapter" : "entry";
    const id = `timeline-${slugify(first(entry.anchor_slug, entry.slug, entry.id, `${kind}-${index + 1}`))}`;
    const title = text(entry.title, entry.label, entry.activity_type, "History entry");
    const summary = text(entry.summary, entry.description, entry.body, entry.note);
    const source = text(entry.source_note, entry.source, entry.caveat);
    const sourceUrl = safeUrl(entry.source_url);
    return `<article class="archive-${kind === "chapter" ? "chapter" : "timeline-entry"}" id="${id}" data-era="${escapeHtml(text(entry.era, entry.year))}" data-kind="${escapeHtml(slugify(first(entry.activity_type, entry.entry_type, entry.type, kind)))}"><div class="archive-date">${escapeHtml(dateLabel(entry))}</div><div class="archive-timeline-copy"><span class="archive-label">${escapeHtml(titleCase(first(entry.activity_type, entry.entry_type, entry.type, kind)))}</span><h2>${escapeHtml(title)}</h2>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}${source ? `<p class="archive-timeline-source">${escapeHtml(source)}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}">View source</a>` : ""}</p>` : ""}</div></article>`;
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

  async function timeline() {
    const slug = slugFromPath("timelines");
    if (!slug) {
      app.innerHTML = errorState("No timeline was named.", "Return to the Archive and follow a published history path.");
      app.querySelector("[data-archive-retry]")?.remove();
      return;
    }
    app.innerHTML = loading("Assembling this history…");
    try {
      const payload = await getJson(`/api/archive/timelines/${encodeURIComponent(slug)}`);
      const timelineRecord = first(payload.timeline, payload.subject, payload);
      const title = text(timelineRecord.title, timelineRecord.name, titleCase(slug));
      const intro = text(timelineRecord.introduction, timelineRecord.summary, timelineRecord.description);
      const entries = mergeTimelineEntries(payload);
      const eras = [...new Set(entries.map((entry) => text(entry.era, entry.year)).filter(Boolean))];
      const kinds = [...new Set(entries.map((entry) => slugify(first(entry.activity_type, entry.entry_type, entry.type, entry._kind, "entry"))).filter(Boolean))];
      const breadcrumbCurrent = document.querySelector("[data-archive-breadcrumb-current]");
      if (breadcrumbCurrent) breadcrumbCurrent.textContent = title;
      document.title = `${title} timeline · Archive · the six.well construct`;
      app.innerHTML = `<header class="archive-timeline-header site-hero site-hero--supporting"><div><span class="archive-kicker">Interactive history</span><h1 class="archive-timeline-title hero-title">${escapeHtml(title)}</h1></div><div class="archive-record-orientation">${intro ? `<p class="archive-timeline-intro hero-descriptor">${escapeHtml(intro)}</p>` : ""}<div class="archive-meta"><span>${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span>${timelineRecord.updated_at ? `<span>Updated ${escapeHtml(dateLabel({ date: timelineRecord.updated_at }))}</span>` : ""}</div><div class="archive-actions"><a class="archive-button" href="${escapeHtml(subjectExplorerUrl({ ...timelineRecord, slug }))}">Explore related records</a></div></div></header>
        ${entries.length ? `<div class="archive-timeline-controls" aria-label="Timeline filters"><label>Era<select data-timeline-filter="era"><option value="">All eras</option>${eras.map((era) => `<option value="${escapeHtml(era)}">${escapeHtml(era)}</option>`).join("")}</select></label><label>Entry type<select data-timeline-filter="kind"><option value="">All types</option>${kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(titleCase(kind))}</option>`).join("")}</select></label><button class="archive-clear" type="button" data-timeline-clear>Clear filters</button></div><section class="archive-timeline-track" aria-label="${escapeHtml(title)} timeline" data-timeline-track>${entries.map(timelineEntryMarkup).join("")}</section><div class="archive-note-empty" data-timeline-empty hidden><p>No public entries match these timeline filters.</p></div>` : `<section class="archive-empty"><span class="archive-kicker">Timeline forming</span><h2>No public entries yet.</h2><p>This permanent timeline address is ready; dated chapters will appear as their evidence is reviewed.</p></section>`}`;
      if (!entries.length) return;
      const eraSelect = app.querySelector('[data-timeline-filter="era"]');
      const kindSelect = app.querySelector('[data-timeline-filter="kind"]');
      const entryElements = [...app.querySelectorAll("[data-era][data-kind]")];
      const empty = app.querySelector("[data-timeline-empty]");
      function filterTimeline(mode) {
        const url = new URL(location.href);
        const era = eraSelect.value;
        const kind = kindSelect.value;
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
      eraSelect.value = initial.get("era") || "";
      kindSelect.value = initial.get("kind") || "";
      eraSelect.addEventListener("change", () => filterTimeline());
      kindSelect.addEventListener("change", () => filterTimeline());
      app.querySelector("[data-timeline-clear]").addEventListener("click", () => { eraSelect.value = ""; kindSelect.value = ""; filterTimeline(); });
      window.addEventListener("popstate", () => { const current = new URL(location.href).searchParams; eraSelect.value = current.get("era") || ""; kindSelect.value = current.get("kind") || ""; filterTimeline("replace"); });
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
  if (view === "timeline") timeline();
})();
