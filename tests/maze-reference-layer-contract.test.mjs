import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const app = read("apps/maze/src/App.tsx");
const canvas = read("apps/maze/src/components/ConstructCanvas.tsx");
const referenceImage = read("apps/maze/src/components/ReferenceImage.tsx");
const tools = read("apps/maze/src/components/MazeTools.tsx");
const types = read("apps/maze/src/types.ts");

test("Maze Builder exposes a temporary image-reference action", () => {
  assert.match(tools, /"Upload reference"/);
  assert.match(tools, /image\/png,image\/jpeg,image\/webp/);
  assert.match(tools, /Temporary guide only\. It will not be saved or exported\./);
  assert.match(app, /REFERENCE_MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(app, /URL\.createObjectURL\(file\)/);
  assert.match(app, /URL\.revokeObjectURL\(reference\.src\)/);
});

test("reference image is non-interactive and rendered beneath Maze marks", () => {
  assert.match(referenceImage, /name="maze-reference"/);
  assert.match(referenceImage, /listening=\{false\}/);
  assert.match(referenceImage, /Math\.min\([\s\S]*availableWidth \/ reference\.width,[\s\S]*availableHeight \/ reference\.height/);

  const referencePosition = canvas.indexOf("<ReferenceImage");
  const wallsPosition = canvas.indexOf("{mazeWalls.map");
  const shapesPosition = canvas.indexOf("{mazeShapes.map");
  assert.ok(referencePosition > -1);
  assert.ok(referencePosition < wallsPosition);
  assert.ok(referencePosition < shapesPosition);
});

test("reference image stays outside Maze persistence and final captures", () => {
  assert.match(
    types,
    /export type MazeState = \{\s*canvasLayout: CanvasLayout;\s*mazeWalls: MazeWall\[\];\s*mazeShapes: MazeShape\[\];\s*\};/
  );
  assert.match(app, /stage\.find\("\.maze-reference"\)/);
  assert.match(app, /referenceNodes\.forEach\(\(node\) => node\.visible\(false\)\)/);
  assert.match(app, /finally \{[\s\S]*node\.visible\(visibility\[index\]\)/);
  assert.match(app, /const url = captureMazeImage\(stage\)/);
  assert.match(app, /capturePng=\{\(\) => captureMazeImage\(stage\)\}/);
});
