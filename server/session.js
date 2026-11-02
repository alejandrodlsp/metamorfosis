// Controlador de partida en servidor: orquesta draft, selección, carreras y puntuación para una sala.
// Los humanos responden por WebSocket; los bots (o humanos desconectados) deciden con la IA.
import { RaceEngine } from '../shared/engine/engine.js';
import * as T from '../shared/engine/tournament.js';
import * as AI from '../shared/engine/ai.js';

const ABORT = Symbol('abort');

export function tournamentView(t, viewerId) {
  const view = { ...t };
  if (t.phase === 'select') {
    view.selection = Object.fromEntries(t.players.map((p) => {
      const c = t.selection[p.id];
      return [p.id, !c ? null : p.id === viewerId ? c : 'hidden'];
    }));
  }
  return view;
}

export class GameSession {
  constructor(room, hooks) {
    this.room = room;
    this.hooks = hooks; // { persist(), onEnd() }
    this.aborted = false;
    this.pending = new Map();
    this.cancellers = new Set();
    this.engine = null;
    this.awaiting = null;
    this.logTail = [];
    this.running = false;
    this.rng = Math.random;
  }

  get cfg() { return this.room.config; }
  get t() { return this.room.t; }
  player(id) { return this.room.players.get(id); }
  isBot(id) { const p = this.player(id); return !p || p.isBot || !p.connected; }
  level(id) { return this.player(id)?.level || this.cfg.aiLevel; }

