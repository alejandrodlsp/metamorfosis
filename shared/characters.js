// 36 personajes. Cada habilidad es DATOS (texto, tipo, límites, configuración) + funciones de gancho
// que usan únicamente la API `ctx` del motor (ver shared/engine/engine.js -> makeCtx).
//
// Eventos disponibles: BEFORE_MAIN_MOVE, AFTER_DICE_ROLL, DURING_MOVEMENT, BEFORE_LANDING, ON_PASS, ON_STOP,
// ON_SHARED_SPACE, ON_OTHER_PLAYER_MOVE, AFTER_MOVEMENT, ON_FINISH, ON_TRIP, ON_ELIMINATION, TURN_END.

const plural = (n, w = 'casilla') => `${n} ${w}${n === 1 ? '' : 's'}`;
const defs = [];
const def = (d) => defs.push({ limit: null, config: {}, ...d });

export const ABILITY_TYPES = {
  mandatory: { label: 'Obligatoria', hint: 'Se ejecuta automáticamente.' },
  optional: { label: 'Opcional', hint: 'Te preguntamos si quieres usarla.' },
  passive: { label: 'Pasiva', hint: 'Siempre activa, cambia las reglas.' },
};

export const CATEGORIES = [
  'Velocidad', 'Manipulación de dados', 'Teletransporte', 'Bloqueo', 'Ataque', 'Retroceso de rivales',
  'Bonificaciones', 'Eliminación', 'Trampas', 'Interacciones entre corredores',
  'Alteración del orden de turnos', 'Manipulación de posiciones', 'Habilidades pasivas',
];

// ---------------------------------------------------------------------------------------------
def({
  id: 'alchemist', name: 'Alquimista', en: 'Alchemist', color: '#9b5de5', glyph: '⚗️',
  category: 'Manipulación de dados', type: 'mandatory', title: 'Transmutación',
  desc: 'Convierte los resultados bajos del dado en un movimiento superior.',
  activation: 'Después de tirar el dado en su turno.',
  effect: 'Un 1 se transforma en 4 y un 2 en 3 antes de mover.',
  interactions: 'Mago, Genio, Gemelo y Mercader de Dados ven el valor ya transmutado.',
  animation: 'sparkle', ai: { n: 6, w: 6 }, config: { map: { 1: 4, 2: 3 } },
  hooks: {
    async AFTER_DICE_ROLL(ctx) {
      if (ctx.actor !== ctx.self) return;
      const to = ctx.ab.config.map[ctx.turn.roll];
      if (!to) return;
      const from = ctx.turn.roll;
      ctx.turn.roll = to;
      await ctx.announce(`¡${ctx.n(ctx.self)} transmuta su ${from} en un ${to}!`);
    },
  },
});

def({
  id: 'blimp', name: 'Dirigible', en: 'Blimp', color: '#4cc9f0', glyph: '🎈',
  category: 'Velocidad', type: 'mandatory', title: 'Corrientes de aire',
  desc: 'Su velocidad cambia según la zona de la pista en la que empieza a moverse.',
  activation: 'Al iniciar su movimiento principal.',
  effect: 'Primer tercio: -1. Segundo tercio: +1. Último tercio: +2 (siempre mueve al menos 1).',
  interactions: 'Se combina con bonificaciones del Entrenador o la Liebre (si lo copia el Gato Copión).',
  animation: 'dash', ai: { n: 6, w: 6 },
  config: { zones: [{ upTo: 1 / 3, bonus: -1 }, { upTo: 2 / 3, bonus: 1 }, { upTo: 1.01, bonus: 2 }] },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      const p = ctx.move.from / ctx.L;
      const z = ctx.ab.config.zones.find((zn) => p < zn.upTo);
      const before = ctx.move.distance;
      ctx.move.distance = Math.max(1, before + z.bonus);
      if (z.bonus !== 0) ctx.say(`${ctx.n(ctx.self)} aprovecha la corriente: ${z.bonus > 0 ? '+' : ''}${z.bonus} al movimiento.`);
    },
  },
});

def({
  id: 'coach', name: 'Entrenador', en: 'Coach', color: '#f9c74f', glyph: '📣',
  category: 'Bonificaciones', type: 'mandatory', title: 'Charla de equipo',
  desc: 'Da bonificaciones de movimiento a los corredores que comparten su casilla.',
  activation: 'Cuando un corredor empieza su movimiento principal en la casilla del Entrenador.',
  effect: '+1 al movimiento principal de cada corredor en su casilla (también el suyo si no está solo).',
  interactions: 'Ayuda también a los rivales: cuidado con quién comparte casilla contigo.',
  animation: 'pulse', ai: { n: 5, w: 5 },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      const { move, mover, self } = ctx;
      if (move.type !== 'MAIN' || move.from !== self.pos) return;
      if (mover === self && ctx.at(self.pos).length <= 1) return;
      move.distance += 1;
      await ctx.announce(`¡${ctx.n(self)} anima a ${ctx.n(mover)}: +1 casilla!`, { ms: 700, targets: [mover] });
    },
  },
});

def({
  id: 'babayaga', name: 'Baba Yaga', en: 'Baba Yaga', color: '#6a4c93', glyph: '🧙‍♀️',
  category: 'Trampas', type: 'mandatory', title: 'Maldición de la choza',
  desc: 'Hace tropezar a los corredores que comparten casilla con ella.',
  activation: 'Cuando Baba Yaga termina un movimiento con otro corredor, o cuando otro corredor termina en su casilla.',
  effect: 'El otro corredor tropieza y pierde su próximo movimiento principal (ella no).',
  interactions: 'Hipnotizador, Tercero en Discordia o Fiestero pueden acabar llevando rivales hasta ella.',
  animation: 'curse', ai: { n: 6, w: 8 },
  hooks: {
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover !== self && other !== self) return;
      const victim = mover === self ? other : mover;
      if (victim.tripped || !ctx.canAffect(victim, 'trip')) return;
      await ctx.announce(`¡${ctx.n(self)} maldice a ${ctx.n(victim)}! ${ctx.n(victim)} tropezará.`, { targets: [victim] });
      await ctx.trip(victim);
    },
  },
});

