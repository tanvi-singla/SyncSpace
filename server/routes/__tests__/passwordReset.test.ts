import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  users: [] as any[],
  resetTokens: [] as any[],
  lastResetLink: '' as string,
  findUser: vi.fn(),
  updateUser: vi.fn(),
  findResetToken: vi.fn(),
  findResetTokens: vi.fn(),
  createResetToken: vi.fn(),
  deleteResetTokens: vi.fn(),
  claimResetToken: vi.fn(),
  sendEmail: vi.fn(),
  logEmailFailure: vi.fn(),
}));

vi.mock('../../lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mocks.findUser(...args),
      update: (...args: unknown[]) => mocks.updateUser(...args),
    },
    passwordResetToken: {
      findFirst: (...args: unknown[]) => mocks.findResetToken(...args),
      findMany: (...args: unknown[]) => mocks.findResetTokens(...args),
      create: (...args: unknown[]) => mocks.createResetToken(...args),
      deleteMany: (...args: unknown[]) => mocks.deleteResetTokens(...args),
      updateMany: (...args: unknown[]) => mocks.claimResetToken(...args),
    },
    $transaction: (callback: (tx: unknown) => unknown) => callback({
      user: { update: (...args: unknown[]) => mocks.updateUser(...args) },
      passwordResetToken: {
        create: (...args: unknown[]) => mocks.createResetToken(...args),
        deleteMany: (...args: unknown[]) => mocks.deleteResetTokens(...args),
        updateMany: (...args: unknown[]) => mocks.claimResetToken(...args),
      },
    }),
  },
}));

vi.mock('../../lib/auth/email', () => ({
  sendPasswordResetEmail: (...args: unknown[]) => mocks.sendEmail(...args),
  logPasswordResetEmailFailure: (...args: unknown[]) => mocks.logEmailFailure(...args),
}));

import { authRouter } from '../auth';
import { verifyPassword } from '../../lib/auth/password';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const validReset = (token: string, password = 'NewSecurePassword1!') => ({
  token,
  password,
  confirmPassword: password,
});

async function requestResetLink(): Promise<string> {
  await request(app).post('/api/auth/forgot-password').send({ email: 'user@example.com' }).expect(200);
  await vi.waitFor(() => expect(mocks.lastResetLink).not.toBe(''));
  const link = new URL(mocks.lastResetLink);
  return new URLSearchParams(link.hash.slice(1)).get('token') || '';
}

