import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

test("Legend drafts can retain authenticated raster variants without a schema migration", () => {
  const api = source("functions/api/construct/_lib.js");
  const studio = source("studio/construct-manager.js");

  assert.match(api, /media_id: text\(entry\?\.media_id \?\? entry\?\.mediaId, 200\)/);
  assert.match(api, /entry\.svg_markup \|\| entry\.image_url \|\| entry\.media_id \|\| entry\.href/);
  assert.match(api, /!text\(entry\?\.media_id\?\?entry\?\.mediaId,200\)/);
  assert.match(studio, /data-admin-media-preview="\$\{esc\(mediaId\)\}"/);
  assert.match(studio, /\["name","style","note","svg_markup","image_url","media_id","href","publication_state","public_visible"\]/);
  assert.match(studio, /upload\.append\("privacy",publishNow\?"public":"internal"\)/);
  assert.match(studio, /upload\.append\("public_presentation",publishNow\?"inline":"hidden"\)/);
});

test("Legend SVG cleaning preserves the supplied mark label and Illustrator class rules", () => {
  const studio = source("studio/construct-manager.js");

  assert.match(studio, /"text","tspan"/);
  assert.match(studio, /"font-family","font-size","font-style","font-weight","letter-spacing","text-anchor"/);
  assert.match(studio, /match\(\/\^\\\.\(\[a-zA-Z\]\[\\w-\]\*\)\$\//);
  assert.match(studio, /querySelectorAll\("path,rect,circle,ellipse,line,polyline,polygon,g,text,tspan"\)/);
});
