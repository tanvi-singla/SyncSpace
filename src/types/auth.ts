import type { CreateUserInput, LoginInput } from '../lib/validation/auth';

/**
 * Full User entity model representing the database record
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  avatarUrl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Safe client-facing user representation that strictly omits passwordHash
 */
export type SafeUser = Omit<User, 'passwordHash'>;

/**
 * Strips passwordHash and returns a SafeUser, guaranteeing sensitive credentials
 * are never leaked to client exposure surfaces.
 */
export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _omitted, ...safeUser } = user;
  return safeUser;
}

export type { CreateUserInput, LoginInput };
