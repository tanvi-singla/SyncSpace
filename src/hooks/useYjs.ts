import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { CanvasElement, UserPresence, ConnectionStatus, ActiveTool } from '../types/canvas';
import { getRandomUserName, getRandomUserColor, generateId } from '../utils/constants';
import { getWsUrl } from '../lib/yjs/config';
import { getCanvasRoomName } from '../lib/yjs/rooms';

interface UseYjsOptions {
  roomId: string;
  wsUrl?: string;
}

const INITIAL_WELCOME_NOTES: CanvasElement[] = [
  {
    id: 'welcome_1',
    type: 'sticky',
    x: 320,
    y: 180,
    width: 260,
    height: 220,
    rotation: -1.2,
    color: 'sunflower',
    hasTape: true,
    title: '🌾 Welcome to Studio',
    text: 'A tactile, local-first CRDT canvas built with Yjs & IndexedDB.\n\n✨ Offline-first & instant\n✨ Multi-room real-time sync\n✨ Washi tape & physical craft feel',
    authorName: 'Master Binder',
    authorColor: '#EAB308',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
    zIndex: 1,
  },
  {
    id: 'welcome_2',
    type: 'stamp',
    x: 620,
    y: 190,
    width: 180,
    height: 90,
    rotation: 4.5,
    color: 'coral',
    stampType: 'APPROVED',
    createdAt: Date.now() - 3000000,
    updatedAt: Date.now() - 3000000,
    zIndex: 2,
  },
  {
    id: 'welcome_3',
    type: 'card',
    x: 620,
    y: 310,
    width: 320,
    height: 240,
    rotation: 0.8,
    color: 'cream',
    hasStaple: true,
    title: '📋 Craft Guidelines',
    text: '• Space + Drag to Pan canvas\n• Scroll wheel to Zoom (10% - 300%)\n• Click "+ Note" or "+ Card" to create\n• Open this URL in another tab to test live peer syncing!',
    authorName: 'Draftsperson',
    authorColor: '#52796F',
    createdAt: Date.now() - 2500000,
    updatedAt: Date.now() - 2500000,
    zIndex: 3,
  },
  {
    id: 'welcome_4',
    type: 'sticky',
    x: 320,
    y: 430,
    width: 260,
    height: 190,
    rotation: 1.8,
    color: 'sage',
    hasTape: true,
    title: '🌿 Risograph Inks',
    text: 'Click any note to switch ink swatches, toggle washi tape, or stamp approvals across your studio board.',
    authorName: 'Print Maker',
    authorColor: '#52796F',
    createdAt: Date.now() - 1500000,
    updatedAt: Date.now() - 1500000,
    zIndex: 4,
  }
];

