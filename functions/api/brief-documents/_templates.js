const POLICY_SCOPE = "It is not final tattoo artwork, a quote, or booking approval.";
const TEMPLATE_KEYS = new Set(["tattoo_build_brief_pdf", "tattoo_maze_brief_pdf"]);
const ACCENTS = {
  tattoo: "#6E0404",
  bright: "#9A2323",
  amber: "#9A5A17",
};
const TEXT_SCALES = { small: 0.92, standard: 1, large: 1.1 };
const DENSITIES = { compact: 0.84, standard: 1, airy: 1.18 };

const SHARED_LABELS = {
  client: "Client",
  reference: "Submission reference",
  submitted: "Submitted",
  placement: "Placement",
  size: "Size / scale",
  budget: "Budget",
  timeline: "Timeline",
  intent: "Design intent",
  notes: "Notes",
};

const DEFAULTS = Object.freeze({
  tattoo_build_brief_pdf: {
    copy: {
      eyebrow: "art.pill TATTOO HOUSE",
      title: "Submitted Build Your Own Brief",
      intro: "A record of the visual language, project direction, and practical details submitted for Studio review.",
      projectHeading: "Project direction",
      artworkHeading: "Selected visual language",
      artworkIntro: "Symbols appear in the order selected. Personal descriptions are preserved with the managed visual-language record.",
      compositionHeading: "Composition reading",
      referencesHeading: "References",
      disclaimer: "This document records the submitted project brief. {{policy_scope}}",
      footer: "art.pill TATTOO HOUSE / THE SIX.WELL CONSTRUCT",
      filenamePrefix: "art-pill-build-brief",
      labels: { ...SHARED_LABELS },
    },
    style: { accent: "tattoo", textScale: "standard", density: "standard" },
  },
  tattoo_maze_brief_pdf: {
    copy: {
      eyebrow: "art.pill TATTOO HOUSE",
      title: "Submitted Maze Brief",
      intro: "A record of the submitted Maze image, explanation, and practical details provided for Studio review.",
      projectHeading: "Project direction",
      artworkHeading: "Submitted Maze",
      artworkIntro: "The image below is the exact Maze artifact submitted with this brief.",
      compositionHeading: "Maze explanation",
      referencesHeading: "References",
      disclaimer: "This document records the submitted project brief. {{policy_scope}}",
      footer: "art.pill TATTOO HOUSE / THE SIX.WELL CONSTRUCT",
      filenamePrefix: "art-pill-maze-brief",
      labels: { ...SHARED_LABELS },
    },
    style: { accent: "tattoo", textScale: "standard", density: "standard" },
  },
});

export function briefTemplateCatalog() {
  return [
    { templateKey: "tattoo_build_brief_pdf", label: "Build Your Own brief", kind: "build" },
    { templateKey: "tattoo_maze_brief_pdf", label: "Maze brief", kind: "maze" },
  ];
}

export function briefTemplateDefault(templateKey) {
  const value = DEFAULTS[templateKey];
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

export function briefTemplateSchema(templateKey) {
  if (!TEMPLATE_KEYS.has(templateKey)) return null;
  return {
    fields: [
      ["copy.eyebrow", "Eyebrow", "text"],
      ["copy.title", "Document title", "text"],
      ["copy.intro", "Introduction", "textarea"],
      ["copy.projectHeading", "Project section heading", "text"],
      ["copy.artworkHeading", templateKey === "tattoo_build_brief_pdf" ? "Symbol section heading" : "Maze image heading", "text"],
      ["copy.artworkIntro", "Artwork section introduction", "textarea"],
      ["copy.compositionHeading", templateKey === "tattoo_build_brief_pdf" ? "Composition heading" : "Explanation heading", "text"],
      ["copy.referencesHeading", "References heading", "text"],
      ["copy.disclaimer", "Required document disclaimer", "textarea", { policy: true }],
      ["copy.footer", "Footer", "text"],
      ["copy.filenamePrefix", "Download filename prefix", "text"],
      ...Object.keys(SHARED_LABELS).map((key) => [`copy.labels.${key}`, `Field label: ${key}`, "text"]),
      ["style.accent", "Accent", "select", { options: [["tattoo", "Tattoo red"], ["bright", "Bright tattoo red"], ["amber", "Construct amber"]] }],
      ["style.textScale", "Text scale", "select", { options: [["small", "Small"], ["standard", "Standard"], ["large", "Large"]] }],
      ["style.density", "Density", "select", { options: [["compact", "Compact"], ["standard", "Standard"], ["airy", "Airy"]] }],
    ].map(([path, label, type, extra]) => ({ path, label, type, ...(extra || {}) })),
    requiredTokens: ["policy_scope"],
  };
}

function text(value, max = 10_000) {
  return String(value ?? "").trim().slice(0, max);
}

function stringsIn(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, result));
  return result;
}

