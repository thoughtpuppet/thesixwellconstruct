import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_TOP_LEVEL = new Set([
  "node_modules",
  "studio",
  "tools",
  "tests",
  "output",
  "prototypes",
  "vendor",
  "dist",
  "coverage",
]);
const EDITABLE_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "figcaption", "blockquote",
  "span", "small", "strong", "em", "a", "button",
]);
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "svg", "canvas",
  "input", "textarea", "select", "template",
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea"]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function tagEnd(source, start) {
  let quote = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      else if (character === "\\") index += 1;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  return -1;
}

function openingTagName(tagText) {
  return tagText.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)\b/)?.[1]?.toLowerCase() || "";
}

function closingTagName(tagText) {
  return tagText.match(/^<\s*\/\s*([A-Za-z][A-Za-z0-9:-]*)\b/)?.[1]?.toLowerCase() || "";
}

function attributeValue(tagText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagText.match(new RegExp(`\\s${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2] || "";
}

function hasAttribute(tagText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\s${escaped}(?:\\s*=|\\s|/?>)`, "i").test(tagText);
}

function meaningfulText(value) {
  return String(value || "")
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length > 0;
}

function pageKey(relativePath) {
  const route = relativePath.replace(/\/index\.html$/i, "").replace(/\.html$/i, "") || "root";
  const readable = route.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
  if (readable.length <= 72) return readable;
  const suffix = createHash("sha256").update(relativePath).digest("hex").slice(0, 10);
  return `${readable.slice(0, 61)}-${suffix}`;
}

function popToClosingTag(stack, name) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].name === name) {
      stack.length = index;
      return;
    }
  }
}

