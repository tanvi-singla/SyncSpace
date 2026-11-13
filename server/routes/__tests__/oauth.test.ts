import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  findOrCreateOAuthUser: vi.fn(),
  resolveOAuthIdentity: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  linkOAuthAccount: vi.fn(),
  getUserProviders: vi.fn(),
  unlinkOAuthAccount: vi.fn(),
  getOAuthConfiguration: vi.fn(),
}));

vi.mock('openid-client', () => ({
  randomState: () => 'state-test-value',
  randomPKCECodeVerifier: () => 'verifier-test-value',
  randomNonce: () => 'nonce-test-value',
  calculatePKCECodeChallenge: async () => 'challenge-test-value',
  buildAuthorizationUrl: (...args: unknown[]) => mocks.buildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mocks.authorizationCodeGrant(...args),
}));

vi.mock('../../lib/auth/oauth', () => ({
  getOAuthConfiguration: (...args: unknown[]) => mocks.getOAuthConfiguration(...args),
  getOAuthCallbackUrl: (provider: string) => `http://localhost:5000/api/auth/${provider}/callback`,
  getOAuthFrontendUrl: () => 'http://localhost:5173',
  safeOAuthReturnPath: (path: unknown) =>
    typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
      ? path
      : '/dashboard',
  findOrCreateOAuthUser: (...args: unknown[]) => mocks.findOrCreateOAuthUser(...args),
  resolveOAuthIdentity: (...args: unknown[]) => mocks.resolveOAuthIdentity(...args),
  linkOAuthAccount: (...args: unknown[]) => mocks.linkOAuthAccount(...args),
  getUserProviders: (...args: unknown[]) => mocks.getUserProviders(...args),
  unlinkOAuthAccount: (...args: unknown[]) => mocks.unlinkOAuthAccount(...args),
}));

vi.mock('../../lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === 'user-1') {
          return Promise.resolve({
            id: 'user-1',
            email: 'oauth@example.com',
            name: 'OAuth User',
            passwordHash: null,
            authVersion: 0,
            avatarUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return Promise.resolve(null);
      }),
    },
    providerAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { authRouter } from '../auth';

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use('/api/auth', authRouter);

