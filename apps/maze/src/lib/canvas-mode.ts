import type { CanvasMode, MazeState, MazeTool } from "../types";

export const STANDARD_CANVAS_COLOR = "#b88f4e";
export const NEGATIVE_SPACE_CANVAS_COLOR = "#151413";

const CHROMATIC_INK_OPTIONS = ["#b51f29", "#1f7c8c", "#d66a1f", "#d9a21b", "#2d9b74"];

export const STANDARD_INK_OPTIONS = [NEGATIVE_SPACE_CANVAS_COLOR, ...CHROMATIC_INK_OPTIONS];
export const NEGATIVE_SPACE_INK_OPTIONS = [STANDARD_CANVAS_COLOR, ...CHROMATIC_INK_OPTIONS];

export function isCanvasMode(value: unknown): value is CanvasMode {
  return value === "standard" || value === "negative-space";
}

export function canvasBackgroundForMode(mode: CanvasMode) {
  return mode === "negative-space" ? NEGATIVE_SPACE_CANVAS_COLOR : STANDARD_CANVAS_COLOR;
}

export function defaultInkColorForMode(mode: CanvasMode) {
  return mode === "negative-space" ? STANDARD_CANVAS_COLOR : NEGATIVE_SPACE_CANVAS_COLOR;
}

export function inkOptionsForMode(mode: CanvasMode) {
  return mode === "negative-space" ? NEGATIVE_SPACE_INK_OPTIONS : STANDARD_INK_OPTIONS;
}

function matchesColor(value: string, target: string) {
  return value.toLowerCase() === target;
}

function replaceCanvasConflict(value: string, mode: CanvasMode) {
  const background = canvasBackgroundForMode(mode);
  return matchesColor(value, background) ? defaultInkColorForMode(mode) : value;
}

export function switchCanvasMode(state: MazeState, canvasMode: CanvasMode): MazeState {
  if (state.canvasMode === canvasMode) return state;

  return {
    ...state,
    canvasMode,
    mazeWalls: state.mazeWalls.map((wall) => ({
      ...wall,
      stroke: replaceCanvasConflict(wall.stroke, canvasMode)
    })),
    mazeShapes: state.mazeShapes.map((shape) => ({
      ...shape,
      stroke: replaceCanvasConflict(shape.stroke, canvasMode),
      fill: replaceCanvasConflict(shape.fill, canvasMode)
    }))
  };
}

export function sanitizeToolForCanvasMode(tool: MazeTool, mode: CanvasMode): MazeTool {
  if (tool.type === "wall" || tool.type === "wallPreset") {
    return { ...tool, stroke: replaceCanvasConflict(tool.stroke, mode) };
  }
  if (tool.type === "shape") {
    return {
      ...tool,
      stroke: replaceCanvasConflict(tool.stroke, mode),
      fill: replaceCanvasConflict(tool.fill, mode)
    };
  }
  return tool;
}