def({
  id: 'centaur', name: 'Centauro', en: 'Centaur', color: '#c77d3a', glyph: '🏹',
  category: 'Retroceso de rivales', type: 'optional', title: 'Carga al galope',
  desc: 'Puede hacer retroceder a los corredores que adelanta.',
  activation: 'Cuando el Centauro adelanta (pasa por encima) a otro corredor en un movimiento hacia delante.',
  effect: 'El corredor adelantado retrocede 3 casillas (movimiento adicional hacia atrás, nunca más allá de la salida).',
  interactions: 'Puede disparar otras habilidades del rival retrocedido (al adelantar, Escurridizo...).',
  animation: 'attack', ai: { n: 7, w: 7 }, config: { back: 3 },
  hooks: {
    async ON_PASS(ctx) {
      const { self, mover, passed } = ctx;
      if (mover !== self || ctx.move.dir < 0 || passed.pos === 0 || !ctx.canAffect(passed, 'back')) return;
      const ok = await ctx.confirm({
        title: 'Carga al galope', text: `Has adelantado a ${ctx.n(passed)}. ¿Hacerle retroceder ${plural(ctx.ab.config.back)}?`, aiValue: 1,
      });
      if (!ok) return;
      await ctx.announce(`¡${ctx.n(self).toUpperCase()} HA ADELANTADO A ${ctx.n(passed).toUpperCase()}! ${ctx.n(passed)} retrocede ${plural(ctx.ab.config.back)}.`, { targets: [passed] });
      await ctx.moveBy(passed, { dist: ctx.ab.config.back, dir: -1, hostile: true, kind: 'back' });
    },
  },
});

def({
  id: 'banana', name: 'Plátano', en: 'Banana', color: '#ffd93d', glyph: '🍌',
  category: 'Trampas', type: 'mandatory', title: 'Piel resbaladiza',
  desc: 'Hace tropezar a los corredores que pasan por su posición.',
  activation: 'Cuando otro corredor adelanta al Plátano durante un movimiento hacia delante.',
  effect: 'El corredor que lo adelanta tropieza (pierde su próximo movimiento principal).',
  interactions: 'Si solo termina en su casilla no hay tropiezo: es "compartir casilla", no "pasar".',
  animation: 'trap', ai: { n: 5, w: 6 },
  hooks: {
    async ON_PASS(ctx) {
      const { self, mover, passed } = ctx;
      if (passed !== self || mover === self || ctx.move.dir < 0 || mover.tripped || !ctx.canAffect(mover, 'trip')) return;
      await ctx.announce(`¡${ctx.n(mover)} pisa la piel de ${ctx.n(self)} y resbala!`, { targets: [mover] });
      await ctx.trip(mover);
    },
  },
});

def({
  id: 'cheerleader', name: 'Animadora', en: 'Cheerleader', color: '#ff70a6', glyph: '🎀',
  category: 'Manipulación de posiciones', type: 'optional', title: 'Ánimo, rezagados',
  desc: 'Puede impulsar al corredor en última posición a cambio de un pequeño movimiento propio.',
  activation: 'Antes de tirar el dado en su turno, si hay corredores por detrás de ella.',
  effect: 'El corredor en última posición avanza 2 (movimiento adicional) y la Animadora avanza 1.',
  interactions: 'Puede acercar rezagados a trampas o a la Baba Yaga. Los últimos empatados se eligen.',
  animation: 'pulse', ai: { n: 4, w: 5 }, config: { boost: 2, self: 1 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self) return;
      const others = ctx.others();
      if (!others.length) return;
      const minPos = Math.min(...others.map((r) => r.pos));
      if (minPos >= self.pos) return;
      const lasts = others.filter((r) => r.pos === minPos);
      const gap = self.pos - minPos;
      const cfg = ctx.ab.config;
      let target = lasts[0];
      if (lasts.length > 1) {
        target = await ctx.pickRacer({
          title: 'Ánimo, rezagados', text: `Elige a quién impulsar ${plural(cfg.boost)} (tú avanzas ${plural(cfg.self)}).`,
          candidates: lasts.map((r) => ({ racer: r, aiValue: gap - 3 })), allowSkip: true,
        });
      } else {
        const ok = await ctx.confirm({
          title: 'Ánimo, rezagados', text: `¿Impulsar a ${ctx.n(target)} (última posición) ${plural(cfg.boost)} y avanzar tú ${plural(cfg.self)}?`, aiValue: gap - 3,
        });
        if (!ok) target = null;
      }
      if (!target) return;
      await ctx.announce(`¡${ctx.n(self)} anima a ${ctx.n(target)}! Ambos avanzan.`, { targets: [target] });
      await ctx.moveBy(target, { dist: cfg.boost });
      await ctx.moveBy(self, { dist: cfg.self });
    },
  },
});

