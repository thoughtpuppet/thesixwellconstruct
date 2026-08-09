import type { CanvasMode, CanvasTone, MazeState, MazeTool } from "../types";

export const STANDARD_CANVAS_COLOR = "#bc854d";
export const LEGACY_STANDARD_CANVAS_COLOR = "#b88f4e";
export const NEGATIVE_SPACE_CANVAS_COLOR = "#151413";
export const DEFAULT_CANVAS_TONE: CanvasTone = "golden-brown";

export const CANVAS_TONES: Array<{ id: CanvasTone; label: string; color: string }> = [
  { id: "light", label: "Light", color: "#f1c6a3" },
  { id: "light-medium", label: "Light medium", color: "#dca477" },
  { id: "medium", label: "Medium", color: "#c78d5c" },
  { id: "golden-brown", label: "Golden brown", color: STANDARD_CANVAS_COLOR },
  { id: "medium-deep", label: "Medium deep", color: "#99613f" },
  { id: "deep", label: "Deep", color: "#74462f" },
  { id: "rich-deep", label: "Rich deep", color: "#523127" }
];

const CHROMATIC_INK_OPTIONS = ["#b51f29", "#1f7c8c", "#d66a1f", "#d9a21b", "#2d9b74"];

export const STANDARD_INK_OPTIONS = [NEGATIVE_SPACE_CANVAS_COLOR, ...CHROMATIC_INK_OPTIONS];

export function isCanvasTone(value: unknown): value is CanvasTone {
  return CANVAS_TONES.some((tone) => tone.id === value);
}

export function canvasToneColor(tone: CanvasTone) {
  return CANVAS_TONES.find((option) => option.id === tone)?.color ?? STANDARD_CANVAS_COLOR;
}

export function isCanvasMode(value: unknown): value is CanvasMode {
  return value === "standard" || value === "negative-space";
}

export function canvasBackgroundForMode(mode: CanvasMode, tone: CanvasTone) {
  return mode === "negative-space" ? NEGATIVE_SPACE_CANVAS_COLOR : canvasToneColor(tone);
}

export function defaultInkColorForMode(mode: CanvasMode, tone: CanvasTone) {
  return mode === "negative-space" ? canvasToneColor(tone) : NEGATIVE_SPACE_CANVAS_COLOR;
}

export function inkOptionsForMode(mode: CanvasMode, tone: CanvasTone) {
  return mode === "negative-space"
    ? [canvasToneColor(tone), ...CHROMATIC_INK_OPTIONS]
    : STANDARD_INK_OPTIONS;
}

function matchesColor(value: string, target: string) {
  return value.toLowerCase() === target;
}

export function normalizeMazeColor(value: string) {
  return matchesColor(value, LEGACY_STANDARD_CANVAS_COLOR) ? STANDARD_CANVAS_COLOR : value;
}

function replaceCanvasConflict(value: string, mode: CanvasMode, tone: CanvasTone) {
  const normalized = normalizeMazeColor(value);
  const background = canvasBackgroundForMode(mode, tone);
  return matchesColor(normalized, background)
    ? defaultInkColorForMode(mode, tone)
    : normalized;
}

export function switchCanvasMode(state: MazeState, canvasMode: CanvasMode): MazeState {
  if (state.canvasMode === canvasMode) return state;

  return {
    ...state,
    canvasMode,
    mazeWalls: state.mazeWalls.map((wall) => ({
      ...wall,
      stroke: replaceCanvasConflict(wall.stroke, canvasMode, state.canvasTone)
    })),
    mazeShapes: state.mazeShapes.map((shape) => ({
      ...shape,
      stroke: replaceCanvasConflict(shape.stroke, canvasMode, state.canvasTone),
      fill: replaceCanvasConflict(shape.fill, canvasMode, state.canvasTone)
    }))
  };
}

export function switchCanvasTone(state: MazeState, canvasTone: CanvasTone): MazeState {
  if (state.canvasTone === canvasTone) return state;

  const previousTone = canvasToneColor(state.canvasTone);
  const nextTone = canvasToneColor(canvasTone);
  const convertColor = (value: string) => {
    const normalized = normalizeMazeColor(value);
    if (state.canvasMode === "negative-space" && matchesColor(normalized, previousTone)) return nextTone;
    if (state.canvasMode === "negative-space" && matchesColor(normalized, NEGATIVE_SPACE_CANVAS_COLOR)) return nextTone;
    if (state.canvasMode === "standard" && matchesColor(normalized, nextTone)) return NEGATIVE_SPACE_CANVAS_COLOR;
    return normalized;
  };

  return {
    ...state,
    canvasTone,
    mazeWalls: state.mazeWalls.map((wall) => ({ ...wall, stroke: convertColor(wall.stroke) })),
    mazeShapes: state.mazeShapes.map((shape) => ({
      ...shape,
      stroke: convertColor(shape.stroke),
      fill: convertColor(shape.fill)
    }))
  };
}

export function sanitizeToolForCanvasMode(tool: MazeTool, mode: CanvasMode, tone: CanvasTone): MazeTool {
  if (tool.type === "wall" || tool.type === "wallPreset") {
    return { ...tool, stroke: replaceCanvasConflict(tool.stroke, mode, tone) };
  }
  if (tool.type === "shape") {
    return {
      ...tool,
      stroke: replaceCanvasConflict(tool.stroke, mode, tone),
      fill: replaceCanvasConflict(tool.fill, mode, tone)
    };
  }
  return tool;
}
