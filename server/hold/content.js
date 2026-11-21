'use strict';

// HOLD's message pack: data/hold-messages.json (or HOLD_MESSAGES). Schema:
//   [{ id, kind: 'scam'|'real'|'practice', sender, channel: 'sms'|'whatsapp'|'email', lines: [..],
//      flagLine: int|null, springLine: int|null, action: string, consequence: string|null, teach?: string }]
// A scam has a red-flag line and springs at or after it; a real message has neither. One optional 'practice'
// message (an easy scam) is the practice round; it is not one of the scored messages (loadPack splits it off;
// without one, the first scam, the easiest, is reused).
// Cyber look (16 Nov, Angelo picked B2): `disguise` is the friendly character the sender wears while the room holds
// (courier|helpdesk|bank|boss|friend). Real and fake messages share disguises, and the disguise follows the sender
// (a courier text is a courier, real or not), so it gives nothing away. `persona` is the attacker under the mask,
// shown only at the reveal (phisher|smisher|visher|impersonator|fakehelpdesk|quisher); null on a real message.
// Both are optional: a pack without them gets the channel's default disguise and a channel persona.
// ACTS (16 Nov): `act` (1-3) puts a message in an act (each act opens with a title card; stakes rise per act).
// All or none of a pack's scored messages carry it; without it the pack is split in three, in order. Messages are
// played act by act, in pack order within an act. Optional `difficulty` (1-3 or a word) and `tell` (a string) are for the
// playtest log only (scripts/hold-spot-report.js); they never leave the server.
// Holding = your thumb is on the message's action button (Angelo's playtest, 15 Nov): a scam that
// springs while you hold means YOU TAPPED IT, and `consequence` says what that cost.

const fs = require('node:fs');
const path = require('node:path');
const { actFor } = require('./rules');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'data', 'hold-messages.json');
const CHANNELS = ['sms', 'whatsapp', 'email'];
const DISGUISES = ['courier', 'helpdesk', 'bank', 'boss', 'friend'];
const PERSONAS = ['phisher', 'smisher', 'visher', 'impersonator', 'fakehelpdesk', 'quisher'];
const FORMATS = ['text', 'phone', 'web'];
// What the big screen needs to draw a message's format (never the kind or the flag).
const view = (m) => ({ format: m.format || 'text', brand: m.brand || null, tab: m.tab || null, time: m.time || null, date: m.date || null });
const DEFAULT_DISGUISE = { sms: 'courier', whatsapp: 'friend', email: 'helpdesk' };
const DEFAULT_PERSONA = { sms: 'smisher', whatsapp: 'smisher', email: 'phisher' };

