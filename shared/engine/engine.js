// Motor de reglas de UNA carrera. Autoritativo, sin dependencias de UI. Determinista salvo por `rng` (dados).
// Orden de resolución de cada evento: 1) efectos del tablero, 2) habilidad del personaje activo,
// 3) habilidades de los demás personajes siguiendo el orden de turno.
import { getCircuit } from '../board.js';
import { CHAR_BY_ID } from '../characters.js';
import { EVENT_MS } from '../timing.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, w = 'casilla') => `${n} ${w}${n === 1 ? '' : 's'}`;

export class RaceEngine {
  /**
   * @param {object} o
   * @param {string} o.circuitId
   * @param {{id:string,name:string,color:string,charId:string}[]} o.racers  (id = id del jugador)
   * @param {string[]} o.turnOrder
   * @param {object} o.config
   * @param {() => number} o.rng
   * @param {{send?:Function,sleep?:Function,waitRoll?:Function,decide:Function,timeout?:Function}} o.io
   */
  constructor({ circuitId, racers, turnOrder, config, rng = Math.random, io = {}, raceNumber = 1 }) {
    this.config = config;
    this.rng = rng;
    this.io = io;
    this.circuit = getCircuit(circuitId);
    this.L = this.circuit.length;
    this.outbox = [];
    this.seq = 0;
    this.resolved = new Set();
    this.chain = [];
    this.depth = 0;
    this.extraTurnFor = null;
    this.actorGone = false;
    this.reqSeq = 0;
    this.modSeq = 0;
    this.skippedWarn = new Set();

    const rs = {};
    for (const r of racers) {
      rs[r.id] = {
        id: r.id, name: r.name, color: r.color, charId: r.charId, pos: 0,
        finished: false, place: null, eliminated: false, tripped: false, mods: [],
        stars: 0, chips: 0, lastRoll: null, copiedId: null, uses: {}, mem: {}, starSpaces: [],
      };
    }
    this.turn = { no: 0, actorId: null, roll: null, handlers: 0, boardMoves: 0 };
    this.state = {
      raceNumber, circuit: circuitId, L: this.L, racers: rs, turnOrder: [...turnOrder], cur: 0,
      turnNo: 0, turn: this.turn, finishOrder: [], starsClaimed: {}, over: false, awaiting: null, moveSeq: 0, forced: false,
    };
  }

