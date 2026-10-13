import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CanvasElement } from '../../../types/canvas';
import { getCanvasRoomName } from '../../../lib/yjs/rooms';

function item(id: string, type: CanvasElement['type']): CanvasElement {
  return {
    id, type, x: 10, y: 20, width: 120, height: 60, rotation: 0,
    zIndex: 1, color: 'sunflower', createdAt: 1, updatedAt: 1,
  };
}

describe('canvas Yjs persistence state', () => {
  it('restores latest adds, edits, moves, and deletions when the same room is reopened', () => {
    const documentId = 'canvas-document-123';
    const roomBeforeNavigation = getCanvasRoomName(documentId);
    const roomAfterReopening = getCanvasRoomName(documentId);
    expect(roomAfterReopening).toBe(roomBeforeNavigation);

    const editingDoc = new Y.Doc();
    const elements = editingDoc.getMap<CanvasElement>('canvas-elements');
    const shape = item('shape-1', 'rectangle');
    const line = { ...item('line-1', 'line'), startPoint: { x: 10, y: 20 }, endPoint: { x: 80, y: 50 }, endArrow: false };
    const text = { ...item('text-1', 'text'), text: 'Initial' };
    editingDoc.transact(() => {
      elements.set(shape.id, shape);
      elements.set(line.id, line);
      elements.set(text.id, text);
    });

    // Model rapid consecutive canvas operations before navigating away.
    editingDoc.transact(() => {
      elements.set(shape.id, { ...shape, x: 240, y: 180, updatedAt: 2 });
      elements.set(text.id, { ...text, text: 'Latest text', fontSize: 24, updatedAt: 3 });
      elements.delete(line.id);
    });

    const persistedUpdate = Y.encodeStateAsUpdate(editingDoc);
    const reopenedDoc = new Y.Doc();
    Y.applyUpdate(reopenedDoc, persistedUpdate);
    const restored = reopenedDoc.getMap<CanvasElement>('canvas-elements');

    expect(restored.get('shape-1')).toMatchObject({ x: 240, y: 180 });
    expect(restored.get('text-1')).toMatchObject({ text: 'Latest text', fontSize: 24 });
    expect(restored.has('line-1')).toBe(false);

    editingDoc.destroy();
    reopenedDoc.destroy();
  });

  it('keeps two canvases isolated while restoring their own Yjs state', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getMap<CanvasElement>('canvas-elements').set('a', item('a', 'circle'));
    docB.getMap<CanvasElement>('canvas-elements').set('b', item('b', 'diamond'));

    const restoredA = new Y.Doc();
    Y.applyUpdate(restoredA, Y.encodeStateAsUpdate(docA));
    expect(restoredA.getMap('canvas-elements').has('a')).toBe(true);
    expect(restoredA.getMap('canvas-elements').has('b')).toBe(false);
    expect(getCanvasRoomName('canvas-a')).not.toBe(getCanvasRoomName('canvas-b'));

    docA.destroy();
    docB.destroy();
    restoredA.destroy();
  });
});
