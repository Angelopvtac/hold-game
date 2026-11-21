'use strict';

// HOLD bots: fill empty seats up to RULES.MIN_SEATS so a small room still feels like a crowd.
// Each bot has a temper (hold-B's five players) and plans when it lets go at the start of each
// message, in game seconds. They read the message like a person would (they let go around the
// red-flag line on a scam), never more; the greedy one always holds too long. They let go through
// the same room call a phone's release uses.

const RULES = require('./rules');

const TEMPERS = ['steady', 'greedy', 'early', 'wobbly', 'late'];

// Game seconds after the start at which this bot lets go (Infinity: holds to the end).
function planRelease(temper, m, rand = Math.random, lineMs = RULES.LINE_MS) {
  const rnd = (a, b) => a + rand() * (b - a);
  const S = RULES.endAt(m, lineMs) / 1000;
  const F = m.kind !== 'real' ? (m.flagLine * lineMs) / 1000 : 0;
  if (m.kind !== 'real') {
    // 17 Nov: bots are no longer guaranteed to escape (they were clamped to let go before the spring, so a test room never
    // saw a team caught). Each bot may not notice the red flag at all; if it does, it reacts like a person, 0.5-1.7 s
    // after the flag line lands, which can be too late now that scams spring 1.1-3 s after it. About a third of bot
    // pairs get caught (scripts in test/hold.js measure it).
    const notice = { early: 0.65, steady: 0.6, late: 0.5, wobbly: 0.45, greedy: 0.15 }[temper] ?? 0.6;
    if (temper === 'early' && rand() < 0.35) return Math.max(0.6, rnd(F - 1.4, F)); // gets nervous before the flag
    if (rand() >= notice) return Infinity;
    const react = { early: [0.4, 1.2], steady: [0.5, 1.5], late: [0.9, 2.2], wobbly: [0.6, 2.0], greedy: [1.0, 2.5] }[temper] || [0.5, 1.7];
    return Math.max(0.6, F + rnd(react[0], react[1]));
  }
  switch (temper) {
    case 'early': return rnd(1.4, 3.2);
    case 'steady': return rand() < 0.5 ? rnd(4, 6) : Infinity;
    case 'late': return rnd(3.5, S - 0.4);
    case 'wobbly': return rand() < 0.5 ? rnd(2.5, 5) : Infinity;
    default: return Infinity;
  }
}

// SAFE or BOLD at an act card: the greedy and the late go bold, the careful play safe, the wobbly toss a coin.
function planChoice(temper, rand = Math.random) {
  if (temper === 'greedy' || temper === 'late') return 'bold';
  if (temper === 'wobbly') return rand() < 0.5 ? 'bold' : 'safe';
  return 'safe';
}

module.exports = { TEMPERS, planRelease, planChoice };
