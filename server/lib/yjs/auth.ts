import type { IncomingMessage } from 'http';
import { verifyToken, AUTH_COOKIE_NAME } from '../auth/jwt';
import { prisma } from '../db/client';
import { parseRoomName, type ParsedRoom } from '../../../src/lib/yjs/rooms';

export type UserRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface YjsAuthResult {
  authorized: boolean;
  status: number;
  reason?: string;
  userId?: string;
  permission?: UserRole;
  parsedRoom: ParsedRoom;
}

/**
 * Extracts authentication token from either cookies or URL query string.
 */
export function extractAuthToken(req: IncomingMessage, url: URL): string | null {
  // 1. Query parameter token
  const queryToken = url.searchParams.get('token') || url.searchParams.get('auth_token');
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }

  // 2. Cookie header
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(`${AUTH_COOKIE_NAME}=`)) {
        const val = c.slice(AUTH_COOKIE_NAME.length + 1);
        if (val) return decodeURIComponent(val);
      }
    }
  }

  // 3. Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Authorizes an incoming WebSocket connection for a given room.
 * Enforces OWNER, EDITOR, and VIEWER permissions.
 */
export async function authorizeYjsConnection(
  req: IncomingMessage,
  rawRoomName: string,
  url: URL
): Promise<YjsAuthResult> {
  const parsedRoom = parseRoomName(rawRoomName);

  // Allow disabling auth check explicitly via env for mock test environments
  if (process.env.YJS_AUTH_REQUIRED === 'false') {
    return {
      authorized: true,
      status: 200,
      userId: 'mock-user',
      permission: 'OWNER',
      parsedRoom,
    };
  }

  // 1. Extract and verify JWT
  const token = extractAuthToken(req, url);
  if (!token) {
    return {
      authorized: false,
      status: 401,
      reason: 'Authentication required. No auth token or cookie provided.',
      parsedRoom,
    };
  }

  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return {
      authorized: false,
      status: 401,
      reason: 'Invalid or expired authentication token.',
      parsedRoom,
    };
  }

  const userId = payload.userId;

  try {
    const authenticatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { authVersion: true },
    });
    if (!authenticatedUser || authenticatedUser.authVersion !== payload.authVersion) {
      return {
        authorized: false,
        status: 401,
        reason: 'Invalid or expired authentication token.',
        parsedRoom,
      };
    }
  } catch (error) {
    console.error('Yjs session authorization failed:', error);
    return {
      authorized: false,
      status: 500,
      reason: 'Internal database error during authorization.',
      parsedRoom,
    };
  }

  // 2. Directory room (active workspace presence for authenticated users)
  if (parsedRoom.type === 'directory') {
    return {
      authorized: true,
      status: 200,
      userId,
      permission: 'EDITOR',
      parsedRoom,
    };
  }

  // 3. Document or Canvas room: enforce document ownership and sharing permissions
  const documentId = parsedRoom.documentId;
  if (!documentId) {
    return {
      authorized: false,
      status: 400,
      reason: 'Missing document ID in room name.',
      parsedRoom,
    };
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        shares: {
          where: { userId },
        },
      },
    });

    if (!document) {
      return {
        authorized: false,
        status: 404,
        reason: 'Document not found.',
        parsedRoom,
      };
    }

    // Owner check
    if (document.userId === userId) {
      return {
        authorized: true,
        status: 200,
        userId,
        permission: 'OWNER',
        parsedRoom,
      };
    }

    // Collaborator share check
    const share = document.shares[0];
    if (share) {
      return {
        authorized: true,
        status: 200,
        userId,
        permission: share.permission as 'EDITOR' | 'VIEWER',
        parsedRoom,
      };
    }

    // Neither owner nor shared
    return {
      authorized: false,
      status: 403,
      reason: 'Access denied. You do not have permission to view or edit this document.',
      parsedRoom,
    };
  } catch (error) {
    console.error('Yjs authorization error:', error);
    return {
      authorized: false,
      status: 500,
      reason: 'Internal database error during authorization.',
      parsedRoom,
    };
  }
}