def({
  id: 'duelist', name: 'Duelista', en: 'Duelist', color: '#e63946', glyph: '⚔️',
  category: 'Ataque', type: 'optional', title: 'Duelo de dados',
  desc: 'Cuando comparte casilla con otro corredor puede iniciar un duelo de dados. El ganador avanza.',
  activation: 'Cuando el Duelista termina su movimiento en una casilla con otro corredor, o alguien termina en la suya (máx. 3 veces por carrera).',
  effect: 'Ambos tiran un dado; el mayor avanza 3 casillas (movimiento adicional). En empate no pasa nada.',
  interactions: 'El ganador puede ser el rival. El movimiento adicional activa pasos, estrellas y flechas.',
  animation: 'attack', ai: { n: 5, w: 6 }, limit: { per: 'race', n: 3 }, config: { steps: 3 },
  hooks: {
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover !== self && other !== self) return;
      const rival = mover === self ? other : mover;
      if (!ctx.canUse()) return;
      const steps = ctx.ab.config.steps;
      const ok = await ctx.confirm({
        title: 'Duelo de dados', text: `¿Retar a ${ctx.n(rival)} a un duelo? El ganador avanza ${plural(steps)}.`, aiValue: 1,
      });
      if (!ok) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} reta a ${ctx.n(rival)} a un duelo!`, { targets: [rival] });
      const a = await ctx.roll(self, 'duel');
      const b = await ctx.roll(rival, 'duel');
      if (a === b) return ctx.say(`Empate ${a}-${b}: nadie avanza.`);
      const winner = a > b ? self : rival;
      await ctx.announce(`¡${ctx.n(winner)} gana el duelo (${Math.max(a, b)} contra ${Math.min(a, b)}) y avanza ${plural(steps)}!`, { targets: [winner === self ? rival : self] });
      await ctx.moveBy(winner, { dist: steps });
    },
  },
});

def({
  id: 'hare', name: 'Liebre', en: 'Hare', color: '#b5e48c', glyph: '🐇',
  category: 'Velocidad', type: 'mandatory', title: 'Prisa y siesta',
  desc: 'Es muy rápida, pero la confianza la pierde cuando lidera en solitario.',
  activation: 'Siempre al mover; la siesta se comprueba antes de tirar.',
  effect: '+2 al movimiento principal. Si empieza su turno como líder en solitario, se echa una siesta y su movimiento principal es 0.',
  interactions: 'El Entrenador y las flechas aún pueden moverla. El Hipnotizador puede arrastrarla fuera del liderato.',
  animation: 'dash', ai: { n: 7, w: 6 }, config: { bonus: 2 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self) return;
      ctx.mem.nap = ctx.isSoleLeader(self) && self.pos > 0;
      if (ctx.mem.nap) await ctx.announce(`¡${ctx.n(self)} lidera sola y se echa una siesta! No avanzará este turno.`, { anim: 'zzz' });
    },
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      if (ctx.mem.nap) {
        ctx.mem.nap = false;
        ctx.move.blocked = true;
      } else {
        ctx.move.distance += ctx.ab.config.bonus;
        ctx.say(`${ctx.n(ctx.self)} corre veloz: +${ctx.ab.config.bonus}.`);
      }
    },
  },
});

def({
  id: 'hypnotist', name: 'Hipnotizador', en: 'Hypnotist', color: '#7209b7', glyph: '🌀',
  category: 'Teletransporte', type: 'optional', title: 'Mirada magnética',
  desc: 'Puede transportar a otro corredor hasta su posición.',
  activation: 'Antes de tirar el dado, una vez por carrera.',
  effect: 'Teletransporta a un rival hasta la casilla del Hipnotizador (útil para arrastrar al líder hacia atrás).',
  interactions: 'La teletransportación no activa "adelantar". Sí activa casillas, Baba Yaga, Duelista... Huevo es inmune.',
  animation: 'teleport', ai: { n: 7, w: 7 }, limit: { per: 'race', n: 1 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self || !ctx.canUse()) return;
      const cands = ctx.others().filter((r) => r.pos !== self.pos && ctx.canAffect(r, 'teleport'));
      if (!cands.length) return;
      const target = await ctx.pickRacer({
        title: 'Mirada magnética', text: 'Elige a quién teletransportar a tu casilla (una vez por carrera).',
        candidates: cands.map((r) => ({ racer: r, aiValue: r.pos - self.pos - 3 })), allowSkip: true,
      });
      if (!target) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} hipnotiza a ${ctx.n(target)} y lo arrastra a su casilla!`, { targets: [target], anim: 'teleport' });
      await ctx.moveTo(target, self.pos, { hostile: true });
    },
  },
});

def({
  id: 'legs', name: 'Zancadas', en: 'Legs', color: '#06d6a0', glyph: '🦵',
  category: 'Manipulación de dados', type: 'optional', title: 'Paso largo',
  desc: 'Puede sustituir su tirada por un movimiento fijo.',
  activation: 'Después de tirar el dado, hasta 2 veces por carrera.',
  effect: 'Cambia el resultado del dado por un 5.',
  interactions: 'Se aplica antes que bonificaciones. Alquimista y Abucheador no lo afectan al sustituirlo.',
  animation: 'dash', ai: { n: 6, w: 6 }, limit: { per: 'race', n: 2 }, config: { fixed: 5 },
  hooks: {
    async AFTER_DICE_ROLL(ctx) {
      const { self, turn } = ctx;
      const fixed = ctx.ab.config.fixed;
      if (ctx.actor !== self || turn.roll >= fixed || !ctx.canUse()) return;
      const ok = await ctx.confirm({
        title: 'Paso largo', text: `Sacaste ${turn.roll}. ¿Sustituirlo por un ${fixed}? (te quedan ${ctx.usesLeft()} usos)`,
        aiValue: (ctx.usesLeft() >= 2 ? 3.5 : 2.5) - turn.roll,
      });
      if (!ok) return;
      ctx.use();
      const from = turn.roll;
      turn.roll = fixed;
      await ctx.announce(`¡${ctx.n(self)} cambia su ${from} por un ${fixed}!`);
    },
  },
});

def({
  id: 'magician', name: 'Mago', en: 'Magician', color: '#3a86ff', glyph: '🎩',
  category: 'Manipulación de dados', type: 'optional', title: 'Otra vez, por favor',
  desc: 'Puede repetir la tirada de su movimiento principal hasta dos veces.',
  activation: 'Después de tirar el dado en su turno.',
  effect: 'Vuelve a tirar el dado (máximo 2 repeticiones); se queda con la última.',
  interactions: 'El Alquimista (copiado) transmuta la tirada final. Abucheador y Mercader de Dados actúan sobre la tirada original.',
  animation: 'sparkle', ai: { n: 6, w: 6 }, config: { rerolls: 2 },
  hooks: {
    async AFTER_DICE_ROLL(ctx) {
      const { self, turn } = ctx;
      if (ctx.actor !== self) return;
      for (let i = 0; i < ctx.ab.config.rerolls; i++) {
        const left = ctx.ab.config.rerolls - i;
        const ok = await ctx.confirm({
          title: 'Otra vez, por favor', text: `Tu tirada es ${turn.roll}. ¿Repetirla? (${left} ${left === 1 ? 'repetición disponible' : 'repeticiones disponibles'})`,
          aiValue: 3.5 - turn.roll,
        });
        if (!ok) break;
        const prev = turn.roll;
        turn.roll = await ctx.roll(self, 'reroll');
        await ctx.announce(`¡${ctx.n(self)} repite su tirada! ${prev} → ${turn.roll}.`, { ms: 600 });
      }
    },
  },
});

