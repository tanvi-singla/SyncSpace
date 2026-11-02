import type { CorsOptions } from 'cors';

/**
 * Parses and returns the list of explicitly configured frontend origins
 * from CLIENT_URL and FRONTEND_URL environment variables.
 * Supports comma-separated origins and normalizes them by trimming and removing trailing slashes.
 */
export function getAllowedConfiguredOrigins(): string[] {
  const envValues = [process.env.CLIENT_URL, process.env.FRONTEND_URL];
  const origins: string[] = [];

  for (const val of envValues) {
    if (!val || typeof val !== 'string') continue;
    const parts = val.split(',').map((p) => p.trim());
    for (const part of parts) {
      if (!part) continue;
      const normalized = part.replace(/\/+$/, '');
      if (normalized && !origins.includes(normalized)) {
        origins.push(normalized);
      }
    }
  }

  // Ensure both canonical www.sync-space.me and apex sync-space.me are trusted
  if (origins.some((o) => o.includes('sync-space.me')) || process.env.NODE_ENV === 'production') {
    if (!origins.includes('https://www.sync-space.me')) origins.push('https://www.sync-space.me');
    if (!origins.includes('https://sync-space.me')) origins.push('https://sync-space.me');
  }

  return origins;
}

/**
 * Resolves the canonical frontend URL for user-facing links (e.g. password reset emails).
 * - Normalizes sync-space.me to the canonical https://www.sync-space.me
 * - In production, defaults to https://www.sync-space.me if unset
 * - In development, defaults to configured FRONTEND_URL/CLIENT_URL or http://localhost:5173
 */
export function getCanonicalFrontendUrl(): string {
  const envUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const candidates = envUrl.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean);
    for (const candidate of candidates) {
      try {
        const parsed = new URL(candidate);
        // Canonicalize sync-space.me apex to www.sync-space.me
        if (parsed.hostname === 'sync-space.me') {
          parsed.hostname = 'www.sync-space.me';
          parsed.protocol = 'https:';
        }
        return parsed.origin;
      } catch {
        // Continue to next candidate
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return 'https://www.sync-space.me';
  }

  return 'http://localhost:5173';
}

/**
 * Checks whether an origin is a trusted local development or private LAN origin.
 * Covers:
 * - localhost / 127.0.0.1 on any port (http or https)
 * - RFC 1918 private IPv4 ranges:
 *   - 10.0.0.0/8 (10.0.0.0 – 10.255.255.255)
 *   - 172.16.0.0/12 (172.16.0.0 – 172.31.255.255)
 *   - 192.168.0.0/16 (192.168.0.0 – 192.168.255.255)
 */
export function isPrivateOrLocalhost(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname;

    // Loopback / localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // Check private IPv4 ranges
    const parts = hostname.split('.');
    if (
      parts.length === 4 &&
      parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
    ) {
      const [o0, o1] = parts.map(Number);
      // 10.0.0.0/8
      if (o0 === 10) return true;
      // 172.16.0.0/12 (172.16.0.0 – 172.31.255.255)
      if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
      // 192.168.0.0/16
      if (o0 === 192 && o1 === 168) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether an incoming HTTP or WebSocket request origin is allowed.
 * - Requests with no Origin header (e.g. server-to-server, Render health check probes, non-browser clients) are permitted.
 * - Origins explicitly configured in CLIENT_URL / FRONTEND_URL are always permitted.
 * - In production (NODE_ENV === 'production'): ONLY explicitly configured origins are permitted;
 *   arbitrary localhost and private LAN origins are strictly rejected.
 * - In development / test: localhost and RFC 1918 private LAN origins are permitted.
 * - All other unknown/external origins are rejected.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (curl, mobile apps, server-to-server, Render health check, non-browser clients)
  if (!origin) {
    return true;
  }

  const normalized = origin.trim().replace(/\/+$/, '');

  // Check configured production or explicit frontend origins
  const configured = getAllowedConfiguredOrigins();
  if (configured.includes(normalized)) {
    return true;
  }

  // In production, accept ONLY explicitly configured origins.
  // Arbitrary localhost and private LAN origins are strictly forbidden in production.
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // In development and test environments, allow localhost and RFC 1918 private LAN origins
  return isPrivateOrLocalhost(normalized);
}

/**
 * Express CORS middleware options.
 * Enforces strict origin validation and credentials support without using wildcard origins.
 */
export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    // Reject unknown external origins safely
    return callback(null, false);
  },
  credentials: true,
};
