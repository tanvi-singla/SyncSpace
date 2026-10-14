import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';

export const AUTH_COOKIE_NAME = 'auth_token';

export interface TokenPayload {
  userId: string;
  email: string;
  authVersion: number;
}

type TokenClaims = Omit<TokenPayload, 'authVersion'> & { authVersion?: number };

const JWT_SECRET = process.env.JWT_SECRET || 'syncspace-dev-secret-change-in-prod';
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Signs a JWT token containing the user identity payload with a 7-day expiration.
 */
export function signToken(payload: TokenClaims): string {
  return jwt.sign({ ...payload, authVersion: payload.authVersion ?? 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Safely verifies and decodes an auth JWT token. Returns null if invalid or expired.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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
