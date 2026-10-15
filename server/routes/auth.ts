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

const router = Router();

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

    const isMatch = await verifyPassword(password, user.passwordHash);
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
          const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL ||
            (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
          if (!frontendUrl) throw new PasswordResetEmailError('missing_configuration');
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
