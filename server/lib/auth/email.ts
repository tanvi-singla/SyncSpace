import '../config/env';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

export type PasswordResetEmailErrorCode =
  | 'missing_configuration'
  | 'missing_api_key'
  | 'missing_from_email'
  | 'invalid_api_key'
  | 'sender_restriction'
  | 'recipient_restriction'
  | 'rate_limit_exceeded'
  | 'provider_api_failure';

export class PasswordResetEmailError extends Error {
  constructor(
    readonly code: PasswordResetEmailErrorCode,
    readonly status?: number,
    readonly providerCode?: string,
  ) {
    super(code);
    this.name = 'PasswordResetEmailError';
  }
}

const hasValue = (value: string | undefined): boolean => Boolean(value?.trim());

/** Logs only whether server-side configuration exists, never its values. */
export function logPasswordResetEmailConfiguration(): void {
  if (process.env.NODE_ENV === 'test') return;

  console.info(
    `[Password reset email] Resend configuration: RESEND_API_KEY=${hasValue(process.env.RESEND_API_KEY) ? 'present' : 'missing'}, PASSWORD_RESET_FROM_EMAIL=${hasValue(process.env.PASSWORD_RESET_FROM_EMAIL) ? 'present' : 'missing'}`,
  );
}

/** Emits static diagnostics only. Provider messages and request data are never logged. */
export function logPasswordResetEmailFailure(error: unknown): void {
  if (error instanceof PasswordResetEmailError) {
    const status = error.status ? ` http_status=${error.status}` : '';
    const providerCode = error.providerCode ? ` provider_code=${error.providerCode}` : '';
    console.warn(`[Password reset email] Delivery failed: ${error.code}${status}${providerCode}`);
    return;
  }

  console.warn('[Password reset email] Delivery failed: provider_api_failure');
}

function safeProviderCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const value = typeof record.name === 'string' ? record.name : record.code;
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  const knownCodes = new Set([
    'invalid_api_key',
    'missing_api_key',
    'restricted_api_key',
    'validation_error',
    'rate_limit_exceeded',
    'internal_server_error',
    'not_found',
    'forbidden',
    'method_not_allowed',
    'daily_quota_exceeded',
    'sender_restriction',
    'recipient_restriction',
  ]);
  return knownCodes.has(normalized) ? normalized : undefined;
}

/** Sends a reset email through Resend without exposing provider credentials or tokens to clients. */
export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.PASSWORD_RESET_FROM_EMAIL?.trim();

  if (!apiKey && !from) {
    throw new PasswordResetEmailError('missing_configuration');
  }
  if (!apiKey) {
    throw new PasswordResetEmailError('missing_api_key');
  }
  if (!from) {
    throw new PasswordResetEmailError('missing_from_email');
  }

  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Reset your SyncSpace password',
        html: `<p>We received a request to reset your SyncSpace password.</p><p><a href="${resetLink}">Choose a new password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request a reset, you can ignore this email.</p>`,
        text: `We received a request to reset your SyncSpace password. Open this link to choose a new password (expires in 30 minutes): ${resetLink}\n\nIf you did not request a reset, you can ignore this email.`,
      }),
    });
  } catch {
    throw new PasswordResetEmailError('provider_api_failure');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const providerCode = safeProviderCode(payload);
    const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : '';

    if (
      response.status === 401 ||
      /invalid_api_key|restricted_api_key|missing_api_key/i.test(providerCode || '') ||
      (response.status === 403 && /api key|unauthorized|forbidden|credentials/i.test(message) && !/domain|sender|verify|recipient|testing/i.test(message))
    ) {
      throw new PasswordResetEmailError('invalid_api_key', response.status, providerCode);
    }

    if (
      response.status === 429 ||
      providerCode === 'rate_limit_exceeded' ||
      /rate limit|too many requests/i.test(message)
    ) {
      throw new PasswordResetEmailError('rate_limit_exceeded', response.status, providerCode);
    }

    const isRecipientRestriction =
      /testing email|only send to|permitted recipient|recipient.*(restricted|not allowed|suppressed)|own email address|send to.*your own/i.test(message) ||
      /recipient_restriction/i.test(providerCode || '');

    if (isRecipientRestriction) {
      throw new PasswordResetEmailError('recipient_restriction', response.status, providerCode);
    }

    const isSenderRestriction =
      /domain.*not (verified|registered)|sender.*(not verified|not allowed)|from.*not (verified|valid)|verify.*domain/i.test(message) ||
      (response.status === 403 && /sender|domain|verify/i.test(message)) ||
      /sender_restriction|domain_not_verified/i.test(providerCode || '');

    if (isSenderRestriction) {
      throw new PasswordResetEmailError('sender_restriction', response.status, providerCode);
    }

    throw new PasswordResetEmailError('provider_api_failure', response.status, providerCode);
  }
}

