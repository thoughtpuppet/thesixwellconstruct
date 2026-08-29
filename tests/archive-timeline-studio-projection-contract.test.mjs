import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const studio = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");

function sourceSection(start, end) {
  const startIndex = studio.indexOf(start);
  const endIndex = studio.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return studio.slice(startIndex, endIndex);
}

test("activity editor preserves subject associations returned by the admin API", () => {
  const subjectHelper = sourceSection("function activitySubjectIds(", "function activityForm(");
  const form = sourceSection("function activityForm(", "function activityCard(");

  assert.match(subjectHelper, /subject_entity_ids/);
  assert.match(subjectHelper, /subjectEntityIds/);
  assert.match(subjectHelper, /subject_entity_id/);
  assert.match(subjectHelper, /entity_id/);
  assert.match(form, /subjects=activitySubjectIds\(activity\)/);
  assert.match(form, /subjects\.join\(", "\)/);
});

test("timeline workspace renders a read-only chronological projection of subject milestones", () => {
  const card = sourceSection("function timelineMilestoneCard(", "function serializeTimelineForm(");
  const loader = sourceSection("async function loadArchiveTimeline(", "function bindTimelineWorkspace(");

  assert.match(loader, /api\(archiveEndpoints\.activities\)/);
  assert.match(loader, /filter\(activity=>activitySubjectIds\(activity\)\.includes\(subjectEntityId\)\)/);
  assert.match(loader, /sort\(timelineActivityOrder\)/);
  assert.match(loader, /Milestone entries/);
  assert.match(loader, /activities\.map\(timelineMilestoneCard\)/);
  assert.match(card, /data-timeline-activity/);
  assert.match(card, /Public milestone/);
  assert.match(card, /Internal milestone/);
  assert.doesNotMatch(card, /<form|activityForm\(/);
});
