import { describe, expect, it } from 'vitest';
import { CanvasElement } from '../../types/canvas';
import { isPointNearCanvasElement, transformConnectorPoints } from '../canvasGeometry';

function element(overrides: Partial<CanvasElement>): CanvasElement {
  return {
    id: 'test', type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
    rotation: 0, zIndex: 1, color: 'sunflower', createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe('canvas eraser hit testing', () => {
  it('hits a line by distance from its segment, not its bounding box', () => {
    const line = element({ type: 'line', x: 20, y: 30, width: 160, height: 0, startPoint: { x: 20, y: 30 }, endPoint: { x: 180, y: 30 }, endArrow: false });
    expect(isPointNearCanvasElement({ x: 99, y: 35 }, line, 6)).toBe(true);
    expect(isPointNearCanvasElement({ x: 99, y: 46 }, line, 6)).toBe(false);
  });

  it('hits arrowheads and curved and elbow connector paths', () => {
    const arrow = element({ type: 'arrow', x: 0, y: 0, width: 100, height: 100, startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 100 } });
    expect(isPointNearCanvasElement({ x: 95, y: 100 }, arrow, 2)).toBe(true);
    const curve = { ...arrow, lineStyle: 'curved' as const };
    expect(isPointNearCanvasElement({ x: 50, y: 50 }, curve, 3)).toBe(true);
    const elbow = { ...arrow, lineStyle: 'elbow' as const };
    expect(isPointNearCanvasElement({ x: 50, y: 0 }, elbow, 2)).toBe(true);
  });

  it('hits actual freehand segments and respects hidden objects', () => {
    const stroke = element({ type: 'draw', x: 0, y: 0, width: 100, height: 100, points: [{ x: 10, y: 10 }, { x: 90, y: 90 }] });
    expect(isPointNearCanvasElement({ x: 50, y: 52 }, stroke, 4)).toBe(true);
    expect(isPointNearCanvasElement({ x: 50, y: 65 }, stroke, 4)).toBe(false);
    expect(isPointNearCanvasElement({ x: 50, y: 50 }, { ...stroke, isHidden: true }, 10)).toBe(false);
  });

  it('uses the caller supplied zoom-scaled tolerance', () => {
    const line = element({ type: 'line', startPoint: { x: 0, y: 20 }, endPoint: { x: 100, y: 20 }, endArrow: false });
    expect(isPointNearCanvasElement({ x: 50, y: 29 }, line, 10)).toBe(true);
    expect(isPointNearCanvasElement({ x: 50, y: 29 }, line, 3)).toBe(false);
  });

  it('moves and resizes connector endpoints with their selection bounds', () => {
    const connector = element({ type: 'line', x: 10, y: 20, width: 90, height: 40, startPoint: { x: 10, y: 60 }, endPoint: { x: 100, y: 20 }, endArrow: false });
    expect(transformConnectorPoints(connector, { x: 30, y: 50 })).toEqual({ startPoint: { x: 30, y: 90 }, endPoint: { x: 120, y: 50 } });
    expect(transformConnectorPoints(connector, { x: 20, y: 30, width: 180, height: 80 })).toEqual({ startPoint: { x: 20, y: 110 }, endPoint: { x: 200, y: 30 } });
  });
});
