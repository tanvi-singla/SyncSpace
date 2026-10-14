import type WebSocket from 'ws';

const connectionsByUser = new Map<string, Set<WebSocket>>();

export function registerUserConnection(userId: string, connection: WebSocket): () => void {
  const connections = connectionsByUser.get(userId) ?? new Set<WebSocket>();
  connections.add(connection);
  connectionsByUser.set(userId, connections);

  return () => {
    connections.delete(connection);
    if (connections.size === 0) connectionsByUser.delete(userId);
  };
}

/** Immediately closes active collaboration sessions after a password reset. */
export function revokeUserConnections(userId: string): void {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  connectionsByUser.delete(userId);
  for (const connection of connections) {
    try {
      connection.close(4001, 'Session expired');
    } catch {
      // The socket may already be closing.
    }
  }
}
