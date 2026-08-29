const TOKEN_KEY = "swc_submissions_admin_token";
export const FRAGMENT_EDITOR_SCHEMA_VERSION = 1;
export const FRAGMENT_EDITOR_MAX_OUTPUT = 2400;
export const FRAGMENT_EDITOR_HISTORY_LIMIT = 40;

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function sourceSize(source = {}) {
  return {
    width: Math.max(1, number(source.width ?? source.naturalWidth, 1)),
    height: Math.max(1, number(source.height ?? source.naturalHeight, 1)),
  };
}

function fittedSquareCrop(source) {
  const { width, height } = sourceSize(source);
  const side = Math.min(width, height);
  return {
    mode: "square",
    x: (width - side) / 2 / width,
    y: (height - side) / 2 / height,
    width: side / width,
    height: side / height,
  };
}

export function normalizeFragmentCrop(input = {}, source = {}) {
  const dimensions = sourceSize(source);
  const mode = input.mode === "square" ? "square" : input.mode === "free" ? "free" : "none";
  if (mode === "none") return { mode: "none", x: 0, y: 0, width: 1, height: 1 };
  let width = clamp(number(input.width, 1), 0.01, 1);
  let height = clamp(number(input.height, 1), 0.01, 1);
  let x = clamp(number(input.x, 0), 0, 1 - width);
  let y = clamp(number(input.y, 0), 0, 1 - height);

  if (mode === "square") {
    const defaultCrop = fittedSquareCrop(dimensions);
    if (!input.width || !input.height) return defaultCrop;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const side = Math.max(1, Math.min(width * dimensions.width, height * dimensions.height));
    width = side / dimensions.width;
    height = side / dimensions.height;
    x = clamp(centerX - width / 2, 0, 1 - width);
    y = clamp(centerY - height / 2, 0, 1 - height);
  }

  return { mode, x, y, width, height };
}

export function moveFragmentCrop(crop, deltaX, deltaY, source = {}) {
  const normalized = normalizeFragmentCrop(crop, source);
  if (normalized.mode === "none") return normalized;
  return normalizeFragmentCrop({
    ...normalized,
    x: clamp(normalized.x + number(deltaX, 0), 0, 1 - normalized.width),
    y: clamp(normalized.y + number(deltaY, 0), 0, 1 - normalized.height),
  }, source);
}

export function zoomFragmentCrop(crop, factor, source = {}) {
  const normalized = normalizeFragmentCrop(crop, source);
  if (normalized.mode === "none") return normalized;
  const safeFactor = clamp(number(factor, 1), 0.125, 8);
  const centerX = normalized.x + normalized.width / 2;
  const centerY = normalized.y + normalized.height / 2;
  return normalizeFragmentCrop({
    ...normalized,
    width: clamp(normalized.width / safeFactor, 0.01, 1),
    height: clamp(normalized.height / safeFactor, 0.01, 1),
    x: centerX - normalized.width / safeFactor / 2,
    y: centerY - normalized.height / safeFactor / 2,
  }, source);
}

export function fragmentOutputSize(crop, source = {}, maximum = FRAGMENT_EDITOR_MAX_OUTPUT) {
  const dimensions = sourceSize(source);
  const normalized = normalizeFragmentCrop(crop, dimensions);
  const croppedWidth = Math.max(1, normalized.width * dimensions.width);
  const croppedHeight = Math.max(1, normalized.height * dimensions.height);
  const scale = Math.min(1, Math.max(1, number(maximum, FRAGMENT_EDITOR_MAX_OUTPUT)) / Math.max(croppedWidth, croppedHeight));
  return {
    width: Math.max(1, Math.round(croppedWidth * scale)),
    height: Math.max(1, Math.round(croppedHeight * scale)),
  };
}

function normalizePoint(point = {}) {
  return {
    x: clamp(point.x),
    y: clamp(point.y),
    pressure: clamp(number(point.pressure, 1), 0.05, 1),
  };
}

