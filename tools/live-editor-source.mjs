import { createHash } from "node:crypto";

const COPY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SOURCE_MARKER_PATTERN = /^[a-z0-9._:-]{1,200}$/;
const STYLE_PROPERTIES = Object.freeze({
  color: "color",
  fontFamily: "font-family",
  fontSize: "font-size",
  width: "width",
  height: "height",
  maxWidth: "max-width",
  display: "display",
  opacity: "opacity",
  textTransform: "text-transform",
  textAlign: "text-align",
});

export function contentHash(content) {
  return createHash("sha256").update(String(content || ""), "utf8").digest("hex");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function styleText(styles = {}) {
  const declarations = [];
  for (const [property, cssName] of Object.entries(STYLE_PROPERTIES)) {
    const value = String(styles[property] || "").trim();
    if (!value || /[{};]|url\s*\(|expression\s*\(/i.test(value)) continue;
    declarations.push(`${cssName}: ${value}`);
  }
  return declarations.join("; ");
}

function mergedStyleText(existingStyle, styles) {
  const editorProperties = new Set(Object.values(STYLE_PROPERTIES));
  const preserved = String(existingStyle || "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator === -1) return true;
      return !editorProperties.has(declaration.slice(0, separator).trim().toLowerCase());
    });
  const editorStyle = styleText(styles);
  if (editorStyle) preserved.push(editorStyle);
  return preserved.join("; ");
}

function updateStyleAttribute(openingTag, styles) {
  const styleAttribute = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  const match = openingTag.match(styleAttribute);
  const nextStyle = mergedStyleText(match?.[2] || "", styles);
  if (match) {
    return nextStyle
      ? openingTag.replace(match[0], ` style="${nextStyle.replace(/"/g, "&quot;")}"`)
      : openingTag.replace(match[0], "");
  }
  if (!nextStyle) return openingTag;
  return openingTag.replace(/\s*\/?\s*>$/, (ending) => ` style="${nextStyle.replace(/"/g, "&quot;")}"${ending}`);
}

function editorStylesFromOpeningTag(openingTag) {
  const match = String(openingTag || "").match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  const styles = {};
  if (!match) return styles;
  const propertyNames = Object.fromEntries(Object.entries(STYLE_PROPERTIES).map(([key, cssName]) => [cssName, key]));
  for (const declaration of match[2].split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const cssName = declaration.slice(0, separator).trim().toLowerCase();
    const property = propertyNames[cssName];
    if (property) styles[property] = declaration.slice(separator + 1).trim();
  }
  return styles;
}

function assertSafeEditorHtml(html) {
  const value = String(html || "");
  if (/<\/?(?:script|style|iframe|object|embed|form|input|textarea|select|button)\b/i.test(value)) {
    throw new Error("The edit contains unsupported interactive or executable markup.");
  }
  if (/\son[a-z]+\s*=|javascript\s*:/i.test(value)) {
    throw new Error("The edit contains an unsafe attribute or URL.");
  }
  return value;
}

function matchingElementSpan(source, tagStart, tagName) {
  const openEnd = source.indexOf(">", tagStart);
  if (openEnd === -1) return null;
  const openingTag = source.slice(tagStart, openEnd + 1);
  if (/\/\s*>$/.test(openingTag)) return null;

  const tokenPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}(?=[\\s>/])`, "ig");
  tokenPattern.lastIndex = openEnd + 1;
  let depth = 1;
  let match;
  while ((match = tokenPattern.exec(source))) {
    const isClosing = source[match.index + 1] === "/";
    const tokenEnd = source.indexOf(">", match.index);
    if (tokenEnd === -1) return null;
    if (isClosing) depth -= 1;
    else if (source[tokenEnd - 1] !== "/") depth += 1;
    if (depth === 0) {
      return { tagStart, openEnd, closeStart: match.index, end: tokenEnd, openingTag };
    }
    tokenPattern.lastIndex = tokenEnd + 1;
  }
  return null;
}

function htmlCopySpan(source, copyId) {
  if (!COPY_ID_PATTERN.test(String(copyId || ""))) throw new Error("Invalid copy ID.");
  const attributePattern = new RegExp(`\\bdata-copy-id\\s*=\\s*(["'])${escapeRegExp(copyId)}\\1`, "g");
  const matches = [...String(source).matchAll(attributePattern)];
  if (matches.length !== 1) {
    throw new Error(matches.length ? `Copy ID ${copyId} is duplicated.` : `Copy ID ${copyId} was not found in source.`);
  }

  const attributeIndex = matches[0].index;
  const tagStart = source.lastIndexOf("<", attributeIndex);
  const tagMatch = source.slice(tagStart).match(/^<([A-Za-z][A-Za-z0-9:-]*)\b/);
  if (tagStart === -1 || !tagMatch) throw new Error(`Copy ID ${copyId} is not attached to a normal element.`);
  const span = matchingElementSpan(source, tagStart, tagMatch[1]);
  if (!span) throw new Error(`Copy ID ${copyId} does not have a replaceable element span.`);
  return span;
}

export function readHtmlCopy(source, copyId) {
  const span = htmlCopySpan(String(source), copyId);
  return {
    html: String(source).slice(span.openEnd + 1, span.closeStart),
    styles: editorStylesFromOpeningTag(span.openingTag),
  };
}

export function replaceHtmlCopy(source, { copyId, html, styles }) {
  const span = htmlCopySpan(String(source), copyId);

  const nextOpeningTag = updateStyleAttribute(span.openingTag, styles);
  const safeHtml = assertSafeEditorHtml(html);
  return source.slice(0, span.tagStart) + nextOpeningTag + safeHtml + source.slice(span.closeStart);
}

function sourceMarkerSpan(source, marker) {
  if (!SOURCE_MARKER_PATTERN.test(String(marker || ""))) throw new Error("Invalid source marker.");
  const markerText = `/* live-copy:${marker} */`;
  const positions = [];
  let from = 0;
  while (true) {
    const index = String(source).indexOf(markerText, from);
    if (index === -1) break;
    positions.push(index);
    from = index + markerText.length;
  }
  if (positions.length !== 1) {
    throw new Error(positions.length ? `Source marker ${marker} is duplicated.` : `Source marker ${marker} was not found.`);
  }

  let start = positions[0] + markerText.length;
  while (/\s/.test(source[start] || "")) start += 1;
  const quote = source[start];
  if (quote !== '"' && quote !== "'") throw new Error(`Source marker ${marker} is not followed by a string literal.`);
  let end = start + 1;
  let escaped = false;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) break;
  }
  if (end >= source.length) throw new Error(`Source marker ${marker} has an unterminated string literal.`);
  return { start, end, quote };
}

function decodeSourceLiteral(source, span) {
  const literal = source.slice(span.start, span.end + 1);
  if (span.quote === '"') {
    try { return JSON.parse(literal); } catch { /* fall through to the controlled decoder */ }
  }
  const raw = source.slice(span.start + 1, span.end);
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\\'"nrtbfv0])/g, (match, escape) => {
    if (escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape[0] === "x") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ "\\":"\\", "'":"'", '"':'"', n:"\n", r:"\r", t:"\t", b:"\b", f:"\f", v:"\v", 0:"\0" })[escape] ?? escape;
  });
}

export function readSourceMarker(source, marker) {
  return decodeSourceLiteral(String(source), sourceMarkerSpan(String(source), marker));
}

export function replaceSourceMarker(source, { marker, text }) {
  const span = sourceMarkerSpan(String(source), marker);
  return source.slice(0, span.start) + JSON.stringify(String(text || "")) + source.slice(span.end + 1);
}
