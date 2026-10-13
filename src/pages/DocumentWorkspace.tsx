import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import {
  Image as ImageIcon,
  PlusCircle,
  CheckCircle2,
  HelpCircle,
  ChevronDown,
  User,
  Users,
  Calendar,
  Plus,
  Trash2,
  Check,
  Quote,
  Heading1,
  Heading2,
  CheckSquare,
  List,
  Layers,
  ArrowRight,
  FileText
} from 'lucide-react';
import {
  FontFamily,
  FontSize,
  PageWidth,
  HeaderToggles,
  BlockType,
  DocumentBlock
} from '../types/documentTheme';
import { DocumentFormattingBar } from '../components/DocumentFormattingBar';
import { DocumentInspector } from '../components/DocumentInspector';
import { SlashCommandMenu, SlashCommandItem } from '../components/SlashCommandMenu';
import { useParams } from 'react-router-dom';
import { CoverPickerModal } from '../components/document/CoverPickerModal';
import { useWorkspace } from '../hooks/useWorkspace';
import { useDocumentUI } from '../context/DocumentUIContext';
import { useDocumentYjs } from '../hooks/useDocumentYjs';
import { useAuth } from '../context/AuthContext';

export interface DocumentWorkspaceProps {
  workspaceState?: ReturnType<typeof useWorkspace>;
  showTopBar?: boolean;
  documentId?: string;
}

