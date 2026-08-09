import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANVAS_TONES,
  DEFAULT_CANVAS_TONE,
  NEGATIVE_SPACE_CANVAS_COLOR,
  canvasBackgroundForMode,
  canvasToneColor,
  inkOptionsForMode,
  switchCanvasMode,
  switchCanvasTone,
} from "../apps/maze/src/lib/canvas-mode.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const app = read("apps/maze/src/App.tsx");
const canvas = read("apps/maze/src/components/ConstructCanvas.tsx");
const canvasMode = read("apps/maze/src/lib/canvas-mode.ts");
const serverDrafts = read("functions/api/build-drafts/_lib.js");
const styles = read("apps/maze/src/styles.css");
const tools = read("apps/maze/src/components/MazeTools.tsx");
const types = read("apps/maze/src/types.ts");

test("Maze state and drafts persist canvas mode and tone with legacy fallbacks", () => {
  assert.match(types, /export type CanvasMode = "standard" \| "negative-space"/);
  assert.match(types, /export type CanvasTone =\s*\| "light"[\s\S]*\| "rich-deep"/);
  assert.match(types, /canvasLayout: CanvasLayout;\s*canvasMode: CanvasMode;\s*canvasTone: CanvasTone;/);
  assert.match(app, /isCanvasMode\(value\?\.canvasMode\) \? value\.canvasMode : "standard"/);
  assert.match(app, /isCanvasTone\(value\?\.canvasTone\) \? value\.canvasTone : DEFAULT_CANVAS_TONE/);
  assert.match(app, /canvasMode: state\.canvasMode/);
  assert.match(app, /canvasTone: state\.canvasTone/);
  assert.match(app, /canvasMode: payload\.canvasMode/);
  assert.match(app, /canvasTone: payload\.canvasTone/);
  assert.match(serverDrafts, /payload\.canvasMode === "negative-space" \? "negative-space" : "standard"/);
  assert.match(serverDrafts, /\.includes\(payload\.canvasTone\)[\s\S]*: "golden-brown"/);
});

test("canvas tones span light to rich deep with golden brown as the default", () => {
  assert.equal(DEFAULT_CANVAS_TONE, "golden-brown");
  assert.equal(CANVAS_TONES.length, 7);
  assert.deepEqual(CANVAS_TONES.map((tone) => tone.id), [
    "light",
    "light-medium",
    "medium",
    "golden-brown",
    "medium-deep",
    "deep",
    "rich-deep",
  ]);
  assert.equal(canvasToneColor("golden-brown"), "#bc854d");
});

test("standard and negative-space palettes exclude the matching canvas color", () => {
  assert.match(canvasMode, /STANDARD_CANVAS_COLOR = "#bc854d"/);
  assert.match(canvasMode, /LEGACY_STANDARD_CANVAS_COLOR = "#b88f4e"/);
  assert.match(canvasMode, /NEGATIVE_SPACE_CANVAS_COLOR = "#151413"/);
  assert.match(canvasMode, /STANDARD_INK_OPTIONS = \[NEGATIVE_SPACE_CANVAS_COLOR, \.\.\.CHROMATIC_INK_OPTIONS\]/);
  assert.match(tools, /const inkOptions = inkOptionsForMode\(canvasMode, canvasTone\)/);
  assert.match(tools, /stroke: color,\s*fill: color/);

  for (const tone of CANVAS_TONES) {
    const standard = inkOptionsForMode("standard", tone.id);
    const negative = inkOptionsForMode("negative-space", tone.id);
    assert.ok(!standard.includes(tone.color), tone.id);
    assert.ok(standard.includes(NEGATIVE_SPACE_CANVAS_COLOR), tone.id);
    assert.ok(negative.includes(tone.color), tone.id);
    assert.ok(!negative.includes(NEGATIVE_SPACE_CANVAS_COLOR), tone.id);
    assert.equal(canvasBackgroundForMode("standard", tone.id), tone.color);
    assert.equal(canvasBackgroundForMode("negative-space", tone.id), NEGATIVE_SPACE_CANVAS_COLOR);
  }
});