function normalizeStroke(stroke = {}) {
  return {
    id: String(stroke.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    tool: stroke.tool === "restore" ? "restore" : "erase",
    size: clamp(number(stroke.size, 0.08), 0.005, 0.5),
    softness: clamp(number(stroke.softness, 0.7)),
    opacity: clamp(number(stroke.opacity, 1), 0.05, 1),
    points: Array.isArray(stroke.points) ? stroke.points.slice(0, 12000).map(normalizePoint) : [],
  };
}

export function normalizeFragmentRecipe(input = {}, source = {}) {
  let supplied = input;
  if (typeof supplied === "string") {
    try { supplied = JSON.parse(supplied); } catch { supplied = {}; }
  }
  const brush = supplied.brush || {};
  return {
    schema_version: FRAGMENT_EDITOR_SCHEMA_VERSION,
    crop: normalizeFragmentCrop(supplied.crop || {}, source),
    brush: {
      size: clamp(number(brush.size ?? supplied.brush_size, 0.08), 0.005, 0.5),
      softness: clamp(number(brush.softness ?? supplied.brush_softness, 0.7)),
      opacity: clamp(number(brush.opacity ?? supplied.brush_opacity, 1), 0.05, 1),
    },
    strokes: Array.isArray(supplied.strokes) ? supplied.strokes.slice(0, 1000).map(normalizeStroke) : [],
    output: {
      background: "transparent",
      preferred_mime: "image/webp",
      fallback_mime: "image/png",
      max_dimension: FRAGMENT_EDITOR_MAX_OUTPUT,
    },
  };
}

export function serializeFragmentRecipe(recipe, source = {}) {
  return JSON.stringify(normalizeFragmentRecipe(recipe, source));
}

export function interpolateFragmentStroke(points, spacing) {
  const source = (points || []).map(normalizePoint);
  if (source.length < 2) return source;
  const step = Math.max(0.0005, number(spacing, 0.01));
  const output = [source[0]];
  for (let index = 1; index < source.length; index += 1) {
    const from = source[index - 1];
    const to = source[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let part = 1; part <= count; part += 1) {
      const progress = part / count;
      output.push({
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        pressure: from.pressure + (to.pressure - from.pressure) * progress,
      });
    }
  }
  return output;
}

export class FragmentRecipeHistory {
  constructor(initial, limit = FRAGMENT_EDITOR_HISTORY_LIMIT) {
    this.initial = clone(initial);
    this.current = clone(initial);
    this.past = [];
    this.future = [];
    this.limit = Math.max(1, number(limit, FRAGMENT_EDITOR_HISTORY_LIMIT));
  }

  commit(next, previous = this.current) {
    const before = clone(previous);
    const after = clone(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return this.current;
    this.past.push(before);
    this.past = this.past.slice(-this.limit);
    this.current = after;
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

  reset() {
    return this.commit(this.initial);
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

async function decodeImage(blob, signal) {
  if (signal?.aborted) throw new DOMException("Loading cancelled.", "AbortError");
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch { try { return await createImageBitmap(blob); } catch {} }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("This browser could not decode the fragment editing source."));
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
  if (!response.ok) throw new Error(`Editing source unavailable (${response.status}).`);
  return response.blob();
}

function stampMask(context, stroke, width, height) {
  if (!stroke.points.length) return;
  const minimum = Math.max(1, Math.min(width, height));
  const radius = Math.max(1, stroke.size * minimum / 2);
  const hardness = 1 - stroke.softness;
  const points = interpolateFragmentStroke(stroke.points, Math.max(0.0005, stroke.size / 8));
  context.save();
  context.globalCompositeOperation = stroke.tool === "restore" ? "source-over" : "destination-out";
  for (const point of points) {
    const pointRadius = Math.max(1, radius * point.pressure);
    const inner = Math.max(0, pointRadius * hardness);
    const gradient = context.createRadialGradient(point.x * width, point.y * height, inner, point.x * width, point.y * height, pointRadius);
    const alpha = clamp(stroke.opacity * point.pressure, 0.05, 1);
    if (stroke.tool === "restore") {
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(inner === pointRadius ? 1 : Math.max(0.001, hardness), `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
      gradient.addColorStop(inner === pointRadius ? 1 : Math.max(0.001, hardness), `rgba(0,0,0,${alpha})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x * width, point.y * height, pointRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawMask(maskCanvas, recipe) {
  const context = maskCanvas.getContext("2d", { alpha: true });
  context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  for (const stroke of recipe.strokes) stampMask(context, stroke, maskCanvas.width, maskCanvas.height);
  return maskCanvas;
}

function drawEditedOutput(canvas, source, recipe, includeMask = true) {
  const dimensions = sourceSize(source);
  const crop = normalizeFragmentCrop(recipe.crop, dimensions);
  const context = canvas.getContext("2d", { alpha: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    crop.x * dimensions.width,
    crop.y * dimensions.height,
    crop.width * dimensions.width,
    crop.height * dimensions.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if (includeMask && recipe.strokes.length) {
    const mask = document.createElement("canvas");
    mask.width = canvas.width;
    mask.height = canvas.height;
    drawMask(mask, recipe);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = "source-over";
  }
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodeEditedOutput(canvas) {
  const webp = await canvasBlob(canvas, "image/webp", 0.9);
  if (webp?.type === "image/webp") return { blob: webp, mimeType: "image/webp", extension: "webp" };
  const png = await canvasBlob(canvas, "image/png");
  if (!png) throw new Error("The edited fragment could not be encoded.");
  return { blob: png, mimeType: "image/png", extension: "png" };
}

function ensureAmbientField() {
  if (globalThis.ConstructAmbientField) return Promise.resolve(globalThis.ConstructAmbientField);
  if (!globalThis.document) return Promise.resolve(null);
  const existing = document.querySelector('script[src*="construct-ambient-field.js"]');
  if (existing) return new Promise((resolve) => {
    if (globalThis.ConstructAmbientField) resolve(globalThis.ConstructAmbientField);
    else existing.addEventListener("load", () => resolve(globalThis.ConstructAmbientField), { once: true });
  });
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "/js/construct-ambient-field.js";
    script.onload = () => resolve(globalThis.ConstructAmbientField || null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
}

function editorMarkup(title) {
  return `<section class="bbfe" data-bbfe>
    <header class="bbfe-head"><div><span class="cm-section-index">Non-destructive image editor</span><h3>${escapeHtml(title || "Fragment image")}</h3><p>Crop first, then softly erase or restore the fragment edge. The private original is never changed.</p></div><div class="bbfe-history" role="toolbar" aria-label="Edit history"><button class="button" type="button" data-bbfe-action="undo">Undo</button><button class="button" type="button" data-bbfe-action="redo">Redo</button><button class="button" type="button" data-bbfe-action="reset">Reset</button><button class="button" type="button" data-bbfe-action="before" aria-pressed="false">Before</button></div></header>
    <div class="bbfe-body">
      <aside class="bbfe-tools" aria-label="Fragment editing tools">
        <fieldset><legend>Tool</legend><div class="bbfe-tool-grid"><button class="button is-active" type="button" data-bbfe-tool="crop" aria-pressed="true">Crop</button><button class="button" type="button" data-bbfe-tool="pan" aria-pressed="false">Pan</button><button class="button" type="button" data-bbfe-tool="erase" aria-pressed="false">Soft erase</button><button class="button" type="button" data-bbfe-tool="restore" aria-pressed="false">Restore</button></div></fieldset>
        <fieldset data-bbfe-crop-controls><legend>Crop</legend><div class="bbfe-tool-grid"><button class="button is-active" type="button" data-bbfe-crop-mode="none" aria-pressed="true">No crop</button><button class="button" type="button" data-bbfe-crop-mode="square" aria-pressed="false">Square</button><button class="button" type="button" data-bbfe-crop-mode="free" aria-pressed="false">Free crop</button></div><label>Crop zoom <output data-bbfe-crop-zoom-output>100%</output><input type="range" min="100" max="800" value="100" step="1" data-bbfe-crop-zoom disabled></label><div data-bbfe-free-controls hidden><label>Crop width <output data-bbfe-crop-width-output></output><input type="range" min="5" max="100" value="100" step="1" data-bbfe-crop-width></label><label>Crop height <output data-bbfe-crop-height-output></output><input type="range" min="5" max="100" value="100" step="1" data-bbfe-crop-height></label></div><p>No crop keeps the full image. Square makes an equal-sided output; Free crop makes a regular rectangle.</p></fieldset>
        <fieldset data-bbfe-view-controls><legend>View</legend><label>View zoom <output data-bbfe-view-zoom-output>100%</output><input type="range" min="100" max="500" value="100" step="1" data-bbfe-view-zoom></label><button class="button" type="button" data-bbfe-action="fit">Fit image</button></fieldset>
        <fieldset data-bbfe-brush-controls hidden><legend>Brush</legend><label>Size <output data-bbfe-brush-size-output></output><input type="range" min="1" max="50" value="8" step="0.5" data-bbfe-brush-size></label><label>Edge softness <output data-bbfe-brush-softness-output></output><input type="range" min="0" max="100" value="70" step="1" data-bbfe-brush-softness></label><label>Strength <output data-bbfe-brush-opacity-output></output><input type="range" min="5" max="100" value="100" step="1" data-bbfe-brush-opacity></label></fieldset>
      </aside>
      <div class="bbfe-workspace"><div class="bbfe-stage" data-bbfe-stage data-tool="crop"><canvas class="bbfe-eyes" data-bbfe-eyes aria-hidden="true"></canvas><canvas class="bbfe-canvas" data-bbfe-canvas tabindex="0" aria-label="Blackboard fragment editor"></canvas><span class="bbfe-brush-cursor" data-bbfe-brush-cursor hidden aria-hidden="true"></span></div><p class="bbfe-status" data-bbfe-status role="status" aria-live="polite">Loading editing source…</p></div>
    </div>
    <footer class="bbfe-save"><div><strong>Save a new edit revision</strong><p>Creates a transparent display image, alpha mask, and replayable edit recipe. Your source upload stays unchanged.</p></div><button class="button" type="button" data-bbfe-save disabled>Save edit revision</button></footer>
  </section>`;
}

export async function mountBlackboardFragmentEditor(container, options = {}) {
  if (!container) throw new Error("A fragment editor mount is required.");
  container.innerHTML = editorMarkup(options.title);
  const shell = container.querySelector("[data-bbfe]");
  const stage = shell.querySelector("[data-bbfe-stage]");
  const canvas = shell.querySelector("[data-bbfe-canvas]");
  const eyes = shell.querySelector("[data-bbfe-eyes]");
  const status = shell.querySelector("[data-bbfe-status]");
  const saveButton = shell.querySelector("[data-bbfe-save]");
  const abortController = new AbortController();
  let destroyed = false;
  let source = null;
  let history = null;
  let previewRecipe = null;
  let tool = "crop";
  let showBefore = false;
  let activeGesture = null;
  let cropZoom = 100;
  let viewZoom = 1;
  let viewPan = { x: 0, y: 0 };
  let resizeObserver = null;
  let ambientCleanup = null;
  let renderFrame = 0;
  let savedFingerprint = "";

  const recipe = () => previewRecipe || history?.current;
  const dimensions = () => sourceSize(source);
  const setStatus = (message) => { status.textContent = message; };

  function syncControls() {
    if (!history) return;
    const current = recipe();
    shell.querySelector('[data-bbfe-action="undo"]').disabled = !history.canUndo;
    shell.querySelector('[data-bbfe-action="redo"]').disabled = !history.canRedo;
    shell.querySelector('[data-bbfe-action="before"]').setAttribute("aria-pressed", String(showBefore));
    for (const button of shell.querySelectorAll("[data-bbfe-tool]")) {
      const active = button.dataset.bbfeTool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of shell.querySelectorAll("[data-bbfe-crop-mode]")) {
      const active = button.dataset.bbfeCropMode === current.crop.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    shell.querySelector("[data-bbfe-free-controls]").hidden = current.crop.mode !== "free";
    shell.querySelector("[data-bbfe-crop-zoom]").disabled = current.crop.mode === "none";
    shell.querySelector("[data-bbfe-brush-controls]").hidden = !["erase", "restore"].includes(tool);
    shell.querySelector("[data-bbfe-crop-controls]").hidden = tool !== "crop";
    shell.querySelector("[data-bbfe-view-controls]").hidden = tool === "crop";
    shell.querySelector("[data-bbfe-brush-size]").value = String(current.brush.size * 100);
    shell.querySelector("[data-bbfe-brush-softness]").value = String(current.brush.softness * 100);
    shell.querySelector("[data-bbfe-brush-opacity]").value = String(current.brush.opacity * 100);
    shell.querySelector("[data-bbfe-brush-size-output]").textContent = `${Math.round(current.brush.size * 100)}%`;
    shell.querySelector("[data-bbfe-brush-softness-output]").textContent = `${Math.round(current.brush.softness * 100)}%`;
    shell.querySelector("[data-bbfe-brush-opacity-output]").textContent = `${Math.round(current.brush.opacity * 100)}%`;
    shell.querySelector("[data-bbfe-crop-width]").value = String(current.crop.width * 100);
    shell.querySelector("[data-bbfe-crop-height]").value = String(current.crop.height * 100);
    shell.querySelector("[data-bbfe-crop-width-output]").textContent = `${Math.round(current.crop.width * 100)}%`;
    shell.querySelector("[data-bbfe-crop-height-output]").textContent = `${Math.round(current.crop.height * 100)}%`;
    shell.querySelector("[data-bbfe-view-zoom-output]").textContent = `${Math.round(viewZoom * 100)}%`;
    shell.querySelector("[data-bbfe-crop-zoom-output]").textContent = `${Math.round(cropZoom)}%`;
    stage.dataset.tool = tool;
  }

  function stageMetrics() {
    const rect = stage.getBoundingClientRect();
    return { width: Math.max(280, rect.width || 640), height: Math.max(280, rect.height || rect.width || 640) };
  }

  function sizeCanvas() {
    const metrics = stageMetrics();
    const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(metrics.width * dpr));
    const height = Math.max(1, Math.round(metrics.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${metrics.width}px`;
      canvas.style.height = `${metrics.height}px`;
    }
    return { ...metrics, dpr };
  }

  function fittedRect(contentWidth, contentHeight, metrics, zoom = 1, pan = viewPan) {
    const scale = Math.min(metrics.width / contentWidth, metrics.height / contentHeight) * zoom;
    const width = contentWidth * scale;
    const height = contentHeight * scale;
    return { x: (metrics.width - width) / 2 + pan.x, y: (metrics.height - height) / 2 + pan.y, width, height, scale };
  }

  function drawCropMode(context, metrics, current) {
    const size = dimensions();
    const imageRect = fittedRect(size.width, size.height, metrics, 1, { x: 0, y: 0 });
    context.drawImage(source, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    const cropRect = {
      x: imageRect.x + current.crop.x * imageRect.width,
      y: imageRect.y + current.crop.y * imageRect.height,
      width: current.crop.width * imageRect.width,
      height: current.crop.height * imageRect.height,
    };
    context.save();
    if (current.crop.mode !== "none") {
      context.fillStyle = "rgba(14,14,14,.66)";
      context.beginPath();
      context.rect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
      context.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      context.fill("evenodd");
    }
    context.strokeStyle = "#FCB867";
    context.lineWidth = 5;
    context.setLineDash([14, 10]);
    context.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    context.setLineDash([]);
    context.fillStyle = "#FCB867";
    context.font = "800 12px Inter,Arial,sans-serif";
    context.fillText(current.crop.mode === "none" ? "NO CROP · FULL IMAGE" : current.crop.mode === "square" ? "SQUARE CROP" : "FREE CROP", cropRect.x + 10, cropRect.y + 22);
    context.restore();
    return { imageRect, cropRect };
  }

  function editedContentRect(current, metrics) {
    const size = fragmentOutputSize(current.crop, dimensions(), 1200);
    return fittedRect(size.width, size.height, metrics, viewZoom, viewPan);
  }

  function drawEditMode(context, metrics, current) {
    const output = fragmentOutputSize(current.crop, dimensions(), Math.min(1200, Math.max(canvas.width, canvas.height)));
    const preview = document.createElement("canvas");
    preview.width = output.width;
    preview.height = output.height;
    drawEditedOutput(preview, source, current, !showBefore);
    const rect = editedContentRect(current, metrics);
    context.drawImage(preview, rect.x, rect.y, rect.width, rect.height);
    return { contentRect: rect };
  }

  function render() {
    renderFrame = 0;
    if (!source || !history || destroyed) return;
    const metrics = sizeCanvas();
    const context = canvas.getContext("2d", { alpha: true });
    context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
    context.clearRect(0, 0, metrics.width, metrics.height);
    const current = normalizeFragmentRecipe(recipe(), dimensions());
    const layout = tool === "crop" ? drawCropMode(context, metrics, current) : drawEditMode(context, metrics, current);
    canvas._bbfeLayout = layout;
    syncControls();
  }

  function queueRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(render);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerPressure(event) {
    return event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 1;
  }

  function outputPoint(point, current, pressure = 1) {
    const rect = editedContentRect(current, stageMetrics());
    if (point.x < rect.x || point.y < rect.y || point.x > rect.x + rect.width || point.y > rect.y + rect.height) return null;
    return normalizePoint({
      x: (point.x - rect.x) / rect.width,
      y: (point.y - rect.y) / rect.height,
      pressure: pressure > 0 ? pressure : 1,
    });
  }

  function beginGesture(event) {
    if (!source || event.button !== 0) return;
    const point = pointerPosition(event);
    const current = clone(history.current);
    canvas.setPointerCapture?.(event.pointerId);
    if (tool === "crop") {
      if (!canvas._bbfeLayout?.cropRect) return;
      activeGesture = { type: "crop", pointerId: event.pointerId, start: point, previous: current };
      previewRecipe = current;
    } else if (tool === "pan") {
      activeGesture = { type: "pan", pointerId: event.pointerId, start: point, pan: { ...viewPan } };
    } else if (["erase", "restore"].includes(tool)) {
      const normalized = outputPoint(point, current, pointerPressure(event));
      if (!normalized) return;
      const stroke = normalizeStroke({
        tool,
        size: current.brush.size,
        softness: current.brush.softness,
        opacity: current.brush.opacity,
        points: [normalized],
      });
      activeGesture = { type: "stroke", pointerId: event.pointerId, previous: current, stroke };
      previewRecipe = { ...current, strokes: [...current.strokes, stroke] };
    }
    event.preventDefault();
    queueRender();
  }

  function moveGesture(event) {
    const point = pointerPosition(event);
    const brushCursor = shell.querySelector("[data-bbfe-brush-cursor]");
    if (["erase", "restore"].includes(tool) && history) {
      const current = recipe();
      const normalized = outputPoint(point, current, pointerPressure(event));
      const rect = canvas.getBoundingClientRect();
      brushCursor.hidden = !normalized;
      if (normalized) {
        const size = current.brush.size * Math.min(rect.width, rect.height);
        brushCursor.style.width = `${size}px`;
        brushCursor.style.height = `${size}px`;
        brushCursor.style.left = `${point.x - size / 2}px`;
        brushCursor.style.top = `${point.y - size / 2}px`;
      }
    } else brushCursor.hidden = true;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
    if (activeGesture.type === "crop") {
      const imageRect = canvas._bbfeLayout.imageRect;
      const deltaX = (point.x - activeGesture.start.x) / imageRect.width;
      const deltaY = (point.y - activeGesture.start.y) / imageRect.height;
      previewRecipe = {
        ...activeGesture.previous,
        crop: moveFragmentCrop(activeGesture.previous.crop, deltaX, deltaY, dimensions()),
      };
    } else if (activeGesture.type === "pan") {
      viewPan = { x: activeGesture.pan.x + point.x - activeGesture.start.x, y: activeGesture.pan.y + point.y - activeGesture.start.y };
    } else if (activeGesture.type === "stroke") {
      const normalized = outputPoint(point, previewRecipe, pointerPressure(event));
      if (normalized) {
        const points = activeGesture.stroke.points;
        const last = points.at(-1);
        if (!last || Math.hypot(normalized.x - last.x, normalized.y - last.y) >= 0.002) points.push(normalized);
        previewRecipe = { ...activeGesture.previous, strokes: [...activeGesture.previous.strokes, activeGesture.stroke] };
      }
    }
    event.preventDefault();
    queueRender();
  }

  function endGesture(event) {
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
    if (["crop", "stroke"].includes(activeGesture.type) && previewRecipe) history.commit(normalizeFragmentRecipe(previewRecipe, dimensions()), activeGesture.previous);
    previewRecipe = null;
    canvas.releasePointerCapture?.(event.pointerId);
    activeGesture = null;
    queueRender();
  }

  function commitBrush(key, value) {
    const current = clone(history.current);
    current.brush[key] = value;
    history.commit(normalizeFragmentRecipe(current, dimensions()));
    queueRender();
  }

  function commitFreeCrop(key, value) {
    const current = clone(history.current);
    const center = current.crop[key === "width" ? "x" : "y"] + current.crop[key] / 2;
    current.crop.mode = "free";
    current.crop[key] = value;
    current.crop[key === "width" ? "x" : "y"] = center - value / 2;
    history.commit(normalizeFragmentRecipe(current, dimensions()));
    cropZoom = 100;
    shell.querySelector("[data-bbfe-crop-zoom]").value = "100";
    queueRender();
  }

  async function generateRevision() {
    const current = normalizeFragmentRecipe(history.current, dimensions());
    const outputSize = fragmentOutputSize(current.crop, dimensions(), FRAGMENT_EDITOR_MAX_OUTPUT);
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputSize.width;
    outputCanvas.height = outputSize.height;
    drawEditedOutput(outputCanvas, source, current, true);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = outputSize.width;
    maskCanvas.height = outputSize.height;
    drawMask(maskCanvas, current);
    const [encoded, maskBlob] = await Promise.all([encodeEditedOutput(outputCanvas), canvasBlob(maskCanvas, "image/png")]);
    if (!maskBlob) throw new Error("The fragment alpha mask could not be encoded.");
    const base = String(options.filename || options.title || "blackboard-fragment").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "-") || "blackboard-fragment";
    return {
      recipe: current,
      recipeJson: serializeFragmentRecipe(current, dimensions()),
      outputFile: new File([encoded.blob], `${base}-edited.${encoded.extension}`, { type: encoded.mimeType, lastModified: Date.now() }),
      maskFile: new File([maskBlob], `${base}-mask.png`, { type: "image/png", lastModified: Date.now() }),
      mimeType: encoded.mimeType,
      width: outputSize.width,
      height: outputSize.height,
      sourceMediaId: options.sourceMediaId || "",
    };
  }

  shell.addEventListener("click", async (event) => {
    const toolButton = event.target.closest("[data-bbfe-tool]");
    if (toolButton) { tool = toolButton.dataset.bbfeTool; queueRender(); return; }
    const modeButton = event.target.closest("[data-bbfe-crop-mode]");
    if (modeButton && history) {
      const current = clone(history.current);
      current.crop = modeButton.dataset.bbfeCropMode === "none"
        ? { mode: "none", x: 0, y: 0, width: 1, height: 1 }
        : modeButton.dataset.bbfeCropMode === "square"
          ? fittedSquareCrop(dimensions())
          : { ...(current.crop.mode === "none" ? { x: 0, y: 0, width: 1, height: 1 } : current.crop), mode: "free" };
      history.commit(normalizeFragmentRecipe(current, dimensions()));
      cropZoom = 100;
      shell.querySelector("[data-bbfe-crop-zoom]").value = "100";
      queueRender();
      return;
    }
    const action = event.target.closest("[data-bbfe-action]")?.dataset.bbfeAction;
    if (action === "undo" && history) { history.undo(); previewRecipe = null; queueRender(); return; }
    if (action === "redo" && history) { history.redo(); previewRecipe = null; queueRender(); return; }
    if (action === "reset" && history) { history.commit(normalizeFragmentRecipe({}, dimensions())); cropZoom = 100; viewZoom = 1; viewPan = { x: 0, y: 0 }; shell.querySelector("[data-bbfe-crop-zoom]").value = "100"; shell.querySelector("[data-bbfe-view-zoom]").value = "100"; queueRender(); return; }
    if (action === "before") { showBefore = !showBefore; queueRender(); return; }
    if (action === "fit") { viewZoom = 1; viewPan = { x: 0, y: 0 }; shell.querySelector("[data-bbfe-view-zoom]").value = "100"; queueRender(); return; }
    if (event.target.closest("[data-bbfe-save]") && history) {
      saveButton.disabled = true;
      setStatus("Generating transparent derivative and alpha mask…");
      try {
        const revision = await generateRevision();
        await options.onSave?.(revision);
        savedFingerprint = serializeFragmentRecipe(history.current, dimensions());
        setStatus("Edit revision saved.");
      } catch (error) {
        setStatus(error.message);
      } finally {
        saveButton.disabled = false;
      }
    }
  });

  shell.addEventListener("input", (event) => {
    if (!history) return;
    const target = event.target;
    if (target.matches("[data-bbfe-view-zoom]")) { viewZoom = number(target.value, 100) / 100; queueRender(); return; }
    if (target.matches("[data-bbfe-crop-zoom]")) {
      const next = number(target.value, 100);
      const current = clone(history.current);
      current.crop = zoomFragmentCrop(current.crop, next / cropZoom, dimensions());
      history.commit(normalizeFragmentRecipe(current, dimensions()));
      cropZoom = next;
      queueRender();
      return;
    }
    if (target.matches("[data-bbfe-crop-width]")) { commitFreeCrop("width", number(target.value, 100) / 100); return; }
    if (target.matches("[data-bbfe-crop-height]")) { commitFreeCrop("height", number(target.value, 100) / 100); return; }
    if (target.matches("[data-bbfe-brush-size]")) { commitBrush("size", number(target.value, 8) / 100); return; }
    if (target.matches("[data-bbfe-brush-softness]")) { commitBrush("softness", number(target.value, 70) / 100); return; }
    if (target.matches("[data-bbfe-brush-opacity]")) { commitBrush("opacity", number(target.value, 100) / 100); }
  });

  canvas.addEventListener("pointerdown", beginGesture);
  canvas.addEventListener("pointermove", moveGesture);
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("pointerleave", (event) => { if (!activeGesture) shell.querySelector("[data-bbfe-brush-cursor]").hidden = true; });
  canvas.addEventListener("wheel", (event) => {
    if (tool === "crop" || !history) return;
    event.preventDefault();
    viewZoom = clamp(viewZoom * (event.deltaY < 0 ? 1.1 : 0.9), 1, 5);
    shell.querySelector("[data-bbfe-view-zoom]").value = String(Math.round(viewZoom * 100));
    queueRender();
  }, { passive: false });

  const onKeyDown = (event) => {
    const target = event.target;
    if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "z" && history) {
      event.preventDefault();
      event.shiftKey ? history.redo() : history.undo();
      queueRender();
    } else if (meta && event.key.toLowerCase() === "y" && history) {
      event.preventDefault();
      history.redo();
      queueRender();
    }
  };
  globalThis.addEventListener?.("keydown", onKeyDown);
  const isDirty = () => Boolean(history && serializeFragmentRecipe(history.current, dimensions()) !== savedFingerprint);
  const onBeforeUnload = (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  globalThis.addEventListener?.("beforeunload", onBeforeUnload);

  try {
    const blob = options.sourceBlob || await (options.loadSource ? options.loadSource(options.sourceMediaId, abortController.signal) : fetchAdminMedia(options.sourceMediaId, abortController.signal));
    source = await decodeImage(blob, abortController.signal);
    const initial = normalizeFragmentRecipe(options.recipeJson || options.recipe || {}, dimensions());
    history = new FragmentRecipeHistory(initial);
    savedFingerprint = serializeFragmentRecipe(initial, dimensions());
    saveButton.disabled = false;
    setStatus("Ready. Keep No crop or choose Square/Free crop, then erase or restore the edge.");
    resizeObserver = new ResizeObserver(queueRender);
    resizeObserver.observe(stage);
    const ambient = await ensureAmbientField();
    if (!destroyed && ambient && eyes) ambientCleanup = ambient.mount({ root: stage, eyesCanvas: eyes, eyeOpacity: 0.10, eyeTint: "#6D3D15", particleCount: 0, dprCap: 1.5 });
    queueRender();
  } catch (error) {
    if (error.name !== "AbortError") setStatus(error.message);
  }

  return {
    generateRevision,
    getRecipe: () => history ? clone(history.current) : null,
    isDirty,
    destroy() {
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      ambientCleanup?.();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      globalThis.removeEventListener?.("keydown", onKeyDown);
      globalThis.removeEventListener?.("beforeunload", onBeforeUnload);
      source?.close?.();
    },
  };
}

export const __blackboardFragmentEditorTest = {
  fittedSquareCrop,
  normalizeFragmentCrop,
  moveFragmentCrop,
  zoomFragmentCrop,
  fragmentOutputSize,
  normalizeFragmentRecipe,
  serializeFragmentRecipe,
  interpolateFragmentStroke,
  FragmentRecipeHistory,
};
