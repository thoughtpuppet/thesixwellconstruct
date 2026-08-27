import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profilePath = new URL("../about/saieldauhnsolehman/index.html", import.meta.url);
const profileCssPath = new URL("../about/saieldauhnsolehman/profile.css", import.meta.url);
const constructNavPath = new URL("../js/construct-nav.js", import.meta.url);
const tattooIndexPath = new URL("../tattoos/index.html", import.meta.url);

const aboutNavigationPaths = [
  "../about/breakdown/index.html",
  "../about/contact-press/index.html",
  "../about/exhibitions-appearances/index.html",
  "../about/founder/index.html",
  "../about/legend/index.html",
  "../about/mediums/index.html",
  "../about/six-well/index.html",
  "../about/visual-language/index.html",
  "../about/ways-in/index.html",
  "../js/legend-record-view.js",
];

test("Saiel profile uses the About shell and publishes the supplied inquiry statement", async () => {
  const html = await readFile(profilePath, "utf8");

  assert.match(html, /class="about-section-page saiel-profile-page entrance-fade"/);
  assert.match(html, /site-hero site-hero--supporting/);
  assert.match(html, /class="hero-title">Saiel Dauhn Solehman\.<\/h1>/);
  assert.match(html, /Saiel Dauhn Solehman’s work emerges from the merging of deep philosophical inquiry and systems thinking\./);
  assert.match(html, /Her approach is grounded in an effort to understand the world rather than change it\./);
  assert.match(html, /currently studies philosophy, politics, and economics at Georgia State University/);
  assert.doesNotMatch(html, /class="profile-facts"/);
});

test("Saiel profile uses the repository portrait and bounded profile styling", async () => {
  const [html, css] = await Promise.all([
    readFile(profilePath, "utf8"),
    readFile(profileCssPath, "utf8"),
  ]);

  assert.match(html, /src="\/assets\/Sai%20Solehman%20Sunflower%20Scarf\.jpg"/);
  assert.match(html, /alt="Saiel Dauhn Solehman wearing a sunflower-patterned scarf"/);
  assert.match(css, /\.profile-image-frame\s*\{[^}]*border:\s*5px solid/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.profile-feature\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("shared construct navigation exposes the permanent Saiel profile route", async () => {
  const nav = await readFile(constructNavPath, "utf8");
  const routeMatches = nav.match(/\/about\/saieldauhnsolehman\//g) || [];

  assert.ok(routeMatches.length >= 2);
});

test("Tattoo artist band links to the permanent Saiel profile", async () => {
  const html = await readFile(tattooIndexPath, "utf8");

  assert.match(html, /href="\/about\/saieldauhnsolehman\/" data-copy-id="tattoos-artist-action-about"/);
});

test("About profile buttons share the permanent Saiel profile destination", async () => {
  const sources = await Promise.all(
    aboutNavigationPaths.map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")),
  );

  for (const source of sources) {
    assert.match(source, /href="\/about\/saieldauhnsolehman\/"/);
    assert.doesNotMatch(source, /href="\/about\/founder\/"/);
  }
});
