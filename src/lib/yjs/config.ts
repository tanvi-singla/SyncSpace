/**
 * Centralized Yjs WebSocket relay configuration for SyncSpace.
 * Ensures consistent WebSocket URL resolution across document and canvas collaboration,
 * supporting localhost in development, LAN IPs for multi-computer setups,
 * and custom production URLs via VITE_WS_URL or VITE_YJS_WS_URL.
 */

export function getWsUrl(): string {
  // 1. Explicit environment variable takes highest priority
  const envUrl =
    (import.meta as any).env?.VITE_WS_URL ||
    (import.meta as any).env?.VITE_YJS_WS_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 2. If running in a browser across different computers on a LAN/network,
  // dynamically resolve the WebSocket server on port 1234 using the current host.
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}:1234`;
    }
  }

  // 3. Default local development fallback
  return 'ws://localhost:1234';
}
