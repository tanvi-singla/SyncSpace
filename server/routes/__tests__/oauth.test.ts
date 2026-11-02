import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  findOrCreateOAuthUser: vi.fn(),
  resolveOAuthIdentity: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
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
  getOAuthConfiguration: () => ({}),
  getOAuthCallbackUrl: (provider: string) => `http://localhost:5000/api/auth/${provider}/callback`,
  getOAuthFrontendUrl: () => 'http://localhost:5173',
  safeOAuthReturnPath: (path: unknown) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard',
  findOrCreateOAuthUser: (...args: unknown[]) => mocks.findOrCreateOAuthUser(...args),
  resolveOAuthIdentity: (...args: unknown[]) => mocks.resolveOAuthIdentity(...args),
}));

import { authRouter } from '../auth';

const app = express();
app.use(cookieParser());
app.use('/api/auth', authRouter);

describe('OAuth callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildAuthorizationUrl.mockReturnValue(new URL('https://provider.example/authorize'));
    mocks.authorizationCodeGrant.mockResolvedValue({ access_token: 'provider-access-token', claims: () => ({ sub: 'google-sub', email: 'oauth@example.com', email_verified: true }) });
    mocks.resolveOAuthIdentity.mockResolvedValue({ providerAccountId: 'google-sub', email: 'oauth@example.com', name: 'OAuth User', avatarUrl: null });
    mocks.findOrCreateOAuthUser.mockResolvedValue({ id: 'user-1', email: 'oauth@example.com', name: 'OAuth User', passwordHash: null, authVersion: 0 });
  });

  async function transactionCookie(): Promise<string> {
    const response = await request(app).get('/api/auth/google?next=%2Fsettings').expect(302);
    const cookie = response.headers['set-cookie'][0] as string;
    return cookie.split(';')[0].split('=').slice(1).join('=');
  }

  it('rejects a callback with missing or mismatched state', async () => {
    const cookie = await transactionCookie();
    const response = await request(app).get('/api/auth/google/callback?code=code&state=wrong')
      .set('Cookie', `oauth_transaction=${cookie}`).expect(303);
    expect(response.headers.location).toContain('oauth_error=invalid_state');
    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('handles a cancelled provider login without exchanging a code', async () => {
    const cookie = await transactionCookie();
    const response = await request(app).get('/api/auth/google/callback?error=access_denied&state=state-test-value')
      .set('Cookie', `oauth_transaction=${cookie}`).expect(303);
    expect(response.headers.location).toContain('oauth_error=cancelled');
    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('reports duplicate email accounts without linking or creating a session', async () => {
    const cookie = await transactionCookie();
    mocks.findOrCreateOAuthUser.mockRejectedValue(new Error('oauth_account_exists'));
    const response = await request(app).get('/api/auth/google/callback?code=code&state=state-test-value')
      .set('Cookie', `oauth_transaction=${cookie}`).expect(303);
    expect(response.headers.location).toContain('oauth_error=account_exists');
    expect(response.headers['set-cookie'].some((value: string) => value.startsWith('auth_token='))).toBe(false);
  });

  it('handles an invalid provider callback response as a sign-in error', async () => {
    const cookie = await transactionCookie();
    mocks.authorizationCodeGrant.mockRejectedValue(new Error('invalid_grant'));
    const response = await request(app).get('/api/auth/google/callback?code=bad-code&state=state-test-value')
      .set('Cookie', `oauth_transaction=${cookie}`).expect(303);
    expect(response.headers.location).toContain('oauth_error=oauth_failed');
    expect(mocks.findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it('logs in a provider identity using its stable provider ID and existing session cookie', async () => {
    const cookie = await transactionCookie();
    const response = await request(app).get('/api/auth/google/callback?code=code&state=state-test-value')
      .set('Cookie', `oauth_transaction=${cookie}`).expect(303);
    expect(mocks.authorizationCodeGrant).toHaveBeenCalledOnce();
    expect(mocks.findOrCreateOAuthUser).toHaveBeenCalledWith('google', expect.objectContaining({ providerAccountId: 'google-sub' }));
    expect(response.headers.location).toBe('http://localhost:5173/settings');
    expect(response.headers['set-cookie'].some((value: string) => value.startsWith('auth_token='))).toBe(true);
  });

  it('does not allow an external return URL', async () => {
    const response = await request(app).get('/api/auth/google?next=https%3A%2F%2Fevil.example').expect(302);
    const cookie = response.headers['set-cookie'][0] as string;
    const encoded = cookie.split(';')[0].split('=').slice(1).join('=');
    const transaction = JSON.parse(Buffer.from(encoded.split('.')[0], 'base64url').toString());
    expect(transaction.returnPath).toBe('/dashboard');
  });

  it('rejects a tampered signed state cookie', async () => {
    const cookie = await transactionCookie();
    const [payload] = cookie.split('.');
    const response = await request(app).get('/api/auth/google/callback?code=code&state=state-test-value')
      .set('Cookie', `oauth_transaction=${payload}.bad-signature`).expect(303);
    expect(response.headers.location).toContain('oauth_error=invalid_state');
    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });
});
