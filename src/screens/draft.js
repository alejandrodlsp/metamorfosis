import { h } from '../dom.js';
import { S, myId } from '../store.js';
import { net } from '../net.js';
import { G } from '../ctx.js';
import { button, charCard, abilityDetail, compareModal, timerEl } from '../components.js';
import { avatar } from '../assets.js';
import { CHARACTERS, CATEGORIES, CHAR_BY_ID } from '../../shared/characters.js';
import { CIRCUITS } from '../../shared/board.js';
import { circuitOf, remainingCharacters } from '../../shared/engine/tournament.js';

function pickSlots(ids, total, used = []) {
  return h('div', { class: 'pick-slots' }, Array.from({ length: total }, (_, i) => {
    const id = ids[i];
    return id
      ? h('div', { class: `pick-slot ${used.includes(id) ? 'used' : ''}`, title: CHAR_BY_ID[id].name }, avatar(id))
      : h('div', { class: 'pick-slot empty' }, '?');
  }));
}

// ---------------------------------------------------------------- Draft
export const draft = {
  st: { sel: null, cat: '', compare: [] },
  mount(root) { this.root = root; G.world.setMode('showcase'); this.update(); },
  unmount() {},
  update() {
    const t = S.t;
    if (!t || t.phase !== 'draft') return;
    const st = this.st;
    const d = t.draft;
    const n = t.players.length;
    const cur = d.order[d.index];
    const me = myId();
    const myTurn = cur === me;
    const ordered = d.order.slice(0, n).map((id) => t.players.find((p) => p.id === id));
    const curPlayer = t.players.find((p) => p.id === cur);
    const round = Math.floor(d.index / n) + 1;

    const list = CHARACTERS.filter((c) => !st.cat || c.category === st.cat);
    const grid = h('div', { class: 'cards' }, list.map((c) => {
      const owner = d.taken[c.id] && t.players.find((p) => p.id === d.taken[c.id]);
      return charCard(c.id, {
        selected: st.sel === c.id, dim: !!owner, ownerColor: owner?.color, ownerName: owner?.name,
        onClick: (id) => { st.sel = id; this.update(); },
      });
    }));

    const selId = st.sel;
    const selTaken = selId && d.taken[selId];
    const inCompare = selId && st.compare.includes(selId);
    const side = h('div', { class: 'side-detail' },
      selId ? abilityDetail(selId) : h('div', { class: 'panel muted' }, 'Pulsa una carta para ver su habilidad completa.'),
      selId && h('div', { class: 'row' },
        button(inCompare ? 'Quitar de comparar' : 'Comparar', () => {
          st.compare = inCompare ? st.compare.filter((x) => x !== selId) : [...st.compare, selId].slice(-2);
          this.update();
        }, 'small'),
        st.compare.length === 2 && button('Ver comparación', () => compareModal(st.compare), 'small accent')),
      selId && button(selTaken ? 'Ya elegido' : myTurn ? `ELEGIR ${CHAR_BY_ID[selId].name.toUpperCase()}` : 'Espera tu turno', () => {
        if (myTurn && !selTaken) net.send({ type: 'draftPick', charId: selId });
      }, `primary xl ${!myTurn || selTaken ? 'disabled' : ''}`));

    const players = h('div', { class: 'panel players-panel' }, h('h3', null, 'Jugadores'), ordered.map((p) => h('div', { class: `pp ${p.id === cur ? 'current' : ''}`, style: { '--owner': p.color } },
      h('div', { class: 'pp-name' }, h('span', { class: 'dot', style: { background: p.color } }), p.name, p.id === me && h('span', { class: 'badge me' }, 'TÚ')),
      pickSlots(d.picks[p.id], t.config.picksPerPlayer))));

    this.root.replaceChildren(h('div', { class: 'screen wide draft' },
      h('div', { class: 'topbar' },
        h('h2', null, 'DRAFT SERPENTEANTE'),
        h('div', { class: `turn-banner ${myTurn ? 'mine' : ''}` },
          myTurn ? '¡ES TU TURNO DE ELEGIR!' : `Elige ${curPlayer?.name ?? '…'}`,
          S.awaiting?.kind === 'draft' && S.awaiting.deadline ? timerEl(S.awaiting.deadline) : null),
        h('div', { class: 'muted' }, `Ronda ${round}/${t.config.picksPerPlayer} · elección ${d.index + 1}/${d.order.length}`)),
      h('div', { class: 'draft-grid' },
        players,
        h('div', { class: 'col grow' },
          h('div', { class: 'filters' }, h('select', { class: 'input', onChange: (e) => { st.cat = e.target.value; this.update(); } },
            h('option', { value: '' }, 'Todas las categorías'), CATEGORIES.map((c) => h('option', { value: c, selected: c === st.cat }, c)))),
          grid),
        side)));
  },
};

