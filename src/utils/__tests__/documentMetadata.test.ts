import { describe, it, expect } from 'vitest';
import {
  computeDocumentAuthor,
  formatDocumentDate,
  computeContributorCount,
} from '../documentMetadata';
import type { DocumentMeta, DocumentShareInfo } from '../../types/dashboard';

describe('Document Header Metadata Derivation Tests', () => {
  describe('Author Derivation (computeDocumentAuthor)', () => {
    it('displays Vani when a document is created by Vani (via docMeta.owner.name)', () => {
      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        title: 'Vani Product Spec',
        type: 'doc',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        createdBy: 'Vani',
        permission: 'OWNER',
        isShared: false,
      };

      const currentUser = { id: 'user-vani-id', name: 'Vani', email: 'vani@syncspace.dev' };
      const author = computeDocumentAuthor(docMeta as DocumentMeta, currentUser, true);

      expect(author).toBe('Vani');
    });

    it('displays Vani when createdBy string is present even if owner object is not yet loaded', () => {
      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-2',
        title: 'Untitled Document',
        type: 'doc',
        userId: 'user-vani-id',
        createdBy: 'Vani',
        permission: 'OWNER',
        isShared: false,
      };

      const author = computeDocumentAuthor(docMeta as DocumentMeta, null, true);
      expect(author).toBe('Vani');
    });

    it('displays the creator name when the document was created by another user (e.g., Tanvi viewed by Vani)', () => {
      // Document is owned by Tanvi, but Vani is the current logged-in collaborator viewing it
      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-3',
        title: 'Tanvi Project Plan',
        type: 'doc',
        userId: 'user-tanvi-id',
        owner: {
          id: 'user-tanvi-id',
          name: 'Tanvi',
          email: 'tanvi@syncspace.dev',
        },
        createdBy: 'Tanvi',
        permission: 'EDITOR',
        isShared: true,
      };

      const currentUser = { id: 'user-vani-id', name: 'Vani', email: 'vani@syncspace.dev' };
      // isOwner is false for Vani
      const author = computeDocumentAuthor(docMeta as DocumentMeta, currentUser, false);

      // Must display the actual creator (Tanvi), NOT the current viewer (Vani)
      expect(author).toBe('Tanvi');
    });

    it('displays Rohan when Rohan is the document owner', () => {
      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-4',
        title: 'Rohan Research',
        type: 'doc',
        userId: 'user-rohan-id',
        owner: {
          id: 'user-rohan-id',
          name: 'Rohan Sharma',
          email: 'rohan@syncspace.dev',
        },
        createdBy: 'Rohan Sharma',
        permission: 'VIEWER',
        isShared: true,
      };

      const currentUser = { id: 'user-mannat-id', name: 'Mannat', email: 'mannat@syncspace.dev' };
      const author = computeDocumentAuthor(docMeta as DocumentMeta, currentUser, false);

      expect(author).toBe('Rohan Sharma');
    });

    it('falls back to current user name when owner is viewing their newly created local document without metadata', () => {
      const currentUser = { id: 'user-vani-id', name: 'Vani', email: 'vani@syncspace.dev' };
      const author = computeDocumentAuthor(undefined, currentUser, true);
      expect(author).toBe('Vani');
    });

    it('falls back to "Document Owner" when no user profile or owner data is available', () => {
      const author = computeDocumentAuthor(undefined, null, false);
      expect(author).toBe('Document Owner');
    });
  });

  describe('Creation Date Formatting (formatDocumentDate)', () => {
    it('formats a valid millisecond timestamp into "MMM D, YYYY"', () => {
      // 2026-11-17T12:00:00Z
      const timestamp = new Date('2026-11-17T12:00:00Z').getTime();
      const formatted = formatDocumentDate(timestamp);
      expect(formatted).toBe('Nov 17, 2026');
    });

    it('formats a historical date correctly (e.g. Sep 9, 2026)', () => {
      const timestamp = new Date('2026-09-09T00:00:00Z').getTime();
      const formatted = formatDocumentDate(timestamp);
      expect(formatted).toBe('Sep 9, 2026');
    });

    it('formats an ISO date string correctly', () => {
      const formatted = formatDocumentDate('2026-01-15T08:30:00Z');
      expect(formatted).toBe('Jan 15, 2026');
    });

    it('never uses new Date() fallback: returns "Date unavailable" when timestamp is undefined', () => {
      const formatted = formatDocumentDate(undefined);
      expect(formatted).toBe('Date unavailable');
    });

    it('returns "Date unavailable" when timestamp is null', () => {
      const formatted = formatDocumentDate(null);
      expect(formatted).toBe('Date unavailable');
    });

    it('returns "Date unavailable" when timestamp is an invalid date string', () => {
      const formatted = formatDocumentDate('not-a-valid-date');
      expect(formatted).toBe('Date unavailable');
    });
  });

  describe('Contributor Count & Deduplication (computeContributorCount)', () => {
    it('returns 1 contributor for a newly created document owned by Vani with no shares', () => {
      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        title: 'Vani Notes',
        type: 'doc',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        shares: [],
        permission: 'OWNER',
        isShared: false,
      };

      const result = computeContributorCount(docMeta as DocumentMeta, { id: 'user-vani-id', name: 'Vani' }, true);
      expect(result.count).toBe(1);
      expect(result.text).toBe('1 contributor');
    });

    it('counts owner once and each shared collaborator once', () => {
      const shares: DocumentShareInfo[] = [
        {
          id: 'share-1',
          documentId: 'doc-1',
          userId: 'user-mannat-id',
          permission: 'EDITOR',
          createdAt: '2026-11-17T10:00:00Z',
          user: {
            id: 'user-mannat-id',
            name: 'Mannat',
            email: 'mannat@syncspace.dev',
          },
        },
        {
          id: 'share-2',
          documentId: 'doc-1',
          userId: 'user-rohan-id',
          permission: 'VIEWER',
          createdAt: '2026-11-17T11:00:00Z',
          user: {
            id: 'user-rohan-id',
            name: 'Rohan',
            email: 'rohan@syncspace.dev',
          },
        },
      ];

      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        shares,
        permission: 'OWNER',
        isShared: false,
      };

      // Vani (Owner) + Mannat + Rohan = 3 contributors
      const result = computeContributorCount(docMeta as DocumentMeta, { id: 'user-vani-id', name: 'Vani' }, true);
      expect(result.count).toBe(3);
      expect(result.text).toBe('3 contributors');
    });

    it('deduplicates if the owner is accidentally present in the shares list', () => {
      const shares: DocumentShareInfo[] = [
        {
          id: 'share-self',
          documentId: 'doc-1',
          userId: 'user-vani-id',
          permission: 'EDITOR',
          createdAt: '2026-11-17T10:00:00Z',
          user: {
            id: 'user-vani-id',
            name: 'Vani',
            email: 'vani@syncspace.dev',
          },
        },
        {
          id: 'share-other',
          documentId: 'doc-1',
          userId: 'user-mannat-id',
          permission: 'EDITOR',
          createdAt: '2026-11-17T10:00:00Z',
          user: {
            id: 'user-mannat-id',
            name: 'Mannat',
            email: 'mannat@syncspace.dev',
          },
        },
      ];

      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        shares,
        permission: 'OWNER',
        isShared: false,
      };

      const result = computeContributorCount(docMeta as DocumentMeta, { id: 'user-vani-id', name: 'Vani' }, true);
      // Vani is counted once, Mannat once -> total 2
      expect(result.count).toBe(2);
      expect(result.text).toBe('2 contributors');
    });

    it('deduplicates multiple share entries for the same collaborator', () => {
      const shares: DocumentShareInfo[] = [
        {
          id: 'share-1a',
          documentId: 'doc-1',
          userId: 'user-mannat-id',
          permission: 'VIEWER',
          createdAt: '2026-11-17T10:00:00Z',
          user: {
            id: 'user-mannat-id',
            name: 'Mannat',
            email: 'mannat@syncspace.dev',
          },
        },
        {
          id: 'share-1b',
          documentId: 'doc-1',
          userId: 'user-mannat-id',
          permission: 'EDITOR',
          createdAt: '2026-11-17T11:00:00Z',
          user: {
            id: 'user-mannat-id',
            name: 'Mannat',
            email: 'mannat@syncspace.dev',
          },
        },
      ];

      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        shares,
        permission: 'OWNER',
        isShared: false,
      };

      const result = computeContributorCount(docMeta as DocumentMeta, { id: 'user-vani-id', name: 'Vani' }, true);
      // Vani once, Mannat once -> 2 contributors
      expect(result.count).toBe(2);
      expect(result.text).toBe('2 contributors');
    });

    it('produces the same contributor count from either the owner perspective or collaborator perspective', () => {
      const shares: DocumentShareInfo[] = [
        {
          id: 'share-1',
          documentId: 'doc-1',
          userId: 'user-mannat-id',
          permission: 'EDITOR',
          createdAt: '2026-11-17T10:00:00Z',
          user: {
            id: 'user-mannat-id',
            name: 'Mannat',
            email: 'mannat@syncspace.dev',
          },
        },
      ];

      const docMeta: Partial<DocumentMeta> = {
        id: 'doc-1',
        userId: 'user-vani-id',
        owner: {
          id: 'user-vani-id',
          name: 'Vani',
          email: 'vani@syncspace.dev',
        },
        shares,
        permission: 'EDITOR',
        isShared: true,
      };

      // Mannat (collaborator) views the document
      const resultMannat = computeContributorCount(docMeta as DocumentMeta, { id: 'user-mannat-id', name: 'Mannat' }, false);
      expect(resultMannat.count).toBe(2);
      expect(resultMannat.text).toBe('2 contributors');

      // Vani (owner) views the document
      const resultVani = computeContributorCount(docMeta as DocumentMeta, { id: 'user-vani-id', name: 'Vani' }, true);
      expect(resultVani.count).toBe(2);
      expect(resultVani.text).toBe('2 contributors');
    });
  });
});
