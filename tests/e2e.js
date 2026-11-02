// Prueba de integración: un cliente humano simulado juega un torneo completo contra bots por WebSocket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 3999;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), ROOMS_FILE: '/tmp/mil-prodigios-test.json' }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const state = { me: null, game: null, room: null, rolls: 0, decisions: 0, events: 0, phases: new Set() };
const send = (m) => ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'joined') state.me = m;
  if (m.type === 'error') console.log('ERROR', m.message);
  if (m.type === 'room') state.room = m.room;
  if (m.type === 'game') {
    state.game = m; state.room = m.room; state.phases.add(m.t.phase);
    const t = m.t;
    const aw = m.awaiting;
    if (t.phase === 'draft' && aw?.kind === 'draft' && aw.playerId === state.me.playerId) {
      const free = ['magician', 'legs', 'centaur', 'duelist', 'alchemist', 'blimp', 'coach', 'babayaga', 'banana', 'cheerleader', 'hare', 'hypnotist']
        .find((c) => !t.draft.taken[c]) || Object.keys(t.draft.taken)[0];
      const all = ['rocket', 'hugebaby', 'mouth', 'copycat', 'dicemonger', 'genius', 'heckler', 'egg', 'gunk', 'flipflop', 'inchworm', 'mastermind', 'lackey', 'loveableloser', 'leaptoad', 'partyanimal', 'sisyphus', 'romantic', 'scoocher', 'stickler', 'suckerfish', 'thirdwheel', 'twin', 'skipper'];
      send({ type: 'draftPick', charId: [free, ...all].find((c) => !t.draft.taken[c]) });
    }
    if (t.phase === 'select' && !t.selection[state.me.playerId]) {
      const mine = t.draft.picks[state.me.playerId].filter((c) => !t.used[state.me.playerId].includes(c));
      send({ type: 'selectChar', charId: mine[0] });
    }
    if (t.phase === 'result' || (t.phase === 'final' && false)) send({ type: 'ack' });
    if (t.phase === 'final') send({ type: 'playAgain' });
  }
  if (m.type === 'events') {
    state.events += m.events.length;
    if (m.race.awaiting?.kind === 'roll' && m.race.awaiting.playerId === state.me.playerId) { state.rolls++; send({ type: 'roll' }); }
  }
  if (m.type === 'request') {
    state.decisions++;
    const best = m.request.options.reduce((a, b) => ((b.aiValue ?? 0) > (a.aiValue ?? 0) ? b : a));
    send({ type: 'decide', requestId: m.request.id, answer: best.id });
  }
});
await new Promise((r) => ws.once('open', r));
send({ type: 'createRoom', name: 'Tester', password: 'secreto' });
await sleep(300);
assert.ok(state.me?.code, 'sala creada');
for (let i = 0; i < 3; i++) send({ type: 'addBot', level: 'hard' });
send({ type: 'settings', settings: { animSpeed: 0, rollSeconds: 0 } });
await sleep(300);
assert.equal(state.room.players.length, 4);

// Segundo cliente: contraseña incorrecta
const bad = new WebSocket(`ws://localhost:${PORT}/ws`);
const badMsgs = [];
bad.on('message', (r) => badMsgs.push(JSON.parse(r.toString())));
await new Promise((r) => bad.once('open', r));
bad.send(JSON.stringify({ type: 'joinRoom', code: state.me.code, password: 'mal', name: 'X' }));
await sleep(300);
assert.ok(badMsgs.some((m) => m.type === 'error'), 'contraseña incorrecta rechazada');
bad.close();

send({ type: 'start' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  await sleep(300);
  if (state.game?.t.phase === 'final') break;
  if (Date.now() - t0 > 5000 && Math.round((Date.now() - t0) / 300) % 20 === 0) console.log('...', state.game?.t.phase, 'race', state.game?.t.raceNumber, JSON.stringify(state.game?.awaiting), 'events', state.events, 'rolls', state.rolls);
}
assert.equal(state.game?.t.phase, 'final', `no llegó al final: ${state.game?.t.phase}`);
assert.ok(state.decisions > 0, 'el humano debió recibir decisiones de habilidades opcionales');
console.log('OK: torneo completo por WebSocket. fases:', [...state.phases].join(','), 'tiradas humanas:', state.rolls, 'decisiones:', state.decisions, 'eventos:', state.events);
const scores = Object.entries(state.game.t.scores).map(([k, v]) => `${k}:${v.total}`).join(' ');
console.log('Marcador:', scores);
send({ type: 'playAgain' });
await sleep(500);
assert.equal(state.room.phase, 'lobby');
ws.close();
srv.kill();
process.exit(0);
