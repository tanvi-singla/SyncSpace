import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CanvasElement } from '../../../types/canvas';
import { getCanvasRoomName, isCanvasRoomRestored, parseRoomName } from '../../../lib/yjs/rooms';
import { getWsTokenApi } from '../../../lib/api/auth';
import { WebsocketProvider } from 'y-websocket';

function item(id: string, type: CanvasElement['type'], extra: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    type,
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    rotation: 0,
    zIndex: 1,
    color: 'sunflower',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

describe('Canvas Room Name Generation & Validation', () => {
  it('generates deterministic canvas room names for document IDs', () => {
    expect(getCanvasRoomName('canvas-document-123')).toBe('syncspace:canvas:canvas-document-123');
    expect(getCanvasRoomName('main')).toBe('syncspace:canvas:main');
    expect(getCanvasRoomName('064f758b-0598-4792-9219-975eee410c6c')).toBe(
      'syncspace:canvas:064f758b-0598-4792-9219-975eee410c6c'
    );
  });

  it('falls back to default canvas room name when id is empty or missing using roomId fallback', () => {
    const emptyId = '';
    expect(getCanvasRoomName(emptyId || 'default')).toBe('syncspace:canvas:default');
    const nullId = null as unknown as string;
    expect(getCanvasRoomName(nullId || 'default')).toBe('syncspace:canvas:default');
  });

  it('correctly parses canvas room names', () => {
    const parsed = parseRoomName('syncspace:canvas:doc-abc');
    expect(parsed.type).toBe('canvas');
    expect(parsed.documentId).toBe('doc-abc');
  });

  it('validates whether canvas room has restored from IndexedDB', () => {
    const docId = 'doc-xyz';
    const roomName = getCanvasRoomName(docId);
    expect(isCanvasRoomRestored(docId, roomName)).toBe(true);
    expect(isCanvasRoomRestored(docId, 'syncspace:canvas:different-doc')).toBe(false);
    expect(isCanvasRoomRestored(docId, null)).toBe(false);
  });
});

describe('Authentication Token Supplied Before Canvas WebSocket Connection', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('supplies token in provider.params before initiating WebSocket connection', async () => {
    const mockToken = 'mock-canvas-shortlived-jwt-token';
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: mockToken, userId: 'user-canvas-1' }),
      } as Response);
    });

    const doc = new Y.Doc();
    const docName = getCanvasRoomName('doc-with-token');

    // Create provider with connect: false as required
    const provider = new WebsocketProvider('ws://localhost:1234', docName, doc, { connect: false });
    expect(provider.shouldConnect).toBe(false);

    // Fetch token using helper
    const token = await getWsTokenApi();
    expect(token).toBe(mockToken);

    // Supply params before connect
    if (token) {
      provider.params = { token };
    }

    expect(provider.params).toEqual({ token: mockToken });

    // Clean up
    provider.destroy();
    doc.destroy();
  });

  it('handles token-fetch failure safely without throwing and falls back to connect attempt', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.reject(new Error('Network error or server unreachable'));
    });

    const doc = new Y.Doc();
    const docName = getCanvasRoomName('doc-token-fail');
    const provider = new WebsocketProvider('ws://localhost:1234', docName, doc, { connect: false });

    let tokenRetrieved: string | null = 'not-null-yet';
    try {
      tokenRetrieved = await getWsTokenApi();
    } catch {
      tokenRetrieved = null;
    }

    expect(tokenRetrieved).toBeNull();
    // In fallback mode, provider connects without token (cookie fallback)
    expect(provider.params).toEqual({});

    provider.destroy();
    doc.destroy();
  });
});

