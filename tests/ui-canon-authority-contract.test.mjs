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

test("shared public checkboxes use one CSS authority with semantic accents", async () => {
  const [
    formsCss,
    submissionClient,
    bookingClient,
    calendarCss,
    systemJs,
    guideHtml,
    flashClaim,
    flashDetail,
    customInquiry,
    consultation,
    buildBrief,
    inPerson,
    specialApplication,
    privateBooking,
    studioBooking,
    studioVisit,
    eventRegistration,
    eventOpenMic,
    preferences,
    artInquiry,
    managedPreview,
  ] = await Promise.all([
    read("css/forms.css"),
    read("js/submission-form.js"),
    read("js/booking-calendar.js"),
    read("css/booking-calendar.css"),
    read("tools/ui-guide-system.js"),
    read("tools/ui-guide.html"),
    read("tattoos/flash/claim/index.html"),
    read("tattoos/flash/detail/index.html"),
    read("tattoos/inquire/custom/index.html"),
    read("tattoos/inquire/consultation/index.html"),
    read("tattoos/build/index.html"),
    read("tattoos/build/in-person/index.html"),
    read("tattoos/special-projects/apply/index.html"),
    read("booking/index.html"),
    read("booking/studio/index.html"),
    read("booking/studio-visit/index.html"),
    read("events/signal-symbol/index.html"),
    read("events/cultandshift/index.html"),
    read("preferences/index.html"),
    read("art/acquisitioninquiry.html"),
    read("tattoos/build-managed-preview/index.html"),
  ]);

  assert.match(formsCss, /label\.form-check\s*\{/);
  assert.match(formsCss, /input\.form-check__input\s*\{/);
  assert.match(formsCss, /width:\s*18px/);
  assert.match(formsCss, /appearance:\s*auto/);
  assert.match(formsCss, /accent-color:\s*var\(/);
  assert.match(formsCss, /label\.form-check--construct[\s\S]*?--form-check-accent:\s*var\(--color-accent,\s*#FCB467\)/);
  assert.match(formsCss, /input\.form-check__input:focus-visible/);
  assert.match(formsCss, /\.form-check-group\s*\{/);

  for (const client of [submissionClient, bookingClient]) {
    assert.match(client, /form-check form-check--construct/);
    assert.match(client, /form-check__input/);
    assert.match(client, /form-check-group__heading/);
    assert.doesNotMatch(client, /ensureConsentStyles|sixwellMarketingConsentStyles|marketing-consent-choice/);
  }
  assert.doesNotMatch(calendarCss, /marketing-consent/);

  const adoptedPages = [
    flashClaim,
    flashDetail,
    customInquiry,
    consultation,
    buildBrief,
    inPerson,
    specialApplication,
    privateBooking,
    studioBooking,
    studioVisit,
    eventRegistration,
    eventOpenMic,
    preferences,
    artInquiry,
    managedPreview,
  ];
  for (const page of adoptedPages) {
    assert.match(page, /href="\/css\/forms\.css(?:\?[^"]+)?"/);
  }

  const ordinaryControlPages = adoptedPages.filter((page) => page !== artInquiry);
  for (const page of ordinaryControlPages) {
    assert.match(page, /form-check__input/);
    assert.doesNotMatch(page, /\.check\s*\{|\.check input|\.check-label|\.marketing-consent-choice|\.preference-choice|\.extended-ack|\.session-plan-ack/);
  }

  assert.match(flashClaim, /\.sheet-option:has\(input:checked\)/);
  assert.match(flashClaim, /form-check__input form-check__input--flush/);
  assert.match(flashDetail, /\.sheet-design-row:has\(input:checked\)/);
  assert.match(flashDetail, /input\.className = 'form-check__input form-check__input--flush'/);
  assert.match(eventRegistration, /form-check form-check--construct/);
  assert.match(eventOpenMic, /form-check form-check--construct/);
  assert.match(preferences, /form-check form-check--construct/);

  assert.match(artInquiry, /\.type-tile input\[type="checkbox"\]\s*\{\s*display:none/);
  assert.match(systemJs, /id: "component-forms"[\s\S]*?sources: \["css\/forms\.css", "tattoos\/flash\/claim\/index\.html", "js\/submission-form\.js"\]/);
  assert.match(systemJs, /Shared public checkbox system adopted/);
  assert.match(systemJs, /form-check form-check--construct/);
  assert.match(guideHtml, /href="\/css\/forms\.css\?v=canonical-source"/);
});