def({
  id: 'rocket', name: 'Cohetero', en: 'Rocket Scientist', color: '#ef476f', glyph: '🚀',
  category: 'Velocidad', type: 'optional', title: 'Ignición total',
  desc: 'Puede duplicar su movimiento a cambio de sufrir un tropiezo.',
  activation: 'Al iniciar su movimiento principal.',
  effect: 'Su movimiento se multiplica por 2, pero tropieza y pierde el siguiente movimiento principal.',
  interactions: 'El resto de bonificaciones se suman después del doble. Si cruza la meta, el tropiezo no importa.',
  animation: 'dash', ai: { n: 6, w: 5 },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      const { self, move } = ctx;
      if (ctx.mover !== self || move.type !== 'MAIN' || move.distance <= 0) return;
      const L = ctx.L;
      if (move.from + move.distance >= L) return;
      let gain = move.distance;
      if (move.from + move.distance * 2 >= L) gain += 12;
      const ok = await ctx.confirm({
        title: 'Ignición total', text: `Te moverías ${move.distance}. ¿Duplicarlo a ${move.distance * 2} y tropezar después?`, aiValue: gain - 4.5,
      });
      if (!ok) return;
      move.distance *= 2;
      await ctx.announce(`¡${ctx.n(self)} enciende los cohetes! Movimiento doblado a ${move.distance}, pero tropezará.`, { anim: 'dash' });
      await ctx.trip(self, { hostile: false });
    },
  },
});

def({
  id: 'hugebaby', name: 'Bebé Gigante', en: 'Huge Baby', color: '#ffafcc', glyph: '👶',
  category: 'Bloqueo', type: 'passive', title: 'Ocupa demasiado',
  desc: 'Impide que otros corredores terminen en su misma casilla y altera dónde quedan colocados.',
  activation: 'Siempre: cuando un corredor fuera a terminar un movimiento en su casilla.',
  effect: 'Ese corredor se queda una casilla antes (hacia donde venía). Si no había recorrido nada, se queda donde estaba.',
  interactions: 'Afecta a movimientos principales, adicionales y teletransportes. También a las víctimas del Hipnotizador.',
  animation: 'shield', ai: { n: 5, w: 6 },
  hooks: {
    async BEFORE_LANDING(ctx) {
      const { self, mover, move } = ctx;
      if (mover === self || move.dest !== self.pos || move.dest >= ctx.L) return;
      const dir = Math.sign(move.dest - move.from);
      if (!dir) return;
      move.dest -= dir;
      await ctx.announce(`¡${ctx.n(self)} ocupa toda la casilla! ${ctx.n(mover)} se queda una casilla antes.`, { ms: 700, targets: [mover] });
    },
  },
});

