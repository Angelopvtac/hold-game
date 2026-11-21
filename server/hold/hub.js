'use strict';

// HOLD's socket hub on /hold/ws (server.js routes the upgrade).
// Lobby rules (server/lobby.js): each /hold/screen browser makes a lobby
// with a 6-digit PIN and a host token only that browser gets; phones join with the PIN (wrong
// PINs are rate limited); every host command is checked against the token, and only a screen
// socket can send one. Wire frames (client -> server):
//   { t:'join', role:'screen', createLobby?, hostToken?, pin? }   { t:'join', role:'player', pin?, token? }
//   { t:'hold', down: bool }   { t:'choose', pick: 'safe'|'bold' }   { t:'tap', n }   { t:'pair', code: '123' }   { t:'unpair' }   { t:'profile', name, av }   { t:'host', token, cmd: 'start'|'skip'|'ransom'|'duel'|'again'|'reset'|'rename', id? }   { t:'pong' }
// Server -> client: welcome, need_join, pin_bad, pair_bad, error, state (screens), you (phones), event, ping.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { makePin, secretMatches, PinLimiter } = require('../lobby');
const holdContent = require('./content');
const { HoldRoom, send } = require('./room');
// Fast heartbeat (19 Nov QA): ping players every pingMs; silent for staleMs mid-message = absent from that message.
const HEARTBEAT = { pingMs: parseInt(process.env.HOLD_PING_MS || '2000', 10), staleMs: parseInt(process.env.HOLD_STALE_MS || '4500', 10) };

