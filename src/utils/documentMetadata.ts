import type { DocumentMeta, DocumentShareInfo } from '../types/dashboard';

/**
 * Computes the authoritative author name for a document.
 * Priority:
 * 1. Explicit owner profile from backend (`docMeta.owner.name`)
 * 2. `createdBy` string populated on DocumentMeta
 * 3. Logged-in user's name if this user is the verified document owner
 * 4. Neutral fallback ('Document Owner')
 */
export function computeDocumentAuthor(
  docMeta?: DocumentMeta | null,
  currentUser?: { id?: string; name?: string; email?: string } | null,
  isOwner?: boolean
): string {
  if (docMeta?.owner?.name && docMeta.owner.name.trim()) {
    return docMeta.owner.name.trim();
  }
  if (docMeta?.createdBy && docMeta.createdBy.trim()) {
    return docMeta.createdBy.trim();
  }
  if (isOwner && currentUser?.name && currentUser.name.trim()) {
    return currentUser.name.trim();
  }
  return 'Document Owner';
}

/**
 * Formats a document's createdAt timestamp into "MMM D, YYYY" (e.g. "Nov 17, 2026").
 * Requirement: Never falls back to `new Date()`. Returns a neutral fallback string
 * ("Date unavailable") when timestamp is missing, null, or invalid.
 */
export function formatDocumentDate(timestamp?: number | string | Date | null): string {
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return 'Date unavailable';
  }

  const dateObj = typeof timestamp === 'number' || typeof timestamp === 'string'
    ? new Date(timestamp)
    : timestamp;

  if (isNaN(dateObj.getTime())) {
    return 'Date unavailable';
  }

  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Computes the unique number of contributors (people with document access).
 * Rules:
 * 1. Counts the owner once.
 * 2. Counts each shared collaborator once.
 * 3. Deduplicates users by ID, email, or name to prevent duplicates.
 * 4. Does not inflate count with live participant awareness states.
 */
export function computeContributorCount(
  docMeta?: DocumentMeta | null,
  currentUser?: { id?: string; name?: string; email?: string } | null,
  isOwner?: boolean,
  extraShares?: DocumentShareInfo[]
): { count: number; text: string } {
  const uniqueKeys = new Set<string>();

  // 1. Identify and count the document owner once
  const ownerId = docMeta?.owner?.id || docMeta?.userId || (isOwner && currentUser?.id ? currentUser.id : undefined);
  const ownerEmail = docMeta?.owner?.email || (isOwner && currentUser?.email ? currentUser.email : undefined);
  const ownerName = docMeta?.owner?.name || docMeta?.createdBy || (isOwner && currentUser?.name ? currentUser.name : undefined);

  if (ownerId) {
    uniqueKeys.add(`id:${ownerId}`);
  } else if (ownerEmail) {
    uniqueKeys.add(`email:${ownerEmail.toLowerCase().trim()}`);
  } else if (ownerName) {
    uniqueKeys.add(`name:${ownerName.trim()}`);
  } else {
    uniqueKeys.add('owner:default');
  }

  // 2. Add shared collaborators, deduplicating against the owner and each other
  const shares = (docMeta?.shares && docMeta.shares.length > 0) ? docMeta.shares : (extraShares || []);
  for (const share of shares) {
    const shareUserId = share.userId || share.user?.id;
    const shareEmail = share.user?.email;
    const shareName = share.user?.name;

    // Skip if this share represents the same user as the owner
    if (ownerId && shareUserId && shareUserId === ownerId) continue;
    if (ownerEmail && shareEmail && shareEmail.toLowerCase().trim() === ownerEmail.toLowerCase().trim()) continue;

    if (shareUserId) {
      uniqueKeys.add(`id:${shareUserId}`);
    } else if (shareEmail) {
      uniqueKeys.add(`email:${shareEmail.toLowerCase().trim()}`);
    } else if (shareName) {
      uniqueKeys.add(`name:${shareName.trim()}`);
    }
  }

  const count = Math.max(1, uniqueKeys.size);
  return {
    count,
    text: `${count} ${count === 1 ? 'contributor' : 'contributors'}`,
  };
}