export function analyzeLiveEditorHtml(source, relativePath = "index.html") {
  const stack = [];
  const insertions = [];
  const existingIds = [];
  const ownedElements = [];
  const tagOrdinals = new Map();
  let cursor = 0;

  function isSkipped() {
    return stack.some((entry) => entry.skip);
  }

  function activeEditableOwner() {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].editableOwner) return stack[index].editableOwner;
    }
    return null;
  }

  function markText(text) {
    if (!meaningfulText(text) || isSkipped()) return;
    const owner = activeEditableOwner();
    if (owner) owner.hasText = true;
  }

  while (cursor < source.length) {
    const rawEntry = stack[stack.length - 1];
    if (rawEntry && RAW_TEXT_TAGS.has(rawEntry.name)) {
      const closePattern = new RegExp(`<\\s*\\/\\s*${rawEntry.name}\\s*>`, "ig");
      closePattern.lastIndex = cursor;
      const closeMatch = closePattern.exec(source);
      if (!closeMatch) break;
      cursor = closeMatch.index + closeMatch[0].length;
      popToClosingTag(stack, rawEntry.name);
      continue;
    }

    const nextTag = source.indexOf("<", cursor);
    if (nextTag === -1) {
      markText(source.slice(cursor));
      break;
    }
    markText(source.slice(cursor, nextTag));

    if (source.startsWith("<!--", nextTag)) {
      const commentEnd = source.indexOf("-->", nextTag + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    const end = tagEnd(source, nextTag);
    if (end === -1) break;
    const tagText = source.slice(nextTag, end);
    const closeName = closingTagName(tagText);
    if (closeName) {
      popToClosingTag(stack, closeName);
      cursor = end;
      continue;
    }

    if (/^<\s*[!?]/.test(tagText)) {
      cursor = end;
      continue;
    }

    const name = openingTagName(tagText);
    if (!name) {
      cursor = end;
      continue;
    }

    const explicitCopyId = attributeValue(tagText, "data-copy-id");
    const liveOwner = attributeValue(tagText, "data-live-edit-owner");
    const ignoresEditor = hasAttribute(tagText, "data-live-edit-ignore");
    const parentSkipped = isSkipped();
    const skip = parentSkipped || SKIP_TAGS.has(name) || ignoresEditor || liveOwner === "managed" || liveOwner === "preview";
    let editableOwner = activeEditableOwner();

    if (explicitCopyId) {
      existingIds.push(explicitCopyId);
      ownedElements.push({ kind: "copy", id: explicitCopyId, tag: name });
    } else if (liveOwner) {
      ownedElements.push({ kind: liveOwner, id: attributeValue(tagText, "data-live-edit-marker"), tag: name });
    }

    if (!skip && EDITABLE_TAGS.has(name) && !editableOwner) {
      const ordinal = (tagOrdinals.get(name) || 0) + 1;
      tagOrdinals.set(name, ordinal);
      editableOwner = {
        tag: name,
        ordinal,
        openingEnd: end,
        hasText: false,
        alreadyOwned: Boolean(explicitCopyId || liveOwner),
      };
      if (explicitCopyId || liveOwner) editableOwner.hasText = true;
    }

    const selfClosing = /\/\s*>$/.test(tagText) || VOID_TAGS.has(name);
    if (!selfClosing) stack.push({ name, skip, editableOwner });
    if (selfClosing && editableOwner && editableOwner.hasText && !editableOwner.alreadyOwned) {
      insertions.push(editableOwner);
    }
    cursor = end;
  }

  const finalized = new Set();
  for (const entry of stack) {
    if (entry.editableOwner && entry.editableOwner.hasText && !entry.editableOwner.alreadyOwned) finalized.add(entry.editableOwner);
  }

  // A normal close pops records from the stack, so discover completed owners by replaying
  // their opening positions from candidate starts that received text.
  // The lightweight second pass records only candidates selected by the first-pass rules.
  const completed = collectCompletedCandidates(source, relativePath);
  const candidates = completed.filter((candidate) => candidate.hasText && !candidate.alreadyOwned);
  const key = pageKey(relativePath);
  for (const candidate of candidates) {
    candidate.copyId = `live-${key}-${candidate.tag}-${candidate.ordinal}`;
  }

  const duplicates = existingIds.filter((id, index) => existingIds.indexOf(id) !== index);
  return {
    relativePath,
    source,
    candidates,
    existingIds,
    ownedElements,
    duplicateIds: [...new Set(duplicates)],
  };
}

function collectCompletedCandidates(source) {
  const stack = [];
  const completed = [];
  const tagOrdinals = new Map();
  let cursor = 0;

  const isSkipped = () => stack.some((entry) => entry.skip);
  const activeOwner = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].editableOwner) return stack[index].editableOwner;
    }
    return null;
  };
  const markText = (text) => {
    if (!meaningfulText(text) || isSkipped()) return;
    const owner = activeOwner();
    if (owner) owner.hasText = true;
  };

  while (cursor < source.length) {
    const rawEntry = stack[stack.length - 1];
    if (rawEntry && RAW_TEXT_TAGS.has(rawEntry.name)) {
      const closePattern = new RegExp(`<\\s*\\/\\s*${rawEntry.name}\\s*>`, "ig");
      closePattern.lastIndex = cursor;
      const closeMatch = closePattern.exec(source);
      if (!closeMatch) break;
      cursor = closeMatch.index + closeMatch[0].length;
      while (stack.length) {
        const popped = stack.pop();
        if (popped.name === rawEntry.name) break;
      }
      continue;
    }
    const nextTag = source.indexOf("<", cursor);
    if (nextTag === -1) {
      markText(source.slice(cursor));
      break;
    }
    markText(source.slice(cursor, nextTag));
    if (source.startsWith("<!--", nextTag)) {
      const commentEnd = source.indexOf("-->", nextTag + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }
    const end = tagEnd(source, nextTag);
    if (end === -1) break;
    const tagText = source.slice(nextTag, end);
    const closeName = closingTagName(tagText);
    if (closeName) {
      while (stack.length) {
        const popped = stack.pop();
        if (popped.editableOwner && popped.editableOwner.openingDepth === stack.length) {
          completed.push(popped.editableOwner);
        }
        if (popped.name === closeName) break;
      }
      cursor = end;
      continue;
    }
    if (/^<\s*[!?]/.test(tagText)) {
      cursor = end;
      continue;
    }
    const name = openingTagName(tagText);
    if (!name) {
      cursor = end;
      continue;
    }
    const explicitCopyId = attributeValue(tagText, "data-copy-id");
    const liveOwner = attributeValue(tagText, "data-live-edit-owner");
    const containerOnly = hasAttribute(tagText, "data-live-edit-container");
    const skip = isSkipped() || SKIP_TAGS.has(name) || hasAttribute(tagText, "data-live-edit-ignore") || liveOwner === "managed" || liveOwner === "preview";
    let editableOwner = activeOwner();
    if (!skip && !containerOnly && EDITABLE_TAGS.has(name) && !editableOwner) {
      const ordinal = (tagOrdinals.get(name) || 0) + 1;
      tagOrdinals.set(name, ordinal);
      editableOwner = {
        tag: name,
        ordinal,
        openingEnd: end,
        openingDepth: stack.length,
        hasText: false,
        alreadyOwned: Boolean(explicitCopyId || liveOwner),
      };
    }
    const selfClosing = /\/\s*>$/.test(tagText) || VOID_TAGS.has(name);
    if (selfClosing) {
      if (editableOwner && editableOwner.openingDepth === stack.length) completed.push(editableOwner);
    } else {
      stack.push({ name, skip, editableOwner });
    }
    cursor = end;
  }
  while (stack.length) {
    const popped = stack.pop();
    if (popped.editableOwner && popped.editableOwner.openingDepth === stack.length) completed.push(popped.editableOwner);
  }
  return completed.sort((a, b) => a.openingEnd - b.openingEnd);
}

