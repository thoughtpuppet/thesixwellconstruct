import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { handleConstructApi, selectExploreDestination } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    db.exec(read(join("migrations", name)));
  }
  return db;
}

function runtime(db) { return { SUBMISSIONS_DB: new LocalD1(db) }; }
function request(path, method = "GET") { return new Request(`https://example.test${path}`, { method }); }

function destination(scope, key, medium = "art", entityKey = key) {
  return { key, scope, kind: "test", medium: { id: medium, label: medium.toUpperCase() }, title: key, route: `/test/${key}/`, entityKey };
}

function exploreElement({ dataset = {}, hidden = false } = {}) {
  const events = {};
  return {
    attributes: {}, dataset: { ...dataset }, disabled: false, hidden, textContent: "", title: "", parentElement: null,
    addEventListener(name, handler) { events[name] = handler; },
    dispatch(name, event = {}) { return events[name]?.(event); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

function exploreClientHarness({ storedPortal = null, responses = [] } = {}) {
  const pageEvents = {};
  const storage = new Map();
  if (storedPortal) storage.set("sixwell_explore_portal_v1", JSON.stringify(storedPortal));
  const buttons = ["all", "works", "process", "pages"].map((scope) => exploreElement({ dataset: { exploreScope: scope } }));
  const room = exploreElement({ dataset: { exploreState: "loading", exploreActiveScope: "all" } });
  const actionGroup = exploreElement();
  const status = exploreElement({ dataset: { state: "loading" } });
  const portal = exploreElement({ hidden: true });
  const browsingLabel = exploreElement();
  const preview = exploreElement({ dataset: { explorePreviewState: "idle" } });
  const previewFrame = exploreElement();
  previewFrame.parentElement = preview;
  previewFrame.setAttribute("src", "about:blank");
  const previewStatus = exploreElement();
  const previewMedium = exploreElement();
  const previewTitle = exploreElement();
  const diveAgain = exploreElement();
  const enterPage = exploreElement();
  const backToBoard = exploreElement();
  const selectorMap = new Map([
    ["[data-explore-room]", room], ["[data-explore-actions]", actionGroup], ["[data-explore-status]", status],
    ["[data-explore-portal]", portal], ["[data-explore-browsing-label]", browsingLabel],
    ["[data-explore-preview-frame]", previewFrame],
    ["[data-explore-preview-status]", previewStatus], ["[data-explore-preview-medium]", previewMedium],
    ["[data-explore-preview-title]", previewTitle], ["[data-explore-dive-again]", diveAgain],
    ["[data-explore-enter-page]", enterPage], ["[data-explore-back-to-board]", backToBoard],
  ]);
  const document = {
    querySelector(selector) { return selectorMap.get(selector) || null; },
    querySelectorAll(selector) { return selector === "[data-explore-scope]" ? buttons : []; },
  };
  const fetchCalls = [];
  const window = {
    addEventListener(name, handler) { pageEvents[name] = handler; },
    clearTimeout() {},
    setTimeout() { return 1; },
    location: { href: "" },
    _constructFade(route) { this.fadedTo = route; },
  };
  const sessionStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    const payload = responses.shift() || {};
    return { ok: payload.ok !== false, async json() { return payload; } };
  };
  runInNewContext(read("js/explore.js"), { document, window, sessionStorage, URLSearchParams, fetch });
  return {
    actionGroup, backToBoard, browsingLabel, buttons, diveAgain, enterPage, fetchCalls, pageEvents, portal, preview,
    previewFrame, previewMedium, previewStatus, previewTitle, room, status, storage, window,
  };
}

const flushExploreClient = () => new Promise((resolve) => setImmediate(resolve));

test("all-site selection uses 50/30/20 family bands and omits unavailable families", () => {
  const pools = {
    works: [destination("works", "work")],
    process: [destination("process", "process")],
    pages: [destination("pages", "page")],
  };
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.1).destination.scope, "works");
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.6).destination.scope, "process");
  assert.equal(selectExploreDestination(pools, "all", [], () => 0.9).destination.scope, "pages");
  assert.equal(selectExploreDestination({ works: [], process: [], pages: pools.pages }, "all", [], () => 0).destination.scope, "pages");
});

