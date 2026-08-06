import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT=fileURLToPath(new URL("..",import.meta.url));
const source=(...parts)=>readFileSync(join(ROOT,...parts),"utf8");

test("Origin Thread assignments are generalized once at the canonical entity layer",()=>{
  const migration=source("migrations","0110_origin_thread_entities.sql"),api=source("functions","api","construct","_lib.js");
  assert.match(migration,/CREATE TABLE archive_origin_thread_entities/);
  assert.match(migration,/FOREIGN KEY\(entity_id\) REFERENCES content_entities\(id\)/);
  assert.match(migration,/SELECT thread_id,dossier_entity_id,is_primary,sort_order,created_at/);
  assert.match(migration,/DROP TABLE archive_origin_thread_dossiers/);
  assert.match(api,/entityOriginThreadsMatch=path\.match/);
  assert.match(api,/replaceEntityOriginThreads/);
  assert.doesNotMatch(api,/replaceDossierOriginThreads|archive_origin_thread_dossiers/);
});

test("the shared Studio Connections workbench owns the reusable Origin Thread editor",()=>{
  const connections=source("studio","connections-manager.js"),origins=source("studio","origin-thread-manager.js"),construct=source("studio","construct-manager.js"),merch=source("studio","merch-manager.js"),studio=source("studio","submissions","index.html");
  assert.match(connections,/options\.originThreads/);
  assert.match(connections,/OriginThreadManager\?\.mount/);
  assert.match(origins,/\/api\/admin\/entities\/\$\{encodeURIComponent\(entityId\)\}\/origin-threads/);
  assert.match(origins,/Primary origin thread/);
  assert.match(origins,/Archived provenance retained/);
  assert.match(construct,/flash:\{[^\n]*originThreads:true/);
  assert.match(construct,/symbols:\{[^\n]*originThreads:true/);
  assert.match(construct,/works:\{[^\n]*originThreads:true/);
  assert.match(merch,/entityId:record\.id,originThreads:true/);
  assert.match(studio,/connections\.dataset\.id, originThreads: true/);
  assert.match(studio,/data-event-connections/);
  assert.match(studio,/entityId: connections\.dataset\.eventConnections, originThreads: true/);
  assert.match(studio,/originThreads: kind === "project"/);
});

test("public detail Related sections place Origin Thread cards before pairwise relationships and outside the graph",()=>{
  const component=source("js","construct-connections.js"),merch=source("js","merch-detail.js"),merchPage=source("merch","detail","index.html"),projects=source("tattoos","special-projects","index.html");
  assert.match(component,/if\(originThreads\.length\)content\.appendChild\(originGroup/);
  assert.match(component,/Primary inception/);
  assert.match(component,/Supporting inception/);
  assert.match(component,/\/archive\/\?origin=/);
  assert.match(component,/const mapView=map\(records,payload\.entity\)/);
  assert.doesNotMatch(component,/map\(originThreads/);
  assert.match(merch,/ConstructConnections\.mount\(\{ host: section, entityId: product\.id, title: "Related", embedded: true \}\)/);
  assert.doesNotMatch(merch,/related-card|originRelatedCard/);
  assert.match(merchPage,/<section class="related" id="productRelated" hidden><\/section>/);
  assert.match(merchPage,/\/js\/construct-connections\.js\?v=7/);
  assert.match(projects,/title: "Related"/);
  assert.match(projects,/title: "Series Connections"/);
});
