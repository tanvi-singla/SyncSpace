import * as oidc from 'openid-client';
import type { ProviderAccount, User } from '@prisma/client';
import { prisma } from '../db/client';

export type OAuthProvider = 'google' | 'github';

const GITHUB_SERVER = {
  issuer: 'https://github.com',
  authorization_endpoint: 'https://github.com/login/oauth/authorize',
  token_endpoint: 'https://github.com/login/oauth/access_token',
} satisfies oidc.ServerMetadata;

let googleConfiguration: Promise<oidc.Configuration> | undefined;

export function getOAuthConfiguration(provider: OAuthProvider): Promise<oidc.Configuration> | oidc.Configuration {
  const clientId = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new Error(`${provider}_oauth_not_configured`);
  if (provider === 'github') return new oidc.Configuration(GITHUB_SERVER, clientId, clientSecret);
  googleConfiguration ??= oidc.discovery(new URL('https://accounts.google.com'), clientId, clientSecret);
  return googleConfiguration;
}

export function getOAuthCallbackUrl(provider: OAuthProvider): string {
  const base = process.env.OAUTH_CALLBACK_BASE_URL || process.env.API_URL || 'http://localhost:5000';
  const url = new URL(`/api/auth/${provider}/callback`, base);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('oauth_callback_must_use_https');
  }
  return url.toString();
}

export function getOAuthFrontendUrl(): string {
  const base = process.env.OAUTH_FRONTEND_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  if (!base) throw new Error('oauth_frontend_url_not_configured');
  const url = new URL(base);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('oauth_frontend_url_must_use_https');
  }
  return url.origin;
}

export function safeOAuthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }
  try {
    const parsed = new URL(value, 'https://syncspace.invalid');
    return parsed.origin === 'https://syncspace.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export async function resolveOAuthIdentity(provider: OAuthProvider, accessToken: string, claims?: oidc.IDToken): Promise<{
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}> {
  if (provider === 'google') {
    if (!claims || typeof claims.sub !== 'string' || typeof claims.email !== 'string' || claims.email_verified !== true) {
      throw new Error('oauth_identity_unverified');
    }
    return {
      providerAccountId: claims.sub,
      email: claims.email.trim().toLowerCase(),
      name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : claims.email,
      avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
    };
  }

  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };
  const profileResponse = await fetch('https://api.github.com/user', { headers });
  if (!profileResponse.ok) throw new Error('oauth_profile_unavailable');
  const profile = await profileResponse.json() as { id?: number; name?: string | null; login?: string; avatar_url?: string };
  if (!Number.isSafeInteger(profile.id) || !profile.id) throw new Error('oauth_identity_unverified');

  const emailsResponse = await fetch('https://api.github.com/user/emails', { headers });
  if (!emailsResponse.ok) throw new Error('oauth_email_unavailable');
  const emails = await emailsResponse.json() as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
  const verifiedEmail = emails.find((item) => item.primary && item.verified && typeof item.email === 'string')?.email;
  if (!verifiedEmail) throw new Error('oauth_identity_unverified');

  return {
    providerAccountId: String(profile.id),
    email: verifiedEmail.trim().toLowerCase(),
    name: profile.name?.trim() || profile.login || verifiedEmail,
    avatarUrl: profile.avatar_url || null,
  };
}

export async function findOrCreateOAuthUser(provider: OAuthProvider, identity: Awaited<ReturnType<typeof resolveOAuthIdentity>>): Promise<User> {
  const existingAccount = await prisma.providerAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
    include: { user: true },
  }) as (ProviderAccount & { user: User }) | null;
  if (existingAccount) return existingAccount.user;

  // Deliberately never link by matching email. Existing password users must sign in
  // and use a future explicit account-linking flow before adding a provider.
  if (await prisma.user.findUnique({ where: { email: identity.email } })) throw new Error('oauth_account_exists');

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: identity.email, passwordHash: null, name: identity.name, avatarUrl: identity.avatarUrl },
      });
      await tx.providerAccount.create({
        data: { userId: user.id, provider, providerAccountId: identity.providerAccountId },
      });
      return user;
    });
  } catch (error) {
    // Concurrent callbacks for the same provider identity may race on the unique key.
    const account = await prisma.providerAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
      include: { user: true },
    }) as (ProviderAccount & { user: User }) | null;
    if (account) return account.user;
    if (await prisma.user.findUnique({ where: { email: identity.email } })) throw new Error('oauth_account_exists');
    throw error;
  }
}
