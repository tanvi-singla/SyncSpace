import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { DocumentBlock, BlockType } from '../types/documentTheme';
import { getWsUrl } from '../lib/yjs/config';
import { getDocumentRoomName } from '../lib/yjs/rooms';
import { getWsTokenApi } from '../lib/api/auth';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface DocumentCollaborator {
  clientId: number;
  userId?: string;
  name: string;
  color: string;
  lastActive: number;
}

export interface UseDocumentYjsOptions {
  documentId: string;
  wsUrl?: string;
  user?: {
    id?: string;
    name?: string;
    color?: string;
  };
}

export interface UseDocumentYjsReturn {
  blocks: DocumentBlock[];
  updateBlock: (
    id: string,
    updates: Partial<DocumentBlock> | string,
    extra?: Partial<DocumentBlock>
  ) => void;
  addBlock: (
    typeOrBlock?: BlockType | Partial<DocumentBlock>,
    afterId?: string
  ) => string;
  deleteBlock: (id: string) => void;
  toggleChecklist: (id: string) => void;
  connectionStatus: ConnectionStatus;
  isIndexedDbSynced: boolean;
  clientId: number;
  collaborators: DocumentCollaborator[];
  remoteUsers: DocumentCollaborator[];
}

function generateBlockId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Normalizes an item from the Y.Array (supporting both granular Y.Map blocks
 * and legacy plain DocumentBlock objects) into a typed DocumentBlock.
 */
function yItemToBlock(item: any): DocumentBlock {
  if (item instanceof Y.Map) {
    return {
      id: item.get('id') || '',
      type: item.get('type') || 'paragraph',
      content: item.get('content') || '',
      checked: item.get('checked') ?? false,
    };
  }
  return {
    id: item?.id || '',
    type: item?.type || 'paragraph',
    content: item?.content || '',
    checked: item?.checked ?? false,
  };
}

/**
 * Converts a DocumentBlock into a collaborative Y.Map for granular property CRDT updates.
 */
function blockToYMap(b: DocumentBlock): Y.Map<any> {
  const map = new Y.Map<any>();
  map.set('id', b.id);
  map.set('type', b.type);
  map.set('content', b.content);
  map.set('checked', b.checked ?? false);
  return map;
}

function findBlockIndex(arr: Y.Array<any>, id: string): number {
  for (let i = 0; i < arr.length; i++) {
    const b = arr.get(i);
    if (!b) continue;
    const bid = b instanceof Y.Map ? b.get('id') : b.id;
    if (bid === id) {
      return i;
    }
  }
  return -1;
}

