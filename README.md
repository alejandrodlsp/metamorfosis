# La Carrera de los Mil Prodigios

Juego web multijugador de carreras fantásticas por turnos (inspirado en las mecánicas de *Magical Athlete*), con **three.js** en el cliente y un **servidor autoritativo** (Node + WebSocket) con salas por código y contraseña.

- 2 a 6 participantes (humanos y/o IA) · 36 personajes con habilidades que cambian las reglas · 4 carreras por torneo (circuitos *Pradera* y *Salvaje* alternados).
- Draft serpenteante, selección de personaje por carrera, motor de eventos de habilidades, IA, puntuación acumulada, pantalla final.

## Arranque

```bash
npm install
npm run dev          # servidor (3001) + Vite (http://localhost:5173) con recarga en caliente
# o bien, producción en un solo puerto:
npm run serve        # build + servidor en http://localhost:3001  (PORT=8080 npm run serve)
npm test             # motor (125 torneos simulados + escenarios) 
node tests/e2e.js    # torneo completo por WebSocket (sala, contraseña, draft, decisiones)
```

Para jugar con amigos: uno crea la sala (**JUGAR → Crear sala**), comparte el **código de 5 letras** y la contraseña, y los demás entran en **Unirse a sala**. Hay que exponer el puerto del servidor (red local, túnel o despliegue); detrás de HTTPS el cliente usa `wss://` automáticamente (proxy el path `/ws`).

- **Partida rápida vs IA**: crea una sala privada con 1-5 IA y la arranca.
- **CONTINUAR**: reanuda tu partida (reconecta con el token guardado en el navegador). Si el servidor se reinicia, las salas se restauran desde `data/rooms.json` y la carrera en curso se reinicia al volver a entrar.
- Si un jugador se desconecta, **juega la IA por él** hasta que vuelva.

## Sustituir los assets de personajes

Todo lo de los personajes son *placeholders* vacíos generados con `npm run placeholders` en `public/assets/characters/`:

```
public/assets/characters/manifest.json   →  { "alchemist": { "portrait": "alchemist.svg", "model": null, "modelScale": 1 }, ... }
public/assets/characters/<id>.svg        →  retrato (512×640 recomendado)
```

1. Copia tu imagen (`alchemist.png`, `.webp`...) a esa carpeta y cambia `portrait` en el manifiesto. Se usa en cartas, marcador y ficha 3D del corredor.
2. Opcional: añade `"model": "alchemist.glb"` (y `modelScale`) para sustituir la ficha plana por un modelo 3D.
3. Los ids de personaje están en `shared/characters.js`. El resto de assets (tablero, dado, efectos, sonidos) se genera por código.

## Arquitectura

```
shared/                      Reglas puras (corren en el servidor; el cliente solo importa datos)
  config.js                  Reglas configurables (puntuación, estrellas, orden de turnos...)
  board.js                   Circuitos (casillas, efectos, layout 3D)
  characters.js              36 personajes: datos + ganchos de habilidad
  engine/engine.js           Motor de una carrera: turnos, movimiento, eventos, resolución
  engine/tournament.js       Draft, selección, puntuación, clasificación (estado JSON)
  engine/ai.js               IA: draft, personaje por carrera, decisiones de habilidades
server/                      index.js (HTTP+WS) · rooms.js (salas, contraseñas, persistencia) · session.js (flujo de partida)
src/                         Cliente: screens/ (UI), three/ (mundo 3D, dado, efectos), director.js (animaciones), net.js
tests/                       engine.test.js · e2e.js · balance.js (estadísticas de equilibrio)
```

El servidor es la única fuente de verdad: el motor emite eventos (`MOVE`, `DICE`, `ABILITY`...) con una instantánea del estado y el cliente los reproduce en orden (el *director*). Las animaciones nunca bloquean la lógica: el servidor solo espacia los eventos (`animSpeed`) y, si una pestaña está oculta, el cliente salta las animaciones.

### Motor de habilidades

