import './lib/config/env';
import http from 'http';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { corsOptions } from './lib/config/cors';
import { getJwtSecret } from './lib/auth/jwt';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';
import { createYjsServer, setupAuthorizedWSConnection } from './yjsServer';
import { authorizeYjsConnection, verifyWebSocketOrigin } from './lib/yjs/auth';
import { logPasswordResetEmailConfiguration } from './lib/auth/email';

logPasswordResetEmailConfiguration();

const app = express();

// Secure CORS configuration: rejects untrusted origins while supporting credentials and configured origins
app.use(cors(corsOptions));

// Standard body and cookie parsers
app.use(express.json());
app.use(cookieParser());

// Basic health check route (used by Render health-check probe)
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount authentication routes
app.use('/api/auth', authRouter);

// Mount document routes (protected by requireAuth inside the router)
app.use('/api/documents', documentsRouter);

// Global unhandled error middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Unified HTTP server
// Serves REST API routes (/api/auth, /api/documents, /api/health) and
// real-time Yjs WebSocket collaboration on the same port.
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  // Validate JWT configuration before starting HTTP server (fails fast in production if missing/insecure)
  getJwtSecret();

  const httpServer = http.createServer(app);
  const { wss } = createYjsServer();

  httpServer.on('upgrade', async (req, socket, head) => {
    try {
      // 1. Verify WebSocket Origin before completing upgrade
      if (!verifyWebSocketOrigin(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nOrigin not allowed');
        socket.destroy();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const rawRoomName = decodeURIComponent(url.pathname.slice(1).split('?')[0]);

      if (!rawRoomName) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\nRoom name required');
        socket.destroy();
        return;
      }

      const authResult = await authorizeYjsConnection(req, rawRoomName, url);

      if (!authResult.authorized) {
        const statusText =
          authResult.status === 401 ? 'Unauthorized'
          : authResult.status === 403 ? 'Forbidden'
          : 'Not Found';
        socket.write(
          `HTTP/1.1 ${authResult.status} ${statusText}\r\nContent-Type: text/plain\r\n\r\n${authResult.reason || statusText}`
        );
        socket.destroy();
        return;
      }

      console.log(`[Yjs Server] Client connected to room: ${rawRoomName} (${authResult.permission})`);

      wss.handleUpgrade(req, socket, head, (ws) => {
        setupAuthorizedWSConnection(ws, req, authResult, rawRoomName);
      });
    } catch (err) {
      console.error('[Yjs Server] Upgrade error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`SyncSpace server running on http://${HOST}:${PORT}`);
    console.log(`🌾 Yjs WebSocket relay available on ws://${HOST}:${PORT}`);
  });
}

export default app;
export { app };