def({
  id: 'mouth', name: 'M.O.U.T.H.', en: 'M.O.U.T.H.', color: '#d00000', glyph: '👄',
  category: 'Eliminación', type: 'optional', title: 'Gran bocado',
  desc: 'Puede eliminar a otro corredor cuando termina compartiendo casilla con él, bajo ciertas condiciones.',
  activation: 'Al compartir casilla (en su movimiento o en el del rival), solo si M.O.U.T.H. ha recorrido al menos el 40% del circuito. Una vez por carrera.',
  effect: 'El otro corredor queda eliminado: sale de la carrera y no puntúa.',
  interactions: 'El Huevo (sin eclosionar) es inmune. El jugador eliminado conserva puntos de otras carreras.',
  animation: 'bite', ai: { n: 8, w: 8 }, limit: { per: 'race', n: 1 }, config: { minProgress: 0.4 },
  hooks: {
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover !== self && other !== self) return;
      const victim = mover === self ? other : mover;
      if (!ctx.canUse() || self.pos < Math.ceil(ctx.L * ctx.ab.config.minProgress) || !ctx.canAffect(victim, 'eliminate')) return;
      const ok = await ctx.confirm({
        title: 'Gran bocado', text: `¿Devorar a ${ctx.n(victim)}? Quedará eliminado (solo una vez por carrera).`,
        aiValue: (self.pos / ctx.L) * 10 - 3 + (ctx.rank(victim) <= 2 ? 2 : 0),
      });
      if (!ok) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self).toUpperCase()} DEVORA A ${ctx.n(victim).toUpperCase()}!`, { targets: [victim] });
      await ctx.eliminate(victim);
    },
  },
});

def({
  id: 'copycat', name: 'Gato Copión', en: 'Copy Cat', color: '#adb5bd', glyph: '🐱',
  category: 'Interacciones entre corredores', type: 'passive', title: 'Imitación perfecta',
  desc: 'Copia la habilidad del corredor que va en cabeza.',
  activation: 'Al inicio de su turno elige al líder (el más adelantado que no sea él).',
  effect: 'Hasta su próximo turno posee también la habilidad de ese personaje, con sus propios contadores de uso.',
  interactions: 'Con habilidades "una vez por carrera" las gasta por separado del original.',
  animation: 'swirl', ai: { n: 5, w: 5 }, copy: true, hooks: {},
});

def({
  id: 'dicemonger', name: 'Mercader de Dados', en: 'Dicemonger', color: '#ffb703', glyph: '🎲',
  category: 'Bonificaciones', type: 'mandatory', title: 'Comisión del 6',
  desc: 'Cobra comisión cada vez que alguien saca un 6.',
  activation: 'Después de que cualquier otro corredor tire el dado y su resultado sea 6.',
  effect: 'El Mercader avanza 2 casillas (movimiento adicional), aunque no sea su turno.',
  interactions: 'Abucheador (si actúa antes) puede bajar ese 6 y anular la comisión. Se resuelve por orden de turno.',
  animation: 'gold', ai: { n: 5, w: 5 }, config: { steps: 2 },
  hooks: {
    async AFTER_DICE_ROLL(ctx) {
      const { self, actor, turn } = ctx;
      if (actor === self || turn.roll !== 6) return;
      await ctx.announce(`¡${ctx.n(actor)} saca un 6 y ${ctx.n(self)} cobra su comisión!`, { ms: 700 });
      await ctx.moveBy(self, { dist: ctx.ab.config.steps });
    },
  },
});

def({
  id: 'genius', name: 'Genio', en: 'Genius', color: '#00b4d8', glyph: '🧠',
  category: 'Manipulación de dados', type: 'optional', title: 'Cálculo exacto',
  desc: 'Predice su tirada: si acierta, recibe un gran impulso.',
  activation: 'Antes de tirar el dado elige un número del 1 al 6.',
  effect: 'Si el dado coincide con la predicción, su resultado aumenta en 4. Si falla, no pasa nada.',
  interactions: 'Se compara con el resultado del dado antes de transmutaciones posteriores; Alquimista copiado puede cambiarlo.',
  animation: 'sparkle', ai: { n: 5, w: 5 }, config: { bonus: 4 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      if (ctx.actor !== ctx.self) return;
      ctx.mem.guess = null;
      const n = await ctx.pickNumber({
        title: 'Cálculo exacto', text: `Predice tu tirada (1-6). Si aciertas: +${ctx.ab.config.bonus}.`, min: 1, max: 6, allowSkip: true, aiValue: () => 0.2,
      });
      if (n) {
        ctx.mem.guess = n;
        ctx.say(`${ctx.n(ctx.self)} predice un ${n}.`);
      }
    },
    async AFTER_DICE_ROLL(ctx) {
      if (ctx.actor !== ctx.self || !ctx.mem.guess) return;
      const g = ctx.mem.guess;
      ctx.mem.guess = null;
      if (g !== ctx.turn.roll) return ctx.say(`${ctx.n(ctx.self)} falló su predicción (${g}).`);
      ctx.turn.roll += ctx.ab.config.bonus;
      await ctx.announce(`¡${ctx.n(ctx.self)} acierta su predicción! +${ctx.ab.config.bonus} al movimiento.`);
    },
  },
});

def({
  id: 'heckler', name: 'Abucheador', en: 'Heckler', color: '#8d99ae', glyph: '😠',
  category: 'Manipulación de dados', type: 'mandatory', title: 'Abucheo',
  desc: 'Ridiculiza las tiradas más altas de los demás.',
  activation: 'Después de que otro corredor tire el dado y saque un 6.',
  effect: 'Ese 6 se reduce en 2 antes de mover.',
  interactions: 'Si actúa antes que el Mercader de Dados, anula su comisión.',
  animation: 'curse', ai: { n: 5, w: 5 }, config: { cut: 2 },
  hooks: {
    async AFTER_DICE_ROLL(ctx) {
      const { self, actor, turn } = ctx;
      if (actor === self || turn.roll !== 6) return;
      turn.roll -= ctx.ab.config.cut;
      await ctx.announce(`¡${ctx.n(self)} abuchea a ${ctx.n(actor)}! Su 6 baja a ${turn.roll}.`, { targets: [actor], ms: 800 });
    },
  },
});

def({
  id: 'egg', name: 'Huevo', en: 'Egg', color: '#f1faee', glyph: '🥚',
  category: 'Habilidades pasivas', type: 'passive', title: 'Cascarón',
  desc: 'Protegido y lento al principio; cuando eclosiona se vuelve veloz.',
  activation: 'Siempre. Eclosiona al terminar un movimiento en el 40% del circuito o más.',
  effect: 'Sin eclosionar: -1 al movimiento (mínimo 1) e inmune a retrocesos, teletransportes ajenos y eliminación. Eclosionado: +2 al movimiento y 1 ficha.',
  interactions: 'Frena a Centauro, Hipnotizador, M.O.U.T.H. y Chancla mientras está en el cascarón.',
  animation: 'shield', ai: { n: 5, w: 5 }, config: { minProgress: 0.4 },
  immune(ctx, kind) {
    return !ctx.mem.hatched && ['back', 'teleport', 'eliminate'].includes(kind);
  },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      ctx.move.distance = ctx.mem.hatched ? ctx.move.distance + 2 : Math.max(1, ctx.move.distance - 1);
    },
    async AFTER_MOVEMENT(ctx) {
      const { self } = ctx;
      if (ctx.mover !== self || ctx.mem.hatched || self.pos < Math.ceil(ctx.L * ctx.ab.config.minProgress)) return;
      ctx.mem.hatched = true;
      await ctx.announce(`¡${ctx.n(self)} eclosiona! Ahora corre mucho más rápido (+2).`, { anim: 'confetti' });
      ctx.chip(1);
    },
  },
});

def({
  id: 'gunk', name: 'Mugre', en: 'Gunk', color: '#6b705c', glyph: '🟢',
  category: 'Trampas', type: 'mandatory', title: 'Rastro viscoso',
  desc: 'Deja pegajosos a los corredores que se acercan demasiado.',
  activation: 'Cuando otro corredor adelanta a Mugre, o comparte casilla con él.',
  effect: 'El corredor afectado tiene -2 en su próximo movimiento principal.',
  interactions: 'No se acumula: varios contactos seguidos solo aplican un -2.',
  animation: 'trap', ai: { n: 5, w: 6 }, config: { slow: 2 },
  hooks: {
    async ON_PASS(ctx) {
      const { self, mover, passed } = ctx;
      if (passed !== self || mover === self || ctx.move.dir < 0) return;
      await ctx.announce(`¡${ctx.n(mover)} se pega en la mugre de ${ctx.n(self)}! -${ctx.ab.config.slow} a su próximo movimiento.`, { targets: [mover], ms: 800 });
      ctx.addMod(mover, { label: 'mugre', value: -ctx.ab.config.slow });
    },
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover !== self && other !== self) return;
      const victim = mover === self ? other : mover;
      await ctx.announce(`¡${ctx.n(victim)} se pega en la mugre de ${ctx.n(self)}! -${ctx.ab.config.slow} a su próximo movimiento.`, { targets: [victim], ms: 800 });
      ctx.addMod(victim, { label: 'mugre', value: -ctx.ab.config.slow });
    },
  },
});

def({
  id: 'flipflop', name: 'Chancla', en: 'Flip Flop', color: '#ff9f1c', glyph: '🩴',
  category: 'Manipulación de posiciones', type: 'optional', title: 'Cambiazo',
  desc: 'Puede intercambiar su posición con la de un rival que va por delante.',
  activation: 'Antes de tirar el dado, una vez por carrera.',
  effect: 'Ambos se teletransportan a la casilla del otro. Después, Chancla tira pero su movimiento principal de ese turno es 2 menor.',
  interactions: 'No activa "adelantar". Sí activa casillas y compartir casilla. Huevo es inmune.',
  animation: 'teleport', ai: { n: 6, w: 6 }, limit: { per: 'race', n: 1 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self || !ctx.canUse()) return;
      const cands = ctx.others().filter((r) => r.pos > self.pos && ctx.canAffect(r, 'teleport'));
      if (!cands.length) return;
      const target = await ctx.pickRacer({
        title: 'Cambiazo', text: 'Elige un rival por delante con quien intercambiar posición (una vez por carrera).',
        candidates: cands.map((r) => ({ racer: r, aiValue: r.pos - self.pos - 6 })), allowSkip: true,
      });
      if (!target) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} intercambia su sitio con ${ctx.n(target)}!`, { targets: [target], anim: 'teleport' });
      await ctx.swap(self, target);
      ctx.addMod(self, { label: 'cambiazo', value: -2 });
    },
  },
});

