'use strict';

// HOLD player names (19 Nov, Angelo: "let people type their own user names and select a character"). The only free text
// in the game, so it is checked here and escaped everywhere it is drawn (screen.html / play.html esc()).
//   cleanName(raw) -> { ok: true, name } | { ok: false, why }
// Rules: trimmed, inner spaces collapsed, 2-12 characters, letters (any script) with their accents, digits, space, hyphen,
// apostrophe. No emoji, symbols, control or invisible characters. A short block list of slurs and obvious profanity
// (checked after folding case, accents and basic leetspeak) asks for another name. The host can still reset any name.

const MIN = 2, MAX = 12;
const ALLOWED = /^[\p{L}\p{M}\p{N}' -]+$/u;
// Roots matched anywhere inside the folded name, and short ones matched only as a whole word (so Hancock, Draper, Spicer,
// Dickson and Pakenham stay fine). Kept short and blunt on purpose; the host menu's RENAME covers the rest.
const BLOCK = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'nigg', 'kaffir', 'kafir', 'faggot', 'retard', 'whore', 'slut', 'penis', 'vagina',
  'nazi', 'hitler', 'wank', 'twat', 'bastard', 'asshole', 'arsehole', 'jewboy', 'tranny', 'porn'];
const WORDS = ['fag', 'sex', 'dick', 'cock', 'pussy', 'rape', 'rapist', 'spic', 'coon', 'chink', 'paki', 'dyke', 'poes', 'naai', 'piel', 'ass', 'arse'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

// Lower case, accents off, leetspeak folded, everything but a-z dropped: "Sh!7 H3ad" -> "shithead".
function fold(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[0134578@$!|+]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
}
function rude(name) {
  const f = fold(name);
  if (!f) return false;
  const words = String(name).split(/[\s'-]+/).map(fold).filter(Boolean);
  return BLOCK.some((b) => f.includes(b)) || WORDS.some((w) => f === w || words.includes(w));
}

function cleanName(raw) {
  if (typeof raw !== 'string') return { ok: false, why: 'Type a name.' };
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...name].length < MIN) return { ok: false, why: `At least ${MIN} characters.` };
  if ([...name].length > MAX) return { ok: false, why: `At most ${MAX} characters.` };
  if (!ALLOWED.test(name)) return { ok: false, why: 'Letters, numbers, spaces, - and \' only.' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, why: 'Use some letters.' };
  if ((name.match(/\p{M}/gu) || []).length > (name.match(/\p{L}/gu) || []).length) return { ok: false, why: 'Letters, numbers, spaces, - and \' only.' }; // no stacked-accent spam
  if (rude(name)) return { ok: false, why: 'Pick another name.' };
  return { ok: true, name };
}

// A name nobody else in the room has (case-insensitive): "Sam", "Sam 2", "Sam 3"… still within MAX characters.
function uniqueName(name, taken) {
  const has = (n) => taken(n.toLowerCase());
  if (!has(name)) return name;
  for (let i = 2; i < 100; i++) {
    const tail = ' ' + i, base = [...name].slice(0, MAX - tail.length).join('').trim();
    if (!has(base + tail)) return base + tail;
  }
  return null;
}

// The 8 characters a phone can pick (index = p.av). Colour + one accessory, drawn by art.js defender().
const AVATARS = 8;

module.exports = { cleanName, uniqueName, fold, rude, AVATARS, MIN, MAX };
