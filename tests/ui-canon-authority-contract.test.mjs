import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Guide uses direct source links without verification statuses", async () => {
  const [systemJs, systemCss] = await Promise.all([
    read("tools/ui-guide-system.js"),
    read("tools/ui-guide-system.css"),
  ]);

  for (const field of [
    "primaryRoute",
    "candidateRoutes",
    "ownerFiles",
    "parentFamily",
    "variantOf",
    "adoptionState",
    "notes",
  ]) {
    assert.match(systemJs, new RegExp(`${field}:`), `missing source field ${field}`);
  }

  assert.match(systemJs, /function sourceRecord\(record, system\)/);
  assert.match(systemJs, /function sourceInfo\(record\)/);
  assert.match(systemJs, /PUBLIC_TEMPLATES\.forEach\(function \(record\) \{ sourceRecord\(record, "public"\); \}\)/);
  assert.match(systemJs, /COMPONENTS\.forEach\(function \(record\) \{ sourceRecord\(record, record\.system \|\| "public"\); \}\)/);
  assert.match(systemJs, /STUDIO_PATTERNS\.forEach\(function \(record\) \{ sourceRecord\(record, "studio"\); \}\)/);
  assert.match(systemJs, /SPECIALIZED\.forEach\(function \(record\) \{ sourceRecord\(record, "specialized"\); \}\)/);

  for (const removed of [
    "authorityStatus",
    "Unverified",
    "Under Review",
    "Approved Canon",
    "Approved Variant",
    "visualEvidenceStatus",
    "approvedDeltas",
    "previewAuthorityNotice",
  ]) {
    assert.doesNotMatch(systemJs, new RegExp(removed), `verification artifact remains: ${removed}`);
  }
  assert.doesNotMatch(systemCss, /authority-chip|visual-review-gate|canon-review-item/);
  assert.doesNotMatch(systemJs, /preview-stage|renderPreview|previewDocument|data-viewport/);
  assert.doesNotMatch(systemCss, /preview-stage|preview-viewport|viewport-presets/);
});

test("Source Map links references, candidates, owners, and adoption notes", async () => {
  const systemJs = await read("tools/ui-guide-system.js");

  assert.match(systemJs, /FOUNDATION_PATTERNS\.map\(function \(record\)/);
  assert.match(systemJs, /\.concat\(PUBLIC_TEMPLATES\.map\(function \(record\)/);
  assert.match(systemJs, /\.concat\(COMPONENTS\.map\(function \(record\)/);
  assert.match(systemJs, /\.concat\(STUDIO_PATTERNS\.map\(function \(record\)/);
  assert.match(systemJs, /\.concat\(SPECIALIZED\.map\(function \(record\)/);

  for (const heading of [
    "Reference route",
    "Candidate routes",
    "Owning files",
    "Adoption / notes",
  ]) {
    assert.match(systemJs, new RegExp(`<th>${heading.replace("/", "\\/")}<\\/th>`), `missing Source Map column ${heading}`);
  }
});

test("established foundations remain present without a review queue", async () => {
  const [systemJs, tokens] = await Promise.all([
    read("tools/ui-guide-system.js"),
    read("css/tokens.css"),
  ]);

  for (const id of [
    "foundation-canvas-ink",
    "foundation-typography",
    "foundation-spacing",
    "foundation-structure-motion",
  ]) {
    assert.match(systemJs, new RegExp(`id: "${id}"`));
  }
  assert.match(systemJs, /Foundation is already established in the UI Guide/);
  assert.match(systemJs, /Every pattern follows a named source/);
  assert.doesNotMatch(systemJs, /CANON_REVIEW_QUEUE|canon queue|Visual approval gate/i);

  assert.match(tokens, /--color-bg:\s+#0E0E0E/);
  assert.match(tokens, /--color-body:\s+#FBD19D/);
});

test("approved-client booking is the canonical public calendar source", async () => {
  const [systemJs, calendarCss, calendarJs, bookingHtml, rescheduleHtml] = await Promise.all([
    read("tools/ui-guide-system.js"),
    read("css/booking-calendar.css"),
    read("js/booking-calendar.js"),
    read("booking/index.html"),
    read("booking/reschedule/index.html"),
  ]);

  assert.match(
    systemJs,
    /id: "component-scheduling"[\s\S]*?referenceRoute: "\/booking\/\?preview=1"[\s\S]*?sources: \["booking\/index\.html", "css\/booking-calendar\.css", "js\/booking-calendar\.js", "booking\/reschedule\/index\.html"\]/,
  );
  assert.match(systemJs, /Shared public appointment pickers adopted · public variants preserve their workflows · Studio excluded/);
  assert.match(systemJs, /inherit their semantic site\/node color/);
  assert.match(calendarCss, /--calendar-node-color:var\(--venture-accent/);
  assert.match(calendarCss, /\.cal-month-select/);
  assert.match(calendarCss, /\.cal-month-count/);
  assert.match(calendarJs, /calMonthSelect\.className = "cal-month-select"/);
  assert.match(calendarJs, /function availableMonthKeys\(\)/);
  assert.match(bookingHtml, /href="\/css\/booking-calendar\.css"/);
  assert.match(bookingHtml, /class="cal-month-select"/);
  assert.match(bookingHtml, /class="cal-grid" role="grid"/);
  assert.doesNotMatch(bookingHtml, /\.day-button\s*\{/);
  assert.doesNotMatch(bookingHtml, /\.month-button\s*\{/);
  assert.match(rescheduleHtml, /href="\/css\/booking-calendar\.css"/);
  assert.match(rescheduleHtml, /class="reschedule-calendar cal-wrap"/);
  assert.match(rescheduleHtml, /class="cal-month-select"/);
  assert.match(rescheduleHtml, /class="cal-grid"/);
  assert.match(rescheduleHtml, /--venture-color:var\(--color-tattooing\)/);
  assert.doesNotMatch(
    systemJs.match(/"component-scheduling": \[[\s\S]*?\]\s*,/m)?.[0] || "",
    /studio\/submissions/,
  );
});
