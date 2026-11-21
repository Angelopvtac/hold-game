// One HOLD lobby: players, teams, bots, the phase clock and all scoring. The server owns the
// clock; phones say "thumb down" / "thumb up" (hold {down}) and pair up (pair {code}). Phases:
//   lobby (pair up) -> ready (every key in) -> play (lines appear on the big screen, pots grow) -> crash
//         -> reveal (red flag circled, lesson, mini leaderboard) -> ready (next) ... -> final
// TEAMS (15 Nov): in the lobby each phone has a 3-digit code; a seat neighbour types it and the two are a
// pair (a third typing a paired code makes a trio). Anyone unpaired at START plays SOLO. Bot pairs only
// fill a small room. One pot and one score per team.
// TWO KEYS (15 Nov, Angelo): every member holds a ring. The message builds on the BIG SCREEN for the
// whole room; phones never get its text, only the button label. A team's pot grows only while ALL its
// members hold: before that it waits ('wait'), and it starts growing the moment the last key goes in.
// One release banks the pot for the whole team (and names who pulled the key); that team is done for
// this message. Each team that banks bumps the teams still holding. A scam springs at its spring line:
// a team still fully holding is caught (0). A real message held by all to the end doubles the pot.
// INTRO + STAKES (15 Nov, Angelo after playing TWO KEYS): START opens a ~40 s walkthrough ('walk', three
// cards; card 1 is live: each team's practice pot grows only while every key is in), then a practice round
// (this.practice: the pack's practice message, never added to totals), then a NOW FOR REAL card ('stage').
// The messages run in stakes stages (RULES.stage: ×1, ×2, ×3, last ALL IN ×5, the pot faster each stage);
// a 'stage' card announces each new one. Banked pots (and doubles, and what a spring took) multiply.
//   lobby -> walk -> ready* -> play* -> crash* -> reveal* -> stage(go) -> ready ... [stage(up)] ... -> final
// ACTS (16 Nov, approved storyboard): the 'stage' cards are now
// act title cards (card.kind 'act': the act's name and new trick; acts 2 and 3 carry SAFE or BOLD, `choose`) and the
// FINAL MESSAGE · ALL IN card. A team's pick is `k.mode` for the whole act ('bold' only if every member picked BOLD).
// SPOTTED IT: a release after the red-flag line landed (and before the spring) pays the pot +50% (k.mark 'spotted');
// before it, 'early' (plain bank). Caught = 'tapped' (SAFE keeps half), a real message held = 'trusted' (×2). BOLD
// doubles everything the team banks in the act. The mark and the bonus stay on the server until the crash: during play
// nothing may tell the room which kind the message is (a bank on screen shows the plain pot, never the bonus).
// Teams keep counts (spotted, taps, early, trusted) for the three awards at the end: HUMAN FIREWALL (most spotted;
// fewest taps, then most money), NERVES OF STEEL (most money), NEVER FOOLED (every team with no taps). One log line per team per message.
//   lobby -> walk -> practice -> stage(act 1) -> ready ... -> stage(act 2, SAFE/BOLD) ... -> stage(final) -> ready -> final
// RANSOMWARE (16 Nov prototype, Angelo's idea; RULES.RANSOM): after an act's last reveal, the team that lost the most to scams
// in that act (k.actLost) is LOCKED and duels the nearest team above it: phase 'ransom', steps card -> count -> mash -> result.
// Phones send tap {n} (batched); the server caps each phone at tapRate/s. Score = average taps per member. Locked wins = the
// lock jumps to the loser (next duel, up to maxDuels); defender wins (or the cap) = the lock holder pays `cut` of its bank.
//   ... reveal (last of act N) -> ransom* -> stage(act N+1) | final. Host 'ransom' (RANSOMWARE NOW) starts one at once.
// LAST BUSINESS STANDING (18 Nov, storyboard): in an act whose
// RULES.ACTS entry `closes` (act 3), a company breached by a scam gets CONTAIN IT at the spring (this.contain, inside the 'crash'
// phase: step 'mash' for CONTAIN.ms, then 'result'): every member taps; average taps per member >= CONTAIN.need = contained (the
// message's pot is still lost; SAFE keeps half), less = CLOSED for good (k.closed). A closed company holds along: its SPOTTED IT
// still counts for Human Firewall, it earns nothing and is never breached again. No duel after that act. The TV shows the market
// (this.market: one building per company, a snapshot taken at the act card, the spring, the contain result and the reveal, never
// during play). Final ranking (rankRows): open companies first by revenue, then closed ones, latest to close first. Awards: LAST
// BUSINESS STANDING (rank 1), TOP REVENUE, HUMAN FIREWALL. Each phone ends on its company report (you().report).
// AGREE-QUIZ (18 Nov, RULES.QUIZ): after the reveal of the 2nd and 6th message of an act, phase 'quiz' (this.quiz: steps pick ->
// agree -> reveal). Phones send answer {pick}; a pick is private (a partner's shows only once the whole team has picked, or at the
// agree step); a team's answer is its members' common pick. Right = a stakes-scaled bonus (no revenue for a closed company) and
// +1 HUMAN FIREWALL (k.n.quiz). The TV shows only how many teams answered until the reveal. RESTORE FROM BACKUP (RULES.BACKUP):
// a closed company's banks fill k.backup; full = reopened at the next reveal (k.restored), once. LET GO TOGETHER (RULES.SYNC):
// every member up within SYNC.ms = k.sync, the bank ×SYNC.x at the resolve (the team's phones know at once; the TV at the crash).

const NAMES = require('./names');
const RULES = require('./rules');
const { TEMPERS, planRelease, planChoice } = require('./bots');
const { makeHostToken } = require('../lobby');
const { view: viewOf } = require('./content');

const PAUSE_AT = new Set(['reveal', 'stage', 'ready']); // where a host PAUSE holds the game
const PHASES = ['lobby', 'walk', 'ready', 'play', 'crash', 'reveal', 'stage', 'ransom', 'quiz', 'hot', 'final'];

// Security review 18 Nov #3: a socket that stops reading (TCP paused) would make the server buffer every frame for it, so
// one with more than MAX_BUFFERED unsent is cut off instead of fed more.
const MAX_BUFFERED = 1024 * 1024;
const MAX_VIEWERS = parseInt(process.env.HOLD_MAX_VIEWERS || '4', 10); // view-only screens per lobby (the host TV is not one)
function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED) { try { ws.terminate(); } catch { /* gone */ } return; }
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

const COMPUTER = 'The computer';
// A team's award counts. played: messages it was in (not sat out).
const RULES_ZERO = () => ({ spotted: 0, early: 0, taps: 0, trusted: 0, played: 0, quiz: 0 });
// LAST BUSINESS STANDING ranking (18 Nov): open companies above every closed one, by revenue; closed companies by when they
// closed (the last to close first: if everyone closed, the last one standing wins), then revenue. rows: { id, total, closed: null |
// { seq } }. Returns new rows in order with rank = position + 1.
function rankRows(rows) {
  const open = (r) => !r.closed;
  return [...rows].sort((a, b) => (open(b) - open(a)) || (open(a) ? 0 : b.closed.seq - a.closed.seq) || b.total - a.total)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
// The three awards (18 Nov), over ranked rows (bots compete like anyone): LAST BUSINESS STANDING (rank 1), TOP REVENUE (most
// revenue, a closed company may win it), HUMAN FIREWALL (most red flags spotted plus quiz answers right, then fewest taps,
// then most money).
const fwScore = (r) => (r.n.spotted || 0) + (r.n.quiz || 0);
function RULES_AWARDS(rows) {
  const fw = rows.filter((r) => fwScore(r) > 0).sort((a, b) => fwScore(b) - fwScore(a) || a.n.taps - b.n.taps || b.total - a.total)[0];
  const rev = rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total)[0];
  const top = rows.find((r) => r.rank === 1) || rows[0];
  return { lbs: top ? top.id : null, revenue: rev ? rev.id : null, firewall: fw ? fw.id : null };
}

class HoldRoom {
  constructor({ pin, messages, practice = null, quiz = [], incidents = [], puzzles = [], names, scale = 1, hostToken = makeHostToken(), rand = Math.random, guarded = (w, f) => f, makeToken, log = () => {} }) {
    Object.assign(this, { pin, messages, names, scale, hostToken, rand, guarded, makeToken, log });
    this.puzzleBank = puzzles; this.puzzleUsed = new Set(); this.hot = null; // the HOT FILE puzzles and the live chain
    this.incidentBank = incidents; this.irDone = false; // the INCIDENT ROOM scenarios; asked once a match
    this.quizBank = quiz; this.quizUsed = new Set(); this.quiz = null; // the agree-quiz bank, the items asked this match, the live quiz
    this.scamsPlayed = 0; // scored scams resolved so far (the y of 'spotted x / y')
    this.practiceMsg = practice || messages.find((m) => m.kind === 'scam') || messages[0];
    this.practice = false; // the practice round is running (index stays 0)
    this.walk = null;      // { step, allIn } during the walkthrough
    this.card = null;      // { kind: 'act'|'final', ... } during a stage card (an act title card, or ALL IN)
    this.players = new Map(); // id -> player
    this.pairs = new Map();   // id -> { id, members: [player ids], total }: a pair, a trio or a SOLO player
    this.screens = new Set();
    this.sockByPlayer = new Map();
    this.phase = 'lobby';
    this.index = 0;
    this.play = null;   // { startAt, bonus, left, shown, sent }
    this.result = null; // { kind: 'spring'|'double', potEnd, caught: [pair ids] }
    this.reveal = null;
    this.final = null;
    this.ransom = null; // the RANSOMWARE duel chain, during phase 'ransom'
    this.contain = null; // CONTAIN IT, inside the 'crash' phase of a closing act: { teams, taps, step, startAt, result }
    this.market = null;  // the skyline snapshot for a closing act and the end
    this.closeSeq = 0;   // order in which companies closed
    this.playMs = 0;     // game ms of every scored message so far (uptime's denominator)
    this.phaseEndsAt = 0;
    this.codeFailsByAddr = new Map(); // address -> { n, at, until }: wrong pair codes per address (security 18 Nov #2)
    this.timers = new Set();
    this.seq = 0;
    this.pairSeq = 0;
    this.createdAt = Date.now();
    this.emptySince = Date.now();
    this.dirty = true;
  }

