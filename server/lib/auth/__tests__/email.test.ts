import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  logPasswordResetEmailConfiguration,
  logPasswordResetEmailFailure,
  PasswordResetEmailError,
  sendPasswordResetEmail,
} from '../email';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Resend password reset email service', () => {
  it('reports missing server credentials without disclosing values', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', '');
    vi.stubEnv('NODE_ENV', 'development');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logPasswordResetEmailConfiguration();
    await expect(sendPasswordResetEmail('person@example.test', 'https://app.test/reset#token=secret'))
      .rejects.toMatchObject({ code: 'missing_configuration' });

    expect(info).toHaveBeenCalledWith(
      '[Password reset email] Resend configuration: RESEND_API_KEY=missing, PASSWORD_RESET_FROM_EMAIL=missing',
    );

    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', 'SyncSpace <onboarding@resend.dev>');
    logPasswordResetEmailConfiguration();
    expect(info).toHaveBeenLastCalledWith(
      '[Password reset email] Resend configuration: RESEND_API_KEY=present, PASSWORD_RESET_FROM_EMAIL=present',
    );
    expect(info.mock.calls.flat().join(' ')).not.toContain('test-api-key');
  });

  it('differentiates missing API key vs missing sender address', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', 'SyncSpace <onboarding@resend.dev>');
    await expect(sendPasswordResetEmail('person@example.test', 'https://app.test/reset#token=secret'))
      .rejects.toMatchObject({ code: 'missing_api_key' });

    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', '');
    await expect(sendPasswordResetEmail('person@example.test', 'https://app.test/reset#token=secret'))
      .rejects.toMatchObject({ code: 'missing_from_email' });
  });

  it('sends using the configured sender and reset link', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', 'SyncSpace <onboarding@resend.dev>');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendPasswordResetEmail('person@example.test', 'https://app.test/reset-password#token=secret');

    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers.Authorization).toBe('Bearer test-api-key');
    expect(body.from).toBe('SyncSpace <onboarding@resend.dev>');
    expect(body.to).toEqual(['person@example.test']);
    expect(body.text).toContain('https://app.test/reset-password#token=secret');
  });

  it.each([
    [401, { name: 'validation_error', message: 'Invalid API key' }, 'invalid_api_key'],
    [403, { name: 'validation_error', message: 'You can only send testing emails to your own email address' }, 'recipient_restriction'],
    [403, { name: 'validation_error', message: 'The domain syncspace.dev is not verified. Please verify it at resend.com/domains.' }, 'sender_restriction'],
    [429, { name: 'rate_limit_exceeded', message: 'Too many requests' }, 'rate_limit_exceeded'],
    [500, { name: 'internal_error', message: 'Provider failure' }, 'provider_api_failure'],
  ] as const)('categorizes Resend HTTP %i errors safely', async (status, payload, code) => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', 'SyncSpace <onboarding@resend.dev>');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let error: unknown;
    try {
      await sendPasswordResetEmail('person@example.test', 'https://app.test/reset#token=private-token');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PasswordResetEmailError);
    logPasswordResetEmailFailure(error);

    const output = warn.mock.calls.flat().join(' ');
    expect(output).toContain(code);
    expect(output).toContain(`http_status=${status}`);
    expect(output).not.toContain('person@example.test');
    expect(output).not.toContain('private-token');
    expect(output).not.toContain('test-api-key');
    expect(output).not.toContain(payload.message);
  });

  it('logs network failures without provider or request details', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('PASSWORD_RESET_FROM_EMAIL', 'SyncSpace <onboarding@resend.dev>');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('request failed with secret token')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let error: unknown;
    try {
      await sendPasswordResetEmail('person@example.test', 'https://app.test/reset#token=private-token');
    } catch (caught) {
      error = caught;
    }
    logPasswordResetEmailFailure(error);

    expect(warn).toHaveBeenCalledWith('[Password reset email] Delivery failed: provider_api_failure');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret token');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('private-token');
  });
});
