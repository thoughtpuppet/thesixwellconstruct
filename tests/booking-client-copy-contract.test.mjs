import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const bookingPages = [
  "booking/index.html",
  "booking/reschedule/index.html",
  "booking/studio/index.html",
  "booking/studio-visit/index.html",
  "booking/confirmed/index.html",
  "booking/confirmed/build/index.html",
  "booking/confirmed/consultation/index.html",
  "booking/confirmed/virtual-consultation/index.html",
  "booking/confirmed/studio/index.html",
];

test("booking pages opt operational prose into sentence case without changing the Tattoo index", () => {
  for (const relativePath of bookingPages) {
    const source = readFileSync(join(ROOT, ...relativePath.split("/")), "utf8");
    assert.match(source, /<body[^>]*class="[^"]*booking-client-flow[^"]*"/, relativePath);
    assert.match(source, /href="\/css\/booking-client-copy\.css"/, relativePath);
  }

  const styles = readFileSync(join(ROOT, "css", "booking-client-copy.css"), "utf8");
  assert.match(styles, /body\.booking-client-flow main/);
  assert.match(styles, /p:not\(\.hero-descriptor\)/);
  assert.match(styles, /text-transform:\s*none !important/);
  assert.match(styles, /letter-spacing:\s*normal !important/);
  assert.match(styles, /\.pending-checkout-link, \.pending-checkout-button/);
  assert.match(styles, /text-transform:\s*uppercase !important/);

  const tattooIndex = readFileSync(join(ROOT, "tattoos", "index.html"), "utf8");
  assert.doesNotMatch(tattooIndex, /booking-client-copy\.css|booking-client-flow/);
});

test("operational booking leads no longer use the uppercase hero descriptor role", () => {
  const operationalPages = bookingPages.filter((relativePath) =>
    relativePath.includes("confirmed/") || relativePath === "booking/reschedule/index.html"
  );
  for (const relativePath of operationalPages) {
    const source = readFileSync(join(ROOT, ...relativePath.split("/")), "utf8");
    assert.doesNotMatch(source, /class="lead hero-descriptor"/, relativePath);
  }
});
