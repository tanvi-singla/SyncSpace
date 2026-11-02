# 🌾 PaperCraft Studio — Local-First CRDT Collaborative Canvas

An artisanal, local-first collaborative canvas and workspace built with **React**, **TypeScript**, **Tailwind CSS**, **Yjs CRDT**, **y-indexeddb**, and **y-websocket**.

Designed with the tactile atmosphere of a creative printmaking workshop: unbleached craft parchment, risograph inks, washi tape, stamps, and vintage fountain pen multiplayer presence.

---

## ✨ Features

- **🏛️ 100% Local-First & Offline Ready:** Backed by `y-indexeddb` with zero data loss, instant optimistic writes, and seamless recovery upon page reload.
- **⚡ Real-Time CRDT Sync:** Backed by `Y.Doc` and `y-websocket` (pointing to `ws://localhost:1234`) with graceful fallback to local cache when offline.
- **📜 Tactile Paper Craft Aesthetic:**
  - Unbleached parchment background with organic dot grid and grain overlay.
  - Paper cards with subtle irregular rotations and physical tactile drop shadows.
  - Multi-hue washi tape strips, staples, and brass paperclips.
  - Bold Risograph ink palettes (Sunflower, Coral, Sage Olive, French Blue, Lavender, Kraft).
  - Rubber stamp seals (*APPROVED*, *DRAFT*, *URGENT*, *IDEA*, *COMPLETED*).
  - Kraft cutout shapes (Polaroids, circular badges, section banners, luggage tags).
- **✒️ Multiplayer Presence (Awareness):**
  - Vintage fountain pen cursors with colored ink tips and hand-stamped peer tags.
  - Peer avatar badges and customizable artisan nickname / ink color.
- **🗺️ Infinite Canvas & Minimap:**
  - Smooth pan (Space / Middle Mouse / 2-finger scroll) and zoom (10% - 300%).
  - Floating minimap with click-to-navigate viewport.
- **🚪 Room Switcher & Multi-Tab Tester:**
  - Dynamic `roomId` support via URL (`?room=...`).
  - One-click "Test Live Sync (Open New Tab)" button to instantly test peer sync locally.
- **💾 Export to JSON:** Export full studio board state to formatted JSON.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 3. Run the Yjs relay (a separate process)
```bash
npm run yjs
```
It listens on `ws://localhost:1234`. The Express API remains on port 5000.

---

## PostgreSQL configuration

Prisma and the Express backend read their PostgreSQL connection from the
backend-only `DATABASE_URL` environment variable. The database host is not
hardcoded in application code.

### Shared database for two PCs

After you obtain a shared PostgreSQL database, create a private `.env` file on
**each** PC (it is gitignored) using the exact same shared connection string:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Replace the placeholders with the connection details supplied by the database
host. Do not put this value in `VITE_*` variables, frontend code, Git, or a
committed `.env` file. `npm run server` loads this private `.env` for the
Express backend. Apply the existing migrations to a new shared database once:

```bash
npx prisma migrate deploy
```

Run this against the shared database only after checking that `DATABASE_URL`
points to it. It applies the tracked migrations without resetting or deleting
database data. The current migrations already create users, password reset
tokens, and documents; no new migration is needed for a host-only change.

To verify the setup, register on one PC, then sign in with that same account
on the other PC. A document created by that account should appear in its
document list on both PCs. Documents remain owner-managed, and their existing
sharing permissions control access for other registered users. Yjs canvas
content uses its existing WebSocket relay and is outside this PostgreSQL
configuration; a relay at `localhost` is only local to one PC.

### Local Docker fallback

