const TOKEN_KEY = "swc_submissions_admin_token";
export const FRAGMENT_MAPPER_SCHEMA_VERSION = 1;
export const FRAGMENT_MAPPER_MAX_MASK = 2400;
export const FRAGMENT_MAPPER_RECIPE_LIMIT = 240000;

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const stableId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function parseObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePoint(point = {}) {
  return { x: clamp(point.x), y: clamp(point.y) };
}

function normalizeStroke(stroke = {}) {
  return {
    id: String(stroke.id || stableId()),
    tool: stroke.tool === "erase" ? "erase" : "paint",
    size: clamp(number(stroke.size, 0.045), 0.005, 0.3),
    points: Array.isArray(stroke.points) ? stroke.points.slice(0, 12000).map(normalizePoint) : [],
  };
}

export function normalizeFragmentMappingRecipe(value = {}) {
  const input = parseObject(value);
  const suppliedBounds = input.base_bounds || input.baseBounds || {};
  const baseBounds = ["x_pct", "y_pct", "width_pct", "height_pct"].every((key) => Number.isFinite(Number(suppliedBounds[key] ?? suppliedBounds[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())])))
    ? {
        x_pct: clamp(number(suppliedBounds.x_pct ?? suppliedBounds.xPct), 0, 100),
        y_pct: clamp(number(suppliedBounds.y_pct ?? suppliedBounds.yPct), 0, 100),
        width_pct: clamp(number(suppliedBounds.width_pct ?? suppliedBounds.widthPct), 0, 100),
        height_pct: clamp(number(suppliedBounds.height_pct ?? suppliedBounds.heightPct), 0, 100),
      }
    : null;
  return {
    schema_version: FRAGMENT_MAPPER_SCHEMA_VERSION,
    coordinate_space: "full-scan-normalized",
    brush: { size: clamp(number(input.brush?.size ?? input.brush_size, 0.045), 0.005, 0.3) },
    strokes: Array.isArray(input.strokes) ? input.strokes.slice(0, 1000).map(normalizeStroke) : [],
    base_mask_media_id: String(input.base_mask_media_id || input.baseMaskMediaId || "") || null,
    base_bounds: baseBounds,
    copied_from_state_id: String(input.copied_from_state_id || input.copiedFromStateId || "") || null,
    source_width: Math.max(0, Math.round(number(input.source_width ?? input.sourceWidth, 0))) || null,
    source_height: Math.max(0, Math.round(number(input.source_height ?? input.sourceHeight, 0))) || null,
  };
}

export function serializeFragmentMappingRecipe(value = {}) {
  const encoded = JSON.stringify(normalizeFragmentMappingRecipe(value));
  if (encoded.length > FRAGMENT_MAPPER_RECIPE_LIMIT) throw new Error("This mapping has too many brush points. Undo a few strokes or use a larger brush.");
  return encoded;
}

export function interpolateFragmentMappingStroke(points, spacing = 0.01) {
  const source = (points || []).map(normalizePoint);
  if (source.length < 2) return source;
  const step = Math.max(0.0005, number(spacing, 0.01));
  const result = [source[0]];
  for (let index = 1; index < source.length; index += 1) {
    const from = source[index - 1];
    const to = source[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let part = 1; part <= count; part += 1) {
      const progress = part / count;
      result.push({ x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });
    }
  }
  return result;
}

function stampStroke(context, stroke, width, height) {
  if (!stroke.points.length) return;
  const radius = Math.max(1, stroke.size * Math.min(width, height) / 2);
  const points = interpolateFragmentMappingStroke(stroke.points, Math.max(0.0005, stroke.size / 7));
  context.save();
  context.globalCompositeOperation = stroke.tool === "erase" ? "destination-out" : "source-over";
  context.fillStyle = "#fff";
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawRecipeMask(canvas, recipe, baseMask = null) {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (baseMask) {
    const bounds = recipe.base_bounds;
    if (bounds) context.drawImage(baseMask, bounds.x_pct / 100 * canvas.width, bounds.y_pct / 100 * canvas.height, bounds.width_pct / 100 * canvas.width, bounds.height_pct / 100 * canvas.height);
    else context.drawImage(baseMask, 0, 0, canvas.width, canvas.height);
  }
  for (const stroke of recipe.strokes) stampStroke(context, stroke, canvas.width, canvas.height);
  return canvas;
}

export function fragmentMaskBounds(imageData, width, height) {
  const data = imageData?.data || imageData;
  if (!data || !width || !height) return null;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 1) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) return null;
  const pixelWidth = maximumX - minimumX + 1;
  const pixelHeight = maximumY - minimumY + 1;
  const round = (value) => Math.round(value * 10000) / 10000;
  return {
    x: minimumX,
    y: minimumY,
    width: pixelWidth,
    height: pixelHeight,
    x_pct: round(minimumX / width * 100),
    y_pct: round(minimumY / height * 100),
    width_pct: round(pixelWidth / width * 100),
    height_pct: round(pixelHeight / height * 100),
  };
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The interaction mask could not be encoded.")), type));
}

