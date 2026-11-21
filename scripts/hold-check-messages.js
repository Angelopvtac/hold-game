#!/usr/bin/env node
// Validates a HOLD message pack (default data/hold-messages.json, the South African pack) against the game's timing (rules.js endAt,
// 17 Nov: scams spring 1.1-3 s after the red flag, never before the ask line, mostly before the last line).
// Usage: node scripts/hold-check-messages.js [pack.json]
// Rules: optional practice first, then 18 messages, 6 per act in act order, 3 scam + 3 real per act (19 Nov: cut from 8, Angelo);
// never 3 scams in a row; every disguise used by both kinds; the spot window (red flag shown -> scam springs)
// is at least 2.6 s at that act's line speed; Act 3 ends on a scam (the ALL IN finale).
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'data', 'hold-messages.json');
const errs = [];
const err = (m) => errs.push(m);
let all;
try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('FAIL: cannot parse ' + file + ': ' + e.message); process.exit(1); }
if (!Array.isArray(all)) { console.error('FAIL: top level must be an array'); process.exit(1); }

const KEYS = ['id', 'kind', 'sender', 'channel', 'lines', 'flagLine', 'springLine', 'teach', 'action', 'disguise', 'persona', 'act', 'difficulty', 'tell'];
const OPTIONAL = ['consequence', 'format', 'brand', 'tab', 'urlFlag', 'time', 'date'];
const DISGUISES = ['courier', 'helpdesk', 'bank', 'boss', 'friend'];
const PERSONAS = ['phisher', 'smisher', 'visher', 'impersonator', 'fakehelpdesk', 'quisher'];
const CHANNELS = ['sms', 'whatsapp', 'email'];
const LINE_S = { 0: 1.8, 1: 1.8, 2: 1.8, 3: 1.4 }; // seconds per line by act (Act 3 runs faster)
const SPRING_AFTER_S = 0.8;
const MIN_WINDOW_S = 2.6;
const MAXLEN = 45;

const RULES = require('../server/hold/rules');
let beforeLast = 0;
const ids = new Set();
const practice = all.filter((m) => m.kind === 'practice');
if (practice.length > 1) err('at most one practice message');
if (practice.length && all[0].kind !== 'practice') err('the practice message must come first');
const msgs = all.filter((m) => m.kind !== 'practice');
if (msgs.length !== 18) err(`expected 18 messages, got ${msgs.length}`);

all.forEach((m, i) => {
  const at = `#${i} (${m && m.id})`;
  for (const k of KEYS) if (!(k in m)) err(`${at}: missing ${k}`);
  for (const k of Object.keys(m)) if (!KEYS.includes(k) && !OPTIONAL.includes(k)) err(`${at}: unknown key ${k}`);
  if (typeof m.id !== 'string' || !m.id) err(`${at}: id must be a non-empty string`);
  if (ids.has(m.id)) err(`${at}: duplicate id`); ids.add(m.id);
  if (!['scam', 'real', 'practice'].includes(m.kind)) err(`${at}: bad kind ${m.kind}`);
  if (typeof m.sender !== 'string' || !m.sender) err(`${at}: sender must be a non-empty string`);
  if (!CHANNELS.includes(m.channel)) err(`${at}: bad channel ${m.channel}`);
  if (!DISGUISES.includes(m.disguise)) err(`${at}: bad disguise ${m.disguise}`);
  if (m.kind === 'real' ? m.persona !== null : !PERSONAS.includes(m.persona)) err(`${at}: persona ${m.persona} wrong for a ${m.kind} message`);
  if (m.kind === 'practice' ? m.act !== 0 : ![1, 2, 3].includes(m.act)) err(`${at}: bad act ${m.act}`);
  if (![1, 2, 3].includes(m.difficulty)) err(`${at}: difficulty must be 1-3`);
  const tw = typeof m.tell === 'string' ? m.tell.trim().split(/\s+/).length : 0;
  if (tw < 3 || tw > 6) err(`${at}: tell must be 3-6 words ("${m.tell}")`);
  if (typeof m.teach !== 'string' || !m.teach) err(`${at}: teach must be a non-empty string`);
  else if (m.teach.length > 120) err(`${at}: teach too long (${m.teach.length})`);
  if (typeof m.action !== 'string' || !m.action.trim() || m.action.length > 20) err(`${at}: action must be 1-20 chars`);
  const scam = m.kind !== 'real';
  if (scam && (typeof m.consequence !== 'string' || !m.consequence || m.consequence.length > 24)) err(`${at}: scam consequence must be 1-24 chars`);
  if (!scam && m.consequence != null) err(`${at}: real message consequence must be null`);
  if (!Array.isArray(m.lines)) { err(`${at}: lines must be an array`); return; }
  const n = m.lines.length;
  if (n < 4 || n > 8) err(`${at}: needs 4-8 lines, has ${n}`);
  m.lines.forEach((l, j) => {
    if (typeof l !== 'string' || !l.trim()) err(`${at} line ${j}: must be a non-empty string`);
    else if (m.format === 'phone') { for (const part of l.split('|')) if ([...part.trim()].length > 52) err(`${at} line ${j}: notification part over 52 chars: "${part.trim()}"`); }
    else if (m.format === 'web') { const max = j === 0 ? 40 : 58; if ([...l].length > max) err(`${at} line ${j}: ${[...l].length} chars > ${max} (web): "${l}"`); }
    else if ([...l].length > MAXLEN) err(`${at} line ${j}: ${[...l].length} chars > ${MAXLEN}: "${l}"`);
  });
  const text = [m.sender, ...m.lines].join(' ');
  // SA numbers must be obviously fictional: a 000 block (no official drama range in SA).
  for (const ph of text.match(/(\+27\s?|0)[6-8]\d[\s\d]{7,9}\d/g) || []) if (!/\b000\b/.test(ph)) err(`${at}: phone ${ph} has no 000 block`);
  for (const uk of ['£', '+44', 'HMRC', 'Sort ', '07700', 'p&p', '7726']) if ([m.sender, m.action, m.consequence || '', m.teach, ...m.lines].join(' ').includes(uk)) err(`${at}: UK leftover "${uk}"`);
  if (m.kind === 'real') {
    if (m.flagLine !== null || m.springLine !== null) err(`${at}: real messages need flagLine and springLine null`);
  } else {
    const f = m.flagLine, s = m.springLine;
    if (!Number.isInteger(f) || !Number.isInteger(s)) { err(`${at}: scam needs integer flagLine and springLine`); return; }
    if (!(f >= 0 && f <= s && s < n)) err(`${at}: need 0 <= flagLine <= springLine < lines (${f}, ${s}, ${n})`);
    if (m.kind === 'scam') {
      const st = RULES.stage(msgs.indexOf(m), msgs.length, m.act, m), L = st.lineMs;
      const gap = RULES.endAt(m, L) - RULES.flagAt(m, L);
      if (gap < 1100 || gap > 3000) err(`${at}: springs ${gap} ms after the red flag (want 1100-3000)`);
      if (RULES.endAt(m, L) <= s * L) err(`${at}: springs before its ask line lands`);
      if (RULES.endAt(m, L) < (n - 1) * L) beforeLast++;
    }
  }
});

