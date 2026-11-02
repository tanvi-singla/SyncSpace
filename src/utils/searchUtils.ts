import type { DocumentMeta } from '../types/dashboard';

export type SearchTypeFilter = 'all' | 'doc' | 'canvas';

export interface SearchResultItem {
  document: DocumentMeta;
  relevanceScore: number;
  matchType: 'title' | 'creator' | 'collaborator' | 'recent';
}

/**
 * Filters and ranks documents based on search query, type filter, and recency.
 * Only returns active, non-deleted documents accessible to the current user session.
 */
export function filterSearchResults(
  documents: DocumentMeta[],
  query: string,
  typeFilter: SearchTypeFilter = 'all'
): SearchResultItem[] {
  // 1. Filter out soft-deleted items
  const activeDocs = documents.filter((doc) => !doc.isDeleted);

  // 2. Apply type filter
  const filteredByType = activeDocs.filter((doc) => {
    if (typeFilter === 'doc') return doc.type === 'doc';
    if (typeFilter === 'canvas') return doc.type === 'canvas';
    return true; // 'all' includes doc, canvas, and file
  });

  const trimmedQuery = query.trim().toLowerCase();

  // 3. If query is empty, return recent items sorted by updatedAt
  if (!trimmedQuery) {
    return filteredByType
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((doc) => ({
        document: doc,
        relevanceScore: 0,
        matchType: 'recent' as const,
      }));
  }

  const results: SearchResultItem[] = [];

  for (const doc of filteredByType) {
    const titleLower = (doc.title || '').toLowerCase();
    const ownerNameLower = (doc.owner?.name || '').toLowerCase();
    const createdByLower = (doc.createdBy || '').toLowerCase();

    let score = 0;
    let matchType: SearchResultItem['matchType'] = 'title';

    if (titleLower === trimmedQuery) {
      // Exact title match
      score = 100;
      matchType = 'title';
    } else if (titleLower.startsWith(trimmedQuery)) {
      // Title prefix match
      score = 75;
      matchType = 'title';
    } else if (titleLower.includes(trimmedQuery)) {
      // Title substring match
      score = 50;
      matchType = 'title';
    } else if (doc.owner?.name && ownerNameLower.includes(trimmedQuery)) {
      // Collaborator owner name match
      score = 30;
      matchType = 'collaborator';
    } else if (doc.createdBy && createdByLower.includes(trimmedQuery)) {
      // Creator name match
      score = 25;
      matchType = 'creator';
    }

    if (score > 0) {
      // Slight boost for pinned favorites
      if (doc.isFavorite) score += 5;

      results.push({
        document: doc,
        relevanceScore: score,
        matchType,
      });
    }
  }

  // 4. Sort by relevance descending, then by updatedAt descending
  results.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return (b.document.updatedAt || 0) - (a.document.updatedAt || 0);
  });

  return results;
}

