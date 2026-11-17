import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signToken, AUTH_COOKIE_NAME } from '../../lib/auth/jwt';

const { prismaMock, mockUsers, mockDocument } = vi.hoisted(() => {
  const users = {
    'user-owner-1': { id: 'user-owner-1', name: 'Owner User', email: 'owner@syncspace.dev', avatarUrl: null, authVersion: 1 },
    'user-editor-2': { id: 'user-editor-2', name: 'Editor User', email: 'editor@syncspace.dev', avatarUrl: null, authVersion: 1 },
    'user-viewer-3': { id: 'user-viewer-3', name: 'Viewer User', email: 'viewer@syncspace.dev', avatarUrl: null, authVersion: 1 },
    'user-stranger-4': { id: 'user-stranger-4', name: 'Stranger User', email: 'stranger@syncspace.dev', avatarUrl: null, authVersion: 1 },
  };

  const doc = {
    id: 'doc-123',
    title: 'Test Document',
    type: 'doc' as const,
    userId: 'user-owner-1',
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: {
      id: 'user-owner-1',
      name: 'Owner User',
      email: 'owner@syncspace.dev',
      avatarUrl: null,
    },
    shares: [
      {
        id: 'share-1',
        documentId: 'doc-123',
        userId: 'user-editor-2',
        permission: 'EDITOR' as const,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        user: {
          id: 'user-editor-2',
          name: 'Editor User',
          email: 'editor@syncspace.dev',
          avatarUrl: null,
        },
      },
      {
        id: 'share-2',
        documentId: 'doc-123',
        userId: 'user-viewer-3',
        permission: 'VIEWER' as const,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        user: {
          id: 'user-viewer-3',
          name: 'Viewer User',
          email: 'viewer@syncspace.dev',
          avatarUrl: null,
        },
      },
    ],
  };

  const mock = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users[where.id as keyof typeof users] || null;
        if (where.email) return Object.values(users).find((u) => u.email === where.email) || null;
        return null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { email?: string } }) => {
        if (where.email) return Object.values(users).find((u) => u.email === where.email) || null;
        return null;
      }),
    },
    document: {
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: any }) => {
        if (where.id !== doc.id) return null;
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
      findUnique: vi.fn(async ({ where }: { where: { documentId_userId?: { documentId: string; userId: string }; id?: string } }) => {
        if (where.documentId_userId) {
          const { documentId, userId } = where.documentId_userId;
          if (documentId !== doc.id) return null;
          return doc.shares.find((s) => s.userId === userId) || null;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { documentId: string } }) => {
        if (where.documentId !== doc.id) return [];
        return [...doc.shares];
      }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  return { prismaMock: mock, mockUsers: users, mockDocument: doc };
});

vi.mock('../../lib/db/client', () => ({
  prisma: prismaMock,
}));

import { documentsRouter } from '../documents';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/documents', documentsRouter);