export function DocumentWorkspace({ workspaceState, showTopBar = false, documentId }: DocumentWorkspaceProps) {
  const { id: routeDocId } = useParams<{ id: string }>();
  const currentDocId = documentId || workspaceState?.currentDocId || routeDocId || '';
  const currentDocMeta = currentDocId && workspaceState?.documents ? workspaceState.documents[currentDocId] : undefined;
  const docUI = useDocumentUI();
  const { user } = useAuth();

  // Document Title & Core State
  const [docTitle, setDocTitle] = useState(currentDocMeta?.title || 'Untitled Document');
  const [docIcon, setDocIcon] = useState<string | null>(null);
  const [hasCover, setHasCover] = useState(false);
  const [coverUrl, setCoverUrl] = useState(
    'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=1600&q=80'
  );

  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Role permissions: VIEWERS cannot edit
  const isViewer = currentDocMeta?.permission === 'VIEWER';
  const isReadOnly = isLocked || isViewer;

  // Subpages state
  const [subpages, setSubpages] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (currentDocMeta?.title) {
      setDocTitle(currentDocMeta.title);
    }
  }, [currentDocMeta?.title]);

  // Load saved preferences if available
  useEffect(() => {
    try {
      const saved = localStorage.getItem('syncspace_doc_theme');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fontFamily) docUI.setFontFamily(parsed.fontFamily);
        if (parsed.fontSize) docUI.setFontSize(parsed.fontSize);
        if (parsed.pageWidth) docUI.setPageWidth(parsed.pageWidth);
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  // Yjs CRDT Document Synchronization Hook (Single source of truth)
  const {
    blocks,
    updateBlock,
    addBlock,
    deleteBlock,
    toggleChecklist,
    connectionStatus,
    isIndexedDbSynced,
    collaborators,
  } = useDocumentYjs({
    documentId: currentDocId,
    user: user
      ? {
          id: user.id,
          name: user.name,
          color: '#00667E',
        }
      : undefined,
  });

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  // Block handlers delegating directly to Yjs transactions
  const handleUpdateBlock = (id: string, content: string, extra?: Partial<DocumentBlock>) => {
    updateBlock(id, content, extra);
  };

  const handleAddBlock = (type: BlockType = 'paragraph', afterId?: string): string => {
    return addBlock(type, afterId);
  };

  const handleDeleteBlock = (id: string) => {
    deleteBlock(id);
  };

  const handleToggleCheck = (id: string) => {
    toggleChecklist(id);
  };

  const handleTitleChange = (newTitle: string) => {
    setDocTitle(newTitle);
    if (currentDocId && workspaceState?.updateDocumentTitle) {
      workspaceState.updateDocumentTitle(currentDocId, newTitle);
    }
  };

  const handleBlockKeyDown = (e: React.KeyboardEvent, blockId: string) => {
    if (e.key === '/') {
      setSlashMenuOpen(true);
      setSlashBlockId(blockId);
      setSlashIndex(0);
    } else if (e.key === 'Enter' && !e.shiftKey && !slashMenuOpen) {
      e.preventDefault();
      const newBlockId = handleAddBlock('paragraph', blockId);
      if (newBlockId) {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-block-id="${newBlockId}"]`) as HTMLElement;
          if (el) el.focus();
        });
      }
    }
  };

  const handleSelectSlashItem = (item: SlashCommandItem) => {
    if (!slashBlockId) return;
    const current = blocks.find(b => b.id === slashBlockId);
    if (current && (current.content.trim() === '/' || current.content.trim() === '')) {
      handleUpdateBlock(slashBlockId, '', { type: item.type });
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-block-id="${slashBlockId}"]`) as HTMLElement;
        if (el) el.focus();
      });
    } else {
      const newBlockId = handleAddBlock(item.type, slashBlockId);
      if (newBlockId) {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-block-id="${newBlockId}"]`) as HTMLElement;
          if (el) el.focus();
        });
      }
    }
    setSlashMenuOpen(false);
    setSlashBlockId(null);
  };

  // React to signals from top formatting bar (e.g. adding tasks or quotes)
  useEffect(() => {
    if (docUI.addBlockSignal) {
      handleAddBlock(docUI.addBlockSignal.type);
    }
  }, [docUI.addBlockSignal]);

  // Typography styles synced from docUI
  const fontClass =
    docUI.fontFamily === 'serif' ? 'font-serif' : docUI.fontFamily === 'mono' ? 'font-mono' : 'font-sans';

  const fontScaleClass =
    docUI.fontSize === 'small' ? 'text-sm' : docUI.fontSize === 'large' ? 'text-lg' : 'text-base';

  const widthClass = docUI.pageWidth === 'large' ? 'max-w-5xl' : 'max-w-3xl';

  // Word count calculation
  const wordCount = useMemo(() => {
    return blocks.reduce((acc, b) => {
      const words = b.content.trim().split(/\s+/).filter(Boolean);
      return acc + words.length;
    }, 0);
  }, [blocks]);

  useEffect(() => {
    docUI.setWordCount(wordCount);
  }, [wordCount]);

  const { headerToggles } = docUI;

  // Zoom scale percentage
  const zoomScale = useMemo(() => {
    const val = parseInt(docUI.zoomLevel.replace('%', ''), 10);
    return isNaN(val) ? 1 : val / 100;
  }, [docUI.zoomLevel]);

  // Handle adding subpage
  const handleAddSubpage = () => {
    const title = prompt('Enter subpage title:') || 'Untitled Subpage';
    setSubpages(prev => [...prev, { id: `sp_${Date.now()}`, title }]);
  };

  // Scroll to block ID from outline
  const handleScrollToBlock = (id: string) => {
    const el = document.getElementById(`block-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white text-workspace-900 overflow-hidden font-sans select-text">
      
      {/* Document Formatting Bar directly on top of document */}
      <DocumentFormattingBar
        documentId={currentDocId}
        documentTitle={docTitle}
        isOwner={!currentDocMeta?.isShared && (!currentDocMeta?.permission || currentDocMeta?.permission === 'OWNER')}
        permission={currentDocMeta?.permission || 'OWNER'}
      />


      {/* Main Document Writing Surface & Right Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Main Document Scrollable Canvas */}
        <div className="flex-1 overflow-y-auto px-8 sm:px-16 md:px-24 py-10 bg-white custom-scrollbar h-full">
          
          <div
            className={`mx-auto ${widthClass} transition-all duration-200`}
            style={{
              transform: zoomScale !== 1 ? `scale(${zoomScale})` : undefined,
              transformOrigin: 'top center',
            }}
          >
            
            {/* Cover Image Banner (if enabled in inspector & active) */}
            {headerToggles.coverImage && hasCover && (
              <div className="relative group h-48 sm:h-56 w-full rounded-2xl overflow-hidden mb-6 border border-workspace-100 shadow-xs cursor-pointer">
                <img
                  src={coverUrl}
                  alt="Cover"
                  onClick={() => setIsCoverPickerOpen(true)}
                  className="w-full h-full object-cover object-center group-hover:brightness-95 transition-all"
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setIsCoverPickerOpen(true)}
                    className="px-2.5 py-1 text-xs bg-black/60 hover:bg-black/80 text-white rounded-md backdrop-blur-xs transition-colors cursor-pointer"
                  >
                    Change cover
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasCover(false)}
                    className="px-2.5 py-1 text-xs bg-black/60 hover:bg-black/80 text-white rounded-md backdrop-blur-xs transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            {/* Header Action Buttons (Add cover / Add icon) */}
            <div className="flex items-center gap-4 text-xs text-workspace-400 font-medium mb-3 select-none">
              {headerToggles.coverImage && !hasCover && (
                <button
                  type="button"
                  onClick={() => {
                    setHasCover(true);
                    setIsCoverPickerOpen(true);
                  }}
                  className="flex items-center gap-1.5 hover:text-workspace-700 transition-colors cursor-pointer"
                >
                  <ImageIcon size={14} />
                  <span>Add cover</span>
                </button>
              )}

              {headerToggles.pageTitleIcon && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className="flex items-center gap-1.5 hover:text-workspace-700 transition-colors cursor-pointer"
                  >
                    {docIcon ? (
                      <span className="text-xl">{docIcon}</span>
                    ) : (
                      <>
                        <PlusCircle size={14} />
                        <span>Add icon</span>
                      </>
                    )}
                  </button>

                  {showIconPicker && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowIconPicker(false)} />
                      <div className="absolute left-0 mt-2 z-50 w-56 bg-white rounded-2xl shadow-xl border border-workspace-200 p-3 animate-fade-in font-sans">
                        <div className="text-[11px] font-semibold text-workspace-400 uppercase tracking-wider mb-2">
                          Select an icon
                        </div>
                        <div className="grid grid-cols-5 gap-1 text-xl">
                          {['📄', '🌾', '💡', '🚀', '📝', '⚡', '🎨', '✨', '🔥', '📚', '🎯', '🛠', '📊', '💼', '🌟'].map(em => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => {
                                setDocIcon(em);
                                setShowIconPicker(false);
                              }}
                              className="h-9 flex items-center justify-center rounded-lg hover:bg-workspace-100 transition-colors cursor-pointer"
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                        {docIcon && (
                          <div className="mt-2 pt-2 border-t border-workspace-100 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setDocIcon(null);
                                setShowIconPicker(false);
                              }}
                              className="text-[11px] text-rose-600 hover:underline cursor-pointer"
                            >
                              Remove icon
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Document Title Heading */}
            {headerToggles.pageTitleIcon && (
              <h1
                contentEditable={!isReadOnly}
                suppressContentEditableWarning
                onBlur={e => handleTitleChange(e.currentTarget.textContent || 'Untitled Document')}
                className={`text-4xl sm:text-5xl font-extrabold text-workspace-900 tracking-tight outline-none mb-3 ${fontClass} empty:before:content-['Untitled_Document'] empty:before:text-workspace-300`}
              >
                {docTitle}
              </h1>
            )}

            {/* Subtitle (if enabled in inspector) */}
            {headerToggles.subtitle && (
              <div className="mb-4">
                <input
                  type="text"
                  disabled={isReadOnly}
                  placeholder="Add a subtitle..."
                  value={subtitle}
                  onChange={e => setSubtitle(e.target.value)}
                  className="w-full text-base text-workspace-500 placeholder-workspace-300 outline-none font-medium bg-transparent disabled:opacity-75"
                />
              </div>
            )}

            {/* Metadata Row: Author, Contributors, Date */}
            {(headerToggles.author || headerToggles.contributors || headerToggles.date) && (
              <div className="flex items-center gap-5 text-xs text-workspace-400 font-medium mb-8 pb-3 border-b border-workspace-100">
                {headerToggles.author && (
                  <div className="flex items-center gap-1.5">
                    <User size={13} className="text-workspace-400" />
                    <span className="text-workspace-600">Tanvi</span>
                  </div>
                )}
                {headerToggles.contributors && (
                  <div className="flex items-center gap-1.5">
                    <Users size={13} className="text-workspace-400" />
                    <span>2 contributors</span>
                  </div>
                )}
                {headerToggles.date && (
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-workspace-400" />
                    <span>Sep 9, 2026</span>
                  </div>
                )}
              </div>
            )}

            {/* Interactive Page Outline Table of Contents */}
            {headerToggles.pageOutline && (
              <div className="mb-6 p-4 rounded-xl bg-primary-50/40 border border-primary-100 text-xs font-sans">
                <div className="font-semibold text-primary-900 mb-2 flex items-center gap-1.5">
                  <List size={14} className="text-primary-600" />
                  <span>Page Outline</span>
                </div>
                <div className="space-y-1.5 pl-2 border-l-2 border-primary-500">
                  <div
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="font-medium text-workspace-700 hover:text-primary-700 cursor-pointer"
                  >
                    {docTitle}
                  </div>
                  {blocks
                    .filter(b => b.type === 'heading1' || b.type === 'heading2')
                    .map(b => (
                      <div
                        key={b.id}
                        onClick={() => handleScrollToBlock(b.id)}
                        className={`hover:text-primary-700 cursor-pointer truncate ${
                          b.type === 'heading2' ? 'pl-3 text-workspace-500' : 'text-workspace-700 font-medium'
                        }`}
                      >
                        {b.content || 'Untitled Section'}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Interactive Subpages Widget */}
            {headerToggles.subpages && (
              <div className="mb-6 p-4 rounded-xl bg-workspace-50 border border-workspace-200 text-xs font-sans">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-workspace-800 flex items-center gap-1.5">
                    <Layers size={14} className="text-primary-600" />
                    <span>Subpages ({subpages.length})</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSubpage}
                    className="text-primary-600 hover:text-primary-700 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={13} />
                    <span>Add subpage</span>
                  </button>
                </div>

                {subpages.length === 0 ? (
                  <div className="text-workspace-400 italic">
                    No subpages attached yet. Click "+ Add subpage" to create one.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {subpages.map(sp => (
                      <div
                        key={sp.id}
                        onClick={() => alert(`Navigating to subpage: ${sp.title}`)}
                        className="p-2.5 bg-white rounded-lg border border-workspace-200 hover:border-primary-400 flex items-center justify-between group cursor-pointer transition-all shadow-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText size={14} className="text-primary-600 shrink-0" />
                          <span className="font-medium text-workspace-800 truncate">{sp.title}</span>
                        </div>
                        <ArrowRight size={13} className="text-workspace-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Interactive Block Content Canvas */}
            <div className={`space-y-3 min-h-[420px] ${fontClass} ${fontScaleClass}`}>
              {blocks.map(block => (
                <div key={block.id} id={`block-${block.id}`} className="relative group/block flex items-start -ml-8">
                  
                  {/* Hover Actions: Plus and Delete */}
                  {!isReadOnly && (
                    <div className="w-8 flex items-center justify-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity pt-1 select-none pr-1">
                      <button
                        type="button"
                        onClick={() => handleAddBlock('paragraph', block.id)}
                        title="Add block below"
                        className="p-1 rounded hover:bg-workspace-100 text-workspace-400 hover:text-workspace-700 transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBlock(block.id)}
                        title="Delete block"
                        className="p-1 rounded hover:bg-rose-50 text-workspace-400 hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}

                  {/* Block Content Node */}
                  <div className="flex-1 min-w-0 relative">
                    <DocumentBlockView
                      block={block}
                      isLocked={isReadOnly}
                      onUpdateBlock={handleUpdateBlock}
                      onToggleCheck={handleToggleCheck}
                      onKeyDown={handleBlockKeyDown}
                    />

                    {/* Slash Command Menu Popup */}
                    {slashMenuOpen && slashBlockId === block.id && !isReadOnly && (
                      <SlashCommandMenu
                        isOpen={slashMenuOpen}
                        onClose={() => setSlashMenuOpen(false)}
                        onSelect={handleSelectSlashItem}
                        selectedIndex={slashIndex}
                        setSelectedIndex={setSlashIndex}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>

        </div>

        {/* Page Details Inspector Component (Right Side) */}
        <DocumentInspector
          isLocked={isLocked}
          onToggleLock={() => setIsLocked(!isLocked)}
        />

      </div>

      {/* Cover Image Picker Modal */}
      <CoverPickerModal
        isOpen={isCoverPickerOpen}
        onClose={() => setIsCoverPickerOpen(false)}
        currentCoverUrl={coverUrl}
        onSelectCover={url => {
          setCoverUrl(url);
          setHasCover(true);
        }}
        onRemoveCover={() => setHasCover(false)}
      />

      {/* Bottom Status Bar matching screenshot */}
      <footer className="h-9 border-t border-workspace-200 px-5 bg-white flex items-center justify-between text-xs text-workspace-500 select-none shrink-0 z-20 font-sans">
        <div className="flex items-center gap-2">
          <span>{wordCount} words</span>
          <span>•</span>
          <div className="flex items-center gap-1 text-workspace-600 font-medium">
            <span>
              {isIndexedDbSynced
                ? connectionStatus === 'connected'
                  ? 'Synced live'
                  : 'Saved offline'
                : 'Saving...'}
            </span>
            <CheckCircle2
              size={14}
              className={
                connectionStatus === 'connected'
                  ? 'text-emerald-500 fill-emerald-50'
                  : 'text-amber-500 fill-amber-50'
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowZoomMenu(!showZoomMenu)}
              className="flex items-center gap-1 hover:text-workspace-800 cursor-pointer"
            >
              <span>{docUI.zoomLevel}</span>
              <ChevronDown size={12} />
            </button>
            {showZoomMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowZoomMenu(false)} />
                <div className="absolute right-0 bottom-full mb-1 z-40 w-24 bg-white border border-workspace-200 rounded-lg shadow-lg py-1 text-xs font-sans">
                  {['75%', '90%', '100%', '125%', '150%'].map(z => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => {
                        docUI.setZoomLevel(z);
                        setShowZoomMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1 hover:bg-workspace-100 cursor-pointer ${
                        docUI.zoomLevel === z ? 'text-primary-700 font-semibold' : 'text-workspace-700'
                      }`}
                    >
                      {z}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            title="Help & shortcuts"
            onClick={() => alert('Keyboard Shortcuts:\n• / : Open slash command menu\n• Enter : New paragraph\n• Shift+Enter : Line break\n• Ctrl+B : Bold\n• Ctrl+I : Italic')}
            className="hover:text-workspace-800 transition-colors cursor-pointer"
          >
            <HelpCircle size={14} />
          </button>
        </div>
      </footer>

    </div>
  );
}

interface DocumentBlockViewProps {
  block: DocumentBlock;
  isLocked: boolean;
  onUpdateBlock: (id: string, content: string, extra?: Partial<DocumentBlock>) => void;
  onToggleCheck: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void;
}

const DocumentBlockView: React.FC<DocumentBlockViewProps> = React.memo(({
  block,
  isLocked,
  onUpdateBlock,
  onToggleCheck,
  onKeyDown,
}) => {
  const contentRef = useRef<HTMLElement | null>(null);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      contentRef.current = node;
      if (node && node.textContent !== block.content && document.activeElement !== node) {
        node.textContent = block.content;
      }
    },
    [block.content]
  );

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (document.activeElement === el) {
      if (el.textContent === block.content) return;

      const sel = window.getSelection();
      let offset = 0;
      if (sel && sel.rangeCount > 0) {
        offset = sel.getRangeAt(0).startOffset;
      }

      el.textContent = block.content;

      if (sel && el.firstChild) {
        try {
          const range = document.createRange();
          const safeOffset = Math.min(offset, el.firstChild.textContent?.length || 0);
          range.setStart(el.firstChild, safeOffset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {
          // Graceful fallback
        }
      }
    } else {
      if (el.textContent !== block.content) {
        el.textContent = block.content;
      }
    }
  }, [block.content, block.type]);

  const handleInput = (e: React.FormEvent<HTMLElement>) => {
    const text = e.currentTarget.textContent || '';
    onUpdateBlock(block.id, text);
  };

  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    const text = e.currentTarget.textContent || '';
    onUpdateBlock(block.id, text);
  };

  switch (block.type) {
    case 'heading1':
      return (
        <h2
          ref={setRef}
          data-block-id={block.id}
          contentEditable={!isLocked}
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onKeyDown={e => onKeyDown(e, block.id)}
          className="text-2xl sm:text-3xl font-bold text-workspace-900 mt-5 mb-2 outline-none empty:before:content-['Heading_1'] empty:before:text-workspace-300"
        />
      );

    case 'heading2':
      return (
        <h3
          ref={setRef}
          data-block-id={block.id}
          contentEditable={!isLocked}
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onKeyDown={e => onKeyDown(e, block.id)}
          className="text-xl sm:text-2xl font-bold text-workspace-800 mt-4 mb-1.5 outline-none empty:before:content-['Heading_2'] empty:before:text-workspace-300"
        />
      );

    case 'checklist':
      return (
        <div className="flex items-start gap-2.5 my-1">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => onToggleCheck(block.id)}
            className={`mt-1 w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
              block.checked
                ? 'bg-primary-600 border-primary-600 text-white'
                : 'border-workspace-300 hover:border-workspace-400 bg-white'
            }`}
          >
            {block.checked && <Check size={11} strokeWidth={3} />}
          </button>
          <div
            ref={setRef}
            data-block-id={block.id}
            contentEditable={!isLocked}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={handleBlur}
            onKeyDown={e => onKeyDown(e, block.id)}
            className={`flex-1 outline-none text-workspace-800 leading-relaxed ${
              block.checked ? 'line-through text-workspace-400' : ''
            } empty:before:content-['To-do...'] empty:before:text-workspace-300`}
          />
        </div>
      );

    case 'bullet':
      return (
        <div className="flex items-start gap-2.5 my-1">
          <span className="text-workspace-400 select-none text-base leading-relaxed">•</span>
          <div
            ref={setRef}
            data-block-id={block.id}
            contentEditable={!isLocked}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={handleBlur}
            onKeyDown={e => onKeyDown(e, block.id)}
            className="flex-1 outline-none text-workspace-800 leading-relaxed empty:before:content-['List_item...'] empty:before:text-workspace-300"
          />
        </div>
      );

    case 'numbered':
      return (
        <div className="flex items-start gap-2.5 my-1">
          <span className="text-workspace-400 select-none text-xs font-semibold mt-1">1.</span>
          <div
            ref={setRef}
            data-block-id={block.id}
            contentEditable={!isLocked}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={handleBlur}
            onKeyDown={e => onKeyDown(e, block.id)}
            className="flex-1 outline-none text-workspace-800 leading-relaxed empty:before:content-['Numbered_item...'] empty:before:text-workspace-300"
          />
        </div>
      );

    case 'quote':
      return (
        <div className="border-l-2 border-primary-600 pl-4 py-1 my-2 italic text-workspace-700 bg-primary-50/30 rounded-r-lg">
          <div
            ref={setRef}
            data-block-id={block.id}
            contentEditable={!isLocked}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={handleBlur}
            onKeyDown={e => onKeyDown(e, block.id)}
            className="outline-none empty:before:content-['Empty_quote...'] empty:before:text-workspace-300"
          />
        </div>
      );

    case 'paragraph':
    default:
      return (
        <div
          ref={setRef}
          data-block-id={block.id}
          contentEditable={!isLocked}
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onKeyDown={e => onKeyDown(e, block.id)}
          className="outline-none text-workspace-800 leading-relaxed min-h-[24px] empty:before:content-['Press_/_for_commands_or_start_writing...'] empty:before:text-workspace-400 empty:before:cursor-text"
        />
      );
  }
});

export default DocumentWorkspace;
