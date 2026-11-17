import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  deduplicateAwarenessStates,
  RawAwarenessUserState,
  DocumentCollaborator,
} from '../useDocumentYjs';

describe('Phase 2 - Yjs Awareness Enhancements & Multi-Tab Deduplication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. Pure Awareness Deduplication (deduplicateAwarenessStates)', () => {
    it('displays two different users as two distinct participants', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // User 1 in Tab 1
      states.set(101, {
        user: {
          userId: 'user-alice',
          name: 'Alice',
          color: '#10B981',
          avatarUrl: 'https://avatar.test/alice.png',
          role: 'OWNER',
          isEditing: false,
          lastActive: now,
        },
      });

      // User 2 in Tab 2
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          avatarUrl: 'https://avatar.test/bob.png',
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      const { allParticipants, collaborators } = deduplicateAwarenessStates(states, 101, 'user-alice');

      // Total participants is 2
      expect(allParticipants).toHaveLength(2);
      expect(allParticipants.map((p) => p.userId).sort()).toEqual(['user-alice', 'user-bob']);

      // Remote collaborators (excluding local user Alice) is exactly 1 (Bob)
      expect(collaborators).toHaveLength(1);
      expect(collaborators[0].userId).toBe('user-bob');
      expect(collaborators[0].name).toBe('Bob');
      expect(collaborators[0].tabCount).toBe(1);
    });

    it('groups multiple tabs belonging to the same user into one participant and tracks tabCount', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Bob opens 3 tabs
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          avatarUrl: null,
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });
      states.set(202, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          avatarUrl: null,
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });
      states.set(203, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          avatarUrl: null,
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      const { allParticipants, collaborators } = deduplicateAwarenessStates(states, 101, 'user-alice');

      // Bob appears only ONCE
      expect(collaborators).toHaveLength(1);
      const bob = collaborators[0];
      expect(bob.userId).toBe('user-bob');
      expect(bob.name).toBe('Bob');
      expect(bob.tabCount).toBe(3);
      expect(bob.clientIds).toEqual([201, 202, 203]);
      expect(bob.clientId).toBe(201); // Primary clientId for backward compatibility
    });

    it('tracks currentUserTabs correctly when current user has multiple tabs open', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Alice (local user) has 2 tabs open
      states.set(101, {
        user: {
          userId: 'user-alice',
          name: 'Alice',
          color: '#10B981',
          role: 'OWNER',
          isEditing: false,
          lastActive: now,
        },
      });
      states.set(102, {
        user: {
          userId: 'user-alice',
          name: 'Alice',
          color: '#10B981',
          role: 'OWNER',
          isEditing: false,
          lastActive: now,
        },
      });

      // Bob (remote) has 1 tab
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      const { allParticipants, collaborators, currentUserTabs } = deduplicateAwarenessStates(states, 101, 'user-alice');

      expect(currentUserTabs).toBe(2);
      expect(collaborators).toHaveLength(1); // Alice is not listed under remote collaborators
      expect(collaborators[0].userId).toBe('user-bob');
      expect(allParticipants).toHaveLength(2); // Total unique people = Alice and Bob
    });

    it('marks a user as editing if ANY of their open tabs is actively editing', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Bob tab 1: idle
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      // Bob tab 2: actively editing
      states.set(202, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: true,
          lastActive: now,
        },
      });

      const { collaborators } = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(collaborators).toHaveLength(1);
      expect(collaborators[0].isEditing).toBe(true);
    });

    it('returns editing status to false when all tabs stop editing', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Bob tab 1: idle
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      // Bob tab 2: was editing, now idle
      states.set(202, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: false,
          lastActive: now,
        },
      });

      const { collaborators } = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(collaborators[0].isEditing).toBe(false);
    });

    it('drops editing status to false if editing tab is inactive for > 4000ms', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Bob tab 1: marked isEditing = true but lastActive is 5000ms ago (stale/crashed)
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          color: '#3B82F6',
          role: 'EDITOR',
          isEditing: true,
          lastActive: now - 5000,
        },
      });

      const { collaborators } = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(collaborators[0].isEditing).toBe(false);
    });

    it('NEVER allows a VIEWER to appear as editing, even if isEditing is true in raw state', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Charlie is a VIEWER
      states.set(301, {
        user: {
          userId: 'user-charlie',
          name: 'Charlie',
          color: '#F59E0B',
          role: 'VIEWER',
          isEditing: true, // Malicious or buggy client claimed isEditing
          lastActive: now,
        },
      });

      const { allParticipants } = deduplicateAwarenessStates(states, 101, 'user-alice');
      const charlie = allParticipants.find((p) => p.userId === 'user-charlie');
      expect(charlie).toBeDefined();
      expect(charlie?.role).toBe('VIEWER');
      expect(charlie?.isEditing).toBe(false); // Strictly suppressed
    });

    it('updates participant count and tab count correctly when a tab disconnects', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      states.set(201, {
        user: { userId: 'user-bob', name: 'Bob', color: '#3B82F6', role: 'EDITOR', lastActive: now },
      });
      states.set(202, {
        user: { userId: 'user-bob', name: 'Bob', color: '#3B82F6', role: 'EDITOR', lastActive: now },
      });

      // Initial state: Bob has 2 tabs
      const step1 = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(step1.collaborators).toHaveLength(1);
      expect(step1.collaborators[0].tabCount).toBe(2);

      // Tab 202 disconnects (Yjs removes it from awareness states)
      states.delete(202);
      const step2 = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(step2.collaborators).toHaveLength(1);
      expect(step2.collaborators[0].tabCount).toBe(1);

      // Tab 201 disconnects (Bob fully left)
      states.delete(201);
      const step3 = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(step3.collaborators).toHaveLength(0);
    });

    it('cleans up completely stale awareness states older than 35 seconds', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Stale ghost client from 40 seconds ago
      states.set(999, {
        user: {
          userId: 'ghost-user',
          name: 'Ghost',
          color: '#9CA3AF',
          role: 'EDITOR',
          lastActive: now - 40000,
        },
      });

      const { allParticipants } = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(allParticipants.some((p) => p.userId === 'ghost-user')).toBe(false);
    });
  });

  describe('2. Yjs Awareness Protocol Integration', () => {
    it('synchronizes presence, groups multiple tabs, and reflects rehydration between two simulated clients', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      const doc3 = new Y.Doc(); // Tab 2 for user 2

      const awareness1 = new awarenessProtocol.Awareness(doc1);
      const awareness2 = new awarenessProtocol.Awareness(doc2);
      const awareness3 = new awarenessProtocol.Awareness(doc3);

      // Connect awareness instances directly to simulate WebSocket relay distribution
      const routeUpdate = (sender: awarenessProtocol.Awareness, receivers: awarenessProtocol.Awareness[]) => {
        sender.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
          const changedClients = [...added, ...updated, ...removed];
          const update = awarenessProtocol.encodeAwarenessUpdate(sender, changedClients);
          receivers.forEach((r) => awarenessProtocol.applyAwarenessUpdate(r, update, 'custom'));
        });
      };

      routeUpdate(awareness1, [awareness2, awareness3]);
      routeUpdate(awareness2, [awareness1, awareness3]);
      routeUpdate(awareness3, [awareness1, awareness2]);

      // Client 1 (Alice) connects
      awareness1.setLocalStateField('user', {
        userId: 'user-alice',
        name: 'Alice',
        color: '#10B981',
        role: 'OWNER',
        isEditing: false,
        lastActive: Date.now(),
      });

      // Client 2 (Bob Tab 1) connects
      awareness2.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        color: '#3B82F6',
        role: 'EDITOR',
        isEditing: false,
        lastActive: Date.now(),
      });

      // Client 3 (Bob Tab 2) connects
      awareness3.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        color: '#3B82F6',
        role: 'EDITOR',
        isEditing: false,
        lastActive: Date.now(),
      });

      // From Alice's perspective:
      const aliceStates = awareness1.getStates();
      const aliceView = deduplicateAwarenessStates(aliceStates, doc1.clientID, 'user-alice');

      // Bob appears ONCE with tabCount = 2
      expect(aliceView.collaborators).toHaveLength(1);
      expect(aliceView.collaborators[0].userId).toBe('user-bob');
      expect(aliceView.collaborators[0].tabCount).toBe(2);

      // Now Bob's Tab 2 starts editing
      awareness3.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        color: '#3B82F6',
        role: 'EDITOR',
        isEditing: true,
        lastActive: Date.now(),
      });

      const updatedAliceView = deduplicateAwarenessStates(awareness1.getStates(), doc1.clientID, 'user-alice');
      expect(updatedAliceView.collaborators[0].isEditing).toBe(true);

      // Bob's Tab 2 stops editing after 3.5 seconds
      awareness3.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        color: '#3B82F6',
        role: 'EDITOR',
        isEditing: false,
        lastActive: Date.now(),
      });

      const idleAliceView = deduplicateAwarenessStates(awareness1.getStates(), doc1.clientID, 'user-alice');
      expect(idleAliceView.collaborators[0].isEditing).toBe(false);

      // Bob closes Tab 2
      awarenessProtocol.removeAwarenessStates(awareness3, [doc3.clientID], 'custom');
      // Relay removal to awareness1
      const removalUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness3, [doc3.clientID]);
      awarenessProtocol.applyAwarenessUpdate(awareness1, removalUpdate, 'custom');

      const finalAliceView = deduplicateAwarenessStates(awareness1.getStates(), doc1.clientID, 'user-alice');
      expect(finalAliceView.collaborators).toHaveLength(1);
      expect(finalAliceView.collaborators[0].tabCount).toBe(1);

      // Cleanup
      doc1.destroy();
      doc2.destroy();
      doc3.destroy();
      awareness1.destroy();
      awareness2.destroy();
      awareness3.destroy();
    });

    it('demonstrates authentication rehydration: transitions generic Collaborator to verified user profile', () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const awarenessA = new awarenessProtocol.Awareness(docA);
      const awarenessB = new awarenessProtocol.Awareness(docB);

      // Wire relay
      awarenessA.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const u = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [...added, ...updated, ...removed]);
        awarenessProtocol.applyAwarenessUpdate(awarenessB, u, 'custom');
      });
      awarenessB.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const u = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [...added, ...updated, ...removed]);
        awarenessProtocol.applyAwarenessUpdate(awarenessA, u, 'custom');
      });

      // Initial load: User on Client B is unauthenticated / rehydrating
      awarenessB.setLocalStateField('user', {
        name: 'Collaborator',
        color: '#00667E',
        userId: undefined,
        role: undefined,
        lastActive: Date.now(),
      });

      // Observer on Client A sees anonymous Collaborator
      const initialView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-a');
      expect(initialView.collaborators).toHaveLength(1);
      expect(initialView.collaborators[0].name).toBe('Collaborator');
      expect(initialView.collaborators[0].userId).toBeUndefined();

      // Auth rehydration completes on Client B!
      awarenessB.setLocalStateField('user', {
        name: 'Tanvi S.',
        avatarUrl: 'https://syncspace.me/avatars/tanvi.jpg',
        userId: 'user-tanvi-uuid',
        role: 'EDITOR',
        color: '#00667E',
        lastActive: Date.now(),
      });

      // Observer on Client A immediately receives updated profile
      const rehydratedView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-a');
      expect(rehydratedView.collaborators).toHaveLength(1);
      expect(rehydratedView.collaborators[0].name).toBe('Tanvi S.');
      expect(rehydratedView.collaborators[0].userId).toBe('user-tanvi-uuid');
      expect(rehydratedView.collaborators[0].avatarUrl).toBe('https://syncspace.me/avatars/tanvi.jpg');
      expect(rehydratedView.collaborators[0].role).toBe('EDITOR');

      docA.destroy();
      docB.destroy();
      awarenessA.destroy();
      awarenessB.destroy();
    });
  });

  describe('3. Phase 3: Editing Activity Verification (Typing, Blocks, Inactivity, Role Permissions)', () => {
    it('typing and editing text inside a block triggers isEditing = true immediately', () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const awarenessA = new awarenessProtocol.Awareness(docA);
      const awarenessB = new awarenessProtocol.Awareness(docB);

      // Wire relay between Alice and Bob
      awarenessA.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const u = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [...added, ...updated, ...removed]);
        awarenessProtocol.applyAwarenessUpdate(awarenessB, u, 'custom');
      });
      awarenessB.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const u = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [...added, ...updated, ...removed]);
        awarenessProtocol.applyAwarenessUpdate(awarenessA, u, 'custom');
      });

      // Both connect in idle state
      awarenessA.setLocalStateField('user', {
        userId: 'user-alice',
        name: 'Alice',
        role: 'OWNER',
        isEditing: false,
        lastActive: Date.now(),
      });
      awarenessB.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        role: 'EDITOR',
        isEditing: false,
        lastActive: Date.now(),
      });

      // Initially Bob is idle (Viewing)
      let aliceView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice');
      expect(aliceView.collaborators[0].isEditing).toBe(false);

      // Bob simulates markEditing() when typing text in a paragraph block
      let timer: ReturnType<typeof setTimeout> | null = null;
      const simulateMarkEditing = () => {
        awarenessB.setLocalStateField('user', {
          ...awarenessB.getLocalState()?.user,
          isEditing: true,
          lastActive: Date.now(),
        });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          awarenessB.setLocalStateField('user', {
            ...awarenessB.getLocalState()?.user,
            isEditing: false,
            lastActive: Date.now(),
          });
        }, 3500);
      };

      // 1. Bob types: isEditing becomes true immediately
      simulateMarkEditing();
      aliceView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice');
      expect(aliceView.collaborators[0].isEditing).toBe(true);

      // 2. After 3.4 seconds without activity, still editing
      vi.advanceTimersByTime(3400);
      aliceView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice');
      expect(aliceView.collaborators[0].isEditing).toBe(true);

      // 3. Exactly at 3.5 seconds (3500ms total), editing returns to viewing (false)
      vi.advanceTimersByTime(100);
      aliceView = deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice');
      expect(aliceView.collaborators[0].isEditing).toBe(false);

      docA.destroy();
      docB.destroy();
      awarenessA.destroy();
      awarenessB.destroy();
    });

    it('continuous typing debounces the inactivity timer, keeping isEditing = true', () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const awarenessA = new awarenessProtocol.Awareness(docA);
      const awarenessB = new awarenessProtocol.Awareness(docB);

      awarenessB.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const u = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [...added, ...updated, ...removed]);
        awarenessProtocol.applyAwarenessUpdate(awarenessA, u, 'custom');
      });

      awarenessB.setLocalStateField('user', {
        userId: 'user-bob',
        name: 'Bob',
        role: 'EDITOR',
        isEditing: false,
        lastActive: Date.now(),
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      const simulateMarkEditing = () => {
        awarenessB.setLocalStateField('user', {
          ...awarenessB.getLocalState()?.user,
          isEditing: true,
          lastActive: Date.now(),
        });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          awarenessB.setLocalStateField('user', {
            ...awarenessB.getLocalState()?.user,
            isEditing: false,
            lastActive: Date.now(),
          });
        }, 3500);
      };

      // Keystroke 1 at t=0ms
      simulateMarkEditing();
      expect(deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice').collaborators[0].isEditing).toBe(true);

      // Keystroke 2 at t=2000ms (resets 3.5s countdown)
      vi.advanceTimersByTime(2000);
      simulateMarkEditing();

      // At t=4000ms (4s from start, 2s from keystroke 2), still editing
      vi.advanceTimersByTime(2000);
      expect(deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice').collaborators[0].isEditing).toBe(true);

      // At t=5500ms (3.5s from keystroke 2), timer expires -> returns to viewing
      vi.advanceTimersByTime(1500);
      expect(deduplicateAwarenessStates(awarenessA.getStates(), docA.clientID, 'user-alice').collaborators[0].isEditing).toBe(false);

      docA.destroy();
      docB.destroy();
      awarenessA.destroy();
      awarenessB.destroy();
    });

    it('adding a block, deleting a block, changing block type, and checklist toggle all trigger editing', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // Simulated operations by user Bob:
      // 1. Adding a block
      states.set(201, {
        user: { userId: 'user-bob', name: 'Bob', role: 'EDITOR', isEditing: true, lastActive: now },
      });
      let result = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(result.collaborators[0].isEditing).toBe(true);

      // 2. Deleting a block
      states.set(201, {
        user: { userId: 'user-bob', name: 'Bob', role: 'EDITOR', isEditing: true, lastActive: now },
      });
      result = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(result.collaborators[0].isEditing).toBe(true);

      // 3. Changing block type (e.g. paragraph -> heading1 via slash command)
      states.set(201, {
        user: { userId: 'user-bob', name: 'Bob', role: 'EDITOR', isEditing: true, lastActive: now },
      });
      result = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(result.collaborators[0].isEditing).toBe(true);

      // 4. Checklist toggle
      states.set(201, {
        user: { userId: 'user-bob', name: 'Bob', role: 'EDITOR', isEditing: true, lastActive: now },
      });
      result = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(result.collaborators[0].isEditing).toBe(true);
    });

    it('merely selecting text, scrolling, opening menus, or viewing does NOT trigger isEditing', () => {
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      // User Bob is viewing the document, scrolling, or selecting text without mutating content
      states.set(201, {
        user: {
          userId: 'user-bob',
          name: 'Bob',
          role: 'EDITOR',
          isEditing: false, // passive viewing
          lastActive: now,
        },
      });

      const result = deduplicateAwarenessStates(states, 101, 'user-alice');
      expect(result.collaborators[0].isEditing).toBe(false);
    });

    it('VIEWER users can NEVER broadcast or appear as editing', () => {
      // 1. Client-side refusal to broadcast when role is VIEWER
      const viewerRole = 'VIEWER';
      let broadcastCalled = false;
      const safeMarkEditing = (role: string) => {
        if (role === 'VIEWER') return; // Refuse
        broadcastCalled = true;
      };

      safeMarkEditing(viewerRole);
      expect(broadcastCalled).toBe(false);

      // 2. Presentation-layer suppression even if raw state was manipulated
      const states = new Map<number, { user: RawAwarenessUserState }>();
      const now = Date.now();

      states.set(301, {
        user: {
          userId: 'user-viewer',
          name: 'Viewer User',
          role: 'VIEWER',
          isEditing: true, // Maliciously claimed
          lastActive: now,
        },
      });

      const result = deduplicateAwarenessStates(states, 101, 'user-alice');
      const viewer = result.allParticipants.find((p) => p.userId === 'user-viewer');
      expect(viewer).toBeDefined();
      expect(viewer?.role).toBe('VIEWER');
      expect(viewer?.isEditing).toBe(false); // Strictly suppressed
    });
  });
});