  // ------------------------------------------------------------------ utilidades
  racer(id) { return this.state.racers[id]; }
  inPlay(r) { return !!r && !r.finished && !r.eliminated; }
  activeRacers() { return this.state.turnOrder.map((id) => this.state.racers[id]).filter((r) => this.inPlay(r)); }
  othersAt(pos, except) { return this.activeRacers().filter((r) => r !== except && r.pos === pos); }
  nm(r) { return CHAR_BY_ID[r.charId].name; }
  pl(r) { return `${r.name} (${this.nm(r)})`; }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, type, ...data };
    this.outbox.push(ev);
    return ev;
  }

  async flush(force = false) {
    if (!this.outbox.length && !force) return;
    const evs = this.outbox;
    this.outbox = [];
    if (this.io.send) await this.io.send(evs, this.snapshot());
  }

  async beat(ms) {
    await this.flush();
    const t = ms * (this.config.animSpeed ?? 1);
    if (t > 0 && this.io.sleep) await this.io.sleep(t);
  }

  async fx(type, data, ms = EVENT_MS[type] ?? 0) {
    this.emit(type, data);
    await this.beat(ms);
  }

  log(text, kind = 'info', racerId = null) {
    this.emit('LOG', { text, kind, racerId });
  }

  // ------------------------------------------------------------------ decisiones y dados
  async ask(racer, abDef, req) {
    const full = {
      id: ++this.reqSeq, playerId: racer.id, racerId: racer.id, charId: racer.charId, abilityId: abDef?.id,
      seconds: this.io.timeout?.(racer.id, 'decision') ?? 0, ...req,
    };
    return this.decide(full);
  }

  async decide(req) {
    this.state.awaiting = {
      kind: 'decision', playerId: req.playerId, racerId: req.racerId, requestId: req.id, title: req.title,
      deadline: req.seconds ? Date.now() + req.seconds * 1000 : null,
    };
    await this.flush(true);
    let ans = null;
    try {
      ans = await this.io.decide(req);
    } finally {
      this.state.awaiting = null;
    }
    if (ans != null && !req.options.some((o) => o.id === ans)) ans = null;
    return ans;
  }

  async waitRoll(actor) {
    const secs = this.io.timeout?.(actor.id, 'roll') ?? 0;
    this.state.awaiting = { kind: 'roll', playerId: actor.id, racerId: actor.id, deadline: secs ? Date.now() + secs * 1000 : null };
    await this.flush(true);
    try {
      if (this.io.waitRoll) await this.io.waitRoll({ playerId: actor.id, racerId: actor.id, seconds: secs });
    } finally {
      this.state.awaiting = null;
    }
  }

  async rollDie(racer, purpose = 'main') {
    const value = 1 + Math.floor(this.rng() * 6);
    await this.fx('DICE', { racerId: racer.id, value, purpose });
    return value;
  }

  // ------------------------------------------------------------------ habilidades
  abilitiesOf(racer) {
    const def = CHAR_BY_ID[racer.charId];
    const list = [{ key: def.id, def }];
    if (def.copy && racer.copiedId) {
      const c = CHAR_BY_ID[racer.copiedId];
      if (c) list.push({ key: `copy:${c.id}`, def: c, copied: true });
    }
    return list;
  }

  updateCopy(actor) {
    if (!CHAR_BY_ID[actor.charId].copy) return;
    const cands = this.activeRacers().filter((r) => r !== actor && !CHAR_BY_ID[r.charId].copy);
    if (!cands.length) { actor.copiedId = null; return; }
    const best = Math.max(...cands.map((r) => r.pos));
    const lead = cands.find((r) => r.pos === best);
    if (actor.copiedId !== lead.charId) {
      actor.copiedId = lead.charId;
      this.log(`${this.nm(actor)} copia la habilidad de ${this.nm(lead)} (${CHAR_BY_ID[lead.charId].title}).`, 'ability', actor.id);
    }
  }

  usage(racer, ab) {
    const u = (racer.uses[ab.key] ||= { race: 0, turnNo: -1, turn: 0 });
    if (u.turnNo !== this.turn.no) { u.turnNo = this.turn.no; u.turn = 0; }
    return u;
  }

  isImmune(racer, kind) {
    for (const ab of this.abilitiesOf(racer)) {
      if (ab.def.immune && ab.def.immune(this.makeCtx(racer, ab, 'IMMUNE', {}), kind)) return true;
    }
    return false;
  }

  isSilenced(racer) {
    for (const s of this.activeRacers()) {
      if (s === racer) continue;
      for (const ab of this.abilitiesOf(s)) {
        if (ab.def.silences && ab.def.silences(this, racer, s, ab.def)) return true;
      }
    }
    return false;
  }

  resolutionOrder() {
    const list = this.state.turnOrder;
    if (!list.length) return [];
    let start = list.indexOf(this.turn.actorId);
    if (start < 0) start = this.state.cur % list.length;
    return [...list.slice(start), ...list.slice(0, start)].map((id) => this.state.racers[id]);
  }

  /** Lanza un evento: efectos del tablero -> habilidad activa -> resto por orden de turno. */
  async dispatch(event, payload = {}) {
    const s = this.state;
    if (s.over) return;
    if (event === 'ON_STOP') await this.boardStop(payload);
    if (s.over) return;
    const cfg = this.config;
    for (const racer of this.resolutionOrder()) {
      if (s.over) return;
      if (!this.inPlay(racer)) continue;
      for (const ab of this.abilitiesOf(racer)) {
        const handler = ab.def.hooks?.[event];
        if (!handler) continue;
        const gk = `${event}|${payload.key}|${racer.id}|${ab.key}`;
        if (this.resolved.has(gk)) continue;
        this.resolved.add(gk);
        const ck = `${racer.id}|${ab.key}`;
        if (this.chain.includes(ck)) continue; // una habilidad no puede dispararse a sí misma dentro de su cadena
        if (this.depth >= cfg.maxChainDepth || this.turn.handlers >= cfg.maxHandlersPerTurn) {
          if (!this.skippedWarn.has(gk)) { this.skippedWarn.add(gk); this.log('La cadena de efectos es demasiado larga: se detiene.', 'system'); }
          continue;
        }
        if (ab.def.type === 'optional' && this.isSilenced(racer)) {
          this.log(`${this.nm(racer)} no puede usar su habilidad opcional (silenciado).`, 'system', racer.id);
          continue;
        }
        this.chain.push(ck);
        this.depth++;
        this.turn.handlers++;
        try {
          await handler(this.makeCtx(racer, ab, event, payload));
        } finally {
          this.chain.pop();
          this.depth--;
        }
        if (s.over) return;
        if (!this.inPlay(racer)) break;
      }
    }
  }

  makeCtx(racer, ab, event, payload) {
    const eng = this;
    const def = ab.def;
    const others = () => eng.activeRacers().filter((r) => r !== racer);
    const ctx = {
      ...payload, engine: eng, event, self: racer, ab: def, abKey: ab.key, L: eng.L,
      mem: (racer.mem[ab.key] ||= {}),
      n: (r) => eng.nm(r),
      racers: () => eng.activeRacers(),
      others,
      at: (pos) => eng.activeRacers().filter((r) => r.pos === pos),
      isActive: (r) => eng.inPlay(r),
      rank: (r) => 1 + eng.activeRacers().filter((o) => o.pos > r.pos).length,
      isSoleLeader: (r) => eng.activeRacers().length > 1 && eng.activeRacers().every((o) => o === r || o.pos < r.pos),
      isSoleLast: (r) => eng.activeRacers().length > 1 && eng.activeRacers().every((o) => o === r || o.pos > r.pos),
      canAffect: (target, kind) => eng.inPlay(target) && !eng.isImmune(target, kind),
      canUse: () => { if (!def.limit) return true; const u = eng.usage(racer, ab); return (def.limit.per === 'race' ? u.race : u.turn) < def.limit.n; },
      usesLeft: () => { if (!def.limit) return Infinity; const u = eng.usage(racer, ab); return def.limit.n - (def.limit.per === 'race' ? u.race : u.turn); },
      use: () => { const u = eng.usage(racer, ab); u.race++; u.turn++; },
      say: (text, kind = 'ability') => eng.log(text, kind, racer.id),
      announce: async (text, o = {}) => {
        eng.log(text, 'ability', racer.id);
        await eng.fx('ABILITY', {
          racerId: racer.id, abilityId: def.id, name: def.name, title: def.title, text,
          anim: o.anim || def.animation, targets: (o.targets || []).map((t) => t.id),
        }, o.ms ?? 1000);
      },
      confirm: async ({ title, text, aiValue = 1 }) => {
        const ans = await eng.ask(racer, def, {
          type: 'confirm', title, text,
          options: [{ id: 'yes', label: 'Usar habilidad', aiValue }, { id: 'no', label: 'No usar', aiValue: 0 }],
        });
        return ans === 'yes';
      },
      pickRacer: async ({ title, text, candidates, allowSkip = false }) => {
        if (!candidates.length) return null;
        const ans = await eng.ask(racer, def, {
          type: 'racer', title, text, allowSkip,
          options: candidates.map((c) => ({ id: c.racer.id, label: `${eng.pl(c.racer)} · casilla ${c.racer.pos}`, aiValue: c.aiValue ?? 0, racerId: c.racer.id })),
        });
        return ans ? eng.state.racers[ans] : null;
      },
      pickNumber: async ({ title, text, min, max, allowSkip = false, aiValue = () => 0 }) => {
        const options = [];
        for (let i = min; i <= max; i++) options.push({ id: String(i), label: String(i), aiValue: typeof aiValue === 'function' ? aiValue(i) : aiValue });
        const ans = await eng.ask(racer, def, { type: 'number', title, text, allowSkip, options });
        return ans ? Number(ans) : null;
      },
      roll: (r = racer, purpose = 'ability') => eng.rollDie(r, purpose),
      moveBy: (target, o) => eng.moveRacer(target, {
        type: 'EXTRA', distance: o.dist, dir: o.dir ?? 1, source: racer.id, hostile: !!o.hostile,
        kind: o.kind ?? ((o.dir ?? 1) < 0 ? 'back' : 'move'), cause: { abilityId: def.id, text: o.text },
      }),
      moveTo: (target, pos, o = {}) => eng.teleport(target, pos, { source: racer.id, hostile: !!o.hostile, kind: 'teleport', cause: { abilityId: def.id } }),
      swap: (a, b) => eng.swap(a, b, { source: racer.id, hostile: a === racer && b !== racer, cause: { abilityId: def.id } }),
      trip: (target, o = {}) => eng.trip(target, { source: racer.id, hostile: o.hostile ?? target !== racer }),
      eliminate: (target) => eng.eliminate(target, { source: racer.id, hostile: true }),
      addMod: (target, m) => eng.addMod(target, m),
      chip: (n = 1) => eng.addChip(racer, n),
      reverseOrder: () => eng.reverseOrder(),
      extraTurn: (r) => { eng.extraTurnFor = r.id; },
    };
    return ctx;
  }

  // ------------------------------------------------------------------ efectos básicos
  addMod(target, { label, value, turns = 1 }) {
    target.mods = target.mods.filter((m) => m.label !== label);
    target.mods.push({ id: ++this.modSeq, label, value, turns });
    this.emit('MOD', { racerId: target.id, label, value });
  }

  addChip(racer, n) {
    racer.chips += n;
    this.log(`${this.nm(racer)} gana ${plural(n, 'ficha')} de puntos.`, 'ability', racer.id);
    this.emit('CHIP', { racerId: racer.id, n });
  }

  reverseOrder() {
    const s = this.state;
    s.turnOrder.reverse();
    const i = s.turnOrder.indexOf(this.turn.actorId);
    s.cur = i >= 0 ? i : s.cur % s.turnOrder.length;
    this.emit('ORDER', { turnOrder: [...s.turnOrder] });
  }

  removeFromOrder(id) {
    const s = this.state;
    const i = s.turnOrder.indexOf(id);
    if (i < 0) return;
    s.turnOrder.splice(i, 1);
    if (i < s.cur) s.cur--;
    else if (i === s.cur) this.actorGone = true;
  }

  checkOver() {
    const s = this.state;
    if (s.finishOrder.length >= 2 || s.turnOrder.filter((id) => this.inPlay(s.racers[id])).length === 0) s.over = true;
    return s.over;
  }

  async shield(racer, kind) {
    this.log(`¡${this.nm(racer)} es inmune (${kind})!`, 'ability', racer.id);
    await this.fx('SHIELD', { racerId: racer.id, kind });
  }

  async trip(racer, o = {}) {
    if (this.state.over || !this.inPlay(racer) || racer.tripped) return false;
    if (o.hostile && this.isImmune(racer, 'trip')) { await this.shield(racer, 'trip'); return false; }
    racer.tripped = true;
    this.log(`${this.pl(racer)} tropieza y perderá su próximo movimiento principal.`, 'trip', racer.id);
    await this.fx('TRIP', { racerId: racer.id });
    await this.dispatch('ON_TRIP', { subject: racer, source: o.source, key: `trip${++this.state.moveSeq}` });
    return true;
  }

  async eliminate(racer, o = {}) {
    if (this.state.over || !this.inPlay(racer)) return false;
    if (o.hostile && this.isImmune(racer, 'eliminate')) { await this.shield(racer, 'eliminate'); return false; }
    racer.eliminated = true;
    this.removeFromOrder(racer.id);
    this.log(`${this.pl(racer)} queda ELIMINADO de la carrera.`, 'elim', racer.id);
    await this.fx('ELIM', { racerId: racer.id });
    if (this.checkOver()) return true;
    await this.dispatch('ON_ELIMINATION', { subject: racer, source: o.source, key: `elim${++this.state.moveSeq}` });
    return true;
  }

  async finish(racer) {
    const s = this.state;
    racer.finished = true;
    racer.pos = this.L;
    racer.place = s.finishOrder.length + 1;
    s.finishOrder.push(racer.id);
    this.removeFromOrder(racer.id);
    this.log(`¡${this.pl(racer)} cruza la meta en ${racer.place}º lugar!`, 'finish', racer.id);
    await this.fx('FINISH', { racerId: racer.id, place: racer.place });
    if (this.checkOver()) return;
    await this.dispatch('ON_FINISH', { subject: racer, place: racer.place, key: `fin${racer.id}` });
  }

  // ------------------------------------------------------------------ movimiento
  newMove(racer, o) {
    const id = ++this.state.moveSeq;
    return {
      id, key: `m${id}`, type: 'EXTRA', racerId: racer.id, from: racer.pos, dest: racer.pos, dir: 1, distance: 0,
      roll: null, skipOccupied: false, blocked: false, hostile: false, source: null, cause: null, jumped: [], passed: [], moved: 0, ...o,
    };
  }

  /** Movimiento principal o adicional (EXTRA). */
  async moveRacer(racer, o) {
    const s = this.state;
    if (s.over || !this.inPlay(racer)) return null;
    const dir = o.dir ?? 1;
    if (o.hostile && this.isImmune(racer, o.kind ?? 'back')) { await this.shield(racer, o.kind ?? 'back'); return null; }
    const move = this.newMove(racer, {
      type: o.type ?? 'EXTRA', dir, distance: o.distance, roll: o.roll ?? null, hostile: !!o.hostile, source: o.source ?? null, cause: o.cause ?? null,
    });
    await this.dispatch('DURING_MOVEMENT', { mover: racer, move, key: move.key });
    if (s.over || !this.inPlay(racer)) return null;
    if (move.blocked) move.distance = 0;
    move.distance = Math.max(0, Math.round(move.distance));
    return this.runMove(racer, move);
  }

  async runMove(racer, move) {
    const s = this.state;
    const L = this.L;
    let pos = move.from;
    let steps = move.distance;
    const jumped = [];
    while (steps > 0) {
      const nxt = pos + move.dir;
      if (nxt < 0 || nxt > L) break;
      pos = nxt;
      if (pos === L && move.dir > 0) break;
      if (move.skipOccupied && move.dir > 0) {
        const occ = this.othersAt(pos, racer);
        if (occ.length) { jumped.push(...occ.map((r) => r.id)); continue; }
      }
      steps--;
    }
    move.dest = pos;
    move.jumped = jumped;
    await this.dispatch('BEFORE_LANDING', { mover: racer, move, key: move.key });
    if (s.over || !this.inPlay(racer)) return move;
    move.dest = clamp(move.dest, 0, L);

    if (move.dest === move.from) {
      if (move.type === 'MAIN') this.log(`${this.pl(racer)} no se mueve (0 casillas).`, 'move', racer.id);
      return move;
    }

    move.moved = Math.abs(move.dest - move.from);
    if (move.dir > 0 || this.config.backwardPassTriggers) {
      const lo = Math.min(move.from, move.dest);
      const hi = Math.max(move.from, move.dest);
      move.passed = this.activeRacers().filter((r) => r !== racer && r.pos > lo && r.pos < hi)
        .sort((a, b) => (move.dir > 0 ? a.pos - b.pos : b.pos - a.pos)).map((r) => r.id);
    }
    const from = racer.pos;
    racer.pos = move.dest;
    this.describeMove(racer, move, from);
    await this.fx('MOVE', {
      racerId: racer.id, from, to: move.dest, moveType: move.type, dir: move.dir, distance: move.moved,
      jumped: move.jumped, passed: move.passed, causeAbility: move.cause?.abilityId ?? null, board: !!move.cause?.board,
    }, Math.min(2600, EVENT_MS.MOVE_BASE + EVENT_MS.MOVE_STEP * move.moved));
    await this.afterMove(racer, move);
    return move;
  }

  describeMove(racer, move, from) {
    const n = plural(move.moved);
    if (move.type === 'MAIN') this.log(`${this.pl(racer)} avanza ${n} (movimiento principal, ${from} → ${move.dest}).`, 'move', racer.id);
    else if (move.type === 'TELEPORT') this.log(`${this.nm(racer)} se teletransporta de la casilla ${from} a la ${move.dest}.`, 'move', racer.id);
    else this.log(`${this.nm(racer)} ${move.dir > 0 ? 'avanza' : 'retrocede'} ${n} (movimiento adicional, ${from} → ${move.dest}).`, 'move', racer.id);
  }

  async teleport(racer, pos, o = {}) {
    const s = this.state;
    if (s.over || !this.inPlay(racer)) return null;
    if (o.hostile && this.isImmune(racer, 'teleport')) { await this.shield(racer, 'teleport'); return null; }
    const L = this.L;
    const dest = clamp(pos, 0, L - 1);
    const move = this.newMove(racer, {
      type: 'TELEPORT', dest, dir: Math.sign(dest - racer.pos) || 1, distance: Math.abs(dest - racer.pos), hostile: !!o.hostile, source: o.source ?? null, cause: o.cause ?? null,
    });
    await this.dispatch('BEFORE_LANDING', { mover: racer, move, key: move.key });
    if (s.over || !this.inPlay(racer)) return move;
    move.dest = clamp(move.dest, 0, L - 1);
    if (move.dest === racer.pos) return move;
    move.moved = Math.abs(move.dest - racer.pos);
    const from = racer.pos;
    racer.pos = move.dest;
    this.describeMove(racer, move, from);
    await this.fx('MOVE', {
      racerId: racer.id, from, to: move.dest, moveType: 'TELEPORT', dir: move.dir, distance: move.moved, jumped: [], passed: [],
      causeAbility: move.cause?.abilityId ?? null, board: !!move.cause?.board,
    }, EVENT_MS.TELEPORT);
    await this.afterMove(racer, move);
    return move;
  }

  async swap(a, b, o = {}) {
    const s = this.state;
    if (s.over || !this.inPlay(a) || !this.inPlay(b) || a.pos === b.pos) return false;
    if (o.hostile && this.isImmune(b, 'teleport')) { await this.shield(b, 'teleport'); return false; }
    const m1 = this.newMove(a, { type: 'TELEPORT', dest: b.pos, source: o.source, cause: o.cause });
    const m2 = this.newMove(b, { type: 'TELEPORT', dest: a.pos, source: o.source, cause: o.cause });
    const pa = a.pos;
    const pb = b.pos;
    a.pos = pb;
    b.pos = pa;
    m1.moved = m2.moved = Math.abs(pa - pb);
    this.log(`${this.nm(a)} y ${this.nm(b)} intercambian sus posiciones (${pa} ↔ ${pb}).`, 'move');
    await this.fx('SWAP', { a: a.id, b: b.id, posA: pb, posB: pa });
    await this.afterMove(a, m1);
    if (!s.over && this.inPlay(b)) await this.afterMove(b, m2);
    return true;
  }

  /** Efectos posteriores a cualquier movimiento: adelantar, detenerse, compartir casilla, otros movimientos. */
  async afterMove(racer, move) {
    const s = this.state;
    for (const pid of move.passed) {
      const p = s.racers[pid];
      if (this.inPlay(p) && this.inPlay(racer)) {
        await this.dispatch('ON_PASS', { mover: racer, passed: p, move, key: `${move.key}:${pid}` });
      }
      if (s.over) return;
    }
    if (!this.inPlay(racer)) return;
    if (racer.pos !== move.dest) return; // desplazado por un efecto de adelantamiento
    if (racer.pos >= this.L) { await this.finish(racer); return; }

    await this.dispatch('ON_STOP', { mover: racer, move, key: move.key });
    if (s.over || !this.inPlay(racer)) return;
    if (racer.pos === move.dest) {
      for (const o of this.othersAt(racer.pos, racer)) {
        if (!this.inPlay(racer)) break;
        await this.dispatch('ON_SHARED_SPACE', { mover: racer, other: o, move, key: `${move.key}:${o.id}` });
        if (s.over) return;
      }
    }
    if (!this.inPlay(racer)) return;
    await this.dispatch('ON_OTHER_PLAYER_MOVE', { mover: racer, move, key: move.key });
    if (s.over || !this.inPlay(racer)) return;
    await this.dispatch('AFTER_MOVEMENT', { mover: racer, move, key: move.key });
  }

  // ------------------------------------------------------------------ casillas del tablero
  async boardStop({ mover, move }) {
    const s = this.state;
    if (!this.inPlay(mover) || mover.pos !== move.dest) return;
    if (move.type === 'TELEPORT' && (!this.config.teleportTriggersBoard || move.cause?.noBoard)) return;
    const sp = this.circuit.spaces[mover.pos];
    switch (sp.type) {
      case 'star': {
        if (this.config.starMode === 'first') {
          if (s.starsClaimed[mover.pos] != null) return;
          s.starsClaimed[mover.pos] = mover.id;
        } else {
          if (mover.starSpaces.includes(mover.pos)) return;
          mover.starSpaces.push(mover.pos);
        }
        mover.stars++;
        this.log(`¡${this.pl(mover)} se detiene en una ESTRELLA y la consigue!`, 'board', mover.id);
        await this.fx('STAR', { racerId: mover.id, pos: mover.pos });
        break;
      }
      case 'arrow': {
        if (this.turn.boardMoves >= this.config.maxBoardChain) { this.log('Cadena de flechas detenida.', 'system'); return; }
        this.turn.boardMoves++;
        const dir = sp.delta > 0 ? 1 : -1;
        this.log(`${this.nm(mover)} pisa una flecha ${sp.delta > 0 ? '+' : ''}${sp.delta}: se mueve ${plural(Math.abs(sp.delta))} ${dir > 0 ? 'hacia delante' : 'hacia atrás'}.`, 'board', mover.id);
        await this.fx('BOARD', { racerId: mover.id, pos: mover.pos, kind: 'arrow', delta: sp.delta });
        await this.moveRacer(mover, { type: 'EXTRA', distance: Math.abs(sp.delta), dir, kind: 'board', cause: { board: true } });
        break;
      }
      case 'trip': {
        this.log(`${this.nm(mover)} pisa una casilla de tropiezo.`, 'board', mover.id);
        await this.fx('BOARD', { racerId: mover.id, pos: mover.pos, kind: 'trip' });
        await this.trip(mover, { hostile: false });
        break;
      }
      case 'portal': {
        if (this.turn.boardMoves >= this.config.maxBoardChain) return;
        this.turn.boardMoves++;
        this.log(`${this.nm(mover)} entra en un portal hacia la casilla ${sp.to}.`, 'board', mover.id);
        await this.fx('BOARD', { racerId: mover.id, pos: mover.pos, kind: 'portal' });
        await this.teleport(mover, sp.to, { cause: { board: true, noBoard: true }, kind: 'portal' });
        break;
      }
      case 'mud': {
        this.log(`${this.nm(mover)} se mete en el barro: -2 a su próximo movimiento principal.`, 'board', mover.id);
        await this.fx('BOARD', { racerId: mover.id, pos: mover.pos, kind: 'mud' });
        this.addMod(mover, { label: 'barro', value: -2 });
        break;
      }
      default:
    }
  }

  // ------------------------------------------------------------------ turnos
  async playTurn() {
    const s = this.state;
    if (s.over) return;
    const actor = s.racers[s.turnOrder[s.cur % s.turnOrder.length]];
    s.cur = s.turnOrder.indexOf(actor.id);
    s.turnNo++;
    this.turn = s.turn = { no: s.turnNo, actorId: actor.id, roll: null, handlers: 0, boardMoves: 0 };
    this.actorGone = false;
    this.chain = [];
    this.depth = 0;

    this.log(`— Turno ${s.turnNo}: ${this.pl(actor)} —`, 'turn', actor.id);
    await this.fx('TURN_START', { racerId: actor.id, turnNo: s.turnNo });
    this.updateCopy(actor);

    if (actor.tripped) {
      actor.tripped = false;
      this.log(`${this.pl(actor)} se levanta del tropiezo y pierde su movimiento principal.`, 'trip', actor.id);
      await this.fx('RECOVER', { racerId: actor.id });
      this.endTurn();
      return;
    }

    await this.dispatch('BEFORE_MAIN_MOVE', { actor, key: `bmm${s.turnNo}` });
    if (s.over) return;
    if (this.inPlay(actor)) {
      await this.waitRoll(actor);
      const raw = await this.rollDie(actor, 'main');
      this.turn.roll = raw;
      this.log(`${this.pl(actor)} saca un ${raw}.`, 'dice', actor.id);
      await this.dispatch('AFTER_DICE_ROLL', { actor, turn: this.turn, key: `adr${s.turnNo}` });
      if (s.over) return;
      if (this.inPlay(actor)) {
        actor.lastRoll = this.turn.roll;
        const applied = [...actor.mods];
        const modSum = applied.reduce((a, m) => a + m.value, 0);
        if (modSum) this.log(`${this.nm(actor)} arrastra ${applied.map((m) => `${m.label} ${m.value}`).join(', ')} al movimiento.`, 'move', actor.id);
        await this.moveRacer(actor, { type: 'MAIN', distance: this.turn.roll + modSum, roll: this.turn.roll, cause: { text: 'Movimiento principal' } });
        const ids = new Set(applied.map((m) => m.id));
        actor.mods = actor.mods.map((m) => (ids.has(m.id) ? { ...m, turns: m.turns - 1 } : m)).filter((m) => m.turns > 0);
        if (s.over) return;
      }
    }
    await this.dispatch('TURN_END', { actor, key: `te${s.turnNo}` });
    if (s.over) return;
    this.endTurn();
  }

  endTurn() {
    const s = this.state;
    if (!s.turnOrder.length) return;
    const extra = this.extraTurnFor;
    this.extraTurnFor = null;
    if (extra && this.inPlay(s.racers[extra]) && s.turnOrder.includes(extra)) {
      s.cur = s.turnOrder.indexOf(extra);
      this.emit('EXTRA_TURN', { racerId: extra });
      return;
    }
    if (this.actorGone) s.cur %= s.turnOrder.length;
    else s.cur = (s.cur + 1) % s.turnOrder.length;
  }

  async run() {
    const s = this.state;
    await this.fx('RACE_START', { circuit: s.circuit, turnOrder: [...s.turnOrder] });
    while (!s.over) {
      if (s.turnNo >= this.config.maxTurnsPerRace) {
        // Salvaguarda: se cierra por posiciones.
        const rest = this.activeRacers().sort((a, b) => b.pos - a.pos);
        for (const r of rest) {
          if (s.finishOrder.length >= 2) break;
          r.place = s.finishOrder.length + 1;
          s.finishOrder.push(r.id);
        }
        s.forced = true;
        s.over = true;
        this.log('Se alcanzó el máximo de turnos: la carrera se cierra por posiciones.', 'system');
        break;
      }
      await this.playTurn();
    }
    await this.fx('RACE_OVER', { finishOrder: [...s.finishOrder] });
    return this.result();
  }

  result() {
    const s = this.state;
    const ids = Object.keys(s.racers);
    return {
      finishOrder: [...s.finishOrder],
      stars: Object.fromEntries(ids.map((id) => [id, s.racers[id].stars])),
      chips: Object.fromEntries(ids.map((id) => [id, s.racers[id].chips])),
      eliminated: ids.filter((id) => s.racers[id].eliminated),
      turns: s.turnNo,
      forced: s.forced,
    };
  }
}
