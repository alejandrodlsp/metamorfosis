import { h } from '../dom.js';
import { S, navigate, saveOpts } from '../store.js';
import { G } from '../ctx.js';
import { button, charCard, abilityDetail } from '../components.js';
import { backBar } from './util.js';
import { CHARACTERS, CATEGORIES } from '../../shared/characters.js';
import { SPACE_INFO, CIRCUITS } from '../../shared/board.js';
import { DEFAULT_CONFIG } from '../../shared/config.js';
import { audioSettings } from '../audio.js';
import { showTutorial } from './tutorial.js';

// ---------------------------------------------------------------- Personajes
export const characters = {
  sel: CHARACTERS[0].id, cat: '', type: '', q: '',
  mount(root) { this.root = root; this.build(); },
  update() {},
  unmount() {},
  build() {
    const grid = h('div', { class: 'cards' });
    const detail = h('div', { class: 'side-detail' });
    const draw = () => {
      const q = this.q.toLowerCase();
      const list = CHARACTERS.filter((c) => (!this.cat || c.category === this.cat) && (!this.type || c.type === this.type)
        && (!q || `${c.name} ${c.en} ${c.title} ${c.desc}`.toLowerCase().includes(q)));
      grid.replaceChildren(...list.map((c) => charCard(c.id, { selected: c.id === this.sel, onClick: (id) => { this.sel = id; draw(); } })));
      detail.replaceChildren(abilityDetail(this.sel));
    };
    const search = h('input', { class: 'input', placeholder: 'Buscar personaje o habilidad…', value: this.q, onInput: (e) => { this.q = e.target.value; draw(); } });
    const cat = h('select', { class: 'input', onChange: (e) => { this.cat = e.target.value; draw(); } },
      h('option', { value: '' }, 'Todas las categorías'), CATEGORIES.map((c) => h('option', { value: c, selected: c === this.cat }, c)));
    const type = h('select', { class: 'input', onChange: (e) => { this.type = e.target.value; draw(); } },
      h('option', { value: '' }, 'Todos los tipos'), [['mandatory', 'Obligatorias'], ['optional', 'Opcionales'], ['passive', 'Pasivas']].map(([v, l]) => h('option', { value: v, selected: v === this.type }, l)));
    draw();
    this.root.replaceChildren(h('div', { class: 'screen wide' },
      backBar(() => navigate('menu'), `PERSONAJES (${CHARACTERS.length})`),
      h('div', { class: 'filters' }, search, cat, type),
      h('div', { class: 'split' }, grid, detail)));
  },
};

// ---------------------------------------------------------------- Reglas
const sec = (title, ...children) => h('section', { class: 'rules-sec' }, h('h3', null, title), ...children);

