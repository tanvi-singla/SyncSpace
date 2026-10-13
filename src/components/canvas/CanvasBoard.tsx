import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useAuth } from '../../auth/AuthContext';
import { 
  CanvasElement, 
  ActiveTool, 
  Point, 
  ViewportState, 
  PaperColor 
} from '../../types/canvas';
import { useCanvasEngine } from './useCanvasEngine';
import { CanvasTopBar } from './CanvasTopBar';
import { CanvasLeftToolbar } from './CanvasLeftToolbar';
import { CanvasPropertiesPanel } from './CanvasPropertiesPanel';
import { CanvasLayersPanel } from './CanvasLayersPanel';
import { CanvasContextMenu } from './CanvasContextMenu';
import { CanvasMinimap } from './CanvasMinimap';
import { CanvasShortcutsModal } from './CanvasShortcutsModal';
import { 
  ShapeRenderer, 
  StickyNoteRenderer, 
  TextRenderer, 
  ImageRenderer, 
  FreehandRenderer, 
  ConnectorRenderer, 
  SelectionBox, 
  RemoteMultiplayerCursor 
} from './CanvasShapeRenderers';
import { 
  calculateElementsBounds, 
  getClosestAnchorSide, 
  getShapeAnchorPoint,
  doRectsIntersect,
  isPointNearCanvasElement,
} from '../../utils/canvasGeometry';

type CanvasBoardProps = {
  workspaceState: ReturnType<typeof useWorkspace>;
};

