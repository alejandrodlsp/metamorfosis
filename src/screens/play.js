import { h, toast } from '../dom.js';
import { S, navigate, saveProfile } from '../store.js';
import { net } from '../net.js';
import { button, colorSwatches } from '../components.js';
import { backBar } from './util.js';

export const play = {
  mount(root) {
    this.root = root;
    this.tab = this.tab || 'create';
    this.build();
  },
  update() {},
  unmount() {},
  build() {
    const root = this.root;
    const name = h('input', { class: 'input', maxlength: 16, placeholder: 'Tu nombre', value: S.profile.name });
    const swatchBox = h('div');
    const renderSwatches = () => swatchBox.replaceChildren(colorSwatches(S.profile.color, (c) => { S.profile.color = c; saveProfile(); renderSwatches(); }));
    renderSwatches();
    const pw = h('input', { class: 'input', type: 'password', maxlength: 40, placeholder: 'Contraseña (opcional)', autocomplete: 'off' });
    const code = h('input', { class: 'input code', maxlength: 5, placeholder: 'CÓDIGO', autocapitalize: 'characters', onInput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } });
    const joinPw = h('input', { class: 'input', type: 'password', maxlength: 40, placeholder: 'Contraseña (si la tiene)', autocomplete: 'off' });
    const bots = h('select', { class: 'input' }, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === 3 }, `${n} IA (${n + 1} participantes)`)));
    const level = h('select', { class: 'input' }, [['easy', 'IA fácil'], ['normal', 'IA normal'], ['hard', 'IA difícil']].map(([v, l]) => h('option', { value: v, selected: v === 'normal' }, l)));

    const profile = () => {
      const n = name.value.trim() || `Jugador${Math.floor(10 + Math.random() * 90)}`;
      S.profile.name = n;
      saveProfile();
      return { name: n, color: S.profile.color };
    };

    const panes = {
      create: () => h('div', { class: 'pane' },
        h('p', { class: 'muted' }, 'Crea una sala privada y comparte el código (y la contraseña) con tus amigos.'),
        pw,
        button('Crear sala', () => net.send({ type: 'createRoom', ...profile(), password: pw.value }), 'primary xl')),
      join: () => h('div', { class: 'pane' },
        h('p', { class: 'muted' }, 'Introduce el código de sala que te han pasado.'),
        code, joinPw,
        button('Unirme', () => {
          if (code.value.length < 5) return toast('El código tiene 5 caracteres.', 'warn');
          net.send({ type: 'joinRoom', code: code.value, password: joinPw.value, ...profile() });
        }, 'primary xl')),
      quick: () => h('div', { class: 'pane' },
        h('p', { class: 'muted' }, 'Una partida contra la IA, sin esperar a nadie. Podrás invitar amigos desde la sala.'),
        bots, level,
        button('Empezar partida rápida', () => {
          S.pendingQuick = { bots: Number(bots.value), level: level.value };
          net.send({ type: 'createRoom', ...profile(), password: '' });
        }, 'primary xl')),
    };
    const paneBox = h('div');
    const tabs = h('div', { class: 'tabs' });
    const draw = () => {
      tabs.replaceChildren(...[['create', 'Crear sala'], ['join', 'Unirse a sala'], ['quick', 'Partida rápida vs IA']].map(([k, l]) =>
        h('button', { class: `tab ${this.tab === k ? 'on' : ''}`, onClick: () => { this.tab = k; draw(); } }, l)));
      paneBox.replaceChildren(panes[this.tab]());
    };
    draw();

    root.replaceChildren(h('div', { class: 'screen narrow' },
      backBar(() => navigate('menu'), 'JUGAR'),
      h('div', { class: 'panel' },
        h('label', { class: 'lbl' }, 'Tu nombre'), name,
        h('label', { class: 'lbl' }, 'Tu color'), swatchBox,
        tabs, paneBox)));
  },
};
