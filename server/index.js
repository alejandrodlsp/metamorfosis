// Servidor HTTP (estáticos de dist/) + WebSocket (salas y partidas).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, cleanName } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3001;
const manager = new RoomManager(process.env.ROOMS_FILE || path.join(__dirname, '..', 'data', 'rooms.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (req.url === '/healthz') { res.writeHead(200, headers); return res.end('ok'); }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Cliente no compilado. Ejecuta "npm run build" o usa "npm run dev" (Vite en http://localhost:5173).');
  }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, { ...headers, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': /\/assets\/[^/]+\.(js|css)$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
const failsByIp = new Map();

const ipOf = (req) => req.socket.remoteAddress || 'unknown';
function tooManyFails(ip) {
  const rec = failsByIp.get(ip);
  return rec && rec.count >= 8 && Date.now() - rec.t < 5 * 60_000;
}
function registerFail(ip) {
  const rec = failsByIp.get(ip);
  if (!rec || Date.now() - rec.t > 5 * 60_000) failsByIp.set(ip, { count: 1, t: Date.now() });
  else rec.count++;
}

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const fail = (ws, message) => send(ws, { type: 'error', message });

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  ws.alive = true;
  ws.ctx = { room: null, player: null };
  let bucket = 0;
  const refill = setInterval(() => { bucket = 0; }, 5000);
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { type: 'hello' });

  ws.on('message', (raw) => {
    if (++bucket > 120) { ws.close(1008, 'rate limit'); return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    const { room, player } = ws.ctx;

    if (room && player) { room.handle(player, msg); return; }

    switch (msg.type) {
      case 'createRoom': {
        if (tooManyFails(ip)) return fail(ws, 'Demasiados intentos. Espera unos minutos.');
        const pw = typeof msg.password === 'string' ? msg.password.slice(0, 40) : '';
        const r = manager.create(pw);
        const p = r.addPlayer({ name: cleanName(msg.name), color: msg.color });
        ws.ctx = { room: r, player: p };
        send(ws, { type: 'joined', code: r.code, playerId: p.id, token: p.token });
        r.attach(p, ws);
        break;
      }
      case 'joinRoom': {
        if (tooManyFails(ip)) return fail(ws, 'Demasiados intentos. Espera unos minutos.');
        const r = manager.get(msg.code);
        if (!r || !manager.checkPassword(r, typeof msg.password === 'string' ? msg.password.slice(0, 40) : '')) {
          registerFail(ip);
          return fail(ws, 'Sala o contraseña incorrecta.');
        }
        if (r.phase !== 'lobby') return fail(ws, 'La partida ya ha empezado. Usa "Continuar" si ya eras jugador de esta sala.');
        if (r.players.size >= r.config.maxPlayers) return fail(ws, 'La sala está llena.');
        const p = r.addPlayer({ name: cleanName(msg.name), color: msg.color });
        ws.ctx = { room: r, player: p };
        send(ws, { type: 'joined', code: r.code, playerId: p.id, token: p.token });
        r.attach(p, ws);
        break;
      }
      case 'rejoin': {
        const r = manager.get(msg.code);
        const p = r && manager.findByToken(r, msg.token);
        if (!p) { registerFail(ip); return send(ws, { type: 'rejoinFailed' }); }
        ws.ctx = { room: r, player: p };
        send(ws, { type: 'joined', code: r.code, playerId: p.id, token: p.token });
        r.attach(p, ws);
        break;
      }
      default:
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    const { room, player } = ws.ctx;
    if (room && player) room.detach(player, ws);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  manager.sweep();
}, 30_000).unref();

server.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}  (salas: ${manager.rooms.size})`));
