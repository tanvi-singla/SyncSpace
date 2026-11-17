import React, { useEffect, useRef } from 'react';
import { Users, X, Eye, Pencil, Crown, Share2 } from 'lucide-react';
import type { DocumentPermission } from '../../types/dashboard';

export interface ConnectedParticipant {
  userId?: string;
  name: string;
  avatarUrl?: string | null;
  color?: string;
  tabCount: number;
  isEditing: boolean;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  isCurrentUser: boolean;
}

export interface OfflineAccessUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export interface ParticipantsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  connectedParticipants: ConnectedParticipant[];
  offlineUsers: OfflineAccessUser[];
  owner: {
    id?: string;
    name: string;
    avatarUrl?: string | null;
  };
  onManageSharing?: () => void;
  canManageSharing?: boolean;
}

export function ParticipantsPopover({
  isOpen,
  onClose,
  connectedParticipants,
  offlineUsers,
  owner,
  onManageSharing,
  canManageSharing = false,
}: ParticipantsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Background scrim for mobile screens */}
      <div className="fixed inset-0 z-40 bg-black/10 sm:hidden" onClick={onClose} aria-hidden="true" />

      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-label="Document Participants"
        className="absolute right-0 top-full mt-2 w-80 sm:w-88 bg-white rounded-2xl border border-workspace-200 shadow-2xl p-4 z-50 text-xs font-sans animate-fade-in max-h-[85vh] overflow-y-auto"
      >
        {/* Popover Header */}
        <div className="flex items-center justify-between pb-3 border-b border-workspace-100 mb-3">
          <div className="flex items-center gap-2 font-bold text-workspace-900 text-sm">
            <Users size={16} className="text-primary-600" />
            <span>Document Participants</span>
            <span className="px-1.5 py-0.5 rounded-full bg-workspace-100 text-[11px] font-semibold text-workspace-600">
              {connectedParticipants.length} online
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close participants list"
            className="p-1 rounded-lg text-workspace-400 hover:text-workspace-600 hover:bg-workspace-100 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Document Owner Section */}
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-50/60 border border-amber-200/60 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Crown size={14} className="text-amber-600 fill-amber-100 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 block">
                Document Owner
              </span>
              <span className="font-semibold text-workspace-900 text-xs truncate block">
                {owner.name}
              </span>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
            Owner
          </span>
        </div>

        {/* Section 1: Currently Connected */}
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-workspace-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Currently Connected ({connectedParticipants.length})</span>
          </div>

          <div className="space-y-1">
            {connectedParticipants.map((p) => (
              <div
                key={p.userId || p.name}
                className="flex items-center justify-between py-2 px-2.5 rounded-xl hover:bg-workspace-50 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative shrink-0">
                    {p.avatarUrl ? (
                      <img
                        src={p.avatarUrl}
                        alt={p.name}
                        className="w-8 h-8 rounded-full object-cover border border-workspace-200"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-xs"
                        style={{ backgroundColor: p.color || '#00667E' }}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {/* Active green dot */}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-500/20" />
                  </div>

                  <div className="min-w-0 flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-workspace-900 truncate text-xs">
                        {p.name}
                      </span>
                      {p.isCurrentUser && (
                        <span className="text-[10px] font-medium text-workspace-400">
                          (You)
                        </span>
                      )}
                      {p.tabCount > 1 && (
                        <span
                          className="px-1.5 py-0.2 rounded-md bg-workspace-100 text-[10px] font-semibold text-workspace-600 border border-workspace-200"
                          title={`${p.tabCount} open browser tabs`}
                        >
                          {p.tabCount} tabs
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.isEditing ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded-full border border-amber-200 animate-pulse">
                          <Pencil size={9} className="animate-bounce" />
                          <span>Editing...</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <Eye size={11} />
                          <span>Viewing</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Role Badge */}
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide shrink-0 ${
                    p.role === 'OWNER'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : p.role === 'EDITOR'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-workspace-100 text-workspace-600 border-workspace-200'
                  }`}
                >
                  {p.role === 'OWNER' ? 'Owner' : p.role === 'EDITOR' ? 'Editor' : 'Viewer'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: People with Access (Offline) */}
        <div>
          <div className="text-[11px] font-semibold text-workspace-400 uppercase tracking-wider mt-3 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-workspace-300" />
            <span>People with access — Offline ({offlineUsers.length})</span>
          </div>

          {offlineUsers.length === 0 ? (
            <div className="text-[11px] text-workspace-400 italic py-1.5 px-2.5">
              All collaborators are currently connected.
            </div>
          ) : (
            <div className="space-y-1">
              {offlineUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between py-2 px-2.5 rounded-xl hover:bg-workspace-50 transition-colors opacity-80"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      {u.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt={u.name}
                          className="w-8 h-8 rounded-full object-cover border border-workspace-200 grayscale"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-workspace-200 text-workspace-500 flex items-center justify-center font-bold text-xs">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {/* Offline gray dot */}
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-workspace-300 border-2 border-white" />
                    </div>

                    <div className="min-w-0 flex flex-col">
                      <span className="font-medium text-workspace-700 truncate text-xs">
                        {u.name}
                      </span>
                      <span className="text-[11px] text-workspace-400">Offline</span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold border border-workspace-200 bg-workspace-50 text-workspace-500 uppercase tracking-wide shrink-0">
                    {u.role === 'OWNER' ? 'Owner' : u.role === 'EDITOR' ? 'Editor' : 'Viewer'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: Manage Sharing */}
        {canManageSharing && (
          <div className="mt-4 pt-3 border-t border-workspace-100 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onClose();
                onManageSharing?.();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors cursor-pointer"
            >
              <Share2 size={13} />
              <span>Manage sharing settings</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