export function validateBriefTemplateContent(templateKey, candidate) {
  const fallback = briefTemplateDefault(templateKey);
  const errors = [];
  if (!fallback || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: ["Template content must be an object."], content: fallback };
  }
  const allowedTop = new Set(["copy", "style"]);
  Object.keys(candidate).forEach((key) => { if (!allowedTop.has(key)) errors.push(`${key} is not editable.`); });
  const copy = candidate.copy;
  const style = candidate.style;
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) errors.push("copy must be an object.");
  if (!style || typeof style !== "object" || Array.isArray(style)) errors.push("style must be an object.");
  const allowedCopy = new Set(Object.keys(fallback.copy));
  Object.keys(copy || {}).forEach((key) => { if (!allowedCopy.has(key)) errors.push(`copy.${key} is not editable.`); });
  for (const key of Object.keys(fallback.copy)) {
    if (key === "labels") continue;
    if (typeof copy?.[key] !== "string" || !text(copy[key])) errors.push(`copy.${key} is required.`);
  }
  if (!text(copy?.disclaimer).includes("{{policy_scope}}")) {
    errors.push("The required {{policy_scope}} variable must remain in the disclaimer.");
  }
  if (!copy?.labels || typeof copy.labels !== "object" || Array.isArray(copy.labels)) {
    errors.push("copy.labels must be an object.");
  } else {
    Object.keys(copy.labels).forEach((key) => { if (!Object.hasOwn(SHARED_LABELS, key)) errors.push(`copy.labels.${key} is not editable.`); });
    Object.keys(SHARED_LABELS).forEach((key) => {
      if (typeof copy.labels[key] !== "string" || !text(copy.labels[key])) errors.push(`copy.labels.${key} is required.`);
    });
  }
  if (!Object.hasOwn(ACCENTS, style?.accent)) errors.push("Choose an approved accent.");
  if (!Object.hasOwn(TEXT_SCALES, style?.textScale)) errors.push("Choose an approved text scale.");
  if (!Object.hasOwn(DENSITIES, style?.density)) errors.push("Choose an approved density.");
  if (stringsIn(candidate).some((value) => /<\s*\/?\s*[a-z][^>]*>/i.test(value))) errors.push("Raw HTML is not allowed.");
  if (stringsIn(candidate).join("").length > 50_000) errors.push("Template content is too large.");
  return { ok: errors.length === 0, errors: [...new Set(errors)], content: JSON.parse(JSON.stringify(candidate)) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeSvg(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])(?!#)[\s\S]*?\1/gi, "");
}

function prettyDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(date);
}

function valueOf(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && text(value)) return Array.isArray(value) ? value.join(", ") : text(value);
  }
  return "Not provided";
}

