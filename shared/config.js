// Configuración global de reglas. Toda interpretación de reglas ambiguas es ajustable aquí (ver README).
export const DEFAULT_CONFIG = {
  minPlayers: 2,
  maxPlayers: 6,
  races: 4,
  picksPerPlayer: 4,
  // Circuito de cada carrera (se alternan).
  circuitOrder: ['normal', 'wild', 'normal', 'wild'],
  scoring: {
    // [primer puesto, segundo puesto] por carrera; progresión creciente.
    place: [[3, 1], [4, 2], [5, 3], [6, 4]],
    starPoints: 1,
    chipPoints: 1,
  },
  // 'first': la primera carrera que se detiene en una estrella se la queda. 'perRacer': cada corredor puede cogerla una vez.
  starMode: 'first',
  // 'lowestScoreFirst' | 'random' | 'seat'
  turnOrder: 'lowestScoreFirst',
  teleportTriggersBoard: true,
  backwardPassTriggers: false,
  maxChainDepth: 8,
  maxBoardChain: 4,
  maxHandlersPerTurn: 150,
  maxTurnsPerRace: 300,
  // Tiempos de espera para humanos (segundos). 0 = sin límite.
  rollSeconds: 30,
  decisionSeconds: 20,
  draftSeconds: 60,
  selectSeconds: 45,
  // Multiplicador de pausas de animación (0 = instantáneo).
  animSpeed: 0.75,
  aiLevel: 'normal', // 'easy' | 'normal' | 'hard'
};

export const PLAYER_COLORS = [
  { id: 'red', name: 'Rojo', hex: '#ff4d6d' },
  { id: 'blue', name: 'Azul', hex: '#3d8bff' },
  { id: 'green', name: 'Verde', hex: '#2fd27a' },
  { id: 'yellow', name: 'Amarillo', hex: '#ffc53d' },
  { id: 'purple', name: 'Morado', hex: '#a45cff' },
  { id: 'orange', name: 'Naranja', hex: '#ff8a2b' },
];

export const CIRCUIT_ALTERNATE = (config, raceNumber) =>
  config.circuitOrder[(raceNumber - 1) % config.circuitOrder.length];
