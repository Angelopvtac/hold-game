'use strict';

// The rules of who may join and who may control a lobby. Network-free, so the
// security-relevant parts can be tested directly.

const crypto = require('node:crypto');

const makePin = () => String(crypto.randomInt(100000, 1000000));
const makeHostToken = () => crypto.randomBytes(32).toString('hex');

// Constant-time comparison. Anything that is not a same-length string is a mismatch.
function secretMatches(given, real) {
  if (typeof given !== 'string' || typeof real !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Nicknames are two words chosen from the content pack, never free text, so nothing
// a player writes can reach the projector. Returns null unless both words are listed.
function composeName(names, first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return null;
  if (!names.adjectives.includes(first) || !names.nouns.includes(second)) return null;
  return first + ' ' + second;
}

// Counts wrong PINs per client. Only failures count, so a whole venue behind one
// address can join with the right PIN at any rate.
class PinLimiter {
  constructor({ maxFails = 20, windowMs = 60000, blockMs = 60000, maxKeys = 20000, now = Date.now } = {}) {
    Object.assign(this, { maxFails, windowMs, blockMs, maxKeys, now });
    this.entries = new Map(); // key -> { fails, windowEnds, blockedUntil }
  }

  // Milliseconds this client must still wait; 0 means it may try.
  blockedFor(key) {
    const e = this.entries.get(key);
    return e ? Math.max(0, e.blockedUntil - this.now()) : 0;
  }

  fail(key) {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || t >= e.windowEnds) {
      if (!this.entries.has(key) && this.entries.size >= this.maxKeys) this.prune(t);
      e = { fails: 0, windowEnds: t + this.windowMs, blockedUntil: e ? e.blockedUntil : 0 };
      this.entries.set(key, e);
    }
    if (++e.fails >= this.maxFails) e.blockedUntil = t + this.blockMs;
  }

  // Bounds memory: drop expired clients, then the oldest if an attack filled the table.
  prune(t) {
    for (const [k, e] of this.entries) if (t >= e.windowEnds && t >= e.blockedUntil) this.entries.delete(k);
    while (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value);
  }
}

module.exports = { makePin, makeHostToken, secretMatches, composeName, PinLimiter };
