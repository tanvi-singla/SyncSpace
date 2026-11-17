import { describe, it, expect } from 'vitest';
import type { DocumentCollaborator } from '../../../hooks/useDocumentYjs';
import type { DocumentMeta, DocumentShareInfo } from '../../../types/dashboard';
import type {
  ConnectedParticipant,
  OfflineAccessUser,
} from '../ParticipantsPopover';

/**
 * Helper recreating the exact participant aggregation logic in DocumentEditorHeader.
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

describe('Phase 4: Document Header & Participant UI Aggregation', () => {
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
      documentId: 'doc-collab-101',
      userId: 'user-mannat',
      permission: 'EDITOR',
      createdAt: '2026-01-01T00:00:00.000Z',
      user: mannatUser,
    },
    {
      id: 'share-rohan',
      documentId: 'doc-collab-101',
      userId: 'user-rohan',
      permission: 'VIEWER',
      createdAt: '2026-01-02T00:00:00.000Z',
      user: rohanUser,
    },
  ];

  const docMeta: DocumentMeta = {
    id: 'doc-collab-101',
    title: 'SyncSpace Architecture & PRD',
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

  it('scenario 1: Tanvi (Owner) and Mannat (Editor) both open the document and appear as separate participants', () => {
    // Tanvi's view: Tanvi is logged in, Mannat is a connected remote collaborator
    const tanviPerspective = computeParticipantsAndAccess({
      allParticipants: [
        {
          clientId: 101,
          clientIds: [101],
          userId: 'user-tanvi',
          name: 'Tanvi S.',
          color: '#10B981',
          avatarUrl: tanviUser.avatarUrl,
          role: 'OWNER',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
        {
          clientId: 201,
          clientIds: [201],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          avatarUrl: mannatUser.avatarUrl,
          role: 'EDITOR',
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
          avatarUrl: mannatUser.avatarUrl,
          role: 'EDITOR',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
      ],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    expect(tanviPerspective.connectedList).toHaveLength(2);
    expect(tanviPerspective.connectedList[0].name).toBe('Tanvi S.');
    expect(tanviPerspective.connectedList[0].isCurrentUser).toBe(true);
    expect(tanviPerspective.connectedList[0].role).toBe('OWNER');

    expect(tanviPerspective.connectedList[1].name).toBe('Mannat K.');
    expect(tanviPerspective.connectedList[1].isCurrentUser).toBe(false);
    expect(tanviPerspective.connectedList[1].role).toBe('EDITOR');

    // Both see consistent Document Owner
    expect(tanviPerspective.owner.id).toBe('user-tanvi');
    expect(tanviPerspective.owner.name).toBe('Tanvi S.');
  });

  it('scenario 2: Mannat opens document and sees Tanvi as Owner and herself as Editor (You)', () => {
    // Mannat's perspective: Mannat is currentUser, Tanvi is remote
    const mannatDocMeta: DocumentMeta = {
      ...docMeta,
      permission: 'EDITOR',
    };

    const mannatPerspective = computeParticipantsAndAccess({
      allParticipants: [
        {
          clientId: 101,
          clientIds: [101],
          userId: 'user-tanvi',
          name: 'Tanvi S.',
          color: '#10B981',
          avatarUrl: tanviUser.avatarUrl,
          role: 'OWNER',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
        {
          clientId: 201,
          clientIds: [201],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          avatarUrl: mannatUser.avatarUrl,
          role: 'EDITOR',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
      ],
      collaborators: [
        {
          clientId: 101,
          clientIds: [101],
          userId: 'user-tanvi',
          name: 'Tanvi S.',
          color: '#10B981',
          avatarUrl: tanviUser.avatarUrl,
          role: 'OWNER',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
      ],
      currentUser: mannatUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'EDITOR',
      docMeta: mannatDocMeta,
      sharesList: docShares,
    });

    expect(mannatPerspective.connectedList).toHaveLength(2);
    // Tanvi is recognized as OWNER
    const tanviItem = mannatPerspective.connectedList.find((p) => p.userId === 'user-tanvi');
    expect(tanviItem?.role).toBe('OWNER');
    expect(tanviItem?.isCurrentUser).toBe(false);

    // Mannat is recognized as (You) and EDITOR
    const mannatItem = mannatPerspective.connectedList.find((p) => p.userId === 'user-mannat');
    expect(mannatItem?.role).toBe('EDITOR');
    expect(mannatItem?.isCurrentUser).toBe(true);

    // Mannat does NOT confuse herself with the document owner
    expect(mannatPerspective.owner.id).toBe('user-tanvi');
    expect(mannatPerspective.owner.name).toBe('Tanvi S.');
  });

  it('scenario 3: Multiple tabs do NOT create duplicate participants and display tabCount', () => {
    // Mannat has 3 tabs open
    const multiTabPerspective = computeParticipantsAndAccess({
      allParticipants: [
        {
          clientId: 101,
          clientIds: [101],
          userId: 'user-tanvi',
          name: 'Tanvi S.',
          color: '#10B981',
          avatarUrl: tanviUser.avatarUrl,
          role: 'OWNER',
          tabCount: 1,
          isEditing: false,
          lastActive: Date.now(),
        },
        {
          clientId: 201,
          clientIds: [201, 202, 203],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          avatarUrl: mannatUser.avatarUrl,
          role: 'EDITOR',
          tabCount: 3,
          isEditing: false,
          lastActive: Date.now(),
        },
      ],
      collaborators: [
        {
          clientId: 201,
          clientIds: [201, 202, 203],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          avatarUrl: mannatUser.avatarUrl,
          role: 'EDITOR',
          tabCount: 3,
          isEditing: false,
          lastActive: Date.now(),
        },
      ],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    // Exactly 2 participants total
    expect(multiTabPerspective.connectedList).toHaveLength(2);
    const mannat = multiTabPerspective.connectedList.find((p) => p.userId === 'user-mannat');
    expect(mannat).toBeDefined();
    expect(mannat?.tabCount).toBe(3);
  });

  it('scenario 4: Editing and viewing indicators update correctly in real time', () => {
    // When Mannat starts editing
    const editingPerspective = computeParticipantsAndAccess({
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
        {
          clientId: 201,
          clientIds: [201],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          role: 'EDITOR',
          tabCount: 1,
          isEditing: true, // Editing!
          lastActive: Date.now(),
        },
      ],
      collaborators: [],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    const mannatEditing = editingPerspective.connectedList.find((p) => p.userId === 'user-mannat');
    expect(mannatEditing?.isEditing).toBe(true);

    // After 3.5s inactivity, Mannat returns to Viewing
    const viewingPerspective = computeParticipantsAndAccess({
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
        {
          clientId: 201,
          clientIds: [201],
          userId: 'user-mannat',
          name: 'Mannat K.',
          color: '#3B82F6',
          role: 'EDITOR',
          tabCount: 1,
          isEditing: false, // Viewing!
          lastActive: Date.now(),
        },
      ],
      collaborators: [],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    const mannatViewing = viewingPerspective.connectedList.find((p) => p.userId === 'user-mannat');
    expect(mannatViewing?.isEditing).toBe(false);
  });

  it('scenario 5: Offline collaborator (Rohan) remains visible in People with access (Offline)', () => {
    // Only Tanvi and Mannat are connected. Rohan is offline.
    const result = computeParticipantsAndAccess({
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
      collaborators: [],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    // Connected: Tanvi & Mannat
    expect(result.connectedList).toHaveLength(2);

    // Offline: Rohan
    expect(result.offlineAccessUsers).toHaveLength(1);
    expect(result.offlineAccessUsers[0].id).toBe('user-rohan');
    expect(result.offlineAccessUsers[0].name).toBe('Rohan M.');
    expect(result.offlineAccessUsers[0].role).toBe('VIEWER');

    // Neither Tanvi nor Mannat are in offlineAccessUsers
    expect(result.offlineAccessUsers.some((u) => u.id === 'user-tanvi')).toBe(false);
    expect(result.offlineAccessUsers.some((u) => u.id === 'user-mannat')).toBe(false);
  });

  it('scenario 6: VIEWER permissions remain intact and VIEWER is never shown as editing', () => {
    // Rohan connects as a VIEWER, and somehow claims isEditing: true
    const result = computeParticipantsAndAccess({
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
        {
          clientId: 301,
          clientIds: [301],
          userId: 'user-rohan',
          name: 'Rohan M.',
          color: '#F59E0B',
          role: 'VIEWER',
          tabCount: 1,
          isEditing: true, // Attempted editing
          lastActive: Date.now(),
        },
      ],
      collaborators: [],
      currentUser: tanviUser,
      currentUserTabs: 1,
      isLocalEditing: false,
      permission: 'OWNER',
      docMeta,
      sharesList: docShares,
    });

    const rohan = result.connectedList.find((p) => p.userId === 'user-rohan');
    expect(rohan).toBeDefined();
    expect(rohan?.role).toBe('VIEWER');
    expect(rohan?.isEditing).toBe(false); // Strictly suppressed
  });

  it('scenario 7: document created by Vani displays Vani, actual creation date, and deduplicated contributor count', async () => {
    const { computeDocumentAuthor, formatDocumentDate, computeContributorCount } = await import(
      '../../../utils/documentMetadata'
    );

    const vaniUser = {
      id: 'user-vani-id',
      name: 'Vani',
      email: 'vani@syncspace.dev',
      avatarUrl: null,
    };

    const vaniDoc: DocumentMeta = {
      id: 'doc-vani-101',
      title: 'Untitled Document',
      type: 'doc',
      userId: 'user-vani-id',
      owner: vaniUser,
      createdBy: 'Vani',
      isFavorite: false,
      isDeleted: false,
      createdAt: new Date('2026-11-17T18:00:00.000Z').getTime(),
      updatedAt: new Date('2026-11-17T18:00:00.000Z').getTime(),
      permission: 'OWNER',
      shares: [],
      isShared: false,
    };

    // 1. Author displays Vani when Vani creates the document
    const authorForVani = computeDocumentAuthor(vaniDoc, vaniUser, true);
    expect(authorForVani).toBe('Vani');

    // 2. Author displays Vani even when another user (e.g. Mannat) opens the shared document
    const mannatUser = { id: 'user-mannat-id', name: 'Mannat K.', email: 'mannat@syncspace.dev' };
    const authorForMannat = computeDocumentAuthor(vaniDoc, mannatUser, false);
    expect(authorForMannat).toBe('Vani');

    // 3. Creation date displays actual creation date (Nov 17, 2026) and never falls back to Sep 9, 2026 or new Date()
    const formattedDate = formatDocumentDate(vaniDoc.createdAt);
    expect(formattedDate).toBe('Nov 17, 2026');

    // Missing timestamp gives neutral fallback
    expect(formatDocumentDate(undefined)).toBe('Date unavailable');

    // 4. Initial contributor count is exactly 1 for a new document
    const initialContributors = computeContributorCount(vaniDoc, vaniUser, true);
    expect(initialContributors.count).toBe(1);
    expect(initialContributors.text).toBe('1 contributor');

    // 5. When shared with Mannat, contributor count becomes 2
    const sharedWithMannatDoc: DocumentMeta = {
      ...vaniDoc,
      shares: [
        {
          id: 'share-1',
          documentId: vaniDoc.id,
          userId: mannatUser.id,
          permission: 'EDITOR',
          createdAt: '2026-11-17T18:10:00.000Z',
          user: mannatUser,
        },
      ],
    };

    const sharedContributors = computeContributorCount(sharedWithMannatDoc, vaniUser, true);
    expect(sharedContributors.count).toBe(2);
    expect(sharedContributors.text).toBe('2 contributors');

    // 6. Multiple tabs / duplicate user awareness does not increase contributor count
    const extraDuplicateShares = [
      ...sharedWithMannatDoc.shares!,
      {
        id: 'share-dup',
        documentId: vaniDoc.id,
        userId: mannatUser.id, // Same user
        permission: 'EDITOR' as const,
        createdAt: '2026-11-17T18:15:00.000Z',
        user: mannatUser,
      },
    ];

    const deduplicatedContributors = computeContributorCount(
      sharedWithMannatDoc,
      vaniUser,
      true,
      extraDuplicateShares
    );
    expect(deduplicatedContributors.count).toBe(2);
    expect(deduplicatedContributors.text).toBe('2 contributors');
  });
});
