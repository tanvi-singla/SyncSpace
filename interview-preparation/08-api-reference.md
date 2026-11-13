# 08. Complete REST API Reference

This document provides an exhaustive, OpenAPI-style specification for every REST endpoint implemented in SyncSpace.

---

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 Health Check Probe
- **Route:** `GET /api/health`
- **Auth:** Public
- **Purpose:** Used by Render deployment health check probes to monitor container health.
- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-07T12:00:00.000Z"
  }
  ```

---

### 1.2 User Registration
- **Route:** `POST /api/auth/register`
- **Auth:** Public
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "email": "alice@example.com",
    "password": "Password123!",
    "name": "Alice Developer",
    "avatarUrl": "https://example.com/avatar.png"
  }
  ```
- **Validation Rules (Zod):**
  - `email`: Valid email format, max 255 chars.
  - `password`: 8–128 chars, at least 1 uppercase letter, 1 number, and 1 special character.
  - `name`: 1–100 chars, non-empty.
  - `avatarUrl`: Valid URL format or empty string (optional).
- **Responses:**
  - **201 Created:** (Sets `auth_token` HttpOnly cookie)
    ```json
    {
      "id": "c7a8b9d0-1234-5678-9abc-def012345678",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "avatarUrl": "https://example.com/avatar.png"
    }
    ```
  - **400 Bad Request:** Validation failure with details array.
  - **409 Conflict:** `{"error": "User already exists with this email"}`
  - **500 Internal Server Error:** `{"error": "Internal server error"}`

---

### 1.3 User Login
- **Route:** `POST /api/auth/login`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "alice@example.com",
    "password": "Password123!"
  }
  ```
- **Responses:**
  - **200 OK:** (Sets `auth_token` HttpOnly cookie)
    ```json
    {
      "id": "c7a8b9d0-1234-5678-9abc-def012345678",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "avatarUrl": "https://example.com/avatar.png"
    }
    ```
  - **400 Bad Request:** Validation failed.
  - **401 Unauthorized:** `{"error": "Invalid email or password"}`

---

### 1.4 User Logout
- **Route:** `POST /api/auth/logout`
- **Auth:** Public / Optional
- **Purpose:** Clears the `auth_token` HttpOnly cookie.
- **Response (200 OK):**
  ```json
  {
    "message": "Logged out successfully"
  }
  ```

---

### 1.5 Get Current User Profile
- **Route:** `GET /api/auth/me`
- **Auth:** Required (`requireAuth` via cookie or Bearer token)
- **Responses:**
  - **200 OK:** Returns `SafeUser` object.
  - **401 Unauthorized:** Missing or expired token, or `authVersion` mismatch.
  - **404 Not Found:** User record deleted from database.

---

### 1.6 WebSocket Connection Token
- **Route:** `GET /api/auth/ws-token`
- **Auth:** Required (`requireAuth`)
- **Purpose:** Mints a freshly signed JWT for WebSocket connection handshakes in multi-computer LAN environments.
- **Response (200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "userId": "c7a8b9d0-1234-5678-9abc-def012345678"
  }
  ```

---

### 1.7 OAuth Initiation (Google / GitHub)
- **Route:** `GET /api/auth/:provider` (`provider` $\in$ `['google', 'github']`)
- **Auth:** Public
- **Query Parameters:**
  - `next`: Optional internal redirect path (e.g. `?next=/workspace/123`). Sanitized to prevent open redirects.
- **Behavior:**
  - Sets signed `oauth_transaction` cookie containing state, PKCE code verifier, and return path.
  - Returns `302 Found` redirect to provider authorization screen.

---

### 1.8 OAuth Callback (Google / GitHub)
- **Route:** `GET /api/auth/:provider/callback`
- **Auth:** Public
- **Query Parameters:** `state`, `code` (or `error`)
- **Behavior:**
  - Verifies signed state cookie.
  - Exchanges authorization code using PKCE verifier.
  - Resolves verified email and profile identity.
  - Creates or finds user record via atomic transaction.
  - Sets `auth_token` cookie and returns `303 See Other` to `returnPath`.

---

