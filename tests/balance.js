// Estadística de equilibrio: usa cada personaje en carreras aleatorias de 4 jugadores.
import { DEFAULT_CONFIG } from '../shared/config.js';
import { CHARACTERS } from '../shared/characters.js';
import { RaceEngine } from '../shared/engine/engine.js';
import * as AI from '../shared/engine/ai.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cfg = { ...DEFAULT_CONFIG, animSpeed: 0 };
const rng = mulberry32(12345);
const stat = Object.fromEntries(CHARACTERS.map((c) => [c.id, { n: 0, pts: 0 }]));
const N = Number(process.argv[2] || 600);
for (let i = 0; i < N; i++) {
  const circuitId = i % 2 ? 'wild' : 'normal';
  const pool = [...CHARACTERS].sort(() => rng() - 0.5).slice(0, 4);
  const racers = pool.map((c, k) => ({ id: `p${k}`, name: `J${k}`, color: '#fff', charId: c.id }));
  const e = new RaceEngine({ circuitId, racers, turnOrder: racers.map((r) => r.id).sort(() => rng() - 0.5), config: cfg, rng, io: { decide: async (r) => AI.decide(r, rng, 'normal') } });
  const res = await e.run();
  racers.forEach((r) => { stat[r.charId].n++; });
  res.finishOrder.forEach((id, idx) => { stat[racers.find((r) => r.id === id).charId].pts += idx === 0 ? 3 : 1.5; });
}
const rows = Object.entries(stat).map(([id, s]) => [id, s.n, (s.pts / s.n).toFixed(2)]).sort((a, b) => b[2] - a[2]);
console.log(rows.map((r) => `${r[0].padEnd(14)} n=${String(r[1]).padStart(4)} avg=${r[2]}`).join('\n'));
