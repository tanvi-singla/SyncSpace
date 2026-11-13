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

/**
 * Resolves the OAuth client configuration for the given provider.
 * Supports both OAUTH_<PROVIDER>_* and un-prefixed <PROVIDER>_* environment variables.
 */
export function getOAuthConfiguration(provider: OAuthProvider): Promise<oidc.Configuration> | oidc.Configuration {
  const upper = provider.toUpperCase();
  const clientId = process.env[`OAUTH_${upper}_CLIENT_ID`]?.trim() || process.env[`${upper}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`OAUTH_${upper}_CLIENT_SECRET`]?.trim() || process.env[`${upper}_CLIENT_SECRET`]?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(`${provider}_oauth_not_configured`);
  }

  if (provider === 'github') {
    return new oidc.Configuration(GITHUB_SERVER, clientId, clientSecret);
  }

  googleConfiguration ??= oidc.discovery(new URL('https://accounts.google.com'), clientId, clientSecret).catch((err) => {
    // Clear cached promise on failure so subsequent requests can retry
    googleConfiguration = undefined;
    throw err;
  });

  return googleConfiguration;
}

/**
 * Returns the exact OAuth callback URL for the given provider.
 * Prefers provider-specific callback URL if set (OAUTH_<PROVIDER>_CALLBACK_URL or <PROVIDER>_CALLBACK_URL),
 * then falls back to OAUTH_CALLBACK_BASE_URL / API_URL / BACKEND_URL with /api/auth/<provider>/callback.
 */
export function getOAuthCallbackUrl(provider: OAuthProvider): string {
  const upper = provider.toUpperCase();
  const specific =
    process.env[`OAUTH_${upper}_CALLBACK_URL`]?.trim() ||
    process.env[`${upper}_CALLBACK_URL`]?.trim();

  if (specific) {
    const parsed = new URL(specific);
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new Error('oauth_callback_must_use_https');
    }
    return parsed.toString();
  }

  const rawBase =
    process.env.OAUTH_CALLBACK_BASE_URL?.trim() ||
    process.env.API_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    'http://localhost:5000';

  const base = rawBase.startsWith('http://') || rawBase.startsWith('https://')
    ? rawBase
    : (process.env.NODE_ENV === 'production' ? `https://${rawBase}` : `http://${rawBase}`);

  const url = new URL(`/api/auth/${provider}/callback`, base);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('oauth_callback_must_use_https');
  }
  return url.toString();
}

/**
 * Resolves the frontend URL to redirect users back to after OAuth completion.
 */
export function getOAuthFrontendUrl(): string {
  const rawBase =
    process.env.OAUTH_FRONTEND_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');

  if (!rawBase) {
    throw new Error('oauth_frontend_url_not_configured');
  }

  const base = rawBase.startsWith('http://') || rawBase.startsWith('https://')
    ? rawBase
    : (process.env.NODE_ENV === 'production' ? `https://${rawBase}` : `http://${rawBase}`);

  const url = new URL(base);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('oauth_frontend_url_must_use_https');
  }
  return url.origin;
}

/**
 * Validates and sanitizes a post-login destination path to prevent open redirects.
 */