function validate(list) {
  const fail = (m) => { throw new Error('HOLD messages: ' + m); };
  if (!Array.isArray(list) || !list.length) fail('must be a non-empty list');
  const ids = new Set();
  const isInt = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
  list.forEach((m, i) => {
    const w = `[${i}]`;
    if (!m || typeof m !== 'object') fail(w + ' is not an object');
    if (typeof m.id !== 'string' || !m.id) fail(w + '.id missing');
    if (ids.has(m.id)) fail(w + '.id used twice: ' + m.id);
    ids.add(m.id);
    if (!['scam', 'real', 'practice'].includes(m.kind)) fail(w + '.kind must be scam, real or practice');
    if (typeof m.sender !== 'string' || !m.sender.trim()) fail(w + '.sender missing');
    if (!CHANNELS.includes(m.channel)) fail(w + '.channel must be one of ' + CHANNELS.join(', '));
    if (!Array.isArray(m.lines) || m.lines.length < 2 || !m.lines.every((l) => typeof l === 'string' && l.trim())) fail(w + '.lines needs 2+ non-empty strings');
    if (m.teach !== undefined && typeof m.teach !== 'string') fail(w + '.teach must be a string');
    // The button your thumb is on (big screen under the message, and the phone's ring label).
    if (typeof m.action !== 'string' || !m.action.trim() || m.action.length > 20) fail(w + '.action must be button text of 20 characters or fewer');
    const scam = m.kind !== 'real';
    if (scam && (typeof m.consequence !== 'string' || !m.consequence.trim() || m.consequence.length > 24)) fail(w + '.consequence (what tapping it cost) is required on a scam, 24 characters or fewer');
    if (m.kind === 'real' && m.consequence != null && typeof m.consequence !== 'string') fail(w + '.consequence must be a string or null');
    if (m.disguise !== undefined && !DISGUISES.includes(m.disguise)) fail(w + '.disguise must be one of ' + DISGUISES.join(', '));
    if (m.persona !== undefined && m.persona !== null && !PERSONAS.includes(m.persona)) fail(w + '.persona must be one of ' + PERSONAS.join(', ') + ' or null');
    if (m.kind === 'real' && m.persona) fail(w + ' a real message has no persona (it reveals LEGIT)');
    if (m.act !== undefined && !(m.kind === 'practice' ? [0, null] : [1, 2, 3]).includes(m.act)) fail(w + (m.kind === 'practice' ? '.act on the practice message must be 0 (it plays before act 1)' : '.act must be 1, 2 or 3'));
    if (m.tell !== undefined && m.tell !== null && typeof m.tell !== 'string') fail(w + '.tell must be a string');
    if (m.difficulty !== undefined && m.difficulty !== null && typeof m.difficulty !== 'string' && !Number.isFinite(m.difficulty)) fail(w + '.difficulty must be a number or a string');
    // FORMATS (18 Nov): `format` 'text' (default) | 'phone' | 'web'. phone: each line is a push notification
    // "App | Title | Body" (body optional), plus optional `time` / `date` for the lock screen. web: line 0 is the address
    // (typed into the browser bar), then page parts: "# heading", "> a field", "! a button", anything else is page text;
    // `brand` (the site's name) is required, `tab` optional, `urlFlag: true` also marks the address at the reveal.
    if (m.format !== undefined && !FORMATS.includes(m.format)) fail(w + '.format must be one of ' + FORMATS.join(', '));
    if (m.format === 'phone') {
      if (!m.lines.every((l) => { const p = l.split('|').map((x) => x.trim()); return p.length >= 2 && p.length <= 3 && p.every(Boolean); })) fail(w + ' phone lines must be "App | Title | Body"');
      for (const k of ['time', 'date']) if (m[k] !== undefined && typeof m[k] !== 'string') fail(w + '.' + k + ' must be a string');
    }
    if (m.format === 'web') {
      if (!/^[^\s]+\.[^\s]+$/.test(m.lines[0])) fail(w + ' a web page starts with its address (no spaces), e.g. site.co.za/path');
      if (typeof m.brand !== 'string' || !m.brand.trim()) fail(w + '.brand (the site name) is required on a web page');
      if (m.tab !== undefined && typeof m.tab !== 'string') fail(w + '.tab must be a string');
      if (m.urlFlag !== undefined && typeof m.urlFlag !== 'boolean') fail(w + '.urlFlag must be true or false');
    }
    if (m.format !== 'web' && (m.brand !== undefined || m.urlFlag !== undefined)) fail(w + ' brand/urlFlag are for web pages');
    const n = m.lines.length;
    if (scam) {
      if (!isInt(m.flagLine, n)) fail(w + '.flagLine must be a line index');
      if (!isInt(m.springLine, n)) fail(w + '.springLine must be a line index');
      if (m.springLine < m.flagLine) fail(w + '.springLine must be at or after flagLine');
    } else if (m.flagLine !== null || m.springLine !== null) fail(w + ' a real message has flagLine and springLine null');
  });
  // Fill the look's defaults, so the rest of the server can rely on both fields.
  return list.map((m) => ({ ...m, disguise: m.disguise || DEFAULT_DISGUISE[m.channel], persona: m.kind === 'real' ? null : m.persona || DEFAULT_PERSONA[m.channel] }));
}

// { messages: the scored ones, in order; practice: the practice message }.
function loadPack(file = process.env.HOLD_MESSAGES || DEFAULT_PATH) {
  const all = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  const messages = withActs(all.filter((m) => m.kind !== 'practice'));
  if (!messages.length) throw new Error('HOLD messages: needs at least one scam or real message');
  return { messages, practice: all.find((m) => m.kind === 'practice') || messages.find((m) => m.kind === 'scam') || messages[0] };
}
// Every scored message gets its act; the list is ordered act by act (stable within an act).
function withActs(list) {
  const some = list.filter((m) => m.act !== undefined).length;
  if (some && some !== list.length) throw new Error('HOLD messages: give every message an act, or none');
  const out = list.map((m, i) => ({ ...m, act: some ? m.act : actFor(i, list.length) }));
  return out.map((m, i) => [m, i]).sort((a, b) => a[0].act - b[0].act || a[1] - b[1]).map((x) => x[0]);
}
const load = (file) => loadPack(file).messages;
// The agree-quiz bank (18 Nov): data/hold-quiz.json (or HOLD_QUIZ; HOLD_QUIZ=off for none). Each item:
//   { id, act: 1-3, question, options: [2-4 strings], answer: index, why: the one-line lesson, source?: url, pro?: true }
// pro (19 Nov): an expert question only practitioners know, asked as the PRO QUESTION (QUIZ.proActs).
// Extra fields (public_pct, room_pct, ...) are for us; only id, act, question, options, answer and why reach the game.
const QUIZ_PATH = path.join(__dirname, '..', '..', 'data', 'hold-quiz.json');
function validateQuiz(list) {
  const fail = (m) => { throw new Error('HOLD quiz: ' + m); };
  if (!Array.isArray(list)) fail('must be a list');
  const ids = new Set();
  return list.map((q, i) => {
    const w = 'item ' + i;
    if (typeof q.id !== 'string' || !q.id || ids.has(q.id)) fail(w + ' needs a unique id'); ids.add(q.id);
    if (![1, 2, 3].includes(q.act)) fail(w + '.act must be 1-3');
    if (typeof q.question !== 'string' || !q.question || q.question.length > 140) fail(w + '.question must be a short string');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 || !q.options.every((o) => typeof o === 'string' && o && o.length <= 48)) fail(w + '.options must be 2-4 short strings');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) fail(w + '.answer must index an option');
    if (typeof q.why !== 'string' || !q.why || q.why.length > 160) fail(w + '.why must be a short string');
    if (q.pro !== undefined && typeof q.pro !== 'boolean') fail(w + '.pro must be true or false');
    return { id: q.id, act: q.act, question: q.question, options: [...q.options], answer: q.answer, why: q.why, pro: q.pro === true };
  });
}
function loadQuiz(file = process.env.HOLD_QUIZ || QUIZ_PATH) {
  if (file === 'off') return [];
  if (!fs.existsSync(file)) return [];
  return validateQuiz(JSON.parse(fs.readFileSync(file, 'utf8')));
}


