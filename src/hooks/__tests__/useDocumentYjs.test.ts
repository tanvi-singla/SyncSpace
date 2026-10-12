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
});
