import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Hoist mock for Prisma database client before any server module loads
const { prismaMock } = vi.hoisted(() => {
  let userSeq = 1;
  let docSeq = 1;
  let shareSeq = 1;

  const initialTanvi = {
    id: 'user-tanvi-seed-1',
    name: 'Tanvi',
    email: 'tanvi1841.becse24@chitkara.edu.in',
    avatarUrl: null,
    authVersion: 0,
    passwordHash: '$2b$10$hashedtestpassword123456789012345678901234567890',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const initialProject7 = {
    id: 'user-p7-seed-2',
    name: 'Project 7',
    email: 'project7@syncspace.dev',
    avatarUrl: null,
    authVersion: 0,
    passwordHash: '$2b$10$hashedtestpassword123456789012345678901234567890',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const docAbc = {
    id: 'doc-abc-101',
    title: 'ABC',
    type: 'doc' as const,
    userId: initialTanvi.id,
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
  };

  const docCanvas = {
    id: 'doc-canvas-102',
    title: 'Untitled Canvas',
    type: 'canvas' as const,
    userId: initialTanvi.id,
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T11:00:00.000Z'),
    updatedAt: new Date('2026-01-01T11:00:00.000Z'),
  };

  const docShared1 = {
    id: 'doc-shared-201',
    title: 'sharedoc by project 7',
    type: 'doc' as const,
    userId: initialProject7.id,
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    updatedAt: new Date('2026-01-01T12:00:00.000Z'),
  };

  const docShared2 = {
    id: 'doc-shared-202',
    title: 'abcc canvas',
    type: 'canvas' as const,
    userId: initialProject7.id,
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T13:00:00.000Z'),
    updatedAt: new Date('2026-01-01T13:00:00.000Z'),
  };

  const share1 = {
    id: 'share-p7-doc-1',
    documentId: docShared1.id,
    userId: initialTanvi.id,
    permission: 'EDITOR' as const,
    createdAt: new Date('2026-01-01T14:00:00.000Z'),
  };

  const share2 = {
    id: 'share-p7-canvas-2',
    documentId: docShared2.id,
    userId: initialTanvi.id,
    permission: 'EDITOR' as const,
    createdAt: new Date('2026-01-01T15:00:00.000Z'),
  };

  const usersStore = new Map<string, any>([
    [initialTanvi.id, initialTanvi],
    [initialProject7.id, initialProject7],
  ]);

  const docsStore = new Map<string, any>([
    [docAbc.id, docAbc],
    [docCanvas.id, docCanvas],
    [docShared1.id, docShared1],
    [docShared2.id, docShared2],
  ]);

  const sharesStore = new Map<string, any>([
    [share1.id, share1],
    [share2.id, share2],
  ]);

  const mock = {
    user: {
      findFirst: vi.fn(async ({ where }: { where?: any } = {}) => {
        const allUsers = Array.from(usersStore.values());
        if (!where) return allUsers[0] ? { ...allUsers[0] } : null;
        if (where.OR && Array.isArray(where.OR)) {
          const found = allUsers.find((u) =>
            where.OR.some((cond: any) =>
              (cond.email && u.email.toLowerCase() === cond.email.toLowerCase()) ||
              (cond.name && u.name === cond.name) ||
              (cond.id && u.id === cond.id)
            )
          );
          return found ? { ...found } : null;
        }
        const found = allUsers.find((u) => {
          if (where.id && u.id !== where.id) return false;
          if (where.email && u.email.toLowerCase() !== where.email.toLowerCase()) return false;
          if (where.name && u.name !== where.name) return false;
          return true;
        });
        return found ? { ...found } : null;
      }),
      findUnique: vi.fn(async ({ where, select }: { where: { id?: string; email?: string }; select?: any }) => {
        let user: any = null;
        if (where.id) user = usersStore.get(where.id);
        else if (where.email) {
          const target = where.email.toLowerCase();
          user = Array.from(usersStore.values()).find((u) => u.email.toLowerCase() === target);
        }
        if (!user) return null;
        if (select?.authVersion) return { authVersion: user.authVersion ?? 0 };
        return { ...user };
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = data.id || `user-mock-${userSeq++}`;
        const record = {
          id,
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash ?? null,
          avatarUrl: data.avatarUrl ?? null,
          authVersion: data.authVersion ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        usersStore.set(id, record);
        return { ...record };
      }),
      deleteMany: vi.fn(async ({ where }: { where?: any } = {}) => {
        let count = 0;
        if (where?.email) {
          const target = where.email.toLowerCase();
          for (const [id, u] of usersStore.entries()) {
            if (u.email.toLowerCase() === target) {
              usersStore.delete(id);
              count++;
            }
          }
        } else if (where?.id) {
          if (typeof where.id === 'string') {
            if (usersStore.delete(where.id)) count++;
          } else if (where.id.in && Array.isArray(where.id.in)) {
            for (const id of where.id.in) {
              if (usersStore.delete(id)) count++;
            }
          }
        }
        return { count };
      }),
    },
    document: {
      findFirst: vi.fn(async ({ where }: { where?: any } = {}) => {
        const allDocs = Array.from(docsStore.values());
        if (!where) return allDocs[0] ? { ...allDocs[0] } : null;
        const found = allDocs.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.userId && d.userId !== where.userId) return false;
          if (where.title && d.title !== where.title) return false;
          if (where.isDeleted !== undefined && d.isDeleted !== where.isDeleted) return false;
          return true;
        });
        return found ? { ...found } : null;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: any }) => {
        const doc = docsStore.get(where.id);
        if (!doc) return null;
        const result: any = { ...doc };
        if (include?.user) {
          const owner = usersStore.get(doc.userId);
          result.user = owner
            ? { id: owner.id, name: owner.name, email: owner.email, avatarUrl: owner.avatarUrl }
            : null;
        }
        if (include?.shares) {
          const docShares = Array.from(sharesStore.values())
            .filter((s) => s.documentId === doc.id)
            .map((s) => {
              const shareCopy: any = { ...s };
              if (include.shares?.include?.user) {
                const shareUser = usersStore.get(s.userId);
                shareCopy.user = shareUser
                  ? { id: shareUser.id, name: shareUser.name, email: shareUser.email, avatarUrl: shareUser.avatarUrl }
                  : null;
              }
              return shareCopy;
            });
          result.shares = docShares;
        }
        return result;
      }),
      findMany: vi.fn(async ({ where, orderBy }: { where?: any; orderBy?: any } = {}) => {
        let docs = Array.from(docsStore.values());
        if (where?.userId) {
          docs = docs.filter((d) => d.userId === where.userId);
        }
        if (where?.isDeleted !== undefined) {
          docs = docs.filter((d) => d.isDeleted === where.isDeleted);
        }
        return docs.map((d) => ({ ...d }));
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = data.id || `doc-mock-${docSeq++}`;
        const record = {
          id,
          title: data.title,
          type: data.type,
          userId: data.userId,
          isFavorite: data.isFavorite ?? false,
          isDeleted: data.isDeleted ?? false,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        docsStore.set(id, record);
        return { ...record };
      }),
      count: vi.fn(async ({ where }: { where?: any } = {}) => {
        let docs = Array.from(docsStore.values());
        if (where?.userId) {
          docs = docs.filter((d) => d.userId === where.userId);
        }
        if (where?.isDeleted !== undefined) {
          docs = docs.filter((d) => d.isDeleted === where.isDeleted);
        }
        return docs.length;
      }),
      deleteMany: vi.fn(async ({ where }: { where?: any } = {}) => {
        let count = 0;
        if (where?.id?.in && Array.isArray(where.id.in)) {
          for (const id of where.id.in) {
            if (docsStore.delete(id)) count++;
          }
        } else if (where?.id) {
          if (docsStore.delete(where.id)) count++;
        }
        return { count };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const doc = docsStore.get(where.id);
        docsStore.delete(where.id);
        return doc || { id: where.id };
      }),
    },
    documentShare: {
      findMany: vi.fn(async ({ where, include, orderBy }: { where?: any; include?: any; orderBy?: any } = {}) => {
        let shares = Array.from(sharesStore.values());
        if (where?.userId) {
          shares = shares.filter((s) => s.userId === where.userId);
        }
        if (where?.documentId) {
          shares = shares.filter((s) => s.documentId === where.documentId);
        }
        if (where?.document?.isDeleted !== undefined) {
          shares = shares.filter((s) => {
            const doc = docsStore.get(s.documentId);
            return doc && doc.isDeleted === where.document.isDeleted;
          });
        }
        return shares.map((s) => {
          const shareCopy: any = { ...s };
          if (include?.document) {
            const doc = docsStore.get(s.documentId);
            if (doc) {
              const docCopy: any = { ...doc };
              if (include.document.include?.user) {
                const docOwner = usersStore.get(doc.userId);
                docCopy.user = docOwner
                  ? { id: docOwner.id, name: docOwner.name, email: docOwner.email, avatarUrl: docOwner.avatarUrl }
                  : null;
              }
              shareCopy.document = docCopy;
            }
          }
          if (include?.user) {
            const shareUser = usersStore.get(s.userId);
            shareCopy.user = shareUser
              ? { id: shareUser.id, name: shareUser.name, email: shareUser.email, avatarUrl: shareUser.avatarUrl }
              : null;
          }
          return shareCopy;
        });
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; documentId_userId?: { documentId: string; userId: string } } }) => {
        if (where.id) {
          const share = sharesStore.get(where.id);
          return share ? { ...share } : null;
        }
        if (where.documentId_userId) {
          const { documentId, userId } = where.documentId_userId;
          const share = Array.from(sharesStore.values()).find(
            (s) => s.documentId === documentId && s.userId === userId
          );
          return share ? { ...share } : null;
        }
        return null;
      }),
      create: vi.fn(async ({ data, include }: { data: any; include?: any }) => {
        const id = data.id || `share-mock-${shareSeq++}`;
        const record = { id, createdAt: new Date(), ...data };
        sharesStore.set(id, record);
        const result: any = { ...record };
        if (include?.user) {
          const u = usersStore.get(data.userId);
          result.user = u
            ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }
            : null;
        }
        return result;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const share = sharesStore.get(where.id);
        sharesStore.delete(where.id);
        return share || { id: where.id };
      }),
    },
    $disconnect: vi.fn(async () => {}),
  };

  return { prismaMock: mock };
});