function createHub({ names, guarded = (w, f) => f, originAllowed = () => true, addressOf = (req) => req.socket.remoteAddress || 'unknown' } = {}) {
  const { messages, practice } = holdContent.loadPack();
  const quiz = holdContent.loadQuiz();
  const incidents = holdContent.loadIncidents();
  const puzzles = holdContent.loadPuzzles();
  const scale = parseFloat(process.env.HOLD_SCALE || '1') || 1;
  const MAX_ROOMS = parseInt(process.env.HOLD_MAX_ROOMS || process.env.MAX_ROOMS || '30', 10);
  const EMPTY_LOBBY_EVICT_MS = parseInt(process.env.HOLD_EMPTY_LOBBY_EVICT_MS || String(10 * 60 * 1000), 10);
  const IDLE_MS = parseInt(process.env.ROOM_IDLE_MS || String(30 * 60 * 1000), 10);
  const rooms = new Map(); // pin -> HoldRoom
  // Security review 18 Nov #5: a venue puts every phone behind one address, so 20 wrong PINs from a prankster locked the
  // whole room out. Now a socket is cut off after SOCKET_PIN_FAILS wrong PINs, and an address is only blocked by a flood
  // (HOLD_PIN_MAX_FAILS a minute, which a script needs many sockets for).
  const SOCKET_PIN_FAILS = 5;
  const pinLimiter = new PinLimiter({ maxFails: parseInt(process.env.HOLD_PIN_MAX_FAILS || '200', 10) });
  const roomLimiter = new PinLimiter({ maxFails: parseInt(process.env.ROOMS_PER_IP || '10', 10), windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const makeToken = () => crypto.randomBytes(24).toString('hex');
  // PLAYTEST LOG (16 Nov): one JSON line per team per message, STATE_DIR/hold-log.jsonl (no names, no tokens).
  // scripts/hold-spot-report.js turns it into spot rates per message and per act.
  const LOG = process.env.HOLD_LOG || path.join(process.env.STATE_DIR || path.join(__dirname, '..', '..', 'state'), 'hold-log.jsonl');
  // Security review 18 Nov #6: a hostile room skipping through messages grew it by about 1 GB an hour, so it stops at
  // HOLD_LOG_MAX_BYTES (50 MB by default; a real match writes about 30 KB) and says so once on the console.
  const LOG_MAX = parseInt(process.env.HOLD_LOG_MAX_BYTES || String(50 * 1024 * 1024), 10);
  let logSize = null, logCapped = false;
  const log = (rows) => {
    try {
      if (logSize === null) { try { logSize = fs.statSync(LOG).size; } catch { logSize = 0; } }
      const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      if (logSize + text.length > LOG_MAX) { if (!logCapped) { logCapped = true; console.warn(`[hold] ${LOG} reached ${LOG_MAX} bytes; no more playtest rows`); } return; }
      fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, text); logSize += Buffer.byteLength(text);
    } catch { /* the log never stops a match */ }
  };
  const uniquePin = () => { for (;;) { const p = makePin(); if (!rooms.has(p)) return p; } };
  const roomByHostToken = (t) => { if (typeof t !== 'string') return null; for (const r of rooms.values()) if (secretMatches(t, r.hostToken)) return r; return null; };
  const roomByPlayerToken = (t) => { if (typeof t !== 'string') return null; for (const r of rooms.values()) if (r.playerByToken(t)) return r; return null; };

  function roomForPin(ws, pin) {
    const wait = pinLimiter.blockedFor(ws.address);
    if (wait) { send(ws, { t: 'pin_bad', message: 'Too many wrong PINs. Try again in a minute.' }); return null; }
    const room = typeof pin === 'string' || typeof pin === 'number' ? rooms.get(String(pin)) : null;
    if (room && secretMatches(String(pin), room.pin)) return room;
    pinLimiter.fail(ws.address);
    send(ws, { t: 'pin_bad', message: 'That PIN is not right. Check the big screen.' });
    ws.pinFails = (ws.pinFails || 0) + 1;
    if (ws.pinFails >= SOCKET_PIN_FAILS) ws.close(1008, 'Too many wrong PINs');
    return null;
  }

  // Security review 18 Nov #7: with the cap reached, close the oldest lobby that no phone has
  // ever joined and is older than EMPTY_LOBBY_EVICT_MS, so held-open empty lobbies can't lock a real TV out.
  function evictEmptyLobby() {
    let oldest = null;
    for (const r of rooms.values()) {
      if (r.phase !== 'lobby' || r.everJoined || r.humans().length || Date.now() - r.createdAt < EMPTY_LOBBY_EVICT_MS) continue;
      if (!oldest || r.createdAt < oldest.createdAt) oldest = r;
    }
    if (!oldest) return false;
    for (const s of [...oldest.screens]) { send(s, { t: 'error', message: 'This empty lobby was closed to make room. Reload to start a new one.' }); try { s.close(); } catch { /* closing */ } }
    oldest.dispose(); rooms.delete(oldest.pin);
    return true;
  }

  function joinScreen(ws, msg) {
    if (ws.meta.room) ws.meta.room.onClose(ws);
    const mine = roomByHostToken(msg.hostToken);
    if (mine) return mine.addScreen(ws, { isHost: true, created: false });
    if (msg.pin !== undefined) { const r = roomForPin(ws, msg.pin); if (r) r.addScreen(ws, { isHost: false, created: false }); return undefined; }
    if (msg.createLobby === true) {
      if (roomLimiter.blockedFor(ws.address) || (rooms.size >= MAX_ROOMS && !evictEmptyLobby())) { send(ws, { t: 'error', message: 'Too many games on this server right now. Try again later.' }); return undefined; }
      roomLimiter.fail(ws.address);
      const room = new HoldRoom({ pin: uniquePin(), messages, practice, quiz, incidents, puzzles, names, scale, guarded, makeToken, log });
      rooms.set(room.pin, room);
      return room.addScreen(ws, { isHost: true, created: true });
    }
    send(ws, { t: 'welcome', role: 'screen', isHost: false, pin: null });
    return undefined;
  }

  function joinPlayer(ws, msg) {
    if (ws.meta.playerId) return;
    let room = roomByPlayerToken(msg.token);
    if (!room) {
      if (msg.pin === undefined || msg.pin === null || msg.pin === '') { send(ws, { t: 'need_join' }); return; }
      room = roomForPin(ws, msg.pin);
      if (!room) return;
    }
    if (ws.meta.room && ws.meta.room !== room) ws.meta.room.onClose(ws);
    room.addPlayer(ws, room.playerByToken(msg.token) ? msg.token : undefined);
  }

  function handle(ws, msg) {
    const room = ws.meta.room;
    switch (msg.t) {
      case 'join': return msg.role === 'screen' ? joinScreen(ws, msg) : joinPlayer(ws, msg);
      case 'hold': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.hold(ws.meta.playerId, msg.down === true, msg.away === true); return undefined;
      case 'host': {
        if (ws.meta.role !== 'screen' || !room || !secretMatches(msg.token, room.hostToken)) { send(ws, { t: 'error', message: 'Only the host can do that.' }); return undefined; }
        if (msg.cmd === 'reset') { rooms.delete(room.pin); room.pin = uniquePin(); rooms.set(room.pin, room); }
        if (msg.cmd === 'rename') return room.renamePlayer(typeof msg.id === 'string' ? msg.id.slice(0, 16) : '');
        return room.command(String(msg.cmd || ''));
      }
      case 'choose': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.choose(ws.meta.playerId, msg.pick); return undefined;
      case 'answer': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.answer(ws.meta.playerId, msg.pick); return undefined;
      case 'hot': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.hotAnswer(ws.meta.playerId, msg.pick); return undefined;
      case 'profile': {
        if (ws.meta.role !== 'player' || !ws.meta.playerId || !room || rooms.get(room.pin) !== room) return undefined;
        const why = room.setProfile(ws.meta.playerId, typeof msg.name === 'string' ? msg.name.slice(0, 64) : null, msg.av);
        send(ws, { t: 'profile', ok: !why, message: why || '' });
        return undefined;
      }
      case 'tap': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.tap(ws.meta.playerId, msg.n); return undefined;
      case 'pair': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.pairByCode(ws.meta.playerId, typeof msg.code === 'string' || typeof msg.code === 'number' ? String(msg.code).slice(0, 3) : ''); return undefined;
      case 'unpair': if (ws.meta.role === 'player' && ws.meta.playerId && room && rooms.get(room.pin) === room) room.unpair(ws.meta.playerId); return undefined;
      case 'pong': ws.isAlive = true; return undefined;
      default: return undefined;
    }
  }

  const MSG_PER_SEC = 20, MSG_BURST = 60;
  // Security review 18 Nov #3: connection caps. 300 per address still fits a venue NAT.
  const MAX_CONN_PER_IP = parseInt(process.env.MAX_CONN_PER_IP || '300', 10);
  const MAX_CONNECTIONS = parseInt(process.env.HOLD_MAX_CONNECTIONS || process.env.MAX_CONNECTIONS || '2000', 10);
  const connsByAddress = new Map(); // address -> open sockets
  wss.on('connection', (ws, req) => {
    ws.meta = { role: null, playerId: null, isHost: false, room: null };
    ws.address = addressOf(req);
    const conns = (connsByAddress.get(ws.address) || 0) + 1;
    if (conns > MAX_CONN_PER_IP || wss.clients.size > MAX_CONNECTIONS) { ws.close(1013, 'Too many connections'); return; }
    connsByAddress.set(ws.address, conns);
    ws.on('close', () => { const n = (connsByAddress.get(ws.address) || 1) - 1; if (n > 0) connsByAddress.set(ws.address, n); else connsByAddress.delete(ws.address); });
    ws.isAlive = true;
    ws.bucket = { tokens: MSG_BURST, at: Date.now() };
    ws.lastPong = Date.now();
    ws.on('pong', () => { ws.isAlive = true; ws.lastPong = Date.now(); });
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      const b = ws.bucket, now = Date.now();
      b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_PER_SEC); b.at = now;
      if (b.tokens < 1) { ws.close(1008, 'Slow down'); return; }
      b.tokens -= 1;
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
      guarded('hold message ' + msg.t, () => handle(ws, msg))();
    });
    ws.on('close', guarded('hold close', () => { if (ws.meta.room) ws.meta.room.onClose(ws); }));
  });

  let n = 0;
  const tick = setInterval(guarded('hold tick', () => { n++; for (const r of rooms.values()) r.tick(n); }), 100);
  const beat = setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch { /* ignore */ } } }, 15000);
  // 19 Nov QA: a phone that loses signal mid-message kept counting as holding until the 15-30 s beat cut it off. A fast
  // ping (HEARTBEAT.pingMs) marks a player silent for HEARTBEAT.staleMs as absent from the message in play (not cut off).
  const fastBeat = setInterval(guarded('hold heartbeat', () => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (ws.meta.role !== 'player' || !ws.meta.playerId || !ws.meta.room) continue;
      if (now - (ws.lastPong || now) > HEARTBEAT.staleMs && ws.meta.room.phase === 'play') ws.meta.room.stale(ws.meta.playerId, ws);
      try { ws.ping(); } catch { /* ignore */ }
    }
  }), HEARTBEAT.pingMs);
  const sweep = setInterval(guarded('hold cleanup', () => {
    for (const [pin, r] of rooms) if (!r.hasSockets() && Date.now() - r.emptySince > IDLE_MS) { r.dispose(); rooms.delete(pin); }
  }), 30000);
  [tick, beat, fastBeat, sweep].forEach((t) => t.unref());

  // server.js hands over upgrades for /hold/ws here.
  function upgrade(req, socket, head) {
    if (!originAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  return { wss, rooms, upgrade, handle, messages };
}

module.exports = { createHub };
