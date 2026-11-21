// A small resilient socket: auto-reconnects with backoff and replies to heartbeats.
// Clients import this and hand it one message handler.
//
// Phones sleep. A woken phone can hold a socket that looks open but is dead, and the
// browser may not notice for minutes. Once joined, the server sends this client state
// several times a second, so silence means the line is dead: after STALE_MS of quiet,
// or on waking with any noticeable gap, drop the socket and reconnect at once.

const STALE_MS = 6000; // joined clients normally hear from the server every 100-200 ms
const WAKE_STALE_MS = 2500;

// path: the socket path (HOLD uses /hold/ws).
export function createSocket(onMessage, path = '/ws') {
  let ws;
  let closed = false;
  let backoff = 400;
  let retry = null;
  let lastMsg = Date.now();
  let joined = false; // only joined sockets get a steady stream; the PIN screen hears nothing
  const api = {
    connected: false,
    onopen: null,
    onstatus: null,
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { closed = true; clearTimeout(retry); try { ws.close(); } catch { /* ignore */ } },
  };

  function status(s) { if (api.onstatus) api.onstatus(s); }

  function connect() {
    clearTimeout(retry);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}${path}`);
    ws = sock;
    joined = false;
    lastMsg = Date.now();
    sock.onopen = () => { backoff = 400; api.connected = true; lastMsg = Date.now(); status('online'); if (api.onopen) api.onopen(); };
    sock.onmessage = (e) => {
      lastMsg = Date.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'ping') { api.send({ t: 'pong' }); return; }
      if (m.t === 'welcome') joined = true;
      onMessage(m);
    };
    sock.onclose = () => {
      if (sock !== ws) return; // a socket we already replaced
      api.connected = false; status('offline');
      if (closed) return;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(5000, Math.round(backoff * 1.6));
    };
    sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
  }

  // Abandon a silent socket without waiting for the browser to time it out.
  function reconnectNow() {
    if (closed) return;
    const dead = ws;
    ws = null;
    if (dead) { dead.onclose = null; dead.onmessage = null; try { dead.close(); } catch { /* ignore */ } }
    api.connected = false; status('offline');
    backoff = 400;
    connect();
  }
  const quietFor = () => Date.now() - lastMsg;
  setInterval(() => { if (joined && api.connected && quietFor() > STALE_MS) reconnectNow(); }, 1000);
  const onWake = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (!ws || ws.readyState > 1 || (joined && quietFor() > WAKE_STALE_MS)) reconnectNow();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('pageshow', onWake);
  window.addEventListener('online', onWake);

  connect();
  return api;
}