export function safeOAuthReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/dashboard';
  }
  try {
    const parsed = new URL(value, 'https://syncspace.invalid');
    return parsed.origin === 'https://syncspace.invalid'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export interface OAuthIdentity {
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

/**
 * Resolves and validates user identity from provider tokens and profile APIs.
 * - For Google: Validates OIDC ID token claims, verifying subject, email, and email_verified.
 * - For GitHub: Fetches authenticated user profile and verified email addresses.
 *   Prefers primary verified email.
 *   Supports GitHub accounts with private or unavailable emails by safely falling back to
 *   GitHub's official noreply format ({id}+{login}@users.noreply.github.com).
 *   Never trusts unverified email addresses.
 */
export async function resolveOAuthIdentity(
  provider: OAuthProvider,
  accessToken: string,
  claims?: oidc.IDToken
): Promise<OAuthIdentity> {
  if (provider === 'google') {
    if (!claims || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
      throw new Error('oauth_identity_unverified');
    }
    const email = claims.email.trim().toLowerCase();
    const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email;
    const avatarUrl = typeof claims.picture === 'string' && claims.picture.trim() ? claims.picture.trim() : null;
    const emailVerified = claims.email_verified === true;

    return {
      providerAccountId: claims.sub,
      email,
      name,
      avatarUrl,
      emailVerified,
    };
  }

  // GitHub user profile request (requires User-Agent header)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SyncSpace-App',
  };

  const profileResponse = await fetch('https://api.github.com/user', { headers });
  if (!profileResponse.ok) {
    throw new Error('oauth_profile_unavailable');
  }

  const profile = (await profileResponse.json()) as {
    id?: number;
    name?: string | null;
    login?: string;
    avatar_url?: string;
    email?: string | null;
  };

  if (!profile.id || !Number.isSafeInteger(profile.id)) {
    throw new Error('oauth_identity_unverified');
  }

  // Fetch verified emails for this GitHub account
  let verifiedEmail: string | undefined;
  let unverifiedCandidateEmail: string | undefined;

  try {
    const emailsResponse = await fetch('https://api.github.com/user/emails', { headers });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }>;

      if (Array.isArray(emails)) {
        // 1. Prefer primary verified email
        const primaryVerified = emails.find(
          (item) => item.primary && item.verified && typeof item.email === 'string' && item.email.trim()
        );
        if (primaryVerified?.email) {
          verifiedEmail = primaryVerified.email.trim().toLowerCase();
        } else {
          // 2. Fall back to any verified email
          const anyVerified = emails.find(
            (item) => item.verified && typeof item.email === 'string' && item.email.trim()
          );
          if (anyVerified?.email) {
            verifiedEmail = anyVerified.email.trim().toLowerCase();
          }
        }

        if (!verifiedEmail) {
          const unverified = emails.find(
            (item) => typeof item.email === 'string' && item.email.trim()
          );
          if (unverified?.email) {
            unverifiedCandidateEmail = unverified.email.trim().toLowerCase();
          }
        }
      }
    }
  } catch {
    // If user/emails endpoint is inaccessible or fails, fall back to GitHub noreply address
  }

  if (!verifiedEmail && !unverifiedCandidateEmail && typeof profile.email === 'string' && profile.email.trim()) {
    unverifiedCandidateEmail = profile.email.trim().toLowerCase();
  }

  // 3. Support GitHub accounts with private or unavailable email addresses
  // Never trust unverified emails. If no verified email is available, use GitHub's standard noreply address format:
  // {id}+{login}@users.noreply.github.com
  let email: string;
  let emailVerified: boolean;

  if (verifiedEmail) {
    email = verifiedEmail;
    emailVerified = true;
  } else if (unverifiedCandidateEmail) {
    email = unverifiedCandidateEmail;
    emailVerified = false;
  } else {
    email = `${profile.id}+${profile.login || 'user'}@users.noreply.github.com`.toLowerCase();
    emailVerified = true;
  }

  return {
    providerAccountId: String(profile.id),
    email,
    name: profile.name?.trim() || profile.login || email,
    avatarUrl: profile.avatar_url || null,
    emailVerified,
  };
}

/**
 * Finds an existing user by provider identity, or links to an existing user with verified matching email,
 * or creates a new SyncSpace user and provider account.
 *
 * Rules:
 * 1. If provider account is already linked, returns that existing user.
 * 2. If provider email is unverified, rejects automatic linking (throws oauth_identity_unverified).
 * 3. If an existing user matches the verified provider email, safely links the provider account to that user,
 *    preserving existing user ID, password, documents, and permissions without duplicate accounts.
 * 4. If no account exists, creates a new user and provider account in a transaction.
 */
export async function findOrCreateOAuthUser(
  provider: OAuthProvider,
  identity: OAuthIdentity
): Promise<User> {
  // 1. If provider account is already linked, verify consistency with verified provider email
  const existingAccount = (await prisma.providerAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
    include: { user: true },
  })) as (ProviderAccount & { user: User }) | null;

  if (existingAccount) {
    // If the provider email is verified and mismatches the currently linked account,
    // check if a user matching the verified provider email exists to heal the mapping safely.
    if (
      identity.emailVerified &&
      existingAccount.user.email.toLowerCase() !== identity.email.toLowerCase()
    ) {
      console.warn(
        `[OAuth Diagnostic] Provider account ${provider}:${identity.providerAccountId} was mapped to ${existingAccount.user.email}, but verified provider email is ${identity.email}.`
      );
      const matchingUser = await prisma.user.findUnique({ where: { email: identity.email } });
      if (matchingUser) {
        await prisma.providerAccount.update({
          where: { id: existingAccount.id },
          data: { userId: matchingUser.id },
        });
        console.log(
          `[OAuth Diagnostic] Safely re-mapped ${provider} account to correct user: ${matchingUser.email} (ID: ${matchingUser.id})`
        );
        return matchingUser;
      }
    }
    return existingAccount.user;
  }

  // 2. Reject unverified emails before linking or creating accounts
  if (!identity.emailVerified) {
    throw new Error('oauth_identity_unverified');
  }

  // 3. When an OAuth provider returns a verified email matching an existing account:
  // Safely link the provider identity to the existing user and preserve their user ID and data.
  const existingUser = await prisma.user.findUnique({ where: { email: identity.email } });

  if (existingUser) {
    try {
      await prisma.providerAccount.create({
        data: {
          userId: existingUser.id,
          provider,
          providerAccountId: identity.providerAccountId,
        },
      });
      console.log(`[OAuth Diagnostic] Safely linked verified ${provider} account to existing user: ${existingUser.email} (ID: ${existingUser.id})`);
      return existingUser;
    } catch (err) {
      // Concurrent callbacks might have linked it simultaneously
      const checkAccount = (await prisma.providerAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
        include: { user: true },
      })) as (ProviderAccount & { user: User }) | null;
      if (checkAccount) {
        return checkAccount.user;
      }
      throw err;
    }
  }

  // 4. No existing user and no existing link: create a new SyncSpace user and provider account in a transaction
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: identity.email,
          passwordHash: null,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
        },
      });

      await tx.providerAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: identity.providerAccountId,
        },
      });

      return user;
    });
  } catch (error) {
    // Concurrent callbacks for the same provider identity may race on the unique key.
    const account = (await prisma.providerAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
      include: { user: true },
    })) as (ProviderAccount & { user: User }) | null;

    if (account) {
      return account.user;
    }

    const racedUser = await prisma.user.findUnique({ where: { email: identity.email } });
    if (racedUser) {
      await prisma.providerAccount.create({
        data: {
          userId: racedUser.id,
          provider,
          providerAccountId: identity.providerAccountId,
        },
      });
      return racedUser;
    }

    throw error;
  }
}

