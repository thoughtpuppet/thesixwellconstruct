import { renderClientEmail } from "./_email-renderer.js";

const CONTENT_KEYS = new Set([
  "subject",
  "preheader",
  "classification",
  "headline",
  "greeting",
  "intro",
  "sections",
  "detailLabels",
  "primaryActionLabel",
  "secondaryActionLabels",
  "notice",
  "outro",
  "signature",
  "footer",
]);

const HTML_PATTERN = /<\s*\/?\s*[a-z][^>]*>/i;
const TOKEN_PATTERN = /{{\s*([a-z0-9_]+)\s*}}/gi;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 10_000) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, limit).trim();
}

function list(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => text(entry))
    .filter(Boolean)
    .slice(0, 30);
}

function stableId(value, prefix, index) {
  const source = text(value, 120).toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return source || `${prefix}_${index + 1}`;
}

function semanticIds(semantic) {
  const next = clone(semantic || {});
  next.details = (Array.isArray(next.details) ? next.details : []).map((entry, index) => ({
    ...entry,
    id: text(entry?.id, 120) || stableId(entry?.label, "detail", index),
  }));
  next.sections = (Array.isArray(next.sections) ? next.sections : []).filter(Boolean).map((entry, index) => ({
    ...entry,
    id: text(entry?.id, 120) || stableId(entry?.title, "section", index),
  }));
  next.secondaryActions = (Array.isArray(next.secondaryActions) ? next.secondaryActions : []).filter(Boolean).map((entry, index) => ({
    ...entry,
    id: text(entry?.id, 120) || stableId(entry?.label, "action", index),
  }));
  return next;
}

function tokenized(value, variables) {
  let output = text(value);
  const entries = Object.entries(variables || {})
    .map(([key, raw]) => [key, text(raw)])
    .filter(([, raw]) => raw)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, raw] of entries) {
    output = output.split(raw).join(`{{${key}}}`);
  }
  return output;
}

function tokenizedList(values, variables) {
  return list(values).map((entry) => tokenized(entry, variables));
}

function interpolate(value, variables) {
  return text(value).replace(TOKEN_PATTERN, (_match, key) => text(variables?.[key]));
}

function interpolateList(values, variables) {
  return list(values).map((entry) => interpolate(entry, variables));
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, output));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => stringsIn(entry, output));
  return output;
}

function tokensIn(value) {
  const found = new Set();
  for (const item of stringsIn(value)) {
    for (const match of item.matchAll(TOKEN_PATTERN)) found.add(match[1]);
  }
  return [...found];
}

