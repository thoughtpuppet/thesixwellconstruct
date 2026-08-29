import { rewriteJavaScriptForViewer } from "../../../shared/archive-viewer-javascript.js";

export { rewriteJavaScriptForViewer } from "../../../shared/archive-viewer-javascript.js";

const VIEWER_ORIGIN = "https://archive-viewer.thesixwellconstruct.com";
const MAX_PREVIEW_SECONDS = 15 * 60;
const MAX_REWRITABLE_TEXT_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export const PUBLIC_SNAPSHOT_GATE_SQL = `
SELECT snapshot.id,snapshot.entry_path
FROM archive_web_snapshots snapshot
JOIN archive_dossiers dossier ON dossier.entity_id=snapshot.dossier_entity_id
JOIN content_entities entity ON entity.id=dossier.entity_id
JOIN archive_records owner ON owner.id=dossier.entity_id
JOIN archive_materials material
  ON material.id=snapshot.material_id
 AND material.dossier_entity_id=snapshot.dossier_entity_id
JOIN archive_object_states object_state
  ON object_state.id=snapshot.state_id
 AND object_state.id=material.state_id
JOIN archive_object_versions object_version
  ON object_version.id=object_state.version_id
 AND object_version.entity_id=snapshot.dossier_entity_id
WHERE snapshot.id=?
  AND snapshot.scan_status='ready'
  AND snapshot.scan_revision=snapshot.source_revision
  AND snapshot.mutation_token=''
  AND snapshot.viewer_approved=1
  AND snapshot.publication_state='published'
  AND snapshot.public_visible=1
  AND dossier.state='published'
  AND dossier.public_visible=1
  AND entity.visibility='public'
  AND owner.state='published'
  AND material.state='published'
  AND material.visibility='public'
  AND object_state.publication_state='published'
  AND object_state.public_visible=1
  AND object_version.publication_state='published'
  AND object_version.public_visible=1
LIMIT 1`;

export const PREVIEW_SNAPSHOT_GATE_SQL = `
SELECT snapshot.id,snapshot.entry_path
FROM archive_web_snapshots snapshot
WHERE snapshot.id=?
  AND snapshot.scan_status='ready'
  AND snapshot.scan_revision=snapshot.source_revision
  AND snapshot.mutation_token=''
LIMIT 1`;

export const SNAPSHOT_FILE_SQL = `
SELECT normalized_path,viewer_storage_key,mime_type,byte_size
FROM archive_web_snapshot_files
WHERE snapshot_id=?
  AND normalized_path=?
  AND viewer_eligible=1
  AND viewer_storage_key<>''
LIMIT 1`;

export const SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL = `
SELECT dependency.original_reference,
       '__archive_replacement__/' || replacement.id resolved_path
FROM archive_web_snapshot_dependencies dependency
JOIN archive_web_snapshot_replacements replacement
  ON replacement.snapshot_id=dependency.snapshot_id
 AND replacement.dependency_key=dependency.dependency_key
WHERE dependency.snapshot_id=?
  AND dependency.referring_path=?
  AND dependency.status='resolved'
  AND dependency.resolved_path<>''
  AND dependency.dependency_kind<>'navigation'
  AND dependency.notes='local-external-replacement'
  AND (
    lower(dependency.original_reference) LIKE 'http://%'
    OR lower(dependency.original_reference) LIKE 'https://%'
    OR dependency.original_reference LIKE '//%'
  )
ORDER BY dependency.original_reference`;

export const SNAPSHOT_REPLACEMENT_SQL = `
SELECT id,local_path,storage_key,mime_type,byte_size,sha256,derivative_role
FROM archive_web_snapshot_replacements
WHERE id=?
  AND snapshot_id=?
  AND derivative_role='external-resource-replacement'
LIMIT 1`;

export const PREVIEW_CAPTURE_SQL = `
SELECT capture.storage_key,capture.mime_type,capture.byte_size,capture.sha256
FROM archive_web_snapshot_captures capture
LEFT JOIN archive_web_history_candidates candidate ON candidate.id=capture.candidate_id
JOIN archive_web_snapshots snapshot ON snapshot.id=capture.snapshot_id
WHERE capture.id=?
  AND capture.snapshot_id=?
  AND (capture.candidate_id IS NULL OR candidate.snapshot_id=capture.snapshot_id)
LIMIT 1`;

export const PUBLIC_CAPTURE_SQL = `
SELECT capture.storage_key,capture.mime_type,capture.byte_size,capture.sha256
FROM archive_web_snapshot_captures capture
LEFT JOIN archive_web_history_candidates candidate ON candidate.id=capture.candidate_id
WHERE capture.id=?
  AND capture.snapshot_id=?
  AND (capture.candidate_id IS NULL OR (
    candidate.snapshot_id=capture.snapshot_id
    AND candidate.decision IN ('approved-version','approved-state','preserved-branch','merged')
  ))
LIMIT 1`;

