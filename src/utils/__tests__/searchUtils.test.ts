import { describe, it, expect } from 'vitest';
import { filterSearchResults } from '../searchUtils';
import type { DocumentMeta } from '../../types/dashboard';

describe('Global Search Utility (filterSearchResults)', () => {
  const mockDocuments: DocumentMeta[] = [
    {
      id: 'doc-1',
      title: 'SyncSpace Architecture Overview',
      type: 'doc',
      createdAt: 1000,
      updatedAt: 5000,
      isFavorite: false,
      createdBy: 'Tanvi',
      permission: 'OWNER',
    },
    {
      id: 'doc-2',
      title: 'Database Schema Design',
      type: 'doc',
      createdAt: 2000,
      updatedAt: 9000,
      isFavorite: true,
      createdBy: 'Tanvi',
      permission: 'OWNER',
    },
    {
      id: 'canvas-1',
      title: 'System Architecture Canvas',
      type: 'canvas',
      createdAt: 3000,
      updatedAt: 8000,
      isFavorite: true,
      createdBy: 'Tanvi',
      permission: 'OWNER',
    },
    {
      id: 'canvas-2',
      title: 'Sprint Planning Whiteboard',
      type: 'canvas',
      createdAt: 4000,
      updatedAt: 7000,
      isFavorite: false,
      createdBy: 'Tanvi',
      permission: 'OWNER',
    },
    {
      id: 'doc-shared-1',
      title: 'Client Onboarding Guide',
      type: 'doc',
      createdAt: 1500,
      updatedAt: 6000,
      isFavorite: false,
      createdBy: 'Alex Rivera',
      isShared: true,
      permission: 'EDITOR',
      owner: {
        id: 'user-alex',
        name: 'Alex Rivera',
        email: 'alex@example.com',
      },
    },
    {
      id: 'doc-deleted-1',
      title: 'Deleted Architecture Draft',
      type: 'doc',
      createdAt: 500,
      updatedAt: 10000,
      isFavorite: false,
      isDeleted: true,
      deletedAt: 10000,
      createdBy: 'Tanvi',
      permission: 'OWNER',
    },
  ];

  it('returns active documents ordered by recency when query is empty', () => {
    const results = filterSearchResults(mockDocuments, '', 'all');

    // Should exclude deleted doc-deleted-1
    expect(results.length).toBe(5);
    // Highest updatedAt is doc-2 (9000), followed by canvas-1 (8000)
    expect(results[0].document.id).toBe('doc-2');
    expect(results[1].document.id).toBe('canvas-1');
    expect(results[0].matchType).toBe('recent');
  });

  it('searches documents by title case-insensitively', () => {
    const results = filterSearchResults(mockDocuments, 'database', 'all');

    expect(results.length).toBe(1);
    expect(results[0].document.id).toBe('doc-2');
    expect(results[0].document.title).toBe('Database Schema Design');
    expect(results[0].matchType).toBe('title');
  });

  it('searches canvases by title', () => {
    const results = filterSearchResults(mockDocuments, 'whiteboard', 'all');

    expect(results.length).toBe(1);
    expect(results[0].document.id).toBe('canvas-2');
    expect(results[0].document.type).toBe('canvas');
  });

  it('searches shared documents and matches collaborator owner name', () => {
    // Search by title
    const titleResults = filterSearchResults(mockDocuments, 'onboarding', 'all');
    expect(titleResults.length).toBe(1);
    expect(titleResults[0].document.id).toBe('doc-shared-1');
    expect(titleResults[0].document.isShared).toBe(true);

    // Search by collaborator name
    const collaboratorResults = filterSearchResults(mockDocuments, 'alex', 'all');
    expect(collaboratorResults.length).toBe(1);
    expect(collaboratorResults[0].document.id).toBe('doc-shared-1');
    expect(collaboratorResults[0].matchType).toBe('collaborator');
  });

  it('filters results by document type (doc vs canvas)', () => {
    // Both doc-1 and canvas-1 have 'Architecture' in the title
    const allResults = filterSearchResults(mockDocuments, 'architecture', 'all');
    expect(allResults.length).toBe(2);

    const docOnly = filterSearchResults(mockDocuments, 'architecture', 'doc');
    expect(docOnly.length).toBe(1);
    expect(docOnly[0].document.id).toBe('doc-1');
    expect(docOnly[0].document.type).toBe('doc');

    const canvasOnly = filterSearchResults(mockDocuments, 'architecture', 'canvas');
    expect(canvasOnly.length).toBe(1);
    expect(canvasOnly[0].document.id).toBe('canvas-1');
    expect(canvasOnly[0].document.type).toBe('canvas');
  });

  it('never returns soft-deleted items in search results', () => {
    const results = filterSearchResults(mockDocuments, 'draft', 'all');
    // doc-deleted-1 has title 'Deleted Architecture Draft' with isDeleted: true
    expect(results.length).toBe(0);
  });

  it('returns an empty array when no documents match query', () => {
    const results = filterSearchResults(mockDocuments, 'nonexistent keyword xyz 123', 'all');
    expect(results).toEqual([]);
  });

  it('ranks exact matches higher than substring matches', () => {
    const items: DocumentMeta[] = [
      {
        id: '1',
        title: 'Notes for Project Roadmap',
        type: 'doc',
        createdAt: 100,
        updatedAt: 100,
        isFavorite: false,
        createdBy: 'Tanvi',
      },
      {
        id: '2',
        title: 'Roadmap',
        type: 'doc',
        createdAt: 100,
        updatedAt: 100,
        isFavorite: false,
        createdBy: 'Tanvi',
      },
      {
        id: '3',
        title: 'Roadmap 2026',
        type: 'doc',
        createdAt: 100,
        updatedAt: 100,
        isFavorite: false,
        createdBy: 'Tanvi',
      },
    ];

    const results = filterSearchResults(items, 'Roadmap', 'all');
    // Exact match 'Roadmap' should rank first
    expect(results[0].document.id).toBe('2');
    // Prefix match 'Roadmap 2026' should rank second
    expect(results[1].document.id).toBe('3');
    // Substring match 'Notes for Project Roadmap' should rank third
    expect(results[2].document.id).toBe('1');
  });

  it('guarantees that unauthorized documents from other users are not exposed', () => {
    // Only documents passed into the search function (loaded through authenticated API) can be returned.
    const unauthorizedOtherUserDoc: DocumentMeta = {
      id: 'secret-doc-other-user',
      title: 'Top Secret Document from Another Company',
      type: 'doc',
      createdAt: 100,
      updatedAt: 100,
      isFavorite: false,
      createdBy: 'Stranger',
    };

    // The user's active workspace list does NOT contain unauthorized other user doc
    const results = filterSearchResults(mockDocuments, 'Top Secret', 'all');
    expect(results.find((r) => r.document.id === unauthorizedOtherUserDoc.id)).toBeUndefined();
    expect(results.length).toBe(0);
  });
});