/**
 * Safely links a provider account to an already-authenticated user.
 */
export async function linkOAuthAccount(
  userId: string,
  provider: OAuthProvider,
  providerAccountId: string
): Promise<ProviderAccount> {
  const existing = await prisma.providerAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
  });

  if (existing) {
    if (existing.userId === userId) {
      return existing;
    }
    throw new Error('provider_already_linked');
  }

  return prisma.providerAccount.create({
    data: {
      userId,
      provider,
      providerAccountId,
    },
  });
}

/**
 * Returns the list of linked provider names for a user.
 */
export async function getUserProviders(userId: string): Promise<string[]> {
  const accounts = await prisma.providerAccount.findMany({
    where: { userId },
    select: { provider: true },
  });
  return accounts.map((a) => a.provider);
}

/**
 * Safely unlinks a provider account from a user.
 * Prevents unlinking if the user has no password and this is their only provider account.
 */
export async function unlinkOAuthAccount(userId: string, provider: OAuthProvider): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { providerAccounts: true },
  });

  if (!user) {
    throw new Error('user_not_found');
  }

  const hasPassword = Boolean(user.passwordHash);
  const remainingProviders = user.providerAccounts.filter((a) => a.provider !== provider);

  if (!hasPassword && remainingProviders.length === 0) {
    throw new Error('cannot_unlink_only_auth_method');
  }

  await prisma.providerAccount.deleteMany({
    where: { userId, provider },
  });
}

/**
 * Safely logs OAuth configuration diagnostics at server boot.
 * Identifies whether Google and GitHub credentials are configured and reports expected callback URIs.
 * Never prints secret values, access tokens, or authorization codes.
 */
export function logOAuthConfigStatus(): void {
  const googleClientId = process.env.OAUTH_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const googleReady = Boolean(googleClientId?.trim() && googleSecret?.trim());

  const githubClientId = process.env.OAUTH_GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID;
  const githubSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET;
  const githubReady = Boolean(githubClientId?.trim() && githubSecret?.trim());

  console.log(`[OAuth Diagnostic] Google Sign-In: ${googleReady ? 'READY (configured)' : 'NOT CONFIGURED (missing OAUTH_GOOGLE_CLIENT_ID / OAUTH_GOOGLE_CLIENT_SECRET in .env)'}`);
  if (googleReady) {
    try {
      console.log(`[OAuth Diagnostic] Google Authorized Redirect URI: ${getOAuthCallbackUrl('google')}`);
    } catch (err) {
      console.warn(`[OAuth Diagnostic] Google callback warning:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[OAuth Diagnostic] GitHub Sign-In: ${githubReady ? 'READY (configured)' : 'NOT CONFIGURED (missing OAUTH_GITHUB_CLIENT_ID / OAUTH_GITHUB_CLIENT_SECRET in .env)'}`);
  if (githubReady) {
    try {
      console.log(`[OAuth Diagnostic] GitHub Authorization Callback URL: ${getOAuthCallbackUrl('github')}`);
    } catch (err) {
      console.warn(`[OAuth Diagnostic] GitHub callback warning:`, err instanceof Error ? err.message : err);
    }
  }
}
