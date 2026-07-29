import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_CARD_STYLESHEET = 'href="/css/archive-cards.css"';
const ARCHIVE_CARD_PAGES = [
  "archive/index.html",
  "archive/collections/index.html",
  "archive/records/index.html",
];

async function source(file) {
  return readFile(path.join(ROOT, file), "utf8");
}

test("Archive catalogue and dossier pages load the shared card layer once", async () => {
  for (const file of ARCHIVE_CARD_PAGES) {
    const html = await source(file);
    const publicIndex = html.indexOf('href="/css/archive-public.css"');
    const cardsIndex = html.indexOf(ARCHIVE_CARD_STYLESHEET);
    const typographyIndex = html.indexOf('href="/css/site-typography.css"');

    assert.ok(publicIndex >= 0, `${file} does not load archive-public.css`);
    assert.ok(publicIndex < cardsIndex, `${file} must load Archive cards after the public foundation`);
    assert.ok(cardsIndex < typographyIndex, `${file} must load Archive cards before shared typography`);
    assert.equal(html.split(ARCHIVE_CARD_STYLESHEET).length - 1, 1, `${file} must load Archive cards once`);
  }
});

test("Archive record cards own the portfolio geometry and touch reveal", async () => {
  const css = await source("css/archive-cards.css");

  assert.match(css, /\.archive-record-card-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(css, /\.archive-record-card\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*5[\s\S]*border:\s*var\(--archive-rule,\s*5px\)\s*solid/);
  assert.match(css, /\.archive-record-card:hover,[\s\S]*\.archive-record-card:focus-visible\s*\{[\s\S]*border-color:\s*var\(--archive-signal\)/);
  assert.match(css, /@media \(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*\.archive-record-card-meta\s*\{[\s\S]*opacity:\s*1/);

  for (const selector of [
    ".archive-record-card-media",
    ".archive-record-card-placeholder",
    ".archive-record-card-badges",
    ".archive-record-card-catalogue",
    ".archive-record-card-type",
    ".archive-record-card-meta",
    ".archive-record-card-match",
  ]) {
    assert.ok(css.includes(selector), `Archive card CSS is missing ${selector}`);
  }
});

test("Archive record template preserves dossier navigation and catalogue context", async () => {
  const script = await source("js/archive-public.js");

  assert.ok(script.includes("function archiveRecordCardMarkup(record)"));
  assert.ok(script.includes('class="archive-record-card" href="${escapeHtml(recordHref(record, match))}"'));
  assert.ok(script.includes("archive-record-card-catalogue"));
  assert.ok(script.includes("archive-record-card-type"));
  assert.ok(script.includes("archive-record-card-match"));
  assert.ok(script.includes("records.map(archiveRecordCardMarkup)"));
  assert.ok(script.includes('event.target.closest(".archive-record-card")'));
});

test("Notebook thumbnails open one accessible type-aware quick view", async () => {
  const script = await source("js/archive-public.js");
  const css = await source("css/archive-cards.css");
  const publicCss = await source("css/archive-public.css");

  assert.ok(script.includes("function materialThumbnailMarkup"));
  assert.ok(script.includes('class="archive-notebook-item" id="${presentation.id}"'));
  assert.ok(script.includes("data-archive-material-trigger"));
  assert.ok(script.includes('aria-haspopup="dialog"'));
  assert.ok(script.includes('aria-controls="archive-material-dialog"'));
  assert.ok(script.includes('id="archive-material-dialog"'));
  assert.ok(script.includes('aria-labelledby="archive-material-dialog-title"'));
  assert.ok(script.includes("dialog.showModal()"));
  assert.ok(script.includes('dialog.addEventListener("close"'));
  assert.ok(script.includes('window.addEventListener("hashchange", openHashTarget)'));
  assert.ok(script.includes("lastTrigger.focus({ preventScroll: true })"));

  for (const mediaContract of [
    '["image", "photo", "process-photo", "sketch", "final-image", "artifact"]',
    '["audio", "voice-memo", "voice-note"]',
    'material.type === "video"',
    '["document", "pdf"]',
    "material.body",
  ]) {
    assert.ok(script.includes(mediaContract), `Notebook renderer is missing ${mediaContract}`);
  }

  assert.match(css, /\.archive-notebook-trigger\s*\{[\s\S]*aspect-ratio:\s*4\s*\/\s*3[\s\S]*border:\s*var\(--archive-rule,\s*5px\)\s*solid/);
  assert.ok(css.includes(".archive-material-dialog::backdrop"));
  assert.ok(css.includes(".archive-material-dialog-layout"));
  assert.ok(!publicCss.includes(".archive-record-card"), "Archive record-card styles leaked into archive-public.css");
  assert.ok(!publicCss.includes(".archive-notebook-grid"), "Notebook quick-view styles leaked into archive-public.css");
});

test("record dossiers remove UI box frames without flattening hover or artifact frames", async () => {
  const cardsCss = await source("css/archive-cards.css");
  const publicCss = await source("css/archive-public.css");

  assert.match(publicCss, /body\[data-archive-view="record"\]\s+:where\([\s\S]*\.archive-context-group,[\s\S]*\.archive-state-card,[\s\S]*\.archive-connection-card-shell[\s\S]*\)\s*\{[\s\S]*border:\s*0/);
  assert.match(publicCss, /body\[data-archive-view="record"\]\s+\.archive-state-card\.is-current\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(cardsCss, /body\[data-archive-view="record"\]\s+\.archive-notebook-trigger\s*\{[\s\S]*border:\s*0/);

  assert.match(cardsCss, /\.archive-notebook-trigger:hover[\s\S]*\.archive-notebook-trigger:focus-visible/);
  assert.match(cardsCss, /\.archive-notebook-trigger:hover\s+\.archive-notebook-preview img,[\s\S]*transform:\s*scale\(0\.97\)/);
  assert.match(publicCss, /\.archive-context-entry:hover,[\s\S]*background:\s*var\(--archive-panel-raised\)/);
  assert.match(publicCss, /\.archive-connection-card:hover\s*\{[\s\S]*background:\s*var\(--archive-panel-raised\)/);
  assert.match(publicCss, /\.archive-record-figure\s*\{[\s\S]*border:\s*var\(--archive-rule\)\s*solid/);
  assert.match(publicCss, /\.archive-material-viewer\s*\{[\s\S]*border:\s*var\(--archive-rule\)\s*solid/);
});

test("Archive medium context uses one alias system and role-aware node tokens", async () => {
  const script = await source("js/archive-public.js");
  const css = await source("css/archive-public.css");

  assert.ok(script.includes("const archiveMediumAliases = new Map"));
  for (const alias of [
    'artwork: "art"',
    'tattoo: "tattoos"',
    'flash: "tattoos"',
    'merchandise: "merch"',
    'symbols: "legend"',
    'event: "events"',
    'music: "music"',
    'writings: "writings"',
    'film: "film"',
    'other: "archive"',
  ]) {
    assert.ok(script.includes(alias), `Archive medium aliases are missing ${alias}`);
  }

  assert.ok(script.includes("function filteredMediumKey(searchParams)"));
  assert.ok(script.includes('searchParams.get("medium")'));
  assert.ok(script.includes('searchParams.get("record_type")'));
  assert.ok(script.includes("return unique.length === 1 ? unique[0] :"));
  assert.ok(script.includes("resultsHeading.dataset.archiveMedium = mediumKey"));
  assert.ok(script.includes("delete resultsHeading.dataset.archiveMedium"));

  for (const [medium, base, bright] of [
    ["art", "--color-art", "--color-art-bright"],
    ["tattoos", "--color-tattooing", "--color-tattooing-bright"],
    ["merch", "--color-merch", "--color-merch-bright"],
    ["legend", "--color-about", "--color-about-bright"],
    ["events", "--color-events", "--color-events-bright"],
    ["music", "--color-music", "--color-music-bright"],
    ["writings", "--color-writings", "--color-writings-bright"],
    ["film", "--color-film", "--color-film-bright"],
    ["archive", "--color-archive", "--color-archive-bright"],
  ]) {
    const block = new RegExp(`\\[data-archive-medium="${medium}"\\]\\s*\\{[\\s\\S]*?--archive-medium-color:\\s*var\\(${base}\\);[\\s\\S]*?--archive-medium-bright:\\s*var\\(${bright}\\);`);
    assert.match(css, block);
  }

  assert.match(css, /\.archive-results-heading\[data-archive-medium\]\s+h2\s*\{[\s\S]*color:\s*var\(--archive-medium-color\)/);
  assert.match(css, /body\[data-archive-view="record"\][\s\S]*\.archive-medium-mention\s*\{[\s\S]*color:\s*var\(--archive-medium-bright\)/);
  assert.ok(script.includes('data-archive-medium="${escapeHtml(mediumKey)}"'));
  assert.ok(script.includes('class="archive-medium-mention"'));
  assert.ok(script.includes('" archive-medium-mention"'));
});

test("Archive brands resolve to their own medium colors across filters and dossiers", async () => {
  const script = await source("js/archive-public.js");
  const css = await source("css/archive-public.css");

  assert.ok(script.includes("const archiveBrandMediumAliases = new Map"));
  for (const alias of [
    'thoughtpuppet: "art"',
    '"six-well": "merch"',
    '"art-pill-tattoo-house": "tattoos"',
    '"cult-shift": "events"',
    'milowalksonwater: "music"',
    '"mindful-darkness": "writings"',
    'sloth99: "film"',
  ]) {
    assert.ok(script.includes(alias), `Archive brand aliases are missing ${alias}`);
  }

  assert.ok(script.includes("function archiveBrandMediumKey(...values)"));
  assert.ok(script.includes('[searchParams.get("brand"), archiveBrandMediumKey]'));
  assert.ok(script.includes('entry.role === "brand" ? archiveBrandMediumKey(entry.value)'));
  assert.ok(script.includes('role === "brand" ? archiveBrandMediumKey(subject.entity_id, subject.slug, subject.name, subject.title)'));
  assert.ok(script.includes("archive-brand-mention"));
  assert.ok(script.includes('data-archive-medium="${escapeHtml(brandMediumKey)}"'));
  assert.match(css, /\.archive-brand-mention\[data-archive-medium\]\s*\{[\s\S]*color:\s*var\(--archive-medium-bright\)/);
  assert.match(css, /\.archive-context-entry\.archive-brand-mention\[data-archive-medium\]\s+strong,[\s\S]*color:\s*var\(--archive-medium-bright\)/);
});
