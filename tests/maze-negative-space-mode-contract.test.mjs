import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const app = read("apps/maze/src/App.tsx");
const canvas = read("apps/maze/src/components/ConstructCanvas.tsx");
const canvasMode = read("apps/maze/src/lib/canvas-mode.ts");
const serverDrafts = read("functions/api/build-drafts/_lib.js");
const tools = read("apps/maze/src/components/MazeTools.tsx");
const types = read("apps/maze/src/types.ts");

test("Maze state and drafts persist an explicit canvas mode with a standard fallback", () => {
  assert.match(types, /export type CanvasMode = "standard" \| "negative-space"/);
  assert.match(types, /canvasLayout: CanvasLayout;\s*canvasMode: CanvasMode;/);
  assert.match(app, /isCanvasMode\(value\?\.canvasMode\) \? value\.canvasMode : "standard"/);
  assert.match(app, /canvasMode: state\.canvasMode/);
  assert.match(app, /canvasMode: payload\.canvasMode/);
  assert.match(serverDrafts, /payload\.canvasMode === "negative-space" \? "negative-space" : "standard"/);
});

test("standard and negative-space palettes exclude the matching canvas color", () => {
  assert.match(canvasMode, /STANDARD_CANVAS_COLOR = "#b88f4e"/);
  assert.match(canvasMode, /NEGATIVE_SPACE_CANVAS_COLOR = "#151413"/);
  assert.match(canvasMode, /STANDARD_INK_OPTIONS = \[NEGATIVE_SPACE_CANVAS_COLOR, \.\.\.CHROMATIC_INK_OPTIONS\]/);
  assert.match(canvasMode, /NEGATIVE_SPACE_INK_OPTIONS = \[STANDARD_CANVAS_COLOR, \.\.\.CHROMATIC_INK_OPTIONS\]/);
  assert.match(tools, /const inkOptions = inkOptionsForMode\(canvasMode\)/);
  assert.match(tools, /stroke: color,\s*fill: color/);
});

test("switching modes swaps only conflicting wall and shape colors", () => {
  assert.match(canvasMode, /matchesColor\(value, background\) \? defaultInkColorForMode\(mode\) : value/);
  assert.match(canvasMode, /mazeWalls: state\.mazeWalls\.map[\s\S]*stroke: replaceCanvasConflict\(wall\.stroke, canvasMode\)/);
  assert.match(canvasMode, /mazeShapes: state\.mazeShapes\.map[\s\S]*stroke: replaceCanvasConflict\(shape\.stroke, canvasMode\)[\s\S]*fill: replaceCanvasConflict\(shape\.fill, canvasMode\)/);
  assert.match(app, /commit\(\(current\) => switchCanvasMode\(current, canvasMode\)\)/);
  assert.match(app, /sanitizeToolForCanvasMode\(current, state\.canvasMode\)/);
});

test("canvas controls and rendering expose Negative Space Mode", () => {
  assert.match(app, /aria-pressed=\{canvasMode === "negative-space"\}/);
  assert.match(app, />\s*Negative Space Mode\s*<\/button>/);
  assert.match(canvas, /fill=\{canvasBackground\}/);
  assert.match(canvas, /canvasMode === "standard" \? \([\s\S]*fill="#d4b271"/);
  assert.match(canvas, /stroke=\{canvasContrast\}/);
});
