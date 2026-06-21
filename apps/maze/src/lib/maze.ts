import type { MazeShape, MazeWall } from "../types";
import { uuid } from "./id";

export const CURVE_SMOOTHING_PASSES = 3;
export const HOLD_PERFECTION_SMOOTHING_PASSES = 7;

type Point = { x: number; y: number };

export function smoothCurvePoints(points: number[], passes = CURVE_SMOOTHING_PASSES) {
  if (points.length < 6) {
    return points;
  }

  let smoothed = points;

  for (let pass = 0; pass < passes; pass += 1) {
    const nextPoints = [smoothed[0], smoothed[1]];

    for (let index = 2; index < smoothed.length - 2; index += 2) {
      const previousX = smoothed[index - 2];
      const previousY = smoothed[index - 1];
      const currentX = smoothed[index];
      const currentY = smoothed[index + 1];
      const nextX = smoothed[index + 2];
      const nextY = smoothed[index + 3];

      nextPoints.push(
        previousX * 0.22 + currentX * 0.56 + nextX * 0.22,
        previousY * 0.22 + currentY * 0.56 + nextY * 0.22
      );
    }

    nextPoints.push(smoothed[smoothed.length - 2], smoothed[smoothed.length - 1]);
    smoothed = nextPoints;
  }

  return smoothed;
}

export function pointPairs(points: number[]) {
  const pairs: Point[] = [];

  for (let index = 0; index < points.length - 1; index += 2) {
    pairs.push({ x: points[index], y: points[index + 1] });
  }

  return pairs;
}

