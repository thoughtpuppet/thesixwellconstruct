import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFileSync(join(ROOT, ...relativePath.split("/")), "utf8");

const publicTattooEntryPages = [
  "tattoos/index.html",
  "tattoos/inquire/index.html",
  "tattoos/inquire/consultation/index.html",
  "tattoos/build/in-person/index.html",
  "booking/index.html",
];

test("public tattoo entry pages do not promise walk-in availability", () => {
  for (const relativePath of publicTattooEntryPages) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /walk[- ]?ins?|walkIn(?:Cards|Guidance|Section|Windows)|walk-in-windows/i,
      relativePath,
    );
  }
});

test("tattoo inquiry and booking paths remain connected", () => {
  const landing = read("tattoos/index.html");
  assert.match(landing, /href="\/tattoos\/inquire\/"[^>]*>Book an appointment<\/a>/);

  const chooser = read("tattoos/inquire/index.html");
  for (const href of [
    "/tattoos/flash/",
    "/tattoos/inquire/custom/",
    "/tattoos/build/",
    "/tattoos/special-projects/",
    "/tattoos/inquire/consultation/?type=consult_in_person",
    "/tattoos/inquire/consultation/?type=consult_virtual",
  ]) {
    assert.match(chooser, new RegExp(`href="${href.replace(/[?]/g, "\\?")}"`), href);
  }

  const consultation = read("tattoos/inquire/consultation/index.html");
  assert.match(consultation, /initBookingCalendar\(\{/);
  assert.match(consultation, /apiBookingTypeIds:\s*CONSULTATION_TYPE_IDS/);

  const build = read("tattoos/build/in-person/index.html");
  assert.match(build, /contextUrl:\s*"\/api\/booking\/public-session\/context"/);
  assert.match(build, /checkoutUrl:\s*"\/api\/booking\/public-session\/checkout"/);

  const booking = read("booking/index.html");
  assert.match(booking, /id="appointmentSelection"/);
  assert.match(booking, /id="checkoutBtn"/);
});
