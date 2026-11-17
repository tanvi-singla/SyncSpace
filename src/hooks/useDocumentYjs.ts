import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { DocumentBlock, BlockType } from '../types/documentTheme';
import { getWsUrl } from '../lib/yjs/config';
import { getDocumentRoomName } from '../lib/yjs/rooms';
import { getWsTokenApi } from '../lib/api/auth';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface RawAwarenessUserState {
  userId?: string;
  name?: string;
  color?: string;
  avatarUrl?: string | null;
  role?: 'OWNER' | 'EDITOR' | 'VIEWER';
  isEditing?: boolean;
  currentDocId?: string;
  lastActive?: number;
}

export interface DocumentCollaborator {
  clientId: number;
  clientIds: number[];
  userId?: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  role?: 'OWNER' | 'EDITOR' | 'VIEWER';
  tabCount: number;
  isEditing: boolean;
  lastActive: number;
}

export interface UseDocumentYjsOptions {
  documentId: string;
  wsUrl?: string;
  user?: {
    id?: string;
    name?: string;
    color?: string;
    avatarUrl?: string | null;
    role?: 'OWNER' | 'EDITOR' | 'VIEWER';
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
  allParticipants: DocumentCollaborator[];
  currentUserTabs: number;
  isLocalEditing: boolean;
  markEditing: () => void;
}

/**
 * Pure deduplication helper for Yjs awareness states.
 * - Groups multiple Yjs client IDs belonging to the same authenticated PostgreSQL userId.
 * - Displays each person only once with an accurate tabCount.
 * - If any tab belonging to a user is editing, marks that user as editing.
 * - Never allows a VIEWER to appear as editing.
 * - Cleans up stale editing flags (> 4s inactivity) and dropped clients.
 */
export function deduplicateAwarenessStates(
  states: Map<number, { user?: RawAwarenessUserState; [key: string]: any }>,
  localClientId?: number,
  localUserId?: string
): {
  collaborators: DocumentCollaborator[];
  allParticipants: DocumentCollaborator[];
  currentUserTabs: number;
} {
  const groups = new Map<
    string,
    {
      primaryClientId: number;
      clientIds: number[];
      userId?: string;
      name: string;
      color: string;
      avatarUrl?: string | null;
      role?: 'OWNER' | 'EDITOR' | 'VIEWER';
      isEditing: boolean;
      lastActive: number;
      isLocalUser: boolean;
    }
  >();

  const now = Date.now();

  states.forEach((state, cid) => {
    if (!state || !state.user) return;
    const u = state.user;

    // Drop stale states older than awareness timeout (35s)
    if (u.lastActive && now - u.lastActive > 35000) {
      return;
    }

    const userId = u.userId;
    const userKey = userId ? `user:${userId}` : `client:${cid}`;

    const isThisTabLocal =
      (localClientId !== undefined && cid === localClientId) ||
      Boolean(localUserId && userId && localUserId === userId);

    // VIEWER cannot appear as editing. Inactivity threshold: 4 seconds.
    const tabIsEditing =
      u.role === 'VIEWER'
        ? false
        : Boolean(u.isEditing === true && (!u.lastActive || now - u.lastActive < 4000));

    const existing = groups.get(userKey);
    if (!existing) {
      groups.set(userKey, {
        primaryClientId: cid,
        clientIds: [cid],
        userId: userId || undefined,
        name: u.name || 'Collaborator',
        color: u.color || '#00667E',
        avatarUrl: u.avatarUrl || null,
        role: u.role,
        isEditing: tabIsEditing,
        lastActive: u.lastActive || now,
        isLocalUser: isThisTabLocal,
      });
    } else {
      existing.clientIds.push(cid);
      if (tabIsEditing) {
        existing.isEditing = true;
      }
      existing.lastActive = Math.max(existing.lastActive, u.lastActive || now);
      if (isThisTabLocal) {
        existing.isLocalUser = true;
      }
      // Upgrade placeholder name or avatar if available from another tab
      if (
        (!existing.name || existing.name === 'Collaborator' || existing.name === 'Anonymous') &&
        u.name &&
        u.name !== 'Collaborator'
      ) {
        existing.name = u.name;
      }
      if (!existing.avatarUrl && u.avatarUrl) {
        existing.avatarUrl = u.avatarUrl;
      }
      if (!existing.role && u.role) {
        existing.role = u.role;
      }
    }
  });

  const allParticipants: DocumentCollaborator[] = [];
  const remoteCollaborators: DocumentCollaborator[] = [];
  let currentUserTabs = 1;

  groups.forEach((g) => {
    const participant: DocumentCollaborator = {
      clientId: g.primaryClientId,
      clientIds: g.clientIds,
      userId: g.userId,
      name: g.name,
      color: g.color,
      avatarUrl: g.avatarUrl,
      role: g.role,
      tabCount: g.clientIds.length,
      isEditing: g.isEditing,
      lastActive: g.lastActive,
    };

    allParticipants.push(participant);

    if (g.isLocalUser) {
      currentUserTabs = g.clientIds.length;
    } else {
      remoteCollaborators.push(participant);
    }
  });

  return {
    collaborators: remoteCollaborators,
    allParticipants,
    currentUserTabs,
  };
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
  const [allParticipants, setAllParticipants] = useState<DocumentCollaborator[]>([]);
  const [currentUserTabs, setCurrentUserTabs] = useState<number>(1);
  const [isLocalEditing, setIsLocalEditing] = useState<boolean>(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const blocksArrayRef = useRef<Y.Array<any> | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const awarenessThrottleRef = useRef<number>(0);
  const editingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

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
        name: userRef.current?.name || 'Collaborator',
        color: userRef.current?.color || '#00667E',
        userId: userRef.current?.id,
        avatarUrl: userRef.current?.avatarUrl || null,
        role: userRef.current?.role,
        isEditing: false,
        currentDocId: documentId,
        lastActive: Date.now(),
      });

