import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const RESET_TOKEN_EXPIRY_MINUTES = 30; // 30 minutes
const RESET_TOKEN_LENGTH = 32; // 32 bytes = 256 bits

/**
 * Generates a cryptographically secure random reset token.
 * Returns the raw token (to be sent to user) and its hash (to be stored in database).
 */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(RESET_TOKEN_LENGTH).toString('hex');
  const tokenHash = hashResetToken(token);
  return { token, tokenHash };
}

/** A fast, deterministic hash for indexed token lookup; reset tokens have 256 bits of entropy. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Verifies a reset token against a stored hash.
 */
export async function verifyResetToken(token: string, tokenHash: string): Promise<boolean> {
  try {
    if (/^[a-f0-9]{64}$/i.test(tokenHash)) {
      return crypto.timingSafeEqual(Buffer.from(hashResetToken(token), 'hex'), Buffer.from(tokenHash, 'hex'));
    }
    // Accept outstanding bcrypt-hashed reset links created by the previous implementation.
    return await bcrypt.compare(token, tokenHash);
  } catch {
    return false;
  }
}

/**
 * Calculates the expiration date for a reset token.
 */
export function calculateResetTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + RESET_TOKEN_EXPIRY_MINUTES);
  return expiry;
}

/**
 * Checks if a reset token has expired.
 */
export function isResetTokenExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}
