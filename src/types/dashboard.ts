export interface DocumentMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  createdBy: string;
  type: 'canvas' | 'doc' | 'file';
  fileData?: {
    name: string;
    size: number;
    mimeType: string;
    blobUrl?: string; // Storing as Data URL for now
  };
  isDeleted?: boolean;
  deletedAt?: number;
  lastModifiedBy?: { name: string; id: string };
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
  owner?: {
    id: string;
    name: string;
    email: string;
  };
  userId?: string;
  shares?: DocumentShareInfo[];
  isShared?: boolean;
}

export type DocumentPermission = 'VIEWER' | 'EDITOR';

export interface DocumentShareInfo {
  id: string;
  documentId: string;
  userId: string;
  permission: DocumentPermission;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

export interface SharedDocumentItem {
  id: string;
  title: string;
  type: 'canvas' | 'doc';
  isFavorite: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  permission: DocumentPermission;
  owner: {
    id: string;
    name: string;
    email: string;
  };
  shares?: DocumentShareInfo[];
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface UserPresence {
  userId: string;
  userName: string;
  userColor: string;
  currentDocId: string | null;
  lastActive: number;
}

