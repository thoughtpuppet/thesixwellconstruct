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
  assert.match(source, /\$\{requestedAppointment\} is approved\. Confirm the appointment by paying the \$\{depositLabel\} deposit/);
  assert.match(source, /the requested time is not reserved until payment succeeds/);
  assert.doesNotMatch(source, /by \$\{formatDate\(pending\.paymentDueAt\)\}/);
  assert.match(source, /Private booking access for \$\{requestedAppointment\} is no longer active/);
  assert.doesNotMatch(source, /The deposit window for \$\{requestedAppointment\} has ended/);
  assert.doesNotMatch(source, /Studio approved your requested time/);
});

test("pending Tattoo Special confirmation uses the requested review and deposit copy", () => {
  const source = readFileSync(join(ROOT, "booking", "index.html"), "utf8");

  assert.match(source, /function formatRequestedTime\(value\)/);
  assert.match(source, /return `\$\{day\} at \$\{time\}`/);
  assert.match(source, /Your requested time, \$\{formatRequestedTime\(pending\.startAt \|\| pending\.heldStartAt\)\}, has been submitted for review\. The appointment has not been booked yet, and the deposit is not due until approval\./);
  assert.doesNotMatch(source, /formatRequestedTime\(pending\.startAt \|\| pending\.heldStartAt\)\.toUpperCase\(\)/);
  assert.doesNotMatch(source, /HAS BEEN SENT TO STUDIO FOR REVIEW|IT HAS NOT BOOKED YET/);
  assert.doesNotMatch(source, /It is not reserved, no appointment is booked/);
});