test("switching modes and tones converts only conflicting negative-space colors", () => {
  const baseState = {
    canvasLayout: "wide",
    canvasMode: "negative-space",
    canvasTone: "golden-brown",
    mazeWalls: [
      { instanceId: "negative", kind: "straight", points: [0, 0, 10, 0], stroke: "#bc854d", strokeWidth: 10, zIndex: 1 },
      { instanceId: "red", kind: "straight", points: [0, 10, 10, 10], stroke: "#b51f29", strokeWidth: 10, zIndex: 2 },
    ],
    mazeShapes: [],
  };

  const retinted = switchCanvasTone(baseState, "deep");
  assert.equal(retinted.canvasTone, "deep");
  assert.equal(retinted.mazeWalls[0].stroke, canvasToneColor("deep"));
  assert.equal(retinted.mazeWalls[1].stroke, "#b51f29");

  const standard = switchCanvasMode(retinted, "standard");
  assert.equal(standard.mazeWalls[0].stroke, NEGATIVE_SPACE_CANVAS_COLOR);
  assert.equal(standard.mazeWalls[1].stroke, "#b51f29");

  assert.match(canvasMode, /replaceCanvasConflict\(wall\.stroke, canvasMode, state\.canvasTone\)/);
  assert.match(canvasMode, /export function switchCanvasTone/);
  assert.match(app, /commit\(\(current\) => switchCanvasMode\(current, canvasMode\)\)/);
  assert.match(app, /commit\(\(current\) => switchCanvasTone\(current, canvasTone\)\)/);
  assert.match(app, /sanitizeToolForCanvasMode\(current, state\.canvasMode, state\.canvasTone\)/);
});

test("older saved gold marks normalize to the current canvas gold", () => {
  assert.match(canvasMode, /matchesColor\(value, LEGACY_STANDARD_CANVAS_COLOR\) \? STANDARD_CANVAS_COLOR : value/);
  assert.match(app, /mazeWalls\.map\(\(wall\) => \(\{ \.\.\.wall, stroke: normalizeMazeColor\(wall\.stroke\) \}\)\)/);
  assert.match(app, /mazeShapes\.map[\s\S]*stroke: normalizeMazeColor\(shape\.stroke\)[\s\S]*fill: normalizeMazeColor\(shape\.fill\)/);
});

test("canvas controls expose Negative Space Mode and titled canvas tones", () => {
  assert.match(app, /aria-pressed=\{canvasMode === "negative-space"\}/);
  assert.match(app, />\s*Negative Space Mode\s*<\/button>/);
  assert.match(app, />Canvas tone<\/span>/);
  assert.match(app, /CANVAS_TONES\.map\(\(tone\) =>/);
  assert.match(app, /aria-pressed=\{canvasTone === tone\.id\}/);
  assert.match(canvas, /fill=\{canvasBackground\}/);
  assert.doesNotMatch(canvas, /fill="#d4b271"/);
  assert.match(styles, /\.construct-stage\s*\{[\s\S]*background:\s*var\(--canvas-tone-color, #bc854d\)/);
  assert.match(canvas, /stroke=\{canvasContrast\}/);
});

test("existing active controls use the brighter tattoo red without recoloring dark buttons", () => {
  assert.match(styles, /--tool-active:\s*#b51f29/);
  assert.match(styles, /\.tool-row button,[\s\S]*background:\s*var\(--ink\)/);
  assert.match(styles, /\.tool-row button\.active,[\s\S]*background:\s*var\(--tool-active\)/);
  assert.match(styles, /\.canvas-tone-options button\.active\s*\{[\s\S]*background:\s*var\(--tool-active\)/);
  assert.match(styles, /\.mobile-quick-tools button\s*\{[\s\S]*background:\s*var\(--ink\)/);
});