if (beforeLast < 8) err(`only ${beforeLast} scams spring before their last line (want 8+)`);
// FORMATS (18 Nov): 4-6 phone/web rounds, each format used by a scam and a real one (format is no tell),
// and never the same non-text format twice in a row.
const fm = (m) => m.format || 'text';
const nonText = msgs.filter((m) => fm(m) !== 'text');
if (nonText.length < 4 || nonText.length > 6) err(`${nonText.length} phone/web rounds (want 4-6)`);
for (const f of ['phone', 'web']) { const k = new Set(msgs.filter((m) => fm(m) === f).map((m) => m.kind)); if (!(k.has('scam') && k.has('real'))) err(`format ${f} is not used by both scam and real`); }
for (let i = 1; i < msgs.length; i++) if (fm(msgs[i]) !== 'text' && fm(msgs[i]) === fm(msgs[i - 1])) err(`two ${fm(msgs[i])} rounds in a row: ${msgs[i - 1].id}, ${msgs[i].id}`);
// Act structure
let lastAct = 0;
msgs.forEach((m, i) => { if (m.act < lastAct) err(`#${m.id}: acts out of order`); lastAct = m.act; });
for (const a of [1, 2, 3]) {
  const inAct = msgs.filter((m) => m.act === a);
  const sc = inAct.filter((m) => m.kind === 'scam').length;
  if (inAct.length !== 6) err(`act ${a}: ${inAct.length} messages, expected 6`);
  if (sc !== 3) err(`act ${a}: ${sc} scams, expected 3 (and 3 real)`);
}
const firsts = [1, 2, 3].map((a) => (msgs.find((m) => m.act === a) || {}).kind);
if (new Set(firsts).size === 1) err(`every act opens with a ${firsts[0]}: too predictable`);
const act3 = msgs.filter((m) => m.act === 3);
if (act3.length && act3[act3.length - 1].kind !== 'scam') err('the Act 3 finale (ALL IN) must be a scam');
// never 3 scams in a row (across act breaks too); never 3 real in a row either
for (let i = 2; i < msgs.length; i++) {
  const k = msgs[i].kind;
  if (msgs[i - 1].kind === k && msgs[i - 2].kind === k) err(`3 ${k} messages in a row ending at ${msgs[i].id}`);
}
// every disguise is worn by both a scam and a real message (the disguise must give nothing away)
for (const d of DISGUISES) {
  const kinds = new Set(msgs.filter((m) => m.disguise === d).map((m) => m.kind));
  if (!(kinds.has('scam') && kinds.has('real'))) err(`disguise ${d} is not used by both scam and real (${[...kinds].join(',') || 'unused'})`);
}
for (const p of PERSONAS) if (!msgs.some((m) => m.persona === p)) err(`persona ${p} never appears`);
// red flags move about: in each act, no two scams share a flagLine more than twice
for (const a of [1, 2, 3]) {
  const fl = msgs.filter((m) => m.act === a && m.kind === 'scam').map((m) => m.flagLine);
  if (new Set(fl).size < 2) err(`act ${a}: every red flag sits on the same line (${fl[0]})`);
}

if (errs.length) { console.error(`FAIL: ${errs.length} problem(s)\n - ` + errs.join('\n - ')); process.exit(1); }
const seq = msgs.map((m) => (m.kind === 'scam' ? 'S' : 'R')).join('');
console.log(`PASS: ${practice.length} practice + ${msgs.length} messages; order ${seq.slice(0, 8)} | ${seq.slice(8, 16)} | ${seq.slice(16)}`);
