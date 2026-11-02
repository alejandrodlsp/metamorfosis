// Estado global del cliente y preferencias.
const subs = new Set();

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; }
}

export const S = {
  screen: 'menu',
  connected: false,
  me: null, // { code, playerId, token }
  room: null,
  t: null,
  race: null,
  awaiting: null,
  log: [],
  chat: [],
  request: null,
  pendingQuick: null,
  profile: load('mp.profile', { name: '', color: '#3d8bff' }),
  opts: load('mp.opts', { sound: true, volume: 0.6, shadows: true, particles: true, followCam: true, tutorialSeen: false }),
  session: (() => { try { return JSON.parse(localStorage.getItem('mp.session') || 'null'); } catch { return null; } })(),
};

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() { for (const fn of subs) fn(); }
export function navigate(screen) { S.screen = screen; notify(); }

export function saveProfile() { localStorage.setItem('mp.profile', JSON.stringify(S.profile)); }
export function saveOpts() { localStorage.setItem('mp.opts', JSON.stringify(S.opts)); }
export function saveSession(sess) {
  S.session = sess;
  if (sess) localStorage.setItem('mp.session', JSON.stringify(sess)); else localStorage.removeItem('mp.session');
}

export const myId = () => S.me?.playerId;
export const isHost = () => !!S.room && S.room.hostId === S.me?.playerId;
export const playerInfo = (id) => S.room?.players.find((p) => p.id === id) || S.t?.players.find((p) => p.id === id);
