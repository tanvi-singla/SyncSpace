import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
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
