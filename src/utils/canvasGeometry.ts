import { CanvasElement, Point, ConnectorBinding } from '../types/canvas';

/**
 * Get anchor point for a shape given its position and dimension and side
 */
export function getShapeAnchorPoint(
  shape: CanvasElement,
  side?: 'top' | 'right' | 'bottom' | 'left' | 'center'
): Point {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;

  switch (side) {
    case 'top':
      return { x: cx, y: shape.y };
    case 'bottom':
      return { x: cx, y: shape.y + shape.height };
    case 'left':
      return { x: shape.x, y: cy };
    case 'right':
      return { x: shape.x + shape.width, y: cy };
    case 'center':
    default:
      return { x: cx, y: cy };
  }
}

/**
 * Find the closest side on a target shape from a given source point
 */
export function getClosestAnchorSide(shape: CanvasElement, fromPoint: Point): 'top' | 'right' | 'bottom' | 'left' {
  const anchors: { side: 'top' | 'right' | 'bottom' | 'left'; pt: Point }[] = [
    { side: 'top', pt: { x: shape.x + shape.width / 2, y: shape.y } },
    { side: 'bottom', pt: { x: shape.x + shape.width / 2, y: shape.y + shape.height } },
    { side: 'left', pt: { x: shape.x, y: shape.y + shape.height / 2 } },
    { side: 'right', pt: { x: shape.x + shape.width, y: shape.y + shape.height / 2 } },
  ];

  let bestSide: 'top' | 'right' | 'bottom' | 'left' = 'top';
  let bestDist = Infinity;

  anchors.forEach(({ side, pt }) => {
    const dist = Math.hypot(pt.x - fromPoint.x, pt.y - fromPoint.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestSide = side;
    }
  });

  return bestSide;
}

/**
 * Resolve start and end coordinates for an arrow or line
 */
export function resolveConnectorPoints(
  connector: CanvasElement,
  elementsMap: Map<string, CanvasElement> | Record<string, CanvasElement>
): { start: Point; end: Point } {
  const getElem = (id: string): CanvasElement | undefined => {
    if (elementsMap instanceof Map) return elementsMap.get(id);
    return elementsMap[id];
  };

  let start: Point = connector.startPoint || { x: connector.x, y: connector.y };
  let end: Point = connector.endPoint || { x: connector.x + connector.width, y: connector.y + connector.height };

  if (connector.startBinding?.elementId) {
    const startElem = getElem(connector.startBinding.elementId);
    if (startElem) {
      const side = connector.startBinding.side || getClosestAnchorSide(startElem, end);
      start = getShapeAnchorPoint(startElem, side);
    }
  }

  if (connector.endBinding?.elementId) {
    const endElem = getElem(connector.endBinding.elementId);
    if (endElem) {
      const side = connector.endBinding.side || getClosestAnchorSide(endElem, start);
      end = getShapeAnchorPoint(endElem, side);
    }
  }

  return { start, end };
}

/**
 * Generate SVG Path string for connectors (straight, curved, elbow)
 */
export function generateConnectorPath(
  start: Point,
  end: Point,
  style: 'straight' | 'curved' | 'elbow' = 'straight'
): string {
  if (style === 'straight') {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  if (style === 'curved') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Bezier control points with smooth gentle curve
    const cx1 = start.x + dx * 0.5;
    const cy1 = start.y;
    const cx2 = start.x + dx * 0.5;
    const cy2 = end.y;
    return `M ${start.x} ${start.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end.x} ${end.y}`;
  }

  if (style === 'elbow') {
    const midX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
  }

  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Generate smooth SVG path from freehand drawing points
 */
export function generateSmoothFreehandPath(points: Point[]): string {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} A 1 1 0 0 0 ${points[0].x + 0.1} ${points[0].y + 0.1}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  return d;
}

/**
 * Calculate multi-element bounding box
 */