Cada habilidad son **datos** (`type`, `limit`, `config`, textos) + **ganchos** que usan la API `ctx` (`moveBy`, `moveTo`, `swap`, `trip`, `eliminate`, `confirm`, `pickRacer`, `roll`, `addMod`, `chip`...). Eventos: `BEFORE_MAIN_MOVE`, `AFTER_DICE_ROLL`, `DURING_MOVEMENT`, `BEFORE_LANDING`, `ON_PASS`, `ON_STOP`, `ON_SHARED_SPACE`, `ON_OTHER_PLAYER_MOVE`, `AFTER_MOVEMENT`, `ON_FINISH`, `ON_TRIP`, `ON_ELIMINATION`, `TURN_END`.

- **Orden de resolución** de cada evento: 1) efectos del tablero, 2) habilidad del personaje activo, 3) las demás por orden de turno.
- **Obligatorias** se ejecutan solas; **opcionales** piden confirmación (la IA decide con el `aiValue` que aporta cada habilidad; el humano tiene un tiempo límite tras el cual decide la IA).
- **Antibucles**: cada instancia de evento se resuelve una sola vez por habilidad, una habilidad no puede dispararse dentro de su propia cadena, y hay límites de profundidad (`maxChainDepth`), de efectos por turno y de encadenado de flechas.
- Tres tipos de movimiento: **principal**, **adicional** (EXTRA) y **teletransporte** (no "adelanta").

Para añadir un personaje: `def({ id, name, ..., hooks: { ON_PASS(ctx) {...} } })` en `shared/characters.js`, y genera su placeholder (`npm run placeholders`).

## Interpretaciones de reglas (todas configurables)

| Tema | Decisión | Dónde cambiarlo |
|---|---|---|
| Puntos de posición | 1º/2º por carrera: 3/1, 4/2, 5/3, 6/4 (progresión creciente). Estrella = 1 pt, ficha = 1 pt | `config.scoring` |
| Estrellas | La primera carrera que se detiene en cada estrella se la queda | `config.starMode` (`first`/`perRacer`) |
| Fin de carrera | Al instante cuando el 2º cruza la meta; efectos pendientes descartados | `engine.js` |
| Orden de turnos | Carrera 1 al azar; luego empieza quien tiene menos puntos | `config.turnOrder` |
| "Pasar" a alguien | Estar estrictamente entre origen y destino en movimiento hacia delante. Terminar en su casilla = compartir casilla | `config.backwardPassTriggers` |
| Teletransporte | Activa la casilla de destino y compartir casilla; no activa "adelantar"; los portales no se encadenan | `config.teleportTriggersBoard` |
| Movimiento 0 | No activa detenerse/compartir/otros | `engine.js` |
| Tropiezo | Pierdes el siguiente movimiento principal (el turno se gasta en levantarse) | — |
| Eliminación | El corredor sale de la carrera sin puntos de posición; la carrera acaba si no quedan corredores | — |
| Resolución de modificadores | Se aplican en orden de resolución (activo primero): multiplicadores del activo antes de bonus ajenos | — |
| Habilidades "una vez por carrera" | Contadores propios; el Gato Copión los gasta por separado | `limit` en cada personaje |
| Desempate final | Más puntos → más 1º puestos → más 2º → más estrellas (si persiste, empate) | `standings()` |
| Desconexión | La IA juega por el jugador | — |

Los 36 nombres de personaje vienen de la lista de referencia; **las habilidades concretas son interpretaciones propias** pensadas para cubrir las 13 categorías pedidas (velocidad, dados, teletransporte, bloqueo, ataque, retroceso, bonificaciones, eliminación, trampas, interacciones, orden de turnos, posiciones y pasivas).

## Personajes

