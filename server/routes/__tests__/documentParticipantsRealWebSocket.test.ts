import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Hoist mock for Prisma database client before any server module loads
const { prismaMock, mockUsers, mockDoc } = vi.hoisted(() => {
  const users: Record<string, { id: string; name: string; email: string; avatarUrl: string | null; authVersion: number }> = {
    'user-tanvi': {
      id: 'user-tanvi',
      name: 'Tanvi S.',
      email: 'tanvi@syncspace.me',
      avatarUrl: 'https://syncspace.me/avatars/tanvi.jpg',
      authVersion: 1,
    },
    'user-mannat': {
      id: 'user-mannat',
      name: 'Mannat K.',
      email: 'mannat@syncspace.me',
      avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
      authVersion: 1,
    },
    'user-rohan': {
      id: 'user-rohan',
      name: 'Rohan M.',
      email: 'rohan@syncspace.me',
      avatarUrl: null,
      authVersion: 1,
    },
    'user-stranger': {
      id: 'user-stranger',
      name: 'Stranger User',
      email: 'stranger@syncspace.me',
      avatarUrl: null,
      authVersion: 1,
    },
  };

  const doc = {
    id: 'doc-real-ws-1',
    title: 'SyncSpace PRD & Engineering Spec',
    type: 'doc' as const,
    userId: 'user-tanvi', // Tanvi is original owner
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: users['user-tanvi'],
    shares: [
      {
        id: 'share-mannat',
        documentId: 'doc-real-ws-1',
        userId: 'user-mannat',
        permission: 'EDITOR' as const,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        user: users['user-mannat'],
      },
      {
        id: 'share-rohan',
        documentId: 'doc-real-ws-1',
        userId: 'user-rohan',
        permission: 'VIEWER' as const,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        user: users['user-rohan'],
      },
    ],
  };

  const mock = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users[where.id] || null;
        if (where.email) return Object.values(users).find((u) => u.email === where.email) || null;
        return null;
      }),
    },
    document: {
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: any }) => {
        if (where.id !== doc.id) return null;
        if (include?.shares?.where?.userId) {
          const filterUserId = include.shares.where.userId;
          const filteredShares = doc.shares.filter((s) => s.userId === filterUserId);
          return {
            ...doc,
            shares: filteredShares,
          };
        }
        if (include?.shares) {
          return {
            ...doc,
            shares: [...doc.shares],
          };
        }
        return {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          userId: doc.userId,
          isFavorite: doc.isFavorite,
          isDeleted: doc.isDeleted,
          deletedAt: doc.deletedAt,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          user: doc.user,
        };
      }),
    },
    documentShare: {
      findUnique: vi.fn(async ({ where }: { where: { documentId_userId?: { documentId: string; userId: string } } }) => {
        if (where.documentId_userId) {
          const { documentId, userId } = where.documentId_userId;
          if (documentId !== doc.id) return null;
          return doc.shares.find((s) => s.userId === userId) || null;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { documentId: string } }) => {
        if (where.documentId === doc.id) {
          return [...doc.shares];
        }
        return [];
      }),
    },
  };

  return { prismaMock: mock, mockUsers: users, mockDoc: doc };
});

vi.mock('../../lib/db/client', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  buildEndSessionUrl: vi.fn(),
}));

// Import server modules after mocks are installed
import { createYjsServer } from '../../yjsServer';
import { signToken } from '../../lib/auth/jwt';
import { revokeUserConnections } from '../../lib/yjs/sessionConnections';

