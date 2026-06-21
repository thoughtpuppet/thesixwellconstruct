import { useRef } from "react";
import { Circle, Group, Line } from "react-konva";
import type Konva from "konva";
import type { MazeWall } from "../types";

const HOLD_TO_PERFECT_MS = 650;
const TWO_PI = Math.PI * 2;

type MazeWallLineProps = {
  wall: MazeWall;
  editable: boolean;
  erasable: boolean;
  onSelect: () => void;
  onChange: (wall: MazeWall) => void;
  onErase: () => void;
  onPerfect: (wall: MazeWall) => void;
  shapeRef?: (node: Konva.Node | null) => void;
};

function localArcPoints(radius: number, startAngle: number, endAngle: number) {
  const sweep = endAngle - startAngle;
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 20)));
  const points: number[] = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }

  return points;
}

function remainingCircleRanges(erasedRanges: Array<[number, number]>) {
  if (erasedRanges.length === 0) {
    return [[0, TWO_PI]] as Array<[number, number]>;
  }

  const ranges: Array<[number, number]> = [];
  let cursor = 0;

  for (const [start, end] of erasedRanges) {
    if (start > cursor) {
      ranges.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < TWO_PI) {
    ranges.push([cursor, TWO_PI]);
  }

  return ranges.filter(([start, end]) => end - start > 0.04);
}

export function MazeWallLine({
  wall,
  editable,
  erasable,
  onSelect,
  onChange,
  onErase,
  onPerfect,
  shapeRef
}: MazeWallLineProps) {
  const kind = wall.kind ?? "straight";
  const smoothFreehand = kind === "curve";
  const holdTimerRef = useRef<number | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const startHoldTimer = () => {
    if (!editable) {
      return;
    }

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      onPerfect(wall);
    }, HOLD_TO_PERFECT_MS);
  };

  const selectAndHold = () => {
    if (erasable) {
      onErase();
      return;
    }

    onSelect();
    startHoldTimer();
  };
  const handleClick = () => {
    if (erasable) {
      onErase();
      return;
    }

    onSelect();
  };

  if (kind === "culdesac") {
    const erasedRanges = wall.erasedRanges ?? [];
    const radius = (wall.size ?? 120) / 2;

    if (erasedRanges.length > 0) {
      return (
        <Group
          ref={shapeRef}
          x={wall.x ?? 0}
          y={wall.y ?? 0}
          scaleX={wall.scale ?? 1}
          scaleY={wall.scale ?? 1}
          rotation={wall.rotation ?? 0}
          listening={editable || erasable}
          draggable={editable}
          onClick={handleClick}
          onTap={handleClick}
          onMouseDown={selectAndHold}
          onMouseUp={clearHoldTimer}
          onMouseLeave={clearHoldTimer}
          onTouchStart={selectAndHold}
          onTouchEnd={clearHoldTimer}
          onDragStart={clearHoldTimer}
          onDragEnd={(event) => {
            clearHoldTimer();
            onChange({
              ...wall,
              x: event.target.x(),
              y: event.target.y()
            });
          }}
          onTransformEnd={(event) => {
            clearHoldTimer();
            const node = event.target;
            const nextScale = Math.max(0.25, Math.min(4, node.scaleX()));
            node.scaleX(nextScale);
            node.scaleY(nextScale);

            onChange({
              ...wall,
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              scale: nextScale
            });
          }}
        >
          {/* The remaining arcs are the hit target, so you grab the stamp by
              clicking the wall that's left — not the erased gaps or the hollow
              middle. hitStrokeWidth pads the thin stroke for easier clicking. */}
          {remainingCircleRanges(erasedRanges).map(([start, end]) => (
            <Line
              key={`${start}-${end}`}
              points={localArcPoints(radius, start, end)}
              tension={0}
              stroke={wall.stroke}
              strokeWidth={wall.strokeWidth}
              hitStrokeWidth={Math.max(wall.strokeWidth + 16, 24)}
              lineCap="butt"
              lineJoin="round"
              listening={editable || erasable}
            />
          ))}
        </Group>
      );
    }

    return (
      <Circle
        ref={shapeRef}
        x={wall.x ?? 0}
        y={wall.y ?? 0}
        radius={(wall.size ?? 120) / 2}
        scaleX={wall.scale ?? 1}
        scaleY={wall.scale ?? 1}
        rotation={wall.rotation ?? 0}
        stroke={wall.stroke}
        strokeWidth={wall.strokeWidth}
        fill="transparent"
        listening={editable || erasable}
        draggable={editable}
        onClick={handleClick}
        onTap={handleClick}
        onMouseDown={selectAndHold}
        onMouseUp={clearHoldTimer}
        onMouseLeave={clearHoldTimer}
        onTouchStart={selectAndHold}
        onTouchEnd={clearHoldTimer}
        onDragStart={clearHoldTimer}
        onDragEnd={(event) => {
          clearHoldTimer();
          onChange({
            ...wall,
            x: event.target.x(),
            y: event.target.y()
          });
        }}
        onTransformEnd={(event) => {
          clearHoldTimer();
          const node = event.target;
          const nextScale = Math.max(0.25, Math.min(4, node.scaleX()));
          node.scaleX(nextScale);
          node.scaleY(nextScale);

          onChange({
            ...wall,
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            scale: nextScale
          });
        }}
      />
    );
  }

  // A wall whose first and last points coincide is a closed loop (polygon
  // stamps, boxes, closed curves). Rendering it as an open Line just butts the
  // two end caps together and leaves a notch at the seam, so hand it to Konva
  // as a genuine closed shape — dropping the duplicate vertex — which joins
  // every corner, including the seam, cleanly.
  const points = wall.points;
  const isClosedLoop =
    points.length >= 6 &&
    Math.abs(points[0] - points[points.length - 2]) < 0.01 &&
    Math.abs(points[1] - points[points.length - 1]) < 0.01;
  const renderPoints = isClosedLoop ? points.slice(0, -2) : points;

  return (
    <Line
      ref={shapeRef}
      points={renderPoints}
      closed={isClosedLoop}
      tension={smoothFreehand ? 0.58 : 0}
      stroke={wall.stroke}
      strokeWidth={wall.strokeWidth}
      lineCap="square"
      lineJoin={smoothFreehand || kind === "arc" ? "round" : "miter"}
      listening={editable || erasable}
      draggable={editable}
      onClick={handleClick}
      onTap={handleClick}
      onMouseDown={selectAndHold}
      onMouseUp={clearHoldTimer}
      onMouseLeave={clearHoldTimer}
      onTouchStart={selectAndHold}
      onTouchEnd={clearHoldTimer}
      onDragStart={clearHoldTimer}
      onDragEnd={(event) => {
        clearHoldTimer();
        const node = event.target;
        const movedPoints = wall.points.map((point, index) =>
          index % 2 === 0 ? point + node.x() : point + node.y()
        );
        onChange({
          ...wall,
          points: movedPoints
        });
        node.position({ x: 0, y: 0 });
      }}
      onTransformEnd={(event) => {
        clearHoldTimer();
        const node = event.target;
        const [originX, originY] = wall.points;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const scaledPoints = wall.points.map((point, index) => {
          if (index % 2 === 0) {
            return originX + (point - originX) * scaleX;
          }

          return originY + (point - originY) * scaleY;
        });
        onChange({
          ...wall,
          points: scaledPoints,
          strokeWidth: Math.max(6, wall.strokeWidth * Math.max(scaleX, scaleY))
        });
        node.scale({ x: 1, y: 1 });
      }}
    />
  );
}
