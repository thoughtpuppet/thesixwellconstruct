(function () {
  "use strict";

  const app = document.querySelector("[data-blackboards-app]");
  if (!app) return;

  const dialog = document.querySelector("[data-blackboard-zoom]");
  const zoomStage = dialog?.querySelector("[data-blackboard-zoom-stage]");
  const zoomTitle = dialog?.querySelector("[data-blackboard-zoom-title]");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ""), location.origin);
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : "";
    } catch {
      return "";
    }
  };
  const pathParts = location.pathname.split("/").filter(Boolean);
  const detailSlug = pathParts.length === 3 && pathParts[0] === "archive" && pathParts[1] === "blackboards" ? pathParts[2] : "";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const presentationCleanups = new Map();
  const maskPixelCache = new Map();

  let detailData = null;
  let fragmentViewReturn = null;
  let fragmentStageObserver = null;

  function imageAttributes(image, alt = "", loading = "lazy") {
    const width = Number(image?.width || 0);
    const height = Number(image?.height || 0);
    return `src="${escapeHtml(safeUrl(image?.url))}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async"${width > 0 ? ` width="${width}"` : ""}${height > 0 ? ` height="${height}"` : ""}`;
  }

  function fragmentPresentationMarkup(image, { alt = "", loading = "lazy", modifier = "" } = {}) {
    if (!image?.url) return "";
    return `<span class="blackboard-fragment-presentation${modifier ? ` ${modifier}` : ""}" data-fragment-presentation>
      <canvas class="blackboard-fragment-eyes" data-fragment-eyes aria-hidden="true"></canvas>
      <img ${imageAttributes(image, alt, loading)}>
    </span>`;
  }

  function mountPresentations(root = document) {
    if (!window.ConstructAmbientField) return;
    root.querySelectorAll?.("[data-fragment-presentation]").forEach((frame) => {
      if (presentationCleanups.has(frame)) return;
      const eyes = frame.querySelector("[data-fragment-eyes]");
      if (!eyes) return;
      const cleanup = window.ConstructAmbientField.mount({
        root: frame,
        eyesCanvas: eyes,
        animateEyes: false,
        eyeOpacity: 0.10,
        eyeTint: "#6D3D15",
        eyeMask: "radial-gradient(ellipse 68% 62% at 50% 48%, black 20%, rgba(0,0,0,0.68) 58%, transparent 100%)",
        particleCount: 0,
      });
      presentationCleanups.set(frame, cleanup);
    });
  }

  function cleanupPresentations(root) {
    for (const [frame, cleanup] of presentationCleanups) {
      if (root === frame || root?.contains?.(frame)) {
        cleanup?.();
        presentationCleanups.delete(frame);
      }
    }
  }

  function zoomButton(image, title, className = "blackboard-scan-button", loading = "lazy", presentation = "scan") {
    if (!image?.url) return "";
    const fragment = presentation === "fragment";
    return `<button class="${className}${fragment ? " blackboard-fragment-media-button" : ""}" type="button" data-blackboard-open data-presentation="${fragment ? "fragment" : "scan"}" data-src="${escapeHtml(safeUrl(image.url))}" data-alt="${escapeHtml(image.alt_text || title)}" data-title="${escapeHtml(title)}" data-width="${Number(image.width || 0)}" data-height="${Number(image.height || 0)}" aria-label="${fragment ? "Open full-size fragment" : "Zoom"}: ${escapeHtml(title)}">
      ${fragment ? fragmentPresentationMarkup(image, { alt: "", loading }) : `<img ${imageAttributes(image, image.alt_text || title, loading)}>`}
    </button>`;
  }

  function openZoom(button) {
    if (!dialog || !zoomStage) return;
    const image = {
      url: button.dataset.src || "",
      alt_text: button.dataset.alt || "Blackboard image",
      width: Number(button.dataset.width || 0),
      height: Number(button.dataset.height || 0),
    };
    cleanupPresentations(zoomStage);
    zoomStage.replaceChildren();
    if (button.dataset.presentation === "fragment") {
      zoomStage.innerHTML = fragmentPresentationMarkup(image, {
        alt: image.alt_text,
        loading: "eager",
        modifier: "blackboard-fragment-presentation--zoom",
      });
    } else {
      zoomStage.innerHTML = `<img ${imageAttributes(image, image.alt_text, "eager")}>`;
    }
    if (zoomTitle) zoomTitle.textContent = button.dataset.title || "Blackboard image";
    dialog.showModal();
    requestAnimationFrame(() => mountPresentations(zoomStage));
  }

  function statePlacements(stateId, fragments) {
    return fragments.flatMap((fragment) => (Array.isArray(fragment.placements) ? fragment.placements : [])
      .filter((placement) => (placement.stateId || placement.state_id) === stateId)
      .map((placement) => ({ fragment, placement })))
      .sort((left, right) => Number(left.placement.sortOrder ?? left.placement.sort_order ?? 0) - Number(right.placement.sortOrder ?? right.placement.sort_order ?? 0));
  }

  function placementNumbers(placement) {
    const bounds = placement.bounds || {};
    return {
      x: Number(placement.xPercent ?? placement.x_percent ?? placement.x_pct ?? bounds.xPercent ?? bounds.x_percent ?? bounds.x_pct),
      y: Number(placement.yPercent ?? placement.y_percent ?? placement.y_pct ?? bounds.yPercent ?? bounds.y_percent ?? bounds.y_pct),
      width: Number(placement.widthPercent ?? placement.width_percent ?? placement.width_pct ?? bounds.widthPercent ?? bounds.width_percent ?? bounds.width_pct),
      height: Number(placement.heightPercent ?? placement.height_percent ?? placement.height_pct ?? bounds.heightPercent ?? bounds.height_percent ?? bounds.height_pct),
    };
  }

  function maskForPlacement(placement) {
    const mask = placement.hotspotMask || placement.hotspot_mask;
    const url = safeUrl(mask?.url || placement.maskUrl || placement.mask_url || "");
    return url ? { ...(mask || {}), url } : null;
  }

  function hotspotMarkup({ fragment, placement }, index) {
    const { x, y, width, height } = placementNumbers(placement);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return "";
    const mask = maskForPlacement(placement);
    return `<span class="blackboard-hotspot-region${mask ? " has-mask" : ""}" style="left:${x}%;top:${y}%;width:${width}%;height:${height}%" data-mask-url="${escapeHtml(mask?.url || "")}">
      <span class="blackboard-hotspot-shape" aria-hidden="true"></span>
      <button type="button" data-select-board-fragment="${escapeHtml(fragment.id)}" data-hotspot-target data-x="${x}" data-y="${y}" data-width="${width}" data-height="${height}" data-mask-url="${escapeHtml(mask?.url || "")}" aria-label="${index + 1}. Open fragment: ${escapeHtml(fragment.title)}"></button>
      <span class="blackboard-hotspot-index" aria-hidden="true">${index + 1}</span>
    </span>`;
  }

  function prepareHotspotMasks(root) {
    root.querySelectorAll?.(".blackboard-hotspot-region[data-mask-url]").forEach((region) => {
      const url = safeUrl(region.dataset.maskUrl);
      if (!url) return;
      const shape = region.querySelector(".blackboard-hotspot-shape");
      if (!shape) return;
      const value = `url("${url.replace(/"/g, "%22")}")`;
      shape.style.webkitMaskImage = value;
      shape.style.maskImage = value;
    });
  }

  function loadMaskPixels(url) {
    if (maskPixelCache.has(url)) return maskPixelCache.get(url);
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, image.naturalWidth);
          canvas.height = Math.max(1, image.naturalHeight);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          resolve({ width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data });
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error("Hotspot mask unavailable."));
      image.src = url;
    }).catch((error) => {
      maskPixelCache.delete(url);
      throw error;
    });
    maskPixelCache.set(url, pending);
    return pending;
  }

  function pointInsideExpandedBounds(button, event) {
    const stage = button.closest("[data-interactive-stage]");
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const bounds = {
      x: Number(button.dataset.x),
      y: Number(button.dataset.y),
      width: Number(button.dataset.width),
      height: Number(button.dataset.height),
    };
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
    const x = (event.clientX - rect.left) / rect.width * 100;
    const y = (event.clientY - rect.top) / rect.height * 100;
    const toleranceX = Math.max(0, (44 - rect.width * bounds.width / 100) / 2) / rect.width * 100;
    const toleranceY = Math.max(0, (44 - rect.height * bounds.height / 100) / 2) / rect.height * 100;
    if (x < bounds.x - toleranceX || x > bounds.x + bounds.width + toleranceX || y < bounds.y - toleranceY || y > bounds.y + bounds.height + toleranceY) return null;
    return {
      localX: Math.min(1, Math.max(0, (x - bounds.x) / bounds.width)),
      localY: Math.min(1, Math.max(0, (y - bounds.y) / bounds.height)),
      placementPixelWidth: rect.width * bounds.width / 100,
      placementPixelHeight: rect.height * bounds.height / 100,
    };
  }

  async function hotspotHit(button, event) {
    if (event.detail === 0) return true;
    const point = pointInsideExpandedBounds(button, event);
    if (!point) return false;
    const maskUrl = safeUrl(button.dataset.maskUrl);
    if (!maskUrl) return true;
    try {
      const mask = await loadMaskPixels(maskUrl);
      const centerX = Math.round(point.localX * (mask.width - 1));
      const centerY = Math.round(point.localY * (mask.height - 1));
      const radiusX = Math.min(18, Math.max(1, Math.ceil(mask.width * 6 / Math.max(1, point.placementPixelWidth))));
      const radiusY = Math.min(18, Math.max(1, Math.ceil(mask.height * 6 / Math.max(1, point.placementPixelHeight))));
      for (let y = Math.max(0, centerY - radiusY); y <= Math.min(mask.height - 1, centerY + radiusY); y += 1) {
        for (let x = Math.max(0, centerX - radiusX); x <= Math.min(mask.width - 1, centerX + radiusX); x += 1) {
          const dx = (x - centerX) / radiusX;
          const dy = (y - centerY) / radiusY;
          if (dx * dx + dy * dy <= 1 && mask.data[(y * mask.width + x) * 4 + 3] >= 24) return true;
        }
      }
      return false;
    } catch {
      return true;
    }
  }

  function stateCard(state, { timeline = false, recordTitle = "", fragments = [], anchor = true } = {}) {
    const title = recordTitle ? `${recordTitle} · ${state.title}` : state.title;
    const placements = statePlacements(state.id, fragments);
    return `<article class="blackboard-card${timeline ? " blackboard-timeline-card" : ""}"${anchor ? ` id="state-${escapeHtml(state.id)}"` : ""}>
      ${zoomButton(state.scan, title)}
      <div class="blackboard-card-copy">
        <p class="blackboard-card-meta">${escapeHtml(state.catalogue_label)}${state.date_label ? ` · ${escapeHtml(state.date_label)}` : ""}</p>
        <h3>${escapeHtml(state.title)}</h3>
        ${state.description ? `<p>${escapeHtml(state.description)}</p>` : ""}
        ${placements.length ? `<button class="blackboard-fragment-entry" type="button" data-enter-fragment-view data-state-id="${escapeHtml(state.id)}">Enter fragment view <span>${placements.length} mapped ${placements.length === 1 ? "fragment" : "fragments"}</span></button>` : ""}
      </div>
    </article>`;
  }

  function recordCard(record) {
    const latest = record.latestState || record.latest_state || record.latestCapture || record.latest_capture;
    return `<article class="blackboard-surface-card blackboard-field-card">
      ${latest ? `<div class="blackboard-field-media"><span>Latest documented state</span>${zoomButton(latest.scan, `${record.title} · ${latest.title}`)}</div>` : ""}
      <div class="blackboard-card-copy">
        <p class="blackboard-card-meta">${escapeHtml(record.catalogueLabel || record.catalogue_label)} · ${escapeHtml(record.studioLocation || record.studio_location)} · ${escapeHtml(record.wallDesignation || record.wall_designation)}</p>
        <h2><a href="${escapeHtml(safeUrl(record.route))}">${escapeHtml(record.title)}</a></h2>
        ${record.summary ? `<p>${escapeHtml(record.summary)}</p>` : ""}
        <dl class="blackboard-card-register"><div><dt>Current state</dt><dd>${escapeHtml(latest?.catalogue_label || latest?.title || "Not available")}</dd></div><div><dt>Captured states</dt><dd>${Number(record.stateCount || record.state_count)}</dd></div><div><dt>Public fragments</dt><dd>${Number(record.fragmentCount || record.fragment_count)}</dd></div></dl>
        <a class="blackboard-card-open" href="${escapeHtml(safeUrl(record.route))}">Open Blackboard record <span aria-hidden="true">↗</span></a>
      </div>
    </article>`;
  }

  function manifestationList(items) {
    return items.length ? `<div class="blackboard-fragment-links"><h4>Manifestations</h4><ul>${items.map((item) => `<li><span>${escapeHtml(item.relationship)}</span> <a href="${escapeHtml(safeUrl(item.target?.route) || "/archive/")}">${escapeHtml(item.target?.title)}</a></li>`).join("")}</ul></div>` : "";
  }

  function fragmentCard(fragment) {
    const visible = fragment.visibleIn || fragment.visible_in || [];
    const threads = fragment.originThreads || fragment.origin_threads || [];
    return `<article class="blackboard-fragment" id="fragment-${escapeHtml(fragment.slug)}">
      ${zoomButton(fragment.image, fragment.title, "blackboard-scan-button", "lazy", "fragment")}
      <div class="blackboard-fragment-copy">
        <p class="blackboard-fragment-board">${fragment.date ? escapeHtml(fragment.date) : "Date not fixed to a board state"}</p>
        <h3>${escapeHtml(fragment.title)}</h3>
        ${fragment.caption ? `<p>${escapeHtml(fragment.caption)}</p>` : ""}
        ${manifestationList(Array.isArray(fragment.manifestations) ? fragment.manifestations : [])}
        ${visible.length ? `<div class="blackboard-fragment-links"><h4>Visible in</h4><ul>${visible.map((state) => `<li><a href="#state-${escapeHtml(state.id)}">${escapeHtml(state.catalogue_label)} · ${escapeHtml(state.date_label || state.title)}</a></li>`).join("")}</ul></div>` : ""}
        ${threads.length ? `<div class="blackboard-fragment-links"><h4>Origin threads</h4><ul>${threads.map((thread) => `<li>${escapeHtml(thread.title)}</li>`).join("")}</ul></div>` : ""}
      </div>
    </article>`;
  }

  function fragmentIndexCard(fragment) {
    const board = fragment.board || {};
    const boardRoute = safeUrl(board.route) || "/archive/blackboards/";
    const visible = fragment.visibleIn || fragment.visible_in || [];
    const threads = fragment.originThreads || fragment.origin_threads || [];
    const manifestations = Array.isArray(fragment.manifestations) ? fragment.manifestations : [];
    const relationships = [...new Set([
      ...manifestations.map((item) => item.relationship).filter(Boolean),
      ...(visible.length ? ["Visible in state"] : []),
      ...(threads.length ? ["Origin Thread"] : []),
    ])];
    const fragmentRoute = `${boardRoute}#fragment-${encodeURIComponent(fragment.slug || fragment.id || "")}`;
    const boardLabel = board.catalogueLabel || board.catalogue_label || board.title || "Blackboard record";
    return `<article class="blackboard-fragment blackboard-index-fragment" id="index-fragment-${escapeHtml(fragment.slug)}">
      <div class="blackboard-index-fragment-media"><span>Blackboard fragment</span>${zoomButton(fragment.image, fragment.title, "blackboard-scan-button", "lazy", "fragment")}</div>
      <div class="blackboard-fragment-copy">
        <p class="blackboard-fragment-board"><a href="${escapeHtml(boardRoute)}">${escapeHtml(boardLabel)}</a>${fragment.date ? ` · ${escapeHtml(fragment.date)}` : ""}</p>
        <h3>${escapeHtml(fragment.title)}</h3>
        ${fragment.caption ? `<p>${escapeHtml(fragment.caption)}</p>` : ""}
        ${relationships.length ? `<div class="blackboard-index-relationships" aria-label="Fragment relationships">${relationships.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : ""}
        <a class="blackboard-card-open" href="${escapeHtml(fragmentRoute)}">Trace fragment connections <span aria-hidden="true">↗</span></a>
      </div>
    </article>`;
  }

  function notebookCard(item) {
    return `<article class="blackboard-fragment">${zoomButton(item.image, item.title)}<div class="blackboard-fragment-copy">
      <p class="blackboard-fragment-board">${escapeHtml(item.date || "Undated notebook entry")}</p><h3>${escapeHtml(item.title)}</h3>
      ${item.caption ? `<p>${escapeHtml(item.caption)}</p>` : ""}${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}</div></article>`;
  }

  function historyMarkup(item) {
    return `<article class="blackboard-history-entry"><p class="blackboard-card-meta">${escapeHtml(item.date_label || item.occurred_at || "Undated")}</p><h3>${escapeHtml(item.title)}</h3>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}</article>`;
  }

  function timeline(states, recordTitle, fragments) {
    return states.map((state, index) => `${index && Number.isFinite(Number(state.elapsed_days)) ? `<div class="blackboard-interval" aria-label="${Number(state.elapsed_days)} days elapsed"><span>${Number(state.elapsed_days)} days later</span></div>` : ""}${stateCard(state, { timeline: true, recordTitle, fragments })}`).join("");
  }

  function fragmentViewDetail(fragment) {
    const manifestations = Array.isArray(fragment.manifestations) ? fragment.manifestations : [];
    const threads = fragment.originThreads || fragment.origin_threads || [];
    return `<div class="blackboard-fragment-view-detail">
      ${zoomButton(fragment.image, fragment.title, "blackboard-fragment-detail-button", "eager", "fragment")}
      <p class="blackboard-fragment-board">${escapeHtml(fragment.date || "Date not fixed to a board state")}</p>
      <h3>${escapeHtml(fragment.title)}</h3>
      ${fragment.caption ? `<p>${escapeHtml(fragment.caption)}</p>` : ""}${fragment.body ? `<p>${escapeHtml(fragment.body)}</p>` : ""}
      ${manifestationList(manifestations)}
      ${threads.length ? `<div class="blackboard-fragment-links"><h4>Origin threads</h4><ul>${threads.map((thread) => `<li>${escapeHtml(thread.title)}</li>`).join("")}</ul></div>` : ""}
      <button type="button" data-open-notebook-fragment="${escapeHtml(fragment.slug)}">View this Notebook entry</button>
    </div>`;
  }

  function fragmentStateOptions(selectedId) {
    const states = Array.isArray(detailData?.states) ? detailData.states : [];
    if (states.length < 2) return "";
    return `<label class="blackboard-fragment-state-filter"><span>Board state</span><select data-fragment-state-filter>${states.map((state) => `<option value="${escapeHtml(state.id)}"${state.id === selectedId ? " selected" : ""}>${escapeHtml(state.catalogue_label)} · ${escapeHtml(state.date_label || state.title)}</option>`).join("")}</select></label>`;
  }

  function boardStageMarkup(state, entries) {
    const scan = state.scan || {};
    const width = Number(scan.width || 0);
    const height = Number(scan.height || 0);
    const ratio = width > 0 && height > 0 ? ` style="aspect-ratio:${width}/${height}"` : "";
    return `<div class="blackboard-interactive-stage${ratio ? " has-known-ratio" : ""}" data-interactive-stage data-mode="full"${ratio}>
      <img ${imageAttributes(scan, scan.alt_text || state.title, "eager")}>
      <div class="blackboard-hotspots" aria-label="Mapped fragment regions">${entries.map(hotspotMarkup).join("")}</div>
    </div>`;
  }

  function fragmentRailMarkup(entries) {
    return `<div class="blackboard-fragment-rail" role="list" aria-label="Fragments visible in this state">${entries.map(({ fragment }, index) => `<div class="blackboard-fragment-rail-item" role="listitem"><button type="button" data-select-board-fragment="${escapeHtml(fragment.id)}" data-fragment-rail-button aria-current="false" tabindex="${index ? "-1" : "0"}" aria-label="${index + 1}. Select fragment: ${escapeHtml(fragment.title)}"><span class="blackboard-fragment-rail-index" aria-hidden="true">${index + 1}</span>${fragmentPresentationMarkup(fragment.image, { alt: "", loading: "lazy" })}<strong>${escapeHtml(fragment.title)}</strong></button></div>`).join("")}</div>`;
  }

  function disconnectFragmentStage() {
    fragmentStageObserver?.disconnect();
    fragmentStageObserver = null;
  }

  function renderFragmentView(state, entries, selectedId = "") {
    const view = app.querySelector("[data-blackboard-fragment-view]");
    if (!view) return;
    disconnectFragmentStage();
    cleanupPresentations(view);
    view.hidden = false;
    view.dataset.stateId = state.id;
    view.innerHTML = `<div class="blackboard-fragment-view-toolbar"><div><p class="blackboard-card-meta">${escapeHtml(state.catalogue_label)} · ${escapeHtml(state.date_label || state.title)}</p><h2 tabindex="-1">Fragment view</h2></div><div class="blackboard-fragment-view-actions">${fragmentStateOptions(state.id)}<button type="button" data-exit-fragment-view>Return to Blackboard record</button></div></div>
      <div class="blackboard-fragment-workspace"><div class="blackboard-fragment-canvas"><div class="blackboard-fragment-modebar" role="group" aria-label="Blackboard view"><button type="button" data-fragment-full aria-pressed="true">Return to Full View</button><button type="button" data-fragment-selected aria-pressed="false" disabled>Selected area</button></div>${boardStageMarkup(state, entries)}</div><aside data-fragment-view-detail aria-live="polite"><p>${entries.length ? "Select a highlighted region on the full board or choose a close-up from the rail." : "No fragment location has been confirmed for this state."}</p></aside></div>
      ${entries.length ? fragmentRailMarkup(entries) : '<p class="blackboards-empty blackboard-fragment-empty-state" role="status">No mapped fragments are confirmed for this state.</p>'}`;
    prepareHotspotMasks(view);
    mountPresentations(view);
    const stage = view.querySelector("[data-interactive-stage]");
    if (stage && window.ResizeObserver) {
      fragmentStageObserver = new ResizeObserver(() => {
        if (stage.dataset.mode === "detail" && stage.dataset.fragmentId) applyBoardZoom(stage.dataset.fragmentId);
      });
      fragmentStageObserver.observe(stage);
    }
    if (selectedId) selectBoardFragment(selectedId);
  }

  function enterFragmentView(stateId, trigger) {
    if (!detailData) return;
    const states = Array.isArray(detailData.states) ? detailData.states : [];
    const fragments = Array.isArray(detailData.fragments) ? detailData.fragments : [];
    const state = states.find((item) => item.id === stateId);
    const entries = state ? statePlacements(state.id, fragments) : [];
    if (!state || !entries.length) return;
    fragmentViewReturn = trigger || document.activeElement;
    app.querySelector("[data-blackboard-record-view]").hidden = true;
    renderFragmentView(state, entries);
    app.querySelector("[data-blackboard-fragment-view] h2")?.focus?.();
    app.querySelector("[data-blackboard-fragment-view]")?.scrollIntoView({ block: "start" });
  }

  function exitFragmentView() {
    const view = app.querySelector("[data-blackboard-fragment-view]");
    const record = app.querySelector("[data-blackboard-record-view]");
    if (!view || view.hidden) return;
    disconnectFragmentStage();
    cleanupPresentations(view);
    view.hidden = true;
    view.replaceChildren();
    record.hidden = false;
    fragmentViewReturn?.focus?.();
    fragmentViewReturn = null;
  }

  function fragmentAndPlacement(fragmentId) {
    const view = app.querySelector("[data-blackboard-fragment-view]");
    const fragment = detailData?.fragments?.find((item) => item.id === fragmentId);
    const placement = fragment?.placements?.find((item) => (item.stateId || item.state_id) === view?.dataset.stateId);
    return { view, fragment, placement };
  }

  function applyBoardZoom(fragmentId) {
    const { view, placement } = fragmentAndPlacement(fragmentId);
    const stage = view?.querySelector("[data-interactive-stage]");
    const image = stage?.querySelector(":scope > img");
    if (!stage || !image || !placement || stage.dataset.mode !== "detail") return;
    const { x, y, width, height } = placementNumbers(placement);
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (![x, y, width, height, stageWidth, stageHeight].every(Number.isFinite) || width <= 0 || height <= 0 || stageWidth <= 0 || stageHeight <= 0) return;
    const scale = Math.min(6, Math.max(1.6, Math.min(0.78 * 100 / width, 0.68 * 100 / height)));
    const centerX = (x + width / 2) / 100 * stageWidth;
    const centerY = (y + height / 2) / 100 * stageHeight;
    stage.style.setProperty("--fragment-scale", String(scale));
    stage.style.setProperty("--fragment-translate-x", `${stageWidth / 2 - centerX * scale}px`);
    stage.style.setProperty("--fragment-translate-y", `${stageHeight / 2 - centerY * scale}px`);
  }

  function selectBoardFragment(fragmentId) {
    if (!detailData) return;
    const { view, fragment, placement } = fragmentAndPlacement(fragmentId);
    const stage = view?.querySelector("[data-interactive-stage]");
    if (!view || !stage || !fragment || !placement) return;
    stage.dataset.mode = "detail";
    stage.dataset.fragmentId = fragmentId;
    view.querySelectorAll("[data-select-board-fragment]").forEach((button) => {
      const selected = button.dataset.selectBoardFragment === fragmentId;
      button.setAttribute("aria-current", selected ? "true" : "false");
      if (button.matches("[data-fragment-rail-button]")) button.tabIndex = selected ? 0 : -1;
    });
    view.querySelector("[data-fragment-full]")?.setAttribute("aria-pressed", "false");
    const selected = view.querySelector("[data-fragment-selected]");
    if (selected) {
      selected.disabled = false;
      selected.dataset.fragmentId = fragmentId;
      selected.setAttribute("aria-pressed", "true");
    }
    const detail = view.querySelector("[data-fragment-view-detail]");
    cleanupPresentations(detail);
    detail.innerHTML = fragmentViewDetail(fragment);
    mountPresentations(detail);
    applyBoardZoom(fragmentId);
    const image = stage.querySelector(":scope > img");
    if (image && !image.complete) image.addEventListener("load", () => applyBoardZoom(fragmentId), { once: true });
    view.querySelector(`[data-fragment-rail-button][data-select-board-fragment="${CSS.escape(fragmentId)}"]`)?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  }

  function showFullBoard() {
    const view = app.querySelector("[data-blackboard-fragment-view]");
    const stage = view?.querySelector("[data-interactive-stage]");
    if (!view || !stage) return;
    stage.dataset.mode = "full";
    delete stage.dataset.fragmentId;
    stage.style.removeProperty("--fragment-scale");
    stage.style.removeProperty("--fragment-translate-x");
    stage.style.removeProperty("--fragment-translate-y");
    view.querySelectorAll("[data-select-board-fragment]").forEach((button) => button.setAttribute("aria-current", "false"));
    const rails = [...view.querySelectorAll("[data-fragment-rail-button]")];
    rails.forEach((button, index) => { button.tabIndex = index ? -1 : 0; });
    view.querySelector("[data-fragment-full]")?.setAttribute("aria-pressed", "true");
    const selected = view.querySelector("[data-fragment-selected]");
    if (selected) {
      selected.disabled = true;
      selected.removeAttribute("data-fragment-id");
      selected.setAttribute("aria-pressed", "false");
    }
    const detail = view.querySelector("[data-fragment-view-detail]");
    cleanupPresentations(detail);
    detail.innerHTML = "<p>Select a highlighted region on the full board or choose a close-up from the rail.</p>";
  }

  function renderDetail(data) {
    cleanupPresentations(app);
    disconnectFragmentStage();
    const record = data.record || data.surface;
    const latest = data.latestState || data.latest_state || data.latestCapture || data.latest_capture;
    const states = Array.isArray(data.states) ? data.states : (Array.isArray(data.captures) ? data.captures : []);
    const notebook = Array.isArray(data.notebook) ? data.notebook : (data.contextMedia || data.context_media || []);
    const fragments = Array.isArray(data.fragments) ? data.fragments : [];
    const history = data.itemHistory || data.item_history || data.activities || [];
    document.title = `${record.title} · the six.well construct`;
    const title = document.querySelector(".hero-title");
    const descriptor = document.querySelector(".hero-descriptor");
    const current = document.querySelector(".construct-breadcrumb-current");
    if (title) title.textContent = record.title;
    if (current) current.textContent = record.title;
    if (descriptor) descriptor.textContent = record.summary || "One evolving Blackboard record documented through dated states and notebook fragments.";
    detailData = { ...data, record, states, fragments };
    app.innerHTML = `<div data-blackboard-record-view><section class="blackboard-surface-intro" aria-label="Blackboard record identity">
        <dl><div><dt>Record</dt><dd>${escapeHtml(record.catalogueLabel || record.catalogue_label)}</dd></div><div><dt>Location</dt><dd>${escapeHtml(record.studioLocation || record.studio_location)}</dd></div><div><dt>Wall</dt><dd>${escapeHtml(record.wallDesignation || record.wall_designation)}</dd></div><div><dt>Orientation</dt><dd>${escapeHtml(record.orientationNote || record.orientation_note)}</dd></div></dl>
      </section>
      <section class="blackboards-section blackboard-latest" aria-labelledby="latest-capture">
        <div class="blackboards-section-heading"><h2 id="latest-capture">Current documented state</h2><p>The newest scan leads while remaining part of this single catalogued Blackboard record.</p></div>
        ${latest ? stateCard(latest, { recordTitle: record.title, fragments, anchor: false }) : `<p class="blackboards-empty">No public state is available.</p>`}
      </section>
      <section class="blackboards-section" aria-labelledby="capture-timeline">
        <div class="blackboards-section-heading"><h2 id="capture-timeline">Version 1 · States</h2><p>State I through the current state, oldest to newest. Intervals report elapsed calendar days between scans.</p></div>
        ${states.length ? `<div class="blackboard-timeline">${timeline(states, record.title, fragments)}</div>` : `<p class="blackboards-empty">No public states are available.</p>`}
      </section>
      <section class="blackboards-section" aria-labelledby="open-notebook"><div class="blackboards-section-heading"><h2 id="open-notebook">Open notebook</h2><p>Studio context and sporadic close-up fragments. An entry does not belong to a dated state unless “Visible in” is manually confirmed.</p></div>
        ${notebook.length ? `<div class="blackboard-context-grid">${notebook.map(notebookCard).join("")}</div>` : ""}
        ${fragments.length ? `<div class="blackboard-fragment-grid">${fragments.map(fragmentCard).join("")}</div>` : ""}
        ${!notebook.length && !fragments.length ? `<p class="blackboards-empty">No Notebook entries are public yet.</p>` : ""}
      </section>
      ${history.length ? `<section class="blackboards-section" aria-labelledby="item-history"><div class="blackboards-section-heading"><h2 id="item-history">Item history</h2><p>Documented lifecycle events for the physical Blackboard—not its routine captured states.</p></div><div class="blackboard-history">${history.map(historyMarkup).join("")}</div></section>` : ""}</div><section class="blackboard-fragment-view" data-blackboard-fragment-view hidden></section>`;
    mountPresentations(app);
  }

  function renderIndex(data) {
    cleanupPresentations(app);
    const records = Array.isArray(data.records) ? data.records : (Array.isArray(data.surfaces) ? data.surfaces : []);
    const fragments = Array.isArray(data.fragments) ? data.fragments : [];
    app.innerHTML = `<section class="blackboard-field-intro" aria-labelledby="blackboard-field-thesis"><h2 id="blackboard-field-thesis">One field. Two scales.</h2><div><p>First, browse complete Blackboards as evolving physical records. Then move deeper into the fragments that left those surfaces and entered the wider Construct.</p><p>Both inventories use the same card language, but each answers a different question: “Which board is this?” and “Where did this thought travel?”</p></div></section>
      <nav class="blackboard-field-jump" aria-label="Browse this Blackboard field"><a href="#blackboard-records"><span>01 · Browse boards</span><span aria-hidden="true">↓</span></a><a href="#blackboard-fragment-index"><span>02 · Browse fragments</span><span aria-hidden="true">↓</span></a></nav>
      <section class="blackboards-section blackboard-field-section" aria-labelledby="blackboard-records">
      <div class="blackboards-section-heading"><h2 id="blackboard-records">The Field</h2><p>Every card is one physical Blackboard with a permanent catalogue identity. Its newest public state leads; earlier states remain inside the record.</p></div>
      ${records.length ? `<div class="blackboard-grid">${records.map(recordCard).join("")}</div>` : `<p class="blackboards-empty">No Blackboard records are public yet.</p>`}
      </section>
      <section class="blackboards-section blackboard-fragment-index-section" aria-labelledby="blackboard-fragment-index">
        <div class="blackboards-section-heading"><h2 id="blackboard-fragment-index">Fragment Index</h2><p>Fragments are close readings of the field. Each card identifies its board context and foregrounds the work, record, or Origin Thread the thought became part of.</p></div>
        ${fragments.length ? `<div class="blackboard-index-fragment-grid">${fragments.map(fragmentIndexCard).join("")}</div>` : `<p class="blackboards-empty">No reviewed public fragments are available yet. Open a Blackboard record to browse its captured states.</p>`}
      </section>`;
    mountPresentations(app);
  }

  async function load() {
    try {
      const endpoint = detailSlug ? `/api/archive/blackboards/${encodeURIComponent(detailSlug)}` : "/api/archive/blackboards";
      const response = await fetch(endpoint, { headers: { accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The Blackboard archive could not be opened.");
      if (detailSlug) renderDetail(data);
      else renderIndex(data);
    } catch (error) {
      app.innerHTML = `<p class="blackboards-error" role="alert">${escapeHtml(error.message)} <button type="button" data-blackboards-retry>Try again</button></p>`;
      app.querySelector("[data-blackboards-retry]")?.addEventListener("click", load);
    }
  }

  dialog?.querySelector("[data-blackboard-zoom-close]")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog?.addEventListener("close", () => {
    cleanupPresentations(zoomStage);
    zoomStage?.replaceChildren();
  });

  app.addEventListener("change", (event) => {
    const filter = event.target.closest("[data-fragment-state-filter]");
    if (!filter || !detailData) return;
    const state = detailData.states.find((item) => item.id === filter.value);
    const entries = state ? statePlacements(state.id, detailData.fragments) : [];
    if (!state) return;
    renderFragmentView(state, entries);
    requestAnimationFrame(() => app.querySelector("[data-fragment-state-filter]")?.focus());
  });

  app.addEventListener("click", async (event) => {
    const zoom = event.target.closest("[data-blackboard-open]");
    if (zoom) { openZoom(zoom); return; }
    const enter = event.target.closest("[data-enter-fragment-view]");
    if (enter) { enterFragmentView(enter.dataset.stateId, enter); return; }
    if (event.target.closest("[data-exit-fragment-view]")) { exitFragmentView(); return; }
    const select = event.target.closest("[data-select-board-fragment]");
    if (select) {
      if (select.matches("[data-hotspot-target]") && !(await hotspotHit(select, event))) return;
      selectBoardFragment(select.dataset.selectBoardFragment);
      return;
    }
    if (event.target.closest("[data-fragment-full]")) { showFullBoard(); return; }
    const selected = event.target.closest("[data-fragment-selected]");
    if (selected?.dataset.fragmentId) { selectBoardFragment(selected.dataset.fragmentId); return; }
    const notebook = event.target.closest("[data-open-notebook-fragment]");
    if (notebook) {
      const slug = notebook.dataset.openNotebookFragment;
      exitFragmentView();
      requestAnimationFrame(() => document.querySelector(`#fragment-${CSS.escape(slug)}`)?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" }));
    }
  });

  app.addEventListener("keydown", (event) => {
    const button = event.target.closest("[data-fragment-rail-button]");
    if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...button.closest("[role='list']").querySelectorAll("[data-fragment-rail-button]")];
    const index = buttons.indexOf(button);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowLeft" ? Math.max(0, index - 1) : Math.min(buttons.length - 1, index + 1);
    event.preventDefault();
    const next = buttons[nextIndex];
    next.focus();
    selectBoardFragment(next.dataset.selectBoardFragment);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || dialog?.open) return;
    const view = app.querySelector("[data-blackboard-fragment-view]");
    if (!view || view.hidden) return;
    const stage = view.querySelector("[data-interactive-stage]");
    if (stage?.dataset.mode === "detail") showFullBoard();
    else exitFragmentView();
  });

  window.addEventListener("pagehide", () => {
    disconnectFragmentStage();
    cleanupPresentations(document);
  }, { once: true });

  load();
})();
