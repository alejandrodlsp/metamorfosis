import './styles.css';
import { World } from './three/world.js';
import { Director } from './director.js';
import { G } from './ctx.js';
import { S, subscribe, notify, saveSession, myId, navigate } from './store.js';
import { net } from './net.js';
import { toast } from './dom.js';
import { loadManifest } from './assets.js';
import { audioSettings } from './audio.js';
import { startTicker } from './components.js';
import { CHARACTERS } from '../shared/characters.js';
import { PLAYER_COLORS } from '../shared/config.js';
import { menu } from './screens/menu.js';
import { play } from './screens/play.js';
import { lobby } from './screens/lobby.js';
import { characters, rules, options } from './screens/library.js';
import { draft, select } from './screens/draft.js';
import { race, hud } from './screens/race.js';
import { final } from './screens/results.js';

const SCREENS = { menu, play, lobby, characters, rules, options, draft, select, race, final };
const ui = document.getElementById('ui');
let active = null;
let activeName = null;
let showcaseBuilt = false;

function currentScreen() {
  if (S.room && S.me) {
    if (S.room.phase === 'lobby') return 'lobby';
    if (S.room.phase === 'playing' && S.t) {
      return { draft: 'draft', select: 'select', race: 'race', result: 'race', final: 'final' }[S.t.phase] || 'lobby';
    }
  }
  return S.screen;
}

function buildShowcase() {
  const w = G.world;
  w.setCircuit('normal');
  w.resetRace();
  w.setMode('showcase');
  const picks = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 6);
  const fake = { racers: {}, starsClaimed: {} };
  picks.forEach((c, i) => {
    fake.racers[`s${i}`] = { id: `s${i}`, name: '', color: PLAYER_COLORS[i].hex, charId: c.id, pos: [0, 0, 1, 4, 5, 9][i] + i % 2, eliminated: false, finished: false, tripped: false, mods: [] };
  });
  w.syncRacers(fake);
  w.fitBoard(true);
  showcaseBuilt = true;
}

export function render() {
  const name = currentScreen();
  if (name !== 'race' && name !== 'final' && !showcaseBuilt) buildShowcase();
  if (name === 'race') showcaseBuilt = false;
  if (name !== activeName) {
    active?.unmount?.();
    ui.replaceChildren();
    active = SCREENS[name];
    activeName = name;
    active.mount(ui);
    document.getElementById('app').dataset.screen = name;
  } else {
    active.update?.();
  }
  document.getElementById('app').classList.toggle('offline', !!S.me && !S.connected);
}

function resetSession() {
  S.me = null; S.room = null; S.t = null; S.race = null; S.awaiting = null; S.log = []; S.chat = []; S.request = null;
  G.director.raceKey = null;
  showcaseBuilt = false;
}

net.onMessage((m) => {
  switch (m.type) {
    case '_open': S.connected = true; render(); break;
    case '_close': S.connected = false; render(); break;
    case 'joined':
      resetSession();
      S.me = { code: m.code, playerId: m.playerId, token: m.token };
      saveSession({ code: m.code, token: m.token });
      break;
    case 'room':
      S.room = m.room;
      if (S.pendingQuick && S.room.hostId === myId()) {
        const q = S.pendingQuick;
        S.pendingQuick = null;
        net.send({ type: 'settings', settings: { aiLevel: q.level } });
        for (let i = 0; i < q.bots; i++) net.send({ type: 'addBot', level: q.level });
        net.send({ type: 'start' });
      }
      render();
      lobby.updateChat?.();
      break;
    case 'game':
      S.room = m.room; S.t = m.t; S.awaiting = m.awaiting;
      if (!S.log.length && m.log?.length) S.log = m.log.slice();
      G.director.onGame(m);
      render();
      break;
    case 'events': G.director.push(m); break;
    case 'request':
      S.request = m.request;
      G.director.whenIdle(() => { if (S.request?.id === m.request.id) hud.showDecision(m.request); });
      break;
    case 'requestClosed': if (S.request?.id === m.id) hud.closeDecision(); break;
    case 'chat':
      S.chat.push(m);
      if (S.chat.length > 100) S.chat.shift();
      if (activeName === 'lobby') lobby.updateChat();
      else if (activeName === 'race') hud.log(`💬 ${m.name}: ${m.text}`, 'chat');
      break;
    case 'error': toast(m.message, 'warn'); S.pendingQuick = null; break;
    case 'left':
    case 'kicked':
      if (m.type === 'kicked') toast('Has sido expulsado de la sala.', 'warn');
      saveSession(null);
      resetSession();
      S.screen = 'menu';
      render();
      break;
    case 'rejoinFailed':
      saveSession(null);
      resetSession();
      toast('No se pudo reanudar la partida (la sala ya no existe).', 'warn');
      S.screen = 'menu';
      render();
      break;
    default:
  }
});

async function boot() {
  G.world = new World(document.getElementById('scene'));
  G.director = new Director();
  G.hud = hud;
  audioSettings.enabled = S.opts.sound;
  audioSettings.volume = S.opts.volume;
  G.world.setQuality({ shadows: S.opts.shadows, particles: S.opts.particles });
  await loadManifest();
  startTicker();
  net.setRejoinProvider(() => (S.me ? { code: S.me.code, token: S.me.token } : null));
  subscribe(render);
  net.connect();
  render();
  window.__mp = { S, G, navigate, notify };
}

boot();
