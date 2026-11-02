// Inteligencia artificial: decisiones de habilidades, draft y selección de personaje por carrera.
import { CHAR_BY_ID, CHARACTER_IDS } from '../characters.js';
import { availableToDraft, remainingCharacters } from './tournament.js';

const NOISE = { easy: 3, normal: 0.7, hard: 0.05 };
const noise = (rng, level) => (rng() - 0.5) * 2 * (NOISE[level] ?? NOISE.normal);

/** Elige una opción de una petición de decisión. Devuelve el id de la opción o null (omitir). */
export function decide(req, rng = Math.random, level = 'normal') {
  const opts = req.options;
  if (req.type === 'confirm') {
    const yes = opts.find((o) => o.id === 'yes');
    const no = opts.find((o) => o.id === 'no');
    const score = (yes.aiValue ?? 0) + noise(rng, level);
    return score > (no.aiValue ?? 0) ? 'yes' : 'no';
  }
  let best = null;
  let bestScore = -Infinity;
  for (const o of opts) {
    const s = (o.aiValue ?? 0) + noise(rng, level) + rng() * 1e-3;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  if (req.allowSkip && (!best || bestScore <= 0)) return null;
  return best ? best.id : null;
}

const value = (c, circuit) => (circuit === 'wild' ? c.ai.w : c.ai.n);

export function chooseDraftPick(t, pid, rng = Math.random, level = 'normal') {
  const mine = t.draft.picks[pid].map((id) => CHAR_BY_ID[id]);
  const cats = new Set(mine.map((c) => c.category));
  const optionals = mine.filter((c) => c.type === 'optional').length;
  const wildAvg = mine.length ? mine.reduce((a, c) => a + c.ai.w, 0) / mine.length : 6;
  let best = null;
  let bestScore = -Infinity;
  for (const id of availableToDraft(t)) {
    const c = CHAR_BY_ID[id];
    let s = (c.ai.n + c.ai.w) / 2;
    if (!cats.has(c.category)) s += 0.8; // variedad de habilidades
    if (c.id === 'stickler' && optionals >= 2) s -= 1.5; // choca con mis habilidades opcionales
    if (c.type === 'optional' && optionals >= 3) s -= 0.7;
    if (wildAvg < 5.5 && c.ai.w > c.ai.n) s += 0.5; // equilibrio entre circuitos
    s += noise(rng, level);
    if (s > bestScore) { bestScore = s; best = id; }
  }
  return best;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/** Asigna los personajes restantes a las carreras restantes maximizando el valor total y devuelve el de esta carrera. */
export function chooseRaceCharacter(t, pid, rng = Math.random, level = 'normal') {
  const rem = remainingCharacters(t, pid);
  if (rem.length <= 1) return rem[0];
  const circuits = [];
  for (let r = t.raceNumber; r <= t.config.races; r++) circuits.push(t.config.circuitOrder[(r - 1) % t.config.circuitOrder.length]);
  const used = circuits.slice(0, rem.length);
  let best = rem[0];
  let bestScore = -Infinity;
  for (const perm of permutations(rem)) {
    const s = perm.reduce((a, id, i) => a + value(CHAR_BY_ID[id], used[i]), 0) + noise(rng, level);
    if (s > bestScore) { bestScore = s; best = perm[0]; }
  }
  return best;
}

export const allCharacterIds = CHARACTER_IDS;
