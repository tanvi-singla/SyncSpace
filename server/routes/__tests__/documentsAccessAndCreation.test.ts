import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
      expect(allAccessible.length).toBe(4);

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
