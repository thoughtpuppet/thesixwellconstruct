import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FRAGMENT_MAPPER_MAX_MASK,
  FRAGMENT_MAPPER_SCHEMA_VERSION,
  fragmentMaskBounds,
  interpolateFragmentMappingStroke,
  normalizeFragmentMappingRecipe,
  serializeFragmentMappingRecipe,
} from "../studio/blackboard-fragment-mapper.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = readFileSync(join(ROOT, "studio", "blackboard-fragment-mapper.js"), "utf8");
const MANAGER = readFileSync(join(ROOT, "studio", "archive-blackboards-manager.js"), "utf8");

test("painted alpha pixels calculate normalized bounds inside the full scan", () => {
  const width = 10;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y <= 5; y += 1) for (let x = 3; x <= 7; x += 1) data[(y * width + x) * 4 + 3] = 255;
  assert.deepEqual(fragmentMaskBounds(data, width, height), {
    x: 3,
    y: 2,
    width: 5,
    height: 4,
    x_pct: 30,
    y_pct: 25,
    width_pct: 50,
    height_pct: 50,
  });
  assert.equal(fragmentMaskBounds(new Uint8ClampedArray(width * height * 4), width, height), null);
});

test("mapping recipes preserve normalized paint and erase strokes", () => {
  const recipe = normalizeFragmentMappingRecipe({
    brush_size: 2,
    strokes: [
      { tool: "paint", size: 0.04, points: [{ x: -1, y: 2 }] },
      { tool: "erase", size: 0.02, points: [{ x: 0.4, y: 0.6 }] },
    ],
    copied_from_state_id: "state-i",
  });
  assert.equal(recipe.schema_version, FRAGMENT_MAPPER_SCHEMA_VERSION);
  assert.equal(recipe.coordinate_space, "full-scan-normalized");
  assert.equal(recipe.strokes[0].tool, "paint");
  assert.deepEqual(recipe.strokes[0].points[0], { x: 0, y: 1 });
  assert.equal(recipe.strokes[1].tool, "erase");
  assert.equal(JSON.parse(serializeFragmentMappingRecipe(recipe)).copied_from_state_id, "state-i");
});

test("mapping stroke interpolation fills pointer gaps", () => {
  const points = interpolateFragmentMappingStroke([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], 0.05);
  assert.ok(points.length > 10);
  assert.deepEqual(points[0], { x: 0.1, y: 0.1 });
  assert.deepEqual(points.at(-1), { x: 0.9, y: 0.9 });
});

test("Canvas mapping contract paints masks, crops PNG output, and exposes state-copy controls", () => {
  assert.equal(FRAGMENT_MAPPER_MAX_MASK, 2400);
  assert.match(SOURCE, /data-bbfm-tool="pan"/);
  assert.match(SOURCE, /data-bbfm-tool="paint"/);
  assert.match(SOURCE, /data-bbfm-tool="erase"/);
  assert.match(SOURCE, /data-bbfm-action="undo"/);
  assert.match(SOURCE, /data-bbfm-action="redo"/);
  assert.match(SOURCE, /data-bbfm-action="clear"/);
  assert.match(SOURCE, /data-bbfm-copy/);
  assert.match(SOURCE, /newest\.id/);
  assert.match(SOURCE, /canvasBlob\(cropped, "image\/png"\)/);
  assert.match(SOURCE, /destination-out/);
  assert.match(MANAGER, /mountBlackboardFragmentMapper/);
  assert.match(MANAGER, /hotspot_mask_media_id:hotspotMaskId/);
  assert.match(MANAGER, /hotspot_recipe:revision\.recipe/);
});
