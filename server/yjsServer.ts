import http from 'http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as authProtocol from 'y-protocols/auth';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
// @ts-ignore y-websocket bin utils is a CJS module
import yUtils from 'y-websocket/bin/utils';
import { authorizeYjsConnection, type YjsAuthResult } from './lib/yjs/auth';

const { getYDoc } = yUtils;

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

function send(doc: any, conn: WebSocket, m: Uint8Array): void {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, {}, (err) => {
      if (err != null) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc: any, conn: WebSocket): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    if (controlledIds && controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds as Set<number>), null);
    }
  }
  try {
    conn.close();
  } catch {
    // Already closed
  }
}

/**
 * Sets up a WebSocket connection with role-based access control (OWNER, EDITOR, VIEWER).
 */
export function setupAuthorizedWSConnection(
  conn: WebSocket,
  req: http.IncomingMessage,
  authResult: YjsAuthResult,
  roomName: string
): void {
  conn.binaryType = 'arraybuffer';
  const doc = getYDoc(roomName, true);
  doc.conns.set(conn, new Set<number>());

  const isViewer = authResult.permission === 'VIEWER';

  // Listen to incoming messages
  conn.on('message', (message: ArrayBuffer) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          // Peek the sync message type
          const syncMessageType = decoding.readVarUint(decoder);

          if (isViewer) {
            // Viewers are ONLY allowed to send sync step 1 (asking server for doc state)
            if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
              encoding.writeVarUint(encoder, messageSync);
              encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
              syncProtocol.writeSyncStep2(encoder, doc);
              send(doc, conn, encoding.toUint8Array(encoder));
            } else {
              // Viewer attempted to send syncStep2 or update -> REJECT modifications
              const authEncoder = encoding.createEncoder();
              encoding.writeVarUint(authEncoder, messageAuth);
              authProtocol.writePermissionDenied(authEncoder, 'Viewers have read-only permissions.');
              send(doc, conn, encoding.toUint8Array(authEncoder));
            }
          } else {
            // OWNER and EDITOR have full read-write capabilities
            encoding.writeVarUint(encoder, messageSync);
            // Re-decode from start of sync payload
            const fullSyncDecoder = decoding.createDecoder(new Uint8Array(message));
            decoding.readVarUint(fullSyncDecoder); // skip messageSync
            syncProtocol.readSyncMessage(fullSyncDecoder, encoder, doc, conn);

            if (encoding.length(encoder) > 1) {
              send(doc, conn, encoding.toUint8Array(encoder));
            }
          }
          break;
        }

        case messageAwareness: {
          // Awareness updates (cursors, presence) are allowed for all authorized collaborators
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            decoding.readVarUint8Array(decoder),
            conn
          );
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Yjs Server] Error handling message:', err);
    }
  });

  // Keep connection alive with periodic pings
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, 30000);

  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });

  conn.on('pong', () => {
    pongReceived = true;
  });

  // Send initial sync step 1 to client so it receives current document state
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));

    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      send(doc, conn, encoding.toUint8Array(awarenessEncoder));
    }
  }
}

/**
 * Creates and configures the hardened Yjs HTTP & WebSocket server.
 */
export function createYjsServer(): {
  server: http.Server;
  wss: WebSocket.Server;
  start: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
} {
  const wss = new WebSocket.Server({ noServer: true });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'SyncSpace Yjs Relay Server' }));
  });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const rawRoomName = url.pathname.slice(1).split('?')[0];

      if (!rawRoomName) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\nRoom name required');
        socket.destroy();
        return;
      }

      // Check authorization
      const authResult = await authorizeYjsConnection(req, rawRoomName, url);

      if (!authResult.authorized) {
        const statusText = authResult.status === 401 ? 'Unauthorized' : authResult.status === 403 ? 'Forbidden' : 'Not Found';
        socket.write(`HTTP/1.1 ${authResult.status} ${statusText}\r\nContent-Type: text/plain\r\n\r\n${authResult.reason || statusText}`);
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        setupAuthorizedWSConnection(ws, req, authResult, rawRoomName);
      });
    } catch (err) {
      console.error('[Yjs Server] Upgrade error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  const start = (
    port = parseInt(process.env.YJS_PORT || process.env.PORT || '1234', 10),
    host = process.env.YJS_HOST || process.env.HOST || '0.0.0.0'
  ): Promise<{ port: number; host: string }> => {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        console.log(`🌾 SyncSpace Yjs Relay listening at ws://${host}:${port}`);
        resolve({ port, host });
      });
    });
  };

  return { server, wss, start };
}

// Auto-run if executed directly as script
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const { start } = createYjsServer();
  void start();
}

export default createYjsServer;
