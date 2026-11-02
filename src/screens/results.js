import { h } from '../dom.js';
import { S, isHost, myId } from '../store.js';
import { net } from '../net.js';
import { G } from '../ctx.js';
import { button, timerEl } from '../components.js';
import { avatar } from '../assets.js';
import { sfx } from '../audio.js';
import { CHAR_BY_ID } from '../../shared/characters.js';
import { CIRCUITS } from '../../shared/board.js';
import { standings } from '../../shared/engine/tournament.js';

let ackedRace = 0;

const pinfo = (id) => S.t.players.find((p) => p.id === id);
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}º`);

export function renderResult() {
  const t = S.t;
  const lr = t.lastResult;
  if (!lr) return h('div');
  const rows = [...lr.rows].sort((a, b) => (a.place ?? 9) - (b.place ?? 9) || b.total - a.total);
  const table = h('table', { class: 'table' },
    h('thead', null, h('tr', null, ['Puesto', 'Jugador', 'Personaje', 'Posición', 'Estrellas', 'Fichas', 'Carrera', 'Total'].map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r) => {
      const p = pinfo(r.playerId);
      return h('tr', { style: { '--owner': p.color }, class: r.place ? 'podium' : '' },
        h('td', null, r.place ? medal(r.place) : r.eliminated ? '☠' : '—'),
        h('td', null, h('span', { class: 'dot', style: { background: p.color } }), p.name, p.id === myId() && h('span', { class: 'badge me' }, 'TÚ')),
        h('td', null, CHAR_BY_ID[r.charId].name),
        h('td', null, r.placePts ? `+${r.placePts}` : '0'),
        h('td', null, `${r.stars} (+${r.starPts})`),
        h('td', null, `${r.chips} (+${r.chipPts})`),
        h('td', { class: 'strong' }, `+${r.total}`),
        h('td', { class: 'strong' }, t.scores[r.playerId].total));
    })));
  const acked = ackedRace === t.raceNumber;
  return h('div', { class: 'overlay result' },
    h('div', { class: 'panel result-panel' },
      h('h2', null, `¡Carrera ${lr.raceNumber} terminada!`),
      h('div', { class: 'muted' }, CIRCUITS[lr.circuit].name),
      table,
      h('div', { class: 'row end' },
        S.awaiting?.kind === 'ack' && S.awaiting.deadline ? h('span', { class: 'muted' }, 'Siguiente carrera en ', timerEl(S.awaiting.deadline)) : null,
        button(acked ? 'Esperando a los demás…' : lr.raceNumber >= t.config.races ? 'Ver resultado final' : 'Continuar →', () => {
          ackedRace = t.raceNumber;
          net.send({ type: 'ack' });
          document.querySelector('.result-panel .btn.primary')?.classList.add('disabled');
        }, `primary xl ${acked ? 'disabled' : ''}`))));
}

export const final = {
  timer: null,
  mount(root) {
    this.root = root;
    G.world.setMode('showcase');
    sfx.win();
    this.timer = setInterval(() => {
      const w = G.world;
      const p = w.center.clone();
      p.x += (Math.random() - 0.5) * w.rx * 1.4;
      p.z += (Math.random() - 0.5) * w.rz * 1.2;
      p.y = 6 + Math.random() * 6;
      w.confetti(p);
    }, 700);
    this.update();
  },
  unmount() { clearInterval(this.timer); },
  update() {
    const t = S.t;
    if (!t) return;
    const st = standings(t);
    const winners = st.filter((r) => r.rank === 1);
    const me = myId();
    const names = winners.map((w) => pinfo(w.playerId).name).join(' y ');
    const podium = h('div', { class: 'podium-row' }, [st[1], st[0], st[2]].filter(Boolean).map((r) => {
      const p = pinfo(r.playerId);
      return h('div', { class: `podium-col rank-${r.rank}`, style: { '--owner': p.color } },
        h('div', { class: 'podium-medal' }, medal(r.rank)),
        h('div', { class: 'podium-name' }, p.name),
        h('div', { class: 'podium-pts' }, `${r.total} pts`),
        h('div', { class: 'podium-block' }));
    }));
    const detail = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Jugador'), t.scores[t.players[0].id].races.map((_, i) => h('th', null, `C${i + 1}`)), h('th', null, 'Total'))),
      h('tbody', null, st.map((r) => {
        const p = pinfo(r.playerId);
        return h('tr', { class: r.rank === 1 ? 'podium' : '' },
          h('td', null, medal(r.rank)),
          h('td', null, h('span', { class: 'dot', style: { background: p.color } }), p.name, p.id === me && h('span', { class: 'badge me' }, 'TÚ')),
          t.scores[r.playerId].races.map((x) => h('td', { title: CHAR_BY_ID[x.charId].name }, h('div', { class: 'cell-char' }, avatar(x.charId, 'tiny')), `${x.total}`)),
          h('td', { class: 'strong' }, r.total));
      })));
    this.root.replaceChildren(h('div', { class: 'screen narrow final' },
      h('div', { class: 'winner' }, h('div', { class: 'trophy' }, '🏆'), h('h1', null, winners.length > 1 ? `¡Empate entre ${names}!` : `¡${names} gana el torneo!`),
        winners.some((w) => w.playerId === me) && h('div', { class: 'muted' }, '¡Enhorabuena, campeón!')),
      podium,
      h('div', { class: 'panel' }, h('h3', null, 'Clasificación final'), detail),
      h('div', { class: 'row center' },
        isHost() ? button('🔁 Nuevo torneo (volver a la sala)', () => net.send({ type: 'playAgain' }), 'primary xl') : h('div', { class: 'muted' }, 'El anfitrión puede iniciar otro torneo…'),
        button('Salir', () => net.send({ type: 'leave' }), 'ghost'))));
  },
};
