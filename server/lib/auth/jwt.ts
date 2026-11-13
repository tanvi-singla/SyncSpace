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
 * Computes secure, HttpOnly cookie options based on the deployment environment.
 * Supports cross-origin setups (e.g., Render separate frontend and backend origins)
 * where SameSite='none' and Secure=true are required for credentialed requests.
 */
export function getAuthCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none' | 'strict';
} {
  const isProduction = process.env.NODE_ENV === 'production';
  const explicitSameSite = process.env.COOKIE_SAME_SITE?.toLowerCase();

  let sameSite: 'lax' | 'none' | 'strict' = 'lax';
  let secure = isProduction;

  if (explicitSameSite === 'none' || explicitSameSite === 'lax' || explicitSameSite === 'strict') {
    sameSite = explicitSameSite;
  } else if (isProduction) {
    // Check if configured frontend origin is different from backend
    const frontend = process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.OAUTH_FRONTEND_URL;
    const backend = process.env.BACKEND_URL || process.env.API_URL || process.env.OAUTH_CALLBACK_BASE_URL;
    if (frontend && backend) {
      try {
        if (new URL(frontend).origin !== new URL(backend).origin) {
          sameSite = 'none';
        }
      } catch {
        // Fall back to lax if parsing fails
      }
    }
  }

  // SameSite=None strictly requires Secure=true in modern browsers
  if (sameSite === 'none') {
    secure = true;
  }

  return {
    httpOnly: true,
    secure,
    sameSite,
  };
}

/**
 * Sets the signed JWT in a secure HttpOnly cookie.
 */
export function setAuthCookie(res: Response, token: string): void {
  const options = getAuthCookieOptions();
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...options,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

/**
 * Clears the auth cookie upon logout.
 */
export function clearAuthCookie(res: Response): void {
  const options = getAuthCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...options,
    path: '/',
  });
}
