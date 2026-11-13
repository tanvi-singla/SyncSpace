import { existsSync, readFileSync } from 'node:fs';
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
    // 1. Try native process.loadEnvFile if available
    if (typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile(targetPath);
      } catch {
        // Fall back to manual parser below if native loader encounters formatting issues
      }
    }

    // 2. Robust fallback parser to ensure variables with quotes/comments/CRLF are loaded
    try {
      const raw = readFileSync(targetPath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();

        // Strip surrounding matching quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // Only populate if not already set in process.env
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
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
