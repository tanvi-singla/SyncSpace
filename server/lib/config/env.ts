import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Render and other hosted environments inject variables directly. Locally, load
// the server-side project .env without overriding variables already provided by
// the process environment.
export function loadServerEnvironment(envPath = resolve(process.cwd(), '.env')): void {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

// Avoid loading developer secrets into test processes. Hosted environments
// without a local .env continue to use their injected variables.
if (process.env.NODE_ENV !== 'test') {
  loadServerEnvironment();
}