describe('Phase 5: Real Two-Account WebSocket Collaboration & Access Control', () => {
  let serverInstance: http.Server;
  let serverPort: number;
  let wsUrl: string;

  const tanviToken = signToken({ userId: 'user-tanvi', email: 'tanvi@syncspace.me', authVersion: 1 });
  const mannatToken = signToken({ userId: 'user-mannat', email: 'mannat@syncspace.me', authVersion: 1 });
  const rohanToken = signToken({ userId: 'user-rohan', email: 'rohan@syncspace.me', authVersion: 1 });
  const strangerToken = signToken({ userId: 'user-stranger', email: 'stranger@syncspace.me', authVersion: 1 });

  const documentRoom = 'syncspace:doc:doc-real-ws-1';

  beforeAll(async () => {
    const { server, start } = createYjsServer();
    serverInstance = server;
    await start(0, '127.0.0.1');
    const addr = server.address();
    serverPort = typeof addr === 'object' && addr ? addr.port : 54321;
    wsUrl = `ws://127.0.0.1:${serverPort}`;
  });

  afterAll(async () => {
    if (serverInstance) {
      await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
    }
  });

  // =========================================================================
  // 1. Real Two-Account Testing with Live WebSockets
  // =========================================================================
  describe('1. Live Real-Time Two-Account WebSocket Connection & Presence', () => {
    it('Tanvi (Owner) connects to the document room over WebSocket with valid JWT', async () => {
      const client = new WebSocket(`${wsUrl}/${documentRoom}?token=${tanviToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          expect(client.readyState).toBe(WebSocket.OPEN);
          client.close();
          resolve();
        });
        client.on('error', (err: any) => reject(err));
      });
    });

    it('Mannat (Editor) connects to the shared document room over WebSocket with valid JWT', async () => {
      const client = new WebSocket(`${wsUrl}/${documentRoom}?token=${mannatToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          expect(client.readyState).toBe(WebSocket.OPEN);
          client.close();
          resolve();
        });
        client.on('error', (err: any) => reject(err));
      });
    });

    it('Tanvi and Mannat both connect and exchange real binary awareness updates over WebSocket', async () => {
      const tanviClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${tanviToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      const mannatClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${mannatToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await Promise.all([
        new Promise<void>((res) => tanviClient.on('open', () => res())),
        new Promise<void>((res) => mannatClient.on('open', () => res())),
      ]);

      // Set up awareness on Tanvi's side
      const tanviDoc = new Y.Doc();
      const tanviAwareness = new awarenessProtocol.Awareness(tanviDoc);
      tanviAwareness.setLocalState({
        user: {
          userId: 'user-tanvi',
          name: 'Tanvi S.',
          role: 'OWNER',
          avatarUrl: 'https://syncspace.me/avatars/tanvi.jpg',
          isEditing: false,
          lastActive: Date.now(),
        },
      });

      // Set up awareness on Mannat's side
      const mannatDoc = new Y.Doc();
      const mannatAwareness = new awarenessProtocol.Awareness(mannatDoc);
      const mannatClientId = mannatAwareness.clientID;
      mannatAwareness.setLocalState({
        user: {
          userId: 'user-mannat',
          name: 'Mannat K.',
          role: 'EDITOR',
          avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
          isEditing: false,
          lastActive: Date.now(),
        },
      });

      // Send Mannat's awareness update into the WebSocket
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // messageAwareness = 1
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(mannatAwareness, [mannatClientId])
      );
      mannatClient.send(encoding.toUint8Array(encoder));

      // Tanvi receives awareness update from WebSocket
      const receivedAwarenessPromise = new Promise<void>((resolve) => {
        tanviClient.on('message', (data: Buffer) => {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          const messageType = decoding.readVarUint(decoder);
          if (messageType === 1) {
            // messageAwareness
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(tanviAwareness, update, 'server');
            const states = tanviAwareness.getStates();
            if (states.has(mannatClientId)) {
              const mannatState = states.get(mannatClientId)?.user;
              expect(mannatState?.userId).toBe('user-mannat');
              expect(mannatState?.name).toBe('Mannat K.');
              resolve();
            }
          }
        });
      });

      await receivedAwarenessPromise;

      tanviClient.close();
      mannatClient.close();
    });

    it('Live editing propagation: Mannat sets isEditing: true and Tanvi receives the active editing flag', async () => {
      const tanviClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${tanviToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      const mannatClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${mannatToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await Promise.all([
        new Promise<void>((res) => tanviClient.on('open', () => res())),
        new Promise<void>((res) => mannatClient.on('open', () => res())),
      ]);

      const tanviDoc = new Y.Doc();
      const tanviAwareness = new awarenessProtocol.Awareness(tanviDoc);

      const mannatDoc = new Y.Doc();
      const mannatAwareness = new awarenessProtocol.Awareness(mannatDoc);
      const mannatClientId = mannatAwareness.clientID;
      mannatAwareness.setLocalState({
        user: {
          userId: 'user-mannat',
          name: 'Mannat K.',
          role: 'EDITOR',
          avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
          isEditing: false,
          lastActive: Date.now(),
        },
      });

      // Listen for Mannat's editing broadcast on Tanvi's socket
      const editingBroadcastPromise = new Promise<void>((resolve) => {
        tanviClient.on('message', (data: Buffer) => {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          const msgType = decoding.readVarUint(decoder);
          if (msgType === 1) {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(tanviAwareness, update, 'server');
            const mannatState = tanviAwareness.getStates().get(mannatClientId)?.user;
            if (mannatState && mannatState.isEditing === true) {
              expect(mannatState.name).toBe('Mannat K.');
              expect(mannatState.isEditing).toBe(true);
              resolve();
            }
          }
        });
      });

      // Mannat starts editing
      mannatAwareness.setLocalState({
        user: {
          userId: 'user-mannat',
          name: 'Mannat K.',
          role: 'EDITOR',
          avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
          isEditing: true,
          lastActive: Date.now(),
        },
      });

      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(mannatAwareness, [mannatClientId])
      );
      mannatClient.send(encoding.toUint8Array(enc));

      await editingBroadcastPromise;

      tanviClient.close();
      mannatClient.close();
    });

    it('Inactivity reset: Mannat stops editing and after inactivity isEditing resets to false', async () => {
      const tanviClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${tanviToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      const mannatClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${mannatToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await Promise.all([
        new Promise<void>((res) => tanviClient.on('open', () => res())),
        new Promise<void>((res) => mannatClient.on('open', () => res())),
      ]);

      const tanviDoc = new Y.Doc();
      const tanviAwareness = new awarenessProtocol.Awareness(tanviDoc);

      const mannatDoc = new Y.Doc();
      const mannatAwareness = new awarenessProtocol.Awareness(mannatDoc);
      const mannatClientId = mannatAwareness.clientID;
      mannatAwareness.setLocalState({
        user: {
          userId: 'user-mannat',
          name: 'Mannat K.',
          role: 'EDITOR',
          avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
          isEditing: true,
          lastActive: Date.now(),
        },
      });

      const idleBroadcastPromise = new Promise<void>((resolve) => {
        tanviClient.on('message', (data: Buffer) => {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          const msgType = decoding.readVarUint(decoder);
          if (msgType === 1) {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(tanviAwareness, update, 'server');
            const state = tanviAwareness.getStates().get(mannatClientId)?.user;
            if (state && state.isEditing === false) {
              resolve();
            }
          }
        });
      });

      // Mannat sets isEditing: false (simulating 3.5s inactivity timeout)
      mannatAwareness.setLocalState({
        user: {
          userId: 'user-mannat',
          name: 'Mannat K.',
          role: 'EDITOR',
          avatarUrl: 'https://syncspace.me/avatars/mannat.jpg',
          isEditing: false,
          lastActive: Date.now(),
        },
      });

      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(mannatAwareness, [mannatClientId])
      );
      mannatClient.send(encoding.toUint8Array(enc));

      await idleBroadcastPromise;

      tanviClient.close();
      mannatClient.close();
    });

    it('Session revocation: revokeUserConnections closes active WebSocket on logout / password reset', async () => {
      const rohanClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${rohanToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await new Promise<void>((res) => rohanClient.on('open', () => res()));
      expect(rohanClient.readyState).toBe(WebSocket.OPEN);

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        rohanClient.on('close', (code: number, reason: Buffer) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      // Trigger session revocation for Rohan
      revokeUserConnections('user-rohan');

      const closeInfo = await closePromise;
      expect(closeInfo.code).toBe(4001);
      expect(closeInfo.reason).toBe('Session expired');
    });
  });

  // =========================================================================
  // 2. Server Security & Permission Enforcement
  // =========================================================================
  describe('2. WebSocket Server Security & Permission Enforcement', () => {
    it('Security 1: WebSocket upgrade is rejected when Origin is untrusted (403 Forbidden)', async () => {
      const client = new WebSocket(`${wsUrl}/${documentRoom}?token=${tanviToken}`, {
        headers: { Origin: 'https://malicious-phishing-site.com' },
      });

      const failurePromise = new Promise<number>((resolve) => {
        client.on('unexpected-response', (_req: any, res: any) => {
          resolve(res.statusCode || 0);
        });
      });

      const statusCode = await failurePromise;
      expect(statusCode).toBe(403);
    });

    it('Security 2: WebSocket upgrade is rejected when token is missing (401 Unauthorized)', async () => {
      const client = new WebSocket(`${wsUrl}/${documentRoom}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      const failurePromise = new Promise<number>((resolve) => {
        client.on('unexpected-response', (_req: any, res: any) => {
          resolve(res.statusCode || 0);
        });
      });

      const statusCode = await failurePromise;
      expect(statusCode).toBe(401);
    });

    it('Security 3: WebSocket upgrade is rejected for unauthorized user not in shares (403 Forbidden)', async () => {
      const client = new WebSocket(`${wsUrl}/${documentRoom}?token=${strangerToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      const failurePromise = new Promise<number>((resolve) => {
        client.on('unexpected-response', (_req: any, res: any) => {
          resolve(res.statusCode || 0);
        });
      });

      const statusCode = await failurePromise;
      expect(statusCode).toBe(403);
    });

    it('Security 4: VIEWER modification is rejected by Yjs server with permission denied message', async () => {
      const rohanClient = new WebSocket(`${wsUrl}/${documentRoom}?token=${rohanToken}`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      await new Promise<void>((res) => rohanClient.on('open', () => res()));

      // Rohan (VIEWER) attempts to send a write update (syncStep2)
      const fakeUpdate = new Uint8Array([0, 1, 2, 3]);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // messageSync
      encoding.writeVarUint(enc, syncProtocol.messageYjsSyncStep2);
      encoding.writeVarUint8Array(enc, fakeUpdate);

      const permissionDeniedPromise = new Promise<string>((resolve) => {
        rohanClient.on('message', (data: Buffer) => {
          const dec = decoding.createDecoder(new Uint8Array(data));
          const msgType = decoding.readVarUint(dec);
          if (msgType === 2) {
            // messageAuth = 2
            decoding.readVarUint(dec); // skip permissionDenied type
            const reason = decoding.readVarString(dec);
            resolve(reason);
          }
        });
      });

      rohanClient.send(encoding.toUint8Array(enc));

      const reason = await permissionDeniedPromise;
      expect(reason).toContain('Viewers have read-only permissions');

      rohanClient.close();
    });
  });
});
