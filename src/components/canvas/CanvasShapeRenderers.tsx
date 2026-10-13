import React, { useState, useRef, useEffect } from 'react';
import { 
  CanvasElement, 
  Point, 
  UserPresence, 
  ViewportState 
} from '../../types/canvas';
import { 
  resolveConnectorPoints, 
  generateConnectorPath, 
  generateSmoothFreehandPath 
} from '../../utils/canvasGeometry';
import { CANVAS_PALETTES } from '../../utils/canvasConstants';

// ==========================================
// 1. GENERIC SHAPE RENDERER (Rect, Circle, Diamond, etc.)
// ==========================================
interface ShapeRendererProps {
  element: CanvasElement;
  isSelected: boolean;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: (newText: string) => void;
  zoom: number;
}

export const ShapeRenderer: React.FC<ShapeRendererProps> = ({
  element,
  isSelected,
  isEditing,
  onStartEditing,
  onFinishEditing,
  zoom,
}) => {
  const [editText, setEditText] = useState(element.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditText(element.text || '');
  }, [element.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const {
    type,
    width,
    height,
    fillColor = '#FFFFFF',
    strokeColor = '#1F2937',
    strokeWidth = 2,
    strokeStyle = 'solid',
    opacity = 1,
    fontSize = 14,
    fontFamily = 'sans',
    fontWeight = 'normal',
    fontStyle = 'normal',
    textDecoration = 'none',
    textAlign = 'center',
    textColor = '#1F2937',
  } = element;

  const strokeDash = strokeStyle === 'dashed' ? '6 4' : strokeStyle === 'dotted' ? '2 3' : undefined;

  const renderShapeSvg = () => {
    switch (type) {
      case 'circle':
        return (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={Math.max(width / 2 - strokeWidth / 2, 1)}
            ry={Math.max(height / 2 - strokeWidth / 2, 1)}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );

      case 'diamond': {
        const points = `${width / 2},${strokeWidth} ${width - strokeWidth},${height / 2} ${width / 2},${height - strokeWidth} ${strokeWidth},${height / 2}`;
        return (
          <polygon
            points={points}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
      }

      case 'triangle': {
        const points = `${width / 2},${strokeWidth} ${width - strokeWidth},${height - strokeWidth} ${strokeWidth},${height - strokeWidth}`;
        return (
          <polygon
            points={points}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
      }

      case 'star': {
        // 5-point star
        const cx = width / 2;
        const cy = height / 2;
        const outerR = Math.min(width, height) / 2 - strokeWidth;
        const innerR = outerR * 0.42;
        let starPoints = '';
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (i * Math.PI) / 5 - Math.PI / 2;
          const px = cx + r * Math.cos(angle);
          const py = cy + r * Math.sin(angle);
          starPoints += `${px},${py} `;
        }
        return (
          <polygon
            points={starPoints.trim()}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
      }

      case 'hexagon': {
        const cx = width / 2;
        const cy = height / 2;
        const rx = width / 2 - strokeWidth;
        const ry = height / 2 - strokeWidth;
        let hexPoints = '';
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const px = cx + rx * Math.cos(angle);
          const py = cy + ry * Math.sin(angle);
          hexPoints += `${px},${py} `;
        }
        return (
          <polygon
            points={hexPoints.trim()}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
      }

      case 'cloud': {
        const w = width;
        const h = height;
        const path = `M ${w * 0.2} ${h * 0.7} 
          A ${w * 0.15} ${h * 0.25} 0 0 1 ${w * 0.25} ${h * 0.35} 
          A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.6} ${h * 0.3} 
          A ${w * 0.2} ${h * 0.25} 0 0 1 ${w * 0.8} ${h * 0.5} 
          A ${w * 0.15} ${h * 0.2} 0 0 1 ${w * 0.75} ${h * 0.75} 
          Z`;
        return (
          <path
            d={path}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
      }

      case 'rectangle':
      default:
        return (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(width - strokeWidth, 1)}
            height={Math.max(height - strokeWidth, 1)}
            rx={8}
            ry={8}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
          />
        );
    }
  };

  return (
    <div
      className="relative w-full h-full select-none"
      style={{ opacity }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEditing();
      }}
    >
      <svg className="w-full h-full overflow-visible pointer-events-none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.05))' }}>
        {renderShapeSvg()}
      </svg>

      {/* Text Inside Shape */}
      <div 
        className="absolute inset-0 flex items-center justify-center p-3 pointer-events-none"
        style={{
          fontFamily: fontFamily === 'mono' ? '"JetBrains Mono", monospace' : fontFamily === 'serif' ? 'Georgia, serif' : 'Inter, sans-serif',
          fontSize: `${fontSize}px`,
          fontWeight,
          fontStyle,
          textDecoration,
          textAlign,
          color: textColor,
        }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => onFinishEditing(editText)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onFinishEditing(editText);
            }}
            className="w-full h-full bg-transparent resize-none outline-none border-none pointer-events-auto text-center custom-scrollbar"
            style={{
              fontFamily: 'inherit',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              color: 'inherit',
              textAlign,
            }}
          />
        ) : (
          <div className="w-full max-h-full overflow-hidden text-ellipsis whitespace-pre-wrap leading-snug">
            {element.text}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 2. STICKY NOTE RENDERER
// ==========================================
interface StickyNoteRendererProps {
  element: CanvasElement;
  isSelected: boolean;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: (newText: string, newTitle?: string) => void;
}

export const StickyNoteRenderer: React.FC<StickyNoteRendererProps> = ({
  element,
  isSelected,
  isEditing,
  onStartEditing,
  onFinishEditing,
}) => {
  const [editText, setEditText] = useState(element.text || '');
  const [editTitle, setEditTitle] = useState(element.title || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditText(element.text || '');
    setEditTitle(element.title || '');
  }, [element.text, element.title]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const colorKey = (element.color as string) || 'sunflower';
  const matchedPalette = CANVAS_PALETTES.stickyColors.find((c) => c.key === colorKey) || CANVAS_PALETTES.stickyColors[0];

  return (
    <div
      className="relative w-full h-full rounded-md shadow-md p-3.5 flex flex-col transition-shadow group select-none border"
      style={{
        backgroundColor: element.fillColor && element.fillColor !== '#FFFFFF' ? element.fillColor : matchedPalette.bg,
        borderColor: element.strokeColor || matchedPalette.border,
        color: element.textColor || matchedPalette.text,
        opacity: element.opacity ?? 1,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEditing();
      }}
    >
      {/* Decorative Washi Tape / Pin */}
      <div 
        className="absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-5 bg-amber-400/30 backdrop-blur-xs rounded-xs shadow-xs pointer-events-none"
        style={{ transform: 'rotate(-1.5deg)' }}
      />

      {/* Optional Sticky Note Title */}
      {(element.title || isEditing) && (
        <div className="mb-1.5 pb-1 border-b border-black/10 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title..."
              className="w-full bg-transparent outline-none font-bold text-xs"
            />
          ) : (
            <span>{element.title}</span>
          )}
        </div>
      )}

      {/* Sticky Content */}
      <div className="flex-1 overflow-hidden relative">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => onFinishEditing(editText, editTitle)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onFinishEditing(editText, editTitle);
            }}
            placeholder="Type your thoughts..."
            className="w-full h-full bg-transparent resize-none outline-none text-xs leading-relaxed custom-scrollbar font-medium"
            style={{
              fontSize: element.fontSize ? `${element.fontSize}px` : '13px',
              fontFamily: 'Inter, sans-serif',
            }}
          />
        ) : (
          <div 
            className="w-full h-full overflow-hidden text-xs leading-relaxed whitespace-pre-wrap font-medium"
            style={{
              fontSize: element.fontSize ? `${element.fontSize}px` : '13px',
            }}
          >
            {element.text || <span className="opacity-40 italic">Double-click to write note...</span>}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3. TEXT BLOCK RENDERER
// ==========================================
interface TextRendererProps {
  element: CanvasElement;
  isSelected: boolean;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: (newText: string) => void;
}

export const TextRenderer: React.FC<TextRendererProps> = ({
  element,
  isSelected,
  isEditing,
  onStartEditing,
  onFinishEditing,
}) => {
  const [editText, setEditText] = useState(element.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditText(element.text || '');
  }, [element.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const {
    fontSize = 18,
    fontFamily = 'sans',
    fontWeight = 'normal',
    fontStyle = 'normal',
    textDecoration = 'none',
    textAlign = 'left',
    textColor = '#1F2937',
    opacity = 1,
  } = element;

  return (
    <div
      className={`relative w-full h-full p-2 select-none flex ${
        textAlign === 'center' ? 'items-center justify-center' : textAlign === 'right' ? 'items-center justify-end' : 'items-center justify-start'
      }`}
      style={{
        opacity,
        fontFamily: fontFamily === 'mono' ? '"JetBrains Mono", monospace' : fontFamily === 'serif' ? 'Georgia, serif' : 'Inter, sans-serif',
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        textDecoration,
        textAlign,
        color: textColor,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEditing();
      }}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={() => onFinishEditing(editText)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onFinishEditing(editText);
          }}
          className="w-full h-full bg-transparent resize-none outline-none border-none custom-scrollbar"
          style={{
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            fontStyle: 'inherit',
            textDecoration: 'inherit',
            color: 'inherit',
            textAlign,
          }}
        />
      ) : (
        <div className="w-full whitespace-pre-wrap leading-snug">
          {element.text || <span className="opacity-40 italic">Type text...</span>}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4. IMAGE ELEMENT RENDERER
// ==========================================
export const ImageRenderer: React.FC<{ element: CanvasElement; isSelected: boolean }> = ({ element }) => {
  return (
    <div 
      className="w-full h-full overflow-hidden rounded-lg shadow-sm border border-workspace-200 select-none bg-workspace-100"
      style={{ opacity: element.opacity ?? 1 }}
    >
      {element.imageUrl ? (
        <img
          src={element.imageUrl}
          alt={element.title || 'Canvas Image'}
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-workspace-400">
          No image source
        </div>
      )}
    </div>
  );
};

// ==========================================
// 5. FREEHAND DRAWING RENDERER (SVG)
// ==========================================
export const FreehandRenderer: React.FC<{ element: CanvasElement; isSelected: boolean }> = ({ element }) => {
  const pathD = generateSmoothFreehandPath(element.points || []);
  const strokeColor = element.strokeColor || '#1F2937';
  const strokeWidth = element.strokeWidth || 3;
  const opacity = element.opacity ?? 1;

  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" style={{ opacity }}>
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// ==========================================
// 6. CONNECTOR / ARROW RENDERER (SVG Layer)
// ==========================================
interface ConnectorRendererProps {
  element: CanvasElement;
  elementsMap: Map<string, CanvasElement> | Record<string, CanvasElement>;
  isSelected: boolean;
  onPointerDown?: (event: React.PointerEvent<SVGPathElement>) => void;
}

export const ConnectorRenderer: React.FC<ConnectorRendererProps> = ({
  element,
  elementsMap,
  isSelected,
  onPointerDown,
}) => {
  const { start, end } = resolveConnectorPoints(element, elementsMap);
  const pathD = generateConnectorPath(start, end, element.lineStyle || 'straight');
  
  const strokeColor = element.strokeColor || '#1F2937';
  const strokeWidth = element.strokeWidth || 2;
  const strokeStyle = element.strokeStyle || 'solid';
  const opacity = element.opacity ?? 1;
  const markerEndId = `marker-end-${element.id}`;
  const markerStartId = `marker-start-${element.id}`;

  const strokeDash = strokeStyle === 'dashed' ? '6 4' : strokeStyle === 'dotted' ? '2 3' : undefined;

  // Midpoint for connector text label
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  return (
    <g className="cursor-pointer" opacity={opacity}>
      <defs>
        {element.endArrow !== false && (
          <marker
            id={markerEndId}
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={strokeColor} />
          </marker>
        )}
        {element.startArrow && (
          <marker
            id={markerStartId}
            viewBox="0 0 10 10"
            refX="3"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 8 1.5 L 0 5 L 8 8.5 z" fill={strokeColor} />
          </marker>
        )}
      </defs>

      {/* Invisible wider stroke for easier clicking */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(strokeWidth + 12, 16)}
        className="pointer-events-auto"
        onPointerDown={onPointerDown}
      />

      {/* Main Visible Connector Path */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDash}
        markerEnd={element.endArrow !== false ? `url(#${markerEndId})` : undefined}
        markerStart={element.startArrow ? `url(#${markerStartId})` : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Connector Label if provided */}
      {element.text && (
        <g transform={`translate(${midX}, ${midY})`}>
          <rect
            x={-((element.text.length * 7 + 16) / 2)}
            y={-11}
            width={element.text.length * 7 + 16}
            height={22}
            rx={4}
            fill="#FFFFFF"
            stroke="#E5E7EB"
            strokeWidth={1}
            filter="drop-shadow(0 1px 2px rgba(0,0,0,0.08))"
          />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fill={element.textColor || '#374151'}
            fontSize={element.fontSize || 11}
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            {element.text}
          </text>
        </g>
      )}
    </g>
  );
};

// ==========================================
// 7. SELECTION BOUNDING BOX & RESIZE HANDLES
// ==========================================
interface SelectionBoxProps {
  bounds: { x: number; y: number; width: number; height: number };
  isMulti: boolean;
  onResizeStart: (handle: string, e: React.PointerEvent) => void;
  zoom: number;
}

export const SelectionBox: React.FC<SelectionBoxProps> = ({
  bounds,
  isMulti,
  onResizeStart,
  zoom,
}) => {
  const handles = [
    { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
    { id: 'n', x: bounds.width / 2, y: 0, cursor: 'ns-resize' },
    { id: 'ne', x: bounds.width, y: 0, cursor: 'nesw-resize' },
    { id: 'e', x: bounds.width, y: bounds.height / 2, cursor: 'ew-resize' },
    { id: 'se', x: bounds.width, y: bounds.height, cursor: 'nwse-resize' },
    { id: 's', x: bounds.width / 2, y: bounds.height, cursor: 'ns-resize' },
    { id: 'sw', x: 0, y: bounds.height, cursor: 'nesw-resize' },
    { id: 'w', x: 0, y: bounds.height / 2, cursor: 'ew-resize' },
  ];

  const handleSize = Math.max(8 / zoom, 6);

  return (
    <div
      className="absolute pointer-events-none border-2 border-primary-500 rounded-sm z-30"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        boxShadow: '0 0 0 1px rgba(255,255,255,0.8), 0 2px 8px rgba(0, 102, 126, 0.15)',
      }}
    >
      {/* 8 Bounding Box Resize Handles */}
      {handles.map((h) => (
        <div
          key={h.id}
          onPointerDown={(e) => onResizeStart(h.id, e)}
          className="absolute bg-white border-2 border-primary-600 rounded-xs pointer-events-auto hover:bg-primary-100 hover:scale-125 transition-transform"
          style={{
            left: h.x,
            top: h.y,
            width: `${handleSize}px`,
            height: `${handleSize}px`,
            transform: 'translate(-50%, -50%)',
            cursor: h.cursor,
          }}
        />
      ))}

      {/* Multi-Selection Badge */}
      {isMulti && (
        <div className="absolute -top-6 left-0 bg-primary-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">
          Multi-Selected
        </div>
      )}
    </div>
  );
};

// ==========================================
// 8. MULTIPLAYER REMOTE CURSORS
// ==========================================
export const RemoteMultiplayerCursor: React.FC<{ user: UserPresence; zoom: number }> = ({ user, zoom }) => {
  if (!user.cursor) return null;

  return (
    <div
      className="absolute pointer-events-none z-50 transition-all duration-75 ease-out"
      style={{
        left: user.cursor.x,
        top: user.cursor.y,
      }}
    >
      <svg
        className="w-5 h-5 -translate-x-1 -translate-y-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M4.5 3.5 L19.5 11.5 L12 13.5 L9.5 20.5 L4.5 3.5 Z"
          fill={user.color || '#00667E'}
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className="ml-3 -mt-2 px-2 py-0.5 rounded-full text-white font-medium text-[11px] whitespace-nowrap shadow-md flex items-center gap-1"
        style={{ backgroundColor: user.color || '#00667E' }}
      >
        <span>{user.name}</span>
        {user.tool && user.tool !== 'select' && (
          <span className="opacity-75 text-[9px] uppercase">({user.tool})</span>
        )}
      </div>
    </div>
  );
};
