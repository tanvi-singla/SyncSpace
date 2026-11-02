import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from 'http';
import { verifyWebSocketOrigin, authorizeYjsConnection } from '../auth';

describe('WebSocket Origin Verification and Yjs Connection Gating', () => {
  const originalClientUrl = process.env.CLIENT_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.CLIENT_URL;
    delete process.env.FRONTEND_URL;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
    if (originalFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = originalFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
  });

  describe('verifyWebSocketOrigin', () => {
    it('permits requests without an Origin header (non-browser clients, automated scripts)', () => {
      const mockReq = {
        headers: {},
      } as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('permits requests with undefined origin header', () => {
      const mockReq = {
        headers: { origin: undefined },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('permits explicitly configured production origin in CLIENT_URL', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      const mockReq = {
        headers: { origin: 'https://syncspace.onrender.com' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('permits explicitly configured production origin in FRONTEND_URL with trailing slash', () => {
      process.env.FRONTEND_URL = 'https://app.syncspace.dev/';
      const mockReq = {
        headers: { origin: 'https://app.syncspace.dev' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('permits localhost origin in development', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        headers: { origin: 'http://localhost:5173' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('permits private LAN origin in development', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        headers: { origin: 'http://192.168.1.50:5173' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(true);
    });

    it('rejects untrusted external origin in development', () => {
      process.env.NODE_ENV = 'development';
      const mockReq = {
        headers: { origin: 'https://evil-hacker.com' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(false);
    });

    it('rejects arbitrary private LAN origin in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      const mockReq = {
        headers: { origin: 'http://192.168.1.50:5173' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(false);
    });

    it('rejects arbitrary localhost origin in production when not configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      const mockReq = {
        headers: { origin: 'http://localhost:5173' },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReq)).toBe(false);
    });

    it('handles origin header when supplied as an array', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      const mockReqAllowed = {
        headers: { origin: ['https://syncspace.onrender.com'] },
      } as unknown as IncomingMessage;

      const mockReqDenied = {
        headers: { origin: ['https://evil.com'] },
      } as unknown as IncomingMessage;

      expect(verifyWebSocketOrigin(mockReqAllowed)).toBe(true);
      expect(verifyWebSocketOrigin(mockReqDenied)).toBe(false);
    });
  });

  describe('authorizeYjsConnection Origin Gating', () => {
    it('immediately rejects untrusted origin with 403 before any token check or database lookup', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';

      const mockReq = {
        headers: { origin: 'https://untrusted-cross-site.com' },
      } as unknown as IncomingMessage;

      const url = new URL('http://localhost:5000/syncspace:doc:some-doc-id?token=valid-or-not');
      const result = await authorizeYjsConnection(mockReq, 'syncspace:doc:some-doc-id', url);

      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
      expect(result.reason).toBe('Origin not allowed');
    });

    it('allows connection attempt to proceed to token validation when origin is permitted', async () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';

      const mockReq = {
        headers: { origin: 'https://syncspace.onrender.com' },
      } as unknown as IncomingMessage;

      // Without a token, should reach the token check and return 401 (not 403 Origin not allowed)
      const url = new URL('http://localhost:5000/syncspace:doc:some-doc-id');
      const result = await authorizeYjsConnection(mockReq, 'syncspace:doc:some-doc-id', url);

      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
      expect(result.reason).toContain('Authentication required');
    });

    it('allows non-browser connection attempt without origin to proceed to token validation', async () => {
      const mockReq = {
        headers: {},
      } as unknown as IncomingMessage;

      const url = new URL('http://localhost:5000/syncspace:doc:some-doc-id');
      const result = await authorizeYjsConnection(mockReq, 'syncspace:doc:some-doc-id', url);

      // Reaches token check and returns 401
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
      expect(result.reason).toContain('Authentication required');
    });
  });
});

