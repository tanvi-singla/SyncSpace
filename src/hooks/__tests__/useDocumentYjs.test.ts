import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { DocumentBlock, BlockType } from '../../types/documentTheme';
import { getDocumentRoomName, getCanvasRoomName, parseRoomName } from '../../lib/yjs/rooms';
import * as awarenessProtocol from 'y-protocols/awareness';

describe('Document Yjs CRDT Logic & Room Isolation', () => {
  it('guarantees complete room isolation between different document IDs', () => {
    const docAId = 'doc-alpha-123';
    const docBId = 'doc-beta-456';

    const roomA = getDocumentRoomName(docAId);
    const roomB = getDocumentRoomName(docBId);

    expect(roomA).toBe('syncspace:doc:doc-alpha-123');
    expect(roomB).toBe('syncspace:doc:doc-beta-456');
    expect(roomA).not.toBe(roomB);

    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const blocksArrayA = docA.getArray<any>('blocks');
    const blocksArrayB = docB.getArray<any>('blocks');

    // Insert block into doc A
    docA.transact(() => {
      const bMap = new Y.Map();
      bMap.set('id', 'block-a-1');
      bMap.set('type', 'heading1');
      bMap.set('content', 'Document A Architecture');
      bMap.set('checked', false);
      blocksArrayA.push([bMap]);
    });

    // Insert block into doc B
    docB.transact(() => {
      const bMap = new Y.Map();
      bMap.set('id', 'block-b-1');
      bMap.set('type', 'paragraph');
      bMap.set('content', 'Document B Roadmap');
      bMap.set('checked', false);
      blocksArrayB.push([bMap]);
    });

    // Verify isolation
    expect(blocksArrayA.length).toBe(1);
    expect(blocksArrayA.get(0).get('content')).toBe('Document A Architecture');
    expect(blocksArrayB.length).toBe(1);
    expect(blocksArrayB.get(0).get('content')).toBe('Document B Roadmap');
    expect(blocksArrayA.get(0).get('id')).not.toBe(blocksArrayB.get(0).get('id'));
  });

  it('correctly formats and parses document, canvas, and directory room names', () => {
    expect(getDocumentRoomName('123')).toBe('syncspace:doc:123');
    expect(getCanvasRoomName('456')).toBe('syncspace:canvas:456');

    const parsedDoc = parseRoomName('syncspace:doc:abc-1');
    expect(parsedDoc.type).toBe('doc');
    expect(parsedDoc.documentId).toBe('abc-1');

    const parsedCanvas = parseRoomName('syncspace:canvas:canvas-99');
    expect(parsedCanvas.type).toBe('canvas');
    expect(parsedCanvas.documentId).toBe('canvas-99');

    const parsedLegacy = parseRoomName('syncspace-document-legacy-7');
    expect(parsedLegacy.type).toBe('doc');
    expect(parsedLegacy.documentId).toBe('legacy-7');

    const parsedDir = parseRoomName('workspace-directory');
    expect(parsedDir.type).toBe('directory');
  });

  it('synchronizes edits between two clients in the same document room', () => {
    const client1Doc = new Y.Doc();
    const client2Doc = new Y.Doc();

    const client1Blocks = client1Doc.getArray<any>('blocks');
    const client2Blocks = client2Doc.getArray<any>('blocks');

    // Wire simulated update exchange between clients (same room)
    client1Doc.on('update', (update) => {
      Y.applyUpdate(client2Doc, update);
    });
    client2Doc.on('update', (update) => {
      Y.applyUpdate(client1Doc, update);
    });

    // Client 1 adds a block
    client1Doc.transact(() => {
      const bMap = new Y.Map();
      bMap.set('id', 'b1');
      bMap.set('type', 'paragraph');
      bMap.set('content', 'Initial thoughts from client 1');
      bMap.set('checked', false);
      client1Blocks.push([bMap]);
    });

    // Client 2 should now have the block
    expect(client2Blocks.length).toBe(1);
    expect(client2Blocks.get(0).get('content')).toBe('Initial thoughts from client 1');

    // Client 2 updates the block content
    client2Doc.transact(() => {
      client2Blocks.get(0).set('content', 'Updated by client 2');
    });

    // Client 1 should observe the converged state
    expect(client1Blocks.get(0).get('content')).toBe('Updated by client 2');

    // Client 1 adds a checklist block
    client1Doc.transact(() => {
      const bMap = new Y.Map();
      bMap.set('id', 'b2');
      bMap.set('type', 'checklist');
      bMap.set('content', 'Deploy to staging');
      bMap.set('checked', false);
      client1Blocks.push([bMap]);
    });

    // Client 2 toggles the checklist
    client2Doc.transact(() => {
      client2Blocks.get(1).set('checked', true);
    });

    // Both converge
    expect(client1Blocks.length).toBe(2);
    expect(client2Blocks.length).toBe(2);
    expect(client1Blocks.get(1).get('checked')).toBe(true);
    expect(client2Blocks.get(1).get('checked')).toBe(true);
  });

  it('prevents block duplication during simultaneous granular edits on the same block', () => {
    const client1Doc = new Y.Doc();
    const client2Doc = new Y.Doc();

    const client1Blocks = client1Doc.getArray<any>('blocks');
    const client2Blocks = client2Doc.getArray<any>('blocks');

    // Initial synchronized state
    client1Doc.transact(() => {
      const bMap = new Y.Map();
      bMap.set('id', 'shared-block');
      bMap.set('type', 'checklist');
      bMap.set('content', 'Initial Task');
      bMap.set('checked', false);
      client1Blocks.push([bMap]);
    });

    Y.applyUpdate(client2Doc, Y.encodeStateAsUpdate(client1Doc));

    // Both clients edit concurrently without network connection
    // Client 1 edits text
    client1Doc.transact(() => {
      client1Blocks.get(0).set('content', 'Task edited by client 1');
    });

    // Client 2 marks task as checked
    client2Doc.transact(() => {
      client2Blocks.get(0).set('checked', true);
    });

    // Reconnection / Sync exchange
    const update1 = Y.encodeStateAsUpdate(client1Doc);
    const update2 = Y.encodeStateAsUpdate(client2Doc);

    Y.applyUpdate(client2Doc, update1);
    Y.applyUpdate(client1Doc, update2);

    // CRDT guarantee: exactly 1 block exists with BOTH edits merged!
    expect(client1Blocks.length).toBe(1);
    expect(client2Blocks.length).toBe(1);

    expect(client1Blocks.get(0).get('content')).toBe('Task edited by client 1');
    expect(client1Blocks.get(0).get('checked')).toBe(true);

    expect(client2Blocks.get(0).get('content')).toBe('Task edited by client 1');
    expect(client2Blocks.get(0).get('checked')).toBe(true);
  });

  it('supports block deletion and resets to single paragraph if empty', () => {
    const doc = new Y.Doc();
    const blocksArray = doc.getArray<any>('blocks');

    doc.transact(() => {
      const b1 = new Y.Map();
      b1.set('id', 'b1');
      b1.set('type', 'paragraph');
      b1.set('content', 'First');
      b1.set('checked', false);

      const b2 = new Y.Map();
      b2.set('id', 'b2');
      b2.set('type', 'paragraph');
      b2.set('content', 'Second');
      b2.set('checked', false);

      blocksArray.push([b1, b2]);
    });

    expect(blocksArray.length).toBe(2);

    // Delete one block
    doc.transact(() => {
      blocksArray.delete(0, 1);
    });
    expect(blocksArray.length).toBe(1);
    expect(blocksArray.get(0).get('id')).toBe('b2');

    // Deleting the last block resets to empty paragraph
    doc.transact(() => {
      if (blocksArray.length <= 1) {
        blocksArray.delete(0, blocksArray.length);
        const resetBlock = new Y.Map();
        resetBlock.set('id', 'reset-1');
        resetBlock.set('type', 'paragraph');
        resetBlock.set('content', '');
        resetBlock.set('checked', false);
        blocksArray.push([resetBlock]);
      }
    });

    expect(blocksArray.length).toBe(1);
    expect(blocksArray.get(0).get('type')).toBe('paragraph');
    expect(blocksArray.get(0).get('content')).toBe('');
  });

  it('manages multiplayer awareness and cleans up state on exit', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const awareness1 = new awarenessProtocol.Awareness(doc1);
    const awareness2 = new awarenessProtocol.Awareness(doc2);

    // Simulate awareness transport
    awareness1.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness1, changed);
      awarenessProtocol.applyAwarenessUpdate(awareness2, update, 'client1');
    });

    awareness2.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness2, changed);
      awarenessProtocol.applyAwarenessUpdate(awareness1, update, 'client2');
    });

    // Client 1 sets user presence
    awareness1.setLocalStateField('user', {
      name: 'Alice',
      color: '#E05A47',
      cursor: { x: 150, y: 300 },
    });

    // Client 2 receives Alice's state
    const statesOnClient2 = awareness2.getStates();
    const aliceState = statesOnClient2.get(doc1.clientID);
    expect(aliceState).toBeDefined();
    expect(aliceState?.user?.name).toBe('Alice');
    expect(aliceState?.user?.cursor).toEqual({ x: 150, y: 300 });

    // Client 1 leaves document
    awareness1.setLocalState(null);

    // Client 2 sees client 1 removed
    const statesAfterLeave = awareness2.getStates();
    expect(statesAfterLeave.get(doc1.clientID)).toBeUndefined();
  });

  it('propagates local keystroke edits immediately to remote client observers via observeDeep', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const arr1 = doc1.getArray<any>('blocks');
    const arr2 = doc2.getArray<any>('blocks');

    // Simulate instant WebSocket bi-directional transport
    doc1.on('update', (update) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update) => {
      Y.applyUpdate(doc1, update);
    });

    // Client 1 creates initial paragraph block
    const bMap = new Y.Map();
    bMap.set('id', 'b-live-1');
    bMap.set('type', 'paragraph');
    bMap.set('content', '');
    bMap.set('checked', false);
    doc1.transact(() => {
      arr1.push([bMap]);
    });

    // Track remote client notifications
    let observerCallCount = 0;
    let lastObservedContent = '';
    const observer = () => {
      observerCallCount++;
      const block = arr2.get(0);
      lastObservedContent = block.get('content');
    };
    arr2.observeDeep(observer);

    // Simulate character-by-character live typing from client 1 ("H", "e", "l", "l", "o")
    const typedChars = ['H', 'He', 'Hel', 'Hell', 'Hello'];
    for (const text of typedChars) {
      doc1.transact(() => {
        bMap.set('content', text);
      });
    }

    // Client 2 observer fired on every keystroke
    expect(observerCallCount).toBe(5);
    expect(lastObservedContent).toBe('Hello');
    expect(arr2.get(0).get('content')).toBe('Hello');

    // Clean up observer
    arr2.unobserveDeep(observer);
  });

  it('preserves offline edits and converges upon reconnection without data loss', () => {
    const docOnline = new Y.Doc();
    const docOffline = new Y.Doc();

    const arrOnline = docOnline.getArray<any>('blocks');
    const arrOffline = docOffline.getArray<any>('blocks');

    // Initial shared state: 1 shared block
    docOnline.transact(() => {
      const b = new Y.Map();
      b.set('id', 'block-1');
      b.set('type', 'paragraph');
      b.set('content', 'Initial base content');
      b.set('checked', false);
      arrOnline.push([b]);
    });

    // Initial sync
    Y.applyUpdate(docOffline, Y.encodeStateAsUpdate(docOnline));

    // Client goes offline and types 2 new blocks while disconnected
    docOffline.transact(() => {
      arrOffline.get(0).set('content', 'Initial base content (modified offline)');

      const offlineBlock = new Y.Map();
      offlineBlock.set('id', 'block-offline-2');
      offlineBlock.set('type', 'checklist');
      offlineBlock.set('content', 'Offline checklist item');
      offlineBlock.set('checked', true);
      arrOffline.push([offlineBlock]);
    });

    // Meanwhile, online client adds another block concurrently
    docOnline.transact(() => {
      const onlineBlock = new Y.Map();
      onlineBlock.set('id', 'block-online-3');
      onlineBlock.set('type', 'heading2');
      onlineBlock.set('content', 'Concurrent online section');
      onlineBlock.set('checked', false);
      arrOnline.push([onlineBlock]);
    });

    // Reconnection occurs: updates are exchanged between offline and online
    const offlineUpdate = Y.encodeStateAsUpdate(docOffline);
    const onlineUpdate = Y.encodeStateAsUpdate(docOnline);

    Y.applyUpdate(docOnline, offlineUpdate);
    Y.applyUpdate(docOffline, onlineUpdate);

    // Both documents must converge to the exact same 3 blocks
    expect(arrOnline.length).toBe(3);
    expect(arrOffline.length).toBe(3);

    // Check first block merged content
    expect(arrOnline.get(0).get('content')).toBe('Initial base content (modified offline)');
    expect(arrOffline.get(0).get('content')).toBe('Initial base content (modified offline)');

    // Check offline block is preserved on both
    const offlineBlockInOnline = [arrOnline.get(1), arrOnline.get(2)].find(b => b.get('id') === 'block-offline-2');
    expect(offlineBlockInOnline).toBeDefined();
    expect(offlineBlockInOnline?.get('content')).toBe('Offline checklist item');
    expect(offlineBlockInOnline?.get('checked')).toBe(true);

    // Check online block is preserved on both
    const onlineBlockInOffline = [arrOffline.get(1), arrOffline.get(2)].find(b => b.get('id') === 'block-online-3');
    expect(onlineBlockInOffline).toBeDefined();
    expect(onlineBlockInOffline?.get('content')).toBe('Concurrent online section');
  });

  it('merges concurrent multi-block edits from two clients without race conditions or duplication', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const arrA = docA.getArray<any>('blocks');
    const arrB = docB.getArray<any>('blocks');

    // Create 2 initial blocks
    docA.transact(() => {
      const b1 = new Y.Map();
      b1.set('id', 'blk-1');
      b1.set('type', 'heading1');
      b1.set('content', 'Sprint Goals');
      b1.set('checked', false);

      const b2 = new Y.Map();
      b2.set('id', 'blk-2');
      b2.set('type', 'paragraph');
      b2.set('content', 'Team objectives for Q4');
      b2.set('checked', false);

      arrA.push([b1, b2]);
    });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Client A edits block 1 title
    docA.transact(() => {
      arrA.get(0).set('content', 'Sprint Goals 2026');
    });

    // Client B edits block 2 description concurrently
    docB.transact(() => {
      arrB.get(1).set('content', 'Team objectives for Q4 - Updated');
    });

    // Sync
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(arrA.length).toBe(2);
    expect(arrB.length).toBe(2);
    expect(arrA.get(0).get('content')).toBe('Sprint Goals 2026');
    expect(arrA.get(1).get('content')).toBe('Team objectives for Q4 - Updated');
    expect(arrB.get(0).get('content')).toBe('Sprint Goals 2026');
    expect(arrB.get(1).get('content')).toBe('Team objectives for Q4 - Updated');
  });

  it('properly cleans up observeDeep listeners on unmount without memory leaks', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<any>('blocks');

    let calls = 0;
    const observer = () => {
      calls++;
    };

    arr.observeDeep(observer);

    doc.transact(() => {
      const b = new Y.Map();
      b.set('id', 'blk-x');
      b.set('type', 'paragraph');
      b.set('content', 'hello');
      arr.push([b]);
    });

    expect(calls).toBe(1);

    // Unobserve (simulating hook unmount cleanup)
    arr.unobserveDeep(observer);

    doc.transact(() => {
      arr.get(0).set('content', 'world');
    });

    // Observer was unobserved and must NOT be called again
    expect(calls).toBe(1);

    doc.destroy();
  });
});