def({
  id: 'inchworm', name: 'Gusano Medidor', en: 'Inchworm', color: '#9ef01a', glyph: '🐛',
  category: 'Habilidades pasivas', type: 'passive', title: 'Se agarra donde puede',
  desc: 'Se arrastra despacio, pero se engancha a quien lo adelanta.',
  activation: 'Siempre al mover; el enganche ocurre cuando un rival lo adelanta.',
  effect: 'Su movimiento principal siempre es 3. Cuando un rival lo adelanta, se mueve hasta la casilla donde ese rival se detiene.',
  interactions: 'El movimiento de enganche es adicional: puede activar estrellas, flechas y compartir casilla con el rival.',
  animation: 'dash', ai: { n: 5, w: 6 }, config: { fixed: 3 },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      ctx.move.distance = ctx.ab.config.fixed;
    },
    async ON_PASS(ctx) {
      const { self, mover, passed } = ctx;
      if (passed !== self || mover === self || ctx.move.dir < 0 || mover.pos >= ctx.L) return;
      const dist = mover.pos - self.pos;
      if (dist <= 0) return;
      await ctx.announce(`¡${ctx.n(self)} se engancha a ${ctx.n(mover)} y avanza ${plural(dist)}!`, { targets: [mover] });
      await ctx.moveBy(self, { dist });
    },
  },
});

