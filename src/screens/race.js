import { h } from '../dom.js';
import { S, myId, saveOpts } from '../store.js';
import { net } from '../net.js';
import { G } from '../ctx.js';
import { button, abilityDetail, showCharacter, typeBadge, timerEl } from '../components.js';
import { avatar } from '../assets.js';
import { audioSettings } from '../audio.js';
import { CHAR_BY_ID } from '../../shared/characters.js';
import { CIRCUITS, SPACE_INFO } from '../../shared/board.js';
import { DiceView } from '../three/dice.js';
import { showTutorial } from './tutorial.js';
import { renderResult } from './results.js';

const els = {};
let mounted = false;
let bannerTimer = null;
let rollSent = false;

const pname = (id) => S.race?.racers[id]?.name || '';
const cname = (id) => { const r = S.race?.racers[id]; return r ? CHAR_BY_ID[r.charId].name : ''; };

export const hud = {
  refresh() { if (mounted) race.update(); },

  clearLog() { if (els.log) els.log.replaceChildren(); },

  log(text, kind = 'info') {
    S.log.push({ text, kind });
    if (S.log.length > 250) S.log.shift();
    if (!els.log) return;
    els.log.append(h('div', { class: `log-line k-${kind}` }, text));
    while (els.log.childElementCount > 160) els.log.firstChild.remove();
    els.log.scrollTop = els.log.scrollHeight;
  },

  banner(ev) {
    if (!els.banner) return;
    const c = ev.abilityId && CHAR_BY_ID[ev.abilityId];
    els.banner.replaceChildren(
      h('div', { class: 'b-head' }, c && avatar(c.id, 'tiny'), h('span', { class: 'b-name' }, ev.name || ''), ev.title && h('span', { class: 'b-title' }, `✦ ${ev.title}`)),
      h('div', { class: 'b-text' }, ev.text));
    els.banner.classList.remove('show');
    void els.banner.offsetWidth;
    els.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => els.banner?.classList.remove('show'), 3000);
  },

  diceStart(racerId, purpose) {
    if (!els.diceLabel) return;
    const what = { main: 'tira el dado', reroll: 'repite la tirada', duel: 'tira en el duelo', ability: 'tira un dado' }[purpose] || 'tira';
    els.diceLabel.textContent = `${pname(racerId)} ${what}…`;
  },

  diceResult(racerId, value) {
    if (els.diceLabel) els.diceLabel.textContent = `${pname(racerId)} saca un ${value}`;
  },

  showDecision(req) {
    els.decision?.remove();
    if (!els.root) return;
    S.request = req;
    const deadline = req.seconds ? Date.now() + req.seconds * 1000 : null;
    const answer = (id) => { net.send({ type: 'decide', requestId: req.id, answer: id }); this.closeDecision(); };
    let body;
    if (req.type === 'confirm') {
      body = h('div', { class: 'opts' }, button('✔ Usar habilidad', () => answer('yes'), 'primary xl'), button('✖ No usar', () => answer('no'), 'xl'));
    } else if (req.type === 'racer') {
      body = h('div', { class: 'opts col' }, req.options.map((o) => {
        const r = S.race?.racers[o.racerId];
        return h('button', { class: 'btn opt', onClick: () => answer(o.id) }, r && avatar(r.charId, 'tiny'), o.label);
      }), req.allowSkip && button('No usar', () => answer(null), 'ghost'));
    } else {
      body = h('div', { class: 'opts' }, h('div', { class: 'num-grid' }, req.options.map((o) => h('button', { class: 'btn num', onClick: () => answer(o.id) }, o.label))), req.allowSkip && button('No usar', () => answer(null), 'ghost'));
    }
    els.decision = h('div', { class: 'decision' },
      h('div', { class: 'dec-head' }, avatar(req.charId, 'tiny'), h('div', null, h('b', null, req.title), h('div', { class: 'muted' }, cname(req.racerId))), deadline && timerEl(deadline)),
      h('p', null, req.text), body);
    els.root.append(els.decision);
  },

  closeDecision() {
    els.decision?.remove();
    els.decision = null;
    S.request = null;
  },
};

function tipFor(i) {
  const circuit = CIRCUITS[S.race?.circuit];
  const sp = circuit?.spaces[i];
  if (!sp) return null;
  const info = SPACE_INFO[sp.type];
  let extra = '';
  if (sp.type === 'arrow') extra = ` (${sp.delta > 0 ? '+' : ''}${sp.delta})`;
  if (sp.type === 'portal') extra = ` → casilla ${sp.to}`;
  if (sp.type === 'star' && S.race?.starsClaimed?.[i]) extra = ' (ya conseguida)';
  return { title: `Casilla ${i}: ${info.label}${extra}`, text: info.desc };
}

