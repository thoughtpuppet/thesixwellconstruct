import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

test("shared public form typography increases by two pixels on mobile", () => {
  const forms = read("css", "forms.css");
  const mobile = forms.slice(forms.indexOf("@media (max-width: 768px)"));

  assert.match(mobile, /\.form-field__label,[\s\S]*?font-size:\s*12px/);
  assert.match(mobile, /input:not\(\[type="checkbox"\]\)[\s\S]*?font-size:\s*18px\s*!important/);
  assert.match(mobile, /label\.form-check,[\s\S]*?font-size:\s*12px/);
  assert.match(mobile, /\.form-note\s*\{[\s\S]*?font-size:\s*15px/);
  assert.match(mobile, /\.form-help,[\s\S]*?\.form-status\s*\{[\s\S]*?font-size:\s*14px/);
});

test("custom select text stays aligned with ordinary mobile controls", () => {
  const selectMenu = read("css", "select-menu.css");
  const mobile = selectMenu.slice(selectMenu.indexOf("@media (max-width: 768px)"));

  assert.match(mobile, /\.custom-select > \.custom-select-trigger,[\s\S]*?font-size:\s*18px/);
});

test("Custom Inquiry uses a paragraph-sized Project description field on mobile", () => {
  const page = read("tattoos", "inquire", "custom", "index.html");
  const submissions = read("functions", "api", "submissions", "_lib.js");
  const studio = read("studio", "submissions", "index.html");

  assert.match(page, /<label for="message">Project description/);
  assert.match(page, /<textarea class="project-description" id="message" name="message" required>/);
  assert.match(page, /@media \(max-width:640px\)[\s\S]*?\.field textarea\.project-description \{ min-height:180px!important; \}/);
  assert.match(submissions, /\["message", "Project description is required\."\]/);
  assert.match(studio, /<label>Project Description<\/label><div class="value full">\$\{escapeHtml\(p\("message"\)\)\}/);
});
