import React from 'react';
import { Grid2X2, Layers, Maximize2, Minus, Plus, Shapes, X } from 'lucide-react';

interface CanvasDetailsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
  isLayersOpen: boolean;
  onToggleLayers: () => void;
}

export function CanvasDetailsPanel({
  isOpen,
  onClose,
  showGrid,
  onToggleGrid,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
  isLayersOpen,
  onToggleLayers,
}: CanvasDetailsPanelProps) {
  if (!isOpen) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-40 flex h-full w-[min(320px,88vw)] shrink-0 flex-col border-l border-workspace-200 bg-white shadow-[-2px_0_12px_rgba(0,0,0,0.04)] md:relative md:inset-auto md:z-20 md:w-80 md:shadow-none">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-workspace-200 px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-primary-100 bg-primary-50 text-primary-600">
            <Shapes size={14} />
          </div>
          <h2 className="text-sm font-bold tracking-tight text-workspace-900">Canvas Details</h2>
        </div>
        <button type="button" onClick={onClose} title="Close Canvas Details" aria-label="Close Canvas Details" className="rounded-md p-1.5 text-workspace-400 hover:bg-workspace-100 hover:text-workspace-700">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-6 overflow-y-auto p-5 text-xs text-workspace-700">
        <section>
          <h3 className="mb-3 text-xs font-semibold text-workspace-800">Canvas view</h3>
          <button
            type="button"
            role="switch"
            aria-checked={showGrid}
            onClick={onToggleGrid}
            className="flex w-full items-center justify-between rounded-lg py-1 text-left"
          >
            <span className="flex items-center gap-2"><Grid2X2 size={15} className="text-workspace-400" /> Show dot grid</span>
            <span className={`relative h-5 w-9 rounded-full p-0.5 transition-colors ${showGrid ? 'bg-primary-600' : 'bg-workspace-200'}`}>
              <span className={`block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${showGrid ? 'translate-x-4' : ''}`} />
            </span>
          </button>
        </section>

        <section className="border-t border-workspace-100 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-workspace-800">Zoom</h3>
            <span className="font-mono text-workspace-500">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-workspace-200 bg-workspace-50 p-1">
            <button type="button" onClick={onZoomOut} title="Zoom out" className="rounded-md p-2 hover:bg-white"><Minus size={14} /></button>
            <button type="button" onClick={onResetZoom} title="Reset zoom" className="flex-1 rounded-md px-2 py-1.5 font-medium hover:bg-white">Reset</button>
            <button type="button" onClick={onZoomIn} title="Zoom in" className="rounded-md p-2 hover:bg-white"><Plus size={14} /></button>
          </div>
          <button type="button" onClick={onFitToScreen} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-workspace-200 px-3 py-2 font-medium text-workspace-700 hover:bg-workspace-50">
            <Maximize2 size={14} /> Fit content to screen
          </button>
        </section>

        <section className="border-t border-workspace-100 pt-5">
          <button type="button" onClick={onToggleLayers} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 font-medium transition-colors ${isLayersOpen ? 'bg-primary-50 text-primary-700' : 'border border-workspace-200 text-workspace-700 hover:bg-workspace-50'}`}>
            <span className="flex items-center gap-2"><Layers size={15} /> Layers panel</span>
            <span>{isLayersOpen ? 'Open' : 'Closed'}</span>
          </button>
        </section>
      </div>
    </aside>
  );
}
