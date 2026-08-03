import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("private booking presents contextual copy as body text and names the approved Tattoo Special request", () => {
  const source = readFileSync(join(ROOT, "booking", "index.html"), "utf8");

  assert.match(source, /class="booking-context-copy" id="bookingLead"/);
  assert.doesNotMatch(source, /class="lead hero-descriptor" id="bookingLead"/);
  assert.match(source, /const designLabel = \[special\.offerTitle, special\.variantLabel\]\.filter\(Boolean\)\.join/);
  assert.match(source, /const requestedAppointment = `\$\{designLabel\} appointment for \$\{formatDate\(pending\.startAt\)\}`/);
  assert.match(source, /Your requested \$\{requestedAppointment\} has been approved\. Confirm it by paying the \$\{depositLabel\} deposit/);
  assert.match(source, /pending\.paymentDueAt \? ` by \$\{formatDate\(pending\.paymentDueAt\)\}`/);
  assert.doesNotMatch(source, /Studio approved your requested time/);
});