def({
  id: 'mastermind', name: 'Cerebro', en: 'Mastermind', color: '#560bad', glyph: '🕶️',
  category: 'Alteración del orden de turnos', type: 'optional', title: 'Plan maestro',
  desc: 'Puede invertir el orden de turnos de todos los corredores.',
  activation: 'Antes de tirar el dado en su turno, una vez por carrera.',
  effect: 'El orden de turnos se invierte para el resto de la carrera (el Cerebro mantiene su turno actual).',
  interactions: 'Cambia el orden en que se resuelven las habilidades. Conviene si el siguiente rival te saca ventaja.',
  animation: 'swirl', ai: { n: 5, w: 5 }, limit: { per: 'race', n: 1 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self || !ctx.canUse()) return;
      const order = ctx.engine.state.turnOrder.map((id) => ctx.engine.state.racers[id]);
      if (order.length < 3) return;
      const i = order.indexOf(self);
      const next = order[(i + 1) % order.length];
      const prev = order[(i - 1 + order.length) % order.length];
      const ok = await ctx.confirm({
        title: 'Plan maestro', text: '¿Invertir el orden de turnos durante el resto de la carrera? (una vez por carrera)',
        aiValue: next.pos - prev.pos - 2,
      });
      if (!ok) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} invierte el orden de turnos!`);
      ctx.reverseOrder();
    },
  },
});

def({
  id: 'lackey', name: 'Lacayo', en: 'Lackey', color: '#bc6c25', glyph: '🛎️',
  category: 'Bonificaciones', type: 'mandatory', title: 'A la sombra del campeón',
  desc: 'Aprovecha el tirón del primero que llega a la meta.',
  activation: 'Cuando el primer corredor cruza la meta.',
  effect: 'El Lacayo avanza 4 casillas (movimiento adicional) y puede arrebatar el segundo puesto.',
  interactions: 'Si termina cruzando la meta, la carrera acaba con él en segunda posición.',
  animation: 'dash', ai: { n: 5, w: 5 }, config: { steps: 4 },
  hooks: {
    async ON_FINISH(ctx) {
      const { self, subject } = ctx;
      if (subject === self) return;
      await ctx.announce(`¡${ctx.n(subject)} cruza la meta y ${ctx.n(self)} corre tras su estela!`);
      await ctx.moveBy(self, { dist: ctx.ab.config.steps });
    },
  },
});

def({
  id: 'loveableloser', name: 'Perdedor Entrañable', en: 'Loveable Loser', color: '#a2d2ff', glyph: '🥺',
  category: 'Bonificaciones', type: 'mandatory', title: 'El público te quiere',
  desc: 'Cuanto peor va, más le anima el público.',
  activation: 'Al inicio de su turno, si está en última posición en solitario.',
  effect: '+2 a su movimiento principal ese turno y 1 ficha de puntos (máximo 2 fichas por carrera).',
  interactions: 'Animadora e Hipnotizador pueden dejarlo sin su última posición.',
  animation: 'confetti', ai: { n: 5, w: 5 }, config: { bonus: 2, maxChips: 2 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self) return;
      ctx.mem.pity = ctx.isSoleLast(self);
      if (!ctx.mem.pity) return;
      await ctx.announce(`¡El público anima a ${ctx.n(self)}! +${ctx.ab.config.bonus} al movimiento.`, { anim: 'confetti' });
      if ((ctx.mem.chips || 0) < ctx.ab.config.maxChips) {
        ctx.mem.chips = (ctx.mem.chips || 0) + 1;
        ctx.chip(1);
      }
    },
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN' || !ctx.mem.pity) return;
      ctx.mem.pity = false;
      ctx.move.distance += ctx.ab.config.bonus;
    },
  },
});

def({
  id: 'leaptoad', name: 'Sapo Saltarín', en: 'Leaptoad', color: '#2d6a4f', glyph: '🐸',
  category: 'Habilidades pasivas', type: 'passive', title: 'Saltos sobre nenúfares',
  desc: 'Salta por encima de las casillas ocupadas.',
  activation: 'Siempre durante su movimiento principal.',
  effect: 'Las casillas con otros corredores no cuentan como pasos: avanza más lejos.',
  interactions: 'Sigue "adelantando" a los saltados (Plátano, Centauro...), pero evita terminar compartiendo casilla.',
  animation: 'dash', ai: { n: 5, w: 6 },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      ctx.move.skipOccupied = true;
    },
    async AFTER_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN' || !ctx.move.jumped.length) return;
      const names = ctx.move.jumped.map((id) => ctx.n(ctx.engine.state.racers[id])).join(', ');
      await ctx.announce(`¡${ctx.n(ctx.self)} salta sobre ${names} sin gastar pasos!`, { ms: 700 });
    },
  },
});

def({
  id: 'partyanimal', name: 'Fiestero', en: 'Party Animal', color: '#ff006e', glyph: '🪩',
  category: 'Manipulación de posiciones', type: 'mandatory', title: '¡Que empiece la fiesta!',
  desc: 'Atrae a todos hacia su fiesta y se beneficia de la multitud.',
  activation: 'Al inicio de su turno.',
  effect: 'Todos los rivales a 5 casillas o menos dan 1 paso hacia él (movimiento adicional). Su movimiento principal recibe +1 por cada corredor en su casilla.',
  interactions: 'Provoca compartir casilla: Baba Yaga, Romántico, Duelista... Los pasos hacia atrás no pasan de la salida.',
  animation: 'pulse', ai: { n: 6, w: 7 }, config: { radius: 5 },
  hooks: {
    async BEFORE_MAIN_MOVE(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self) return;
      const targets = ctx.others().filter((r) => r.pos !== self.pos && Math.abs(r.pos - self.pos) <= ctx.ab.config.radius);
      if (!targets.length) return;
      await ctx.announce(`¡${ctx.n(self)} monta una fiesta! Todos dan un paso hacia él.`, { targets });
      for (const r of targets) {
        if (!ctx.isActive(r) || r.pos === self.pos) continue;
        await ctx.moveBy(r, { dist: 1, dir: Math.sign(self.pos - r.pos), kind: 'pull' });
      }
    },
    async DURING_MOVEMENT(ctx) {
      const { self, move } = ctx;
      if (ctx.mover !== self || move.type !== 'MAIN') return;
      const crowd = ctx.at(self.pos).length - 1;
      if (crowd <= 0) return;
      move.distance += crowd;
      ctx.say(`La multitud empuja a ${ctx.n(self)}: +${crowd}.`);
    },
  },
});

def({
  id: 'sisyphus', name: 'Sísifo', en: 'Sisyphus', color: '#6c757d', glyph: '🪨',
  category: 'Habilidades pasivas', type: 'mandatory', title: 'La roca eterna',
  desc: 'Empuja con fuerza, pero su roca rueda hacia atrás una vez... y luego se vuelve imparable.',
  activation: 'Siempre al mover; la roca rueda al pasar de la mitad del circuito.',
  effect: '+1 al movimiento. La primera vez que termina un movimiento en la mitad del circuito o más, rueda hasta el 25% del circuito. A partir de entonces: +3.',
  interactions: 'El retroceso es un movimiento adicional (el Escurridizo se aprovecha). Nunca más allá de la salida.',
  animation: 'curse', ai: { n: 5, w: 5 }, config: { before: 1, after: 3, threshold: 0.5, rollback: 0.25 },
  hooks: {
    async DURING_MOVEMENT(ctx) {
      if (ctx.mover !== ctx.self || ctx.move.type !== 'MAIN') return;
      ctx.move.distance += ctx.mem.rolled ? ctx.ab.config.after : ctx.ab.config.before;
    },
    async AFTER_MOVEMENT(ctx) {
      const { self } = ctx;
      const c = ctx.ab.config;
      if (ctx.mover !== self || ctx.mem.rolled || self.pos < Math.ceil(ctx.L * c.threshold)) return;
      ctx.mem.rolled = true;
      const target = Math.floor(ctx.L * c.rollback);
      await ctx.announce(`¡La roca de ${ctx.n(self)} rueda cuesta abajo! Retrocede a la casilla ${target}, pero ahora será imparable.`, { anim: 'curse' });
      await ctx.moveBy(self, { dist: self.pos - target, dir: -1, kind: 'self' });
    },
  },
});

def({
  id: 'romantic', name: 'Romántico', en: 'Romantic', color: '#ff758f', glyph: '💘',
  category: 'Interacciones entre corredores', type: 'mandatory', title: 'Amor a primera vista',
  desc: 'Se entusiasma cada vez que comparte casilla con alguien.',
  activation: 'Cuando el Romántico comparte casilla con otro corredor (una vez por turno).',
  effect: 'El Romántico avanza 2 casillas (movimiento adicional).',
  interactions: 'Con Baba Yaga, se resuelve por orden de turno: puede huir antes de tropezar... o no.',
  animation: 'hearts', ai: { n: 5, w: 5 }, limit: { per: 'turn', n: 1 }, config: { steps: 2 },
  hooks: {
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover !== self && other !== self) return;
      if (!ctx.canUse()) return;
      ctx.use();
      const partner = mover === self ? other : mover;
      await ctx.announce(`¡${ctx.n(self)} se enamora de ${ctx.n(partner)} y sale corriendo tras la emoción!`, { anim: 'hearts', targets: [partner] });
      await ctx.moveBy(self, { dist: ctx.ab.config.steps });
    },
  },
});

def({
  id: 'scoocher', name: 'Escurridizo', en: 'Scoocher', color: '#4895ef', glyph: '🦎',
  category: 'Interacciones entre corredores', type: 'mandatory', title: 'A rebufo',
  desc: 'Se aprovecha de todo el caos que provocan los demás.',
  activation: 'Cuando otro corredor realiza un movimiento adicional (habilidades, flechas, retrocesos...). Máx. 3 por turno.',
  effect: 'El Escurridizo avanza 1 casilla (movimiento adicional).',
  interactions: 'Se alimenta de Centauro, Duelista, flechas, Fiestero, Animadora... y no de los movimientos principales.',
  animation: 'dash', ai: { n: 5, w: 7 }, limit: { per: 'turn', n: 3 },
  hooks: {
    async ON_OTHER_PLAYER_MOVE(ctx) {
      const { self, mover, move } = ctx;
      if (mover === self || move.type !== 'EXTRA' || !ctx.canUse()) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} se pega a la estela del movimiento de ${ctx.n(mover)}!`, { ms: 600, targets: [mover] });
      await ctx.moveBy(self, { dist: 1 });
    },
  },
});

