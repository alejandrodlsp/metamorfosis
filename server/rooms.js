// Salas: códigos, contraseñas (scrypt), jugadores, bots, ajustes y persistencia entre reinicios.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, PLAYER_COLORS } from '../shared/config.js';
import { createTournament } from '../shared/engine/tournament.js';
import { GameSession } from './session.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Chispa', 'Pimpón', 'Gruñón', 'Nube', 'Trueno', 'Mora', 'Bruma', 'Zafiro'];
const COLOR_HEX = PLAYER_COLORS.map((c) => c.hex);
const IDLE_ABORT_MS = 60_000;
const ROOM_TTL_MS = 24 * 3600 * 1000;

export const cleanName = (s, fallback = 'Jugador') => {
  const v = String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return v || fallback;
};

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}

function verifyPassword(pw, rec) {
  if (!rec) return true;
  const h = crypto.scryptSync(String(pw ?? ''), rec.salt, 32);
  const expected = Buffer.from(rec.hash, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

const newToken = () => crypto.randomBytes(18).toString('hex');
const newId = () => `p${crypto.randomBytes(4).toString('hex')}`;

export class Room {
  constructor(manager, code, password) {
    this.manager = manager;
    this.code = code;
    this.pass = password ? hashPassword(password) : null;
    this.hostId = null;
    this.players = new Map();
    this.config = { ...DEFAULT_CONFIG };
    this.phase = 'lobby';
    this.t = null;
    this.session = null;
    this.touched = Date.now();
    this.idleTimer = null;
  }

  humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  connectedHumans() { return this.humans().filter((p) => p.connected); }

  freeColor(preferred) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    if (COLOR_HEX.includes(preferred) && !used.has(preferred)) return preferred;
    return COLOR_HEX.find((c) => !used.has(c)) || COLOR_HEX[0];
  }

  addPlayer({ name, color, isBot = false, level = null }) {
    const p = {
      id: newId(), name: cleanName(name, isBot ? BOT_NAMES[this.players.size % BOT_NAMES.length] : 'Jugador'),
      color: this.freeColor(color), isBot, level, token: newToken(), ws: null, connected: isBot,
    };
    this.players.set(p.id, p);
    if (!this.hostId && !isBot) this.hostId = p.id;
    return p;
  }

  roomInfo() {
    return {
      room: {
        code: this.code, hasPassword: !!this.pass, hostId: this.hostId, phase: this.phase, max: this.config.maxPlayers,
        settings: {
          aiLevel: this.config.aiLevel, animSpeed: this.config.animSpeed, rollSeconds: this.config.rollSeconds,
          decisionSeconds: this.config.decisionSeconds, draftSeconds: this.config.draftSeconds, selectSeconds: this.config.selectSeconds,
        },
        players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot, level: p.level, connected: p.connected })),
      },
    };
  }

  sendTo(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }

  pushLobby() {
    this.touched = Date.now();
    if (this.phase === 'lobby') this.broadcast({ type: 'room', ...this.roomInfo() });
    else if (this.session) this.session.sync();
    this.manager.save();
  }

  // ------------------------------------------------------------------ conexión
  attach(p, ws) {
    if (p.ws && p.ws !== ws) { try { p.ws.close(4000, 'replaced'); } catch { /* noop */ } }
    p.ws = ws;
    p.connected = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.phase === 'playing') this.ensureSession();
    this.pushLobby();
  }

  detach(p, ws) {
    if (p.ws !== ws) return;
    p.ws = null;
    p.connected = false;
    this.session?.onDisconnect(p.id);
    if (this.phase === 'lobby') {
      this.removePlayer(p.id);
      return;
    }
    this.reassignHost();
    if (!this.connectedHumans().length) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { this.session?.abort(); this.session = null; }, IDLE_ABORT_MS);
    }
    this.pushLobby();
  }

  reassignHost() {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = this.connectedHumans()[0] || this.humans()[0];
    if (next) this.hostId = next.id;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.hostId === id) { this.hostId = null; this.reassignHost(); }
    if (!this.humans().length) { this.destroy(); return; }
    this.pushLobby();
  }

  destroy() {
    this.session?.abort();
    clearTimeout(this.idleTimer);
    this.manager.rooms.delete(this.code);
    this.manager.save();
  }

  ensureSession() {
    if (this.session && this.session.running) return;
    if (!this.t) return;
    this.session = new GameSession(this, {
      persist: () => this.manager.save(),
      onEnd: () => { this.phase = 'lobby'; this.t = null; this.session = null; this.pushLobby(); },
    });
    this.session.run();
  }

  startGame() {
    if (this.phase !== 'lobby') return 'La partida ya empezó.';
    const n = this.players.size;
    if (n < this.config.minPlayers) return `Hacen falta al menos ${this.config.minPlayers} participantes (añade IA).`;
    if (n > this.config.maxPlayers) return 'Demasiados participantes.';
    this.t = createTournament([...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })), { ...this.config });
    this.phase = 'playing';
    this.ensureSession();
    this.manager.save();
    return null;
  }

  // ------------------------------------------------------------------ mensajes
  handle(p, msg) {
    this.touched = Date.now();
    const isHost = p.id === this.hostId;
    const session = this.session;
    switch (msg.type) {
      case 'setProfile': {
        const target = msg.playerId && msg.playerId !== p.id ? this.players.get(msg.playerId) : p;
        if (!target || (target !== p && !(isHost && target.isBot))) return;
        if (this.phase !== 'lobby') return;
        if (msg.name !== undefined) target.name = cleanName(msg.name, target.name);
        if (msg.color !== undefined && COLOR_HEX.includes(msg.color)) {
          const owner = [...this.players.values()].find((o) => o.color === msg.color && o !== target);
          if (owner) { owner.color = target.color; }
          target.color = msg.color;
        }
        return this.pushLobby();
      }
      case 'addBot': {
        if (!isHost || this.phase !== 'lobby' || this.players.size >= this.config.maxPlayers) return;
        const level = ['easy', 'normal', 'hard'].includes(msg.level) ? msg.level : null;
        const used = new Set([...this.players.values()].map((x) => x.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
        this.addPlayer({ name, isBot: true, level });
        return this.pushLobby();
      }
      case 'removeBot':
      case 'kick': {
        if (!isHost || this.phase !== 'lobby') return;
        const target = this.players.get(msg.playerId);
        if (!target || target.id === p.id) return;
        if (target.ws) { this.sendTo(target, { type: 'kicked' }); try { target.ws.close(4001, 'kicked'); } catch { /* noop */ } }
        return this.removePlayer(target.id);
      }
      case 'settings': {
        if (!isHost || this.phase !== 'lobby') return;
        const s = msg.settings || {};
        const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
        if (['easy', 'normal', 'hard'].includes(s.aiLevel)) this.config.aiLevel = s.aiLevel;
        for (const [k, lo, hi] of [['animSpeed', 0, 2], ['rollSeconds', 0, 120], ['decisionSeconds', 0, 120], ['draftSeconds', 0, 180], ['selectSeconds', 0, 180]]) {
          const v = num(s[k], lo, hi);
          if (v !== undefined) this.config[k] = v;
        }
        return this.pushLobby();
      }
      case 'start': {
        if (!isHost) return;
        const err = this.startGame();
        if (err) this.sendTo(p, { type: 'error', message: err });
        else this.pushLobby();
        return;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
        if (text) this.broadcast({ type: 'chat', from: p.id, name: p.name, color: p.color, text });
        return;
      }
      case 'leave': return this.leave(p);
      case 'draftPick': return session?.answer(p.id, 'draftPick', String(msg.charId));
      case 'selectChar': return session?.answer(p.id, 'selectChar', String(msg.charId));
      case 'roll': return session?.answer(p.id, 'roll', true);
      case 'decide': return session?.answer(p.id, 'decide', { requestId: Number(msg.requestId), answer: msg.answer == null ? null : String(msg.answer) });
      case 'ack': return session?.answer(p.id, 'ack', true);
      case 'playAgain': {
        if (isHost || !this.players.get(this.hostId)?.connected) session?.answer('__room', 'playAgain', true);
        return;
      }
      default:
    }
  }

  leave(p) {
    if (this.phase === 'lobby') {
      const ws = p.ws;
      p.ws = null;
      this.removePlayer(p.id);
      if (ws) this.sendTo({ ws }, { type: 'left' });
      return;
    }
    // En partida: se queda el asiento y juega la IA.
    p.token = newToken();
    const ws = p.ws;
    p.ws = null;
    p.connected = false;
    this.session?.onDisconnect(p.id);
    this.reassignHost();
    if (ws) ws.send(JSON.stringify({ type: 'left' }));
    this.pushLobby();
  }

  // ------------------------------------------------------------------ persistencia
  toJSON() {
    return {
      code: this.code, pass: this.pass, hostId: this.hostId, config: this.config, phase: this.phase, t: this.t, touched: this.touched,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot, level: p.level, token: p.token })),
    };
  }
}

