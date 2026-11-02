import { CHAR_BY_ID } from '../shared/characters.js';
import { h } from './dom.js';

let manifest = {};

export async function loadManifest() {
  try {
    const r = await fetch('/assets/characters/manifest.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { /* sin manifiesto: se usan los nombres por defecto */ }
}

export const portraitUrl = (id) => `/assets/characters/${manifest[id]?.portrait || `${id}.svg`}`;
export const modelInfo = (id) => (manifest[id]?.model ? { url: `/assets/characters/${manifest[id].model}`, scale: manifest[id].modelScale || 1 } : null);

/** Retrato del personaje (con emoji de reserva si falta el archivo). */
export function avatar(id, cls = '') {
  const c = CHAR_BY_ID[id];
  const img = h('img', { class: `avatar ${cls}`, src: portraitUrl(id), alt: c?.name || id, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => {
    const fb = h('div', { class: `avatar fallback ${cls}`, style: { background: c?.color || '#555' } }, c?.glyph || '?');
    img.replaceWith(fb);
  }, { once: true });
  return img;
}