def({
  id: 'stickler', name: 'Quisquilloso', en: 'Stickler', color: '#8338ec', glyph: '📏',
  category: 'Bloqueo', type: 'passive', title: 'Silencio en la sala',
  desc: 'Su presencia intimida: los cercanos no se atreven a usar poderes opcionales.',
  activation: 'Siempre: a los corredores a 2 casillas o menos de él.',
  effect: 'Los corredores cercanos no pueden usar habilidades opcionales (las obligatorias y pasivas funcionan).',
  interactions: 'Anula a Mago, Zancadas, Centauro, Hipnotizador... y a cualquier habilidad opcional cercana.',
  animation: 'shield', ai: { n: 5, w: 5 }, config: { radius: 2 },
  silences(engine, victim, owner, ab) {
    return victim !== owner && Math.abs(victim.pos - owner.pos) <= ab.config.radius;
  },
  hooks: {},
});

def({
  id: 'suckerfish', name: 'Rémora', en: 'Suckerfish', color: '#48cae4', glyph: '🐟',
  category: 'Interacciones entre corredores', type: 'optional', title: 'Viaje gratis',
  desc: 'Se pega a los corredores que salen desde su casilla.',
  activation: 'Cuando otro corredor termina su movimiento principal habiendo empezado en la casilla de la Rémora.',
  effect: 'La Rémora avanza la mitad (redondeando hacia arriba) de lo que avanzó ese corredor.',
  interactions: 'Se combina con el Entrenador (misma casilla de salida) o el Fiestero (junta a todos).',
  animation: 'dash', ai: { n: 5, w: 5 },
  hooks: {
    async ON_OTHER_PLAYER_MOVE(ctx) {
      const { self, mover, move } = ctx;
      if (mover === self || move.type !== 'MAIN' || move.from !== self.pos || move.dir < 0 || move.moved < 2) return;
      const dist = Math.ceil(move.moved / 2);
      const ok = await ctx.confirm({
        title: 'Viaje gratis', text: `${ctx.n(mover)} avanzó ${move.moved} desde tu casilla. ¿Pegarte a él y avanzar ${plural(dist)}?`, aiValue: 1,
      });
      if (!ok) return;
      await ctx.announce(`¡${ctx.n(self)} se agarra a ${ctx.n(mover)} y avanza ${plural(dist)}!`, { targets: [mover] });
      await ctx.moveBy(self, { dist });
    },
  },
});

def({
  id: 'thirdwheel', name: 'Tercero en Discordia', en: 'Third Wheel', color: '#fb8500', glyph: '👀',
  category: 'Teletransporte', type: 'optional', title: 'Me apunto',
  desc: 'Se cuela donde dos corredores comparten casilla.',
  activation: 'Cuando otros dos corredores comparten casilla por delante de él (a 8 casillas o menos). Dos veces por carrera.',
  effect: 'Se teletransporta a esa casilla.',
  interactions: 'Puede acabar compartiendo casilla con Baba Yaga o el Duelista. No activa "adelantar".',
  animation: 'teleport', ai: { n: 6, w: 7 }, limit: { per: 'race', n: 2 }, config: { range: 8 },
  hooks: {
    async ON_SHARED_SPACE(ctx) {
      const { self, mover, other } = ctx;
      if (mover === self || other === self || !ctx.canUse()) return;
      const space = mover.pos;
      const gap = space - self.pos;
      if (gap <= 0 || gap > ctx.ab.config.range || space >= ctx.L) return;
      const ok = await ctx.confirm({
        title: 'Me apunto', text: `${ctx.n(mover)} y ${ctx.n(other)} comparten la casilla ${space}. ¿Colarte (teletransporte, +${gap})?`, aiValue: gap - 2,
      });
      if (!ok) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} se cuela en la casilla de ${ctx.n(mover)} y ${ctx.n(other)}!`, { targets: [mover, other], anim: 'teleport' });
      await ctx.moveTo(self, space);
    },
  },
});

def({
  id: 'twin', name: 'Gemelo', en: 'Twin', color: '#80ed99', glyph: '👯',
  category: 'Interacciones entre corredores', type: 'mandatory', title: 'Eco de dados',
  desc: 'Su hermano gemelo repite lo que otros consiguen con el mismo dado.',
  activation: 'Cuando otro corredor mueve con una tirada igual a la última tirada del Gemelo.',
  effect: 'El Gemelo avanza la mitad (redondeando hacia arriba) de esa tirada, como movimiento adicional.',
  interactions: 'Cuenta la tirada final (tras Alquimista, Mago, Abucheador...).',
  animation: 'swirl', ai: { n: 5, w: 5 },
  hooks: {
    async ON_OTHER_PLAYER_MOVE(ctx) {
      const { self, mover, move } = ctx;
      if (mover === self || move.type !== 'MAIN' || move.roll == null || self.lastRoll !== move.roll) return;
      const dist = Math.ceil(move.roll / 2);
      await ctx.announce(`¡${ctx.n(mover)} saca lo mismo que ${ctx.n(self)}: ${move.roll}! El Gemelo avanza ${plural(dist)}.`, { ms: 800, targets: [mover] });
      await ctx.moveBy(self, { dist });
    },
  },
});

def({
  id: 'skipper', name: 'Patrón', en: 'Skipper', color: '#118ab2', glyph: '⚓',
  category: 'Alteración del orden de turnos', type: 'optional', title: 'Al timón',
  desc: 'Puede saltarse la cola y jugar otro turno seguido.',
  activation: 'Al terminar su turno, una vez por carrera.',
  effect: 'Juega inmediatamente un turno extra completo.',
  interactions: 'Un turno extra vuelve a activar habilidades "antes de mover" del resto.',
  animation: 'dash', ai: { n: 5, w: 5 }, limit: { per: 'race', n: 1 },
  hooks: {
    async TURN_END(ctx) {
      const { self } = ctx;
      if (ctx.actor !== self || !ctx.canUse() || self.tripped) return;
      const ok = await ctx.confirm({
        title: 'Al timón', text: '¿Jugar otro turno seguido? (una vez por carrera)', aiValue: ctx.L - self.pos <= 9 ? 1 : -1,
      });
      if (!ok) return;
      ctx.use();
      await ctx.announce(`¡${ctx.n(self)} toma el timón y juega otro turno!`);
      ctx.extraTurn(self);
    },
  },
});

export const CHARACTERS = defs;
export const CHAR_BY_ID = Object.fromEntries(defs.map((d) => [d.id, d]));
export const CHARACTER_IDS = defs.map((d) => d.id);

// Información serializable (sin funciones) para clientes.
export function publicCharacter(d) {
  const { hooks, immune, silences, ...rest } = d;
  return { ...rest, triggers: Object.keys(hooks) };
}
