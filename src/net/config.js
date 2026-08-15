/**
 * Where to find the multiplayer server, and who we say we are.
 * Resolution order: explicit option, ?net= query, VITE_NET_URL, same host on 8787.
 */

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/ws';

function envUrl() {
  try {
    return import.meta.env?.VITE_NET_URL || null;
  } catch {
    return null;
  }
}

export function resolveServerUrl(explicit) {
  if (explicit) return explicit;

  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('net');
    if (fromQuery) return fromQuery;
  }

  const fromEnv = envUrl();
  if (fromEnv) return fromEnv;

  if (typeof window === 'undefined') return `ws://localhost:${DEFAULT_PORT}${DEFAULT_PATH}`;

  const loc = window.location;
  const secure = loc.protocol === 'https:';
  const proto = secure ? 'wss:' : 'ws:';
  // Behind a single https origin (Railway, ngrok) the server usually sits on the
  // same host and port, otherwise assume the dev server next door on 8787.
  const port = secure ? (loc.port ? `:${loc.port}` : '') : `:${DEFAULT_PORT}`;
  return `${proto}//${loc.hostname}${port}${DEFAULT_PATH}`;
}

const NAMES = [
  'Popcorn', 'Reel', 'Usher', 'Matinee', 'Balcony', 'Trailer',
  'Projector', 'Encore', 'Cameo', 'Nachos', 'Aisle', 'Curtain',
];

export function resolveDisplayName(explicit) {
  if (explicit) return String(explicit).slice(0, 24);

  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('name');
    if (fromQuery) return fromQuery.slice(0, 24);
    try {
      const saved = window.localStorage.getItem('cinema.name');
      if (saved) return saved.slice(0, 24);
      const generated = `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
      window.localStorage.setItem('cinema.name', generated);
      return generated;
    } catch {
      /* private mode, fall through */
    }
  }
  return 'Guest';
}

export function resolveRoom(explicit) {
  if (explicit) return explicit;
  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('room');
    if (fromQuery) return fromQuery;
  }
  return 'main';
}

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];
