import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const source=(...parts)=>readFileSync(join(ROOT,...parts),"utf8");

test("Maze Archive migration seeds only public collection shells and a private authored-history draft",()=>{
  const database=new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for(const migration of readdirSync(join(ROOT,"migrations")).filter(name=>name.endsWith(".sql")).sort()) database.exec(source("migrations",migration));
  const collections=database.prepare("SELECT slug,state FROM archive_collections WHERE slug LIKE 'maze-built-by-%' ORDER BY slug").all();
  assert.deepEqual(collections.map(row=>`${row.slug}:${row.state}`),["maze-built-by-artpill:published","maze-built-by-others:published"]);
  const pattern=database.prepare("SELECT ce.visibility,ce.search_visibility,ar.state record_state,ad.state dossier_state,ad.public_visible,ot.state origin_state,ot.public_visible origin_visible FROM content_entities ce JOIN archive_records ar ON ar.id=ce.id JOIN archive_dossiers ad ON ad.entity_id=ce.id JOIN archive_origin_thread_dossiers otd ON otd.dossier_entity_id=ce.id JOIN archive_origin_threads ot ON ot.id=otd.thread_id WHERE ce.id='archive-maze-pattern'").get();
  assert.equal(`${pattern.visibility}/${pattern.search_visibility}/${pattern.record_state}/${pattern.dossier_state}/${pattern.public_visible}/${pattern.origin_state}/${pattern.origin_visible}`,"internal/0/draft/draft/0/draft/0");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM maze_archive_consents").get().count,0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM maze_archive_entries").get().count,0);
});

test("Maze Archive room uses the shared shell, existing collection API, useful states, and no remix surface",()=>{
  const page=source("archive","maze","index.html"),css=source("css","archive-maze.css"),client=source("js","archive-maze.js");
  assert.match(page,/archive-public\.css/);
  assert.match(page,/construct-breadcrumb/);
  assert.match(page,/class="hero-descriptor"/);
  assert.match(page,/archive-site-footer/);
  assert.match(page,/href="\/tattoos\/build\/maze\/"/);
  assert.match(css,/background:\s*var\(--color-bg\)/);
  assert.match(css,/border-(?:top|bottom|right):\s*5px|border:\s*5px/g);
  assert.doesNotMatch(css,/border[^;]*:\s*1px/);
  assert.match(client,/collection=maze-built-by-artpill/);
  assert.match(client,/collection=maze-built-by-others/);
  assert.match(client,/history is being documented/i);
  assert.match(client,/temporarily unavailable/i);
  assert.doesNotMatch(client,/maze_json|download|remix/i);
});

test("Maze Archive entry points and Studio controls are connected to authenticated routes",()=>{
  const worker=source("_worker.js"),builder=source("apps","maze","src","App.tsx"),studio=source("studio","submissions","index.html"),manager=source("studio","construct-manager.js"),archive=source("js","archive-public.js"),tattoos=source("archive","tattoos","index.html");
  assert.match(worker,/maze-archive\(\?:\\\/\(promote\)\)\?/);
  assert.match(builder,/name="maze_archive_opt_in"/);
  assert.match(builder,/name="maze_archive_include_explanation"/);
  assert.match(builder,/contact details and editable Maze JSON remain private/i);
  assert.match(studio,/Create private Archive draft/);
  assert.match(studio,/data-maze-archive-action="withdraw"/);
  assert.match(manager,/data-dossier-collections/);
  assert.match(manager,/collection_ids/);
  assert.match(archive,/href="\/archive\/maze\/"/);
  assert.match(tattoos,/enter the Maze Archive/);
});
