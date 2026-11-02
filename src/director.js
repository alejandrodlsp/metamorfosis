// Director de animaciones: reproduce en orden los eventos del servidor sin bloquear la lógica.
import { S } from './store.js';
import { G } from './ctx.js';
import { sfx } from './audio.js';
import { CIRCUITS } from '../shared/board.js';
import { CHAR_BY_ID } from '../shared/characters.js';

const KIND_COLORS = { arrow: 0x55d6c9, trip: 0xff4d4d, portal: 0xb388ff, mud: 0xa8743d, star: 0xffd23f };

export class Director {
  constructor() {
    this.queue = [];
    this.running = false;
    this.pending = null;
    this.idleWaiters = [];
    this.raceKey = null;
  }

  get busy() { return this.running || this.queue.length > 0; }

  whenIdle(fn) {
    if (!this.busy) fn(); else this.idleWaiters.push(fn);
  }

  /** Estado completo (mensaje "game"). */
  onGame(msg) {
    const race = msg.race;
    if (msg.t.phase === 'race' || msg.t.phase === 'result' || msg.t.phase === 'final') {
      if (race) {
        if (this.busy) this.pending = race;
        else this.applyRace(race, true);
      }
    }
  }

  applyRace(race, maybeStart = false) {
    const key = `${race.raceNumber}:${race.circuit}`;
    if (maybeStart && this.raceKey !== key) this.startRace(race);
    S.race = race;
    G.world.syncRacers(race);
    G.hud?.refresh();
  }

  startRace(race) {
    this.raceKey = `${race.raceNumber}:${race.circuit}`;
    const w = G.world;
    w.setCircuit(race.circuit);
    w.resetRace();
    w.setMode('race');
    w.followOn = S.opts.followCam;
    w.syncRacers(race);
    w.fitBoard();
    S.race = race;
    if (!race.turnNo) {
      S.log = [];
      G.hud?.clearLog();
    }
  }

  push(batch) {
    this.queue.push(batch);
    this.pending = null;
    if (!this.running) this.run();
  }

  async run() {
    this.running = true;
    try {
      while (this.queue.length) {
        const b = this.queue.shift();
        G.world.timeScale = this.queue.length > 4 ? 0.3 : this.queue.length > 1 ? 0.6 : 1;
        if (b.race && (!S.race || this.raceKey !== `${b.race.raceNumber}:${b.race.circuit}`)) this.startRace(b.race);
        for (const ev of b.events) await this.play(ev, b.race);
        S.race = b.race;
        G.world.syncRacers(b.race);
        G.hud?.refresh();
      }
      if (this.pending) { this.applyRace(this.pending, true); this.pending = null; }
    } catch (e) {
      console.error('[director]', e);
    }
    this.running = false;
    G.world.timeScale = 1;
    const waiters = this.idleWaiters.splice(0);
    for (const fn of waiters) fn();
  }

  racerName(id, race) {
    const r = (race || S.race)?.racers[id];
    return r ? CHAR_BY_ID[r.charId].name : '';
  }

  async play(ev, race) {
    const w = G.world;
    const hud = G.hud;
    switch (ev.type) {
      case 'LOG': hud?.log(ev.text, ev.kind); break;
      case 'RACE_START':
        hud?.banner({ name: 'Carrera', title: CIRCUITS[ev.circuit]?.name, text: `¡Comienza la carrera ${race?.raceNumber ?? ''}! ${CIRCUITS[ev.circuit]?.tagline ?? ''}`, anim: 'pulse' });
        await w.sleep(900);
        break;
      case 'TURN_START':
        S.activeId = ev.racerId;
        w.setActive(ev.racerId);
        hud?.refresh();
        sfx.turn();
        await w.sleep(280);
        break;
      case 'DICE': {
        const r = (race || S.race)?.racers[ev.racerId];
        hud?.diceStart(ev.racerId, ev.purpose);
        sfx.dice();
        await G.dice.roll(ev.value, r?.color || '#3d8bff');
        hud?.diceResult(ev.racerId, ev.value, ev.purpose);
        w.floatText(ev.racerId, String(ev.value), '#fff');
        await w.sleep(260);
        break;
      }
      case 'MOVE': {
        await w.moveRacer(ev.racerId, ev.from, ev.to, { type: ev.moveType, dir: ev.dir });
        if (ev.moveType === 'TELEPORT') w.floatText(ev.racerId, '✦ Teletransporte', '#d1b3ff');
        else if (ev.moveType === 'EXTRA') w.floatText(ev.racerId, `${ev.dir > 0 ? '+' : '−'}${ev.distance}`, ev.dir > 0 ? '#ffb347' : '#ff6b6b');
        else w.floatText(ev.racerId, `+${ev.distance}`, '#fff');
        break;
      }
      case 'SWAP': await w.swapRacers(ev.a, ev.b, ev.posA, ev.posB); break;
      case 'BOARD': {
        w.tileFlash(ev.pos, KIND_COLORS[ev.kind] || 0xffffff);
        const label = { arrow: ev.delta > 0 ? `➡ +${ev.delta}` : `⬅ ${ev.delta}`, trip: '⚠ Tropiezo', portal: '🌀 Portal', mud: '🟤 Barro −2' }[ev.kind];
        if (label) w.floatText(ev.racerId, label, '#fff');
        await w.sleep(260);
        break;
      }
      case 'STAR':
        w.claimStar(ev.pos);
        w.floatText(ev.racerId, '⭐ ¡Estrella!', '#ffd23f');
        await w.sleep(700);
        break;
      case 'TRIP': await w.trip(ev.racerId); await w.sleep(250); break;
      case 'RECOVER': await w.recover(ev.racerId); break;
      case 'ELIM': await w.eliminate(ev.racerId); break;
      case 'FINISH':
        hud?.banner({ name: this.racerName(ev.racerId, race), title: 'Meta', text: `¡Cruza la meta en ${ev.place}º lugar!`, anim: 'confetti' });
        await w.finishRacer(ev.racerId, ev.place);
        break;
      case 'SHIELD':
        w.abilityFx(ev.racerId, 'shield');
        w.floatText(ev.racerId, '¡Inmune!', '#59d2ff');
        await w.sleep(500);
        break;
      case 'ABILITY':
        hud?.banner(ev);
        w.abilityFx(ev.racerId, ev.anim, ev.targets);
        await w.sleep(Math.min(900, (ev.ms ?? 1000) * 0.8));
        break;
      case 'CHIP':
        w.floatText(ev.racerId, `+${ev.n} ficha`, '#7cf3a0');
        sfx.star();
        break;
      case 'MOD': w.floatText(ev.racerId, `${ev.value} ${ev.label}`, '#ff9f6b'); break;
      case 'ORDER': hud?.refresh(); break;
      case 'EXTRA_TURN': hud?.banner({ name: this.racerName(ev.racerId, race), title: 'Turno extra', text: '¡Juega otro turno seguido!', anim: 'dash' }); break;
      case 'RACE_OVER':
        hud?.banner({ name: 'Carrera', title: 'Fin', text: '¡Se acabó la carrera! Dos corredores han cruzado la meta.', anim: 'confetti' });
        sfx.win();
        await w.sleep(1200);
        break;
      default:
    }
  }
}
