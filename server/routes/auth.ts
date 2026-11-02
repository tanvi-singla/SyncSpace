import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/db/client';
import { hashPassword, verifyPassword } from '../lib/auth/password';
import { signToken, setAuthCookie, clearAuthCookie } from '../lib/auth/jwt';
import { requireAuth } from '../middleware/auth';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../../src/lib/validation/auth';
import { toSafeUser } from '../../src/types/auth';
import { generateResetToken, verifyResetToken, hashResetToken, calculateResetTokenExpiry } from '../lib/auth/tokens';
import { logPasswordResetEmailFailure, sendPasswordResetEmail, PasswordResetEmailError } from '../lib/auth/email';
import { revokeUserConnections } from '../lib/yjs/sessionConnections';
import * as oidc from 'openid-client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  findOrCreateOAuthUser, getOAuthCallbackUrl, getOAuthConfiguration, getOAuthFrontendUrl,
  resolveOAuthIdentity, safeOAuthReturnPath,
} from '../lib/auth/oauth';
import type { OAuthProvider } from '../lib/auth/oauth';
import { getCanonicalFrontendUrl } from '../lib/config/cors';

const router = Router();
const OAUTH_COOKIE = 'oauth_transaction';
const OAUTH_COOKIE_MAX_AGE = 10 * 60 * 1000;
type OAuthTransaction = { provider: OAuthProvider; state: string; verifier: string; nonce?: string; returnPath: string };

function oauthTransactionSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'syncspace-dev-secret-change-in-prod';
  if (process.env.NODE_ENV === 'production' && secret.length < 32) throw new Error('oauth_state_secret_too_short');
  return secret;
}

function encodeOAuthTransaction(transaction: OAuthTransaction): string {
  const payload = Buffer.from(JSON.stringify(transaction)).toString('base64url');
  const signature = createHmac('sha256', oauthTransactionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeOAuthTransaction(value: string): OAuthTransaction | null {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', oauthTransactionSecret()).update(payload).digest();
  let provided: Buffer;
  try { provided = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthTransaction; } catch { return null; }
}

function clearOAuthTransaction(res: Response): void {
  res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth' });
}

function oauthFailure(res: Response, code = 'oauth_failed'): void {
  clearOAuthTransaction(res);
  try {
    const target = new URL('/login', getOAuthFrontendUrl());
    target.searchParams.set('oauth_error', code);
    res.redirect(303, target.toString());
  } catch {
    res.status(400).json({ error: 'OAuth sign-in could not be completed.' });
  }
}

for (const provider of ['google', 'github'] as const) {
  router.get(`/${provider}`, async (req: Request, res: Response): Promise<void> => {
    try {
      const configuration = await getOAuthConfiguration(provider);
      const state = oidc.randomState();
      const verifier = oidc.randomPKCECodeVerifier();
      const nonce = provider === 'google' ? oidc.randomNonce() : undefined;
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const transaction: OAuthTransaction = {
        provider, state, verifier, ...(nonce ? { nonce } : {}),
        returnPath: safeOAuthReturnPath(req.query.next),
      };
      res.cookie(OAUTH_COOKIE, encodeOAuthTransaction(transaction), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: OAUTH_COOKIE_MAX_AGE,
        path: '/api/auth',
      });
      const parameters: Record<string, string> = {
        redirect_uri: getOAuthCallbackUrl(provider),
        scope: provider === 'google' ? 'openid email profile' : 'read:user user:email',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      };
      if (nonce) parameters.nonce = nonce;
      res.redirect(302, oidc.buildAuthorizationUrl(configuration, parameters).toString());
    } catch (error) {
      console.error(`OAuth ${provider} initiation failed:`, error instanceof Error ? error.message : 'unknown error');
      oauthFailure(res, 'provider_unavailable');
    }
  });

  router.get(`/${provider}/callback`, async (req: Request, res: Response): Promise<void> => {
    try {
      const raw = req.cookies?.[OAUTH_COOKIE];
      if (!raw) return oauthFailure(res, 'invalid_state');
      const transaction = decodeOAuthTransaction(raw);
      if (!transaction) return oauthFailure(res, 'invalid_state');
      if (transaction.provider !== provider || !transaction.state || !transaction.verifier ||
          typeof req.query.state !== 'string' || req.query.state !== transaction.state) {
        return oauthFailure(res, 'invalid_state');
      }
      if (req.query.error) return oauthFailure(res, req.query.error === 'access_denied' ? 'cancelled' : 'oauth_failed');

      const configuration = await getOAuthConfiguration(provider);
      const callbackUrl = new URL(getOAuthCallbackUrl(provider));
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
      }
      const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: transaction.state,
        pkceCodeVerifier: transaction.verifier,
        ...(transaction.nonce ? { expectedNonce: transaction.nonce } : {}),
      }, { redirect_uri: getOAuthCallbackUrl(provider) });
      const identity = await resolveOAuthIdentity(provider, tokens.access_token, tokens.claims());
      const user = await findOrCreateOAuthUser(provider, identity);
      const token = signToken({ userId: user.id, email: user.email, authVersion: user.authVersion });
      clearOAuthTransaction(res);
      setAuthCookie(res, token);
      const target = new URL(transaction.returnPath, getOAuthFrontendUrl());
      res.redirect(303, target.toString());
    } catch (error) {
      const code = error instanceof Error && error.message === 'oauth_account_exists' ? 'account_exists' : 'oauth_failed';
      console.error(`OAuth ${provider} callback failed:`, error instanceof Error ? error.message : 'unknown error');
      oauthFailure(res, code);
    }
  });
}

