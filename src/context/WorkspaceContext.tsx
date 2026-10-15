import React, { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import type { DocumentMeta, SyncStatus, UserPresence } from '../types/dashboard';
import { useAuth } from '../auth/AuthContext';
import {
  listDocumentsApi,
  createDocumentApi,
  updateDocumentApi,
  deleteDocumentApi,
  getSharedDocumentsApi,
  getDocumentApi,
} from '../lib/api/documents';
import { getWsUrl } from '../lib/yjs/config';
import { getWsTokenApi } from '../lib/api/auth';

export type CanvasItem = { id: string; type: string; x: number; y: number; w?: number; h?: number; r?: number; text?: string; color?: string };

export type WorkspaceContextType = {
  documents: Record<string, DocumentMeta>;
  isLoadingDocuments: boolean;
  createItem: (type: 'canvas' | 'doc' | 'file', title?: string) => Promise<string>;
  uploadFile: (file: File) => Promise<string>;
  moveToTrash: (id: string) => Promise<void>;
  restoreFromTrash: (id: string) => Promise<void>;
  permanentlyDelete: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  updateDocumentTitle: (id: string, title: string) => Promise<void>;
  refreshDocuments: () => Promise<void>;
  loadDocument: (id: string) => Promise<DocumentMeta | null>;
  saveStatus: SyncStatus;
  activeUsersByDoc: Record<string, UserPresence[]>;
  blocks?: any; updateBlock?: any; toggleChecklist?: any; addBlock?: any; deleteBlock?: any;
  setIsSyncPanelOpen?: any; currentDocId?: any;
  canvasItems?: any; updateCanvasItem?: any; deleteCanvasItem?: any; addCanvasItem?: any;
  setCurrentDocId: (id: string | null) => void;
};


export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

function createLocalFileId(): string {
  return `file-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<Record<string, DocumentMeta>>({});
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SyncStatus>('syncing');
  const [activeUsersByDoc, setActiveUsersByDoc] = useState<Record<string, UserPresence[]>>({});
  const { user } = useAuth();

  // This preserves integration's IndexedDB/WebSocket presence channel. Database
  // document metadata is intentionally not stored in workspace-directory.
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const localFilesMapRef = useRef<Y.Map<DocumentMeta> | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const idbProvider = new IndexeddbPersistence('workspace-directory', doc);
    const localFilesMap = doc.getMap<DocumentMeta>('local-files');
    let wsProvider: WebsocketProvider | null = null;
    ydocRef.current = doc;
    idbRef.current = idbProvider;
    localFilesMapRef.current = localFilesMap;

    const syncLocalFiles = () => {
      const localFiles: Record<string, DocumentMeta> = {};
      localFilesMap.forEach((file, id) => { localFiles[id] = file; });
      setDocuments((previous) => ({
        ...Object.fromEntries(Object.entries(previous).filter(([, item]) => item.type !== 'file')),
        ...localFiles,
      }));
    };
    const handleIndexedDbSynced = () => { syncLocalFiles(); setSaveStatus('synced'); };
    idbProvider.on('synced', handleIndexedDbSynced);
    localFilesMap.observe(syncLocalFiles);

    let isDisposed = false;
    let cleanupAwareness: (() => void) | undefined;
    try {
      wsProvider = new WebsocketProvider(getWsUrl(), 'workspace-directory', doc, { connect: false });
      providerRef.current = wsProvider;
      wsProvider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        setSaveStatus(event.status === 'connected' ? 'synced' : event.status === 'connecting' ? 'syncing' : 'offline');
      });
      const awareness = wsProvider.awareness;
      const handleAwarenessChange = () => {
        const usersByDoc: Record<string, UserPresence[]> = {};
        awareness.getStates().forEach((state) => {
          if (state.user?.currentDocId) (usersByDoc[state.user.currentDocId] ||= []).push(state.user as UserPresence);
        });
        setActiveUsersByDoc(usersByDoc);
      };
      awareness.on('change', handleAwarenessChange);
      cleanupAwareness = () => { awareness.off('change', handleAwarenessChange); awareness.setLocalState(null); };

      getWsTokenApi()
        .then((token) => {
          if (isDisposed || !wsProvider) return;
          if (token) wsProvider.params = { token };
          wsProvider.connect();
        })
        .catch(() => {
          if (isDisposed || !wsProvider) return;
          wsProvider.connect();
        });
    } catch (error) {
      console.warn('WebSocket connection fallback to local-only IndexedDB mode:', error);
      setSaveStatus('offline');
    }

    return () => {
      isDisposed = true;
      localFilesMap.unobserve(syncLocalFiles);
      idbProvider.off('synced', handleIndexedDbSynced);
      cleanupAwareness?.();
      wsProvider?.destroy();
      idbProvider.destroy();
      doc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      idbRef.current = null;
      localFilesMapRef.current = null;
    };
  }, []);

  // Set or refresh integration's awareness payload after authentication loads.
  useEffect(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness || !user) return;
    const current = awareness.getLocalState()?.user;
    awareness.setLocalStateField('user', {
      ...current, userId: user.id, userName: user.name, userColor: '#00667E',
      currentDocId: current?.currentDocId ?? null, lastActive: Date.now(),
    });
  }, [user]);

  // Fetch both owned and shared documents from the API.
  const refreshDocuments = useCallback(async () => {
    if (!user) return;
    try {
      const [ownedDocs, sharedDocs] = await Promise.all([
        listDocumentsApi(user.name),
        getSharedDocumentsApi(),
      ]);
      const allDocs = [...ownedDocs, ...sharedDocs];
      const metadata = Object.fromEntries(allDocs.map((item) => [item.id, item]));
      setDocuments((previous) => ({
        ...metadata,
        ...Object.fromEntries(Object.entries(previous).filter(([, item]) => item.type === 'file')),
      }));
    } catch (error) {
      console.error('Failed to refresh documents:', error);
    }
  }, [user]);

  const loadDocument = useCallback(async (id: string): Promise<DocumentMeta | null> => {
    try {
      const doc = await getDocumentApi(id, user?.name ?? '');
      setDocuments((previous) => ({ ...previous, [doc.id]: doc }));
      return doc;
    } catch (error) {
      console.error('Failed to load document metadata:', error);
      return null;
    }
  }, [user]);

  // Load owned and shared documents when user is authenticated.
  useEffect(() => {
    if (!user) {
      setDocuments((previous) => Object.fromEntries(Object.entries(previous).filter(([, item]) => item.type === 'file')));
      setIsLoadingDocuments(false);
      return;
    }
    let cancelled = false;
    setIsLoadingDocuments(true);
    void Promise.all([listDocumentsApi(user.name), getSharedDocumentsApi()])
      .then(([ownedDocs, sharedDocs]) => {
        if (cancelled) return;
        const allDocs = [...ownedDocs, ...sharedDocs];
        const metadata = Object.fromEntries(allDocs.map((item) => [item.id, item]));
        setDocuments((previous) => ({
          ...metadata,
          ...Object.fromEntries(Object.entries(previous).filter(([, item]) => item.type === 'file')),
        }));
      })
      .catch((error) => {
        console.error('Failed to load documents from API:', error);
        if (!cancelled) setSaveStatus('error');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDocuments(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const setCurrentDocId = useCallback((id: string | null) => {
    const awareness = providerRef.current?.awareness;
    const current = awareness?.getLocalState()?.user;
    if (awareness && current) awareness.setLocalStateField('user', { ...current, currentDocId: id, lastActive: Date.now() });
  }, []);

  const createItem = useCallback(async (type: 'canvas' | 'doc' | 'file', title?: string): Promise<string> => {
    if (type === 'file') return '';
    const resolvedTitle = title?.trim() || (type === 'canvas' ? 'Untitled Canvas' : 'Untitled Document');
    try {
      const newDocument = await createDocumentApi(type, resolvedTitle, user?.name ?? 'Unknown');
      if (!newDocument || !newDocument.id) {
        throw new Error('Server returned an invalid document record');
      }
      setDocuments((previous) => ({ ...previous, [newDocument.id]: newDocument }));
      return newDocument.id;
    } catch (error) { setSaveStatus('error'); throw error; }
  }, [user]);

  const uploadFile = useCallback(async (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const localFilesMap = localFilesMapRef.current;
      if (!localFilesMap || !ydocRef.current) return reject(new Error('Local persistence is not initialized'));
      const id = createLocalFileId();
      ydocRef.current.transact(() => localFilesMap.set(id, {
        id, title: file.name, type: 'file', isFavorite: false, createdAt: Date.now(), updatedAt: Date.now(), createdBy: user?.name ?? 'Unknown',
        fileData: { name: file.name, size: file.size, mimeType: file.type, blobUrl: event.target?.result as string },
      }));
      resolve(id);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  }), [user]);

  const updateLocalFile = useCallback((id: string, update: (file: DocumentMeta) => DocumentMeta) => {
    const file = localFilesMapRef.current?.get(id);
    if (file && ydocRef.current) ydocRef.current.transact(() => localFilesMapRef.current?.set(id, update(file)));
  }, []);

  const updateDocumentTitle = useCallback(async (id: string, title: string) => {
    const existing = documents[id];
    if (!existing) return;
    if (existing.permission === 'VIEWER') {
      console.warn('Viewers cannot update document title');
      return;
    }
    if (existing.type === 'file') return updateLocalFile(id, (file) => ({ ...file, title, updatedAt: Date.now() }));
    setDocuments((previous) => ({ ...previous, [id]: { ...existing, title, updatedAt: Date.now() } }));
    try { await updateDocumentApi(id, { title }, user?.name ?? ''); }
    catch (error) { console.error('Failed to update document title:', error); setDocuments((previous) => ({ ...previous, [id]: existing })); }
  }, [documents, updateLocalFile, user]);

  const toggleFavorite = useCallback(async (id: string) => {
    const existing = documents[id];
    if (!existing) return;
    if (existing.isShared || (existing.permission && existing.permission !== 'OWNER')) {
      console.warn('Only document owners can update favorite status');
      return;
    }
    if (existing.type === 'file') return updateLocalFile(id, (file) => ({ ...file, isFavorite: !file.isFavorite, updatedAt: Date.now() }));
    const isFavorite = !existing.isFavorite;
    setDocuments((previous) => ({ ...previous, [id]: { ...existing, isFavorite, updatedAt: Date.now() } }));
    try { await updateDocumentApi(id, { isFavorite }, user?.name ?? ''); }
    catch (error) { console.error('Failed to toggle favorite:', error); setDocuments((previous) => ({ ...previous, [id]: existing })); }
  }, [documents, updateLocalFile, user]);

  const moveToTrash = useCallback(async (id: string) => {
    const existing = documents[id];
    if (!existing) return;
    if (existing.isShared || (existing.permission && existing.permission !== 'OWNER')) {
      console.warn('Only document owners can delete documents');
      return;
    }
    const now = Date.now();
    if (existing.type === 'file') return updateLocalFile(id, (file) => ({ ...file, isDeleted: true, deletedAt: now, updatedAt: now }));
    setDocuments((previous) => ({ ...previous, [id]: { ...existing, isDeleted: true, deletedAt: now, updatedAt: now } }));
    try { await updateDocumentApi(id, { isDeleted: true, deletedAt: new Date(now).toISOString() }, user?.name ?? ''); }
    catch (error) { console.error('Failed to move to trash:', error); setDocuments((previous) => ({ ...previous, [id]: existing })); }
  }, [documents, updateLocalFile, user]);

  const deleteDocument = useCallback(async (id: string) => { await moveToTrash(id); }, [moveToTrash]);

  const restoreFromTrash = useCallback(async (id: string) => {
    const existing = documents[id];
    if (!existing) return;
    if (existing.isShared || (existing.permission && existing.permission !== 'OWNER')) {
      console.warn('Only document owners can restore documents');
      return;
    }
    const restore = (item: DocumentMeta): DocumentMeta => { const { deletedAt: _deletedAt, ...rest } = item; return { ...rest, isDeleted: false, updatedAt: Date.now() }; };
    if (existing.type === 'file') return updateLocalFile(id, restore);
    const restored = restore(existing);
    setDocuments((previous) => ({ ...previous, [id]: restored }));
    try { await updateDocumentApi(id, { isDeleted: false }, user?.name ?? ''); }
    catch (error) { console.error('Failed to restore document:', error); setDocuments((previous) => ({ ...previous, [id]: existing })); }
  }, [documents, updateLocalFile, user]);

  const permanentlyDelete = useCallback(async (id: string) => {
    const existing = documents[id];
    if (!existing) return;
    if (existing.isShared || (existing.permission && existing.permission !== 'OWNER')) {
      console.warn('Only document owners can permanently delete documents');
      return;
    }
    if (existing.type === 'file') { ydocRef.current?.transact(() => localFilesMapRef.current?.delete(id)); return; }
    setDocuments((previous) => { const next = { ...previous }; delete next[id]; return next; });
    try { await deleteDocumentApi(id); }
    catch (error) { console.error('Failed to permanently delete document:', error); setDocuments((previous) => ({ ...previous, [id]: existing })); }
  }, [documents]);

  const emptyTrash = useCallback(async () => {
    await Promise.all(
      Object.values(documents)
        .filter((item) => item.isDeleted && (!item.isShared || item.permission === 'OWNER'))
        .map((item) => permanentlyDelete(item.id))
    );
  }, [documents, permanentlyDelete]);

  return (
    <WorkspaceContext.Provider value={{
      documents, isLoadingDocuments, createItem, uploadFile, deleteDocument, moveToTrash, restoreFromTrash, permanentlyDelete,
      emptyTrash, toggleFavorite, updateDocumentTitle, refreshDocuments, loadDocument, saveStatus, activeUsersByDoc,
      blocks: {}, updateBlock: () => {}, toggleChecklist: () => {}, addBlock: () => {}, deleteBlock: () => {},
      canvasItems: {}, updateCanvasItem: () => {}, deleteCanvasItem: () => {}, addCanvasItem: () => {}, setCurrentDocId,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
