import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { 
  CanvasElement, 
  UserPresence, 
  ConnectionStatus, 
  ActiveTool, 
  Point,
  ViewportState,
  PaperColor
} from '../../types/canvas';
import { 
  CANVAS_PALETTES, 
  INITIAL_DEMO_CANVAS_ITEMS 
} from '../../utils/canvasConstants';
import { 
  getShapeAnchorPoint, 
  getClosestAnchorSide, 
  calculateElementsBounds,
  transformConnectorPoints,
} from '../../utils/canvasGeometry';
import { getWsUrl } from '../../lib/yjs/config';
import { getCanvasRoomName, isCanvasRoomRestored } from '../../lib/yjs/rooms';

interface UseCanvasEngineOptions {
  roomId: string;
  wsUrl?: string;
  currentUserName?: string;
  currentUserColor?: string;
}

function generateUniqueId(prefix = 'elem'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
}

export function useCanvasEngine({
  roomId,
  wsUrl,
  currentUserName = 'Tanvi',
  currentUserColor = '#00667E',
}: UseCanvasEngineOptions) {
  const resolvedWsUrl = wsUrl || getWsUrl();
  // Elements state
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [viewport, setViewport] = useState<ViewportState>({ x: 0, y: 0, zoom: 1 });
  
  // Connection & Sync state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'synced'>('synced');
  const [indexedDbSyncedRoom, setIndexedDbSyncedRoom] = useState<string | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<UserPresence[]>([]);

  // History state for Undo / Redo
  const [undoStack, setUndoStack] = useState<CanvasElement[][]>([]);
  const [redoStack, setRedoStack] = useState<CanvasElement[][]>([]);
  const isPerformingHistoryActionRef = useRef(false);

  // Clipboard state
  const clipboardRef = useRef<CanvasElement[]>([]);

  // Yjs references
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const elementsMapRef = useRef<Y.Map<CanvasElement> | null>(null);
  const lastCursorBroadcastRef = useRef<number>(0);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSavedSoon = useCallback(() => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => {
      setSaveStatus('synced');
      saveStatusTimerRef.current = null;
    }, 300);
  }, []);

  const isIndexedDbSynced = isCanvasRoomRestored(roomId || 'default', indexedDbSyncedRoom);

  useLayoutEffect(() => {
    setIndexedDbSyncedRoom(null);
  }, [roomId]);

  // Helper to record an undo snapshot before mutating
  const pushHistorySnapshot = useCallback((currentList: CanvasElement[]) => {
    if (isPerformingHistoryActionRef.current) return;
    setUndoStack((prev) => [...prev.slice(-30), JSON.parse(JSON.stringify(currentList))]);
    setRedoStack([]); // Clear redo stack on new action
  }, []);

  const recordHistorySnapshot = useCallback(() => {
    pushHistorySnapshot(elements);
  }, [elements, pushHistorySnapshot]);

  // Selection, viewport and history belong to the active room. Reset them when
  // navigating between documents so the previous canvas cannot leak UI state.
  useEffect(() => {
    setElements([]);
    setSelectedIds([]);
    setUndoStack([]);
    setRedoStack([]);
    setViewport({ x: 0, y: 0, zoom: 1 });
  }, [roomId]);

  // Initialize Y.Doc, IndexedDB, WebSocket
  useEffect(() => {
    // The PostgreSQL document UUID is the only room identifier. Using the same
    // name for IndexedDB and the relay means an offline document resumes into
    // exactly the room it later synchronizes with.
    const docName = getCanvasRoomName(roomId || 'default');
    const doc = new Y.Doc();
    ydocRef.current = doc;

    // 1. IndexedDB Persistence
    const idbProvider = new IndexeddbPersistence(docName, doc);
    idbRef.current = idbProvider;

    const elementsMap = doc.getMap<CanvasElement>('canvas-elements');
    elementsMapRef.current = elementsMap;

    const syncElementsFromYjs = () => {
      const arr = Array.from(elementsMap.values()).filter(Boolean);
      arr.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
      setElements(arr);
    };

    let indexedDbReady = false;
    let websocketSynced = false;
    let websocketStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';
    let initialContentSeeded = false;

    // Do not seed while a remote document may still be arriving: doing so would
    // accidentally add the demo items to an existing collaborator's canvas.
    const seedInitialContentIfNeeded = () => {
      if (!indexedDbReady || initialContentSeeded || elementsMap.size !== 0) return;
      if (!websocketSynced && websocketStatus !== 'disconnected') return;
      initialContentSeeded = true;
      doc.transact(() => {
        INITIAL_DEMO_CANVAS_ITEMS.forEach((item) => {
          elementsMap.set(item.id, item);
        });
      });
    };

    const handleIndexedDbSynced = () => {
      indexedDbReady = true;
      setIndexedDbSyncedRoom(docName);
      setSaveStatus('synced');
      seedInitialContentIfNeeded();
      syncElementsFromYjs();
    };
    idbProvider.on('synced', handleIndexedDbSynced);

    // This observer is independent of transport availability, so canvas edits
    // still render immediately when the relay is offline.
    const handleElementsChange = () => syncElementsFromYjs();
    elementsMap.observe(handleElementsChange);

    // 2. WebSocket Multiplayer
    let wsProvider: WebsocketProvider | null = null;
    let cleanupAwareness: (() => void) | undefined;
    try {
      wsProvider = new WebsocketProvider(resolvedWsUrl, docName, doc, { connect: true });
      providerRef.current = wsProvider;

      wsProvider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        websocketStatus = event.status;
        setConnectionStatus(event.status);
        if (event.status === 'connected') setSaveStatus('synced');
        else if (event.status === 'connecting') setSaveStatus('saving');
        else {
          setSaveStatus('saved');
          seedInitialContentIfNeeded();
        }
      });

      wsProvider.on('sync', (isSynced: boolean) => {
        websocketSynced = isSynced;
        if (isSynced) seedInitialContentIfNeeded();
      });

      wsProvider.on('connection-error', () => {
        // The provider retries with backoff; IndexedDB remains fully usable.
        websocketStatus = 'disconnected';
        setConnectionStatus('disconnected');
        setSaveStatus('saved');
        seedInitialContentIfNeeded();
      });

      const awareness = wsProvider.awareness;
      awareness.setLocalStateField('user', {
        name: currentUserName,
        color: currentUserColor,
        cursor: null,
        selectedIds: [],
        lastActive: Date.now(),
        tool: 'select',
      });

      const handleAwarenessChange = () => {
        const states = awareness.getStates();
        const users: UserPresence[] = [];
        const localClientId = doc.clientID;

        states.forEach((state, clientId) => {
          if (clientId !== localClientId && state.user) {
            users.push({
              clientId,
              name: state.user.name || 'Collaborator',
              color: state.user.color || '#00667E',
              cursor: state.user.cursor || null,
              selectedIds: state.user.selectedIds || [],
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
      };
    } catch (e) {
      console.warn('WebSocket connection fallback to local-only IndexedDB mode:', e);
      websocketStatus = 'disconnected';
      setConnectionStatus('disconnected');
      seedInitialContentIfNeeded();
    }

    syncElementsFromYjs();

    return () => {
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
      elementsMap.unobserve(handleElementsChange);
      idbProvider.off('synced', handleIndexedDbSynced);
      cleanupAwareness?.();
      if (wsProvider) {
        wsProvider.awareness.setLocalState(null);
      }
      if (wsProvider) wsProvider.destroy();
      idbProvider.destroy();
      doc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      idbRef.current = null;
      elementsMapRef.current = null;
    };
  }, [roomId, wsUrl, currentUserName, currentUserColor]);

  // Broadcast cursor to peers
  const broadcastCursor = useCallback((cursor: Point | null, tool?: ActiveTool) => {
    const now = Date.now();
    if (now - lastCursorBroadcastRef.current < 30 && cursor !== null) return;
    lastCursorBroadcastRef.current = now;

    if (providerRef.current?.awareness) {
      const current = providerRef.current.awareness.getLocalState()?.user || {};
      providerRef.current.awareness.setLocalStateField('user', {
        ...current,
        cursor,
        tool: tool || activeTool,
        lastActive: now,
      });
    }
  }, [activeTool]);

  // Broadcast selection
  useEffect(() => {
    if (providerRef.current?.awareness) {
      const current = providerRef.current.awareness.getLocalState()?.user || {};
      providerRef.current.awareness.setLocalStateField('user', {
        ...current,
        selectedIds,
      });
    }
  }, [selectedIds]);

  // ==========================================
  // ELEMENT CRUD & MANIPULATION METHODS
  // ==========================================

  // Add Element
  const addElement = useCallback((newElemData: Partial<CanvasElement>): string => {
    if (!elementsMapRef.current || !ydocRef.current) return '';
    pushHistorySnapshot(elements);
    setSaveStatus('saving');

    const newId = newElemData.id || generateUniqueId(newElemData.type || 'shape');
    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);

    const completeElement: CanvasElement = {
      id: newId,
      type: newElemData.type || 'rectangle',
      x: newElemData.x ?? 200,
      y: newElemData.y ?? 200,
      width: newElemData.width ?? 160,
      height: newElemData.height ?? 100,
      zIndex: newElemData.zIndex ?? maxZ + 1,
      fillColor: newElemData.fillColor ?? '#FFFFFF',
      strokeColor: newElemData.strokeColor ?? '#1F2937',
      strokeWidth: newElemData.strokeWidth ?? 2,
      strokeStyle: newElemData.strokeStyle ?? 'solid',
      opacity: newElemData.opacity ?? 1,
      fontSize: newElemData.fontSize ?? 14,
      fontFamily: newElemData.fontFamily ?? 'sans',
      fontWeight: newElemData.fontWeight ?? 'normal',
      textAlign: newElemData.textAlign ?? 'center',
      textColor: newElemData.textColor ?? '#1F2937',
      rotation: newElemData.rotation ?? 0,
      color: (newElemData.color as PaperColor) || 'sunflower',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...newElemData,
    };

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(newId, completeElement);
    });

    markSavedSoon();
    return newId;
  }, [elements, pushHistorySnapshot, markSavedSoon]);

  // Update Single Element
  const updateElement = useCallback((id: string, updates: Partial<CanvasElement>, recordHistory = true) => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    if (recordHistory) pushHistorySnapshot(elements);
    setSaveStatus('saving');

    const existing = elementsMapRef.current.get(id);
    if (!existing) return;

    const updated = {
      ...existing,
      ...updates,
      ...((existing.type === 'line' || existing.type === 'arrow') && !existing.startBinding && !existing.endBinding &&
        (updates.x !== undefined || updates.y !== undefined || updates.width !== undefined || updates.height !== undefined)
        ? transformConnectorPoints(existing, updates)
        : {}),
      updatedAt: Date.now(),
    };

    ydocRef.current.transact(() => {
      elementsMapRef.current?.set(id, updated);
      
      // Auto-update connected arrows if shape was moved/resized
      if (updates.x !== undefined || updates.y !== undefined || updates.width !== undefined || updates.height !== undefined) {
        elements.forEach((el) => {
          if (el.type === 'arrow' || el.type === 'line') {
            const isStartBound = el.startBinding?.elementId === id;
            const isEndBound = el.endBinding?.elementId === id;
            if (isStartBound || isEndBound) {
              const startPt = isStartBound 
                ? getShapeAnchorPoint(updated, el.startBinding?.side || 'right') 
                : (el.startPoint || { x: el.x, y: el.y });
              const endPt = isEndBound 
                ? getShapeAnchorPoint(updated, el.endBinding?.side || 'left') 
                : (el.endPoint || { x: el.x + el.width, y: el.y + el.height });
              
              elementsMapRef.current?.set(el.id, {
                ...el,
                startPoint: startPt,
                endPoint: endPt,
                x: Math.min(startPt.x, endPt.x),
                y: Math.min(startPt.y, endPt.y),
                width: Math.abs(endPt.x - startPt.x),
                height: Math.abs(endPt.y - startPt.y),
                updatedAt: Date.now(),
              });
            }
          }
        });
      }
    });

    markSavedSoon();
  }, [elements, pushHistorySnapshot, markSavedSoon]);

  // Update Multiple Elements Simultaneously
  const updateElements = useCallback((updatesMap: Record<string, Partial<CanvasElement>>, recordHistory = true) => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    if (recordHistory) pushHistorySnapshot(elements);
    setSaveStatus('saving');

    ydocRef.current.transact(() => {
      const updatedElementsRecord: Record<string, CanvasElement> = {};

      Object.entries(updatesMap).forEach(([id, updates]) => {
        const existing = elementsMapRef.current?.get(id);
        if (existing) {
          const updated = {
            ...existing,
            ...updates,
            ...((existing.type === 'line' || existing.type === 'arrow') && !existing.startBinding && !existing.endBinding &&
              (updates.x !== undefined || updates.y !== undefined || updates.width !== undefined || updates.height !== undefined)
              ? transformConnectorPoints(existing, updates)
              : {}),
            updatedAt: Date.now(),
          };
          elementsMapRef.current?.set(id, updated);
          updatedElementsRecord[id] = updated;
        }
      });

      // Update any connectors connected to moved items
      elements.forEach((el) => {
        if ((el.type === 'arrow' || el.type === 'line') && !updatesMap[el.id]) {
          const startBoundId = el.startBinding?.elementId;
          const endBoundId = el.endBinding?.elementId;
          const startMoved = startBoundId && updatedElementsRecord[startBoundId];
          const endMoved = endBoundId && updatedElementsRecord[endBoundId];

          if (startMoved || endMoved) {
            const startShape = startMoved || elements.find((item) => item.id === startBoundId);
            const endShape = endMoved || elements.find((item) => item.id === endBoundId);

            const startPt = startShape 
              ? getShapeAnchorPoint(startShape, el.startBinding?.side || 'right') 
              : (el.startPoint || { x: el.x, y: el.y });
            const endPt = endShape 
              ? getShapeAnchorPoint(endShape, el.endBinding?.side || 'left') 
              : (el.endPoint || { x: el.x + el.width, y: el.y + el.height });

            elementsMapRef.current?.set(el.id, {
              ...el,
              startPoint: startPt,
              endPoint: endPt,
              x: Math.min(startPt.x, endPt.x),
              y: Math.min(startPt.y, endPt.y),
              width: Math.abs(endPt.x - startPt.x),
              height: Math.abs(endPt.y - startPt.y),
              updatedAt: Date.now(),
            });
          }
        }
      });
    });

    markSavedSoon();
  }, [elements, pushHistorySnapshot, markSavedSoon]);

  // Delete Elements
  const deleteElements = useCallback((ids: string[]) => {
    if (!elementsMapRef.current || !ydocRef.current || ids.length === 0) return;
    pushHistorySnapshot(elements);
    setSaveStatus('saving');

    const idSet = new Set(ids);

    ydocRef.current.transact(() => {
      ids.forEach((id) => {
        elementsMapRef.current?.delete(id);
      });

      // Clean up connector bindings attached to deleted elements
      elements.forEach((el) => {
        if (el.type === 'arrow' || el.type === 'line') {
          let updated = false;
          let newStartBinding = el.startBinding;
          let newEndBinding = el.endBinding;

          if (el.startBinding && idSet.has(el.startBinding.elementId)) {
            newStartBinding = undefined;
            updated = true;
          }
          if (el.endBinding && idSet.has(el.endBinding.elementId)) {
            newEndBinding = undefined;
            updated = true;
          }

          if (updated && !idSet.has(el.id)) {
            elementsMapRef.current?.set(el.id, {
              ...el,
              startBinding: newStartBinding,
              endBinding: newEndBinding,
              updatedAt: Date.now(),
            });
          }
        }
      });
    });

    setSelectedIds((prev) => prev.filter((id) => !idSet.has(id)));
    markSavedSoon();
  }, [elements, pushHistorySnapshot, markSavedSoon]);

  // Duplicate Elements
  const duplicateElements = useCallback((ids: string[]) => {
    if (!elementsMapRef.current || !ydocRef.current || ids.length === 0) return;
    pushHistorySnapshot(elements);
    setSaveStatus('saving');

    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);
    const newSelectedIds: string[] = [];
    const idMap: Record<string, string> = {};

    // Map old IDs to new IDs
    ids.forEach((id) => {
      idMap[id] = generateUniqueId('dup');
      newSelectedIds.push(idMap[id]);
    });

    ydocRef.current.transact(() => {
      ids.forEach((id, idx) => {
        const original = elements.find((el) => el.id === id);
        if (!original) return;

        const newId = idMap[id];
        const cloned: CanvasElement = {
          ...JSON.parse(JSON.stringify(original)),
          id: newId,
          x: original.x + 24,
          y: original.y + 24,
          zIndex: maxZ + idx + 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (cloned.startPoint) cloned.startPoint = { x: cloned.startPoint.x + 24, y: cloned.startPoint.y + 24 };
        if (cloned.endPoint) cloned.endPoint = { x: cloned.endPoint.x + 24, y: cloned.endPoint.y + 24 };

        // Rebind connectors if both connected endpoints are duplicated
        if (cloned.startBinding && idMap[cloned.startBinding.elementId]) {
          cloned.startBinding = { ...cloned.startBinding, elementId: idMap[cloned.startBinding.elementId] };
        }
        if (cloned.endBinding && idMap[cloned.endBinding.elementId]) {
          cloned.endBinding = { ...cloned.endBinding, elementId: idMap[cloned.endBinding.elementId] };
        }

        elementsMapRef.current?.set(newId, cloned);
      });
    });

    setSelectedIds(newSelectedIds);
    markSavedSoon();
  }, [elements, pushHistorySnapshot, markSavedSoon]);

  // Bring to Front
  const bringToFront = useCallback((ids: string[]) => {
    if (!elementsMapRef.current || !ydocRef.current || ids.length === 0) return;
    pushHistorySnapshot(elements);
    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);

    ydocRef.current.transact(() => {
      ids.forEach((id, idx) => {
        const el = elementsMapRef.current?.get(id);
        if (el) {
          elementsMapRef.current?.set(id, { ...el, zIndex: maxZ + idx + 1, updatedAt: Date.now() });
        }
      });
    });
  }, [elements, pushHistorySnapshot]);

  // Send to Back
  const sendToBack = useCallback((ids: string[]) => {
    if (!elementsMapRef.current || !ydocRef.current || ids.length === 0) return;
    pushHistorySnapshot(elements);
    const minZ = elements.reduce((min, el) => Math.min(min, el.zIndex || 0), 0);

    ydocRef.current.transact(() => {
      ids.forEach((id, idx) => {
        const el = elementsMapRef.current?.get(id);
        if (el) {
          elementsMapRef.current?.set(id, { ...el, zIndex: minZ - (ids.length - idx), updatedAt: Date.now() });
        }
      });
    });
  }, [elements, pushHistorySnapshot]);

  // Group Elements
  const groupElements = useCallback((ids: string[]) => {
    if (ids.length < 2) return;
    pushHistorySnapshot(elements);
    const newGroupId = generateUniqueId('group');

    ydocRef.current?.transact(() => {
      ids.forEach((id) => {
        const el = elementsMapRef.current?.get(id);
        if (el) {
          elementsMapRef.current?.set(id, { ...el, groupId: newGroupId, updatedAt: Date.now() });
        }
      });
    });
  }, [elements, pushHistorySnapshot]);

  // Ungroup Elements
  const ungroupElements = useCallback((ids: string[]) => {
    pushHistorySnapshot(elements);
    ydocRef.current?.transact(() => {
      ids.forEach((id) => {
        const el = elementsMapRef.current?.get(id);
        if (el && el.groupId) {
          const { groupId, ...rest } = el;
          elementsMapRef.current?.set(id, { ...rest, updatedAt: Date.now() });
        }
      });
    });
  }, [elements, pushHistorySnapshot]);

  // Alignment Actions
  const alignElements = useCallback((
    ids: string[], 
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v'
  ) => {
    if (ids.length < 2) return;
    const selectedElements = elements.filter((el) => ids.includes(el.id));
    const bounds = calculateElementsBounds(selectedElements);
    if (!bounds) return;

    pushHistorySnapshot(elements);
    const updates: Record<string, Partial<CanvasElement>> = {};

    if (alignment === 'left') {
      selectedElements.forEach((el) => {
        updates[el.id] = { x: bounds.minX };
      });
    } else if (alignment === 'center') {
      const midX = bounds.minX + bounds.width / 2;
      selectedElements.forEach((el) => {
        updates[el.id] = { x: midX - el.width / 2 };
      });
    } else if (alignment === 'right') {
      selectedElements.forEach((el) => {
        updates[el.id] = { x: bounds.maxX - el.width };
      });
    } else if (alignment === 'top') {
      selectedElements.forEach((el) => {
        updates[el.id] = { y: bounds.minY };
      });
    } else if (alignment === 'middle') {
      const midY = bounds.minY + bounds.height / 2;
      selectedElements.forEach((el) => {
        updates[el.id] = { y: midY - el.height / 2 };
      });
    } else if (alignment === 'bottom') {
      selectedElements.forEach((el) => {
        updates[el.id] = { y: bounds.maxY - el.height };
      });
    } else if (alignment === 'distribute-h') {
      const sorted = [...selectedElements].sort((a, b) => a.x - b.x);
      const totalElementsWidth = sorted.reduce((sum, el) => sum + el.width, 0);
      const availableSpace = bounds.width - totalElementsWidth;
      const gap = availableSpace / (sorted.length - 1);
      let currentX = bounds.minX;

      sorted.forEach((el) => {
        updates[el.id] = { x: currentX };
        currentX += el.width + gap;
      });
    } else if (alignment === 'distribute-v') {
      const sorted = [...selectedElements].sort((a, b) => a.y - b.y);
      const totalElementsHeight = sorted.reduce((sum, el) => sum + el.height, 0);
      const availableSpace = bounds.height - totalElementsHeight;
      const gap = availableSpace / (sorted.length - 1);
      let currentY = bounds.minY;

      sorted.forEach((el) => {
        updates[el.id] = { y: currentY };
        currentY += el.height + gap;
      });
    }

    updateElements(updates, false);
  }, [elements, pushHistorySnapshot, updateElements]);

  // Clear Canvas
  const clearCanvas = useCallback(() => {
    if (!elementsMapRef.current || !ydocRef.current) return;
    pushHistorySnapshot(elements);
    ydocRef.current.transact(() => {
      const keys = Array.from(elementsMapRef.current!.keys());
      keys.forEach((key) => {
        elementsMapRef.current?.delete(key);
      });
    });
    setSelectedIds([]);
  }, [elements, pushHistorySnapshot]);

  // ==========================================
  // UNDO & REDO
  // ==========================================

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !elementsMapRef.current || !ydocRef.current) return;
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, JSON.parse(JSON.stringify(elements))]);

    isPerformingHistoryActionRef.current = true;
    ydocRef.current.transact(() => {
      elementsMapRef.current?.clear();
      previousState.forEach((el) => {
        elementsMapRef.current?.set(el.id, el);
      });
    });
    isPerformingHistoryActionRef.current = false;
  }, [undoStack, elements]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !elementsMapRef.current || !ydocRef.current) return;
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, JSON.parse(JSON.stringify(elements))]);

    isPerformingHistoryActionRef.current = true;
    ydocRef.current.transact(() => {
      elementsMapRef.current?.clear();
      nextState.forEach((el) => {
        elementsMapRef.current?.set(el.id, el);
      });
    });
    isPerformingHistoryActionRef.current = false;
  }, [redoStack, elements]);

  // ==========================================
  // CLIPBOARD (Copy / Cut / Paste)
  // ==========================================

  const copySelected = useCallback(() => {
    const selected = elements.filter((el) => selectedIds.includes(el.id));
    if (selected.length > 0) {
      clipboardRef.current = JSON.parse(JSON.stringify(selected));
    }
  }, [elements, selectedIds]);

  const cutSelected = useCallback(() => {
    copySelected();
    deleteElements(selectedIds);
  }, [copySelected, deleteElements, selectedIds]);

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    pushHistorySnapshot(elements);

    const maxZ = elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);
    const newSelectedIds: string[] = [];
    const idMap: Record<string, string> = {};

    clipboardRef.current.forEach((el) => {
      idMap[el.id] = generateUniqueId('paste');
      newSelectedIds.push(idMap[el.id]);
    });

    ydocRef.current?.transact(() => {
      clipboardRef.current.forEach((original, idx) => {
        const newId = idMap[original.id];
        const pasted: CanvasElement = {
          ...JSON.parse(JSON.stringify(original)),
          id: newId,
          x: original.x + 28,
          y: original.y + 28,
          zIndex: maxZ + idx + 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (pasted.startPoint) pasted.startPoint = { x: pasted.startPoint.x + 28, y: pasted.startPoint.y + 28 };
        if (pasted.endPoint) pasted.endPoint = { x: pasted.endPoint.x + 28, y: pasted.endPoint.y + 28 };

        if (pasted.startBinding && idMap[pasted.startBinding.elementId]) {
          pasted.startBinding = { ...pasted.startBinding, elementId: idMap[pasted.startBinding.elementId] };
        }
        if (pasted.endBinding && idMap[pasted.endBinding.elementId]) {
          pasted.endBinding = { ...pasted.endBinding, elementId: idMap[pasted.endBinding.elementId] };
        }

        elementsMapRef.current?.set(newId, pasted);
      });
    });

    setSelectedIds(newSelectedIds);
  }, [elements, pushHistorySnapshot]);

  // ==========================================
  // EXPORTING HELPERS
  // ==========================================

  const exportAsJSON = useCallback((canvasTitle = 'syncspace-canvas') => {
    const dataStr = JSON.stringify(elements, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${canvasTitle.toLowerCase().replace(/\s+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [elements]);

  const importFromJSON = useCallback((jsonContent: string) => {
    try {
      const parsed = JSON.parse(jsonContent);
      if (Array.isArray(parsed)) {
        pushHistorySnapshot(elements);
        ydocRef.current?.transact(() => {
          elementsMapRef.current?.clear();
          parsed.forEach((item) => {
            if (item && item.id) {
              elementsMapRef.current?.set(item.id, item);
            }
          });
        });
      }
    } catch (e) {
      console.error('Failed to parse Canvas JSON file:', e);
    }
  }, [elements, pushHistorySnapshot]);

  return {
    // Canvas Data
    elements,
    selectedIds,
    setSelectedIds,
    activeTool,
    setActiveTool,
    viewport,
    setViewport,

    // Sync & Presence
    connectionStatus,
    saveStatus,
    isIndexedDbSynced,
    remoteUsers,
    broadcastCursor,

    // CRUD & Transforms
    addElement,
    updateElement,
    updateElements,
    recordHistorySnapshot,
    deleteElements,
    duplicateElements,
    bringToFront,
    sendToBack,
    groupElements,
    ungroupElements,
    alignElements,
    clearCanvas,

    // Undo / Redo
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,

    // Clipboard
    copySelected,
    cutSelected,
    pasteClipboard,

    // Export & Import
    exportAsJSON,
    importFromJSON,
  };
}
