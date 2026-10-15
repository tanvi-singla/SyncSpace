import './lib/config/env';
import http from 'http';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';
import { createYjsServer, setupAuthorizedWSConnection } from './yjsServer';
import { authorizeYjsConnection } from './lib/yjs/auth';
import { logPasswordResetEmailConfiguration } from './lib/auth/email';

logPasswordResetEmailConfiguration();

const app = express();

// CORS configuration for local, LAN, and production Vite clients
const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter((url): url is string => typeof url === 'string' && url.length > 0);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1|172\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

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
  const httpServer = http.createServer(app);
  const { wss } = createYjsServer();

  httpServer.on('upgrade', async (req, socket, head) => {
    try {
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
