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
  assert.match(styles, /\.tattoo-before-booking:hover,[\s\S]*?background: var\(--before-booking-hover\);/);
  assert.match(styles, /@media \(max-width: 780px\)/);
});
