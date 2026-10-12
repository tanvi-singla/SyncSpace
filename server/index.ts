import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';

const app = express();

// CORS configuration for local, LAN, and production Vite clients
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

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
// Express HTTP server
// Serves REST API routes (/api/auth, /api/documents, /api/health).
// Realtime Yjs WebSocket collaboration is hosted independently (e.g. Render Web Service
// or standalone `npm run yjs`).
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    console.log(`SyncSpace Express server running on http://${HOST}:${PORT}`);
  });
}

export default app;
export { app };