vi.mock('../../lib/db/client', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import request from 'supertest';
import { app } from '../../index';
import { prisma } from '../../lib/db/client';
import { signToken, AUTH_COOKIE_NAME } from '../../lib/auth/jwt';

describe('Document Access and Creation Tests (/api/documents)', { timeout: 30000 }, () => {
  let tanviToken: string;
  let tanviCookie: string;
  let tanviUserId: string;

  let otherToken: string;
  let otherCookie: string;
  let otherUserId: string;

  const otherUser = {
    email: 'unauthorized-test-user@syncspace.dev',
    password: 'Password123!',
    name: 'Unauthorized User',
  };

  const createdDocIds: string[] = [];

  const extractCookie = (res: request.Response): string => {
    const cookies = res.headers['set-cookie'];
    if (!cookies) return '';
    const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
    const match = cookieArr.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
    return match ? match.split(';')[0] : '';
  };

  beforeAll(async () => {
    // 1. Locate Tanvi's user account in the database
    const tanvi = await prisma.user.findFirst({
      where: {
        OR: [
          { email: 'tanvi1841.becse24@chitkara.edu.in' },
          { name: 'Tanvi' },
        ],
      },
    });

    if (!tanvi) {
      throw new Error("Tanvi's account not found in database for test");
    }

    tanviUserId = tanvi.id;
    tanviToken = signToken({
      userId: tanvi.id,
      email: tanvi.email,
      authVersion: tanvi.authVersion,
    });
    tanviCookie = `${AUTH_COOKIE_NAME}=${tanviToken}`;

    // 2. Clean up any previous test user with the otherUser email
    await prisma.user.deleteMany({
      where: { email: otherUser.email },
    });

    // 3. Register the other user
    const otherRes = await request(app).post('/api/auth/register').send(otherUser);
    expect(otherRes.status).toBe(201);
    otherUserId = otherRes.body.id;
    otherCookie = extractCookie(otherRes);
  });

  afterAll(async () => {
    // Clean up created test documents
    if (createdDocIds.length > 0) {
      await prisma.document.deleteMany({
        where: { id: { in: createdDocIds } },
      });
    }

    // Clean up other test user
    if (otherUserId) {
      await prisma.user.deleteMany({
        where: { id: otherUserId },
      });
    }

    await prisma.$disconnect();
  });

  describe('Bug 1 Verification: Tanvi can see documents she owns or is authorized to access', () => {
    it('restores authenticated session for Tanvi via /api/auth/me', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [tanviCookie]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tanviUserId);
      expect(res.body.name).toBe('Tanvi');
      expect(res.body.email).toBe('tanvi1841.becse24@chitkara.edu.in');
    });

    it('returns Tanvi owned documents (including soft-deleted) from GET /api/documents', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Cookie', [tanviCookie]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Verify that all returned documents belong to Tanvi and have OWNER permission
      for (const doc of res.body) {
        expect(doc.userId).toBe(tanviUserId);
        expect(doc.permission).toBe('OWNER');
      }

      // Check specific known owned document "ABC"
      const abcDoc = res.body.find((d: any) => d.title === 'ABC');
      expect(abcDoc).toBeDefined();
      expect(abcDoc.type).toBe('doc');
      expect(abcDoc.isDeleted).toBe(false);
    });

    it('returns documents shared with Tanvi from GET /api/documents/shared-with-me', async () => {
      const res = await request(app)
        .get('/api/documents/shared-with-me')
        .set('Cookie', [tanviCookie]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Check known shared documents
      const sharedDoc = res.body.find((d: any) => d.title === 'sharedoc by project 7');
      expect(sharedDoc).toBeDefined();
      expect(sharedDoc.permission).toBe('EDITOR');

      const sharedCanvas = res.body.find((d: any) => d.title === 'abcc canvas');
      expect(sharedCanvas).toBeDefined();
      expect(sharedCanvas.permission).toBe('EDITOR');
    });

    it('confirms that the 4 documents in Prisma associated with Tanvi are accessible', async () => {
      const [ownedRes, sharedRes] = await Promise.all([
        request(app).get('/api/documents').set('Cookie', [tanviCookie]),
        request(app).get('/api/documents/shared-with-me').set('Cookie', [tanviCookie]),
      ]);

      const allAccessible = [...ownedRes.body, ...sharedRes.body];
      expect(allAccessible.length).toBeGreaterThanOrEqual(4);

      const titles = allAccessible.map((d) => d.title);
      expect(titles).toContain('ABC');
      expect(titles).toContain('Untitled Canvas');
      expect(titles).toContain('sharedoc by project 7');
      expect(titles).toContain('abcc canvas');
    });
  });

  describe('Security & Authorization: Unauthorized users cannot see private documents', () => {
    it('returns 401 when requesting documents without authentication', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(401);
    });

    it('returns 401 when requesting shared-with-me without authentication', async () => {
      const res = await request(app).get('/api/documents/shared-with-me');
      expect(res.status).toBe(401);
    });

    it('prevents another user from seeing Tanvi documents in their document list', async () => {
      const [otherOwnedRes, otherSharedRes] = await Promise.all([
        request(app).get('/api/documents').set('Cookie', [otherCookie]),
        request(app).get('/api/documents/shared-with-me').set('Cookie', [otherCookie]),
      ]);

      expect(otherOwnedRes.status).toBe(200);
      expect(otherSharedRes.status).toBe(200);

      const otherAccessible = [...otherOwnedRes.body, ...otherSharedRes.body];
      const titles = otherAccessible.map((d) => d.title);
      expect(titles).not.toContain('ABC');
    });

    it('returns 403 Forbidden when unauthorized user tries to fetch a private document by ID', async () => {
      // Find Tanvi's private document "ABC"
      const tanviDoc = await prisma.document.findFirst({
        where: { userId: tanviUserId, title: 'ABC' },
      });
      expect(tanviDoc).toBeDefined();

      const res = await request(app)
        .get(`/api/documents/${tanviDoc!.id}`)
        .set('Cookie', [otherCookie]);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });
  });

  describe('Bug 2 Verification: New Document functionality', () => {
    let newDocId: string;

    it('creates exactly one document record with type "doc" via POST /api/documents', async () => {
      const initialCount = await prisma.document.count({
        where: { userId: tanviUserId },
      });

      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', [tanviCookie])
        .send({ type: 'doc', title: 'Automated Test Document' });

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe('string');
      expect(res.body.title).toBe('Automated Test Document');
      expect(res.body.type).toBe('doc');
      expect(res.body.userId).toBe(tanviUserId);
      expect(res.body.permission).toBe('OWNER');
      expect(res.body.isDeleted).toBe(false);

      newDocId = res.body.id;
      createdDocIds.push(newDocId);

      const finalCount = await prisma.document.count({
        where: { userId: tanviUserId },
      });

      // Exactly one record created
      expect(finalCount).toBe(initialCount + 1);
    });

    it('allows opening the editor for the newly created document via GET /api/documents/:id', async () => {
      expect(newDocId).toBeDefined();

      const res = await request(app)
        .get(`/api/documents/${newDocId}`)
        .set('Cookie', [tanviCookie]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(newDocId);
      expect(res.body.title).toBe('Automated Test Document');
      expect(res.body.type).toBe('doc');
      expect(res.body.permission).toBe('OWNER');
    });

    it('persists the created document when refreshing the document list', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Cookie', [tanviCookie]);

      expect(res.status).toBe(200);
      const found = res.body.find((d: any) => d.id === newDocId);
      expect(found).toBeDefined();
      expect(found.title).toBe('Automated Test Document');
    });

    it('returns 400 Bad Request with descriptive message when creating document with invalid type', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', [tanviCookie])
        .send({ type: 'invalid_type', title: 'Invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid document type/i);
    });

    it('returns 401 Unauthorized when unauthenticated client attempts to create document', async () => {
      const res = await request(app)
        .post('/api/documents')
        .send({ type: 'doc', title: 'Unauthorized' });

      expect(res.status).toBe(401);
    });
  });
});
