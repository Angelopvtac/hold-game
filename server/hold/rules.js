'use strict';

// HOLD's numbers, in one place.
// Times are real milliseconds at scale 1; the room multiplies every one by its scale (HOLD_SCALE)
// so tests run on a fast clock. The pot is computed in GAME seconds, so scores don't depend on it.

const LINE_MS = 1800;            // a new line of the message every 1.8 s (two keys: the whole room reads it on the big screen)
const SPRING_AFTER_MS = 800;     // a scam springs this long after its spring line lands
const REAL_END_AFTER_MS = 2000;  // a real message ends this long after its last line
const READY_MS = 8000;           // "thumbs down" before each message; ends early when every human holds
const READY_MIN_MS = 1500;       // ... but never shorter than this (the room sees the countdown)
const CRASH_MS = 2200;           // the crash / double stamp
const REVEAL_MS = 11000;         // the red flag, the lesson, every team's mark and the release strip (16 Nov: 7 s -> 11 s:
                                 // the reveal is when partners talk, and a 24-message match then runs ~12 min from START)
const SLIP_MS = 150;             // server debounce: a release undone within this is not a release (real ms, unscaled)
const MIN_PAIRS = 2;             // bot pairs fill the room up to this many pairs (15 Nov: HOLD is played in pairs)
const MIN_SEATS = 4;             // = MIN_PAIRS pairs of 2
const MAX_TEAM = 3;              // a pair, or a trio when the room is odd
const CODE_FAILS = 8;            // wrong pairing codes a phone may type before a short wait
const CODE_BLOCK_MS = 30000;
const GONE_SEAT_MS = 20000; // mid-match: a phone that left without ever playing gives its seat back after this (security 18 Nov #4)
const ADDR_CODE_FAILS = 30, ADDR_CODE_WINDOW_MS = 60000; // wrong pair codes per address a minute (a venue NAT shares one address)
const MAX_PLAYERS = 60;
// INTRO (15 Nov, Angelo after playing TWO KEYS): a ~40 s walkthrough, then a practice round that doesn't count.
const WALK_STEPS = 3;            // three big-screen cards
const WALK_A_MS = 20000;         // card 1 (both thumbs down = the pot grows) waits for every team's keys, at most this long
const WALK_GRACE_MS = 3500;      // ... every team has both keys in: watch the practice pot grow this long, then move on
const WALK_CARD_MS = 9000;       // cards 2 and 3 (3: LET GO WHEN YOU SPOT THE RED FLAG)
const WALK_RATE = 1200;          // the walkthrough's practice pot, rand per game second while every key is in
const STAGE_MS = 3000;           // the FINAL MESSAGE · ALL IN ×5 card
// ACTS (16 Nov, approved storyboard): the match is three acts, each
// opened by a title card naming its new trick. Messages carry `act` (1-3; content.js fills it for a pack without).
// Stakes rise per act (banked pots ×1/×2/×3, the pot grows faster) and the last message of the match is ALL IN ×5.
// Act 3 builds its lines faster. Acts 2 and 3 open with SAFE or BOLD: every member of a team picks within CHOICE_MS;
// all BOLD = BOLD (everything banked this act ×2), anything else = SAFE (caught this act: keep half).
const ACTS = [
  { n: 1, name: 'INBOX', trick: 'links in texts and emails', tip: 'Let go together: ×1.5', lead: 'WATCH OUT FOR', persona: 'smisher', mult: 1, speed: 1, lineMs: 1800, choice: false },
  { n: 2, name: 'THE BOSS IS IN A HURRY', trick: 'urgent payments and gift cards', lead: 'NEW TRICK', persona: 'impersonator', mult: 2, speed: 1.2, lineMs: 1800, choice: true },
  // LAST BUSINESS STANDING (18 Nov, approved storyboard): in act 3 a
  // breach closes the company for good unless it CONTAINS IT (tap fast for CONTAIN.ms). `rule` replaces the trick line.
  { n: 3, name: 'LAST BUSINESS STANDING', trick: '', rule: 'If a scam hits you: tap fast for 5 s to contain it.', tip: 'Closed? Lock in twice to restore from backup.', lead: 'THE FINAL ACT', persona: 'fakehelpdesk', mult: 3, speed: 1.4, lineMs: 1400, choice: true, closes: true },
];
const FINAL = { mult: 5, speed: 1.6 };   // the last message of the match: ALL IN
const ACT_CARD_MS = 15000;       // an act card with SAFE/BOLD
const ACT_PLAIN_MS = 8000;       // an act card without a choice (act 1)
const CHOICE_MS = 10000;         // seconds to pick SAFE or BOLD (inside the card)
const ACT_MIN_MS = 6000;         // a card ends early once every team has picked, but not before this ...
const ACT_GRACE_MS = 2500;       // ... and this long after the last pick
const SAFE_KEEP = 0.5;           // SAFE: caught this act, keep half of the pot
const BOLD_X = 2;                // BOLD: everything banked this act ×2
// SPOTTED IT (16 Nov, Angelo: "the people that let go earlier were more security aware"): letting go after the red-flag
// line has landed and before the scam springs pays the pot +50%. Before the flag = LEFT EARLY (plain bank).
const SPOT_BONUS = 0.5;
// RANSOMWARE (16 Nov, Angelo's idea, prototype): at the end of each act the team that lost the most to scams in it is LOCKED
// (tie: the lower bank; nobody caught = no battle). It duels the nearest team above it in the standings: 3-2-1, then every
// member of both teams taps as fast as they can for mashMs. Score = average taps per member (fair for a solo or a trio);
// the first to `key` cracks it at once. Locked team wins = free, and the lock jumps to the loser, who duels the next team
// up. Defender wins = the locked team pays `cut` of its bank. At most maxDuels per act; whoever holds the lock then pays.
// cardMs 8000 (19 Nov, Angelo: 'not enough theatre… didn't give the audience context'): the RANSOMWARE HITS intro.
const RANSOM = { cardMs: 8000, nextCardMs: 4000, countMs: 3000, mashMs: 8000, resultMs: 5000, paidMs: 6000, key: 75, maxDuels: 3, cut: 0.25,
  tapRate: 15, tapBurst: 8, botRate: [5, 8] };
