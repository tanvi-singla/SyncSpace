import type { Request, Response, NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Redirects requests arriving at the apex domain sync-space.me to the canonical https://www.sync-space.me.
 */
export function apexDomainRedirect(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  if (host === 'sync-space.me') {
    res.redirect(301, `https://www.sync-space.me${req.originalUrl}`);
    return;
  }
  next();
}

/**
 * Middleware factory for client-side SPA route fallback.
 * Sends index.html for non-API GET requests if the built index.html exists.
 */
export function createSpaFallbackMiddleware(distDirectory?: string) {
  const resolvedDist = distDirectory || resolve(process.cwd(), 'dist');
  const indexPath = resolve(resolvedDist, 'index.html');

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }

    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }

    next();
  };
}

