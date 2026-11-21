'use strict';

// HOLD's web server: serves the pages in public/ and hands the game socket (/hold/ws) to the
// HOLD hub (server/hold/hub.js), which runs every lobby. The TV opens /screen, phones open /.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHub } = require('./hold/hub');

const BIND = process.env.BIND || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // only behind a proxy that sets X-Forwarded-For
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const NAMES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'names.json'), 'utf8'));

// Errors are logged with where they happened, never with message contents or names.
function logError(where, err) { console.error(`[error] ${where}: ${(err && err.stack) || err}`); }
function guarded(where, fn) { return (...a) => { try { return fn(...a); } catch (e) { logError(where, e); } }; }
process.on('uncaughtException', (e) => logError('uncaught', e));
process.on('unhandledRejection', (e) => logError('unhandled rejection', e));
process.on('SIGTERM', () => process.exit(0));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

// Pages use inline scripts, so scripts stay 'unsafe-inline', but only from this origin; nothing can frame the game.
function securityHeaders(req, res) {
  const host = /^[\w.:\-\[\]]+$/.test(req.headers.host || '') ? req.headers.host : '';
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'" + (host ? ` ws://${host} wss://${host}` : '') +
    "; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

// Browsers send Origin on a WebSocket; refuse other sites' pages (the page's own host,
// PUBLIC_URL and ALLOWED_ORIGINS pass). Non-browser clients send none and are allowed.
const ALLOWED_ORIGINS = new Set([PUBLIC_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')].map((o) => o.trim().replace(/\/$/, '')).filter(Boolean));
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// The key every per-client limit counts by. An IPv6 client usually controls a whole /64.
function limitKey(addr) {
  if (!addr.includes(':')) return addr;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [head, tail] = addr.split('%')[0].toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? null : (tail ? tail.split(':') : []);
  const groups = t ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}
function clientAddress(req) {
  const forwarded = TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return limitKey(forwarded || req.socket.remoteAddress || 'unknown');
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    // Pages and code are always revalidated (iOS Safari otherwise keeps stale pages); fonts may cache.
    const ext = path.extname(file);
    const code = ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css' || ext === '.json';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': code ? 'no-cache, must-revalidate' : 'public, max-age=3600' });
    res.end(buf);
  });
}

const hub = createHub({ names: NAMES, guarded, originAllowed, addressOf: clientAddress });

const PAGES = {
  '/': '/hold/play.html', '/play': '/hold/play.html', '/hold': '/hold/play.html', '/hold/': '/hold/play.html', '/hold/play': '/hold/play.html',
  '/screen': '/hold/screen.html', '/hold/screen': '/hold/screen.html',
};

const server = http.createServer((req, res) => {
  securityHeaders(req, res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end('Bad request'); return; }
  let pathname = url.pathname;
  if (pathname === '/health') {
    let players = 0; for (const r of hub.rooms.values()) players += r.humans().length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size, players }));
    return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  pathname = PAGES[pathname] || pathname;
  const file = safeJoin(PUBLIC_DIR, pathname);
  if (!file) { res.writeHead(400); res.end('Bad path'); return; }
  serveFile(res, file);
});

server.on('upgrade', (req, socket, head) => {
  let p = ''; try { p = new URL(req.url, 'http://localhost').pathname; } catch { /* bad url */ }
  if (p === '/hold/ws') return hub.upgrade(req, socket, head);
  socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy();
  return undefined;
});

function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return 'localhost';
}

server.listen(PORT, BIND, () => {
  const base = PUBLIC_URL || `http://${BIND === '0.0.0.0' ? lanAddress() : BIND}:${PORT}`;
  console.log('HOLD: ready');
  console.log('  messages : ' + hub.messages.length);
  console.log('  TV       : ' + base + '/screen');
  console.log('  phones   : ' + base + '/  (or scan the QR on the TV)');
});

module.exports = { server, hub };
