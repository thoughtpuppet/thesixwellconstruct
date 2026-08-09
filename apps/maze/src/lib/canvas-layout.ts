import type { CanvasLayout, MazeState, MazeWall } from "../types";

export const CANVAS_LAYOUTS: Record<CanvasLayout, {
  label: string;
  description: string;
  width: number;
  height: number;
}> = {
  tall: {
    label: "Tall",
    description: "Portrait canvas",
    width: 760,
    height: 1200
  },
  square: {
    label: "Square",
    description: "Balanced canvas",
    width: 960,
    height: 960
  },
  wide: {
    label: "Wide",
    description: "Landscape canvas",
    width: 1200,
    height: 760
  }
};

export const CANVAS_LAYOUT_OPTIONS = (Object.keys(CANVAS_LAYOUTS) as CanvasLayout[])
  .map((id) => ({ id, ...CANVAS_LAYOUTS[id] }));

export function isCanvasLayout(value: unknown): value is CanvasLayout {
  return value === "tall" || value === "square" || value === "wide";
}

export function defaultCanvasLayout(): CanvasLayout {
  if (typeof window === "undefined") return "wide";
  return window.matchMedia("(max-width: 680px)").matches ? "tall" : "wide";
}

function fitWall(wall: MazeWall, scale: number, offsetX: number, offsetY: number): MazeWall {
  const points = wall.points.map((coordinate, index) =>
    coordinate * scale + (index % 2 === 0 ? offsetX : offsetY)
  );

  return {
    ...wall,
    points,
    x: wall.x === undefined ? undefined : wall.x * scale + offsetX,
    y: wall.y === undefined ? undefined : wall.y * scale + offsetY,
    size: wall.size === undefined ? undefined : wall.size * scale,
    strokeWidth: Math.max(5, wall.strokeWidth * scale)
  };
}

export function fitMazeToLayout(state: MazeState, canvasLayout: CanvasLayout): MazeState {
  const current = CANVAS_LAYOUTS[state.canvasLayout];
  const next = CANVAS_LAYOUTS[canvasLayout];
  const scale = Math.min(next.width / current.width, next.height / current.height);
  const offsetX = (next.width - current.width * scale) / 2;
  const offsetY = (next.height - current.height * scale) / 2;

  return {
    canvasLayout,
    canvasMode: state.canvasMode,
    mazeWalls: state.mazeWalls.map((wall) => fitWall(wall, scale, offsetX, offsetY)),
    mazeShapes: state.mazeShapes.map((shape) => ({
      ...shape,
      x: shape.x * scale + offsetX,
      y: shape.y * scale + offsetY,
      size: shape.size * scale
    }))
  };
}
