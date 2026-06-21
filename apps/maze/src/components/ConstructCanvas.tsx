import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Circle, Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { symbolLibrary } from "../data/symbols";
import type { CanvasItem, MazeShape, MazeTool, MazeWall, Selection } from "../types";
import { uuid } from "../lib/id";
import { pathLength, perfectMazeWall, smoothCurvePoints, wallStampPoints } from "../lib/maze";
import { MazeGeometryShape } from "./MazeGeometryShape";
import { MazeWallLine } from "./MazeWallLine";
import { SymbolImage } from "./SymbolImage";

type ConstructCanvasProps = {
  items: CanvasItem[];
  mazeWalls: MazeWall[];
  mazeShapes: MazeShape[];
  selected: Selection;
  mazeTool: MazeTool;
  workspaceMode: "construct" | "maze";
  onSelect: (selection: Selection) => void;
  onChange: (item: CanvasItem) => void;
  onMazeWallAdd: (wall: MazeWall) => void;
  onMazeWallChange: (wall: MazeWall) => void;
  onMazeWallDelete: (id: string) => void;
  onMazeEraseStart: () => void;
  onMazeEraseAt: (point: { x: number; y: number }, radius: number) => void;
  onMazeEraseEnd: () => void;
  onMazeWallPreview: (wall: MazeWall | null) => void;
  onMazeShapeAdd: (shape: MazeShape) => void;
  onMazeShapeChange: (shape: MazeShape) => void;
  onMazeShapeDelete: (id: string) => void;
  onStageReady: (stage: Konva.Stage | null) => void;
};

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 760;
const CURVE_POINT_SPACING = 10;
const CURVE_RESISTANCE = 0.2;
const CURVE_CLOSE_DISTANCE = 28;
const DRAW_HOLD_TO_PERFECT_MS = 620;

