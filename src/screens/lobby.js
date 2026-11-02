import { h } from '../dom.js';
import { S, isHost, myId } from '../store.js';
import { net } from '../net.js';
import { button, colorSwatches } from '../components.js';
import { PLAYER_COLORS } from '../../shared/config.js';
import { toast } from '../dom.js';

const LEVELS = { easy: 'fácil', normal: 'normal', hard: 'difícil' };

export const lobby = {
  colorOpen: null,
  mount(root) {
    this.root = root;
    this.slots = h('div', { class: 'slots' });
    this.settings = h('div', { class: 'panel settings' });
    this.chatLog = h('div', { class: 'chat-log' });
    const chatInput = h('input', { class: 'input', maxlength: 200, placeholder: 'Escribe un mensaje…' });
    const form = h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); const v = chatInput.value.trim(); if (v) net.send({ type: 'chat', text: v }); chatInput.value = ''; } }, chatInput, h('button', { class: 'btn' }, 'Enviar'));
    this.head = h('div', { class: 'lobby-head' });
    this.foot = h('div', { class: 'lobby-foot' });
    root.replaceChildren(h('div', { class: 'screen lobby' },
      this.head,
      h('div', { class: 'lobby-grid' },
        h('div', { class: 'panel' }, h('h3', null, 'Participantes'), this.slots),
        h('div', { class: 'col' }, this.settings, h('div', { class: 'panel chat' }, h('h3', null, 'Chat'), this.chatLog, form))),
      this.foot));
    this.update();
    this.updateChat();
  },
  unmount() {},
  update() {
    const room = S.room;
    if (!room) return;
    const typing = this.slots.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    this.drawHead(room);
    if (!typing) this.drawSlots(room);
    this.drawSettings(room);
    this.drawFoot(room);
  },
  drawHead(room) {
    const code = h('button', { class: 'room-code', title: 'Copiar código', onClick: () => { navigator.clipboard?.writeText(room.code); toast('Código copiado', 'ok', 1500); } }, room.code);
    this.head.replaceChildren(
      h('div', null, h('div', { class: 'muted' }, 'Código de sala'), code),
      h('div', { class: 'muted right' }, room.hasPassword ? '🔒 Con contraseña' : '🔓 Sin contraseña', h('br'), 'Comparte el código con tus amigos'));
  },
  drawSlots(room) {
    const me = myId();
    const host = isHost();
    const taken = room.players.map((p) => p.color);
    const rows = room.players.map((p) => {
      const mine = p.id === me;
      const editable = mine || (host && p.isBot);
      const nameEl = editable
        ? h('input', { class: 'input name-input', maxlength: 16, value: p.name, onChange: (e) => net.send({ type: 'setProfile', playerId: p.id, name: e.target.value }) })
        : h('span', { class: 'slot-name' }, p.name);
      const tags = [
        p.id === room.hostId && h('span', { class: 'badge host' }, 'ANFITRIÓN'),
        p.isBot && h('span', { class: 'badge bot' }, `IA ${LEVELS[p.level || room.settings.aiLevel]}`),
        mine && h('span', { class: 'badge me' }, 'TÚ'),
        !p.isBot && !p.connected && h('span', { class: 'badge off' }, 'Desconectado'),
      ];
      const open = this.colorOpen === p.id;
      return h('div', { class: 'slot' },
        h('button', { class: 'swatch big on', style: { background: p.color }, disabled: !editable, onClick: () => { this.colorOpen = open ? null : p.id; this.update(); }, title: 'Cambiar color' }),
        h('div', { class: 'slot-main' }, nameEl, h('div', { class: 'tags' }, tags),
          open && colorSwatches(p.color, (c) => { this.colorOpen = null; net.send({ type: 'setProfile', playerId: p.id, color: c }); }, taken)),
        host && !mine && h('button', { class: 'btn small danger', onClick: () => net.send({ type: p.isBot ? 'removeBot' : 'kick', playerId: p.id }) }, p.isBot ? 'Quitar' : 'Expulsar'));
    });
    const empty = Array.from({ length: room.max - room.players.length }, () => h('div', { class: 'slot empty' },
      h('div', { class: 'slot-main muted' }, 'Hueco libre — espera a un amigo o añade IA')));
    const add = host && room.players.length < room.max && h('div', { class: 'row' },
      button('+ Añadir IA', () => net.send({ type: 'addBot' }), 'small'));
    this.slots.replaceChildren(...[...rows, ...empty, add].filter(Boolean));
  },
  drawSettings(room) {
    const host = isHost();
    const s = room.settings;
    const sel = (label, key, opts) => {
      const el = h('select', { class: 'input', disabled: !host, onChange: (e) => net.send({ type: 'settings', settings: { [key]: key === 'aiLevel' ? e.target.value : Number(e.target.value) } }) },
        opts.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)));
      return h('label', { class: 'field' }, h('span', null, label), el);
    };
    const timer = [[0, 'Sin límite'], [20, '20 s'], [30, '30 s'], [60, '60 s']];
    this.settings.replaceChildren(...[
      h('h3', null, 'Ajustes de partida'),
      sel('Nivel de la IA', 'aiLevel', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']]),
      sel('Velocidad de animaciones', 'animSpeed', [[0.4, 'Muy rápida'], [0.75, 'Normal'], [1.2, 'Lenta']]),
      sel('Tiempo para tirar el dado', 'rollSeconds', timer),
      sel('Tiempo para decidir habilidades', 'decisionSeconds', timer),
      sel('Tiempo por elección (draft)', 'draftSeconds', [[0, 'Sin límite'], [30, '30 s'], [60, '60 s'], [90, '90 s']]),
      !host && h('p', { class: 'muted' }, 'Solo el anfitrión puede cambiar los ajustes.')].filter(Boolean));
  },
  drawFoot(room) {
    const host = isHost();
    const n = room.players.length;
    this.foot.replaceChildren(
      button('Salir de la sala', () => net.send({ type: 'leave' }), 'ghost'),
      host
        ? button(n < 2 ? 'Hacen falta 2 participantes' : `¡EMPEZAR! (${n} participantes)`, () => net.send({ type: 'start' }), `primary xl ${n < 2 ? 'disabled' : ''}`)
        : h('div', { class: 'muted' }, 'Esperando a que el anfitrión empiece la partida…'));
  },
  updateChat() {
    if (!this.chatLog) return;
    this.chatLog.replaceChildren(...S.chat.slice(-60).map((m) => h('div', { class: 'chat-line' }, h('b', { style: { color: m.color } }, `${m.name}: `), m.text)));
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  },
};

export const colorsList = PLAYER_COLORS;