export class RoomManager {
  constructor(file) {
    this.rooms = new Map();
    this.file = file;
    this.saveTimer = null;
    this.load();
  }

  genCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(password) {
    const room = new Room(this, this.genCode(), password);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code ?? '').toUpperCase().trim()); }

  checkPassword(room, pw) { return verifyPassword(pw, room.pass); }

  findByToken(room, token) {
    const tk = Buffer.from(String(token ?? ''));
    for (const p of room.players.values()) {
      const pt = Buffer.from(p.token);
      if (pt.length === tk.length && crypto.timingSafeEqual(pt, tk)) return p;
    }
    return null;
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...this.rooms.values()]));
        fs.renameSync(tmp, this.file);
      } catch (e) { console.error('[persist]', e.message); }
    }, 500);
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const r of data) {
        if (Date.now() - (r.touched || 0) > ROOM_TTL_MS) continue;
        const room = new Room(this, r.code, null);
        room.pass = r.pass;
        room.hostId = r.hostId;
        room.config = { ...DEFAULT_CONFIG, ...r.config };
        room.phase = r.phase;
        room.t = r.t;
        room.touched = r.touched;
        for (const p of r.players) room.players.set(p.id, { ...p, ws: null, connected: p.isBot });
        if (room.humans().length) this.rooms.set(room.code, room);
      }
    } catch (e) { console.error('[load]', e.message); }
  }

  sweep() {
    for (const room of this.rooms.values()) {
      if (!room.connectedHumans().length && Date.now() - room.touched > ROOM_TTL_MS) room.destroy();
    }
  }
}
