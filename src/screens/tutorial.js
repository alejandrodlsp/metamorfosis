import { h } from '../dom.js';
import { S, saveOpts } from '../store.js';
import { modal, button } from '../components.js';

const STEPS = [
  ['🏁 Bienvenido a la carrera', 'Dos corredores deben cruzar la meta. El primero y el segundo ganan puntos. Un torneo son 4 carreras con 4 personajes distintos por jugador.'],
  ['🃏 Draft serpenteante', 'Antes de correr, todos elegís 4 personajes de las 36 cartas boca arriba, alternando el orden (1→N, N→1...). Lee bien las habilidades: ¡cambian las reglas de la carrera!'],
  ['🎲 Tu turno', 'Pulsa TIRAR DADO. El resultado se muestra y tu personaje se mueve solo. Antes y después pueden activarse habilidades (tuyas y de los demás, incluso cuando no es tu turno).'],
  ['✨ Habilidades opcionales', 'Cuando una habilidad opcional se pueda usar, aparecerá una ventana para que decidas. Si no respondes a tiempo decide la IA por ti.'],
  ['🟦 Casillas', '⭐ Estrella: puntos extra. ➡ Flecha: movimiento adicional. ⚠ Tropiezo: pierdes tu siguiente movimiento. 🌀 Portal y 🟤 barro en el circuito salvaje. Pasa el ratón por una casilla para ver su efecto.'],
  ['📜 Registro y avisos', 'El panel de eventos explica por qué ocurre cada movimiento. Un cartel grande te avisa cuando una habilidad se activa.'],
  ['🏆 Puntuación', 'Primer y segundo puesto + estrellas + fichas de habilidades. Tras 4 carreras gana quien más puntos tenga. ¡A correr!'],
];

export function showTutorial() {
  let i = 0;
  const body = h('div', { class: 'tutorial' });
  let m;
  const draw = () => {
    const [title, text] = STEPS[i];
    body.replaceChildren(
      h('h2', null, title),
      h('p', null, text),
      h('div', { class: 'dots' }, STEPS.map((_, k) => h('span', { class: `dot ${k === i ? 'on' : ''}` }))),
      h('div', { class: 'row end' },
        i > 0 && button('Anterior', () => { i--; draw(); }, 'ghost'),
        i < STEPS.length - 1 ? button('Siguiente', () => { i++; draw(); }, 'primary') : button('¡Entendido!', () => m.close(), 'primary')));
  };
  draw();
  m = modal(body, { onClose: () => { S.opts.tutorialSeen = true; saveOpts(); } });
  return m;
}
