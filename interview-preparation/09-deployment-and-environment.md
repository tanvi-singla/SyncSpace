# 09. Deployment, Environment & Production Infrastructure

This document covers the deployment architecture of SyncSpace on Render, environment variable management, build pipelines, custom domain configuration, and Single-Page Application (SPA) routing fallbacks.

---

## 1. Production Deployment Topology

SyncSpace is designed to deploy seamlessly to cloud PaaS platforms like **Render**, **Railway**, or **Fly.io**.

On Render, SyncSpace operates as a **Unified Web Service**:

```
                Internet / Browser Clients
                            │
                            ▼
               Cloudflare / Render CDN
          (SSL Termination & DDoS Mitigation)
                            │
               ┌────────────┴────────────┐
               │                         │
               ▼                         ▼
         sync-space.me            www.sync-space.me
      (301 Apex Redirect)       (Canonical Production)
               │                         │
               └────────────┬────────────┘
                            │
                            ▼
            Render Web Service Container (:10000)
    ┌───────────────────────────────────────────────────┐
    │  Unified Node.js / Express Runtime                │
    │                                                   │
    │  • Express HTTP REST API (/api/*)                 │
    │  • Hardened Yjs WebSocket Server (ws://.../*)     │
    │  • Static Frontend Asset Delivery (dist/)         │
    │  • SPA Deep Link Fallback (/* -> index.html)      │
    └───────────────────────────────────────────────────┘
                            │
                            ▼ (Encrypted TLS / Port 5432)
             Neon Serverless PostgreSQL Pooler
```

---

## 2. Environment Variables Catalog

> [!IMPORTANT]
> In accordance with senior security standards, actual secret values (API keys, passwords, database credentials) are **never** committed to version control or included in documentation. Only variable names and their structural requirements are listed below.

### Server Runtime Variables (Configured in Render Dashboard)
| Variable Name | Required in Prod? | Purpose & Constraints |
|---|---|---|
| `DATABASE_URL` | **Yes** | Neon PostgreSQL connection string. Must include `sslmode=require` and point to the pooled endpoint (`-pooler`). |
| `JWT_SECRET` | **Yes** | Cryptographic key used to sign and verify session JWTs. Must be $\ge 32$ characters long; fails fast if missing or equal to dev fallback. |
| `NODE_ENV` | **Yes** | Set to `"production"`. Enables cookie security flags (`secure: true`), strict CORS checks, and disables stack trace leaks. |
| `CLIENT_URL` / `FRONTEND_URL` | **Yes** | The canonical public URL of the deployed frontend (e.g. `https://www.sync-space.me`). Used for CORS allowlists and email links. |
| `RESEND_API_KEY` | **Yes** | API key from Resend used to deliver transactional password-reset emails. |
| `PASSWORD_RESET_FROM_EMAIL` | **Yes** | Sender email address (e.g. `SyncSpace <noreply@sync-space.me>`). Must use a verified domain in Resend. |
| `OAUTH_GOOGLE_CLIENT_ID` | Optional | Google Cloud OAuth Client ID for Google login. |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Optional | Google Cloud OAuth Client Secret. |
| `OAUTH_GITHUB_CLIENT_ID` | Optional | GitHub OAuth App Client ID. |
| `OAUTH_GITHUB_CLIENT_SECRET`| Optional | GitHub OAuth App Client Secret. |
| `OAUTH_STATE_SECRET` | Optional | Optional custom secret for signing OAuth PKCE state cookies (defaults to `JWT_SECRET`). |

### Frontend Build-Time Variables (Vite)
| Variable Name | Build-Time Only? | Purpose & Constraints |
|---|---|---|
| `VITE_WS_URL` | **Yes** | Points the frontend WebSocket provider to the backend relay: `wss://www.sync-space.me`. Baked into client JS bundles during `npm run build`. |

---

## 3. The 3-Tier Single-Page Application (SPA) Deep Routing Solution

### The Problem:
Single-Page Applications utilize client-side routing (React Router). When a user visits the homepage (`https://www.sync-space.me`) and clicks into a workspace, React Router pushes `/workspace/123` to the address bar without making a full HTTP request.
However, if the user **bookmarks the link or refreshes the page** (or clicks a reset-password email link), the browser sends an HTTP GET request directly to the hosting provider:
`GET /workspace/123 HTTP/1.1`

If the hosting provider looks for a physical file named `/workspace/123/index.html` and doesn't find it, it returns **404 Not Found**.

### SyncSpace's 3-Tier Defense:

#### Tier 1: `public/_redirects` (Render Static Site Rule)
```text
/*    /index.html   200
```
During `npm run build`, Vite copies `public/_redirects` directly into `dist/_redirects`. If deployed as a Render Static Site, Render's edge CDN rewrites all routes to `/index.html` with HTTP 200.

#### Tier 2: `render.yaml` (Infrastructure-as-Code Blueprint)
```yaml
services:
  - type: web
    name: syncspace
    env: node
    buildCommand: npm run build
    startCommand: npm run start
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

#### Tier 3: Express SPA Fallback Middleware ([`server/lib/config/spa.ts`](file:///d:/SyncSpace/server/lib/config/spa.ts))
When deployed as a unified Node.js service:
```typescript
export function createSpaFallbackMiddleware(distPath: string) {
  const indexPath = resolve(distPath, 'index.html');
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only intercept non-API GET requests
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  };
}
```
**Why this is elegant:** API requests (`/api/auth`, `/api/documents`) flow through unaffected. Real static assets (`/assets/*.js`) are served by `express.static`. Only client-side deep routes are rewritten to `index.html`.

---

## 4. Custom Domain & Canonical Apex Redirection

SyncSpace is mapped to custom domain `sync-space.me` with its canonical production host at `www.sync-space.me`.

### Apex Domain Redirect Middleware:
```typescript
export function apexDomainRedirect(req: Request, res: Response, next: NextFunction): void {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host === 'sync-space.me') {
    const canonical = `https://www.sync-space.me${req.originalUrl}`;
    res.redirect(301, canonical);
    return;
  }
  next();
}
```
**Benefits:**
- Eliminates duplicate content penalties for SEO.
- Guarantees SSL certificate consistency across DNS records.
- Preserves URL query parameters and hashes during redirection.

---

## 5. Production Build & Deployment Pipeline

The production deployment sequence runs in two stages:

```bash
# 1. Build Command on Render:
npm run build
# Internally executes: tsc -b && vite build

# 2. Start Command on Render:
npm run start
# Internally executes: prisma generate && tsx server/index.ts
```

### What Happens Step-by-Step During Build:
1. `tsc -b`: Typechecks both client and server codebases. If a TypeScript type error exists, the build halts immediately, preventing broken code from deploying.
2. `vite build`: Transforms, tree-shakes, and minifies React components into optimized production assets inside `dist/`.
3. Copies `public/_redirects` into `dist/_redirects`.
4. `prisma generate`: Synchronizes the generated Prisma Client with the PostgreSQL schema.
5. `tsx server/index.ts`: Boots the unified HTTP/WebSocket server.

