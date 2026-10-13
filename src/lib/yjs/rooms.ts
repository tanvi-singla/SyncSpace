/**
 * Deterministic room naming conventions for SyncSpace Yjs collaboration.
 * Ensures complete room isolation between documents, canvases, and directories.
 */

export const ROOM_PREFIX_DOC = 'syncspace:doc:';
export const ROOM_PREFIX_CANVAS = 'syncspace:canvas:';
export const ROOM_DIRECTORY = 'workspace-directory';

/**
 * Returns the deterministic room name for a text document.
 */
export function getDocumentRoomName(documentId: string): string {
  const id = (documentId || '').trim();
  if (id.startsWith(ROOM_PREFIX_DOC)) return id;
  return `${ROOM_PREFIX_DOC}${id}`;
}

/**
 * Returns the deterministic room name for a canvas document.
 */
export function getCanvasRoomName(documentId: string): string {
  const id = (documentId || '').trim();
  if (id.startsWith(ROOM_PREFIX_CANVAS)) return id;
  // If already prefixed with syncspace: but not syncspace:canvas:
  if (id.startsWith('syncspace:')) {
    return `${ROOM_PREFIX_CANVAS}${id.slice('syncspace:'.length)}`;
  }
  return `${ROOM_PREFIX_CANVAS}${id}`;
}

/** True only after the local IndexedDB provider restored the active canvas room. */
export function isCanvasRoomRestored(documentId: string, restoredRoomName: string | null): boolean {
  return restoredRoomName !== null && getCanvasRoomName(documentId || 'default') === restoredRoomName;
}

export type ParsedRoom = {
  type: 'doc' | 'canvas' | 'directory' | 'unknown';
  documentId?: string;
  rawRoomName: string;
};

/**
 * Parses any incoming room name (including legacy formats) to extract document ID and type.
 */
export function parseRoomName(roomName: string): ParsedRoom {
  const clean = (roomName || '').trim().replace(/^\/+/, '');

  if (clean === ROOM_DIRECTORY) {
    return { type: 'directory', rawRoomName: clean };
  }

  if (clean.startsWith(ROOM_PREFIX_DOC)) {
    return {
      type: 'doc',
      documentId: clean.slice(ROOM_PREFIX_DOC.length),
      rawRoomName: clean,
    };
  }

  if (clean.startsWith('syncspace-document-')) {
    return {
      type: 'doc',
      documentId: clean.slice('syncspace-document-'.length),
      rawRoomName: clean,
    };
  }

  if (clean.startsWith(ROOM_PREFIX_CANVAS)) {
    return {
      type: 'canvas',
      documentId: clean.slice(ROOM_PREFIX_CANVAS.length),
      rawRoomName: clean,
    };
  }

  if (clean.startsWith('syncspace:')) {
    return {
      type: 'canvas',
      documentId: clean.slice('syncspace:'.length),
      rawRoomName: clean,
    };
  }

  if (clean.startsWith('paper-craft-')) {
    return {
      type: 'canvas',
      documentId: clean.slice('paper-craft-'.length),
      rawRoomName: clean,
    };
  }

  return {
    type: 'unknown',
    documentId: clean,
    rawRoomName: clean,
  };
}
