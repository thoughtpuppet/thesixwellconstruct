export const SNAP_SCREEN_TOLERANCE = 10;

export type SnapPoint = { x: number; y: number };
export type SnapGuide = { axis: "x" | "y"; position: number };

type SnappableWall = {
  instanceId: string;
  kind: string;
  points: number[];
  x?: number;
  y?: number;
  scale?: number;
  size?: number;
  strokeWidth: number;
};

type SnappableShape = {
  instanceId: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  size: number;
  filled: boolean;
};

type SnapContext = {
  walls: SnappableWall[];
  shapes: SnappableShape[];
  canvasWidth: number;
  canvasHeight: number;
  tolerance: number;
  excludeId?: string;
};

type Segment = { start: SnapPoint; end: SnapPoint };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

type PointSnapResult = {
  point: SnapPoint;
  guides: SnapGuide[];
  snapped: boolean;
};

type DragSnapResult = {
  position: SnapPoint;
  guides: SnapGuide[];
  snapped: boolean;
};

const EPSILON = 0.001;
const CIRCLE_STEPS = 48;

function rotatePoint(point: SnapPoint, center: SnapPoint, rotation: number): SnapPoint {
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine
  };
}

function circlePoints(center: SnapPoint, radius: number) {
  const points: SnapPoint[] = [];
  for (let step = 0; step <= CIRCLE_STEPS; step += 1) {
    const angle = (step / CIRCLE_STEPS) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return points;
}

function wallPoints(wall: SnappableWall): SnapPoint[] {
  if (wall.kind === "culdesac") {
    return circlePoints(
      { x: wall.x ?? 0, y: wall.y ?? 0 },
      ((wall.size ?? 120) * (wall.scale ?? 1)) / 2
    );
  }

  const points: SnapPoint[] = [];
  for (let index = 0; index < wall.points.length - 1; index += 2) {
    points.push({ x: wall.points[index], y: wall.points[index + 1] });
  }
  return points;
}

function shapePoints(shape: SnappableShape): SnapPoint[] {
  const center = { x: shape.x, y: shape.y };
  const radius = (shape.size * shape.scale) / 2;

  if (shape.kind === "circle") {
    return circlePoints(center, radius);
  }

  if (shape.kind === "square") {
    const points = [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
      { x: center.x - radius, y: center.y + radius }
    ].map((point) => rotatePoint(point, center, shape.rotation));
    return [...points, points[0]];
  }

  const sides = shape.kind === "triangle" ? 3 : shape.kind === "pentagon" ? 5 : 6;
  const points: SnapPoint[] = [];
  for (let vertex = 0; vertex < sides; vertex += 1) {
    const angle = -Math.PI / 2 + (vertex / sides) * Math.PI * 2 + shape.rotation * Math.PI / 180;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return [...points, points[0]];
}

function segmentsFromPoints(points: SnapPoint[]) {
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push({ start: points[index - 1], end: points[index] });
  }
  return segments;
}

function markSegments(context: SnapContext) {
  return [
    ...context.walls
      .filter((wall) => wall.instanceId !== context.excludeId)
      .flatMap((wall) => segmentsFromPoints(wallPoints(wall))),
    ...context.shapes
      .filter((shape) => shape.instanceId !== context.excludeId)
      .flatMap((shape) => segmentsFromPoints(shapePoints(shape)))
  ];
}

function nearestPointOnSegment(point: SnapPoint, segment: Segment): SnapPoint {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return segment.start;
  const amount = Math.max(0, Math.min(1,
    ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared
  ));
  return {
    x: segment.start.x + dx * amount,
    y: segment.start.y + dy * amount
  };
}

function distance(first: SnapPoint, second: SnapPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function guidesBetween(source: SnapPoint, target: SnapPoint): SnapGuide[] {
  const guides: SnapGuide[] = [];
  if (Math.abs(source.x - target.x) > EPSILON) guides.push({ axis: "x", position: target.x });
  if (Math.abs(source.y - target.y) > EPSILON) guides.push({ axis: "y", position: target.y });
  return guides;
}

function dedupeGuides(guides: SnapGuide[]) {
  const seen = new Set<string>();
  return guides.filter((guide) => {
    const key = `${guide.axis}:${guide.position.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function snapPointToEdges(point: SnapPoint, context: SnapContext): PointSnapResult {
  let bestPoint: SnapPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const segment of markSegments(context)) {
    const candidate = nearestPointOnSegment(point, segment);
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestPoint = candidate;
    }
  }

  const canvasPoint = { ...point };
  let canvasSnapped = false;
  const xEdges = [0, context.canvasWidth];
  const yEdges = [0, context.canvasHeight];
  const nearestX = xEdges.reduce((best, edge) =>
    Math.abs(point.x - edge) < Math.abs(point.x - best) ? edge : best
  );
  const nearestY = yEdges.reduce((best, edge) =>
    Math.abs(point.y - edge) < Math.abs(point.y - best) ? edge : best
  );
  if (Math.abs(point.x - nearestX) <= context.tolerance) {
    canvasPoint.x = nearestX;
    canvasSnapped = true;
  }
  if (Math.abs(point.y - nearestY) <= context.tolerance) {
    canvasPoint.y = nearestY;
    canvasSnapped = true;
  }
  const canvasDistance = canvasSnapped ? distance(point, canvasPoint) : Number.POSITIVE_INFINITY;

  if (bestPoint && bestDistance <= context.tolerance && bestDistance <= canvasDistance) {
    return {
      point: bestPoint,
      guides: guidesBetween(point, bestPoint),
      snapped: true
    };
  }

  if (canvasSnapped) {
    return {
      point: canvasPoint,
      guides: guidesBetween(point, canvasPoint),
      snapped: true
    };
  }

  return { point, guides: [], snapped: false };
}

function intersectionCoordinate(segment: Segment, fixed: number, horizontal: boolean) {
  const startFixed = horizontal ? segment.start.y : segment.start.x;
  const endFixed = horizontal ? segment.end.y : segment.end.x;
  const startMoving = horizontal ? segment.start.x : segment.start.y;
  const endMoving = horizontal ? segment.end.x : segment.end.y;
  const fixedDelta = endFixed - startFixed;

  if (Math.abs(fixedDelta) <= EPSILON) {
    if (Math.abs(fixed - startFixed) > EPSILON) return [];
    return [startMoving, endMoving];
  }

  const amount = (fixed - startFixed) / fixedDelta;
  if (amount < 0 || amount > 1) return [];
  return [startMoving + (endMoving - startMoving) * amount];
}

export function snapStraightEndpoint(
  start: SnapPoint,
  pointer: SnapPoint,
  horizontal: boolean,
  context: SnapContext
): PointSnapResult {
  const proposed = horizontal ? { x: pointer.x, y: start.y } : { x: start.x, y: pointer.y };
  const fixed = horizontal ? start.y : start.x;
  const moving = horizontal ? pointer.x : pointer.y;
  const candidates = [
    ...(horizontal ? [0, context.canvasWidth] : [0, context.canvasHeight]),
    ...markSegments(context).flatMap((segment) => intersectionCoordinate(segment, fixed, horizontal))
  ];
  const snappedCoordinate = candidates.reduce<number | null>((best, candidate) => {
    if (Math.abs(candidate - moving) > context.tolerance) return best;
    if (best === null || Math.abs(candidate - moving) < Math.abs(best - moving)) return candidate;
    return best;
  }, null);

  if (snappedCoordinate === null) return { point: proposed, guides: [], snapped: false };
  const point = horizontal
    ? { x: snappedCoordinate, y: start.y }
    : { x: start.x, y: snappedCoordinate };
  return {
    point,
    guides: [{ axis: horizontal ? "x" : "y", position: snappedCoordinate }],
    snapped: true
  };
}

function boundsForPoints(points: SnapPoint[], padding = 0): Bounds {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - padding,
    minY: Math.min(...ys) - padding,
    maxX: Math.max(...xs) + padding,
    maxY: Math.max(...ys) + padding
  };
}

function wallBounds(wall: SnappableWall) {
  return boundsForPoints(wallPoints(wall), wall.strokeWidth / 2);
}

function shapeBounds(shape: SnappableShape) {
  return boundsForPoints(shapePoints(shape), shape.filled ? 0 : 2.5);
}

function translateBounds(bounds: Bounds, dx: number, dy: number): Bounds {
  return {
    minX: bounds.minX + dx,
    minY: bounds.minY + dy,
    maxX: bounds.maxX + dx,
    maxY: bounds.maxY + dy
  };
}

function targetBounds(context: SnapContext) {
  return [
    ...context.walls
      .filter((wall) => wall.instanceId !== context.excludeId)
      .map(wallBounds),
    ...context.shapes
      .filter((shape) => shape.instanceId !== context.excludeId)
      .map(shapeBounds)
  ];
}

function axisAdjustment(
  movingMin: number,
  movingMax: number,
  targets: Array<{ min: number; max: number }>,
  canvasMax: number,
  tolerance: number
) {
  const candidates = [
    { delta: -movingMin, guide: 0 },
    { delta: canvasMax - movingMax, guide: canvasMax },
    ...targets.flatMap((target) => [
      { delta: target.min - movingMin, guide: target.min },
      { delta: target.max - movingMax, guide: target.max },
      { delta: target.min - movingMax, guide: target.min },
      { delta: target.max - movingMin, guide: target.max }
    ])
  ].filter((candidate) => Math.abs(candidate.delta) <= tolerance);

  return candidates.sort((first, second) => Math.abs(first.delta) - Math.abs(second.delta))[0] ?? null;
}

function snapBounds(bounds: Bounds, context: SnapContext) {
  const targets = targetBounds(context);
  const x = axisAdjustment(
    bounds.minX,
    bounds.maxX,
    targets.map((target) => ({ min: target.minX, max: target.maxX })),
    context.canvasWidth,
    context.tolerance
  );
  const y = axisAdjustment(
    bounds.minY,
    bounds.maxY,
    targets.map((target) => ({ min: target.minY, max: target.maxY })),
    context.canvasHeight,
    context.tolerance
  );
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    guides: dedupeGuides([
      ...(x ? [{ axis: "x" as const, position: x.guide }] : []),
      ...(y ? [{ axis: "y" as const, position: y.guide }] : [])
    ]),
    snapped: Boolean(x || y)
  };
}

function wallNodePosition(wall: SnappableWall): SnapPoint {
  return wall.kind === "culdesac"
    ? { x: wall.x ?? 0, y: wall.y ?? 0 }
    : { x: 0, y: 0 };
}

function openWallAnchors(wall: SnappableWall) {
  const points = wallPoints(wall);
  if (wall.kind === "culdesac" || points.length < 2) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) <= EPSILON) return [];
  return [first, last];
}

export function snapWallNodePosition(
  wall: SnappableWall,
  proposedPosition: SnapPoint,
  context: SnapContext
): DragSnapResult {
  const basePosition = wallNodePosition(wall);
  let dx = proposedPosition.x - basePosition.x;
  let dy = proposedPosition.y - basePosition.y;
  const localContext = { ...context, excludeId: wall.instanceId };
  const targets = markSegments(localContext);
  let bestConnection: { source: SnapPoint; target: SnapPoint; distance: number } | null = null;

  for (const anchor of openWallAnchors(wall)) {
    const movedAnchor = { x: anchor.x + dx, y: anchor.y + dy };
    for (const segment of targets) {
      const target = nearestPointOnSegment(movedAnchor, segment);
      const candidateDistance = distance(movedAnchor, target);
      if (candidateDistance <= context.tolerance && (!bestConnection || candidateDistance < bestConnection.distance)) {
        bestConnection = { source: movedAnchor, target, distance: candidateDistance };
      }
    }
  }

  if (bestConnection) {
    dx += bestConnection.target.x - bestConnection.source.x;
    dy += bestConnection.target.y - bestConnection.source.y;
    return {
      position: { x: basePosition.x + dx, y: basePosition.y + dy },
      guides: guidesBetween(bestConnection.source, bestConnection.target),
      snapped: true
    };
  }

  const boundSnap = snapBounds(translateBounds(wallBounds(wall), dx, dy), localContext);
  return {
    position: {
      x: basePosition.x + dx + boundSnap.dx,
      y: basePosition.y + dy + boundSnap.dy
    },
    guides: boundSnap.guides,
    snapped: boundSnap.snapped
  };
}

export function applyWallNodePosition<T extends SnappableWall>(wall: T, position: SnapPoint): T {
  if (wall.kind === "culdesac") {
    return { ...wall, x: position.x, y: position.y };
  }
  return {
    ...wall,
    points: wall.points.map((coordinate, index) =>
      coordinate + (index % 2 === 0 ? position.x : position.y)
    )
  };
}

export function snapShapePosition(
  shape: SnappableShape,
  proposedPosition: SnapPoint,
  context: SnapContext
): DragSnapResult {
  const dx = proposedPosition.x - shape.x;
  const dy = proposedPosition.y - shape.y;
  const localContext = { ...context, excludeId: shape.instanceId };
  const boundSnap = snapBounds(translateBounds(shapeBounds(shape), dx, dy), localContext);
  return {
    position: {
      x: proposedPosition.x + boundSnap.dx,
      y: proposedPosition.y + boundSnap.dy
    },
    guides: boundSnap.guides,
    snapped: boundSnap.snapped
  };
}
