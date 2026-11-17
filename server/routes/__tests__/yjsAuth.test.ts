import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Hoist mock for Prisma database client before any server module loads
const { prismaMock } = vi.hoisted(() => {
  let userSeq = 1;
  let docSeq = 1;
  let shareSeq = 1;

  const usersStore = new Map<string, any>();
  const docsStore = new Map<string, any>();
  const sharesStore = new Map<string, any>();

  const mock = {
    user: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = data.id || `user-mock-${userSeq++}`;
        const record = { id, authVersion: data.authVersion ?? 0, ...data };
        usersStore.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where, select }: { where: { id?: string; email?: string }; select?: any }) => {
        let user: any = null;
        if (where.id) user = usersStore.get(where.id);
        else if (where.email) user = Array.from(usersStore.values()).find((u) => u.email === where.email);
        if (!user) return null;
        if (select?.authVersion) return { authVersion: user.authVersion ?? 0 };
        return user;
      }),
      deleteMany: vi.fn(async ({ where }: { where?: any }) => {
        if (where?.id?.in && Array.isArray(where.id.in)) {
          for (const id of where.id.in) {
            usersStore.delete(id);
          }
        }
        return { count: 1 };
      }),
    },
    document: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = data.id || `doc-mock-${docSeq++}`;
        const record = { id, ...data, shares: [] };
        docsStore.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: any }) => {
        const doc = docsStore.get(where.id);
        if (!doc) return null;
        if (include?.shares) {
          const docShares = Array.from(sharesStore.values()).filter((s) => s.documentId === doc.id);
          if (include.shares.where?.userId) {
            return {
              ...doc,
              shares: docShares.filter((s) => s.userId === include.shares.where.userId),
            };
          }
          return { ...doc, shares: docShares };
        }
        return doc;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        docsStore.delete(where.id);
        return { id: where.id };
      }),
    },
    documentShare: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = data.id || `share-mock-${shareSeq++}`;
        const record = { id, ...data };
        sharesStore.set(id, record);
        return record;
      }),
    },
  };

  return { prismaMock: mock };
});

vi.mock('../../lib/db/client', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import { prisma } from '../../lib/db/client';
import { signToken } from '../../lib/auth/jwt';
import { createYjsServer } from '../../yjsServer';
import { authorizeYjsConnection } from '../../lib/yjs/auth';

describe('Yjs WebSocket Server Role Authorization & Access Control', () => {
  let ownerUser: { id: string; email: string };
  let editorUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };
  let testDoc: { id: string; title: string };

  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let outsiderToken: string;

  beforeAll(async () => {
    // Generate unique emails for test isolation
    const stamp = Date.now();
    const ownerEmail = `yjs-owner-${stamp}@test.dev`;
    const editorEmail = `yjs-editor-${stamp}@test.dev`;
    const viewerEmail = `yjs-viewer-${stamp}@test.dev`;
    const outsiderEmail = `yjs-outsider-${stamp}@test.dev`;

    ownerUser = await prisma.user.create({
      data: { email: ownerEmail, passwordHash: 'hash', name: 'Owner User' },
    });
    editorUser = await prisma.user.create({
      data: { email: editorEmail, passwordHash: 'hash', name: 'Editor User' },
    });
    viewerUser = await prisma.user.create({
      data: { email: viewerEmail, passwordHash: 'hash', name: 'Viewer User' },
    });
    outsiderUser = await prisma.user.create({
      data: { email: outsiderEmail, passwordHash: 'hash', name: 'Outsider User' },
    });

    testDoc = await prisma.document.create({
      data: {
        title: 'Yjs Collab Test Document',
        type: 'doc',
        userId: ownerUser.id,
      },
    });

    // Share with editor
    await prisma.documentShare.create({
      data: {
        documentId: testDoc.id,
        userId: editorUser.id,
        permission: 'EDITOR',
      },
    });

    // Share with viewer
    await prisma.documentShare.create({
      data: {
        documentId: testDoc.id,
        userId: viewerUser.id,
        permission: 'VIEWER',
      },
    });

    ownerToken = signToken({ userId: ownerUser.id, email: ownerUser.email });
    editorToken = signToken({ userId: editorUser.id, email: editorUser.email });
    viewerToken = signToken({ userId: viewerUser.id, email: viewerUser.email });
    outsiderToken = signToken({ userId: outsiderUser.id, email: outsiderUser.email });
  });

  afterAll(async () => {
    // Clean up test data
    if (testDoc?.id) {
      await prisma.document.delete({ where: { id: testDoc.id } }).catch(() => {});
    }
    const userIds = [ownerUser?.id, editorUser?.id, viewerUser?.id, outsiderUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
  });

  it('rejects connection when no auth token is provided (401)', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(false);
    expect(res.status).toBe(401);
  });

  it('rejects connection with invalid token (401)', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}?token=invalid-jwt-token`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(false);
    expect(res.status).toBe(401);
  });

  it('allows authenticated users to connect to directory room', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/workspace-directory?token=${ownerToken}`);

    const res = await authorizeYjsConnection(mockReq, 'workspace-directory', url);
    expect(res.authorized).toBe(true);
    expect(res.status).toBe(200);
    expect(res.userId).toBe(ownerUser.id);
  });

  it('authorizes document owner with OWNER role', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}?token=${ownerToken}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(true);
    expect(res.permission).toBe('OWNER');
    expect(res.userId).toBe(ownerUser.id);
  });

  it('authorizes collaborator with EDITOR role', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}?token=${editorToken}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(true);
    expect(res.permission).toBe('EDITOR');
    expect(res.userId).toBe(editorUser.id);
  });

  it('authorizes collaborator with VIEWER role', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}?token=${viewerToken}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(true);
    expect(res.permission).toBe('VIEWER');
    expect(res.userId).toBe(viewerUser.id);
  });

  it('rejects unauthorized user from accessing unshared document (403)', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}?token=${outsiderToken}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(false);
    expect(res.status).toBe(403);
  });

  it('rejects connection to nonexistent document (404)', async () => {
    const mockReq = {
      headers: {},
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:nonexistent-doc-id-999?token=${ownerToken}`);

    const res = await authorizeYjsConnection(mockReq, 'syncspace:doc:nonexistent-doc-id-999', url);
    expect(res.authorized).toBe(false);
    expect(res.status).toBe(404);
  });

  it('supports token extraction from cookie header', async () => {
    const mockReq = {
      headers: {
        cookie: `some_cookie=abc; auth_token=${ownerToken}; other=xyz`,
      },
    } as any;
    const url = new URL(`http://localhost:1234/syncspace:doc:${testDoc.id}`);

    const res = await authorizeYjsConnection(mockReq, `syncspace:doc:${testDoc.id}`, url);
    expect(res.authorized).toBe(true);
    expect(res.permission).toBe('OWNER');
  });
});
