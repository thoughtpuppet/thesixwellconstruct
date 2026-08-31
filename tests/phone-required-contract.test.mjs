import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const PUBLIC_PHONE_FIELDS = [
  ["tattoos/inquire/custom/index.html", "phone"],
  ["tattoos/inquire/consultation/index.html", "phone"],
  ["tattoos/flash/claim/index.html", "phone"],
  ["tattoos/special-projects/apply/index.html", "phone"],
  ["tattoos/build/index.html", "phone"],
  ["tattoos/build/in-person/index.html", "phone"],
  ["booking/studio/index.html", "phone"],
  ["booking/studio-visit/index.html", "phone"],
  ["booking/index.html", "clientPhoneInput"],
  ["art/acquisitioninquiry.html", "phone"],
  ["events/greenfield/index.html", "phone"],
  ["events/greenfield/index.html", "performerPhone"],
  ["events/signal-symbol/index.html", "phone"],
  ["events/signal-symbol/index.html", "waitPhone"],
  ["tattoos/specials/index.html", "specialsPhone"],
];

test("public inquiry, booking, and event forms require phone in the browser", () => {
  for (const [path, id] of PUBLIC_PHONE_FIELDS) {
    const source = read(...path.split("/"));
    const input = source.match(new RegExp(`<input[^>]*id=["']${id}["'][^>]*>`, "i"))?.[0] || "";
    assert.match(input, /\btype=["']tel["']/i, `${path}#${id} must be a telephone input`);
    assert.match(input, /\brequired\b/i, `${path}#${id} must be required`);
  }
});

test("public APIs reject missing phone numbers", () => {
  const submissions = read("functions", "api", "submissions", "_lib.js");
  const booking = read("functions", "api", "booking", "_lib.js");
  const events = read("functions", "api", "events", "_lib.js");
  const specials = read("functions", "api", "tattoo-specials", "_lib.js");

  assert.match(submissions, /if \(!submission\.contact\.phone\)[\s\S]*?Phone number is required\./);
  assert.equal((booking.match(/if \(!client\.phone\) return \{ error: "Phone number is required\." \};/g) || []).length, 2);
  assert.equal((events.match(/Phone number is required\./g) || []).length, 3);
  assert.match(specials, /if \(!primary\.phone\) return failure\("Enter the primary purchaser's phone number\./);
});

test("custom event submit handlers surface a missing-phone error before fetch", () => {
  const greenfield = read("events", "greenfield", "index.html");
  const signalSymbol = read("events", "signal-symbol", "index.html");

  assert.equal((greenfield.match(/Please enter your phone number\./g) || []).length, 2);
  assert.equal((signalSymbol.match(/Please enter your phone number\./g) || []).length, 2);
});
