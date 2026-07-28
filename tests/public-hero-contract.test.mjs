import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const routes = [
  { route: "/about/", file: "about/index.html", variant: "landing", descriptor: true },
  { route: "/art/", file: "art/index.html", variant: "landing", descriptor: true },
  { route: "/merch/", file: "merch/index.html", variant: "landing", descriptor: true },
  { route: "/tattoos/", file: "tattoos/index.html", variant: "landing", descriptor: true },
  { route: "/events/", file: "events/index.html", variant: "landing", descriptor: true },
  { route: "/archive/", file: "archive/index.html", heroSource: "js/archive-public.js", variant: "landing", descriptor: true, dynamic: true },

  { route: "/404", file: "404.html", variant: "supporting", descriptor: true },
  { route: "/about/artpilltattoohouse/", file: "about/artpilltattoohouse/index.html", variant: "supporting", descriptor: true },
  { route: "/about/breakdown/", file: "about/breakdown/index.html", variant: "supporting", descriptor: true },
  { route: "/about/contact-press/", file: "about/contact-press/index.html", variant: "supporting", descriptor: true },
  { route: "/about/current-state/", file: "about/current-state/index.html", variant: "supporting", descriptor: true },
  { route: "/about/founder/", file: "about/founder/index.html", variant: "supporting", descriptor: true },
  { route: "/about/legend/", file: "about/legend/index.html", variant: "supporting", descriptor: true },
  { route: "/about/mediums/", file: "about/mediums/index.html", variant: "supporting", descriptor: true },
  { route: "/about/six-well/", file: "about/six-well/index.html", variant: "supporting", descriptor: true },
  { route: "/about/visual-language/", file: "about/visual-language/index.html", variant: "supporting", descriptor: true },
  { route: "/about/ways-in/", file: "about/ways-in/index.html", variant: "supporting", descriptor: true },

  { route: "/archive/about/", file: "archive/about/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/guide/", file: "archive/guide/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/art/", file: "archive/art/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/collections/", file: "archive/collections/index.html", heroSource: "js/archive-public.js", variant: "supporting", descriptor: true, dynamic: true },
  { route: "/archive/events/", file: "archive/events/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/film/", file: "archive/film/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/merch/", file: "archive/merch/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/music/", file: "archive/music/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/records/:slug/", file: "archive/records/index.html", heroSource: "js/archive-public.js", variant: "supporting", descriptor: true, dynamic: true },
  { route: "/archive/sixwell-construct/", file: "archive/sixwell-construct/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/tattoos/", file: "archive/tattoos/index.html", variant: "supporting", descriptor: true },
  { route: "/archive/timelines/:slug/", file: "archive/timelines/index.html", heroSource: "js/archive-public.js", variant: "supporting", descriptor: true, dynamic: true },
  { route: "/archive/writings/", file: "archive/writings/index.html", variant: "supporting", descriptor: true },

  { route: "/art/acquisitioninquiry", file: "art/acquisitioninquiry.html", variant: "supporting", descriptor: true },
  { route: "/art/homelandsecuritypainting", file: "art/homelandsecuritypainting.html", variant: "supporting" },
  { route: "/art/lostmarblespainting", file: "art/lostmarblespainting.html", variant: "supporting" },
  { route: "/art/lustpainting", file: "art/lustpainting.html", variant: "supporting" },
  { route: "/art/paranoiafosteredtraumapainting", file: "art/paranoiafosteredtraumapainting.html", variant: "supporting" },
  { route: "/art/slothpainting", file: "art/slothpainting.html", variant: "supporting" },
  { route: "/art/thefrustrationsofinnercharospainting", file: "art/thefrustrationsofinnercharospainting.html", variant: "supporting" },

  { route: "/booking/", file: "booking/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/reschedule/", file: "booking/reschedule/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/studio/", file: "booking/studio/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/studio-visit/", file: "booking/studio-visit/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/confirmed/", file: "booking/confirmed/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/confirmed/build/", file: "booking/confirmed/build/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/confirmed/consultation/", file: "booking/confirmed/consultation/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/confirmed/studio/", file: "booking/confirmed/studio/index.html", variant: "supporting", descriptor: true },
  { route: "/booking/confirmed/virtual-consultation/", file: "booking/confirmed/virtual-consultation/index.html", variant: "supporting", descriptor: true },
  { route: "/construct-map/", file: "construct-map/index.html", variant: "supporting", descriptor: true },

  { route: "/events/calendar/", file: "events/calendar/index.html", variant: "supporting", descriptor: true },
  { route: "/events/confirmed/", file: "events/confirmed/index.html", variant: "supporting", descriptor: true },
  { route: "/events/cultandshift/", file: "events/cultandshift/index.html", variant: "supporting" },
  { route: "/events/open-studios/", file: "events/open-studios/index.html", variant: "supporting", descriptor: true },
  { route: "/events/signal-symbol/", file: "events/signal-symbol/index.html", variant: "supporting", descriptor: true },
  { route: "/events/solehmans-new-year/", file: "events/solehmans-new-year/index.html", variant: "supporting", descriptor: true },
  { route: "/events/ss-and-f-live-audience/", file: "events/ss-and-f-live-audience/index.html", variant: "supporting", descriptor: true },

  { route: "/merch/am-i-losing-my-marbles", file: "merch/am-i-losing-my-marbles.html", variant: "supporting" },
  { route: "/merch/lostmarbles-hoodie", file: "merch/lostmarbles-hoodie.html", variant: "supporting" },
  { route: "/merch/marbles-print", file: "merch/marbles-print.html", variant: "supporting" },
  { route: "/merch/maze-puffer-jacket", file: "merch/maze-puffer-jacket.html", variant: "supporting" },
  { route: "/preferences/", file: "preferences/index.html", variant: "supporting", descriptor: true },
  { route: "/search/", file: "search/index.html", variant: "supporting" },

  { route: "/tattoos/approved/", file: "tattoos/approved/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/build/", file: "tattoos/build/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/build/in-person/", file: "tattoos/build/in-person/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/day-of/", file: "tattoos/day-of/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/flash/", file: "tattoos/flash/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/flash/ap-flash-001/", file: "tattoos/flash/ap-flash-001/index.html", variant: "supporting" },
  { route: "/tattoos/flash/ap-maze-001/", file: "tattoos/flash/ap-maze-001/index.html", variant: "supporting" },
  { route: "/tattoos/flash/ap-sairo-001/", file: "tattoos/flash/ap-sairo-001/index.html", variant: "supporting" },
  { route: "/tattoos/flash/ap-standalone-001/", file: "tattoos/flash/ap-standalone-001/index.html", variant: "supporting" },
  { route: "/tattoos/flash/ap-standalone-archive-001/", file: "tattoos/flash/ap-standalone-archive-001/index.html", variant: "supporting" },
  { route: "/tattoos/flash/claim/", file: "tattoos/flash/claim/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/flash/detail/:slug/", file: "tattoos/flash/detail/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/flash/maze/", file: "tattoos/flash/maze/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/inquire/", file: "tattoos/inquire/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/inquire/consultation/", file: "tattoos/inquire/consultation/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/inquire/custom/", file: "tattoos/inquire/custom/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/location-parking/", file: "tattoos/location-parking/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/policies/", file: "tattoos/policies/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/portfolio/", file: "tattoos/portfolio/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/special-projects/", file: "tattoos/special-projects/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/special-projects/apply/", file: "tattoos/special-projects/apply/index.html", variant: "supporting", descriptor: true },
  { route: "/tattoos/submission-received/", file: "tattoos/submission-received/index.html", variant: "supporting", descriptor: true },
];

