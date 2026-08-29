import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FRAGMENT_EDITOR_HISTORY_LIMIT,
  FRAGMENT_EDITOR_MAX_OUTPUT,
  FRAGMENT_EDITOR_SCHEMA_VERSION,
  FragmentRecipeHistory,
  fragmentBrushFeatherScale,
  fragmentOutputSize,
  interpolateFragmentStroke,
  moveFragmentCrop,
  normalizeFragmentCrop,
  normalizeFragmentRecipe,
  serializeFragmentRecipe,
  zoomFragmentCrop,
} from "../studio/blackboard-fragment-editor.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = readFileSync(join(ROOT, "studio", "blackboard-fragment-editor.js"), "utf8");

test("square crops remain physically square on non-square source images", () => {
  const source = { width: 1200, height: 800 };
  const crop = normalizeFragmentCrop({ mode: "square", x: 0.2, y: 0.1, width: 0.6, height: 0.6 }, source);
  assert.equal(Math.round(crop.width * source.width), Math.round(crop.height * source.height));
  assert.ok(crop.x >= 0 && crop.x + crop.width <= 1);
  assert.ok(crop.y >= 0 && crop.y + crop.height <= 1);
});

test("default and explicit no-crop modes preserve the complete source", () => {
  assert.deepEqual(normalizeFragmentCrop({}, { width: 1200, height: 800 }), { mode: "none", x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(normalizeFragmentCrop({ mode: "none", x: 0.2, width: 0.4 }, { width: 1200, height: 800 }), { mode: "none", x: 0, y: 0, width: 1, height: 1 });
});

test("free crop, pan, and zoom stay normalized inside the source", () => {
  const source = { width: 1600, height: 900 };
  const crop = normalizeFragmentCrop({ mode: "free", x: 0.2, y: 0.15, width: 0.55, height: 0.35 }, source);
  assert.deepEqual(crop, { mode: "free", x: 0.2, y: 0.15, width: 0.55, height: 0.35 });
  const moved = moveFragmentCrop(crop, 2, -2, source);
  assert.equal(moved.x + moved.width, 1);
  assert.equal(moved.y, 0);
  const zoomed = zoomFragmentCrop(moved, 2, source);
  assert.ok(zoomed.width < moved.width);
  assert.ok(zoomed.height < moved.height);
});

test("rendered edit revisions preserve aspect ratio and never exceed 2400 pixels", () => {
  assert.equal(FRAGMENT_EDITOR_MAX_OUTPUT, 2400);
  assert.deepEqual(fragmentOutputSize({ mode: "free", x: 0, y: 0, width: 1, height: 1 }, { width: 6000, height: 3000 }), { width: 2400, height: 1200 });
  assert.deepEqual(fragmentOutputSize({ mode: "free", x: 0, y: 0, width: 0.25, height: 0.5 }, { width: 2000, height: 1000 }), { width: 500, height: 500 });
});

test("recipes normalize brush, crop, and stroke data and serialize as replayable JSON", () => {
  const recipe = normalizeFragmentRecipe({
    crop: { mode: "free", x: -1, y: 2, width: 0.5, height: 0.5 },
    brush: { size: 4, softness: -1, opacity: 0 },
    strokes: [{ tool: "restore", points: [{ x: -1, y: 2, pressure: 2 }] }],
  }, { width: 100, height: 100 });
  assert.equal(recipe.schema_version, FRAGMENT_EDITOR_SCHEMA_VERSION);
  assert.equal(recipe.output.background, "transparent");
  assert.equal(recipe.output.preferred_mime, "image/webp");
  assert.equal(recipe.output.fallback_mime, "image/png");
  assert.equal(recipe.strokes[0].tool, "restore");
  assert.deepEqual(recipe.strokes[0].points[0], { x: 0, y: 1, pressure: 1 });
  assert.deepEqual(JSON.parse(serializeFragmentRecipe(recipe, { width: 100, height: 100 })), recipe);
  assert.equal(normalizeFragmentRecipe({ brush: { softness: 4 } }, { width: 100, height: 100 }).brush.softness, 2);
});

test("stroke interpolation fills soft brush paths without changing their endpoints", () => {
  const points = interpolateFragmentStroke([{ x: 0, y: 0, pressure: 1 }, { x: 1, y: 0.5, pressure: 0.5 }], 0.05);
  assert.ok(points.length > 2);
  assert.deepEqual(points[0], { x: 0, y: 0, pressure: 1 });
  assert.deepEqual(points.at(-1), { x: 1, y: 0.5, pressure: 0.5 });
});

test("extended feather expands the visible eraser fade beyond its core radius", () => {
  assert.equal(fragmentBrushFeatherScale(0.7), 1);
  assert.equal(fragmentBrushFeatherScale(1), 1);
  assert.equal(fragmentBrushFeatherScale(2), 2.5);
});

test("recipe history supports bounded undo, redo, and reset", () => {
  const initial = { value: 0 };
  const history = new FragmentRecipeHistory(initial, 2);
  history.commit({ value: 1 });
  history.commit({ value: 2 });
  history.commit({ value: 3 });
  assert.equal(history.past.length, 2);
  assert.deepEqual(history.undo(), { value: 2 });
  assert.deepEqual(history.redo(), { value: 3 });
  assert.deepEqual(history.reset(), initial);
  assert.equal(FRAGMENT_EDITOR_HISTORY_LIMIT, 40);
});

test("Canvas editor contract keeps source immutable and exports transparent output plus mask", () => {
  assert.match(SOURCE, /globalCompositeOperation = stroke\.tool === "restore" \? "source-over" : "destination-out"/);
  assert.match(SOURCE, /globalCompositeOperation = "destination-in"/);
  assert.match(SOURCE, /canvasBlob\(canvas, "image\/webp", 0\.9\)/);
  assert.match(SOURCE, /canvasBlob\(canvas, "image\/png"\)/);
  assert.match(SOURCE, /maskFile: new File/);
  assert.match(SOURCE, /source_media_id|sourceMediaId/);
  assert.match(SOURCE, /createImageBitmap\(blob, \{ imageOrientation: "from-image" \}\)/);
  assert.match(SOURCE, /data-bbfe-crop-mode="square"/);
  assert.match(SOURCE, /data-bbfe-crop-mode="free"/);
  assert.match(SOURCE, /data-bbfe-crop-mode="none"/);
  assert.match(SOURCE, /data-bbfe-tool="erase"/);
  assert.match(SOURCE, /data-bbfe-tool="restore"/);
  assert.match(SOURCE, /data-bbfe-action="apply-crop"/);
  assert.match(SOURCE, /Apply edits &amp; save revision/);
  assert.match(SOURCE, /max="200"[^>]*data-bbfe-brush-softness/);
  assert.match(SOURCE, /const featherScale = fragmentBrushFeatherScale\(softness\)/);
  assert.match(SOURCE, /current\.brush\.size \* fragmentBrushFeatherScale\(current\.brush\.softness\)/);
  assert.match(SOURCE, /Crop applied to this working round/);
  assert.match(SOURCE, /beforeunload/);
});
