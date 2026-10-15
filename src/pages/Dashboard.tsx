import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { FileText, Plus, Search, Star, Trash2, LayoutGrid, Users, Upload, FileIcon, Image as ImageIcon, Download, RotateCcw, Clock, Layers, FileUp } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { DocumentCard } from '../components/document/DocumentCard';
import { ShareModal } from '../components/document/ShareModal';
import type { DocumentMeta } from '../types/dashboard';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatRelativeTime(dateMs: number) {
  const diffMs = Date.now() - dateMs;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Working late';
}

export function Dashboard() {
  const { user } = useAuth();
  const {
    documents,
    isLoadingDocuments,
    createItem,
    uploadFile,
    deleteDocument,
    toggleFavorite,
    activeUsersByDoc,
    restoreFromTrash,
    permanentlyDelete,
    emptyTrash,
    updateDocumentTitle,
    refreshDocuments,
  } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sharingDoc, setSharingDoc] = useState<DocumentMeta | null>(null);

  // Sync filter directly from query params so sidebar navigation works seamlessly
  const filterParam = searchParams.get('filter');
  const filter: 'all' | 'canvas' | 'doc' | 'files' | 'favorites' | 'shared' | 'recent' | 'trash' =
    filterParam && ['all', 'canvas', 'doc', 'files', 'favorites', 'shared', 'recent', 'trash'].includes(filterParam)
      ? (filterParam as any)
      : 'all';

  const setFilter = (nextFilter: string) => {
    const updated = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      updated.delete('filter');
    } else {
      updated.set('filter', nextFilter);
    }
    setSearchParams(updated, { replace: true });
  };

  // Re-fetch documents whenever user navigates to the shared filter
  useEffect(() => {
    if (filter === 'shared') {
      void refreshDocuments();
    }
  }, [filter, refreshDocuments]);
  const [isDragging, setIsDragging] = useState(false);

  const [isCreating, setIsCreating] = useState<'canvas' | 'doc' | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateCanvas = async () => {
    if (isCreating) return;
    setIsCreating('canvas');
    setCreateError(null);
    try {
      const id = await createItem('canvas');
      if (!id || typeof id !== 'string') {
        throw new Error('Failed to create canvas: invalid ID returned');
      }
      navigate(`/workspace/${id}`);
    } catch (err: any) {
      console.error('Create canvas error:', err);
      setCreateError(err?.message || 'Failed to create canvas. Please try again.');
    } finally {
      setIsCreating(null);
    }
  };

  const handleCreateDocument = async () => {
    if (isCreating) return;
    setIsCreating('doc');
    setCreateError(null);
    try {
      const id = await createItem('doc');
      if (!id || typeof id !== 'string') {
        throw new Error('Failed to create document: invalid ID returned');
      }
      navigate(`/workspace/${id}`);
    } catch (err: any) {
      console.error('Create document error:', err);
      setCreateError(err?.message || 'Failed to create document. Please try again.');
    } finally {
      setIsCreating(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        await uploadFile(files[i]);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        await uploadFile(files[i]);
      }
    }
  };

  const allDocs = Object.values(documents);

  const filteredDocs = allDocs.filter(doc => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (filter === 'trash') return !!doc.isDeleted;
    if (doc.isDeleted) return false;

    if (filter === 'canvas') return doc.type === 'canvas';
    if (filter === 'doc') return doc.type === 'doc';
    if (filter === 'files') return doc.type === 'file';
    if (filter === 'favorites') return doc.isFavorite;
    if (filter === 'shared') {
      return !!doc.isShared || doc.permission === 'VIEWER' || doc.permission === 'EDITOR';
    }
    return true;
  });


  const recentDocs = [...filteredDocs].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleToggleSelect = (id: string, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === recentDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recentDocs.map(d => d.id)));
    }
  };

  const handleBulkFavorite = () => {
    selectedIds.forEach(id => toggleFavorite(id));
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    selectedIds.forEach(id => deleteDocument(id));
    setSelectedIds(new Set());
  };

  const handleBulkExport = () => {
    const exportData = Array.from(selectedIds).map(id => documents[id]).filter(Boolean);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `syncspace_export_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSelectedIds(new Set());
  };

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, searchQuery]);

  return (
    <div
      className={`flex-1 bg-white overflow-y-auto relative ${isDragging ? 'bg-primary-50/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 border-4 border-primary-500 border-dashed rounded-lg bg-white/50 backdrop-blur-sm flex items-center justify-center pointer-events-none m-4">
          <div className="text-center">
            <Upload size={48} className="text-primary-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-workspace-900">Drop files to upload</h2>
            <p className="text-workspace-500 mt-2">Any file type is supported</p>
          </div>
        </div>
      )}

      <div className="px-8 py-6">
        {/* Top Row: Greeting & Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-workspace-900 mb-1">{getGreeting()}, {user?.name || 'Tanvi'}</h1>
            <p className="text-workspace-500">Welcome back to your local-first workspace</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCreateCanvas}
              disabled={isCreating !== null}
              className="flex items-center justify-center space-x-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCreating === 'canvas' ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <LayoutGrid size={18} />
              )}
              <span>{isCreating === 'canvas' ? 'Creating Canvas...' : 'New Canvas'}</span>
            </button>

            <button
              onClick={handleCreateDocument}
              disabled={isCreating !== null}
              className="flex items-center justify-center space-x-2 bg-white border border-workspace-200 hover:bg-workspace-50 text-workspace-800 px-4 py-2 rounded-md font-medium transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCreating === 'doc' ? (
                <div className="w-4 h-4 border-2 border-workspace-700 border-t-transparent rounded-full animate-spin" />
              ) : (
                <FileText size={18} />
              )}
              <span>{isCreating === 'doc' ? 'Creating Document...' : 'New Document'}</span>
            </button>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              accept="image/*,application/pdf,.txt,.md,.json"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center space-x-2 bg-white border border-workspace-200 hover:bg-workspace-50 text-workspace-800 px-4 py-2 rounded-md font-medium transition-colors shadow-sm"
            >
              <Upload size={18} />
              <span>Upload File</span>
            </button>
          </div>
        </div>

        {createError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 flex items-center justify-between text-sm shadow-xs">
            <span>{createError}</span>
            <button
              onClick={() => setCreateError(null)}
              className="text-red-500 hover:text-red-700 font-bold ml-4 text-base leading-none"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {/* Second Row: Filters & Search */}
        <div className="flex items-center justify-between gap-4 w-full mb-8">
          <div className="inline-flex items-center gap-2 bg-neutral-100/90 p-1.5 rounded-2xl border border-neutral-200/60 overflow-x-auto hide-scrollbar w-full md:w-auto">
            {(['all', 'canvas', 'doc', 'files', 'favorites', 'shared'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all whitespace-nowrap ${filter === f
                  ? 'bg-neutral-900 text-white shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/70'
                  }`}
              >
                {f === 'all' && <Layers className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                {f === 'canvas' && <LayoutGrid className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                {f === 'doc' && <FileText className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                {f === 'files' && <FileUp className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                {f === 'favorites' && <Star className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                {f === 'shared' && <Users className={`w-4 h-4 shrink-0 ${filter === f ? 'text-white' : 'text-neutral-400'}`} />}
                <span className="leading-none">{f === 'doc' ? 'Documents' : f === 'canvas' ? 'Canvases' : f === 'shared' ? 'Shared With Me' : f}</span>
              </button>
            ))}
          </div>

          <div className="relative w-72 md:w-80 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspaces..."
              className="w-full pl-10 pr-10 py-2 bg-white border border-neutral-200 rounded-2xl text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 shadow-xs"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-neutral-400 border border-neutral-200 bg-white text-xs px-1.5 py-0.5 rounded-md font-semibold">
              ⌘K
            </div>
          </div>
        </div>

        {/* Recent Documents */}
        <div>
          {filter === 'trash' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center justify-between">
              <div className="text-red-700 text-sm">
                Items in trash are stored locally. You can restore them or delete them permanently.
              </div>
              <button
                onClick={() => {
                  if (window.confirm('Empty trash? This cannot be undone.')) emptyTrash();
                }}
                className="text-red-700 font-medium text-sm hover:text-red-800 bg-white px-3 py-1.5 rounded-md border border-red-200 shadow-sm"
              >
                Empty Trash
              </button>
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-workspace-500 uppercase tracking-wider">
              {searchQuery ? 'Search Results' : filter === 'all' ? 'Recent Workspaces' : `Filtered: ${filter}`}
            </h2>
            {recentDocs.length > 0 && (
              <button
                onClick={handleSelectAll}
                className="text-xs font-medium text-workspace-500 hover:text-workspace-900 transition-colors"
              >
                {selectedIds.size === recentDocs.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-6">
            {recentDocs.length === 0 && allDocs.length > 0 && (
              <div className="text-workspace-500 text-sm py-4 col-span-3">No documents found matching your criteria.</div>
            )}

            {recentDocs.map(doc => {
              const activeUsers = activeUsersByDoc[doc.id] || [];
              return (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  filter={filter}
                  activeUsers={activeUsers}
                  selected={selectedIds.has(doc.id)}
                  showSelection={selectedIds.size > 0}
                  onToggleSelect={handleToggleSelect}
                  onToggleFavorite={toggleFavorite}
                  onDelete={deleteDocument}
                  onRestore={restoreFromTrash}
                  onPermanentlyDelete={permanentlyDelete}
                  onUpdateTitle={updateDocumentTitle}
                  onShare={(d) => setSharingDoc(d)}
                />
              );
            })}

          </div>

          {isLoadingDocuments && (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center space-x-3 text-workspace-400">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm">Loading workspaces...</span>
              </div>
            </div>
          )}

          {!isLoadingDocuments && allDocs.length === 0 && filter !== 'shared' && filter !== 'trash' && (
            <div className="flex flex-col items-center justify-center p-12 mt-4 bg-workspace-50 border border-workspace-200 border-dashed rounded-xl">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <LayoutGrid className="text-workspace-400" size={32} />
              </div>
              <h3 className="text-lg font-medium text-workspace-900 mb-1">No workspaces yet</h3>
              <p className="text-sm text-workspace-500 mb-6 text-center max-w-sm">
                Create your first Canvas or Document to get started.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleCreateCanvas}
                  disabled={isCreating !== null}
                  className="flex items-center justify-center space-x-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreating === 'canvas' ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Plus size={18} />
                  )}
                  <span>{isCreating === 'canvas' ? 'Creating Canvas...' : 'New Canvas'}</span>
                </button>
                <button
                  onClick={handleCreateDocument}
                  disabled={isCreating !== null}
                  className="flex items-center justify-center space-x-2 bg-white border border-workspace-200 hover:bg-workspace-50 text-workspace-800 px-4 py-2 rounded-md font-medium transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreating === 'doc' ? (
                    <div className="w-4 h-4 border-2 border-workspace-700 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <FileText size={18} />
                  )}
                  <span>{isCreating === 'doc' ? 'Creating Document...' : 'New Document'}</span>
                </button>
              </div>
            </div>
          )}

          {!isLoadingDocuments && recentDocs.length === 0 && filter === 'shared' && (
            <div className="flex flex-col items-center justify-center p-12 mt-4 bg-workspace-50 border border-workspace-200 border-dashed rounded-xl">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <Users className="text-workspace-400" size={32} />
              </div>
              <h3 className="text-lg font-medium text-workspace-900 mb-1">No shared documents yet</h3>
              <p className="text-sm text-workspace-500 text-center max-w-sm">
                Documents and canvases shared with you by other registered users will appear here.
              </p>
            </div>
          )}

          {allDocs.length > 0 && recentDocs.length === 0 && filter === 'trash' && (
            <div className="flex flex-col items-center justify-center p-12 mt-4 bg-workspace-50 border border-workspace-200 border-dashed rounded-xl">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <Trash2 className="text-workspace-400" size={32} />
              </div>
              <h3 className="text-lg font-medium text-workspace-900 mb-1">Trash is empty</h3>
              <p className="text-sm text-workspace-500 text-center max-w-sm">
                Deleted documents and canvases will appear here.
              </p>
            </div>
          )}

          {allDocs.length > 0 && recentDocs.length === 0 && filter === 'favorites' && (
            <div className="flex flex-col items-center justify-center p-12 mt-4 bg-workspace-50 border border-workspace-200 border-dashed rounded-xl">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center shadow-sm mb-4">
                <Star className="text-amber-400" size={32} />
              </div>
              <h3 className="text-lg font-medium text-workspace-900 mb-1">No favorite items yet</h3>
              <p className="text-sm text-workspace-500 text-center max-w-sm">
                Click the star icon on any document or canvas to pin it here for quick access.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center bg-neutral-900 text-white rounded-2xl shadow-2xl px-4 py-3 gap-4 border border-neutral-700 animate-in slide-in-from-bottom-8">
          <div className="text-sm font-medium border-r border-neutral-700 pr-4">
            {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleBulkFavorite} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-sm font-medium">
              <Star size={16} /> Favorite
            </button>
            <button onClick={handleBulkExport} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-sm font-medium">
              <Download size={16} /> Export
            </button>
            <button onClick={handleBulkDelete} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-red-900/50 text-red-400 transition-colors text-sm font-medium">
              <Trash2 size={16} /> Delete
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="ml-2 p-1.5 rounded-full hover:bg-neutral-800 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      {/* Share Modal */}
      <ShareModal
        isOpen={!!sharingDoc}
        onClose={() => {
          setSharingDoc(null);
          void refreshDocuments();
        }}
        documentId={sharingDoc?.id}
        documentTitle={sharingDoc?.title}
      />
    </div>
  );

}