export function useDocumentYjs({
  documentId,
  wsUrl,
  user,
}: UseDocumentYjsOptions): UseDocumentYjsReturn {
  const [blocks, setBlocks] = useState<DocumentBlock[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [isIndexedDbSynced, setIsIndexedDbSynced] = useState(false);
  const [clientId, setClientId] = useState<number>(0);
  const [collaborators, setCollaborators] = useState<DocumentCollaborator[]>([]);

  const ydocRef = useRef<Y.Doc | null>(null);
  const blocksArrayRef = useRef<Y.Array<any> | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const awarenessThrottleRef = useRef<number>(0);

  // Use the standardized multi-computer WebSocket URL resolver
  const resolvedWsUrl = wsUrl || getWsUrl();

  useEffect(() => {
    // Graceful handling for missing or blank document ID
    if (!documentId || !documentId.trim()) {
      setBlocks([]);
      setConnectionStatus('disconnected');
      setIsIndexedDbSynced(false);
      setCollaborators([]);
      return;
    }

    const docName = getDocumentRoomName(documentId);
    const doc = new Y.Doc();
    ydocRef.current = doc;
    setClientId(doc.clientID);

    const blocksArray = doc.getArray<any>('blocks');
    blocksArrayRef.current = blocksArray;

    const syncBlocksFromYjs = () => {
      const currentArray = blocksArrayRef.current;
      if (!currentArray) return;
      const list: DocumentBlock[] = [];
      for (let i = 0; i < currentArray.length; i++) {
        const item = currentArray.get(i);
        if (item) list.push(yItemToBlock(item));
      }
      setBlocks(list);
    };

    let hasInitialized = false;

    // Checks if the document is genuinely empty and initializes starter paragraph once
    const checkAndInitDefaultBlocks = (isWsSynced = false) => {
      const currentArray = blocksArrayRef.current;
      const currentDoc = ydocRef.current;
      if (!currentArray || !currentDoc) return;

      if (currentArray.length === 0) {
        // If connecting to WebSocket, wait until WebSocket is synced before inserting default block
        // to prevent race conditions with remote server content.
        if (wsProvider && !isWsSynced && wsProvider.wsconnected) {
          return;
        }

        if (hasInitialized) return;
        hasInitialized = true;

        currentDoc.transact(() => {
          if (currentArray.length === 0) {
            currentArray.push([
              blockToYMap({
                id: 'b1',
                type: 'paragraph',
                content: '',
                checked: false,
              }),
            ]);
          }
        });
      } else {
        hasInitialized = true;
        // If concurrent initializations occurred, deduplicate initial empty b1 blocks
        if (currentArray.length > 1) {
          const b1EmptyIndices: number[] = [];
          for (let i = 0; i < currentArray.length; i++) {
            const item = currentArray.get(i);
            const block = yItemToBlock(item);
            if (block.id === 'b1' && block.content === '') {
              b1EmptyIndices.push(i);
            }
          }
          if (b1EmptyIndices.length > 0 && currentArray.length > b1EmptyIndices.length) {
            // Remove empty initial b1 blocks if user content exists
            currentDoc.transact(() => {
              for (let i = b1EmptyIndices.length - 1; i >= 0; i--) {
                currentArray.delete(b1EmptyIndices[i], 1);
              }
            });
          } else if (b1EmptyIndices.length > 1) {
            currentDoc.transact(() => {
              for (let i = b1EmptyIndices.length - 1; i > 0; i--) {
                currentArray.delete(b1EmptyIndices[i], 1);
              }
            });
          }
        }
      }
    };

    // 1. IndexedDB persistence for offline-first resilience
    const idbProvider = new IndexeddbPersistence(docName, doc);
    idbRef.current = idbProvider;

    idbProvider.on('synced', () => {
      setIsIndexedDbSynced(true);
      checkAndInitDefaultBlocks(false);
      syncBlocksFromYjs();
    });

    // 2. Real-time WebSocket synchronization across tabs and users
    let isDisposed = false;
    let wsProvider: WebsocketProvider | null = null;
    let cleanupAwareness: (() => void) | undefined;

    // Sanitize target host for safe diagnostic logging (never log tokens or contents)
    const safeHost = (() => {
      try {
        return new URL(resolvedWsUrl.replace(/^ws/, 'http')).host;
      } catch {
        return 'unknown';
      }
    })();

    console.log(`[useDocumentYjs] Initializing connection to room: ${docName} (target host: ${safeHost})`);

    try {
      wsProvider = new WebsocketProvider(resolvedWsUrl, docName, doc, {
        connect: false,
      });
      providerRef.current = wsProvider;

      wsProvider.on('status', (event: { status: ConnectionStatus }) => {
        console.log(`[useDocumentYjs] Connection status changed to: ${event.status} (room: ${docName}, host: ${safeHost})`);
        setConnectionStatus(event.status);
        if (event.status === 'disconnected') {
          // If offline and IndexedDB is empty, safely initialize starter block
          checkAndInitDefaultBlocks(false);
          syncBlocksFromYjs();
        }
      });

      wsProvider.on('sync', (isSynced: boolean) => {
        if (isSynced) {
          console.log(`[useDocumentYjs] Synced with relay server for room: ${docName} (host: ${safeHost})`);
          checkAndInitDefaultBlocks(true);
          syncBlocksFromYjs();
        }
      });

      wsProvider.on('connection-error', (err: any) => {
        const safeErrorMessage =
          err && typeof err.message === 'string'
            ? err.message
            : err && typeof err.type === 'string'
            ? err.type
            : 'WebSocket connection handshake failure';
        console.warn(`[useDocumentYjs] Connection error for room: ${docName} (host: ${safeHost}): ${safeErrorMessage}`);
        setConnectionStatus('disconnected');
        checkAndInitDefaultBlocks(false);
        syncBlocksFromYjs();
      });

      // Awareness for collaborative presence
      const awareness = wsProvider.awareness;
      awareness.setLocalStateField('user', {
        name: user?.name || 'Collaborator',
        color: user?.color || '#00667E',
        userId: user?.id,
        currentDocId: documentId,
        lastActive: Date.now(),
      });

      const handleAwarenessChange = () => {
        const now = Date.now();
        if (now - awarenessThrottleRef.current < 40) return; // Throttled updates to prevent high-frequency re-renders
        awarenessThrottleRef.current = now;

        const states = awareness.getStates();
        const active: DocumentCollaborator[] = [];
        const localClientId = doc.clientID;

        states.forEach((state, cid) => {
          if (cid !== localClientId && state.user) {
            active.push({
              clientId: cid,
              userId: state.user.userId,
              name: state.user.name || 'Anonymous',
              color: state.user.color || '#00667E',
              lastActive: state.user.lastActive || Date.now(),
            });
          }
        });
        setCollaborators(active);
      };

      awareness.on('change', handleAwarenessChange);
      cleanupAwareness = () => {
        awareness.off('change', handleAwarenessChange);
        awareness.setLocalState(null);
      };

      // Retrieve backend-minted WebSocket token for cross-origin or deployed authentication
      getWsTokenApi()
        .then((token) => {
          if (isDisposed || !wsProvider) return;
          if (token) {
            wsProvider.params = { token };
          }
          wsProvider.connect();
        })
        .catch((err) => {
          if (isDisposed || !wsProvider) return;
          const msg = err instanceof Error ? err.message : 'token retrieval failure';
          console.warn(`[useDocumentYjs] Connecting with cookie fallback (${msg})`);
          wsProvider.connect();
        });
    } catch (e) {
      const initError = e instanceof Error ? e.message : 'Unknown initialization failure';
      console.warn(
        `[useDocumentYjs] WebSocket initialization fallback to offline IndexedDB for ${docName}: ${initError}`
      );
      setConnectionStatus('disconnected');
    }

    // 3. Observe deep mutations (both block order changes and individual block property changes)
    const handleArrayChange = () => {
      syncBlocksFromYjs();
    };

    blocksArray.observeDeep(handleArrayChange);

    // Initial state read
    syncBlocksFromYjs();

    // 4. Cleanup on document change or unmount
    return () => {
      isDisposed = true;
      blocksArray.unobserveDeep(handleArrayChange);
      cleanupAwareness?.();
      if (wsProvider) {
        wsProvider.destroy();
      }
      idbProvider.destroy();
      doc.destroy();
      ydocRef.current = null;
      blocksArrayRef.current = null;
      providerRef.current = null;
      idbRef.current = null;
    };
  }, [documentId, resolvedWsUrl]);

  // Update a block in Y.Doc with granular property mutations (no delete-reinsert)
  const updateBlock = useCallback(
    (
      id: string,
      updates: Partial<DocumentBlock> | string,
      extra?: Partial<DocumentBlock>
    ) => {
      const currentArray = blocksArrayRef.current;
      const currentDoc = ydocRef.current;
      if (!currentArray || !currentDoc) return;

      const patch: Partial<DocumentBlock> =
        typeof updates === 'string'
          ? { content: updates, ...extra }
          : { ...updates, ...extra };

      const idx = findBlockIndex(currentArray, id);
      if (idx === -1) return;

      const current = currentArray.get(idx);
      if (!current) return;

      // Granular Y.Map mutation
      if (current instanceof Y.Map) {
        currentDoc.transact(() => {
          if (patch.content !== undefined && current.get('content') !== patch.content) {
            current.set('content', patch.content);
          }
          if (patch.type !== undefined && current.get('type') !== patch.type) {
            current.set('type', patch.type);
          }
          if (patch.checked !== undefined && current.get('checked') !== patch.checked) {
            current.set('checked', patch.checked);
          }
        });
      } else {
        // Legacy plain object fallback
        const hasChanges = Object.entries(patch).some(
          ([key, value]) => (current as any)[key] !== value
        );
        if (!hasChanges) return;

        const updated: DocumentBlock = {
          ...current,
          ...patch,
        };

        currentDoc.transact(() => {
          currentArray.delete(idx, 1);
          currentArray.insert(idx, [blockToYMap(updated)]);
        });
      }
    },
    []
  );

  // Add a new block in Y.Doc (at end or after a specific block)
  const addBlock = useCallback(
    (
      typeOrBlock?: BlockType | Partial<DocumentBlock>,
      afterId?: string
    ): string => {
      const currentArray = blocksArrayRef.current;
      const currentDoc = ydocRef.current;
      if (!currentArray || !currentDoc) return '';

      let newBlock: DocumentBlock;
      if (typeof typeOrBlock === 'object' && typeOrBlock !== null) {
        newBlock = {
          id: typeOrBlock.id || generateBlockId(),
          type: typeOrBlock.type || 'paragraph',
          content: typeOrBlock.content || '',
          checked: typeOrBlock.checked ?? false,
        };
      } else {
        newBlock = {
          id: generateBlockId(),
          type: typeOrBlock || 'paragraph',
          content: '',
          checked: false,
        };
      }

      const ymap = blockToYMap(newBlock);

      currentDoc.transact(() => {
        if (!afterId) {
          currentArray.push([ymap]);
        } else {
          const idx = findBlockIndex(currentArray, afterId);
          if (idx === -1) {
            currentArray.push([ymap]);
          } else {
            currentArray.insert(idx + 1, [ymap]);
          }
        }
      });

      return newBlock.id;
    },
    []
  );

  // Delete a block from Y.Doc (resets to single empty block if all deleted)
  const deleteBlock = useCallback((id: string) => {
    const currentArray = blocksArrayRef.current;
    const currentDoc = ydocRef.current;
    if (!currentArray || !currentDoc) return;

    currentDoc.transact(() => {
      if (currentArray.length <= 1) {
        currentArray.delete(0, currentArray.length);
        currentArray.push([
          blockToYMap({
            id: generateBlockId(),
            type: 'paragraph',
            content: '',
            checked: false,
          }),
        ]);
        return;
      }

      const idx = findBlockIndex(currentArray, id);
      if (idx !== -1) {
        currentArray.delete(idx, 1);
      }
    });
  }, []);

  // Toggle checklist checkbox in Y.Doc
  const toggleChecklist = useCallback((id: string) => {
    const currentArray = blocksArrayRef.current;
    const currentDoc = ydocRef.current;
    if (!currentArray || !currentDoc) return;

    const idx = findBlockIndex(currentArray, id);
    if (idx === -1) return;

    const current = currentArray.get(idx);
    if (!current) return;

    if (current instanceof Y.Map) {
      currentDoc.transact(() => {
        current.set('checked', !current.get('checked'));
      });
    } else {
      currentDoc.transact(() => {
        currentArray.delete(idx, 1);
        currentArray.insert(idx, [
          blockToYMap({
            ...current,
            checked: !current.checked,
          }),
        ]);
      });
    }
  }, []);

  return {
    blocks,
    updateBlock,
    addBlock,
    deleteBlock,
    toggleChecklist,
    connectionStatus,
    isIndexedDbSynced,
    clientId,
    collaborators,
    remoteUsers: collaborators,
  };
}

export default useDocumentYjs;
