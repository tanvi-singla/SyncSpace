# 11. 100+ Project-Specific Interview Questions & Answers

This document provides over 100 project-specific technical interview questions and answers directly grounded in the SyncSpace codebase. Questions are categorized by domain and progressive difficulty levels (Beginner, Intermediate, Advanced).

---

## 📑 Question Category Index

1. [React & Frontend Architecture (Q1 – Q20)](#category-1-react--frontend-architecture)
2. [Node.js & Express Architecture (Q21 – Q40)](#category-2-nodejs--express-architecture)
3. [Database, Prisma & Data Modeling (Q41 – Q60)](#category-3-database-prisma--data-modeling)
4. [Authentication, Security & Cryptography (Q61 – Q80)](#category-4-authentication-security--cryptography)
5. [Real-Time Systems, Yjs & WebSockets (Q81 – Q105)](#category-5-real-time-systems-yjs--websockets)

---

## Category 1: React & Frontend Architecture

### Q1: What is the root component structure of SyncSpace?
**Answer:** The React application mounts at `main.tsx` into `#root`. `App.tsx` renders `AppRouter` (`src/router/index.tsx`), which wraps the entire component tree in three nested context providers: `AuthProvider` $\rightarrow$ `WorkspaceProvider` $\rightarrow$ `DocumentUIProvider`, followed by `RouterProvider`.

### Q2: Why are `AuthProvider` and `WorkspaceProvider` placed outside `RouterProvider`?
**Answer:** Placing providers above `RouterProvider` guarantees that global authentication state and workspace data are accessible to route loader guards, navigation event listeners, and top-level layout components without being re-mounted when URL paths transition.

### Q3: How does `ProtectedRoute` handle initial page load without flickering to `/login`?
**Answer:** `ProtectedRoute` checks two states from `useAuth`: `isAuthenticated` and `isLoading`. While the initial session rehydration request (`GET /api/auth/me`) is executing, `isLoading` is `true`, causing `ProtectedRoute` to render a centered spinner. It only navigates to `/login` if `isLoading === false && !isAuthenticated`.

### Q4: How is React Router v7 configured in SyncSpace?
**Answer:** It uses `createBrowserRouter` with nested route definitions. Public routes (`/login`, `/register`, `/forgot-password`, `/reset-password`) are siblings to the root `/` protected route, which wraps `MainLayout` and its nested child pages (`/dashboard`, `/workspace/:id`, `/settings`).

### Q5: What is the purpose of `MainLayout.tsx`?
**Answer:** `MainLayout` renders the persistent desktop layout frame: the fixed `Sidebar` on the left and an `<Outlet />` on the right for dynamic page content. This prevents the sidebar from re-rendering when navigating between dashboard and workspace pages.

### Q6: How does the application switch between the Text Editor and Canvas Board?
**Answer:** In `src/pages/Workspace.tsx`, the component reads the route parameter `:id`, finds the document in `workspaceState.documents`, and inspects `doc.type`. If `doc.type === 'doc'`, it renders `<Editor />`; if `doc.type === 'canvas'`, it renders `<CanvasBoard />`.

### Q7: What happens if a user navigates directly to a `/workspace/:id` URL that isn't in local state?
**Answer:** In `Workspace.tsx`, a `useEffect` detects that `id` is present but `doc` is undefined. It sets `isFetchingDirect = true` and invokes `workspaceState.loadDocument(id)`, which calls `GET /api/documents/:id`. If the document exists and the user has permission, it populates state; if 403 or 404, it renders a polished "Document Unavailable" screen.

### Q8: How does `WorkspaceContext` implement optimistic UI updates?
**Answer:** For actions like renaming a document (`updateDocumentTitle`) or toggling favorites (`toggleFavorite`), `WorkspaceContext` immediately updates React state via `setDocuments` before making the network call. It stores the previous state in a closure variable. If `updateDocumentApi()` fails, the `catch` block reverts the document back to its previous state.

### Q9: Why does `useDocumentYjs` maintain an active `ydocRef` using `useRef`?
**Answer:** The `Y.Doc` instance must remain stable across component re-renders. Storing it in `useRef` ensures that re-renders triggered by state changes (like typing or cursor movement) do not destroy or re-instantiate the CRDT document or its WebSocket provider.

### Q10: How does `useDocumentYjs` prevent race conditions when initializing default blocks in an empty document?
**Answer:** If `blocksArray.length === 0`, the hook checks `wsProvider.wsconnected`. If the WebSocket is still connecting, it waits until the initial `sync` event fires before creating a default paragraph block. This prevents an empty client from overwriting pre-existing remote server content.

### Q11: How are slash commands (`/`) implemented in the document editor?
**Answer:** In `src/pages/DocumentWorkspace.tsx`, `handleBlockKeyDown` listens for `e.key === '/'`. When detected, it opens `<SlashCommandMenu />` at the current block position. Selecting an item (e.g. Heading 1) calls `handleUpdateBlock(blockId, '', { type: 'heading1' })` and focuses the block via `requestAnimationFrame`.

### Q12: How is the global search modal triggered and managed?
**Answer:** `Sidebar.tsx` mounts a global `keydown` listener for `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'`. It prevents default browser behavior and toggles `isSearchOpen = true`, mounting `<SearchModal />`.

### Q13: Why is query debouncing used in `SearchModal.tsx`?
**Answer:** It uses a 150ms `setTimeout` debounce on user keystrokes. Filtering hundreds of documents and executing regex highlighting on every single keystroke would degrade typing responsiveness on lower-end devices.

### Q14: How does `SearchModal` safely highlight search matches in text?
**Answer:** `HighlightedText` escapes regex special characters using `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`, splits the text by matching tokens, and maps matches into `<mark>` elements, avoiding dangerous `dangerouslySetInnerHTML` injections.

### Q15: How does `useCanvasEngine` handle infinite canvas panning and zooming?
**Answer:** It maintains a `viewport` state `{ x: number, y: number, zoom: number }`. Wheel events update `zoom` clamped between 0.1 and 3.0. Middle-mouse drag or spacebar drag updates `x` and `y`. Elements are rendered inside a CSS-transformed container: `transform: translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`.

### Q16: How does the canvas engine calculate shape anchor points for connectors?
**Answer:** `src/utils/canvasGeometry.ts` computes the four cardinal perimeter points (`top`, `bottom`, `left`, `right`) of the target shape and calculates the Euclidean distance ($\sqrt{\Delta x^2 + \Delta y^2}$) from the line's endpoint to each anchor, snapping to the closest one.

### Q17: How is Undo/Redo implemented in the whiteboard canvas?
**Answer:** `useCanvasEngine` maintains `undoStack` and `redoStack` arrays storing serialized snapshots of `CanvasElement[]`. Before any mutation, `pushHistorySnapshot` pushes the current state to `undoStack` (capped at 30 items) and clears `redoStack`. Pressing `Ctrl+Z` pops from `undoStack` and restores the elements.

### Q18: What is the role of `DocumentUIContext`?
**Answer:** It decouples visual preferences (font size, font family, full-width mode, drawer visibility) from document data. Preferences are stored in `localStorage` under `syncspace_doc_theme` so a user's ergonomic settings persist across all documents.

### Q19: How are checklist items toggled in the document editor?
**Answer:** `toggleChecklist(id)` finds the block in the `Y.Array`. If it is a `Y.Map`, it calls `current.set('checked', !current.get('checked'))` inside `doc.transact()`. The change is immediately broadcast to all peers and persisted to IndexedDB.

### Q20: How does SyncSpace handle responsive design?
**Answer:** Tailwind CSS breakpoints (`sm:`, `md:`, `lg:`, `xl:`) are used throughout. The sidebar collapses into mobile overlay drawers on narrow viewports, and canvas toolbars reposition to maintain touch accessibility.

---

## Category 2: Node.js & Express Architecture

### Q21: What version of Express does SyncSpace use and what are its key features?
**Answer:** Express `^5.2.1`. It features native promise support (unhandled promise rejections in route handlers automatically route to error middleware), upgraded `path-to-regexp` v8 routing, and enhanced query parser security.

### Q22: How does the server run HTTP and WebSockets on the same port?
**Answer:** It initializes `const httpServer = http.createServer(app)`. It mounts Express routes on `app` for standard HTTP requests and attaches a listener to `httpServer.on('upgrade', ...)` to handle WebSocket handshake requests.

### Q23: What happens during the HTTP `upgrade` event in `server/index.ts`?
**Answer:** When an HTTP upgrade request arrives, the server checks the `Origin` header against CORS rules, extracts the room name, authenticates the JWT and verifies document permissions in PostgreSQL, and if valid, calls `wss.handleUpgrade()` to complete the handshake.

### Q24: What is the purpose of `apexDomainRedirect` in `server/lib/config/spa.ts`?
**Answer:** It inspects `req.headers.host`. If the request arrives at apex domain `sync-space.me`, it issues an immediate HTTP 301 Permanent Redirect to `https://www.sync-space.me${req.originalUrl}`, preserving path and query strings.

### Q25: Why use an HTTP 301 redirect instead of 302 for domain canonicalization?
**Answer:** HTTP 301 indicates "Moved Permanently". Browsers and search engines cache this redirect indefinitely, reducing server load and consolidating search engine domain ranking to the canonical `www` domain.

### Q26: How does Express serve the Single-Page Application (SPA) in production?
**Answer:** If the `dist/` directory exists, `server/index.ts` mounts `express.static(distPath)` followed by `createSpaFallbackMiddleware`. The fallback middleware intercepts non-API `GET` requests and sends `dist/index.html`.

### Q27: Why must `createSpaFallbackMiddleware` check `!req.path.startsWith('/api')`?
**Answer:** If an invalid or unauthenticated API request arrives (e.g. `GET /api/documents/nonexistent`), the server must return JSON `{ error: 'Document not found' }` with status 404, rather than mistakenly returning the HTML of `index.html`.

### Q28: How does SyncSpace parse cookies on the backend?
**Answer:** Using `cookieParser()` middleware. It parses the incoming `Cookie` header into an object on `req.cookies`, allowing route handlers and middlewares to read `req.cookies.auth_token`.

### Q29: How does `requireAuth` middleware authenticate requests?
**Answer:** In `server/middleware/auth.ts`, it extracts the token from `req.cookies.auth_token` or `req.headers.authorization`. It verifies the JWT signature, queries the database to compare `user.authVersion === payload.authVersion`, and attaches `req.user = payload`.

### Q30: What is the purpose of `server/lib/config/env.ts`?
**Answer:** It loads `.env` files in Node.js using native `process.loadEnvFile()`. It includes guards to avoid loading developer `.env` files in test environments, allowing Vitest to mock environment variables cleanly.

### Q31: How does the server handle unhandled runtime errors?
**Answer:** A global error-handling middleware `(err, req, res, next) => { ... }` is mounted as the final middleware in `server/index.ts`. It logs the error to `console.error` and returns a sanitized `500 Internal Server Error` JSON response.

### Q32: What is the difference between `server:dev` and `start` scripts in `package.json`?
**Answer:** `server:dev` uses `tsx watch server/index.ts` for live hot-reloading on file changes. `start` runs `prisma generate && tsx server/index.ts` to ensure Prisma types are compiled before launching the production server.

### Q33: How does SyncSpace implement CORS in development vs. production?
**Answer:** In development, `server/lib/config/cors.ts` allows `localhost` and RFC 1918 private LAN IP addresses (`192.168.x.x`, `10.x.x.x`) to enable multi-device testing. In production, LAN IPs are strictly rejected and only explicitly configured domains (`CLIENT_URL`, `FRONTEND_URL`, `sync-space.me`) are accepted.

### Q34: Why does CORS configuration use a dynamic origin callback function?
**Answer:** Express `cors({ origin: (origin, callback) => ... })` allows evaluating incoming origins dynamically at runtime rather than fixing a static string. It also allows requests with no `Origin` header (like health checks from Render or curl).

### Q35: Why is `credentials: true` mandatory in the CORS options?
**Answer:** The frontend and backend exchange authentication via `httpOnly` session cookies. Browsers block scripts from reading responses or sending cookies cross-origin unless the server explicitly responds with `Access-Control-Allow-Credentials: true`.

### Q36: How does the server prevent Cross-Site WebSocket Hijacking (CSWSH)?
**Answer:** During the HTTP `upgrade` event, `verifyWebSocketOrigin(req)` inspects `req.headers.origin`. If the origin is not on the trusted allowlist, the server writes `403 Forbidden` and terminates the TCP socket with `socket.destroy()` before completing the handshake.

### Q37: How does `server/routes/documents.ts` enforce permissions on `PUT /api/documents/:id`?
**Answer:** It checks document ownership. If the user is the owner, they can update title, favorite, and soft-delete flags. If the user is an `EDITOR`, they can only update `title`. If an editor attempts to update `isDeleted`, it rejects with `403 Forbidden`. If the user is a `VIEWER`, all modifications return 403.

### Q38: How does the document share endpoint prevent duplicate sharing?
**Answer:** In `POST /api/documents/:documentId/share`, it queries `prisma.documentShare.findUnique({ where: { documentId_userId: { documentId, userId: recipient.id } } })`. If a share record exists, it rejects with `409 Conflict`.

### Q39: Can a user share a document with themselves?
**Answer:** No. In `server/routes/documents.ts`, the route handler checks `if (recipient.id === userId) return res.status(400).json({ error: 'Cannot share document with yourself' })`.

### Q40: What happens when a document is permanently deleted?
**Answer:** In `DELETE /api/documents/:id`, the server verifies `existing.userId === userId` (owner only). It calls `prisma.document.delete({ where: { id } })`. Foreign key cascade constraints in PostgreSQL automatically delete all associated `DocumentShare` records.

---

## Category 3: Database, Prisma & Data Modeling

### Q41: What database engine is used in SyncSpace?
**Answer:** PostgreSQL (v16+) hosted on Neon serverless database infrastructure.

### Q42: What is the purpose of connection pooling in Neon?
**Answer:** Neon provides PgBouncer connection pooling (`-pooler` connection string). It multiplexes incoming stateless queries over a pool of persistent database connections, preventing connection exhaustion under heavy concurrent user load.

### Q43: How does Prisma prevent connection pool leakage in development?
**Answer:** In `server/lib/db/client.ts`, `prisma` is attached to `global.prisma`. During hot reloads in development, existing client instances are reused rather than instantiating new pools on every file execution.

### Q44: What are the 5 core models in `prisma/schema.prisma`?
**Answer:** `User`, `Document`, `DocumentShare`, `ProviderAccount`, and `PasswordResetToken`.

### Q45: What is the relationship between `User` and `Document`?
**Answer:** A one-to-many relationship: One `User` can own zero or more `Document` records. In Prisma, this is modeled with `userId String` and `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.

### Q46: What does `onDelete: Cascade` do when a User is deleted?
**Answer:** PostgreSQL automatically deletes all documents, document shares, password reset tokens, and OAuth provider accounts belonging to that user at the database engine level, preventing orphaned records.

### Q47: Why is `passwordHash` nullable in the `User` model?
**Answer:** Users who register via Google or GitHub OAuth do not have passwords. Making `passwordHash` nullable allows OAuth accounts to exist cleanly without dummy passwords.

### Q48: What indexes are defined on the `Document` model and why?
**Answer:** 
- `@@index([userId])`: Optimizes lookups for documents owned by a user.
- `@@index([userId, isDeleted])`: Composite index specifically optimizing the dashboard query filtering active documents (`WHERE user_id = $1 AND is_deleted = false`).

### Q49: What composite unique constraint exists on `DocumentShare`?
**Answer:** `@@unique([documentId, userId])`. It guarantees that a document can have at most one permission record per collaborator, preventing duplicate entries.

### Q50: What composite unique constraint exists on `ProviderAccount`?
**Answer:** `@@unique([provider, providerAccountId])`. It ensures that a specific external identity (e.g. GitHub user `883719`) can only be linked to a single SyncSpace account.

### Q51: How does `PasswordResetToken` index token hashes?
**Answer:** It defines `@@index([tokenHash])`. Because the token hash is a deterministic SHA-256 string, lookups during reset password validation execute via $O(1)$ index scans rather than full table scans.

### Q52: What is an interactive transaction in Prisma?
**Answer:** Executed via `prisma.$transaction(async (tx) => { ... })`. It wraps multiple database operations inside a single PostgreSQL `BEGIN ... COMMIT` block. If any query inside fails, all modifications roll back.

### Q53: Where are Prisma transactions used in SyncSpace?
**Answer:**
1. In `server/lib/auth/oauth.ts`: Atomically creates the `User` and `ProviderAccount` records.
2. In `server/routes/auth.ts`: Atomically claims the password reset token, updates password hash, increments `authVersion`, and purges redundant reset tokens.

### Q54: What is optimistic concurrency / conditional write in password reset?
**Answer:** `tx.passwordResetToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })`. Only the first concurrent request matching `usedAt === null` updates a row (`count === 1`). Subsequent parallel requests find 0 matching rows (`count === 0`) and abort.

### Q55: How are soft deletes implemented in the database?
**Answer:** The `Document` model contains `isDeleted Boolean @default(false)` and `deletedAt DateTime?`. When moved to trash, `isDeleted = true` and `deletedAt = new Date()`. Soft-deleted documents can be restored or permanently purged.

### Q56: How does SyncSpace fetch shared documents efficiently?
**Answer:** In `server/routes/documents.ts` (`GET /shared-with-me`), it queries `prisma.documentShare.findMany` where `userId = callerId` and `document: { isDeleted: false }`, including the document and owner profile in a single SQL `JOIN`.

### Q57: How do Prisma migrations work in development?
**Answer:** Developers run `npx prisma migrate dev --name <migration_name>`. Prisma calculates the diff between `schema.prisma` and the database, writes a timestamped SQL file in `prisma/migrations/`, executes the SQL, and regenerates the Prisma client.

### Q58: What is the purpose of `prisma generate` in deployment scripts?
**Answer:** Cloud platforms like Render don't commit `node_modules`. Running `prisma generate` compiles the custom TypeScript type definitions and binary query engine for `@prisma/client` to match the target OS.

### Q59: Why are UUIDs used for primary keys instead of auto-incrementing integers?
**Answer:** UUIDs (`@default(uuid())`) are non-sequential and cryptographically random. This prevents ID enumeration attacks (where an attacker guesses `/api/documents/1`, `/api/documents/2`) and allows safe ID generation across distributed environments.

### Q60: How does Prisma handle PostgreSQL enums?
**Answer:** Defined in `schema.prisma` as `enum DocumentPermission { VIEWER EDITOR }`. Prisma maps this to a native PostgreSQL `CREATE TYPE "DocumentPermission" AS ENUM ('VIEWER', 'EDITOR')`.

---

## Category 4: Authentication, Security & Cryptography

### Q61: What authentication scheme does SyncSpace use?
**Answer:** Stateless JSON Web Tokens (JWT) signed with HMAC-SHA256 and stored in secure, `httpOnly`, `sameSite: 'lax'` browser cookies.

### Q62: Why are JWTs stored in `httpOnly` cookies instead of `localStorage`?
**Answer:** `localStorage` is accessible to any JavaScript running in the browser. In the event of a Cross-Site Scripting (XSS) vulnerability or compromised third-party script, tokens in `localStorage` can be stolen. `httpOnly` cookies cannot be accessed by client JavaScript.

### Q63: What claims are stored inside the SyncSpace JWT?
**Answer:** `{ userId: string, email: string, authVersion: number, exp: number }`.

### Q64: What is the expiration period of SyncSpace JWTs?
**Answer:** 7 days (`expiresIn: '7d'`).

### Q65: What is `authVersion` and what security problem does it solve?
**Answer:** Standard JWTs cannot be revoked until they expire. `authVersion` is an integer stored in the database and embedded in the token. If a password is changed or session revoked, the database counter increments. Any token presented with an older `authVersion` is immediately rejected.

### Q66: What password hashing algorithm is used in SyncSpace?
**Answer:** `bcryptjs` with 12 salt rounds (minimum 10 enforced in `server/lib/auth/password.ts`).

### Q67: Why is bcrypt superior to SHA-256 for password storage?
**Answer:** SHA-256 is designed for fast computation, allowing attackers to test billions of guesses per second with GPUs. Bcrypt is intentionally slow and memory-hard. At 12 rounds, each hash takes ~300ms, making brute-force attacks computationally impractical.

### Q68: How are password reset tokens generated?
**Answer:** In `server/lib/auth/tokens.ts`, using `crypto.randomBytes(32).toString('hex')`. This produces a 256-bit cryptographically secure pseudorandom token.

### Q69: Why is the raw password reset token never stored in the database?
**Answer:** If the database were compromised, plaintext tokens could be used to take over accounts. SyncSpace computes a deterministic SHA-256 hash of the token (`hashResetToken`) and stores only the hash in the database.

### Q70: Why are password reset tokens passed in the URL hash (`#token=...`) instead of query parameters?
**Answer:** Per RFC specifications, browsers **never send URL fragments/hashes to web servers** in HTTP requests, and they are excluded from HTTP `Referer` headers. This guarantees the raw reset token is never logged in proxy access logs or CDN caches.

### Q71: How does SyncSpace prevent user enumeration in `POST /api/auth/forgot-password`?
**Answer:** Regardless of whether the email exists in the database, the API always returns HTTP 200 with the exact same message: `"If an account exists for this email, a password reset link has been sent."` Furthermore, email dispatch occurs in a detached background promise so execution timing does not reveal user existence.

### Q72: How does SyncSpace prevent timing attacks when comparing cryptographic signatures?
**Answer:** Using `crypto.timingSafeEqual(bufA, bufB)`. Standard string comparison (`===`) exits early on the first mismatched character, allowing attackers to measure microscopic timing variations to deduce valid signatures. `timingSafeEqual` takes constant time regardless of where differences occur.

### Q73: What is PKCE in OAuth 2.0 and why does SyncSpace use it?
**Answer:** Proof Key for Code Exchange. It generates a cryptographic random string (`verifier`) and its SHA-256 hash (`code_challenge`). Even if an authorization code is intercepted in transit, it cannot be exchanged for tokens without the original verifier.

### Q74: How does SyncSpace protect the OAuth transaction state?
**Answer:** The transaction state (provider, state, verifier, returnPath) is serialized, signed with an HMAC-SHA256 signature, and stored in a short-lived (10-minute) `httpOnly` cookie `oauth_transaction`.

### Q75: What is SyncSpace's policy on OAuth account linking?
**Answer:** SyncSpace **never automatically links accounts by matching email**. If an OAuth callback arrives with an email that already exists as a password user, it rejects the login with `account_exists`. This prevents account takeover attacks via unverified OAuth accounts.

### Q76: How does SyncSpace defend against open redirect attacks in OAuth?
**Answer:** `safeOAuthReturnPath` validates the return URL. If it contains protocol schemes, backslashes, double slashes (`//`), or resolves to an external origin, it forcibly defaults to `/dashboard`.

### Q77: What happens in `server/lib/yjs/sessionConnections.ts` when a user resets their password?
**Answer:** `revokeUserConnections(userId)` iterates through all active WebSocket connections belonging to that user and invokes `ws.close(4401, 'Session revoked')`, terminating collaborative sessions immediately.

### Q78: Why are CORS credentials incompatible with wildcard (`*`) origins?
**Answer:** The W3C CORS specification forbids `Access-Control-Allow-Origin: *` when `Access-Control-Allow-Credentials: true` is set. Browsers reject the response to prevent malicious sites from extracting authenticated session cookies.

### Q79: What is the minimum length enforced for `JWT_SECRET` in production?
**Answer:** 32 characters (`MIN_JWT_SECRET_LENGTH = 32`).

### Q80: How does `SessionStorage` improve the password reset user experience?
**Answer:** On initial mount, `ResetPassword.tsx` caches the token from the URL hash into `sessionStorage`. If the user refreshes the page (`F5`), the token is recovered from `sessionStorage` rather than showing an "Invalid Link" error.

---

## Category 5: Real-Time Systems, Yjs & WebSockets

### Q81: What is Yjs?
**Answer:** A high-performance, modular CRDT library for JavaScript that models shared data types (`Y.Array`, `Y.Map`, `Y.Text`) and handles binary synchronization across distributed peers.

### Q82: What is the difference between a State Vector and an Update in Yjs?
**Answer:** A **State Vector** is a lightweight summary of which operations a client has seen from every other client (e.g. `{ client1: 10, client2: 5 }`). An **Update** is the binary payload containing the actual missing operations and content.

### Q83: How does SyncSpace structure collaborative document data in Yjs?
**Answer:** It uses a root `Y.Array<Y.Map<any>>('blocks')`. Each block in the document is a `Y.Map` containing properties: `id`, `type`, `content`, and `checked`.

### Q84: Why is each block represented as a `Y.Map` instead of a plain JavaScript object?
**Answer:** If blocks were plain objects inside `Y.Array`, modifying a block's text would require replacing the entire object. A `Y.Map` allows granular property-level CRDT updates (`map.set('content', newText)`), preserving block identity and remote user cursor selections.

### Q85: What is the purpose of `doc.transact(fn)` in Yjs?
**Answer:** It groups multiple mutations into a single atomic transaction. It produces exactly one update event for local observers and emits one binary update message across the WebSocket, preventing flickering intermediate states.

### Q86: What is `WSSharedDoc` in `server/yjsServer.ts`?
**Answer:** A custom server-side class extending `Y.Doc`. It maintains an in-memory map of active WebSocket connections (`conns`) and an `Awareness` instance, relaying updates between room participants.

### Q87: How does `yjsServer.ts` handle heartbeat ping/pongs?
**Answer:** It sets a 30-second interval (`setInterval`). It pings each active socket. If a client fails to reply with a `pong` within the interval, `closeConn()` terminates the dead socket and purges its awareness state.

### Q88: How does the server enforce read-only permissions for `VIEWER` roles on WebSockets?
**Answer:** When decoding incoming binary messages, if `isViewer` is true and the message is anything other than `SyncStep1`, the server drops the message and returns `authProtocol.writePermissionDenied`. Viewers cannot apply updates to `WSSharedDoc`.

### Q89: What is the Yjs Awareness protocol?
**Answer:** A protocol (`y-protocols/awareness`) for managing ephemeral, transient peer state (such as cursor coordinates, user names, selection highlights) that does not need to be saved into persistent document history.

### Q90: Why are awareness updates throttled to 40ms in `useDocumentYjs`?
**Answer:** High-frequency mouse movements emit hundreds of events per second. Throttling to 40ms limits React re-renders to ~25 frames per second, keeping animations smooth without freezing the browser thread.

### Q91: How does `y-indexeddb` enable offline collaboration in SyncSpace?
**Answer:** `new IndexeddbPersistence(docName, doc)` creates a local IndexedDB replica. Every local or remote edit is written to IndexedDB. On page load, cached blocks load instantly (0ms latency), and offline edits synchronize once the WebSocket reconnects.

### Q92: What happens if two users edit the same paragraph block offline and reconnect simultaneously?
**Answer:** Yjs merges the edits using Lamport clocks and client IDs. Both edits are preserved without data loss. If changes occurred at different character positions, they interleave seamlessly; if at the same position, Yjs uses deterministic client ID ordering to break ties identically on all peers.

### Q93: How does SyncSpace partition Yjs rooms?
**Answer:** Using deterministic room prefixes: `syncspace:doc:<id>` for text documents, `syncspace:canvas:<id>` for whiteboards, and `workspace-directory` for global workspace presence.

### Q94: Why does `parseRoomName` support legacy prefixes?
**Answer:** In `src/lib/yjs/rooms.ts`, `parseRoomName` supports legacy formats like `paper-craft-` and `syncspace-document-` to ensure backward compatibility with older document links created in earlier prototypes.

### Q95: What is the difference between `observe` and `observeDeep` in Yjs?
**Answer:** `observe` only fires when items are added or removed from the top-level collection. `observeDeep` listens recursively to mutations inside nested CRDT structures (such as property updates inside a `Y.Map` nested within a `Y.Array`).

### Q96: How does SyncSpace handle WebSocket disconnection gracefully?
**Answer:** When the WebSocket disconnects, `useDocumentYjs` transitions `connectionStatus` to `'disconnected'`. The user continues editing in IndexedDB-backed offline mode. `y-websocket` automatically attempts exponential backoff reconnection.

### Q97: What is `getWsUrl()` in `src/lib/yjs/config.ts`?
**Answer:** A dynamic resolver that determines the WebSocket URL. It checks `VITE_WS_URL` first; if unset on a local LAN, it dynamically infers `ws://${window.location.hostname}:5000`, enabling multi-device testing over Wi-Fi without hardcoding IP addresses.

### Q98: What would happen if a client connected to Yjs without an auth token?
**Answer:** `authorizeYjsConnection` in `server/lib/yjs/auth.ts` inspects cookies and query parameters. If no valid token is found, it returns `{ authorized: false, status: 401 }`. The upgrade handler writes `HTTP/1.1 401 Unauthorized` and destroys the TCP socket.

### Q99: What are the current persistence limitations of SyncSpace's Yjs server?
**Answer:** Yjs documents are currently held in-memory on the Node.js server (`docs = new Map<string, WSSharedDoc>()`). While state persists across users' local IndexedDB caches, restarting the server clears the relay memory.

### Q100: How would you scale SyncSpace's WebSocket infrastructure to multiple server instances?
**Answer:** By implementing a Redis Pub/Sub backplane using `y-redis`. When a client on Server A sends an update, Server A publishes the binary delta to Redis, which broadcasts it to Server B and Server C, ensuring all connected clients stay synchronized regardless of which backend node they connect to.

### Q101: How does SyncSpace prevent memory leaks in `WSSharedDoc`?
**Answer:** In `server/yjsServer.ts`, `WSSharedDoc` initializes with `{ gc: true }` (Garbage Collection enabled). Deleted items are replaced with lightweight tombstone markers, and redundant history is compacted.

### Q102: How does `closeConn()` clean up user awareness on disconnection?
**Answer:** When a socket closes, `closeConn` retrieves all `controlledIds` associated with that connection and invokes `awarenessProtocol.removeAwarenessStates()`, instantly removing the disconnected user's cursor from other collaborators' screens.

### Q103: What happens when an authorized user is demoted from `EDITOR` to `VIEWER` while editing?
**Answer:** On the next incoming binary message, the server's message handler identifies their permission as `VIEWER`, rejects the update, and replies with `permissionDenied`. The client UI transitions to read-only mode.

### Q104: Why does SyncSpace use binary WebSockets rather than Server-Sent Events (SSE) or long-polling?
**Answer:** SSE is unidirectional (server-to-client only), requiring separate HTTP POST requests for every client keystroke. WebSockets provide full-duplex, low-overhead binary TCP communication, essential for 60fps live cursor tracking and bi-directional CRDT delta exchange.

### Q105: How does SyncSpace guarantee that vector shapes in the canvas stay synchronized?
**Answer:** Shapes are stored in a root `Y.Map<CanvasElement>('elements')`. Adding, dragging, or resizing a shape invokes `elementsMap.set(shape.id, shape)` inside an atomic transaction. Yjs broadcasts the binary delta, and remote clients update their local canvas elements state in real time.

