/**
 * Centralized Yjs WebSocket relay configuration for SyncSpace.
 * Ensures consistent WebSocket URL resolution across document and canvas collaboration,
 * supporting localhost in development, LAN IPs for multi-computer setups,
 * and custom production URLs via VITE_WS_URL or VITE_YJS_WS_URL.
 */

export function getWsUrl(): string {
  // 1. If running in a browser across different computers on a LAN/network (e.g. http://10.x.x.x:5173),
  // dynamically resolve the WebSocket server using the current host so collaborators automatically connect to the host.
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}:5000`;
    }
  }

  // 2. Explicit environment variable takes priority for localhost / dev
  const envUrl =
    (import.meta as any).env?.VITE_WS_URL ||
    (import.meta as any).env?.VITE_YJS_WS_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    // Ignore dead placeholder Render relay that prevents local & LAN collaboration
    if (!trimmed.includes('syncspace-yjs-relay.onrender.com')) {
      return trimmed;
    }
  }

  // 3. Default local development fallback
  return 'ws://localhost:5000';
}
