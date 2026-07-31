(function () {
  "use strict";

  const app = document.querySelector("[data-failed-experiments-app]");
  const breadcrumbRoot = document.querySelector("[data-failed-experiments-breadcrumb-root]");
  const breadcrumbSeparator = document.querySelector("[data-failed-experiments-breadcrumb-detail-separator]");
  const breadcrumbCurrent = document.querySelector("[data-failed-experiments-breadcrumb-current]");
  if (!app) return;

  const FILTERS = [
    ["medium", "Medium"],
    ["phase", "Process phase"],
    ["kind", "Experiment kind"],
    ["result", "Original result"],
    ["afterlife", "Later afterlife"],
  ];

  const CONTROLLED_OPTIONS = {
    medium: [
      ["art", "Art"],
      ["merch", "Merch"],
      ["tattoos", "Tattoos"],
      ["film", "Film"],
      ["music", "Music"],
      ["writings", "Writings"],
      ["legend", "Legend"],
      ["other", "Other"],
    ],
    kind: [
      ["concept", "Concept"],
      ["material-test", "Material test"],
      ["process-test", "Process test"],
      ["prototype", "Prototype"],
      ["other", "Other"],
    ],
    result: [
      ["failed", "Failed"],
      ["abandoned", "Abandoned"],
      ["inconclusive", "Inconclusive"],
      ["superseded", "Superseded"],
    ],
    afterlife: [
      ["none", "None"],
      ["recovered", "Recovered"],
      ["reused", "Reused"],
    ],
  };

  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const text = (...values) => String(first(...values) || "").trim();
  const slugify = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const titleCase = (value) => text(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const truncate = (value, limit = 190) => text(value).length > limit ? `${text(value).slice(0, limit - 1).trim()}…` : text(value);
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));

  function safeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.origin);
      if (!/^https?:$/.test(url.protocol)) return "";
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
    } catch {
      return "";
    }
  }

  function safeRoute(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.origin);
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : "";
    } catch {
      return "";
    }
  }

  function slugFromPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("failed-experiments");
    const raw = index >= 0 ? parts[index + 1] : "";
    if (raw && raw !== "index.html") {
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
    return new URL(location.href).searchParams.get("experiment") || "";
  }

  function mediumKey(record) {
    const raw = slugify(first(record && record.node_id, record && record.medium, record && record.medium_label, "archive")).replace(/^node-/, "");
    const aliases = {
      tattoo: "tattoos",
      tattooing: "tattoos",
      writing: "writings",
      archive: "archive",
      other: "archive",
    };
    const resolved = aliases[raw] || raw;
    return ["art", "merch", "tattoos", "film", "music", "writings", "legend", "archive"].includes(resolved) ? resolved : "archive";
  }

  function displayDate(record) {
    const authored = text(record && record.date_label, record && record.display_date, record && record.approximate_label);
    if (authored) return authored;
    const raw = text(record && record.occurred_at, record && record.date);
    if (!raw) return "Undated";
    const iso = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!iso) return raw;
    const precision = slugify(record && record.date_precision);
    if (precision === "year" || !iso[2]) return iso[1];
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3] || 1)));
    if (Number.isNaN(date.valueOf())) return raw;
    if (precision === "month" || !iso[3]) return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function normalizeMedia(media) {
    return list(media).map((item, index) => ({ ...item, _index: index })).sort((left, right) => {
      const leftRole = slugify(left.role) === "primary" ? 0 : 1;
      const rightRole = slugify(right.role) === "primary" ? 0 : 1;
      if (leftRole !== rightRole) return leftRole - rightRole;
      const leftOrder = Number(first(left.sort_order, left.sortOrder, left._index));
      const rightOrder = Number(first(right.sort_order, right.sortOrder, right._index));
      return leftOrder - rightOrder;
    });
  }

  function normalizeExperiment(value) {
    const source = first(value && value.experiment, value && value.item, value && value.record, value, {});
    return {
      ...(source && typeof source === "object" ? source : {}),
      media: normalizeMedia(first(source && source.media, value && value.media, [])),
    };
  }

  function mediaUrl(media) {
    return safeUrl(first(
      media && media.url,
      media && media.public_url,
      media && media.display_url,
      media && media.derivative_url,
      media && media.src
    ));
  }

  function mediaKind(media) {
    const mime = text(media && media.mime_type, media && media.mimeType).toLowerCase();
    const role = slugify(first(media && media.role, media && media.kind, media && media.type));
    const url = mediaUrl(media).toLowerCase();
    if (mime.startsWith("image/") || /\.(avif|gif|jpe?g|png|webp)(?:[?#]|$)/.test(url)) return "image";
    if (mime.startsWith("video/") || /\.(m4v|mov|mp4|webm)(?:[?#]|$)/.test(url)) return "video";
    if (mime.startsWith("audio/") || /\.(aac|m4a|mp3|ogg|wav)(?:[?#]|$)/.test(url)) return "audio";
    if (mime === "application/pdf" || role === "document" || /\.pdf(?:[?#]|$)/.test(url)) return "document";
    if (["image", "final-image", "process-photo", "photograph", "sketch"].includes(role)) return "image";
    if (["video", "time-lapse", "timelapse"].includes(role)) return "video";
    if (["audio", "voice-memo", "audio-note"].includes(role)) return "audio";
    return role || "artifact";
  }

  function experimentRoute(experiment) {
    const supplied = safeRoute(experiment && experiment.route);
    const slug = text(experiment && experiment.slug, experiment && experiment.id);
    return supplied || (slug ? `/archive/failed-experiments/${encodeURIComponent(slug)}/` : "/archive/failed-experiments/");
  }

  function loading(message) {
    return `<div class="archive-loading" role="status"><span class="archive-loading-mark" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
  }

  function errorState(title, message, options = {}) {
    return `<section class="archive-error failed-experiments-error" role="alert">
      <span class="archive-kicker">Archive unavailable</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="failed-experiments-error-actions">
        ${options.retry === false ? "" : '<button class="archive-button" type="button" data-failed-experiments-retry>Try again</button>'}
        <a class="archive-button" href="/archive/failed-experiments/">All failed experiments</a>
      </div>
    </section>`;
  }

  async function getJson(url, signal) {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal });
    let payload = null;
    try { payload = await response.json(); } catch { /* The status below remains authoritative. */ }
    if (!response.ok) {
      const error = new Error(text(payload && payload.error, payload && payload.message, `Archive request failed (${response.status}).`));
      error.status = response.status;
      throw error;
    }
    return payload || {};
  }

  function setBreadcrumb(experiment) {
    const isDetail = Boolean(experiment);
    if (breadcrumbRoot) {
      breadcrumbRoot.classList.toggle("construct-breadcrumb-current", !isDetail);
      if (isDetail) breadcrumbRoot.removeAttribute("aria-current");
      else breadcrumbRoot.setAttribute("aria-current", "page");
    }
    if (breadcrumbSeparator) breadcrumbSeparator.hidden = !isDetail;
    if (breadcrumbCurrent) {
      breadcrumbCurrent.hidden = !isDetail;
      breadcrumbCurrent.textContent = isDetail ? text(experiment.title, "Experiment") : "";
    }
  }

  function indexMediaMarkup(experiment) {
    const media = normalizeMedia(experiment.media)[0];
    const kind = mediaKind(media);
    const url = mediaUrl(media);
    if (kind === "image" && url) {
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text(media.alt, media.alt_text, media.caption, experiment.title))}" loading="lazy" decoding="async">`;
    }
    const label = media ? titleCase(kind) : "Text record";
    return `<span class="failed-experiment-card-placeholder failed-experiment-card-placeholder--${escapeHtml(slugify(kind || "note"))}" aria-hidden="true"><span>${escapeHtml(label)}</span></span>`;
  }

  function experimentCardMarkup(experiment) {
    const title = text(experiment.title, "Untitled experiment");
    const summary = text(experiment.summary, experiment.public_note, experiment.note);
    const afterlife = slugify(experiment.afterlife);
    return `<article class="failed-experiment-card" data-archive-medium="${escapeHtml(mediumKey(experiment))}">
      <a href="${escapeHtml(experimentRoute(experiment))}">
        <span class="failed-experiment-card-media">${indexMediaMarkup(experiment)}</span>
        <span class="failed-experiment-card-copy">
          <span class="failed-experiment-card-meta"><span>${escapeHtml(displayDate(experiment))}</span><span>${escapeHtml(titleCase(first(experiment.kind, "Experiment")))}</span></span>
          <h3>${escapeHtml(title)}</h3>
          <span class="failed-experiment-card-outcome"><span>${escapeHtml(titleCase(first(experiment.result, "Unresolved")))}</span>${afterlife && afterlife !== "none" ? `<span>${escapeHtml(titleCase(afterlife))}</span>` : ""}</span>
          ${summary ? `<span class="failed-experiment-card-summary">${escapeHtml(truncate(summary))}</span>` : ""}
        </span>
      </a>
    </article>`;
  }

  function normalizeFacet(payload, key) {
    const facets = payload && payload.facets || {};
    const aliases = key === "phase" ? ["phase", "phases", "process_phase", "process_phases"] : [key, `${key}s`];
    const raw = first(...aliases.map((alias) => facets[alias]), []);
    if (Array.isArray(raw)) {
      return raw.map((option) => typeof option === "object" ? {
        value: text(option.value, option.slug, option.id, option.name, option.label),
        label: text(option.label, option.name, option.value, option.slug),
        count: first(option.count, option.total),
      } : { value: text(option), label: titleCase(option) }).filter((option) => option.value);
    }
    if (raw && typeof raw === "object") return Object.entries(raw).map(([value, count]) => ({ value, label: titleCase(value), count }));
    return [];
  }

  function facetOptions(payload, key) {
    const supplied = normalizeFacet(payload, key);
    const controlled = CONTROLLED_OPTIONS[key] || [];
    if (!controlled.length) return supplied;
    const byValue = new Map(supplied.map((option) => [option.value, option]));
    const options = controlled.map(([value, label]) => ({ ...byValue.get(value), value, label: byValue.get(value)?.label || label }));
    supplied.forEach((option) => { if (!controlled.some(([value]) => value === option.value)) options.push(option); });
    return options;
  }

  function activeFilterLabel(key, value) {
    if (key === "q") return `Search: ${value}`;
    if (key === "date") return `Date: ${value}`;
    const definition = FILTERS.find(([filter]) => filter === key);
    return `${definition ? definition[1] : titleCase(key)}: ${titleCase(value)}`;
  }

  function renderIndex() {
    document.title = "Failed Experiments · Archive · the six.well construct";
    setBreadcrumb(null);
    app.innerHTML = `
      <header class="archive-hero failed-experiments-hero site-hero site-hero--supporting" aria-labelledby="failed-experiments-title">
        <div><span class="archive-kicker">Archive lens</span><h1 class="hero-title" id="failed-experiments-title">Failed Experiments.</h1></div>
        <div class="archive-hero-copy"><p class="hero-descriptor">Abandoned concepts, flawed tests, and unresolved attempts preserved as part of the work.</p><div class="archive-actions"><a class="archive-button" href="/archive/">Search Archive</a><a class="archive-button" href="/archive/guide/">Read the Archive Guide</a></div></div>
      </header>
      <section class="failed-experiments-search-panel" aria-label="Search failed experiments">
        <form class="failed-experiments-search" role="search" data-failed-experiments-search>
          <div class="failed-experiments-search-field"><label class="archive-label" for="failed-experiments-query">Search notes and titles</label><input id="failed-experiments-query" name="q" type="search" autocomplete="off" placeholder="Try a material, method, or question"></div>
          <div class="failed-experiments-search-field failed-experiments-search-field--date"><label class="archive-label" for="failed-experiments-date">Exact date</label><input id="failed-experiments-date" name="date" type="date"></div>
          <button class="archive-search-button" type="submit">Search</button>
        </form>
      </section>
      <section class="archive-explorer failed-experiments-explorer" aria-label="Failed experiments notebook">
        <aside class="archive-filter-panel" aria-labelledby="failed-experiments-filter-title">
          <div class="archive-filter-heading"><h2 id="failed-experiments-filter-title">Refine</h2><button class="archive-clear" type="button" data-failed-experiments-clear>Clear all</button></div>
          <div class="archive-facets" data-failed-experiments-facets>${FILTERS.map(([key, label]) => `<div class="archive-facet"><label for="failed-experiments-${key}">${label}</label><select id="failed-experiments-${key}" name="${key}" disabled><option value="">Any ${label.toLowerCase()}</option></select></div>`).join("")}</div>
        </aside>
        <div class="archive-results" id="failed-experiments-records">
          <header class="archive-results-heading"><h2 tabindex="-1" data-failed-experiments-results-heading>Chronological notebook</h2><span class="archive-count" data-failed-experiments-count aria-live="polite">Loading</span></header>
          <div class="archive-active-filters" data-failed-experiments-active-filters aria-label="Active filters"></div>
          <div data-failed-experiments-results aria-live="polite" aria-busy="true">${loading("Reading the experiment notebook…")}</div>
          <nav class="archive-pagination" aria-label="Failed experiment pages" data-failed-experiments-pagination hidden></nav>
        </div>
      </section>`;

    const searchForm = app.querySelector("[data-failed-experiments-search]");
    const queryInput = searchForm.elements.q;
    const dateInput = searchForm.elements.date;
    const facets = app.querySelector("[data-failed-experiments-facets]");
    const results = app.querySelector("[data-failed-experiments-results]");
    const resultsHeading = app.querySelector("[data-failed-experiments-results-heading]");
    const count = app.querySelector("[data-failed-experiments-count]");
    const activeFilters = app.querySelector("[data-failed-experiments-active-filters]");
    const pagination = app.querySelector("[data-failed-experiments-pagination]");
    let controller;
    let lastFacets = {};
    let focusResultsAfterLoad = false;

    function params() {
      return new URL(location.href).searchParams;
    }

    function syncControls() {
      const current = params();
      queryInput.value = current.get("q") || "";
      dateInput.value = current.get("date") || "";
      FILTERS.forEach(([key]) => {
        const select = facets.querySelector(`[name="${key}"]`);
        if (select) select.value = current.get(key) || "";
      });
      activeFilters.innerHTML = ["q", "date", ...FILTERS.map(([key]) => key)].map((key) => [key, current.get(key)]).filter(([, value]) => value).map(([key, value]) => `<button class="archive-chip" type="button" data-remove-failed-experiments-filter="${escapeHtml(key)}"><span>${escapeHtml(activeFilterLabel(key, value))}</span></button>`).join("");
    }

    function navigate(update, options = {}) {
      const url = new URL(location.href);
      Object.entries(update).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
      if (!("page" in update)) url.searchParams.delete("page");
      history[options.replace ? "replaceState" : "pushState"]({}, "", url);
      focusResultsAfterLoad = Boolean(options.focusResults);
      syncControls();
      load();
    }

    function renderFacets(payload) {
      if (payload && payload.facets && Object.keys(payload.facets).length) lastFacets = payload;
      const current = params();
      FILTERS.forEach(([key, label]) => {
        const select = facets.querySelector(`[name="${key}"]`);
        const options = facetOptions(lastFacets, key);
        const selected = current.get(key) || "";
        if (selected && !options.some((option) => option.value === selected)) options.unshift({ value: selected, label: titleCase(selected) });
        select.innerHTML = `<option value="">Any ${label.toLowerCase()}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}${option.count !== undefined ? ` (${escapeHtml(option.count)})` : ""}</option>`).join("")}`;
        select.value = selected;
        select.disabled = key === "phase" && options.length === 0;
      });
    }

    function renderPagination(payload, total) {
      const info = payload && payload.pagination || {};
      const page = Number(first(info.page, params().get("page"), 1)) || 1;
      const limit = Number(first(info.limit, 24)) || 24;
      const pages = Number(first(info.pages, info.total_pages, Math.ceil(total / limit), 1)) || 1;
      if (pages <= 1) {
        pagination.hidden = true;
        pagination.innerHTML = "";
        return;
      }
      pagination.hidden = false;
      pagination.innerHTML = `<button class="archive-button" type="button" data-failed-experiments-page="${page - 1}"${page <= 1 ? " disabled" : ""}>Previous</button><span>Page ${page} of ${pages}</span><button class="archive-button" type="button" data-failed-experiments-page="${page + 1}"${page >= pages ? " disabled" : ""}>Next</button>`;
    }

    async function load() {
      if (controller) controller.abort();
      controller = new AbortController();
      results.setAttribute("aria-busy", "true");
      results.innerHTML = loading("Reading the experiment notebook…");
      pagination.hidden = true;
      const current = params();
      const request = new URLSearchParams();
      ["q", "date", ...FILTERS.map(([key]) => key), "page"].forEach((key) => {
        const value = current.get(key);
        if (value) request.set(key, value);
      });
      request.set("limit", "24");
      try {
        const payload = await getJson(`/api/archive/failed-experiments?${request}`, controller.signal);
        const experiments = list(payload.items).map((item) => normalizeExperiment(item));
        const total = Number(first(payload.pagination && payload.pagination.total, payload.total, experiments.length)) || 0;
        renderFacets(payload);
        count.textContent = `${total} ${total === 1 ? "experiment" : "experiments"}`;
        results.innerHTML = experiments.length ? `<div class="failed-experiment-grid">${experiments.map(experimentCardMarkup).join("")}</div>` : `<section class="archive-empty"><span class="archive-kicker">No match</span><h2>Nothing public here yet.</h2><p>Try a broader search or clear the filters. Draft and internal experiments never appear in this notebook.</p><p><button class="archive-button" type="button" data-failed-experiments-empty-clear>Clear filters</button></p></section>`;
        results.setAttribute("aria-busy", "false");
        renderPagination(payload, total);
        if (focusResultsAfterLoad) {
          focusResultsAfterLoad = false;
          resultsHeading.focus({ preventScroll: true });
          resultsHeading.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        count.textContent = "Unavailable";
        results.setAttribute("aria-busy", "false");
        results.innerHTML = errorState("The notebook could not be opened.", "The public Archive did not answer. Try again in a moment.");
      }
    }

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      navigate({ q: queryInput.value.trim(), date: dateInput.value });
    });
    facets.addEventListener("change", (event) => {
      const select = event.target.closest("select[name]");
      if (!select) return;
      window.SixWellAnalytics?.track("filter_change", { action: select.name, itemId: select.value || "all" });
      navigate({ [select.name]: select.value });
    });
    app.querySelector("[data-failed-experiments-clear]").addEventListener("click", () => {
      const update = { q: "", date: "", page: "" };
      FILTERS.forEach(([key]) => { update[key] = ""; });
      navigate(update);
    });
    activeFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-failed-experiments-filter]");
      if (button) navigate({ [button.dataset.removeFailedExperimentsFilter]: "" });
    });
    pagination.addEventListener("click", (event) => {
      const button = event.target.closest("[data-failed-experiments-page]");
      if (button && !button.disabled) navigate({ page: button.dataset.failedExperimentsPage }, { focusResults: true });
    });
    results.addEventListener("click", (event) => {
      const card = event.target.closest(".failed-experiment-card a");
      if (card) window.SixWellAnalytics?.track("item_open", { action: "failed-experiment", itemId: new URL(card.href, location.href).pathname });
      if (event.target.closest("[data-failed-experiments-empty-clear]")) app.querySelector("[data-failed-experiments-clear]").click();
      if (event.target.closest("[data-failed-experiments-retry]")) load();
    });
    window.addEventListener("popstate", () => { syncControls(); load(); });
    syncControls();
    load();
  }

  function paragraphMarkup(value) {
    return text(value).split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  }

  function evidenceMediaMarkup(media, experiment) {
    const kind = mediaKind(media);
    const url = mediaUrl(media);
    const title = text(media.title, media.caption, `${titleCase(kind)} evidence`);
    if (kind === "image" && url) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text(media.alt, media.alt_text, media.caption, experiment.title))}" loading="lazy" decoding="async">`;
    if (kind === "video" && url) return `<video controls playsinline preload="none" aria-label="${escapeHtml(title)}"><source src="${escapeHtml(url)}"${text(media.mime_type, media.mimeType) ? ` type="${escapeHtml(text(media.mime_type, media.mimeType))}"` : ""}>Your browser cannot play this video.</video>`;
    if (kind === "audio" && url) return `<div class="failed-experiment-evidence-audio"><span class="archive-label">Audio evidence</span><audio controls preload="none" aria-label="${escapeHtml(title)}"><source src="${escapeHtml(url)}"${text(media.mime_type, media.mimeType) ? ` type="${escapeHtml(text(media.mime_type, media.mimeType))}"` : ""}>Your browser cannot play this audio.</audio></div>`;
    if (url) return `<a class="failed-experiment-document-link" href="${escapeHtml(url)}"><span class="archive-label">${escapeHtml(titleCase(kind))}</span><strong>${escapeHtml(title)}</strong><span>Open evidence <span aria-hidden="true">↗</span></span></a>`;
    return `<div class="failed-experiment-evidence-placeholder"><span class="archive-label">${escapeHtml(titleCase(kind))}</span><strong>${escapeHtml(title)}</strong></div>`;
  }

  function evidenceMarkup(media, experiment, index) {
    const caption = text(media.caption);
    const transcript = text(media.transcript);
    const role = titleCase(first(media.role, mediaKind(media), "Evidence"));
    return `<figure class="failed-experiment-evidence-card">
      <div class="failed-experiment-evidence-media">${evidenceMediaMarkup(media, experiment)}</div>
      <figcaption><span><span class="archive-label">${String(index + 1).padStart(2, "0")} · ${escapeHtml(role)}</span>${caption ? `<span>${escapeHtml(caption)}</span>` : ""}${transcript ? `<details class="failed-experiment-transcript"><summary>Read transcript</summary><div>${paragraphMarkup(transcript)}</div></details>` : ""}</span></figcaption>
    </figure>`;
  }

  function detailNarratives(experiment) {
    const entries = [
      ["The attempt", first(experiment.attempt, experiment.intent, experiment.hypothesis)],
      ["What happened", first(experiment.failure_observation, experiment.observation, experiment.result_note)],
      ["What it taught", first(experiment.learning, experiment.learning_note)],
      ["Next move", first(experiment.next_step, experiment.nextStep)],
      ["Later afterlife", experiment.afterlife_note],
      ["Expanded context", first(experiment.expanded_context, experiment.context, experiment.body)],
    ].filter(([, value]) => text(value));
    if (!entries.length) return "";
    return `<section class="failed-experiment-narrative" aria-labelledby="failed-experiment-narrative-title"><header><span class="archive-section-index">Record</span><h2 id="failed-experiment-narrative-title">What was preserved</h2></header><div class="failed-experiment-narrative-grid">${entries.map(([label, value]) => `<article><span class="archive-label">${escapeHtml(label)}</span><div>${paragraphMarkup(value)}</div></article>`).join("")}</div></section>`;
  }

  function renderDetailPayload(payload) {
    const experiment = normalizeExperiment({ ...(payload || {}), experiment: payload && payload.experiment });
    const media = normalizeMedia(first(payload && payload.media, experiment.media, []));
    const title = text(experiment.title, "Untitled experiment");
    const summary = text(experiment.summary, experiment.public_note, experiment.note);
    const afterlife = titleCase(first(experiment.afterlife, "none"));
    const metadata = [
      displayDate(experiment),
      text(experiment.medium_label, titleCase(mediumKey(experiment))),
      titleCase(experiment.kind),
      text(experiment.process_phase),
    ].filter(Boolean);
    document.title = `${title} · Failed Experiments · the six.well construct`;
    setBreadcrumb(experiment);
    app.innerHTML = `
      <article class="failed-experiment-detail" data-archive-medium="${escapeHtml(mediumKey(experiment))}">
        <header class="archive-hero failed-experiment-detail-hero site-hero site-hero--supporting" aria-labelledby="failed-experiment-title">
          <div><span class="archive-kicker">Failed experiment</span><h1 class="hero-title" id="failed-experiment-title">${escapeHtml(title)}</h1></div>
          <div class="archive-hero-copy">${summary ? `<p class="hero-descriptor">${escapeHtml(summary)}</p>` : ""}<div class="archive-meta">${metadata.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div><div class="archive-actions"><a class="archive-button" href="/archive/failed-experiments/">All failed experiments</a></div></div>
        </header>
        <dl class="failed-experiment-outcomes" aria-label="Experiment outcome">
          <div><dt>Original result</dt><dd>${escapeHtml(titleCase(first(experiment.result, "Unresolved")))}</dd></div>
          <div><dt>Later afterlife</dt><dd>${escapeHtml(afterlife)}</dd></div>
        </dl>
        ${detailNarratives(experiment)}
        ${media.length ? `<section class="failed-experiment-evidence" aria-labelledby="failed-experiment-evidence-title"><header><span class="archive-section-index">Evidence sequence</span><h2 id="failed-experiment-evidence-title">What remains</h2></header><div class="failed-experiment-evidence-grid">${media.map((item, index) => evidenceMarkup(item, experiment, index)).join("")}</div></section>` : ""}
        <section class="failed-experiment-connections" data-failed-experiment-connections hidden aria-label="Related records"></section>
      </article>`;

    const host = app.querySelector("[data-failed-experiment-connections]");
    if (host && experiment.id && window.ConstructConnections && host.dataset.mounted !== "true") {
      host.dataset.mounted = "true";
      window.ConstructConnections.mount({ entityId: experiment.id, host, embedded: true });
    }
  }

  async function renderDetail(slug) {
    setBreadcrumb({ title: "Experiment" });
    app.innerHTML = loading("Opening this failed experiment…");
    try {
      const payload = await getJson(`/api/archive/failed-experiments/${encodeURIComponent(slug)}`);
      renderDetailPayload(payload);
    } catch (error) {
      const missing = error.status === 404;
      document.title = `${missing ? "Experiment not found" : "Failed experiment unavailable"} · the six.well construct`;
      app.innerHTML = errorState(
        missing ? "This experiment is not public." : "This experiment could not be opened.",
        missing ? "It may still be under review, archived, or the address may be incorrect." : "The public Archive did not answer. Try again in a moment.",
        { retry: !missing }
      );
      app.querySelector("[data-failed-experiments-retry]")?.addEventListener("click", () => renderDetail(slug));
    }
  }

  const slug = slugFromPath();
  if (slug) renderDetail(slug);
  else renderIndex();
})();