export const rules = {
  mount(root) {
    const sc = DEFAULT_CONFIG.scoring;
    root.replaceChildren(h('div', { class: 'screen narrow wide-text' },
      backBar(() => navigate('menu'), 'REGLAS'),
      h('div', { class: 'panel rules' },
        button('▶ Ver tutorial interactivo', () => showTutorial(), 'accent'),
        sec('Objetivo',
          h('p', null, 'Un torneo son 4 carreras. En cada carrera cada jugador corre con uno de sus 4 personajes (uno distinto por carrera). Gana quien más puntos acumule al final de las 4 carreras.')),
        sec('Preparación: draft serpenteante',
          h('p', null, 'Las 36 cartas están boca arriba. Los jugadores eligen por turnos en serpiente (1→N, N→1, 1→N, N→1) hasta tener 4 personajes cada uno. Un personaje solo puede tener un dueño.')),
        sec('Turno de juego',
          h('ol', null,
            h('li', null, 'Se resuelven las habilidades "antes de tirar" (BEFORE_MAIN_MOVE).'),
            h('li', null, 'Tiras el dado de 6 caras y se aplican habilidades que modifican la tirada (AFTER_DICE_ROLL).'),
            h('li', null, 'Se calcula el movimiento principal con bonificaciones y penalizaciones (DURING_MOVEMENT).'),
            h('li', null, 'Mueves automáticamente. Se resuelve: adelantar (ON_PASS), detenerse y casilla (ON_STOP), compartir casilla (ON_SHARED_SPACE), reacciones de otros (ON_OTHER_PLAYER_MOVE) y fin de movimiento (AFTER_MOVEMENT).'),
            h('li', null, 'Si alguien cruza la meta se resuelve ON_FINISH. La carrera termina cuando dos corredores la han cruzado.')),
          h('p', null, 'Orden de resolución de cada evento: 1) efectos del tablero, 2) habilidad del personaje activo, 3) habilidades de los demás siguiendo el orden de turno. Las habilidades opcionales te preguntan si quieres usarlas.')),
        sec('Tipos de movimiento',
          h('ul', null,
            h('li', null, h('b', null, 'Principal: '), 'el de tu turno (dado + modificadores).'),
            h('li', null, h('b', null, 'Adicional: '), 'efectos de habilidades o flechas. Hacia atrás nunca pasa de la salida.'),
            h('li', null, h('b', null, 'Teletransporte: '), 'cambia de casilla sin adelantar a nadie (no activa "adelantar").'))),
        sec('Reglas especiales',
          h('ul', null,
            h('li', null, h('b', null, 'Adelantar: '), 'pasar por encima de un corredor en un movimiento hacia delante. Terminar en su casilla es "compartir casilla".'),
            h('li', null, h('b', null, 'Tropiezo: '), 'pierdes tu siguiente movimiento principal (el turno se usa en levantarse).'),
            h('li', null, h('b', null, 'Movimiento de cero casillas: '), 'no activa nada al detenerse.'),
            h('li', null, h('b', null, 'Eliminación: '), 'el corredor sale de la carrera, sin puntos de posición.'),
            h('li', null, h('b', null, 'Cadenas: '), 'una habilidad no puede dispararse a sí misma dentro de su propia cadena y hay un límite de profundidad para evitar bucles.'))),
        sec('Casillas',
          h('div', { class: 'legend' }, Object.entries(SPACE_INFO).map(([k, v]) => h('div', { class: `legend-item sp-${k}` }, h('b', null, v.label), h('span', null, v.desc))))),
        sec('Circuitos',
          Object.values(CIRCUITS).map((c) => h('p', null, h('b', null, `${c.name} (${c.length} casillas): `), c.tagline)),
          h('p', null, 'Las carreras alternan: Pradera, Salvaje, Pradera, Salvaje.')),
        sec('Puntuación',
          h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Carrera'), h('th', null, '1º'), h('th', null, '2º'))),
            h('tbody', null, sc.place.map((p, i) => h('tr', null, h('td', null, `Carrera ${i + 1}`), h('td', null, `${p[0]} pts`), h('td', null, `${p[1]} pts`))))),
          h('p', null, `Cada estrella vale ${sc.starPoints} punto y cada ficha de habilidad ${sc.chipPoints}. Desempate: más primeros puestos, más segundos, más estrellas.`)),
        sec('Interpretaciones adoptadas (configurables)',
          h('ul', null,
            h('li', null, 'Estrella: la primera carrera que se detiene en cada casilla de estrella se la queda (starMode).'),
            h('li', null, 'La carrera termina al instante cuando el segundo corredor cruza la meta; los efectos pendientes se descartan.'),
            h('li', null, 'Orden de turnos: carrera 1 al azar; después, empieza quien tiene menos puntos (turnOrder).'),
            h('li', null, 'Los teletransportes sí activan la casilla de destino (salvo los portales) pero no "adelantar".'),
            h('li', null, 'Las flechas se encadenan hasta un máximo de 4 por turno.'),
            h('li', null, 'Si un jugador se desconecta, la IA juega por él hasta que vuelva.'))))));
  },
  update() {},
  unmount() {},
};

// ---------------------------------------------------------------- Opciones
export const options = {
  mount(root) {
    const o = S.opts;
    const toggle = (label, key, after) => h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: o[key], onChange: (e) => { o[key] = e.target.checked; saveOpts(); after?.(); } }), h('span', null, label));
    root.replaceChildren(h('div', { class: 'screen narrow' },
      backBar(() => navigate('menu'), 'OPCIONES'),
      h('div', { class: 'panel' },
        toggle('Sonido activado', 'sound', () => { audioSettings.enabled = o.sound; }),
        h('label', { class: 'field' }, h('span', null, 'Volumen'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: o.volume, onInput: (e) => { o.volume = Number(e.target.value); audioSettings.volume = o.volume; saveOpts(); } })),
        toggle('Sombras (más calidad, más consumo)', 'shadows', () => G.world.setQuality({ shadows: o.shadows, particles: o.particles })),
        toggle('Partículas y efectos completos', 'particles', () => G.world.setQuality({ shadows: o.shadows, particles: o.particles })),
        toggle('Cámara automática (sigue al jugador activo)', 'followCam', () => { G.world.followOn = o.followCam; }),
        button('Reiniciar tutorial', () => { o.tutorialSeen = false; saveOpts(); }, 'small'),
        h('p', { class: 'muted' }, 'La velocidad de animaciones y los tiempos de turno los decide el anfitrión de la sala.'))));
  },
  update() {},
  unmount() {},
};
