import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOAuthConfiguration,
  getOAuthCallbackUrl,
  getOAuthFrontendUrl,
  safeOAuthReturnPath,
  resolveOAuthIdentity,
  findOrCreateOAuthUser,
  linkOAuthAccount,
  getUserProviders,
  unlinkOAuthAccount,
} from '../oauth';
import { prisma } from '../../db/client';

vi.mock('../../db/client', () => ({
  prisma: {
    providerAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('openid-client', async () => {
  class MockConfiguration {
    server: any;
    clientId: string;
    clientSecret: string;
    constructor(server: any, clientId: string, clientSecret: string) {
      this.server = server;
      this.clientId = clientId;
      this.clientSecret = clientSecret;
    }
  }

  return {
    Configuration: MockConfiguration,
    discovery: vi.fn().mockResolvedValue({
      server: 'https://accounts.google.com',
      clientId: 'google-client-id',
    }),
  };
});

describe('oauth library unit tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getOAuthConfiguration', () => {
    it('returns GitHub configuration using OAUTH_GITHUB_* variables', () => {
      process.env.OAUTH_GITHUB_CLIENT_ID = 'gh-client-id';
      process.env.OAUTH_GITHUB_CLIENT_SECRET = 'gh-client-secret';

      const config = getOAuthConfiguration('github');
      expect(config).toBeDefined();
    });

    it('supports fallback to un-prefixed GITHUB_* variables', () => {
      delete process.env.OAUTH_GITHUB_CLIENT_ID;
      delete process.env.OAUTH_GITHUB_CLIENT_SECRET;
      process.env.GITHUB_CLIENT_ID = 'gh-fallback-id';
      process.env.GITHUB_CLIENT_SECRET = 'gh-fallback-secret';

      const config = getOAuthConfiguration('github');
      expect(config).toBeDefined();
    });

    it('returns Google configuration using OAUTH_GOOGLE_* variables', async () => {
      process.env.OAUTH_GOOGLE_CLIENT_ID = 'google-client-id';
      process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'google-client-secret';

      const config = await getOAuthConfiguration('google');
      expect(config).toBeDefined();
    });

    it('supports fallback to un-prefixed GOOGLE_* variables', async () => {
      delete process.env.OAUTH_GOOGLE_CLIENT_ID;
      delete process.env.OAUTH_GOOGLE_CLIENT_SECRET;
      process.env.GOOGLE_CLIENT_ID = 'google-fallback-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-fallback-secret';

      const config = await getOAuthConfiguration('google');
      expect(config).toBeDefined();
    });

    it('throws error when credentials are not configured', () => {
      delete process.env.OAUTH_GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.OAUTH_GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_SECRET;

      expect(() => getOAuthConfiguration('google')).toThrow('google_oauth_not_configured');
    });
  });

  describe('getOAuthCallbackUrl', () => {
    it('returns specific callback URL when OAUTH_GOOGLE_CALLBACK_URL is set', () => {
      process.env.OAUTH_GOOGLE_CALLBACK_URL = 'http://localhost:5000/api/auth/google/callback';
      expect(getOAuthCallbackUrl('google')).toBe('http://localhost:5000/api/auth/google/callback');
    });

    it('falls back to OAUTH_CALLBACK_BASE_URL', () => {
      delete process.env.OAUTH_GOOGLE_CALLBACK_URL;
      delete process.env.GOOGLE_CALLBACK_URL;
      process.env.OAUTH_CALLBACK_BASE_URL = 'http://localhost:5000';

      expect(getOAuthCallbackUrl('google')).toBe('http://localhost:5000/api/auth/google/callback');
    });

    it('falls back to API_URL or BACKEND_URL', () => {
      delete process.env.OAUTH_GITHUB_CALLBACK_URL;
      delete process.env.OAUTH_CALLBACK_BASE_URL;
      process.env.API_URL = 'https://api.syncspace.dev';

      expect(getOAuthCallbackUrl('github')).toBe('https://api.syncspace.dev/api/auth/github/callback');
    });

    it('enforces HTTPS for callback URLs in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.OAUTH_GOOGLE_CALLBACK_URL = 'http://insecure.example.com/callback';

      expect(() => getOAuthCallbackUrl('google')).toThrow('oauth_callback_must_use_https');
    });
  });

  describe('getOAuthFrontendUrl', () => {
    it('returns configured frontend origin', () => {
      process.env.FRONTEND_URL = 'http://localhost:5173';
      expect(getOAuthFrontendUrl()).toBe('http://localhost:5173');
    });

    it('prefers OAUTH_FRONTEND_URL over FRONTEND_URL', () => {
      process.env.OAUTH_FRONTEND_URL = 'https://app.syncspace.dev';
      process.env.FRONTEND_URL = 'http://localhost:5173';
      expect(getOAuthFrontendUrl()).toBe('https://app.syncspace.dev');
    });

    it('enforces HTTPS in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.OAUTH_FRONTEND_URL = 'http://insecure.example.com';
      expect(() => getOAuthFrontendUrl()).toThrow('oauth_frontend_url_must_use_https');
    });
  });

  describe('safeOAuthReturnPath', () => {
    it('allows valid relative paths', () => {
      expect(safeOAuthReturnPath('/dashboard')).toBe('/dashboard');
      expect(safeOAuthReturnPath('/workspace/doc-123')).toBe('/workspace/doc-123');
      expect(safeOAuthReturnPath('/settings?tab=profile#section')).toBe('/settings?tab=profile#section');
    });

    it('rejects external absolute URLs and defaults to /dashboard', () => {
      expect(safeOAuthReturnPath('https://evil.com')).toBe('/dashboard');
      expect(safeOAuthReturnPath('//evil.com')).toBe('/dashboard');
      expect(safeOAuthReturnPath('\\evil.com')).toBe('/dashboard');
      expect(safeOAuthReturnPath('javascript:alert(1)')).toBe('/dashboard');
    });

    it('handles non-string values safely', () => {
      expect(safeOAuthReturnPath(null)).toBe('/dashboard');
      expect(safeOAuthReturnPath(undefined)).toBe('/dashboard');
      expect(safeOAuthReturnPath(123)).toBe('/dashboard');
    });
  });

  describe('resolveOAuthIdentity', () => {
    it('resolves Google identity from verified claims', async () => {
      const claims = {
        sub: 'google-user-123',
        email: 'user@gmail.com',
        email_verified: true,
        name: 'Google User',
        picture: 'https://lh3.googleusercontent.com/avatar',
      };

      const identity = await resolveOAuthIdentity('google', 'access-token', claims);
      expect(identity).toEqual({
        providerAccountId: 'google-user-123',
        email: 'user@gmail.com',
        name: 'Google User',
        avatarUrl: 'https://lh3.googleusercontent.com/avatar',
        emailVerified: true,
      });
    });

    it('sets emailVerified=false for Google identity if email is not verified', async () => {
      const claims = {
        sub: 'google-user-123',
        email: 'user@gmail.com',
        email_verified: false,
      };

      const identity = await resolveOAuthIdentity('google', 'access-token', claims);
      expect(identity.emailVerified).toBe(false);
    });

    it('rejects Google identity if sub or email is missing', async () => {
      await expect(resolveOAuthIdentity('google', 'access-token', undefined)).rejects.toThrow(
        'oauth_identity_unverified'
      );
    });

    it('resolves GitHub identity with primary verified email', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 998877,
            name: 'Octocat Dev',
            login: 'octocat',
            avatar_url: 'https://avatars.githubusercontent.com/u/998877',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { email: 'secondary@example.com', primary: false, verified: true },
            { email: 'primary@example.com', primary: true, verified: true },
          ],
        });

      globalThis.fetch = mockFetch;

      const identity = await resolveOAuthIdentity('github', 'gho_token');
      expect(identity).toEqual({
        providerAccountId: '998877',
        email: 'primary@example.com',
        name: 'Octocat Dev',
        avatarUrl: 'https://avatars.githubusercontent.com/u/998877',
        emailVerified: true,
      });

      // Verify User-Agent header is sent
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'SyncSpace-App',
          }),
        })
      );
    });

    it('resolves GitHub identity with fallback to any verified email if primary is missing', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 12345, login: 'devuser' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { email: 'verified-backup@example.com', primary: false, verified: true },
            { email: 'unverified-primary@example.com', primary: true, verified: false },
          ],
        });

      const identity = await resolveOAuthIdentity('github', 'gho_token');
      expect(identity.email).toBe('verified-backup@example.com');
      expect(identity.providerAccountId).toBe('12345');
      expect(identity.emailVerified).toBe(true);
    });

    it('sets emailVerified=false for GitHub identity when only unverified email exists', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 665544, login: 'unverifieduser' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { email: 'unverified@github.com', primary: true, verified: false },
          ],
        });

      const identity = await resolveOAuthIdentity('github', 'gho_token');
      expect(identity.email).toBe('unverified@github.com');
      expect(identity.emailVerified).toBe(false);
    });

    it('supports GitHub accounts with private or unavailable email addresses', async () => {
      // User has "Keep my email addresses private" or /user/emails is inaccessible
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 445566,
            login: 'stealthdev',
            name: 'Stealth Developer',
            avatar_url: null,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // No verified email in list
        });

      const identity = await resolveOAuthIdentity('github', 'gho_token');
      expect(identity.providerAccountId).toBe('445566');
      expect(identity.email).toBe('445566+stealthdev@users.noreply.github.com');
      expect(identity.name).toBe('Stealth Developer');
      expect(identity.emailVerified).toBe(true);
    });

    it('supports GitHub private email when /user/emails endpoint returns HTTP error', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 778899, login: 'privateuser' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const identity = await resolveOAuthIdentity('github', 'gho_token');
      expect(identity.providerAccountId).toBe('778899');
      expect(identity.email).toBe('778899+privateuser@users.noreply.github.com');
      expect(identity.emailVerified).toBe(true);
    });
  });

  describe('findOrCreateOAuthUser', () => {
    it('returns existing user when provider account is already linked (Already-linked provider login)', async () => {
      const existingUser = {
        id: 'user-existing',
        email: 'user@example.com',
        name: 'Existing User',
        passwordHash: null,
        authVersion: 0,
      };

      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce({
        id: 'pa-1',
        userId: 'user-existing',
        provider: 'google',
        providerAccountId: 'google-sub-1',
        createdAt: new Date(),
        user: existingUser,
      } as any);

      const result = await findOrCreateOAuthUser('google', {
        providerAccountId: 'google-sub-1',
        email: 'user@example.com',
        name: 'Existing User',
        avatarUrl: null,
        emailVerified: true,
      });

      expect(result).toEqual(existingUser);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.providerAccount.create).not.toHaveBeenCalled();
    });

    it('detects email mismatch on previously linked providerAccount and safely heals mapping to the correct user', async () => {
      const wrongUser = {
        id: 'user-wrong',
        email: 'mannat@gmail.com',
        name: 'Mannat Old',
        passwordHash: '$2a$12$hash1',
        authVersion: 0,
      };

      const correctUser = {
        id: 'user-correct',
        email: 'mannat240024@gmail.com',
        name: 'Mannat Correct',
        passwordHash: '$2a$12$hash2',
        authVersion: 1,
      };

      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce({
        id: 'pa-mismatched',
        userId: 'user-wrong',
        provider: 'google',
        providerAccountId: '109169458277276006344',
        user: wrongUser,
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(correctUser as any);
      vi.mocked(prisma.providerAccount.update).mockResolvedValueOnce({
        id: 'pa-mismatched',
        userId: 'user-correct',
        provider: 'google',
        providerAccountId: '109169458277276006344',
      } as any);

      const result = await findOrCreateOAuthUser('google', {
        providerAccountId: '109169458277276006344',
        email: 'mannat240024@gmail.com',
        name: 'Mannat',
        avatarUrl: null,
        emailVerified: true,
      });

      expect(result.id).toBe('user-correct');
      expect(result.email).toBe('mannat240024@gmail.com');
      expect(prisma.providerAccount.update).toHaveBeenCalledWith({
        where: { id: 'pa-mismatched' },
        data: { userId: 'user-correct' },
      });
    });

    it('safely links existing email/password account with verified Google email preserving user ID and data', async () => {
      const existingPasswordUser = {
        id: 'user-pwd-123',
        email: 'existing@example.com',
        name: 'Existing Member',
        passwordHash: '$2a$12$securepasswordhash',
        avatarUrl: 'https://syncspace.test/avatar.png',
        authVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(existingPasswordUser as any);
      vi.mocked(prisma.providerAccount.create).mockResolvedValueOnce({
        id: 'pa-new-link',
        userId: 'user-pwd-123',
        provider: 'google',
        providerAccountId: 'google-sub-linked',
        createdAt: new Date(),
      } as any);

      const result = await findOrCreateOAuthUser('google', {
        providerAccountId: 'google-sub-linked',
        email: 'existing@example.com',
        name: 'Google Profile Name',
        avatarUrl: null,
        emailVerified: true,
      });

      expect(result.id).toBe('user-pwd-123');
      expect(result.email).toBe('existing@example.com');
      expect(result.passwordHash).toBe('$2a$12$securepasswordhash');
      expect(prisma.providerAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-pwd-123',
          provider: 'google',
          providerAccountId: 'google-sub-linked',
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('safely links existing email/password account with verified GitHub email preserving user ID and data', async () => {
      const existingPasswordUser = {
        id: 'user-pwd-456',
        email: 'githubber@example.com',
        name: 'SyncSpace Pro User',
        passwordHash: '$2a$12$securepasswordhash2',
        avatarUrl: null,
        authVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(existingPasswordUser as any);
      vi.mocked(prisma.providerAccount.create).mockResolvedValueOnce({
        id: 'pa-gh-link',
        userId: 'user-pwd-456',
        provider: 'github',
        providerAccountId: 'gh-998877',
        createdAt: new Date(),
      } as any);

      const result = await findOrCreateOAuthUser('github', {
        providerAccountId: 'gh-998877',
        email: 'githubber@example.com',
        name: 'GitHub Octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/998877',
        emailVerified: true,
      });

      expect(result.id).toBe('user-pwd-456');
      expect(result.email).toBe('githubber@example.com');
      expect(prisma.providerAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-pwd-456',
          provider: 'github',
          providerAccountId: 'gh-998877',
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects automatic linking and throws oauth_identity_unverified when provider email is unverified', async () => {
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);

      await expect(
        findOrCreateOAuthUser('google', {
          providerAccountId: 'google-unverified',
          email: 'unverified@example.com',
          name: 'Unverified User',
          avatarUrl: null,
          emailVerified: false,
        })
      ).rejects.toThrow('oauth_identity_unverified');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.providerAccount.create).not.toHaveBeenCalled();
    });

    it('registers a new Google user and provider account in a transaction when no account exists (New Google user registration)', async () => {
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      const createdUser = {
        id: 'brand-new-user-id',
        email: 'brandnew@gmail.com',
        name: 'Brand New User',
        passwordHash: null,
        avatarUrl: 'https://lh3.googleusercontent.com/pic',
        authVersion: 0,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const tx = {
          user: { create: vi.fn().mockResolvedValueOnce(createdUser) },
          providerAccount: { create: vi.fn().mockResolvedValueOnce({ id: 'pa-brand-new' }) },
        };
        return fn(tx);
      });

      const result = await findOrCreateOAuthUser('google', {
        providerAccountId: 'google-brand-new-sub',
        email: 'brandnew@gmail.com',
        name: 'Brand New User',
        avatarUrl: 'https://lh3.googleusercontent.com/pic',
        emailVerified: true,
      });

      expect(result).toEqual(createdUser);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('prevents duplicate account creation and safely handles concurrent callback races', async () => {
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      const existingRacedUser = {
        id: 'raced-user-id',
        email: 'raced@example.com',
        name: 'Raced User',
        passwordHash: null,
        authVersion: 0,
      };

      // Transaction fails due to unique constraint on concurrent insert
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('Unique constraint violation'));

      // Fallback checks find the concurrently created user and links safely
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(existingRacedUser as any);
      vi.mocked(prisma.providerAccount.create).mockResolvedValueOnce({ id: 'pa-raced-link' } as any);

      const result = await findOrCreateOAuthUser('google', {
        providerAccountId: 'google-raced-sub',
        email: 'raced@example.com',
        name: 'Raced User',
        avatarUrl: null,
        emailVerified: true,
      });

      expect(result).toEqual(existingRacedUser);
      expect(prisma.providerAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'raced-user-id',
          provider: 'google',
          providerAccountId: 'google-raced-sub',
        },
      });
    });
  });

  describe('linkOAuthAccount', () => {
    it('creates a new link when not already linked', async () => {
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.providerAccount.create).mockResolvedValueOnce({
        id: 'pa-link-1',
        userId: 'user-1',
        provider: 'github',
        providerAccountId: 'gh-12345',
        createdAt: new Date(),
      } as any);

      const result = await linkOAuthAccount('user-1', 'github', 'gh-12345');
      expect(result.userId).toBe('user-1');
      expect(result.provider).toBe('github');
    });

    it('returns existing account when already linked to same user', async () => {
      const existing = {
        id: 'pa-link-1',
        userId: 'user-1',
        provider: 'github',
        providerAccountId: 'gh-12345',
        createdAt: new Date(),
      };
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(existing as any);

      const result = await linkOAuthAccount('user-1', 'github', 'gh-12345');
      expect(result).toEqual(existing);
      expect(prisma.providerAccount.create).not.toHaveBeenCalled();
    });

    it('throws provider_already_linked when linked to a different user', async () => {
      const existing = {
        id: 'pa-link-1',
        userId: 'different-user',
        provider: 'github',
        providerAccountId: 'gh-12345',
        createdAt: new Date(),
      };
      vi.mocked(prisma.providerAccount.findUnique).mockResolvedValueOnce(existing as any);

      await expect(linkOAuthAccount('user-1', 'github', 'gh-12345')).rejects.toThrow(
        'provider_already_linked'
      );
    });
  });

  describe('unlinkOAuthAccount and getUserProviders', () => {
    it('returns list of providers for user', async () => {
      vi.mocked(prisma.providerAccount.findMany).mockResolvedValueOnce([
        { provider: 'google' },
        { provider: 'github' },
      ] as any);

      const providers = await getUserProviders('user-1');
      expect(providers).toEqual(['google', 'github']);
    });

    it('prevents unlinking the only authentication method if user has no password', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: null,
        providerAccounts: [{ provider: 'google' }],
      } as any);

      await expect(unlinkOAuthAccount('user-1', 'google')).rejects.toThrow(
        'cannot_unlink_only_auth_method'
      );
    });

    it('allows unlinking if user has another provider', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: null,
        providerAccounts: [{ provider: 'google' }, { provider: 'github' }],
      } as any);
      vi.mocked(prisma.providerAccount.deleteMany).mockResolvedValueOnce({ count: 1 } as any);

      await unlinkOAuthAccount('user-1', 'google');
      expect(prisma.providerAccount.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', provider: 'google' },
      });
    });

    it('allows unlinking if user has a password', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: '$2a$12$passwordhash',
        providerAccounts: [{ provider: 'google' }],
      } as any);
      vi.mocked(prisma.providerAccount.deleteMany).mockResolvedValueOnce({ count: 1 } as any);

      await unlinkOAuthAccount('user-1', 'google');
      expect(prisma.providerAccount.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', provider: 'google' },
      });
    });
  });
});
