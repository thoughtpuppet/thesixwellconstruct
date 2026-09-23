import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFileSync(join(ROOT, ...relativePath.split("/")), "utf8");

const requestFormPages = new Map([
  ["tattoos/inquire/custom/index.html", 1],
  ["tattoos/flash/claim/index.html", 1],
  ["tattoos/build/index.html", 1],
  ["tattoos/special-projects/index.html", 2],
  ["tattoos/special-projects/apply/index.html", 1],
  ["tattoos/specials/index.html", 1],
]);

test("public tattoo request forms use the shared before-booking guide", () => {
  for (const [relativePath, placeholderCount] of requestFormPages) {
    const source = read(relativePath);
    assert.match(source, /href="\/css\/tattoo-before-booking\.css"/, relativePath);
    assert.match(source, /src="\/js\/tattoo-before-booking\.js"/, relativePath);
    assert.equal((source.match(/data-tattoo-before-booking/g) || []).length, placeholderCount, relativePath);
  }

  const custom = read("tattoos/inquire/custom/index.html");
  assert.doesNotMatch(custom, /Every request is reviewed and approved before booking/);
  assert.ok(custom.indexOf("data-tattoo-before-booking") < custom.indexOf('id="inquiryForm"'));

  const build = read("tattoos/build/index.html");
  assert.doesNotMatch(build, /data-copy-id="build-form-note"/);
  assert.ok(build.indexOf("data-tattoo-before-booking") < build.indexOf('id="buildBriefForm"'));

  const application = read("tattoos/special-projects/apply/index.html");
  assert.ok(application.indexOf("data-tattoo-before-booking") < application.indexOf('id="specialProjectForm"'));
});

test("Tattoo index places the shared guide before Ways to Collaborate", () => {
  const landing = read("tattoos/index.html");
  assert.match(landing, /href="\/css\/tattoo-before-booking\.css"/);
  assert.match(landing, /src="\/js\/tattoo-before-booking\.js"/);
  assert.equal((landing.match(/data-tattoo-before-booking/g) || []).length, 1);
  assert.match(landing, /\.index-before-booking \.tattoo-before-booking \{ margin-bottom:0; \}/);
  assert.ok(landing.indexOf('id="booking-process"') < landing.indexOf('id="before-booking"'));
  assert.ok(landing.indexOf('id="before-booking"') < landing.indexOf('id="ways-to-work"'));
});

test("consultation, planning, healed-photo, and internal preview forms do not receive the guide", () => {
  for (const relativePath of [
    "tattoos/inquire/consultation/index.html",
    "tattoos/build/in-person/index.html",
    "tattoos/special-projects/healed/index.html",
    "tattoos/build-managed-preview/index.html",
  ]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /tattoo-before-booking/, relativePath);
  }
});

test("shared guide matches the inquiry guide subjects and accordion behavior", () => {
  const component = read("js/tattoo-before-booking.js");
  const chooser = read("tattoos/inquire/index.html");
  const styles = read("css/tattoo-before-booking.css");
  const customStyles = read("css/tattoo-custom-inquiry.css");
  const componentTitles = [...component.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);
  const chooserTitles = [...chooser.matchAll(/<summary>([^<]+)<\/summary>/g)].map((match) => match[1].replaceAll("&amp;", "&"));

  assert.equal(componentTitles.length, 13);
  assert.deepEqual(componentTitles, chooserTitles);
  assert.match(component, /aria-expanded="false"/);
  assert.match(component, /class="tattoo-before-booking__title-button"/);
  assert.match(component, /\[toggle, titleToggle\]\.forEach/);
  assert.match(component, /content\.hidden = !open/);
  assert.match(component, /section\.classList\.toggle\("is-collapsed", !open\)/);
  assert.match(component, /name="' \+ groupName/);
  assert.match(styles, /border: 5px solid var\(--before-booking-ring\)/);
  assert.match(styles, /\.tattoo-before-booking\.is-collapsed/);
  assert.match(styles, /\.tattoo-before-booking\.is-collapsed \.tattoo-before-booking__toggle \{[\s\S]*?top: auto;[\s\S]*?bottom: 4px;/);
  assert.match(styles, /\.tattoo-before-booking\.is-collapsed:hover \{[\s\S]*?background: var\(--before-booking-hover\);/);
  assert.doesNotMatch(styles, /\.tattoo-before-booking:focus-within/);
  assert.match(styles, /\.tattoo-before-booking__title-button \{[\s\S]*?letter-spacing: inherit !important;[\s\S]*?line-height: inherit !important;/);
  assert.match(customStyles, /@media \(max-width: 640px\) \{[\s\S]*?body\.custom-inquiry-page \.layout \{[\s\S]*?gap: 0 !important;[\s\S]*?body\.custom-inquiry-page \.site-hero \{[\s\S]*?margin-bottom: 24px;[\s\S]*?body\.custom-inquiry-page \.form-panel \{[\s\S]*?padding-top: 0 !important;/);
  assert.match(styles, /@media \(max-width: 780px\)/);
});