export function calculateElementsBounds(elements: CanvasElement[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} | null {
  if (!elements || elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach((el) => {
    if (el.type === 'line' || el.type === 'arrow') {
      const p1 = el.startPoint || { x: el.x, y: el.y };
      const p2 = el.endPoint || { x: el.x + el.width, y: el.y + el.height };
      minX = Math.min(minX, p1.x, p2.x);
      minY = Math.min(minY, p1.y, p2.y);
      maxX = Math.max(maxX, p1.x, p2.x);
      maxY = Math.max(maxY, p1.y, p2.y);
    } else if (el.type === 'draw' && el.points && el.points.length > 0) {
      el.points.forEach((pt) => {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      });
    } else {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if a point is inside a rectangle
 */
export function isPointInRect(pt: Point, rect: { x: number; y: number; width: number; height: number }): boolean {
  return pt.x >= rect.x && pt.x <= rect.x + rect.width && pt.y >= rect.y && pt.y <= rect.y + rect.height;
}

/**
 * Check if two rectangles intersect
 */
export function doRectsIntersect(
  r1: { minX: number; minY: number; maxX: number; maxY: number },
  r2: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(r2.minX > r1.maxX || r2.maxX < r1.minX || r2.minY > r1.maxY || r2.maxY < r1.minY);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Hit test canvas geometry in world coordinates. Tolerance should be scaled by zoom. */
export function isPointNearCanvasElement(point: Point, element: CanvasElement, tolerance: number): boolean {
  if (element.isHidden) return false;
  const threshold = Math.max(0, tolerance) + Math.max(0, element.strokeWidth || 0) / 2;

  if (element.type === 'line' || element.type === 'arrow') {
    const { start, end } = resolveConnectorPoints(element, new Map());
    let distance: number;
    if (element.lineStyle === 'curved') {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      let previous = start;
      distance = Infinity;
      for (let index = 1; index <= 24; index++) {
        const t = index / 24;
        const mt = 1 - t;
        const current = {
          x: mt ** 3 * start.x + 3 * mt ** 2 * t * (start.x + dx * 0.5) + 3 * mt * t ** 2 * (start.x + dx * 0.5) + t ** 3 * end.x,
          y: mt ** 3 * start.y + 3 * mt ** 2 * t * start.y + 3 * mt * t ** 2 * end.y + t ** 3 * end.y,
        };
        distance = Math.min(distance, distanceToSegment(point, previous, current));
        previous = current;
      }
    } else if (element.lineStyle === 'elbow') {
      const midX = (start.x + end.x) / 2;
      const bends = [{ x: midX, y: start.y }, { x: midX, y: end.y }];
      const path = [start, ...bends, end];
      distance = Math.min(...path.slice(1).map((pt, index) => distanceToSegment(point, path[index], pt)));
    } else {
      distance = distanceToSegment(point, start, end);
    }
    const arrowheadRadius = Math.max(8, (element.strokeWidth || 2) * 3);
    if (element.type === 'arrow' && element.endArrow !== false) distance = Math.min(distance, Math.max(0, Math.hypot(point.x - end.x, point.y - end.y) - arrowheadRadius));
    if (element.startArrow) distance = Math.min(distance, Math.max(0, Math.hypot(point.x - start.x, point.y - start.y) - arrowheadRadius));
    return distance <= threshold;
  }

  if (element.type === 'draw' && element.points?.length) {
    if (element.points.length === 1) {
      return Math.hypot(point.x - element.points[0].x, point.y - element.points[0].y) <= threshold;
    }
    return element.points.slice(1).some((end, index) => distanceToSegment(point, element.points![index], end) <= threshold);
  }

  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const angle = -(element.rotation || 0) * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const localPoint = element.rotation
    ? { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) }
    : point;
  return isPointInRect(localPoint, {
    x: element.x - threshold,
    y: element.y - threshold,
    width: element.width + threshold * 2,
    height: element.height + threshold * 2,
  });
}

/** Translate or resize a connector's stored endpoints with its selection bounds. */
export function transformConnectorPoints(
  element: CanvasElement,
  updates: Partial<CanvasElement>
): Pick<CanvasElement, 'startPoint' | 'endPoint'> {
  const start = element.startPoint || { x: element.x, y: element.y };
  const end = element.endPoint || { x: element.x + element.width, y: element.y + element.height };
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const oldWidth = Math.abs(end.x - start.x);
  const oldHeight = Math.abs(end.y - start.y);
  const nextX = updates.x ?? element.x;
  const nextY = updates.y ?? element.y;
  const isResize = updates.width !== undefined || updates.height !== undefined;
  const scaleX = isResize && oldWidth > 0 ? (updates.width ?? element.width) / oldWidth : 1;
  const scaleY = isResize && oldHeight > 0 ? (updates.height ?? element.height) / oldHeight : 1;
  const mapPoint = (point: Point): Point => isResize
    ? { x: nextX + (point.x - minX) * scaleX, y: nextY + (point.y - minY) * scaleY }
    : { x: point.x + nextX - element.x, y: point.y + nextY - element.y };
  return { startPoint: mapPoint(start), endPoint: mapPoint(end) };
}
