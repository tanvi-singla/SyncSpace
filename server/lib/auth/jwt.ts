import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';

export const AUTH_COOKIE_NAME = 'auth_token';
export const DEV_JWT_FALLBACK_SECRET = 'syncspace-dev-secret-change-in-prod';
export const MIN_JWT_SECRET_LENGTH = 32;

export interface TokenPayload {
  userId: string;
  email: string;
  authVersion: number;
}

type TokenClaims = Omit<TokenPayload, 'authVersion'> & { authVersion?: number };

const JWT_EXPIRES_IN: SignOptions['expiresIn'] = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Validates and retrieves the active JWT secret.
 * In production (NODE_ENV === 'production'):
 * - Refuses execution if JWT_SECRET is missing or empty.
 * - Refuses execution if JWT_SECRET equals the development fallback secret.
 * - Refuses execution if JWT_SECRET is shorter than 32 characters.
 * In non-production (development, test):
 * - Returns the configured JWT_SECRET or falls back to the development secret.
 *
 * Never prints or leaks the secret value in logs or error messages.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret) {
      throw new Error(
        '[Security] JWT_SECRET environment variable is missing in production. An explicitly configured, strong secret is required.'
      );
    }
    if (secret === DEV_JWT_FALLBACK_SECRET) {
      throw new Error(
        '[Security] JWT_SECRET must not use the known development fallback in production. Generate a strong secret (e.g. openssl rand -hex 64).'
      );
    }
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `[Security] JWT_SECRET in production is too short (${secret.length} characters). It must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`
      );
    }
    return secret;
  }

  if (secret && secret.length > 0) {
    return secret;
  }

  return DEV_JWT_FALLBACK_SECRET;
}

/**
 * Signs a JWT token containing the user identity payload with a 7-day expiration.
 */
export function signToken(payload: TokenClaims): string {
  const secret = getJwtSecret();
  return jwt.sign({ ...payload, authVersion: payload.authVersion ?? 0 }, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Safely verifies and decodes an auth JWT token. Returns null if invalid or expired.
 */
export function verifyToken(token: string): TokenPayload | null {
  const secret = getJwtSecret();
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded && 'email' in decoded) {
      return {
        userId: (decoded as { userId: string }).userId,
        email: (decoded as { email: string }).email,
        // Tokens minted before authVersion was added remain valid at the default version.
        authVersion: typeof (decoded as { authVersion?: unknown }).authVersion === 'number'
          ? (decoded as { authVersion: number }).authVersion
          : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sets the signed JWT in a secure HttpOnly cookie.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * Clears the auth cookie upon logout.
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}
