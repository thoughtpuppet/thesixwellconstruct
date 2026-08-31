import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(ROOT, "js", "atlanta-calendar-record.js"), "utf8");
const context = { window:{} };
runInNewContext(source, context);

const { classificationEnd, isPast } = context.window.AtlantaCalendarRecord;
const NOW = Date.parse("2026-08-31T13:00:00-04:00");

test("legacy single timed ranges expire from Upcoming at their original occurrence", () => {
  const legacyRange = {
    dateKind:"timed",
    eventStructure:"single",
    startsAt:"2026-03-15T12:30:00-04:00",
    endsAt:"2026-12-06T21:30:00-05:00",
  };
  assert.equal(classificationEnd(legacyRange).toISOString(), "2026-03-15T16:30:00.000Z");
  assert.equal(isPast(legacyRange, NOW), true);
});

test("ordinary timed occurrences remain Upcoming until their real end", () => {
  const occurrence = {
    dateKind:"timed",
    eventStructure:"single",
    isOccurrence:true,
    startsAt:"2026-08-31T12:00:00-04:00",
    endsAt:"2026-09-02T12:00:00-04:00",
  };
  assert.equal(classificationEnd(occurrence).toISOString(), "2026-09-02T16:00:00.000Z");
  assert.equal(isPast(occurrence, NOW), false);
});

test("date ranges and exhibitions retain their full active window", () => {
  const workshop = {
    dateKind:"date_range",
    eventStructure:"single",
    startsAt:"2026-08-25",
    endsAt:"2026-09-15",
  };
  const exhibition = {
    dateKind:"date_range",
    eventStructure:"exhibition",
    startsAt:"2026-06-05",
    endsAt:"2026-11-29",
  };
  assert.equal(isPast(workshop, NOW), false);
  assert.equal(isPast(exhibition, NOW), false);
});

test("same-day timed events stay Upcoming until they end", () => {
  const sameDay = {
    dateKind:"timed",
    eventStructure:"single",
    startsAt:"2026-08-31T12:00:00-04:00",
    endsAt:"2026-08-31T14:00:00-04:00",
  };
  assert.equal(isPast(sameDay, NOW), false);
  assert.equal(isPast(sameDay, Date.parse("2026-08-31T14:01:00-04:00")), true);
});
