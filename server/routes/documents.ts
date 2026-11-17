import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/db/client';
import { requireAuth } from '../middleware/auth';
import { DocumentPermission } from '@prisma/client';

const router = Router();

// All document routes require authentication
router.use(requireAuth);

const VALID_PERMISSIONS: DocumentPermission[] = ['VIEWER', 'EDITOR'];

/**
 * GET /api/documents
 * Returns all documents (including soft-deleted) created/owned by the authenticated user.
 * The frontend handles client-side filtering of isDeleted.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    // Mark owned documents with 'OWNER' permission
    const withPermissions = documents.map((doc) => ({
      ...doc,
      permission: 'OWNER' as const,
    }));

    res.status(200).json(withPermissions);
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/shared-with-me
 * Returns all documents shared with the authenticated user.
 * Must be defined before /:id route so Express does not parse 'shared-with-me' as an ID.
 */
router.get('/shared-with-me', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const shares = await prisma.documentShare.findMany({
      where: {
        userId,
        document: { isDeleted: false },
      },
      include: {
        document: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const sharedDocuments = shares.map((s) => ({
      id: s.document.id,
      title: s.document.title,
      type: s.document.type,
      isFavorite: s.document.isFavorite,
      isDeleted: s.document.isDeleted,
      deletedAt: s.document.deletedAt,
      createdAt: s.document.createdAt,
      updatedAt: s.document.updatedAt,
      userId: s.document.userId,
      permission: s.permission,
      owner: s.document.user,
    }));

    res.status(200).json(sharedDocuments);
  } catch (err) {
    console.error('List shared documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/documents
 * Creates a new document owned by the authenticated user.
 * Body: { title?: string, type: 'canvas' | 'doc' }
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { title, type } = req.body;

    if (!type || !['canvas', 'doc'].includes(type)) {
      res.status(400).json({ error: 'Invalid document type. Must be "canvas" or "doc".' });
      return;
    }

    const defaultTitle = type === 'canvas' ? 'Untitled Canvas' : 'Untitled Document';

    const document = await prisma.document.create({
      data: {
        title: (typeof title === 'string' && title.trim()) ? title.trim() : defaultTitle,
        type,
        userId,
      },
    });

    res.status(201).json({
      ...document,
      permission: 'OWNER',
    });
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/documents/:documentId/share
 * Allows document owner to share a document with another registered user by email.
 * Body: { email: string, permission: 'VIEWER' | 'EDITOR' }
 */
router.post('/:documentId/share', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const rawDocId = req.params.documentId;
    const documentId = typeof rawDocId === 'string' ? rawDocId : Array.isArray(rawDocId) ? rawDocId[0] : '';
    const { email, permission } = req.body;

    if (!documentId) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'Recipient email is required' });
      return;
    }

    if (!permission || !VALID_PERMISSIONS.includes(permission)) {
      res.status(400).json({ error: 'Invalid permission. Must be "VIEWER" or "EDITOR".' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Only owner can share
    if (document.userId !== userId) {
      res.status(403).json({ error: 'Only the document owner can share this document' });
      return;
    }

    // Find recipient by email
    const recipient = await prisma.user.findFirst({
      where: { email: email.trim().toLowerCase() },
    });

    if (!recipient) {
      res.status(404).json({ error: 'User with this email does not exist' });
      return;
    }

    // Owner cannot share with themselves
    if (recipient.id === userId) {
      res.status(400).json({ error: 'Cannot share document with yourself' });
      return;
    }

    // Check for duplicate share
    const existingShare = await prisma.documentShare.findUnique({
      where: {
        documentId_userId: {
          documentId,
          userId: recipient.id,
        },
      },
    });

    if (existingShare) {
      res.status(409).json({ error: 'Document is already shared with this user' });
      return;
    }

    const share = await prisma.documentShare.create({
      data: {
        documentId,
        userId: recipient.id,
        permission,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    res.status(201).json(share);
  } catch (err) {
    console.error('Share document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:documentId/shares
 * Returns all active shares for a document.
 * Accessible to document owner and all authorized collaborators (viewers & editors).
 */
router.get('/:documentId/shares', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const rawDocId = req.params.documentId;
    const documentId = typeof rawDocId === 'string' ? rawDocId : Array.isArray(rawDocId) ? rawDocId[0] : '';

    if (!documentId) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Verify caller is owner or active collaborator before exposing collaborator data
    const isOwner = document.userId === userId;
    let isCollaborator = false;
    if (!isOwner) {
      const share = await prisma.documentShare.findUnique({
        where: {
          documentId_userId: {
            documentId,
            userId,
          },
        },
      });
      isCollaborator = !!share;
    }

    if (!isOwner && !isCollaborator) {
      res.status(403).json({ error: 'Access denied. You do not have permission to view collaborators for this document.' });
      return;
    }

    const shares = await prisma.documentShare.findMany({
      where: { documentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json(shares);
  } catch (err) {
    console.error('Get document shares error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/documents/:documentId/share/:userId
 * Updates permission for a shared user (VIEWER <-> EDITOR). Owner only.
 * Body: { permission: 'VIEWER' | 'EDITOR' }
 */
router.patch('/:documentId/share/:targetUserId', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerId = req.user!.userId;
    const rawDocId = req.params.documentId;
    const documentId = typeof rawDocId === 'string' ? rawDocId : Array.isArray(rawDocId) ? rawDocId[0] : '';
    const rawTargetUserId = req.params.targetUserId;
    const targetUserId = typeof rawTargetUserId === 'string' ? rawTargetUserId : Array.isArray(rawTargetUserId) ? rawTargetUserId[0] : '';
    const { permission } = req.body;

    if (!documentId || !targetUserId) {
      res.status(400).json({ error: 'Invalid document ID or target user ID' });
      return;
    }

    if (!permission || !VALID_PERMISSIONS.includes(permission)) {
      res.status(400).json({ error: 'Invalid permission. Must be "VIEWER" or "EDITOR".' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (document.userId !== callerId) {
      res.status(403).json({ error: 'Only the document owner can update permissions' });
      return;
    }

    const existingShare = await prisma.documentShare.findUnique({
      where: {
        documentId_userId: {
          documentId,
          userId: targetUserId,
        },
      },
    });

    if (!existingShare) {
      res.status(404).json({ error: 'Share record not found' });
      return;
    }

    const updatedShare = await prisma.documentShare.update({
      where: { id: existingShare.id },
      data: { permission },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    res.status(200).json(updatedShare);
  } catch (err) {
    console.error('Update share permission error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/:documentId/share/:userId
 * Revokes sharing access for a user. Owner only.
 */
router.delete('/:documentId/share/:targetUserId', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerId = req.user!.userId;
    const rawDocId = req.params.documentId;
    const documentId = typeof rawDocId === 'string' ? rawDocId : Array.isArray(rawDocId) ? rawDocId[0] : '';
    const rawTargetUserId = req.params.targetUserId;
    const targetUserId = typeof rawTargetUserId === 'string' ? rawTargetUserId : Array.isArray(rawTargetUserId) ? rawTargetUserId[0] : '';

    if (!documentId || !targetUserId) {
      res.status(400).json({ error: 'Invalid document ID or target user ID' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (document.userId !== callerId) {
      res.status(403).json({ error: 'Only the document owner can revoke access' });
      return;
    }

    const existingShare = await prisma.documentShare.findUnique({
      where: {
        documentId_userId: {
          documentId,
          userId: targetUserId,
        },
      },
    });

    if (!existingShare) {
      res.status(404).json({ error: 'Share record not found' });
      return;
    }

    await prisma.documentShare.delete({
      where: { id: existingShare.id },
    });

    res.status(200).json({ message: 'Access revoked successfully' });

  } catch (err) {
    console.error('Revoke share error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id
 * Returns a single document. Verifies owner or active share permission.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const rawId = req.params.id;
    const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

    if (!id) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        shares: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Determine access permission
    let permission: 'OWNER' | DocumentPermission;

    if (document.userId === userId) {
      permission = 'OWNER';
    } else {
      // Check if document was shared with user
      const share = document.shares.find((s) => s.userId === userId);

      if (!share) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      permission = share.permission;
    }

    res.status(200).json({
      ...document,
      permission,
      owner: document.user,
      shares: document.shares,
    });
  } catch (err) {
    console.error('Get document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/documents/:id
 * Updates a document's mutable fields.
 * Owner: Can update title, favorite, soft-delete.
 * Editor: Can update title only.
 * Viewer: Rejected with 403.
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const rawId = req.params.id;
    const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

    if (!id) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const existing = await prisma.document.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Check authorization: Owner vs Editor vs Viewer
    const isOwner = existing.userId === userId;
    let isEditor = false;

    if (!isOwner) {
      const share = await prisma.documentShare.findUnique({
        where: {
          documentId_userId: {
            documentId: id,
            userId,
          },
        },
      });

      if (!share) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (share.permission === 'VIEWER') {
        res.status(403).json({ error: 'Viewers cannot modify document' });
        return;
      }

      isEditor = share.permission === 'EDITOR';
    }

    const { title, isFavorite, isDeleted, deletedAt } = req.body;

    // Editors cannot soft delete or change favorite status
    if (isEditor && (isDeleted !== undefined || deletedAt !== undefined)) {
      res.status(403).json({ error: 'Only the document owner can delete this document' });
      return;
    }

    const updateData: {
      title?: string;
      isFavorite?: boolean;
      isDeleted?: boolean;
      deletedAt?: Date | null;
    } = {};

    if (typeof title === 'string' && title.trim()) {
      updateData.title = title.trim();
    }

    if (isOwner) {
      if (typeof isFavorite === 'boolean') {
        updateData.isFavorite = isFavorite;
      }
      if (typeof isDeleted === 'boolean') {
        updateData.isDeleted = isDeleted;
      }
      if (isDeleted === true && deletedAt !== undefined) {
        updateData.deletedAt = deletedAt ? new Date(deletedAt) : new Date();
      }
      if (isDeleted === false) {
        updateData.deletedAt = null;
      }
    }

    const updated = await prisma.document.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      ...updated,
      permission: isOwner ? 'OWNER' : 'EDITOR',
    });
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/:id
 * Permanently deletes a document. Verifies ownership.
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const rawId = req.params.id;
    const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

    if (!id) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const existing = await prisma.document.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Only owner can delete
    if (existing.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await prisma.document.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { router as documentsRouter };