// ---------------------------------------------------------------- Selección de personaje por carrera
export const select = {
  sel: null,
  mount(root) { this.root = root; G.world.setMode('showcase'); this.sel = null; this.update(); },
  unmount() {},
  update() {
    const t = S.t;
    if (!t || t.phase !== 'select') return;
    const me = myId();
    const circuit = CIRCUITS[circuitOf(t)];
    const counts = {};
    circuit.spaces.forEach((s) => { counts[s.type] = (counts[s.type] || 0) + 1; });
    const mine = remainingCharacters(t, me);
    const chosen = t.selection[me];
    if (!this.sel || !mine.includes(this.sel)) this.sel = mine[0];

    const cards = h('div', { class: 'cards big' }, mine.map((id) => charCard(id, {
      selected: this.sel === id, onClick: (c) => { if (!chosen) { this.sel = c; this.update(); } }, dim: !!chosen && chosen !== id,
    })));

    const roster = h('div', { class: 'panel players-panel' }, h('h3', null, 'Plantillas'), t.players.map((p) => {
      const sel = t.selection[p.id];
      return h('div', { class: 'pp', style: { '--owner': p.color } },
        h('div', { class: 'pp-name' }, h('span', { class: 'dot', style: { background: p.color } }), p.name, p.id === me && h('span', { class: 'badge me' }, 'TÚ'),
          h('span', { class: `badge ${sel ? 'ok' : 'wait'}` }, sel ? 'Listo' : 'Eligiendo…')),
        pickSlots(t.draft.picks[p.id], t.config.picksPerPlayer, t.used[p.id]));
    }));

    this.root.replaceChildren(h('div', { class: 'screen wide select' },
      h('div', { class: 'topbar' },
        h('h2', null, `CARRERA ${t.raceNumber} DE ${t.config.races}`),
        h('div', { class: 'turn-banner mine' }, chosen ? 'Esperando a los demás…' : 'Elige tu corredor', S.awaiting?.kind === 'select' && S.awaiting.deadline ? timerEl(S.awaiting.deadline) : null)),
      h('div', { class: 'circuit-card' },
        h('div', { class: `circuit-badge ${circuit.id}` }, circuit.id === 'wild' ? '🌋' : '🌿'),
        h('div', null,
          h('h3', null, circuit.name),
          h('div', { class: 'muted' }, circuit.tagline),
          h('div', { class: 'chips' },
            h('span', { class: 'chip' }, `${circuit.length} casillas`),
            h('span', { class: 'chip' }, `⭐ ${counts.star || 0}`),
            h('span', { class: 'chip' }, `➡ ${counts.arrow || 0} flechas`),
            h('span', { class: 'chip' }, `⚠ ${counts.trip || 0} tropiezos`),
            counts.portal && h('span', { class: 'chip' }, `🌀 ${counts.portal} portales`),
            counts.mud && h('span', { class: 'chip' }, `🟤 ${counts.mud} barro`)))),
      h('div', { class: 'draft-grid' },
        roster,
        h('div', { class: 'col grow' }, h('p', { class: 'muted' }, 'Cada personaje solo puede usarse una vez por torneo. Piensa qué circuito te viene mejor.'), cards),
        h('div', { class: 'side-detail' },
          this.sel && abilityDetail(this.sel),
          this.sel && button(chosen ? '✔ Personaje confirmado' : `CORRER CON ${CHAR_BY_ID[this.sel].name.toUpperCase()}`, () => { if (!chosen) net.send({ type: 'selectChar', charId: this.sel }); }, `primary xl ${chosen ? 'disabled' : ''}`)))));
  },
};
