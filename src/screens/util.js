import { h } from '../dom.js';

export function simpleScreen(build) {
  return {
    mount(root) { this.root = root; this.update(); },
    update() { this.root.replaceChildren(build()); },
    unmount() {},
  };
}

export const backBar = (onBack, title) => h('div', { class: 'topbar' },
  h('button', { class: 'btn ghost', onClick: onBack }, '← Volver'),
  h('h2', null, title));
