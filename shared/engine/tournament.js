// Estado de torneo (draft, selección por carrera, puntuación). Puro y serializable (JSON).
import { CIRCUIT_ALTERNATE } from '../config.js';
import { CHAR_BY_ID, CHARACTER_IDS } from '../characters.js';

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function snakeOrder(ids, picks) {
  const out = [];
  for (let r = 0; r < picks; r++) out.push(...(r % 2 === 0 ? ids : [...ids].reverse()));
  return out;
}

export function createTournament(players, config, rng = Math.random) {
  const ids = shuffle(players.map((p) => p.id), rng); // el primer pick se sortea
  return {
    config,
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    phase: 'draft',
    raceNumber: 0,
    seat: players.map((p) => p.id),
    lastOrder: ids,
    draft: { order: snakeOrder(ids, config.picksPerPlayer), index: 0, picks: Object.fromEntries(ids.map((i) => [i, []])), taken: {} },
    used: Object.fromEntries(ids.map((i) => [i, []])),
    selection: {},
    scores: Object.fromEntries(ids.map((i) => [i, { total: 0, races: [] }])),
    lastResult: null,
  };
}

// ---------------------------------------------------------------- draft
export const currentPicker = (t) => (t.phase === 'draft' ? t.draft.order[t.draft.index] : null);

export function pickError(t, pid, charId) {
  if (t.phase !== 'draft') return 'No es la fase de selección.';
  if (currentPicker(t) !== pid) return 'No es tu turno de elegir.';
  if (!CHAR_BY_ID[charId]) return 'Personaje inexistente.';
  if (t.draft.taken[charId]) return 'Ese personaje ya fue elegido.';
  return null;
}

export function pickCharacter(t, pid, charId) {
  const err = pickError(t, pid, charId);
  if (err) throw new Error(err);
  t.draft.picks[pid].push(charId);
  t.draft.taken[charId] = pid;
  t.draft.index++;
  if (t.draft.index >= t.draft.order.length) beginSelection(t);
}

export const availableToDraft = (t) => CHARACTER_IDS.filter((id) => !t.draft.taken[id]);

// ---------------------------------------------------------------- selección por carrera
export function beginSelection(t) {
  t.raceNumber++;
  t.phase = 'select';
  t.selection = {};
}

export const remainingCharacters = (t, pid) => t.draft.picks[pid].filter((c) => !t.used[pid].includes(c));

export function selectError(t, pid, charId) {
  if (t.phase !== 'select') return 'No es la fase de selección de carrera.';
  if (!remainingCharacters(t, pid).includes(charId)) return 'Ese personaje no está disponible para ti.';
  return null;
}

export function selectForRace(t, pid, charId) {
  const err = selectError(t, pid, charId);
  if (err) throw new Error(err);
  t.selection[pid] = charId;
}

export const allSelected = (t) => t.players.every((p) => t.selection[p.id]);

export const circuitOf = (t) => CIRCUIT_ALTERNATE(t.config, t.raceNumber);

export function turnOrderForRace(t, rng) {
  const ids = t.players.map((p) => p.id);
  const mode = t.config.turnOrder;
  if (mode === 'seat') return t.seat.filter((i) => ids.includes(i));
  if (mode === 'random' || t.raceNumber === 1) return shuffle(ids, rng);
  return [...ids].sort((a, b) => t.scores[a].total - t.scores[b].total || t.lastOrder.indexOf(a) - t.lastOrder.indexOf(b));
}

/** Prepara los datos para crear el motor de carrera. */
export function buildRace(t, rng) {
  const order = turnOrderForRace(t, rng);
  t.lastOrder = order;
  t.phase = 'race';
  return {
    circuitId: circuitOf(t),
    raceNumber: t.raceNumber,
    turnOrder: order,
    racers: t.players.map((p) => ({ id: p.id, name: p.name, color: p.color, charId: t.selection[p.id] })),
  };
}

// ---------------------------------------------------------------- puntuación
export function scoreRace(t, result) {
  const sc = t.config.scoring;
  const table = sc.place[Math.min(t.raceNumber, sc.place.length) - 1];
  const rows = [];
  for (const p of t.players) {
    const idx = result.finishOrder.indexOf(p.id);
    const place = idx === 0 ? 1 : idx === 1 ? 2 : null;
    const placePts = place ? table[place - 1] : 0;
    const stars = result.stars[p.id] || 0;
    const chips = result.chips[p.id] || 0;
    const starPts = stars * sc.starPoints;
    const chipPts = chips * sc.chipPoints;
    const row = {
      charId: t.selection[p.id], place, placePts, stars, starPts, chips, chipPts,
      eliminated: result.eliminated.includes(p.id), total: placePts + starPts + chipPts,
    };
    t.scores[p.id].races.push(row);
    t.scores[p.id].total += row.total;
    t.used[p.id].push(row.charId);
    rows.push({ playerId: p.id, ...row });
  }
  t.lastResult = { raceNumber: t.raceNumber, circuit: circuitOf(t), rows, finishOrder: result.finishOrder };
  t.phase = 'result';
  return t.lastResult;
}

export function nextRace(t) {
  if (t.phase !== 'result') return;
  if (t.raceNumber >= t.config.races) t.phase = 'final';
  else beginSelection(t);
}

export function standings(t) {
  const rows = t.players.map((p) => {
    const s = t.scores[p.id];
    return {
      playerId: p.id, total: s.total,
      firsts: s.races.filter((r) => r.place === 1).length,
      seconds: s.races.filter((r) => r.place === 2).length,
      stars: s.races.reduce((a, r) => a + r.stars, 0),
    };
  });
  const key = (r) => [r.total, r.firsts, r.seconds, r.stars];
  const cmp = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]; return 0; };
  rows.sort(cmp);
  rows.forEach((r, i) => { r.rank = i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
