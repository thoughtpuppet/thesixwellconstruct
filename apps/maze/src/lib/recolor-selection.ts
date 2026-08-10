import type { MazeState, Selection } from "../types";

export function recolorMazeSelection(state: MazeState, selection: Selection, color: string): MazeState {
  if (selection?.type === "wall") {
    const selectedWall = state.mazeWalls.find((wall) => wall.instanceId === selection.id);
    if (!selectedWall || selectedWall.stroke === color) return state;

    return {
      ...state,
      mazeWalls: state.mazeWalls.map((wall) =>
        wall.instanceId === selection.id ? { ...wall, stroke: color } : wall
      )
    };
  }

  if (selection?.type === "shape") {
    const selectedShape = state.mazeShapes.find((shape) => shape.instanceId === selection.id);
    if (!selectedShape || (selectedShape.stroke === color && selectedShape.fill === color)) return state;

    return {
      ...state,
      mazeShapes: state.mazeShapes.map((shape) =>
        shape.instanceId === selection.id ? { ...shape, stroke: color, fill: color } : shape
      )
    };
  }

  return state;
}