export function ConstructCanvas({
  items,
  mazeWalls,
  mazeShapes,
  selected,
  mazeTool,
  workspaceMode,
  onSelect,
  onChange,
  onMazeWallAdd,
  onMazeWallChange,
  onMazeWallDelete,
  onMazeEraseStart,
  onMazeEraseAt,
  onMazeEraseEnd,
  onMazeWallPreview,
  onMazeShapeAdd,
  onMazeShapeChange,
  onMazeShapeDelete,
  onStageReady
}: ConstructCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());
  const draftWallRef = useRef<MazeWall | null>(null);
  const drawHoldTimerRef = useRef<number | null>(null);
  const isErasingRef = useRef(false);
  const lastEraserPointRef = useRef<{ x: number; y: number } | null>(null);
  const [draftWall, setDraftWall] = useState<MazeWall | null>(null);
  const [eraserPoint, setEraserPoint] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    onStageReady(stageRef.current);
  }, [onStageReady]);

  // Fit the fixed-resolution canvas into whatever width the container has, so
  // the stage scales down on small screens instead of overflowing into scroll.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateScale = () => {
      const viewportSafeWidth = Math.max(320, window.innerWidth - 28);
      const available = Math.min(container.clientWidth || viewportSafeWidth, viewportSafeWidth);
      if (available > 0) {
        setScale(Math.min(1, available / CANVAS_WIDTH));
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  const nextZIndex = () => {
    const zIndexes = [
      ...items.map((item) => item.zIndex),
      ...mazeWalls.map((wall) => wall.zIndex),
      ...mazeShapes.map((shape) => shape.zIndex)
    ];
    return (zIndexes.length ? Math.max(...zIndexes) : 0) + 1;
  };

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const canTransform =
      workspaceMode === "construct" || (workspaceMode === "maze" && mazeTool.type === "select");
    const selectedNode = selected && canTransform ? shapeRefs.current.get(selected.id) : null;
    transformer.nodes(selectedNode ? [selectedNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [items, mazeShapes, mazeTool.type, mazeWalls, selected, workspaceMode]);

  useEffect(() => {
    onMazeWallPreview(draftWall);
    draftWallRef.current = draftWall;
  }, [draftWall, onMazeWallPreview]);

  useEffect(() => {
    if (!(workspaceMode === "maze" && mazeTool.type === "eraser")) {
      setEraserPoint(null);
    }
  }, [workspaceMode, mazeTool.type]);

  const clearDrawHoldTimer = () => {
    if (drawHoldTimerRef.current !== null) {
      window.clearTimeout(drawHoldTimerRef.current);
      drawHoldTimerRef.current = null;
    }
  };

  const startDrawHoldTimer = () => {
    clearDrawHoldTimer();
    drawHoldTimerRef.current = window.setTimeout(() => {
      const currentDraft = draftWallRef.current;

      if (currentDraft?.kind !== "curve") {
        return;
      }

      const perfectedDraft = perfectMazeWall(currentDraft);
      draftWallRef.current = perfectedDraft;
      setDraftWall(perfectedDraft);
      drawHoldTimerRef.current = null;
    }, DRAW_HOLD_TO_PERFECT_MS);
  };

  const isCanvasTarget = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const target = event.target;
    return target === target.getStage() || target.name() === "canvas-background";
  };

  const stagePoint = () => {
    const stage = stageRef.current;
    // getRelativePointerPosition accounts for the stage scale, so draw/erase
    // coordinates stay in the 1200x760 logical space at any display size.
    const pointer = stage?.getRelativePointerPosition();
    return pointer ? { x: pointer.x, y: pointer.y } : null;
  };

  const handleCanvasStart = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (workspaceMode === "maze" && mazeTool.type === "eraser") {
      const point = stagePoint();
      if (point) {
        isErasingRef.current = true;
        lastEraserPointRef.current = point;
        onMazeEraseStart();
        setEraserPoint(point);
      }
      return;
    }

    if (!isCanvasTarget(event)) {
      return;
    }

    if (workspaceMode !== "maze") {
      onSelect(null);
      return;
    }

    const point = stagePoint();
    if (!point) {
      return;
    }

    if (mazeTool.type === "wall") {
      const wall: MazeWall = {
        instanceId: uuid(),
        kind: mazeTool.variant,
        points:
          mazeTool.variant === "curve"
            ? [point.x, point.y]
            : [point.x, point.y, point.x, point.y],
        stroke: mazeTool.stroke,
        strokeWidth: mazeTool.strokeWidth,
        zIndex: nextZIndex()
      };
      setDraftWall(wall);
      draftWallRef.current = wall;
      if (wall.kind === "curve") {
        startDrawHoldTimer();
      }
      onSelect({ type: "wall", id: wall.instanceId });
      return;
    }

    if (mazeTool.type === "wallPreset") {
      const wall: MazeWall =
        mazeTool.preset === "culdesac"
          ? {
              instanceId: uuid(),
              kind: "culdesac",
              points: [],
              x: point.x,
              y: point.y,
              rotation: 0,
              scale: 1,
              size: mazeTool.size,
              stroke: mazeTool.stroke,
              strokeWidth: mazeTool.strokeWidth,
              zIndex: nextZIndex()
            }
          : {
              // Polyline stamps live as ordinary point-based walls so erasing,
              // dragging, and transforming reuse the hand-drawn-wall paths.
              instanceId: uuid(),
              kind: "straight",
              points: wallStampPoints(mazeTool.preset, point, mazeTool.size),
              stroke: mazeTool.stroke,
              strokeWidth: mazeTool.strokeWidth,
              zIndex: nextZIndex()
            };
      onMazeWallAdd(wall);
      onSelect({ type: "wall", id: wall.instanceId });
      return;
    }

    if (mazeTool.type === "shape") {
      const shape: MazeShape = {
        instanceId: uuid(),
        kind: mazeTool.kind,
        x: point.x,
        y: point.y,
        rotation: 0,
        scale: 1,
        size: mazeTool.size,
        stroke: mazeTool.stroke,
        fill: mazeTool.fill,
        filled: mazeTool.filled,
        zIndex: nextZIndex()
      };
      onMazeShapeAdd(shape);
      onSelect({ type: "shape", id: shape.instanceId });
      return;
    }

    onSelect(null);
  };

  const handleCanvasMove = () => {
    if (workspaceMode === "maze" && mazeTool.type === "eraser") {
      const point = stagePoint();
      if (!point) {
        return;
      }

      // Track the cursor so the eraser brush is visible on hover, not only
      // while actively erasing.
      setEraserPoint(point);

      if (!isErasingRef.current) {
        return;
      }

      const lastPoint = lastEraserPointRef.current;
      if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 4) {
        return;
      }

      lastEraserPointRef.current = point;
      onMazeEraseAt(point, mazeTool.width / 2);
      return;
    }

    if (!draftWall) {
      return;
    }
    clearDrawHoldTimer();

    const point = stagePoint();
    if (!point) {
      return;
    }

    const [x1, y1] = draftWall.points;

    if (draftWall.kind === "curve") {
      const previousX = draftWall.points[draftWall.points.length - 2];
      const previousY = draftWall.points[draftWall.points.length - 1];
      const distanceFromPrevious = Math.hypot(point.x - previousX, point.y - previousY);

      if (distanceFromPrevious < CURVE_POINT_SPACING) {
        return;
      }

      const resistedX = previousX + (point.x - previousX) * CURVE_RESISTANCE;
      const resistedY = previousY + (point.y - previousY) * CURVE_RESISTANCE;
      const nextPoints = [...draftWall.points, resistedX, resistedY];
      const nextDraft = {
        ...draftWall,
        points: smoothCurvePoints(nextPoints, 1)
      };

      draftWallRef.current = nextDraft;
      setDraftWall(nextDraft);
      startDrawHoldTimer();
      return;
    }

    // Straight walls snap to the axis the drag leans toward, so they stay
    // strictly horizontal or vertical — never diagonal.
    const horizontal = Math.abs(point.x - x1) >= Math.abs(point.y - y1);
    const endX = horizontal ? point.x : x1;
    const endY = horizontal ? y1 : point.y;
    const nextDraft = {
      ...draftWall,
      points: [x1, y1, endX, endY]
    };
    draftWallRef.current = nextDraft;
    setDraftWall(nextDraft);
  };

  const handleCanvasEnd = () => {
    if (workspaceMode === "maze" && mazeTool.type === "eraser") {
      isErasingRef.current = false;
      lastEraserPointRef.current = null;
      setEraserPoint(null);
      onMazeEraseEnd();
      return;
    }

    clearDrawHoldTimer();
    if (!draftWall) {
      return;
    }

    if (draftWall.kind === "culdesac") {
      onMazeWallAdd(draftWall);
      onSelect({ type: "wall", id: draftWall.instanceId });
      setDraftWall(null);
      draftWallRef.current = null;
      return;
    }

    const [x1, y1] = draftWall.points;
    const x2 = draftWall.points[draftWall.points.length - 2];
    const y2 = draftWall.points[draftWall.points.length - 1];
    const drawnLength =
      draftWall.kind === "curve" ? pathLength(draftWall.points) : Math.hypot(x2 - x1, y2 - y1);

    if (drawnLength > 16) {
      const shouldCloseCurve =
        draftWall.kind === "curve" &&
        draftWall.points.length >= 10 &&
        Math.hypot(x2 - x1, y2 - y1) <= CURVE_CLOSE_DISTANCE;
      const smoothedPoints =
        draftWall.kind === "curve" ? smoothCurvePoints(draftWall.points) : draftWall.points;
      const nextWall = shouldCloseCurve
        ? {
            ...draftWall,
            points: [...smoothedPoints.slice(0, -2), x1, y1]
          }
        : { ...draftWall, points: smoothedPoints };

      onMazeWallAdd(nextWall);
      onSelect({ type: "wall", id: nextWall.instanceId });
    } else {
      onSelect(null);
    }
    setDraftWall(null);
    draftWallRef.current = null;
  };

  const handlePerfectWall = (wall: MazeWall) => {
    onMazeWallChange(perfectMazeWall(wall));
  };

  return (
    <div className="canvas-shell" ref={containerRef}>
      <Stage
        ref={stageRef}
        width={CANVAS_WIDTH * scale}
        height={CANVAS_HEIGHT * scale}
        scaleX={scale}
        scaleY={scale}
        className="construct-stage"
        onMouseDown={handleCanvasStart}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasEnd}
        onMouseLeave={handleCanvasEnd}
        onTouchStart={handleCanvasStart}
        onTouchMove={handleCanvasMove}
        onTouchEnd={handleCanvasEnd}
      >
        <Layer>
          <Rect
            name="canvas-background"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="#b88f4e"
          />
          <Rect
            name="canvas-background"
            x={CANVAS_WIDTH / 2 - 165}
            y={CANVAS_HEIGHT / 2 - 120}
            width={330}
            height={240}
            fill="#d4b271"
            opacity={0.36}
            cornerRadius={4}
          />
          <Rect
            name="canvas-background"
            x={28}
            y={28}
            width={CANVAS_WIDTH - 56}
            height={CANVAS_HEIGHT - 56}
            stroke="#211f1d"
            strokeWidth={2}
            opacity={0.14}
          />
          {mazeWalls.map((wall) => (
            <MazeWallLine
              key={wall.instanceId}
              wall={wall}
              editable={workspaceMode === "maze" && mazeTool.type === "select"}
              erasable={workspaceMode === "maze" && mazeTool.type === "remove"}
              onSelect={() => onSelect({ type: "wall", id: wall.instanceId })}
              onChange={onMazeWallChange}
              onErase={() => onMazeWallDelete(wall.instanceId)}
              onPerfect={handlePerfectWall}
              shapeRef={(node) => {
                if (node) {
                  shapeRefs.current.set(wall.instanceId, node);
                } else {
                  shapeRefs.current.delete(wall.instanceId);
                }
              }}
            />
          ))}
          {draftWall ? (
            <MazeWallLine
              wall={draftWall}
              editable={false}
              erasable={false}
              onSelect={() => onSelect({ type: "wall", id: draftWall.instanceId })}
              onChange={() => undefined}
              onErase={() => undefined}
              onPerfect={() => undefined}
            />
          ) : null}
          {mazeShapes.map((shape) => (
            <MazeGeometryShape
              key={shape.instanceId}
              shape={shape}
              editable={workspaceMode === "maze" && mazeTool.type === "select"}
              erasable={workspaceMode === "maze" && mazeTool.type === "remove"}
              onSelect={() => onSelect({ type: "shape", id: shape.instanceId })}
              onChange={onMazeShapeChange}
              onErase={() => onMazeShapeDelete(shape.instanceId)}
              shapeRef={(node) => {
                if (node) {
                  shapeRefs.current.set(shape.instanceId, node);
                } else {
                  shapeRefs.current.delete(shape.instanceId);
                }
              }}
            />
          ))}
          {items.map((item) => {
            const symbol = symbolLibrary.find((entry) => entry.id === item.symbolId);

            if (!symbol) {
              return null;
            }

            return (
              <SymbolImage
                key={item.instanceId}
                item={item}
                symbol={symbol}
                onSelect={() => onSelect({ type: "symbol", id: item.instanceId })}
                onChange={onChange}
                shapeRef={(node) => {
                  if (node) {
                    shapeRefs.current.set(item.instanceId, node);
                  } else {
                    shapeRefs.current.delete(item.instanceId);
                  }
                }}
              />
            );
          })}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            boundBoxFunc={(_, nextBox) => {
              if (nextBox.width < 36 || nextBox.height < 36) {
                return _;
              }
              return nextBox;
            }}
          />
          {eraserPoint ? (
            <Circle
              x={eraserPoint.x}
              y={eraserPoint.y}
              radius={mazeTool.type === "eraser" ? mazeTool.width / 2 : 24}
              stroke="#151413"
              strokeWidth={2}
              dash={[6, 5]}
              fill="rgba(212, 178, 113, 0.5)"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}
