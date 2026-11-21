'use strict';

// HOLD playtest report (16 Nov): which messages are too easy? Reads the playtest log the server writes,
// one JSON line per team per message (STATE_DIR/hold-log.jsonl, or HOLD_LOG), and prints the spot rate
// per message and per act. Human teams only and no practice round, unless asked.
//   node scripts/hold-spot-report.js [log file] [--bots] [--practice] [--pin 123456]

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const pinAt = args.indexOf('--pin');
const pin = pinAt >= 0 ? args[pinAt + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--pin')
  || process.env.HOLD_LOG || path.join(process.env.STATE_DIR || path.join(__dirname, '..', 'state'), 'hold-log.jsonl');

if (!fs.existsSync(file)) { console.error('No playtest log at ' + file); process.exit(1); }
const all = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
// RANSOMWARE duels log their own rows (type 'ransom'): summarised at the end, never counted as messages.
const duels = all.filter((r) => r && r.type === 'ransom' && (!pin || r.pin === pin));
process.on('exit', () => {
  if (!duels.length) return;
  const human = duels.filter((d) => !d.lockedBot || !d.rivalBot);
  console.log(`\nRANSOMWARE · ${duels.length} duels (${human.length} with people) · locked team broke free ${duels.filter((d) => d.winner === 'locked').length}× · ransoms paid ${duels.filter((d) => d.payer).length}×`);
  for (const d of human) console.log(`  act ${d.act} duel ${d.duel}: locked ${d.lockedScore} vs ${d.rivalScore} taps/member${d.cracked ? ' (cracked)' : ''} -> ${d.winner}${d.payer ? ` · paid R${d.amount}` : ''}`);
});
const rows = all
  .filter((r) => r && !r.type && (flag('--bots') || !r.bot) && (flag('--practice') || !r.practice) && (!pin || r.pin === pin));
if (!rows.length) { console.log('No matching rows in ' + file); process.exit(0); }

const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '-');
const count = (list, mark) => list.filter((r) => r.mark === mark).length;
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

// Per message: scams by spotted / early / tapped, real by trusted / early. Teams that sat out don't count.
const byMsg = new Map();
for (const r of rows) { const k = r.act + '|' + r.index + '|' + r.id; if (!byMsg.has(k)) byMsg.set(k, []); byMsg.get(k).push(r); }
console.log(`HOLD spot report · ${file} · ${rows.length} team rows${pin ? ' · PIN ' + pin : ''}\n`);
console.log(pad('ACT', 4) + pad('MESSAGE', 26) + pad('KIND', 6) + pad('DIFF', 5) + pad('TEAMS', 6) + pad('SPOTTED', 9) + pad('EARLY', 7) + pad('TAPPED', 8) + 'TRUSTED  TELL');
const acts = new Map();
for (const [k, list] of [...byMsg].sort((a, b) => { const [x1, y1] = a[0].split('|').map(Number), [x2, y2] = b[0].split('|').map(Number); return x1 - x2 || y1 - y2; })) {
  const r0 = list[0], played = list.filter((r) => r.mark !== 'out'), scam = r0.kind !== 'real', n = played.length;
  console.log(pad(r0.act, 4) + pad(r0.id, 26) + pad(r0.kind, 6) + pad(r0.difficulty ?? '', 5) + pad(n, 6)
    + pad(scam ? pct(count(played, 'spotted'), n) : '', 9) + pad(pct(count(played, 'early'), n), 7)
    + pad(scam ? pct(count(played, 'tapped'), n) : '', 8) + pad(scam ? '' : pct(count(played, 'trusted'), n), 9) + (r0.tell || ''));
  const a = acts.get(r0.act) || { scams: 0, spotted: 0, tapped: 0, reals: 0, trusted: 0 };
  if (scam) { a.scams += n; a.spotted += count(played, 'spotted'); a.tapped += count(played, 'tapped'); } else { a.reals += n; a.trusted += count(played, 'trusted'); }
  acts.set(r0.act, a);
}
console.log('\nPER ACT (team-messages)');
for (const [act, a] of [...acts].sort((x, y) => x[0] - y[0])) {
  console.log(`  act ${act}: scams spotted ${pct(a.spotted, a.scams)} · tapped ${pct(a.tapped, a.scams)} (of ${a.scams}) · real trusted ${pct(a.trusted, a.reals)} (of ${a.reals})`);
}
console.log('\nTarget (16 Nov): about 80% spotted in act 1, falling to about 50% in act 3.');
