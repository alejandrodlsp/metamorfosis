import { h, toast } from '../dom.js';
import { S, navigate } from '../store.js';
import { net } from '../net.js';
import { button } from '../components.js';
import { simpleScreen } from './util.js';
import { CHARACTERS } from '../../shared/characters.js';
import { avatar } from '../assets.js';

export const menu = simpleScreen(() => {
  const floating = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 8);
  return h('div', { class: 'screen menu' },
    h('div', { class: 'logo' },
      h('div', { class: 'logo-top' }, 'LA CARRERA DE LOS'),
      h('div', { class: 'logo-main' }, 'MIL PRODIGIOS'),
      h('div', { class: 'logo-sub' }, 'Carreras fantásticas por turnos · 2 a 6 jugadores · online')),
    h('div', { class: 'menu-buttons' },
      button('▶  JUGAR', () => navigate('play'), 'xl primary'),
      S.session && button('↺  CONTINUAR PARTIDA', () => {
        toast('Reconectando con tu sala…');
        net.send({ type: 'rejoin', code: S.session.code, token: S.session.token });
      }, 'xl accent'),
      button('🃏  PERSONAJES', () => navigate('characters'), 'xl'),
      button('📜  REGLAS', () => navigate('rules'), 'xl'),
      button('⚙  OPCIONES', () => navigate('options'), 'xl')),
    h('div', { class: 'menu-cards' }, floating.map((c, i) => h('div', { class: 'menu-card', style: { '--i': i, '--c': c.color } }, avatar(c.id)))),
    h('div', { class: `conn ${S.connected ? 'on' : 'off'}` }, S.connected ? '● Conectado al servidor' : '● Sin conexión…'));
});