export function boundsForPoints(points: number[]) {
  const pairs = pointPairs(points);
  const xs = pairs.map((point) => point.x);
  const ys = pairs.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

export function pathLength(points: number[]) {
  let total = 0;

  for (let index = 2; index < points.length - 1; index += 2) {
    total += Math.hypot(points[index] - points[index - 2], points[index + 1] - points[index - 1]);
  }

  return total;
}

function shouldPerfectAsCircle(points: number[]) {
  const pairs = pointPairs(points);

  if (pairs.length < 8) {
    return false;
  }

  const bounds = boundsForPoints(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const aspect = width / Math.max(1, height);
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  const distances = pairs.map((point) => Math.hypot(point.x - centerX, point.y - centerY));
  const averageDistance =
    distances.reduce((total, distance) => total + distance, 0) / Math.max(1, distances.length);
  const radialVariance =
    distances.reduce((total, distance) => total + Math.abs(distance - averageDistance), 0) /
    Math.max(1, distances.length) /
    Math.max(1, averageDistance);

  return aspect > 0.84 && aspect < 1.16 && radialVariance < 0.18;
}

function shouldPerfectAsBox(points: number[]) {
  const pairs = pointPairs(points);

  if (pairs.length < 8) {
    return false;
  }

  const bounds = boundsForPoints(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const tolerance = Math.max(18, Math.min(width, height) * 0.16);
  const onEdgeCount = pairs.filter((point) => {
    const nearVerticalEdge =
      Math.abs(point.x - bounds.minX) <= tolerance || Math.abs(point.x - bounds.maxX) <= tolerance;
    const nearHorizontalEdge =
      Math.abs(point.y - bounds.minY) <= tolerance || Math.abs(point.y - bounds.maxY) <= tolerance;

    return nearVerticalEdge || nearHorizontalEdge;
  }).length;

  const edgeRatio = onEdgeCount / pairs.length;
  const aspect = width / Math.max(1, height);

  return edgeRatio >= 0.72 && aspect > 0.45 && aspect < 2.2;
}

function distanceFromLine(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));

  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function archPointsFrom(points: number[]) {
  const pairs = pointPairs(points);

  if (pairs.length < 5) {
    return null;
  }

  const start = pairs[0];
  const end = pairs[pairs.length - 1];
  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);

  if (chordLength < 54) {
    return null;
  }

  const apex = pairs.reduce((best, point) =>
    distanceFromLine(point, start, end) > distanceFromLine(best, start, end) ? point : best
  );
  const archDepth = distanceFromLine(apex, start, end);

  if (archDepth < Math.max(24, chordLength * 0.16)) {
    return null;
  }

  const control = {
    x: 2 * apex.x - (start.x + end.x) / 2,
    y: 2 * apex.y - (start.y + end.y) / 2
  };
  const nextPoints: number[] = [];

  for (let step = 0; step <= 28; step += 1) {
    const t = step / 28;
    const inverse = 1 - t;
    nextPoints.push(
      inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    );
  }

  return nextPoints;
}

// Polyline maze stamps: pre-shaped walls laid down with a single click. They
// live as ordinary point-based "straight" walls, so the eraser, drag, and
// transform paths all treat them the same as a hand-drawn wall. The cul-de-sac
// stays special (a circle) and is built inline at placement time.
export type WallStampPreset =
  | "corner"
  | "tee"
  | "cross"
  | "hook"
  | "pocket"
  | "square"
  | "triangle"
  | "pentagon"
  | "hexagon";

// A closed regular polygon outline, point-up to match the filled MazeShapes
// (Konva's RegularPolygon also starts at the top vertex).
function regularPolygonPoints(cx: number, cy: number, radius: number, sides: number): number[] {
  const points: number[] = [];

  for (let vertex = 0; vertex <= sides; vertex += 1) {
    const angle = -Math.PI / 2 + (vertex / sides) * Math.PI * 2;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }

  return points;
}

// An actual cul-de-sac: a circular turnaround at the top opening onto a throat
// of two parallel walls leading in from the bottom. Drawn as one continuous
// stroke — up the right wall, around the loop, back down the left wall.
function pocketPoints(cx: number, cy: number, size: number): number[] {
  const half = size / 2;
  const radius = size * 0.34;
  const bulbX = cx;
  const bulbY = cy - size * 0.1;
  const throatHalf = Math.min(radius * 0.55, radius - 1);
  const bottomY = cy + half;
  // Angles (screen space, y down) where the throat walls meet the loop.
  const openAngle = Math.atan2(Math.sqrt(radius * radius - throatHalf * throatHalf), throatHalf);
  const startAngle = openAngle;
  // Sweep the long way round — over the top — leaving the gap at the bottom.
  const endAngle = Math.PI - openAngle - Math.PI * 2;
  const steps = 44;
  const points: number[] = [bulbX + throatHalf, bottomY];

  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + (endAngle - startAngle) * (step / steps);
    points.push(bulbX + Math.cos(angle) * radius, bulbY + Math.sin(angle) * radius);
  }

  points.push(bulbX - throatHalf, bottomY);

  return points;
}

export function wallStampPoints(preset: WallStampPreset, center: Point, size: number): number[] {
  const half = size / 2;
  const { x: cx, y: cy } = center;

  switch (preset) {
    // L elbow: down the left side, then across the bottom.
    case "corner":
      return [cx - half, cy - half, cx - half, cy + half, cx + half, cy + half];
    // T junction: crossbar along the top, stem dropping from its middle. The
    // retrace back to the bar's center keeps it a single continuous stroke.
    case "tee":
      return [cx - half, cy - half, cx + half, cy - half, cx, cy - half, cx, cy + half];
    // Four-way: top→center→left→center→right→center→bottom, retracing the hub
    // so the whole plus draws as one stroke.
    case "cross":
      return [
        cx,
        cy - half,
        cx,
        cy,
        cx - half,
        cy,
        cx,
        cy,
        cx + half,
        cy,
        cx,
        cy,
        cx,
        cy + half
      ];
    // U channel / dead end: down the left, across the bottom, back up the right.
    case "hook":
      return [cx - half, cy - half, cx - half, cy + half, cx + half, cy + half, cx + half, cy - half];
    case "pocket":
      return pocketPoints(cx, cy, size);
    // Axis-aligned square (flat sides), matching the filled square shape.
    case "square":
      return [
        cx - half,
        cy - half,
        cx + half,
        cy - half,
        cx + half,
        cy + half,
        cx - half,
        cy + half,
        cx - half,
        cy - half
      ];
    case "triangle":
      return regularPolygonPoints(cx, cy, half, 3);
    case "pentagon":
      return regularPolygonPoints(cx, cy, half, 5);
    case "hexagon":
      return regularPolygonPoints(cx, cy, half, 6);
    default:
      return [];
  }
}