`docker-compose.yml` remains available for private local development and keeps
its existing `postgres_data` volume. To use it, keep Docker running and use a
private `.env` containing a local URL that matches its `POSTGRES_*` values:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=syncspace
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/syncspace?schema=public"
```

Do not run `docker compose down -v` when preserving local data.

## Google and GitHub sign-in (Phase 2B)

OAuth credentials are backend-only. Never add provider secrets to `VITE_*` variables.
Before enabling sign-in, apply the tracked schema migration with
`npx prisma migrate deploy` and regenerate the Prisma client with `npm run prisma:generate`.

### Google developer console

Create an OAuth client ID in Google Cloud Console with application type **Web
application**. Add the server callback as an authorized redirect URI:

```text
http://localhost:5000/api/auth/google/callback
https://YOUR_API_HOST/api/auth/google/callback
```

Use the credentials only in the Express server environment:

```dotenv
OAUTH_GOOGLE_CLIENT_ID=your-google-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret
OAUTH_CALLBACK_BASE_URL=http://localhost:5000
OAUTH_FRONTEND_URL=http://localhost:5173
OAUTH_STATE_SECRET=replace-with-at-least-32-random-characters
```

### GitHub developer settings

Create an OAuth App under GitHub **Settings → Developer settings → OAuth Apps**.
Set its Authorization callback URL to:

```text
http://localhost:5000/api/auth/github/callback
https://YOUR_API_HOST/api/auth/github/callback
```

Set its Homepage URL to the SyncSpace frontend origin, then provide:

```dotenv
OAUTH_GITHUB_CLIENT_ID=your-github-client-id
OAUTH_GITHUB_CLIENT_SECRET=your-github-client-secret
OAUTH_CALLBACK_BASE_URL=http://localhost:5000
OAUTH_FRONTEND_URL=http://localhost:5173
OAUTH_STATE_SECRET=replace-with-at-least-32-random-characters
```

For production, set `OAUTH_CALLBACK_BASE_URL` to the HTTPS origin serving Express
and `OAUTH_FRONTEND_URL` to the HTTPS frontend origin. Register the corresponding
exact callback URI in both provider consoles. If `OAUTH_FRONTEND_URL` is omitted,
the backend falls back to `FRONTEND_URL` or `CLIENT_URL`; callback origin defaults
to `http://localhost:5000` only for local development. If the frontend and API use
different hosts, set `VITE_API_URL` to the API origin so the buttons reach Express.
Set a unique, randomly generated `OAUTH_STATE_SECRET` of at least 32 characters
in production (or ensure the existing `JWT_SECRET` meets that requirement).

OAuth uses authorization code flow with state and PKCE. Google OIDC identity and
verified email are validated by `openid-client`; GitHub identity comes from its
authenticated profile API and email from a verified primary email. The account
linking policy is intentionally explicit: existing accounts with the same email
are not linked automatically; users must authenticate through the existing method.
OAuth-created users have no local password initially and can use the existing
forgot-password flow to set one after email verification. Password login safely
rejects accounts that do not yet have a local password.

### Manual verification

1. Apply the migration, set local OAuth credentials, and start Express, Vite, and
   PostgreSQL.
2. Open `/register` and confirm both provider buttons preserve the existing form.
3. Complete Google and GitHub sign-in; confirm each returns to the app signed in.
4. Cancel provider consent, alter/remove the callback `state`, and retry a stale
   callback; each should return to `/login` with a useful error and no session.
5. Try a provider identity whose email already belongs to a password account;
   confirm the app asks the user to sign in normally and does not link it.
6. Sign out, sign back in with the same provider, and confirm the same local user
   is used. Test forgot-password for the OAuth-created account and set a password.

---

## 👥 Real-Time Peer Sync Testing

### Testing with Multi-Tabs (Default)
1. Start `npm run dev` and open `http://localhost:5173`.
2. Click the Room Switcher in the top left and click **"Test Live Sync (Open New Tab)"** or duplicate the tab.
3. Move notes, type text, or move your mouse — see Yjs CRDT synchronization and fountain pen cursors live!

### Optional: Running a Local Y-Websocket Server
To sync across different devices or separate browser instances:
```bash
npm run yjs
```
This runs a local Yjs WebSocket relay on port `1234`. The app connects automatically to `ws://localhost:1234`!

Each PostgreSQL canvas UUID maps to one isolated Yjs room named
`syncspace:<document-id>`. Canvas elements are held in the Yjs
`canvas-elements` map and mirrored into React for rendering. The same Y.Doc is
persisted in IndexedDB, so local edits survive reloads and merge when the relay
reconnects. The development relay deliberately has no room authorization;
sharing and access control must be added before production use.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `V` | Pointer / Select Tool |
| `Space` or `H` | Pan Canvas |
| `N` | Create Sticky Note |
| `T` | Create Index Card / Text Block |
| `+` / `-` | Zoom In / Out |
| `0` | Reset Zoom to 100% |
| `Del` / `Backspace` | Discard Selected Card |
| `?` | Open Studio Guide |
