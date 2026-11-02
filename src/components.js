// Componentes de interfaz reutilizables.
import { h } from './dom.js';
import { avatar } from './assets.js';
import { CHAR_BY_ID, ABILITY_TYPES } from '../shared/characters.js';
import { PLAYER_COLORS } from '../shared/config.js';
import { sfx } from './audio.js';

export const EVENT_LABELS = {
  BEFORE_MAIN_MOVE: 'Antes de mover', AFTER_DICE_ROLL: 'Tras tirar el dado', DURING_MOVEMENT: 'Durante el movimiento',
  BEFORE_LANDING: 'Al aterrizar', ON_PASS: 'Al adelantar', ON_STOP: 'Al detenerse', ON_SHARED_SPACE: 'Al compartir casilla',
  ON_OTHER_PLAYER_MOVE: 'Cuando otro se mueve', AFTER_MOVEMENT: 'Tras mover', ON_FINISH: 'Al llegar a meta',
  ON_TRIP: 'Al tropezar', ON_ELIMINATION: 'Al eliminar', TURN_END: 'Fin de turno',
};

export function button(label, onClick, cls = '') {
  return h('button', { class: `btn ${cls}`, onClick: (e) => { sfx.click(); onClick?.(e); } }, label);
}

export function typeBadge(type) {
  const t = ABILITY_TYPES[type];
  return h('span', { class: `badge type-${type}`, title: t.hint }, t.label);
}

export function charCard(id, { onClick, selected = false, ownerColor = null, ownerName = null, dim = false, compact = false, extra = null } = {}) {
  const c = CHAR_BY_ID[id];
  const el = h('div', {
    class: `card ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${compact ? 'compact' : ''} ${onClick ? 'clickable' : ''}`,
    style: ownerColor ? { '--owner': ownerColor } : null,
    onClick: onClick ? () => { sfx.click(); onClick(id); } : null,
    onMouseenter: onClick ? () => sfx.hover() : null,
  },
  h('div', { class: 'card-art', style: { '--c': c.color } }, avatar(id)),
  h('div', { class: 'card-body' },
    h('div', { class: 'card-name' }, c.name),
    h('div', { class: 'card-sub' }, c.title),
    !compact && h('div', { class: 'card-tags' }, h('span', { class: 'pill' }, c.category), typeBadge(c.type))),
  ownerName && h('div', { class: 'owner-tag' }, ownerName),
  extra);
  return el;
}

export function abilityDetail(id, { big = true } = {}) {
  const c = CHAR_BY_ID[id];
  const triggers = Object.keys(c.hooks);
  return h('div', { class: `detail ${big ? 'big' : ''}` },
    h('div', { class: 'detail-head' },
      h('div', { class: 'detail-art', style: { '--c': c.color } }, avatar(id)),
      h('div', null,
        h('h3', null, c.name),
        h('div', { class: 'muted' }, c.en),
        h('div', { class: 'card-tags' }, h('span', { class: 'pill' }, c.category), typeBadge(c.type)))),
    h('div', { class: 'ability-title' }, `✦ ${c.title}`),
    h('p', { class: 'ability-desc' }, c.desc),
    h('dl', null,
      h('dt', null, 'Condición de activación'), h('dd', null, c.activation),
      h('dt', null, 'Efecto en el movimiento'), h('dd', null, c.effect),
      h('dt', null, 'Interacciones'), h('dd', null, c.interactions)),
    h('div', { class: 'chips' }, triggers.length ? triggers.map((e) => h('span', { class: 'chip', title: e }, EVENT_LABELS[e] || e)) : h('span', { class: 'chip' }, c.copy ? 'Copia habilidades' : 'Regla constante')));
}

export function colorSwatches(current, onPick, taken = []) {
  return h('div', { class: 'swatches' }, PLAYER_COLORS.map((c) => h('button', {
    class: `swatch ${c.hex === current ? 'on' : ''} ${taken.includes(c.hex) && c.hex !== current ? 'taken' : ''}`,
    style: { background: c.hex }, title: c.name, type: 'button',
    onClick: () => { sfx.click(); onPick(c.hex); },
  })));
}

export function modal(content, { onClose, wide = false } = {}) {
  const root = document.getElementById('ui');
  const close = () => { back.remove(); onClose?.(); };
  const back = h('div', { class: 'modal-back', onClick: (e) => { if (e.target === back) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}` }, h('button', { class: 'modal-x', onClick: close, 'aria-label': 'Cerrar' }, '✕'), content));
  root.append(back);
  return { close, el: back };
}

export function showCharacter(id) {
  return modal(abilityDetail(id));
}

export function compareModal(ids) {
  return modal(h('div', { class: 'compare' }, ids.map((id) => abilityDetail(id, { big: false }))), { wide: true });
}

export function timerEl(deadline) {
  const el = h('span', { class: 'timer', dataset: { deadline: deadline || '' } }, '');
  return el;
}

export function startTicker() {
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-deadline]')) {
      const d = Number(el.dataset.deadline);
      if (!d) { el.textContent = ''; continue; }
      const s = Math.max(0, Math.ceil((d - Date.now()) / 1000));
      el.textContent = `${s}s`;
      el.classList.toggle('urgent', s <= 5);
    }
  }, 250);
}
