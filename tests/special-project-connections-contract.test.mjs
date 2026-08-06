import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

test("Special Project calls receive collision-safe Construct identities", () => {
  const migration = source("migrations", "0109_special_project_connections.sql");
  const booking = source("functions", "api", "booking", "_lib.js");
  assert.match(migration, /INSERT INTO content_entities/);
  assert.doesNotMatch(migration, /INSERT OR IGNORE INTO content_entities/);
  assert.match(migration, /'special_project'/);
  assert.match(booking, /existingEntity\.entity_type !== "special_project"/);
  assert.match(booking, /Special Projects with application history cannot be deleted/);
  assert.match(booking, /DELETE FROM content_entities WHERE id = \? AND entity_type = 'special_project'/);
  assert.match(booking, /VALUES \(\?, 'special_project', 'node-tattoos', 'public'/);
});

test("Construct directory exposes Special Projects with routes, profiles, and primary media", () => {
  const construct = source("functions", "api", "construct", "_lib.js");
  assert.match(construct, /WHEN 'special_project' THEN spc\.title/);
  assert.match(construct, /WHEN 'special_project' THEN '\/tattoos\/special-projects\/\?project='\|\|spc\.slug/);
  assert.match(construct, /FROM special_project_call_media spm JOIN media_assets m/);
  assert.match(construct, /ORDER BY CASE spm\.role WHEN 'primary' THEN 0 ELSE 1 END/);
  assert.match(construct, /WHEN 'special_project' THEN 'Special Project'/);
  assert.match(construct, /WHEN 'special_project' THEN CASE spc\.profile WHEN 'experimental' THEN 'Experimental' ELSE 'Extended' END/);
});

test("Special Projects Studio reuses the Art-style scoped connection panel without nesting forms", () => {
  const studio = source("studio", "submissions", "index.html");
  const manager = source("studio", "connections-manager.js");
  assert.match(studio, /specialProjectConnectionsBlock\(seriesId, "series"\)/);
  assert.match(studio, /specialProjectConnectionsBlock\(project\.id \|\| "", "project"\)/);
  assert.match(studio, /Save this \$\{kind\} first to add Construct connections/);
  assert.match(studio, /data-special-project-connections[\s\S]*aria-expanded="false"[\s\S]*aria-controls=/);
  assert.match(studio, /data-special-project-connections-panel hidden/);
  assert.match(studio, /panel\.hidden = isOpen/);
  assert.match(studio, /<div class="tattoo-settings" data-special-projects-form>/);
  assert.doesNotMatch(studio, /<form class="tattoo-settings" data-special-projects-form>/);
  assert.match(studio, /data-save-special-projects/);
  assert.match(studio, /event\.target\.matches\?\.\("\[data-special-projects-form\]"\)/);
  assert.match(studio, /excludedRelationshipTypeIds: \["rel-realized-as"\]/);
  assert.match(studio, /wireSpecialProjectConnections\(detailEl\)/);
  assert.match(manager, /excludedRelationshipTypeIds/);
  assert.match(manager, /excludedTargetEntityTypes/);
  assert.match(manager, /cm-entity-options-\$\{\+\+mountSequence\}/);
  assert.match(manager, /public_visible:form\.elements\.public_visible\.checked/);
});

test("public Special Projects reuse the canonical Cards and Graph connection component", () => {
  const page = source("tattoos", "special-projects", "index.html");
  const component = source("js", "construct-connections.js");
  assert.match(page, /id="seriesConnections" hidden/);
  assert.match(page, /id="projectConnections" hidden/);
  assert.match(page, /\/js\/construct-connections\.js\?v=6/);
  assert.match(page, /title: "Project Connections"/);
  assert.match(page, /title: "Series Connections"/);
  assert.match(page, /activeSeriesSlug[\s\S]*seriesRecords\.find/);
  assert.match(component, /options\.title\|\|"Related"/);
  assert.match(component, /mountRequests=new WeakMap/);
  assert.match(component, /window\.ConstructConnections=\{mount,clear\}/);
  assert.match(component, /"Cards"/);
  assert.match(component, /"Graph"/);
});