test("selection balances medium, canonical entity, and surface instead of row volume", () => {
  const dense = Array.from({ length: 20 }, (_, index) => destination("works", `dense-${index}`, "art", "dense"));
  const sparseMedium = [destination("works", "tattoo-one", "tattoos", "tattoo-one")];
  assert.equal(selectExploreDestination({ works: [...dense, ...sparseMedium] }, "works", [], () => 0.75).destination.medium.id, "tattoos");

  const entityA = Array.from({ length: 12 }, (_, index) => destination("works", `a-${index}`, "art", "a"));
  const entityB = [destination("works", "b-one", "art", "b")];
  assert.equal(selectExploreDestination({ works: [...entityA, ...entityB] }, "works", [], () => 0.75).destination.key, "b-one");
});

test("exclusions prevent repeats and restart only after a scope is exhausted", () => {
  const pools = { works: [destination("works", "one"), destination("works", "two")] };
  const fresh = selectExploreDestination(pools, "works", ["one"], () => 0);
  assert.equal(fresh.destination.key, "two");
  assert.equal(fresh.restarted, false);
  const restarted = selectExploreDestination(pools, "works", ["one", "two"], () => 0);
  assert.equal(restarted.destination.key, "one");
  assert.equal(restarted.restarted, true);
});

test("Explore API validates scope, rejects methods, and always disables caching", async () => {
  const db = database();
  const invalid = await handleConstructApi(request("/api/site/explore?scope=unknown"), runtime(db));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const method = await handleConstructApi(request("/api/site/explore", "POST"), runtime(db));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("cache-control"), "no-store");
});

test("works and pages only return eligible public internal destinations", async () => {
  const db = database();
  db.exec(`
    UPDATE content_entities SET visibility='internal',search_visibility=0;
    UPDATE archive_dossiers SET state='draft',public_visible=0;
    UPDATE construct_nodes SET homepage_enabled=0;
    UPDATE construct_pathways SET homepage_enabled=0;

    UPDATE content_entities SET visibility='public',search_visibility=1 WHERE id='art-marbles';
    UPDATE search_documents SET state='published',route='/art/lostmarblespainting' WHERE entity_id='art-marbles';

    UPDATE content_entities SET visibility='private',search_visibility=1 WHERE id IN (SELECT entity_id FROM search_documents WHERE entity_id<>'art-marbles');

    UPDATE content_entities SET visibility='public' WHERE id='node-about';
    UPDATE construct_nodes SET state='published',homepage_enabled=1,route='/about/' WHERE id='node-about';
    UPDATE content_entities SET visibility='public' WHERE id='path-about-01';
    UPDATE construct_pathways SET state='published',homepage_enabled=1,route='https://outside.example/' WHERE id='path-about-01';
    UPDATE content_entities SET visibility='public' WHERE id='path-about-02';
    UPDATE construct_pathways SET state='published',homepage_enabled=1,route='/booking/studio/' WHERE id='path-about-02';
    UPDATE content_entities SET visibility='public' WHERE id='path-about-03';
    UPDATE construct_pathways SET state='published',homepage_enabled=1,route='/adventure/' WHERE id='path-about-03';
  `);
  const works = await handleConstructApi(request("/api/site/explore?scope=works"), runtime(db));
  assert.equal(works.status, 200);
  assert.equal(works.headers.get("cache-control"), "no-store");
  const workPayload = await works.json();
  assert.equal(workPayload.destination.route, "/art/lostmarblespainting");
  assert.equal(workPayload.destination.medium.id, "art");
  assert.deepEqual(Object.keys(workPayload.destination).sort(), ["key", "kind", "medium", "route", "scope", "title"]);

  const pages = await handleConstructApi(request("/api/site/explore?scope=pages"), runtime(db));
  assert.equal(pages.status, 200);
  assert.equal((await pages.json()).destination.route, "/about/");
});

