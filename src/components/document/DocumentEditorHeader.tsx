import React, { useState } from 'react';
import { Cloud, FileText, MoreHorizontal, Share2 } from 'lucide-react';
import { EditorHeader } from '../EditorHeader';
import { ShareModal } from './ShareModal';
import type { DocumentCollaborator, ConnectionStatus } from '../../hooks/useDocumentYjs';

interface DocumentEditorHeaderProps {
  title: string;
  documentId: string;
  isOwner: boolean;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  connectionStatus: ConnectionStatus;
  isIndexedDbSynced: boolean;
  collaborators: DocumentCollaborator[];
  currentUser?: { name?: string; avatarUrl?: string | null } | null;
  onBack: () => void;
}

export function DocumentEditorHeader({
  title,
  documentId,
  isOwner,
  permission,
  isSidebarOpen,
  onToggleSidebar,
  connectionStatus,
  isIndexedDbSynced,
  collaborators,
  currentUser,
  onBack,
}: DocumentEditorHeaderProps) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const syncLabel = !isIndexedDbSynced
    ? 'Saving…'
    : connectionStatus === 'connected'
      ? 'Synced live'
      : 'Saved locally';

  return (
    <>
      <EditorHeader
        title={title || 'Untitled Document'}
        icon={<FileText size={17} />}
        onBack={onBack}
        onToggleSidebar={onToggleSidebar}
        isSidebarOpen={isSidebarOpen}
        rightContent={
          <>
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium ${
                isIndexedDbSynced
                  ? connectionStatus === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-workspace-50 text-workspace-600 border-workspace-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
              title={`Local save: ${isIndexedDbSynced ? 'ready' : 'saving'}; connection: ${connectionStatus}`}
              role="status"
              aria-live="polite"
            >
              <Cloud size={13} className={!isIndexedDbSynced ? 'animate-pulse' : ''} />
              <span className="hidden sm:inline">{syncLabel}</span>
            </div>

            <div className="flex items-center -space-x-2" title={`${collaborators.length + 1} collaborators`}>
              {collaborators.slice(0, 3).map((person) => (
                <div
                  key={person.clientId}
                  className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ backgroundColor: person.color || '#00667E' }}
                  title={person.name}
                >
                  {person.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {currentUser?.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt={currentUser.name || 'You'} className="w-7 h-7 rounded-full border-2 border-white bg-workspace-200 object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full border-2 border-white bg-primary-600 text-white flex items-center justify-center text-[10px] font-semibold" title={`${currentUser?.name || 'You'} (You)`}>
                  {currentUser?.name?.charAt(0).toUpperCase() || 'Y'}
                </div>
              )}
              <span className="pl-3 text-xs font-semibold text-workspace-500">{collaborators.length + 1}</span>
            </div>

            {isOwner ? (
              <button
                type="button"
                onClick={() => setIsShareOpen(true)}
                className="h-8 flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-2.5 sm:px-3 text-xs font-semibold transition-colors"
              >
                <Share2 size={14} />
                <span className="hidden sm:inline">Share</span>
              </button>
            ) : (
              <span className="px-2 py-1 rounded-lg text-xs font-medium bg-workspace-100 text-workspace-700 border border-workspace-200">
                {permission === 'VIEWER' ? 'Viewer' : 'Editor'}
              </span>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((open) => !open)}
                title="More options"
                aria-label="More options"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-workspace-200 text-workspace-600 hover:bg-workspace-100 transition-colors"
              >
                <MoreHorizontal size={17} />
              </button>
              {showMoreMenu && (
                <>
                  <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setShowMoreMenu(false)} />
                  <div className="absolute right-0 top-10 z-40 w-44 rounded-xl border border-workspace-200 bg-white py-1 shadow-xl text-xs">
                    <button
                      type="button"
                      onClick={() => { window.print(); setShowMoreMenu(false); }}
                      className="w-full px-3 py-2 text-left text-workspace-700 hover:bg-workspace-100"
                    >Print document</button>
                  </div>
                </>
              )}
            </div>
          </>
        }
      />
      <ShareModal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} documentId={documentId} documentTitle={title} />
    </>
  );
}
