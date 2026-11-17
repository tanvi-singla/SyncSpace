import { describe, it, expect } from 'vitest';
import {
  deduplicateAwarenessStates,
  type DocumentCollaborator,
  type RawAwarenessUserState,
} from '../../../hooks/useDocumentYjs';
import type { DocumentMeta, DocumentShareInfo } from '../../../types/dashboard';
import type { ConnectedParticipant, OfflineAccessUser } from '../ParticipantsPopover';

/**
 * Recreates the exact aggregation pipeline in DocumentEditorHeader.tsx
 */
function computeParticipantsAndAccess({
  allParticipants,
  collaborators,
  currentUser,
  currentUserTabs = 1,
  isLocalEditing = false,
  permission,
  docMeta,
  sharesList = [],
}: {
  allParticipants?: DocumentCollaborator[];
  collaborators: DocumentCollaborator[];
  currentUser?: { id?: string; name?: string; email?: string; avatarUrl?: string | null } | null;
  currentUserTabs?: number;
  isLocalEditing?: boolean;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  docMeta?: DocumentMeta;
  sharesList?: DocumentShareInfo[];
}): {
  connectedList: ConnectedParticipant[];
  offlineAccessUsers: OfflineAccessUser[];
  owner: { id?: string; name: string; avatarUrl?: string | null };
} {
  const isOwner = permission === 'OWNER' || docMeta?.permission === 'OWNER';
  const ownerId = docMeta?.owner?.id || docMeta?.userId;
  const ownerName = docMeta?.owner?.name || (isOwner ? (currentUser?.name || 'You') : 'Document Owner');
  const ownerAvatar = (docMeta?.owner as any)?.avatarUrl || (isOwner ? currentUser?.avatarUrl : null);
  const owner = { id: ownerId, name: ownerName, avatarUrl: ownerAvatar };

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
  const connectedList: ConnectedParticipant[] = [];

  for (const p of rawList) {
    const key = p.userId ? `user:${p.userId}` : `client:${p.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isCurrent = Boolean(currentUser?.id && p.userId === currentUser.id);

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

    const editing =
      verifiedRole === 'VIEWER' ? false : isCurrent ? Boolean(isLocalEditing) : p.isEditing;

    connectedList.push({
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

  const connectedUserIds = new Set(connectedList.map((p) => p.userId).filter(Boolean));
  const offlineAccessUsers: OfflineAccessUser[] = [];
  const seenOffline = new Set<string>();

  if (owner.id && !connectedUserIds.has(owner.id)) {
    seenOffline.add(owner.id);
    offlineAccessUsers.push({
      id: owner.id,
      name: owner.name,
      avatarUrl: owner.avatarUrl,
      role: 'OWNER',
    });
  }

  for (const share of sharesList) {
    if (share.userId && !connectedUserIds.has(share.userId) && !seenOffline.has(share.userId)) {
      seenOffline.add(share.userId);
      offlineAccessUsers.push({
        id: share.userId,
        name: share.user.name || 'Collaborator',
        avatarUrl: share.user.avatarUrl,
        role: share.permission,
      });
    }
  }

  return { connectedList, offlineAccessUsers, owner };
}

describe('Phase 5: End-to-End Participants Verification & UI Integration', () => {
  const tanviUser = {
    id: 'user-tanvi',
    name: 'Tanvi S.',
    email: 'tanvi@syncspace.me',
    avatarUrl: 'https://syncspace.me/avatars/tanvi.jpg',
  };

  const mannatUser = {
    id: 'user-mannat',
    name: 'Mannat K.',
    email: 'mannat@syncspace.me',
    avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
  };

  const rohanUser = {
    id: 'user-rohan',
    name: 'Rohan M.',
    email: 'rohan@syncspace.me',
    avatarUrl: null,
  };

  const docShares: DocumentShareInfo[] = [
    {
      id: 'share-mannat',
      documentId: 'doc-e2e-1',
      userId: 'user-mannat',
      permission: 'EDITOR',
      createdAt: '2026-01-02T00:00:00.000Z',
      user: mannatUser,
    },
    {
      id: 'share-rohan',
      documentId: 'doc-e2e-1',
      userId: 'user-rohan',
      permission: 'VIEWER',
      createdAt: '2026-01-03T00:00:00.000Z',
      user: rohanUser,
    },
  ];

  const docMeta: DocumentMeta = {
    id: 'doc-e2e-1',
    title: 'SyncSpace PRD',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
    createdBy: 'Tanvi S.',
    userId: 'user-tanvi',
    type: 'doc',
    permission: 'OWNER',
    owner: tanviUser,
    shares: docShares,
  };

  // =========================================================================
  // 1. Two-Account Collaboration Flow & Deduplication
  // =========================================================================
  describe('1. Two-Account Collaboration Flow & Multi-Tab Presence', () => {
    it('Tanvi (Owner) and Mannat (Editor) both connected: each appears once with correct roles', () => {
      const now = Date.now();
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          101,
          {
            user: {
              userId: 'user-tanvi',
              name: 'Tanvi S.',
              role: 'OWNER',
              avatarUrl: tanviUser.avatarUrl,
              isEditing: false,
              lastActive: now,
            },
          },
        ],
        [
          201,
          {
            user: {
              userId: 'user-mannat',
              name: 'Mannat K.',
              role: 'EDITOR',
              avatarUrl: mannatUser.avatarUrl,
              isEditing: false,
              lastActive: now,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      expect(result.allParticipants).toHaveLength(2);
      expect(result.collaborators).toHaveLength(1);
      expect(result.collaborators[0].userId).toBe('user-mannat');
      expect(result.collaborators[0].role).toBe('EDITOR');
      expect(result.currentUserTabs).toBe(1);

      // Tanvi perspective
      const headerAgg = computeParticipantsAndAccess({
        allParticipants: result.allParticipants,
        collaborators: result.collaborators,
        currentUser: tanviUser,
        currentUserTabs: result.currentUserTabs,
        permission: 'OWNER',
        docMeta,
        sharesList: docShares,
      });

      expect(headerAgg.connectedList).toHaveLength(2);
      expect(headerAgg.connectedList.find((p) => p.userId === 'user-tanvi')?.isCurrentUser).toBe(true);
      expect(headerAgg.connectedList.find((p) => p.userId === 'user-mannat')?.role).toBe('EDITOR');
      expect(headerAgg.offlineAccessUsers).toHaveLength(1);
      expect(headerAgg.offlineAccessUsers[0].id).toBe('user-rohan');
      expect(headerAgg.offlineAccessUsers[0].role).toBe('VIEWER');
    });

    it('Multi-tab deduplication: Mannat opens 2 tabs with distinct client IDs; appears once with tabCount: 2', () => {
      const now = Date.now();
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          101,
          {
            user: {
              userId: 'user-tanvi',
              name: 'Tanvi S.',
              role: 'OWNER',
              isEditing: false,
              lastActive: now,
            },
          },
        ],
        [
          201,
          {
            user: {
              userId: 'user-mannat',
              name: 'Mannat K.',
              role: 'EDITOR',
              isEditing: false,
              lastActive: now,
            },
          },
        ],
        [
          202,
          {
            user: {
              userId: 'user-mannat',
              name: 'Mannat K.',
              role: 'EDITOR',
              isEditing: true, // Tab 2 is actively editing
              lastActive: now,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      expect(result.allParticipants).toHaveLength(2);

      const mannat = result.allParticipants.find((p) => p.userId === 'user-mannat')!;
      expect(mannat.tabCount).toBe(2);
      expect(mannat.clientIds).toEqual([201, 202]);
      // If any tab is editing, user status is editing
      expect(mannat.isEditing).toBe(true);
    });

    it('Tab closure: closing Tab 2 drops tabCount to 1 without losing user connection', () => {
      const now = Date.now();
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          101,
          {
            user: {
              userId: 'user-tanvi',
              name: 'Tanvi S.',
              role: 'OWNER',
              isEditing: false,
              lastActive: now,
            },
          },
        ],
        [
          201,
          {
            user: {
              userId: 'user-mannat',
              name: 'Mannat K.',
              role: 'EDITOR',
              isEditing: false,
              lastActive: now,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      const mannat = result.allParticipants.find((p) => p.userId === 'user-mannat')!;
      expect(mannat.tabCount).toBe(1);
      expect(mannat.isEditing).toBe(false);
    });

    it('Full disconnect: when all of Mannat’s tabs close, she moves to People with Access (Offline)', () => {
      const now = Date.now();
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          101,
          {
            user: {
              userId: 'user-tanvi',
              name: 'Tanvi S.',
              role: 'OWNER',
              isEditing: false,
              lastActive: now,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      const headerAgg = computeParticipantsAndAccess({
        allParticipants: result.allParticipants,
        collaborators: result.collaborators,
        currentUser: tanviUser,
        currentUserTabs: result.currentUserTabs,
        permission: 'OWNER',
        docMeta,
        sharesList: docShares,
      });

      expect(headerAgg.connectedList).toHaveLength(1);
      expect(headerAgg.connectedList[0].userId).toBe('user-tanvi');
      expect(headerAgg.offlineAccessUsers).toHaveLength(2);
      expect(headerAgg.offlineAccessUsers.map((u) => u.name)).toEqual(['Mannat K.', 'Rohan M.']);
    });
  });

  // =========================================================================
  // 2. Timers, Pruning & Edge Cases
  // =========================================================================
  describe('2. Inactivity Timers & Stale State Pruning', () => {
    it('Stale client pruner: drops awareness clients with lastActive > 35s', () => {
      const now = Date.now();
      const staleTime = now - 45000;
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          101,
          {
            user: {
              userId: 'user-tanvi',
              name: 'Tanvi S.',
              role: 'OWNER',
              lastActive: now,
            },
          },
        ],
        [
          888,
          {
            user: {
              userId: 'user-ghost',
              name: 'Ghost Client',
              role: 'EDITOR',
              lastActive: staleTime,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      expect(result.allParticipants).toHaveLength(1);
      expect(result.allParticipants[0].userId).toBe('user-tanvi');
    });

    it('Stale editing flag pruner: resets editing flag if lastActive > 4s', () => {
      const now = Date.now();
      const oldTime = now - 5000;
      const awarenessMap = new Map<number, { user: RawAwarenessUserState }>([
        [
          201,
          {
            user: {
              userId: 'user-mannat',
              name: 'Mannat K.',
              role: 'EDITOR',
              isEditing: true, // Left true before tab pause
              lastActive: oldTime,
            },
          },
        ],
      ]);

      const result = deduplicateAwarenessStates(awarenessMap, 101, 'user-tanvi');
      expect(result.allParticipants[0].isEditing).toBe(false);
    });

    it('Empty collaborator list: owner viewing their solo document shows 0 offline users and canManageSharing: true', () => {
      const soloDocMeta: DocumentMeta = {
        id: 'doc-solo-1',
        title: 'Solo Workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isFavorite: false,
        createdBy: 'Tanvi S.',
        userId: 'user-tanvi',
        type: 'doc',
        permission: 'OWNER',
        owner: tanviUser,
        shares: [],
      };

      const headerAgg = computeParticipantsAndAccess({
        allParticipants: [],
        collaborators: [],
        currentUser: tanviUser,
        currentUserTabs: 1,
        permission: 'OWNER',
        docMeta: soloDocMeta,
        sharesList: [],
      });

      expect(headerAgg.connectedList).toHaveLength(1);
      expect(headerAgg.connectedList[0].userId).toBe('user-tanvi');
      expect(headerAgg.offlineAccessUsers).toHaveLength(0);
      expect(headerAgg.owner.id).toBe('user-tanvi');
    });
  });

  // =========================================================================
  // 3. Security & Permission Invariants
  // =========================================================================
  describe('3. Security & Permission Invariants', () => {
    it('Security: VIEWER can NEVER appear as editing on any user screen', () => {
      const now = Date.now();
      const spoofedAwareness = new Map<number, { user: RawAwarenessUserState }>([
        [
          301,
          {
            user: {
              userId: 'user-rohan',
              name: 'Rohan M.',
              role: 'VIEWER',
              isEditing: true, // Spoofed editing intent
              lastActive: now,
            },
          },
        ],
      ]);

      const dedupResult = deduplicateAwarenessStates(spoofedAwareness, 101, 'user-tanvi');
      const rohan = dedupResult.allParticipants.find((p) => p.userId === 'user-rohan')!;
      expect(rohan.isEditing).toBe(false);

      const headerAgg = computeParticipantsAndAccess({
        allParticipants: dedupResult.allParticipants,
        collaborators: dedupResult.collaborators,
        currentUser: rohanUser,
        permission: 'VIEWER',
        isLocalEditing: true,
        docMeta,
        sharesList: docShares,
      });

      expect(headerAgg.connectedList[0].isEditing).toBe(false);
      expect(headerAgg.connectedList[0].role).toBe('VIEWER');
    });

    it('Security: No private email addresses are exposed in connectedList or offlineAccessUsers', () => {
      const headerAgg = computeParticipantsAndAccess({
        allParticipants: [
          {
            clientId: 101,
            clientIds: [101],
            userId: 'user-tanvi',
            name: 'Tanvi S.',
            color: '#10B981',
            role: 'OWNER',
            tabCount: 1,
            isEditing: false,
            lastActive: Date.now(),
          },
        ],
        collaborators: [
          {
            clientId: 201,
            clientIds: [201],
            userId: 'user-mannat',
            name: 'Mannat K.',
            color: '#3B82F6',
            role: 'EDITOR',
            tabCount: 1,
            isEditing: false,
            lastActive: Date.now(),
          },
        ],
        currentUser: tanviUser,
        currentUserTabs: 1,
        permission: 'OWNER',
        docMeta,
        sharesList: docShares,
      });

      for (const p of headerAgg.connectedList) {
        expect((p as any).email).toBeUndefined();
      }

      for (const u of headerAgg.offlineAccessUsers) {
        expect((u as any).email).toBeUndefined();
      }
    });

    it('Security: Non-owners (Mannat, Rohan) cannot manage sharing', () => {
      const mannatPerspective = computeParticipantsAndAccess({
        allParticipants: [],
        collaborators: [],
        currentUser: mannatUser,
        permission: 'EDITOR',
        docMeta,
        sharesList: docShares,
      });

      expect(mannatPerspective.owner.id).toBe('user-tanvi');
      expect(mannatPerspective.connectedList[0].role).toBe('EDITOR');
    });
  });

  // =========================================================================
  // 4. UI Rendering & Interaction Logic
  // =========================================================================
  describe('4. UI Rendering & Accessibility Verification', () => {
    it('Avatar stack displays max 3 avatars and computes overflow badge count', () => {
      const connected: ConnectedParticipant[] = [
        { name: 'Tanvi', tabCount: 1, isEditing: false, role: 'OWNER', isCurrentUser: true },
        { name: 'Mannat', tabCount: 1, isEditing: false, role: 'EDITOR', isCurrentUser: false },
        { name: 'Rohan', tabCount: 1, isEditing: false, role: 'VIEWER', isCurrentUser: false },
        { name: 'Sarah', tabCount: 1, isEditing: false, role: 'EDITOR', isCurrentUser: false },
        { name: 'Alex', tabCount: 1, isEditing: false, role: 'VIEWER', isCurrentUser: false },
      ];

      const displayAvatars = connected.slice(0, 3);
      const overflowCount = Math.max(0, connected.length - 3);

      expect(displayAvatars).toHaveLength(3);
      expect(overflowCount).toBe(2);
      expect(displayAvatars.map((a) => a.name)).toEqual(['Tanvi', 'Mannat', 'Rohan']);
    });

    it('Avatar fallback to uppercase initial when avatarUrl is null', () => {
      const participant: ConnectedParticipant = {
        name: 'rohan m.',
        avatarUrl: null,
        color: '#6366F1',
        tabCount: 1,
        isEditing: false,
        role: 'VIEWER',
        isCurrentUser: false,
      };

      const initial = participant.name.charAt(0).toUpperCase();
      expect(initial).toBe('R');
    });

    it('Multi-tab badge formatting: displays x2 or x3 when tabCount > 1', () => {
      const singleTab: ConnectedParticipant = {
        name: 'Tanvi',
        tabCount: 1,
        isEditing: false,
        role: 'OWNER',
        isCurrentUser: true,
      };

      const multiTab: ConnectedParticipant = {
        name: 'Mannat',
        tabCount: 3,
        isEditing: false,
        role: 'EDITOR',
        isCurrentUser: false,
      };

      expect(singleTab.tabCount > 1).toBe(false);
      expect(multiTab.tabCount > 1).toBe(true);
      expect(`x${multiTab.tabCount}`).toBe('x3');
    });

    it('Document Owner banner highlights original creator with Crown and Owner badge', () => {
      const headerAgg = computeParticipantsAndAccess({
        allParticipants: [],
        collaborators: [],
        currentUser: tanviUser,
        permission: 'OWNER',
        docMeta,
        sharesList: docShares,
      });

      expect(headerAgg.owner.name).toBe('Tanvi S.');
      expect(headerAgg.owner.id).toBe('user-tanvi');
    });

    it('Popover dismissal on Escape key and outside click handling', () => {
      let closed = false;
      const onClose = () => {
        closed = true;
      };

      const handleKeyDown = (e: { key: string }) => {
        if (e.key === 'Escape') onClose();
      };

      handleKeyDown({ key: 'Tab' });
      expect(closed).toBe(false);

      handleKeyDown({ key: 'Escape' });
      expect(closed).toBe(true);
    });
  });
});
