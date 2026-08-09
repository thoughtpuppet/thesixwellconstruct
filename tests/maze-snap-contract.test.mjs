import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  snapPointToEdges,
  snapShapePosition,
  snapStraightEndpoint,
  snapWallNodePosition,
} from "../apps/maze/src/lib/snap.ts";

const ROOT = process.cwd();
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const verticalWall = {
  instanceId: "vertical-wall",
  kind: "straight",
  points: [100, 20, 100, 200],
  stroke: "#151413",
  strokeWidth: 10,
  zIndex: 1,
};

const context = (overrides = {}) => ({
  walls: [verticalWall],
  shapes: [],
  canvasWidth: 300,
  canvasHeight: 240,
  tolerance: 10,
  ...overrides,
});

test("drawn wall points snap to nearby mark geometry and canvas edges", () => {
  const wallSnap = snapPointToEdges({ x: 107, y: 82 }, context());
  assert.deepEqual(wallSnap.point, { x: 100, y: 82 });
  assert.equal(wallSnap.snapped, true);

  const canvasSnap = snapPointToEdges({ x: 4, y: 150 }, context({ walls: [] }));
  assert.deepEqual(canvasSnap.point, { x: 0, y: 150 });
});

test("straight wall snapping preserves the selected horizontal or vertical axis", () => {
  const horizontal = snapStraightEndpoint(
    { x: 20, y: 80 },
    { x: 94, y: 88 },
    true,
    context(),
  );
  assert.deepEqual(horizontal.point, { x: 100, y: 80 });

  const vertical = snapStraightEndpoint(
    { x: 100, y: 20 },
    { x: 106, y: 233 },
    false,
    context({ walls: [] }),
  );
  assert.deepEqual(vertical.point, { x: 100, y: 240 });
});

test("dragged open walls connect endpoints while shapes align visible bounds", () => {
  const movingWall = {
    instanceId: "moving-wall",
    kind: "straight",
    points: [20, 80, 90, 80],
    stroke: "#151413",
    strokeWidth: 10,
    zIndex: 2,
  };
  const wallDrag = snapWallNodePosition(movingWall, { x: 5, y: 0 }, context());
  assert.deepEqual(wallDrag.position, { x: 10, y: 0 });

  const shape = {
    instanceId: "shape",
    kind: "circle",
    x: 150,
    y: 100,
    rotation: 0,
    scale: 1,
    size: 40,
    filled: true,
  };
  const wallEdge = snapShapePosition(shape, { x: 128, y: 100 }, context());
  assert.deepEqual(wallEdge.position, { x: 125, y: 100 });

  const canvasEdge = snapShapePosition(shape, { x: 23, y: 100 }, context({ walls: [] }));
  assert.deepEqual(canvasEdge.position, { x: 20, y: 100 });
});

test("Maze Studio exposes on-by-default snapping, mobile control, guides, and clean exports", () => {
  const app = read("apps", "maze", "src", "App.tsx");
  const tools = read("apps", "maze", "src", "components", "MazeTools.tsx");
  const canvas = read("apps", "maze", "src", "components", "ConstructCanvas.tsx");
  const styles = read("apps", "maze", "src", "styles.css");

  assert.match(app, /const \[snapToEdges, setSnapToEdges\] = useState\(true\)/);
  assert.match(app, /aria-pressed=\{snapToEdges\}[\s\S]*?<Magnet[\s\S]*?Snap/);
  assert.match(app, /stage\.find\("\.maze-snap-guide"\)/);
  assert.match(tools, /checked=\{snapToEdges\}[\s\S]*?Snap to edges/);
  assert.match(canvas, /name="maze-snap-guide"/);
  assert.match(canvas, /SNAP_SCREEN_TOLERANCE \/ Math\.max\(scale, 0\.01\)/);
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});