function jsonLog(level, event, details = {}) {
  const value = JSON.stringify({ level, event, ...details });
  if (level === "error") console.error(value);
  else if (level === "warn") console.warn(value);
  else console.log(value);
}

function problem(status, message, headers = {}) {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function normalizeSnapshotPath(input) {
  let value;
  try {
    value = decodeURIComponent(String(input || ""));
  } catch {
    return null;
  }
  value = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value || value.includes("\0") || /^[a-z]:\//i.test(value) || value.startsWith("//")) return null;
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : null;
}

function parseViewerPath(pathname) {
  const previewMatch = /^\/p\/([^/]+)\/s\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (previewMatch && SNAPSHOT_ID_PATTERN.test(previewMatch[2])) {
    return { snapshotId: previewMatch[2], requestedPath: previewMatch[3] || "", previewToken: previewMatch[1] };
  }
  const match = /^\/s\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match || !SNAPSHOT_ID_PATTERN.test(match[1])) return null;
  return { snapshotId: match[1], requestedPath: match[2] || "", previewToken: "" };
}

function base64UrlToBytes(value) {
  if (!/^[a-z0-9_-]+$/i.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function timingSafeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function previewSignature(secret, snapshotId, expires) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1\n${snapshotId}\n${expires}`));
  return new Uint8Array(bytes);
}

export async function createPreviewToken(secret, snapshotId, expires) {
  if (!secret || !SNAPSHOT_ID_PATTERN.test(snapshotId) || !Number.isInteger(expires)) throw new Error("Invalid preview token input.");
  return `v1.${expires}.${bytesToBase64Url(await previewSignature(secret, snapshotId, expires))}`;
}

export async function verifyPreviewToken(token, secret, snapshotId, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret || !SNAPSHOT_ID_PATTERN.test(snapshotId)) return false;
  const [version, expiresValue, encodedSignature, ...extra] = token.split(".");
  if (extra.length || version !== "v1" || !/^\d{10}$/.test(expiresValue)) return false;
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds || expires > nowSeconds + MAX_PREVIEW_SECONDS) return false;
  const supplied = base64UrlToBytes(encodedSignature);
  if (!supplied) return false;
  const expected = await previewSignature(secret, snapshotId, expires);
  return timingSafeEqual(supplied, expected);
}

function cspFor(requestOrigin, historicalShell = false) {
  const allowedOrigin = /^https?:\/\/[a-z0-9.:-]+$/i.test(requestOrigin) ? requestOrigin : VIEWER_ORIGIN;
  const frameAncestors = [
    "https://thesixwellconstruct.com",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
  ].join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${allowedOrigin}`,
    `style-src 'unsafe-inline' ${allowedOrigin}`,
    `img-src ${allowedOrigin} data: blob:`,
    `font-src ${allowedOrigin} data:`,
    `media-src ${allowedOrigin} data: blob:`,
    "connect-src 'none'",
    historicalShell ? `frame-src ${allowedOrigin}` : "frame-src 'none'",
    historicalShell ? `child-src ${allowedOrigin}` : "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors}`,
    "sandbox allow-scripts",
  ].join("; ");
}