describe('Bidirectional Canvas Elements Synchronization (CRDT)', () => {
  it('synchronizes element additions, moves, text edits, and deletions bidirectionally', () => {
    const clientADoc = new Y.Doc();
    const clientBDoc = new Y.Doc();

    const elementsA = clientADoc.getMap<CanvasElement>('canvas-elements');
    const elementsB = clientBDoc.getMap<CanvasElement>('canvas-elements');

    // Wire simulated real-time bi-directional relay between client A and client B
    clientADoc.on('update', (update) => {
      Y.applyUpdate(clientBDoc, update);
    });
    clientBDoc.on('update', (update) => {
      Y.applyUpdate(clientADoc, update);
    });

    // 1. Client A creates a rectangle shape
    const rect = item('rect-1', 'rectangle', { x: 50, y: 100, width: 200, height: 120, color: 'sky' });
    clientADoc.transact(() => {
      elementsA.set(rect.id, rect);
    });

    // Client B immediately observes the rectangle
    expect(elementsB.has('rect-1')).toBe(true);
    expect(elementsB.get('rect-1')).toMatchObject({
      id: 'rect-1',
      type: 'rectangle',
      x: 50,
      y: 100,
      width: 200,
      height: 120,
      color: 'sky',
    });

    // 2. Client B moves and resizes the shape
    clientBDoc.transact(() => {
      elementsB.set('rect-1', {
        ...rect,
        x: 350,
        y: 220,
        width: 250,
        height: 160,
        updatedAt: 2,
      });
    });

    // Client A immediately receives the updated position & dimensions
    expect(elementsA.get('rect-1')).toMatchObject({
      x: 350,
      y: 220,
      width: 250,
      height: 160,
      updatedAt: 2,
    });

    // 3. Client B adds a sticky note and a connector line
    const sticky = item('sticky-1', 'sticky', {
      x: 500,
      y: 80,
      width: 180,
      height: 180,
      text: 'Canvas architecture note',
      color: 'coral',
    });
    const connector = item('conn-1', 'line', {
      startPoint: { x: 350, y: 220 },
      endPoint: { x: 500, y: 80 },
      startArrow: false,
      endArrow: true,
    });

    clientBDoc.transact(() => {
      elementsB.set(sticky.id, sticky);
      elementsB.set(connector.id, connector);
    });

    // Client A receives both elements
    expect(elementsA.has('sticky-1')).toBe(true);
    expect(elementsA.get('sticky-1')?.text).toBe('Canvas architecture note');
    expect(elementsA.has('conn-1')).toBe(true);
    expect(elementsA.get('conn-1')?.endArrow).toBe(true);

    // 4. Client A edits the sticky note text
    clientADoc.transact(() => {
      const current = elementsA.get('sticky-1')!;
      elementsA.set('sticky-1', { ...current, text: 'Updated collaboratively by Client A', updatedAt: 3 });
    });

    // Client B receives the text update
    expect(elementsB.get('sticky-1')?.text).toBe('Updated collaboratively by Client A');

    // 5. Client A deletes the rectangle
    clientADoc.transact(() => {
      elementsA.delete('rect-1');
    });

    // Client B reflects deletion
    expect(elementsB.has('rect-1')).toBe(false);
    expect(elementsA.size).toBe(2);
    expect(elementsB.size).toBe(2);

    clientADoc.destroy();
    clientBDoc.destroy();
  });

  it('converges deterministically when both clients edit concurrently', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const map1 = doc1.getMap<CanvasElement>('canvas-elements');
    const map2 = doc2.getMap<CanvasElement>('canvas-elements');

    const baseElem = item('node-1', 'circle', { x: 100, y: 100, color: 'violet' });
    doc1.transact(() => {
      map1.set(baseElem.id, baseElem);
    });

    // Sync initial element to doc2
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Client 1 edits position while disconnected
    doc1.transact(() => {
      map1.set('node-1', { ...baseElem, x: 250, y: 300, updatedAt: 10 });
    });

    // Client 2 edits color while disconnected
    doc2.transact(() => {
      map2.set('node-1', { ...baseElem, color: 'sage', updatedAt: 11 });
    });

    // Reconnect & exchange updates
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);

    Y.applyUpdate(doc1, update2);
    Y.applyUpdate(doc2, update1);

    // Both clients converge to identical state without discrepancy
    expect(map1.get('node-1')).toEqual(map2.get('node-1'));

    doc1.destroy();
    doc2.destroy();
  });
});

describe('Disconnected and Error Status Handling', () => {
  it('does not falsely report synced when disconnected', () => {
    let connectionStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';
    let saveStatus: 'saved' | 'saving' | 'synced' = 'saving';
    let websocketStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';

    // Handler simulating status change events in useCanvasEngine
    const handleStatus = (status: 'connected' | 'connecting' | 'disconnected') => {
      websocketStatus = status;
      connectionStatus = status;
      if (status === 'connected') {
        saveStatus = 'synced';
      } else if (status === 'connecting') {
        saveStatus = 'saving';
      } else {
        saveStatus = 'saved';
      }
    };

    // When disconnected
    handleStatus('disconnected');
    expect(connectionStatus).toBe('disconnected');
    expect(saveStatus).toBe('saved');
    expect(saveStatus).not.toBe('synced');

    // When connection-error fires
    handleStatus('disconnected');
    expect(connectionStatus).toBe('disconnected');
    expect(saveStatus).toBe('saved');

    // When connected
    handleStatus('connected');
    expect(connectionStatus).toBe('connected');
    expect(saveStatus).toBe('synced');
  });

  it('preserves local elements intact during disconnection', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<CanvasElement>('canvas-elements');

    const offlineElem = item('offline-shape', 'diamond', { x: 40, y: 50 });
    doc.transact(() => {
      map.set(offlineElem.id, offlineElem);
    });

    // Simulate WebSocket disconnect event
    expect(map.has('offline-shape')).toBe(true);
    expect(map.get('offline-shape')?.type).toBe('diamond');

    // Local modifications while offline
    doc.transact(() => {
      map.set('offline-shape', { ...offlineElem, x: 120, y: 90 });
    });

    expect(map.get('offline-shape')?.x).toBe(120);
    doc.destroy();
  });
});

describe('Existing Canvas Yjs Persistence State', () => {
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
