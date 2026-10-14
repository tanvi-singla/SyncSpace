import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, 
  Pencil, 
  Check, 
  RotateCcw, 
  RotateCw, 
  Share2, 
  MoreHorizontal, 
  Cloud, 
  Download, 
  Upload, 
  Trash2, 
  Grid, 
  Maximize2,
  Users,
  Shapes,
  PanelRight,
  PanelRightClose,
  Copy,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { UserPresence } from '../../types/canvas';
import { MOCK_USERS, CURRENT_USER_ID } from '../../data/mockData';
import { ShareModal } from '../document/ShareModal';

interface CanvasTopBarProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  saveStatus: 'saved' | 'saving' | 'synced';
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  remoteUsers: UserPresence[];
  currentUser: { name: string; color: string; avatarUrl?: string };
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onClearCanvas: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  onOpenHelpModal: () => void;
  documentId?: string;
  isOwner?: boolean;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}


export const CanvasTopBar: React.FC<CanvasTopBarProps> = ({
  title,
  onUpdateTitle,
  saveStatus,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  remoteUsers,
  currentUser,
  onExportPNG,
  onExportSVG,
  onExportJSON,
  onImportJSON,
  onClearCanvas,
  onResetZoom,
  onFitToScreen,
  showGrid,
  onToggleGrid,
  onOpenHelpModal,
  documentId,
  isOwner,
  permission,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const navigate = useNavigate();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(title);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitleValue(title);
  }, [title]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (editTitleValue.trim() && editTitleValue !== title) {
      onUpdateTitle(editTitleValue.trim());
    } else {
      setEditTitleValue(title);
    }
  };

  const handleShareCopy = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2500);
  };

  const activeCollaborators = Object.values(MOCK_USERS).filter(
    (u) => u.id !== CURRENT_USER_ID && u.isOnline
  );

  return (
    <>
      <header className="h-14 border-b border-workspace-200 flex items-center justify-between gap-2 px-3 sm:px-4 bg-white/80 backdrop-blur-md z-30 relative sticky top-0 shadow-sm select-none">
        {/* Left Section: Breadcrumb & Editable Title */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 text-sm">
          <button
            type="button"
            onClick={onToggleSidebar}
            title={isSidebarOpen ? 'Hide Canvas Details' : 'Show Canvas Details'}
            aria-label={isSidebarOpen ? 'Hide Canvas Details' : 'Show Canvas Details'}
            aria-pressed={isSidebarOpen}
            className={`shrink-0 p-2 rounded-lg transition-colors ${isSidebarOpen ? 'bg-primary-50 text-primary-700' : 'text-workspace-500 hover:bg-workspace-100'}`}
          >
            {isSidebarOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="w-9 h-9 shrink-0 flex items-center justify-center border border-workspace-200 text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            title="Return to Dashboard"
            aria-label="Return to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <span className="h-6 w-px bg-workspace-200 shrink-0" aria-hidden="true" />
          <Shapes className="w-4 h-4 shrink-0 text-primary-600" />

          {/* Editable Canvas Title */}
          <div className="flex min-w-0 items-center space-x-1.5 group">
            {isEditingTitle ? (
              <div className="flex items-center space-x-1">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleTitleSubmit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSubmit();
                    if (e.key === 'Escape') {
                      setIsEditingTitle(false);
                      setEditTitleValue(title);
                    }
                  }}
                  className="font-semibold text-workspace-900 px-2 py-0.5 border border-primary-500 rounded bg-white outline-none shadow-xs text-sm"
                />
                <button
                  onClick={handleTitleSubmit}
                  className="p-1 text-primary-600 hover:bg-primary-50 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="flex min-w-0 items-center space-x-1.5 rounded hover:bg-workspace-100 transition-colors text-left"
                title="Click to rename canvas"
              >
                <span className="font-semibold text-workspace-900 truncate max-w-[64px] sm:max-w-[140px] md:max-w-xs">
                  {title || 'Untitled Canvas'}
                </span>
                <Pencil className="w-3.5 h-3.5 text-workspace-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
        </div>

        {/* Center: Undo & Redo Controls */}
        <div className="hidden md:flex items-center bg-workspace-100 p-1 rounded-lg border border-workspace-200/80 space-x-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded transition-colors ${
              canUndo
                ? 'text-workspace-700 hover:bg-white hover:text-workspace-900 shadow-2xs'
                : 'text-workspace-300 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded transition-colors ${
              canRedo
                ? 'text-workspace-700 hover:bg-white hover:text-workspace-900 shadow-2xs'
                : 'text-workspace-300 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Right Section: Sync Badge, Collaborators, Share & More Menu */}
        <div className="flex shrink-0 items-center space-x-1 sm:space-x-2">
          {/* Sync / Save Status Badge */}
          <div
            className={`flex items-center space-x-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
              saveStatus === 'saving'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            <Cloud
              size={13}
              className={saveStatus === 'saving' ? 'animate-pulse text-amber-500' : 'text-emerald-500'}
            />
            <span className="hidden sm:inline capitalize">{saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Synced'}</span>
          </div>

          {/* Collaborator Avatars & Live Peers */}
          <div className="flex items-center -space-x-1.5">
            {remoteUsers.length > 0 ? (
              remoteUsers.slice(0, 2).map((user) => (
                <div
                  key={user.clientId}
                  className="relative group cursor-pointer"
                  title={`${user.name} (Active peer)`}
                >
                  <div
                    className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[11px] font-bold text-white shadow-xs"
                    style={{ backgroundColor: user.color || '#00667E' }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
                </div>
              ))
            ) : (
              activeCollaborators.map((user) => (
                <div
                  key={user.id}
                  className="relative group cursor-pointer"
                  title={`${user.name} (Online)`}
                >
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="w-7 h-7 rounded-full border-2 border-white bg-workspace-200 object-cover shadow-xs"
                  />
                  <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
                </div>
              ))
            )}

            {/* Current Local User Avatar */}
            <div className="relative cursor-pointer ml-1" title={`${currentUser.name} (You)`}>
              <div
                className="w-7 h-7 rounded-full border-2 border-primary-500 bg-primary-600 text-white flex items-center justify-center text-[11px] font-bold shadow-xs"
              >
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Count pill */}
            <div className="pl-2 text-xs font-semibold text-workspace-500">
              {remoteUsers.length + 1}
            </div>
          </div>

          {/* Share Button (Owner only) or Permission Badge */}
          {isOwner !== false ? (
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="h-8 flex items-center space-x-1.5 bg-primary-600 hover:bg-primary-700 text-white px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>
          ) : (
            <div className="px-2.5 py-1 rounded-lg text-xs font-medium bg-workspace-100 text-workspace-700 border border-workspace-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-500"></span>
              <span>{permission === 'VIEWER' ? 'Viewer' : 'Editor'}</span>
            </div>
          )}


          {/* More Options Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-1.5 text-workspace-600 hover:text-workspace-900 hover:bg-workspace-100 rounded-lg transition-colors border border-workspace-200"
              title="More Canvas Options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="absolute right-0 top-9 w-56 bg-white border border-workspace-200 rounded-xl shadow-dropdown py-1.5 z-50 text-xs text-workspace-700 animate-fade-in">
                  <div className="px-3 py-1 text-[11px] font-bold text-workspace-400 uppercase tracking-wider">
                    Export / Import
                  </div>
                  <button
                    onClick={() => {
                      onExportPNG();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Download className="w-4 h-4 text-primary-600" />
                    <span>Export as PNG Image</span>
                  </button>
                  <button
                    onClick={() => {
                      onExportSVG();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Download className="w-4 h-4 text-indigo-600" />
                    <span>Export as SVG Vector</span>
                  </button>
                  <button
                    onClick={() => {
                      onExportJSON();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Download className="w-4 h-4 text-emerald-600" />
                    <span>Export as JSON</span>
                  </button>
                  <button
                    onClick={() => {
                      onImportJSON();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Upload className="w-4 h-4 text-workspace-600" />
                    <span>Import JSON Data</span>
                  </button>

                  <div className="my-1 border-t border-workspace-100" />

                  <div className="px-3 py-1 text-[11px] font-bold text-workspace-400 uppercase tracking-wider">
                    View & Grid
                  </div>
                  <button
                    onClick={() => {
                      onToggleGrid();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Grid className="w-4 h-4 text-workspace-600" />
                    <span>{showGrid ? 'Hide Dot Grid' : 'Show Dot Grid'}</span>
                  </button>
                  <button
                    onClick={() => {
                      onResetZoom();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Maximize2 className="w-4 h-4 text-workspace-600" />
                    <span>Reset Zoom to 100%</span>
                  </button>
                  <button
                    onClick={() => {
                      onFitToScreen();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Maximize2 className="w-4 h-4 text-workspace-600" />
                    <span>Fit Content to Screen</span>
                  </button>

                  <div className="my-1 border-t border-workspace-100" />

                  <button
                    onClick={() => {
                      onOpenHelpModal();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-workspace-50 flex items-center space-x-2 transition-colors"
                  >
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Keyboard Shortcuts (?)</span>
                  </button>

                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all canvas objects?')) {
                        onClearCanvas();
                      }
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 flex items-center space-x-2 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear Entire Canvas</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Share Modal Dialog */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        documentId={documentId}
        documentTitle={title}
      />

    </>
  );
};