export function perfectMazeWall(wall: MazeWall): MazeWall {
  if (wall.kind !== "curve" || wall.points.length < 6) {
    return wall;
  }

  const smoothedPoints = smoothCurvePoints(wall.points, HOLD_PERFECTION_SMOOTHING_PASSES);
  const [startX, startY] = smoothedPoints;
  const endX = smoothedPoints[smoothedPoints.length - 2];
  const endY = smoothedPoints[smoothedPoints.length - 1];
  const bounds = boundsForPoints(smoothedPoints);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const closeThreshold = Math.max(44, Math.min(width, height) * 0.38, wall.strokeWidth * 3);
  const isClosedLoop = Math.hypot(endX - startX, endY - startY) <= closeThreshold;

  if (!isClosedLoop) {
    const archPoints = archPointsFrom(smoothedPoints);

    if (archPoints) {
      return {
        ...wall,
        points: archPoints
      };
    }

    return {
      ...wall,
      points: smoothedPoints
    };
  }

  if (shouldPerfectAsCircle(smoothedPoints)) {
    return {
      ...wall,
      kind: "culdesac",
      points: [],
      x: bounds.minX + width / 2,
      y: bounds.minY + height / 2,
      rotation: 0,
      scale: 1,
      size: Math.max(width, height)
    };
  }

  if (!shouldPerfectAsBox(smoothedPoints)) {
    return {
      ...wall,
      points: [...smoothedPoints.slice(0, -2), startX, startY]
    };
  }

  const shouldSquare = width / Math.max(1, height) > 0.86 && width / Math.max(1, height) < 1.14;
  const size = shouldSquare ? Math.max(width, height) : null;
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  const minX = size ? centerX - size / 2 : bounds.minX;
  const maxX = size ? centerX + size / 2 : bounds.maxX;
  const minY = size ? centerY - size / 2 : bounds.minY;
  const maxY = size ? centerY + size / 2 : bounds.maxY;

  return {
    ...wall,
    kind: "straight",
    points: [minX, minY, maxX, minY, maxX, maxY, minX, maxY, minX, minY]
  };
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;

  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function pointOnSegment(start: Point, end: Point, t: number) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
}

// Splits a segment around the eraser's circular hole, returning the kept
// remnant before the hole (`leading`) and after it (`trailing`) separately.
// Keeping them labeled — rather than collapsing into a positional array —
// matters: when the hole covers the segment start there is no leading remnant,
// and a positional [0] lookup would mistake the trailing remnant for the
// leading one and bridge the gap with a straight line.
function keptSegmentParts(point: Point, start: Point, end: Point, radius: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return { leading: null, trailing: null } as {
      leading: Point[] | null;
      trailing: Point[] | null;
    };
  }

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);
  const projectionPoint = pointOnSegment(start, end, Math.max(0, Math.min(1, projection)));
  const perpendicularDistance = Math.hypot(point.x - projectionPoint.x, point.y - projectionPoint.y);

  if (perpendicularDistance > radius) {
    return { leading: [start, end], trailing: null } as {
      leading: Point[] | null;
      trailing: Point[] | null;
    };
  }

  const halfGap = Math.sqrt(Math.max(0, radius * radius - perpendicularDistance * perpendicularDistance));
  const t1 = Math.max(0, projection - halfGap / length);
  const t2 = Math.min(1, projection + halfGap / length);

  return {
    leading: t1 > 0.02 ? [start, pointOnSegment(start, end, t1)] : null,
    trailing: t2 < 0.98 ? [pointOnSegment(start, end, t2), end] : null
  } as { leading: Point[] | null; trailing: Point[] | null };
}

