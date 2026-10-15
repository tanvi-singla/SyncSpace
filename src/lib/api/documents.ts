import type { DocumentMeta, DocumentPermission, DocumentShareInfo, SharedDocumentItem } from '../../types/dashboard';
import { getApiBaseUrl } from './auth';

/**
 * Shape of a document as returned by the API (dates are ISO strings, not ms timestamps).
 */
interface ApiDocument {
  id: string;
  title: string;
  type: 'canvas' | 'doc';
  isFavorite: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  owner?: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Converts an API document (ISO date strings) to the frontend DocumentMeta (ms timestamps).
 * The `createdBy` field is populated with a placeholder since the API doesn't return the
 * user's name in the document record. The WorkspaceContext fills this from the auth user.
 */
function toDocumentMeta(doc: ApiDocument, userName: string): DocumentMeta {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    isFavorite: doc.isFavorite,
    isDeleted: doc.isDeleted,
    deletedAt: doc.deletedAt ? new Date(doc.deletedAt).getTime() : undefined,
    createdAt: new Date(doc.createdAt).getTime(),
    updatedAt: new Date(doc.updatedAt).getTime(),
    createdBy: doc.owner?.name || userName,
    permission: doc.permission || 'OWNER',
    owner: doc.owner,
    isShared: doc.permission !== undefined && doc.permission !== 'OWNER',
  };
}

function toSharedDocumentMeta(doc: SharedDocumentItem): DocumentMeta {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    isFavorite: doc.isFavorite,
    isDeleted: doc.isDeleted,
    deletedAt: doc.deletedAt ? new Date(doc.deletedAt).getTime() : undefined,
    createdAt: new Date(doc.createdAt).getTime(),
    updatedAt: new Date(doc.updatedAt).getTime(),
    createdBy: doc.owner?.name || 'Collaborator',
    permission: doc.permission,
    owner: doc.owner || undefined,
    isShared: true,
  };
}


/**
 * Shared error handler: parses response JSON and throws with the server's error message.
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMessage = 'An unexpected error occurred';
    try {
      const data = await res.json();
      errorMessage = data.error || data.message || errorMessage;
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

/**
 * GET /api/documents
 * Fetches all documents (including soft-deleted) for the authenticated user.
 */
export async function listDocumentsApi(userName: string): Promise<DocumentMeta[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'GET',
    credentials: 'include',
  });
  if (res.status === 401) return [];
  const docs = await handleResponse<ApiDocument[]>(res);
  return docs.map((d) => toDocumentMeta(d, userName));
}

/**
 * POST /api/documents
 * Creates a new document record in PostgreSQL.
 * Returns the full DocumentMeta with the server-generated UUID as the ID.
 */
export async function createDocumentApi(
  type: 'canvas' | 'doc',
  title: string,
  userName: string
): Promise<DocumentMeta> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ type, title }),
  });
  const doc = await handleResponse<ApiDocument>(res);
  return toDocumentMeta(doc, userName);
}

/**
 * PUT /api/documents/:id
 * Updates mutable fields of a document.
 */
export async function updateDocumentApi(
  id: string,
  patch: Partial<{ title: string; isFavorite: boolean; isDeleted: boolean; deletedAt: string | null }>,
  userName: string
): Promise<DocumentMeta> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const doc = await handleResponse<ApiDocument>(res);
  return toDocumentMeta(doc, userName);
}

/**
 * DELETE /api/documents/:id
 * Permanently deletes a document.
 */
export async function deleteDocumentApi(id: string): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error('Failed to delete document');
  }
}

/**
 * GET /api/documents/:id
 * Fetches a single document's metadata and user role.
 */
export async function getDocumentApi(id: string, fallbackUserName = ''): Promise<DocumentMeta> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${id}`, {
    method: 'GET',
    credentials: 'include',
  });
  const doc = await handleResponse<ApiDocument>(res);
  return toDocumentMeta(doc, fallbackUserName);
}

/**
 * GET /api/documents/shared-with-me
 * Returns documents shared with the currently authenticated user.
 */
export async function getSharedDocumentsApi(): Promise<DocumentMeta[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/shared-with-me`, {
    method: 'GET',
    credentials: 'include',
  });
  if (res.status === 401) return [];
  const items = await handleResponse<SharedDocumentItem[]>(res);
  return items.map(toSharedDocumentMeta);
}

/**
 * POST /api/documents/:documentId/share
 * Shares a document with another registered user by email.
 */
export async function shareDocumentApi(
  documentId: string,
  email: string,
  permission: DocumentPermission
): Promise<DocumentShareInfo> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${documentId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, permission }),
  });
  return handleResponse<DocumentShareInfo>(res);
}

/**
 * GET /api/documents/:documentId/shares
 * Returns all active shares for a document (owner only).
 */
export async function getDocumentSharesApi(documentId: string): Promise<DocumentShareInfo[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${documentId}/shares`, {
    method: 'GET',
    credentials: 'include',
  });
  return handleResponse<DocumentShareInfo[]>(res);
}

/**
 * PATCH /api/documents/:documentId/share/:userId
 * Updates permission for a shared user (owner only).
 */
export async function updateSharePermissionApi(
  documentId: string,
  userId: string,
  permission: DocumentPermission
): Promise<DocumentShareInfo> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${documentId}/share/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ permission }),
  });
  return handleResponse<DocumentShareInfo>(res);
}

/**
 * DELETE /api/documents/:documentId/share/:userId
 * Revokes sharing access for a user (owner only).
 */
export async function removeShareApi(documentId: string, userId: string): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/documents/${documentId}/share/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    let errorMsg = 'Failed to remove share';
    try {
      const data = await res.json();
      errorMsg = data.error || errorMsg;
    } catch {
      errorMsg = res.statusText || errorMsg;
    }
    throw new Error(errorMsg);
  }
}

// Aliases matching prompt suggestions
export const shareDocument = shareDocumentApi;
export const getSharedDocuments = getSharedDocumentsApi;
export const updateSharePermission = updateSharePermissionApi;
export const removeShare = removeShareApi;