      const handleAwarenessChange = () => {
        const now = Date.now();
        if (now - awarenessThrottleRef.current < 40) return; // Throttled updates to prevent high-frequency re-renders
        awarenessThrottleRef.current = now;

        const states = awareness.getStates();
        const localClientId = doc.clientID;
        const currentUserId = userRef.current?.id;

        const { collaborators: remoteCollabs, allParticipants: allParts, currentUserTabs: userTabs } =
          deduplicateAwarenessStates(states, localClientId, currentUserId);

        setCollaborators(remoteCollabs);
        setAllParticipants(allParts);
        setCurrentUserTabs(userTabs);
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
      if (editingTimeoutRef.current) {
        clearTimeout(editingTimeoutRef.current);
        editingTimeoutRef.current = null;
      }
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

  // Rehydrate awareness user metadata whenever authenticated user or role updates
  useEffect(() => {
    userRef.current = user;
    const provider = providerRef.current;
    if (!provider) return;

    const awareness = provider.awareness;
    const currentLocal = awareness.getLocalState()?.user || {};

    const isViewer = user?.role === 'VIEWER';
    const isEditing = isViewer ? false : Boolean(currentLocal.isEditing);

    awareness.setLocalStateField('user', {
      ...currentLocal,
      userId: user?.id,
      name: user?.name || currentLocal.name || 'Collaborator',
      color: user?.color || currentLocal.color || '#00667E',
      avatarUrl: user?.avatarUrl !== undefined ? user.avatarUrl : currentLocal.avatarUrl,
      role: user?.role !== undefined ? user.role : currentLocal.role,
      currentDocId: documentId,
      isEditing,
      lastActive: Date.now(),
    });

    const states = awareness.getStates();
    const localClientId = ydocRef.current?.clientID;
    const { collaborators: remoteCollabs, allParticipants: allParts, currentUserTabs: userTabs } =
      deduplicateAwarenessStates(states, localClientId, user?.id);

    setCollaborators(remoteCollabs);
    setAllParticipants(allParts);
    setCurrentUserTabs(userTabs);
  }, [user?.id, user?.name, user?.avatarUrl, user?.role, user?.color, documentId]);

  // Editing activity broadcaster with 3.5-second auto-timeout
  const markEditing = useCallback(() => {
    // VIEWER cannot appear as editing or broadcast editing activity
    if (userRef.current?.role === 'VIEWER') return;

    const provider = providerRef.current;
    if (!provider) return;

    const awareness = provider.awareness;
    const current = awareness.getLocalState()?.user;
    if (!current) return;

    setIsLocalEditing(true);
    awareness.setLocalStateField('user', {
      ...current,
      isEditing: true,
      lastActive: Date.now(),
    });

    if (editingTimeoutRef.current) {
      clearTimeout(editingTimeoutRef.current);
    }

    editingTimeoutRef.current = setTimeout(() => {
      const activeProvider = providerRef.current;
      if (!activeProvider) return;
      const activeAwareness = activeProvider.awareness;
      const curr = activeAwareness.getLocalState()?.user;
      if (curr) {
        activeAwareness.setLocalStateField('user', {
          ...curr,
          isEditing: false,
          lastActive: Date.now(),
        });
      }
      setIsLocalEditing(false);
      editingTimeoutRef.current = null;
    }, 3500);
  }, []);

  // Update a block in Y.Doc with granular property mutations (no delete-reinsert)
  const updateBlock = useCallback(
    (
      id: string,
      updates: Partial<DocumentBlock> | string,
      extra?: Partial<DocumentBlock>
    ) => {
      markEditing();
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
    [markEditing]
  );

  // Add a new block in Y.Doc (at end or after a specific block)
  const addBlock = useCallback(
    (
      typeOrBlock?: BlockType | Partial<DocumentBlock>,
      afterId?: string
    ): string => {
      markEditing();
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
    [markEditing]
  );

  // Delete a block from Y.Doc (resets to single empty block if all deleted)
  const deleteBlock = useCallback((id: string) => {
    markEditing();
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
  }, [markEditing]);

  // Toggle checklist checkbox in Y.Doc
  const toggleChecklist = useCallback((id: string) => {
    markEditing();
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
  }, [markEditing]);

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
    allParticipants,
    currentUserTabs,
    isLocalEditing,
    markEditing,
  };
}

export default useDocumentYjs;