export function useYjs({ roomId, wsUrl }: UseYjsOptions) {
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [isIndexedDbSynced, setIsIndexedDbSynced] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<UserPresence[]>([]);
  
  // Local user profile state
  const [currentUser, setCurrentUser] = useState(() => {
    const savedName = localStorage.getItem('paper_user_name');
    const savedColor = localStorage.getItem('paper_user_color');
    return {
      name: savedName || getRandomUserName(),
      color: savedColor || getRandomUserColor(),
    };
  });

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const elementsMapRef = useRef<Y.Map<CanvasElement> | null>(null);
  const lastCursorUpdateRef = useRef<number>(0);

  const resolvedWsUrl = wsUrl || getWsUrl();

  // Sync current user to localStorage
  useEffect(() => {
    localStorage.setItem('paper_user_name', currentUser.name);
    localStorage.setItem('paper_user_color', currentUser.color);
  }, [currentUser]);

  // Initialize Y.Doc, IndexedDB, and WebSocket provider for roomId
  useEffect(() => {
    const docName = getCanvasRoomName(roomId);
    const doc = new Y.Doc();
    ydocRef.current = doc;

    // 1. IndexedDB Persistence (Local-First Offline storage)
    const idbProvider = new IndexeddbPersistence(docName, doc);
    idbRef.current = idbProvider;

    const elementsMap = doc.getMap<CanvasElement>('canvas-elements');
    elementsMapRef.current = elementsMap;

    const updateReactElements = () => {
      const arr = Array.from(elementsMap.values());
      // Sort by zIndex or createdAt
      arr.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
      setElements(arr);
    };

    idbProvider.on('synced', () => {
      setIsIndexedDbSynced(true);
      // If doc is completely new/empty after loading from IndexedDB, populate starter notes
      if (elementsMap.size === 0) {
        doc.transact(() => {
          INITIAL_WELCOME_NOTES.forEach(note => {
            elementsMap.set(note.id, note);
          });
        });
      }
      updateReactElements();
    });

    // 2. WebSocket Provider (Graceful offline fallback)
    let wsProvider: WebsocketProvider | null = null;
    let cleanupAwareness: (() => void) | undefined;

    try {
      wsProvider = new WebsocketProvider(resolvedWsUrl, docName, doc, { connect: true });
      providerRef.current = wsProvider;

      wsProvider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        setConnectionStatus(event.status);
      });

      wsProvider.on('connection-error', () => {
        setConnectionStatus('disconnected');
      });

      // Awareness for Multiplayer Presence
      const awareness = wsProvider.awareness;
      awareness.setLocalStateField('user', {
        name: currentUser.name,
        color: currentUser.color,
        cursor: null,
        activeElementId: null,
        lastActive: Date.now(),
      });

      const handleAwarenessChange = () => {
        const states = awareness.getStates();
        const users: UserPresence[] = [];
        const localClientId = doc.clientID;

        states.forEach((state, clientId) => {
          if (clientId !== localClientId && state.user) {
            users.push({
              clientId,
              name: state.user.name || 'Anonymous Artisan',
              color: state.user.color || '#E05A47',
              cursor: state.user.cursor || null,
              activeElementId: state.user.activeElementId || null,
              lastActive: state.user.lastActive || Date.now(),
              tool: state.user.tool || 'select',
            });
          }
        });
        setRemoteUsers(users);
      };

      awareness.on('change', handleAwarenessChange);
      cleanupAwareness = () => {
        awareness.off('change', handleAwarenessChange);
        awareness.setLocalState(null);
      };
    } catch (e) {
      console.warn('WebSocket connection fallback to local-only mode:', e);
      setConnectionStatus('disconnected');
    }

    // Observe changes to shared elementsMap
    const handleMapChange = () => {
      updateReactElements();
    };
    elementsMap.observe(handleMapChange);

    // Initial state read
    updateReactElements();

    return () => {
      elementsMap.unobserve(handleMapChange);
      cleanupAwareness?.();
      if (wsProvider) {
        wsProvider.destroy();
      }
      idbProvider.destroy();
      doc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      idbRef.current = null;
      elementsMapRef.current = null;
    };
  }, [roomId, resolvedWsUrl]);

  // Update awareness when local user profile changes
  useEffect(() => {
    if (providerRef.current?.awareness) {
      providerRef.current.awareness.setLocalStateField('user', {
        name: currentUser.name,
        color: currentUser.color,
      });
    }
  }, [currentUser]);

  // Broadcast mouse cursor coordinates over Yjs Awareness (throttled)
  const broadcastCursor = useCallback((cursor: { x: number; y: number } | null, activeTool?: ActiveTool) => {
    const now = Date.now();
    if (now - lastCursorUpdateRef.current < 25 && cursor !== null) {
      return; // 40fps rate limiting for smooth network transport
    }
    lastCursorUpdateRef.current = now;

    if (providerRef.current?.awareness) {
      const current = providerRef.current.awareness.getLocalState()?.user || {};
      providerRef.current.awareness.setLocalStateField('user', {
        ...current,
        cursor,
        tool: activeTool || current.tool,
        lastActive: now,
      });
    }
  }, []);

  // Set active element in awareness
  const broadcastActiveElement = useCallback((activeElementId: string | null) => {
    if (providerRef.current?.awareness) {
      const current = providerRef.current.awareness.getLocalState()?.user || {};
      providerRef.current.awareness.setLocalStateField('user', {
        ...current,
        activeElementId,
      });
    }
  }, []);

  // CRUD Methods for Elements
  const addElement = useCallback((element: Omit<CanvasElement, 'id' | 'createdAt' | 'updatedAt' | 'zIndex'> & Partial<Pick<CanvasElement, 'id' | 'zIndex'>>) => {
    if (!elementsMapRef.current || !ydocRef.current) return '';

    const newId = element.id || generateId();
    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);
    
    const newElement: CanvasElement = {
      ...element,
      id: newId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      zIndex: (element.zIndex !== undefined ? element.zIndex : maxZ + 1),
    };

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(newId, newElement);
    });

    return newId;
  }, [elements]);

  const updateElement = useCallback((id: string, updates: Partial<CanvasElement>) => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    
    const existing = elementsMapRef.current.get(id);
    if (!existing) return;

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(id, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      });
    });
  }, []);

  const deleteElement = useCallback((id: string) => {
    if (!elementsMapRef.current || !ydocRef.current) return;

    ydocRef.current.transact(() => {
      elementsMapRef.current?.delete(id);
    });
  }, []);

  const clearCanvas = useCallback(() => {
    if (!elementsMapRef.current || !ydocRef.current) return;

    ydocRef.current.transact(() => {
      const keys = Array.from(elementsMapRef.current!.keys());
      keys.forEach((key) => {
        elementsMapRef.current?.delete(key);
      });
    });
  }, []);

  const bringToFront = useCallback((id: string) => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    const existing = elementsMapRef.current.get(id);
    if (!existing) return;

    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);
    if (existing.zIndex === maxZ) return;

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(id, {
        ...existing,
        zIndex: maxZ + 1,
        updatedAt: Date.now(),
      });
    });
  }, [elements]);

  const duplicateElement = useCallback((id: string) => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    const existing = elementsMapRef.current.get(id);
    if (!existing) return;

    const newId = generateId();
    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);

    const cloned: CanvasElement = {
      ...existing,
      id: newId,
      x: existing.x + 24,
      y: existing.y + 24,
      rotation: (Math.random() * 4 - 2), // random subtle angle
      zIndex: maxZ + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(newId, cloned);
    });
  }, [elements]);

  return {
    elements,
    connectionStatus,
    isIndexedDbSynced,
    remoteUsers,
    currentUser,
    setCurrentUser,
    broadcastCursor,
    broadcastActiveElement,
    addElement,
    updateElement,
    deleteElement,
    clearCanvas,
    bringToFront,
    duplicateElement,
    clientId: ydocRef.current?.clientID,
  };
}

export default useYjs;
