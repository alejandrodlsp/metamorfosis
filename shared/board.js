// Circuitos. Índice 0 = salida, índice length = meta. Los efectos se resuelven al detenerse en la casilla.
function build(length, defs) {
  const spaces = Array.from({ length: length + 1 }, () => ({ type: 'normal' }));
  spaces[0] = { type: 'start' };
  spaces[length] = { type: 'finish' };
  for (const [i, sp] of Object.entries(defs)) spaces[Number(i)] = sp;
  return spaces;
}

const star = { type: 'star' };
const arrow = (delta) => ({ type: 'arrow', delta });
const trip = { type: 'trip' };
const portal = (to) => ({ type: 'portal', to });
const mud = { type: 'mud' };

export const CIRCUITS = {
  normal: {
    id: 'normal',
    name: 'Circuito Pradera',
    tagline: 'Carrera sencilla: pocos obstáculos y pocos efectos.',
    length: 30,
    theme: { ground: '#7ad66f', sky: ['#7fd3ff', '#fdf3c8'], tile: '#fff6dd' },
    spaces: build(30, {
      5: arrow(2), 7: star, 9: trip, 12: arrow(3), 15: star, 17: arrow(-2),
      20: arrow(2), 23: star, 26: trip,
    }),
    // Puntos de control (x,z) para la curva del tablero 3D.
    layout: [[-17, 8], [-10, 11], [-3, 7], [-5, 0], [3, -3], [11, -1], [14, 6], [10, 12], [17, 14]],
  },
  wild: {
    id: 'wild',
    name: 'Circuito Salvaje',
    tagline: 'Más trampas, portales, barro y caos entre corredores.',
    length: 32,
    theme: { ground: '#8a63d2', sky: ['#2a1b5e', '#ff7ab6'], tile: '#e8dcff' },
    spaces: build(32, {
      3: arrow(3), 5: star, 6: trip, 7: portal(20), 8: arrow(2), 9: mud,
      10: arrow(-3), 11: star, 13: trip, 14: arrow(4), 16: trip, 17: star,
      18: mud, 19: arrow(-4), 21: arrow(3), 22: trip, 23: portal(12), 24: star,
      26: arrow(-2), 27: trip, 28: mud, 29: star,
    }),
    layout: [[-18, 12], [-9, 14], [-2, 9], [-12, 3], [-18, -4], [-8, -9], [2, -4], [8, -11], [17, -8], [16, 2], [9, 5], [14, 12]],
  },
};

export function getCircuit(id) {
  return CIRCUITS[id];
}

export const SPACE_INFO = {
  start: { label: 'Salida', desc: 'Todos empiezan aquí.' },
  finish: { label: 'Meta', desc: 'Al cruzarla, el corredor sale de la carrera. Los dos primeros puntúan.' },
  normal: { label: 'Casilla', desc: 'Sin efecto.' },
  star: { label: 'Estrella', desc: 'El primer corredor que se detiene aquí gana una estrella (puntos extra).' },
  arrow: { label: 'Flecha', desc: 'Al detenerte, te mueves el número de casillas indicado (movimiento adicional).' },
  trip: { label: 'Tropiezo', desc: 'Al detenerte, tropiezas: pierdes tu próximo movimiento principal.' },
  portal: { label: 'Portal', desc: 'Al detenerte, te teletransportas a la casilla indicada.' },
  mud: { label: 'Barro', desc: 'Al detenerte, tu próximo movimiento principal es 2 casillas menor.' },
};
