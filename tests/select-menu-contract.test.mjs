import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("shared select menus preserve native form controls and expose the synchronization API", () => {
  const source = read("js/select-menu.js");
  assert.match(source, /select:not\(\[multiple\]\):not\(\[size\]\):not\(\[data-select-menu-skip\]\)/);
  assert.match(source, /select\.insertAdjacentElement\("afterend", root\)/);
  assert.match(source, /select\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(source, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(source, /select\._customSync = \(\) => sync\(select\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /aria-required/);
  assert.match(source, /global\.SixWellSelectMenu = \{ enhance, sync, closeAll \}/);
  assert.match(source, /"ArrowDown"/);
  assert.match(source, /"Escape"/);
  assert.match(source, /runTypeahead/);
  assert.match(source, /positionList/);
});

test("shared select styling uses neutral resting fields with medium-aware interaction accents", () => {
  const styles = read("css/select-menu.css");
  assert.match(styles, /--select-menu-rest-border:\s*var\(\s*--form-control-border/);
  assert.match(styles, /--select-menu-rest-text:\s*var\(\s*--form-control-text/);
  assert.match(styles, /--select-menu-bg:\s*var\(--form-control-bg/);
  assert.match(styles, /min-height:\s*var\(--form-control-height,\s*44px\)/);
  assert.match(styles, /\.custom-select > \.custom-select-trigger[\s\S]*?border: 5px solid var\(--select-menu-rest-border\)[\s\S]*?color: var\(--select-menu-rest-text\)/);
  assert.match(styles, /\.custom-select > \.custom-select-trigger:hover,[\s\S]*?border-color: var\(--select-menu-accent\)/);
  assert.match(styles, /\.custom-select > \.custom-select-trigger:focus-visible[\s\S]*?border-color: var\(--select-menu-accent\);[\s\S]*?outline: 0/);
  assert.match(styles, /\.custom-select-option[\s\S]*?color: var\(--select-menu-rest-text\)/);
  assert.match(styles, /\.custom-select-option\.is-selected[\s\S]*?background: var\(--select-menu-accent\)/);
  assert.match(styles, /--select-menu-list-max-height: 240px/);
  assert.match(styles, /body\[data-venture="tattooing"\] \.custom-select/);
  assert.match(styles, /body\[data-venture="art"\] \.custom-select/);
  assert.match(styles, /body\[data-venture="events"\] \.custom-select/);
  assert.match(styles, /body\[data-venture="archive"\] \.custom-select/);
  assert.match(styles, /\.custom-select-option\.is-selected/);
  assert.match(styles, /\.custom-select\.opens-up/);
});

test("production shells load the enhancer while established custom menus can opt out", () => {
  const publicShell = read("js/construct-nav.js");
  const studio = read("studio/submissions/index.html");
  const merch = read("merch/index.html");
  const mazeEntry = read("apps/maze/src/main.tsx");
  const mazeHtml = read("apps/maze/index.html");

  assert.match(publicShell, /\/css\/select-menu\.css\?v=2/);
  assert.match(publicShell, /\/js\/select-menu\.js\?v=2/);
  assert.match(studio, /<link rel="stylesheet" href="\/css\/select-menu\.css\?v=2">/);
  assert.match(studio, /<script src="\/js\/select-menu\.js\?v=2"><\/script>/);
  assert.match(studio, /window\.SixWellSelectMenu\?\.enhance\(root\)/);
  assert.doesNotMatch(studio, /function enhanceSelect\(/);
  assert.match(merch, /id="sourceFilterSelect"[^>]*data-select-menu-skip/);
  assert.match(mazeEntry, /import "\.\.\/\.\.\/\.\.\/css\/select-menu\.css"/);
  assert.match(mazeEntry, /import "\.\.\/\.\.\/\.\.\/js\/select-menu\.js"/);
  assert.match(mazeHtml, /<body data-venture="tattooing">/);
});