describe('Password reset flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lastResetLink = '';
    mocks.users = [{ id: 'user-1', email: 'user@example.com', passwordHash: 'old-hash', authVersion: 0 }];
    mocks.resetTokens = [];

    mocks.findUser.mockImplementation(async ({ where }: any) =>
      mocks.users.find((user) => where.email ? user.email === where.email : user.id === where.id) || null
    );
    mocks.updateUser.mockImplementation(async ({ where, data }: any) => {
      const user = mocks.users.find((candidate) => candidate.id === where.id);
      if (data.authVersion?.increment) user.authVersion += data.authVersion.increment;
      if (data.passwordHash) user.passwordHash = data.passwordHash;
      return user;
    });
    mocks.findResetToken.mockImplementation(async ({ where }: any) =>
      mocks.resetTokens.find((token) => token.tokenHash === where.tokenHash) || null
    );
    mocks.findResetTokens.mockImplementation(async ({ where }: any) =>
      mocks.resetTokens.filter((token) =>
        token.tokenHash.startsWith(where.tokenHash.startsWith) &&
        token.usedAt === where.usedAt && token.expiresAt > where.expiresAt.gt
      )
    );
    mocks.createResetToken.mockImplementation(async ({ data }: any) => {
      const token = { id: `reset-${mocks.resetTokens.length + 1}`, usedAt: null, ...data };
      mocks.resetTokens.push(token);
      return token;
    });
    mocks.deleteResetTokens.mockImplementation(async ({ where }: any) => {
      const before = mocks.resetTokens.length;
      mocks.resetTokens = mocks.resetTokens.filter((token) => {
        if (token.userId !== where.userId) return true;
        return where.id?.not ? token.id === where.id.not : false;
      });
      return { count: before - mocks.resetTokens.length };
    });
    mocks.claimResetToken.mockImplementation(async ({ where, data }: any) => {
      const token = mocks.resetTokens.find((candidate) => candidate.id === where.id);
      if (!token || token.usedAt || token.expiresAt <= where.expiresAt.gt) return { count: 0 };
      token.usedAt = data.usedAt;
      return { count: 1 };
    });
    mocks.sendEmail.mockImplementation(async (_email: string, link: string) => {
      mocks.lastResetLink = link;
    });
  });

  it('emails a hashed-token link and successfully resets the password', async () => {
    const token = await requestResetLink();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.resetTokens[0].tokenHash).not.toBe(token);
    expect(mocks.resetTokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);

    await request(app).post('/api/auth/reset-password').send(validReset(token)).expect(200);
    expect(await verifyPassword('NewSecurePassword1!', mocks.users[0].passwordHash)).toBe(true);
    expect(mocks.users[0].authVersion).toBe(1);
    expect(mocks.resetTokens[0].usedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid token without changing the password', async () => {
    const response = await request(app).post('/api/auth/reset-password')
      .send(validReset('not-a-valid-token')).expect(400);
    expect(response.body.error).toMatch(/invalid, expired, or already used/i);
    expect(mocks.users[0].passwordHash).toBe('old-hash');
  });

  it('rejects an expired token', async () => {
    const token = await requestResetLink();
    mocks.resetTokens[0].expiresAt = new Date(Date.now() - 1000);
    await request(app).post('/api/auth/reset-password').send(validReset(token)).expect(400);
    expect(mocks.users[0].passwordHash).toBe('old-hash');
  });

  it('rejects reuse of a successfully consumed token', async () => {
    const token = await requestResetLink();
    await request(app).post('/api/auth/reset-password').send(validReset(token)).expect(200);
    await request(app).post('/api/auth/reset-password').send(validReset(token)).expect(400);
    expect(mocks.users[0].authVersion).toBe(1);
  });

  it('validates password requirements and confirmation on the server', async () => {
    const token = await requestResetLink();
    await request(app).post('/api/auth/reset-password')
      .send(validReset(token, 'weak')).expect(400);
    await request(app).post('/api/auth/reset-password')
      .send({ ...validReset(token), confirmPassword: 'OtherPassword2!' }).expect(400);
    expect(mocks.users[0].passwordHash).toBe('old-hash');
  });

  it('returns the same generic response for an unknown email', async () => {
    const response = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'missing@example.com' }).expect(200);
    expect(response.body.message).toBe('If an account exists for this email, a password reset link has been sent.');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('sends known-user reset links through Resend using the configured frontend origin', async () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://syncspace.example.test';
    try {
      const response = await request(app).post('/api/auth/forgot-password')
        .send({ email: 'user@example.com' }).expect(200);
      await vi.waitFor(() => expect(mocks.sendEmail).toHaveBeenCalledOnce());

      const [email, link] = mocks.sendEmail.mock.calls[0];
      const resetUrl = new URL(link);
      expect(email).toBe('user@example.com');
      expect(resetUrl.origin).toBe('https://syncspace.example.test');
      expect(resetUrl.pathname).toBe('/reset-password');
      expect(resetUrl.hash).toMatch(/^#token=[a-f0-9]{64}$/);
      expect(response.body).toEqual({ message: 'If an account exists for this email, a password reset link has been sent.' });
      expect(JSON.stringify(response.body)).not.toContain(resetUrl.hash.slice(7));
    } finally {
      if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('keeps the generic response and never returns a link when email delivery fails', async () => {
    mocks.sendEmail.mockImplementationOnce(async (_email: string, link: string) => {
      mocks.lastResetLink = link;
      throw new Error('provider failure');
    });
    const response = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' }).expect(200);
    await vi.waitFor(() => expect(mocks.lastResetLink).not.toBe(''));
    expect(response.body).toEqual({ message: 'If an account exists for this email, a password reset link has been sent.' });
    expect(response.body).not.toHaveProperty('devResetLink');
    expect(JSON.stringify(response.body)).not.toContain(mocks.lastResetLink);
    expect(mocks.logEmailFailure).toHaveBeenCalledOnce();
  });

  it('allows only one of two concurrent attempts to consume a token', async () => {
    const token = await requestResetLink();
    const responses = await Promise.all([
      request(app).post('/api/auth/reset-password').send(validReset(token, 'FirstSecurePassword1!')),
      request(app).post('/api/auth/reset-password').send(validReset(token, 'SecondSecurePassword1!')),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(mocks.users[0].authVersion).toBe(1);
    expect(mocks.resetTokens[0].usedAt).toBeInstanceOf(Date);
  });
});