export function CanvasBoard({ workspaceState }: CanvasBoardProps) {
  const { currentDocId, documents, updateDocumentTitle } = workspaceState;
  const { user } = useAuth();

  const currentDocMeta = currentDocId ? documents[currentDocId] : undefined;
  const isOwner = !currentDocMeta?.isShared && (!currentDocMeta?.permission || currentDocMeta?.permission === 'OWNER');
  const docTitle = currentDocMeta ? currentDocMeta.title : 'Architecture Whiteboard';

  // Canvas State Engine

  const engine = useCanvasEngine({
    roomId: currentDocId || 'main',
    currentUserName: user?.name || 'Tanvi',
    currentUserColor: '#00667E',
  });

  const {
    elements,
    selectedIds,
    setSelectedIds,
    activeTool,
    setActiveTool,
    viewport,
    setViewport,
    saveStatus,
    isIndexedDbSynced,
    remoteUsers,
    broadcastCursor,
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
    undo,
    redo,
    canUndo,
    canRedo,
    copySelected,
    cutSelected,
    pasteClipboard,
    exportAsJSON,
    importFromJSON,
  } = engine;

  // UI state
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);

  // Context menu state
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; viewX: number; viewY: number }>({ x: 0, y: 0, viewX: 0, viewY: 0 });
  const isSpacePressedRef = useRef(false);

  // Dragging / Resizing / Creating element state
  const [isDrafting, setIsDrafting] = useState(false);
  const draftShapeRef = useRef<{
    id?: string;
    tool: ActiveTool;
    startX: number;
    startY: number;
    startPoint?: Point;
    points?: Point[];
    startBinding?: { elementId: string; side?: any };
  } | null>(null);

  // Moving elements state
  const isDraggingElementsRef = useRef(false);
  const dragStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragPointerStartRef = useRef<Point>({ x: 0, y: 0 });
  const pendingGeometryUpdatesRef = useRef<Record<string, Partial<CanvasElement>> | null>(null);
  const geometryUpdateFrameRef = useRef<number | null>(null);

  const scheduleGeometryUpdate = (updates: Record<string, Partial<CanvasElement>>) => {
    pendingGeometryUpdatesRef.current = updates;
    if (geometryUpdateFrameRef.current !== null) return;
    geometryUpdateFrameRef.current = window.requestAnimationFrame(() => {
      geometryUpdateFrameRef.current = null;
      const pending = pendingGeometryUpdatesRef.current;
      pendingGeometryUpdatesRef.current = null;
      if (pending) updateElements(pending, false);
    });
  };

  const flushGeometryUpdate = () => {
    if (geometryUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(geometryUpdateFrameRef.current);
      geometryUpdateFrameRef.current = null;
    }
    const pending = pendingGeometryUpdatesRef.current;
    pendingGeometryUpdatesRef.current = null;
    if (pending) updateElements(pending, false);
  };

  useEffect(() => () => {
    if (geometryUpdateFrameRef.current !== null) window.cancelAnimationFrame(geometryUpdateFrameRef.current);
  }, []);

  // Resizing state
  const resizeHandleRef = useRef<{
    handle: string;
    startBounds: { x: number; y: number; width: number; height: number };
    pointerStart: Point;
  } | null>(null);

  // Marquee drag selection box
  const [marqueeBox, setMarqueeBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileImportInputRef = useRef<HTMLInputElement>(null);

  // Screen to World Coordinate Conversion
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (screenX - rect.left - viewport.x) / viewport.zoom,
        y: (screenY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport]
  );

  // Map of elements for fast lookup
  const elementsMap = useMemo(() => {
    const map = new Map<string, CanvasElement>();
    elements.forEach((el) => map.set(el.id, el));
    return map;
  }, [elements]);

  const eraseAt = (point: Point) => {
    const target = [...elements]
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))
      .find((element) => isPointNearCanvasElement(point, element, 7 / viewport.zoom));
    if (target) deleteElements([target.id]);
  };

  const selectedElements = useMemo(() => {
    return elements.filter((el) => selectedIds.includes(el.id));
  }, [elements, selectedIds]);

  const selectedBounds = useMemo(() => {
    if (selectedElements.length === 0) return null;
    const b = calculateElementsBounds(selectedElements);
    if (!b) return null;
    return { x: b.minX, y: b.minY, width: b.width, height: b.height };
  }, [selectedElements]);

  // ==========================================
  // KEYBOARD SHORTCUTS
  // ==========================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // IndexedDB applies the saved Y.Doc asynchronously after mount. Keep all
      // canvas shortcuts inactive until that restore is complete.
      if (!isIndexedDbSynced) return;
      // Ignore shortcuts if user is typing in an input/textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        if (e.key === 'Escape') {
          setEditingElementId(null);
          (e.target as HTMLElement)?.blur();
        }
        return;
      }

      // Spacebar for Pan
      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // Copy / Cut / Paste / Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedIds.length > 0) duplicateElements(selectedIds);
        return;
      }

      // Select All (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(elements.map((el) => el.id));
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteElements(selectedIds);
        }
        return;
      }

      // Escape -> deselect
      if (e.key === 'Escape') {
        setSelectedIds([]);
        setEditingElementId(null);
        setActiveTool('select');
        return;
      }

      // Tool Switching Keys
      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'h':
          setActiveTool('pan');
          break;
        case 'r':
          setActiveTool('rectangle');
          break;
        case 'o':
          setActiveTool('circle');
          break;
        case 'd':
          setActiveTool('diamond');
          break;
        case 'a':
          setActiveTool('arrow');
          break;
        case 'l':
          setActiveTool('line');
          break;
        case 'p':
          setActiveTool('draw');
          break;
        case 't':
          setActiveTool('text');
          break;
        case 's':
        case 'n':
          setActiveTool('sticky');
          break;
        case 'e':
          setActiveTool('eraser');
          break;
        case '?':
          setIsHelpOpen(true);
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        if (containerRef.current) {
          containerRef.current.style.cursor = activeTool === 'pan' ? 'grab' : 'default';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    activeTool,
    selectedIds,
    elements,
    undo,
    redo,
    copySelected,
    cutSelected,
    pasteClipboard,
    duplicateElements,
    deleteElements,
    setSelectedIds,
    setActiveTool,
    isIndexedDbSynced,
  ]);

  // ==========================================
  // POINTER EVENT HANDLERS (Canvas Viewport)
  // ==========================================

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isIndexedDbSynced) return;
    // Right click -> Open context menu
    if (e.button === 2) {
      return;
    }

    const target = e.target as HTMLElement;
    if (target !== containerRef.current && !target.closest('#canvas-world-plane')) return;

    setContextMenuPos(null);

    if (activeTool === 'eraser') {
      eraseAt(screenToWorld(e.clientX, e.clientY));
      if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      return;
    }

    // Pan canvas with middle click, Space+click, or Pan tool
    if (e.button === 1 || isSpacePressedRef.current || activeTool === 'pan') {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        viewX: viewport.x,
        viewY: viewport.y,
      };
      if (containerRef.current) {
        containerRef.current.setPointerCapture(e.pointerId);
      }
      return;
    }

    const worldPos = screenToWorld(e.clientX, e.clientY);

    // If clicked on canvas background
    const isBackground = e.target === containerRef.current || (e.target as HTMLElement).id === 'canvas-world-plane';

    if (isBackground) {
      // 1. Text Tool -> Place inline text box immediately
      if (activeTool === 'text') {
        const newId = addElement({
          type: 'text',
          x: Math.round(worldPos.x),
          y: Math.round(worldPos.y),
          width: 180,
          height: 48,
          text: '',
          fontSize: 18,
          textAlign: 'left',
        });
        setSelectedIds([newId]);
        setEditingElementId(newId);
        setActiveTool('select');
        return;
      }

      // 2. Sticky Note Tool -> Drop note and edit immediately
      if (activeTool === 'sticky') {
        const newId = addElement({
          type: 'sticky',
          x: Math.round(worldPos.x - 110),
          y: Math.round(worldPos.y - 90),
          width: 220,
          height: 180,
          color: 'sunflower',
          text: '',
        });
        setSelectedIds([newId]);
        setEditingElementId(newId);
        setActiveTool('select');
        return;
      }

      // 3. Shape / Connector / Pencil Drafting Tools
      if (['rectangle', 'circle', 'diamond', 'triangle', 'star', 'hexagon', 'cloud', 'line', 'arrow', 'draw'].includes(activeTool)) {
        setIsDrafting(true);
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);

        // Check if starting near a shape for connector auto-binding
        let startBinding: { elementId: string; side?: any } | undefined;
        if (activeTool === 'arrow' || activeTool === 'line') {
          const hoveredShape = elements.find((el) => {
            if (el.type === 'line' || el.type === 'arrow' || el.type === 'draw') return false;
            return (
              worldPos.x >= el.x &&
              worldPos.x <= el.x + el.width &&
              worldPos.y >= el.y &&
              worldPos.y <= el.y + el.height
            );
          });
          if (hoveredShape) {
            const side = getClosestAnchorSide(hoveredShape, worldPos);
            const anchorPt = getShapeAnchorPoint(hoveredShape, side);
            startBinding = { elementId: hoveredShape.id, side };
            draftShapeRef.current = {
              tool: activeTool,
              startX: anchorPt.x,
              startY: anchorPt.y,
              startPoint: anchorPt,
              startBinding,
            };
            return;
          }
        }

        draftShapeRef.current = {
          tool: activeTool,
          startX: worldPos.x,
          startY: worldPos.y,
          startPoint: worldPos,
          points: [worldPos],
          startBinding,
        };
        return;
      }

      // 4. Select tool clicked on background -> Start Marquee Box Selection
      if (activeTool === 'select') {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          setSelectedIds([]);
        }
        setEditingElementId(null);
        setMarqueeBox({
          startX: worldPos.x,
          startY: worldPos.y,
          currentX: worldPos.x,
          currentY: worldPos.y,
        });
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isIndexedDbSynced) return;
    const worldPos = screenToWorld(e.clientX, e.clientY);
    broadcastCursor(worldPos, activeTool);

    if (activeTool === 'eraser' && (e.buttons & 1) === 1) {
      eraseAt(worldPos);
      return;
    }

    // 1. Panning Canvas
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setViewport({
        ...viewport,
        x: panStartRef.current.viewX + dx,
        y: panStartRef.current.viewY + dy,
      });
      return;
    }

    // 2. Resizing Selected Elements
    if (resizeHandleRef.current && selectedBounds) {
      const { handle, startBounds, pointerStart } = resizeHandleRef.current;
      const dx = worldPos.x - pointerStart.x;
      const dy = worldPos.y - pointerStart.y;

      let newX = startBounds.x;
      let newY = startBounds.y;
      let newW = startBounds.width;
      let newH = startBounds.height;

      if (handle.includes('e')) newW = Math.max(startBounds.width + dx, 20);
      if (handle.includes('s')) newH = Math.max(startBounds.height + dy, 20);
      if (handle.includes('w')) {
        const potentialW = startBounds.width - dx;
        if (potentialW >= 20) {
          newX = startBounds.x + dx;
          newW = potentialW;
        }
      }
      if (handle.includes('n')) {
        const potentialH = startBounds.height - dy;
        if (potentialH >= 20) {
          newY = startBounds.y + dy;
          newH = potentialH;
        }
      }

      // If single element, update its geometry directly
      if (selectedElements.length === 1) {
        scheduleGeometryUpdate({ [selectedElements[0].id]: {
          x: Math.round(newX),
          y: Math.round(newY),
          width: Math.round(newW),
          height: Math.round(newH),
        } });
      } else {
        // Multi-element scaling proportional
        const scaleX = newW / startBounds.width;
        const scaleY = newH / startBounds.height;
        const updates: Record<string, Partial<CanvasElement>> = {};
        selectedElements.forEach((el) => {
          const relX = el.x - startBounds.x;
          const relY = el.y - startBounds.y;
          updates[el.id] = {
            x: Math.round(newX + relX * scaleX),
            y: Math.round(newY + relY * scaleY),
            width: Math.round(el.width * scaleX),
            height: Math.round(el.height * scaleY),
          };
        });
        scheduleGeometryUpdate(updates);
      }
      return;
    }

    // 3. Moving Dragged Elements
    if (isDraggingElementsRef.current && selectedIds.length > 0) {
      const dx = worldPos.x - dragPointerStartRef.current.x;
      const dy = worldPos.y - dragPointerStartRef.current.y;

      const updates: Record<string, Partial<CanvasElement>> = {};
      selectedIds.forEach((id) => {
        const origPos = dragStartPositionsRef.current[id];
        if (origPos) {
          updates[id] = {
            x: Math.round(origPos.x + dx),
            y: Math.round(origPos.y + dy),
          };
        }
      });
      scheduleGeometryUpdate(updates);
      return;
    }

    // 4. Freehand Pencil Drawing In-Progress
    if (isDrafting && draftShapeRef.current?.tool === 'draw') {
      draftShapeRef.current.points?.push(worldPos);
      return;
    }

    // 5. Marquee Selection Box In-Progress
    if (marqueeBox) {
      setMarqueeBox({
        ...marqueeBox,
        currentX: worldPos.x,
        currentY: worldPos.y,
      });

      const mMinX = Math.min(marqueeBox.startX, worldPos.x);
      const mMaxX = Math.max(marqueeBox.startX, worldPos.x);
      const mMinY = Math.min(marqueeBox.startY, worldPos.y);
      const mMaxY = Math.max(marqueeBox.startY, worldPos.y);

      const intersectingIds = elements
        .filter((el) => {
          if (el.isHidden) return false;
          return doRectsIntersect(
            { minX: mMinX, minY: mMinY, maxX: mMaxX, maxY: mMaxY },
            { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height }
          );
        })
        .map((el) => el.id);

      setSelectedIds(intersectingIds);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isIndexedDbSynced) return;
    flushGeometryUpdate();
    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (isPanning) {
      setIsPanning(false);
    }

    if (resizeHandleRef.current) {
      resizeHandleRef.current = null;
    }

    if (isDraggingElementsRef.current) {
      isDraggingElementsRef.current = false;
      dragStartPositionsRef.current = {};
    }

    if (marqueeBox) {
      setMarqueeBox(null);
    }

    // Commit newly drafted shape
    if (isDrafting && draftShapeRef.current) {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      const draft = draftShapeRef.current;
      setIsDrafting(false);
      draftShapeRef.current = null;

      const minX = Math.min(draft.startX, worldPos.x);
      const minY = Math.min(draft.startY, worldPos.y);
      const rawW = Math.abs(worldPos.x - draft.startX);
      const rawH = Math.abs(worldPos.y - draft.startY);

      // Default minimum size if user just clicked without dragging
      const width = rawW > 10 ? rawW : 160;
      const height = rawH > 10 ? rawH : draft.tool === 'circle' ? 140 : 100;
      const finalX = rawW > 10 ? minX : draft.startX - width / 2;
      const finalY = rawH > 10 ? minY : draft.startY - height / 2;

      // Handle Freehand Pencil creation
      if (draft.tool === 'draw') {
        const pts = draft.points || [];
        if (pts.length > 1) {
          const b = calculateElementsBounds([{ id: 'tmp', type: 'draw', x: 0, y: 0, width: 0, height: 0, rotation: 0, color: 'sunflower', zIndex: 0, createdAt: 0, updatedAt: 0, points: pts }]);
          const newId = addElement({
            type: 'draw',
            x: b?.minX || minX,
            y: b?.minY || minY,
            width: b?.width || width,
            height: b?.height || height,
            points: pts,
            strokeColor: '#1F2937',
            strokeWidth: 3,
          });
          setSelectedIds([newId]);
        }
        return;
      }

      // Handle Connector (Arrow / Line)
      if (draft.tool === 'arrow' || draft.tool === 'line') {
        const startPt = draft.startPoint || { x: draft.startX, y: draft.startY };
        let endPt = worldPos;
        let endBinding: { elementId: string; side?: any } | undefined;

        // Check if ending on a shape
        const targetShape = elements.find((el) => {
          if (el.type === 'arrow' || el.type === 'line' || el.type === 'draw') return false;
          if (draft.startBinding && el.id === draft.startBinding.elementId) return false;
          return (
            worldPos.x >= el.x &&
            worldPos.x <= el.x + el.width &&
            worldPos.y >= el.y &&
            worldPos.y <= el.y + el.height
          );
        });

        if (targetShape) {
          const side = getClosestAnchorSide(targetShape, startPt);
          endPt = getShapeAnchorPoint(targetShape, side);
          endBinding = { elementId: targetShape.id, side };
        }

        const newId = addElement({
          type: draft.tool,
          x: Math.min(startPt.x, endPt.x),
          y: Math.min(startPt.y, endPt.y),
          width: Math.abs(endPt.x - startPt.x) || 10,
          height: Math.abs(endPt.y - startPt.y) || 10,
          startPoint: startPt,
          endPoint: endPt,
          startBinding: draft.startBinding,
          endBinding,
          endArrow: draft.tool === 'arrow',
          strokeColor: '#00667E',
          strokeWidth: 2,
        });

        setSelectedIds([newId]);
        setActiveTool('select');
        return;
      }

      // Geometric Shapes (Rectangle, Circle, Diamond, etc.)
      const newId = addElement({
        type: draft.tool as any,
        x: Math.round(finalX),
        y: Math.round(finalY),
        width: Math.round(width),
        height: Math.round(height),
        fillColor: '#FFFFFF',
        strokeColor: '#1F2937',
        strokeWidth: 2,
        text: '',
      });

      setSelectedIds([newId]);
      setActiveTool('select');
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (geometryUpdateFrameRef.current !== null) window.cancelAnimationFrame(geometryUpdateFrameRef.current);
    geometryUpdateFrameRef.current = null;
    pendingGeometryUpdatesRef.current = null;
    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setIsPanning(false);
    setIsDrafting(false);
    draftShapeRef.current = null;
    isDraggingElementsRef.current = false;
    dragStartPositionsRef.current = {};
    resizeHandleRef.current = null;
    setMarqueeBox(null);
  };

  // Wheel Zoom & Pan
  const handleWheel = (e: React.WheelEvent) => {
    if (!isIndexedDbSynced) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomFactor = -e.deltaY * 0.0015;
      const newZoom = Math.min(Math.max(viewport.zoom * (1 + zoomFactor), 0.15), 3.0);

      const rect = containerRef.current?.getBoundingClientRect();
      const mouseX = rect ? e.clientX - rect.left : e.clientX;
      const mouseY = rect ? e.clientY - rect.top : e.clientY;

      const newX = mouseX - ((mouseX - viewport.x) / viewport.zoom) * newZoom;
      const newY = mouseY - ((mouseY - viewport.y) / viewport.zoom) * newZoom;

      setViewport({ x: newX, y: newY, zoom: newZoom });
    } else {
      // Pan Canvas
      setViewport({
        ...viewport,
        x: viewport.x - e.deltaX,
        y: viewport.y - e.deltaY,
      });
    }
  };

  // Element Selection & Drag Initiation
  const handleElementPointerDown = (id: string, e: React.PointerEvent) => {
    if (activeTool !== 'select') return;

    e.stopPropagation();
    if (editingElementId === id) return;
    const isMultiKey = e.shiftKey || e.ctrlKey || e.metaKey;

    let nextSelectedIds = [...selectedIds];
    if (isMultiKey) {
      if (nextSelectedIds.includes(id)) {
        nextSelectedIds = nextSelectedIds.filter((selId) => selId !== id);
      } else {
        nextSelectedIds.push(id);
      }
    } else if (!selectedIds.includes(id)) {
      // If clicking an unselected element without shift, select only this element (or its group)
      const targetEl = elementsMap.get(id);
      if (targetEl?.groupId) {
        nextSelectedIds = elements.filter((el) => el.groupId === targetEl.groupId).map((el) => el.id);
      } else {
        nextSelectedIds = [id];
      }
    }

    setSelectedIds(nextSelectedIds);
    bringToFront(nextSelectedIds);

    // Start moving selected elements
    isDraggingElementsRef.current = true;
    const worldPos = screenToWorld(e.clientX, e.clientY);
    dragPointerStartRef.current = worldPos;

    const positions: Record<string, { x: number; y: number }> = {};
    nextSelectedIds.forEach((selId) => {
      const el = elementsMap.get(selId);
      if (el) positions[selId] = { x: el.x, y: el.y };
    });
    dragStartPositionsRef.current = positions;

    if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
  };

  // Handle Resize Start on Bounding Box Handle
  const handleResizeStart = (handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (!selectedBounds) return;

    // Geometry changes during the gesture are streamed without history writes;
    // capture the pre-gesture state once so a single Undo restores the resize.
    recordHistorySnapshot();

    const worldPos = screenToWorld(e.clientX, e.clientY);
    resizeHandleRef.current = {
      handle,
      startBounds: { ...selectedBounds },
      pointerStart: worldPos,
    };

    if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
  };

  // Handle Context Menu (Right Click)
  const handleContextMenu = (e: React.MouseEvent, id?: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (id && !selectedIds.includes(id)) {
      setSelectedIds([id]);
    }
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Image Upload Handler
  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / img.height;
        const width = Math.min(img.width, 360);
        const height = width / aspect;

        const centerWorld = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const newId = addElement({
          type: 'image',
          x: Math.round(centerWorld.x - width / 2),
          y: Math.round(centerWorld.y - height / 2),
          width: Math.round(width),
          height: Math.round(height),
          imageUrl: event.target?.result as string,
          aspectRatio: aspect,
        });

        setSelectedIds([newId]);
        setActiveTool('select');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Export PNG / SVG / JSON
  const handleExportPNG = () => {
    const bounds = calculateElementsBounds(elements);
    if (!bounds || elements.length === 0) return;

    const padding = 60;
    const exportWidth = bounds.width + padding * 2;
    const exportHeight = bounds.height + padding * 2;

    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = exportHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, exportWidth, exportHeight);

    // Draw elements
    elements.forEach((el) => {
      if (el.isHidden) return;
      const drawX = el.x - bounds.minX + padding;
      const drawY = el.y - bounds.minY + padding;

      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;

      if (el.type === 'rectangle') {
        ctx.fillStyle = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : '#FFFFFF';
        ctx.fillRect(drawX, drawY, el.width, el.height);
        ctx.strokeStyle = el.strokeColor || '#1F2937';
        ctx.lineWidth = el.strokeWidth || 2;
        ctx.strokeRect(drawX, drawY, el.width, el.height);
      } else if (el.type === 'circle') {
        ctx.beginPath();
        ctx.ellipse(drawX + el.width / 2, drawY + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = el.strokeColor || '#1F2937';
        ctx.lineWidth = el.strokeWidth || 2;
        ctx.stroke();
      } else if (el.type === 'sticky') {
        ctx.fillStyle = el.fillColor || '#FEF08A';
        ctx.fillRect(drawX, drawY, el.width, el.height);
        ctx.strokeStyle = el.strokeColor || '#CA8A04';
        ctx.strokeRect(drawX, drawY, el.width, el.height);
      }

      // Draw text if available
      if (el.text) {
        ctx.fillStyle = el.textColor || '#1F2937';
        ctx.font = `${el.fontWeight === 'bold' ? 'bold ' : ''}${el.fontSize || 14}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.text.split('\n')[0], drawX + el.width / 2, drawY + el.height / 2);
      }

      ctx.restore();
    });

    const link = document.createElement('a');
    link.download = `${docTitle.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleExportSVG = () => {
    const bounds = calculateElementsBounds(elements);
    if (!bounds || elements.length === 0) return;

    const padding = 50;
    const w = bounds.width + padding * 2;
    const h = bounds.height + padding * 2;

    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect width="100%" height="100%" fill="#FFFFFF" />
        <g transform="translate(${padding - bounds.minX}, ${padding - bounds.minY})">
          ${elements
            .map((el) => {
              if (el.type === 'rectangle') {
                return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="8" fill="${el.fillColor || '#FFFFFF'}" stroke="${el.strokeColor || '#1F2937'}" stroke-width="${el.strokeWidth || 2}" />`;
              }
              if (el.type === 'circle') {
                return `<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${el.fillColor || '#FFFFFF'}" stroke="${el.strokeColor || '#1F2937'}" stroke-width="${el.strokeWidth || 2}" />`;
              }
              return '';
            })
            .join('\n')}
        </g>
      </svg>
    `;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${docTitle.toLowerCase().replace(/\s+/g, '-')}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full w-full bg-workspace-50 relative overflow-hidden select-none font-sans">
      {/* Hidden File Input for JSON import */}
      <input
        ref={fileImportInputRef}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              importFromJSON(event.target?.result as string);
            };
            reader.readAsText(file);
          }
        }}
        className="hidden"
      />

      {/* Top Navigation Bar */}
      <CanvasTopBar
        title={docTitle}
        onUpdateTitle={(newTitle) => currentDocId && updateDocumentTitle(currentDocId, newTitle)}
        saveStatus={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        remoteUsers={remoteUsers}
        currentUser={{ name: user?.name || 'Tanvi', color: '#00667E' }}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportJSON={() => exportAsJSON(docTitle)}
        onImportJSON={() => isIndexedDbSynced && fileImportInputRef.current?.click()}
        onClearCanvas={() => { if (isIndexedDbSynced) clearCanvas(); }}
        onResetZoom={() => setViewport({ ...viewport, zoom: 1 })}
        onFitToScreen={() => {
          const bounds = calculateElementsBounds(elements);
          if (bounds && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const scaleX = (rect.width - 160) / bounds.width;
            const scaleY = (rect.height - 160) / bounds.height;
            const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.5);
            setViewport({
              zoom: newZoom,
              x: (rect.width - bounds.width * newZoom) / 2 - bounds.minX * newZoom,
              y: (rect.height - bounds.height * newZoom) / 2 - bounds.minY * newZoom,
            });
          }
        }}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        onOpenHelpModal={() => setIsHelpOpen(true)}
        documentId={currentDocId || undefined}
        isOwner={isOwner}
        permission={currentDocMeta?.permission || (isOwner ? 'OWNER' : undefined)}
      />


      {/* Main Canvas Surface */}
      <div
        ref={containerRef}
        id="canvas-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        onContextMenu={(e) => handleContextMenu(e)}
        className={`flex-1 relative w-full h-full overflow-hidden ${
          isPanning
            ? 'cursor-grabbing'
            : activeTool === 'pan'
            ? 'cursor-grab'
            : activeTool === 'draw'
            ? 'cursor-crosshair'
            : activeTool === 'eraser'
            ? 'cursor-not-allowed'
            : ['rectangle', 'circle', 'diamond', 'triangle', 'star', 'hexagon', 'cloud', 'line', 'arrow'].includes(activeTool)
            ? 'cursor-crosshair'
            : 'cursor-default'
        }`}
        style={{
          backgroundImage: showGrid ? 'radial-gradient(#D1D5DB 1.2px, transparent 1.2px)' : 'none',
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
          backgroundColor: '#F9FAFB',
        }}
      >
        {/* Left Vertical Tool Palette */}
        <CanvasLeftToolbar
          activeTool={activeTool}
          onSelectTool={(tool) => {
            setActiveTool(tool);
            if (tool !== 'select') setSelectedIds([]);
          }}
          onAddStickyNote={(color) => {
            const centerWorld = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
            const newId = addElement({
              type: 'sticky',
              x: Math.round(centerWorld.x - 110),
              y: Math.round(centerWorld.y - 90),
              width: 220,
              height: 180,
              color: color || 'sunflower',
              text: '',
            });
            setSelectedIds([newId]);
            setEditingElementId(newId);
            setActiveTool('select');
          }}
          onImageUpload={handleImageUpload}
        />

        {/* Transformed World Coordinate Plane */}
        <div
          id="canvas-world-plane"
          className="absolute top-0 left-0 origin-top-left pointer-events-auto"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            width: '100%',
            height: '100%',
          }}
        >
          {/* SVG Connector & Drawing Layer */}
          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-10">
            {elements.map((el) => {
              if (el.isHidden || (el.type !== 'arrow' && el.type !== 'line')) return null;
              return (
                <ConnectorRenderer
                  key={el.id}
                  element={el}
                  elementsMap={elementsMap}
                  isSelected={selectedIds.includes(el.id)}
                  onPointerDown={(event) => handleElementPointerDown(el.id, event)}
                />
              );
            })}
          </svg>

          {/* Render All Canvas HTML/SVG Elements */}
          {elements.map((el) => {
            if (el.isHidden || el.type === 'arrow' || el.type === 'line') return null;

            const isSelected = selectedIds.includes(el.id);
            const isEditing = editingElementId === el.id;

            return (
              <div
                key={el.id}
                onPointerDown={(e) => handleElementPointerDown(el.id, e)}
                onContextMenu={(e) => handleContextMenu(e, el.id)}
                className={`absolute transition-shadow ${
                  activeTool === 'select' ? 'cursor-grab active:cursor-grabbing' : ''
                }`}
                style={{
                  left: el.x,
                  top: el.y,
                  width: el.width,
                  height: el.height,
                  zIndex: el.zIndex || 1,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                }}
              >
                {el.type === 'sticky' ? (
                  <StickyNoteRenderer
                    element={el}
                    isSelected={isSelected}
                    isEditing={isEditing}
                    onStartEditing={() => setEditingElementId(el.id)}
                    onFinishEditing={(newText, newTitle) => {
                      updateElement(el.id, { text: newText, title: newTitle });
                      setEditingElementId(null);
                    }}
                  />
                ) : el.type === 'text' ? (
                  <TextRenderer
                    element={el}
                    isSelected={isSelected}
                    isEditing={isEditing}
                    onStartEditing={() => setEditingElementId(el.id)}
                    onFinishEditing={(newText) => {
                      updateElement(el.id, { text: newText });
                      setEditingElementId(null);
                    }}
                  />
                ) : el.type === 'image' ? (
                  <ImageRenderer element={el} isSelected={isSelected} />
                ) : el.type === 'draw' ? (
                  <FreehandRenderer element={el} isSelected={isSelected} />
                ) : (
                  <ShapeRenderer
                    element={el}
                    isSelected={isSelected}
                    isEditing={isEditing}
                    onStartEditing={() => setEditingElementId(el.id)}
                    onFinishEditing={(newText) => {
                      updateElement(el.id, { text: newText });
                      setEditingElementId(null);
                    }}
                    zoom={viewport.zoom}
                  />
                )}
              </div>
            );
          })}

          {/* Selection Box & Resize Handles */}
          {selectedBounds && activeTool === 'select' && (
            <SelectionBox
              bounds={selectedBounds}
              isMulti={selectedElements.length > 1}
              onResizeStart={handleResizeStart}
              zoom={viewport.zoom}
            />
          )}

          {/* Marquee Drag Selection Box Rectangle */}
          {marqueeBox && (
            <div
              className="absolute border-2 border-primary-500 bg-primary-500/10 rounded-xs pointer-events-none z-40"
              style={{
                left: Math.min(marqueeBox.startX, marqueeBox.currentX),
                top: Math.min(marqueeBox.startY, marqueeBox.currentY),
                width: Math.abs(marqueeBox.currentX - marqueeBox.startX),
                height: Math.abs(marqueeBox.currentY - marqueeBox.startY),
              }}
            />
          )}

          {/* Multiplayer Live Remote Cursors */}
          {remoteUsers.map((remoteUser) => (
            <RemoteMultiplayerCursor
              key={remoteUser.clientId}
              user={remoteUser}
              zoom={viewport.zoom}
            />
          ))}
        </div>

        {/* Right-Side Properties Inspector Panel */}
        <CanvasPropertiesPanel
          selectedElements={selectedElements}
          onUpdateElement={updateElement}
          onUpdateElements={updateElements}
          onDeleteElements={deleteElements}
          onDuplicateElements={duplicateElements}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
          onGroupElements={groupElements}
          onUngroupElements={ungroupElements}
          onAlignElements={alignElements}
        />

        {/* Right-Side Layers Panel */}
        <CanvasLayersPanel
          isOpen={isLayersOpen}
          onClose={() => setIsLayersOpen(false)}
          elements={elements}
          selectedIds={selectedIds}
          onSelectElement={(id, multi) => {
            if (multi) {
              setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
            } else {
              setSelectedIds([id]);
            }
          }}
          onUpdateElement={updateElement}
          onDeleteElements={deleteElements}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
        />

        {/* Bottom-Right Minimap & Zoom Controls */}
        <CanvasMinimap
          elements={elements}
          viewport={viewport}
          onZoomIn={() => setViewport({ ...viewport, zoom: Math.min(viewport.zoom + 0.2, 3) })}
          onZoomOut={() => setViewport({ ...viewport, zoom: Math.max(viewport.zoom - 0.2, 0.2) })}
          onResetZoom={() => setViewport({ ...viewport, zoom: 1 })}
          onFitToScreen={() => {
            const bounds = calculateElementsBounds(elements);
            if (bounds && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const scaleX = (rect.width - 160) / bounds.width;
              const scaleY = (rect.height - 160) / bounds.height;
              const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.5);
              setViewport({
                zoom: newZoom,
                x: (rect.width - bounds.width * newZoom) / 2 - bounds.minX * newZoom,
                y: (rect.height - bounds.height * newZoom) / 2 - bounds.minY * newZoom,
              });
            }
          }}
          onNavigateTo={(worldX, worldY) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            setViewport({
              ...viewport,
              x: rect.width / 2 - worldX * viewport.zoom,
              y: rect.height / 2 - worldY * viewport.zoom,
            });
          }}
          onToggleLayers={() => setIsLayersOpen(!isLayersOpen)}
          isLayersOpen={isLayersOpen}
        />

        {/* Right-Click Context Menu */}
        <CanvasContextMenu
          position={contextMenuPos}
          onClose={() => setContextMenuPos(null)}
          selectedElements={selectedElements}
          onEdit={() => {
            if (selectedElements.length === 1) setEditingElementId(selectedElements[0].id);
          }}
          onCopy={copySelected}
          onCut={cutSelected}
          onDuplicate={() => duplicateElements(selectedIds)}
          onDelete={() => deleteElements(selectedIds)}
          onBringToFront={() => bringToFront(selectedIds)}
          onSendToBack={() => sendToBack(selectedIds)}
          onToggleLock={() => {
            const isLocked = selectedElements.every((el) => el.isLocked);
            const updates: Record<string, Partial<CanvasElement>> = {};
            selectedElements.forEach((el) => {
              updates[el.id] = { isLocked: !isLocked };
            });
            updateElements(updates);
          }}
          onGroup={() => groupElements(selectedIds)}
          onUngroup={() => ungroupElements(selectedIds)}
        />

        {!isIndexedDbSynced && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-[60] flex items-center justify-center bg-workspace-50/80 backdrop-blur-[1px]"
          >
            <div className="rounded-xl border border-workspace-200 bg-white px-4 py-3 text-sm text-workspace-600 shadow-panel">
              Restoring saved canvas…
            </div>
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts Modal */}
      <CanvasShortcutsModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
