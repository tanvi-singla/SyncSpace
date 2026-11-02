import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { resolve } from 'node:path';
import { getCanonicalFrontendUrl } from '../../lib/config/cors';
import { apexDomainRedirect, createSpaFallbackMiddleware } from '../../lib/config/spa';
import { generateResetToken, hashResetToken } from '../../lib/auth/tokens';
import { resetPasswordSchema } from '../../../src/lib/validation/auth';

describe('Password Reset Route, Canonical Domain, and SPA Handling', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalClientUrl = process.env.CLIENT_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.CLIENT_URL;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = originalFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('Canonical URL Resolution (getCanonicalFrontendUrl)', () => {
    it('always canonicalizes apex sync-space.me to https://www.sync-space.me', () => {
      process.env.FRONTEND_URL = 'https://sync-space.me';
      const canonical = getCanonicalFrontendUrl();
      expect(canonical).toBe('https://www.sync-space.me');

      const resetUrl = new URL('/reset-password', canonical);
      resetUrl.hash = new URLSearchParams({ token: 'test-token-123' }).toString();
      expect(resetUrl.toString()).toBe('https://www.sync-space.me/reset-password#token=test-token-123');
    });

    it('handles production default without environment variables', () => {
      process.env.NODE_ENV = 'production';
      const canonical = getCanonicalFrontendUrl();
      expect(canonical).toBe('https://www.sync-space.me');
    });

    it('generates the exact canonical link format required', () => {
      process.env.FRONTEND_URL = 'https://sync-space.me';
      const { token } = generateResetToken();
      const canonical = getCanonicalFrontendUrl();
      const resetUrl = new URL('/reset-password', canonical);
      resetUrl.hash = new URLSearchParams({ token }).toString();

      expect(resetUrl.origin).toBe('https://www.sync-space.me');
      expect(resetUrl.pathname).toBe('/reset-password');
      expect(resetUrl.hash).toMatch(/^#token=[a-f0-9]{64}$/);
    });

    it('preserves custom developer domain in test/dev', () => {
      process.env.FRONTEND_URL = 'https://syncspace.example.test';
      const canonical = getCanonicalFrontendUrl();
      expect(canonical).toBe('https://syncspace.example.test');
    });
  });

  describe('Apex Domain 301 Redirect Middleware (apexDomainRedirect)', () => {
    it('redirects requests with host sync-space.me to https://www.sync-space.me with 301', () => {
      const req = {
        headers: { host: 'sync-space.me' },
        originalUrl: '/reset-password',
      } as unknown as Request;

      const res = {
        redirect: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      apexDomainRedirect(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(301, 'https://www.sync-space.me/reset-password');
      expect(next).not.toHaveBeenCalled();
    });

    it('redirects apex requests while preserving query parameters and paths', () => {
      const req = {
        headers: { host: 'sync-space.me' },
        originalUrl: '/reset-password?ref=email',
      } as unknown as Request;

      const res = {
        redirect: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      apexDomainRedirect(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(301, 'https://www.sync-space.me/reset-password?ref=email');
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() without redirecting when host is already www.sync-space.me', () => {
      const req = {
        headers: { host: 'www.sync-space.me' },
        originalUrl: '/reset-password',
      } as unknown as Request;

      const res = {
        redirect: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      apexDomainRedirect(req, res, next);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next() without redirecting for localhost development hostnames', () => {
      const req = {
        headers: { host: 'localhost:5000' },
        originalUrl: '/api/health',
      } as unknown as Request;

      const res = {
        redirect: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      apexDomainRedirect(req, res, next);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('SPA Fallback Serving Middleware (createSpaFallbackMiddleware)', () => {
    const distPath = resolve(process.cwd(), 'dist');

    it('serves index.html for GET requests to client-side routes like /reset-password', () => {
      const middleware = createSpaFallbackMiddleware(distPath);

      const req = {
        method: 'GET',
        path: '/reset-password',
      } as unknown as Request;

      const res = {
        sendFile: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      middleware(req, res, next);

      expect(res.sendFile).toHaveBeenCalledWith(resolve(distPath, 'index.html'));
      expect(next).not.toHaveBeenCalled();
    });

    it('does not intercept /api routes and allows them to fall through to API routers', () => {
      const middleware = createSpaFallbackMiddleware(distPath);

      const req = {
        method: 'GET',
        path: '/api/health',
      } as unknown as Request;

      const res = {
        sendFile: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      middleware(req, res, next);

      expect(res.sendFile).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('does not intercept non-GET requests (e.g. POST, PUT, DELETE)', () => {
      const middleware = createSpaFallbackMiddleware(distPath);

      const req = {
        method: 'POST',
        path: '/reset-password',
      } as unknown as Request;

      const res = {
        sendFile: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      middleware(req, res, next);

      expect(res.sendFile).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('Password Reset Token and Payload Validation', () => {
    it('generates a 64-character hexadecimal reset token and correct SHA-256 hash', () => {
      const { token, tokenHash } = generateResetToken();
      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);

      const computedHash = hashResetToken(token);
      expect(computedHash).toBe(tokenHash);
    });

    it('validates a correct resetPassword payload with schema', () => {
      const { token } = generateResetToken();
      const validPayload = {
        token,
        password: 'NewStrongPassword123!',
        confirmPassword: 'NewStrongPassword123!',
      };

      const result = resetPasswordSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('rejects password mismatch in schema', () => {
      const { token } = generateResetToken();
      const invalidPayload = {
        token,
        password: 'NewStrongPassword123!',
        confirmPassword: 'DifferentPassword123!',
      };

      const result = resetPasswordSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('do not match'))).toBe(true);
      }
    });

    it('rejects weak password missing required complexity', () => {
      const { token } = generateResetToken();
      const weakPayload = {
        token,
        password: 'weak',
        confirmPassword: 'weak',
      };

      const result = resetPasswordSchema.safeParse(weakPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('8 characters'))).toBe(true);
      }
    });
  });

  describe('Client-Side URL Hash and SessionStorage Resilience Logic', () => {
    it('extracts token from hash fragment correctly without exposing token in query', () => {
      const hash = '#token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const fragmentParams = new URLSearchParams(hash.replace(/^#/, ''));
      const token = fragmentParams.get('token');

      expect(token).toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    });

    it('simulates refresh fallback: preserves token via sessionStorage if hash is missing', () => {
      const mockStorage: Record<string, string> = {};
      const SESSION_KEY = 'syncspace_reset_token';
      const initialToken = 'sample-64-character-token-value';

      // 1. Initial page load saves to sessionStorage
      mockStorage[SESSION_KEY] = initialToken;

      // 2. On refresh, URL hash might be blank
      const refreshedHash = '';
      const fragmentParams = new URLSearchParams(refreshedHash.replace(/^#/, ''));
      let extractedToken = fragmentParams.get('token');

      if (!extractedToken && mockStorage[SESSION_KEY]) {
        extractedToken = mockStorage[SESSION_KEY];
      }

      expect(extractedToken).toBe(initialToken);

      // 3. Upon successful submit, token is removed
      delete mockStorage[SESSION_KEY];
      expect(mockStorage[SESSION_KEY]).toBeUndefined();
    });
  });
});
