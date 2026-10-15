import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Render and other hosted environments inject variables directly. Locally, load
// the server-side project .env without overriding variables already provided by
// the process environment.
export function loadServerEnvironment(envPath?: string): void {
  const defaultPath = resolve(process.cwd(), '.env');
  const projectRootPath = fileURLToPath(new URL('../../../.env', import.meta.url));

  const targetPath = envPath ?? (existsSync(defaultPath) ? defaultPath : projectRootPath);

  if (existsSync(targetPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(targetPath);
      }
    } catch {
      // Do not crash if environment cannot be read from file;
      // deployment-injected variables remain in process.env.
    }
  }
}

// Avoid loading developer secrets into test processes. Hosted environments
// without a local .env continue to use their injected variables.
if (process.env.NODE_ENV !== 'test') {
  loadServerEnvironment();
}
