import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Response } from 'express';
import {
  getJwtSecret,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  AUTH_COOKIE_NAME,
  DEV_JWT_FALLBACK_SECRET,
  MIN_JWT_SECRET_LENGTH,
} from '../jwt';

describe('JWT Security and Lifecycle Management', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const validProductionSecret = 'a-very-strong-production-jwt-secret-with-plenty-of-entropy-12345';

  beforeEach(() => {
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret !== undefined) {
      process.env.JWT_SECRET = originalJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe('Development and Non-Production Environments', () => {
    it('falls back to DEV_JWT_FALLBACK_SECRET in development when JWT_SECRET is unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      expect(getJwtSecret()).toBe(DEV_JWT_FALLBACK_SECRET);
    });

    it('falls back to DEV_JWT_FALLBACK_SECRET in test when JWT_SECRET is unset', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.JWT_SECRET;

      expect(getJwtSecret()).toBe(DEV_JWT_FALLBACK_SECRET);
    });

    it('uses configured JWT_SECRET in development when provided', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'my-custom-dev-secret';

      expect(getJwtSecret()).toBe('my-custom-dev-secret');
    });

    it('trims leading/trailing whitespace from configured secret', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = '  trimmed-secret  ';

      expect(getJwtSecret()).toBe('trimmed-secret');
    });
  });

  describe('Production Environment Hardening (getJwtSecret)', () => {
    it('refuses execution if JWT_SECRET is missing or undefined in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => getJwtSecret()).toThrowError(/\[Security\] JWT_SECRET environment variable is missing in production/i);
    });

    it('refuses execution if JWT_SECRET is empty string or only whitespace in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = '   ';

      expect(() => getJwtSecret()).toThrowError(/\[Security\] JWT_SECRET environment variable is missing in production/i);
    });

    it('refuses execution if JWT_SECRET equals the known development fallback in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = DEV_JWT_FALLBACK_SECRET;

      expect(() => getJwtSecret()).toThrowError(/\[Security\] JWT_SECRET must not use the known development fallback in production/i);
    });

    it(`refuses execution if JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters in production`, () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'short-secret-123';

      expect(() => getJwtSecret()).toThrowError(/\[Security\] JWT_SECRET in production is too short/i);
    });

    it('never prints the secret string in thrown error messages', () => {
      process.env.NODE_ENV = 'production';
      const weakSecret = 'weak-secret-value-never-log-me';
      process.env.JWT_SECRET = weakSecret;

      try {
        getJwtSecret();
        expect.unreachable('Should have thrown an error');
      } catch (err: unknown) {
        expect((err as Error).message).not.toContain(weakSecret);
        expect((err as Error).message).toContain(`${weakSecret.length} characters`);
      }
    });

    it('accepts a strong secret of 32 or more characters in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = validProductionSecret;

      expect(getJwtSecret()).toBe(validProductionSecret);
    });
  });

  describe('Token Signing and Verification Lifecycle', () => {
    it('signs and verifies a valid token payload', () => {
      const payload = {
        userId: 'user-uuid-1234',
        email: 'alice@syncspace.dev',
        authVersion: 2,
      };

      const token = signToken(payload);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);

      const verified = verifyToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(payload.userId);
      expect(verified?.email).toBe(payload.email);
      expect(verified?.authVersion).toBe(payload.authVersion);
    });

    it('defaults authVersion to 0 when omitted in signToken', () => {
      const payload = {
        userId: 'user-legacy-5678',
        email: 'bob@syncspace.dev',
      };

      const token = signToken(payload);
      const verified = verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.authVersion).toBe(0);
    });

    it('returns null for an invalid or tampered token', () => {
      const validToken = signToken({ userId: 'u1', email: 'u1@test.com' });
      const tamperedToken = `${validToken.slice(0, -6)}tamper`;

      expect(verifyToken(tamperedToken)).toBeNull();
      expect(verifyToken('completely-invalid-jwt')).toBeNull();
      expect(verifyToken('')).toBeNull();
    });

    it('returns null for a token signed with a different secret', () => {
      process.env.JWT_SECRET = 'first-secret-for-signing-tokens-12345';
      const token = signToken({ userId: 'u1', email: 'u1@test.com' });

      // Change secret
      process.env.JWT_SECRET = 'second-different-secret-56789-abcd';
      expect(verifyToken(token)).toBeNull();
    });

    it('signs and verifies correctly under production mode with strong secret', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = validProductionSecret;

      const token = signToken({ userId: 'prod-user-1', email: 'prod@syncspace.dev' });
      const verified = verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe('prod-user-1');
      expect(verified?.email).toBe('prod@syncspace.dev');
    });

    it('refuses to sign tokens in production if JWT_SECRET is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => signToken({ userId: 'u1', email: 'u1@test.com' })).toThrowError(/\[Security\]/);
    });

    it('refuses to verify tokens in production if JWT_SECRET is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => verifyToken('some-token')).toThrowError(/\[Security\]/);
    });
  });

  describe('Auth Cookie Configuration (setAuthCookie & clearAuthCookie)', () => {
    it('sets secure: false in development', () => {
      process.env.NODE_ENV = 'development';
      const res = {
        cookie: vi.fn(),
      } as unknown as Response;

      setAuthCookie(res, 'sample-jwt-token');

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        'sample-jwt-token',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        })
      );
    });

    it('sets secure: true in production', () => {
      process.env.NODE_ENV = 'production';
      const res = {
        cookie: vi.fn(),
      } as unknown as Response;

      setAuthCookie(res, 'sample-jwt-token');

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        'sample-jwt-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        })
      );
    });

    it('clears auth cookie with matching security flags', () => {
      process.env.NODE_ENV = 'production';
      const res = {
        clearCookie: vi.fn(),
      } as unknown as Response;

      clearAuthCookie(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        })
      );
    });
  });
});