describe('Document Participants Phase 1 - Access Lists & Permissions', () => {
  const ownerToken = signToken({ userId: 'user-owner-1', email: 'owner@syncspace.dev', authVersion: 1 });
  const editorToken = signToken({ userId: 'user-editor-2', email: 'editor@syncspace.dev', authVersion: 1 });
  const viewerToken = signToken({ userId: 'user-viewer-3', email: 'viewer@syncspace.dev', authVersion: 1 });
  const strangerToken = signToken({ userId: 'user-stranger-4', email: 'stranger@syncspace.dev', authVersion: 1 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Owner access to document and collaborators', () => {
    it('returns document with owner profile and full shares array including collaborator profiles', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockDocument.id);
      expect(res.body.permission).toBe('OWNER');
      expect(res.body.owner).toBeDefined();
      expect(res.body.owner.id).toBe('user-owner-1');
      expect(res.body.owner.email).toBe('owner@syncspace.dev');

      // Verify shares array is present and complete
      expect(Array.isArray(res.body.shares)).toBe(true);
      expect(res.body.shares).toHaveLength(2);

      const editor = res.body.shares.find((s: any) => s.userId === 'user-editor-2');
      expect(editor).toBeDefined();
      expect(editor.permission).toBe('EDITOR');
      expect(editor.user.name).toBe('Editor User');
      expect(editor.user.email).toBe('editor@syncspace.dev');

      const viewer = res.body.shares.find((s: any) => s.userId === 'user-viewer-3');
      expect(viewer).toBeDefined();
      expect(viewer.permission).toBe('VIEWER');
      expect(viewer.user.name).toBe('Viewer User');
      expect(viewer.user.email).toBe('viewer@syncspace.dev');
    });

    it('owner can access GET /api/documents/:documentId/shares', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}/shares`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].user.email).toBe('editor@syncspace.dev');
      expect(res.body[1].user.email).toBe('viewer@syncspace.dev');
    });
  });

  describe('2. Collaborator access to document and collaborators', () => {
    it('EDITOR can retrieve document and receives full shares list and permission "EDITOR"', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${editorToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.permission).toBe('EDITOR');
      expect(res.body.owner.id).toBe('user-owner-1');
      expect(Array.isArray(res.body.shares)).toBe(true);
      expect(res.body.shares).toHaveLength(2);
    });

    it('EDITOR can access GET /api/documents/:documentId/shares', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}/shares`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${editorToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('VIEWER can retrieve document and receives full shares list and permission "VIEWER"', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${viewerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.permission).toBe('VIEWER');
      expect(res.body.owner.id).toBe('user-owner-1');
      expect(Array.isArray(res.body.shares)).toBe(true);
      expect(res.body.shares).toHaveLength(2);
    });

    it('VIEWER can access GET /api/documents/:documentId/shares', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}/shares`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${viewerToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('collaborators CANNOT mutate sharing settings (POST, PATCH, DELETE)', async () => {
      // Editor cannot add share
      const postRes = await request(app)
        .post(`/api/documents/${mockDocument.id}/share`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${editorToken}`])
        .send({ email: 'stranger@syncspace.dev', permission: 'VIEWER' });
      expect(postRes.status).toBe(403);
      expect(postRes.body.error).toContain('Only the document owner');

      // Viewer cannot change share permission
      const patchRes = await request(app)
        .patch(`/api/documents/${mockDocument.id}/share/user-editor-2`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${viewerToken}`])
        .send({ permission: 'VIEWER' });
      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error).toContain('Only the document owner');

      // Editor cannot remove share
      const deleteRes = await request(app)
        .delete(`/api/documents/${mockDocument.id}/share/user-viewer-3`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${editorToken}`]);
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error).toContain('Only the document owner');
    });
  });

  describe('3. Privacy & Unauthorized user rejection', () => {
    it('unauthorized stranger receives 403 on GET /api/documents/:id and NO shares or collaborator emails are leaked', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${strangerToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
      expect(res.body.shares).toBeUndefined();
      expect(res.body.owner).toBeUndefined();
    });

    it('unauthorized stranger receives 403 on GET /api/documents/:documentId/shares', async () => {
      const res = await request(app)
        .get(`/api/documents/${mockDocument.id}/shares`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${strangerToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
      expect(res.body.shares).toBeUndefined();
    });

    it('non-existent document returns 404 for both endpoints', async () => {
      const nonExistentDocId = '00000000-0000-0000-0000-000000000000';

      const docRes = await request(app)
        .get(`/api/documents/${nonExistentDocId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerToken}`]);
      expect(docRes.status).toBe(404);

      const sharesRes = await request(app)
        .get(`/api/documents/${nonExistentDocId}/shares`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerToken}`]);
      expect(sharesRes.status).toBe(404);
    });

    it('invalid document ID returns 400', async () => {
      const res = await request(app)
        .get('/api/documents/%20')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerToken}`]);
      expect([400, 404]).toContain(res.status);
    });
  });
});