// CONTAIN IT (18 Nov, Angelo: "please get it done"): in an act that `closes`, every company breached by a scam gets a CONTAIN IT
// window right at the spring: all members tap for `ms`; score = average taps per member (fair for solo and trio); at least
// `need` = contained (it still loses that message's pot, SAFE keeps half, but stays OPEN); less = CLOSED for good. Taps use
// RANSOM.tapRate/tapBurst. `resultMs`: how long CONTAINED / CLOSED shows before the reveal. Tune after playtests.
// readyMs (19 Nov, Angelo: "players need at least a few seconds prior to it occurring to understand what they have to do"):
// a GET READY · 3·2·1 beat before the tapping window; taps before it don't count.
const CONTAIN = { readyMs: 3000, ms: 5000, need: 40, resultMs: 3000, botRate: [6, 10] }; // bots: 6-10 taps/s, so about half contain
// AGREE-QUIZ (18 Nov, Angelo: "a mini quiz in between ... both have to agree on the answer so it gets people talking";
// research: each partner picks privately first, then they agree; 3 options,
// pitched ~75% right for this room). A quiz follows the reveal of the `after` (1-based) messages of each act, never the act's
// last. pickMs: everyone picks privately (a pick is locked when made); a team whose picks differ may re-pick until agreeMs after
// the pick window. No agreement = no answer. Right = `bonus` × the act's stakes (closed companies: no revenue) and +1 for
// HUMAN FIREWALL. Bots answer right with botRight.
const QUIZ = { pickMs: 12000, agreeMs: 6000, revealMs: 9000, after: [2, 4], bonus: 15000, botRight: 0.65, show: 6, doneGraceMs: 1500,
  // 19 Nov (Angelo: "1 or 2 tricky questions only cyber professionals would know"): the last quiz of acts 2 and 3 is a
  // PRO QUESTION (an item with pro: true), pays proX the bonus, and bots rarely know it.
  proActs: [2, 3], proX: 2, botRightPro: 0.2 };