const excludedActiveSource = /(?:managed-preview|about-next|construct-connections-(?:organic|prototype))/;

async function walkHtml(entry) {
  const absolute = path.join(root, entry);
  const info = await stat(absolute);
  if (info.isFile()) return entry.endsWith(".html") ? [entry] : [];
  const children = await readdir(absolute);
  const nested = await Promise.all(children.map((child) => walkHtml(path.join(entry, child))));
  return nested.flat();
}

test("active public hero inventory is complete and assigns one valid variant", async () => {
  assert.equal(new Set(routes.map(({ route }) => route)).size, routes.length, "hero routes must be unique");

  const landing = routes.filter(({ variant }) => variant === "landing").map(({ route }) => route).sort();
  assert.deepEqual(landing, ["/about/", "/archive/", "/art/", "/events/", "/merch/", "/tattoos/"]);

  const discovered = (
    await Promise.all(
      ["about", "archive", "art", "booking", "construct-map", "events", "merch", "preferences", "search", "tattoos"].map(walkHtml),
    )
  )
    .flat()
    .filter((file) => !excludedActiveSource.test(file));
  const activeWithH1 = [];
  for (const file of discovered) {
    if ((await read(file)).includes("<h1")) activeWithH1.push(file);
  }
  activeWithH1.push("404.html");

  const inventoriedFiles = new Set(routes.map(({ file }) => file));
  for (const file of activeWithH1) {
    assert.ok(inventoriedFiles.has(file), `${file} has a public H1 but is missing from the hero inventory`);
  }
});