// The INCIDENT ROOM bank (19 Nov): data/hold-incidents.json (or HOLD_INCIDENTS; =off for none). Each scenario:
//   { id, title, brief, evidence: [3-4 { tag, title, lines: [1-4 short strings] }], question, options: [3], answer, why,
//     walk: [one line per artefact], sources: [urls] }. Sources stay with us; the rest reaches the game.
const INCIDENTS_PATH = path.join(__dirname, '..', '..', 'data', 'hold-incidents.json');
function validateIncidents(list) {
  const fail = (m) => { throw new Error('HOLD incidents: ' + m); };
  if (!Array.isArray(list)) fail('must be a list');
  const ids = new Set(), str = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;
  return list.map((q, i) => {
    const w = 'scenario ' + i;
    if (!str(q.id, 60) || ids.has(q.id)) fail(w + ' needs a unique id'); ids.add(q.id);
    if (!Array.isArray(q.evidence) || q.evidence.length < 3 || q.evidence.length > 4) fail(w + '.evidence must have 3-4 artefacts');
    q.evidence.forEach((e, j) => { if (!str(e.tag, 20) || !str(e.title, 48) || !Array.isArray(e.lines) || e.lines.length < 1 || e.lines.length > 4 || !e.lines.every((l) => str(l, 56))) fail(w + '.evidence[' + j + '] needs tag, title and 1-4 short lines'); });
    if (!str(q.question, 80)) fail(w + '.question must be short');
    if (!Array.isArray(q.options) || q.options.length !== 3 || !q.options.every((o) => str(o, 56))) fail(w + '.options must be 3 short strings');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 2) fail(w + '.answer must index an option');
    if (!str(q.why, 160)) fail(w + '.why must be short');
    if (!Array.isArray(q.walk) || q.walk.length !== q.evidence.length || !q.walk.every((l) => str(l, 140))) fail(w + '.walk needs one short line per artefact');
    return { id: q.id, title: q.title || '', brief: q.brief || '', evidence: q.evidence.map((e) => ({ tag: e.tag, title: e.title, lines: [...e.lines] })), question: q.question, options: [...q.options], answer: q.answer, why: q.why, walk: [...q.walk] };
  });
}
// The HOT FILE puzzles (19 Nov): data/hold-puzzles.json (or HOLD_PUZZLES; =off for none). Each: { id, act: 1-3, prompt,
//   options: [3 short strings], answer: index, why }.
const PUZZLES_PATH = path.join(__dirname, '..', '..', 'data', 'hold-puzzles.json');
function validatePuzzles(list) {
  const fail = (m) => { throw new Error('HOLD puzzles: ' + m); };
  if (!Array.isArray(list)) fail('must be a list');
  const ids = new Set(), str = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;
  return list.map((q, i) => {
    const w = 'puzzle ' + i;
    if (!str(q.id, 60) || ids.has(q.id)) fail(w + ' needs a unique id'); ids.add(q.id);
    if (![1, 2, 3].includes(q.act)) fail(w + '.act must be 1-3');
    if (!str(q.prompt, 90)) fail(w + '.prompt must be short');
    if (!Array.isArray(q.options) || q.options.length !== 3 || !q.options.every((o) => str(o, 48))) fail(w + '.options must be 3 short strings');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 2) fail(w + '.answer must index an option');
    if (!str(q.why, 140)) fail(w + '.why must be short');
    return { id: q.id, act: q.act, prompt: q.prompt, options: [...q.options], answer: q.answer, why: q.why };
  });
}
function loadPuzzles(file = process.env.HOLD_PUZZLES || PUZZLES_PATH) {
  if (file === 'off' || !fs.existsSync(file)) return [];
  return validatePuzzles(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function loadIncidents(file = process.env.HOLD_INCIDENTS || INCIDENTS_PATH) {
  if (file === 'off' || !fs.existsSync(file)) return [];
  return validateIncidents(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { loadPuzzles, validatePuzzles, PUZZLES_PATH, loadIncidents, validateIncidents, INCIDENTS_PATH, loadQuiz, validateQuiz, QUIZ_PATH, view, FORMATS, load, loadPack, validate, withActs, CHANNELS, DISGUISES, PERSONAS, DEFAULT_PATH };