function tokenCounts(value) {
  const counts = new Map();
  for (const item of stringsIn(value)) {
    for (const match of item.matchAll(TOKEN_PATTERN)) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return counts;
}

function descriptor(path, label, type = "text", options = {}) {
  return { path, label, type, ...options };
}

export function editableEmailContent(semantic, options = {}) {
  const message = semanticIds(semantic);
  const variables = message.variables || {};
  const omitted = new Set(options.omit || []);
  const content = {
    subject: tokenized(message.subject, variables),
    preheader: tokenized(message.preheader, variables),
    classification: tokenized(message.classification, variables),
    headline: tokenized(message.headline, variables),
    greeting: tokenized(message.greeting, variables),
    intro: tokenizedList(message.intro, variables),
    sections: Object.fromEntries(message.sections.map((section) => [section.id, {
      ...(section.editableTitle === false ? {} : { title: tokenized(section.title, variables) }),
      ...(section.editableParagraphs === false ? {} : { paragraphs: tokenizedList(section.paragraphs, variables) }),
    }]).filter(([, section]) => Object.keys(section).length)),
    detailLabels: Object.fromEntries(message.details
      .filter((detail) => detail.editableLabel !== false)
      .map((detail) => [detail.id, tokenized(detail.label, variables)])),
    primaryActionLabel: tokenized(message.primaryAction?.label, variables),
    secondaryActionLabels: Object.fromEntries(message.secondaryActions.map((action) => [action.id, tokenized(action.label, variables)])),
    notice: tokenizedList(message.notice, variables),
    outro: tokenizedList(message.outro, variables),
    footer: tokenizedList(message.footer, variables),
  };
  if (message.signature) {
    content.signature = {
      closing: tokenized(message.signature.closing, variables),
      name: tokenized(message.signature.name, variables),
      mark: tokenized(message.signature.mark, variables),
    };
  }
  for (const key of omitted) delete content[key];
  return content;
}

export function emailContentSchema(semantic, options = {}) {
  const content = editableEmailContent(semantic, options);
  const fields = [];
  const add = (key, label, type = "text", extra = {}) => {
    if (Object.prototype.hasOwnProperty.call(content, key)) fields.push(descriptor(key, label, type, extra));
  };
  add("subject", "Subject");
  add("preheader", "Preheader");
  add("classification", "Classification");
  add("headline", "Headline", "textarea");
  add("greeting", "Greeting pattern");
  add("intro", "Introduction", "paragraphs");
  Object.entries(content.sections || {}).forEach(([id, section], index) => {
    if (Object.prototype.hasOwnProperty.call(section, "title")) fields.push(descriptor(`sections.${id}.title`, `Section ${index + 1} heading`));
    if (Object.prototype.hasOwnProperty.call(section, "paragraphs")) fields.push(descriptor(`sections.${id}.paragraphs`, `Section ${index + 1} content`, "paragraphs"));
  });
  Object.keys(content.detailLabels || {}).forEach((id) => fields.push(descriptor(`detailLabels.${id}`, `Detail label: ${id.replace(/_/g, " ")}`)));
  add("primaryActionLabel", "Primary action label");
  Object.keys(content.secondaryActionLabels || {}).forEach((id) => fields.push(descriptor(`secondaryActionLabels.${id}`, `Secondary action: ${id.replace(/_/g, " ")}`)));
  add("notice", "Notice or policy copy", "paragraphs", { policy: true });
  add("outro", "Closing content", "paragraphs");
  if (content.signature) {
    fields.push(descriptor("signature.closing", "Signature closing"));
    fields.push(descriptor("signature.name", "Signature name"));
    fields.push(descriptor("signature.mark", "Signature mark"));
  }
  add("footer", "Footer", "paragraphs");
  return {
    fields,
    allowedTokens: Object.keys(semantic?.variables || {}).sort(),
    requiredTokens: tokensIn(content),
  };
}

function validateShape(defaultValue, candidate, path, errors) {
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(candidate)) {
      errors.push(`${path} must be a list.`);
      return;
    }
    if (candidate.length > 30) errors.push(`${path} has too many entries.`);
    candidate.forEach((entry) => {
      if (typeof entry !== "string") errors.push(`${path} entries must be text.`);
    });
    return;
  }
  if (defaultValue && typeof defaultValue === "object") {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const allowed = new Set(Object.keys(defaultValue));
    Object.keys(candidate).forEach((key) => {
      if (!allowed.has(key)) errors.push(`${path}.${key} is not editable.`);
    });
    Object.entries(defaultValue).forEach(([key, value]) => validateShape(value, candidate[key], `${path}.${key}`, errors));
    return;
  }
  if (typeof candidate !== "string") errors.push(`${path} must be text.`);
}

function matchesBlockedCopy(value, patterns = []) {
  if (typeof value !== "string") return false;
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(value);
    }
    return value.toLowerCase().includes(String(pattern || "").toLowerCase());
  });
}

function reconcileShape(defaultValue, candidate, blockedCopyPatterns = []) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(candidate)
      && candidate.every((entry) => typeof entry === "string")
      && !candidate.some((entry) => matchesBlockedCopy(entry, blockedCopyPatterns))
      ? clone(candidate)
      : clone(defaultValue);
  }
  if (defaultValue && typeof defaultValue === "object") {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    return Object.fromEntries(
      Object.entries(defaultValue).map(([key, value]) => [key, reconcileShape(value, source[key], blockedCopyPatterns)]),
    );
  }
  return typeof candidate === "string" && !matchesBlockedCopy(candidate, blockedCopyPatterns) ? candidate : defaultValue;
}

export function reconcileEmailContent(semantic, content, options = {}) {
  const defaults = editableEmailContent(semantic, options);
  if (!content || typeof content !== "object" || Array.isArray(content)) return clone(defaults);
  const removedTokens = new Set(options.removedTokens || []);
  const candidate = clone(content);
  if (removedTokens.size && Array.isArray(candidate.notice)) {
    candidate.notice = candidate.notice.filter((entry) => (
      typeof entry !== "string" || !tokensIn(entry).some((token) => removedTokens.has(token))
    ));
  }
  const blockedCopyPatterns = options.blockedCopyPatterns || [];
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, reconcileShape(value, candidate[key], blockedCopyPatterns)]),
  );
}

