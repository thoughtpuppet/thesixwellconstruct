import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { symbolLibrary } from "../data/symbols";
import type { CanvasItem, CanvasLayout, CanvasMode, CanvasReference, MazeShape, MazeTool, MazeWall, Selection } from "../types";
import { uuid } from "../lib/id";
import { pathLength, perfectMazeWall, smoothCurvePoints, wallStampPoints } from "../lib/maze";
import { CANVAS_LAYOUTS } from "../lib/canvas-layout";
import { canvasBackgroundForMode, defaultInkColorForMode, STANDARD_CANVAS_COLOR } from "../lib/canvas-mode";
import {
  applyWallNodePosition,
  SNAP_SCREEN_TOLERANCE,
  snapPointToEdges,
  snapShapePosition,
  snapStraightEndpoint,
  snapWallNodePosition
} from "../lib/snap";
import type { SnapGuide } from "../lib/snap";
import { MazeGeometryShape } from "./MazeGeometryShape";
import { MazeWallLine } from "./MazeWallLine";
import { ReferenceImage } from "./ReferenceImage";
import { SymbolImage } from "./SymbolImage";

type ConstructCanvasProps = {
  items: CanvasItem[];
  mazeWalls: MazeWall[];
  mazeShapes: MazeShape[];
  selected: Selection;
  mazeTool: MazeTool;
  canvasLayout: CanvasLayout;
  canvasMode: CanvasMode;
  snapToEdges: boolean;
  reference: CanvasReference | null;
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
  canvasLayout,
  canvasMode,
  snapToEdges,
  reference,
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
  const { width: canvasWidth, height: canvasHeight } = CANVAS_LAYOUTS[canvasLayout];
  const canvasBackground = canvasBackgroundForMode(canvasMode);
  const canvasContrast = defaultInkColorForMode(canvasMode);
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
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [scale, setScale] = useState(1);

  const updateSnapGuides = (guides: SnapGuide[]) => {
    setSnapGuides((current) => {
      const same = current.length === guides.length && current.every((guide, index) =>
        guide.axis === guides[index]?.axis && Math.abs(guide.position - guides[index].position) < 0.01
      );
      return same ? current : guides;
    });
  };

  const clearSnapGuides = () => updateSnapGuides([]);

  const snapContext = (excludeId?: string) => ({
    walls: mazeWalls,
    shapes: mazeShapes,
    canvasWidth,
    canvasHeight,
    tolerance: SNAP_SCREEN_TOLERANCE / Math.max(scale, 0.01),
    excludeId
  });

  useEffect(() => {
    if (!snapToEdges) clearSnapGuides();
  }, [snapToEdges]);

  useEffect(() => {
    onStageReady(stageRef.current);
  }, [onStageReady]);

  // Fit the selected logical canvas into whatever width the container has, so
  // drawing coordinates remain stable while the display scales responsively.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateScale = () => {
      const viewportSafeWidth = Math.max(320, window.innerWidth - 28);
      const available = Math.min(container.clientWidth || viewportSafeWidth, viewportSafeWidth);
      if (available > 0) {
        setScale(Math.min(1, available / canvasWidth));
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
  }, [canvasWidth]);

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
    // coordinates stay in the selected logical canvas at any display size.
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

    const rawPoint = stagePoint();
    if (!rawPoint) {
      return;
    }

    const pointSnap = snapToEdges && mazeTool.type === "wall"
      ? snapPointToEdges(rawPoint, snapContext())
      : { point: rawPoint, guides: [], snapped: false };
    const point = pointSnap.point;
    updateSnapGuides(pointSnap.guides);

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
      const snappedWall = snapToEdges
        ? applyWallNodePosition(
            wall,
            snapWallNodePosition(
              wall,
              wall.kind === "culdesac" ? { x: wall.x ?? 0, y: wall.y ?? 0 } : { x: 0, y: 0 },
              snapContext(wall.instanceId)
            ).position
          )
        : wall;
      onMazeWallAdd(snappedWall);
      onSelect({ type: "wall", id: snappedWall.instanceId });
      clearSnapGuides();
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
      const snappedPosition = snapToEdges
        ? snapShapePosition(shape, point, snapContext(shape.instanceId)).position
        : point;
      const snappedShape = { ...shape, ...snappedPosition };
      onMazeShapeAdd(snappedShape);
      onSelect({ type: "shape", id: snappedShape.instanceId });
      clearSnapGuides();
      return;
    }

    clearSnapGuides();
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

      if (snapToEdges) {
        updateSnapGuides(snapPointToEdges(point, snapContext()).guides);
      } else {
        clearSnapGuides();
      }

      draftWallRef.current = nextDraft;
      setDraftWall(nextDraft);
      startDrawHoldTimer();
      return;
    }

    // Straight walls snap to the axis the drag leans toward, so they stay
    // strictly horizontal or vertical — never diagonal.
    const horizontal = Math.abs(point.x - x1) >= Math.abs(point.y - y1);
    const endpointSnap = snapToEdges
      ? snapStraightEndpoint({ x: x1, y: y1 }, point, horizontal, snapContext())
      : {
          point: horizontal ? { x: point.x, y: y1 } : { x: x1, y: point.y },
          guides: [],
          snapped: false
        };
    const endX = endpointSnap.point.x;
    const endY = endpointSnap.point.y;
    updateSnapGuides(endpointSnap.guides);
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
    const finalDraft = draftWallRef.current ?? draftWall;
    if (!finalDraft) {
      return;
    }

    if (finalDraft.kind === "culdesac") {
      onMazeWallAdd(finalDraft);
      onSelect({ type: "wall", id: finalDraft.instanceId });
      setDraftWall(null);
      draftWallRef.current = null;
      clearSnapGuides();
      return;
    }

    const [x1, y1] = finalDraft.points;
    const rawX2 = finalDraft.points[finalDraft.points.length - 2];
    const rawY2 = finalDraft.points[finalDraft.points.length - 1];
    const releasePoint = stagePoint();
    const endpointSnap = snapToEdges && finalDraft.kind === "curve" && releasePoint
      ? snapPointToEdges(releasePoint, snapContext())
      : { point: { x: rawX2, y: rawY2 }, guides: [], snapped: false };
    const x2 = endpointSnap.snapped ? endpointSnap.point.x : rawX2;
    const y2 = endpointSnap.snapped ? endpointSnap.point.y : rawY2;
    const pointsWithSnappedEnd = finalDraft.kind === "curve"
      ? [...finalDraft.points.slice(0, -2), x2, y2]
      : finalDraft.points;
    const drawnLength =
      finalDraft.kind === "curve" ? pathLength(pointsWithSnappedEnd) : Math.hypot(x2 - x1, y2 - y1);

    if (drawnLength > 16) {
      const shouldCloseCurve =
        finalDraft.kind === "curve" &&
        finalDraft.points.length >= 10 &&
        Math.hypot(x2 - x1, y2 - y1) <= CURVE_CLOSE_DISTANCE;
      const smoothedPoints =
        finalDraft.kind === "curve" ? smoothCurvePoints(pointsWithSnappedEnd) : finalDraft.points;
      const nextWall = shouldCloseCurve
        ? {
            ...finalDraft,
            points: [...smoothedPoints.slice(0, -2), x1, y1]
          }
        : { ...finalDraft, points: smoothedPoints };

      onMazeWallAdd(nextWall);
      onSelect({ type: "wall", id: nextWall.instanceId });
    } else {
      onSelect(null);
    }
    setDraftWall(null);
    draftWallRef.current = null;
    clearSnapGuides();
  };

  const snapWallForCommit = (wall: MazeWall) => {
    if (!snapToEdges) return wall;
    const basePosition = wall.kind === "culdesac"
      ? { x: wall.x ?? 0, y: wall.y ?? 0 }
      : { x: 0, y: 0 };
    const result = snapWallNodePosition(wall, basePosition, snapContext(wall.instanceId));
    return applyWallNodePosition(wall, result.position);
  };

  const snapShapeForCommit = (shape: MazeShape) => {
    if (!snapToEdges) return shape;
    const result = snapShapePosition(shape, { x: shape.x, y: shape.y }, snapContext(shape.instanceId));
    return { ...shape, ...result.position };
  };

  const handleWallDragMove = (wall: MazeWall, node: Konva.Node) => {
    if (!snapToEdges) {
      clearSnapGuides();
      return;
    }
    const result = snapWallNodePosition(
      wall,
      { x: node.x(), y: node.y() },
      snapContext(wall.instanceId)
    );
    node.position(result.position);
    updateSnapGuides(result.guides);
    node.getLayer()?.batchDraw();
  };

  const handleShapeDragMove = (shape: MazeShape, node: Konva.Node) => {
    if (!snapToEdges) {
      clearSnapGuides();
      return;
    }
    const result = snapShapePosition(
      shape,
      { x: node.x(), y: node.y() },
      snapContext(shape.instanceId)
    );
    node.position(result.position);
    updateSnapGuides(result.guides);
    node.getLayer()?.batchDraw();
  };

  const handlePerfectWall = (wall: MazeWall) => {
    onMazeWallChange(snapWallForCommit(perfectMazeWall(wall)));
  };

  return (
    <div className="canvas-shell" ref={containerRef}>
      <Stage
        ref={stageRef}
        width={canvasWidth * scale}
        height={canvasHeight * scale}
        scaleX={scale}
        scaleY={scale}
        className={`construct-stage${canvasMode === "negative-space" ? " negative-space" : ""}`}
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
            width={canvasWidth}
            height={canvasHeight}
            fill={canvasBackground}
          />
          {canvasMode === "standard" ? (
            <Rect
              name="canvas-background"
              x={canvasWidth / 2 - 165}
              y={canvasHeight / 2 - 120}
              width={330}
              height={240}
              fill="#d4b271"
              opacity={0.36}
              cornerRadius={4}
            />
          ) : null}
          <Rect
            name="canvas-background"
            x={28}
            y={28}
            width={canvasWidth - 56}
            height={canvasHeight - 56}
            stroke={canvasMode === "negative-space" ? STANDARD_CANVAS_COLOR : "#211f1d"}
            strokeWidth={2}
            opacity={0.14}
          />
          {reference ? (
            <ReferenceImage
              reference={reference}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          ) : null}
          {mazeWalls.map((wall) => (
            <MazeWallLine
              key={wall.instanceId}
              wall={wall}
              editable={workspaceMode === "maze" && mazeTool.type === "select"}
              erasable={workspaceMode === "maze" && mazeTool.type === "remove"}
              onSelect={() => onSelect({ type: "wall", id: wall.instanceId })}
              onChange={(nextWall) => onMazeWallChange(snapWallForCommit(nextWall))}
              onErase={() => onMazeWallDelete(wall.instanceId)}
              onPerfect={handlePerfectWall}
              onDragMove={(node) => handleWallDragMove(wall, node)}
              onDragFinish={clearSnapGuides}
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
              onChange={(nextShape) => onMazeShapeChange(snapShapeForCommit(nextShape))}
              onErase={() => onMazeShapeDelete(shape.instanceId)}
              onDragMove={(node) => handleShapeDragMove(shape, node)}
              onDragFinish={clearSnapGuides}
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
          {snapGuides.map((guide) => (
            <Line
              key={`${guide.axis}-${guide.position}`}
              name="maze-snap-guide"
              points={guide.axis === "x"
                ? [guide.position, 0, guide.position, canvasHeight]
                : [0, guide.position, canvasWidth, guide.position]}
              stroke={canvasContrast}
              strokeWidth={2}
              dash={[10, 8]}
              opacity={0.62}
              listening={false}
            />
          ))}
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
              stroke={canvasContrast}
              strokeWidth={2}
              dash={[6, 5]}
              fill={canvasMode === "negative-space" ? "rgba(184, 143, 78, 0.28)" : "rgba(212, 178, 113, 0.5)"}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}
