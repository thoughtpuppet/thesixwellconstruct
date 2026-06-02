import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const defaultVaultRoot = "E:\\OBSIDIAN\\The Six Well Construct";
const vaultRoot = process.env.SIXWELL_ARCHIVE_VAULT || defaultVaultRoot;
const recordsDir = path.join(vaultRoot, "Website", "Archive", "Records");
const outputDir = path.join(siteRoot, "assets", "archive");
const outputFile = path.join(outputDir, "records.json");

const requiredFields = [
  "archive_id",
  "title",
  "node",
  "record_type",
  "room",
  "date_or_period",
  "timeline_period",
  "summary",
  "status",
  "visibility",
];

function parseScalar(raw = "") {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(source, fileName) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: source };

  const data = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const arrayItem = line.match(/^\s+-\s+(.*)$/);
    if (arrayItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(arrayItem[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) {
      throw new Error(`${fileName}: unsupported frontmatter line "${line}"`);
    }

    currentKey = pair[1];
    data[currentKey] = parseScalar(pair[2]);
  }

  return { data, body: source.slice(match[0].length) };
}

function extractPublicBody(markdown) {
  const match = markdown.match(/## Public Body\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/);
  const body = match ? match[1] : markdown;
  return body.trim();
}

function markdownToHtml(markdown) {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

function hasPrivatePath(value) {
  if (typeof value === "string") {
    return /[A-Za-z]:\\/.test(value) || value.includes("E:\\OBSIDIAN") || value.includes("OneDrive\\Documents\\GitHub");
  }
  if (Array.isArray(value)) return value.some(hasPrivatePath);
  if (value && typeof value === "object") return Object.values(value).some(hasPrivatePath);
  return false;
}

function cleanAssetList(assets, fileName) {
  return ensureArray(assets).filter((asset) => {
    if (typeof asset !== "string") return false;
    const publicPath = asset.startsWith("/") || asset.startsWith("https://") || asset.startsWith("http://");
    if (!publicPath) {
      console.warn(`${fileName}: skipped asset that is not already a public URL/path: ${asset}`);
    }
    return publicPath;
  });
}

function normalizeRecord(data, body, fileName) {
  const missing = requiredFields.filter((field) => data[field] === undefined || data[field] === "");
  if (missing.length) {
    throw new Error(`${fileName}: missing required fields: ${missing.join(", ")}`);
  }

  const publicBody = extractPublicBody(body);
  const record = {
    archive_id: data.archive_id,
    title: data.title,
    node: data.node,
    record_type: data.record_type,
    room: data.room,
    date_or_period: String(data.date_or_period),
    timeline_period: String(data.timeline_period),
    summary: data.summary,
    body: publicBody,
    body_html: markdownToHtml(publicBody),
    status: data.status,
    visibility: data.visibility,
    assets: cleanAssetList(data.assets, fileName),
    related_notes: ensureArray(data.related_notes),
    related_site_routes: ensureArray(data.related_site_routes),
    why_it_matters: data.why_it_matters || "",
    source_note: fileName,
  };

  if (hasPrivatePath(record)) {
    throw new Error(`${fileName}: public record includes a private local path`);
  }

  return record;
}

async function collectMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = await collectMarkdownFiles(recordsDir);
const records = [];
let skipped = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  const relativeFile = path.relative(recordsDir, file).replace(/\\/g, "/");
  const { data, body } = parseFrontmatter(source, relativeFile);

  if (data.archive_publish !== true || data.visibility !== "public") {
    skipped += 1;
    continue;
  }

  records.push(normalizeRecord(data, body, relativeFile));
}

records.sort((a, b) => `${b.date_or_period} ${b.title}`.localeCompare(`${a.date_or_period} ${a.title}`));

const payload = {
  generated_at: new Date().toISOString(),
  source: "Obsidian: The Six Well Construct/Website/Archive/Records",
  publish_rule: "archive_publish must be true and visibility must be public",
  records,
  filters: {
    rooms: [...new Set(records.map((record) => record.room))].sort(),
    nodes: [...new Set(records.map((record) => record.node))].sort(),
    record_types: [...new Set(records.map((record) => record.record_type))].sort(),
    timeline_periods: [...new Set(records.map((record) => record.timeline_period))].sort(),
  },
  stats: {
    published: records.length,
    skipped,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Archive build complete: ${records.length} published, ${skipped} skipped.`);
console.log(path.relative(siteRoot, outputFile).replace(/\\/g, "/"));

