import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnvironment } from '../env';

const testVariable = 'SYNCSPACE_ENV_FILE_LOAD_TEST';

afterEach(() => {
  delete process.env[testVariable];
});

describe('server environment loading', () => {
  it('loads an existing server .env file without logging its values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncspace-env-test-'));
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `${testVariable}=loaded-from-env-file\n`, 'utf8');
    try {
      loadServerEnvironment(envFile);
      expect(process.env[testVariable]).toBe('loaded-from-env-file');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ensures injected process environment variables take precedence over .env file', () => {
    process.env[testVariable] = 'injected-deployment-variable';
    const directory = mkdtempSync(join(tmpdir(), 'syncspace-env-test-'));
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `${testVariable}=from-env-file\n`, 'utf8');
    try {
      loadServerEnvironment(envFile);
      expect(process.env[testVariable]).toBe('injected-deployment-variable');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('safely handles missing environment file without crashing', () => {
    expect(() => {
      loadServerEnvironment('/path/to/nonexistent/file/.env');
    }).not.toThrow();
  });
});