export function addLiveEditorCopyIds(source, relativePath = "index.html") {
  const analysis = analyzeLiveEditorHtml(source, relativePath);
  let nextSource = source;
  for (const candidate of [...analysis.candidates].sort((a, b) => b.openingEnd - a.openingEnd)) {
    nextSource = `${nextSource.slice(0, candidate.openingEnd - 1)} data-copy-id="${candidate.copyId}">${nextSource.slice(candidate.openingEnd)}`;
  }
  return { ...analysis, source: nextSource, inserted: analysis.candidates.length };
}

async function discoverPublicIndexPages(directory = ROOT, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const top = relative.split("/")[0];
      if (entry.name.startsWith(".") || EXCLUDED_TOP_LEVEL.has(top)) continue;
      pages.push(...await discoverPublicIndexPages(path.join(directory, entry.name), relative));
    } else if (entry.isFile() && entry.name === "index.html") {
      pages.push(relative);
    }
  }
  return pages.sort();
}

export async function auditLiveEditorCoverage({ write = false } = {}) {
  const publicPages = await discoverPublicIndexPages();
  const results = [];
  for (const relativePath of publicPages) {
    const filePath = path.join(ROOT, ...relativePath.split("/"));
    const source = await readFile(filePath, "utf8");
    const loadsEditor = /\/js\/transition\.js/.test(source) && !/data-live-text-editor\s*=\s*(["'])off\1/i.test(source);
    if (!loadsEditor) continue;
    const result = addLiveEditorCopyIds(source, relativePath);
    if (write && result.inserted) await writeFile(filePath, result.source, "utf8");
    results.push({
      relativePath,
      inserted: result.inserted,
      existing: result.existingIds.length,
      owners: result.ownedElements.length,
      duplicates: result.duplicateIds,
    });
  }
  return {
    pages: results,
    totals: {
      pages: results.length,
      inserted: results.reduce((sum, result) => sum + result.inserted, 0),
      existing: results.reduce((sum, result) => sum + result.existing, 0),
      duplicatePages: results.filter((result) => result.duplicates.length).length,
      zeroOwnershipPages: results.filter((result) => result.inserted + result.existing + result.owners === 0).length,
    },
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const json = process.argv.includes("--json");
  const check = process.argv.includes("--check");
  const audit = await auditLiveEditorCoverage({ write });
  if (json) console.log(JSON.stringify(audit, null, 2));
  else {
    console.log(`Live editor coverage: ${audit.totals.pages} pages, ${audit.totals.existing} existing IDs, ${audit.totals.inserted} missing IDs, ${audit.totals.zeroOwnershipPages} zero-ownership pages, ${audit.totals.duplicatePages} duplicate-ID pages.`);
    for (const page of audit.pages.filter((entry) => entry.inserted || entry.duplicates.length || entry.existing + entry.owners === 0)) {
      console.log(`${page.relativePath}: missing=${page.inserted} existing=${page.existing} owners=${page.owners}${page.duplicates.length ? ` duplicates=${page.duplicates.join(",")}` : ""}`);
    }
  }
  if (check && (audit.totals.inserted || audit.totals.zeroOwnershipPages || audit.totals.duplicatePages)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