async function decodeImage(blob) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch { try { return await createImageBitmap(blob); } catch {} }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("This browser could not decode the Blackboard state scan."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchAdminMedia(mediaId, signal) {
  const response = await fetch(`/api/admin/media/${encodeURIComponent(mediaId)}/file`, {
    headers: { authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Blackboard state media unavailable (${response.status}).`);
  return response.blob();
}

class MapperHistory {
  constructor(initial) {
    this.current = clone(initial);
    this.past = [];
    this.future = [];
  }

  commit(next, previous = this.current) {
    if (JSON.stringify(next) === JSON.stringify(previous)) return this.current;
    this.past.push(clone(previous));
    this.past = this.past.slice(-50);
    this.current = clone(next);
    this.future = [];
    return this.current;
  }

  undo() {
    if (!this.past.length) return this.current;
    this.future.push(clone(this.current));
    this.current = this.past.pop();
    return this.current;
  }

  redo() {
    if (!this.future.length) return this.current;
    this.past.push(clone(this.current));
    this.current = this.future.pop();
    return this.current;
  }
}

function stateMediaId(state) {
  return state?.derivative_media_id || state?.derivativeMediaId || state?.scan?.id || "";
}

function mappingForState(mappings, stateId) {
  return (mappings || []).find((mapping) => (mapping.state_id || mapping.stateId) === stateId) || null;
}

function mappingRecipe(mapping) {
  return mapping?.hotspot_recipe || mapping?.hotspotRecipe || mapping?.hotspot_recipe_json || mapping?.hotspotRecipeJson || {};
}

function mappingMaskId(mapping) {
  return mapping?.hotspot_mask_media_id || mapping?.hotspotMaskMediaId || mapping?.hotspot_mask?.id || mapping?.hotspotMask?.id || "";
}

function boundsForMapping(mapping) {
  const value = (snake, camel, short) => number(mapping?.[snake] ?? mapping?.[camel] ?? mapping?.[short], NaN);
  const bounds = {
    x_pct: value("x_percent", "xPercent", "x_pct"),
    y_pct: value("y_percent", "yPercent", "y_pct"),
    width_pct: value("width_percent", "widthPercent", "width_pct"),
    height_pct: value("height_percent", "heightPercent", "height_pct"),
  };
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

function mapperMarkup(states, activeStateId) {
  return `<section class="bbfm" data-bbfm>
    <header class="bbfm-head"><div><span class="cm-section-index">Painted interaction mask</span><h4>Map the fragment to a board state</h4><p>Paint the exact area represented by the fragment. The saved mask can follow an irregular outline; its percentage bounds are calculated automatically.</p></div><div class="bbfm-state-controls"><label>Board state<select data-bbfm-state>${states.map((state) => `<option value="${escapeHtml(state.id)}" ${state.id === activeStateId ? "selected" : ""}>${escapeHtml(state.catalogue_label || state.catalogueLabel || state.title)} · ${escapeHtml(state.date_label || state.dateLabel || "Undated")}</option>`).join("")}</select></label><div class="bbfm-copy"><select aria-label="Copy painted area to another state" data-bbfm-copy-target>${states.filter((state) => state.id !== activeStateId).map((state) => `<option value="${escapeHtml(state.id)}">${escapeHtml(state.catalogue_label || state.catalogueLabel || state.title)}</option>`).join("")}</select><button class="button" type="button" data-bbfm-copy ${states.length < 2 ? "disabled" : ""}>Copy editable start</button></div></div></header>
    <div class="bbfm-toolbar" role="toolbar" aria-label="State mask tools"><button class="button" type="button" data-bbfm-tool="pan" aria-pressed="false">Pan</button><button class="button is-active" type="button" data-bbfm-tool="paint" aria-pressed="true">Paint area</button><button class="button" type="button" data-bbfm-tool="erase" aria-pressed="false">Erase area</button><label>Brush size <output data-bbfm-brush-output>5%</output><input type="range" min="0.5" max="30" step="0.5" value="4.5" data-bbfm-brush></label><label>View zoom <output data-bbfm-zoom-output>100%</output><input type="range" min="100" max="500" step="1" value="100" data-bbfm-zoom></label><button class="button" type="button" data-bbfm-action="undo">Undo</button><button class="button" type="button" data-bbfm-action="redo">Redo</button><button class="button" type="button" data-bbfm-action="clear">Clear state</button></div>
    <div class="bbfm-stage" data-bbfm-stage data-tool="paint"><canvas data-bbfm-canvas tabindex="0" aria-label="Paint the fragment area on the full-board scan"></canvas><span class="bbfm-cursor" data-bbfm-cursor hidden aria-hidden="true"></span></div>
    <footer class="bbfm-footer"><p data-bbfm-status role="status" aria-live="polite">Loading newest Blackboard state…</p><button class="button" type="button" data-bbfm-save disabled>Save this state mask</button></footer>
  </section>`;
}

export async function mountBlackboardFragmentMapper(container, options = {}) {
  if (!container) throw new Error("A fragment mapper mount is required.");
  const states = (options.states || []).filter((state) => state?.id && stateMediaId(state));
  if (!states.length) {
    container.innerHTML = '<p class="cm-notice">Attach a full-board scan to at least one state before painting a mapping.</p>';
    return { isDirty: () => false, destroy() {} };
  }
  const newest = [...states].sort((left, right) => number(left.state_order ?? left.sort_order) - number(right.state_order ?? right.sort_order)).at(-1);
  let activeStateId = states.some((state) => state.id === options.initialStateId) ? options.initialStateId : newest.id;
  container.innerHTML = mapperMarkup(states, activeStateId);
  const shell = container.querySelector("[data-bbfm]");
  const stage = shell.querySelector("[data-bbfm-stage]");
  const canvas = shell.querySelector("[data-bbfm-canvas]");
  const status = shell.querySelector("[data-bbfm-status]");
  const saveButton = shell.querySelector("[data-bbfm-save]");
  const abortController = new AbortController();
  const sessions = new Map();
  let tool = "paint";
  let viewZoom = 1;
  let viewPan = { x: 0, y: 0 };
  let activeGesture = null;
  let renderFrame = 0;
  let resizeObserver = null;
  let destroyed = false;

  for (const state of states) {
    const mapping = mappingForState(options.mappings, state.id);
    const rawRecipe = mappingRecipe(mapping);
    const recipe = normalizeFragmentMappingRecipe(rawRecipe);
    if (!recipe.strokes.length && !recipe.base_mask_media_id) recipe.base_mask_media_id = mappingMaskId(mapping) || null;
    if (recipe.base_mask_media_id && !recipe.base_bounds) recipe.base_bounds = boundsForMapping(mapping);
    sessions.set(state.id, {
      state,
      mapping,
      history: new MapperHistory(recipe),
      saved: JSON.stringify(recipe),
      source: null,
      baseMask: null,
      previewMask: null,
      loading: null,
    });
  }

  const session = () => sessions.get(activeStateId);
  const setStatus = (message) => { status.textContent = message; };
  const isDirty = () => [...sessions.values()].some((entry) => JSON.stringify(entry.history.current) !== entry.saved);

  async function loadEntry(entry) {
    if (entry.source) return entry;
    if (entry.loading) return entry.loading;
    entry.loading = (async () => {
      const load = options.loadMedia || fetchAdminMedia;
      const sourceBlob = await load(stateMediaId(entry.state), abortController.signal);
      entry.source = await decodeImage(sourceBlob);
      if (entry.history.current.base_mask_media_id) {
        try {
          const maskBlob = await load(entry.history.current.base_mask_media_id, abortController.signal);
          entry.baseMask = await decodeImage(maskBlob);
        } catch {
          entry.history.current.base_mask_media_id = null;
          setStatus("The prior mask could not be loaded; paint a new area for this state.");
        }
      }
      entry.loading = null;
      return entry;
    })();
    return entry.loading;
  }

  function stageMetrics() {
    const rect = stage.getBoundingClientRect();
    return { width: Math.max(280, rect.width || 900), height: Math.max(300, rect.height || 620), dpr: Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)) };
  }

  function sizeCanvas() {
    const metrics = stageMetrics();
    const width = Math.round(metrics.width * metrics.dpr);
    const height = Math.round(metrics.height * metrics.dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${metrics.width}px`;
      canvas.style.height = `${metrics.height}px`;
    }
    return metrics;
  }

  function sourceDimensions(entry) {
    return { width: Math.max(1, entry.source?.width || entry.source?.naturalWidth || 1), height: Math.max(1, entry.source?.height || entry.source?.naturalHeight || 1) };
  }

  function fittedRect(entry, metrics) {
    const source = sourceDimensions(entry);
    const scale = Math.min(metrics.width / source.width, metrics.height / source.height) * viewZoom;
    const width = source.width * scale;
    const height = source.height * scale;
    return { x: (metrics.width - width) / 2 + viewPan.x, y: (metrics.height - height) / 2 + viewPan.y, width, height };
  }

  function rebuildPreviewMask(entry) {
    const source = sourceDimensions(entry);
    const scale = Math.min(1, 1400 / Math.max(source.width, source.height));
    const mask = document.createElement("canvas");
    mask.width = Math.max(1, Math.round(source.width * scale));
    mask.height = Math.max(1, Math.round(source.height * scale));
    entry.previewMask = drawRecipeMask(mask, entry.history.current, entry.baseMask);
  }

  function syncControls() {
    const entry = session();
    shell.querySelector("[data-bbfm-state]").value = activeStateId;
    shell.querySelector("[data-bbfm-copy-target]").innerHTML = states.filter((state) => state.id !== activeStateId).map((state) => `<option value="${escapeHtml(state.id)}">${escapeHtml(state.catalogue_label || state.catalogueLabel || state.title)}</option>`).join("");
    for (const button of shell.querySelectorAll("[data-bbfm-tool]")) {
      const active = button.dataset.bbfmTool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    shell.querySelector('[data-bbfm-action="undo"]').disabled = !entry.history.past.length;
    shell.querySelector('[data-bbfm-action="redo"]').disabled = !entry.history.future.length;
    shell.querySelector("[data-bbfm-brush]").value = String(entry.history.current.brush.size * 100);
    shell.querySelector("[data-bbfm-brush-output]").textContent = `${Math.round(entry.history.current.brush.size * 100)}%`;
    shell.querySelector("[data-bbfm-zoom-output]").textContent = `${Math.round(viewZoom * 100)}%`;
    stage.dataset.tool = tool;
    saveButton.disabled = !entry.source;
  }

  function render() {
    renderFrame = 0;
    const entry = session();
    if (!entry?.source || destroyed) return;
    const metrics = sizeCanvas();
    if (!entry.previewMask) rebuildPreviewMask(entry);
    const context = canvas.getContext("2d", { alpha: false });
    context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
    context.fillStyle = "#0e0e0e";
    context.fillRect(0, 0, metrics.width, metrics.height);
    const rect = fittedRect(entry, metrics);
    context.drawImage(entry.source, rect.x, rect.y, rect.width, rect.height);
    const tint = document.createElement("canvas");
    tint.width = entry.previewMask.width;
    tint.height = entry.previewMask.height;
    const tintContext = tint.getContext("2d", { alpha: true });
    tintContext.drawImage(entry.previewMask, 0, 0);
    tintContext.globalCompositeOperation = "source-in";
    tintContext.fillStyle = "rgba(252,184,103,.58)";
    tintContext.fillRect(0, 0, tint.width, tint.height);
    context.drawImage(tint, rect.x, rect.y, rect.width, rect.height);
    canvas._bbfmRect = rect;
    syncControls();
  }

  function queueRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(render);
  }

  async function switchState(stateId) {
    if (!sessions.has(stateId)) return;
    activeStateId = stateId;
    viewZoom = 1;
    viewPan = { x: 0, y: 0 };
    shell.querySelector("[data-bbfm-zoom]").value = "100";
    setStatus("Loading Blackboard state scan…");
    try {
      await loadEntry(session());
      setStatus("Paint the fragment area. Pan and zoom do not change the saved mask.");
      queueRender();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function normalizedSourcePoint(point) {
    const rect = canvas._bbfmRect;
    if (!rect || point.x < rect.x || point.y < rect.y || point.x > rect.x + rect.width || point.y > rect.y + rect.height) return null;
    return { x: clamp((point.x - rect.x) / rect.width), y: clamp((point.y - rect.y) / rect.height) };
  }

  function beginGesture(event) {
    if (event.button !== 0 || !session()?.source) return;
    const point = canvasPoint(event);
    canvas.setPointerCapture?.(event.pointerId);
    if (tool === "pan") activeGesture = { type: "pan", pointerId: event.pointerId, start: point, pan: { ...viewPan } };
    else {
      const normalized = normalizedSourcePoint(point);
      if (!normalized) return;
      const previous = clone(session().history.current);
      const stroke = normalizeStroke({ tool, size: previous.brush.size, points: [normalized] });
      activeGesture = { type: "stroke", pointerId: event.pointerId, previous, stroke };
      session().history.current = { ...previous, strokes: [...previous.strokes, stroke] };
      session().previewMask = null;
    }
    event.preventDefault();
    queueRender();
  }

  function moveGesture(event) {
    const point = canvasPoint(event);
    const cursor = shell.querySelector("[data-bbfm-cursor]");
    if (["paint", "erase"].includes(tool) && session()?.source) {
      const normalized = normalizedSourcePoint(point);
      cursor.hidden = !normalized;
      if (normalized) {
        const size = session().history.current.brush.size * Math.min(canvas._bbfmRect.width, canvas._bbfmRect.height);
        cursor.style.width = `${size}px`;
        cursor.style.height = `${size}px`;
        cursor.style.left = `${point.x - size / 2}px`;
        cursor.style.top = `${point.y - size / 2}px`;
      }
    } else cursor.hidden = true;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    if (activeGesture.type === "pan") viewPan = { x: activeGesture.pan.x + point.x - activeGesture.start.x, y: activeGesture.pan.y + point.y - activeGesture.start.y };
    else {
      const normalized = normalizedSourcePoint(point);
      if (normalized) {
        const points = activeGesture.stroke.points;
        const previous = points.at(-1);
        if (!previous || Math.hypot(normalized.x - previous.x, normalized.y - previous.y) > Math.max(0.0015, activeGesture.stroke.size / 10)) points.push(normalized);
        session().previewMask = null;
      }
    }
    event.preventDefault();
    queueRender();
  }

  function endGesture(event) {
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    if (activeGesture.type === "stroke") session().history.commit(session().history.current, activeGesture.previous);
    canvas.releasePointerCapture?.(event.pointerId);
    activeGesture = null;
    queueRender();
  }

  async function generateMaskRevision(entry) {
    const source = sourceDimensions(entry);
    const scale = Math.min(1, FRAGMENT_MAPPER_MAX_MASK / Math.max(source.width, source.height));
    const full = document.createElement("canvas");
    full.width = Math.max(1, Math.round(source.width * scale));
    full.height = Math.max(1, Math.round(source.height * scale));
    drawRecipeMask(full, entry.history.current, entry.baseMask);
    const context = full.getContext("2d", { alpha: true, willReadFrequently: true });
    const bounds = fragmentMaskBounds(context.getImageData(0, 0, full.width, full.height), full.width, full.height);
    const recipe = normalizeFragmentMappingRecipe(entry.history.current);
    recipe.source_width = source.width;
    recipe.source_height = source.height;
    if (!bounds) return { stateId: entry.state.id, clear: true, recipe, recipeJson: serializeFragmentMappingRecipe(recipe) };
    const cropped = document.createElement("canvas");
    cropped.width = bounds.width;
    cropped.height = bounds.height;
    cropped.getContext("2d", { alpha: true }).drawImage(full, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    const blob = await canvasBlob(cropped, "image/png");
    const label = String(entry.state.catalogue_label || entry.state.catalogueLabel || entry.state.id).replace(/[^a-zA-Z0-9._-]/g, "-");
    return {
      stateId: entry.state.id,
      clear: false,
      bounds,
      recipe,
      recipeJson: serializeFragmentMappingRecipe(recipe),
      maskFile: new File([blob], `fragment-hotspot-${label}.png`, { type: "image/png", lastModified: Date.now() }),
    };
  }

  shell.addEventListener("click", async (event) => {
    const toolButton = event.target.closest("[data-bbfm-tool]");
    if (toolButton) { tool = toolButton.dataset.bbfmTool; queueRender(); return; }
    const action = event.target.closest("[data-bbfm-action]")?.dataset.bbfmAction;
    if (action === "undo") { session().history.undo(); session().previewMask = null; queueRender(); return; }
    if (action === "redo") { session().history.redo(); session().previewMask = null; queueRender(); return; }
    if (action === "clear") {
      const previous = clone(session().history.current);
      const cleared = normalizeFragmentMappingRecipe({ brush: previous.brush });
      session().baseMask = null;
      session().history.commit(cleared, previous);
      session().previewMask = null;
      setStatus("State mapping cleared. Save to remove it from this state.");
      queueRender();
      return;
    }
    if (event.target.closest("[data-bbfm-copy]")) {
      const targetId = shell.querySelector("[data-bbfm-copy-target]").value;
      if (!targetId || !sessions.has(targetId)) return;
      const sourceRecipe = clone(session().history.current);
      sourceRecipe.copied_from_state_id = activeStateId;
      const target = sessions.get(targetId);
      target.baseMask = session().baseMask;
      target.history.commit(normalizeFragmentMappingRecipe(sourceRecipe), target.history.current);
      target.previewMask = null;
      setStatus("Copied as an editable starting mask. Adjust it for the selected state, then save.");
      await switchState(targetId);
      return;
    }
    if (event.target.closest("[data-bbfm-save]")) {
      saveButton.disabled = true;
      setStatus("Generating cropped PNG interaction mask and percentage bounds…");
      try {
        const revision = await generateMaskRevision(session());
        await options.onSave?.(revision);
        session().saved = JSON.stringify(session().history.current);
        setStatus(revision.clear ? "This state mapping was removed." : "Painted state mapping saved.");
      } catch (error) {
        setStatus(error.message);
      } finally {
        saveButton.disabled = false;
      }
    }
  });

  shell.addEventListener("change", async (event) => {
    if (event.target.matches("[data-bbfm-state]")) await switchState(event.target.value);
  });

  shell.addEventListener("input", (event) => {
    if (event.target.matches("[data-bbfm-brush]")) {
      const entry = session();
      const previous = clone(entry.history.current);
      const next = clone(previous);
      next.brush.size = number(event.target.value, 4.5) / 100;
      entry.history.commit(normalizeFragmentMappingRecipe(next), previous);
      queueRender();
    } else if (event.target.matches("[data-bbfm-zoom]")) {
      viewZoom = number(event.target.value, 100) / 100;
      queueRender();
    }
  });

  canvas.addEventListener("pointerdown", beginGesture);
  canvas.addEventListener("pointermove", moveGesture);
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("pointerleave", () => { if (!activeGesture) shell.querySelector("[data-bbfm-cursor]").hidden = true; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    viewZoom = clamp(viewZoom * (event.deltaY < 0 ? 1.1 : 0.9), 1, 5);
    shell.querySelector("[data-bbfm-zoom]").value = String(Math.round(viewZoom * 100));
    queueRender();
  }, { passive: false });

  const beforeUnload = (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  globalThis.addEventListener?.("beforeunload", beforeUnload);
  resizeObserver = new ResizeObserver(queueRender);
  resizeObserver.observe(stage);
  await switchState(activeStateId);

  return {
    isDirty,
    activeStateId: () => activeStateId,
    destroy() {
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      globalThis.removeEventListener?.("beforeunload", beforeUnload);
      for (const entry of sessions.values()) {
        entry.source?.close?.();
        entry.baseMask?.close?.();
      }
    },
  };
}

export const __blackboardFragmentMapperTest = {
  normalizeFragmentMappingRecipe,
  serializeFragmentMappingRecipe,
  interpolateFragmentMappingStroke,
  fragmentMaskBounds,
};
