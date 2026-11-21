'use strict';

// HOLD: the party game. Drives a real server over real
// sockets on a fast clock: phones join by PIN and pair by code (even; odd = a trio; unpaired = SOLO,
// no bot partners); 3 messages (test/fixtures/hold-3.json) on the server's clock. TWO KEYS: a team's
// pot grows only while all its members hold, one release banks it for all, the spring catches only
// fully-holding teams; the message is on the big screen, never on a phone. Host commands, pages.
//   node test/hold.js

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const HOLD = require('../server/hold/rules');
const holdContent = require('../server/hold/content');

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log((ok ? '  ok  : ' : '  FAIL: ') + name + (detail ? '  :: ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'hold-3.json');
const SCALE = 0.25;

function client(port, p = '/hold/ws') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`);
  const c = { ws, frames: [], raw: '', last: {},
    send: (o) => ws.send(JSON.stringify(o)),
    close: () => ws.close(),
    // Waits for a frame of type t (and matching pred) after the last one waited for.
    async wait(t, pred = () => true, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (let i = c.mark || 0; i < c.frames.length; i++) { const f = c.frames[i]; if (f.t === t && pred(f)) { c.mark = i + 1; return f; } }
        await sleep(5);
      }
      return null;
    } };
  ws.on('message', (r) => { const s = r.toString(); const m = JSON.parse(s); c.raw += s + '\n'; c.frames.push(m); c.last[m.t] = m; if (m.t === 'ping') c.send({ t: 'pong' }); });
  return new Promise((res, rej) => { ws.on('open', () => res(c)); ws.on('error', rej); });
}

async function boot(port, extraEnv = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-hold-test-'));
  const srv = spawn('node', ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), BIND: '127.0.0.1', HOLD_SCALE: String(SCALE), HOLD_MESSAGES: FIXTURE, HOLD_INCIDENTS: 'off', STATE_DIR: stateDir, ...extraEnv }, stdio: ['ignore', 'ignore', 'inherit'] });
  srv.on('exit', () => fs.rmSync(stateDir, { recursive: true, force: true }));
  srv.stateDir = stateDir;
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); return srv; } catch { await sleep(50); } }
  throw new Error('server did not start');
}

// A real (non-practice) phase, optionally at a message index.
const phaseIs = (ph, idx) => (f) => f.state.phase === ph && !f.state.practice && (idx === undefined || f.state.index === idx);
// Host SKIP through the walkthrough and the practice round, to message 1's ready.
async function pastIntro(screen, host) {
  if (screen.last.state.state.phase === 'lobby') await screen.wait('state', (f) => f.state.phase !== 'lobby');
  const sig = (s) => s.phase + ':' + (s.walk ? s.walk.step : '') + ':' + !!s.practice;
  for (let i = 0; i < 12; i++) {
    const s = screen.last.state.state;
    if (s.phase === 'ready' && !s.practice) return true;
    const was = sig(s);
    host('skip');
    await screen.wait('state', (f) => sig(f.state) !== was, 3000);
  }
  return false;
}

// ---------------------------------------------------------------------------
console.log('Rules and content (pure)');
{
  check('pot grows with time and faster later', HOLD.potAt(0) === 0 && HOLD.potAt(1) === 800 && HOLD.potAt(2) - HOLD.potAt(1) > HOLD.potAt(1));
  check('each release bumps the holders more', HOLD.share(1) === 1400 && HOLD.share(2) === 2000 && HOLD.share(3) === 2600);
  const pack = holdContent.load(FIXTURE);
  check('the 3-message fixture loads', pack.length === 3 && pack[0].kind === 'scam' && pack[1].kind === 'real');
  const full = holdContent.load(path.join(ROOT, 'data', 'hold-messages.json'));
  check('the shipped pack loads (18 messages, both kinds)', full.length === 18 && full.some((m) => m.kind === 'real') && full.some((m) => m.kind === 'scam'));
  const bad = (m) => { try { holdContent.validate([m]); return false; } catch { return true; } };
  const ok = { id: 'x', kind: 'scam', sender: 'S', channel: 'sms', lines: ['a', 'b', 'c'], flagLine: 1, springLine: 2, action: 'OPEN LINK', consequence: 'PASSWORD STOLEN' };
  check('a valid message passes', !bad(ok));
  check('scam without a spring line is refused', bad({ ...ok, springLine: null }));
  check('spring before the flag is refused', bad({ ...ok, flagLine: 2, springLine: 1 }));
  check('real with a spring line is refused', bad({ ...ok, kind: 'real', flagLine: null }));
  check('unknown channel is refused', bad({ ...ok, channel: 'fax' }));
  check('a message without its action button is refused', bad({ ...ok, action: '' }) && bad({ ...ok, action: undefined }));
  check('a scam without a consequence is refused', bad({ ...ok, consequence: null }));
  check('a real message may have no consequence', !bad({ ...ok, kind: 'real', flagLine: null, springLine: null, consequence: null }));
  check('every shipped message has an action, every scam a consequence', full.every((m) => m.action && (m.kind === 'real' || m.consequence)));
  check('a new line every 1.8 s, so a room can read it on the big screen', HOLD.LINE_MS === 1800);
  // FORMATS (18 Nov): phone takeover and web page rounds, same hold rule.
  const ph = { ...ok, format: 'phone', lines: ['Messages | 082 000 1111 | hi', 'Messages | Bank | your OTP is 1', 'Messages | 082 000 1111 | send it'], flagLine: 2, springLine: 2 };
  const wb = { ...ok, format: 'web', brand: 'Site', lines: ['site.co.za/x', '# Heading', '> Password', '! Go'], flagLine: 2, springLine: 2 };
  check('formats: phone and web messages pass', !bad(ph) && !bad(wb) && !bad({ ...wb, urlFlag: true, tab: 'T' }) && !bad({ ...ph, time: '02:14', date: 'TUE' }));
  check('formats: an unknown format is refused', bad({ ...ok, format: 'voice' }));
  check('formats: a phone line must be "App | Title | Body"', bad({ ...ph, lines: ['no pipes here', 'a | b'] }));
  check('formats: a web page starts with an address and needs a brand', bad({ ...wb, lines: ['not an address', '# h', '! go'] }) && bad({ ...wb, brand: undefined }));
  check('formats: brand/urlFlag only on web pages', bad({ ...ok, brand: 'X' }) && bad({ ...ph, urlFlag: true }));
  const vw = holdContent.view({ ...wb, urlFlag: true });
  check('formats: the TV view carries the look only (no kind, flag or teach)', vw.format === 'web' && vw.brand === 'Site' && !('kind' in vw) && !('flagLine' in vw) && !('urlFlag' in vw) && !('teach' in vw));
  check('formats: a phone round is a FAST ROUND (lines 0.7x the act pace)', HOLD.stage(0, 24, 2, ph).lineMs === Math.round(1800 * HOLD.PHONE_LINE_X) && HOLD.stage(0, 24, 2, wb).lineMs === 1800 && HOLD.PHONE_LINE_X === 0.7);
  {
    const sp = holdContent.loadPack(path.join(ROOT, 'data', 'hold-messages.json')).messages, fm = (m) => m.format || 'text';
    const nt = sp.filter((m) => fm(m) !== 'text');
    check('formats: the shipped pack has 4-6 phone/web rounds', nt.length >= 4 && nt.length <= 6, String(nt.length));
    check('formats: phone and web are each used by a scam and a real message', ['phone', 'web'].every((f) => ['scam', 'real'].every((k) => sp.some((m) => fm(m) === f && m.kind === k))));
    check('formats: never the same non-text format twice in a row', sp.every((m, i) => i === 0 || fm(m) === 'text' || fm(m) !== fm(sp[i - 1])));
  }
  check('the shipped pack is South African: Rand, no pounds', full.every((m) => !/£|HMRC|\+44/.test([m.sender, ...m.lines, m.teach || ''].join(' '))) && full.some((m) => /R\d/.test(m.lines.join(' '))));
  // INTRO + STAKES (15 Nov, Angelo after playing TWO KEYS): walkthrough, practice, raising stakes.
  // ACTS (16 Nov): stakes per act (x1, x2, x3), the last message ALL IN x5; act 3 builds faster.
  const shippedActs = holdContent.loadPack(path.join(ROOT, 'data', 'hold-messages.json')).messages;
  const mults = (ms) => ms.map((m, i) => HOLD.stage(i, ms.length, m.act).mult);
  const split = holdContent.withActs([...Array(12).keys()].map((i) => ({ id: 'm' + i })));
  check('a pack without acts is split in three, in order', split.map((m) => m.act).join('') === '111122223333', split.map((m) => m.act).join(''));
  check('the shipped pack: three acts of 6', shippedActs.map((m) => m.act).join('') === '1'.repeat(6) + '2'.repeat(6) + '3'.repeat(6), shippedActs.map((m) => m.act).join(''));
  check('stakes on the shipped pack: act 1 x1, act 2 x2, act 3 x3, the last ALL IN x5', JSON.stringify(mults(shippedActs)) === JSON.stringify([...Array(6).fill(1), ...Array(6).fill(2), ...Array(5).fill(3), 5]), JSON.stringify(mults(shippedActs)));
  check('only the last message is the final stage', shippedActs.map((m, i) => HOLD.stage(i, 18, m.act).final).filter(Boolean).length === 1 && HOLD.stage(17, 18, 3).final);
  // 17 Nov, harder: 1.1-3 s from the red flag to the spring (it was 2.6-6.2 s), never before the line that asks you to act,
  // and no scam springs on its last line (finishing is not a tell).
  const gaps = shippedActs.filter((m) => m.kind !== 'real').map((m) => { const st = HOLD.stage(shippedActs.indexOf(m), 18, m.act, m); return { m, g: HOLD.endAt(m, st.lineMs) - HOLD.flagAt(m, st.lineMs), end: HOLD.endAt(m, st.lineMs), ask: m.springLine * st.lineMs, last: (m.lines.length - 1) * st.lineMs }; });
  check('every shipped scam springs 1.1-3 s after its red flag', gaps.every((x) => x.g >= 1100 && x.g <= 3000), JSON.stringify(gaps.map((x) => [x.m.id, x.g])));
  check('... never before its ask line lands', gaps.every((x) => x.end > x.ask));
  check('... and most scams spring before their last line', gaps.filter((x) => x.end < x.last).length >= 8, String(gaps.filter((x) => x.end < x.last).length));
  { // 17 Nov: bot pairs (adjacent tempers, as the room seats them) fall for roughly a third of the shipped scams.
    const { TEMPERS, planRelease } = require('../server/hold/bots');
    let c = 0, n = 0;
    for (let t = 0; t < 2000; t++) shippedActs.forEach((m, i) => { if (m.kind === 'real') return; const st = HOLD.stage(i, 18, m.act, m); const j = t % 5;
      const rel = Math.min(planRelease(TEMPERS[j], m, Math.random, st.lineMs), planRelease(TEMPERS[(j + 1) % 5], m, Math.random, st.lineMs));
      n++; if (rel * 1000 >= HOLD.endAt(m, st.lineMs)) c++; });
    check('bot pairs get caught by 20-40% of scams', c / n >= 0.2 && c / n <= 0.4, (100 * c / n).toFixed(0) + '%');
  }
  check('stakes on the 3-message fixture (acts 1, 2, 3): x1, x2, x5', JSON.stringify(mults(holdContent.load(FIXTURE))) === JSON.stringify([1, 2, 5]));
  check('the pot grows faster each act', [1, 2, 3].map((a) => HOLD.stage(0, 12, a).speed).every((v, i, a) => i === 0 || v > a[i - 1]) && HOLD.stage(11, 12, 3).speed > HOLD.stage(0, 12, 3).speed);
  check('act 3 builds its lines faster (1.4 s)', HOLD.stage(8, 12, 3).lineMs === 1400 && HOLD.stage(0, 12, 1).lineMs === 1800 && HOLD.ACTS[2].lineMs < HOLD.ACTS[0].lineMs);
  check('acts 2 and 3 ask SAFE or BOLD, act 1 does not', !HOLD.ACTS[0].choice && HOLD.ACTS[1].choice && HOLD.ACTS[2].choice && HOLD.CHOICE_MS === 10000 && HOLD.ACT_CARD_MS === 15000);
  check('the red flag lands at its line on the act clock', HOLD.flagAt(pack[0]) === 3 * 1800 && HOLD.flagAt(pack[0], 1400) === 3 * 1400 && HOLD.flagAt(pack[1]) === null);
  check('spotted pays +50%, SAFE keeps half, BOLD doubles', HOLD.SPOT_BONUS === 0.5 && HOLD.SAFE_KEEP === 0.5 && HOLD.BOLD_X === 2);
  const mixed = [{ ...holdContent.load(FIXTURE)[0], act: 1 }, { ...holdContent.load(FIXTURE)[1], act: undefined }];
  let threw = false; try { holdContent.withActs(mixed); } catch { threw = true; }
  check('a pack with acts on some messages only is refused', threw);
  check('an act must be 1, 2 or 3', (() => { try { holdContent.validate([{ ...holdContent.load(FIXTURE)[0], act: 4 }]); return false; } catch { return true; } })());
  const sorted = holdContent.withActs([{ ...pack[0], id: 'a', act: 2 }, { ...pack[1], id: 'b', act: 1 }, { ...pack[2], id: 'c', act: 1 }]);
  check('messages play act by act, pack order within an act', sorted.map((m) => m.id).join('') === 'bca');
  check('the walkthrough is about 40 s: card A up to 20 s, then two cards', HOLD.WALK_A_MS === 20000 && HOLD.WALK_A_MS + 2 * HOLD.WALK_CARD_MS >= 30000 && HOLD.WALK_A_MS + 2 * HOLD.WALK_CARD_MS <= 45000);
  check('stage cards last 3 s', HOLD.STAGE_MS === 3000);
  const shipped = holdContent.loadPack(path.join(ROOT, 'data', 'hold-messages.json'));
  check('the shipped pack has one practice message (kind practice), kept out of the 18', shipped.practice && shipped.practice.kind === 'practice' && shipped.messages.length === 18 && !shipped.messages.some((m) => m.kind === 'practice'));
  check('a pack without one reuses the easiest scam for practice', holdContent.loadPack(FIXTURE).practice.id === 'bank-alert');
  check('a practice message needs a red flag and a spring like a scam', !bad({ ...ok, kind: 'practice' }) && bad({ ...ok, kind: 'practice', flagLine: null }));
  check('a scam springs after its spring line lands', HOLD.endAt(pack[0]) === 4 * HOLD.LINE_MS + HOLD.SPRING_AFTER_MS);
  check('a real message ends after its last line', HOLD.endAt(pack[1]) === 4 * HOLD.LINE_MS + HOLD.REAL_END_AFTER_MS);
}

// The three awards (pure, 18 Nov): LAST BUSINESS STANDING, TOP REVENUE, HUMAN FIREWALL; ties.
{
  const { awards, rankRows } = require('../server/hold/room');
  const row = (id, spotted, taps, total, played = 3) => ({ id, total, closed: null, bot: false, n: { spotted, taps, early: 0, trusted: 0, played } });
  const a = awards(rankRows([row('a', 2, 1, 900), row('b', 2, 0, 100), row('c', 1, 0, 5000)]));
  check('HUMAN FIREWALL tie on spotted: fewer taps wins', a.firewall === 'b');
  check('TOP REVENUE is the most money; all open: LAST BUSINESS STANDING is the richest', a.revenue === 'c' && a.lbs === 'c');
  const t = awards(rankRows([row('a', 2, 1, 900), row('b', 2, 1, 1000)]));
  check('tie on spotted and taps: more money wins', t.firewall === 'b');
  const none = awards(rankRows([row('a', 0, 2, 0), row('b', 0, 1, 0)]));
  check('nobody spotted, nobody banked: no firewall, no top revenue (someone still stands last)', none.firewall === null && none.revenue === null && !!none.lbs);
}

// 19 Nov QA: phone drops, host PAUSE and END MATCH (in-process).
{
  const { HoldRoom } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant'] };
  const msgs = holdContent.withActs(holdContent.load(FIXTURE));
  const mk = () => new HoldRoom({ pin: '123456', messages: msgs, quiz: [], incidents: [], names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.5 });
  const team = (r, n) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot: false }); p.connected = true; ids.push(p.id); } return r.newPair(ids); };
  const pls = (r, k) => k.members.map((id) => r.players.get(id));
  const go = (r, i = 0) => { r.toReady(i); r.startMessage(); for (const p of r.players.values()) if (!p.bot) r.hold(p.id, true); };
  console.log('Phone drops mid-message (19 Nov QA)');
  {
    const r = mk(), a = team(r, 2), b = team(r, 2); go(r);
    const [a1, a2] = pls(r, a);
    check('both teams hold', a.st === 'hold' && b.st === 'hold');
    r.onClose({ meta: { playerId: a1.id } }); // no socket mapped: emulate the close path directly
    a1.connected = false; r.goAway(a1);
    check('a member who drops does NOT lock in for the team', a.st === 'hold' && !a.by);
    check('... and is absent for this message', r.present(a1) === false && r.present(a2) === true);
    r.hold(a1.id, true);
    check('... coming back mid-message, its thumb does not count (released for this message)', a1.down === false && a.st === 'hold');
    r.hold(a2.id, false); r.bank(a, a2, r.teamPot(a)); // the partner still here can let go
    check('the partner still here locks it in as normal', a.st === 'banked' && a.by === a2.id);
    r.dispose();
  }
  {
    const r = mk(), a = team(r, 2), b = team(r, 2); go(r);
    const [a1, a2] = pls(r, a);
    r.hold(a1.id, false, true); r.hold(a2.id, false, true); // both phones step away (app switch / screen lock)
    check('app switch is not a let-go: no bank', a.st !== 'banked');
    check('the whole team stepped away: out of this message (not holding)', a.st === 'wait');
    r.resolve();
    const x = r.pairs.get(a.id);
    check('at the spring an absent team is neither breached nor paid', x.st === 'out' && x.got === 0 && x.mark === 'out' && b.st === 'caught');
    r.skip(); go(r, 1);
    check('next message: back in, both keys count again', r.present(a1) && r.present(a2) && a.st === 'hold');
    r.dispose();
  }
  {
    const r = mk(), a = team(r, 2); r.toReady(0); r.startMessage();
    const [a1, a2] = pls(r, a); r.hold(a1.id, true);
    check('a team waits for its last key', a.st === 'wait');
    r.stale(a2.id); // the hub's heartbeat: a2 went silent without closing
    check('a silent phone is absent, so the partner here arms the pot alone', a.st === 'hold' && !r.present(a2));
    r.dispose();
  }
}
// RANSOMWARE (pure, in-process: a room with no sockets, driven by hand).
{
  const { HoldRoom } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant'] };
  const msgs = holdContent.withActs(holdContent.load(FIXTURE));
  const mk = (scale = 1) => new HoldRoom({ pin: '123456', messages: msgs, names, scale, makeToken: () => 't' + Math.random(), rand: () => 0.5 });
  const team = (r, n, total, { bot = false, lost = 0 } = {}) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot, temper: 'steady' }); p.connected = true; ids.push(p.id); } const k = r.newPair(ids); k.total = total; k.actLost = lost; k.n = { spotted: 0, early: 0, taps: 0, trusted: 0, played: 0 }; return k; };
  const C = HOLD.RANSOM;
  { const r = mk(), s1 = team(r, 1, 0), s3 = team(r, 3, 0);
    check('a solo team is "Name Ltd", a trio "A, B & C Ltd"', /^\S+ Ltd$/.test(r.label(s1)) && /^.+, .+ & .+ Ltd$/.test(r.label(s3)), r.label(s1) + ' / ' + r.label(s3)); r.dispose(); }
  check('RANSOMWARE: 8 s mash, key 75, 3 duels at most, ransom 25%, phones capped at 15 taps/s', C.mashMs === 8000 && C.key === 75 && C.maxDuels === 3 && C.cut === 0.25 && C.tapRate === 15);
  {
    const r = mk(), a = team(r, 2, 5000), b = team(r, 2, 3000, { lost: 900 }), c = team(r, 2, 1000, { lost: 900 }), d = team(r, 2, 200);
    // 19 Nov: the lock goes by breaches, not revenue.
    b.actBreaches = 1; c.actBreaches = 2; b.n.taps = 3; c.n.taps = 2;
    check('the lock goes to the team breached most this act (not the lowest revenue)', r.ransomPick() === c);
    b.actBreaches = 2; check('... a tie goes to more breaches over the whole game', r.ransomPick() === b);
    b.n.taps = 2; b.actLost = 900; c.actLost = 1500; check('... then to more lost this act', r.ransomPick() === c);
    for (const k of [a, b, c, d]) k.actBreaches = 0; a.n.taps = 4;
    check('nobody breached this act: the most breaches over the whole game', r.ransomPick() === a);
    for (const k of [a, b, c, d]) k.n.taps = 0; check('nobody ever breached: no ransomware', r.ransomPick() === null);
    c.actBreaches = 1; c.n.taps = 1; c.actLost = 900; b.actLost = 0;
    check('the rival is the nearest team above in the standings', r.rivalFor(c, [c.id]) === b && r.rivalFor(b, [b.id]) === a);
    check('the leader faces the team below; a team already in the chain is skipped', r.rivalFor(a, [a.id]) === b && r.rivalFor(c, [c.id, b.id]) === a);
    r.dispose();
  }
  {
    // Chain: d is locked; each duel the locked team wins, so the lock climbs; the cap stops it and the holder pays.
    const r = mk(), a = team(r, 2, 4000), b = team(r, 2, 3000), c = team(r, 1, 2000), d = team(r, 3, 1000, { lost: 500 });
    let done = false;
    r.toRansom(d, () => { done = true; }, 1);
    const R = r.ransom;
    check('duel 1: the locked team against the team just above it', r.phase === 'ransom' && R.step === 'card' && R.locked === d.id && R.rival === c.id && R.duel === 1);
    r.skip(); r.skip();
    check('3-2-1, then the mash', R.step === 'mash');
    // Per-member average: d is a trio (3 x 20 = 60 taps, 20 each), c is solo (25 taps): c wins 25 to 20.
    for (const id of d.members) R.taps[id] = 20; R.taps[c.members[0]] = 25;
    check('score = average taps per member (a trio is not 3x a solo)', r.mashScore(d) === 20 && r.mashScore(c) === 25);
    for (const id of d.members) R.taps[id] = 30;
    r.skip();
    check('locked wins: freed, the lock jumps to the loser', R.step === 'result' && R.result.kind === 'free' && R.result.freed === d.id && R.result.next === c.id && d.total === 1000);
    r.skip();
    check('duel 2: the new lock holder against the next team up', R.duel === 2 && R.locked === c.id && R.rival === b.id && R.step === 'card');
    r.skip(); r.skip(); R.taps[c.members[0]] = 40; r.skip();
    r.skip();
    check('duel 3: and again', R.duel === 3 && R.locked === b.id && R.rival === a.id);
    r.skip(); r.skip(); for (const id of b.members) R.taps[id] = 50; for (const id of a.members) R.taps[id] = 10; r.skip();
    check('after the 3rd duel the lock stops on the loser, who pays 25% (to R100)', R.step === 'result' && R.result.kind === 'paid' && R.result.capped && R.result.payer === a.id && R.result.amount === 1000 && a.total === 3000 && b.total === 3000);
    check('no more duels after the cap', R.history.length === 3);
    r.skip();
    check('the chain ends and the match carries on', done && r.ransom === null);
    r.dispose();
  }
  {
    // Defender wins (or a tie): the locked team pays at once.
    const r = mk(), a = team(r, 2, 2000), b = team(r, 2, 1234, { lost: 300 });
    r.toRansom(b, () => {}, 2); r.skip(); r.skip();
    for (const id of a.members) r.ransom.taps[id] = 10; for (const id of b.members) r.ransom.taps[id] = 10;
    r.skip();
    check('a tie: the lock holds and the locked team pays 25% of its bank', r.ransom.result.kind === 'paid' && r.ransom.result.payer === b.id && r.ransom.result.amount === 300 && b.total === 934 && !r.ransom.result.capped);
    r.dispose();
  }
  {
    // The rate cap: a phone may not tap faster than 15/s (a burst of 8 for batching).
    const r = mk(1), a = team(r, 2, 2000), b = team(r, 2, 100, { lost: 300 });
    r.toRansom(b, () => {}, 1); r.skip(); r.skip();
    const me = b.members[0], foe = a.members[0];
    r.tap(me, 50);
    check('a script sending 50 taps at once gets the burst only', r.ransom.taps[me] <= C.tapBurst, String(r.ransom.taps[me]));
    r.tap('nobody', 5); r.tap(foe, 'x'); r.tap(foe, -3);
    check('junk taps and strangers do not count', r.ransom.taps[foe] === 0 && !('nobody' in r.ransom.taps));
    const third = team(r, 2, 900);
    r.tap(third.members[0], 3);
    check('a team that is not in the duel cannot tap', !(third.members[0] in r.ransom.taps));
    r.dispose();
  }
  {
    // Bots mash like people: 5-8 taps a second.
    const r = mk(0.05), a = team(r, 2, 2000, { bot: true }), b = team(r, 2, 100, { bot: true, lost: 300 });
    r.toRansom(b, () => {}, 1); r.skip(); r.skip();
    globalThis.__botRoom = { r, a, b };
  }
}

// LAST BUSINESS STANDING + CONTAIN IT (18 Nov; pure, in-process, driven by hand).
{
  const { HoldRoom, awards, rankRows } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint', 'Slate', 'Dusk'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant', 'Bee', 'Cod'] };
  const base = holdContent.withActs(holdContent.load(FIXTURE));
  // acts 1, 2, then two act-3 scams (the last is ALL IN).
  const msgs = [...base, { ...base[2], id: 'new-number-2' }];
  const mk = () => new HoldRoom({ pin: '123456', messages: msgs, names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.5 });
  const team = (r, n, total, { bot = false } = {}) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot, temper: 'greedy' }); p.connected = true; p.down = true; ids.push(p.id); } const k = r.newPair(ids); k.total = total; k.actLost = 0; k.n = { spotted: 0, early: 0, taps: 0, trusted: 0, played: 0 }; k.upMs = 0; return k; };
  const C = HOLD.CONTAIN;
  check('act 3 is LAST BUSINESS STANDING; its rule line names CONTAIN IT; no trick line', HOLD.ACTS[2].name === 'LAST BUSINESS STANDING' && /contain it/.test(HOLD.ACTS[2].rule) && !HOLD.ACTS[2].trick && HOLD.ACTS[2].closes === true);
  check('CONTAIN IT: 5 s, 40 taps per member', C.ms === 5000 && C.need === 40);
  // Runs message i with every team holding to the spring; returns the room in the phase after resolve.
  const holdThrough = (r, i) => { r.toReady(i); r.startMessage(); r.resolve(); };
  {
    // Act 1: a breach does not open CONTAIN IT and closes nobody.
    const r = mk(), a = team(r, 2, 1000), b = team(r, 2, 500);
    holdThrough(r, 0);
    check('act 1: a breach opens no CONTAIN IT window and closes nobody', r.phase === 'crash' && !r.contain && !a.closed && !b.closed && a.st === 'caught');
    r.dispose();
  }
  {
    // Act 3: both caught; a contains (taps), b doesn't.
    const r = mk(), a = team(r, 2, 4000), b = team(r, 3, 3000), c = team(r, 1, 2000);
    for (const id of c.members) r.players.get(id).down = false; // c never arms: sits out, not breached
    a.mode = 'safe'; b.mode = 'bold';
    holdThrough(r, 2);
    const K = r.contain;
    check('act 3: a breach opens CONTAIN IT (GET READY first) for every breached company (not one that sat out)', r.phase === 'crash' && K && K.step === 'ready' && K.teams.includes(a.id) && K.teams.includes(b.id) && !K.teams.includes(c.id));
    r.tap(a.members[0], 3);
    check('GET READY: taps before the window opens do not count', K.taps[a.members[0]] === 0 && HOLD.CONTAIN.readyMs === 3000);
    r.startContainMash();
    check('... then the 5 s tapping window opens', K.step === 'mash' && r.phase === 'crash');
    check('... the breach banner and pot are public at once (it is the spring)', r.publicState().result && r.publicState().result.caught.length === 2);
    const aLost = a.lost, aKept = a.kept;
    check('SAFE in act 3 keeps half of that message\'s pot', aKept === Math.round(aLost * HOLD.SAFE_KEEP) && a.total === 4000 + aKept);
    // Taps: per-member average; the cap; strangers and the team that sat out are ignored.
    const a0 = a.members[0], a1 = a.members[1];
    r.tap(c.members[0], 5);
    check('a company that was not breached cannot tap', !(c.members[0] in K.taps));
    r.tap('nobody', 5);
    check('strangers do not count', !('nobody' in K.taps));
    r.tap(a0, 50);
    check('the tap cap applies (a burst at most)', K.taps[a0] <= HOLD.RANSOM.tapBurst, String(K.taps[a0]));
    K.taps[a0] = 45; K.taps[a1] = 41;
    for (const id of b.members) K.taps[id] = 30; K.taps[b.members[0]] = 70; // b: 70+30+30 = 130 / 3 = 43.3 -> contained? set lower
    K.taps[b.members[0]] = 50; // b: (50+30+30)/3 = 36.7 < 40
    check('score = average taps per member', r.containScore(a) === 43 && Math.abs(r.containScore(b) - 36.7) < 0.01, r.containScore(a) + ' / ' + r.containScore(b));
    r.skip(); // the window ends
    check('contained: stays OPEN, still lost the pot', !a.closed && K.step === 'result' && K.result[a.id] === 'contained' && a.total === 4000 + aKept);
    check('failed: CLOSED for good', !!b.closed && b.closed.act === 3 && K.result[b.id] === 'closed' && b.total === 3000);
    r.tap(a0, 5);
    check('taps after the window are ignored', K.taps[a0] === 45);
    check('the company that sat out is still open', !c.closed);
    r.skip(); // -> reveal
    const rv = r.reveal;
    check('act 3 reveal: N OF M STILL OPEN and who just closed', r.phase === 'reveal' && rv.open && rv.open.n === 2 && rv.open.of === 3 && JSON.stringify(rv.open.closedNow) === JSON.stringify([b.id]));
    // Next act-3 message (ALL IN): the closed company holds along: its spot counts, no revenue.
    const bTotal = b.total, bSpot = b.n.spotted;
    r.toReady(3); r.startMessage();
    const pot = r.teamPot(b);
    r.play.startAt -= HOLD.flagAt(msgs[3], HOLD.ACTS[2].lineMs) + 100; // after the red flag landed
    r.bank(b, r.players.get(b.members[0]), 999);
    r.bank(a, r.players.get(a.members[0]), 999);
    r.resolve();
    check('a closed company holds along: SPOTTED IT counts for Human Firewall, no revenue', b.mark === 'spotted' && b.n.spotted === bSpot + 1 && b.total === bTotal && b.got === 0, `${b.mark} ${b.total} ${b.got} ${pot}`);
    check('an open company still earns', a.got > 0);
    check('a closed company is never breached again (no second CONTAIN IT, not in the banner)', !(r.contain && r.contain.teams.includes(b.id)) && !r.result.caught.includes(b.id));
    r.dispose();
  }
  {
    // No window when nobody is breached.
    const r = mk(), a = team(r, 2, 4000);
    r.toReady(2); r.startMessage(); r.bank(a, r.players.get(a.members[0]), 100); r.resolve();
    check('act 3, nobody breached: no CONTAIN IT window', r.phase === 'crash' && !r.contain);
    r.dispose();
  }
  {
    // No duel after act 3; duels after acts 1 and 2 stay.
    const r = mk(), a = team(r, 2, 4000), b = team(r, 2, 300);
    r.index = 3; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    check('no ransomware duel after act 3: straight to closing time', r.phase === 'final' && !r.ransom);
    r.dispose();
    const r2 = mk(), a2 = team(r2, 2, 4000), b2 = team(r2, 2, 300);
    b2.n.taps = 1; b2.actBreaches = 1; // someone was breached (19 Nov: no breach ever = no ransomware)
    r2.index = 0; r2.phase = 'reveal'; r2.reveal = {}; r2.afterReveal();
    check('acts 1 and 2 still end with the hot file', r2.phase === 'hot');
    r2.dispose();
  }
  {
    // Ranking: open above every closed; closed by when they closed (later higher), then revenue.
    const row = (id, total, closed, spotted = 0) => ({ id, total, closed, n: { spotted, taps: 0, early: 0, trusted: 0, played: 3 } });
    const rows = rankRows([row('rich-closed', 61000, { seq: 1 }), row('open-poor', 20000, null), row('open-rich', 42000, null), row('late-closed', 5000, { seq: 2 })]);
    check('open companies rank above every closed one, then by revenue', rows.map((x) => x.id).join() === 'open-rich,open-poor,late-closed,rich-closed', rows.map((x) => x.id).join());
    const all = rankRows([row('a', 9000, { seq: 1 }), row('b', 100, { seq: 3 }), row('c', 500, { seq: 3 })]);
    check('everyone closed: the last to close wins (then revenue)', all.map((x) => x.id).join() === 'c,b,a' && all[0].rank === 1);
    const aw = awards(rankRows([row('rich-closed', 61000, { seq: 1 }, 1), row('open', 42000, null, 5), row('x', 100, null, 0)]));
    check('awards: LAST BUSINESS STANDING = rank 1, TOP REVENUE may be closed, HUMAN FIREWALL most spotted', aw.lbs === 'open' && aw.revenue === 'rich-closed' && aw.firewall === 'open' && !('never' in aw) && !('bank' in aw));
  }
  {
    // Uptime and the company report on the phone at the end.
    const r = mk(), a = team(r, 2, 0), b = team(r, 2, 0);
    for (let i = 0; i < 4; i++) {
      r.toReady(i); r.startMessage();
      if (i === 1) r.play.startAt -= 4000; // a: let go 4 s in (b holds the real one to the end)
      if (i === 1) r.bank(a, r.players.get(a.members[0]), 10);
      if (msgs[i].kind !== 'real') { r.bank(b, r.players.get(b.members[0]), 10); }
      r.resolve();
      if (r.contain) { for (const id of a.members) r.contain.taps[id] = 0; r.skip(); }
      if (r.phase === 'crash') r.skip();
    }
    r.toFinal();
    const F = r.final, ra = F.rows.find((x) => x.id === a.id), rb = F.rows.find((x) => x.id === b.id);
    check('final rows: open/closed, closedAct, uptime %, breaches, spotted', ra.closed && ra.closedAct === 3 && !rb.closed && typeof ra.uptime === 'number' && ra.uptime >= 0 && ra.uptime <= 100 && rb.uptime < 100 && ra.breaches >= 1, JSON.stringify([ra, rb]));
    const pa = r.players.get(a.members[0]);
    const y = r.you(pa);
    check('the phone report: name, CLOSED IN ACT 3, rank of M, revenue, uptime, breaches, spotted x/y', y.report && y.report.label && y.report.closedAct === 3 && y.report.rank === 2 && y.report.of === 2 && 'total' in y.report && 'uptime' in y.report && 'breaches' in y.report && y.report.spotted >= 0 && y.report.scams === 3, JSON.stringify(y.report));
    check('the winner\'s phone says STILL TRADING #1', r.you(r.players.get(b.members[0])).report.rank === 1 && !r.you(r.players.get(b.members[0])).report.closedAct);
    r.dispose();
  }
  {
    // The market (skyline) snapshot: frozen while a message plays, updated at the spring and the reveal.
    const r = mk(), a = team(r, 2, 1000), b = team(r, 2, 900);
    r.toActCard(2);
    check('act 3 card: the market appears (every company open)', r.publicState().market && r.publicState().market.length === 2 && r.publicState().market.every((m) => m.open));
    r.endCard(); r.startMessage();
    const before = JSON.stringify(r.publicState().market);
    r.bank(a, r.players.get(a.members[0]), 5000);
    check('the market never moves while a message plays (no tells)', JSON.stringify(r.publicState().market) === before);
    const ps = r.publicState();
    check('no per-team state during play, even in act 3', ps.pairs.every((x) => x.state === 'hold' && !x.got));
    r.resolve();
    check('the market updates at the spring', JSON.stringify(r.publicState().market) !== before);
    r.dispose();
  }
  {
    // Bots mash CONTAIN IT at 5-8 taps/s: report the contain rate.
    let ok = 0, n = 0;
    for (let s = 0; s < 40; s++) {
      let seed = s * 7919 + 1; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const r = new HoldRoom({ pin: '1', messages: msgs, names, scale: 1, makeToken: () => 't', rand });
      const k = team(r, 2, 1000, { bot: true });
      r.toReady(2); r.startMessage(); r.resolve();
      if (r.contain) { r.containBotsFor(C.ms); r.skip(); n++; if (!k.closed) ok++; }
      r.dispose();
    }
    check('bot companies sometimes contain it (rate reported)', n > 0, `${ok}/${n} contained`);
    globalThis.__botContain = `${ok}/${n}`;
  }
}

const lineTexts = holdContent.load(FIXTURE).flatMap((m) => m.lines);
const hasText = (o) => { const s = JSON.stringify(o); return lineTexts.some((l) => s.includes(l)); };
const pairOf = (st, id) => st.pairs.find((k) => k.members.includes(id));

// AGREE-QUIZ, RESTORE FROM BACKUP, LET GO TOGETHER (18 Nov; pure, in-process).
{
  const { HoldRoom, awards, rankRows } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint', 'Slate', 'Dusk'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant', 'Bee', 'Cod'] };
  const base = holdContent.withActs(holdContent.load(FIXTURE));
  // act 1 x3 (quiz after the 2nd), act 2 x1, act 3 x3.
  const msgs = [base[0], { ...base[1], id: 'a1b', act: 1 }, { ...base[0], id: 'a1c' }, base[1], base[2], { ...base[2], id: 'a3b' }, { ...base[1], id: 'a3c', act: 3 }];
  const bank = holdContent.loadQuiz();
  const mk = (quiz = bank) => new HoldRoom({ pin: '123456', messages: msgs, quiz, names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.5 });
  const team = (r, n, total, { bot = false } = {}) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot, temper: 'greedy' }); p.connected = true; p.down = true; ids.push(p.id); } const k = r.newPair(ids); k.total = total; k.actLost = 0; k.n = { spotted: 0, early: 0, taps: 0, trusted: 0, played: 0, quiz: 0 }; k.upMs = 0; k.backup = 0; return k; };
  const Q = HOLD.QUIZ;
  const reg = bank.filter((q) => !q.pro), pros = bank.filter((q) => q.pro);
  check('quiz bank: 24 regular items, 8 per act, plus pro questions for acts 2 and 3; 3 options each, answers in range', reg.length === 24 && [1, 2, 3].every((a) => reg.filter((q) => q.act === a).length === 8) && pros.length >= 2 && [2, 3].every((a) => pros.some((q) => q.act === a)) && bank.every((q) => q.options.length === 3 && q.answer >= 0 && q.answer < 3));
  check('PRO QUESTION: last quiz of acts 2 and 3, pays double, bots rarely know it', JSON.stringify(Q.proActs) === '[2,3]' && Q.proX === 2 && Q.botRightPro < Q.botRight);
  { const r = mk();
    check('a regular slot never draws a pro item; a pro slot draws one for its act', !r.nextQuizItem(2).pro && r.nextQuizItem(2, true).pro && r.nextQuizItem(2, true).act === 2 && r.nextQuizItem(3, true).act === 3);
    r.dispose(); }
  { // The pro slot in the flow: act 3 here has 3 messages and QUIZ.after [2, 4]: its 2nd reveal is its last quiz, so PRO.
    const r = mk(), x = team(r, 2, 1000), y = team(r, 2, 1000);
    r.index = 5; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    const proAsked = r.quiz && r.quiz.item;
    check('act 3, 2nd message: the quiz is a PRO QUESTION for act 3', r.phase === 'quiz' && proAsked && proAsked.pro && proAsked.act === 3, proAsked && proAsked.id);
    const ans = proAsked.answer; for (const id of x.members) r.answer(id, ans); for (const id of y.members) r.answer(id, (ans + 1) % 3);
    r.quizSkip(); if (r.quiz && r.quiz.step !== 'reveal') r.quizSkip();
    const R = r.quiz.result, mult = HOLD.ACTS[2].mult;
    check('PRO right pays proX x the bonus x stakes; the reveal is marked pro', R.pro === true && R.bonus === Q.bonus * mult * Q.proX && x.total === 1000 + R.bonus && y.total === 1000, JSON.stringify(R));
    check('the TV view and phones know it is a PRO QUESTION', r.quizView().pro === true);
    r.dispose(); }
  check('the bank reaches the game without our notes (no source, no pct)', bank.every((q) => !('source' in q) && !('room_pct' in q)));
  check('QUIZ: 12 s private pick, 6 s to agree, after the 2nd and 4th message of an act', Q.pickMs === 12000 && Q.agreeMs === 6000 && JSON.stringify(Q.after) === '[2,4]');
  check('a bad bank is refused', (() => { try { holdContent.validateQuiz([{ id: 'x', act: 1, question: 'q', options: ['a', 'b'], answer: 5, why: 'w' }]); return false; } catch { return true; } })());
  {
    const r = mk(), a = team(r, 2, 1000), b = team(r, 2, 900), s = team(r, 1, 500), c = team(r, 2, 100);
    r.index = 0; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    check('after the 1st message of an act: no quiz', r.phase !== 'quiz' && !r.quiz);
    r.clearTimers();
    r.index = 1; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    const K = r.quiz;
    check('after the 2nd message of an act: a quiz from that act', r.phase === 'quiz' && K && K.step === 'pick' && K.item.act === 1);
    const [a0, a1] = a.members, [b0, b1] = b.members, [c0, c1] = c.members;
    const ans = K.item.answer, wrong = (ans + 1) % 3;
    r.answer(a0, ans);
    const ya1 = r.you(r.players.get(a1)).quiz;
    check("a partner's pick is private until the whole team has picked", ya1.mates[0].picked === true && ya1.mates[0].pick === null && ya1.mine === null);
    const ps = r.publicState();
    check('the TV gets the question and how many answered, never anyone\'s pick', ps.quiz && ps.quiz.question === K.item.question && ps.quiz.options.length === 3 && !/"picks"/.test(JSON.stringify(ps)) && ps.quiz.answered === 0 && !('answer' in ps.quiz) && !ps.quiz.result);
    r.answer(a0, wrong);
    check('a pick is locked once made (no change while the partner has not picked)', K.picks[a0] === ans);
    r.answer(a1, ans);
    check('both picked the same: that is the team\'s answer', r.teamAnswer(a) === ans && r.you(r.players.get(a1)).quiz.agreed && r.you(r.players.get(a0)).quiz.mates[0].pick === ans);
    check('... and the TV now counts one team answered', r.publicState().quiz.answered === 1);
    r.answer(b0, ans); r.answer(b1, wrong);
    const yb0 = r.you(r.players.get(b0)).quiz;
    check('picks differ: both see both picks and may change', yb0.disagree && yb0.mates[0].pick === wrong && r.teamAnswer(b) === null);
    r.answer(b1, ans);
    check('... a re-pick to match agrees', r.teamAnswer(b) === ans);
    r.answer(s.members[0], wrong);
    check('a SOLO team answers alone', r.teamAnswer(s) === wrong);
    r.answer(c0, ans); r.answer(c1, wrong);
    r.quizAgree();
    check('the pick window ends with a team still split: the agree step', K.step === 'agree');
    r.answer(c0, (wrong + 1) % 3); // c0 changes to the third option: still no match
    const before = { a: a.total, b: b.total, s: s.total, c: c.total };
    r.quizReveal();
    const R = K.result;
    check('no agreement = no answer', r.teamAnswer(c) === null && K.answers[c.id] === null);
    check('right = a bonus x the act\'s stakes, and +1 for Human Firewall', a.total === before.a + Q.bonus * HOLD.ACTS[0].mult && b.total === before.b + Q.bonus && a.n.quiz === 1 && b.n.quiz === 1, `${a.total - before.a}`);
    check('wrong or no answer: nothing', s.total === before.s && c.total === before.c && s.n.quiz === 0 && c.n.quiz === 0);
    check('the reveal: the answer, the lesson, % of the room and the right teams by name', R.answer === ans && R.why === K.item.why && R.right === 2 && R.of === 4 && R.pct === 50 && R.names.map((x) => x.id).sort().join() === [a.id, b.id].sort().join());
    check('the TV only gets the result at the reveal', r.publicState().quiz.result && r.publicState().quiz.result.pct === 50);
    check('the phone knows if its team was right', r.you(r.players.get(a0)).quiz.right === true && r.you(r.players.get(s.members[0])).quiz.right === false);
    const asked = K.item.id;
    r.endQuiz();
    check('after the quiz the match carries on to the next message', r.phase === 'ready' && r.index === 2 && !r.quiz);
    check('a quiz is never asked twice', r.quizUsed.has(asked) && r.nextQuizItem(1).id !== asked);
    r.dispose();
  }
  {
    // The act's last message ends the act (duel / closing time), never a quiz; up to 6 names shown.
    const r = mk(), ks = []; for (let i = 0; i < 9; i++) ks.push(team(r, 2, 1000 * i));
    ks[0].n.taps = 1; ks[0].actBreaches = 1;
    r.index = 2; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    check("the act's last message: no quiz (the hot file)", r.phase === 'hot');
    r.clearTimers(); r.hot = null;
    r.index = 1; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    const it = r.quiz.item; for (const k of ks) for (const id of k.members) r.answer(id, it.answer);
    check('every team agreed: the reveal comes early', r.quiz.done === true);
    r.quizReveal();
    check('at most 6 right teams by name, the rest counted', r.quiz.result.names.length === Q.show && r.quiz.result.more === 3 && r.quiz.result.pct === 100);
    r.dispose();
  }
  {
    // Bots answer by themselves; a closed company takes part (Human Firewall) but earns nothing; firewall counts quizzes.
    const r = mk(), a = team(r, 2, 1000), bt = team(r, 2, 0, { bot: true });
    r.index = 5; a.closed = { act: 3, seq: 1, index: 4 };
    r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    check('act 3: a quiz after its 2nd message too', r.phase === 'quiz' && r.quiz.item.act === 3);
    for (const id of a.members) r.answer(id, r.quiz.item.answer);
    r.quizReveal();
    check('a closed company answers: +1 Human Firewall, no revenue', a.n.quiz === 1 && a.total === 1000);
    check('bot teams answer by themselves', bt.members.every((id) => Number.isInteger(r.quiz.picks[id])) || r.quiz.answers[bt.id] !== undefined);
    const row = (id, spotted, quiz) => ({ id, total: 0, closed: null, n: { spotted, quiz, taps: 0 } });
    const aw = awards(rankRows([row('spots', 3, 0), row('quizzer', 1, 3)]));
    check('HUMAN FIREWALL counts red flags spotted plus quiz answers right', aw.firewall === 'quizzer');
    r.dispose();
  }
  {
    // RESTORE FROM BACKUP: a closed company's banks fill its backup bar; full = reopened at the next reveal, once.
    const r = mk([]), a = team(r, 2, 4000), b = team(r, 2, 3000);
    b.closed = { act: 3, seq: 1, index: 4 };
    // Message 5 (act 3 scam): b lets go before the spring.
    r.toReady(5); r.startMessage(); r.bank(b, r.players.get(b.members[0]), 500); r.bank(a, r.players.get(a.members[0]), 500); r.resolve();
    check('closed: a bank fills the backup bar, no revenue', b.backup === 1 && b.total === 3000 && b.got === 0);
    const yb = r.you(r.players.get(b.members[0]));
    check('the closed phone shows its backup bar', yb.backup && yb.backup.have === 1 && yb.backup.need === HOLD.BACKUP.need && yb.backup.now);
    r.skip(); // -> reveal
    check('half a backup: still closed', !!b.closed && !b.restored);
    // Message 6 (act 3, real): b holds it to the end (the real message counts as a bank).
    r.toReady(6); r.startMessage(); r.resolve(); r.skip();
    check('a full bar reopens the company at the reveal', !b.closed && b.restored && r.reveal.open.restoredNow.includes(b.id) && r.reveal.open.n === 2);
    check('... the market shows it lit again, restored', r.market.find((x) => x.id === b.id).open && r.market.find((x) => x.id === b.id).restored);
    check('... and its phone says RESTORED', r.you(r.players.get(b.members[0])).restored && r.you(r.players.get(b.members[0])).restored.now);
    // A second close is for good: no more backup.
    b.closed = { act: 3, seq: 2, index: 6 }; b.backup = 0;
    r.toReady(5); r.startMessage(); r.bank(b, r.players.get(b.members[0]), 500); r.resolve(); r.skip(); r.toReady(6); r.startMessage(); r.resolve(); r.skip();
    check('restored once: a second close is for good (no backup fills)', b.closed && (b.backup || 0) === 0 && !r.you(r.players.get(b.members[0])).backup);
    r.toFinal();
    check('the company report says it was restored', r.you(r.players.get(b.members[0])).report.restored === true);
    r.dispose();
  }
  {
    // LET GO TOGETHER: every member up within 500 ms = the bank x1.5; the TV learns it at the crash, not during play.
    const r = mk([]), a = team(r, 2, 0), b = team(r, 2, 0), c = team(r, 2, 0);
    r.toReady(0); r.startMessage();
    const fa = HOLD.flagAt(msgs[0], HOLD.ACTS[0].lineMs);
    r.play.startAt -= 2000; // the pot has grown a little; before the red flag
    const now = Date.now();
    const up = (k, i, dt) => { const p = r.players.get(k.members[i]); p.upAt = null; r.syncCheck(k, p, now + dt); };
    up(a, 0, 0); up(a, 1, 300);
    up(b, 0, 0); up(b, 1, 900);
    check('both up within 500 ms: in sync', a.sync === true && b.sync === false);
    r.bank(a, r.players.get(a.members[0]), 1000); r.bank(b, r.players.get(b.members[0]), 1000);
    check("the team's own phone knows at once", r.you(r.players.get(a.members[1])).sync && r.you(r.players.get(a.members[1])).sync.x === 1.5);
    check('the TV does not, during play', !JSON.stringify(r.publicState().pairs).includes('"sync"'));
    r.resolve();
    check('in sync: that bank x1.5', a.got === Math.round(b.got * HOLD.SYNC.x) && a.syncX > 0, `${a.got} vs ${b.got}`);
    const row = r.publicState().pairs.find((x) => x.id === a.id);
    check('the TV shows it at the crash (sync badge)', row.sync === true && r.publicState().pairs.find((x) => x.id === b.id).sync === false);
    check('a breach is never in sync', c.st === 'caught' && !c.sync);
    r.dispose();
  }
  check('act 1 card explains it in one line', /together.*1\.5/i.test(HOLD.ACTS[0].tip));
}

// HOT FILE (19 Nov; replaces the ransomware duel in acts 1-2): the infected file lands on the most-breached company; it may
// PASS it up the market or DEFUSE it (a puzzle, both agree); a defuse = HERO; whoever is left holding it loses 25%.
{
  const { HoldRoom } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant'] };
  const base = holdContent.withActs(holdContent.load(FIXTURE));
  const msgs = [base[0], { ...base[1], id: 'a1b', act: 1 }, base[1], base[2]];
  const puzzles = holdContent.loadPuzzles();
  const mk = () => new HoldRoom({ pin: '123456', messages: msgs, quiz: [], incidents: [], puzzles, names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.3 });
  const team = (r, n, total, { bot = false, taps = 0, lost = 0 } = {}) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot, temper: 'greedy' }); p.connected = true; p.down = true; ids.push(p.id); } const k = r.newPair(ids); k.total = total; k.actLost = lost; k.actBreaches = taps; k.n = { spotted: 0, early: 0, taps, trusted: 0, played: 0, quiz: 0 }; k.upMs = 0; k.backup = 0; return k; };
  const H = HOLD.HOT;
  check('puzzles: 6, 3 per act for acts 1-2, 3 options each, answers in range', puzzles.length === 6 && [1, 2].every((a) => puzzles.filter((q) => q.act === a).length === 3) && puzzles.every((q) => q.options.length === 3 && q.answer >= 0 && q.answer < 3));
  check('HOT: 10 s to choose, 15 s to defuse, 3 passes at most, 25% hit', H.chooseMs === 10000 && H.puzzleMs === 15000 && H.maxPasses === 3 && H.cut === 0.25);
  {
    const r = mk(), a = team(r, 2, 40000), b = team(r, 2, 30000), c = team(r, 2, 20000, { taps: 2, lost: 5000 }), d = team(r, 2, 10000);
    r.index = 1; r.phase = 'reveal'; r.reveal = {}; r.afterReveal();
    const T = r.hot;
    check('end of act 1: the HOT FILE lands on the most-breached company', r.phase === 'hot' && T && T.holder === c.id && T.step === 'landed' && !r.ransom);
    const tv = r.publicState().hot;
    check('the TV gets the holder and why, never a puzzle answer', tv && tv.holder.id === c.id && tv.why && !/"answer"/.test(JSON.stringify(tv)));
    const yc = r.you(r.players.get(c.members[0])).hot, ya = r.you(r.players.get(a.members[0])).hot;
    check('the holder phone knows it holds it; the others watch', yc.role === 'holder' && ya.role === 'watch');
    r.hotSkip();
    check('then the holder chooses: PASS or DEFUSE', T.step === 'choose' && T.canPass === true);
    r.hotAnswer(c.members[0], 'pass');
    check('one pick is not a choice (both must agree)', T.step === 'choose');
    r.hotAnswer(c.members[1], 'pass');
    check('both PASS: it moves to the next company up', T.step === 'passed' && T.holder === b.id && T.passes === 1);
    r.hotSkip();
    check('the new holder chooses', T.step === 'choose' && T.holder === b.id);
    for (const id of b.members) r.hotAnswer(id, 'defuse');
    check('both DEFUSE: a puzzle', T.step === 'puzzle' && T.puzzle && T.puzzle.options.length === 3);
    const tvp = r.publicState().hot;
    check('the TV gets the puzzle without its answer', tvp.puzzle && tvp.puzzle.prompt && !('answer' in tvp.puzzle));
    const before = b.total;
    for (const id of b.members) r.hotAnswer(id, T.puzzle.answer);
    check('both pick the right answer: HERO, a bonus, a hero badge', T.step === 'result' && T.result.kind === 'hero' && T.result.team === b.id && b.total > before && b.hero === 1 && b.n.hero === 1);
    check('the hero shows on the TV state (team rows)', r.publicState().pairs.find((x) => x.id === b.id).hero === 1);
    r.hotSkip();
    check('after the result the match carries on (act 2 card)', r.phase === 'stage' && !r.hot);
    r.clearTimers(); r.toFinal();
    check('the hero is in the final rows and its company report', r.final.rows.find((x) => x.id === b.id).hero === 1 && r.you(r.players.get(b.members[0])).report.hero === 1);
    r.dispose();
  }
  {
    // A wrong defuse takes the hit; the last possible holder can't pass; no agreement = pass when possible.
    const r = mk(), a = team(r, 2, 40000), b = team(r, 2, 30000, { taps: 3 });
    r.toHot(b, () => r.continueAt(2), 1); r.hotSkip();
    check('the leader can still pass down', r.hot.canPass === true);
    for (const id of b.members) r.hotAnswer(id, 'defuse');
    const wrong = (r.hot.puzzle.answer + 1) % 3, before = b.total;
    for (const id of b.members) r.hotAnswer(id, wrong);
    check('a wrong defuse: they take the hit (25%)', r.hot.result.kind === 'hit' && b.total === before - Math.round((before * H.cut) / 100) * 100);
    r.dispose();
  }
  {
    const r = mk(), a = team(r, 2, 40000), b = team(r, 2, 30000, { taps: 3 });
    r.toHot(b, () => r.continueAt(2), 1); r.hotSkip();
    r.hotAnswer(b.members[0], 'pass'); r.hotAnswer(b.members[1], 'defuse');
    r.hotDecide();
    check('no agreement on the choice: it passes (the cautious default)', r.hot.holder === a.id && r.hot.passes === 1);
    r.hotSkip();
    check('nobody left to pass to: no PASS', r.hot.canPass === false);
    r.hotAnswer(a.members[0], 'pass'); r.hotAnswer(a.members[1], 'pass');
    check('a PASS without anyone to pass to is ignored', r.hot.step === 'choose');
    const before = a.total; r.hotDecide();
    check('time runs out with nowhere to pass: the holder takes the hit', r.hot.result.kind === 'hit' && r.hot.result.team === a.id && a.total < before);
    r.dispose();
  }
  {
    // The pass chain stops at 3: the 4th holder can only defuse or take it.
    const r = mk(), ks = []; for (let i = 0; i < 5; i++) ks.push(team(r, 2, 10000 * (i + 1), { taps: i === 0 ? 2 : 0 }));
    r.toHot(ks[0], () => r.continueAt(2), 1);
    for (let i = 0; i < 3; i++) { r.hotSkip(); for (const id of r.pairs.get(r.hot.holder).members) r.hotAnswer(id, 'pass'); }
    r.hotSkip();
    check('after 3 passes no more passing', r.hot.passes === 3 && r.hot.canPass === false && r.hot.step === 'choose');
    r.dispose();
  }
  {
    const r = mk(), a = team(r, 2, 100), bt = team(r, 2, 0, { bot: true, taps: 3 });
    r.toHot(bt, () => r.continueAt(2), 1); r.hotSkip();
    check('a bot holder decides by itself', !!r.hot.botPlan);
    r.dispose();
  }
  {
    // 19 Nov (Angelo never saw a pass): bots pass 60% of the time; a bot team below a human team passes it up to them.
    check('bots defuse 40%, pass 60%', H.botDefuse === 0.4);
    const r = new HoldRoom({ pin: '123456', messages: msgs, quiz: [], incidents: [], puzzles, names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.7 });
    const me = team(r, 2, 50000), bt = team(r, 2, 1000, { bot: true, taps: 3 });
    r.toHot(bt, () => r.continueAt(2), 1); r.hotSkip();
    check('a bot holder that can pass plans PASS', r.hot.botPlan === 'pass');
    for (const id of bt.members) r.hot.picks[id] = r.hot.botPlan; r.hotDecide();
    check('... and the file moves up to the human team', r.hot.step === 'passed' && r.hot.holder === me.id && r.hot.from === bt.id && r.hot.passes === 1);
    r.hotSkip(); r.hotAnswer(me.members[0], 'defuse');
    const lv = r.hotView().live;
    check('the TV sees each partner\'s pick live while they decide', lv && lv.length === 2 && lv.find((m) => m.id === me.members[0]).pick === 'defuse' && lv.find((m) => m.id === me.members[1]).pick === null);
    r.hotAnswer(me.members[1], 'defuse');
    check('... who can defuse it', r.hot.step === 'puzzle' && !!r.hot.puzzle);
    r.hotAnswer(me.members[0], 2);
    const lp = r.hotView().live;
    check('... and their live puzzle picks (never the answer)', lp && lp.find((m) => m.id === me.members[0]).pick === 2 && !('answer' in r.hotView().puzzle));
    r.dispose();
  }
}

// INCIDENT ROOM (19 Nov): one responder round per match, between act 2 and act 3: an evidence board builds, then pick alone,
// then agree (the quiz flow); right = QUIZ.bonus x act stakes x IR.mult, and the reveal walks through each artefact.
{
  const { HoldRoom } = require('../server/hold/room');
  const names = { adjectives: ['Teal', 'Amber', 'Coral', 'Jade', 'Ruby', 'Onyx', 'Sky', 'Mint'], nouns: ['Fox', 'Owl', 'Koi', 'Elk', 'Yak', 'Ant'] };
  const base = holdContent.withActs(holdContent.load(FIXTURE));
  const msgs = [base[0], { ...base[1], id: 'a1b', act: 1 }, base[1], { ...base[1], id: 'a2b', act: 2 }, base[2], { ...base[2], id: 'a3b' }];
  const irs = holdContent.loadIncidents();
  const mk = (incidents = irs) => new HoldRoom({ pin: '123456', messages: msgs, quiz: [], incidents, names, scale: 1, makeToken: () => 't' + Math.random(), rand: () => 0.3 });
  const team = (r, n, total, { bot = false } = {}) => { const ids = []; for (let i = 0; i < n; i++) { const p = r.newPlayer({ bot, temper: 'greedy' }); p.connected = true; p.down = true; ids.push(p.id); } const k = r.newPair(ids); k.total = total; k.actLost = 0; k.n = { spotted: 0, early: 0, taps: 0, trusted: 0, played: 0, quiz: 0 }; k.upMs = 0; k.backup = 0; return k; };
  check('incident bank: 2 scenarios, 3-4 artefacts each, 3 options, a walk line per artefact, sources', irs.length === 2 && irs.every((x) => x.evidence.length >= 3 && x.evidence.length <= 4 && x.options.length === 3 && x.walk.length === x.evidence.length && x.answer >= 0 && x.answer < 3));
  check('a bad incident is refused', (() => { try { holdContent.validateIncidents([{ id: 'x', evidence: [], question: 'q', options: ['a', 'b', 'c'], answer: 1, why: 'w', walk: [] }]); return false; } catch { return true; } })());
  {
    const r = mk(), a = team(r, 2, 10000), b = team(r, 2, 5000);
    r.index = 3; r.continueAt(4);
    const Q = r.quiz;
    check('into act 3: the INCIDENT ROOM comes first, starting with the evidence brief', r.phase === 'quiz' && Q && Q.ir === true && Q.step === 'brief');
    const ps = r.publicState();
    check('the TV gets the evidence board, never the answer', ps.quiz.ir === true && ps.quiz.evidence.length >= 3 && !('answer' in ps.quiz) && !ps.quiz.result && !('walk' in ps.quiz));
    const y = r.you(r.players.get(a.members[0])).quiz;
    check('phones get the evidence too (to point at together)', y.ir === true && y.evidence.length === ps.quiz.evidence.length && !('answer' in y));
    r.answer(a.members[0], Q.item.answer);
    check('no picks during the brief', !Number.isInteger(Q.picks[a.members[0]]));
    r.quizSkip();
    check('after the brief: pick alone', Q.step === 'pick' && r.phase === 'quiz');
    for (const id of a.members) r.answer(id, Q.item.answer);
    for (const id of b.members) r.answer(id, (Q.item.answer + 1) % 3);
    const before = a.total, bb = b.total;
    r.quizReveal();
    const mult = HOLD.ACTS[1].mult;
    check('right = QUIZ.bonus x act 2 stakes x IR.mult', a.total === before + HOLD.QUIZ.bonus * mult * HOLD.IR.mult && b.total === bb, String(a.total - before));
    check('... and counts for Human Firewall', a.n.quiz === 1);
    const rv = r.publicState().quiz;
    check('the reveal walks through every artefact', rv.result && rv.result.walk.length === Q.item.evidence.length && rv.result.answer === Q.item.answer);
    r.endQuiz();
    check('after the incident room: the act 3 card', r.phase === 'stage' && r.card && r.card.act === 3);
    r.clearTimers(); r.card = null;
    r.index = 3; r.continueAt(4);
    check('only once per match', r.phase === 'stage' && !r.quiz);
    r.dispose();
  }
  {
    const r = mk([]), a = team(r, 2, 100);
    r.index = 3; r.continueAt(4);
    check('no incident bank: straight to the act 3 card', r.phase === 'stage' && !r.quiz);
    r.dispose();
  }
  {
    const r = mk(), a = team(r, 2, 100), bt = team(r, 2, 0, { bot: true });
    r.index = 3; r.continueAt(4); r.quizSkip();
    check('bots pick after the brief', r.quiz.step === 'pick');
    r.dispose();
  }
}


async function lobbyWith(port, n) {
  const screen = await client(port);
  screen.send({ t: 'join', role: 'screen', createLobby: true });
  const w = await screen.wait('welcome');
  const P = [];
  for (let i = 0; i < n; i++) { const c = await client(port); c.send({ t: 'join', role: 'player', pin: w.pin }); c.welcome = await c.wait('welcome'); P.push(c); }
  await screen.wait('state', (f) => f.state.players.length === n);
  return { screen, P, pin: w.pin, hostToken: w.hostToken, host: (cmd) => screen.send({ t: 'host', token: w.hostToken, cmd }) };
}
// The phone's latest frame (mark-free: any frame so far).
const lastYou = (c) => { for (let i = c.frames.length - 1; i >= 0; i--) if (c.frames[i].t === 'you') return c.frames[i].you; return null; };
async function youWhen(c, pred, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const y = lastYou(c); if (y && pred(y)) return y; await sleep(5); } return null; }

// TWO KEYS (15 Nov, Angelo): every member of a team holds a ring. The team's pot grows only while ALL of
// them hold; one release banks it for the whole team and names who pulled the key. The message is on
// the big screen for everyone; phones never get its text.
const teamOf = (f, k) => f.state.pairs.find((q) => q.id === k.id);
const mateDown = (c, down) => (y) => y.mates && y.mates.length && y.mates.every((m) => m.down === down);

let LOGFILE = null;
async function match(port) {
  console.log('TWO KEYS: 4 phones = 2 pairs, 3 messages, server clock');
  const { screen, P, pin, hostToken, host } = await lobbyWith(port, 4);
  check('the big screen gets a PIN and the host token', /^\d{6}$/.test(pin) && /^[0-9a-f]{64}$/.test(hostToken));
  const bad = await client(port); bad.send({ t: 'join', role: 'player', pin: '000000' });
  check('a wrong PIN is refused', !!(await bad.wait('pin_bad')));
  bad.close();
  check('4 phones join by PIN with names and tokens', P.every((c) => c.welcome && c.welcome.id && c.welcome.name && c.welcome.token));
  const lobby = screen.last.state.state;
  check('the screen lists all 4 in the lobby, no bots, no pairs yet', lobby.phase === 'lobby' && lobby.players.every((p) => !p.bot) && !(lobby.pairs || []).length);

  P[0].send({ t: 'host', token: hostToken, cmd: 'start' });
  await sleep(100);
  check('a phone cannot start the game, even with the token', screen.last.state.state.phase === 'lobby');
  const other = await client(port); other.send({ t: 'join', role: 'screen', pin }); await other.wait('welcome');
  other.send({ t: 'host', token: 'f'.repeat(64), cmd: 'start' }); await sleep(100);
  check('a watching screen with a wrong token cannot start it', screen.last.state.state.phase === 'lobby');
  other.close();

  // ---- pairing with your seat neighbour: one shows a 3-digit code, the other types it
  const codes = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'lobby' && y.code)));
  check('every phone has its own 3-digit pairing code', codes.every((y) => y && /^\d{3}$/.test(y.code)) && new Set(codes.map((y) => y && y.code)).size === 4);
  check('the pairing codes never reach the big screen', !codes.some((y) => y && JSON.stringify(screen.last.state.state).includes('"' + y.code + '"')));
  const [A, B, C, D] = P;
  const unused = String([...Array(900).keys()].map((i) => i + 100).find((n) => !codes.some((y) => y.code === String(n))));
  A.send({ t: 'pair', code: unused });
  check('a wrong code is refused', !!(await A.wait('pair_bad')));
  A.send({ t: 'pair', code: codes[0].code });
  check('your own code is refused', !!(await A.wait('pair_bad')));
  B.send({ t: 'pair', code: codes[0].code });
  D.send({ t: 'pair', code: codes[2].code });
  const paired = await Promise.all(P.map((c) => youWhen(c, (y) => y.pair && y.pair.mates.length === 1)));
  const mateOf = { [A.welcome.id]: B, [B.welcome.id]: A, [C.welcome.id]: D, [D.welcome.id]: C };
  check('both phones confirm PAIRED WITH <the other name>', paired.every((y, i) => y && y.pair.mates[0] === mateOf[P[i].welcome.id].welcome.name));
  const lob2 = await screen.wait('state', (f) => f.state.pairs && f.state.pairs.length === 2);
  check('the big screen lists the pairs as companies: "Sam & Priya Ltd"', lob2 && lob2.state.pairs.every((k) => k.members.length === 2 && /^.+ & .+ Ltd$/.test(k.label)), JSON.stringify(lob2 && lob2.state.pairs.map((k) => k.label)));
  A.send({ t: 'pair', code: codes[2].code });
  check('someone already paired cannot pair again', !!(await A.wait('pair_bad')));

  host('start');
  // ---- WALKTHROUGH card A: both thumbs down = your pot grows (interactive)
  const w0 = await screen.wait('state', (f) => f.state.phase === 'walk');
  check('START opens the walkthrough at card 1 of 3', w0 && w0.state.walk.step === 0 && w0.state.walk.steps === 3);
  const WX = w0.state.pairs.find((k) => k.members.includes(A.welcome.id)), WY = w0.state.pairs.find((k) => k.members.includes(C.welcome.id));
  const yw = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'walk' && y.walk && y.walk.step === 0)));
  check('every phone is on card 1 (PUT YOUR THUMB DOWN), with the goal', yw.every((y) => y && y.down === false && y.keysIn === false));
  check('the big screen counts keys per team: 0/2', teamOf(w0, WX).keys === 0 && teamOf(w0, WX).size === 2);
  A.send({ t: 'hold', down: true });
  const w1 = await screen.wait('state', (f) => f.state.phase === 'walk' && teamOf(f, WX).keys === 1);
  check('one thumb down: KEYS IN 1/2, no practice pot yet', w1 && !teamOf(w1, WX).keysIn && teamOf(w1, WX).walkPot === 0);
  const aWait = await youWhen(A, (y) => y.phase === 'walk' && y.down && !y.keysIn);
  check("A's phone waits for B (WAITING FOR <B>)", aWait && aWait.mates[0].name === B.welcome.name && aWait.mates[0].down === false && aWait.walk.pot === 0);
  B.send({ t: 'hold', down: true });
  const w2 = await screen.wait('state', (f) => f.state.phase === 'walk' && teamOf(f, WX).keysIn);
  check('both down: KEYS IN 2/2', w2 && teamOf(w2, WX).keys === 2);
  await sleep(400);
  const grown = teamOf(screen.last.state, WX).walkPot;
  check('the practice pot grows while both hold', grown > 0, String(grown));
  const aIn = await youWhen(A, (y) => y.phase === 'walk' && y.keysIn && y.walk.since);
  check("the phone gets the growing practice pot", !!aIn);
  B.send({ t: 'hold', down: false });
  await screen.wait('state', (f) => f.state.phase === 'walk' && !teamOf(f, WX).keysIn);
  const stop1 = teamOf(screen.last.state, WX).walkPot; await sleep(300); const stop2 = teamOf(screen.last.state, WX).walkPot;
  check('one lets go: the practice pot stops at once', stop1 > 0 && stop1 === stop2, `${stop1} ${stop2}`);
  check('the walkthrough waits for every team', screen.last.state.state.walk.step === 0);
  const tA = Date.now();
  B.send({ t: 'hold', down: true }); C.send({ t: 'hold', down: true }); D.send({ t: 'hold', down: true });
  const wB = await screen.wait('state', (f) => f.state.phase === 'walk' && f.state.walk.step === 1);
  check('every team with both keys in: on to card 2 (well before 20 s)', wB && Date.now() - tA < HOLD.WALK_A_MS * SCALE * 0.6, `${Date.now() - tA} ms`);
  const wC = await screen.wait('state', (f) => f.state.phase === 'walk' && f.state.walk.step === 2);
  check('card 3 follows by itself', !!wC);
  P.forEach((c) => c.send({ t: 'hold', down: false }));
  // ---- PRACTICE: one easy scam, doesn't count; the big screen coaches at the red flag
  const pr = await screen.wait('state', (f) => f.state.phase === 'ready' && f.state.practice);
  check('then the practice round, labelled practice', pr && pr.state.practice === true);
  const yp0 = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'ready' && y.practice)));
  check('every phone knows it is practice', yp0.every((y) => !!y));
  P.forEach((c) => c.send({ t: 'hold', down: true }));
  const pp = await screen.wait('state', (f) => f.state.phase === 'play' && f.state.practice);
  check('practice plays the easiest scam (fixture: the bank alert)', pp && pp.state.message.sender === 'BANK');
  check('no coaching before the red flag', pp && pp.state.message.hint == null);
  const hinted = await screen.wait('state', (f) => f.state.phase === 'play' && f.state.practice && f.state.message.hint != null);
  check('the red-flag line lands: the big screen gets the LET GO hint', hinted && hinted.state.message.lines.length === hinted.state.message.hint + 1, hinted && JSON.stringify(hinted.state.message));
  A.send({ t: 'hold', down: false });
  const prv = await screen.wait('state', (f) => f.state.phase === 'reveal' && f.state.practice);
  const px = prv && prv.state.reveal.results.find((r) => r.members.includes(A.welcome.id));
  check('practice: A banked for the team, the others got caught', px && px.state === 'banked' && px.got > 0);
  const go = await screen.wait('state', (f) => f.state.phase === 'stage');
  check('after practice: the ACT 1 card (INBOX, no choice, x1)', go && go.state.stage.kind === 'act' && go.state.stage.act === 1 && go.state.stage.name === 'INBOX' && !go.state.stage.choice && go.state.stage.mult === 1, go && JSON.stringify(go.state.stage));
  const ygo = await youWhen(A, (y) => y.phase === 'stage' && y.stage && y.stage.kind === 'act' && y.stage.act === 1);
  check('the phones show the act 1 card too', !!ygo);
  A.send({ t: 'choose', pick: 'bold' }); await sleep(120);
  check('no SAFE/BOLD in act 1: a pick is ignored', !('pick' in lastYou(A)) && (pairOf(screen.last.state.state, A.welcome.id) || {}).pick == null);
  P.forEach((c) => c.send({ t: 'hold', down: false }));
  const ready0 = await screen.wait('state', phaseIs('ready', 0));
  check('then the first real message', !!ready0);
  check('practice points are not added: every team total is 0', ready0 && ready0.state.pairs.every((k) => k.total === 0));
  check('act 1 is x1 and knows its place (message 1 of 1 in act 1)', ready0 && ready0.state.mult === 1 && ready0.state.act && ready0.state.act.n === 1 && ready0.state.act.i === 0 && ready0.state.act.of === 1);
  const yr0 = await youWhen(A, (y) => y.phase === 'ready' && !y.practice);
  check("the phone's team total is still 0", yr0 && yr0.total === 0 && yr0.mult === 1);
  const K = ready0 ? ready0.state.pairs : [];
  check('even: 4 humans make 2 pairs of 2, no bots', K.length === 2 && K.every((k) => k.members.length === 2) && ready0.state.players.length === 4 && !ready0.state.players.some((p) => p.bot));
  const X = K.find((k) => k.members.includes(A.welcome.id)), Y = K.find((k) => k.members.includes(C.welcome.id));
  check('the pairs are the ones the phones made', X && Y && X.members.includes(B.welcome.id) && Y.members.includes(D.welcome.id));
  const y0 = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'ready' && y.index === 0)));
  check('no reader or holder roles any more: every phone has the ring', y0.every((y) => y && !('role' in y) && !('reader' in y) && !('holders' in y)));
  const totals = { [X.id]: 0, [Y.id]: 0 };
  const addUp = (rev) => { for (const r of rev.state.reveal.results) totals[r.id] += r.got; };
  const res = (rev, k) => rev.state.reveal.results.find((r) => r.id === k.id);

  // ---- both keys in: A down alone is not enough; B sees A's thumb live
  A.send({ t: 'hold', down: true });
  const bSeesA = await youWhen(B, (y) => y.phase === 'ready' && mateDown(B, true)(y));
  check("partner state: B's phone sees A HOLDING, live, by name", bSeesA && bSeesA.mates[0].name === A.welcome.name && bSeesA.mates[0].down === true);
  const oneKey = await screen.wait('state', (f) => f.state.phase === 'ready' && pl(f, A.welcome.id).down);
  check('one key in: the team is not ready (keysIn false)', oneKey && teamOf(oneKey, X).keysIn === false);
  B.send({ t: 'hold', down: true });
  const twoKeys = await screen.wait('state', (f) => f.state.phase === 'ready' && teamOf(f, X).keysIn);
  check('both keys in: the screen marks the team ready', !!twoKeys);
  const aSeesB = await youWhen(A, (y) => y.phase === 'ready' && y.keysIn === true);
  check("A's phone says BOTH KEYS IN", !!aSeesB);
  C.send({ t: 'hold', down: true }); D.send({ t: 'hold', down: true });

  // ---- message 1: scam. A pulls out: X banks for both. Y holds through the spring: caught.
  const play1 = await screen.wait('state', phaseIs('play', 0));
  check('every key in: the message starts early', !!play1);
  check('the big screen shows the sender, channel and button', play1 && play1.state.message.sender === 'BANK' && play1.state.message.channel === 'sms' && play1.state.message.action === 'SECURE ACCOUNT');
  const mid = await screen.wait('state', (f) => f.state.phase === 'play' && f.state.message.lines.length >= 2);
  check('the big screen builds the message line by line', mid && mid.state.message.lines[0] === 'BANK ALERT: new sign-in' && mid.state.message.lines.length < 5);
  check('the big screen never gets the kind or the red flag during play', mid && !('kind' in mid.state.message) && !('flagLine' in mid.state.message) && !mid.state.reveal);
  check('both teams hold from the start', mid && teamOf(mid, X).state === 'hold' && teamOf(mid, Y).state === 'hold');
  const ap = await youWhen(A, (y) => y.phase === 'play');
  check("a phone in play gets the ring and the button label, no message text", ap && ap.state === 'hold' && ap.action === 'SECURE ACCOUNT' && !ap.msg && !hasText(ap));
  // SPOTTED IT: A lets go once the red-flag line (line 4) is on the big screen, before the spring.
  await screen.wait('state', (f) => f.state.phase === 'play' && f.state.message.lines.length >= 4);
  A.send({ t: 'hold', down: false });
  // 17 Nov: no live tells. The release is confirmed only on the team's own phones; the TV sees nothing until the spring.
  const aB = await youWhen(A, (y) => y.phase === 'play' && y.state === 'banked');
  check("one release banks for the team: A's phone knows A pulled it", aB && aB.byMe === true && aB.got > 0);
  const bank = { event: { got: aB && aB.got } };
  check('act 1: the bank shown during play is the plain pot x1 (no bonus, no mark)', aB && aB.mult === 1 && !('mark' in aB) && !('bonus' in aB));
  const bB = await youWhen(B, (y) => y.phase === 'play' && y.state === 'banked');
  check("B (still holding) is banked too: SAM BANKED IT FOR YOU", bB && bB.got === bank.event.got && bB.by === A.welcome.name && bB.byMe === false);
  await sleep(250);
  const xb = screen.last.state.state;
  check('no live tells: mid-message the TV still shows X holding (no amount, no name, thumbs down, no pot bump)', xb.phase === 'play' && teamOf({ state: xb }, X).state === 'hold' && teamOf({ state: xb }, X).got === 0 && teamOf({ state: xb }, X).by === null && xb.players.filter((q) => q.pairId === X.id).every((q) => q.down) && xb.play.bonus === 0 && xb.play.holding === 2, JSON.stringify(teamOf({ state: xb }, X)));
  check('no release event reaches the TV', !screen.frames.some((f) => f.t === 'event' && f.event.kind === 'release'));
  check("other teams' phones learn nothing: Y's phone has no X state", (() => { const y = lastYou(C); return y && !JSON.stringify(y).includes(X.id); })());
  const bSeesUp = await youWhen(B, (y) => y.phase === 'play' && mateDown(B, false)(y));
  check("partner state: B's phone shows A LET GO", !!bSeesUp);
  const crash1 = await screen.wait('state', phaseIs('crash', 0));
  check('the scam springs on the server clock', crash1 && crash1.state.result.kind === 'spring');
  check('only the fully-holding team is caught', crash1 && JSON.stringify(crash1.state.result.caught) === JSON.stringify([Y.id]));
  check('the crash carries the pot that was lost', crash1 && crash1.state.result.potEnd > 0);
  const yc = await Promise.all([C, D].map((c) => youWhen(c, (y) => y.phase === 'crash')));
  check('both phones of the caught pair say TAPPED IT and the pot lost', yc.every((y) => y && y.state === 'caught' && y.got === 0 && y.lost > 0));
  const xc = await Promise.all([A, B].map((c) => youWhen(c, (y) => y.phase === 'crash')));
  const spotGot = bank.event.got + Math.round(bank.event.got * HOLD.SPOT_BONUS);
  check('SPOTTED IT: let go after the red flag, the bank lands +50% at the crash', xc.every((y) => y && y.state === 'banked' && y.mark === 'spotted' && y.got === spotGot && y.bonus === spotGot - bank.event.got && !y.lost), JSON.stringify(xc.map((y) => y && [y.mark, y.got, y.bonus])));
  check('the caught pair is marked TAPPED IT (act 1: no SAFE, nothing kept)', yc.every((y) => y && y.mark === 'tapped' && y.kept === 0));
  const rev1 = await screen.wait('state', phaseIs('reveal', 0));
  const top1 = rev1 && rev1.state.top3;
  check('TOP 3 appears at the first reveal, most revenue first', Array.isArray(top1) && top1.length === 2 && top1[0].total >= top1[1].total && top1.every((r) => / Ltd$/.test(r.name)), JSON.stringify(top1));
  check('the reveal shows the full message, the red-flag line and the lesson', rev1 && rev1.state.reveal.lines.length === 5 && rev1.state.reveal.flagLine === 3 && /never text/.test(rev1.state.reveal.teach));
  const x1 = res(rev1, X), y1 = res(rev1, Y);
  check('the leaderboard is per team: X banked (one pot, not two) +50%, Y got 0', x1 && x1.state === 'banked' && x1.got === spotGot && x1.mark === 'spotted' && y1.state === 'caught' && y1.got === 0 && y1.mark === 'tapped', JSON.stringify([x1, y1]));
  check('the reveal has the release strip: flag and end times, X let go after the flag', rev1.state.reveal.flagMs === 3 * 1800 && rev1.state.reveal.endMs === HOLD.endAt(holdContent.load(FIXTURE)[0]) && x1.rel >= rev1.state.reveal.flagMs && x1.rel < rev1.state.reveal.endMs && y1.rel == null);
  addUp(rev1);

  // ---- HOT FILE after act 1: Y was breached the most, so the file lands on Y. Y passes it to X; X defuses (pick 0).
  P.forEach((c) => c.send({ t: 'hold', down: false }));
  const hc = await screen.wait('state', (f) => f.state.phase === 'hot', 8000);
  const H0 = hc && hc.state.hot;
  check('end of act 1: the HOT FILE lands on Y (breached the most)', H0 && H0.holder.id === Y.id && H0.act === 1 && H0.step === 'landed', JSON.stringify(H0));
  const roles = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'hot' && y.hot)));
  check('phones know their side: C and D hold it, A and B watch', roles[2].hot.role === 'holder' && roles[3].hot.role === 'holder' && roles[0].hot.role === 'watch' && roles[1].hot.role === 'watch');
  host('skip');
  await screen.wait('state', (f) => f.state.phase === 'hot' && f.state.hot.step === 'choose', 4000);
  A.send({ t: 'hot', pick: 'defuse' }); // a watcher can't choose
  C.send({ t: 'hot', pick: 'pass' }); D.send({ t: 'hot', pick: 'pass' });
  const passed = await screen.wait('state', (f) => f.state.phase === 'hot' && f.state.hot.holder.id === X.id, 4000);
  check('C and D both PASS: it moves up to X', passed && passed.state.hot.passes === 1 && passed.state.hot.step === 'passed');
  host('skip');
  await screen.wait('state', (f) => f.state.phase === 'hot' && f.state.hot.step === 'choose' && f.state.hot.holder.id === X.id, 4000);
  A.send({ t: 'hot', pick: 'defuse' }); B.send({ t: 'hot', pick: 'defuse' });
  const pz = await screen.wait('state', (f) => f.state.phase === 'hot' && f.state.hot.step === 'puzzle', 4000);
  check('A and B both DEFUSE: the puzzle, with no answer on the wire', pz && pz.state.hot.puzzle && !('answer' in pz.state.hot.puzzle));
  const xBefore = teamOf(pz, X).total;
  A.send({ t: 'hot', pick: 0 }); B.send({ t: 'hot', pick: 0 });
  const hr = await screen.wait('state', (f) => f.state.phase === 'hot' && f.state.hot.step === 'result', 4000);
  const HR = hr && hr.state.hot.result;
  check('the defuse resolves: HERO with a bonus, or the hit', HR && HR.team.id === X.id && (HR.kind === 'hero' ? teamOf(hr, X).total === xBefore + HR.bonus && teamOf(hr, X).hero === 1 : teamOf(hr, X).total === xBefore - HR.amount), JSON.stringify(HR));
  totals[X.id] += teamOf(hr, X).total - xBefore;
  const hlog = () => fs.readFileSync(LOGFILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'hotfile');
  check('the hot file is in the playtest log (no names)', hlog().length === 1 && !JSON.stringify(hlog()).includes(A.welcome.name));
  host('skip');

  // ---- message 2: real. D is late: Y's pot cannot grow until both keys are in. Both hold to the end: x2.
  const up2 = await screen.wait('state', (f) => f.state.phase === 'stage');
  const t2 = Date.now();
  check('a new act: the ACT 2 card (THE BOSS IS IN A HURRY, x2) asks SAFE or BOLD', up2 && up2.state.stage.kind === 'act' && up2.state.stage.act === 2 && up2.state.stage.choice && up2.state.stage.mult === 2 && /BOSS/.test(up2.state.stage.name) && up2.state.stage.trick, up2 && JSON.stringify(up2.state.stage));
  check('every team starts CHOOSING on the big screen', up2 && up2.state.pairs.every((k) => k.pick === 'choosing'));
  const yUp = await youWhen(C, (y) => y.phase === 'stage' && y.stage.act === 2 && y.stage.choice);
  check('the phones get the choice with its deadline', yUp && yUp.stage.choiceEndsAt > yUp.now && yUp.pick === null);
  A.send({ t: 'choose', pick: 'bold' });
  const bSeesPick = await youWhen(B, (y) => y.phase === 'stage' && y.mates[0].pick === 'bold');
  check("B's phone sees A picked BOLD, X still choosing on the big screen", bSeesPick && bSeesPick.teamPick === 'choosing' && teamOf(screen.last.state, X).pick === 'choosing');
  B.send({ t: 'choose', pick: 'bold' }); C.send({ t: 'choose', pick: 'bold' }); D.send({ t: 'choose', pick: 'safe' });
  A.send({ t: 'choose', pick: 'maybe' });
  const picked = await screen.wait('state', (f) => f.state.phase === 'stage' && teamOf(f, X).pick === 'bold' && teamOf(f, Y).pick === 'safe');
  check('both BOLD = BOLD; a split pair plays SAFE', !!picked);
  const r1 = await screen.wait('state', phaseIs('ready', 1));
  check('every team picked: the card closes early (well before 15 s)', r1 && Date.now() - t2 < HOLD.ACT_CARD_MS * SCALE * 0.8, `${Date.now() - t2} ms`);
  check('act 2 is x2 and the pot grows faster', r1 && r1.state.mult === 2 && r1.state.speed > 1);
  check('the act keeps each team\'s pick', r1 && teamOf(r1, X).pick === 'bold' && teamOf(r1, Y).pick === 'safe');
  A.send({ t: 'choose', pick: 'safe' }); await sleep(100);
  check('the choice is closed after the card', teamOf(screen.last.state, X).pick === 'bold' && (lastYou(A) || {}).mode === 'bold');
  [A, B, C].forEach((c) => c.send({ t: 'hold', down: true }));
  const play2 = await screen.wait('state', phaseIs('play', 1));
  check('one key missing: the ready clock runs out, then it starts', !!play2);
  check('the team with one key in waits, its pot does not grow', play2 && teamOf(play2, Y).state === 'wait' && !teamOf(play2, Y).arm && teamOf(play2, X).state === 'hold');
  await sleep(300);
  const still = screen.last.state;
  check('still waiting while one key is out', teamOf(still, Y).state === 'wait');
  D.send({ t: 'hold', down: true });
  const armed = await screen.wait('state', (f) => f.state.phase === 'play' && teamOf(f, Y).state === 'hold');
  check('the last key in: the pot starts growing from then', armed && teamOf(armed, Y).arm && teamOf(armed, Y).arm.t > 0);
  const crash2 = await screen.wait('state', phaseIs('crash', 1));
  check('TOP 3 is frozen while message 2 plays and at its spring (totals move at the spring, the panel waits for the reveal)', play2.state.top3 && JSON.stringify(crash2.state.top3) === JSON.stringify(play2.state.top3) && crash2.state.top3.some((r) => r.total !== crash2.state.pairs.find((k) => k.id === r.id).total));
  check('a real message never springs: it doubles', crash2 && crash2.state.result.kind === 'double' && crash2.state.result.caught.length === 0);
  const rev2 = await screen.wait('state', phaseIs('reveal', 1));
  const x2 = res(rev2, X), y2 = res(rev2, Y);
  check('TOP 3 updates at the reveal', rev2.state.top3 && rev2.state.top3.some((r) => r.total === res(rev2, r).total) && JSON.stringify(rev2.state.top3) !== JSON.stringify(crash2.state.top3), JSON.stringify(rev2.state.top3));
  check('the crash carries the stage multiplier', crash2.state.result.mult === 2);
  check('held by all to the end: double the full pot, x2 for the act, x2 for BOLD (TRUSTED IT)', x2.state === 'dbl' && x2.mark === 'trusted' && x2.got === 2 * 2 * 2 * crash2.state.result.potEnd, `${x2.got} vs ${crash2.state.result.potEnd}`);
  check('the late team doubles a smaller pot', y2.state === 'dbl' && y2.got > 0 && y2.got < x2.got, `${y2.got} vs ${x2.got}`);
  addUp(rev2);

  // ---- END_EVENTS (19 Nov): act 2 ends with the RANSOMWARE tap duel (act 1 with the hot file). Y was breached the most:
  // Y is locked and duels X; nobody taps: a tie keeps the lock, Y pays 25%.
  const rc2 = await screen.wait('state', (f) => f.state.phase === 'ransom', 8000);
  check('end of act 2: the ransomware duel (END_EVENTS), Y locked against X', rc2 && rc2.state.ransom.act === 2 && rc2.state.ransom.locked.id === Y.id && rc2.state.ransom.rival.id === X.id, JSON.stringify(rc2 && rc2.state.ransom));
  const pre2 = { [X.id]: teamOf(rc2, X).total, [Y.id]: teamOf(rc2, Y).total };
  for (const st of ['count', 'mash', 'result']) { host('skip'); await screen.wait('state', (f) => f.state.phase === 'ransom' && f.state.ransom.step === st, 3000); }
  const paid2 = screen.last.state.state.phase === 'ransom' ? screen.last.state : null;
  check('... nobody tapped: a tie, Y pays the ransom', paid2 && paid2.state.ransom.result.kind === 'paid' && paid2.state.ransom.result.payer === Y.id, JSON.stringify(paid2 && paid2.state.ransom));
  totals[X.id] += teamOf(paid2, X).total - pre2[X.id]; totals[Y.id] += teamOf(paid2, Y).total - pre2[Y.id];
  host('skip');

  // ---- message 3: scam. Only C puts a key in: Y never arms and is not caught. A slips (<150 ms): no bank. Then B pulls out.
  P.forEach((c) => c.send({ t: 'hold', down: false }));
  const fin5 = await screen.wait('state', (f) => f.state.phase === 'stage');
  check('the last act opens with its own card, which says ALL IN (no extra card)', fin5 && fin5.state.stage.kind === 'act' && fin5.state.stage.act === 3 && fin5.state.stage.allIn === true && fin5.state.stage.choice);
  A.send({ t: 'choose', pick: 'bold' }); B.send({ t: 'choose', pick: 'bold' }); // Y never picks: SAFE when the choice closes
  const r2 = await screen.wait('state', phaseIs('ready', 2));
  check('nobody in Y picked: Y plays SAFE, X BOLD', r2 && teamOf(r2, X).pick === 'bold' && teamOf(r2, Y).pick === 'safe');
  check('the last message is x5, with act 3 lines every 1.4 s', r2 && r2.state.mult === 5 && r2.state.lineMs === 1400);
  check('no FINAL card in between', !screen.frames.some((f) => f.t === 'state' && f.state.phase === 'stage' && f.state.stage.kind === 'final'));
  const y5 = await youWhen(A, (y) => y.phase === 'ready' && y.index === 2);
  check('the phone shows x5 next to the pot', y5 && y5.mult === 5);
  [A, B, C, D].forEach((c) => c.send({ t: 'hold', down: true }));
  await screen.wait('state', phaseIs('play', 2));
  await sleep(150);
  A.send({ t: 'hold', down: false }); await sleep(30); A.send({ t: 'hold', down: true });
  await sleep(300);
  check('a slip under 150 ms does not bank', teamOf(screen.last.state, X).state === 'hold');
  B.send({ t: 'hold', down: false });
  const bY3 = await youWhen(B, (y) => y.phase === 'play' && y.index === 2 && y.state === 'banked');
  const bank3 = { event: { got: bY3 && bY3.got } };
  check('the last message: banked on the phone at x5', bY3 && bY3.mult === 5 && bY3.got > 0);
  const crash3 = await screen.wait('state', phaseIs('crash', 2));
  check('Y held through: caught', crash3 && crash3.state.result.caught.includes(Y.id));
  // ---- CONTAIN IT (act 3): Y's phones get the tap button, X's say watch the TV; C taps a little, D not at all: Y closes.
  const ct = await screen.wait('state', (f) => f.state.phase === 'crash' && f.state.contain && f.state.contain.step === 'mash', 3000);
  check('act 3 breach: CONTAIN IT on the TV for Y only', ct && ct.state.contain.teams.length === 1 && ct.state.contain.teams[0].id === Y.id && ct.state.contain.need === HOLD.CONTAIN.need);
  const cy = await youWhen(C, (y) => y.contain && y.contain.step === 'mash');
  const ax = await youWhen(A, (y) => y.contain && y.contain.step === 'mash');
  check("the breached phones tap; everyone else watches the TV", cy && cy.contain.role === 'contain' && ax && ax.contain.role === 'watch');
  C.send({ t: 'tap', n: 5 }); A.send({ t: 'tap', n: 5 });
  await sleep(150);
  const ct2 = screen.last.state.state;
  check('taps count for the breached company only', ct2.contain && ct2.contain.teams[0].score > 0 && ct2.contain.teams[0].score < HOLD.CONTAIN.need);
  host('skip');
  const cr = await screen.wait('state', (f) => f.state.phase === 'crash' && f.state.contain && f.state.contain.step === 'result', 3000);
  check('too few taps: Y is CLOSED', cr && cr.state.contain.teams[0].result === 'closed' && cr.state.market && cr.state.market.find((m) => m.id === Y.id).open === false);
  const yc3 = await youWhen(C, (y) => y.contain && y.contain.step === 'result');
  check("Y's phones: CLOSED", yc3 && yc3.contain.result === 'closed' && yc3.closed && yc3.closed.act === 3);
  const rev3 = await screen.wait('state', phaseIs('reveal', 2));
  const y3 = res(rev3, Y), x3 = res(rev3, X);
  check('SAFE: caught, Y keeps half of the pot', y3.state === 'caught' && y3.mark === 'tapped' && y3.lost > 0 && y3.kept === Math.round(y3.lost * HOLD.SAFE_KEEP) && y3.got === y3.kept, JSON.stringify(y3));
  const yk = await youWhen(C, (y) => y.phase === 'reveal' && y.index === 2);
  check("the caught phone hears what SAFE kept", yk && yk.kept === y3.kept && yk.mark === 'tapped');
  check('X banked by B before the red flag: LEFT EARLY, no bonus', x3.state === 'banked' && x3.mark === 'early' && x3.got === bank3.event.got && x3.by === pl(rev3, B.welcome.id).short && x3.rel < rev3.state.reveal.flagMs);
  addUp(rev3);

  check('the act 3 reveal: 1 OF 2 STILL OPEN, Y just closed', rev3.state.reveal.open && rev3.state.reveal.open.n === 1 && rev3.state.reveal.open.of === 2 && rev3.state.reveal.open.closedNow.includes(Y.id));
  // ---- no duel after act 3: closing time
  host('skip');

  // ---- final ranking, per team
  const fin = await screen.wait('state', (f) => f.state.phase === 'final');
  const rank = fin && fin.state.final.rows;
  check('after the last message: the final ranking has the 2 pairs', Array.isArray(rank) && rank.length === 2 && rank.every((r) => / & .* Ltd$/.test(r.name)));
  const aw = fin.state.final.awards, rx = rank.find((r) => r.id === X.id), ry = rank.find((r) => r.id === Y.id);
  check('the counts behind the awards: X spotted 1, early 1, trusted 1; Y tapped twice', rx.n.spotted === 1 && rx.n.early === 1 && rx.n.trusted === 1 && rx.n.taps === 0 && ry.n.taps === 2 && ry.n.trusted === 1, JSON.stringify([rx.n, ry.n]));
  check('no duel after act 3', !screen.frames.some((f) => f.t === 'state' && f.state.phase === 'ransom' && f.state.ransom.act === 3));
  check('HUMAN FIREWALL: most red flags spotted (X)', aw.firewall === X.id);
  check('LAST BUSINESS STANDING: X (open), Y closed ranks below', aw.lbs === X.id && rank[0].id === X.id && ry.closed && ry.closedAct === 3);
  check('TOP REVENUE: the most money', aw.revenue === [...rank].sort((a, b) => b.total - a.total)[0].id);
  check('the room counts 2 scams played (spotted x / 2)', fin.state.final.scams === 2);
  const ya = await youWhen(A, (y) => y.phase === 'final');
  check("A's phone: you won HUMAN FIREWALL and LAST BUSINESS STANDING, spotted 1 of 2", ya && ya.awards.includes('firewall') && ya.awards.includes('lbs') && ya.n.spotted === 1 && ya.scams === 2);
  check("A's phone: the company report (STILL TRADING #1)", ya && ya.report && ya.report.rank === 1 && !ya.report.closedAct && ya.report.scams === 2 && typeof ya.report.uptime === 'number');
  const yc2 = await youWhen(C, (y) => y.phase === 'final');
  check("C's phone: no firewall, tapped 2, report CLOSED IN ACT 3", yc2 && !yc2.awards.includes('firewall') && yc2.n.taps === 2 && yc2.report && yc2.report.closedAct === 3);
  check('ranked open first, then by total', rank.every((r, i) => i === 0 || (!!rank[i - 1].closed < !!r.closed) || (!!rank[i - 1].closed === !!r.closed && (r.closed || rank[i - 1].total >= r.total))));
  check('team totals are the sum of each message', rank.every((r) => r.total === totals[r.id]), JSON.stringify(rank.map((r) => [r.name, r.total, totals[r.id]])));
  const fy = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'final')));
  check("each phone gets its team's rank and total", fy.every((y, i) => { const r = rank.find((q) => q.id === pairOf(ready0.state, P[i].welcome.id).id); return y && y.total === r.total && y.rank === r.rank; }));

  // ---- privacy over the whole match
  const pack = holdContent.load(FIXTURE);
  check('no phone frame ever carries message text', !P.some((c) => c.frames.some((f) => f.t === 'you' && hasText(f.you))));
  check('no phone frame carries the lesson, the kind or the red flag', !P.some((c) => pack.some((m) => m.teach && c.raw.includes(m.teach)) || /"(scam|real)"|flagLine/.test(c.raw)));
  const playFrames = screen.frames.filter((f) => f.t === 'state' && f.state.phase === 'play');
  check('the big screen never gets lines ahead of the clock', playFrames.every((f) => f.state.message.lines.length <= f.state.message.total) && playFrames.some((f) => f.state.message.lines.length < f.state.message.total));
  check('during play the screen gets the disguise but never the persona under it', playFrames.every((f) => typeof f.state.message.disguise === 'string' && !('persona' in f.state.message)));
  check('no phone frame carries a mark or a bonus before the crash', !P.some((c) => c.frames.some((f) => f.t === 'you' && ['ready', 'play', 'stage'].includes(f.you.phase) && ('mark' in f.you || 'bonus' in f.you))));
  check('the big screen gets no mark or bonus during play', playFrames.every((f) => f.state.pairs.every((k) => !('mark' in k) && !('bonus' in k))));
  check('no phone frame gets a persona before the scam springs', !P.some((c) => c.frames.some((f) => f.t === 'you' && f.you.persona && !['crash', 'reveal'].includes(f.you.phase))));
  // Security review 18 Nov #1: the end of a message (the spring time for a scam) gave the answer away.
  check('no screen state during play carries when the message ends', playFrames.length > 0 && playFrames.every((f) => !f.state.phaseEndsAt));
  check('no phone frame during play carries when the message ends', P.every((c) => c.frames.filter((f) => f.t === 'you' && f.you.phase === 'play').every((f) => !f.you.phaseEndsAt)));
  check('real messages never get the coaching hint', !playFrames.filter((f) => !f.state.practice).some((f) => 'hint' in f.state.message));
  check('the screen never got the kind, flag line or lesson during play', !playFrames.some((f) => f.state.reveal || 'kind' in f.state.message || 'flagLine' in f.state.message || pack.some((m) => m.teach && JSON.stringify(f.state).includes(m.teach))));

  // ---- the playtest log: one line per team per message, no names
  const logRows = LOGFILE && fs.existsSync(LOGFILE) ? fs.readFileSync(LOGFILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.pin === pin && !r.type) : [];
  check('the playtest log has a line per team per message (practice included, flagged; duels on their own rows)', logRows.length === 8 && logRows.filter((r) => r.practice).length === 2, String(logRows.length));
  const lx = logRows.find((r) => !r.practice && r.index === 0 && r.team === X.id);
  check('a log line carries act, message, mark, release vs flag and the pick', lx && lx.act === 1 && lx.id === 'bank-alert' && lx.mark === 'spotted' && lx.releaseMs >= lx.flagMs && lx.springMs > lx.releaseMs && lx.choice === null, JSON.stringify(lx));
  check('the log never carries a name or a token', !logRows.some((r) => JSON.stringify(r).includes(A.welcome.name) || JSON.stringify(r).includes(A.welcome.token)));
  check('the log knows each act\'s pick', logRows.some((r) => r.index === 1 && r.team === X.id && r.choice === 'bold'));

  // ---- host: NEW MATCH, same PIN, back to the lobby
  host('again');
  const back = await screen.wait('state', (f) => f.state.phase === 'lobby');
  check('NEW MATCH: same PIN, lobby, totals back to 0, the pairs stay together', back && back.state.pin === pin && back.state.players.every((p) => p.total === 0) && back.state.pairs.length === 2);
  [screen, ...P].forEach((c) => c.close());
}
const pl = (f, id) => f.state.players.find((p) => p.id === id) || {};

async function codeOf(c) { const y = await youWhen(c, (q) => q.phase === 'lobby' && q.code); return y && y.code; }

async function odd(port) {
  console.log('Odd: a pair code stays good for one more: a trio, three keys, one pot');
  const { screen, P, host } = await lobbyWith(port, 3);
  const [A, B, C] = P;
  B.send({ t: 'pair', code: await codeOf(A) });
  const ab = await youWhen(B, (y) => y.pair && y.pair.mates.length === 1);
  check("a pair's code is still shown (good for one more person)", ab && /^\d{3}$/.test(ab.code));
  C.send({ t: 'pair', code: ab.code });
  const ys = await Promise.all(P.map((c) => youWhen(c, (y) => y.pair && y.pair.mates.length === 2)));
  check('the third neighbour typed it: a trio, every phone names its two partners', ys.every((y) => !!y));
  check('a full trio shows no code any more', ys.every((y) => y && !y.code));
  const D = await client(port); D.send({ t: 'join', role: 'player', pin: (await screen.wait('state')).state.pin }); await D.wait('welcome');
  D.send({ t: 'pair', code: ab.code });
  check('a fourth cannot join a trio', !!(await D.wait('pair_bad')));
  D.close();
  await screen.wait('state', (f) => f.state.players.length === 3);
  host('start');
  await pastIntro(screen, host);
  const r0 = await screen.wait('state', phaseIs('ready', 0));
  const human = r0.state.pairs.filter((k) => !k.bot);
  const T = human[0];
  check('the trio plays as one team', human.length === 1 && T.members.length === 3 && P.every((c) => T.members.includes(c.welcome.id)));
  check('a bot pair fills the room to 2 teams, no bot partners', r0.state.pairs.length === 2 && r0.state.pairs.some((k) => k.bot && k.members.length === 2) && !T.members.some((id) => pl(r0, id).bot));
  A.send({ t: 'hold', down: true }); B.send({ t: 'hold', down: true });
  await sleep(500);
  const two = screen.last.state.state;
  check('trio: two keys of three is not ready', two.phase === 'ready' && teamOf({ state: two }, T).keysIn === false);
  const cSees = await youWhen(C, (y) => y.mates && y.mates.length === 2 && y.mates.every((m) => m.down));
  check("trio: the third phone sees both partners' thumbs", !!cSees);
  C.send({ t: 'hold', down: true });
  await screen.wait('state', phaseIs('play', 0));
  const hy = await Promise.all(P.map((c) => youWhen(c, (y) => y.phase === 'play' && y.state === 'hold')));
  check('trio: all three phones have the ring, no text', hy.every((y) => y && !hasText(y)));
  await sleep(250); C.send({ t: 'hold', down: false });
  const cr = await screen.wait('state', phaseIs('crash', 0));
  const t0 = teamOf(cr, T);
  check('trio: one release banks for all three, none caught', t0.state === 'banked' && t0.got > 0 && !cr.state.result.caught.includes(T.id));
  const yb = await Promise.all([A, B].map((c) => youWhen(c, (y) => y.phase === 'crash')));
  check("trio: the others' phones say who banked it", yb.every((y) => y && y.state === 'banked' && y.by === C.welcome.name && y.got === t0.got));
  const rv = await screen.wait('state', phaseIs('reveal', 0));
  const row = rv.state.reveal.results.find((r) => r.id === T.id);
  check('the trio scores its one pot (no average, no triple)', row && row.got === t0.got);
  check('pairs and trios share one leaderboard', rv.state.reveal.results.length === 2 && rv.state.reveal.results.some((r) => r.bot));
  host('skip');
  await screen.wait('state', phaseIs('ready', 1));
  C.send({ t: 'hold', down: true });
  const cr1 = await screen.wait('state', phaseIs('crash', 1));
  const rv1 = await screen.wait('state', phaseIs('reveal', 1));
  const row1 = rv1.state.reveal.results.find((r) => r.id === T.id);
  check('a trio holding to the end scores one double, not three', row1 && row1.state === 'dbl' && row1.got === 2 * cr1.state.result.mult * cr1.state.result.potEnd);
  [screen, ...P].forEach((c) => c.close());
}

// OWN NAMES + CHARACTERS (19 Nov, Angelo): the only free text in HOLD. names.js checks it; the server makes it unique;
// the host can reset any name live; the TV and other phones only ever get it as data (the pages escape it).
async function names(port) {
  console.log('Own names + characters: profile, checks, uniqueness, host RENAME');
  const N = require('../server/hold/names');
  const ok = (n) => N.cleanName(n).ok;
  check('names: 2-12 letters/digits/space/-/\' are fine, any script', ok('Sam') && ok('Zoë') && ok('José-Luis') && ok("O'Brien") && ok('Naledi M') && ok('Thandi 2') && ok('Сергей'));
  check('names: too short, too long, emoji, tags, control and zero-width characters are refused', !ok('a') && !ok('ThisNameIsWayTooLong') && !ok('😀😀') && !ok('<b>x</b>') && !ok('ab\u0007') && !ok('\u200bab') && !ok('a\u0301\u0301\u0301'));
  check('names: slurs and profanity are refused, leetspeak too; ordinary surnames are fine', !ok('fuck') && !ok('F u c k') && !ok('N1gg4') && !ok('kaffir') && !ok('Dick') && ok('Hancock') && ok('Draper') && ok('Pakenham') && ok('Dickson'));
  check('names: spaces trimmed and collapsed', N.cleanName('  Thandi   M ').name === 'Thandi M');
  const { screen, P: [a, b], hostToken } = await lobbyWith(port, 2);
  const ya = await youWhen(a, (y) => y.phase === 'lobby');
  check('a new phone has not set a profile yet (the phone asks once)', ya && ya.named === false && ya.av === null);
  a.send({ t: 'profile', name: '  Sam ', av: 3 });
  const pa = await a.wait('profile');
  check('a good name + character is accepted', pa && pa.ok === true);
  const sa = await screen.wait('state', (f) => f.state.players.some((p) => p.name === 'Sam' && p.av === 3));
  check('the TV gets the chosen name and character', !!sa);
  b.send({ t: 'profile', name: 'sam', av: 1 });
  await b.wait('profile');
  const sb = await screen.wait('state', (f) => f.state.players.some((p) => p.id === b.welcome.id && p.name === 'sam 2'));
  check('a duplicate name gets a number', !!sb);
  b.send({ t: 'profile', name: '<img src=x onerror=alert(1)>', av: 99 });
  const pb = await b.wait('profile');
  check('markup in a name is refused (and a bad character index ignored)', pb && pb.ok === false && !screen.raw.includes('<img'));
  b.send({ t: 'profile', name: 'Sh1t', av: 2 });
  const pc = await b.wait('profile');
  check('a rude name gets "pick another name"', pc && pc.ok === false && /another/i.test(pc.message));
  a.send({ t: 'host', token: hostToken, cmd: 'rename', id: b.welcome.id });
  await sleep(150);
  check('a phone cannot use the host RENAME', lastYou(b) && lastYou(b).name === 'sam 2');
  screen.send({ t: 'host', token: hostToken, cmd: 'rename', id: a.welcome.id });
  const ra = await screen.wait('state', (f) => { const p = f.state.players.find((q) => q.id === a.welcome.id); return p && p.name !== 'Sam'; });
  const pa2 = ra && ra.state.players.find((q) => q.id === a.welcome.id);
  check('host RENAME: the name goes back to a random one, the character stays', pa2 && pa2.av === 3 && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(pa2.name), pa2 && pa2.name);
  const ya2 = await youWhen(a, (y) => y.name === pa2.name);
  check('... and the phone hears its new name', !!ya2);
  a.send({ t: 'pair', code: b.welcome && lastYou(b).code });
  const pr = await screen.wait('state', (f) => f.state.pairs.some((k) => k.members.length === 2 && !k.bot));
  const lab = pr && pr.state.pairs.find((k) => k.members.length === 2 && !k.bot).label;
  check('the company name uses the chosen names', lab && lab.includes('sam 2') && / Ltd$/.test(lab), lab);
  [screen, a, b].forEach((c) => c.close());
}

async function solo(port) {
  console.log('Solo: one key, the same rules alone; host skip and restart');
  const { screen, P: [me], pin, host } = await lobbyWith(port, 1);
  host('start');
  await screen.wait('state', (f) => f.state.phase === 'walk');
  host('skip');
  const sk = await screen.wait('state', (f) => f.state.phase !== 'walk', 1500);
  check('host SKIP (K) in the walkthrough jumps to the practice round', sk && sk.state.phase === 'ready' && sk.state.practice === true);
  await pastIntro(screen, host);
  const r0 = await screen.wait('state', phaseIs('ready', 0));
  const mine = r0 && pairOf(r0.state, me.welcome.id);
  check('1 human, unpaired at START: a SOLO team of one, no bot partner', mine && mine.members.length === 1 && mine.solo === true);
  check('a bot pair fills the room to 2 teams', r0.state.pairs.length === 2 && r0.state.players.length === 3);
  const y0 = await youWhen(me, (y) => y.phase === 'ready' && y.solo);
  check('the phone knows it plays SOLO (no partner)', y0 && y0.solo === true && !(y0.mates || []).length);
  me.send({ t: 'hold', down: true });
  const k1 = await screen.wait('state', (f) => f.state.phase === 'ready' && teamOf(f, mine).keysIn);
  check('SOLO: one key is both keys', !!k1);
  await screen.wait('state', phaseIs('play', 0));
  const yp = await youWhen(me, (y) => y.phase === 'play' && y.state === 'hold');
  check('SOLO: the phone gets the ring and the button, no message text', yp && yp.action === 'SECURE ACCOUNT' && !yp.msg && !hasText(yp));
  await sleep(200); me.send({ t: 'hold', down: false });
  const rev = await screen.wait('state', phaseIs('reveal', 0));
  const row = rev && rev.state.reveal.results.find((r) => r.id === mine.id);
  check('SOLO scores on the same leaderboard', row && row.state === 'banked' && row.got > 0 && row.solo, JSON.stringify(row));
  host('skip');
  await screen.wait('state', phaseIs('ready', 1));
  const y1 = await youWhen(me, (y) => y.phase === 'ready' && y.index === 1);
  check('SOLO stays SOLO next message', y1 && y1.solo === true);
  me.send({ t: 'hold', down: true });
  host('skip');
  check('host SKIP in ready starts the message now', !!(await screen.wait('state', phaseIs('play', 1), 1000)));
  host('skip');
  check('host SKIP in play ends it now', !!(await screen.wait('state', phaseIs('crash', 1), 1000)));
  host('skip');
  check('host SKIP in the crash goes to the reveal', !!(await screen.wait('state', phaseIs('reveal', 1), 1000)));
  host('ransom');
  const rn = await screen.wait('state', (f) => f.state.phase === 'hot', 1000);
  check('host HOT FILE NOW (the ransom key): the file lands on the human team at once', rn && rn.state.hot.holder.id === mine.id);
  const yw = await youWhen(me, (y) => y.phase === 'hot');
  check('the phone knows it holds it and gets no message text', yw && yw.hot.role === 'holder' && !hasText(yw));
  for (let i = 0; i < 8; i++) { if (screen.last.state.state.phase !== 'hot') break; host('skip'); await sleep(50); }
  const back = await screen.wait('state', (f) => f.state.phase !== 'hot', 3000);
  check('after the hot file the match carries on from the reveal', back && ['stage', 'quiz', 'ready'].includes(back.state.phase), back && back.state.phase);
  host('duel');
  const dn = await screen.wait('state', (f) => f.state.phase === 'ransom', 1000);
  check('host RANSOMWARE DUEL NOW (D): the human team is locked against a bot team', dn && dn.state.ransom.locked.id === mine.id && dn.state.ransom.rival.bot === true, JSON.stringify(dn && dn.state.ransom));
  for (let i = 0; i < 8; i++) { if (screen.last.state.state.phase !== 'ransom') break; host('skip'); await sleep(50); }
  const back2 = await screen.wait('state', (f) => f.state.phase !== 'ransom', 3000);
  check('... and the match carries on after it', !!back2);
  host('skip');
  host('again');
  const lob = await screen.wait('state', (f) => f.state.phase === 'lobby');
  check('NEW MATCH drops the bots, keeps the human (unpaired again)', lob && lob.state.players.length === 1 && !lob.state.players[0].bot && lob.state.pairs.length === 0);
  host('reset');
  const re = await screen.wait('state', (f) => f.state.pin !== pin);
  check('RESET LOBBY: new PIN, no players', re && /^\d{6}$/.test(re.state.pin) && re.state.players.length === 0);
  [screen, me].forEach((c) => c.close());
}

// Security review 18 Nov #2: pairing only in the lobby, a code-guess budget per address that a fresh socket can't reset,
// and a partner whose phone drops mid-match can't freeze the team.
async function pairing(port) {
  console.log('Security: pair codes');
  const { screen, P: [A, B], host } = await lobbyWith(port, 2);
  const code = await codeOf(A);
  // Guessing from fresh sockets (the old per-phone budget reset on every reconnect): the address runs out.
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    const x = await client(port); x.send({ t: 'join', role: 'player', pin: screen.last.state.state.pin }); await x.wait('welcome');
    for (let j = 0; j < 4 && !blocked; j++) { x.send({ t: 'pair', code: String(100 + i * 4 + j === Number(code) ? 999 : 100 + i * 4 + j) }); const f = await x.wait('pair_bad'); if (f && /Too many/.test(f.message)) blocked = true; }
    x.close(); await sleep(20);
  }
  check('wrong pair codes from one address run out, even across fresh sockets', blocked);
  await sleep(50);
  host('start');
  await pastIntro(screen, host);
  const L = await client(port); L.send({ t: 'join', role: 'player', pin: screen.last.state.state.pin }); await L.wait('welcome');
  L.send({ t: 'pair', code });
  const lb = await L.wait('pair_bad');
  check('a late joiner cannot pair into a team mid-match', lb && /before the match/i.test(lb.message), lb && lb.message);
  const r0 = await screen.wait('state', phaseIs('ready', 0));
  const k = pairOf(r0.state, A.welcome.id);
  check('... the team stays as it was (A plays SOLO)', k && k.members.length === 1, k && String(k.members.length));
  L.close();
  [screen, A, B, L].forEach((c) => c.close());
}

// 19 Nov QA, over sockets: a phone that refreshes or switches app mid-message does not lock in for its team; host
// PAUSE holds at the next break and END MATCH goes straight to closing time.
async function drops(port) {
  console.log('Phone drops and host PAUSE / END MATCH over sockets (19 Nov QA)');
  const { screen, P: [A, B], host, pin } = await lobbyWith(port, 2);
  B.send({ t: 'pair', code: await codeOf(A) });
  await youWhen(B, (y) => y.pair && y.pair.mates.length === 1);
  host('start');
  await pastIntro(screen, host);
  await screen.wait('state', phaseIs('ready', 0));
  A.send({ t: 'hold', down: true }); B.send({ t: 'hold', down: true });
  await screen.wait('state', phaseIs('play', 0));
  await youWhen(A, (y) => y.phase === 'play' && y.state === 'hold', 3000);
  B.send({ t: 'hold', down: false, away: true }); // B's phone: app switch / screen lock
  const ya = await youWhen(A, (y) => y.phase === 'play' && y.mates && y.mates.length && y.mates[0].down === false, 3000);
  const yb = await youWhen(B, (y) => y.phase === 'play' && y.away, 3000);
  check('app switch mid-message: the team does NOT lock in, A still holds', ya && ya.state === 'hold', JSON.stringify(ya && ya.state));
  check("... B's phone says it stepped away for this message", !!yb);
  // A refresh (close + reconnect with the same token) is the same: absent, no bank.
  const tok = B.welcome.token; B.close();
  await screen.wait('state', (f) => (f.state.players.find((p) => p.id === B.welcome.id) || {}).connected === false);
  const B2 = await client(port); B2.send({ t: 'join', role: 'player', pin, token: tok }); await B2.wait('welcome');
  B2.send({ t: 'hold', down: true });
  await sleep(150);
  const yb2 = lastYou(B2), ya2 = lastYou(A);
  check('back after a refresh mid-message: released for this message, the team still holds', yb2 && yb2.away === true && ya2 && ya2.state === 'hold', JSON.stringify({ b: yb2 && yb2.away, a: ya2 && ya2.state }));
  host('pause');
  const ps = await screen.wait('state', (f) => f.state.paused === true, 3000);
  check('host PAUSE mid-message: the TV knows, the message plays on', ps && ps.state.phase === 'play');
  const held = await screen.wait('state', (f) => f.state.phase === 'reveal' && f.state.held === true, 8000);
  check('... and the game holds at the reveal', !!held);
  await sleep(600);
  check('... still held', screen.last.state.state.phase === 'reveal');
  host('pause');
  const moved = await screen.wait('state', (f) => f.state.phase !== 'reveal' && f.state.paused === false, 5000);
  check('PAUSE again resumes', !!moved, JSON.stringify(screen.last.state.state.phase));
  host('end');
  const fin = await screen.wait('state', (f) => f.state.phase === 'final', 5000);
  check('host END MATCH: straight to closing time', !!fin);
  [screen, A, B2].forEach((c) => c.close());
}

async function ghost(port) {
  console.log('Security: a partner whose phone dies mid-match does not freeze the team');
  const { screen, P: [A, B], host } = await lobbyWith(port, 2);
  B.send({ t: 'pair', code: await codeOf(A) });
  await youWhen(B, (y) => y.pair && y.pair.mates.length === 1);
  host('start');
  await pastIntro(screen, host);
  const r0 = await screen.wait('state', phaseIs('ready', 0));
  const k = pairOf(r0.state, A.welcome.id);
  B.close();
  await screen.wait('state', (f) => (f.state.players.find((p) => p.id === B.welcome.id) || {}).connected === false);
  A.send({ t: 'hold', down: true });
  host('skip');
  await screen.wait('state', phaseIs('play', 0));
  const y = await youWhen(A, (q) => q.phase === 'play' && q.state === 'hold', 2000);
  check('the partner who is still here holds alone: the pot grows', !!y, JSON.stringify(lastYou(A) && lastYou(A).state));
  [screen, A].forEach((c) => c.close());
}

// Security review 18 Nov #3: /hold/ws had no connection caps, and a socket that stops
// reading made the server's memory grow. A second server with small caps.
async function caps(port) {
  console.log('Security: connection caps on /hold/ws');
  const srv = await boot(port, { MAX_CONN_PER_IP: '6', HOLD_MAX_VIEWERS: '2', HOLD_LOG_MAX_BYTES: '50' });
  try {
    const socks = [];
    for (let i = 0; i < 6; i++) socks.push(await client(port));
    const extra = await client(port);
    const closed = await new Promise((res) => { extra.ws.on('close', (code) => res(code)); setTimeout(() => res(null), 1500); });
    check('one address past MAX_CONN_PER_IP is refused (1013)', closed === 1013, String(closed));
    socks.forEach((c) => c.close()); await sleep(150);
    const again = await client(port);
    const stillOpen = await new Promise((res) => { again.ws.on('close', () => res(false)); setTimeout(() => res(true), 500); });
    check('closed sockets free their slots', stillOpen);
    // View-only screens per lobby are capped (each one gets the whole state 10 times a second).
    again.send({ t: 'join', role: 'screen', createLobby: true });
    const w = await again.wait('welcome');
    const v = [];
    for (let i = 0; i < 3; i++) { const c = await client(port); c.send({ t: 'join', role: 'screen', pin: w.pin }); v.push(c); }
    const third = await v[2].wait('error', () => true, 1500);
    check('a lobby takes only HOLD_MAX_VIEWERS view-only screens', !!(await v[0].wait('welcome')) && !!(await v[1].wait('welcome')) && !!third, third && third.message);
    [again, ...v].forEach((c) => c.close());
    await sleep(100);
    // Security review 18 Nov #6: the playtest log stops growing at HOLD_LOG_MAX_BYTES.
    const logf = path.join(srv.stateDir, 'hold-log.jsonl');
    fs.writeFileSync(logf, 'x'.repeat(60) + '\n');
    const { screen, P: [me], host } = await lobbyWith(port, 1);
    host('start');
    await pastIntro(screen, host); // the practice round writes its rows at the reveal
    check('the playtest log stops growing past its cap', fs.statSync(logf).size === 61, String(fs.statSync(logf).size));
    [screen, me].forEach((c) => c.close());
  } finally { srv.kill(); }
}

{ // Security review 18 Nov #3: a socket that stops reading is dropped once its send buffer passes 1 MB.
  const { send } = require('../server/hold/room');
  const fake = (buffered) => ({ OPEN: 1, readyState: 1, bufferedAmount: buffered, sent: 0, gone: false, send() { this.sent++; }, terminate() { this.gone = true; } });
  const slow = fake(2 * 1024 * 1024), ok = fake(1000);
  send(slow, { t: 'state' }); send(ok, { t: 'state' });
  check('a socket with more than 1 MB unsent is cut off, not fed more', slow.gone && slow.sent === 0 && !ok.gone && ok.sent === 1);
}

// Security review 18 Nov #4: mid-match, phones that join and leave without ever playing used to keep their seats for
// the whole match, so 60 throwaway joins made the game "full" for a real late delegate.
async function seats(port) {
  console.log('Security: throwaway joins mid-match free their seats');
  const { screen, P: [A], pin, host } = await lobbyWith(port, 1);
  host('start');
  await pastIntro(screen, host);
  const junk = [];
  for (let i = 0; i < HOLD.MAX_PLAYERS - 1; i++) { const c = await client(port); c.send({ t: 'join', role: 'player', pin }); await c.wait('welcome'); junk.push(c); }
  const full = await client(port); full.send({ t: 'join', role: 'player', pin });
  const e = await full.wait('error', () => true, 2000);
  check('60 humans: the next phone is told the game is full', e && /full/.test(e.message));
  full.close(); junk.forEach((c) => c.close());
  await sleep(HOLD.GONE_SEAT_MS * SCALE + 1500);
  const late = await client(port); late.send({ t: 'join', role: 'player', pin });
  const w = await late.wait('welcome', () => true, 3000);
  check('after the grace, a real late delegate gets a seat', !!w);
  [screen, A, late].forEach((c) => c.close());
}

// Security review 18 Nov #5: 20 wrong PINs from the venue's one shared address locked every new phone out for a minute.
// Now a socket is cut off after a few wrong PINs, and only a flood (PIN_MAX_FAILS a minute) blocks an address.
async function pins(port) {
  console.log('Security: wrong PINs do not lock the venue out');
  const screen = await client(port);
  screen.send({ t: 'join', role: 'screen', createLobby: true });
  const { pin } = await screen.wait('welcome');
  const wrong = pin === '111111' ? '222222' : '111111';
  for (let i = 0; i < 6; i++) {
    const x = await client(port);
    for (let j = 0; j < 5; j++) x.send({ t: 'join', role: 'player', pin: wrong });
    await sleep(60); x.close();
  }
  const me = await client(port); me.send({ t: 'join', role: 'player', pin });
  const w = await me.wait('welcome', () => true, 2000);
  check('30 wrong PINs from the shared address, then the right one: still let in', !!w, JSON.stringify(me.last.pin_bad || {}));
  const y = await client(port);
  const gone = new Promise((res) => { y.ws.on('close', () => res(true)); setTimeout(() => res(false), 2000); });
  for (let j = 0; j < 8; j++) y.send({ t: 'join', role: 'player', pin: wrong });
  check('one socket that keeps guessing is cut off', await gone);
  [screen, me].forEach((c) => c.close());
}

// Security review 18 Nov #7: with the lobby cap reached by empty lobbies, a new TV was refused. Now the oldest lobby that
// no phone ever joined is closed to make room; a lobby with players is never touched.
async function lobbies(port) {
  console.log('Security: empty lobbies make room for a new TV');
  const srv = await boot(port, { HOLD_MAX_ROOMS: '2', HOLD_EMPTY_LOBBY_EVICT_MS: '200' });
  try {
    const real = await lobbyWith(port, 1);
    const junk = await client(port); junk.send({ t: 'join', role: 'screen', createLobby: true }); await junk.wait('welcome');
    await sleep(300);
    const tv = await client(port); tv.send({ t: 'join', role: 'screen', createLobby: true });
    const w = await tv.wait('welcome', () => true, 1500);
    const kicked = await junk.wait('error', () => true, 1500);
    check('cap reached: the empty lobby is closed and the new TV gets one', !!(w && w.pin) && !!kicked, JSON.stringify(tv.last.error || {}));
    const tv2 = await client(port); tv2.send({ t: 'join', role: 'screen', createLobby: true });
    const e2 = await tv2.wait('error', () => true, 1500);
    check('a lobby with a phone in it is never closed to make room', !!e2 && !(await real.screen.wait('error', () => true, 300)));
    [real.screen, ...real.P, junk, tv, tv2].forEach((c) => c.close());
  } finally { srv.kill(); }
}

async function leftover(port) {
  console.log('Unpaired at START next to a pair: SOLO, no trio forced');
  const { screen, P, host } = await lobbyWith(port, 3);
  P[1].send({ t: 'pair', code: await codeOf(P[0]) });
  await youWhen(P[1], (y) => y.pair && y.pair.mates.length === 1);
  host('start');
  const t0 = Date.now();
  await screen.wait('state', (f) => f.state.phase === 'walk');
  const wb = await screen.wait('state', (f) => f.state.phase === 'walk' && f.state.walk.step === 1, 12000);
  check('nobody puts a thumb down: card 1 moves on after 20 s anyway', wb && Date.now() - t0 >= HOLD.WALK_A_MS * SCALE * 0.9, `${Date.now() - t0} ms`);
  await pastIntro(screen, host);
  const r0 = await screen.wait('state', phaseIs('ready', 0));
  const k = r0 && pairOf(r0.state, P[2].welcome.id);
  check('the unpaired one plays SOLO', k && k.members.length === 1 && k.solo);
  check('2 teams already: no bots at all', r0 && r0.state.pairs.length === 2 && !r0.state.players.some((p) => p.bot));
  [screen, ...P].forEach((c) => c.close());
}

async function pages(port) {
  console.log('Pages');
  for (const [p, re] of [['/', /HOLD/], ['/play', /HOLD/], ['/screen', /HOLD/], ['/hold/screen', /HOLD/], ['/hold/play', /HOLD/], ['/hold', /HOLD/]]) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`); const body = await r.text();
    check(`GET ${p} serves its page`, r.status === 200 && re.test(body));
  }
  const bad = await fetch(`http://127.0.0.1:${port}/../server/server.js`);
  check('no path outside public/', bad.status !== 200 || !/createHub/.test(await bad.text()));
}

(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  let srv;
  try {
    {
      const { r, a, b } = globalThis.__botRoom;
      await sleep(HOLD.RANSOM.mashMs * 0.05 * 0.5); // half the mash, game time 4 s
      const sa = r.mashScore(a), sb = r.mashScore(b);
      check('bots mash at a human rate: 5-8 taps a second (about 20-32 in 4 s)', sa >= 14 && sa <= 36 && sb >= 14 && sb <= 36, `${sa} ${sb}`);
      r.dispose();
    }
    srv = await boot(port);
    LOGFILE = path.join(srv.stateDir, 'hold-log.jsonl');
    await match(port);
    await odd(port);
    await pairing(port);
    await ghost(port);
    await drops(port);
    await leftover(port);
    await pins(port);
    await seats(port);
    await caps(port + 1);
    await lobbies(port + 2);
    await names(port);
    await solo(port);
    await pages(port);
  } catch (e) { failed++; console.log('  FAIL: ' + (e.stack || e)); }
  finally { if (srv) srv.kill(); }
  console.log(failed ? `\nHOLD: ${failed} FAILED` : '\nHOLD: all passed');
  process.exit(failed ? 1 : 0);
})();