test("every inventoried public hero loads and follows the shared component contract", async () => {
  for (const record of routes) {
    const html = await read(record.file);
    const source = record.heroSource ? await read(record.heroSource) : html;
    const label = `${record.route} (${record.file})`;

    assert.match(html, /href=["']\/css\/hero\.css["']/, `${label} must load hero.css`);
    assert.ok(
      html.indexOf("/css/hero.css") > html.indexOf("/css/site-typography.css"),
      `${label} must load hero.css after site-typography.css`,
    );
    assert.match(source, /\bsite-hero\b/, `${label} needs .site-hero`);
    assert.match(source, new RegExp(`\\bsite-hero--${record.variant}\\b`), `${label} needs the ${record.variant} variant`);
    assert.match(source, /\bhero-title\b/, `${label} needs .hero-title`);
    if (record.descriptor) assert.match(source, /\bhero-descriptor\b/, `${label} needs .hero-descriptor`);

    if (!record.dynamic) {
      const heroClasses = [...source.matchAll(/class=["']([^"']*\bsite-hero\b[^"']*)["']/g)];
      assert.ok(heroClasses.length > 0, `${label} needs a concrete site hero region`);
      for (const [, className] of heroClasses) {
        const variants = ["landing", "supporting"].filter((variant) =>
          new RegExp(`\\bsite-hero--${variant}\\b`).test(className),
        );
        assert.equal(variants.length, 1, `${label} hero region must have exactly one size variant`);
      }
    }
  }
});

test("legacy shared styles no longer own public hero typography", async () => {
  const [landing, venture, tattoos, archive, mobile, about, typography, transition] = await Promise.all([
    read("css/landing-family.css"),
    read("css/venture-pages.css"),
    read("css/tattoos.css"),
    read("css/archive-public.css"),
    read("css/mobile.css"),
    read("about/section-page.css"),
    read("css/site-typography.css"),
    read("js/transition.js"),
  ]);

  const legacy = [landing, venture, tattoos, archive, mobile, about].join("\n");
  for (const selector of [
    String.raw`\.venture-title`,
    String.raw`\.page-title`,
    String.raw`\.hero-title`,
    String.raw`\.archive-record-title`,
    String.raw`\.archive-timeline-title`,
    String.raw`\.section-head\s*>\s*\.hero-title`,
  ]) {
    assert.doesNotMatch(
      legacy,
      new RegExp(`${selector}\\s*\\{[^}]*(?:font-size|color|font-family|letter-spacing|line-height)`, "i"),
      `${selector} must not retain shared legacy hero typography`,
    );
  }
  assert.doesNotMatch(typography, /\.hero-descriptor\s*\{/);
  assert.match(typography, /:not\(\.hero-title\)/);
  assert.match(
    transition,
    /\.site-hero--landing \.hero-title,\s*\[data-fit-width\]:not\(\.hero-title\)/,
  );
  assert.doesNotMatch(transition, /\.site-hero--supporting \.hero-title/);
  assert.match(transition, /isLandingHeroTitle\s*=\s*title\.matches\('\.site-hero--landing \.hero-title'\)/);
  assert.match(transition, /availableWidth\s*=\s*title\.getBoundingClientRect\(\)\.width/);
  assert.match(transition, /isLandingHeroTitle\s*\?\s*title\.scrollWidth/);
});

test("landing and supporting hero variants share tracking at every breakpoint", async () => {
  const tokens = await read("css/tokens.css");
  const tokenValue = (name) => {
    const match = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(match, `missing --${name}`);
    return match[1].trim();
  };

  for (const suffix of ["", "-tablet", "-mobile", "-compact"]) {
    assert.equal(
      tokenValue(`type-hero-tracking${suffix}`),
      tokenValue(`type-supporting-hero-tracking${suffix}`),
      `landing and supporting hero tracking must match${suffix ? ` at ${suffix.slice(1)}` : ""}`,
    );
  }
});

test("shared landing heroes stack full-width with a larger mobile scale", async () => {
  const [tokens, hero, mobileCss, tattoo] = await Promise.all([
    read("css/tokens.css"),
    read("css/hero.css"),
    read("css/mobile.css"),
    read("tattoos/index.html"),
  ]);

  assert.match(tokens, /--type-hero-size-tablet:\s*clamp\(58px,\s*16vw,\s*132px\)/);
  assert.match(tokens, /--type-hero-size-mobile:\s*clamp\(36px,\s*17vw,\s*112px\)/);
  assert.match(tokens, /--type-hero-size-compact:\s*clamp\(36px,\s*17vw,\s*112px\)/);
  assert.match(
    hero,
    /@media \(max-width: 900px\)[\s\S]*?\.site-hero--landing\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;[^}]*flex-direction:\s*column\s*!important;[^}]*align-items:\s*stretch\s*!important;[^}]*text-align:\s*left\s*!important;/,
  );
  assert.match(
    hero,
    /\.site-hero--landing \.hero-title,\s*\.site-hero--landing \.hero-descriptor\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%\s*!important;[^}]*text-align:\s*left\s*!important;/,
  );
  assert.match(hero, /\.site-hero \.hero-title\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/);
  assert.doesNotMatch(hero, /overflow-wrap:\s*anywhere|word-break:\s*break-(?:all|word)/);
  assert.doesNotMatch(mobileCss, /body\[data-venture="tattooing"\] \.landing-hero/);
  assert.doesNotMatch(
    tattoo,
    /@media \(max-width:768px\)\s*\{[\s\S]*?\.hero(?:-left|-right|-title)?\s*\{[^}]*(?:flex-direction|align-items|text-align|width)/,
  );
});

test("Archive keeps search utility outside the shared landing hero", async () => {
  const source = await read("js/archive-public.js");
  const templateStart = source.indexOf("app.innerHTML = `");
  const templateEnd = source.indexOf("`;", templateStart);
  const template = source.slice(templateStart, templateEnd);
  const heroEnd = template.indexOf("</section>");
  const search = template.indexOf('class="archive-search-form archive-search-panel"');
  const explorer = template.indexOf('class="archive-explorer"');

  assert.ok(templateStart >= 0 && templateEnd > templateStart, "archive explorer template must exist");
  assert.ok(heroEnd >= 0, "archive hero must close before utility regions");
  assert.ok(search > heroEnd, "archive search must sit outside the shared hero");
  assert.ok(explorer > search, "archive search must lead into the archive explorer tools");
});

test("Tattoo landing keeps the path chooser out of its hero", async () => {
  const html = await read("tattoos/index.html");
  const hero = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] || "";

  assert.ok(hero, "Tattoo landing hero must exist");
  assert.doesNotMatch(hero, /Choose a path|cta-primary/i);
  assert.match(
    html,
    /<div class="booking-cta">[\s\S]*?<h2[^>]*>Choose a Path\.<\/h2>[\s\S]*?<a class="cta-primary" href="\/tattoos\/inquire\/">Choose a path →<\/a>/,
    "the lower-page inquiry chooser must remain available",
  );
});

test("Tattoo landing hero stacks full-width and left-aligned on mobile", async () => {
  const [html, heroCss] = await Promise.all([
    read("tattoos/index.html"),
    read("css/hero.css"),
  ]);

  assert.match(html, /class="landing-hero hero site-hero site-hero--landing"/);
  assert.match(heroCss, /@media \(max-width: 900px\)[\s\S]*?\.site-hero--landing\s*\{/);
  assert.doesNotMatch(html, /@media \(max-width:768px\)\s*\{[\s\S]*?\.hero-left\s*\{/);
});

test("Merch filters update only the shared hero title variable and descriptor text", async () => {
  const [html, heroCss, shop, sources] = await Promise.all([
    read("merch/index.html"),
    read("css/hero.css"),
    read("js/shop-storefront.js"),
    read("shared/storefront-config.js"),
  ]);

  assert.match(html, /class=["'][^"']*\bsite-hero\b[^"']*\bsite-hero--landing\b/);
  assert.match(heroCss, /color:\s*var\(--hero-title-color\)\s*!important/);
  assert.match(heroCss, /\.hero-descriptor\s*\{[^}]*color:\s*var\(--type-descriptor-color,\s*rgba\(252,\s*184,\s*103,\s*0\.55\)\)\s*!important/s);
  assert.match(shop, /merchHero\?\.style\.setProperty\("--hero-title-color",\s*color\)/);
  assert.match(shop, /introDesc\.textContent\s*=\s*SOURCES\[key\]\?\.statement\s*\|\|\s*""/);
  assert.match(shop, /introDesc\.textContent\s*=\s*"everything sellable from the construct"/);
  assert.doesNotMatch(shop, /introDesc\.style|--title-color/);

  for (const key of ["six.well", "thoughtpuppet", "art.pill"]) {
    const escapedKey = key.replaceAll(".", "\\.");
    assert.match(sources, new RegExp(`(?:^|\\n)\\s*["']?${escapedKey}["']?\\s*:\\s*\\{[\\s\\S]*?color:[\\s\\S]*?statement:`));
  }
});