describe('OAuth Authentication End-to-End Route Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOAuthConfiguration.mockReturnValue({});
    mocks.buildAuthorizationUrl.mockReturnValue(new URL('https://provider.example/authorize'));
    mocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'provider-access-token',
      claims: () => ({ sub: 'google-sub-123', email: 'oauth@example.com', email_verified: true }),
    });
    mocks.resolveOAuthIdentity.mockResolvedValue({
      providerAccountId: 'google-sub-123',
      email: 'oauth@example.com',
      name: 'OAuth User',
      avatarUrl: null,
      emailVerified: true,
    });
    mocks.findOrCreateOAuthUser.mockResolvedValue({
      id: 'user-1',
      email: 'oauth@example.com',
      name: 'OAuth User',
      passwordHash: null,
      authVersion: 0,
    });
  });

  async function transactionCookie(provider = 'google', query = '?next=%2Fsettings'): Promise<string> {
    const response = await request(app).get(`/api/auth/${provider}${query}`).expect(302);
    const cookie = response.headers['set-cookie'][0] as string;
    return cookie.split(';')[0].split('=').slice(1).join('=');
  }

  describe('OAuth Initiation', () => {
    it('redirects to Google authorization URL with state, PKCE challenge, nonce, and identity scopes', async () => {
      const response = await request(app).get('/api/auth/google?next=%2Fdashboard').expect(302);
      expect(response.headers.location).toBe('https://provider.example/authorize');
      expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scope: 'openid email profile',
          state: 'state-test-value',
          code_challenge: 'challenge-test-value',
          code_challenge_method: 'S256',
          nonce: 'nonce-test-value',
          redirect_uri: 'http://localhost:5000/api/auth/google/callback',
        })
      );

      const cookieHeader = response.headers['set-cookie'][0];
      expect(cookieHeader).toContain('oauth_transaction=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Path=/api/auth');
    });

    it('redirects to GitHub authorization URL with state, PKCE challenge, and user scopes', async () => {
      const response = await request(app).get('/api/auth/github?next=%2Fsettings').expect(302);
      expect(response.headers.location).toBe('https://provider.example/authorize');
      expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scope: 'read:user user:email',
          state: 'state-test-value',
          code_challenge: 'challenge-test-value',
          code_challenge_method: 'S256',
          redirect_uri: 'http://localhost:5000/api/auth/github/callback',
        })
      );
    });

    it('redirects to /login?oauth_error=provider_unavailable if provider is not configured', async () => {
      mocks.getOAuthConfiguration.mockImplementation(() => {
        throw new Error('google_oauth_not_configured');
      });

      const response = await request(app).get('/api/auth/google').expect(303);
      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=provider_unavailable');
    });

    it('does not allow an external return URL in the initiated transaction cookie', async () => {
      const response = await request(app).get('/api/auth/google?next=https%3A%2F%2Fevil.example').expect(302);
      const cookie = response.headers['set-cookie'][0] as string;
      const encoded = cookie.split(';')[0].split('=').slice(1).join('=');
      const transaction = JSON.parse(Buffer.from(encoded.split('.')[0], 'base64url').toString());
      expect(transaction.returnPath).toBe('/dashboard');
    });
  });

  describe('OAuth Callbacks and Identity Resolution', () => {
    it('successfully completes Google OAuth callback, establishes session, and redirects to destination', async () => {
      const cookie = await transactionCookie('google', '?next=%2Fworkspace%2Fdoc-1');
      const response = await request(app)
        .get('/api/auth/google/callback?code=valid-google-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(mocks.authorizationCodeGrant).toHaveBeenCalledOnce();
      expect(mocks.resolveOAuthIdentity).toHaveBeenCalledWith(
        'google',
        'provider-access-token',
        expect.objectContaining({ sub: 'google-sub-123' })
      );
      expect(mocks.findOrCreateOAuthUser).toHaveBeenCalledWith('google', expect.objectContaining({ providerAccountId: 'google-sub-123' }));
      expect(response.headers.location).toBe('http://localhost:5173/workspace/doc-1');

      // Verify auth_token session cookie is set
      const authCookie = response.headers['set-cookie'].find((c: string) => c.startsWith('auth_token='));
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');
    });

    it('successfully completes GitHub OAuth callback and establishes session', async () => {
      mocks.resolveOAuthIdentity.mockResolvedValueOnce({
        providerAccountId: 'github-id-9988',
        email: 'developer@example.com',
        name: 'GitHub Dev',
        avatarUrl: 'https://avatars.githubusercontent.com/u/9988',
      });
      mocks.findOrCreateOAuthUser.mockResolvedValueOnce({
        id: 'user-github',
        email: 'developer@example.com',
        name: 'GitHub Dev',
        passwordHash: null,
        authVersion: 0,
      });

      const cookie = await transactionCookie('github', '?next=%2Fdashboard');
      const response = await request(app)
        .get('/api/auth/github/callback?code=valid-github-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(mocks.authorizationCodeGrant).toHaveBeenCalledOnce();
      expect(mocks.resolveOAuthIdentity).toHaveBeenCalledWith('github', 'provider-access-token', expect.anything());
      expect(mocks.findOrCreateOAuthUser).toHaveBeenCalledWith('github', expect.objectContaining({ providerAccountId: 'github-id-9988' }));
      expect(response.headers.location).toBe('http://localhost:5173/dashboard');
      expect(response.headers['set-cookie'].some((c: string) => c.startsWith('auth_token='))).toBe(true);
    });

    it('supports GitHub accounts with private or missing email addresses using noreply identity', async () => {
      mocks.resolveOAuthIdentity.mockResolvedValueOnce({
        providerAccountId: 'github-id-777',
        email: '777+privateuser@users.noreply.github.com',
        name: 'Private User',
        avatarUrl: null,
      });
      mocks.findOrCreateOAuthUser.mockResolvedValueOnce({
        id: 'user-private-noreply',
        email: '777+privateuser@users.noreply.github.com',
        name: 'Private User',
        passwordHash: null,
        authVersion: 0,
      });

      const cookie = await transactionCookie('github');
      const response = await request(app)
        .get('/api/auth/github/callback?code=valid-github-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(mocks.findOrCreateOAuthUser).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({ email: '777+privateuser@users.noreply.github.com' })
      );
      expect(response.headers['set-cookie'].some((c: string) => c.startsWith('auth_token='))).toBe(true);
    });

    it('authenticates existing linked provider identities without creating duplicate accounts', async () => {
      const existingUser = {
        id: 'existing-user-uuid',
        email: 'existing@syncspace.dev',
        name: 'Existing Member',
        passwordHash: null,
        authVersion: 0,
      };
      mocks.findOrCreateOAuthUser.mockResolvedValueOnce(existingUser);

      const cookie = await transactionCookie('google');
      const response = await request(app)
        .get('/api/auth/google/callback?code=code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(mocks.findOrCreateOAuthUser).toHaveBeenCalledWith('google', expect.objectContaining({ providerAccountId: 'google-sub-123' }));
      expect(response.headers['set-cookie'].some((c: string) => c.startsWith('auth_token='))).toBe(true);
    });

    it('safely links existing email/password account with verified Google email', async () => {
      const existingUser = {
        id: 'user-existing-pwd',
        email: 'user@example.com',
        name: 'Existing Password User',
        passwordHash: '$2a$12$somehash',
        authVersion: 0,
      };
      mocks.findOrCreateOAuthUser.mockResolvedValueOnce(existingUser);

      const cookie = await transactionCookie('google');
      const response = await request(app)
        .get('/api/auth/google/callback?code=code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/settings');
      expect(response.headers['set-cookie'].some((val: string) => val.startsWith('auth_token='))).toBe(true);
    });

    it('rejects unverified email and redirects to login with unverified_email error', async () => {
      const cookie = await transactionCookie('google');
      mocks.findOrCreateOAuthUser.mockRejectedValueOnce(new Error('oauth_identity_unverified'));

      const response = await request(app)
        .get('/api/auth/google/callback?code=code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=unverified_email');
      expect(response.headers['set-cookie'].some((val: string) => val.startsWith('auth_token='))).toBe(false);
    });
  });

  describe('Error Handling and Security Protections', () => {
    it('rejects a callback with missing or mismatched state', async () => {
      const cookie = await transactionCookie('google');
      const response = await request(app)
        .get('/api/auth/google/callback?code=code&state=wrong-state')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=invalid_state');
      expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it('rejects a tampered signed state cookie', async () => {
      const cookie = await transactionCookie('google');
      const [payload] = cookie.split('.');
      const response = await request(app)
        .get('/api/auth/google/callback?code=code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${payload}.invalid-tampered-signature`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=invalid_state');
      expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it('handles provider cancellation (access_denied) gracefully without exchanging code', async () => {
      const cookie = await transactionCookie('google');
      const response = await request(app)
        .get('/api/auth/google/callback?error=access_denied&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=cancelled');
      expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it('handles provider token exchange failure gracefully as oauth_failed', async () => {
      const cookie = await transactionCookie('google');
      mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));

      const response = await request(app)
        .get('/api/auth/google/callback?code=bad-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      expect(response.headers.location).toBe('http://localhost:5173/login?oauth_error=oauth_failed');
      expect(mocks.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });
  });

  describe('Session Lifecycle and Protected Routes', () => {
    it('allows access to protected /api/auth/me using the session cookie created by OAuth callback', async () => {
      const cookie = await transactionCookie('google');
      const callbackResponse = await request(app)
        .get('/api/auth/google/callback?code=valid-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      const authCookie = callbackResponse.headers['set-cookie'].find((c: string) => c.startsWith('auth_token='));
      expect(authCookie).toBeDefined();

      const tokenValue = authCookie.split(';')[0];
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Cookie', tokenValue)
        .expect(200);

      expect(meResponse.body.id).toBe('user-1');
      expect(meResponse.body.email).toBe('oauth@example.com');
      expect(meResponse.body.passwordHash).toBeUndefined(); // Never leak passwordHash
    });

    it('logging out clears session cookie and subsequent requests to protected routes fail', async () => {
      const cookie = await transactionCookie('google');
      const callbackResponse = await request(app)
        .get('/api/auth/google/callback?code=valid-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie}`)
        .expect(303);

      const authCookie = callbackResponse.headers['set-cookie'].find((c: string) => c.startsWith('auth_token='));
      const tokenValue = authCookie.split(';')[0];

      // Logout
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', tokenValue)
        .expect(200);

      expect(logoutResponse.body.message).toBe('Logged out successfully');

      // Subsequent access without cookie is rejected
      await request(app)
        .get('/api/auth/me')
        .expect(401);
    });

    it('safely links a provider account when user is already authenticated', async () => {
      // 1. Obtain authenticated session cookie
      const cookie1 = await transactionCookie('google');
      const cb1 = await request(app)
        .get('/api/auth/google/callback?code=valid-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie1}`)
        .expect(303);
      const authCookie = cb1.headers['set-cookie'].find((c: string) => c.startsWith('auth_token=')).split(';')[0];

      // 2. Authenticated user initiates GitHub OAuth with explicit ?action=link
      const initResponse = await request(app)
        .get('/api/auth/github?action=link&next=%2Fsettings')
        .set('Cookie', authCookie)
        .expect(302);

      const linkingCookie = initResponse.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('=');
      const decodedPayload = JSON.parse(Buffer.from(linkingCookie.split('.')[0], 'base64url').toString());
      expect(decodedPayload.linkingUserId).toBe('user-1');

      // 3. Complete callback: links account with matching verified email
      mocks.resolveOAuthIdentity.mockResolvedValueOnce({
        providerAccountId: 'github-acc-555',
        email: 'oauth@example.com',
        name: 'Linked Dev',
        avatarUrl: null,
        emailVerified: true,
      });

      const cb2 = await request(app)
        .get('/api/auth/github/callback?code=github-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${linkingCookie}`)
        .expect(303);

      expect(mocks.linkOAuthAccount).toHaveBeenCalledWith('user-1', 'github', 'github-acc-555');
      expect(cb2.headers.location).toBe('http://localhost:5173/settings');
    });

    it('rejects account linking if authenticated user email does not match verified provider email', async () => {
      // 1. Obtain authenticated session cookie for user-1 (oauth@example.com)
      const cookie1 = await transactionCookie('google');
      const cb1 = await request(app)
        .get('/api/auth/google/callback?code=valid-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${cookie1}`)
        .expect(303);
      const authCookie = cb1.headers['set-cookie'].find((c: string) => c.startsWith('auth_token=')).split(';')[0];

      // 2. Initiate link
      const initResponse = await request(app)
        .get('/api/auth/github?action=link&next=%2Fsettings')
        .set('Cookie', authCookie)
        .expect(302);
      const linkingCookie = initResponse.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('=');

      // 3. Provider returns a different verified email
      mocks.resolveOAuthIdentity.mockResolvedValueOnce({
        providerAccountId: 'github-diff-999',
        email: 'different-email@example.com',
        name: 'Different User',
        avatarUrl: null,
        emailVerified: true,
      });

      const cb2 = await request(app)
        .get('/api/auth/github/callback?code=github-code&state=state-test-value')
        .set('Cookie', `oauth_transaction=${linkingCookie}`)
        .expect(303);

      expect(mocks.linkOAuthAccount).not.toHaveBeenCalled();
      expect(cb2.headers.location).toBe('http://localhost:5173/login?oauth_error=account_exists');
    });
  });
});