function detail(label, value) {
  return `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function sizeAndScale(payload) {
  const size = payload?.size ? text(payload.size) : "";
  const scale = payload?.scale ? text(payload.scale) : "";
  if (size && scale && size !== scale) return `${size} / ${scale}`;
  return size || scale || "Not provided";
}

function section(title, body, className = "") {
  if (!body) return "";
  return `<section class="section ${className}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function referenceList(files, links) {
  const values = [];
  (Array.isArray(files) ? files : []).forEach((file) => {
    if (!["maze_json_file"].includes(file?.fieldName) && file?.fileName) values.push(file.fileName);
  });
  if (links && links !== "Not provided") values.push(...String(links).split(/\s*[\n,]\s*/).filter(Boolean));
  return values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="muted">No references were included.</p>`;
}

export function buildBriefSample(kind = "build") {
  const base = {
    id: "demo-submission-014",
    type: kind === "maze" ? "maze_design" : "build_brief",
    contactName: "Jordan Rivera",
    contactEmail: "jordan@example.com",
    createdAt: "2026-07-18T15:30:00.000Z",
    files: [{ fieldName: "references", fileName: "forearm-placement.jpg" }],
  };
  if (kind === "maze") return {
    ...base,
    payload: { placement: "Outer forearm", scale: "5-6 inches", budget_range: "$900-$1,300", timeline: "Fall 2026", maze_explanation: "The open center represents making room for a new direction while the outer path holds the history that led there.", message: "Keep the final form architectural and readable from a distance." },
    mazeImageDataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#d4b271"/><g fill="none" stroke="#211f1d" stroke-width="22"><path d="M120 120H1080V640H120V120ZM260 250H920V510H260V250Z"/><path d="M260 380H470M730 380H920M600 120V270M600 490V640"/></g><circle cx="600" cy="380" r="72" fill="none" stroke="#6E0404" stroke-width="18"/></svg>`),
  };
  return {
    ...base,
    payload: {
      placement: "Upper arm wrapping toward shoulder", size: "6-8 inches", budget_range: "$1,000-$1,500", timeline: "Fall 2026", design_intent: "A grounded composition about protection, transition, and choosing a new direction.", message: "Keep the arrangement open with room for the symbols to breathe.", reference_links: "https://example.com/reference",
      symbol_snapshot: [
        { name: "Threshold", category: "Passage", meaning: "A marked point of entry, change, or decision.", client_note: "The point where I chose to begin again.", imagery: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M18 84V20h64v64M36 84V38h28v46" fill="none" stroke="currentColor" stroke-width="8"/></svg>` },
        { name: "Anchor", category: "Stability", meaning: "A stabilizing commitment that holds while circumstances change.", client_note: "My relationship to family and home.", imagery: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="7"/><path d="M50 34v48M24 60c2 18 12 25 26 25s24-7 26-25M30 60h40" fill="none" stroke="currentColor" stroke-width="7"/></svg>` },
      ],
      client_composition_snapshot: { reading: "Threshold opens the movement; Anchor holds the composition steady while the direction changes." },
      composition_snapshot: { sharedThemes: ["transition", "stability"], appliedRules: [{ type: "sequence", interpretation: "The passage is read before the stabilizing form." }] },
    },
  };
}

export function renderBriefHtml({ templateKey, content, source, mazeImageDataUrl = "" }) {
  const validation = validateBriefTemplateContent(templateKey, content);
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const cfg = validation.content;
  const copy = cfg.copy;
  const payload = source.payload || {};
  const kind = templateKey === "tattoo_maze_brief_pdf" ? "maze" : "build";
  const accent = ACCENTS[cfg.style.accent];
  const scale = TEXT_SCALES[cfg.style.textScale];
  const density = DENSITIES[cfg.style.density];
  const details = [
    detail(copy.labels.placement, valueOf(payload, "placement")),
    detail(copy.labels.size, sizeAndScale(payload)),
    detail(copy.labels.budget, valueOf(payload, "budget_range")),
    detail(copy.labels.timeline, valueOf(payload, "timeline")),
    kind === "build" ? detail(copy.labels.intent, valueOf(payload, "design_intent", "direction", "intent")) : "",
    detail(copy.labels.notes, valueOf(payload, "message")),
  ].join("");
  let artwork = "";
  let composition = "";
  if (kind === "build") {
    const symbols = Array.isArray(payload.symbol_snapshot) ? payload.symbol_snapshot : [];
    artwork = `<p class="section-intro">${escapeHtml(copy.artworkIntro)}</p><div class="symbols">${symbols.map((symbol, index) => `<article class="symbol"><div class="symbol-image" style="color:${accent}">${safeSvg(symbol.imagery)}</div><div><p class="ordinal">${String(index + 1).padStart(2, "0")} / ${escapeHtml(symbol.category || "Visual language")}</p><h3>${escapeHtml(symbol.name || `Symbol ${index + 1}`)}</h3><p>${escapeHtml(symbol.meaning || "")}</p>${symbol.client_note ? `<blockquote>${escapeHtml(symbol.client_note)}</blockquote>` : ""}</div></article>`).join("")}</div>`;
    const clientReading = payload.client_composition_snapshot?.reading || payload.composition_reading || payload.composition_snapshot?.reading || "No composition reading was included.";
    const themes = payload.composition_snapshot?.sharedThemes || payload.shared_composition_themes || [];
    const rules = payload.composition_snapshot?.appliedRules || payload.authored_composition_rules || [];
    composition = `<p class="reading">${escapeHtml(clientReading)}</p>${themes.length ? `<p class="meta"><strong>Shared themes:</strong> ${escapeHtml(themes.join(", "))}</p>` : ""}${rules.length ? `<ul>${rules.map((rule) => `<li>${escapeHtml(rule.interpretation || rule.type || rule)}</li>`).join("")}</ul>` : ""}`;
  } else {
    artwork = `<p class="section-intro">${escapeHtml(copy.artworkIntro)}</p>${mazeImageDataUrl ? `<figure class="maze"><img src="${escapeHtml(mazeImageDataUrl)}" alt="Submitted Maze design"></figure>` : `<p class="muted">The submitted Maze image is unavailable in this preview.</p>`}`;
    composition = `<p class="reading">${escapeHtml(valueOf(payload, "maze_explanation"))}</p>`;
  }
  const disclaimer = copy.disclaimer.replaceAll("{{policy_scope}}", POLICY_SCOPE);
  const filenamePrefix = text(copy.filenamePrefix, 80).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "art-pill-brief";
  const filename = `${filenamePrefix}-${String(source.id || "submission").replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 12)}.pdf`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(copy.title)}</title><style>
    @page{size:letter;margin:.56in .58in .64in}.page-break{break-before:page}*{box-sizing:border-box}html{background:#FFE7CA}body{margin:0;background:#FFE7CA;color:#0E0E0E;font-family:Arial,sans-serif;font-size:${11 * scale}px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{border-top:5px solid ${accent};padding-top:${18 * density}px;margin-bottom:${28 * density}px}.eyebrow,.ordinal,dt,.footer{font-size:${8.5 * scale}px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.eyebrow{color:${accent};margin:0 0 8px}h1{font-family:Georgia,serif;font-size:${31 * scale}px;line-height:1.02;margin:0;max-width:520px}header>.intro{font-family:Georgia,serif;color:#4c3d32;max-width:520px;margin:14px 0 0}.identity{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:${22 * density}px}.identity div,.detail{border-top:5px solid rgba(110,4,4,.22);padding-top:8px}.identity span{display:block}.identity strong{display:block;margin-top:4px;font-size:${10.5 * scale}px}.section{break-inside:auto;margin:${28 * density}px 0 0}.section>h2{font-family:Georgia,serif;font-size:${20 * scale}px;margin:0 0 ${12 * density}px;color:${accent};break-after:avoid-page}.section-intro,.muted{font-family:Georgia,serif;color:#5e4b3e;max-width:560px}.section-intro{break-after:avoid-page}.composition-section,.maze-artwork{break-inside:avoid-page}.maze-artwork{break-before:page}.details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${14 * density}px 18px}.detail{break-inside:avoid}.detail dt{color:${accent}}.detail dd{margin:5px 0 0;white-space:pre-wrap}.symbols{display:grid;gap:${15 * density}px}.symbol{display:grid;grid-template-columns:105px 1fr;gap:16px;border:5px solid rgba(110,4,4,.18);padding:${14 * density}px;break-inside:avoid}.symbol-image{width:96px;height:96px;display:grid;place-items:center}.symbol-image svg{max-width:88px;max-height:88px;width:100%;height:100%}.symbol h3{font-family:Georgia,serif;font-size:${16 * scale}px;margin:2px 0 7px}.symbol p{margin:0 0 7px}.ordinal{color:${accent}}blockquote{margin:8px 0 0;padding:8px 12px;border-left:5px solid ${accent};font-family:Georgia,serif;color:#5e4b3e}.reading{font-family:Georgia,serif;font-size:${14 * scale}px;line-height:1.65;margin:0}.meta{margin-top:12px}.maze{margin:12px 0 0;border:5px solid rgba(110,4,4,.25);padding:10px;background:#d4b271;break-inside:avoid}.maze img{display:block;width:100%;height:auto;max-height:470px;object-fit:contain}ul{padding-left:18px}.policy{border:5px solid ${accent};padding:${14 * density}px;margin-top:${30 * density}px;font-family:Georgia,serif;break-inside:avoid}.footer{margin-top:22px;padding-top:10px;border-top:5px solid rgba(110,4,4,.2);display:flex;justify-content:space-between;color:#5e4b3e}
  </style></head><body><header><p class="eyebrow">${escapeHtml(copy.eyebrow)}</p><h1>${escapeHtml(copy.title)}</h1><p class="intro">${escapeHtml(copy.intro)}</p><div class="identity"><div><span class="eyebrow">${escapeHtml(copy.labels.client)}</span><strong>${escapeHtml(source.contactName || "Client")}</strong></div><div><span class="eyebrow">${escapeHtml(copy.labels.reference)}</span><strong>${escapeHtml(source.id || "")}</strong></div><div><span class="eyebrow">${escapeHtml(copy.labels.submitted)}</span><strong>${escapeHtml(prettyDate(source.createdAt))}</strong></div></div></header>${section(copy.projectHeading, `<dl class="details">${details}</dl>`)}${section(copy.artworkHeading, artwork, kind === "maze" ? "maze-artwork" : "")}${section(copy.compositionHeading, composition, "composition-section")}${section(copy.referencesHeading, referenceList(source.files, valueOf(payload, "reference_links")))}<aside class="policy">${escapeHtml(disclaimer)}</aside><div class="footer"><span>${escapeHtml(copy.footer)}</span><span>${escapeHtml(source.id || "")}</span></div></body></html>`;
  return { html, filename, content: validation.content };
}
