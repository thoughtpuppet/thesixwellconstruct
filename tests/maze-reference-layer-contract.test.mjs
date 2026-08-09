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
const inspector = read("apps/maze/src/components/Inspector.tsx");
const styles = read("apps/maze/src/styles.css");
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

test("Maze wall width control reaches 45 pixels", () => {
  assert.match(tools, /<span>Wall<\/span>[\s\S]*?min="8"[\s\S]*?max="45"/);
});

test("Shape size stays persistent and can target the selected shape or every shape", () => {
  assert.match(tools, /<span>Shape<\/span>[\s\S]*?min="24"[\s\S]*?max="360"[\s\S]*?value=\{shapeSize\}/);
  assert.match(tools, /Selected \+ next/);
  assert.match(tools, /All shapes/);
  assert.match(app, /shapeSizeScope === "all"[\s\S]*?state\.mazeShapes\.map/);
  assert.match(app, /shape\.instanceId === selectedShape\.instanceId[\s\S]*?size: nextSize, scale: 1/);
  assert.match(inspector, /Math\.round\(selectedShape\.size \* selectedShape\.scale\).*?px/);
  assert.match(inspector, /selectedShape\.scale\.toFixed\(2\).*?from.*?selectedShape\.size/);
});

test("Maze control groups have visible titles connected to their controls", () => {
  for (const title of ["Drawing tools", "Wall forms", "Shapes", "Apply shape size to", "Drawing color"]) {
    assert.match(tools, new RegExp(`>${title}<`));
  }
  assert.match(tools, /id="drawing-tools-title">Drawing tools<\/h3>[\s\S]*aria-labelledby="drawing-tools-title"/);
  assert.match(tools, /id="wall-forms-title">Wall forms<\/h3>[\s\S]*aria-labelledby="wall-forms-title"/);
  assert.match(tools, /id="shapes-title">Shapes<\/h3>[\s\S]*aria-labelledby="shapes-title"/);
  assert.match(tools, /id="shape-size-scope-title">Apply shape size to<\/h3>[\s\S]*aria-labelledby="shape-size-scope-title"/);
  assert.match(tools, /id="drawing-color-title">Drawing color<\/h3>[\s\S]*aria-labelledby="drawing-color-title"/);
  assert.match(inspector, />Selected mark actions<\/h3>/);
  assert.match(inspector, /className="action-grid"[\s\S]*aria-labelledby="project-actions-title"[\s\S]*id="project-actions-title">Project actions<\/h3>/);
  assert.match(styles, /\.control-group-title\s*\{[\s\S]*text-transform:\s*uppercase/);
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
    /export type MazeState = \{\s*canvasLayout: CanvasLayout;\s*canvasMode: CanvasMode;\s*canvasTone: CanvasTone;\s*mazeWalls: MazeWall\[\];\s*mazeShapes: MazeShape\[\];\s*\};/
  );
  assert.match(app, /stage\.find\("\.maze-reference"\)/);
  assert.match(app, /hiddenNodes\.forEach\(\(node\) => node\.visible\(false\)\)/);
  assert.match(app, /finally \{[\s\S]*node\.visible\(visibility\[index\]\)/);
  assert.match(app, /const url = captureMazeImage\(stage\)/);
  assert.match(app, /capturePng=\{\(\) => captureMazeImage\(stage\)\}/);
});