test("process selection reuses record publication, media privacy and presentation, and public-included gates", async () => {
  const db = database();
  db.exec(`
    UPDATE content_entities SET visibility='internal';
    UPDATE archive_dossiers SET state='draft',public_visible=0;
    UPDATE archive_materials SET state='draft',visibility='internal';
    UPDATE archive_source_material_sets SET publication_state='draft',visibility='internal';
    UPDATE content_entities SET visibility='public' WHERE id='art-marbles';
    UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id='art-marbles';

    INSERT INTO archive_materials(id,dossier_entity_id,material_type,title,body,visibility,state,created_at,updated_at)
      VALUES('explore-public-note','art-marbles','note','Public studio note','A public process note.','public','published',datetime('now'),datetime('now'));
    INSERT INTO archive_materials(id,dossier_entity_id,material_type,title,body,visibility,state,created_at,updated_at)
      VALUES('explore-private-note','art-marbles','note','Private studio note','Never public.','private','published',datetime('now'),datetime('now'));
    INSERT INTO media_assets(id,source_url,mime_type,privacy,state,created_at,updated_at,public_presentation)
      VALUES('explore-hidden-media','/private/hidden.jpg','image/jpeg','public','active',datetime('now'),datetime('now'),'hidden');
    INSERT INTO archive_materials(id,dossier_entity_id,media_id,material_type,title,visibility,state,created_at,updated_at)
      VALUES('explore-hidden-photo','art-marbles','explore-hidden-media','process-photo','Hidden process photo','public','published',datetime('now'),datetime('now'));
  `);
  assert.deepEqual({...db.prepare("SELECT privacy,state,public_presentation FROM media_assets WHERE id='explore-hidden-media'").get()},{privacy:"public",state:"active",public_presentation:"hidden"});
  assert.deepEqual({...db.prepare("SELECT state,visibility FROM archive_materials WHERE id='explore-hidden-photo'").get()},{state:"published",visibility:"public"});
  assert.deepEqual({...db.prepare("SELECT state,public_visible FROM archive_dossiers WHERE entity_id='art-marbles'").get()},{state:"published",public_visible:1});
  const response = await handleConstructApi(request("/api/site/explore?scope=process"), runtime(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.destination.key, "process:material:explore-public-note");
  assert.match(payload.destination.route, /^\/archive\/records\/[^/]+\/#/);
  assert.doesNotMatch(payload.destination.route, /hidden\.jpg|\/api\//);
  const excluded = await handleConstructApi(request(`/api/site/explore?scope=process&exclude=${payload.destination.key}`), runtime(db));
  assert.equal((await excluded.json()).restarted, true);
});

test("empty eligible pools return a retryable no-store response", async () => {
  const db = database();
  db.exec("UPDATE content_entities SET visibility='internal'; UPDATE archive_dossiers SET public_visible=0; UPDATE construct_nodes SET homepage_enabled=0; UPDATE construct_pathways SET homepage_enabled=0;");
  const response = await handleConstructApi(request("/api/site/explore?scope=all"), runtime(db));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Explore is an immersive room with semantic sculptural controls", () => {
  const html = read("adventure/index.html");
  const css = read("css/explore.css");
  const room = read("js/explore-room.js");
  const client = read("js/explore.js");
  const nav = read("js/construct-nav.js");
  const transition = read("js/transition.js");
  const wayfinding = read("js/construct-wayfinding.js");
  const guide = read("tools/ui-guide-system.js");
  const worker = read("_worker.js");

  assert.match(html, /<main\b[^>]*\bdata-explore-room\b/);
  assert.match(html, /<h1\b[^>]*>\s*Explore\.?\s*<\/h1>/);
  assert.match(html, /<div\b[^>]*\bexplore-atmosphere\b[^>]*aria-hidden="true"/);
  assert.match(html, /<canvas\b[^>]*\bdata-explore-eyes\b/);
  assert.match(html, /<canvas\b[^>]*\bdata-explore-particles\b/);
  assert.match(html, /<div\b[^>]*\bexplore-scene\b[^>]*aria-hidden="true"/);
  assert.match(html, /<canvas\b[^>]*\bdata-explore-scene-canvas\b/);
  assert.match(html, /<script src="\/js\/construct-ambient-field\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/js\/explore-room\.js"><\/script>/);
  for (const [scope, label, description] of [
    ["all", "Take me anywhere", "Across the entire domain\."],
    ["works", "Works &amp; objects", "Art, objects, events &amp; archives\."],
    ["process", "Process &amp; evidence", "Sketches, notes, bts media &amp; voice memos\."],
    ["pages", "Pages &amp; pathways", "whole pages, guides, portfolios &amp; pathways\."],
  ]) {
    const action = html.match(new RegExp(`<button[^>]+data-explore-scope="${scope}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(action, new RegExp(`aria-describedby="explore-description-${scope}"`));
    assert.match(action, new RegExp(`<span class="explore-action__label">${label}<\\/span>`));
    assert.match(action, new RegExp(`<span class="explore-action__description" id="explore-description-${scope}">${description}<\\/span>`));
  }
  assert.match(html, /data-explore-scope="all" data-explore-shape="disc" aria-label="Take me anywhere"/);
  assert.match(html, /data-explore-status[^>]*aria-live="polite"/);
  assert.match(html, /<section[^>]+data-explore-portal[^>]+hidden/);
  assert.match(html, /data-explore-browsing-label>Browsing entire site<\/p>/);
  assert.match(html, /<iframe[\s\S]*?data-explore-preview-frame[\s\S]*?tabindex="-1"[\s\S]*?aria-hidden="true"[\s\S]*?inert[\s\S]*?sandbox="allow-scripts allow-same-origin"/);
  assert.match(html, /data-explore-preview-medium/);
  assert.match(html, /data-explore-preview-title/);
  assert.match(html, /data-explore-dive-again>Dive again/);
  assert.match(html, /data-explore-enter-page>Enter page/);
  assert.match(html, /data-explore-back-to-board>Back to diving board/);
  assert.doesNotMatch(html, /data-venture=|href="\/css\/hero\.css"/);
  assert.doesNotMatch(html, /\bsite-hero\b|\bhero-title\b|\bhero-descriptor\b|\bconstruct-breadcrumb\b|\bexplore-panel\b|<footer\b/);
  assert.match(html, /<body data-live-text-editor="off" data-construct-wayfinding="off">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/thesixwellconstruct\.com\/adventure\/">/);

  assert.match(css, /(?:html|body)[^{]*\{[^}]*background:\s*var\(--color-bg\)/s);
  assert.match(css, /\.explore-room\s*\{[^}]*min-height:\s*100(?:s|d|l)?vh/s);
  assert.match(css, /\.explore-action[^}]*min-(?:width|height):\s*(?:var\(--control-min-height,\s*)?44px/s);
  assert.match(css, /\.explore-action:focus-visible/);
  assert.match(css, /--explore-description:\s*rgba\(252,\s*184,\s*103,\s*0\.55\)/);
  assert.match(css, /\.explore-action:hover \.explore-action__label,[\s\S]*?color:\s*var\(--explore-focus\)/);
  assert.match(css, /\.explore-action__description\s*\{[\s\S]*?opacity:\s*0[\s\S]*?transform:\s*translate\(-50%,\s*-8px\)/);
  assert.match(css, /\.explore-action:hover \.explore-action__description,[\s\S]*?opacity:\s*1[\s\S]*?transform:\s*translate\(-50%,\s*0\)/);
  assert.match(css, /@media\s*\(hover:\s*none\)[\s\S]*?\.explore-action__description[\s\S]*?opacity:\s*1/);
  assert.match(css, /\.explore-room\[data-explore-renderer="fallback"\]/);
  assert.match(css, /\.explore-action::before/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  for (const [scope, signal] of [["works", "--explore-orange"], ["process", "--explore-yellow"], ["pages", "--explore-blue"]]) {
    assert.match(css, new RegExp(`data-explore-active-scope="${scope}"[\\s\\S]*?--explore-active-signal:\\s*var\\(${signal}\\)`));
  }
  assert.match(css, /\.explore-portal\s*\{[\s\S]*?border-left:\s*5px solid var\(--explore-active-signal\)[\s\S]*?background:\s*var\(--color-bg\)/);
  assert.match(css, /\.explore-portal__browsing\s*\{[\s\S]*?color:\s*var\(--explore-active-copy\)[\s\S]*?text-transform:\s*uppercase/);
  assert.match(css, /\.explore-portal__preview\s*\{[\s\S]*?border:\s*5px solid var\(--explore-destination-signal\)[\s\S]*?background:\s*var\(--color-bg\)/);
  for (const [node, signal] of [
    ["tattoos", "--color-tattooing"], ["art", "--color-art"], ["merch", "--color-merch"],
    ["events", "--color-events"], ["music", "--color-music"], ["writings", "--color-writings"],
    ["archive", "--color-archive"], ["film", "--color-film"],
  ]) {
    assert.match(css, new RegExp(`data-explore-destination-node="${node}"[\\s\\S]*?--explore-destination-signal:\\s*var\\(${signal}\\)`));
  }
  assert.match(css, /\.explore-portal\s*\{[\s\S]*?--explore-destination-signal:\s*var\(--color-about\)/);
  assert.match(css, /\.explore-portal__frame\s*\{[\s\S]*?inset:\s*0[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(css, /\.explore-portal__frame\s*\{[^}]*transform:\s*scale/s);
  assert.match(css, /\.explore-portal__action--again\s*\{[\s\S]*?background:\s*var\(--color-bg\)[\s\S]*?color:\s*var\(--explore-active-copy\)/);
  assert.match(css, /\.explore-portal__action--enter\s*\{[\s\S]*?background:\s*var\(--explore-active-signal\)[\s\S]*?color:\s*var\(--explore-active-ink\)/);
  assert.match(css, /\.explore-portal__action,[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.explore-portal\s*\{[\s\S]*?top:\s*30%[\s\S]*?border-top:\s*5px solid var\(--explore-active-signal\)/);

  assert.match(room, /from\s+["']\/entry-room\/3d\/vendor\/three\.module\.js["']/);
  assert.match(room, /all:\s*\{[\s\S]*?color:\s*0xd01006[\s\S]*?geometry:\s*\(\)\s*=>\s*prismGeometry\(48\)/i);
  assert.doesNotMatch(room, /SphereGeometry/);
  assert.doesNotMatch(room, /MeshPhysicalMaterial/);
  assert.match(room, /0xD01006/i);
  assert.match(room, /new THREE\.CylinderGeometry\(1,\s*1,\s*0\.46,\s*segments\)/);
  for (const [segments, color] of [[4, "F06C00"], [3, "FFBB00"], [6, "006EFF"]]) {
    assert.match(room, new RegExp(`prismGeometry\\(${segments}(?:,|\\))`));
    assert.match(room, new RegExp(`0x${color}`, "i"));
  }
  assert.match(room, /flatShading:\s*true/);
  assert.match(room, /roughness:\s*1(?:\.0)?/);
  assert.match(room, /metalness:\s*0(?:\.0)?/);
  assert.match(room, /function createWallShadowTexture\(\)/);
  assert.match(room, /createRadialGradient\(128,\s*128,\s*8,\s*128,\s*128,\s*126\)/);
  assert.match(room, /feather\.addColorStop\(0\.58,\s*["']rgba\(255, 255, 255, 0\.16\)["']\)/);
  assert.match(room, /new THREE\.CanvasTexture\(canvas\)/);
  assert.match(room, /new THREE\.SpriteMaterial\(\{/);
  assert.match(room, /new THREE\.Sprite\(wallShadowMaterial\)/);
  assert.match(room, /wallShadow\.position\.set\(0,\s*0,\s*-0\.82\)/);
  assert.match(room, /scene\.add\(wallShadow\)/);
  assert.match(room, /driftX \* 0\.58/);
  assert.match(room, /driftY \+ lift\) \* 0\.58/);
  assert.match(room, /item\.wallShadow\.position\.z = -0\.82/);
  assert.match(room, /wallShadowTexture\.dispose\(\)/);
  assert.match(room, /new THREE\.PlaneGeometry\(2,\s*2\)/);
  assert.match(room, /color:\s*0x2a1a12/i);
  assert.match(room, /backWall\.position\.z = -1\.15/);
  assert.match(room, /backWall\.renderOrder = -2/);
  assert.match(room, /wallShadow\.renderOrder = -1/);
  assert.match(room, /wallTopLeft = screenToWorld\(bounds\.left, bounds\.top, -1\.15\)/);
  assert.doesNotMatch(room, /CircleGeometry/);
  assert.doesNotMatch(css, /drop-shadow\(/);
  assert.match(css, /data-explore-renderer="fallback"[^}]*\.explore-action\s*\{[\s\S]*?radial-gradient\(/);
  assert.equal((room.match(/floatX:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/floatY:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/floatZ:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/floatTilt:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/rollSway:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/tumbleX:\s*0\./g) || []).length, 4);
  assert.equal((room.match(/tumbleY:\s*0\./g) || []).length, 4);
  assert.match(room, /Math\.cos\(elapsed \* 0\.34 \+ item\.floatPhase\)/);
  assert.match(room, /Math\.sin\(elapsed \* 0\.47 \+ item\.floatPhase \* 1\.13\)/);
  assert.match(room, /item\.basePosition\.y \+ driftY \+ lift/);
  assert.match(room, /const driftY = reduceMotion\s*\? 0/);
  assert.match(room, /const zAxisRoll = reduceMotion\s*\? 0/);
  assert.match(room, /const depthTumbleX = reduceMotion\s*\? 0/);
  assert.match(room, /const depthTumbleY = reduceMotion\s*\? 0/);
  assert.match(room, /Math\.sin\(elapsed \* 0\.56 \+ item\.floatPhase \* 0\.72\) \* item\.spec\.tumbleX/);
  assert.match(room, /Math\.cos\(elapsed \* 0\.43 \+ item\.floatPhase \* 1\.19\) \* item\.spec\.tumbleY/);
  assert.match(room, /motionElapsed \* 1000 \* item\.spec\.rotationSpeed/);
  assert.match(room, /Math\.sin\(elapsed \* 0\.31 \+ item\.floatPhase \* 0\.9\) \* item\.spec\.rollSway/);
  assert.match(room, /item\.spec\.rotation\[2\] \+ tiltZ \+ zAxisRoll/);
  assert.match(room, /item\.spec\.rotation\[0\] \+ depthTumbleX/);
  assert.match(room, /item\.spec\.rotation\[1\] \+ depthTumbleY/);
  assert.match(room, /const portalOpen = Boolean\(portal && !portal\.hidden\)/);
  assert.match(room, /previewBlend \+= \(targetPreviewBlend - previewBlend\)/);
  assert.match(room, /const motionFactor = 1 - previewEase/);
  assert.match(room, /motionElapsed \+= deltaSeconds \* motionFactor/);
  assert.match(room, /item\.previewPositionX - item\.basePosition\.x\) \* previewEase \+ driftX/);
  assert.match(room, /const previewCenterX = Math\.min\(previewRightLimit, Math\.max\(/);
  assert.match(room, /const targetOpacity = portalOpen \? 0\.3/);
  assert.match(room, /reduceMotionQuery\.addEventListener\("change", onMotionChange\)/);
  assert.match(room, /reduceMotionQuery\.removeEventListener\("change", onMotionChange\)/);
  assert.match(room, /function onPageHide\(event\)[\s\S]*if \(!event\.persisted\)[\s\S]*dispose\(\)/);
  assert.match(room, /function onPageShow\(event\)[\s\S]*if \(!event\.persisted \|\| disposed\) return/);
  assert.match(room, /window\.addEventListener\("pagehide", onPageHide\)/);
  assert.match(room, /window\.addEventListener\("pageshow", onPageShow\)/);
  assert.doesNotMatch(room, /window\.addEventListener\("pagehide", dispose, \{ once: true \}\)/);
  assert.match(room, /dataset\.exploreRenderer\s*=\s*["'](?:webgl|fallback)["']/);
  assert.match(client, /Finding somewhere…/);
  assert.match(client, /data-explore-state|dataset\.exploreState/);
  assert.match(client, /data-explore-active-scope|dataset\.exploreActiveScope/);
  assert.match(client, /interactive_start/);
  assert.match(client, /interactive_complete/);
  assert.match(client, /sixwell_explore_portal_v1/);
  assert.match(client, /showPreview\(scope, destination\)/);
  assert.match(client, /function enterCurrentPage\(\)[\s\S]*?_constructFade\(currentPortal\.destination\.route\)/);
  assert.match(client, /previewFrame\.setAttribute\("src", "about:blank"\)/);
  assert.match(client, /window\.addEventListener\("pageshow", function \(event\)/);
  assert.match(client, /if \(!event\.persisted\) return;[\s\S]*setControlsBusy\(false\);[\s\S]*setRoomState\("preview", currentPortal\.scope\)/);
  assert.match(nav, /className = 'cnav-explore'/);
  assert.match(nav, /id = 'cnav-mobile-explore'/);
  assert.equal((nav.match(/appendChild\(createExploreCompassIcon\(\)\)/g) || []).length, 2);
  assert.doesNotMatch(nav, /textContent = 'ADVENTURE'/);
  assert.match(nav, /M32 12 L37 32 L32 52 L27 32 Z/);
  assert.match(nav, /stroke:var\(--color-archive, #6D3D15\);stroke-width:5/);
  assert.match(nav, /stroke:var\(--color-about, #F8B468\);stroke-width:3/);
  assert.match(nav, /center\.setAttribute\('r', '3\.5'\)/);
  assert.equal((nav.match(/setAttribute\('aria-label', 'Adventure through the Construct'\)/g) || []).length, 2);
  assert.doesNotMatch(nav, /textContent = 'EXPLORE'|Explore the Construct/);
  assert.match(nav, /aria-current', 'page'/);
  assert.match(nav, /pathname === '\/adventure'/);
  assert.equal((nav.match(/_constructFade\('\/adventure\/'\)/g) || []).length, 2);
  assert.equal((nav.match(/location\.href = '\/adventure\/'/g) || []).length, 2);
  assert.equal((nav.match(/['"]\/explore\/['"]/g) || []).length, 0);
  assert.equal((nav.match(/\{ key: '[^']+',\s+label:/g) || []).length, 9, "Explore must not become a tenth medium node");
  assert.match(transition, /liveTextEditorDisabled[\s\S]*data-live-text-editor[\s\S]*===\s*'off'/);
  assert.match(wayfinding, /data-construct-wayfinding['"]\)\s*===\s*['"]off['"]/);
  const exploreTemplate = guide.match(/\{ id: "construct-explore"[^\n]+\}/)?.[0] || "";
  assert.match(exploreTemplate, /kind: "interactive"/);
  assert.match(exploreTemplate, /route: "\/adventure\/"/);
  assert.match(exploreTemplate, /adventure\/index\.html/);
  assert.match(exploreTemplate, /heroVariant: "Immersive room"/);
  assert.match(exploreTemplate, /js\/explore-room\.js/);
  assert.match(exploreTemplate, /js\/construct-ambient-field\.js/);
  assert.doesNotMatch(exploreTemplate, /css\/hero\.css/);
  assert.match(worker, /url\.pathname === "\/api\/site\/explore"/);
  assert.match(worker, /url\.pathname === "\/explore"[\s\S]*?adventureUrl\.pathname = "\/adventure\/"[\s\S]*?Response\.redirect\(adventureUrl, 308\)/);
});

test("Explore previews and re-dives without navigating until Enter Page", async () => {
  const first = destination("works", "first-work", "merch");
  const second = destination("works", "second-work", "archive");
  const harness = exploreClientHarness({ responses: [{ destination: first }, { destination: second }] });

  harness.buttons[1].dispatch("click");
  await flushExploreClient();
  assert.equal(harness.portal.hidden, false);
  assert.equal(harness.room.dataset.exploreState, "preview");
  assert.equal(harness.room.dataset.exploreActiveScope, "works");
  assert.equal(harness.previewFrame.getAttribute("src"), first.route);
  assert.equal(harness.previewTitle.textContent, first.title);
  assert.equal(harness.previewMedium.textContent, first.medium.label);
  assert.equal(harness.browsingLabel.textContent, "Browsing works & objects");
  assert.equal(harness.portal.dataset.exploreDestinationNode, "merch");
  assert.equal(harness.actionGroup.attributes["aria-hidden"], "true");
  assert.equal(harness.actionGroup.attributes.inert, "");
  assert.equal(harness.window.fadedTo, undefined);
  assert.match(harness.storage.get("sixwell_explore_portal_v1"), /first-work/);

  harness.diveAgain.dispatch("click");
  await flushExploreClient();
  assert.equal(harness.previewFrame.getAttribute("src"), second.route);
  assert.equal(harness.portal.dataset.exploreDestinationNode, "archive");
  assert.match(harness.fetchCalls[1], /scope=works/);
  assert.match(harness.fetchCalls[1], /exclude=first-work/);
  assert.equal(harness.window.fadedTo, undefined);

  harness.enterPage.dispatch("click");
  assert.equal(harness.window.fadedTo, second.route);
  assert.match(harness.storage.get("sixwell_explore_portal_v1"), /second-work/);

  harness.backToBoard.dispatch("click");
  assert.equal(harness.portal.hidden, true);
  assert.equal("exploreDestinationNode" in harness.portal.dataset, false);
  assert.equal(harness.previewFrame.getAttribute("src"), "about:blank");
  assert.equal(harness.room.dataset.exploreState, "idle");
  assert.equal("exploreActiveScope" in harness.room.dataset, false);
  assert.equal(harness.actionGroup.attributes["aria-hidden"], undefined);
  assert.equal(harness.storage.has("sixwell_explore_portal_v1"), false);
  assert.match(harness.storage.get("sixwell_explore_history_v1"), /second-work/);
});

test("Explore identifies the selected browsing scope above the portal viewer", async () => {
  for (const [index, label] of [
    [0, "Browsing entire site"],
    [1, "Browsing works & objects"],
    [2, "Browsing process & evidence"],
    [3, "Browsing pages & pathways"],
  ]) {
    const scope = ["all", "works", "process", "pages"][index];
    const harness = exploreClientHarness({ responses: [{ destination: destination(scope === "all" ? "works" : scope, "scope-" + scope) }] });
    harness.buttons[index].dispatch("click");
    await flushExploreClient();
    assert.equal(harness.browsingLabel.textContent, label);
  }
});

test("Explore restores the current portal after a reload or BFCache return", () => {
  const saved = { scope: "process", destination: destination("process", "saved-process") };
  const harness = exploreClientHarness({ storedPortal: saved });

  assert.equal(harness.portal.hidden, false);
  assert.equal(harness.portal.dataset.exploreDestinationNode, "art");
  assert.equal(harness.room.dataset.exploreState, "preview");
  assert.equal(harness.room.dataset.exploreActiveScope, "process");
  assert.equal(harness.browsingLabel.textContent, "Browsing process & evidence");
  assert.equal(harness.previewFrame.getAttribute("src"), saved.destination.route);
  assert.equal(typeof harness.pageEvents.pageshow, "function");

  harness.room.dataset.exploreState = "loading";
  harness.buttons.forEach((button) => { button.disabled = true; });
  harness.pageEvents.pageshow({ persisted: true });
  assert.deepEqual(harness.buttons.map((button) => button.disabled), [false, false, false, false]);
  assert.equal(harness.room.dataset.exploreState, "preview");
  assert.equal(harness.room.dataset.exploreActiveScope, "process");
  assert.equal(harness.portal.hidden, false);
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.status.dataset.state, "idle");
});

test("the shared ambient field preserves 404 and About behavior while giving Explore a quieter configuration", () => {
  const ambient = read("js/construct-ambient-field.js");
  const errorPage = read("404.html");
  const about = read("about/index.html");
  const room = read("js/explore-room.js");

  assert.match(ambient, /ConstructAmbientField\s*=\s*Object\.freeze\(\{\s*mount:\s*mount\s*\}\)/);
  assert.match(ambient, /\/assets\/eyes\/openeye\.png/);
  assert.match(ambient, /\/assets\/eyes\/closedeye\.png/);
  assert.match(ambient, /parity === 0 \? openEye : closedEye/);
  assert.match(ambient, /EYE_FALL_SPEED\s*=\s*0\.10/);
  assert.match(ambient, /EYE_ROW_SPEED\s*=\s*0\.18/);
  assert.match(ambient, /pixelRatio\s*=\s*Math\.min\(dprCap/);
  assert.match(ambient, /finite\(options\.dprCap,\s*2\)/);
  assert.match(ambient, /new ResizeObserver/);
  assert.match(ambient, /visibilitychange/);
  assert.match(ambient, /prefers-reduced-motion:\s*reduce/);
  assert.match(ambient, /renderSettledFrame/);
  assert.match(ambient, /particle\.angle\s*\+=\s*particle\.orbitSpeed/);
  assert.match(ambient, /particle\.dist\s*\+=\s*particle\.driftSpeed/);

  assert.match(errorPage, /<script src="\/js\/construct-ambient-field\.js"><\/script>/);
  assert.match(errorPage, /ConstructAmbientField\.mount\(\{/);
  assert.match(errorPage, /eyesCanvas:\s*document\.getElementById\(['"]bg['"]\)/);
  assert.match(errorPage, /eyeFilter:\s*['"]brightness\(0\.20\) saturate\(2\)['"]/);
  assert.doesNotMatch(errorPage, /function\s+(?:tileSize|draw|loop)\s*\(/);

  assert.match(about, /<script src="\/js\/construct-ambient-field\.js"><\/script>/);
  assert.match(about, /ConstructAmbientField\.mount\(\{/);
  assert.match(about, /eyesCanvas:\s*document\.getElementById\(['"]eyesBg['"]\)/);
  assert.match(about, /particleCanvas:\s*document\.getElementById\(['"]particleBg['"]\)/);
  assert.match(about, /eyeOpacity:\s*0\.10/);
  assert.match(about, /eyeTint:\s*['"]#6D3D15['"]/i);
  assert.match(about, /particleCount:\s*120/);
  assert.match(about, /particleColor:\s*['"]#FCB867['"]/i);
  assert.match(about, /particleOpacity:\s*\[0\.12,\s*0\.42\]/);
  assert.match(about, /centerX:\s*0\.5/);
  assert.match(about, /centerY:\s*0\.45/);
  assert.match(about, /radial-gradient\(ellipse 58% 48% at 50% 42%,\s*black 18%,\s*rgba\(0,\s*0,\s*0,\s*0\.62\) 46%,\s*transparent 86%\)/);
  assert.doesNotMatch(about, /function\s+(?:drawEyes|stepEyes|spawnP|updateParticles)\s*\(/);

  assert.match(room, /ConstructAmbientField\.mount\(\{/);
  assert.match(room, /eyeOpacity:\s*0\.05/);
  assert.match(room, /eyeTint:\s*["']#6D3D15["']/i);
  assert.match(room, /const eyeMask\s*=\s*["'][^"']*radial-gradient/);
  assert.match(room, /\beyeMask,\s*$/m);
  const exploreParticleCount = Number(room.match(/particleCount:\s*(\d+)/)?.[1] || 0);
  assert.ok(exploreParticleCount >= 72 && exploreParticleCount <= 120);
  assert.match(room, /getPropertyValue\(["']--color-about["']\)/);
  assert.match(room, /constructAmber[^\n]*#FCB867/i);
  assert.match(room, /particleColor:\s*constructAmber/);
  assert.match(room, /particleOpacity:\s*\[0\.08,\s*0\.3\]/);
  const particleSize = room.match(/particleSize:\s*\[([\d.]+),\s*([\d.]+)\]/);
  assert.ok(particleSize && Number(particleSize[1]) < 1 && Number(particleSize[2]) >= 7);
});
