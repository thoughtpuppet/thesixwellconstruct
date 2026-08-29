const HEIC_MODULE_URL = "/studio/vendor/heic-to/1.5.2/heic-to.min.js";
const HEIC_MIMES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

let decoderModulePromise;

function extensionFor(file) {
  const name = String(file?.name || "");
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function basenameFor(file) {
  const name = String(file?.name || "fragment").trim() || "fragment";
  return name.replace(/\.[^.]+$/, "") || "fragment";
}

function loadDecoder() {
  if (!decoderModulePromise) decoderModulePromise = import(HEIC_MODULE_URL);
  return decoderModulePromise;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The HEIC edit proxy could not be encoded."))),
      type,
      quality,
    );
  });
}

export function isHeicUpload(file) {
  return Boolean(file) && (
    HEIC_MIMES.has(String(file.type || "").toLowerCase()) ||
    HEIC_EXTENSIONS.has(extensionFor(file))
  );
}

export async function createHeicEditProxy(file, options = {}) {
  if (!isHeicUpload(file)) throw new Error("Choose a HEIC or HEIF image.");

  const { heicTo, isHeic } = await loadDecoder();
  if (!(await isHeic(file))) throw new Error("The selected file is not a valid HEIC or HEIF image.");

  const maxEdge = Math.max(1, Number(options.maxEdge) || 2400);
  const quality = Math.min(1, Math.max(0.1, Number(options.quality) || 0.92));
  const bitmap = await heicTo({
    blob: file,
    type: "bitmap",
    options: { imageOrientation: "from-image", resizeQuality: "high" },
  });

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the HEIC edit proxy.");
    context.fillStyle = "#0E0E0E";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasBlob(canvas, "image/jpeg", quality);
    return new File([blob], `${basenameFor(file)}.edit-proxy.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } finally {
    bitmap.close?.();
  }
}