/**
 * POST /api/auth/register
 * Validates registration input, checks duplicates, creates user, sets auth cookie, and returns safe user.
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
      return;
    }

    const { email, password, name, avatarUrl } = parseResult.data;

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'User already exists with this email' });
      return;
    }

    // Hash password and persist user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        avatarUrl: avatarUrl || null,
      },
    });

    // Generate JWT and set HttpOnly session cookie
    const token = signToken({ userId: user.id, email: user.email, authVersion: user.authVersion });
    setAuthCookie(res, token);

    res.status(201).json(toSafeUser(user));
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Validates credentials, sets session cookie, and returns safe user.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
      return;
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = user.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, authVersion: user.authVersion });
    setAuthCookie(res, token);

    res.status(200).json(toSafeUser(user));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
router.post('/logout', (_req: Request, res: Response): void => {
  clearAuthCookie(res);
  res.status(200).json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Returns authenticated user profile, guarded by requireAuth middleware.
 */
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(toSafeUser(user));
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/ws-token
 * Issues a signed token for authenticated WebSocket/Yjs connections.
 */
router.get('/ws-token', requireAuth, (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = signToken({ userId: req.user.userId, email: req.user.email, authVersion: req.user.authVersion });
  res.status(200).json({ token, userId: req.user.userId });
});


/**
 * POST /api/auth/forgot-password
 * Sends a single-use reset link when the email exists, but always returns the same response.
 */
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  const genericResponse = {
    message: 'If an account exists for this email, a password reset link has been sent.'
  };

  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }

    const { email } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      // Continue after responding so lookup timing does not reveal account existence.
      void (async () => {
        const { token, tokenHash } = generateResetToken();
        const expiresAt = calculateResetTokenExpiry();
        await prisma.$transaction(async (tx) => {
          await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
          await tx.passwordResetToken.create({
            data: { userId: user.id, tokenHash, expiresAt }
          });
        });

        try {
          const frontendUrl = getCanonicalFrontendUrl();
          const resetUrl = new URL('/reset-password', frontendUrl);
          resetUrl.hash = new URLSearchParams({ token }).toString();
          await sendPasswordResetEmail(user.email, resetUrl.toString());
        } catch (error) {
          logPasswordResetEmailFailure(error);
        }
      })().catch(() => {
        console.error('Password reset request could not be processed.');
      });
    }

    res.status(200).json(genericResponse);
  } catch (err) {
    console.error('Password reset request could not be processed.');
    res.status(200).json(genericResponse);
  }
});

/**
 * POST /api/auth/reset-password
 * Validates the reset token and updates the user's password.
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Password does not meet requirements',
        details: parsed.error.issues
      });
      return;
    }
    const { token, password } = parsed.data;

    const now = new Date();
    let resetRecord = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashResetToken(token) }
    });

    // Support reset links issued before token hashes changed from bcrypt to indexed SHA-256.
    if (!resetRecord) {
      const legacyRecords = await prisma.passwordResetToken.findMany({
        where: { tokenHash: { startsWith: '$2' }, usedAt: null, expiresAt: { gt: now } }
      });
      for (const candidate of legacyRecords) {
        if (await verifyResetToken(token, candidate.tokenHash)) {
          resetRecord = candidate;
          break;
        }
      }
    }

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt <= now) {
      res.status(400).json({ error: 'This reset link is invalid, expired, or already used.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const consumed = await prisma.$transaction(async (tx) => {
      const claimedAt = new Date();
      // Claim the token with a conditional write. Only one concurrent request can win.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: resetRecord.id, usedAt: null, expiresAt: { gt: claimedAt } },
        data: { usedAt: claimedAt }
      });
      if (claim.count !== 1) return false;

      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash, authVersion: { increment: 1 } }
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetRecord.userId, id: { not: resetRecord.id } }
      });
      return true;
    });

    if (!consumed) {
      res.status(400).json({ error: 'This reset link is invalid, expired, or already used.' });
      return;
    }

    revokeUserConnections(resetRecord.userId);
    clearAuthCookie(res);
    res.status(200).json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Password reset could not be completed.');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { router as authRouter };