  // ------------------------------------------------------------------ infraestructura
  sleep(ms) {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(ABORT);
      const c = { reject };
      const timer = setTimeout(() => { this.cancellers.delete(c); resolve(); }, ms);
      c.clear = () => clearTimeout(timer);
      this.cancellers.add(c);
    });
  }

  waitFor(pid, kind, seconds, match) {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(ABORT);
      const entry = { kind, match, resolve };
      const c = { reject, clear: () => clearTimeout(entry.timer) };
      entry.c = c;
      if (seconds > 0) {
        entry.timer = setTimeout(() => this.settle(pid, entry, undefined, true), seconds * 1000);
      }
      this.cancellers.add(c);
      this.pending.set(pid, entry);
    });
  }

  settle(pid, entry, value, auto) {
    if (this.pending.get(pid) !== entry) return;
    this.pending.delete(pid);
    clearTimeout(entry.timer);
    this.cancellers.delete(entry.c);
    entry.resolve({ value, auto });
  }

  /** Mensaje de un humano que responde a lo que se le está pidiendo. */
  answer(pid, kind, value) {
    const entry = this.pending.get(pid);
    if (!entry || entry.kind !== kind) return false;
    if (entry.match && !entry.match(value)) return false;
    this.settle(pid, entry, value, false);
    return true;
  }

  onDisconnect(pid) {
    const entry = this.pending.get(pid);
    if (entry) this.settle(pid, entry, undefined, true);
  }

  abort() {
    this.aborted = true;
    for (const c of this.cancellers) { c.clear?.(); c.reject(ABORT); }
    this.cancellers.clear();
    this.pending.clear();
  }

  broadcast(msg) { this.room.broadcast(msg); }

  sync() {
    const room = this.room;
    for (const p of room.players.values()) {
      if (!p.ws) continue;
      room.sendTo(p, {
        type: 'game', ...room.roomInfo(), t: tournamentView(this.t, p.id),
        race: this.engine ? this.engine.snapshot() : null, awaiting: this.awaiting, log: this.logTail.slice(-80),
      });
    }
  }

  deadline(seconds) { return seconds > 0 ? Date.now() + seconds * 1000 : null; }

  // ------------------------------------------------------------------ ciclo principal
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const t = this.t;
      if (t.phase === 'race') t.phase = 'select'; // reanudación: la carrera se reinicia
      for (;;) {
        this.hooks.persist();
        switch (this.t.phase) {
          case 'draft': await this.runDraft(); break;
          case 'select': await this.runSelect(); await this.runRace(); break;
          case 'result': await this.runResult(); break;
          case 'final': await this.runFinal(); return;
          default: return;
        }
      }
    } catch (e) {
      if (e !== ABORT) console.error('[session]', e);
    } finally {
      this.running = false;
    }
  }

  async runDraft() {
    const t = this.t;
    while (t.phase === 'draft') {
      const pid = T.currentPicker(t);
      let charId;
      if (this.isBot(pid)) {
        this.awaiting = { kind: 'draft', playerId: pid, deadline: null };
        this.sync();
        await this.sleep(900 * (this.cfg.animSpeed || 0.3));
        charId = AI.chooseDraftPick(t, pid, this.rng, this.level(pid));
      } else {
        const secs = this.cfg.draftSeconds;
        this.awaiting = { kind: 'draft', playerId: pid, deadline: this.deadline(secs) };
        this.sync();
        const ans = await this.waitFor(pid, 'draftPick', secs, (v) => !T.pickError(t, pid, v));
        charId = ans.auto ? AI.chooseDraftPick(t, pid, this.rng, 'hard') : ans.value;
      }
      T.pickCharacter(t, pid, charId);
      this.hooks.persist();
    }
    this.awaiting = null;
    this.sync();
  }

  async runSelect() {
    const t = this.t;
    const pendingHumans = [];
    for (const p of t.players) {
      if (t.selection[p.id]) continue;
      if (this.isBot(p.id)) T.selectForRace(t, p.id, AI.chooseRaceCharacter(t, p.id, this.rng, this.level(p.id)));
      else pendingHumans.push(p.id);
    }
    const secs = this.cfg.selectSeconds;
    this.awaiting = { kind: 'select', deadline: this.deadline(pendingHumans.length ? secs : 0) };
    this.sync();
    await Promise.all(pendingHumans.map(async (pid) => {
      const ans = await this.waitFor(pid, 'selectChar', secs, (v) => !T.selectError(t, pid, v));
      const charId = ans.auto ? AI.chooseRaceCharacter(t, pid, this.rng, 'hard') : ans.value;
      T.selectForRace(t, pid, charId);
      this.sync();
    }));
    this.awaiting = null;
  }

  async runRace() {
    const t = this.t;
    const spec = T.buildRace(t, this.rng);
    this.logTail = [];
    this.engine = new RaceEngine({ ...spec, config: this.cfg, rng: this.rng, io: this.makeIo() });
    this.sync();
    await this.sleep(600 * (this.cfg.animSpeed || 0));
    const result = await this.engine.run();
    T.scoreRace(t, result);
    this.hooks.persist();
    this.sync();
  }

  async runResult() {
    const t = this.t;
    const humans = t.players.filter((p) => !this.isBot(p.id)).map((p) => p.id);
    const secs = 25;
    this.awaiting = { kind: 'ack', deadline: this.deadline(secs), waiting: humans };
    this.sync();
    await Promise.all(humans.map((pid) => this.waitFor(pid, 'ack', secs)));
    this.awaiting = null;
    this.engine = null;
    T.nextRace(t);
  }

  async runFinal() {
    this.awaiting = { kind: 'final', deadline: null };
    this.sync();
    await this.waitFor('__room', 'playAgain', 0);
    this.awaiting = null;
    this.engine = null;
    this.hooks.onEnd();
  }

  // ------------------------------------------------------------------ E/S del motor
  makeIo() {
    const self = this;
    return {
      send: async (events, snapshot) => {
        for (const e of events) {
          if (e.type === 'LOG' || e.type === 'ABILITY') self.logTail.push({ text: e.text, kind: e.type === 'LOG' ? e.kind : 'ability', racerId: e.racerId ?? null });
        }
        if (self.logTail.length > 300) self.logTail.splice(0, self.logTail.length - 200);
        self.broadcast({ type: 'events', events, race: snapshot });
      },
      sleep: (ms) => self.sleep(ms),
      timeout: (pid, kind) => (self.isBot(pid) ? 0 : kind === 'roll' ? self.cfg.rollSeconds : self.cfg.decisionSeconds),
      waitRoll: async ({ playerId, seconds }) => {
        if (self.isBot(playerId)) { await self.sleep(250 * (self.cfg.animSpeed || 0)); return; }
        await self.waitFor(playerId, 'roll', seconds);
      },
      decide: async (req) => {
        const pid = req.playerId;
        if (self.isBot(pid)) {
          await self.sleep(500 * (self.cfg.animSpeed || 0));
          return AI.decide(req, self.rng, self.level(pid));
        }
        const p = self.player(pid);
        self.room.sendTo(p, { type: 'request', request: req });
        const ans = await self.waitFor(pid, 'decide', req.seconds, (v) => v && v.requestId === req.id);
        self.room.sendTo(p, { type: 'requestClosed', id: req.id });
        if (ans.auto) return AI.decide(req, self.rng, 'hard');
        return ans.value.answer ?? null;
      },
    };
  }
}