export function normalizeAngle(angle: number) {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function expandedAngleRange(start: number, end: number): Array<[number, number]> {
  if (start <= end) {
    return [[start, end]];
  }

  return [
    [0, end],
    [start, Math.PI * 2]
  ];
}

export function mergeAngleRanges(ranges: Array<[number, number]>) {
  const sorted = ranges
    .flatMap(([start, end]) => expandedAngleRange(normalizeAngle(start), normalizeAngle(end)))
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];

    if (!previous || range[0] > previous[1]) {
      merged.push([...range]);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
  }

  return merged;
}

function splitCuldesacByEraser(wall: MazeWall, point: Point, radius: number) {
  const centerX = wall.x ?? 0;
  const centerY = wall.y ?? 0;
  const wallScale = wall.scale ?? 1;
  const wallRadius = ((wall.size ?? 120) / 2) * wallScale;
  const threshold = radius + wall.strokeWidth / 2;
  const distanceFromCenter = Math.hypot(point.x - centerX, point.y - centerY);
  const distanceFromRing = Math.abs(distanceFromCenter - wallRadius);

  if (distanceFromRing > threshold) {
    return [wall];
  }

  const rotationRadians = ((wall.rotation ?? 0) * Math.PI) / 180;
  const eraseCenterAngle = normalizeAngle(Math.atan2(point.y - centerY, point.x - centerX) - rotationRadians);
  const eraseHalfAngle = Math.min(Math.PI * 0.42, Math.max(0.08, threshold / Math.max(1, wallRadius)));
  const nextRanges = mergeAngleRanges([
    ...(wall.erasedRanges ?? []),
    [eraseCenterAngle - eraseHalfAngle, eraseCenterAngle + eraseHalfAngle]
  ]);
  const erasedSweep = nextRanges.reduce((total, [start, end]) => total + end - start, 0);

  if (erasedSweep >= Math.PI * 2 - 0.12) {
    return [];
  }

  return [
    {
      ...wall,
      erasedRanges: nextRanges
    }
  ];
}

export function splitWallByEraser(wall: MazeWall, point: Point, radius: number) {
  if (wall.kind === "culdesac") {
    return splitCuldesacByEraser(wall, point, radius);
  }

  const threshold = radius + wall.strokeWidth / 2;
  const chunks: number[][] = [];
  let currentChunk: number[] = [];
  let erasedAny = false;

  for (let index = 2; index < wall.points.length - 1; index += 2) {
    const start = { x: wall.points[index - 2], y: wall.points[index - 1] };
    const end = { x: wall.points[index], y: wall.points[index + 1] };
    const erased = distanceToSegment(point, start, end) <= threshold;

    if (!erased) {
      if (currentChunk.length === 0) {
        currentChunk.push(start.x, start.y);
      }
      currentChunk.push(end.x, end.y);
      continue;
    }

    erasedAny = true;
    const { leading, trailing } = keptSegmentParts(point, start, end, threshold);

    // The kept lead-in (if any) closes the current chunk at the gap edge.
    if (leading) {
      if (currentChunk.length === 0) {
        currentChunk.push(leading[0].x, leading[0].y);
      }
      currentChunk.push(leading[1].x, leading[1].y);
    }

    if (currentChunk.length >= 4) {
      chunks.push(currentChunk);
    }
    currentChunk = [];

    // The kept tail (if any) starts a fresh chunk on the far side of the gap.
    if (trailing) {
      currentChunk.push(trailing[0].x, trailing[0].y, trailing[1].x, trailing[1].y);
    }
  }

  if (currentChunk.length >= 4) {
    chunks.push(currentChunk);
  }

  if (!erasedAny) {
    return [wall];
  }

  return chunks
    .filter((points) => pathLength(points) > 12)
    .map((points, index) => ({
      ...wall,
      instanceId: index === 0 ? wall.instanceId : uuid(),
      points
    }));
}

export function shapeTouchedByEraser(shape: MazeShape, point: Point, radius: number) {
  const shapeRadius = (shape.size * shape.scale) / 2;
  return Math.hypot(point.x - shape.x, point.y - shape.y) <= radius + shapeRadius;
}
