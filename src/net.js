// Cliente WebSocket con reconexión automática y reingreso a la sala.
const listeners = new Set();
let ws = null;
let retry = 0;
let reconnectTimer = null;
let getRejoin = () => null;

export const net = {
  connected: false,
  onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  setRejoinProvider(fn) { getRejoin = fn; },
  send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      net.connected = true;
      emit({ type: '_open' });
      const r = getRejoin();
      if (r) net.send({ type: 'rejoin', code: r.code, token: r.token });
    };
    ws.onmessage = (e) => {
      try { emit(JSON.parse(e.data)); } catch { /* mensaje inválido */ }
    };
    ws.onclose = () => {
      net.connected = false;
      emit({ type: '_close' });
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => net.connect(), Math.min(8000, 600 * 2 ** retry++));
    };
    ws.onerror = () => {};
  },
  close() { if (ws) { ws.onclose = null; ws.close(); ws = null; net.connected = false; } },
};

function emit(m) { for (const fn of listeners) fn(m); }