| # | Personaje | Original | Categoría | Tipo | Habilidad |
|---|---|---|---|---|---|
| 1 | **Alquimista** | Alchemist | Manipulación de dados | Obligatoria | Transmutación |
| 2 | **Dirigible** | Blimp | Velocidad | Obligatoria | Corrientes de aire |
| 3 | **Entrenador** | Coach | Bonificaciones | Obligatoria | Charla de equipo |
| 4 | **Baba Yaga** | Baba Yaga | Trampas | Obligatoria | Maldición de la choza |
| 5 | **Centauro** | Centaur | Retroceso de rivales | Opcional | Carga al galope |
| 6 | **Plátano** | Banana | Trampas | Obligatoria | Piel resbaladiza |
| 7 | **Animadora** | Cheerleader | Manipulación de posiciones | Opcional | Ánimo, rezagados |
| 8 | **Duelista** | Duelist | Ataque | Opcional | Duelo de dados |
| 9 | **Liebre** | Hare | Velocidad | Obligatoria | Prisa y siesta |
| 10 | **Hipnotizador** | Hypnotist | Teletransporte | Opcional | Mirada magnética |
| 11 | **Zancadas** | Legs | Manipulación de dados | Opcional | Paso largo |
| 12 | **Mago** | Magician | Manipulación de dados | Opcional | Otra vez, por favor |
| 13 | **Cohetero** | Rocket Scientist | Velocidad | Opcional | Ignición total |
| 14 | **Bebé Gigante** | Huge Baby | Bloqueo | Pasiva | Ocupa demasiado |
| 15 | **M.O.U.T.H.** | M.O.U.T.H. | Eliminación | Opcional | Gran bocado |
| 16 | **Gato Copión** | Copy Cat | Interacciones entre corredores | Pasiva | Imitación perfecta |
| 17 | **Mercader de Dados** | Dicemonger | Bonificaciones | Obligatoria | Comisión del 6 |
| 18 | **Genio** | Genius | Manipulación de dados | Opcional | Cálculo exacto |
| 19 | **Abucheador** | Heckler | Manipulación de dados | Obligatoria | Abucheo |
| 20 | **Huevo** | Egg | Habilidades pasivas | Pasiva | Cascarón |
| 21 | **Mugre** | Gunk | Trampas | Obligatoria | Rastro viscoso |
| 22 | **Chancla** | Flip Flop | Manipulación de posiciones | Opcional | Cambiazo |
| 23 | **Gusano Medidor** | Inchworm | Habilidades pasivas | Pasiva | Se agarra donde puede |
| 24 | **Cerebro** | Mastermind | Alteración del orden de turnos | Opcional | Plan maestro |
| 25 | **Lacayo** | Lackey | Bonificaciones | Obligatoria | A la sombra del campeón |
| 26 | **Perdedor Entrañable** | Loveable Loser | Bonificaciones | Obligatoria | El público te quiere |
| 27 | **Sapo Saltarín** | Leaptoad | Habilidades pasivas | Pasiva | Saltos sobre nenúfares |
| 28 | **Fiestero** | Party Animal | Manipulación de posiciones | Obligatoria | ¡Que empiece la fiesta! |
| 29 | **Sísifo** | Sisyphus | Habilidades pasivas | Obligatoria | La roca eterna |
| 30 | **Romántico** | Romantic | Interacciones entre corredores | Obligatoria | Amor a primera vista |
| 31 | **Escurridizo** | Scoocher | Interacciones entre corredores | Obligatoria | A rebufo |
| 32 | **Quisquilloso** | Stickler | Bloqueo | Pasiva | Silencio en la sala |
| 33 | **Rémora** | Suckerfish | Interacciones entre corredores | Opcional | Viaje gratis |
| 34 | **Tercero en Discordia** | Third Wheel | Teletransporte | Opcional | Me apunto |
| 35 | **Gemelo** | Twin | Interacciones entre corredores | Obligatoria | Eco de dados |
| 36 | **Patrón** | Skipper | Alteración del orden de turnos | Opcional | Al timón |

Descripción completa (activación, efecto, interacciones) en el juego (**PERSONAJES**) y en `shared/characters.js`.

## Seguridad básica

Contraseñas de sala con *scrypt* (nunca se guardan en claro), comparación en tiempo constante, límite de intentos por IP, límite de mensajes por conexión, mensajes ≤ 8 KB, nombres saneados, toda la UI se construye con nodos de texto (sin `innerHTML`) y el servidor valida cada acción (turno, personaje disponible, etc.).