export function validateEmailContent(semantic, content, options = {}) {
  const defaults = editableEmailContent(semantic, options);
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, errors: ["Template content must be an object."], content: defaults };
  }
  Object.keys(content).forEach((key) => {
    if (!CONTENT_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(defaults, key)) errors.push(`${key} is not editable.`);
  });
  Object.entries(defaults).forEach(([key, value]) => validateShape(value, content[key], key, errors));
  const allStrings = stringsIn(content);
  if (allStrings.some((entry) => matchesBlockedCopy(entry, options.blockedCopyPatterns || []))) {
    errors.push("Removed client deadline language cannot be restored.");
  }
  if (allStrings.some((entry) => entry.length > 10_000)) errors.push("One or more copy fields exceed 10,000 characters.");
  if (allStrings.join("").length > 50_000) errors.push("Template copy exceeds 50,000 characters.");
  if (allStrings.some((entry) => HTML_PATTERN.test(entry))) errors.push("Raw HTML is not allowed in template copy.");
  const allowedTokens = new Set(Object.keys(semantic?.variables || {}));
  const usedTokens = tokensIn(content);
  usedTokens.forEach((token) => {
    if (!allowedTokens.has(token)) errors.push(`Unknown template variable: {{${token}}}.`);
  });
  const requiredCounts = tokenCounts(defaults);
  const usedCounts = tokenCounts(content);
  for (const [required, count] of requiredCounts) {
    if ((usedCounts.get(required) || 0) < count) errors.push(`Required template variable is missing: {{${required}}}.`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], content: clone(content) };
}

export function applyEmailContent(semantic, content, options = {}) {
  const message = semanticIds(semantic);
  if (!content) return message;
  const validation = validateEmailContent(message, content, options);
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const variables = message.variables || {};
  const copy = validation.content;
  ["subject", "preheader", "classification", "headline", "greeting"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(copy, key)) message[key] = interpolate(copy[key], variables);
  });
  if (copy.intro) message.intro = interpolateList(copy.intro, variables);
  if (copy.sections) message.sections = message.sections.map((section) => ({
    ...section,
    ...(Object.prototype.hasOwnProperty.call(copy.sections[section.id] || {}, "title") ? { title: interpolate(copy.sections[section.id].title, variables) } : {}),
    ...(Object.prototype.hasOwnProperty.call(copy.sections[section.id] || {}, "paragraphs") ? { paragraphs: interpolateList(copy.sections[section.id].paragraphs, variables) } : {}),
  }));
  if (copy.detailLabels) message.details = message.details.map((detail) => ({
    ...detail,
    label: Object.prototype.hasOwnProperty.call(copy.detailLabels, detail.id)
      ? interpolate(copy.detailLabels[detail.id], variables)
      : detail.label,
  }));
  if (Object.prototype.hasOwnProperty.call(copy, "primaryActionLabel") && message.primaryAction) {
    message.primaryAction.label = interpolate(copy.primaryActionLabel, variables);
  }
  if (copy.secondaryActionLabels) message.secondaryActions = message.secondaryActions.map((action) => ({
    ...action,
    label: Object.prototype.hasOwnProperty.call(copy.secondaryActionLabels, action.id)
      ? interpolate(copy.secondaryActionLabels[action.id], variables)
      : action.label,
  }));
  if (copy.notice) message.notice = interpolateList(copy.notice, variables);
  if (copy.outro) message.outro = interpolateList(copy.outro, variables);
  if (copy.signature && message.signature) {
    message.signature = {
      closing: interpolate(copy.signature.closing, variables),
      name: interpolate(copy.signature.name, variables),
      mark: interpolate(copy.signature.mark, variables),
    };
  }
  if (copy.footer) message.footer = interpolateList(copy.footer, variables);
  return message;
}

export function renderEmailContent(semantic, content, options = {}, designProfile = null) {
  return renderClientEmail(applyEmailContent(semantic, content, options), designProfile);
}

export function cloneEmailSemantic(semantic) {
  return semanticIds(semantic);
}