  // ---- clock ---------------------------------------------------------------
  ms(x) { return Math.max(1, Math.round(x * this.scale)); }
  later(ms, fn) { const t = setTimeout(this.guarded('hold timer', () => { this.timers.delete(t); fn(); }), ms); this.timers.add(t); return t; }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); for (const p of this.players.values()) p.pending = null; }
  // Game seconds since the message started, and the pot of a team holding since the first line.
  gameT(now = Date.now()) { return this.play ? (now - this.play.startAt) / this.scale / 1000 : 0; }
  potNow(now = Date.now()) { return this.play ? this.potT(this.gameT(now)) + this.play.bonus : 0; }
  get message() { return this.practice ? this.practiceMsg : this.messages[this.index]; }
  // This message's stakes: the multiplier on what a team banks, and how fast the pot grows. Practice is ×1.
  get stakes() {
    if (this.practice) return { n: 0, act: 0, mult: 1, speed: 1, lineMs: RULES.LINE_MS, final: false };
    const m = this.messages[this.index];
    return RULES.stage(this.index, this.messages.length, m ? m.act : 1, m);
  }
  // Where message i sits in its act: { n, name, i (0-based in the act), of }.
  actOf(i = this.index) {
    const m = this.messages[i]; if (!m) return null;
    const same = this.messages.filter((x) => x.act === m.act), a = RULES.ACTS[m.act - 1];
    return { n: m.act, name: a.name, i: same.indexOf(m), of: same.length };
  }
  potT(t) { return RULES.potAt(t * this.stakes.speed); }
  linesShown(now = Date.now()) {
    if (!this.play) return 0;
    if (this.play.shown != null) return this.play.shown; // frozen at the crash
    return Math.min(this.message.lines.length, Math.floor((now - this.play.startAt) / this.ms(this.stakes.lineMs)) + 1);
  }

  // ---- people --------------------------------------------------------------
  hasSockets() { return this.screens.size > 0 || this.sockByPlayer.size > 0; }
  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  nameTaken(name) { for (const p of this.players.values()) if (p.name === name) return true; return false; }
  freeName() {
    const { adjectives, nouns } = this.names;
    for (let i = 0; i < 200; i++) {
      const n = adjectives[Math.floor(this.rand() * adjectives.length)] + ' ' + nouns[Math.floor(this.rand() * nouns.length)];
      if (!this.nameTaken(n)) return n;
    }
    for (const a of adjectives) for (const b of nouns) if (!this.nameTaken(a + ' ' + b)) return a + ' ' + b;
    return 'Player ' + (this.players.size + 1);
  }
  freeCode() {
    const used = new Set([...this.players.values()].map((p) => p.code));
    for (let i = 0; i < 2000; i++) { const c = String(100 + Math.floor(this.rand() * 900)); if (!used.has(c)) return c; }
    for (let n = 100; n < 1000; n++) if (!used.has(String(n))) return String(n);
    return null;
  }
  newPlayer({ bot = false, temper = null } = {}) {
    const id = 'h' + (++this.seq);
    // pending: a release inside the SLIP_MS debounce (the pot it would bank).
    const p = { id, name: this.freeName(), av: bot ? Math.floor(this.rand() * NAMES.AVATARS) : null, named: false, token: bot ? null : this.makeToken(), code: bot ? null : this.freeCode(), bot, temper, connected: bot, down: bot, pairId: null, pending: null, fails: 0, blockedUntil: 0 };
    this.players.set(id, p);
    return p;
  }
  // 19 Nov (Angelo): a phone may set its own name and character. The only free text in HOLD: names.js checks it (2-12
  // letters/digits/space/-/', no emoji or control chars, a block list) and every page escapes it. Returns an error or null.
  setProfile(id, rawName, av) {
    const p = this.players.get(id);
    if (!p || p.bot) return 'Not in this game.';
    if (this.phase === 'final') return 'The game is over.';
    const look = Number.isInteger(av) && av >= 0 && av < NAMES.AVATARS ? av : null;
    if (rawName !== undefined && rawName !== null && rawName !== '') {
      const c = NAMES.cleanName(rawName);
      if (!c.ok) return c.why;
      if (c.name.toLowerCase() !== p.name.toLowerCase()) {
        const u = NAMES.uniqueName(c.name, (n) => [...this.players.values()].some((q) => q !== p && q.name.toLowerCase() === n));
        if (!u) return 'Pick another name.';
        p.name = u; p.custom = true;
      }
    }
    if (look !== null) p.av = look;
    p.named = true;
    this.sendYou(); this.dirty = true;
    return null;
  }
  // Host RENAME: an offensive name goes back to a random one at once (the character stays).
  renamePlayer(id) {
    const p = this.players.get(String(id));
    if (!p || p.bot) return undefined;
    p.name = this.freeName(); p.custom = false;
    this.log([{ at: new Date().toISOString(), type: 'rename', pin: this.pin }]);
    this.sendYou(); this.dirty = true;
    return undefined;
  }
  playerByToken(token) { if (typeof token !== 'string') return null; for (const p of this.players.values()) if (p.token && p.token === token) return p; return null; }

  // ---- pairs ---------------------------------------------------------------
  pairOf(p) { return p && p.pairId ? this.pairs.get(p.pairId) || null : null; }
  newPair(ids) {
    // st: this message's team state, 'wait'|'hold'|'banked'|'caught'|'dbl'|'out'; got: its score; by: who banked; arm: when both keys went in.
    // mode: this act's SAFE/BOLD ('safe'|'bold'|null in act 1); picks: player id -> pick at the act card; n: the award counts.
    const k = { id: 'k' + (++this.pairSeq), members: [], total: 0, st: null, got: 0, by: null, arm: null, mode: null, picks: {}, n: RULES_ZERO() };
    this.pairs.set(k.id, k);
    for (const id of ids) this.addToPair(k, this.players.get(id));
    return k;
  }
  addToPair(k, p) { k.members.push(p.id); p.pairId = k.id; }
  // Takes a player out of its team; a pair left with one person breaks up (they are unpaired again).
  leavePair(p) {
    const k = this.pairOf(p); p.pairId = null;
    if (!k) return;
    k.members = k.members.filter((id) => id !== p.id);
    if (k.members.length < 2) this.breakPair(k);
  }
  breakPair(k) { for (const id of k.members) { const q = this.players.get(id); if (q) q.pairId = null; } this.pairs.delete(k.id); }
  // A message's team state: also its mark ('spotted'|'early'|'tapped'|'trusted'|'out'), the release time (game ms from the
  // start), the plain bank, the spotted bonus (kept off the wire until the crash) and what SAFE kept when caught.
  resetTeam(k) { k.st = null; k.got = 0; k.by = null; k.arm = null; k.lost = 0; k.mark = null; k.rel = null; k.base = 0; k.bonus = 0; k.kept = 0; k.sync = false; k.syncX = 0; k.backupNow = false; }
  // A team is a small company (17 Nov): "Slate Ltd", "Slate & Winter Ltd", "Slate, Winter & Koi Ltd".
  label(k, short = this.shortNames()) {
    const ns = k.members.map((id) => this.players.get(id)).filter(Boolean).map(short);
    return (ns.length <= 1 ? ns.join('') : ns.slice(0, -1).join(', ') + ' & ' + ns[ns.length - 1]) + ' Ltd';
  }

  // A phone types its neighbour's code: the two are a pair. A pair's codes stay good for one more
  // person, who makes a trio. Not during a message.
  pairByCode(id, code) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const ws = this.sockByPlayer.get(id);
    const bad = (message) => { if (ws) send(ws, { t: 'pair_bad', message }); };
    const now = Date.now();
    // Security review 18 Nov #2: pairing only in the lobby (a stranger who guessed a code could join a team mid-match),
    // and wrong codes are also counted per address, so a fresh socket doesn't get a fresh budget.
    if (this.phase !== 'lobby') return bad('Pair up before the match starts. You play SOLO this match.');
    const addr = (ws && ws.address) || 'unknown';
    const af = this.codeFailsByAddr.get(addr);
    if (p.blockedUntil > now || (af && af.until > now)) return bad('Too many wrong codes. Wait a moment.');
    const mine = this.pairOf(p);
    if (mine && mine.members.length > 1) return bad('You are already paired.');
    const q = [...this.players.values()].find((x) => !x.bot && x.code === String(code || ''));
    if (!q || q === p) {
      if (++p.fails >= RULES.CODE_FAILS) { p.fails = 0; p.blockedUntil = now + RULES.CODE_BLOCK_MS; }
      const f = af && now - af.at < RULES.ADDR_CODE_WINDOW_MS ? af : { n: 0, at: now, until: 0 };
      if (++f.n >= RULES.ADDR_CODE_FAILS) { f.n = 0; f.at = now; f.until = now + RULES.CODE_BLOCK_MS; }
      this.codeFailsByAddr.set(addr, f);
      return bad(q === p ? "That's your own code. Type theirs." : 'No one has that code. Check their phone.');
    }
    const theirs = this.pairOf(q);
    if (theirs && theirs.members.length >= RULES.MAX_TEAM) return bad('They are a full team already.');
    p.fails = 0;
    if (mine) this.pairs.delete(mine.id); // was playing SOLO
    if (!theirs) this.newPair([q.id, p.id]); else this.addToPair(theirs, p);
    this.sendYou();
  }
  unpair(id) {
    const p = this.players.get(id);
    if (!p || p.bot || this.phase !== 'lobby') return;
    this.leavePair(p);
    this.sendYou();
  }

  addScreen(ws, { isHost, created }) {
    // Security review 18 Nov #3: each screen gets the whole state 10 times a second; PIN-only viewers are capped per lobby.
    if (!isHost && [...this.screens].filter((s) => !s.meta.isHost).length >= MAX_VIEWERS) { send(ws, { t: 'error', message: 'This game has enough screens already.' }); return; }
    ws.meta = { role: 'screen', playerId: null, isHost, room: this };
    this.screens.add(ws);
    send(ws, { t: 'welcome', role: 'screen', isHost, pin: this.pin, hostToken: created ? this.hostToken : undefined });
    send(ws, { t: 'state', state: this.publicState() });
  }
  addPlayer(ws, token) {
    let p = this.playerByToken(token);
    if (!p) {
      if (this.humans().length >= RULES.MAX_PLAYERS) { send(ws, { t: 'error', message: 'This game is full.' }); return null; }
      p = this.newPlayer();
      this.everJoined = true; // a lobby a phone has joined is never closed to make room (security 18 Nov #7)
    }
    const old = this.sockByPlayer.get(p.id);
    if (old && old !== ws) { old.meta.playerId = null; try { old.close(); } catch { /* closing */ } }
    ws.meta = { role: 'player', playerId: p.id, isHost: false, room: this };
    this.sockByPlayer.set(p.id, ws);
    p.connected = true;
    send(ws, { t: 'welcome', role: 'player', id: p.id, name: p.name, token: p.token, pin: this.pin });
    send(ws, { t: 'you', you: this.you(p) });
    this.dirty = true;
    return p;
  }
  onClose(ws) {
    this.screens.delete(ws);
    const id = ws.meta && ws.meta.playerId;
    if (id && this.sockByPlayer.get(id) === ws) {
      this.sockByPlayer.delete(id);
      const p = this.players.get(id);
      if (p) {
        p.connected = false;
        p.goneAt = Date.now();
        // 19 Nov QA: a phone that drops mid-message (refresh, screen lock, lost signal) is ABSENT for the rest of that message:
        // it neither banks nor is breached, and its team carries on with whoever is still here (no bank for the whole team).
        const k = this.pairOf(p);
        this.goAway(p);
        p.down = false;
        if (this.phase === 'walk' && k) this.walkKeys(k);
        if (this.phase === 'lobby') { this.leavePair(p); this.players.delete(id); this.sendYou(); }
      }
      this.dirty = true;
    }
    if (!this.hasSockets()) this.emptySince = Date.now();
  }
  kickPlayers() {
    for (const ws of this.sockByPlayer.values()) { send(ws, { t: 'need_join', reason: 'reset' }); ws.meta.playerId = null; ws.meta.room = null; }
    this.sockByPlayer.clear();
    this.players.clear();
    this.pairs.clear();
  }

  // ---- the input: thumb down / up. TWO KEYS: every member's thumb counts. ------
  hold(id, down, away = false) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    down = down === true;
    if (this.phase === 'play' && this.play && p.awayPlay === this.play) { p.down = false; return; } // absent for this message
    if (away && !down && this.phase === 'play') return this.goAway(p); // app switch / screen lock: absent, not a let-go
    const k = this.pairOf(p);
    if (this.phase === 'play' && k && k.st === 'hold') {
      if (!down && !p.pending) {
        // The team banks at the moment the thumb came up, made final only if it stays up for SLIP_MS.
        const at = Date.now();
        p.pending = { pot: this.teamPot(k), at, timer: this.later(RULES.SLIP_MS, () => { if (p.pending) this.bank(k, p, p.pending.pot, p.pending.at); }) };
      } else if (down && p.pending) { clearTimeout(p.pending.timer); this.timers.delete(p.pending.timer); p.pending = null; }
    }
    if (p.down === down) return;
    p.down = down;
    if (!down) this.syncCheck(k, p);
    else if (this.phase === 'play' && k && k.st === 'hold') p.upAt = null; // a slip (thumb straight back down) is not a let-go
    this.dirty = true;
    this.sendTeam(k); // partner state, live: your mates see your thumb at once
    if (this.phase === 'walk' && k) this.walkKeys(k);
    if (this.phase === 'ready') this.maybeStartEarly();
    if (this.phase === 'play' && k && k.st === 'wait') this.maybeArm(k);
  }
  // LET GO TOGETHER: a member's thumb came up during play; every member up within SYNC.ms (real ms) of each other = in sync.
  syncCheck(k, p, now = Date.now()) {
    if (this.phase !== 'play' || !k || k.members.length < 2 || this.practice || k.closed || !['hold', 'banked'].includes(k.st)) return;
    if (p.upAt == null) p.upAt = now;
    const ups = k.members.map((id) => { const q = this.players.get(id); return q ? q.upAt : null; });
    if (ups.some((t) => t == null)) return;
    if (Math.max(...ups) - Math.min(...ups) <= RULES.SYNC.ms) k.sync = true;
  }
  // Every member's key in (connected, thumb down).
  // Security review 18 Nov #2: a member whose phone is gone (dead battery, or a ghost who joined and left) isn't required,
  // so it can't freeze its team for the rest of the match; someone must still be here.
  keysIn(k) {
    const here = k.members.map((id) => this.players.get(id)).filter((q) => this.present(q));
    return here.length > 0 && here.every((q) => q.bot || q.down);
  }
  // Here for this message: a bot, or a connected phone that hasn't dropped out of the message in play.
  present(q) { return !!q && (q.bot || (q.connected && !(this.phase === 'play' && this.play && q.awayPlay === this.play))); }
  // A phone dropped out of the message in play (closed, hidden, or silent for HEARTBEAT.staleMs): absent until the next one.
  // If nobody in its team is left, the team is OUT of this message: no bank, no breach (letting go always pays more, so
  // dropping out is never a way to dodge a scam and still collect).
  goAway(p) {
    if (this.phase !== 'play' || !this.play || p.bot || p.awayPlay === this.play) return;
    p.awayPlay = this.play;
    if (p.pending) { clearTimeout(p.pending.timer); this.timers.delete(p.pending.timer); p.pending = null; }
    p.down = false;
    const k = this.pairOf(p);
    if (k) {
      const left = k.members.some((id) => this.present(this.players.get(id)));
      if (!left && k.st === 'hold') { k.st = 'wait'; k.arm = null; }
      else if (left && k.st === 'wait') this.maybeArm(k);
      this.sendTeam(k);
    }
    this.dirty = true;
  }
  // Heartbeat (hub): a phone that went silent without closing (lost signal) is absent from the message in play.
  stale(id, ws) { if (ws && this.sockByPlayer.get(id) !== ws) return; const p = this.players.get(id); if (p) this.goAway(p); }
  // A waiting team starts its pot the moment its last key goes in.
  maybeArm(k, now = Date.now()) {
    if (this.phase !== 'play' || k.st !== 'wait' || !this.keysIn(k)) return;
    k.st = 'hold'; k.arm = { t: this.gameT(now), bonus: this.play.bonus };
    this.event({ kind: 'keys', pair: k.id });
    this.sendTeam(k); this.dirty = true;
  }
  // The pot a holding team has right now: grown only since both keys went in, plus the bumps since then.
  teamPot(k, now = Date.now()) {
    if (!this.play || !k.arm) return 0;
    return Math.max(0, this.potT(this.gameT(now)) - this.potT(k.arm.t) + this.play.bonus - k.arm.bonus);
  }
  // Someone in the team let go: the whole team banks the pot times the stage multiplier, and the room knows who pulled the key.
  // at: when the thumb came up (the SLIP_MS debounce makes it final later); it decides SPOTTED IT or LEFT EARLY.
  bank(k, p, pot, at = Date.now()) {
    if (this.phase !== 'play' || k.st !== 'hold') return;
    for (const id of k.members) { const q = this.players.get(id); if (q && q.pending) { clearTimeout(q.pending.timer); this.timers.delete(q.pending.timer); q.pending = null; } }
    const st = this.stakes, mult = st.mult, x = k.mode === 'bold' ? RULES.BOLD_X : 1;
    const fa = RULES.flagAt(this.message, st.lineMs);
    k.rel = Math.max(0, Math.round((at - this.play.startAt) / this.scale));
    k.mark = fa != null && k.rel >= fa ? 'spotted' : 'early';
    k.base = pot * mult;
    k.bonus = k.mark === 'spotted' ? Math.round(k.base * RULES.SPOT_BONUS) : 0; // paid at the crash
    k.st = 'banked'; k.got = k.base * x; k.by = p.id;
    if (p.bot && k.members.length > 1 && !this.practice && !k.closed && this.rand() < RULES.SYNC.botP) k.sync = true; // bots let go together now and then
    const holding = [...this.pairs.values()].filter((q) => q.st === 'hold');
    let share = 0;
    // A closed company is out of the market: its release bumps nobody.
    if (holding.length && !k.closed) { this.play.left++; share = RULES.share(this.play.left); this.play.bonus += share; }
    // No 'release' event to the TV (17 Nov): it played a sound and named the team, a tell for everyone else.
    this.sendYou(); this.dirty = true;
  }

  // ---- phases ----------------------------------------------------------------
  setPhase(phase, ms, next) {
    this.phase = phase;
    this.phaseEndsAt = ms ? Date.now() + ms : 0;
    // Host PAUSE (19 Nov QA): the game holds at the next safe point (a reveal, an act card, before a message) until resumed.
    // Nothing is frozen mid-message, so no pot, spring or tap clock needs shifting.
    if (ms) this.phaseTimer = this.later(ms, () => { if (this.paused && PAUSE_AT.has(this.phase)) { this.resumeFn = next; this.phaseEndsAt = 0; this.dirty = true; } else next(); });
    this.dirty = true;
  }
  togglePause() {
    if (this.phase === 'lobby' || this.phase === 'final') return;
    this.paused = !this.paused;
    if (!this.paused && this.resumeFn) { const f = this.resumeFn; this.resumeFn = null; f(); }
    this.dirty = true;
  }
  // Host END MATCH (19 Nov QA): straight to closing time with the revenue as it stands; any duel, quiz or hot file is dropped.
  endMatch() {
    if (this.phase === 'lobby' || this.phase === 'final') return;
    this.clearTimers();
    this.paused = false; this.resumeFn = null;
    this.ransom = null; this.contain = null; this.quiz = null; this.hot = null; this.walk = null;
    this.toFinal();
  }
  // Anyone unpaired plays SOLO (at START, or a late joiner before a message).
  soloLeftovers() { for (const p of this.humans()) if (!p.pairId && p.connected) this.newPair([p.id]); }
  start() {
    if (this.phase !== 'lobby') return;
    for (const p of [...this.players.values()]) if (!p.bot && !p.connected) { this.leavePair(p); this.players.delete(p.id); }
    if (!this.humans().length) return;
    this.soloLeftovers();
    // Bot pairs fill a small room (they play each other, never with a person).
    for (let i = 0; this.pairs.size < RULES.MIN_PAIRS; i += 2) {
      const a = this.newPlayer({ bot: true, temper: TEMPERS[i % TEMPERS.length] }), b = this.newPlayer({ bot: true, temper: TEMPERS[(i + 1) % TEMPERS.length] });
      this.newPair([a.id, b.id]);
    }
    for (const k of this.pairs.values()) { k.total = 0; k.mode = null; k.picks = {}; k.n = RULES_ZERO(); k.actLost = 0; k.actBreaches = 0; k.closed = null; k.contained = 0; k.upMs = 0; k.backup = 0; k.restored = null; }
    this.top3 = null; this.market = null; this.contain = null; this.closeSeq = 0; this.playMs = 0;
    this.final = null; this.scamsPlayed = 0; this.quiz = null; this.quizUsed = new Set(); this.irDone = false; this.hot = null; this.puzzleUsed = new Set();
    this.toWalk();
  }

  // ---- the walkthrough: three cards; card 1 is live (each team's practice pot grows only while every key is in)
  toWalk() {
    this.clearTimers();
    this.index = 0; this.practice = false; this.play = null; this.result = null; this.reveal = null; this.card = null;
    this.walk = { step: 0, allIn: false };
    for (const p of this.players.values()) if (p.bot) p.down = true;
    for (const k of this.pairs.values()) { this.resetTeam(k); k.walkPot = 0; k.walkSince = null; }
    this.setPhase('walk', this.ms(RULES.WALK_A_MS), () => this.walkNext());
    for (const k of this.pairs.values()) this.walkKeys(k);
    this.sendYou();
  }
  // A team's keys changed: its practice pot starts or stops. Card 1 moves on once every team has every key in.
  walkKeys(k, now = Date.now()) {
    if (this.phase !== 'walk' || this.walk.step !== 0) return;
    const on = this.keysIn(k);
    if (on && k.walkSince == null) k.walkSince = now;
    else if (!on && k.walkSince != null) { k.walkPot = this.walkPotNow(k, now); k.walkSince = null; }
    this.dirty = true;
    if (!this.walk.allIn && [...this.pairs.values()].every((q) => this.keysIn(q))) {
      this.walk.allIn = true;
      this.later(this.ms(RULES.WALK_GRACE_MS), () => { if (this.phase === 'walk' && this.walk.step === 0) this.walkNext(); });
    }
  }
  walkPotNow(k, now = Date.now()) { return (k.walkPot || 0) + (k.walkSince != null ? Math.round((RULES.WALK_RATE * (now - k.walkSince)) / this.scale / 1000) : 0); }
  walkNext() {
    if (this.phase !== 'walk') return;
    this.clearTimers();
    if (++this.walk.step >= RULES.WALK_STEPS) return this.toPractice();
    this.setPhase('walk', this.ms(RULES.WALK_CARD_MS), () => this.walkNext());
    this.sendYou();
    return undefined;
  }
  toPractice() { this.walk = null; this.toReady(0, true); }
  // FINAL MESSAGE · ALL IN ×5 (3 s), before the last message unless its act card just opened it.
  toCard(kind, next) {
    this.clearTimers();
    this.practice = false; this.index = next; this.play = null; this.result = null; this.reveal = null;
    for (const k of this.pairs.values()) this.resetTeam(k);
    this.card = { kind, mult: RULES.stage(next, this.messages.length, this.messages[next].act).mult, next };
    this.setPhase('stage', this.ms(RULES.STAGE_MS), () => this.endCard());
    this.sendYou();
  }
  // An act's title card: its name and new trick (15 s). Acts 2 and 3: every member picks SAFE or BOLD within CHOICE_MS;
  // the card ends early once every team has picked. Bots pick at once.
  toActCard(next) {
    this.clearTimers();
    this.practice = false; this.index = next; this.play = null; this.result = null; this.reveal = null;
    const m = this.messages[next], a = RULES.ACTS[m.act - 1], now = Date.now();
    const inAct = this.messages.filter((x) => x.act === m.act).length;
    for (const k of this.pairs.values()) { this.resetTeam(k); k.mode = null; k.picks = {}; k.actLost = 0; k.actBreaches = 0; }
    this.card = { kind: 'act', act: a.n, acts: RULES.ACTS.length, name: a.name, trick: a.trick, tip: a.tip || null, rule: a.rule || null, closes: !!a.closes, lead: a.lead, persona: a.persona, mult: a.mult, count: inAct,
      allIn: this.messages[this.messages.length - 1].act === m.act, choice: a.choice, startAt: now, choiceEndsAt: a.choice ? now + this.ms(RULES.CHOICE_MS) : 0, locked: !a.choice, next };
    if (a.closes) this.snapMarket();
    if (a.choice) {
      for (const k of this.pairs.values()) for (const id of k.members) { const q = this.players.get(id); if (q && q.bot) k.picks[id] = planChoice(q.temper, this.rand); }
      this.later(this.ms(RULES.CHOICE_MS), () => this.lockChoices());
    }
    this.setPhase('stage', this.ms(a.choice ? RULES.ACT_CARD_MS : RULES.ACT_PLAIN_MS), () => this.endCard());
    this.sendYou();
  }
  // A phone picks SAFE or BOLD (and may change it until the choice closes).
  choose(id, pick) {
    const p = this.players.get(id), k = this.pairOf(p), c = this.card;
    if (!p || p.bot || !k || this.phase !== 'stage' || !c || c.kind !== 'act' || !c.choice || c.locked || !['safe', 'bold'].includes(pick)) return;
    k.picks[p.id] = pick;
    this.sendTeam(k); this.dirty = true;
    // Every team has picked: close the card soon (never before ACT_MIN_MS from its start).
    if ([...this.pairs.values()].every((q) => this.decided(q))) {
      const now = Date.now(), end = Math.max(c.startAt + this.ms(RULES.ACT_MIN_MS), now + this.ms(RULES.ACT_GRACE_MS));
      if (end < this.phaseEndsAt) {
        this.clearTimers();
        c.choiceEndsAt = Math.min(c.choiceEndsAt, end);
        this.later(c.choiceEndsAt - now, () => this.lockChoices());
        this.setPhase('stage', end - now, () => this.endCard());
        this.sendYou();
      }
    }
  }
  decided(k) { return k.members.every((id) => k.picks[id]); }
  // BOLD only if every member picked BOLD; anything else (a split, no pick, a phone offline) is SAFE.
  modeOf(k) { return k.members.every((id) => k.picks[id] === 'bold') ? 'bold' : 'safe'; }
  lockChoices() {
    const c = this.card;
    if (!c || c.kind !== 'act' || c.locked) return;
    c.locked = true;
    for (const k of this.pairs.values()) k.mode = this.modeOf(k);
    this.sendYou(); this.dirty = true;
  }
  endCard() {
    if (this.phase !== 'stage' || !this.card) return;
    this.lockChoices();
    this.clearTimers();
    this.toReady(this.card.next);
  }
  // After a reveal: practice -> act 1's card; the last -> final; a new act -> its card; the last message -> ALL IN; else next.
  afterReveal() {
    this.clearTimers();
    if (this.practice) return this.toActCard(0);
    const n = this.messages.length, next = this.index + 1;
    // AGREE-QUIZ after the act's 2nd and 4th reveal (6 messages an act since 19 Nov) (never its last: that one ends the act).
    const a = this.actOf();
    if (a && RULES.QUIZ.after.includes(a.i + 1) && a.i + 1 < a.of) {
      const slots = RULES.QUIZ.after.filter((q) => q < a.of); // the act's quiz slots that can happen
      const pro = RULES.QUIZ.proActs.includes(a.n) && a.i + 1 === Math.max(...slots); // its last one: the PRO QUESTION
      const item = (pro && this.nextQuizItem(a.n, true)) || this.nextQuizItem(a.n);
      if (item) return this.toQuiz(item, () => this.continueAt(next));
    }
    // The act is over: RANSOMWARE locks the team breached most this act (nobody: most this game; never: no duel).
    // No duel after a closing act (LAST BUSINESS STANDING): closing time comes next.
    if ((next >= n || this.messages[next].act !== this.messages[this.index].act) && !this.closingAct()) {
      const L = this.ransomPick(), act = this.messages[this.index].act || 1;
      const ev = RULES.END_EVENTS.length ? RULES.END_EVENTS[(act - 1) % RULES.END_EVENTS.length] : null;
      if (L && ev && this.rivalFor(L, [L.id])) return ev === 'ransom' ? this.toRansom(L, () => this.continueAt(next), act) : this.toHot(L, () => this.continueAt(next), act);
    }
    return this.continueAt(next);
  }
  continueAt(next) {
    const n = this.messages.length;
    if (next >= n) return this.toFinal();
    if (next > 0 && this.messages[next].act !== this.messages[next - 1].act) {
      // INCIDENT ROOM: once a match, on the way into act 3 (the closing act).
      const bank = this.incidentBank || [];
      if (this.messages[next].act === 3 && !this.irDone && bank.length) {
        this.irDone = true;
        const item = bank[Math.floor(this.rand() * bank.length) % bank.length];
        return this.toQuiz(item, () => this.toActCard(next));
      }
      return this.toActCard(next);
    }
    if (next === n - 1) return this.toCard('final', next);
    return this.toReady(next);
  }

  // ---- RANSOMWARE ----------------------------------------------------------------
  // The team locked at the end of an act (19 Nov, Angelo: "based on teams with most breaches", not least revenue):
  // the most breaches this act; tie = more breaches over the whole game, then more lost this act. Nobody breached this
  // act = the most breaches over the whole game. Nobody ever breached = no ransomware. `why` says which.
  ransomPick() {
    const all = [...this.pairs.values()], game = (k) => (k.n && k.n.taps) || 0;
    const act = all.filter((k) => (k.actBreaches || 0) > 0)
      .sort((a, b) => b.actBreaches - a.actBreaches || game(b) - game(a) || (b.actLost || 0) - (a.actLost || 0) || a.total - b.total);
    if (act[0]) return act[0];
    const ever = all.filter((k) => game(k) > 0).sort((a, b) => game(b) - game(a) || a.total - b.total);
    if (ever[0]) return ever[0];
    return null;
  }
  // Standings: most money first (ties: the older team first, so the order is stable).
  standings() { return [...this.pairs.values()].sort((a, b) => b.total - a.total || Number(a.id.slice(1)) - Number(b.id.slice(1))); }
  // The locked team's rival: the nearest team above it that hasn't been in this chain yet; the leader faces the one below.
  rivalFor(L, used) {
    const st = this.standings(), i = st.indexOf(L);
    for (let j = i - 1; j >= 0; j--) if (!used.includes(st[j].id)) return st[j];
    for (let j = i + 1; j < st.length; j++) if (!used.includes(st[j].id)) return st[j];
    return null;
  }
  toRansom(L, then, act = null) {
    this.clearTimers();
    this.card = null; this.play = null; this.result = null; this.reveal = null; this.practice = false;
    this.ransom = { act, then, why: (L.actBreaches || 0) > 0 ? 'act' : (L.n && L.n.taps) > 0 ? 'game' : 'host', breaches: (L.actBreaches || 0) > 0 ? L.actBreaches : (L.n && L.n.taps) || 0, duel: 0, max: RULES.RANSOM.maxDuels, locked: L.id, rival: null, used: [L.id], step: null, taps: {}, startAt: 0, result: null, history: [] };
    this.nextDuel();
  }
  nextDuel() {
    const R = this.ransom, L = this.pairs.get(R.locked), V = L && this.rivalFor(L, R.used);
    if (!L || !V) { // nobody left to duel: the lock holder pays (the TV keeps the last duel's pair on screen)
      const last = R.history[R.history.length - 1]; if (last) R.rival = last.locked;
      return this.payRansom(L, false);
    }
    R.duel++; R.rival = V.id; R.used.push(V.id); R.result = null; R.taps = {}; R.startAt = 0;
    for (const k of [L, V]) for (const id of k.members) { R.taps[id] = 0; const p = this.players.get(id); if (p) { p.mash = 0; p.tapB = null; } }
    this.ransomStep('card', R.duel === 1 ? RULES.RANSOM.cardMs : RULES.RANSOM.nextCardMs, () => this.ransomStep('count', RULES.RANSOM.countMs, () => this.startMash()));
    return undefined;
  }
  ransomStep(step, ms, next) { this.clearTimers(); this.ransom.step = step; this.setPhase('ransom', this.ms(ms), next); this.sendYou(); }
  startMash() {
    const R = this.ransom, now = Date.now(), [lo, hi] = RULES.RANSOM.botRate;
    R.startAt = now;
    for (const id of Object.keys(R.taps)) { const p = this.players.get(id); if (!p) continue; p.tapB = { tokens: Math.min(3, RULES.RANSOM.tapBurst), at: now }; if (p.bot) p.mashRate = lo + this.rand() * (hi - lo); }
    this.ransomStep('mash', RULES.RANSOM.mashMs, () => this.endMash(false));
    R.startAt = now;
    const botStep = () => {
      if (this.phase !== 'ransom' || R.step !== 'mash' || this.ransom !== R) return;
      for (const id of Object.keys(R.taps)) {
        const p = this.players.get(id);
        if (!p || !p.bot) continue;
        p.mash += p.mashRate * 0.1 * (0.6 + this.rand() * 0.8); // a human hand: uneven
        R.taps[id] = Math.floor(p.mash);
      }
      this.dirty = true;
      if (!this.checkCrack()) this.later(this.ms(100), botStep);
    };
    this.later(this.ms(100), botStep);
  }
  // Members whose taps count in the average: connected people and bots (an offline phone doesn't drag its team down).
  mashers(k) { const on = k.members.filter((id) => { const p = this.players.get(id); return p && (p.bot || p.connected); }); return on.length ? on : k.members; }
  mashScore(k) { const R = this.ransom, ids = this.mashers(k); return Math.round((10 * ids.reduce((s, id) => s + (R.taps[id] || 0), 0)) / ids.length) / 10; }
  // A phone's taps (batched by the page): only the two duelling teams, only while the mash runs, at most tapRate a second.
  tap(id, n) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const K = this.contain;
    if (this.phase === 'crash' && K && K.step === 'mash' && id in K.taps) { // CONTAIN IT
      const ok = this.tapOk(p, n); if (ok <= 0) return;
      K.taps[id] += ok; this.dirty = true;
      return;
    }
    const R = this.ransom;
    if (this.phase !== 'ransom' || !R || R.step !== 'mash' || !(id in R.taps)) return;
    const ok = this.tapOk(p, n); if (ok <= 0) return;
    R.taps[id] += ok;
    this.dirty = true;
    this.checkCrack();
  }
  // How many of n taps a phone may have now (RANSOM.tapRate a second, a burst of tapBurst, game time).
  tapOk(p, n) {
    n = Math.floor(Number(n)); if (!(n > 0)) return 0; n = Math.min(n, 50);
    const now = Date.now(), b = p.tapB || (p.tapB = { tokens: 0, at: now }), C = RULES.RANSOM;
    b.tokens = Math.min(C.tapBurst, b.tokens + (C.tapRate * (now - b.at)) / this.scale / 1000); b.at = now;
    const ok = Math.min(n, Math.floor(b.tokens));
    if (ok > 0) b.tokens -= ok;
    return ok;
  }
  // The first team to `key` taps per member cracks it at once.
  checkCrack() {
    const R = this.ransom, L = this.pairs.get(R.locked), V = this.pairs.get(R.rival);
    if (!L || !V || R.step !== 'mash') return false;
    if (this.mashScore(L) >= RULES.RANSOM.key || this.mashScore(V) >= RULES.RANSOM.key) { this.endMash(true); return true; }
    return false;
  }
  endMash(cracked) {
    const R = this.ransom;
    if (this.phase !== 'ransom' || !R || R.step !== 'mash') return;
    this.clearTimers();
    const L = this.pairs.get(R.locked), V = this.pairs.get(R.rival);
    const sL = this.mashScore(L), sV = this.mashScore(V), free = sL > sV; // a tie: the lock holds
    const row = { duel: R.duel, locked: L.id, rival: V.id, sL, sV, winner: free ? 'locked' : 'rival', cracked: !!cracked };
    R.history.push(row);
    if (free) {
      if (R.duel >= R.max) { R.locked = V.id; return this.payRansom(V, true, row); } // the cap: the lock stops on the loser
      R.result = { kind: 'free', freed: L.id, next: V.id, sL, sV, cracked: !!cracked };
      this.logDuel(row, L, V, null, 0);
      this.ransomStep('result', RULES.RANSOM.resultMs, () => { R.locked = V.id; this.nextDuel(); });
      return undefined;
    }
    return this.payRansom(L, false, row);
  }
  // The lock holder pays `cut` of its bank (rounded to R100); the chain ends.
  payRansom(k, capped, row = null) {
    const R = this.ransom;
    const amount = k ? Math.round((k.total * RULES.RANSOM.cut) / 100) * 100 : 0;
    if (k) k.total -= amount;
    if (k && this.top3) this.snapTop3(); // the ransom is public: the side panel can show it
    R.locked = k ? k.id : R.locked;
    R.result = { kind: 'paid', payer: k ? k.id : null, amount, capped: !!capped, sL: row ? row.sL : null, sV: row ? row.sV : null, cracked: row ? row.cracked : false, freed: row && row.winner === 'locked' ? row.locked : null };
    if (row) { const L = this.pairs.get(row.locked), V = this.pairs.get(row.rival); this.logDuel(row, L, V, k, amount); }
    this.ransomStep('result', RULES.RANSOM.paidMs, () => this.endRansom());
    return undefined;
  }
  logDuel(row, L, V, payer, amount) {
    const R = this.ransom;
    this.log([{ at: new Date().toISOString(), type: 'ransom', pin: this.pin, act: R.act, duel: row.duel, locked: row.locked, rival: row.rival, lockedSize: L.members.length, rivalSize: V.members.length,
      lockedBot: this.isBotPair(L), rivalBot: this.isBotPair(V), lockedScore: row.sL, rivalScore: row.sV, cracked: row.cracked, winner: row.winner, payer: payer ? payer.id : null, amount }]);
  }
  endRansom() {
    const R = this.ransom; if (!R) return undefined;
    this.clearTimers();
    this.ransom = null;
    for (const p of this.players.values()) { p.mash = 0; p.tapB = null; }
    return R.then();
  }
  ransomSkip() {
    const R = this.ransom; if (!R) return undefined;
    if (R.step === 'card') return this.ransomStep('count', RULES.RANSOM.countMs, () => this.startMash());
    if (R.step === 'count') return this.startMash();
    if (R.step === 'mash') return this.endMash(false);
    if (R.step === 'result') { if (R.result && R.result.kind === 'free') { R.locked = R.result.next; return this.nextDuel(); } return this.endRansom(); }
    return undefined;
  }
  // Host RANSOMWARE NOW / HOT FILE NOW: lock the poorest team with a person in it and run the event at once, then carry
  // on where it was. kind 'hot' (W) = HOT FILE; 'duel' (D) = the tap duel.
  ransomNow(kind = 'hot') {
    if (this.phase === 'ransom' || this.phase === 'hot' || this.phase === 'final' || this.phase === 'quiz') return undefined;
    if (this.phase === 'lobby') { this.start(); if (this.phase !== 'walk') return undefined; }
    const people = [...this.pairs.values()].filter((k) => !this.isBotPair(k));
    if (!people.length || this.pairs.size < 2) return undefined;
    const L = people.sort((a, b) => a.total - b.total)[0];
    const ph = this.phase, i = this.index, prac = this.practice, c = this.card;
    const then = ph === 'walk' ? () => this.toWalk()
      : ph === 'reveal' ? () => (prac ? this.toActCard(0) : this.continueAt(i + 1))
      : ph === 'stage' && c ? () => (c.kind === 'act' ? this.toActCard(c.next) : this.toCard(c.kind, c.next))
      : () => this.toReady(i, prac); // ready / play / crash: the message starts again
    for (const p of this.players.values()) if (p.pending) { clearTimeout(p.pending.timer); p.pending = null; }
    const act = prac ? 1 : (this.messages[i] || {}).act || 1;
    return kind === 'duel' ? this.toRansom(L, then, act) : this.toHot(L, then, act);
  }
  toReady(i, practice = false) {
    this.clearTimers();
    this.index = i; this.practice = practice; this.card = null; this.play = null; this.result = null; this.reveal = null;
    this.soloLeftovers();
    for (const p of this.players.values()) if (p.bot) p.down = true;
    for (const k of this.pairs.values()) this.resetTeam(k);
    this.readyAt = Date.now();
    this.setPhase('ready', this.ms(RULES.READY_MS), () => this.startMessage());
    this.later(this.ms(RULES.READY_MIN_MS), () => this.maybeStartEarly());
    this.sendYou();
  }
  // Every connected human has a thumb down: go as soon as the minimum ready time has passed.
  maybeStartEarly() {
    if (this.phase !== 'ready' || this.paused || Date.now() - this.readyAt < this.ms(RULES.READY_MIN_MS)) return;
    const live = this.humans().filter((h) => h.connected && h.pairId);
    if (live.length && live.every((h) => h.down)) this.startMessage();
  }
  startMessage() {
    if (this.phase !== 'ready') return;
    this.clearTimers();
    const m = this.message, now = Date.now();
    this.play = { startAt: now, bonus: 0, left: 0, shown: null, };
    for (const p of this.players.values()) p.upAt = null;
    for (const k of this.pairs.values()) {
      this.resetTeam(k);
      // Every key in: the pot grows from the first line. Otherwise the team waits for its last key.
      if (this.keysIn(k)) { k.st = 'hold'; k.arm = { t: 0, bonus: 0 }; } else k.st = 'wait';
      for (const id of k.members) {
        const h = this.players.get(id);
        if (h && h.bot) {
          const at = planRelease(h.temper, m, this.rand, this.stakes.lineMs);
          if (Number.isFinite(at)) this.later(this.ms(at * 1000), () => this.bank(k, h, this.teamPot(k)));
        }
      }
    }
    this.setPhase('play', this.ms(RULES.endAt(m, this.stakes.lineMs)), () => this.resolve());
    this.event({ kind: 'start', index: this.index });
    this.sendYou();
  }
  resolve() {
    if (this.phase !== 'play') return;
    const now = Date.now();
    // Thumbs that came up before the end count as let go, even inside the debounce window.
    for (const p of this.players.values()) if (p.pending) { const k = this.pairOf(p); if (k) this.bank(k, p, p.pending.pot, p.pending.at); }
    this.clearTimers();
    const m = this.message, st = this.stakes, potEnd = this.potNow(now), mult = st.mult, scam = m.kind !== 'real';
    this.play.shown = this.linesShown(now);
    const teams = [...this.pairs.values()];
    const endMs = RULES.endAt(m, st.lineMs);
    if (!this.practice) this.playMs += endMs;
    for (const k of teams) {
      const x = k.mode === 'bold' ? RULES.BOLD_X : 1;
      // Uptime: game ms this company was open with every key in (from its arm to its release, or the end).
      if (!this.practice && !k.closed && k.arm) k.upMs = (k.upMs || 0) + Math.max(0, Math.min(endMs, (k.rel != null ? k.rel : endMs) - k.arm.t * 1000));
      if (k.closed) { // LAST BUSINESS STANDING: a closed company holds along; only a spot counts (Human Firewall)
        if (k.st === 'hold') { k.st = scam ? 'caught' : 'dbl'; k.mark = scam ? 'tapped' : 'trusted'; }
        else if (k.st === 'wait') { k.st = 'out'; k.mark = 'out'; }
        k.got = 0; k.lost = 0; k.kept = 0; k.bonus = 0; k.base = 0; k.sync = false;
        if (!this.practice && k.mark === 'spotted') k.n.spotted++;
        // RESTORE FROM BACKUP: a bank (let go before the spring, or a real message held) fills the backup bar.
        if (!this.practice && !k.restored && ((scam && k.st === 'banked') || (!scam && k.st === 'dbl'))) { k.backup = (k.backup || 0) + 1; k.backupNow = true; }
        continue;
      }
      if (k.st === 'hold') {
        k.lost = this.teamPot(k, now) * mult;
        if (scam) { k.st = 'caught'; k.mark = 'tapped'; k.kept = k.mode === 'safe' ? Math.round(k.lost * RULES.SAFE_KEEP) : 0; k.got = k.kept; }
        else { k.st = 'dbl'; k.mark = 'trusted'; k.got = 2 * k.lost * x; k.lost = 0; }
      } else if (k.st === 'wait') { k.st = 'out'; k.mark = 'out'; k.got = 0; }
      else if (k.st === 'banked') {
        k.got += k.bonus * x; // SPOTTED IT: the bonus lands now, with the kind
        if (k.sync) { const g = Math.round(k.got * RULES.SYNC.x); k.syncX = g - k.got; k.got = g; } // LET GO TOGETHER
      }
      if (k.st !== 'banked') k.sync = false;
      if (!this.practice) { // practice never counts
        k.total += k.got;
        if (k.st === 'caught') k.actLost = (k.actLost || 0) + Math.max(0, (k.lost || 0) - (k.kept || 0)); // RANSOMWARE: what scams took this act
        if (k.st === 'caught') k.actBreaches = (k.actBreaches || 0) + 1; // RANSOMWARE: who was breached most this act
        const c = { spotted: 'spotted', early: 'early', tapped: 'taps', trusted: 'trusted' }[k.mark];
        if (c) k.n[c]++;
        if (k.mark !== 'out') k.n.played++;
      }
    }
    if (!this.practice && scam) this.scamsPlayed++;
    const caught = teams.filter((k) => k.st === 'caught' && !k.closed).map((k) => k.id);
    this.result = { kind: scam ? 'spring' : 'double', potEnd, mult, caught, consequence: scam ? m.consequence : null, persona: scam ? m.persona : null, disguise: m.disguise };
    this.writeLog(m, st, teams);
    this.event({ kind: this.result.kind, caught: caught.length, holders: teams.filter((k) => k.st === 'caught' || k.st === 'dbl').length });
    if (this.closingAct() && scam && caught.length) { // CONTAIN IT: tap fast or close for good
      // GET READY (CONTAIN.readyMs, 3·2·1 on the breached phones and the TV), then the tapping window.
      const K = this.contain = { teams: caught, taps: {}, step: 'ready', readyAt: now, startAt: now + this.ms(RULES.CONTAIN.readyMs), ms: this.ms(RULES.CONTAIN.ms), result: {} };
      for (const id of caught) for (const pid of this.pairs.get(id).members) K.taps[pid] = 0;
      this.snapMarket();
      this.setPhase('crash', this.ms(RULES.CONTAIN.readyMs), () => this.startContainMash());
    } else {
      if (this.closingAct()) this.snapMarket();
      this.setPhase('crash', this.ms(RULES.CRASH_MS), () => this.toReveal());
    }
    this.sendYou();
  }

  // ---- HOT FILE (19 Nov) -------------------------------------------------------------
  // An infected file lands on L (the most-breached company of the act). Steps: landed -> choose -> (passed -> choose)* ->
  // puzzle? -> result. Both members agree (private picks, shown to the team once all picked). Watchers only watch the TV.
  toHot(L, then, act = 1) {
    this.clearTimers();
    this.card = null; this.play = null; this.result = null; this.reveal = null; this.contain = null;
    for (const p of this.players.values()) if (p.pending) { clearTimeout(p.pending.timer); p.pending = null; }
    this.hot = { act: act || 1, then, holder: L.id, first: L.id, from: null, passes: 0, max: RULES.HOT.maxPasses, used: [L.id], picks: {}, canPass: false, puzzle: null, result: null, step: null, endsAt: 0, history: [], botPlan: null,
      why: { act: L.actBreaches || 0, game: (L.n && L.n.taps) || 0, lost: L.actLost || 0 } };
    this.hotStep('landed', RULES.HOT.landMs, () => this.hotChoose());
  }
  hotStep(step, ms, next) {
    const T = this.hot; this.clearTimers();
    T.step = step; T.picks = {}; T.botPlan = null; T.endsAt = Date.now() + this.ms(ms);
    this.setPhase('hot', this.ms(ms), next); this.sendYou(); this.dirty = true;
  }
  hotChoose() {
    const T = this.hot, k = this.pairs.get(T.holder);
    T.canPass = T.passes < T.max && !!(k && this.rivalFor(k, T.used));
    this.hotStep('choose', RULES.HOT.chooseMs, () => this.hotDecide());
    if (k && this.isBotPair(k)) {
      const pick = this.rand() < RULES.HOT.botDefuse || !T.canPass ? 'defuse' : 'pass';
      T.botPlan = pick;
      const at = 2500 + this.rand() * 4000;
      this.later(this.ms(at * 0.45), () => { if (this.hot === T && T.step === 'choose') { T.picks[k.members[0]] = pick; this.dirty = true; } });
      this.later(this.ms(at), () => { if (this.hot === T && T.step === 'choose') { for (const id of k.members) T.picks[id] = pick; this.hotDecide(); } });
    }
  }
  hotVoters(k) { return this.mashers(k); }
  hotTeamPick(k) {
    const T = this.hot, ps = this.hotVoters(k).map((id) => T.picks[id]);
    return ps.length && ps.every((x) => x !== undefined && x === ps[0]) ? ps[0] : null;
  }
  hotAnswer(id, pick) {
    const T = this.hot, p = this.players.get(id), k = this.pairOf(p);
    if (!T || this.phase !== 'hot' || !p || p.bot || !k || k.id !== T.holder) return;
    if (!this.hotVoters(k).includes(id)) return;
    if (T.step === 'choose') {
      if (!['pass', 'defuse', 'take'].includes(pick) || (pick === 'pass' && !T.canPass)) return;
      T.picks[id] = pick; this.sendTeam(k); this.dirty = true;
      if (this.hotTeamPick(k) !== null) this.hotDecide();
    } else if (T.step === 'puzzle') {
      if (!Number.isInteger(pick) || pick < 0 || pick >= T.puzzle.options.length) return;
      T.picks[id] = pick; this.sendTeam(k); this.dirty = true;
      if (this.hotTeamPick(k) !== null) this.hotSolve();
    }
  }
  // The choice: agreed DEFUSE -> puzzle; agreed PASS -> pass; no agreement -> pass if it can (the cautious default), else hit.
  hotDecide() {
    const T = this.hot; if (!T || T.step !== 'choose') return undefined;
    const k = this.pairs.get(T.holder), v = k ? this.hotTeamPick(k) : null;
    if (v === 'defuse') return this.hotPuzzle();
    if ((v === 'pass' || v === null) && T.canPass) return this.hotPass();
    return this.hotHit(k, v === 'take' ? 'took' : 'stuck');
  }
  hotPass() {
    const T = this.hot, k = this.pairs.get(T.holder), next = this.rivalFor(k, T.used);
    T.history.push({ team: k.id, kind: 'pass' });
    T.from = k.id; T.holder = next.id; T.used.push(next.id); T.passes += 1;
    this.hotStep('passed', RULES.HOT.passedMs, () => this.hotChoose());
  }
  nextPuzzle(act) {
    const free = (this.puzzleBank || []).filter((q) => !this.puzzleUsed.has(q.id));
    return free.find((q) => q.act === act) || free[0] || (this.puzzleBank || [])[0] || null;
  }
  hotPuzzle() {
    const T = this.hot, k = this.pairs.get(T.holder), item = this.nextPuzzle(T.act);
    if (!item) return this.hotHit(k, 'stuck');
    this.puzzleUsed.add(item.id);
    T.puzzle = item;
    this.hotStep('puzzle', RULES.HOT.puzzleMs, () => this.hotSolve());
    if (k && this.isBotPair(k)) {
      const n = item.options.length, pick = this.rand() < RULES.HOT.botRight ? item.answer : (item.answer + 1 + Math.floor(this.rand() * (n - 1))) % n;
      T.botPlan = pick;
      const at = 4000 + this.rand() * 7000, first = this.rand() < 0.35 ? (pick + 1) % n : pick; // sometimes they start split
      this.later(this.ms(at * 0.4), () => { if (this.hot === T && T.step === 'puzzle') { T.picks[k.members[0]] = first; this.dirty = true; } });
      this.later(this.ms(at * 0.7), () => { if (this.hot === T && T.step === 'puzzle' && k.members[1]) { T.picks[k.members[1]] = pick; this.dirty = true; } });
      this.later(this.ms(at), () => { if (this.hot === T && T.step === 'puzzle') { for (const id of k.members) T.picks[id] = pick; this.hotSolve(); } });
    }
    return undefined;
  }
  hotSolve() {
    const T = this.hot; if (!T || T.step !== 'puzzle') return undefined;
    const k = this.pairs.get(T.holder), v = k ? this.hotTeamPick(k) : null;
    if (v === T.puzzle.answer) {
      const mult = (RULES.ACTS[(T.act || 1) - 1] || RULES.ACTS[0]).mult, bonus = RULES.QUIZ.bonus * mult * RULES.HOT.heroX;
      if (!k.closed) k.total += bonus;
      k.hero = (k.hero || 0) + 1; k.n.hero = (k.n.hero || 0) + 1;
      T.result = { kind: 'hero', team: k.id, bonus, answer: T.puzzle.answer, why: T.puzzle.why, pick: v };
      T.history.push({ team: k.id, kind: 'hero' });
      this.hotLog(k, 'hero', 0);
      this.snapTop3();
      return this.hotStep('result', RULES.HOT.resultMs, () => this.endHot());
    }
    return this.hotHit(k, v === null ? 'timeout' : 'wrong', v);
  }
  hotHit(k, how, pick = null) {
    const T = this.hot;
    const amount = Math.round(((k ? k.total : 0) * RULES.HOT.cut) / 100) * 100;
    if (k) k.total = Math.max(0, k.total - amount);
    T.result = { kind: 'hit', team: k ? k.id : null, amount, how, answer: T.puzzle ? T.puzzle.answer : null, why: T.puzzle ? T.puzzle.why : null, pick };
    if (k) T.history.push({ team: k.id, kind: 'hit' });
    this.hotLog(k, 'hit', amount);
    this.snapTop3();
    return this.hotStep('result', RULES.HOT.resultMs, () => this.endHot());
  }
  hotLog(k, kind, amount) {
    const T = this.hot;
    this.log([{ at: new Date().toISOString(), type: 'hotfile', pin: this.pin, act: T.act, passes: T.passes, team: k ? k.id : null, bot: k ? this.isBotPair(k) : null, kind, amount, puzzle: T.puzzle ? T.puzzle.id : null, how: T.result && T.result.how }]);
  }
  endHot() { const T = this.hot; if (!T) return undefined; this.clearTimers(); this.hot = null; return T.then(); }
  hotSkip() {
    const T = this.hot; if (!T) return undefined;
    if (T.step === 'landed' || T.step === 'passed') return this.hotChoose();
    if (T.step === 'choose') return this.hotDecide();
    if (T.step === 'puzzle') return this.hotSolve();
    return this.endHot();
  }
  hotSide(k, short) { return k && { id: k.id, label: this.label(k, short), members: [...k.members], size: k.members.length, total: k.total, bot: this.isBotPair(k), hero: k.hero || 0 }; }
  // The big screen: who holds it and why, the chain so far, the puzzle (never its answer until the result).
  hotView() {
    const T = this.hot, short = this.shortNames(), k = this.pairs.get(T.holder);
    const v = { step: T.step, act: T.act, holder: this.hotSide(k, short), from: T.from ? this.hotSide(this.pairs.get(T.from), short) : null, first: T.first === T.holder, passes: T.passes, max: T.max, canPass: T.canPass, endsAt: T.endsAt,
      why: T.why, picked: k ? this.hotVoters(k).filter((id) => T.picks[id] !== undefined).length : 0, of: k ? this.hotVoters(k).length : 0,
      // 19 Nov (Angelo): the room watches them decide and defuse live: each member's current pick (it's their event, not a hold).
      live: k && (T.step === 'choose' || T.step === 'puzzle') ? this.hotVoters(k).map((id) => { const q = this.players.get(id); return { id, name: q ? short(q) : '', av: q ? q.av : null, pick: T.picks[id] === undefined ? null : T.picks[id] }; }) : null,
      history: T.history.filter((h) => this.pairs.has(h.team)).map((h) => ({ kind: h.kind, label: this.label(this.pairs.get(h.team), short) })) };
    if (T.puzzle && (T.step === 'puzzle' || T.step === 'result')) v.puzzle = { prompt: T.puzzle.prompt, options: T.puzzle.options };
    if (T.step === 'result' && T.result) v.result = { ...T.result, team: this.hotSide(this.pairs.get(T.result.team), short) };
    return v;
  }
  hotYou(p, k) {
    const T = this.hot, v = this.hotView(), mine = k && k.id === T.holder;
    const y = { ...v, role: mine ? 'holder' : 'watch' };
    if (mine) {
      const all = this.hotVoters(k).every((id) => T.picks[id] !== undefined);
      y.mine = T.picks[p.id] === undefined ? null : T.picks[p.id];
      y.mates = k.members.filter((id) => id !== p.id).map((id) => { const q = this.players.get(id); const has = T.picks[id] !== undefined; return { name: q ? q.name : '', av: q ? q.av : null, picked: has, pick: all && has ? T.picks[id] : null }; });
      y.split = all && this.hotTeamPick(k) === null;
    }
    return y;
  }

  // ---- AGREE-QUIZ -------------------------------------------------------------------
  // The next unasked item for an act (any act's if this one has run out).
  // A regular item for this act (or any act if this act's ran out); pro = a PRO QUESTION for this act (or any pro).
  nextQuizItem(act, pro = false) {
    const free = (this.quizBank || []).filter((q) => !this.quizUsed.has(q.id) && !!q.pro === pro);
    return free.find((q) => q.act === act) || (pro ? free[0] : free[0]) || null;
  }
  // Members whose answer counts: connected people and bots (an offline phone can't block its team).
  quizVoters(k) { return this.mashers(k); }
  // The team's answer: every voter picked the same option (a SOLO team: its one pick); else null.
  teamAnswer(k) {
    const Q = this.quiz; if (!Q) return null;
    const ps = this.quizVoters(k).map((id) => Q.picks[id]);
    return ps.length && ps.every((x) => Number.isInteger(x) && x === ps[0]) ? ps[0] : null;
  }
  teamPicked(k) { const Q = this.quiz; return !!Q && this.quizVoters(k).every((id) => Number.isInteger(Q.picks[id])); }
  qrules(Q = this.quiz) { return Q && Q.ir ? RULES.IR : RULES.QUIZ; }
  toQuiz(item, then) {
    this.clearTimers();
    this.card = null; this.play = null; this.result = null; this.reveal = null; this.contain = null;
    const ir = Array.isArray(item.evidence);
    if (!ir) this.quizUsed.add(item.id);
    const now = Date.now(), a = this.messages[this.index] ? this.messages[this.index].act : 1;
    this.quiz = { item, then, ir, act: a, step: ir ? 'brief' : 'pick', picks: {}, startAt: now, briefEndsAt: ir ? now + this.ms(RULES.IR.briefMs) : 0, pickEndsAt: 0, result: null, done: false };
    if (ir) { this.setPhase('quiz', this.ms(RULES.IR.briefMs), () => this.quizStartPick()); this.sendYou(); return; }
    this.quizStartPick();
  }
  // The pick window opens (straight away for a quiz; after the evidence brief in the INCIDENT ROOM).
  quizStartPick() {
    const Q = this.quiz; if (!Q) return;
    this.clearTimers();
    const C = this.qrules(Q), item = Q.item, now = Date.now();
    Q.step = 'pick'; Q.pickStartAt = now; Q.pickEndsAt = now + this.ms(C.pickMs);
    // Bot teams: one pick for the whole team, at a human pace (3-9 s), right with botRight.
    for (const k of this.pairs.values()) {
      if (!this.isBotPair(k)) continue;
      const right = this.rand() < (Q.ir ? C.botRight : item.pro ? RULES.QUIZ.botRightPro : RULES.QUIZ.botRight), n = item.options.length;
      const pick = right ? item.answer : (item.answer + 1 + Math.floor(this.rand() * (n - 1))) % n;
      this.later(this.ms(3000 + this.rand() * 6000), () => { if (this.quiz && this.quiz.item === item && this.quiz.step !== 'reveal') { for (const id of k.members) this.quiz.picks[id] = pick; this.quizMaybeDone(); this.dirty = true; } });
    }
    this.setPhase('quiz', this.ms(C.pickMs), () => this.quizAgree());
    this.sendYou();
  }
  // A phone answers. Pick step: a pick is private and locked, unless the whole team has picked and disagrees (then any
  // member may change). Agree step: anyone in a team without an agreed answer may change.
  answer(id, pick) {
    const p = this.players.get(id), k = this.pairOf(p), Q = this.quiz;
    if (!p || p.bot || !k || this.phase !== 'quiz' || !Q || Q.step === 'reveal' || Q.step === 'brief') return;
    if (!Number.isInteger(pick) || pick < 0 || pick >= Q.item.options.length) return;
    if (!this.quizVoters(k).includes(id)) return;
    const mine = Q.picks[id];
    const mayChange = Q.step === 'agree' || (this.teamPicked(k) && this.teamAnswer(k) === null);
    if (Number.isInteger(mine) && !mayChange) return;
    if (this.teamAnswer(k) !== null) return; // agreed: locked
    Q.picks[id] = pick;
    this.sendTeam(k); this.dirty = true;
    this.quizMaybeDone();
  }
  // Every team agreed: reveal after a short grace (the last pair sees their match first).
  quizMaybeDone() {
    const Q = this.quiz;
    if (!Q || Q.done || Q.step === 'reveal') return;
    if ([...this.pairs.values()].every((k) => this.teamAnswer(k) !== null)) {
      Q.done = true;
      this.clearTimers();
      this.setPhase('quiz', this.ms(RULES.QUIZ.doneGraceMs), () => this.quizReveal());
      this.sendYou();
    }
  }
  quizAgree() {
    const Q = this.quiz; if (!Q || Q.step !== 'pick') return;
    this.clearTimers();
    if ([...this.pairs.values()].every((k) => this.teamAnswer(k) !== null)) return this.quizReveal();
    const C = this.qrules(Q);
    Q.step = 'agree'; Q.agreeEndsAt = Date.now() + this.ms(C.agreeMs);
    this.setPhase('quiz', this.ms(C.agreeMs), () => this.quizReveal());
    this.sendYou();
    return undefined;
  }
  quizReveal() {
    const Q = this.quiz; if (!Q || Q.step === 'reveal') return;
    this.clearTimers();
    Q.step = 'reveal';
    const short = this.shortNames(), mult = (RULES.ACTS[(Q.act || 1) - 1] || RULES.ACTS[0]).mult;
    const bonus = RULES.QUIZ.bonus * mult * (Q.ir ? RULES.IR.mult : Q.item.pro ? RULES.QUIZ.proX : 1), teams = [...this.pairs.values()], right = [];
    Q.answers = {};
    for (const k of teams) {
      const a = this.teamAnswer(k); Q.answers[k.id] = a;
      if (a === Q.item.answer) {
        k.n.quiz = (k.n.quiz || 0) + 1;
        if (!k.closed) k.total += bonus;
        right.push(k);
      }
    }
    const human = (k) => !this.isBotPair(k);
    const shown = [...right].sort((a, b) => human(b) - human(a) || b.total - a.total).slice(0, RULES.QUIZ.show);
    Q.result = { answer: Q.item.answer, why: Q.item.why, right: right.length, of: teams.length, pct: teams.length ? Math.round((100 * right.length) / teams.length) : 0,
      names: shown.map((k) => ({ id: k.id, label: this.label(k, short), members: [...k.members] })), more: Math.max(0, right.length - shown.length), bonus, pro: !!Q.item.pro };
    if (Q.ir) Q.result.walk = [...Q.item.walk];
    this.log([{ at: new Date().toISOString(), type: Q.ir ? 'incident' : 'quiz', pin: this.pin, act: Q.act, id: Q.item.id, answer: Q.item.answer,
      teams: teams.map((k) => ({ team: k.id, size: k.members.length, bot: this.isBotPair(k), answer: Q.answers[k.id], right: Q.answers[k.id] === Q.item.answer, closed: !!k.closed })) }]);
    this.snapTop3();
    if (this.closingAct()) this.snapMarket();
    this.setPhase('quiz', this.ms(this.qrules(Q).revealMs), () => this.endQuiz());
    this.sendYou();
  }
  endQuiz() { const Q = this.quiz; if (!Q) return undefined; this.clearTimers(); this.quiz = null; return Q.then(); }
  quizSkip() { const Q = this.quiz; if (!Q) return undefined; if (Q.step === 'brief') return this.quizStartPick(); if (Q.step === 'pick') return this.quizAgree(); if (Q.step === 'agree') return this.quizReveal(); return this.endQuiz(); }
  // The big screen: the question and options; how many teams have answered; nothing about anyone's pick until the reveal.
  quizView() {
    const Q = this.quiz;
    const v = { step: Q.step, act: Q.act, id: Q.item.id, pro: !!Q.item.pro, question: Q.item.question, options: Q.item.options, startAt: Q.startAt, pickEndsAt: Q.pickEndsAt, agreeEndsAt: Q.agreeEndsAt || 0,
      answered: [...this.pairs.values()].filter((k) => this.teamAnswer(k) !== null).length, of: this.pairs.size, need: 'agree' };
    if (Q.ir) Object.assign(v, { ir: true, title: Q.item.title, brief: Q.item.brief, evidence: Q.item.evidence, briefEndsAt: Q.briefEndsAt });
    if (Q.step === 'reveal') v.result = Q.result;
    return v;
  }
  // A phone: its own pick, its mates' picks (only once the whole team has picked, or at the agree step), the team's answer.
  quizYou(p, k) {
    const Q = this.quiz, open = Q.step !== 'pick' || this.teamPicked(k), ta = this.teamAnswer(k);
    const y = { step: Q.step, pro: !!Q.item.pro, question: Q.item.question, options: Q.item.options, startAt: Q.startAt, pickEndsAt: Q.pickEndsAt, agreeEndsAt: Q.agreeEndsAt || 0,
      mine: Number.isInteger(Q.picks[p.id]) ? Q.picks[p.id] : null, solo: k.members.length === 1, agreed: ta !== null, teamAnswer: ta,
      mates: k.members.filter((id) => id !== p.id).map((id) => { const q = this.players.get(id); const has = Number.isInteger(Q.picks[id]); return { name: q ? q.name : '', av: q ? q.av : null, picked: has, pick: open && has ? Q.picks[id] : null }; }),
      disagree: this.teamPicked(k) && ta === null, closed: !!k.closed };
    if (Q.ir) Object.assign(y, { ir: true, title: Q.item.title, evidence: Q.item.evidence, briefEndsAt: Q.briefEndsAt });
    if (Q.step === 'reveal' && Q.result) Object.assign(y, { walk: Q.ir ? Q.item.walk : undefined, answer: Q.item.answer, why: Q.item.why, right: ta === Q.item.answer, bonus: ta === Q.item.answer && !k.closed ? Q.result.bonus : 0, pct: Q.result.pct });
    return y;
  }

  // ---- LAST BUSINESS STANDING ------------------------------------------------------
  // The act being played closes companies on a breach (act 3), and never the practice.
  closingAct(i = this.index) { if (this.practice) return false; const m = this.messages[i]; const a = m && RULES.ACTS[m.act - 1]; return !!(a && a.closes); }
  // One bot tick of CONTAIN IT (100 ms of game time): a human hand, uneven.
  // The CONTAIN IT window opens: taps count from now (bucket reset so taps during GET READY can't bank a burst).
  startContainMash() {
    const K = this.contain; if (this.phase !== 'crash' || !K || K.step !== 'ready') return;
    this.clearTimers();
    const now = Date.now(), [lo, hi] = RULES.CONTAIN.botRate;
    K.step = 'mash'; K.startAt = now;
    for (const pid of Object.keys(K.taps)) { K.taps[pid] = 0; const p = this.players.get(pid); if (p) { p.mash = 0; p.tapB = { tokens: Math.min(3, RULES.RANSOM.tapBurst), at: now }; if (p.bot) p.mashRate = lo + this.rand() * (hi - lo); } }
    this.setPhase('crash', this.ms(RULES.CONTAIN.ms), () => this.endContain());
    const botStep = () => { if (this.contain !== K || K.step !== 'mash') return; this.containBotStep(); this.dirty = true; this.later(this.ms(100), botStep); };
    this.later(this.ms(100), botStep);
    this.sendYou();
  }
  containBotStep() {
    const K = this.contain; if (!K) return;
    for (const id of Object.keys(K.taps)) { const p = this.players.get(id); if (!p || !p.bot) continue; p.mash = (p.mash || 0) + p.mashRate * 0.1 * (0.6 + this.rand() * 0.8); K.taps[id] = Math.floor(p.mash); }
  }
  containBotsFor(ms) { for (let t = 0; t < ms; t += 100) this.containBotStep(); }
  // Average taps per member (connected people and bots), to 0.1.
  containScore(k) { const K = this.contain, ids = this.mashers(k); return Math.round((10 * ids.reduce((s, id) => s + ((K && K.taps[id]) || 0), 0)) / ids.length) / 10; }
  endContain() {
    const K = this.contain;
    if (this.phase !== 'crash' || !K || K.step !== 'mash') return;
    this.clearTimers();
    for (const id of K.teams) {
      const k = this.pairs.get(id); if (!k) continue;
      const score = this.containScore(k), ok = score >= RULES.CONTAIN.need;
      K.result[id] = ok ? 'contained' : 'closed';
      K.scores = { ...(K.scores || {}), [id]: score };
      if (ok) k.contained = (k.contained || 0) + 1;
      else k.closed = { act: this.messages[this.index].act, seq: ++this.closeSeq, index: this.index };
    }
    K.step = 'result';
    this.log([{ at: new Date().toISOString(), type: 'contain', pin: this.pin, index: this.index, teams: K.teams.map((id) => { const k = this.pairs.get(id); return { team: id, size: k ? k.members.length : 0, bot: k ? this.isBotPair(k) : null, score: K.scores[id], result: K.result[id] }; }) }]);
    this.snapMarket();
    this.setPhase('crash', this.ms(RULES.CONTAIN.resultMs), () => this.toReveal());
    this.sendYou();
  }
  // The skyline: one building per company (pair order), revenue and open/closed, as of now.
  snapMarket() {
    const short = this.shortNames();
    this.market = [...this.pairs.values()].map((k) => ({ id: k.id, label: this.label(k, short), members: [...k.members], total: k.total, open: !k.closed, closedNow: !!(k.closed && k.closed.index === this.index && !this.practice),
      backup: k.closed && !k.restored ? { have: Math.min(k.backup || 0, RULES.BACKUP.need), need: RULES.BACKUP.need } : null, restored: !!k.restored, restoredNow: !!(k.restored && k.restored.index === this.index && this.phase === 'reveal') }));
  }
  containView() {
    const K = this.contain, short = this.shortNames();
    return { step: K.step, readyAt: K.readyAt, startAt: K.startAt, ms: K.ms, need: RULES.CONTAIN.need, teams: K.teams.map((id) => { const k = this.pairs.get(id); return k && { id, label: this.label(k, short), members: [...k.members], size: k.members.length, score: this.containScore(k), result: K.result[id] || null, bot: this.isBotPair(k) }; }).filter(Boolean) };
  }
  // open: the crash, the reveal or the final, when the mark (and with it the kind) may be shown.
  pairRow(k, short = this.shortNames(), open = ['crash', 'reveal', 'final'].includes(this.phase)) {
    const by = k.by && this.players.get(k.by);
    const r = { id: k.id, name: this.label(k, short), members: [...k.members], size: k.members.length, solo: k.members.length === 1, bot: this.isBotPair(k), state: k.st || 'wait', got: k.got, lost: k.st === 'caught' ? k.lost || 0 : 0, by: by ? short(by) : null, total: k.total, mode: k.mode, closed: !!k.closed, hero: k.hero || 0 };
    if (open) Object.assign(r, { mark: k.mark, rel: k.rel, base: k.base, bonus: k.bonus * (k.mode === 'bold' ? RULES.BOLD_X : 1), kept: k.kept, n: { ...k.n }, sync: !!(k.sync && k.st === 'banked'), syncX: k.syncX || 0, restored: !!k.restored, backupNow: !!k.backupNow });
    return r;
  }
  // One line per team for the playtest log (no names, no tokens): which messages are too easy?
  writeLog(m, st, teams) {
    const fa = RULES.flagAt(m, st.lineMs), at = new Date().toISOString();
    this.log(teams.map((k) => ({ at, pin: this.pin, practice: this.practice, act: this.practice ? 0 : m.act, index: this.index, id: m.id, kind: m.kind, tell: m.tell || null, difficulty: m.difficulty || null,
      team: k.id, size: k.members.length, bot: this.isBotPair(k), mark: k.mark, choice: k.mode, releaseMs: k.rel, flagMs: fa, springMs: m.kind !== 'real' ? RULES.endAt(m, st.lineMs) : null, endMs: RULES.endAt(m, st.lineMs), lineMs: st.lineMs, got: k.got, sync: !!k.sync, closed: !!k.closed })));
  }
  isBotPair(k) { return k.members.every((id) => { const q = this.players.get(id); return q && q.bot; }); }
  // TOP 3 by revenue for the TV's side panel: a snapshot taken at each reveal, frozen while messages play.
  snapTop3() {
    const short = this.shortNames();
    this.top3 = [...this.pairs.values()].sort((a, b) => b.total - a.total || Number(a.id.slice(1)) - Number(b.id.slice(1))).slice(0, 3)
      .map((k) => ({ id: k.id, name: this.label(k, short), members: [...k.members], total: k.total }));
  }
  toReveal() {
    if (this.phase !== 'crash') return;
    this.clearTimers();
    const m = this.message, short = this.shortNames();
    // RESTORE FROM BACKUP: a full backup bar reopens a closed company, once, now (the reveal), never during play.
    const restoredNow = [];
    if (!this.practice) for (const k of this.pairs.values()) if (k.closed && !k.restored && (k.backup || 0) >= RULES.BACKUP.need) { k.restored = { index: this.index, act: k.closed.act }; k.closed = null; restoredNow.push(k.id); }
    const results = [...this.pairs.values()].map((k) => this.pairRow(k, short)).sort((a, b) => b.got - a.got || b.total - a.total);
    const st = this.stakes;
    // The release strip: when each team let go, against the red flag and the spring (game ms from the start).
    if (!this.practice) this.snapTop3();
    if (this.closingAct()) this.snapMarket();
    this.contain = null;
    this.reveal = { open: this.closingAct() ? { n: [...this.pairs.values()].filter((k) => !k.closed).length, of: this.pairs.size, closedNow: [...this.pairs.values()].filter((k) => k.closed && k.closed.index === this.index).map((k) => k.id), restoredNow } : null, act: this.practice ? null : this.actOf(), flagMs: RULES.flagAt(m, st.lineMs), endMs: RULES.endAt(m, st.lineMs), lineMs: st.lineMs, kind: m.kind === 'real' ? 'real' : 'scam', practice: this.practice, mult: st.mult, sender: m.sender, channel: m.channel, disguise: m.disguise, persona: m.kind === 'real' ? null : m.persona, action: m.action, consequence: m.consequence || null, lines: m.lines, flagLine: m.flagLine, teach: m.teach || '', view: { ...viewOf(m), urlFlag: !!m.urlFlag }, results };
    this.setPhase('reveal', this.ms(RULES.REVEAL_MS), () => this.afterReveal());
    this.sendYou();
  }
  toFinal() {
    this.clearTimers();
    const short = this.shortNames();
    const rows = rankRows([...this.pairs.values()].map((k) => {
      const r = this.pairRow(k, short, true);
      for (const f of ['state', 'got', 'by', 'mark', 'rel', 'base', 'bonus', 'kept', 'lost', 'mode']) delete r[f];
      return { ...r, closed: k.closed ? { seq: k.closed.seq, act: k.closed.act } : null, closedAct: k.closed ? k.closed.act : null, contained: k.contained || 0,
        uptime: this.playMs ? Math.round((100 * (k.upMs || 0)) / this.playMs) : 0, breaches: k.n.taps, spotted: k.n.spotted, quiz: k.n.quiz || 0, restored: !!k.restored, hero: k.hero || 0 };
    }));
    this.snapMarket();
    this.final = { rows, scams: this.scamsPlayed, awards: RULES_AWARDS(rows), open: rows.filter((r) => !r.closed).length };
    this.play = null; this.result = null; this.reveal = null; this.practice = false; this.card = null;
    for (const k of this.pairs.values()) this.resetTeam(k);
    this.setPhase('final', 0);
    this.sendYou();
  }
  // Host SKIP: end the current phase now.
  skip() {
    this.resumeFn = null; // SKIP moves on now, even from a held (paused) step
    if (this.phase === 'walk') { this.clearTimers(); return this.toPractice(); } // the whole walkthrough
    if (this.phase === 'stage') return this.endCard();
    if (this.phase === 'ready') return this.startMessage();
    if (this.phase === 'play') return this.resolve();
    if (this.phase === 'crash') return this.contain && this.contain.step === 'ready' ? this.startContainMash() : this.contain && this.contain.step === 'mash' ? this.endContain() : this.toReveal();
    if (this.phase === 'reveal') return this.afterReveal();
    if (this.phase === 'ransom') return this.ransomSkip();
    if (this.phase === 'hot') return this.hotSkip();
    if (this.phase === 'quiz') return this.quizSkip();
    return undefined;
  }
  // NEW MATCH: same PIN and people (and their pairs: they still sit together), bots out, back to the lobby.
  again() {
    this.clearTimers();
    this.paused = false; this.resumeFn = null;
    for (const p of [...this.players.values()]) if (p.bot || !p.connected) { this.leavePair(p); this.players.delete(p.id); }
    for (const k of [...this.pairs.values()]) { k.members = k.members.filter((id) => this.players.has(id)); if (k.members.length < 2) this.breakPair(k); else { k.total = 0; this.resetTeam(k); } }
    this.index = 0; this.play = null; this.result = null; this.reveal = null; this.final = null; this.practice = false; this.walk = null; this.card = null; this.ransom = null; this.top3 = null; this.contain = null; this.market = null; this.quiz = null; this.hot = null;
    for (const k of this.pairs.values()) { k.closed = null; k.backup = 0; k.restored = null; }
    this.setPhase('lobby', 0);
    this.sendYou();
  }
  command(cmd) {
    switch (cmd) {
      case 'start': return this.start();
      case 'skip': return this.skip();
      case 'ransom': return this.ransomNow('hot');
      case 'duel': return this.ransomNow('duel');
      case 'again': return this.phase === 'lobby' ? undefined : this.again();
      case 'reset': this.again(); return this.kickPlayers();
      case 'pause': return this.togglePause();
      case 'end': return this.endMatch();
      default: return undefined;
    }
  }
  dispose() { this.clearTimers(); }

  // ---- what each client sees -------------------------------------------------
  shortNames() {
    const firsts = new Map();
    // A name the player typed is used whole (it is already 2-12 characters); a random one by its first word, whole if two share it.
    for (const p of this.players.values()) { const f = p.name.split(' ')[0].toLowerCase(); firsts.set(f, (firsts.get(f) || 0) + 1); }
    return (p) => { if (p.custom) return p.name; const f = p.name.split(' ')[0]; return firsts.get(f.toLowerCase()) > 1 ? p.name : f; };
  }
  // Security review 18 Nov #1: while a message plays, its end is the spring time for a scam and a fixed formula for a real
  // one, so sending it gave the answer (and the exact moment) to anyone reading the socket. No page needs it then.
  publicEndsAt() { return this.phase === 'play' ? 0 : this.phaseEndsAt; }
  inMatch() { return ['walk', 'ready', 'play', 'crash', 'reveal', 'stage', 'ransom', 'quiz', 'hot'].includes(this.phase); }
  keysDown(k) { return k.members.filter((id) => { const q = this.players.get(id); return q && (q.bot || (q.connected && q.down)); }).length; }
  publicState(now = Date.now()) {
    const short = this.shortNames();
    const s = {
      phase: this.phase, paused: !!this.paused, held: !!this.resumeFn, pin: this.pin, index: this.index, count: this.messages.length, now, phaseEndsAt: this.publicEndsAt(), scale: this.scale,
      players: [...this.players.values()].map((p) => {
        const k = this.pairOf(p);
        return { id: p.id, name: p.name, av: p.av, short: short(p), bot: p.bot, connected: p.connected, down: !!p.down, pairId: k ? k.id : null, total: k ? k.total : 0 };
      }),
      pairs: [...this.pairs.values()].map((k) => ({ ...this.pairRow(k, short), label: this.label(k, short), keysIn: this.keysIn(k), keys: this.keysDown(k), walkPot: this.phase === 'walk' ? this.walkPotNow(k, now) : 0, arm: k.arm, connected: k.members.some((id) => { const q = this.players.get(id); return q && !q.bot && q.connected; }), ...this.pickView(k) })),
    };
    // 17 Nov (Angelo): no live tells. While a message plays, the TV state says nothing about who let go: a team that
    // locked in still looks like it is holding (state, keys, thumbs), no amounts, and the pot carries no share bumps.
    // Everything shows at the spring (crash) and the reveal. Phones only ever get their own team (you()).
    if (this.phase === 'play') {
      const hid = new Set();
      for (const r of s.pairs) if (r.state === 'banked') { hid.add(r.id); Object.assign(r, { state: 'hold', got: 0, by: null, keysIn: true, keys: r.size, arm: r.arm ? { ...r.arm, bonus: 0 } : r.arm }); }
      for (const r of s.pairs) if (r.arm) r.arm = { ...r.arm, bonus: 0 };
      for (const q of s.players) if (q.pairId && hid.has(q.pairId)) q.down = true;
    }
    if (this.inMatch() && this.top3) s.top3 = this.top3;
    if (this.inMatch()) { s.practice = this.practice; s.mult = this.stakes.mult; s.speed = this.stakes.speed; s.allIn = this.stakes.final; s.lineMs = this.stakes.lineMs; if (!this.practice) s.act = this.actOf(); }
    if (this.phase === 'walk') s.walk = { step: this.walk.step, steps: RULES.WALK_STEPS, allIn: this.walk.allIn, rate: RULES.WALK_RATE };
    if (this.phase === 'stage') s.stage = this.cardView();
    if ((this.phase === 'play' || this.phase === 'crash') && this.play) {
      const m = this.message, shown = this.linesShown(now);
      // The message builds line by line for the whole room. The kind and the red flag wait for the reveal.
      s.message = { sender: m.sender, channel: m.channel, disguise: m.disguise, action: m.action, lines: m.lines.slice(0, shown), total: m.lines.length, view: viewOf(m) };
      // The disguise is the sender's friendly face, the same for real and fake; the persona (and the kind) waits for the reveal.
      // Practice only: coaching once the red-flag line has landed ("THAT'S A RED FLAG, LET GO!").
      if (this.practice && shown > m.flagLine) s.message.hint = m.flagLine;
      s.play = this.phase === 'play' ? { startAt: this.play.startAt, bonus: 0, holding: [...this.pairs.values()].filter((k) => k.st === 'hold' || k.st === 'banked').length }
        : { startAt: this.play.startAt, bonus: this.play.bonus, holding: [...this.pairs.values()].filter((k) => k.st === 'hold').length };
    }
    if (this.phase === 'crash') s.result = this.result;
    if (this.phase === 'crash' && this.contain) s.contain = this.containView();
    // The skyline: from a closing act's card to the end, a snapshot (never live during play).
    const cardCloses = this.phase === 'stage' && this.card && this.card.kind === 'act' && this.card.closes;
    if (this.market && (this.phase === 'final' || cardCloses || (this.inMatch() && this.phase !== 'stage' && this.closingAct()) || (this.phase === 'stage' && this.card && this.card.kind === 'final' && this.closingAct(this.card.next)))) s.market = this.market;
    if (this.phase === 'reveal') s.reveal = this.reveal;
    if (this.phase === 'final') s.final = this.final;
    if (this.phase === 'ransom' && this.ransom) s.ransom = this.ransomView();
    if (this.phase === 'hot' && this.hot) s.hot = this.hotView();
    if (this.phase === 'quiz' && this.quiz) { s.quiz = this.quizView(); if (this.closingAct() && this.market) s.market = this.market; }
    return s;
  }
  // The duel as everyone sees it (the big screen, and inside each phone's view): who, the step, live scores, the result.
  ransomView() {
    const R = this.ransom, L = this.pairs.get(R.locked), V = R.rival && this.pairs.get(R.rival), short = this.shortNames();
    const side = (k) => k && { id: k.id, label: this.label(k, short), members: [...k.members], size: k.members.length, total: k.total, score: R.step === 'mash' || R.step === 'result' ? this.mashScore(k) : 0, bot: this.isBotPair(k) };
    return { step: R.step, why: R.why, breaches: R.breaches, persona: ((RULES.ACTS[(R.act || 1) - 1] || RULES.ACTS[0]).persona) || 'phisher', duel: R.duel, max: R.max, act: R.act, key: RULES.RANSOM.key, cut: RULES.RANSOM.cut, startAt: R.startAt, mashMs: this.ms(RULES.RANSOM.mashMs), locked: side(L), rival: side(V), result: R.result };
  }
  // The act card for clients (no bot picks: those are inside each team's view).
  cardView() { const c = this.card; const { next, ...v } = c; return { ...v, index: next }; }
  // A team's SAFE/BOLD as the room sees it: while the card is open, 'choosing' until every member has picked (then the
  // pick it adds up to); after it, the act's mode.
  pickView(k) {
    const c = this.card;
    if (this.phase === 'stage' && c && c.kind === 'act' && c.choice && !c.locked) return { pick: this.decided(k) ? this.modeOf(k) : 'choosing', picked: k.members.filter((id) => k.picks[id]).length };
    return { pick: k.mode };
  }
  // A phone's view: its own thumb, its partners' thumbs (live), the team's pot. Never the message text.
  you(p, now = Date.now()) {
    const k = this.pairOf(p), short = this.shortNames();
    const y = { away: this.phase === 'play' && !!this.play && p.awayPlay === this.play, phase: this.phase, index: this.index, count: this.messages.length, practice: this.practice, mult: this.stakes.mult, speed: this.stakes.speed, id: p.id, name: p.name, av: p.av, named: !!p.named, state: k && k.st ? k.st : 'wait', got: k ? k.got : 0, total: k ? k.total : 0, down: !!p.down, now, phaseEndsAt: this.publicEndsAt(), scale: this.scale };
    if (k) {
      y.pair = { id: k.id, mates: k.members.filter((id) => id !== p.id).map((id) => this.players.get(id).name), avs: k.members.filter((id) => id !== p.id).map((id) => this.players.get(id).av), label: this.label(k, short), size: k.members.length };
      const choosing = this.phase === 'stage' && this.card && this.card.kind === 'act' && this.card.choice;
      y.mates = k.members.filter((id) => id !== p.id).map((id) => this.players.get(id)).map((q) => ({ name: q.name, av: q.av, down: !!q.down, connected: !!q.connected, away: this.phase === 'play' && !!this.play && q.awayPlay === this.play, ...(choosing ? { pick: k.picks[q.id] || null } : {}) }));
      y.mode = k.mode;
      if (choosing) { y.pick = k.picks[p.id] || null; y.teamPick = this.pickView(k).pick; }
      y.solo = k.members.length === 1;
      y.keysIn = this.keysIn(k);
      if (k.by) { const b = this.players.get(k.by); y.by = b ? b.name : null; y.byMe = k.by === p.id; }
    }
    // Your code, for a neighbour to type: only on your own phone, only while your team has room.
    if ((!k || k.members.length < RULES.MAX_TEAM) && this.phase !== 'play' && this.phase !== 'crash') y.code = p.code;
    if ((this.phase === 'play' || this.phase === 'crash') && this.play) {
      y.action = this.message.action; // the button your thumb is on: the ring's label
      // The share bump other teams' releases add to the pot stays hidden until the spring (it would tell you someone let go).
      if (this.phase === 'play') y.play = { startAt: this.play.startAt, bonus: 0, arm: k && k.arm ? { ...k.arm, bonus: 0 } : null, speed: this.stakes.speed };
    }
    if (!this.practice && this.inMatch() && this.messages[this.index]) y.act = this.actOf();
    // The mark and the bonus only once the kind is public (crash, reveal): never during play.
    if ((this.phase === 'crash' || this.phase === 'reveal') && k) Object.assign(y, { mark: k.mark, base: k.base, bonus: k.bonus * (k.mode === 'bold' ? RULES.BOLD_X : 1), kept: k.kept, bold: k.mode === 'bold' });
    if (this.phase === 'crash' && this.result) {
      y.outcome = this.result.kind;
      if (y.state === 'caught') { y.lost = k.lost; y.consequence = this.result.consequence; y.persona = this.message.persona; }
    }
    if (this.phase === 'reveal' && k && k.st === 'caught') y.lost = k.lost || 0;
    // At the reveal (public on the big screen) the phone may name who was under the mask. Never the text, kind or flag.
    if (this.phase === 'reveal' && this.reveal && this.reveal.persona) y.persona = this.reveal.persona;
    if (this.phase === 'walk') y.walk = { step: this.walk.step, steps: RULES.WALK_STEPS, pot: k ? k.walkPot || 0 : 0, since: k ? k.walkSince : null, rate: RULES.WALK_RATE, base: k ? this.walkPotNow(k, now) : 0 };
    if (this.phase === 'stage') y.stage = this.cardView();
    if (this.phase === 'ransom' && this.ransom) {
      const R = this.ransom, v = this.ransomView();
      y.ransom = { ...v, role: k && k.id === R.locked ? 'locked' : k && k.id === R.rival ? 'rival' : 'watch', mine: R.taps[p.id] || 0 };
    }
    if (this.phase === 'ready') {
      const teams = [...this.pairs.values()].filter((q) => !this.isBotPair(q));
      y.ready = { down: teams.filter((q) => this.keysIn(q)).length, of: teams.length };
    }
    if (k) y.closed = k.closed ? { act: k.closed.act } : null;
    if (k && k.closed && !k.restored) y.backup = { have: Math.min(k.backup || 0, RULES.BACKUP.need), need: RULES.BACKUP.need, now: !!k.backupNow && ['crash', 'reveal'].includes(this.phase) };
    if (k && k.restored) y.restored = { act: k.restored.act, now: k.restored.index === this.index && this.phase === 'reveal' };
    if (k && k.sync && ['play', 'crash', 'reveal'].includes(this.phase) && ['banked', 'hold'].includes(k.st)) y.sync = { x: RULES.SYNC.x, extra: k.syncX || 0 }; // your own team only
    if (this.phase === 'quiz' && this.quiz && k) y.quiz = this.quizYou(p, k);
    if (this.phase === 'hot' && this.hot) y.hot = this.hotYou(p, k);
    if (this.phase === 'crash' && this.contain && k) {
      const K = this.contain, mine = K.teams.includes(k.id);
      y.contain = { step: K.step, readyAt: K.readyAt, startAt: K.startAt, ms: K.ms, need: RULES.CONTAIN.need, role: mine ? 'contain' : 'watch', mine: K.taps[p.id] || 0, score: mine ? this.containScore(k) : 0, result: mine ? K.result[k.id] || null : null, count: K.teams.length };
    }
    if (this.phase === 'final' && this.final && k) {
      const F = this.final, r = F.rows.find((x) => x.id === k.id), aw = F.awards;
      y.rank = r ? r.rank : null; y.of = F.rows.length; y.scams = F.scams;
      if (r) {
        Object.assign(y, { n: r.n, awards: [aw.lbs === k.id && 'lbs', aw.revenue === k.id && 'revenue', aw.firewall === k.id && 'firewall'].filter(Boolean) });
        y.report = { label: r.name, members: r.members, rank: r.rank, of: F.rows.length, open: F.open, closedAct: r.closedAct, total: r.total, uptime: r.uptime, breaches: r.breaches, spotted: r.spotted, scams: F.scams, contained: r.contained, quiz: r.quiz, quizzes: this.quizUsed.size, restored: r.restored, hero: r.hero || 0 };
      }
    }
    return y;
  }
  // Security review 18 Nov #4: mid-match, a phone that left and never played (no team, or a SOLO team that has played
  // nothing) gives its seat back after GONE_SEAT_MS, so throwaway joins can't keep the game full.
  freeGoneSeats(now = Date.now()) {
    let freed = false;
    for (const p of [...this.players.values()]) {
      if (p.bot || p.connected || !p.goneAt || now - p.goneAt < this.ms(RULES.GONE_SEAT_MS)) continue;
      const k = this.pairOf(p);
      if (k && (k.members.length > 1 || k.n.played > 0 || k.total || k.st === 'hold' || (this.ransom && [this.ransom.locked, this.ransom.rival].includes(k.id)))) continue;
      if (k) this.pairs.delete(k.id);
      this.players.delete(p.id);
      freed = true;
    }
    if (freed) this.dirty = true;
  }
  sendTeam(k) { if (!k) return; for (const id of k.members) { const ws = this.sockByPlayer.get(id), q = this.players.get(id); if (ws && q) send(ws, { t: 'you', you: this.you(q) }); } }
  sendYou() { for (const [id, ws] of this.sockByPlayer) { const p = this.players.get(id); if (p) send(ws, { t: 'you', you: this.you(p) }); } this.dirty = true; }
  event(ev) { for (const ws of this.screens) send(ws, { t: 'event', event: ev }); }
  // Called by the hub at 10 Hz: screens get the state; phones a steady heartbeat of their own.
  tick(n) {
    if (n % 10 === 0 && this.inMatch()) this.freeGoneSeats();
    const st = JSON.stringify({ t: 'state', state: this.publicState() }); // once, not once per screen
    for (const ws of this.screens) send(ws, st);
    if (this.dirty || n % 3 === 0) { for (const [id, ws] of this.sockByPlayer) { const p = this.players.get(id); if (p) send(ws, { t: 'you', you: this.you(p) }); } }
    this.dirty = false;
  }
}

module.exports = { HoldRoom, PHASES, send, awards: RULES_AWARDS, rankRows };
