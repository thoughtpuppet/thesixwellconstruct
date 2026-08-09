import { Circle, Rect, RegularPolygon } from "react-konva";
import type Konva from "konva";
import type { MazeShape } from "../types";

type MazeGeometryShapeProps = {
  shape: MazeShape;
  editable: boolean;
  erasable: boolean;
  onSelect: () => void;
  onChange: (shape: MazeShape) => void;
  onErase: () => void;
  onDragMove?: (node: Konva.Node) => void;
  onDragFinish?: () => void;
  shapeRef?: (node: Konva.Node | null) => void;
};

function sidesFor(kind: MazeShape["kind"]) {
  switch (kind) {
    case "triangle":
      return 3;
    case "pentagon":
      return 5;
    case "hexagon":
      return 6;
    default:
      return 4;
  }
}

function sharedShapeProps(
  shape: MazeShape,
  editable: boolean,
  erasable: boolean,
  onSelect: () => void
) {
  return {
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    scaleX: shape.scale,
    scaleY: shape.scale,
    fill: shape.filled ? shape.fill : "transparent",
    stroke: shape.filled ? undefined : shape.stroke,
    strokeWidth: shape.filled ? 0 : 5,
    listening: editable || erasable,
    draggable: editable,
    onClick: onSelect,
    onTap: onSelect
  };
}

export function MazeGeometryShape({
  shape,
  editable,
  erasable,
  onSelect,
  onChange,
  onErase,
  onDragMove,
  onDragFinish,
  shapeRef
}: MazeGeometryShapeProps) {
  const handleSelectOrErase = () => {
    if (erasable) {
      onErase();
      return;
    }

    onSelect();
  };

  const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    onDragMove?.(event.target);
    onChange({
      ...shape,
      x: event.target.x(),
      y: event.target.y()
    });
    onDragFinish?.();
  };

  const handleTransformEnd = (event: Konva.KonvaEventObject<Event>) => {
    const node = event.target;
    const nextScale = Math.max(0.35, Math.min(3.4, node.scaleX()));
    node.scaleX(nextScale);
    node.scaleY(nextScale);

    onChange({
      ...shape,
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scale: nextScale
    });
  };

  if (shape.kind === "circle") {
    return (
      <Circle
        ref={shapeRef}
        {...sharedShapeProps(shape, editable, erasable, handleSelectOrErase)}
        radius={shape.size / 2}
        onDragStart={onDragFinish}
        onDragMove={(event) => onDragMove?.(event.target)}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
    );
  }

  if (shape.kind === "square") {
    return (
      <Rect
        ref={shapeRef}
        {...sharedShapeProps(shape, editable, erasable, handleSelectOrErase)}
        width={shape.size}
        height={shape.size}
        offsetX={shape.size / 2}
        offsetY={shape.size / 2}
        onDragStart={onDragFinish}
        onDragMove={(event) => onDragMove?.(event.target)}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
    );
  }

  return (
    <RegularPolygon
      ref={shapeRef}
      {...sharedShapeProps(shape, editable, erasable, handleSelectOrErase)}
      sides={sidesFor(shape.kind)}
      radius={shape.size / 2}
      onDragStart={onDragFinish}
      onDragMove={(event) => onDragMove?.(event.target)}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    />
  );
}
