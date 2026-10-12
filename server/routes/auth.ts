import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/db/client';
import { hashPassword, verifyPassword } from '../lib/auth/password';
import { signToken, setAuthCookie, clearAuthCookie } from '../lib/auth/jwt';
import { requireAuth } from '../middleware/auth';
import { registerSchema, loginSchema } from '../../src/lib/validation/auth';
import { toSafeUser } from '../../src/types/auth';
import { generateResetToken, verifyResetToken, calculateResetTokenExpiry, isResetTokenExpired } from '../lib/auth/tokens';

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
    const token = signToken({ userId: user.id, email: user.email });
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

    const token = signToken({ userId: user.id, email: user.email });
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
  const token = signToken({ userId: req.user.userId, email: req.user.email });
  res.status(200).json({ token, userId: req.user.userId });
});


/**
 * POST /api/auth/forgot-password
 * Initiates password reset by generating a secure token and storing its hash.
 * Returns a generic response regardless of whether the email exists (prevents user enumeration).
 * In development mode, returns the reset link for testing purposes.
 */
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Find user by email (case-insensitive)
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() }
    });

    // Generic response regardless of whether user exists
    const genericResponse = {
      message: 'If an account exists for this email, a password reset link has been sent.'
    };

    if (!user) {
      // User doesn't exist - return generic response to prevent enumeration
      res.status(200).json(genericResponse);
      return;
    }

    // Invalidate any existing reset tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id }
    });

    // Generate new reset token
    const { token, tokenHash } = generateResetToken();
    const expiresAt = calculateResetTokenExpiry();

    // Store token hash in database
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    // In development mode, return the reset link for testing
    if (process.env.NODE_ENV !== 'production') {
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
      console.log('\n=== PASSWORD RESET LINK (DEVELOPMENT MODE) ===');
      console.log(`Email: ${user.email}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log('==============================================\n');
      
      res.status(200).json({
        ...genericResponse,
        // Only include this in development for testing
        ...(process.env.NODE_ENV !== 'production' && { 
          devResetLink: resetLink,
          devEmail: user.email 
        })
      });
    } else {
      // In production, just return the generic response
      // Email would be sent here via a real email service
      res.status(200).json(genericResponse);
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    // Still return generic response to prevent enumeration
    res.status(200).json({
      message: 'If an account exists for this email, a password reset link has been sent.'
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Validates the reset token and updates the user's password.
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Reset token is required' });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    // Validate password strength (same as registration)
    const passwordValidation = registerSchema.shape.password.safeParse(password);
    if (!passwordValidation.success) {
      res.status(400).json({
        error: 'Password does not meet requirements',
        details: passwordValidation.error.issues
      });
      return;
    }

    // Find all reset tokens and verify the provided token
    const resetTokens = await prisma.passwordResetToken.findMany({
      where: { usedAt: null },
      include: { user: true }
    });

    let validToken = null;
    for (const resetToken of resetTokens) {
      const isValid = await verifyResetToken(token, resetToken.tokenHash);
      if (isValid) {
        validToken = resetToken;
        break;
      }
    }

    if (!validToken) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    // Check if token has expired
    if (isResetTokenExpired(validToken.expiresAt)) {
      res.status(400).json({ error: 'Reset token has expired' });
      return;
    }

    // Check if token has already been used
    if (validToken.usedAt) {
      res.status(400).json({ error: 'Reset token has already been used' });
      return;
    }

    // Hash the new password
    const passwordHash = await hashPassword(password);

    // Update user's password
    await prisma.user.update({
      where: { id: validToken.userId },
      data: { passwordHash }
    });

    // Mark the token as used
    await prisma.passwordResetToken.update({
      where: { id: validToken.id },
      data: { usedAt: new Date() }
    });

    // Invalidate all other reset tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: validToken.userId,
        id: { not: validToken.id }
      }
    });

    res.status(200).json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { router as authRouter };
