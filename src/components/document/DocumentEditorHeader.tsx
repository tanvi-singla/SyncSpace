import React, { useState, useEffect, useMemo } from 'react';
import { Cloud, FileText, MoreHorizontal, Share2, Pencil } from 'lucide-react';
import { EditorHeader } from '../EditorHeader';
import { ShareModal } from './ShareModal';
import {
  ParticipantsPopover,
  ConnectedParticipant,
  OfflineAccessUser,
} from './ParticipantsPopover';
import type { DocumentCollaborator, ConnectionStatus } from '../../hooks/useDocumentYjs';
import type { DocumentMeta, DocumentShareInfo } from '../../types/dashboard';
import { getDocumentSharesApi } from '../../lib/api/documents';

export interface DocumentEditorHeaderProps {
  title: string;
  documentId: string;
  isOwner: boolean;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  connectionStatus: ConnectionStatus;
  isIndexedDbSynced: boolean;
  collaborators: DocumentCollaborator[];
  allParticipants?: DocumentCollaborator[];
  currentUserTabs?: number;
  isLocalEditing?: boolean;
  docMeta?: DocumentMeta;
  currentUser?: { id?: string; name?: string; email?: string; avatarUrl?: string | null } | null;
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
  allParticipants,
  currentUserTabs = 1,
  isLocalEditing = false,
  docMeta,
  currentUser,
  onBack,
}: DocumentEditorHeaderProps) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [sharesList, setSharesList] = useState<DocumentShareInfo[]>(docMeta?.shares || []);

  // Fetch or update shares list to maintain accurate offline access list
  useEffect(() => {
    if (docMeta?.shares && docMeta.shares.length > 0) {
      setSharesList(docMeta.shares);
    } else if (documentId) {
      getDocumentSharesApi(documentId)
        .then((data) => setSharesList(data))
        .catch((err) => console.warn('Could not load shares for header:', err));
    }
  }, [documentId, docMeta?.shares]);

  // Determine original document owner
  const owner = useMemo(() => {
    const ownerId = docMeta?.owner?.id || docMeta?.userId;
    const ownerName = docMeta?.owner?.name || (isOwner ? (currentUser?.name || 'You') : 'Document Owner');
    const ownerAvatar = (docMeta?.owner as any)?.avatarUrl || (isOwner ? currentUser?.avatarUrl : null);
    return {
      id: ownerId,
      name: ownerName,
      avatarUrl: ownerAvatar,
    };
  }, [docMeta?.owner, docMeta?.userId, isOwner, currentUser]);

  // Compute deduplicated connected participants with backend-verified roles
  const connectedList = useMemo<ConnectedParticipant[]>(() => {
    const rawList: DocumentCollaborator[] =
      allParticipants && allParticipants.length > 0
        ? allParticipants
        : [
            ...(currentUser
              ? [
                  {
                    clientId: 0,
                    clientIds: [0],
                    userId: currentUser.id,
                    name: currentUser.name || 'You',
                    color: '#00667E',
                    avatarUrl: currentUser.avatarUrl,
                    role: (permission || 'OWNER') as any,
                    tabCount: currentUserTabs || 1,
                    isEditing: Boolean(isLocalEditing),
                    lastActive: Date.now(),
                  },
                ]
              : []),
            ...collaborators,
          ];

    const seen = new Set<string>();
    const list: ConnectedParticipant[] = [];

    for (const p of rawList) {
      const key = p.userId ? `user:${p.userId}` : `client:${p.clientId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isCurrent = Boolean(currentUser?.id && p.userId === currentUser.id);

      // Determine verified role from backend access list
      let verifiedRole: 'OWNER' | 'EDITOR' | 'VIEWER' = 'VIEWER';
      if (owner.id && p.userId === owner.id) {
        verifiedRole = 'OWNER';
      } else if (isCurrent) {
        verifiedRole = permission || 'OWNER';
      } else {
        const share = sharesList.find((s) => s.userId === p.userId);
        if (share) {
          verifiedRole = share.permission;
        } else if (p.role) {
          verifiedRole = p.role;
        }
      }

      // Suppress editing for VIEWER
      const editing =
        verifiedRole === 'VIEWER' ? false : isCurrent ? Boolean(isLocalEditing) : p.isEditing;

      list.push({
        userId: p.userId,
        name: isCurrent ? currentUser?.name || p.name || 'You' : p.name || 'Collaborator',
        avatarUrl: isCurrent ? currentUser?.avatarUrl ?? p.avatarUrl : p.avatarUrl,
        color: p.color || '#00667E',
        tabCount: isCurrent ? currentUserTabs || p.tabCount || 1 : p.tabCount || 1,
        isEditing: editing,
        role: verifiedRole,
        isCurrentUser: isCurrent,
      });
    }

    return list;
  }, [
    allParticipants,
    collaborators,
    currentUser,
    currentUserTabs,
    isLocalEditing,
    permission,
    owner.id,
    sharesList,
  ]);

  // Compute offline users with document access
  const offlineAccessUsers = useMemo<OfflineAccessUser[]>(() => {
    const connectedUserIds = new Set(connectedList.map((p) => p.userId).filter(Boolean));
    const offlineList: OfflineAccessUser[] = [];
    const seen = new Set<string>();

    // 1. Owner if offline
    if (owner.id && !connectedUserIds.has(owner.id)) {
      seen.add(owner.id);
      offlineList.push({
        id: owner.id,
        name: owner.name,
        avatarUrl: owner.avatarUrl,
        role: 'OWNER',
      });
    }

    // 2. Shared collaborators if offline
    for (const share of sharesList) {
      if (share.userId && !connectedUserIds.has(share.userId) && !seen.has(share.userId)) {
        seen.add(share.userId);
        offlineList.push({
          id: share.userId,
          name: share.user.name || 'Collaborator',
          avatarUrl: share.user.avatarUrl,
          role: share.permission,
        });
      }
    }

    return offlineList;
  }, [connectedList, owner, sharesList]);

  const hasAnyEditing = useMemo(() => connectedList.some((p) => p.isEditing), [connectedList]);
  const displayAvatars = connectedList.slice(0, 3);
  const overflowCount = Math.max(0, connectedList.length - 3);

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
            {/* Sync status badge */}
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

            {/* Live Participant Avatar Stack */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsPopoverOpen((open) => !open)}
                aria-haspopup="dialog"
                aria-expanded={isPopoverOpen}
                className="group flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-workspace-200 bg-white hover:bg-workspace-50 hover:border-workspace-300 transition-all cursor-pointer shadow-xs select-none"
                title="View document participants & collaborators"
              >
                {/* Overlapping avatar stack */}
                <div className="flex items-center -space-x-2">
                  {displayAvatars.map((person) => (
                    <div key={person.userId || person.name} className="relative">
                      {person.avatarUrl ? (
                        <img
                          src={person.avatarUrl}
                          alt={person.name}
                          className={`w-7 h-7 rounded-full border-2 border-white object-cover bg-workspace-100 ${
                            person.isEditing
                              ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-white animate-pulse'
                              : ''
                          }`}
                        />
                      ) : (
                        <div
                          className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-xs ${
                            person.isEditing
                              ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-white animate-pulse'
                              : ''
                          }`}
                          style={{ backgroundColor: person.color || '#00667E' }}
                        >
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                      )}

                      {/* Small multi-tab badge (e.g. x2, x3) */}
                      {person.tabCount > 1 && (
                        <span
                          className="absolute -top-1 -right-1 px-1 py-0.2 bg-workspace-800 text-white text-[8px] font-extrabold rounded-full border border-white leading-none shadow-xs"
                          title={`${person.tabCount} open browser tabs`}
                        >
                          x{person.tabCount}
                        </span>
                      )}

                      {/* Online/Editing indicator dot */}
                      <span
                        className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white ${
                          person.isEditing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'
                        }`}
                      />
                    </div>
                  ))}

                  {/* Overflow badge if more than 3 */}
                  {overflowCount > 0 && (
                    <div className="w-7 h-7 rounded-full border-2 border-white bg-workspace-100 text-workspace-600 flex items-center justify-center text-[10px] font-bold">
                      +{overflowCount}
                    </div>
                  )}
                </div>

                {/* Live editing indicator or participant count */}
                <div className="flex items-center gap-1.5 text-xs font-semibold text-workspace-600">
                  {hasAnyEditing ? (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse">
                      <Pencil size={9} className="animate-bounce" />
                      <span>Editing...</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-workspace-600 pl-0.5">
                      {connectedList.length}
                    </span>
                  )}
                </div>
              </button>

              {/* Interactive Participants Popover */}
              <ParticipantsPopover
                isOpen={isPopoverOpen}
                onClose={() => setIsPopoverOpen(false)}
                connectedParticipants={connectedList}
                offlineUsers={offlineAccessUsers}
                owner={owner}
                canManageSharing={isOwner}
                onManageSharing={() => setIsShareOpen(true)}
              />
            </div>

            {/* Share action button (Owner only) */}
            {isOwner ? (
              <button
                type="button"
                onClick={() => setIsShareOpen(true)}
                className="h-8 flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-2.5 sm:px-3 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Share2 size={14} />
                <span className="hidden sm:inline">Share</span>
              </button>
            ) : (
              <span className="px-2 py-1 rounded-lg text-xs font-medium bg-workspace-100 text-workspace-700 border border-workspace-200">
                {permission === 'VIEWER' ? 'Viewer' : 'Editor'}
              </span>
            )}

            {/* Options menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((open) => !open)}
                title="More options"
                aria-label="More options"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-workspace-200 text-workspace-600 hover:bg-workspace-100 transition-colors cursor-pointer"
              >
                <MoreHorizontal size={17} />
              </button>
              {showMoreMenu && (
                <>
                  <button
                    className="fixed inset-0 z-30 cursor-default"
                    aria-label="Close menu"
                    onClick={() => setShowMoreMenu(false)}
                  />
                  <div className="absolute right-0 top-10 z-40 w-44 rounded-xl border border-workspace-200 bg-white py-1 shadow-xl text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        window.print();
                        setShowMoreMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-workspace-700 hover:bg-workspace-100 cursor-pointer"
                    >
                      Print document
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        }
      />
      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        documentId={documentId}
        documentTitle={title}
      />
    </>
  );
}

export default DocumentEditorHeader;
