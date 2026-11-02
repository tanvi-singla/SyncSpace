import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  FileText,
  LayoutGrid,
  Clock,
  Star,
  Users,
  CornerDownLeft,
  ArrowRight,
  Loader2,
  FileUp,
} from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace';
import type { DocumentMeta } from '../../types/dashboard';
import {
  filterSearchResults,
  type SearchTypeFilter,
  type SearchResultItem,
} from '../../utils/searchUtils';
import { formatRelativeTime } from '../../utils/formatTime';

export interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Highlights matches of the query in the text string safely.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) {
    return <span>{text}</span>;
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark
            key={index}
            className="bg-primary-100 text-primary-900 font-semibold rounded-xs px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const { documents, isLoadingDocuments, refreshDocuments } = useWorkspace();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounce query input by 150ms to prevent render stuttering on rapid keystrokes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Refresh workspace documents in background when modal is opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setTypeFilter('all');
      setSelectedIndex(0);
      void refreshDocuments();
      // Auto-focus input on modal opening
      const focusTimer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(focusTimer);
    }
  }, [isOpen, refreshDocuments]);

  // Convert documents map into array
  const allDocumentsList = useMemo(() => {
    return Object.values(documents);
  }, [documents]);

  // Compute matching results using searchUtils
  const searchResults: SearchResultItem[] = useMemo(() => {
    return filterSearchResults(allDocumentsList, debouncedQuery, typeFilter);
  }, [allDocumentsList, debouncedQuery, typeFilter]);

  // Compute total counts for filter tabs
  const filterCounts = useMemo(() => {
    const activeDocs = allDocumentsList.filter((d) => !d.isDeleted);
    return {
      all: activeDocs.length,
      doc: activeDocs.filter((d) => d.type === 'doc').length,
      canvas: activeDocs.filter((d) => d.type === 'canvas').length,
    };
  }, [allDocumentsList]);

  // Reset selected index when results or filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery, typeFilter]);

  // Handle navigating to the selected document
  const handleSelectDocument = useCallback(
    (docId: string) => {
      onClose();
      navigate(`/workspace/${docId}`);
    },
    [navigate, onClose]
  );

  // Handle keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % searchResults.length);
      // Auto-scroll into view if needed
      scrollSelectedItemIntoView((selectedIndex + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
      scrollSelectedItemIntoView((selectedIndex - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = searchResults[selectedIndex];
      if (current) {
        handleSelectDocument(current.document.id);
      }
    }
  };

  const scrollSelectedItemIntoView = (index: number) => {
    if (!listRef.current) return;
    const elements = listRef.current.querySelectorAll('[data-search-item]');
    const target = elements[index] as HTMLElement | undefined;
    if (target) {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  if (!isOpen) return null;

  const isSearching = debouncedQuery.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 p-4 animate-fade-in font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-workspace-200 overflow-hidden flex flex-col max-h-[82vh] animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-workspace-200 gap-3 bg-white shrink-0">
          <Search className="w-5 h-5 text-workspace-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search documents, canvases, or collaborators..."
            className="flex-1 bg-transparent border-none text-sm sm:text-base text-workspace-900 placeholder:text-workspace-400 focus:outline-none focus:ring-0"
            aria-label="Search workspaces"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-workspace-400 hover:text-workspace-700 hover:bg-workspace-100 transition-colors"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center text-[10px] font-semibold text-workspace-400 bg-workspace-100 border border-workspace-200 px-1.5 py-0.5 rounded select-none">
            ESC
          </kbd>
        </div>

        {/* Filter Pills Bar */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-workspace-100 bg-workspace-50/70 shrink-0 text-xs select-none">
          <span className="text-workspace-400 font-medium mr-1 hidden sm:inline">Filter:</span>
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              typeFilter === 'all'
                ? 'bg-primary-600 text-white shadow-xs font-semibold'
                : 'bg-white text-workspace-600 hover:bg-workspace-100 border border-workspace-200'
            }`}
          >
            All ({filterCounts.all})
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('doc')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              typeFilter === 'doc'
                ? 'bg-primary-600 text-white shadow-xs font-semibold'
                : 'bg-white text-workspace-600 hover:bg-workspace-100 border border-workspace-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Documents ({filterCounts.doc})</span>
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('canvas')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              typeFilter === 'canvas'
                ? 'bg-primary-600 text-white shadow-xs font-semibold'
                : 'bg-white text-workspace-600 hover:bg-workspace-100 border border-workspace-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Canvases ({filterCounts.canvas})</span>
          </button>
        </div>

        {/* Results List View */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar min-h-[220px]"
          role="listbox"
        >
          {isLoadingDocuments && allDocumentsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-workspace-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
              <span className="text-xs">Loading workspaces...</span>
            </div>
          ) : searchResults.length === 0 ? (
            /* No Results Found State */
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-workspace-100 text-workspace-400 flex items-center justify-center mb-3">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-workspace-900">
                No results found for &ldquo;{debouncedQuery}&rdquo;
              </p>
              <p className="text-xs text-workspace-500 mt-1 max-w-sm">
                No matching document titles or collaborators. Try adjusting your search query or switching the filter tab.
              </p>
            </div>
          ) : (
            <>
              {/* Header Indicator */}
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-workspace-400 uppercase tracking-wider flex items-center gap-1.5 select-none">
                {isSearching ? (
                  <>
                    <span>Matching Results ({searchResults.length})</span>
                  </>
                ) : (
                  <>
                    <Clock size={12} className="text-workspace-400" />
                    <span>Recently Updated</span>
                  </>
                )}
              </div>

              {/* Items */}
              {searchResults.map((item, index) => {
                const doc = item.document;
                const isSelected = index === selectedIndex;
                const isCanvas = doc.type === 'canvas';
                const isDoc = doc.type === 'doc';
                const isFile = doc.type === 'file';
                const isShared = doc.isShared || doc.permission === 'VIEWER' || doc.permission === 'EDITOR';

                return (
                  <div
                    key={doc.id}
                    data-search-item
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectDocument(doc.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-primary-50/70 border-primary-200 text-workspace-900 shadow-xs'
                        : 'border-transparent hover:bg-workspace-50 text-workspace-700'
                    }`}
                  >
                    {/* Left: Icon & Title info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                          isCanvas
                            ? 'bg-teal-50 border-teal-200 text-teal-700'
                            : isDoc
                            ? 'bg-primary-50 border-primary-200 text-primary-700'
                            : 'bg-amber-50 border-amber-200 text-amber-700'
                        }`}
                      >
                        {isCanvas ? (
                          <LayoutGrid size={18} />
                        ) : isDoc ? (
                          <FileText size={18} />
                        ) : (
                          <FileUp size={18} />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-workspace-900 truncate">
                            <HighlightedText text={doc.title} query={debouncedQuery} />
                          </span>
                          {doc.isFavorite && (
                            <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />
                          )}
                        </div>

                        {/* Badges & Metadata */}
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-workspace-500 flex-wrap">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-medium border ${
                              isCanvas
                                ? 'bg-teal-50/80 text-teal-800 border-teal-200'
                                : 'bg-primary-50/80 text-primary-800 border-primary-200'
                            }`}
                          >
                            {isCanvas ? 'Canvas' : isDoc ? 'Document' : 'File'}
                          </span>

                          {isShared ? (
                            <span className="flex items-center gap-1 text-[11px] text-primary-700">
                              <Users size={11} className="shrink-0" />
                              <span className="truncate">
                                Shared by {doc.owner?.name || 'Collaborator'}
                              </span>
                              <span className="text-[10px] font-semibold uppercase opacity-75">
                                ({doc.permission === 'EDITOR' ? 'Editor' : 'Viewer'})
                              </span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-workspace-400">
                              Owner
                            </span>
                          )}

                          <span>•</span>
                          <span className="text-[11px] text-workspace-400">
                            {formatRelativeTime(doc.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Enter hint on select */}
                    <div className="flex items-center shrink-0">
                      {isSelected ? (
                        <div className="flex items-center gap-1 text-xs text-primary-700 font-semibold bg-white px-2 py-1 rounded-md border border-primary-200 shadow-xs">
                          <span className="hidden sm:inline">Open</span>
                          <CornerDownLeft size={13} />
                        </div>
                      ) : (
                        <ArrowRight size={14} className="text-workspace-300 opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Modal Bottom Keyboard Legend */}
        <div className="px-4 py-2.5 bg-workspace-50 border-t border-workspace-200 flex items-center justify-between text-xs text-workspace-500 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white border border-workspace-200 rounded font-mono text-[10px] shadow-2xs">
                ↑
              </kbd>
              <kbd className="px-1 py-0.5 bg-white border border-workspace-200 rounded font-mono text-[10px] shadow-2xs">
                ↓
              </kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-workspace-200 rounded font-mono text-[10px] shadow-2xs">
                ↵
              </kbd>
              <span>to open</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-workspace-200 rounded font-mono text-[10px] shadow-2xs">
                esc
              </kbd>
              <span>to close</span>
            </span>
          </div>

          <div className="text-[11px] text-workspace-400 font-medium">
            {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SearchModal;