export const race = {
  mount(root) {
    mounted = true;
    els.root = root;
    G.world.setMode('race');
    G.world.followOn = S.opts.followCam;
    els.badge = h('div', { class: 'race-badge' });
    els.score = h('div', { class: 'scoreboard' });
    els.order = h('div', { class: 'order' });
    els.log = h('div', { class: 'log-list' });
    els.card = h('div', { class: 'ability-card' });
    els.banner = h('div', { class: 'banner' });
    els.diceLabel = h('div', { class: 'dice-label' }, '');
    els.diceSlot = h('div', { class: 'dice-slot' });
    els.roll = h('button', { class: 'btn roll', onClick: () => { if (els.roll.classList.contains('ready') && !rollSent) { rollSent = true; net.send({ type: 'roll' }); } } }, '🎲 TIRAR DADO');
    els.hint = h('div', { class: 'roll-hint' });
    els.tip = h('div', { class: 'tile-tip' });
    els.overlay = h('div', { class: 'overlay-slot' });
    if (!G.dice) G.dice = new DiceView(els.diceSlot);
    else els.diceSlot.append(G.dice.renderer.domElement);

    const chatInput = h('input', { class: 'input', maxlength: 200, placeholder: 'Chat…' });
    const chat = h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); const v = chatInput.value.trim(); if (v) net.send({ type: 'chat', text: v }); chatInput.value = ''; } }, chatInput);

    const followBtn = h('button', { class: `btn small ${S.opts.followCam ? 'on' : ''}`, title: 'Cámara automática', onClick: () => { S.opts.followCam = !S.opts.followCam; saveOpts(); G.world.followOn = S.opts.followCam; followBtn.classList.toggle('on', S.opts.followCam); } }, '🎥 Auto');
    const soundBtn = h('button', { class: 'btn small', onClick: () => { S.opts.sound = !S.opts.sound; audioSettings.enabled = S.opts.sound; saveOpts(); soundBtn.textContent = S.opts.sound ? '🔊' : '🔇'; } }, S.opts.sound ? '🔊' : '🔇');

    root.replaceChildren(h('div', { class: 'hud' },
      h('div', { class: 'hud-top' }, els.badge,
        h('div', { class: 'hud-actions' },
          h('button', { class: 'btn small', onClick: () => G.world.fitBoard() }, '🗺 Vista'), followBtn,
          h('button', { class: 'btn small', onClick: () => showTutorial() }, '? Ayuda'), soundBtn,
          h('button', { class: 'btn small danger', onClick: () => { if (confirm('¿Salir de la partida? La IA jugará por ti y podrás volver con "Continuar".')) net.send({ type: 'leave' }); } }, 'Salir'))),
      h('div', { class: 'hud-right' }, els.score),
      h('div', { class: 'hud-left' }, h('div', { class: 'hud-label' }, 'Orden de turnos'), els.order),
      h('div', { class: 'hud-bottom' },
        h('div', { class: 'logbox' }, h('div', { class: 'hud-label' }, 'Registro de eventos'), els.log, chat),
        h('div', { class: 'dice-box' }, els.diceSlot, els.diceLabel, els.roll, els.hint),
        els.card),
      els.banner, els.tip, els.overlay));

    G.world.onHover = (i, x, y) => {
      const t = i == null ? null : tipFor(i);
      if (!t) { els.tip.classList.remove('show'); return; }
      els.tip.replaceChildren(h('b', null, t.title), h('div', null, t.text));
      els.tip.style.left = `${Math.min(window.innerWidth - 260, x + 14)}px`;
      els.tip.style.top = `${y + 14}px`;
      els.tip.classList.add('show');
    };
    // Restaura el registro tras recargar
    for (const l of S.log.slice(-120)) els.log.append(h('div', { class: `log-line k-${l.kind}` }, l.text));
    els.log.scrollTop = els.log.scrollHeight;
    if (S.request) hud.showDecision(S.request);
    this.update();
    if (!S.opts.tutorialSeen && S.t?.raceNumber === 1) setTimeout(() => showTutorial(), 600);
  },

  unmount() {
    mounted = false;
    G.world.onHover = null;
    for (const k of Object.keys(els)) delete els[k];
  },

  update() {
    if (!mounted) return;
    const t = S.t;
    const r = S.race;
    if (!t || !r) { els.badge.textContent = 'Preparando carrera…'; return; }
    const me = myId();
    const circuit = CIRCUITS[r.circuit];
    els.badge.replaceChildren(
      h('b', null, `Carrera ${t.raceNumber}/${t.config.races}`), ` · ${circuit.name} · `, `Turno ${r.turnNo}`);

    // marcador
    const L = r.L;
    const rows = Object.values(r.racers).sort((a, b) => {
      const ka = a.finished ? a.place : a.eliminated ? 99 : 10 + (L - a.pos);
      const kb = b.finished ? b.place : b.eliminated ? 99 : 10 + (L - b.pos);
      return ka - kb;
    });
    const activeId = r.turn?.actorId;
    els.score.replaceChildren(
      h('div', { class: 'hud-label' }, 'Marcador'),
      ...rows.map((x) => {
        const c = CHAR_BY_ID[x.charId];
        const status = x.finished ? `🏁 ${x.place}º` : x.eliminated ? '☠ eliminado' : `casilla ${x.pos}/${L}`;
        return h('div', { class: `sb-row ${x.id === activeId && !r.over ? 'active' : ''} ${x.finished ? 'done' : ''} ${x.eliminated ? 'dead' : ''}`, style: { '--owner': x.color }, title: `${c.title}: ${c.desc}`, onClick: () => showCharacter(x.charId) },
          h('div', { class: 'sb-art' }, avatar(x.charId, 'tiny')),
          h('div', { class: 'sb-main' },
            h('div', { class: 'sb-name' }, x.name, x.id === me && h('span', { class: 'badge me' }, 'TÚ'), x.tripped && '💫', x.mods?.length ? '🐌' : null),
            h('div', { class: 'sb-sub' }, `${c.name} · ${status}`)),
          h('div', { class: 'sb-pts' },
            h('div', { class: 'sb-total' }, `${t.scores[x.id]?.total ?? 0}`, h('small', null, ' pts')),
            h('div', { class: 'sb-race' }, `⭐${x.stars}  ◈${x.chips}`)));
      }));

    // orden de turnos
    els.order.replaceChildren(...r.turnOrder.map((id) => {
      const x = r.racers[id];
      return h('div', { class: `ord ${id === activeId ? 'on' : ''}`, style: { '--owner': x.color }, title: `${x.name} (${CHAR_BY_ID[x.charId].name})` }, avatar(x.charId, 'tiny'));
    }));

    // ficha de habilidad del personaje activo
    const act = activeId && r.racers[activeId];
    if (act) {
      const c = CHAR_BY_ID[act.charId];
      const copied = act.copiedId && CHAR_BY_ID[act.copiedId];
      els.card.replaceChildren(...[
        h('div', { class: 'ac-head', style: { '--c': c.color } }, avatar(act.charId, 'tiny'),
          h('div', null, h('b', null, `${act.name} · ${c.name}`), h('div', { class: 'muted' }, c.category)), typeBadge(c.type)),
        h('div', { class: 'ac-title' }, `✦ ${c.title}`),
        h('div', { class: 'ac-desc' }, c.desc),
        h('div', { class: 'ac-eff' }, c.effect),
        copied && h('div', { class: 'ac-copy' }, `Copia ahora: ${copied.name} — ${copied.title}`),
        h('button', { class: 'btn small ghost', onClick: () => showCharacter(act.charId) }, 'Ver detalle')].filter(Boolean));
    }

    // dado / botón
    const aw = r.awaiting;
    const mineRoll = aw?.kind === 'roll' && aw.playerId === me;
    if (!mineRoll) rollSent = false;
    els.roll.classList.toggle('ready', !!mineRoll && !rollSent);
    els.roll.disabled = !mineRoll;
    els.roll.textContent = mineRoll ? '🎲 TIRAR DADO' : '🎲 …';
    els.hint.replaceChildren();
    if (r.over) els.hint.append('Carrera terminada');
    else if (aw?.kind === 'roll') els.hint.append(...[mineRoll ? '¡Es tu turno! ' : `Esperando a ${pname(aw.playerId)} `, aw.deadline ? timerEl(aw.deadline) : null].filter(Boolean));
    else if (aw?.kind === 'decision') els.hint.append(...[aw.playerId === me ? 'Decide tu habilidad ' : `${pname(aw.playerId)} está decidiendo `, aw.deadline ? timerEl(aw.deadline) : null].filter(Boolean));

    if (t.phase === 'result') {
      const show = () => { if (mounted && S.t?.phase === 'result') els.overlay.replaceChildren(renderResult()); };
      G.director.whenIdle(show);
    } else els.overlay.replaceChildren();
  },
};

export const abilityPanelDetail = abilityDetail;
