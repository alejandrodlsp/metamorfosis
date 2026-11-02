// Pruebas del motor: simulación de torneos completos con IA + escenarios de habilidades concretas.
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../shared/config.js';
import { CHARACTERS, CHAR_BY_ID } from '../shared/characters.js';
import { RaceEngine } from '../shared/engine/engine.js';
import * as T from '../shared/engine/tournament.js';
import * as AI from '../shared/engine/ai.js';
import { CIRCUITS } from '../shared/board.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cfg = { ...DEFAULT_CONFIG, animSpeed: 0 };
const triggerCount = {};

function makeIo(rng, level = 'normal') {
  return {
    decide: async (req) => AI.decide(req, rng, level),
  };
}

async function simulateTournament(n, seed) {
  const rng = mulberry32(seed);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}`, color: '#fff' }));
  const t = T.createTournament(players, cfg, rng);
  while (t.phase === 'draft') {
    const pid = T.currentPicker(t);
    T.pickCharacter(t, pid, AI.chooseDraftPick(t, pid, rng));
  }
  while (t.phase === 'select') {
    for (const p of players) T.selectForRace(t, p.id, AI.chooseRaceCharacter(t, p.id, rng));
    const spec = T.buildRace(t, rng);
    const engine = new RaceEngine({ ...spec, config: cfg, rng, io: makeIo(rng) });
    const origEmit = engine.emit.bind(engine);
    engine.emit = (type, data) => {
      if (type === 'ABILITY') triggerCount[data.abilityId] = (triggerCount[data.abilityId] || 0) + 1;
      return origEmit(type, data);
    };
    const result = await engine.run();
    // Invariantes
    for (const r of Object.values(engine.state.racers)) {
      assert.ok(r.pos >= 0 && r.pos <= engine.L, `posición fuera de rango ${r.pos}`);
    }
    assert.ok(result.finishOrder.length <= 2);
    assert.ok(result.forced === false, `carrera forzada (seed ${seed}, n ${n})`);
    assert.ok(result.finishOrder.length === 2 || engine.activeRacers().length === 0, 'la carrera terminó sin 2 finalistas');
    T.scoreRace(t, result);
    if (t.phase === 'result') T.nextRace(t);
  }
  assert.equal(t.phase, 'final');
  const st = T.standings(t);
  assert.equal(st.length, n);
  return { t, st };
}

let runs = 0;
for (const n of [2, 3, 4, 5, 6]) {
  for (let seed = 1; seed <= 25; seed++) {
    await simulateTournament(n, seed * 31 + n);
    runs++;
  }
}
console.log(`OK: ${runs} torneos simulados`);
const never = CHARACTERS.filter((c) => !triggerCount[c.id] && Object.keys(c.hooks).length && !['stickler'].includes(c.id));
console.log('Anuncios por habilidad:', Object.entries(triggerCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('Sin anuncios en simulación:', never.map((c) => c.id).join(', ') || '(ninguna)');

// ------------------------------------------------------------------ escenarios
function scenario(chars, positions, { rolls = [], decide, order } = {}) {
  const rq = [...rolls];
  const rng = () => ((rq.length ? rq.shift() : 3) - 1 + 0.5) / 6;
  const racers = chars.map((c, i) => ({ id: `p${i + 1}`, name: `J${i + 1}`, color: '#fff', charId: c }));
  const e = new RaceEngine({
    circuitId: 'normal', racers, turnOrder: order || racers.map((r) => r.id), config: cfg, rng,
    io: { decide: async (req) => (decide ? decide(req) : AI.decide(req, () => 0.5, 'hard')) },
  });
  positions.forEach((p, i) => { e.state.racers[`p${i + 1}`].pos = p; });
  return e;
}
const R = (e, i) => e.state.racers[`p${i}`];

// Banana: quien la adelanta tropieza
{
  const e = scenario(['banana', 'alchemist'], [5, 3], { order: ['p2', 'p1'], rolls: [3] });
  await e.playTurn(); // J2 tira 3 -> pasa por encima de banana (pos 5)? 3->6 pasa la 5
  assert.equal(R(e, 2).pos, 6 + 0, 'alquimista termina en 6');
  assert.equal(R(e, 2).tripped, true, 'banana hace tropezar');
}
// Centauro: adelanta y hace retroceder 2 (acepta)
{
  const e = scenario(['centaur', 'alchemist'], [2, 5], { rolls: [4] });
  await e.playTurn(); // centauro 2 -> 6 pasa al alquimista en 5
  assert.equal(R(e, 2).pos, 2, 'rival retrocede 3');
}
// Retroceso nunca por debajo de 0
{
  const e = scenario(['centaur', 'alchemist'], [0, 1], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 2).pos, 0);
}
// Huevo inmune al centauro
{
  const e = scenario(['centaur', 'egg'], [2, 5], { rolls: [4] });
  await e.playTurn();
  assert.equal(R(e, 2).pos, 5, 'huevo protegido');
}
// Baba Yaga al compartir casilla
{
  const e = scenario(['alchemist', 'babayaga'], [1, 4], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 1).pos, 4);
  assert.equal(R(e, 1).tripped, true);
  assert.equal(R(e, 2).tripped, false);
}
// Bebé gigante bloquea terminar en su casilla
{
  const e = scenario(['alchemist', 'hugebaby'], [1, 4], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 1).pos, 3);
}
// Casilla de flecha: normal[5]=+2 -> 7 (estrella)
{
  const e = scenario(['alchemist', 'legs'], [2, 0], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 1).pos, 7);
  assert.equal(R(e, 1).stars, 1);
}
// Casilla de tropiezo (9) -> pierde siguiente movimiento
{
  const e = scenario(['alchemist', 'legs'], [6, 0], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 1).pos, 9);
  assert.equal(R(e, 1).tripped, true);
  await e.playTurn(); // J2
  await e.playTurn(); // J1 se levanta
  assert.equal(R(e, 1).pos, 9);
  assert.equal(R(e, 1).tripped, false);
}
// Dos finalistas terminan la carrera; el resto sale
{
  const e = scenario(['alchemist', 'legs', 'coach'], [28, 29, 10], { rolls: [3, 3, 3] });
  const res = await e.run();
  assert.equal(res.finishOrder.length, 2);
  assert.equal(R(e, 3).finished, false);
}
// Hare se duerme si lidera en solitario
{
  const e = scenario(['hare', 'alchemist'], [10, 3], { rolls: [4] });
  await e.playTurn();
  assert.equal(R(e, 1).pos, 10, 'la liebre duerme');
}
// Hypnotist teletransporta al líder a su casilla
{
  const e = scenario(['hypnotist', 'alchemist'], [2, 12], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 2).pos, 2, 'rival teletransportado (a 2); la IA lo usa con 10 de ventaja');
}
// Cadena Scoocher + Centauro: movimientos adicionales de otros hacen avanzar al Escurridizo
{
  const e = scenario(['centaur', 'alchemist', 'scoocher'], [2, 5, 0], { rolls: [4] });
  await e.playTurn();
  assert.equal(R(e, 2).pos, 2);
  assert.equal(R(e, 3).pos >= 1, true, 'scoocher aprovecha');
}
// M.O.U.T.H. elimina; el eliminado sale del orden de turnos
{
  const e = scenario(['mouth', 'alchemist', 'legs'], [10, 14, 0], { rolls: [4] });
  await e.playTurn();
  assert.equal(R(e, 2).eliminated, true);
  assert.equal(e.state.turnOrder.includes('p2'), false);
}
// Gato Copión copia la habilidad del líder
{
  const e = scenario(['copycat', 'banana'], [0, 9], { rolls: [3] });
  await e.playTurn();
  assert.equal(R(e, 1).copiedId, 'banana');
}
// Mismo evento con varias habilidades simultáneas: dirigible + entrenador + liebre, sin romper
{
  const e = scenario(['coach', 'blimp', 'hare', 'partyanimal', 'twin', 'scoocher'], [3, 3, 3, 3, 3, 3], { rolls: [3, 4, 5, 6, 2, 1, 3, 3] });
  for (let i = 0; i < 12; i++) await e.playTurn();
  for (const r of Object.values(e.state.racers)) assert.ok(r.pos >= 0 && r.pos <= e.L);
}

// Todas las habilidades están definidas por datos completos
assert.equal(CHARACTERS.length, 36);
for (const c of CHARACTERS) {
  for (const k of ['id', 'name', 'category', 'type', 'desc', 'activation', 'effect', 'interactions', 'animation', 'title']) assert.ok(c[k], `${c.id}.${k}`);
}
assert.ok(CIRCUITS.normal.length > 0 && CIRCUITS.wild.spaces.length === CIRCUITS.wild.length + 1);
console.log('OK: escenarios de habilidades');
