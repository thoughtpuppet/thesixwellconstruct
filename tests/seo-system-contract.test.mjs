import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  SEO_STATIC_PAGES,
  applySeoDocument,
  canonicalRedirect,
  chillSeriesStructuredData,
  handleRobots,
  isNoindexPath,
  personStructuredData,
  sitemapXml,
  staticSeoPage,
  tattooParlorStructuredData,
} from "../functions/api/seo/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = "https://thesixwellconstruct.com";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return { success: true, meta: this.database.prepare(this.sql).run(...this.values) }; }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return database;
}

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

test("the shared SEO registry covers the four search journeys", () => {
  assert.equal(new Set(SEO_STATIC_PAGES.map((page) => page.path)).size, SEO_STATIC_PAGES.length);
  assert.match(staticSeoPage("/about/saieldauhnsolehman/").title, /Saiel Dauhn Solehman/);
  assert.match(staticSeoPage("/tattoos/").description, /Atlanta/i);
  assert.match(staticSeoPage("/merch/").title, /Six\.Well Clothing/);
  assert.match(staticSeoPage("/events/").description, /produced|operated/i);
  assert.match(staticSeoPage("/calendar/").title, /Atlanta Creative Calendar/);
});

test("SEO document output is unique, canonical, parseable, and portfolio-query stable", () => {
  const input = `<!doctype html><html><head><title>Old</title><title>Duplicate</title><meta name="description" content="Old"><meta name="robots" content="noindex"><link rel="canonical" href="/old"></head><body><h1>Portfolio</h1></body></html>`;
  const html = applySeoDocument(input, {
    pathname: "/tattoos/portfolio/",
    origin: ORIGIN,
  });
  assert.equal(occurrences(html, /<title>/g), 1);
  assert.equal(occurrences(html, /<meta name="description"/g), 1);
  assert.equal(occurrences(html, /<meta name="robots"/g), 1);
  assert.equal(occurrences(html, /<link rel="canonical"/g), 1);
  assert.match(html, /href="https:\/\/thesixwellconstruct\.com\/tattoos\/portfolio\/"/);
  const encoded = html.match(/<script type="application\/ld\+json" data-seo-structured-data>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(encoded);
  assert.doesNotThrow(() => JSON.parse(encoded));
});

test("SEO rewrites preserve one existing social image and replace duplicate Twitter metadata", () => {
  const input = `<!doctype html><html><head><title>Archive place</title><meta property="og:image" content="/assets/archive/place.jpg"><meta property="og:image:alt" content="Archive place"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="Old title"><meta name="twitter:title" content="Duplicate title"><meta name="twitter:image" content="/old.jpg"></head><body><h1>Archive place</h1></body></html>`;
  const html = applySeoDocument(input, { pathname: "/archive/places/example/", origin: ORIGIN });
  assert.equal(occurrences(html, /<meta property="og:image" /g), 1);
  assert.equal(occurrences(html, /<meta property="og:image:alt" /g), 1);
  assert.equal(occurrences(html, /<meta name="twitter:card" /g), 1);
  assert.equal(occurrences(html, /<meta name="twitter:title" /g), 1);
  assert.equal(occurrences(html, /<meta name="twitter:image" /g), 1);
  assert.match(html, /property="og:image" content="https:\/\/thesixwellconstruct\.com\/assets\/archive\/place\.jpg"/);
  assert.match(html, /name="twitter:image" content="https:\/\/thesixwellconstruct\.com\/assets\/archive\/place\.jpg"/);
});

test("Saiel name variants resolve to one Person identity", () => {
  const person = personStructuredData(ORIGIN);
  assert.equal(person.name, "Saiel Dauhn Solehman");
  assert.deepEqual(person.alternateName, ["Saiel Solehman"]);
  assert.equal(person["@id"], `${ORIGIN}/about/saieldauhnsolehman/#person`);
  assert.equal(person.url, `${ORIGIN}/about/saieldauhnsolehman/`);
});

test("confirmed Chill series credit connects the canonical Person without becoming a sameAs profile", () => {
  const series = chillSeriesStructuredData(ORIGIN);
  assert.equal(series["@type"], "TVSeries");
  assert.equal(series.name, "Chill. the Series");
  assert.equal(series.actor["@id"], `${ORIGIN}/about/saieldauhnsolehman/#person`);
  assert.equal(series.creditText, "Saiel Solehman as Tae “Art Bae”");
  assert.equal(series.productionCompany.name, "The BlackOUT Company");
  assert.equal("sameAs" in series, false);
  const html = applySeoDocument("<html><head><title>Saiel</title></head><body><h1>Saiel Dauhn Solehman</h1></body></html>", {
    pathname: "/about/saieldauhnsolehman/",
    origin: ORIGIN,
  });
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json" data-seo-structured-data>([\s\S]*?)<\/script>/)[1])["@graph"];
  assert.ok(graph.some((node) => node["@id"] === `${ORIGIN}/about/saieldauhnsolehman/#person`));
  assert.ok(graph.some((node) => node["@type"] === "TVSeries" && node.actor?.["@id"] === `${ORIGIN}/about/saieldauhnsolehman/#person`));
});

test("art.pill publishes only the approved local-business fields", () => {
  const parlor = tattooParlorStructuredData(ORIGIN);
  assert.equal(parlor.address.streetAddress, "364 Nelson Street SW");
  assert.equal(parlor.address.addressLocality, "Atlanta");
  assert.equal(parlor.address.postalCode, "30313");
  assert.equal("telephone" in parlor, false);
  assert.equal("geo" in parlor, false);
  assert.equal("openingHours" in parlor, false);
});

test("canonical redirects collapse protocol, host, index files, and legacy aliases once", () => {
  let response = canonicalRedirect(new Request("http://www.thesixwellconstruct.com/about/index.html?ref=x"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), `${ORIGIN}/about/`);
  response = canonicalRedirect(new Request(`${ORIGIN}/legend/`));
  assert.equal(response.headers.get("location"), `${ORIGIN}/about/legend/`);
  assert.equal(canonicalRedirect(new Request(`${ORIGIN}/about/legend/`)), null);
  assert.equal(canonicalRedirect(new Request(`${ORIGIN}/api/site/visibility?path=/about/`)), null);
});

test("robots rules exclude operational paths and advertise the absolute sitemap", async () => {
  assert.equal(isNoindexPath("/studio/submissions/"), true);
  assert.equal(isNoindexPath("/tattoos/portfolio/?work=example"), false);
  assert.equal(isNoindexPath("/home-entry-overlay-prototype.html"), true);
  assert.equal(isNoindexPath("/particle-preview.html"), true);
  assert.equal(isNoindexPath("/about/about-next.html"), true);
  assert.equal(isNoindexPath("/prototypes/entry-threshold-3d/"), true);
  const preview = applySeoDocument("<html><head><title>Preview</title></head><body><h1>Preview</h1></body></html>", {
    pathname: "/particle-preview.html",
    origin: ORIGIN,
  });
  assert.match(preview, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  const response = handleRobots(new Request(`${ORIGIN}/robots.txt`), {});
  const text = await response.text();
  assert.match(text, /Disallow: \/studio\//);
  assert.match(text, /Disallow: \/calendar\/submit\//);
  assert.match(text, /Disallow: \/prototypes\//);
  assert.match(text, /Sitemap: https:\/\/thesixwellconstruct\.com\/sitemap\.xml/);
});

test("prototype assets are excluded from publication and the public tattoo policy contains no phone number", () => {
  const ignored = readFileSync(join(ROOT, ".assetsignore"), "utf8");
  assert.match(ignored, /^docs\/\*\*$/m);
  assert.match(ignored, /^prototypes\/\*\*$/m);
  assert.match(ignored, /^\*prototype\*\.html$/m);
  assert.match(ignored, /^\*preview\*\.html$/m);
  const policy = readFileSync(join(ROOT, "tattoos", "policies", "index.html"), "utf8");
  assert.doesNotMatch(policy, /770[\s().-]*820[\s.-]*5800|\+17708205800|href=["']tel:/i);
});

test("sitemap generation obeys authoritative visibility and excludes query states", async () => {
  const database = migratedDatabase();
  database.prepare(`
    INSERT INTO site_visibility_rules(path,visibility,scope,updated_by,updated_at)
    VALUES('/gallery/','hidden','exact','test',datetime('now'))
    ON CONFLICT(path) DO UPDATE SET visibility='hidden',scope='exact'
  `).run();
  const publicEventCount = database.prepare("SELECT count(*) count FROM events WHERE publication_state IN ('announced','published')").get().count;
  assert.ok(publicEventCount > 0);
  database.prepare(`
    INSERT INTO site_visibility_rules(path,visibility,scope,updated_by,updated_at)
    VALUES('/events/','hidden','descendants','test',datetime('now'))
    ON CONFLICT(path) DO UPDATE SET visibility='hidden',scope='descendants'
  `).run();
  const xml = await sitemapXml({ SUBMISSIONS_DB: new LocalD1(database) }, ORIGIN);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/thesixwellconstruct\.com\/about\/saieldauhnsolehman\/<\/loc>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/thesixwellconstruct\.com\/gallery\/<\/loc>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/thesixwellconstruct\.com\/events\//);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(urls.some((url) => /[?#]/.test(url)), false);
  assert.equal(new Set(urls).size, occurrences(xml, /<loc>/g));
});

test("public person, event, calendar, and location pages expose crawlable distinctions", () => {
  const person = readFileSync(join(ROOT, "about", "saieldauhnsolehman", "index.html"), "utf8");
  const events = readFileSync(join(ROOT, "events", "index.html"), "utf8");
  const calendar = readFileSync(join(ROOT, "calendar", "index.html"), "utf8");
  const location = readFileSync(join(ROOT, "tattoos", "location-parking", "index.html"), "utf8");
  assert.match(person, /Also known as Saiel Solehman/);
  assert.match(person, /Chill\. the Series/);
  assert.match(person, /Saiel Solehman as Tae “Art Bae”/);
  assert.match(person, /href="https:\/\/www\.theblackoutcompany\.com\/chill-the-series"/);
  for (const path of ["/art/", "/tattoos/", "/merch/", "/writings/", "/archive/", "/events/", "/calendar/"]) assert.match(person, new RegExp(`href=["']${path}`));
  assert.match(events, /produced|operated|programs/i);
  assert.match(events, /href="\/calendar\/"/);
  assert.match(calendar, /Atlanta Creative Calendar/);
  assert.match(calendar, /href="\/events\/"/);
  assert.match(location, /364 Nelson Street SW, Atlanta, GA 30313/);
  assert.match(location, /appointment-only/i);
  assert.doesNotMatch(location, /(?:tel:|telephone|opening hours|latitude|longitude)/i);
});

test("Worker routes robots, sitemap, real hidden 404s, and server SEO transformations", () => {
  const worker = readFileSync(join(ROOT, "_worker.js"), "utf8");
  assert.match(worker, /url\.pathname === "\/robots\.txt"/);
  assert.match(worker, /url\.pathname === "\/sitemap\.xml"/);
  assert.match(worker, /decision\.hidden \? notFoundPage\(request, env\) : null/);
  assert.match(worker, /seoRecordSummary/);
  assert.match(worker, /serveCalendarEventPage/);
  assert.match(worker, /serveMerchRecordPage/);
});
