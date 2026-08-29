const SNAPSHOT_ENDPOINT = "/api/admin/archive-web-snapshots";
const CANDIDATE_ENDPOINT = "/api/admin/archive-web-history-candidates";
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_AV_BYTES = 50 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(["css", "csv", "htm", "html", "js", "json", "map", "md", "mjs", "svg", "txt", "xml"]);
const AUDIO_VIDEO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "mp4", "oga", "ogg", "ogv", "wav", "webm"]);
const REJECTED_EXTENSIONS = new Set(["7z", "bat", "cgi", "cmd", "dll", "dmg", "exe", "gz", "msi", "php", "pl", "ps1", "py", "rar", "rb", "sh", "tar", "wasm", "zip"]);
const REVIEW_DECISIONS = [
  ["approved-version", "Approve as a new Version"],
  ["approved-state", "Approve as the next State"],
  ["preserved-branch", "Preserve as an exploratory branch"],
  ["merged", "Mark as merged evidence"],
  ["skipped", "Skip this candidate"],
];
const BEHAVIOR_PRESETS = [
  ["ring-node-opening", "Opening the construct"],
  ["breathing-eyes", "Breathing eyes"],
  ["node-orbits-pathways", "Node orbits and pathways"],
  ["six-living-cultures", "Six living cultures"],
];
const BEHAVIOR_EVOLUTION_ROLES = ["introduced", "refined", "transformed", "disabled", "restored", "observed"];
const BEHAVIOR_MEANING_STATUSES = [
  ["curator-authored", "Authored meaning"],
  ["code-inferred", "Interpretive / code-inferred"],
  ["pending-interpretation", "Meaning awaiting direction"],
];
const WEBSITE_SECTION_IDS = new Set([
  "website-lineage-markers",
  "website-interaction-evolution",
  "website-snapshots",
  "website-history-review",
]);
const BEHAVIOR_EVOLUTION_RESEARCH = [
  ["2026-04-15T20:30:19-04:00", "11cf577", ["Eyes", "Ring / nodes", "Dots"], "Inaugural system: ten eye rings share a nine-second breath; nine nodes orbit and open pathways; six inner dots orbit and vibrate before becoming six medium nodes."],
  ["2026-05-07T12:55:05-04:00", "70660bc", ["Eyes", "Responsive"], "Adds smooth breath, phase-lagged outer rings, responsive scaling, a time-varying open/closed eye crossfade, and raises the amber particle cap to 170."],
  ["2026-05-07T17:03:37-04:00", "1d91e83", ["Eyes"], "Removes the glitchy open/closed crossfade and replaces it with a stable tint mixture."],
  ["2026-05-08T15:51:23-04:00", "97aa62f", ["Ring / nodes", "Mobile"], "Introduces the current core mobile opening: the ring moves to 17% viewport height, shrinks to 62%, and the nine nodes become a vertical stack; an active node opens its pathways around itself."],
  ["2026-05-09T18:48:28-04:00", "70037f4", ["Ring / nodes", "Mobile"], "Adjusts the mobile node stack to its current 26% top and 93% bottom positions."],
  ["2026-05-09T20:05:54-04:00", "12b84af", ["Eyes"], "Changes the eye field to discrete alternating open and closed image positions. The eyes alternate; they do not blink."],
  ["2026-05-11T12:44:36-04:00", "465c740", ["Ring / nodes", "Dots"], "Makes the navigation dot larger and speeds up the node expansion."],
  ["2026-05-11T17:17:09-04:00", "153572a + 294a207", ["Dots", "Restoration"], "Two closely related repairs remove the double-dot artifact by synchronizing traveling, crossfading, and settled renderers."],
  ["2026-06-19T16:01:15-04:00", "478f243", ["Eyes", "Dots", "Depth"], "Adds adaptive outer rings, depth and parallax, intro brightness, and hover-responsive dot motion. The source describes entry into a watched, seemingly infinite domain; persistent particles are disabled in this state."],
  ["2026-07-09T17:57:23-04:00", "5277d94", ["Eyes", "Performance"], "Refines eye-field culling and performance while retaining the phased breath and discrete open/closed placement."],
  ["2026-08-13T12:01:04-04:00", "c0beaec", ["Particles", "Restoration"], "Restores the 170-particle cap in /home/ while keeping the later landing-page system."],
];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));
const asList = (value) => Array.isArray(value) ? value : [];
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
const text = (...values) => String(first(...values) || "").trim();
const titleCase = (value) => text(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const checked = (value) => value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
const jsonOptions = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let mountNode;
let requestApi;
let reportStatus;
let snapshots = [];
let candidates = [];
let websiteRecord = null;
let selectedSnapshotId = "";
let previewUrls = new Map();
let snapshotCaptureUrls = new Map();
let candidateCaptureUrls = new Map();
let eventController = null;

function requestedWebsiteSection() {
  let sectionId = "";
  try {
    sectionId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return "";
  }
  return WEBSITE_SECTION_IDS.has(sectionId) ? sectionId : "";
}

function scrollToRequestedWebsiteSection({ behavior = "auto" } = {}) {
  const sectionId = requestedWebsiteSection();
  if (!sectionId) return false;
  const target = mountNode?.querySelector(`#${CSS.escape(sectionId)}`);
  if (!target) return false;
  requestAnimationFrame(() => target.scrollIntoView({ behavior, block: "start" }));
  return true;
}

function ensureStyles() {
  if (document.querySelector('link[href*="archive-web-snapshots.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/css/archive-web-snapshots.css?v=1";
  document.head.append(link);
}

function recordsFrom(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of [...keys, "records", "items"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function recordFrom(payload, ...keys) {
  for (const key of keys) if (payload?.[key] && typeof payload[key] === "object" && !Array.isArray(payload[key])) return payload[key];
  return payload?.record && typeof payload.record === "object" ? payload.record : {};
}

function stableId(record) {
  return text(record?.id, record?.snapshot_id, record?.snapshotId);
}

function selectedSnapshot() {
  return snapshots.find((snapshot) => stableId(snapshot) === selectedSnapshotId) || snapshots[0] || null;
}

function websiteRecordId() {
  return text(websiteRecord?.id, websiteRecord?.entity_id, websiteRecord?.entityId);
}

function snapshotPlacement(snapshot) {
  const supplied = text(snapshot.version_state_label, snapshot.versionStateLabel, snapshot.state_label, snapshot.stateLabel);
  if (supplied) return supplied;
  const versionNumber = first(snapshot.version_number, snapshot.versionNumber);
  const versionTitle = text(snapshot.version_title, snapshot.versionTitle);
  const stateRoman = text(snapshot.state_roman, snapshot.stateRoman);
  const stateTitle = text(snapshot.state_title, snapshot.stateTitle);
  if (versionNumber || versionTitle || stateRoman || stateTitle) return [versionNumber ? `Version ${versionNumber}` : versionTitle, stateRoman ? `State ${stateRoman}` : "", stateTitle].filter(Boolean).join(" · ");
  return "Not assigned to a published state";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "Undated";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return text(value);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function normalizePath(value) {
  const path = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/").trim();
  if (!path) throw new Error("Every selected file needs a relative path.");
  if (/^(?:\/|[a-z]:\/|\\\\)/i.test(path) || path.includes("\0")) throw new Error(`${path}: absolute paths are not allowed.`);
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`${path}: path traversal is not allowed.`);
  return segments.join("/");
}

function extensionFor(path) {
  const name = String(path || "").split("/").pop() || "";
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function fileLimit(file, path) {
  const extension = extensionFor(path);
  if (SOURCE_EXTENSIONS.has(extension) || String(file.type || "").startsWith("text/")) return MAX_TEXT_BYTES;
  if (AUDIO_VIDEO_EXTENSIONS.has(extension) || /^(audio|video)\//.test(String(file.type || ""))) return MAX_AV_BYTES;
  return MAX_ASSET_BYTES;
}

function validateFileEntries(entries) {
  if (!entries.length) throw new Error("Choose an entry HTML file, additional files, or a folder.");
  if (entries.length > MAX_FILES) throw new Error(`A snapshot may contain at most ${MAX_FILES} files.`);
  const exact = new Set();
  const folded = new Map();
  let total = 0;
  for (const entry of entries) {
    entry.path = normalizePath(entry.path);
    const extension = extensionFor(entry.path);
    if (REJECTED_EXTENSIONS.has(extension)) throw new Error(`${entry.path}: archives, executables, and server code are not accepted.`);
    if (exact.has(entry.path)) throw new Error(`${entry.path}: the same path was selected twice.`);
    const lower = entry.path.toLowerCase();
    if (folded.has(lower)) throw new Error(`${entry.path}: its letter case collides with ${folded.get(lower)}.`);
    exact.add(entry.path);
    folded.set(lower, entry.path);
    const limit = fileLimit(entry.file, entry.path);
    if (entry.file.size > limit) throw new Error(`${entry.path}: ${formatBytes(entry.file.size)} exceeds its ${formatBytes(limit)} limit.`);
    total += Number(entry.file.size) || 0;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`The selected files total ${formatBytes(total)}; the snapshot limit is 100 MB.`);
  return { count: entries.length, total };
}

function folderEntries(files) {
  const source = [...files];
  const rawPaths = source.map((file) => String(file.webkitRelativePath || file.name).replace(/\\/g, "/"));
  const roots = rawPaths.map((path) => path.includes("/") ? path.split("/")[0] : "");
  const commonRoot = roots.length && roots[0] && roots.every((root) => root === roots[0]) ? `${roots[0]}/` : "";
  return source.map((file, index) => ({ file, path: commonRoot ? rawPaths[index].slice(commonRoot.length) : rawPaths[index] }));
}

function filesFromForm(form, { includeEntry = false } = {}) {
  const entries = [];
  if (includeEntry) {
    const entry = form.elements.entry_file?.files?.[0];
    if (entry) entries.push({ file: entry, path: text(form.elements.entry_path?.value, "index.html") });
  }
  const base = text(form.elements.base_path?.value).replace(/^\/+|\/+$/g, "");
  for (const file of [...(form.elements.files?.files || [])]) entries.push({ file, path: [base, file.name].filter(Boolean).join("/") });
  entries.push(...folderEntries(form.elements.folder?.files || []).map((entry) => ({ ...entry, path: [base, entry.path].filter(Boolean).join("/") })));
  validateFileEntries(entries);
  return entries;
}

function dependencyList(snapshot) {
  return asList(first(snapshot?.dependencies, snapshot?.dependency_report, snapshot?.dependencyReport));
}

function snapshotFiles(snapshot) {
  return asList(first(snapshot?.files, snapshot?.snapshot_files, snapshot?.snapshotFiles));
}

function dependencyStatus(dependency) {
  return text(dependency.status, dependency.dependency_status, dependency.dependencyStatus, "unverifiable");
}

function dependencyPath(dependency) {
  return text(dependency.normalized_path, dependency.normalizedPath, dependency.resolved_path, dependency.resolvedPath, dependency.original_reference, dependency.originalReference, dependency.reference);
}

function dependencySummary(snapshot) {
  const supplied = first(snapshot?.dependency_summary, snapshot?.dependencySummary);
  if (supplied && typeof supplied === "object") return supplied;
  return dependencyList(snapshot).reduce((summary, dependency) => {
    const status = dependencyStatus(dependency);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
}

function scanState(snapshot) {
  return text(snapshot.scan_status, snapshot.scanStatus, "pending");
}

function snapshotState(snapshot) {
  return text(snapshot.publication_state, snapshot.publicationState, snapshot.state, "draft");
}

function viewerApproved(snapshot) {
  return checked(first(snapshot.viewer_approved, snapshot.viewerApproved, false));
}

function option(value, label, current) {
  return `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""}>${esc(label)}</option>`;
}

function snapshotCard(snapshot) {
  const id = stableId(snapshot);
  const commit = text(snapshot.git_commit_sha, snapshot.gitCommitSha);
  return `<button class="aws-snapshot-card ${id === selectedSnapshotId ? "is-active" : ""}" type="button" data-snapshot-open="${esc(id)}">
    <span class="aws-card-top"><strong>${esc(text(snapshot.title, "Untitled website snapshot"))}</strong><span class="aws-pill">${esc(scanState(snapshot))}</span></span>
    <span class="aws-card-meta">${esc(titleCase(text(snapshot.lineage_role, snapshot.lineageRole, "exploratory-branch")))}${commit ? ` · ${esc(commit.slice(0, 8))}` : ""}</span>
    <span class="aws-card-meta">${esc(snapshotPlacement(snapshot))}</span>
  </button>`;
}

function createSnapshotForm() {
  if (!websiteRecordId()) return `<div class="aws-empty aws-create-panel"><strong>Start the canonical Website Archive record first.</strong><p>The idempotent starter establishes the dossier, Version 1, State I, Origin Thread, and Blackboard context that own every snapshot.</p></div>`;
  return `<details class="aws-panel aws-create-panel"><summary class="button">Upload a historical site</summary>
    <form class="aws-form" data-snapshot-create>
      <p class="aws-help">Choose an entry HTML file with its related files, or choose a complete folder. Original files remain immutable; the isolated viewer uses a generated derivative.</p>
      <div class="aws-form-grid">
        <label>Snapshot title<input name="title" required placeholder="First landing-page draft"></label>
        <label>Lineage role<select name="lineage_role">${option("exploratory-branch", "Exploratory branch", "exploratory-branch")}${option("canonical-state", "Canonical state", "")}${option("restoration", "Restoration", "")}</select></label>
        <label>Entry path<input name="entry_path" required value="index.html"></label>
        <label>Entry HTML <small>(optional when the folder contains the entry path)</small><input name="entry_file" type="file" accept=".html,.htm,text/html"></label>
        <label>Additional files<input name="files" type="file" multiple></label>
        <label>Complete folder<input name="folder" type="file" webkitdirectory directory multiple></label>
      </div>
      <div class="aws-actions"><button class="button" type="submit">Create private snapshot</button><span data-form-status aria-live="polite"></span></div>
    </form>
  </details>`;
}

function credentialFindings(snapshot) {
  return asList(first(snapshot.credential_findings, snapshot.credentialFindings, snapshot.security_findings, snapshot.securityFindings));
}

function dependencyReportMarkup(snapshot) {
  const dependencies = dependencyList(snapshot);
  const summary = dependencySummary(snapshot);
  const statuses = ["resolved", "missing", "case-mismatch", "external-blocked", "navigation", "embedded", "unverifiable", "accepted-missing"];
  const summaryMarkup = statuses.filter((status) => Number(summary[status] || 0) > 0).map((status) => `<span class="aws-dependency-count" data-status="${esc(status)}"><strong>${Number(summary[status])}</strong>${esc(titleCase(status))}</span>`).join("");
  if (!dependencies.length && !summaryMarkup) return `<div class="aws-empty">Finalize this snapshot to scan its referenced files.</div>`;
  return `<div class="aws-dependency-summary">${summaryMarkup || '<span class="aws-dependency-count"><strong>0</strong>References reported</span>'}</div>
    ${dependencies.length ? `<div class="aws-dependency-list">${dependencies.map((dependency) => {
      const status = dependencyStatus(dependency);
      const path = dependencyPath(dependency);
      const from = text(dependency.referring_path, dependency.referringPath, dependency.source_path, dependency.sourcePath);
      const canResolve = status === "missing" || status === "case-mismatch";
      const dependencyId = text(dependency.id, dependency.dependency_key, dependency.dependencyKey);
      const dependencyKey = text(dependency.dependency_key, dependency.dependencyKey, dependency.id);
      const originalReference = text(dependency.original_reference, dependency.originalReference);
      const mappedExternal = status === "resolved" && text(dependency.notes) === "local-external-replacement";
      const externalBlocked = status === "external-blocked";
      const provenance = mappedExternal
        ? `<small>Original external reference retained: ${esc(originalReference)} · Local replacement: ${esc(text(dependency.resolved_path, dependency.resolvedPath))}</small>`
        : from ? `<small>Referenced by ${esc(from)}</small>` : "";
      const actions = canResolve
        ? `<div class="aws-dependency-actions">${path ? `<button class="button" type="button" data-resolve-dependency="${esc(path)}" data-snapshot-id="${esc(stableId(snapshot))}">Choose file</button>` : ""}${dependencyId ? `<button class="button" type="button" data-accept-dependency="${esc(dependencyId)}" data-snapshot-id="${esc(stableId(snapshot))}">Accept historical absence</button>` : ""}</div>`
        : externalBlocked && dependencyKey ? `<div class="aws-dependency-actions"><button class="button" type="button" data-map-external-dependency="${esc(dependencyKey)}" data-snapshot-id="${esc(stableId(snapshot))}" data-original-reference="${esc(originalReference)}">Choose local replacement</button></div>` : "";
      return `<article class="aws-dependency" data-status="${esc(status)}"><div><span class="aws-pill">${esc(titleCase(status))}</span><strong>${esc(path || "Dynamic reference")}</strong>${provenance}</div>${actions}</article>`;
    }).join("")}</div>` : ""}`;
}

function provenanceMarkup(snapshot) {
  const commit = text(snapshot.git_commit_sha, snapshot.gitCommitSha);
  const treeHash = text(snapshot.tree_sha256, snapshot.tree_hash, snapshot.treeSha256, snapshot.treeHash);
  const committedAt = text(snapshot.git_commit_date, snapshot.gitCommitDate, snapshot.git_commit_at, snapshot.gitCommitAt);
  return `<dl class="aws-provenance">
    <div><dt>Source</dt><dd>${esc(titleCase(text(snapshot.source_kind, snapshot.sourceKind, "upload")))}</dd></div>
    <div><dt>Entry path</dt><dd><code>${esc(text(snapshot.entry_path, snapshot.entryPath, "index.html"))}</code></dd></div>
    <div><dt>Lineage</dt><dd>${esc(titleCase(text(snapshot.lineage_role, snapshot.lineageRole)))}</dd></div>
    <div><dt>Archive state</dt><dd>${esc(snapshotPlacement(snapshot))}</dd></div>
    ${commit ? `<div><dt>Git commit</dt><dd><code title="${esc(commit)}">${esc(commit)}</code></dd></div>` : ""}
    ${committedAt ? `<div><dt>Committed</dt><dd>${esc(formatDate(committedAt))}</dd></div>` : ""}
    ${treeHash ? `<div><dt>Tree SHA-256</dt><dd><code title="${esc(treeHash)}">${esc(treeHash)}</code></dd></div>` : ""}
  </dl>`;
}

function previewMarkup(snapshot) {
  const id = stableId(snapshot);
  const previewUrl = previewUrls.get(id) || "";
  return `<section class="aws-preview" data-admin-web-viewer data-viewport="desktop">
    <div class="aws-preview-toolbar"><div><span class="aws-label">Inline live specimen</span><strong>${previewUrl ? "Short-lived live preview ready" : "Issue a preview to run this draft"}</strong><small>Scroll and interact inside the frame. Internal and external navigation remain blocked.</small></div><div class="aws-actions"><button class="button is-active" type="button" data-admin-viewport="desktop" aria-pressed="true">Desktop</button><button class="button" type="button" data-admin-viewport="mobile" aria-pressed="false">390 px</button><button class="button" type="button" data-admin-preview-reset ${previewUrl ? "" : "disabled"}>Reset</button></div></div>
    <div class="aws-preview-stage">${previewUrl ? `<iframe title="Historical website snapshot: ${esc(text(snapshot.title, "website snapshot"))}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${esc(previewUrl)}" data-preview-src="${esc(previewUrl)}"></iframe>` : `<div class="aws-preview-empty"><strong>Live source is paused.</strong><span>No code runs until Studio issues a short-lived, snapshot-scoped preview capability. Captures remain separate evidence below.</span></div>`}</div>
  </section>`;
}

function snapshotCaptureMarkup(snapshot) {
  const id = stableId(snapshot);
  const captures = asList(first(snapshot.captures, snapshot.capture_derivatives, snapshot.captureDerivatives));
  const figures = captures.map((capture) => {
    const viewport = text(capture.viewport);
    const previewUrl = snapshotCaptureUrls.get(`${id}:${viewport}`) || "";
    if (!previewUrl) return "";
    const hash = text(capture.sha256);
    return `<figure class="aws-candidate-capture-frame" data-viewport="${esc(viewport)}"><img class="aws-candidate-capture" src="${esc(previewUrl)}" alt="Generated ${esc(viewport)} derivative capture of ${esc(text(snapshot.title, "this website snapshot"))}"><figcaption>Generated derivative · ${esc(titleCase(viewport))}${hash ? ` · SHA-256 ${esc(hash.slice(0, 12))}…` : ""}</figcaption></figure>`;
  }).join("");
  return figures ? `<details class="aws-panel aws-captured-evidence"><summary>Captured evidence · generated derivatives</summary><div class="aws-candidate-captures">${figures}</div></details>` : "";
}

function snapshotBehaviors(snapshot) {
  const existing = new Map(asList(first(snapshot.behaviors, snapshot.interaction_behaviors, snapshot.interactionBehaviors)).map((behavior) => [text(behavior.behavior_key, behavior.behaviorKey), behavior]));
  return BEHAVIOR_PRESETS.map(([key, title], index) => ({
    behavior_key: key,
    title,
    evolution_role: "observed",
    interaction_prompt: "",
    observed_behavior: "",
    authored_meaning: "",
    meaning_status: "pending-interpretation",
    source_path: "",
    source_symbol: "",
    public_visible: false,
    sort_order: (index + 1) * 10,
    ...(existing.get(key) || {}),
  }));
}

function behaviorEditorMarkup(snapshot) {
  return `<details class="aws-panel aws-behavior-editor" open><summary>Document the moving systems</summary><form class="aws-form" data-snapshot-behaviors="${esc(stableId(snapshot))}"><p class="aws-help">Record what a visitor can make this exact source state do. Observable mechanics and authored meaning stay separate; visibility here does not publish the snapshot.</p><div class="aws-behavior-editor-list">${snapshotBehaviors(snapshot).map((behavior) => {
    const key = text(behavior.behavior_key, behavior.behaviorKey);
    const currentRole = text(behavior.evolution_role, behavior.evolutionRole, "observed");
    const currentMeaningStatus = text(behavior.meaning_status, behavior.meaningStatus, "pending-interpretation");
    return `<fieldset class="aws-behavior-editor-row" data-behavior-row data-behavior-key="${esc(key)}"><legend>${esc(text(behavior.title, titleCase(key)))}</legend><div class="aws-form-grid"><label>Evolution in this state<select name="evolution_role">${BEHAVIOR_EVOLUTION_ROLES.map((role) => option(role, titleCase(role), currentRole)).join("")}</select></label><label>Meaning source<select name="meaning_status">${BEHAVIOR_MEANING_STATUSES.map(([value, label]) => option(value, label, currentMeaningStatus)).join("")}</select></label><label class="wide">What to try in the live viewer<textarea name="interaction_prompt" placeholder="Open the central ring, then select a medium node…">${esc(text(behavior.interaction_prompt, behavior.interactionPrompt))}</textarea></label><label class="wide">Observed behavior<textarea name="observed_behavior" placeholder="Describe only what this historical source demonstrably does.">${esc(text(behavior.observed_behavior, behavior.observedBehavior))}</textarea></label><label class="wide">Authored meaning or interpretive note<textarea name="authored_meaning" placeholder="Keep empty when the meaning has not been established.">${esc(text(behavior.authored_meaning, behavior.authoredMeaning))}</textarea></label><label>Source path<input name="source_path" value="${esc(text(behavior.source_path, behavior.sourcePath))}" placeholder="index.html"></label><label>Source symbol / region<input name="source_symbol" value="${esc(text(behavior.source_symbol, behavior.sourceSymbol))}" placeholder="drawRing; deployNodes"></label><label class="aws-check"><input name="public_visible" type="checkbox" ${checked(first(behavior.public_visible, behavior.publicVisible, false)) ? "checked" : ""}> Show this behavior note when the snapshot is public</label></div></fieldset>`;
  }).join("")}</div><div class="aws-actions"><button class="button" type="submit">Save behavior record</button><span data-form-status aria-live="polite"></span></div></form></details>`;
}

async function loadSnapshotCapturePreviews(snapshot) {
  const snapshotId = stableId(snapshot);
  if (!snapshotId) return;
  await Promise.all(asList(first(snapshot.captures, snapshot.capture_derivatives, snapshot.captureDerivatives)).map(async (capture) => {
    const viewport = text(capture.viewport);
    if (!["desktop", "mobile"].includes(viewport)) return;
    try {
      const payload = await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(snapshotId)}/captures/${viewport}/preview`, { method: "POST" });
      const preview = first(payload.preview, payload.capture, payload.record, payload);
      const url = text(preview.preview_url, preview.previewUrl);
      if (url) snapshotCaptureUrls.set(`${snapshotId}:${viewport}`, url);
    } catch { /* A missing capability does not hide the snapshot source record. */ }
  }));
}

function addFilesForm(snapshot) {
  return `<details class="aws-panel"><summary>Add or replace draft files</summary><form class="aws-form" data-snapshot-add-files="${esc(stableId(snapshot))}">
    <p class="aws-help">Use the dependency report's Choose file action for an exact missing path. Use this form for groups of files or folders, then rescan.</p>
    <div class="aws-form-grid"><label>Base folder inside snapshot <small>(optional)</small><input name="base_path" placeholder="assets/images"></label><label>Additional files<input name="files" type="file" multiple></label><label>Complete folder<input name="folder" type="file" webkitdirectory directory multiple></label></div>
    <div class="aws-actions"><button class="button" type="submit">Upload and rescan</button><span data-form-status aria-live="polite"></span></div>
  </form></details>`;
}

function snapshotDetail(snapshot) {
  if (!snapshot) return `<section class="aws-empty aws-detail-empty"><h3>No website snapshots yet.</h3><p>Start the canonical Website Archive record or upload a historical HTML package.</p></section>`;
  const id = stableId(snapshot);
  const findings = credentialFindings(snapshot);
  const fileCount = Number(first(snapshot.file_count, snapshot.fileCount, snapshotFiles(snapshot).length, 0));
  const viewerReady = scanState(snapshot) === "ready" || scanState(snapshot) === "complete";
  return `<article class="aws-detail" data-snapshot-detail="${esc(id)}">
    <header class="aws-detail-head"><div><span class="aws-kicker">Website snapshot · ${esc(snapshotState(snapshot))}</span><h3>${esc(text(snapshot.title, "Untitled website snapshot"))}</h3><p>${esc(text(snapshot.git_commit_message, snapshot.gitCommitMessage, snapshot.git_message, snapshot.gitMessage, "An immutable historical source package and its isolated viewer derivative."))}</p></div><div class="aws-actions"><button class="button" type="button" data-snapshot-preview="${esc(id)}" ${fileCount ? "" : "disabled"}>Issue isolated preview</button><button class="button" type="button" data-snapshot-finalize="${esc(id)}" ${fileCount ? "" : "disabled"}>Rescan files</button>${viewerApproved(snapshot) ? `<button class="button danger-button" type="button" data-viewer-approval="${esc(id)}" data-approved="false">Withdraw viewer approval</button>` : `<button class="button" type="button" data-viewer-approval="${esc(id)}" data-approved="true" ${viewerReady && !findings.length ? "" : "disabled"}>Approve isolated viewer</button>`}</div></header>
    ${findings.length ? `<section class="aws-security-block" role="alert"><strong>Public viewer approval is blocked</strong><p>${findings.length} possible credential finding${findings.length === 1 ? " needs" : "s need"} removal, revocation, or an explicit private-only decision.</p><ul>${findings.map((finding) => `<li>${esc([text(finding.rule, finding.kind), text(finding.path), text(finding.message)].filter(Boolean).join(" · ") || "Possible credential")}</li>`).join("")}</ul></section>` : ""}
    ${previewMarkup(snapshot)}
    ${behaviorEditorMarkup(snapshot)}
    ${snapshotCaptureMarkup(snapshot)}
    <div class="aws-detail-grid"><section class="aws-panel"><h4>Provenance</h4>${provenanceMarkup(snapshot)}</section><section class="aws-panel"><h4>Package</h4><dl class="aws-provenance"><div><dt>Files</dt><dd>${fileCount}</dd></div><div><dt>Scan</dt><dd>${esc(titleCase(scanState(snapshot)))}</dd></div><div><dt>Viewer approval</dt><dd>${viewerApproved(snapshot) ? "Approved" : "Not approved"}</dd></div><div><dt>Public projection</dt><dd>${snapshotState(snapshot) === "published" && viewerApproved(snapshot) ? "Eligible when its record chain is public" : "Internal"}</dd></div></dl></section></div>
    <section class="aws-panel"><div class="aws-section-head"><div><span class="aws-kicker">Referenced files</span><h4>Dependency report</h4></div><span class="aws-pill">${esc(scanState(snapshot))}</span></div>${dependencyReportMarkup(snapshot)}</section>
    ${addFilesForm(snapshot)}
  </article>`;
}

function candidateCommitLabel(candidate) {
  const commits = asList(first(candidate.commit_shas, candidate.commitShas, candidate.commits));
  if (commits.length) return commits.map((commit) => typeof commit === "string" ? commit.slice(0, 8) : text(commit.sha, commit.commit_sha).slice(0, 8)).join(" + ");
  return text(candidate.git_commit_sha, candidate.commit_sha, candidate.gitCommitSha, candidate.commitSha, candidate.id).slice(0, 8);
}

function candidateCard(candidate) {
  const id = text(candidate.id);
  const reasons = asList(first(candidate.scoring_reasons, candidate.scoringReasons, candidate.reasons));
  const currentDecision = text(candidate.review_decision, candidate.reviewDecision, candidate.decision, "pending");
  const captures = asList(first(candidate.captures, candidate.capture_derivatives, candidate.captureDerivatives));
  const captureMarkup = captures.map((capture) => {
    const viewport = text(capture.viewport);
    const previewUrl = candidateCaptureUrls.get(`${id}:${viewport}`) || "";
    if (!previewUrl) return "";
    const hash = text(capture.sha256);
    return `<figure class="aws-candidate-capture-frame" data-viewport="${esc(viewport)}"><img class="aws-candidate-capture" src="${esc(previewUrl)}" alt="Network-blocked ${esc(viewport)} capture for ${esc(text(candidate.title, "this Git candidate"))}"><figcaption>Generated viewer derivative · ${esc(titleCase(viewport))}${hash ? ` · SHA-256 ${esc(hash.slice(0, 12))}…` : ""}</figcaption></figure>`;
  }).join("");
  return `<article class="aws-candidate" data-candidate="${esc(id)}"><header><div><span class="aws-kicker">${esc(candidateCommitLabel(candidate))} · ${esc(formatDate(first(candidate.git_commit_date, candidate.gitCommitDate, candidate.commit_date, candidate.commitDate, candidate.git_commit_at, candidate.committed_at, candidate.committedAt)))}</span><h4>${esc(text(candidate.title, candidate.commit_message, candidate.commitMessage, candidate.message, "Git history candidate"))}</h4></div><span class="aws-pill">${esc(titleCase(currentDecision))}</span></header>
    ${captureMarkup ? `<details class="aws-captured-evidence"><summary>Captured evidence · generated derivatives</summary><div class="aws-candidate-captures">${captureMarkup}</div></details>` : ""}
    <p>${esc(text(candidate.summary, candidate.diff_summary, candidate.diffSummary, "Awaiting a curatorial direction."))}</p>
    ${reasons.length ? `<ul class="aws-reasons">${reasons.map((reason) => `<li>${esc(typeof reason === "string" ? reason : text(reason.label, reason.reason, reason.kind))}</li>`).join("")}</ul>` : ""}
    ${text(candidate.snapshot_id, candidate.snapshotId) ? `<div class="aws-actions"><button class="button" type="button" data-candidate-snapshot="${esc(text(candidate.snapshot_id, candidate.snapshotId))}">Inspect linked live source</button></div>` : ""}
    ${currentDecision === "pending" ? `<form class="aws-form" data-candidate-review="${esc(id)}"><div class="aws-form-grid"><label>Archive decision<select name="decision">${REVIEW_DECISIONS.map(([value, label]) => option(value, label, "approved-state")).join("")}</select></label><label>Existing Version ID <small>(when adding a State)</small><input name="version_id" placeholder="Leave blank to use the candidate's proposed parent"></label><label>Existing State ID <small>(branch or merged evidence)</small><input name="state_id" placeholder="Leave blank to use the proposed parent"></label><label class="wide">Curator direction<textarea name="curator_note" required placeholder="Name the meaningful change or why this candidate should not enter the canonical line."></textarea></label></div><div class="aws-actions"><button class="button" type="submit">Record decision</button><span data-form-status aria-live="polite"></span></div></form>` : `<p class="aws-review-note"><strong>Recorded direction</strong>${esc(text(candidate.curator_note, candidate.curatorNote, "No note supplied."))}</p>`}
  </article>`;
}

async function loadCandidateCapturePreviews() {
  candidateCaptureUrls = new Map();
  await Promise.all(candidates.flatMap((candidate) => {
    const candidateId = text(candidate.id);
    return asList(first(candidate.captures, candidate.capture_derivatives, candidate.captureDerivatives)).map(async (capture) => {
      const viewport = text(capture.viewport);
      if (!candidateId || !["desktop", "mobile"].includes(viewport)) return;
      try {
        const payload = await requestApi(`${CANDIDATE_ENDPOINT}/${encodeURIComponent(candidateId)}/captures/${viewport}/preview`, { method: "POST" });
        const preview = first(payload.preview, payload.capture, payload.record, payload);
        const url = text(preview.preview_url, preview.previewUrl);
        if (url) candidateCaptureUrls.set(`${candidateId}:${viewport}`, url);
      } catch { /* Capture metadata remains visible even if a capability cannot be issued. */ }
    });
  }));
}

function lineageTimelineMarkup() {
  const markerDefinitions = [
    {
      key: "first-commit",
      commit: "11cf57741bc8c03bfca3412e56090591b9abdcdc",
      date: "2026-04-15T20:30:19-04:00",
      title: "First committed landing page",
      description: "The inaugural root index.html: the central ring, breathing eye field, orbiting nodes, pathways, and six living cultures begin here.",
    },
    {
      key: "puzzle-entry-room-introduced",
      commit: "ba4ff83564f2828f9e6deb2f4d6e84a56acdf609",
      date: "2026-06-24T21:44:49-04:00",
      title: "Puzzle / Entry Room introduced",
      description: "The Puzzle first appears at /entry-room/ as a separate exploratory threshold while the existing root landing page remains unchanged.",
    },
    {
      key: "entry-room-home-split",
      commit: "da31b717df5bade789f26709cccd753476ea6721",
      date: "2026-07-07T13:15:04-04:00",
      title: "Puzzle / Entry Room becomes the root",
      description: "The root assumes the entry-threshold role and the former landing-page system moves to /home/.",
    },
  ];
  return `<section id="website-lineage-markers" class="aws-lineage"><header class="aws-section-head"><div><span class="aws-kicker">Route and concept chronology</span><h3>Lineage markers</h3><p>These are separate events: inception, introduction of the Puzzle as a branch, and the later route-role change that made it the root.</p></div></header><ol class="aws-lineage-list">${markerDefinitions.map((marker) => {
    const candidate = candidates.find((record) => text(record.id) === marker.key || text(record.commit_sha, record.commitSha, record.git_commit_sha, record.gitCommitSha).startsWith(marker.commit));
    const snapshot = snapshots.find((record) => text(record.git_commit_sha, record.gitCommitSha).startsWith(marker.commit));
    const synchronized = Boolean(candidate || snapshot);
    return `<li class="aws-lineage-marker"><time datetime="${esc(marker.date)}">${esc(formatDate(marker.date))}</time><div><span class="aws-pill">${esc(marker.commit.slice(0, 8))} · ${synchronized ? "Evidence staged" : "Awaiting synchronization"}</span><h4>${esc(marker.title)}</h4><p>${esc(marker.description)}</p>${snapshot ? `<button class="button" type="button" data-candidate-snapshot="${esc(stableId(snapshot))}">Inspect linked live source</button>` : ""}</div></li>`;
  }).join("")}</ol></section>`;
}

function interactionEvolutionMarkup() {
  return `<section id="website-interaction-evolution" class="aws-lineage aws-interaction-evolution"><header class="aws-section-head"><div><span class="aws-kicker">Git-observed behavior research</span><h3>Interaction evolution</h3><p>This is the comparison map for choosing future States. It records mechanics visible in the source; only separately labeled authored notes establish what those mechanics mean.</p></div></header><ol class="aws-lineage-list">${BEHAVIOR_EVOLUTION_RESEARCH.map(([date, commit, systems, description]) => `<li class="aws-lineage-marker"><time datetime="${esc(date)}">${esc(formatDate(date))}</time><div><div class="aws-system-tags"><span class="aws-pill">${esc(commit)}</span>${systems.map((system) => `<span class="aws-pill">${esc(system)}</span>`).join("")}</div><p>${esc(description)}</p></div></li>`).join("")}</ol></section>`;
}

function render() {
  const selected = selectedSnapshot();
  if (selected && !selectedSnapshotId) selectedSnapshotId = stableId(selected);
  const recordSlug = text(websiteRecord?.archive_slug, websiteRecord?.archiveSlug, websiteRecord?.slug, "the-six-well-construct-website");
  const pending = candidates.filter((candidate) => text(candidate.review_decision, candidate.reviewDecision, candidate.decision, "pending") === "pending").length;
  mountNode.innerHTML = `<section class="construct-manager archive-web-studio">
    <header class="aws-hero"><div><span class="aws-kicker">Archive · Website lineage</span><h2>Website Inception</h2><p class="cm-summary">Preserve exact historical site packages, understand what each file needs, and approve meaningful directions into one enduring Archive record.</p></div><div class="aws-actions"><button class="button" type="button" data-start-website-record>${websiteRecord ? "Open canonical Website record" : "Start Website Archive record"}</button>${websiteRecord ? `<a class="button" href="/archive/records/${encodeURIComponent(recordSlug)}/" target="_blank" rel="noopener">Public record route</a>` : ""}<button class="button" type="button" data-web-refresh>Refresh</button></div></header>
    <div class="aws-boundary-note"><strong>Private working boundary</strong><span>Imports, scans, and Git candidates stay internal until viewer approval and the complete record chain are separately published.</span></div>
    <nav class="aws-local-nav" aria-label="Website Archive workspace"><a href="#website-lineage-markers">Lineage markers <span>3</span></a><a href="#website-interaction-evolution">Interaction evolution <span>${BEHAVIOR_EVOLUTION_RESEARCH.length}</span></a><a href="#website-snapshots">Snapshots <span>${snapshots.length}</span></a><a href="#website-history-review">Git review <span>${pending} pending</span></a></nav>
    ${lineageTimelineMarkup()}
    ${interactionEvolutionMarkup()}
    <section id="website-snapshots" class="aws-workspace"><aside class="aws-library"><div class="aws-section-head"><div><span class="aws-kicker">Source packages</span><h3>Snapshots</h3></div><span class="aws-pill">${snapshots.length}</span></div>${createSnapshotForm()}<div class="aws-snapshot-list">${snapshots.length ? snapshots.map(snapshotCard).join("") : '<div class="aws-empty">No source packages have been staged.</div>'}</div></aside><div class="aws-detail-host">${snapshotDetail(selected)}</div></section>
    <section id="website-history-review" class="aws-history"><header class="aws-section-head"><div><span class="aws-kicker">Curatorial gate</span><h3>Git history review</h3><p>Detection offers evidence, not Archive truth. Every Version, State, branch, merge, or skip remains your decision.</p></div><span class="aws-pill">${pending} pending</span></header><div class="aws-candidate-list">${candidates.length ? candidates.map(candidateCard).join("") : '<div class="aws-empty">No Git candidates have been synchronized yet.</div>'}</div></section>
  </section>`;
}

async function loadSnapshotDetail(id) {
  selectedSnapshotId = id;
  render();
  try {
    const payload = await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(id)}`);
    const detail = recordFrom(payload, "snapshot");
    const index = snapshots.findIndex((snapshot) => stableId(snapshot) === id);
    if (index >= 0) snapshots[index] = { ...snapshots[index], ...detail };
    else snapshots.unshift(detail);
    await loadSnapshotCapturePreviews(detail);
    render();
  } catch (error) {
    reportStatus(error.message);
  }
}

async function loadWorkspace({ preserveSelection = true } = {}) {
  const previous = preserveSelection ? selectedSnapshotId : "";
  mountNode.innerHTML = '<section class="construct-manager archive-web-studio"><div class="cm-notice">Loading Website Archive workspace…</div></section>';
  const [snapshotPayload, candidatePayload] = await Promise.all([requestApi(SNAPSHOT_ENDPOINT), requestApi(CANDIDATE_ENDPOINT)]);
  snapshots = recordsFrom(snapshotPayload, "snapshots", "web_snapshots");
  candidates = recordsFrom(candidatePayload, "candidates", "history_candidates");
  websiteRecord = first(snapshotPayload.website_record, snapshotPayload.websiteRecord, candidatePayload.website_record, candidatePayload.websiteRecord, websiteRecord);
  if (!websiteRecord && snapshots.length) {
    const dossierEntityId = text(snapshots[0].dossier_entity_id, snapshots[0].dossierEntityId);
    if (dossierEntityId) websiteRecord = { id: dossierEntityId, archive_slug: "the-six-well-construct-website" };
  }
  selectedSnapshotId = snapshots.some((snapshot) => stableId(snapshot) === previous) ? previous : stableId(snapshots[0]);
  render();
  await loadCandidateCapturePreviews();
  render();
  if (selectedSnapshotId) await loadSnapshotDetail(selectedSnapshotId);
}

async function uploadEntries(snapshotId, entries, output) {
  validateFileEntries(entries);
  let uploaded = 0;
  for (const entry of entries) {
    output.textContent = `Uploading ${uploaded + 1}/${entries.length} · ${entry.path}`;
    const form = new FormData();
    form.append("file", entry.file, entry.file.name);
    form.append("path", entry.path);
    await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(snapshotId)}/files`, { method: "POST", body: form });
    uploaded += 1;
  }
  output.textContent = `Scanning ${uploaded} uploaded file${uploaded === 1 ? "" : "s"}…`;
  await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(snapshotId)}/finalize`, { method: "POST" });
}

async function createSnapshot(form) {
  const output = form.querySelector("[data-form-status]");
  const entries = filesFromForm(form, { includeEntry: true });
  const dossierEntityId = websiteRecordId();
  if (!dossierEntityId) throw new Error("Start the canonical Website Archive record before uploading a snapshot.");
  const entryPath = normalizePath(form.elements.entry_path.value);
  if (!entries.some((entry) => entry.path === entryPath)) throw new Error(`The selected package does not contain its entry path with exact letter case, ${entryPath}.`);
  output.textContent = "Creating private snapshot…";
  const payload = await requestApi(SNAPSHOT_ENDPOINT, jsonOptions("POST", {
    title: form.elements.title.value.trim(),
    dossier_entity_id: dossierEntityId,
    source_kind: "upload",
    lineage_role: form.elements.lineage_role.value,
    entry_path: entryPath,
  }));
  const snapshot = recordFrom(payload, "snapshot");
  const id = stableId(snapshot);
  if (!id) throw new Error("The snapshot was created without an ID.");
  await uploadEntries(id, entries, output);
  reportStatus("Private website snapshot created and scanned");
  selectedSnapshotId = id;
  await loadWorkspace();
}

async function addSnapshotFiles(form) {
  const output = form.querySelector("[data-form-status]");
  const entries = filesFromForm(form);
  await uploadEntries(form.dataset.snapshotAddFiles, entries, output);
  reportStatus("Snapshot files uploaded and dependency report refreshed");
  await loadWorkspace();
}

async function saveSnapshotBehaviors(form) {
  const output = form.querySelector("[data-form-status]");
  const records = [...form.querySelectorAll("[data-behavior-row]")].map((row, index) => {
    const key = row.dataset.behaviorKey;
    const preset = BEHAVIOR_PRESETS.find(([behaviorKey]) => behaviorKey === key);
    return {
      behavior_key: key,
      title: preset?.[1] || titleCase(key),
      evolution_role: row.querySelector('[name="evolution_role"]').value,
      interaction_prompt: row.querySelector('[name="interaction_prompt"]').value.trim(),
      observed_behavior: row.querySelector('[name="observed_behavior"]').value.trim(),
      authored_meaning: row.querySelector('[name="authored_meaning"]').value.trim(),
      meaning_status: row.querySelector('[name="meaning_status"]').value,
      source_path: row.querySelector('[name="source_path"]').value.trim(),
      source_symbol: row.querySelector('[name="source_symbol"]').value.trim(),
      public_visible: row.querySelector('[name="public_visible"]').checked,
      sort_order: (index + 1) * 10,
    };
  });
  output.textContent = "Saving interaction evidence…";
  await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(form.dataset.snapshotBehaviors)}/behaviors`, jsonOptions("PUT", { records }));
  reportStatus("Snapshot behavior record saved");
  await loadSnapshotDetail(form.dataset.snapshotBehaviors);
}

async function resolveDependency(button) {
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;
  document.body.append(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const entries = [{ file, path: button.dataset.resolveDependency }];
      validateFileEntries(entries);
      reportStatus(`Uploading ${button.dataset.resolveDependency}…`);
      const sink = { set textContent(message) { reportStatus(message); } };
      await uploadEntries(button.dataset.snapshotId, entries, sink);
      reportStatus("Missing dependency supplied and report refreshed");
      await loadWorkspace();
    } catch (error) {
      reportStatus(error.message);
    }
  }, { once: true });
  input.click();
}

async function mapExternalDependency(button) {
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;
  document.body.append(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const suggested = `external-replacements/${file.name}`;
      const supplied = window.prompt(`Snapshot-local path for the replacement of ${button.dataset.originalReference || "this external resource"}:`, suggested);
      if (supplied === null) return;
      const replacementPath = normalizePath(supplied);
      const entries = [{ file, path: replacementPath }];
      validateFileEntries(entries);
      reportStatus(`Storing derivative-only replacement ${replacementPath}…`);
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("path", replacementPath);
      await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(button.dataset.snapshotId)}/dependencies/${encodeURIComponent(button.dataset.mapExternalDependency)}/replacement`, { method: "PUT", body: form });
      reportStatus("External reference retained and mapped to its local replacement");
      await loadWorkspace();
    } catch (error) {
      reportStatus(error.message);
    }
  }, { once: true });
  input.click();
}

async function issuePreview(id) {
  reportStatus("Issuing short-lived isolated preview…");
  const payload = await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(id)}/preview`, { method: "POST" });
  const preview = first(payload.preview, payload.record, payload);
  const url = text(preview.preview_url, preview.previewUrl, preview.viewer_url, preview.viewerUrl);
  if (!url) throw new Error("The preview capability did not include a viewer URL.");
  previewUrls.set(id, url);
  render();
  reportStatus(`Preview ready until ${formatDate(first(preview.expires_at, preview.expiresAt))}`);
}

function resetPreview(scope) {
  const frame = scope.querySelector("iframe[data-preview-src]");
  if (!frame) return;
  const src = frame.dataset.previewSrc;
  frame.src = "about:blank";
  requestAnimationFrame(() => { frame.src = src; });
}

function setViewport(scope, viewport) {
  scope.dataset.viewport = viewport;
  scope.querySelectorAll("[data-admin-viewport]").forEach((button) => {
    const active = button.dataset.adminViewport === viewport;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function startWebsiteRecord() {
  reportStatus("Starting the canonical Website Archive record…");
  const payload = await requestApi(`${SNAPSHOT_ENDPOINT}/start`, { method: "POST" });
  websiteRecord = first(payload.website_record, payload.websiteRecord, payload.record, websiteRecord);
  const snapshot = first(payload.snapshot, null);
  if (snapshot) selectedSnapshotId = stableId(snapshot);
  reportStatus("Canonical Website Archive draft is ready");
  await loadWorkspace();
}

async function reviewCandidate(form) {
  const output = form.querySelector("[data-form-status]");
  const body = {
    decision: form.elements.decision.value,
    curator_note: form.elements.curator_note.value.trim(),
  };
  const versionId = form.elements.version_id.value.trim();
  const stateId = form.elements.state_id.value.trim();
  if (versionId) body.version_id = versionId;
  if (stateId) body.state_id = stateId;
  output.textContent = "Recording decision…";
  await requestApi(`${CANDIDATE_ENDPOINT}/${encodeURIComponent(form.dataset.candidateReview)}/review`, jsonOptions("POST", body));
  reportStatus("Git history decision recorded");
  await loadWorkspace();
}

function bindEvents() {
  eventController?.abort();
  eventController = new AbortController();
  const { signal } = eventController;
  window.addEventListener("hashchange", () => scrollToRequestedWebsiteSection({ behavior: "smooth" }), { signal });
  mountNode.addEventListener("submit", async (event) => {
    const create = event.target.closest("[data-snapshot-create]");
    const addFiles = event.target.closest("[data-snapshot-add-files]");
    const behaviors = event.target.closest("[data-snapshot-behaviors]");
    const candidate = event.target.closest("[data-candidate-review]");
    if (!create && !addFiles && !behaviors && !candidate) return;
    event.preventDefault();
    const form = create || addFiles || behaviors || candidate;
    const submit = form.querySelector('[type="submit"]');
    try {
      if (submit) submit.disabled = true;
      if (create) await createSnapshot(create);
      else if (addFiles) await addSnapshotFiles(addFiles);
      else if (behaviors) await saveSnapshotBehaviors(behaviors);
      else await reviewCandidate(candidate);
    } catch (error) {
      form.querySelector("[data-form-status]").textContent = error.message;
      reportStatus(error.message);
    } finally {
      if (submit?.isConnected) submit.disabled = false;
    }
  }, { signal });
  mountNode.addEventListener("click", async (event) => {
    const open = event.target.closest("[data-snapshot-open]");
    if (open) return loadSnapshotDetail(open.dataset.snapshotOpen);
    const candidateSnapshot = event.target.closest("[data-candidate-snapshot]");
    if (candidateSnapshot) {
      await loadSnapshotDetail(candidateSnapshot.dataset.candidateSnapshot);
      mountNode.querySelector("#website-snapshots")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const resolve = event.target.closest("[data-resolve-dependency]");
    if (resolve) return resolveDependency(resolve);
    const externalReplacement = event.target.closest("[data-map-external-dependency]");
    if (externalReplacement) return mapExternalDependency(externalReplacement);
    const accept = event.target.closest("[data-accept-dependency]");
    if (accept) {
      if (!confirm("Accept this dependency as historically absent? The source reference remains in the record, but it will no longer block isolated viewer approval.")) return;
      try {
        reportStatus("Recording the accepted historical absence…");
        await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(accept.dataset.snapshotId)}`, jsonOptions("PATCH", { accepted_missing_dependency_ids: [accept.dataset.acceptDependency] }));
        reportStatus("Historical absence accepted; source reference preserved");
        return await loadWorkspace();
      } catch (error) {
        reportStatus(error.message);
        return;
      }
    }
    const viewport = event.target.closest("[data-admin-viewport]");
    if (viewport) return setViewport(viewport.closest("[data-admin-web-viewer]"), viewport.dataset.adminViewport);
    const reset = event.target.closest("[data-admin-preview-reset]");
    if (reset) return resetPreview(reset.closest("[data-admin-web-viewer]"));
    try {
      if (event.target.closest("[data-start-website-record]")) return await startWebsiteRecord();
      if (event.target.closest("[data-web-refresh]")) return await loadWorkspace();
      const preview = event.target.closest("[data-snapshot-preview]");
      if (preview) return await issuePreview(preview.dataset.snapshotPreview);
      const finalize = event.target.closest("[data-snapshot-finalize]");
      if (finalize) {
        reportStatus("Refreshing dependency report…");
        await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(finalize.dataset.snapshotFinalize)}/finalize`, { method: "POST" });
        reportStatus("Dependency report refreshed");
        return await loadWorkspace();
      }
      const approval = event.target.closest("[data-viewer-approval]");
      if (approval) {
        const approved = approval.dataset.approved === "true";
        await requestApi(`${SNAPSHOT_ENDPOINT}/${encodeURIComponent(approval.dataset.viewerApproval)}`, jsonOptions("PATCH", { viewer_approved: approved }));
        reportStatus(approved ? "Isolated viewer approved" : "Viewer approval withdrawn");
        return await loadWorkspace();
      }
    } catch (error) {
      reportStatus(error.message);
    }
  }, { signal });
}

export async function mountArchiveWebSnapshots(root, api, status) {
  mountNode = root;
  requestApi = api;
  reportStatus = status;
  previewUrls = new Map();
  ensureStyles();
  bindEvents();
  try {
    await loadWorkspace({ preserveSelection: false });
    scrollToRequestedWebsiteSection();
  } catch (error) {
    mountNode.innerHTML = `<section class="construct-manager archive-web-studio"><div class="cm-notice" data-kind="error">${esc(error.message)}</div><button class="button" type="button" data-web-refresh>Try again</button></section>`;
    reportStatus(error.message);
  }
}

export const archiveWebSnapshotLimits = Object.freeze({
  maxFiles: MAX_FILES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxTextBytes: MAX_TEXT_BYTES,
  maxAssetBytes: MAX_ASSET_BYTES,
  maxAudioVideoBytes: MAX_AV_BYTES,
});