### 1.9 Forgot Password Request
- **Route:** `POST /api/auth/forgot-password`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "alice@example.com"
  }
  ```
- **Responses:**
  - **200 OK:** Always returns the same generic message immediately to prevent user enumeration:
    ```json
    {
      "message": "If an account exists for this email, a password reset link has been sent."
    }
    ```
  - **400 Bad Request:** `{"error": "Enter a valid email address."}`

---

### 1.10 Reset Password Execution
- **Route:** `POST /api/auth/reset-password`
- **Auth:** Public (Authenticated via single-use token)
- **Request Body:**
  ```json
  {
    "token": "64_character_hexadecimal_token",
    "password": "NewSecurePassword123!",
    "confirmPassword": "NewSecurePassword123!"
  }
  ```
- **Responses:**
  - **200 OK:** 
    ```json
    {
      "message": "Password has been reset successfully"
    }
    ```
  - **400 Bad Request:** Link invalid, expired (>30m), already used, or passwords mismatch.

---

## 2. Document Management Endpoints (`/api/documents`)

All document endpoints are mounted under `router.use(requireAuth)`.

### 2.1 List Owned Documents
- **Route:** `GET /api/documents`
- **Auth:** Required
- **Purpose:** Returns all documents created by the user (including soft-deleted).
- **Response (200 OK):**
  ```json
  [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "title": "Project Sprint Notes",
      "type": "doc",
      "isFavorite": true,
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-10-01T10:00:00.000Z",
      "updatedAt": "2026-11-01T15:30:00.000Z",
      "userId": "c7a8b9d0-1234-5678-9abc-def012345678",
      "permission": "OWNER"
    }
  ]
  ```

---

### 2.2 List Documents Shared With Me
- **Route:** `GET /api/documents/shared-with-me`
- **Auth:** Required
- **Purpose:** Returns active documents shared with the user by others.
- **Response (200 OK):**
  ```json
  [
    {
      "id": "e4b1deb4-4c8e-5bfe-aced-3c1e8c4eda7e",
      "title": "Architecture Whiteboard",
      "type": "canvas",
      "isFavorite": false,
      "isDeleted": false,
      "deletedAt": null,
      "createdAt": "2026-10-05T12:00:00.000Z",
      "updatedAt": "2026-11-06T18:00:00.000Z",
      "userId": "d8b9c0e1-2345-6789-abcd-ef0123456789",
      "permission": "EDITOR",
      "owner": {
        "id": "d8b9c0e1-2345-6789-abcd-ef0123456789",
        "name": "Bob Architect",
        "email": "bob@example.com",
        "avatarUrl": null
      }
    }
  ]
  ```

---

### 2.3 Create Document
- **Route:** `POST /api/documents`
- **Auth:** Required
- **Request Body:**
  ```json
  {
    "title": "New Brainstorm",
    "type": "canvas"
  }
  ```
- **Validation:** `type` must be `"canvas"` or `"doc"`.
- **Response (201 Created):**
  ```json
  {
    "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "title": "New Brainstorm",
    "type": "canvas",
    "isFavorite": false,
    "isDeleted": false,
    "deletedAt": null,
    "createdAt": "2026-11-07T12:00:00.000Z",
    "updatedAt": "2026-11-07T12:00:00.000Z",
    "userId": "c7a8b9d0-1234-5678-9abc-def012345678",
    "permission": "OWNER"
  }
  ```

---

### 2.4 Get Single Document
- **Route:** `GET /api/documents/:id`
- **Auth:** Required
- **Permission Enforced:** Must be document owner or have an active `DocumentShare`.
- **Responses:**
  - **200 OK:** Returns document record with computed `permission` (`OWNER`, `EDITOR`, or `VIEWER`).
  - **403 Forbidden:** Document exists but user has no permission.
  - **404 Not Found:** Document does not exist.

---

### 2.5 Update Document
- **Route:** `PUT /api/documents/:id`
- **Auth:** Required
- **Request Body:**
  ```json
  {
    "title": "Updated Title",
    "isFavorite": true,
    "isDeleted": true,
    "deletedAt": "2026-11-07T12:00:00.000Z"
  }
  ```
- **Permission Matrix:**
  - **OWNER:** Can update `title`, `isFavorite`, and soft-delete fields (`isDeleted`, `deletedAt`).
  - **EDITOR:** Can update `title` only. Attempting to change `isDeleted` or `isFavorite` returns `403 Forbidden`.
  - **VIEWER:** Cannot modify document. Returns `403 Forbidden`.

---

### 2.6 Permanently Delete Document
- **Route:** `DELETE /api/documents/:id`
- **Auth:** Required
- **Permission Enforced:** Owner only.
- **Responses:**
  - **204 No Content:** Successfully deleted.
  - **403 Forbidden:** Collaborators cannot permanently delete documents.

---

## 3. Document Sharing Endpoints

### 3.1 Share Document with User
- **Route:** `POST /api/documents/:documentId/share`
- **Auth:** Required (Owner only)
- **Request Body:**
  ```json
  {
    "email": "collaborator@example.com",
    "permission": "EDITOR"
  }
  ```
- **Responses:**
  - **201 Created:** Returns created `DocumentShare` object with user profile details.
  - **400 Bad Request:** Cannot share with self, or invalid permission.
  - **404 Not Found:** Document or recipient email not found.
  - **409 Conflict:** Document already shared with this user.

---

### 3.2 List Active Document Shares
- **Route:** `GET /api/documents/:documentId/shares`
- **Auth:** Required (Owner only)
- **Response (200 OK):**
  ```json
  [
    {
      "id": "share-uuid-1",
      "documentId": "doc-uuid-1",
      "userId": "user-uuid-2",
      "permission": "VIEWER",
      "createdAt": "2026-10-10T12:00:00.000Z",
      "user": {
        "id": "user-uuid-2",
        "name": "Jane Observer",
        "email": "jane@example.com",
        "avatarUrl": null
      }
    }
  ]
  ```

---

### 3.3 Update Share Permission
- **Route:** `PATCH /api/documents/:documentId/share/:targetUserId`
- **Auth:** Required (Owner only)
- **Request Body:** `{"permission": "VIEWER"}`
- **Response (200 OK):** Returns updated share record.

---

### 3.4 Revoke Share Access
- **Route:** `DELETE /api/documents/:documentId/share/:targetUserId`
- **Auth:** Required (Owner only)
- **Response (200 OK):** `{"message": "Access revoked successfully"}`