export function viewerHeaders({ origin = VIEWER_ORIGIN, mimeType = "text/html; charset=utf-8", preview = false, historicalShell = false } = {}) {
  return new Headers({
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-disposition": "inline",
    "content-security-policy": cspFor(origin, historicalShell),
    "content-type": mimeType || "application/octet-stream",
    "cross-origin-resource-policy": "cross-origin",
    "permissions-policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-archive-viewer-mode": preview ? "preview" : "published",
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function historicalViewerShell(historicalHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Historical website viewer</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#0e0e0e}iframe{display:block;width:100%;height:100%;border:0;background:#0e0e0e}</style></head><body><iframe title="Historical website snapshot" sandbox="allow-scripts" srcdoc="${escapeHtml(historicalHtml)}"></iframe></body></html>`;
}

export function blockedNavigationHtml(snapshotId, entryPath, attemptedPath = "", routeBase = "") {
  const base = routeBase || `/s/${encodeURIComponent(snapshotId)}`;
  const reset = `${base}/${entryPath.split("/").map(encodeURIComponent).join("/")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Historical navigation blocked</title><style>html,body{margin:0;min-height:100%;background:#100d0a;color:#fcb867;font-family:Georgia,serif}main{box-sizing:border-box;min-height:100vh;display:grid;place-content:center;gap:1rem;padding:2rem;border:5px solid #6d3d15}h1{margin:0;font:700 clamp(1.5rem,5vw,3rem)/1.1 Arial,sans-serif;text-transform:uppercase}p{max-width:42rem;margin:0;line-height:1.6}a{width:max-content;color:#100d0a;background:#fcb867;padding:.75rem 1rem;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;text-transform:uppercase}</style></head><body><main><h1>Historical navigation blocked</h1><p>This preserved page tried to open <strong>${escapeHtml(attemptedPath || "another historical route")}</strong>. Archive viewers do not enter the current website or the outside network.</p><a href="${escapeHtml(reset)}">Reset snapshot</a></main></body></html>`;
}

async function queryFirst(database, sql, ...values) {
  return database.prepare(sql).bind(...values).first();
}

async function queryAll(database, sql, ...values) {
  const result = await database.prepare(sql).bind(...values).all();
  return result?.results || [];
}

function encodedViewerPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function splitReferenceSuffix(value) {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const candidates = [query, fragment].filter((index) => index >= 0);
  const boundary = candidates.length ? Math.min(...candidates) : value.length;
  return { path: value.slice(0, boundary), suffix: value.slice(boundary) };
}

function resolveViewerPath(currentPath, referencePath) {
  let decoded;
  try { decoded = decodeURIComponent(referencePath).replaceAll("\\", "/"); } catch { return null; }
  const segments = decoded.startsWith("/")
    ? []
    : currentPath.split("/").slice(0, -1).filter(Boolean);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? segments.join("/") : null;
}

function mappedExternalPath(externalMappings, reference) {
  if (!externalMappings) return null;
  let candidate;
  if (externalMappings instanceof Map) candidate = externalMappings.get(reference);
  else if (typeof externalMappings === "object" && Object.prototype.hasOwnProperty.call(externalMappings, reference)) candidate = externalMappings[reference];
  if (typeof candidate !== "string") return null;
  const { path, suffix } = splitReferenceSuffix(candidate);
  if (suffix) return null;
  return normalizeSnapshotPath(path);
}

export async function loadExternalReplacementMappings(database, snapshotId, referringPath) {
  const rows = await queryAll(database, SNAPSHOT_EXTERNAL_REPLACEMENTS_SQL, snapshotId, referringPath);
  const mappings = new Map();
  const ambiguous = new Set();
  for (const row of rows) {
    const originalReference = String(row?.original_reference || "");
    if (!/^(?:https?:)?\/\//i.test(originalReference) || ambiguous.has(originalReference)) continue;
    const resolvedPath = normalizeSnapshotPath(row?.resolved_path);
    if (!resolvedPath) continue;
    const existing = mappings.get(originalReference);
    if (existing && existing !== resolvedPath) {
      mappings.delete(originalReference);
      ambiguous.add(originalReference);
    } else mappings.set(originalReference, resolvedPath);
  }
  return mappings;
}

export function rewriteViewerReference(value, routeBase, currentPath, externalMappings = null, allowExternalReplacement = true) {
  if (!value || value.startsWith("#") || /^(?:data|blob):/i.test(value)) return value;
  if (/^(?:https?:)?\/\//i.test(value)) {
    const mappedPath = allowExternalReplacement ? mappedExternalPath(externalMappings, value) : null;
    if (mappedPath) {
      const { suffix } = splitReferenceSuffix(value);
      return `${routeBase}/${encodedViewerPath(mappedPath)}${suffix}`;
    }
    return `${routeBase}/__archive_blocked_navigation__?target=${encodeURIComponent(value.slice(0, 500))}`;
  }
  if (/^(?:javascript|vbscript|mailto|tel):/i.test(value)) {
    return `${routeBase}/__archive_blocked_navigation__?target=${encodeURIComponent(value.slice(0, 500))}`;
  }
  const { path, suffix } = splitReferenceSuffix(value);
  const normalized = path ? resolveViewerPath(currentPath, path) : normalizeSnapshotPath(currentPath);
  return normalized ? `${routeBase}/${encodedViewerPath(normalized)}${suffix}` : `${routeBase}/__archive_blocked_navigation__`;
}

export function rewriteSrcsetForViewer(value, routeBase, currentPath, externalMappings = null) {
  const source = String(value || "");
  const candidates = [];
  let position = 0;
  while (position < source.length) {
    while (position < source.length && /[\s,]/.test(source[position])) position += 1;
    if (position >= source.length) break;

    let reference = "";
    while (position < source.length && !/\s/.test(source[position])) {
      reference += source[position];
      position += 1;
    }
    let commaTerminated = false;
    while (reference.endsWith(",")) {
      commaTerminated = true;
      reference = reference.slice(0, -1);
    }
    if (!reference) continue;

    let descriptor = "";
    if (!commaTerminated) {
      while (position < source.length && /\s/.test(source[position])) position += 1;
      let parenthesisDepth = 0;
      while (position < source.length) {
        const character = source[position];
        if (character === "(") parenthesisDepth += 1;
        else if (character === ")" && parenthesisDepth) parenthesisDepth -= 1;
        if (character === "," && parenthesisDepth === 0) {
          position += 1;
          break;
        }
        descriptor += character;
        position += 1;
      }
    }
    const rewritten = rewriteViewerReference(reference, routeBase, currentPath, externalMappings);
    candidates.push(descriptor.trim() ? `${rewritten} ${descriptor.trim()}` : rewritten);
  }
  return candidates.join(", ");
}

export function rewriteCssForViewer(source, routeBase, currentPath, externalMappings = null) {
  const imported = String(source).replace(/@import(\s+)(["'])([^"']+)\2/gi, (whole, space, quote, reference) => {
    return `@import${space}${quote}${rewriteViewerReference(reference, routeBase, currentPath, externalMappings)}${quote}`;
  });
  return imported.replace(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi, (whole, doubleQuoted, singleQuoted, bare) => {
    const reference = doubleQuoted ?? singleQuoted ?? bare ?? "";
    const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
    return `url(${quote}${rewriteViewerReference(reference, routeBase, currentPath, externalMappings)}${quote})`;
  });
}

const JAVASCRIPT_MIME_TYPES = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
  "text/x-ecmascript", "text/x-javascript",
]);

function isJavaScriptMime(value) {
  const type = String(value || "").trim().toLowerCase().split(";")[0];
  return JAVASCRIPT_MIME_TYPES.has(type);
}

function scriptTypeIsExecutable(value) {
  const type = String(value || "").trim().toLowerCase().split(";")[0];
  return !type || type === "module" || isJavaScriptMime(type);
}

function activeNonHtmlDocument(mimeType) {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  return mime === "image/svg+xml" || mime === "application/xml" || mime === "text/xml" || mime === "application/pdf";
}

function safeActiveNonHtmlAssetRequest(request) {
  const destination = String(request.headers.get("sec-fetch-dest") || "").toLowerCase();
  const mode = String(request.headers.get("sec-fetch-mode") || "").toLowerCase();
  if (!destination || !mode || mode === "navigate") return false;
  return destination === "image" && ["no-cors", "cors", "same-origin"].includes(mode);
}

export function viewerGuardScript(routeBase) {
  const serializedBase = JSON.stringify(routeBase);
  return `<script data-archive-viewer-guard>(()=>{const base=${serializedBase};const initialDocument=location.href;const allowed=(value)=>{try{const target=new URL(value,location.href);return target.origin===location.origin&&target.pathname.startsWith(base+'/')}catch{return false}};const showBlocked=(value)=>{document.documentElement.dataset.archiveScriptNavigationBlocked='true';let screen=document.getElementById('__archive_script_navigation_blocked__');if(!screen){screen=document.createElement('section');screen.id='__archive_script_navigation_blocked__';screen.setAttribute('role','alertdialog');screen.style.cssText='position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;display:grid;place-content:center;gap:16px;padding:32px;border:5px solid #6d3d15;background:#100d0a;color:#fcb867;font:16px/1.6 Georgia,serif';const heading=document.createElement('h1');heading.textContent='Historical navigation blocked';heading.style.cssText='margin:0;font:700 32px/1.1 Arial,sans-serif;text-transform:uppercase';const detail=document.createElement('p');detail.dataset.archiveBlockedTarget='true';detail.style.margin='0';const reset=document.createElement('a');reset.href=initialDocument;reset.dataset.archiveViewerReset='true';reset.textContent='Reset snapshot';reset.style.cssText='width:max-content;padding:12px 16px;background:#fcb867;color:#100d0a;font:700 14px/1 Arial,sans-serif;text-decoration:none;text-transform:uppercase';reset.addEventListener('click',()=>screen.remove());screen.append(heading,detail,reset);document.documentElement.append(screen)}const detail=screen.querySelector('[data-archive-blocked-target]');if(detail)detail.textContent='This preserved page tried to open '+String(value||'another route').slice(0,500)+'. Archive viewers do not enter the current website or the outside network.'};const blockNavigation=(value)=>{showBlocked(value);return undefined};try{Object.defineProperty(globalThis,'__archiveViewerBlockNavigation',{value:blockNavigation,configurable:false,writable:false});Object.defineProperty(globalThis,'__archiveViewerNavigationTarget',{get:()=>initialDocument,set:blockNavigation,configurable:false})}catch{globalThis.__archiveViewerBlockNavigation=blockNavigation}addEventListener('click',(event)=>{const anchor=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(!anchor||anchor.dataset.archiveViewerReset==='true')return;if(anchor.hasAttribute('download')){event.preventDefault();event.stopImmediatePropagation();document.documentElement.dataset.archiveDownloadBlocked='true';return}const raw=anchor.getAttribute('href')||'';if(!raw||raw[0]==='#')return;event.preventDefault();event.stopImmediatePropagation();showBlocked(raw)},true);addEventListener('submit',(event)=>{event.preventDefault();event.stopImmediatePropagation();document.documentElement.dataset.archiveFormBlocked='true'},true);if(window.navigation&&typeof window.navigation.addEventListener==='function')window.navigation.addEventListener('navigate',(event)=>{const destination=event.destination&&event.destination.url;if(destination&&!allowed(destination)){event.preventDefault();showBlocked(destination)}});try{Object.defineProperty(window,'open',{value:()=>{document.documentElement.dataset.archivePopupBlocked='true';return null},configurable:false,writable:false})}catch{window.open=()=>null}new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)if(node&&node.nodeType===1){if(node.matches?.('meta[http-equiv="refresh" i],iframe,object,embed'))node.remove();node.querySelectorAll?.('meta[http-equiv="refresh" i],iframe,object,embed').forEach((entry)=>entry.remove())}}).observe(document.documentElement,{childList:true,subtree:true})})();</script>`;
}

const VIEWER_FOCUS_STUDIES = Object.freeze({
  "breathing-eyes": ["drawEyes"],
  "ring-node-opening": ["drawRing", "drawTravelingDots", "drawSettledNodes", "drawCollapsingNodes"],
  "node-orbits-pathways": ["drawSettledNodes", "drawSubNodes", "drawOutgoingSubNodes"],
  "six-living-cultures": ["drawDots", "drawTravelingDots"],
});

function viewerFocusStudy(value) {
  const study = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIEWER_FOCUS_STUDIES, study) ? study : "";
}

// A focus study never edits the immutable snapshot. It mirrors only the canvas
// calls made by the named historical drawing functions onto a derivative layer
// while the complete source remains visible underneath as a ghost.
export function viewerFocusStudyScript(value) {
  const study = viewerFocusStudy(value);
  if (!study) return "";
  const names = JSON.stringify(VIEWER_FOCUS_STUDIES[study]);
  const serializedStudy = JSON.stringify(study);
  return `<style data-archive-focus-style>body[data-archive-focus-study]>:not(#__archive_focus_canvas__){opacity:.14!important}#__archive_focus_canvas__{position:fixed!important;z-index:2147483000!important;pointer-events:none!important;opacity:1!important}html,body{background:#0e0e0e!important}</style><script data-archive-focus-study>(()=>{const study=${serializedStudy};const names=${names};let active=0,overlay=null,overlayContext=null,sourceCanvas=null;document.documentElement.dataset.archiveFocusStudy=study;const ensure=()=>{sourceCanvas=sourceCanvas||document.querySelector('canvas:not(#__archive_focus_canvas__)');if(!sourceCanvas||!document.body)return null;if(!overlay){overlay=document.createElement('canvas');overlay.id='__archive_focus_canvas__';overlay.setAttribute('aria-hidden','true');document.body.append(overlay);document.body.dataset.archiveFocusStudy=study;overlayContext=overlay.getContext('2d')}const rect=sourceCanvas.getBoundingClientRect();if(overlay.width!==sourceCanvas.width||overlay.height!==sourceCanvas.height){overlay.width=sourceCanvas.width;overlay.height=sourceCanvas.height}overlay.style.left=rect.left+'px';overlay.style.top=rect.top+'px';overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';return overlayContext};const copyState=(from,to)=>{for(const key of ['fillStyle','strokeStyle','globalAlpha','globalCompositeOperation','lineWidth','lineCap','lineJoin','miterLimit','font','textAlign','textBaseline','shadowBlur','shadowColor','shadowOffsetX','shadowOffsetY','lineDashOffset','imageSmoothingEnabled'])try{to[key]=from[key]}catch{}try{to.setTransform(from.getTransform())}catch{}try{to.setLineDash(from.getLineDash())}catch{}};const stateMethods=new Set(['save','restore','translate','rotate','scale','transform','setTransform','resetTransform','setLineDash']);const methods=[...stateMethods,'beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','arcTo','ellipse','rect','roundRect','clip','fill','stroke','fillRect','strokeRect','clearRect','drawImage','fillText','strokeText'];for(const name of methods){const original=CanvasRenderingContext2D.prototype[name];if(typeof original!=='function')continue;Object.defineProperty(CanvasRenderingContext2D.prototype,name,{configurable:true,writable:true,value:function(...args){const result=Reflect.apply(original,this,args);if(name==='fillRect'&&!active&&sourceCanvas&&this.canvas===sourceCanvas&&args[2]>=sourceCanvas.width*.9&&args[3]>=sourceCanvas.height*.9){const target=ensure();if(target)target.clearRect(0,0,target.canvas.width,target.canvas.height)}if(active&&sourceCanvas&&this.canvas===sourceCanvas){const target=ensure();if(target){copyState(this,target);if(!stateMethods.has(name))try{Reflect.apply(original,target,args)}catch{}}}return result}})}const install=()=>{ensure();for(const name of names){const original=globalThis[name];if(typeof original!=='function'||original.__archiveFocusWrapped)continue;const wrapped=function(...args){active++;try{return Reflect.apply(original,this,args)}finally{active--}};Object.defineProperty(wrapped,'__archiveFocusWrapped',{value:true});try{globalThis[name]=wrapped}catch{}}};addEventListener('resize',ensure);setTimeout(install,0)})();</script>`;
}

function hrefMayReferenceAsset(element) {
  const tagName = String(element.tagName || "").toLowerCase();
  if (["use", "image", "feimage"].includes(tagName)) return true;
  if (tagName !== "link") return false;
  const relations = String(element.getAttribute("rel") || "").toLowerCase().split(/\s+/).filter(Boolean);
  return relations.some((relation) => ["stylesheet", "icon", "preload", "modulepreload"].includes(relation));
}

function historicalHtmlResponse(response, routeBase, currentPath, externalMappings = null, focusStudy = "") {
  if (typeof HTMLRewriter !== "function") return response;
  let guardInjected = false;
  const rewriteAttribute = (name) => ({ element(element) {
    const value = element.getAttribute(name);
    if (value) {
      const allowExternalReplacement = name !== "href" || hrefMayReferenceAsset(element);
      element.setAttribute(name, rewriteViewerReference(value, routeBase, currentPath, externalMappings, allowExternalReplacement));
    }
  } });
  const removeElement = { element(element) { element.remove(); } };
  const injectGuard = { element(element) {
    if (guardInjected) return;
    guardInjected = true;
    element.prepend(`${viewerGuardScript(routeBase)}${viewerFocusStudyScript(focusStudy)}`, { html: true });
  } };
  let styleBuffer = "", scriptBuffer = "", executableScript = false;
  return new HTMLRewriter()
    .on("html", injectGuard)
    .on("head", injectGuard)
    .on("body", injectGuard)
    .on("*", { element(element) {
      for (const [name, value] of element.attributes) {
        if (/^on/i.test(name) && value) element.setAttribute(name, rewriteJavaScriptForViewer(value));
      }
    } })
    .on("[href]", rewriteAttribute("href"))
    .on("[src]", rewriteAttribute("src"))
    .on("[poster]", rewriteAttribute("poster"))
    .on("[srcset]", { element(element) { const value = element.getAttribute("srcset"); if (value) element.setAttribute("srcset", rewriteSrcsetForViewer(value, routeBase, currentPath, externalMappings)); } })
    .on("[style]", { element(element) { const value = element.getAttribute("style"); if (value) element.setAttribute("style", rewriteCssForViewer(value, routeBase, currentPath, externalMappings)); } })
    .on("style", { text(text) {
      styleBuffer += text.text;
      if (text.lastInTextNode) {
        text.replace(rewriteCssForViewer(styleBuffer, routeBase, currentPath, externalMappings), { html: true });
        styleBuffer = "";
      } else text.remove();
    } })
    .on("script", {
      element(element) { executableScript = !element.getAttribute("src") && scriptTypeIsExecutable(element.getAttribute("type")); scriptBuffer = ""; },
      text(text) {
        if (!executableScript) return;
        scriptBuffer += text.text;
        if (text.lastInTextNode) { text.replace(rewriteJavaScriptForViewer(scriptBuffer), { html: true }); scriptBuffer = ""; }
        else text.remove();
      },
    })
    .on("form", { element(element) { element.removeAttribute("action"); element.setAttribute("data-archive-form-blocked", "true"); } })
    .on("meta[http-equiv]", { element(element) { if ((element.getAttribute("http-equiv") || "").trim().toLowerCase() === "refresh") element.remove(); } })
    .on("base", removeElement)
    .on("iframe", removeElement)
    .on("object", removeElement)
    .on("embed", removeElement)
    .transform(response);
}

async function blockedResponse(request, snapshotId, entryPath, attemptedPath, preview, previewToken = "") {
  const headers = viewerHeaders({ origin: new URL(request.url).origin, preview });
  const routeBase = preview
    ? `/p/${encodeURIComponent(previewToken)}/s/${encodeURIComponent(snapshotId)}`
    : `/s/${encodeURIComponent(snapshotId)}`;
  return new Response(request.method === "HEAD" ? null : blockedNavigationHtml(snapshotId, entryPath, attemptedPath, routeBase), { status: 404, headers });
}

async function serveSnapshotRequest(request, env, route) {
  const url = new URL(request.url);
  const previewToken = route.previewToken || "";
  const preview = previewToken.length > 0;
  if (preview) {
    const valid = await verifyPreviewToken(previewToken, env.ARCHIVE_VIEWER_SIGNING_KEY, route.snapshotId);
    if (!valid) return problem(404, "Not found.");
  }

  const rawRequestedPath = normalizeSnapshotPath(route.requestedPath || "");
  const captureMatch = rawRequestedPath && /^__archive_capture__\/([a-z0-9][a-z0-9_-]{0,127})$/i.exec(rawRequestedPath);
  if (captureMatch) {
    if (!preview) {
      const publicGate = await queryFirst(env.SUBMISSIONS_DB, PUBLIC_SNAPSHOT_GATE_SQL, route.snapshotId);
      if (!publicGate) return problem(404, "Not found.");
    }
    const capture = await queryFirst(
      env.SUBMISSIONS_DB,
      preview ? PREVIEW_CAPTURE_SQL : PUBLIC_CAPTURE_SQL,
      captureMatch[1],
      route.snapshotId,
    );
    if (!capture) return problem(404, "Not found.");
    const object = request.method === "HEAD"
      ? await env.SUBMISSION_FILES.head(capture.storage_key)
      : await env.SUBMISSION_FILES.get(capture.storage_key);
    if (!object) {
      jsonLog("error", "archive_viewer_capture_missing", { snapshot_id: route.snapshotId, capture_id: captureMatch[1] });
      return problem(404, "Not found.");
    }
    const headers = viewerHeaders({ origin: url.origin, mimeType: capture.mime_type, preview });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    headers.set("content-length", String(capture.byte_size));
    headers.set("x-archive-derivative-role", "generated-viewer-capture");
    headers.set("x-content-sha256", capture.sha256);
    return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
  }

  const gate = await queryFirst(env.SUBMISSIONS_DB, preview ? PREVIEW_SNAPSHOT_GATE_SQL : PUBLIC_SNAPSHOT_GATE_SQL, route.snapshotId);
  if (!gate) return problem(404, "Not found.");
  const entryPath = normalizeSnapshotPath(gate.entry_path);
  const requestedPath = normalizeSnapshotPath(route.requestedPath || entryPath);
  if (!entryPath || !requestedPath) return problem(404, "Not found.");

  const replacementMatch = /^__archive_replacement__\/([a-z0-9][a-z0-9_-]{0,127})$/i.exec(requestedPath);
  if (replacementMatch) {
    const replacement = await queryFirst(env.SUBMISSIONS_DB, SNAPSHOT_REPLACEMENT_SQL, replacementMatch[1], route.snapshotId);
    if (!replacement) return problem(404, "Not found.");
    if (activeNonHtmlDocument(replacement.mime_type) && !safeActiveNonHtmlAssetRequest(request)) {
      return blockedResponse(request, route.snapshotId, entryPath, requestedPath, preview, previewToken);
    }
    const object = request.method === "HEAD"
      ? await env.SUBMISSION_FILES.head(replacement.storage_key)
      : await env.SUBMISSION_FILES.get(replacement.storage_key);
    if (!object) {
      jsonLog("error", "archive_viewer_replacement_missing", { snapshot_id: route.snapshotId, replacement_id: replacementMatch[1] });
      return problem(404, "Not found.");
    }
    const headers = viewerHeaders({ origin: url.origin, mimeType: replacement.mime_type, preview });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    headers.set("x-archive-derivative-role", "external-resource-replacement");
    headers.set("x-content-sha256", replacement.sha256);
    const replacementMime = String(replacement.mime_type || "").toLowerCase();
    const isCss = replacementMime.startsWith("text/css");
    const isJavaScript = isJavaScriptMime(replacementMime);
    if (!isCss && !isJavaScript) headers.set("content-length", String(replacement.byte_size));
    if ((isCss || isJavaScript) && request.method !== "HEAD") {
      const objectBytes = Number(object.size ?? replacement.byte_size ?? 0);
      if (!objectBytes || objectBytes > MAX_REWRITABLE_TEXT_BYTES || Number(replacement.byte_size) > MAX_REWRITABLE_TEXT_BYTES) {
        jsonLog("error", "archive_viewer_replacement_text_too_large", { snapshot_id: route.snapshotId, replacement_id: replacementMatch[1], bytes: objectBytes });
        return problem(500, "Viewer source unavailable.");
      }
      const routeBase = preview
        ? `/p/${encodeURIComponent(previewToken)}/s/${encodeURIComponent(route.snapshotId)}`
        : `/s/${encodeURIComponent(route.snapshotId)}`;
      const source = typeof object.text === "function" ? await object.text() : await new Response(object.body).text();
      return new Response(isCss ? rewriteCssForViewer(source, routeBase, replacement.local_path) : rewriteJavaScriptForViewer(source), { status: 200, headers });
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
  }

  const file = await queryFirst(env.SUBMISSIONS_DB, SNAPSHOT_FILE_SQL, route.snapshotId, requestedPath);
  if (!file) return blockedResponse(request, route.snapshotId, entryPath, requestedPath, preview, previewToken);
  if (activeNonHtmlDocument(file.mime_type) && !safeActiveNonHtmlAssetRequest(request)) {
    return blockedResponse(request, route.snapshotId, entryPath, requestedPath, preview, previewToken);
  }
  const object = request.method === "HEAD"
    ? await env.SUBMISSION_FILES.head(file.viewer_storage_key)
    : await env.SUBMISSION_FILES.get(file.viewer_storage_key);
  if (!object) {
    jsonLog("error", "archive_viewer_object_missing", { snapshot_id: route.snapshotId, path: requestedPath });
    return problem(404, "Not found.");
  }

  const headers = viewerHeaders({ origin: url.origin, mimeType: file.mime_type, preview });
  headers.set("etag", object.httpEtag);
  const isHtml = (file.mime_type || "").toLowerCase().startsWith("text/html");
  const isCss = (file.mime_type || "").toLowerCase().startsWith("text/css");
  const isJavaScript = isJavaScriptMime(file.mime_type);
  if (file.byte_size != null && !isHtml && !isCss && !isJavaScript) headers.set("content-length", String(file.byte_size));
  const routeBase = preview
    ? `/p/${encodeURIComponent(previewToken)}/s/${encodeURIComponent(route.snapshotId)}`
    : `/s/${encodeURIComponent(route.snapshotId)}`;
  const externalMappings = (isHtml || isCss) && request.method !== "HEAD"
    ? await loadExternalReplacementMappings(env.SUBMISSIONS_DB, route.snapshotId, requestedPath)
    : null;
  if (isHtml) {
    const shellHeaders = viewerHeaders({
      origin: url.origin,
      mimeType: "text/html; charset=utf-8",
      preview,
      historicalShell: true,
    });
    if (object.httpEtag) shellHeaders.set("etag", object.httpEtag);
    shellHeaders.set("x-archive-viewer-shell", "nested-srcdoc");
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: shellHeaders });
    const objectBytes = Number(object.size ?? file.byte_size ?? 0);
    if (!objectBytes || objectBytes > MAX_REWRITABLE_TEXT_BYTES || Number(file.byte_size) > MAX_REWRITABLE_TEXT_BYTES) {
      jsonLog("error", "archive_viewer_html_too_large", { snapshot_id: route.snapshotId, path: requestedPath, bytes: objectBytes });
      return problem(500, "Viewer document unavailable.");
    }
    const source = typeof object.text === "function" ? await object.text() : await new Response(object.body).text();
    const historicalResponse = historicalHtmlResponse(
      new Response(source, { headers: { "content-type": file.mime_type || "text/html; charset=utf-8" } }),
      routeBase,
      requestedPath,
      externalMappings,
      url.searchParams.get("study") || "",
    );
    const historicalHtml = await historicalResponse.text();
    return new Response(historicalViewerShell(historicalHtml), { status: 200, headers: shellHeaders });
  }
  if (isCss && request.method !== "HEAD") {
    const objectBytes = Number(object.size ?? file.byte_size ?? 0);
    if (!objectBytes || objectBytes > MAX_REWRITABLE_TEXT_BYTES || Number(file.byte_size) > MAX_REWRITABLE_TEXT_BYTES) {
      jsonLog("error", "archive_viewer_css_too_large", { snapshot_id: route.snapshotId, path: requestedPath, bytes: objectBytes });
      return problem(500, "Viewer stylesheet unavailable.");
    }
    const css = typeof object.text === "function" ? await object.text() : await new Response(object.body).text();
    return new Response(rewriteCssForViewer(css, routeBase, requestedPath, externalMappings), { status: 200, headers });
  }
  if (isJavaScript && request.method !== "HEAD") {
    const objectBytes = Number(object.size ?? file.byte_size ?? 0);
    if (!objectBytes || objectBytes > MAX_REWRITABLE_TEXT_BYTES || Number(file.byte_size) > MAX_REWRITABLE_TEXT_BYTES) {
      jsonLog("error", "archive_viewer_javascript_too_large", { snapshot_id: route.snapshotId, path: requestedPath, bytes: objectBytes });
      return problem(500, "Viewer script unavailable.");
    }
    const source = typeof object.text === "function" ? await object.text() : await new Response(object.body).text();
    return new Response(rewriteJavaScriptForViewer(source), { status: 200, headers });
  }
  const response = new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
  return response;
}

export async function handleArchiveViewerRequest(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return problem(405, "Method not allowed.", { allow: "GET, HEAD" });
  if (!env?.SUBMISSIONS_DB || !env?.SUBMISSION_FILES) {
    jsonLog("error", "archive_viewer_binding_missing");
    return problem(503, "Viewer unavailable.");
  }
  const url = new URL(request.url);
  const route = parseViewerPath(url.pathname);
  if (!route) {
    const fallbackHeaders = viewerHeaders({ origin: url.origin });
    const body = blockedNavigationHtml("unknown", "index.html", url.pathname);
    return new Response(request.method === "HEAD" ? null : body, { status: 404, headers: fallbackHeaders });
  }
  try {
    return await serveSnapshotRequest(request, env, route);
  } catch (error) {
    jsonLog("error", "archive_viewer_request_failed", { snapshot_id: route.snapshotId, message: error instanceof Error ? error.message : String(error) });
    return problem(500, "Viewer unavailable.");
  }
}
