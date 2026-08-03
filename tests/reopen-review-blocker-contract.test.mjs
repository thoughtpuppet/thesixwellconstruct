import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("reopen review reports the exact booking commitment that must be cleared", () => {
  const source = readFileSync(join(ROOT, "functions", "api", "submissions", "_lib.js"), "utf8");

  assert.match(source, /blocker\.kind === "booking_link"[\s\S]*?Revoke the active booking link before reopening review\./);
  assert.match(source, /blocker\.kind === "pending_checkout"[\s\S]*?Release the pending checkout and its held time before reopening review\./);
  assert.match(source, /blocker\.kind === "confirmed_appointment"[\s\S]*?Cancel the confirmed appointment before reopening review\./);
  assert.doesNotMatch(source, /Clear active booking access, pending checkouts, held times, and confirmed appointments before reopening review\./);
});