// RESTORE FROM BACKUP (18 Nov, research: eliminated players keep the verb and get one way back): a company closed in act 3
// keeps holding; every bank (let go before a scam springs, or a real message held to the end) fills its backup bar instead
// of earning; `need` fills reopen it once, at the next reveal. A second close is for good.
const BACKUP = { need: 2 };
// INCIDENT ROOM (19 Nov): once a match, between act 2 and act 3. The evidence board builds for briefMs (no picks), then the
// quiz flow with longer windows; right = QUIZ.bonus x act stakes x mult. Bots get it right less often than a quiz.
// HOT FILE (19 Nov; replaces the ransomware duel in acts 1-2): an infected file lands on the most-breached company; both
// agree to PASS it up the market (at most maxPasses) or DEFUSE it (a puzzle, both agree). Defused = HERO (QUIZ.bonus x act
// stakes x heroX); a wrong defuse, nowhere to pass, or 'take' = the holder loses `cut` of its revenue.
const HOT = { landMs: 8000, passedMs: 5000, chooseMs: 10000, puzzleMs: 15000, resultMs: 7000, maxPasses: 3, cut: 0.25, heroX: 2, botDefuse: 0.4, botRight: 0.6 }; // 19 Nov: bots pass 60% (Angelo never saw a pass)
// END EVENTS (19 Nov, Angelo: "did we drop the tapping battle?"): what ends each act that isn't the closing act, in act
// order (act 1 = [0], act 2 = [1], wrapping). 'hotfile' = HOT FILE, 'ransom' = the RANSOMWARE tap duel. Flip to taste.
const END_EVENTS = ['hotfile', 'ransom'];
const IR = { briefMs: 20000, pickMs: 20000, agreeMs: 8000, revealMs: 18000, mult: 3, botRight: 0.45 };
// LET GO TOGETHER (18 Nov, research: one parameter per round, partners watching each other): every member lets go within
// `ms` (real ms) of each other and the team banks = that bank ×`x`. Bot pairs manage it with botP.
const SYNC = { ms: 500, x: 1.5, botP: 0.3 };
// FORMATS (18 Nov): a message may be a `phone` takeover (push notifications on a giant lock screen) or a `web` page
// (the address types in, then the page builds). Same hold rule. A phone round is a FAST ROUND: its lines come PHONE_LINE_X faster.
const PHONE_LINE_X = 0.7;
// Message i's stakes: its act's, except the last message of the match (ALL IN ×5). Practice is ×1 at act 1's pace.
// m (optional): the message, for its format's line speed.
function stage(i, n, act = 1, m = null) {
  const a = ACTS[Math.min(ACTS.length, Math.max(1, act)) - 1];
  const lineMs = m && m.format === 'phone' ? Math.round(a.lineMs * PHONE_LINE_X) : a.lineMs;
  if (n > 1 && i === n - 1) return { n: a.n, act: a.n, mult: FINAL.mult, speed: FINAL.speed, lineMs, final: true };
  return { n: a.n, act: a.n, mult: a.mult, speed: a.speed, lineMs, final: false };
}
// For a pack without acts: split it in three (the first third act 1, ...).
const actFor = (i, n) => Math.min(3, 1 + Math.floor((3 * i) / Math.max(1, n)));

// The pot in game seconds since the message started (hold-B: 60t + 20t^2).
// 18 Nov: x10 for Rand (winners end in the hundreds of thousands, next to in-message amounts like R250 000).
const potAt = (t) => Math.round(600 * t + 200 * t * t);
// The bump the holders get when the n-th player of this message lets go.
const share = (n) => Math.round((800 + 600 * n) / 100) * 100;
// When a message resolves, in ms from its start at scale 1.
// 17 Nov (Angelo: "a little too easy"; he dodged 12 of 12): a scam springs 1.1-1.6 s after its red-flag line lands,
// mid-message, not as the message finishes, so "let go when it looks done" stops working and you have to read.
// The delay is fixed per message (from its id) so replays and tests are stable.
const SPRING_AFTER_FLAG_MS = [1100, 1600];
const springDelay = (m) => { let h = 0; for (const c of String(m.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const [lo, hi] = SPRING_AFTER_FLAG_MS; return lo + (h % ((hi - lo) / 100 + 1)) * 100; };
// springLine is now the line where the scam first ASKS you to act (pay, click, approve), never before it: a red flag
// that comes before the ask (e.g. "we've changed banks") gives you until just after the ask lands.
const endAt = (m, lineMs = LINE_MS) => (m.kind !== 'real'
  ? Math.max(m.flagLine != null ? m.flagLine * lineMs + springDelay(m) : 0, m.springLine * lineMs + SPRING_AFTER_MS)
  : (m.lines.length - 1) * lineMs + REAL_END_AFTER_MS);
// When the red-flag line lands, in ms from the start at scale 1 (a real message has none).
const flagAt = (m, lineMs = LINE_MS) => (m.kind !== 'real' && m.flagLine != null ? m.flagLine * lineMs : null);

module.exports = { END_EVENTS, HOT, IR, QUIZ, BACKUP, SYNC, PHONE_LINE_X, CONTAIN, GONE_SEAT_MS, ADDR_CODE_FAILS, ADDR_CODE_WINDOW_MS, SPRING_AFTER_FLAG_MS, springDelay, RANSOM, WALK_STEPS, WALK_A_MS, WALK_GRACE_MS, WALK_CARD_MS, WALK_RATE, STAGE_MS, ACTS, FINAL, ACT_CARD_MS, ACT_PLAIN_MS, CHOICE_MS, ACT_MIN_MS, ACT_GRACE_MS, SAFE_KEEP, BOLD_X, SPOT_BONUS, stage, actFor, flagAt, LINE_MS, SPRING_AFTER_MS, REAL_END_AFTER_MS, READY_MS, READY_MIN_MS, CRASH_MS, REVEAL_MS, SLIP_MS, MIN_PAIRS, MIN_SEATS, MAX_TEAM, CODE_FAILS, CODE_BLOCK_MS, MAX_PLAYERS, potAt, share, endAt };
