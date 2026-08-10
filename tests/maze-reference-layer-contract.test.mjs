import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recolorMazeSelection } from "../apps/maze/src/lib/recolor-selection.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const app = read("apps/maze/src/App.tsx");
const canvas = read("apps/maze/src/components/ConstructCanvas.tsx");
const referenceImage = read("apps/maze/src/components/ReferenceImage.tsx");
const inspector = read("apps/maze/src/components/Inspector.tsx");
const styles = read("apps/maze/src/styles.css");
const tools = read("apps/maze/src/components/MazeTools.tsx");
const recolorSelection = read("apps/maze/src/lib/recolor-selection.ts");
const types = read("apps/maze/src/types.ts");
const submissionsApi = read("functions/api/submissions/_lib.js");
const briefTemplates = read("functions/api/brief-documents/_templates.js");
const studio = read("studio/submissions/index.html");

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

test("Drawing color swatches recolor the selected Maze mark in one state commit", () => {
  assert.match(tools, /selectedInkColor \|\| \([\s\S]*?shapeTool\?\.fill/);
  assert.match(tools, /onInkColorChange\(color\)/);
  assert.match(app, /commit\(\(current\) => recolorMazeSelection\(current, selected, color\)\)/);
  assert.match(app, /selectedShape\.filled \? selectedShape\.fill : selectedShape\.stroke/);
  assert.match(recolorSelection, /selection\?\.type === "wall"[\s\S]*?\{ \.\.\.wall, stroke: color \}/);
  assert.match(recolorSelection, /selection\?\.type === "shape"[\s\S]*?\{ \.\.\.shape, stroke: color, fill: color \}/);

  const state = {
    canvasLayout: "wide",
    canvasMode: "standard",
    canvasTone: "golden-brown",
    mazeWalls: [
      { instanceId: "wall-a", kind: "straight", points: [0, 0, 20, 0], stroke: "#151413", strokeWidth: 12, zIndex: 1 },
      { instanceId: "wall-b", kind: "straight", points: [0, 20, 20, 20], stroke: "#1f7c8c", strokeWidth: 18, zIndex: 2 }
    ],
    mazeShapes: [
      { instanceId: "shape-a", kind: "circle", x: 40, y: 40, rotation: 15, scale: 1.25, size: 54, stroke: "#151413", fill: "#151413", filled: false, zIndex: 3 }
    ]
  };

  const wallResult = recolorMazeSelection(state, { type: "wall", id: "wall-a" }, "#b51f29");
  assert.equal(wallResult.mazeWalls[0].stroke, "#b51f29");
  assert.equal(wallResult.mazeWalls[0].strokeWidth, 12);
  assert.equal(wallResult.mazeWalls[1], state.mazeWalls[1]);

  const shapeResult = recolorMazeSelection(state, { type: "shape", id: "shape-a" }, "#d9a21b");
  assert.equal(shapeResult.mazeShapes[0].stroke, "#d9a21b");
  assert.equal(shapeResult.mazeShapes[0].fill, "#d9a21b");
  assert.equal(shapeResult.mazeShapes[0].filled, false);
  assert.equal(shapeResult.mazeShapes[0].rotation, 15);
  assert.equal(recolorMazeSelection(shapeResult, { type: "shape", id: "shape-a" }, "#d9a21b"), shapeResult);
});

test("Maze downloads use attached Blob links and delay URL cleanup", () => {
  assert.match(app, /function downloadBlob\(filename: string, blob: Blob\)/);
  assert.match(app, /document\.body\.appendChild\(anchor\)[\s\S]*?anchor\.click\(\)[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?anchor\.remove\(\)[\s\S]*?URL\.revokeObjectURL\(url\)[\s\S]*?\}, 1000\)/);
  assert.match(app, /downloadBlob\("art-pill-maze\.png", dataUrlToBlob\(url\)\)/);
  assert.match(app, /setSaveStatus\("PNG download started\."\)/);
  assert.match(app, /setSaveStatus\("JSON download started\."\)/);
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

test("reference and editing affordances stay outside every Maze render variant", () => {
  assert.match(
    types,
    /export type MazeState = \{\s*canvasLayout: CanvasLayout;\s*canvasMode: CanvasMode;\s*canvasTone: CanvasTone;\s*mazeWalls: MazeWall\[\];\s*mazeShapes: MazeShape\[\];\s*\};/
  );
  assert.match(app, /stage\.find\("\.maze-reference"\)/);
  assert.match(app, /stage\.find\("\.maze-export-affordance"\)/);
  assert.match(app, /variant === "canvas" \? \[\] : \[\.\.\.stage\.find\("\.canvas-background"\)\]/);
  assert.match(app, /hiddenNodes\.forEach\(\(node\) => node\.visible\(false\)\)/);
  assert.match(app, /finally \{[\s\S]*node\.visible\(visibility\[index\]\)/);
  assert.match(app, /const url = captureMazeImage\(stage\)/);
  assert.match(app, /capturePng=\{\(variant\) => captureMazeImage\(stage, variant\)\}/);
  assert.match(canvas, /name="maze-export-affordance"/);
});

test("final Maze submissions generate mode-specific canvas, transparent, and stencil artifacts", () => {
  assert.match(app, /type MazeImageVariant = "canvas" \| "transparent" \| "stencil"/);
  assert.match(app, /capturePng\("canvas"\)/);
  assert.match(app, /canvasMode === "standard" \? capturePng\("transparent"\) : null/);
  assert.match(app, /capturePng\("stencil"\)/);
  assert.match(app, /fd\.set\("maze_image"/);
  assert.match(app, /fd\.set\("maze_transparent_image"/);
  assert.match(app, /fd\.set\("maze_stencil_image"/);
  assert.match(app, /fd\.set\("maze_json_file"/);
  assert.match(app, /stage\.find\("\.maze-wall-render"\)/);
  assert.match(app, /stage\.find\("\.maze-shape-render"\)/);
  assert.match(app, /stroke: NEGATIVE_SPACE_CANVAS_COLOR,[\s\S]*strokeWidth: 5/);
  assert.match(submissionsApi, /maze_design: 4/);
  assert.match(submissionsApi, /canvasMode === "negative-space"[\s\S]*\["maze_image", "maze_stencil_image"\]/);
  assert.match(submissionsApi, /\["maze_image", "maze_transparent_image", "maze_stencil_image"\]/);
  assert.match(studio, /maze_image: "Canvas render"/);
  assert.match(studio, /maze_transparent_image: "Transparent render"/);
  assert.match(studio, /maze_stencil_image: "Studio stencil — private"/);
  assert.match(briefTemplates, /"maze_transparent_image", "maze_stencil_image"/);
});
