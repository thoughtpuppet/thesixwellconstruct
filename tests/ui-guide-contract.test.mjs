import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tokens expose the complete dual-system responsive contract", async () => {
  const css = await read("css/tokens.css");
  const roles = ["body", "hero", "section", "descriptor", "eyebrow", "breadcrumb", "control", "footer", "meta"];
  const viewportSuffixes = ["tablet", "mobile", "compact"];

  for (const role of roles) {
    for (const suffix of viewportSuffixes) {
      assert.match(css, new RegExp(`--type-${role}-size-${suffix}\\s*:`), `${role} needs a ${suffix} size token`);
      assert.match(css, new RegExp(`--type-${role}-leading-${suffix}\\s*:`), `${role} needs a ${suffix} leading token`);
      assert.match(css, new RegExp(`--type-${role}-tracking-${suffix}\\s*:`), `${role} needs a ${suffix} tracking token`);
    }
  }

  for (const suffix of ["", "-tablet", "-mobile", "-compact"]) {
    assert.match(css, new RegExp(`--type-supporting-hero-size${suffix}\\s*:`));
    assert.match(css, new RegExp(`--type-supporting-hero-leading${suffix}\\s*:`));
    assert.match(css, new RegExp(`--type-supporting-hero-tracking${suffix}\\s*:`));
  }

  for (const token of [
    "--page-padding-x-tablet",
    "--page-padding-x-mobile",
    "--page-padding-x-compact",
    "--section-gap-tablet",
    "--section-gap-mobile",
    "--section-gap-compact",
    "--grid-gap-tablet",
    "--grid-gap-mobile",
    "--grid-gap-compact",
    "--control-min-height",
    "--studio-bg",
    "--studio-panel",
    "--studio-status-success",
    "--studio-status-warning",
    "--studio-status-error",
    "--studio-control-min-height",
    "--studio-workspace-gap-mobile",
    "--studio-pane-padding-mobile",
    "--studio-type-title-size",
    "--studio-type-body-size",
  ]) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing ${token}`);
  }
});

test("the Guide exposes both systems and source libraries without a preview pane", async () => {
  const [html, systemJs] = await Promise.all([
    read("tools/ui-guide.html"),
    read("tools/ui-guide-system.js"),
  ]);

  assert.match(html, /data-guide-system="public"/);
  assert.match(html, /data-guide-system="studio"/);
  assert.match(html, /id="contract-root"/);
  assert.match(html, /id="responsive-role-list"/);
  assert.match(html, /id="studio-role-list"/);
  assert.match(html, /\/tools\/ui-guide-system\.js/);
  assert.match(html, /\/css\/hero\.css/);
  assert.match(html, /site-hero site-hero--supporting/);
  assert.match(html, /--type-supporting-hero-size-mobile/);

  assert.doesNotMatch(systemJs, /preview-stage|renderPreview|previewDocument|data-viewport|mode === "compare"/);
  assert.match(systemJs, /Dual-system foundations/);
  assert.match(systemJs, /Foundation adopted · centered composition retained/);
  assert.match(systemJs, /<th>Family \/ variant<\/th>/);
  assert.match(systemJs, /<th>Reference route<\/th>/);
  assert.match(systemJs, /<th>Candidate routes<\/th>/);
  assert.match(systemJs, /<th>Owning files<\/th>/);
  assert.match(systemJs, /<th>Adoption \/ notes<\/th>/);
  assert.match(systemJs, /adoptionState:\s*record\.adoption \|\| "Not yet migrated"/);
  assert.equal((systemJs.match(/family: "Landing Family"/g) || []).length, 5);
  assert.match(systemJs, /record\.heroVariant = record\.family === "Landing Family" \? "Medium landing hero" : "Supporting hero"/);
  assert.match(systemJs, /record\.sources\.push\("css\/hero\.css"\)/);

  for (const landing of [
    "Standard venture landing",
    "Art catalog landing",
    "Tattoo service landing",
    "Merch commerce landing",
    "Events program landing",
  ]) {
    assert.match(systemJs, new RegExp(landing), `missing ${landing}`);
  }

  for (const region of [
    "Shared navigation",
    "Breadcrumb",
    "Hero title role",
    "Descriptor",
    "Responsive behavior",
    "Footer",
    "Artwork gallery",
    "Live walk-in windows",
    "Product catalog",
    "Live event feed",
  ]) {
    assert.match(systemJs, new RegExp(region), `missing landing region ${region}`);
  }

  assert.match(systemJs, /id: "venture-landing"[^\n]*routes: \[\][^\n]*reference route not linked/);
  assert.match(systemJs, /id: "artwork-catalog"[^\n]*css\/landing-family\.css[^\n]*css\/portfolio-cards\.css[^\n]*Shared foundation adopted · catalog composition retained/);
  assert.match(systemJs, /id: "tattoo-portfolio"[^\n]*css\/portfolio-cards\.css[^\n]*css\/portfolio-detail\.css/);
  assert.match(systemJs, /id: "merch-catalog"[^\n]*css\/landing-family\.css[^\n]*Shared foundation adopted[^"\n]*commerce composition retained/);
  assert.match(systemJs, /id: "tattoo-landing"[^\n]*css\/landing-family\.css[^\n]*Shared foundation adopted[^"\n]*service composition retained/);
  assert.match(systemJs, /id: "event-hub"[^\n]*css\/landing-family\.css[^\n]*Shared foundation adopted[^"\n]*event composition retained/);
  assert.match(systemJs, /id: "event-hub"[\s\S]*route: "\/events\/"/);
  assert.doesNotMatch(systemJs, /id: "venture-landing"[^\n]*route: "\/events\/"/);

  for (const id of [
    "venture-landing",
    "artwork-detail",
    "artwork-inquiry",
    "merch-product",
    "tattoo-portfolio",
    "flash-detail",
    "tattoo-intake",
    "booking-flow",
    "event-registration",
    "archive-guide",
    "archive-record",
    "archive-compare",
    "legend-catalog",
    "construct-search",
    "construct-explore",
    "preferences",
    "hidden-state",
    "component-forms",
    "component-selects",
    "component-scheduling",
    "component-uploads",
    "component-commerce",
    "component-data",
    "component-archive-catalogue",
    "component-overlays",
    "component-feedback",
    "studio-list-detail",
    "studio-scheduler",
    "studio-media",
    "studio-people",
    "studio-campaign",
    "studio-import",
    "studio-dossier",
    "studio-connections",
    "studio-dialog",
  ]) {
    assert.match(systemJs, new RegExp(`id: "${id}"`), `missing ${id}`);
  }

  assert.match(systemJs, /id: "archive-compare"[^\n]*route: "\/archive\/compare\/"[^\n]*js\/archive-compare\.js/);
  assert.match(systemJs, /id: "construct-explore"[^\n]*route: "\/explore\/"[^\n]*css\/explore\.css[^\n]*functions\/api\/construct\/_lib\.js[^\n]*separate from the nine medium nodes/);
  assert.match(systemJs, /id: "component-archive-catalogue"[^\n]*5px state rails[^\n]*top-level comparison workspace/);
  assert.match(systemJs, /id: "component-archive-catalogue"[^\n]*Compare records hero action[^\n]*Individual cards carry no comparison controls/);
  assert.match(systemJs, /id: "studio-dossier"[^\n]*studio\/archive-catalogue\.css[^\n]*read-only permanent identity/);
  assert.match(html, /\/api\/archive\/compare/);
  assert.match(html, /Archive publication layers/);
  assert.doesNotMatch(html, /assets\/archive\/records\.json/);
});

test("token synchronization keeps direct-write and both fallbacks", async () => {
  const html = await read("tools/ui-guide.html");

  assert.match(html, /\/__tools\/read-file/);
  assert.match(html, /\/__tools\/write-file/);
  assert.match(html, /pathSegments:\['css','tokens\.css'\]/);
  assert.match(html, /showOpenFilePicker/);
  assert.match(html, /navigator\.clipboard/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /Token marker validation failed/);
  assert.match(html, /reset to the last values loaded from tokens\.css/);
  assert.doesNotMatch(html, /--color-body:\s*#/);
  assert.match(html, /dirty=false/);
});

test("Studio consumes shared tokens without changing its operational surface", async () => {
  const [html, foundation] = await Promise.all([
    read("studio/submissions/index.html"),
    read("studio/console-system.css"),
  ]);

  assert.match(html, /\/css\/tokens\.css\?v=dual-system-contract/);
  assert.match(html, /\/studio\/console-system\.css\?v=dual-system-contract/);

  for (const tab of [
    "Home",
    "Analytics",
    "People",
    "Tattoos",
    "Studio Booking",
    "Art",
    "Merch",
    "Legend",
    "Events",
    "Archive",
    "Site",
    "Shared",
  ]) {
    assert.match(html, new RegExp(`>${tab}<`), `missing Studio tab ${tab}`);
  }

  assert.match(foundation, /--bg:\s*var\(--studio-bg/);
  assert.match(foundation, /@media \(max-width: 900px\)/);
  assert.match(foundation, /@media \(max-width: 700px\)/);
  assert.match(foundation, /@media \(max-width: 380px\)/);
  assert.match(foundation, /min-height:\s*var\(--studio-control-min-height/);
  assert.match(foundation, /\.list-pane[\s\S]*border-bottom:\s*5px/);
  assert.match(foundation, /\.datetimepicker-popup[\s\S]*position:\s*fixed/);
  assert.match(foundation, /prefers-reduced-motion:\s*reduce/);
});

test("public shared styles consume responsive tokens at canonical breakpoints", async () => {
  const [typography, hero, mobile, venture] = await Promise.all([
    read("css/site-typography.css"),
    read("css/hero.css"),
    read("css/mobile.css"),
    read("css/venture-pages.css"),
  ]);

  for (const css of [typography, hero, mobile, venture]) {
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: (?:700|380)px\)/);
  }

  assert.match(typography, /--type-hero-size-active/);
  assert.match(hero, /\.site-hero--landing/);
  assert.match(hero, /\.site-hero--supporting/);
  assert.match(hero, /--type-supporting-hero-size-mobile/);
  assert.match(hero, /\.hero-descriptor/);
  assert.match(typography, /--type-section-size-active/);
  assert.match(typography, /--type-control-size-active/);
  assert.match(typography, /Raw buttons remain page-owned/);
  assert.doesNotMatch(typography, /button:not\(\.cnav-dot\)/);
  assert.doesNotMatch(typography, /\.hero-title,\s*\r?\n\.page-title,\s*\r?\n\.venture-title/);
  assert.match(mobile, /--grid-gap-mobile/);
  assert.match(mobile, /--page-padding-x-compact/);
  assert.match(venture, /--section-gap-tablet/);
  assert.match(venture, /--grid-gap-compact/);
});
