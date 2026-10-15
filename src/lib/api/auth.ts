import type { CreateUserInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from '../validation/auth';
import type { SafeUser } from '../../types/auth';

/**
 * Parses response JSON and throws an informative error if response is not ok.
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMessage = 'An unexpected error occurred';
    try {
      const data = await res.json();
      errorMessage = data.error || data.message || errorMessage;
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

/**
 * Registers a new user account with credentials: 'include' so session cookie is saved.
 */
export async function registerApi(data: CreateUserInput): Promise<SafeUser> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return handleResponse<SafeUser>(res);
}

/**
 * Logs in with email and password, setting the session cookie.
 */
export async function loginApi(data: LoginInput): Promise<SafeUser> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return handleResponse<SafeUser>(res);
}

/**
 * Logs out the current session and clears the auth cookie.
 */
export async function logoutApi(): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to logout');
  }
}

/**
 * Fetches the currently authenticated user from the backend.
 * Catches 401 and network errors gracefully and returns null without unhandled rejections.
 */
export async function getCurrentUserApi(): Promise<SafeUser | null> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 404) {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Initiates password reset by sending the user's email.
 * Returns a generic response so the account's existence is not disclosed.
 */
export async function forgotPasswordApi(data: ForgotPasswordInput): Promise<{ message: string }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

/**
 * Resets the user's password using a valid reset token.
 */
export async function resetPasswordApi(data: ResetPasswordInput): Promise<{ message: string }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<{ message: string }>(res);
}

/**
 * Resolves the base URL for API requests, supporting custom base URLs if configured.
 */
export function getApiBaseUrl(): string {
  const envApi =
    (typeof process !== 'undefined' && process.env?.VITE_API_URL !== undefined
      ? process.env.VITE_API_URL
      : (import.meta as any).env?.VITE_API_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_SERVER_URL !== undefined
      ? process.env.VITE_SERVER_URL
      : (import.meta as any).env?.VITE_SERVER_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL !== undefined
      ? process.env.VITE_API_BASE_URL
      : (import.meta as any).env?.VITE_API_BASE_URL);

  if (envApi && typeof envApi === 'string' && envApi.trim().length > 0) {
    return envApi.trim().replace(/\/+$/, '');
  }
  return '';
}

/**
 * Fetches a short-lived signed WebSocket token from the trusted backend.
 * Uses session credentials (cookies) to authorize the request.
 * Returns null if unauthenticated or on network failure. Never logs token contents.
 */
export async function getWsTokenApi(): Promise<string | null> {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/auth/ws-token`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (data && typeof data.token === 'string' && data.token.trim().length > 0) {
      return data.token.trim();
    }
    return null;
  } catch {
    return null;
  }
}

