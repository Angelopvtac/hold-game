// HOLD cyber look (16 Nov, Angelo picked direction B2).
// Every drawn thing, shared by the big screen and the phones: the neon city, the "Human Firewall" defenders,
// the friendly disguises a sender wears while the room holds, the attackers under the mask, the pot jar,
// the team button and the phone's big button. Pure functions that return SVG markup (no DOM, no state).

export const C = { n0: '#060a1c', n1: '#0c1333', cyan: '#22e4ff', mag: '#ff4fd8', amber: '#ffb627', amber2: '#b36a00', mint: '#5dffb0', ink: '#f3f1ff', dim: '#93a0d8', soft: '#ff8fb8' };

export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))})`;
}
// A player's colour comes from the first word of their name (the pack's adjectives), so a person keeps it all match.
const COL = { Amber: '#ff9a3c', Cobalt: '#3d7bff', Crimson: '#ff5d73', Hollow: '#8b6cff', Ivory: '#efe4cf', Jade: '#2ee59d', Silent: '#9aa6c8', Velvet: '#c55df0', Winter: '#4cc9f0', Onyx: '#6b7499', Scarlet: '#ff4b4b', Teal: '#2ed3b7', Dusk: '#e86fd0', Ember: '#ff7f50', Frost: '#9fe8ff', Slate: '#7f9bb8' };
const SPARE = ['#ff9a3c', '#3d7bff', '#ff5d73', '#8b6cff', '#2ed3b7', '#e86fd0', '#4cc9f0', '#ffb627'];
export function colOf(name) {
  const w = String(name || '').split(' ')[0];
  if (COL[w]) return COL[w];
  let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}
// 19 Nov (Angelo): players pick a character: 8 looks, a colour + one accessory (index = the player's av). A look travels as
// one colour string 'hex|accessory' so every drawing that takes a colour takes a look too (hex(c) strips the accessory).
export const LOOKS = [
  { c: '#ff9a3c', a: 'cap', name: 'Cap' }, { c: '#3d7bff', a: 'beanie', name: 'Beanie' }, { c: '#2ee59d', a: 'antenna', name: 'Antenna' },
  { c: '#e86fd0', a: 'bow', name: 'Bow' }, { c: '#ff5d73', a: 'mohawk', name: 'Mohawk' }, { c: '#efe4cf', a: 'tophat', name: 'Top hat' },
  { c: '#c55df0', a: 'flower', name: 'Flower' }, { c: '#ffb627', a: 'star', name: 'Star' },
];
export const hex = (c) => String(c || '#8b6cff').split('|')[0];
// A player's look: their chosen character, else the colour from their name (bots and phones that skipped pick a look too).
export function lookOf(p, fallbackName) {
  const av = p && Number.isInteger(p.av) ? p.av : null;
  if (av !== null && LOOKS[av]) return LOOKS[av].c + '|' + LOOKS[av].a;
  return colOf((p && p.name) || fallbackName || '');
}
const ACC = {
  cap: (c) => `<path d="M-30 -86 Q-28 -112 0 -112 Q28 -112 30 -86 Z" fill="${c}"/><path d="M-30 -86 Q-28 -112 0 -112 Q28 -112 30 -86 Z" fill="#000" opacity=".18"/><path d="M8 -88 Q40 -92 52 -84 Q40 -80 8 -82Z" fill="${c}"/><circle cx="0" cy="-112" r="4" fill="#fff" opacity=".8"/>`,
  beanie: (c) => `<path d="M-32 -82 Q-32 -118 0 -118 Q32 -118 32 -82 Z" fill="${c}"/><rect x="-34" y="-90" width="68" height="12" rx="6" fill="#fff" opacity=".85"/><circle cx="0" cy="-122" r="9" fill="#fff"/>`,
  antenna: () => `<path d="M0 -96 V-124" stroke="#9fe8ff" stroke-width="4" stroke-linecap="round"/><circle cx="0" cy="-128" r="8" fill="#5dffb0"/><circle cx="0" cy="-128" r="14" fill="#5dffb0" opacity=".25"/>`,
  bow: () => `<g transform="translate(20 -98) rotate(18)"><path d="M0 0 L-18 -12 L-18 12Z M0 0 L18 -12 L18 12Z" fill="#ff4fd8"/><circle r="6" fill="#ffd0f4"/></g>`,
  mohawk: (c) => `<path d="M-6 -94 Q-14 -112 -4 -126 Q0 -112 4 -128 Q14 -112 6 -94Z" fill="${shade(c, 0.62)}" stroke="#141a3a" stroke-width="2"/>`,
  tophat: () => `<rect x="-30" y="-100" width="60" height="9" rx="4" fill="#3a4790" stroke="#c9d2ff" stroke-width="2"/><rect x="-19" y="-132" width="38" height="34" rx="5" fill="#3a4790" stroke="#c9d2ff" stroke-width="2"/><rect x="-19" y="-110" width="38" height="7" fill="#ff4fd8"/>`,
  flower: () => `<g transform="translate(-20 -100)">${[0, 72, 144, 216, 288].map((r) => `<ellipse cx="0" cy="-9" rx="6" ry="9" fill="#fff" transform="rotate(${r})"/>`).join('')}<circle r="6" fill="#ffb627"/></g>`,
  star: () => `<path d="M0 -136 L6 -122 L21 -121 L9 -112 L13 -97 L0 -105 L-13 -97 L-9 -112 L-21 -121 L-6 -122Z" fill="#ffd34d" stroke="#b36a00" stroke-width="2"/>`,
};
let uid = 0;
const id = (p) => p + (++uid).toString(36);

const BLOB = 'M0 -84 C26 -84 34 -60 34 -36 C34 -10 22 0 0 0 C-22 0 -34 -10 -34 -36 C-34 -60 -26 -84 0 -84Z';
const BLOBSH = 'M0 -84 C26 -84 34 -60 34 -36 C34 -10 22 0 0 0 C14 -8 22 -30 18 -54 C16 -70 10 -80 0 -84Z';
const SHIELD = 'M0 -14 L11 -10 V-2 C11 6 6 12 0 14 C-6 12 -11 6 -11 -2 V-10Z';
export const SHIELD_ICON = (fill = C.cyan, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z" fill="${fill}"/><path d="M8 12l3 3 5-6" stroke="#060a1c" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const FLAG_ICON = (size = 26, pole = '#e0218a', flag = '#ff4fd8') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3" stroke="${pole}" stroke-width="3" stroke-linecap="round"/><path d="M6 4h12l-3 4.5 3 4.5H6z" fill="${flag}"/></svg>`;

// ---- a Human Firewall defender: blob in visor, headset and shield badge. Origin at its feet. ----
// mood: hold | idle | happy | sad. dir: 1 faces right, -1 left.
export function defender(x, y, look, dir = 1, mood = 'hold', k = 1) {
  const c = hex(look), acc = String(look || '').split('|')[1];
  let s = `<g transform="translate(${x} ${y}) scale(${k})"><ellipse cx="0" cy="2" rx="30" ry="7" fill="#000" opacity=".35"/>
  <path d="${BLOB}" fill="${c}"/><path d="${BLOBSH}" fill="${shade(c, 0.78)}"/>
  <ellipse cx="${-7 * dir}" cy="-24" rx="13" ry="11" fill="#fff" opacity=".2"/>
  <g transform="translate(0 -22)"><path d="${SHIELD}" fill="#0b1440"/><path d="${SHIELD}" transform="scale(.72)" fill="#22e4ff"/><path d="M-4 0 L-1 3 L4 -3" stroke="#0b1440" stroke-width="2" fill="none" stroke-linecap="round"/></g>
  <path d="M-31 -58 Q-30 -96 0 -96 Q30 -96 31 -58" stroke="#141c4a" stroke-width="6" fill="none"/>
  <rect x="-38" y="-66" width="11" height="18" rx="5" fill="#26326e"/><rect x="27" y="-66" width="11" height="18" rx="5" fill="#26326e"/>
  <path d="M${33 * dir} -50 Q${30 * dir} -36 ${12 * dir} -36" stroke="#26326e" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="${12 * dir}" cy="-36" r="3.5" fill="#22e4ff"/>
  <rect x="-28" y="-68" width="56" height="22" rx="11" fill="#0a1236" opacity=".9"/><rect x="-28" y="-68" width="56" height="22" rx="11" fill="none" stroke="${mood === 'sad' ? '#ff8fd8' : '#22e4ff'}" stroke-width="2" opacity=".8"/>
  <path d="M-22 -64 H-4" stroke="#fff" stroke-width="2" opacity=".25" stroke-linecap="round"/>`;
  if (mood === 'hold') s += `<g class="blink"><rect x="${-18 + 3 * dir}" y="-61" width="12" height="7" rx="3.5" fill="#22e4ff"/><rect x="${6 + 3 * dir}" y="-61" width="12" height="7" rx="3.5" fill="#22e4ff"/></g><path d="M-5 -38 Q0 -40 5 -38" stroke="#141a3a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (mood === 'idle') s += `<g class="blink"><rect x="-18" y="-60" width="12" height="6" rx="3" fill="#7d8fc0"/><rect x="6" y="-60" width="12" height="6" rx="3" fill="#7d8fc0"/></g><path d="M-5 -38 H5" stroke="#141a3a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (mood === 'happy') s += `<path d="M-18 -54 Q-12 -63 -6 -54 M6 -54 Q12 -63 18 -54" stroke="#5dffb0" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M-8 -40 Q0 -31 8 -40" stroke="#141a3a" stroke-width="3.5" fill="#ff8fa0" stroke-linecap="round"/>`;
  else s += `<path d="M-18 -60 Q-12 -54 -6 -60 M6 -60 Q12 -54 18 -60" stroke="#ff8fd8" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M-6 -36 Q0 -41 6 -36" stroke="#141a3a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M24 -46 q3 6 0 9 q-3 -3 0 -9z" fill="#9fe8ff"/>`;
  if (acc && ACC[acc]) s += ACC[acc](c);
  return s + '</g>';
}
// A defender on its own, in a small square SVG (avatars, chips, rows).
// With an accessory the box grows upwards so a hat or antenna isn't cut off.
export const avatar = (c, mood = 'hold', dir = 1) => `<svg viewBox="${String(c || '').includes('|') ? '-46 -140 92 146' : '-42 -100 84 106'}" aria-hidden="true" overflow="visible">${defender(0, 0, c, dir, mood)}</svg>`;

// ---- friendly disguises (origin bottom-centre, ~210 tall) ----
const BODY = (a, b) => `<path d="M0 -190 C60 -190 76 -140 76 -90 C76 -30 50 -6 0 -6 C-50 -6 -76 -30 -76 -90 C-76 -140 -60 -190 0 -190Z" fill="${a}"/><path d="M0 -190 C60 -190 76 -140 76 -90 C76 -30 50 -6 0 -6 C34 -20 50 -60 44 -110 C40 -150 24 -180 0 -190Z" fill="${b}"/>`;
const EYES = `<g class="blink"><ellipse cx="-24" cy="-126" rx="12" ry="14" fill="#fff"/><ellipse cx="24" cy="-126" rx="12" ry="14" fill="#fff"/><circle cx="-22" cy="-122" r="6.5" fill="#141a3a"/><circle cx="26" cy="-122" r="6.5" fill="#141a3a"/></g>`;
const SMILE = `<path d="M-18 -98 Q0 -84 18 -98" stroke="#141a3a" stroke-width="6" fill="none" stroke-linecap="round"/>`;
const SHADOW = `<ellipse cx="0" cy="4" rx="70" ry="12" fill="#000" opacity=".35"/>`;
const DISGUISE = {
  courier: () => `${SHADOW}<path d="M-26 -10 L-30 2 M26 -10 L30 2" stroke="#3a2a1a" stroke-width="12" stroke-linecap="round"/>
  ${BODY('#f2a65a', '#d98a42')}
  <path d="M-72 -78 Q-50 -66 0 -64 Q50 -66 72 -78 L74 -50 Q40 -36 0 -36 Q-40 -36 -74 -50Z" fill="#2fbf71"/>
  <g class="blink"><ellipse cx="-24" cy="-122" rx="13" ry="15" fill="#fff"/><ellipse cx="24" cy="-122" rx="13" ry="15" fill="#fff"/><circle cx="-22" cy="-118" r="7" fill="#141a3a"/><circle cx="26" cy="-118" r="7" fill="#141a3a"/><circle cx="-20" cy="-121" r="2.5" fill="#fff"/><circle cx="28" cy="-121" r="2.5" fill="#fff"/></g>
  <path d="M-20 -94 Q0 -78 20 -94" stroke="#141a3a" stroke-width="6" fill="#ff8fa0" stroke-linecap="round"/>
  <ellipse cx="-44" cy="-100" rx="9" ry="5" fill="#ff8fa0" opacity=".7"/><ellipse cx="44" cy="-100" rx="9" ry="5" fill="#ff8fa0" opacity=".7"/>
  <path d="M-62 -160 Q-60 -206 0 -208 Q60 -206 62 -160 Z" fill="#2fbf71"/><path d="M-62 -160 Q0 -150 96 -158 Q100 -146 80 -144 Q0 -140 -62 -150Z" fill="#1f8f52"/>
  <path d="M0 -200 L18 -192 V-176 L0 -168 L-18 -176 V-192Z" fill="#fff"/><path d="M-18 -192 L0 -184 L18 -192 M0 -184 V-168" stroke="#2fbf71" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <g transform="translate(-6 -40) rotate(-6)"><rect x="-56" y="-44" width="112" height="70" rx="8" fill="#d8a66a"/><rect x="-56" y="-44" width="112" height="16" rx="6" fill="#c08c52"/><rect x="-10" y="-44" width="20" height="70" fill="#f1d7a8" opacity=".7"/><rect x="18" y="-8" width="30" height="20" rx="3" fill="#fff"/><path d="M22 -2 h22 M22 4 h14" stroke="#141a3a" stroke-width="2"/></g>
  <circle cx="-58" cy="-56" r="12" fill="#f2a65a"/><circle cx="50" cy="-56" r="12" fill="#f2a65a"/>`,
  helpdesk: () => `${SHADOW}${BODY('#7fb2ff', '#5f90e0')}
  <path d="M-30 -60 L0 -36 L30 -60 L30 -6 L-30 -6Z" fill="#fff" opacity=".9"/><rect x="18" y="-56" width="34" height="42" rx="5" fill="#fff"/><text x="35" y="-28" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="17" fill="#2f5fd0">IT</text>
  <path d="M-66 -128 Q-64 -196 0 -196 Q64 -196 66 -128" stroke="#141c4a" stroke-width="10" fill="none"/><rect x="-80" y="-140" width="20" height="34" rx="9" fill="#26326e"/><rect x="60" y="-140" width="20" height="34" rx="9" fill="#26326e"/><path d="M70 -108 Q66 -80 30 -80" stroke="#26326e" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="28" cy="-80" r="7" fill="#22e4ff"/>
  ${EYES}${SMILE}`,
  bank: () => `${SHADOW}${BODY('#c9b8ff', '#a593e6')}
  <path d="M-46 -70 Q0 -50 46 -70 L52 -10 Q0 4 -52 -10Z" fill="#26326e"/><path d="M-16 -66 L0 -46 L16 -66Z" fill="#fff"/><path d="M0 -50 L-7 -36 L0 -14 L7 -36Z" fill="#ffb627"/>
  ${EYES}${SMILE}
  <g transform="translate(-58 -66) rotate(-14)"><rect x="-34" y="-22" width="68" height="44" rx="7" fill="#22e4ff"/><rect x="-34" y="-12" width="68" height="9" fill="#0b1440"/><rect x="-26" y="6" width="16" height="10" rx="2" fill="#ffd05a"/></g>
  <path d="M-40 -186 Q0 -214 40 -186 Q0 -176 -40 -186Z" fill="#26326e"/>`,
  boss: () => `${SHADOW}${BODY('#ffd3a8', '#e8b688')}
  <path d="M-66 -64 Q0 -40 66 -64 L60 -14 Q0 0 -60 -14Z" fill="#141c4a"/><path d="M-18 -60 L0 -36 L18 -60Z" fill="#fff"/><path d="M0 -40 L-7 -28 L0 -8 L7 -28Z" fill="#ff5d73"/>
  <path d="M-58 -170 Q-30 -206 30 -200 Q66 -190 62 -150 Q40 -178 -10 -170 Q-40 -166 -58 -150Z" fill="#3a2a1a"/>
  <rect x="-44" y="-138" width="38" height="26" rx="10" fill="none" stroke="#141a3a" stroke-width="5"/><rect x="6" y="-138" width="38" height="26" rx="10" fill="none" stroke="#141a3a" stroke-width="5"/><path d="M-6 -126 h12" stroke="#141a3a" stroke-width="5"/>
  <circle cx="-24" cy="-124" r="6" fill="#141a3a"/><circle cx="26" cy="-124" r="6" fill="#141a3a"/>
  <path d="M-16 -94 Q0 -86 16 -94" stroke="#141a3a" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  // A familiar face (family, a friend, a new contact): beanie, phone in hand, a little heart.
  friend: () => `${SHADOW}${BODY('#ff9ec4', '#e57fa8')}
  <path d="M-64 -150 Q-62 -212 0 -212 Q62 -212 64 -150 Q0 -136 -64 -150Z" fill="#5d4bd6"/><path d="M-66 -152 Q0 -134 66 -152 L66 -138 Q0 -122 -66 -138Z" fill="#7f6cff"/><circle cx="0" cy="-214" r="14" fill="#ffd05a"/>
  <g class="blink"><ellipse cx="-24" cy="-114" rx="12" ry="14" fill="#fff"/><ellipse cx="24" cy="-114" rx="12" ry="14" fill="#fff"/><circle cx="-22" cy="-110" r="6.5" fill="#141a3a"/><circle cx="26" cy="-110" r="6.5" fill="#141a3a"/><circle cx="-20" cy="-113" r="2.4" fill="#fff"/><circle cx="28" cy="-113" r="2.4" fill="#fff"/></g>
  <path d="M-16 -88 Q0 -76 16 -88" stroke="#141a3a" stroke-width="6" fill="#ff6f8f" stroke-linecap="round"/>
  <ellipse cx="-44" cy="-94" rx="9" ry="5" fill="#ff5d8f" opacity=".6"/><ellipse cx="44" cy="-94" rx="9" ry="5" fill="#ff5d8f" opacity=".6"/>
  <g transform="translate(58 -58) rotate(12)"><rect x="-22" y="-38" width="44" height="76" rx="10" fill="#141a3a"/><rect x="-17" y="-31" width="34" height="58" rx="6" fill="#22e4ff" opacity=".85"/><path d="M0 4 C-10 -6 -10 -16 -3 -16 C0 -16 0 -13 0 -12 C0 -13 0 -16 3 -16 C10 -16 10 -6 0 4Z" fill="#ff4fd8"/></g>
  <circle cx="48" cy="-50" r="12" fill="#ff9ec4"/>`,
};
export const DISGUISES = Object.keys(DISGUISE);
export const DISGUISE_NAME = { courier: 'Courier', helpdesk: 'IT helpdesk', bank: 'Your bank', boss: 'Work', friend: 'A friend' };
export const disguise = (d, k = 1) => `<g transform="scale(${k})">${(DISGUISE[d] || DISGUISE.courier)()}</g>`;

// ---- attackers under the mask ----
function hooded(acc, hood, face, inner = '') {
  return `<ellipse cx="0" cy="4" rx="74" ry="12" fill="#000" opacity=".4"/>
  <path d="M0 -206 C68 -206 84 -150 84 -96 C84 -28 56 -4 0 -4 C-56 -4 -84 -28 -84 -96 C-84 -150 -68 -206 0 -206Z" fill="${hood}"/>
  <path d="M0 -206 C68 -206 84 -150 84 -96 C84 -28 56 -4 0 -4 C40 -18 58 -62 52 -116 C48 -160 30 -196 0 -206Z" fill="#000" opacity=".18"/>
  <path d="M0 -190 C46 -188 56 -150 54 -120 C52 -90 30 -76 0 -76 C-30 -76 -52 -90 -54 -120 C-56 -150 -46 -188 0 -190Z" fill="${acc}" opacity=".5"/>
  <path d="M0 -184 C40 -182 50 -150 48 -122 C46 -96 28 -82 0 -82 C-28 -82 -46 -96 -48 -122 C-50 -150 -40 -182 0 -184Z" fill="${face}"/>
  <g class="flick"><path d="M-36 -138 Q-22 -156 -6 -138 Q-22 -128 -36 -138Z" fill="${acc}"/><path d="M36 -138 Q22 -156 6 -138 Q22 -128 36 -138Z" fill="${acc}"/><circle cx="-18" cy="-140" r="3.5" fill="#fff"/><circle cx="18" cy="-140" r="3.5" fill="#fff"/>
  <ellipse cx="-20" cy="-140" rx="16" ry="10" fill="${acc}" opacity=".25"/><ellipse cx="20" cy="-140" rx="16" ry="10" fill="${acc}" opacity=".25"/></g>
  <path d="M-22 -112 Q0 -96 22 -112" stroke="${acc}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M8 -106 l4 7 l4 -8" fill="#fff"/>
  <path d="M-40 -40 Q0 -28 40 -40" stroke="#000" stroke-opacity=".25" stroke-width="4" fill="none"/>${inner}`;
}
export const HOOK = (x, y, c) => `<path d="M${x} ${y} v16 q0 12 -10 12 q-9 0 -10 -9" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${x - 20} ${y + 19} l-3 -9 l8 4" fill="${c}"/>`;
const ENV = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-26" y="-18" width="52" height="36" rx="5" fill="#fbf9ff"/><path d="M-26 -16 L0 4 L26 -16" stroke="#7a7fa0" stroke-width="3" fill="none"/></g>`;
function qr(x, y, s) {
  let o = ''; const n = 7, c = s / n;
  const p = [[1, 1, 1, 0, 1, 1, 1], [1, 0, 1, 1, 0, 0, 1], [1, 1, 1, 0, 1, 1, 1], [0, 1, 0, 1, 1, 0, 0], [1, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 1, 0, 1], [1, 1, 1, 0, 1, 1, 1]];
  p.forEach((r, i) => r.forEach((v, j) => { if (v) o += `<rect x="${x + j * c}" y="${y + i * c}" width="${c + 0.3}" height="${c + 0.3}" fill="#141a3a"/>`; }));
  return o;
}
const ATTACKER = {
  phisher: () => hooded('#22e4ff', '#24306e', '#0c1230', `
    <path d="M60 -60 Q110 -150 150 -230" stroke="#9a6a3a" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="64" cy="-64" r="12" fill="#24306e"/>
    <path d="M150 -230 Q160 -150 150 -96" stroke="#cfe" stroke-width="2" fill="none" stroke-dasharray="4 4"/>${HOOK(150, -100, '#c8d3ff')}${ENV(138, -58, 1)}`),
  smisher: () => hooded('#ff4fd8', '#3a1f6b', '#150a2e', `
    <g transform="translate(70 -70) rotate(14)"><rect x="-26" y="-46" width="52" height="92" rx="12" fill="#141a3a"/><rect x="-21" y="-38" width="42" height="72" rx="7" fill="#ff4fd8" opacity=".9"/><path d="M-14 -24 h28 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-18 l-8 7 v-7 h-2 a6 6 0 0 1 -6 -6 v-12 a6 6 0 0 1 6 -6z" fill="#fff"/>${HOOK(0, 6, '#fff')}</g>
    <circle cx="60" cy="-60" r="13" fill="#3a1f6b"/>`),
  visher: () => hooded('#ffb627', '#5a2a1a', '#1c0f0a', `
    <g transform="translate(-62 -130) rotate(-24)"><path d="M-14 -34 Q-28 0 -14 34" stroke="#141a3a" stroke-width="18" fill="none" stroke-linecap="round"/><rect x="-24" y="-44" width="26" height="18" rx="8" fill="#141a3a"/><rect x="-24" y="26" width="26" height="18" rx="8" fill="#141a3a"/></g>
    <path d="M70 -150 q14 14 0 28 M84 -162 q24 26 0 52 M98 -174 q34 38 0 76" stroke="#ffb627" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>`),
  impersonator: () => `<ellipse cx="0" cy="4" rx="74" ry="12" fill="#000" opacity=".4"/>
    <path d="M0 -200 C66 -200 82 -146 82 -94 C82 -28 54 -4 0 -4 C-54 -4 -82 -28 -82 -94 C-82 -146 -66 -200 0 -200Z" fill="#6e6aa8"/>
    <path d="M-72 -64 Q0 -36 72 -64 L64 -12 Q0 4 -64 -12Z" fill="#141c4a"/><path d="M-18 -60 L0 -34 L18 -60Z" fill="#fff"/><path d="M0 -38 L-7 -26 L0 -6 L7 -26Z" fill="#ff4fd8"/>
    <path d="M-66 -168 Q-30 -214 34 -206 Q72 -194 66 -150 Q46 -178 -6 -172 Q-44 -168 -66 -150Z" fill="#141a3a"/>
    <g class="flick"><path d="M-36 -134 Q-22 -144 -10 -132 Q-22 -126 -36 -134Z" fill="#ff4fd8"/><path d="M36 -134 Q22 -144 10 -132 Q22 -126 36 -134Z" fill="#ff4fd8"/></g>
    <path d="M-22 -104 Q0 -90 22 -104" stroke="#141a3a" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M60 -60 L96 -150" stroke="#9a6a3a" stroke-width="6" stroke-linecap="round"/>
    <g transform="translate(104 -176) rotate(10)"><circle r="40" fill="#ffd3a8"/><rect x="-30" y="-14" width="26" height="18" rx="7" fill="none" stroke="#141a3a" stroke-width="4"/><rect x="4" y="-14" width="26" height="18" rx="7" fill="none" stroke="#141a3a" stroke-width="4"/><path d="M-14 16 Q0 26 14 16" stroke="#141a3a" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M-34 -18 Q-10 -46 30 -30" stroke="#3a2a1a" stroke-width="10" fill="none" stroke-linecap="round"/><text y="-52" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="20" fill="#ffb627">CEO</text></g>`,
  fakehelpdesk: () => hooded('#5dffb0', '#1f4a4a', '#0a1a1a', `
    <path d="M-60 -150 Q-58 -214 0 -214 Q58 -214 60 -150" stroke="#141c4a" stroke-width="9" fill="none"/><rect x="-74" y="-162" width="18" height="30" rx="8" fill="#26326e"/><rect x="56" y="-162" width="18" height="30" rx="8" fill="#26326e"/>
    <g transform="translate(-2 -40)"><rect x="-30" y="-24" width="60" height="40" rx="6" fill="#fff"/><text x="0" y="3" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="17" fill="#1f4a4a">IT HELP</text></g>
    <g transform="translate(80 -80) rotate(10)"><rect x="-30" y="-40" width="60" height="78" rx="6" fill="#d8c8a0"/><rect x="-12" y="-46" width="24" height="12" rx="3" fill="#7a7fa0"/><text x="0" y="-12" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="11" fill="#141a3a">PASSWORD?</text><path d="M-20 4 h40 M-20 18 h30" stroke="#141a3a" stroke-width="3" stroke-dasharray="4 3"/></g>`),
  quisher: () => hooded('#ffb627', '#3a3a1f', '#14140a', `
    <g transform="translate(78 -82) rotate(-10)"><rect x="-36" y="-36" width="72" height="72" rx="8" fill="#fff"/>${qr(-28, -28, 56)}</g>
    <g transform="translate(-86 -46) rotate(-20)"><rect x="-18" y="-18" width="36" height="36" rx="4" fill="#fff" opacity=".9"/>${qr(-13, -13, 26)}</g>`),
};
export const PERSONAS = Object.keys(ATTACKER);
export const PERSONA = {
  phisher: { name: 'THE PHISHER', what: 'scam by email', line: 'Casts a fake email and waits for a bite.' },
  smisher: { name: 'THE SMISHER', what: 'scam by text message', line: 'Texts a tiny fee with a link on the hook.' },
  visher: { name: 'THE VISHER', what: 'scam by phone call', line: 'Calls as your bank, calm and urgent.' },
  impersonator: { name: 'THE IMPERSONATOR', what: 'wears a face you trust', line: 'Wears the boss\'s face. "Pay this today."' },
  fakehelpdesk: { name: 'THE FAKE HELPDESK', what: 'fake IT support', line: '"Hi, it\'s IT. Just tap Approve."' },
  quisher: { name: 'THE QUISHER', what: 'scam by QR code', line: 'Sticks a fake QR code over the real one.' },
};
export const attacker = (t, k = 1) => `<g transform="scale(${k})">${(ATTACKER[t] || ATTACKER.phisher)()}</g>`;

// The disguise's face as a dropped mask (for the unmask).
const MASK = {
  courier: ['#f2a65a', `<path d="M-44 -30 Q-42 -64 0 -66 Q42 -64 44 -30Z" fill="#2fbf71"/><path d="M-44 -30 Q10 -24 64 -30 Q66 -22 52 -20 Q0 -18 -44 -24Z" fill="#1f8f52"/>`],
  helpdesk: ['#7fb2ff', `<path d="M-50 4 Q-50 -64 0 -64 Q50 -64 50 4" stroke="#141c4a" stroke-width="7" fill="none"/><rect x="-58" y="-6" width="14" height="22" rx="6" fill="#26326e"/><rect x="44" y="-6" width="14" height="22" rx="6" fill="#26326e"/>`],
  bank: ['#c9b8ff', `<path d="M-30 -50 Q0 -70 30 -50 Q0 -42 -30 -50Z" fill="#26326e"/>`],
  boss: ['#ffd3a8', `<path d="M-44 -26 Q-20 -64 30 -58 Q52 -48 46 -20 Q30 -40 -6 -36 Q-30 -32 -44 -20Z" fill="#3a2a1a"/><rect x="-32" y="-16" width="26" height="18" rx="7" fill="none" stroke="#141a3a" stroke-width="4"/><rect x="6" y="-16" width="26" height="18" rx="7" fill="none" stroke="#141a3a" stroke-width="4"/>`],
  friend: ['#ff9ec4', `<path d="M-46 -24 Q-44 -70 0 -70 Q44 -70 46 -24 Q0 -14 -46 -24Z" fill="#5d4bd6"/><circle cx="0" cy="-70" r="10" fill="#ffd05a"/>`],
};
function mask(d) {
  const [face, extra] = MASK[d] || MASK.courier;
  return `<ellipse cx="0" cy="0" rx="46" ry="54" fill="${face}"/><ellipse cx="-16" cy="-8" rx="8" ry="10" fill="#141a3a"/><ellipse cx="16" cy="-8" rx="8" ry="10" fill="#141a3a"/>
  <path d="M-14 18 Q0 28 14 18" stroke="#141a3a" stroke-width="4" fill="none" stroke-linecap="round"/>${extra}
  <path d="M-46 0 Q-70 6 -78 26" stroke="#c9b8ff" stroke-width="3" fill="none" stroke-dasharray="3 4"/>`;
}
// The reveal of a scam: the attacker, mask just pulled off, the dropped disguise in its hand. viewBox 0 0 300 430.
export function unmasked(persona, disg) {
  const g = id('mg');
  return `<g transform="translate(150 420)"><defs><radialGradient id="${g}"><stop offset="0" stop-color="#ff4fd8" stop-opacity=".35"/><stop offset="1" stop-color="#ff4fd8" stop-opacity="0"/></radialGradient></defs><circle cx="0" cy="-150" r="170" fill="url(#${g})"/>
   <g class="unmask">${attacker(persona, 1.3)}</g>
   <g class="maskoff" transform="translate(-112 -112) rotate(-28)">${mask(disg)}</g></g>`;
}
// The reveal of a real message: the same friendly face, with a big thumbs up.
export function legit(disg) {
  const g = id('lg');
  return `<g transform="translate(150 420)"><defs><radialGradient id="${g}"><stop offset="0" stop-color="#5dffb0" stop-opacity=".3"/><stop offset="1" stop-color="#5dffb0" stop-opacity="0"/></radialGradient></defs><circle cx="0" cy="-150" r="170" fill="url(#${g})"/>
   ${disguise(disg, 1.45)}<g transform="translate(96 -210)"><circle r="46" fill="#5dffb0"/><path d="M-14 20 V-6 L0 -32 Q11 -35 9 -15 H26 Q35 -12 29 0 L23 20Z" fill="#060a1c"/></g></g>`;
}
// A hooded silhouette with a question mark (between messages: who's next?).
export function mystery() {
  return `<g transform="translate(150 420) scale(1.3)"><ellipse cx="0" cy="4" rx="74" ry="12" fill="#000" opacity=".4"/>
  <path d="M0 -206 C68 -206 84 -150 84 -96 C84 -28 56 -4 0 -4 C-56 -4 -84 -28 -84 -96 C-84 -150 -68 -206 0 -206Z" fill="#1d2a66"/>
  <path d="M0 -184 C40 -182 50 -150 48 -122 C46 -96 28 -82 0 -82 C-28 -82 -46 -96 -48 -122 C-50 -150 -40 -182 0 -184Z" fill="#0a0f2a"/>
  <text x="0" y="-104" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="84" fill="#22e4ff" class="glow">?</text></g>`;
}

// ---- the neon city: network in the sky, skyline, circuit-trace ground. ----
export function world(w, h, phone) {
  let s = '';
  const nodes = phone ? [[40, 110], [130, 70], [250, 130], [350, 80], [300, 200], [90, 210]] : [[140, 180], [380, 120], [620, 210], [900, 110], [1180, 190], [1460, 120], [1720, 220], [1840, 140], [260, 330], [1600, 330]];
  const edges = phone ? [[0, 1], [1, 2], [2, 3], [2, 4], [0, 5]] : [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [0, 8], [5, 9], [6, 9]];
  edges.forEach(([a, b]) => { s += `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="#22e4ff" stroke-opacity=".12" stroke-width="2"/>`; });
  nodes.forEach(([x, y], i) => { const c = i % 3 === 1 ? '#ff4fd8' : '#22e4ff'; s += `<circle cx="${x}" cy="${y}" r="${phone ? 8 : 14}" fill="${c}" opacity=".12"/><circle cx="${x}" cy="${y}" r="${phone ? 2.5 : 4}" fill="${c}" opacity=".7"/>`; });
  for (let i = 0; i < (phone ? 30 : 80); i++) s += `<circle cx="${(i * 733) % w}" cy="${(i * 389) % (h * 0.5)}" r="${i % 6 ? 1 : 1.8}" fill="#fff" opacity="${0.1 + (i % 4) * 0.08}"/>`;
  const base = phone ? h - 120 : h - 300;
  const bw = phone ? [26, 40, 22, 34, 48, 30, 26, 38, 30, 44, 28, 36] : [70, 110, 60, 90, 140, 80, 70, 120, 90, 150, 60, 100, 80, 130, 70, 110, 90, 140, 70, 100, 120, 90];
  let x = 0, i = 0;
  while (x < w) {
    const ww = bw[i % bw.length], hh = (phone ? 50 : 120) + ((i * 97) % (phone ? 90 : 240)), y = base - (phone ? hh * 0.55 : hh);
    s += `<rect x="${x}" y="${y}" width="${ww - 4}" height="${hh + 400}" fill="${i % 2 ? '#111a48' : '#0e1640'}"/>`;
    for (let wy = y + (phone ? 8 : 16); wy < base; wy += phone ? 12 : 26) for (let wx = x + (phone ? 5 : 12); wx < x + ww - (phone ? 10 : 20); wx += phone ? 9 : 22) { const r = (wx * 7 + wy * 13 + i) % 11; if (r < 3) s += `<rect x="${wx}" y="${wy}" width="${phone ? 4 : 9}" height="${phone ? 5 : 11}" rx="1.5" fill="${['#22e4ff', '#ff4fd8', '#ffb627'][r]}" opacity="${(phone ? 0.12 : 0.22) + r * 0.08}"/>`; }
    if (i % 5 === 2 && !phone) s += `<line x1="${x + ww / 2}" y1="${y}" x2="${x + ww / 2}" y2="${y - 40}" stroke="#2a3a80" stroke-width="3"/><circle cx="${x + ww / 2}" cy="${y - 40}" r="5" fill="#ff4fd8" class="glow"/>`;
    if (i % 7 === 4 && !phone) s += `<g transform="translate(${x + ww / 2} ${y + 50})" opacity=".55"><path d="M0 -26 L22 -18 V0 C22 16 12 26 0 30 C-12 26 -22 16 -22 0 V-18Z" fill="none" stroke="#22e4ff" stroke-width="3"/><path d="M-8 2 l6 6 l10 -12" stroke="#22e4ff" stroke-width="3" fill="none"/></g>`;
    x += ww; i++;
  }
  const gy = phone ? h - 120 : h - 250;
  s += `<path d="M0 ${gy} Q${w * 0.3} ${gy - 18} ${w * 0.55} ${gy - 6} T${w} ${gy - 10} V${h} H0Z" fill="#0f1745"/>`;
  s += `<path d="M0 ${gy} Q${w * 0.3} ${gy - 18} ${w * 0.55} ${gy - 6} T${w} ${gy - 10}" stroke="#22e4ff" stroke-opacity=".35" stroke-width="3" fill="none"/>`;
  const traces = phone ? [[0, 40, 80, 60, 160], [390, 70, 300, 90, 220]] : [[0, 90, 260, 120, 520], [1920, 80, 1640, 130, 1380], [700, 170, 820, 200, 1100], [1240, 160, 1300, 210, 1500]];
  traces.forEach(([x1, dy, x2, dy2, x3]) => { const y1 = gy + dy, y2 = gy + dy2; s += `<path d="M${x1} ${y1} H${x2} L${x2 + (x3 > x2 ? 30 : -30)} ${y2} H${x3}" stroke="#22e4ff" stroke-opacity=".22" stroke-width="3" fill="none"/><circle cx="${x3}" cy="${y2}" r="6" fill="none" stroke="#22e4ff" stroke-opacity=".5" stroke-width="3"/>`; });
  return s;
}

// The HOLD logo's padlock "O".
export const LOCK = `<svg viewBox="0 0 50 58" aria-hidden="true"><path d="M14 26 V18 a11 11 0 0 1 22 0 V26" stroke="#22e4ff" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="4" y="24" width="42" height="32" rx="10" fill="#b36a00"/><rect x="4" y="22" width="42" height="31" rx="10" fill="#ffb627"/><circle cx="25" cy="35" r="5" fill="#b36a00"/><rect x="22.5" y="36" width="5" height="9" rx="2" fill="#b36a00"/></svg>`;
export const logo = () => `H${LOCK}LD`;

// ---- the pot jar (viewBox 0 0 330 330). fill: 0..1 how full. ----
export function jar(fill = 0.6, dead = false) {
  const clip = id('jc'), glass = id('gl');
  const rows = Math.max(0, Math.min(7, Math.round(fill * 7)));
  let coins = '';
  for (let r = 0; r < rows; r++) { const y = 300 - r * 20; for (let i = 0; i < 5; i++) { const x = 88 + i * 40 + (r % 2 ? 20 : 0) + Math.sin(r * 3 + i) * 6; if (x > 250) continue; coins += `<ellipse cx="${x}" cy="${y + 4}" rx="24" ry="9" fill="#b36a00"/><ellipse cx="${x}" cy="${y}" rx="24" ry="9" fill="${(r + i) % 3 ? '#ffb627' : '#ffcd4d'}"/><ellipse cx="${x}" cy="${y}" rx="15" ry="5" fill="none" stroke="#ffd36b" stroke-width="2"/>`; } }
  const edge = dead ? '#ff4fd8' : '#22e4ff';
  return `<defs><linearGradient id="${glass}" x1="0" x2="1"><stop offset="0" stop-color="${edge}" stop-opacity=".25"/><stop offset=".25" stop-color="${edge}" stop-opacity=".06"/><stop offset=".8" stop-color="${edge}" stop-opacity=".04"/><stop offset="1" stop-color="${edge}" stop-opacity=".2"/></linearGradient><clipPath id="${clip}"><path d="M70 92 Q60 110 60 150 V280 Q60 312 92 312 H238 Q270 312 270 280 V150 Q270 110 260 92Z"/></clipPath></defs>
   <ellipse cx="165" cy="318" rx="130" ry="14" fill="#000" opacity=".4"/><g clip-path="url(#${clip})"${dead ? ' opacity=".35"' : ''}>${coins}</g>
   <path d="M70 92 Q60 110 60 150 V280 Q60 312 92 312 H238 Q270 312 270 280 V150 Q270 110 260 92Z" fill="url(#${glass})" stroke="${edge}" stroke-opacity=".6" stroke-width="5"/>
   <path d="M84 130 V270" stroke="#fff" stroke-opacity=".3" stroke-width="9" stroke-linecap="round"/>
   <rect x="58" y="62" width="214" height="34" rx="12" fill="#1d2a66"/><rect x="58" y="62" width="214" height="34" rx="12" fill="none" stroke="${edge}" stroke-opacity=".5" stroke-width="3"/>
   <g transform="translate(165 214)"><path d="M0 -40 L34 -28 V-2 C34 22 18 36 0 42 C-18 36 -34 22 -34 -2 V-28Z" fill="#0b1440" stroke="${edge}" stroke-width="4"/><text y="8" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="30" fill="${edge}">R</text></g>`;
}
export const COIN = `<svg class="coinfall" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="22" r="17" fill="#b36a00"/><circle cx="20" cy="19" r="17" fill="#ffb627"/><circle cx="20" cy="19" r="11" fill="none" stroke="#ffd36b" stroke-width="2.5"/></svg>`;
export const MINIJAR = `<svg viewBox="0 0 62 70" aria-hidden="true"><path d="M12 16 Q8 22 8 30 V58 Q8 66 16 66 H46 Q54 66 54 58 V30 Q54 22 50 16Z" fill="#22e4ff18" stroke="#22e4ff99" stroke-width="3"/><rect x="8" y="8" width="46" height="10" rx="4" fill="#1d2a66" stroke="#22e4ff88" stroke-width="2"/><ellipse cx="31" cy="58" rx="18" ry="5" fill="#b36a00"/><ellipse cx="31" cy="55" rx="18" ry="5" fill="#ffb627"/><ellipse cx="26" cy="49" rx="14" ry="4.5" fill="#b36a00"/><ellipse cx="26" cy="46" rx="14" ry="4.5" fill="#ffb627"/><ellipse cx="34" cy="40" rx="12" ry="4" fill="#b36a00"/><ellipse cx="34" cy="37.5" rx="12" ry="4" fill="#ffb627"/></svg>`;

// ---- a team: its defenders around one shared button. viewBox -6 92 312 158 (about 2:1). ----
// members: [{ c: colour, on: key in (hands on the button) }]. state: wait | hold | banked | out | caught | dbl | idle | final.
const DOME = { hold: ['#bff8ff', '#22e4ff', '#0a7a9a'], banked: ['#ffe08a', '#ffb627', '#b37400'], dbl: ['#ffe08a', '#ffb627', '#b37400'], final: ['#ffe08a', '#ffb627', '#b37400'], caught: ['#f2c8e8', '#b06aa0', '#5a2a58'], wait: ['#6f7cb8', '#3a4790', '#1d2552'], idle: ['#6f7cb8', '#3a4790', '#1d2552'], out: ['#4a5390', '#2a3270', '#161c48'] };
export function team(members, state = 'hold', opts = {}) {
  const g = id('d'), dome = DOME[state] || DOME.wait, n = members.length;
  const glowOn = state === 'hold';
  let s = `<svg viewBox="-6 92 312 158" class="tsvg" aria-hidden="true" overflow="visible"><defs><radialGradient id="${g}" cx=".4" cy=".25" r=".85"><stop offset="0" stop-color="${dome[0]}"/><stop offset=".5" stop-color="${dome[1]}"/><stop offset="1" stop-color="${dome[2]}"/></radialGradient></defs>
   <ellipse cx="150" cy="236" rx="150" ry="22" fill="#070c2e" opacity=".6"/><ellipse cx="150" cy="236" rx="150" ry="22" fill="none" stroke="${state === 'caught' ? '#ff4fd8' : '#22e4ff'}" stroke-opacity=".18" stroke-width="2"/>`;
  if (glowOn) s += `<ellipse class="glow" cx="150" cy="200" rx="120" ry="44" fill="#22e4ff" opacity=".18"/>`;
  const top = glowOn ? 166 : 150;
  s += `<ellipse cx="150" cy="226" rx="78" ry="20" fill="#0d1230"/><path d="M72 208 V226 A78 20 0 0 0 228 226 V208Z" fill="#1d2552"/><ellipse cx="150" cy="208" rx="78" ry="20" fill="#2f3b7c"/>
   <path d="M90 206 Q90 ${top} 150 ${top - 2} Q210 ${top} 210 206 A60 16 0 0 1 90 206Z" fill="url(#${g})"/><ellipse cx="128" cy="${top + 12}" rx="20" ry="6" fill="#fff" opacity="${state === 'out' || state === 'wait' || state === 'idle' ? 0.18 : 0.5}" transform="rotate(-10 128 ${top + 12})"/>`;
  if (state === 'dbl') s += `<text x="150" y="200" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="30" fill="#5a3500">×2</text>`;
  // Seats: 1 = left, 2 = left + right, 3 = left + right + back.
  const seats = n === 1 ? [[50, 1]] : n === 2 ? [[50, 1], [250, -1]] : [[50, 1], [250, -1], [150, 1]];
  const mood = { hold: 'hold', wait: 'idle', idle: 'idle', banked: 'happy', dbl: 'happy', final: 'happy', out: 'idle', caught: 'sad' }[state] || 'idle';
  const order = n === 3 ? [2, 0, 1] : members.map((_, i) => i);
  for (const i of order) {
    const m = members[i], [x, d] = seats[i] || seats[0], back = i === 2;
    const k = back ? 1.05 : 1.3, y = back ? 168 : 240;
    const md = state === 'wait' || state === 'idle' ? (m.on ? 'hold' : 'idle') : mood;
    s += defender(x, y, m.c, d, md, k);
    if ((state === 'hold' || ((state === 'wait' || state === 'idle') && m.on)) && !back) {
      const hx = x === 50 ? [82, 192, 118, 176, 124, 174] : [218, 192, 182, 176, 176, 174];
      s += `<g class="hand"><path d="M${hx[0]} ${hx[1]} Q${(hx[0] + hx[2]) / 2} 172 ${hx[2]} ${hx[3]}" stroke="${shade(hex(m.c), 0.85)}" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cx="${hx[4]}" cy="${hx[5]}" rx="14" ry="9" fill="${hex(m.c)}"/></g>`;
    }
    if ((state === 'banked' || state === 'dbl' || state === 'final') && !back) {
      s += `<path d="M${x + 6 * d} 188 Q${x + 14 * d} 160 ${x + 8 * d} 140" stroke="${shade(hex(m.c), 0.85)}" stroke-width="11" fill="none" stroke-linecap="round"/><g transform="translate(${x + 10 * d} 122) rotate(${8 * d})"><path d="M0 -26 L22 -18 V0 C22 16 12 26 0 30 C-12 26 -22 16 -22 0 V-18Z" fill="${state === 'banked' ? '#22e4ff' : '#ffb627'}" stroke="#0b1440" stroke-width="3"/><path d="M-8 2 l6 6 l10 -12" stroke="#0b1440" stroke-width="4" fill="none" stroke-linecap="round"/></g>`;
    }
  }
  if (state === 'caught') s += `<path d="M150 150 v-14" stroke="#ff4fd8" stroke-opacity=".5" stroke-width="3" stroke-dasharray="3 4"/>` + HOOK(150, 118, '#ff8fd8');
  if (opts.offline) s += `<text x="150" y="130" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="20" fill="#93a0d8">OFFLINE</text>`;
  return s + '</svg>';
}

// ---- the phone's big button (viewBox 0 0 330 300). state: idle | on | locked | gold | sad ----
export function bigButton(state = 'idle', label = '') {
  const d = id('pd'), h = id('ph');
  const col = { on: ['#d4fbff', '#22e4ff', '#0a7a9a', '#06607a', '#06263a'], idle: ['#8e9bd6', '#3a4790', '#1d2552', '#4a58a0', '#c9d2ff'], locked: ['#8e9bd6', '#3a4790', '#1d2552', '#4a58a0', '#c9d2ff'], gold: ['#fff1b8', '#ffb627', '#b37400', '#7a4a00', '#3a2200'], sad: ['#f2c8e8', '#b06aa0', '#5a2a58', '#3a1838', '#2a0c26'] }[state] || [];
  const top = state === 'on' ? 126 : 110;
  let fp = '';
  [[10, 6, '40 8'], [20, 12, '70 10 30 12'], [30, 18, '90 14 50 10'], [40, 24, '120 16 60 14'], [50, 30, '150 18 80 20']].forEach(([rx, ry, da]) => { fp += `<ellipse cx="165" cy="${top + 38}" rx="${rx}" ry="${ry}" stroke-dasharray="${da}" transform="rotate(-8 165 ${top + 38})"/>`; });
  const txt = label ? String(label).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : '';
  const n = String(label || '').length, fs = n > 14 ? 17 : n > 10 ? 19 : 22;
  return `<defs><radialGradient id="${d}" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="${col[0]}"/><stop offset=".45" stop-color="${col[1]}"/><stop offset="1" stop-color="${col[2]}"/></radialGradient><radialGradient id="${h}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${col[1]}" stop-opacity="${state === 'on' ? 0.45 : 0.12}"/><stop offset="1" stop-color="${col[1]}" stop-opacity="0"/></radialGradient></defs>
   <ellipse class="${state === 'on' ? 'glow' : ''}" cx="165" cy="160" rx="170" ry="150" fill="url(#${h})"/><ellipse cx="165" cy="250" rx="140" ry="40" fill="#000" opacity=".35"/>
   <ellipse cx="165" cy="226" rx="140" ry="46" fill="#0d1230"/><path d="M25 200 V226 A140 46 0 0 0 305 226 V200Z" fill="#1d2552"/><ellipse cx="165" cy="200" rx="140" ry="46" fill="#2a346e"/><ellipse cx="165" cy="200" rx="140" ry="46" fill="none" stroke="#22e4ff" stroke-opacity="${state === 'on' ? 0.5 : 0.25}" stroke-width="3"/>
   <path d="M55 196 Q55 ${top} 165 ${top - 4} Q275 ${top} 275 196 A110 34 0 0 1 55 196Z" fill="url(#${d})"/><ellipse cx="165" cy="196" rx="110" ry="34" fill="${col[2]}" opacity=".5"/><ellipse cx="125" cy="${top + 22}" rx="40" ry="14" fill="#fff" opacity=".45" transform="rotate(-12 125 ${top + 22})"/>
   <g fill="none" stroke="${col[3]}" stroke-width="4.5" stroke-linecap="round" opacity="${state === 'on' ? 0.7 : 0.45}">${fp}</g>
   ${txt ? `<text x="165" y="214" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${fs}" letter-spacing="2" fill="${col[4]}">${txt}</text>` : ''}`;
}

// The phone's caught picture: the sad pair by a dimmed button, the attacker sneaking off with the coins. viewBox 0 0 346 250.
export function caughtArt(persona, cols) {
  const d = id('cd');
  const [a, b] = [cols[0] || '#2ed3b7', cols[1] || cols[0] || '#8b6cff'];
  return `<defs><radialGradient id="${d}" cx=".4" cy=".25" r=".85"><stop offset="0" stop-color="#f2c8e8"/><stop offset=".5" stop-color="#b06aa0"/><stop offset="1" stop-color="#5a2a58"/></radialGradient></defs>
   <ellipse cx="130" cy="232" rx="128" ry="16" fill="#070c2e" opacity=".6"/>
   <ellipse cx="130" cy="222" rx="64" ry="16" fill="#0d1230"/><path d="M66 208 V222 A64 16 0 0 0 194 222 V208Z" fill="#1d2552"/><ellipse cx="130" cy="208" rx="64" ry="16" fill="#2f3b7c"/><path d="M80 206 Q80 170 130 168 Q180 170 180 206 A50 13 0 0 1 80 206Z" fill="url(#${d})"/>
   ${defender(40, 236, a, 1, 'sad', 1.15)}${cols.length > 1 ? defender(220, 236, b, -1, 'sad', 1.15) : ''}
   <g transform="translate(300 150) scale(.42)">${attacker(persona || 'phisher')}<g transform="translate(-70 -10)"><path d="M-40 -60 Q-60 0 -40 20 H40 Q60 0 40 -60Z" fill="#b36a00"/><path d="M-36 -64 Q0 -80 36 -64" stroke="#7a4a10" stroke-width="10" fill="none"/><text y="-10" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="44" fill="#ffd36b">R</text></g></g>
   <path d="M240 120 q10 -10 20 0" stroke="#ff4fd8" stroke-width="3" fill="none" opacity=".5" stroke-dasharray="3 5"/>`;
}

// App icons for the message card.
export const APP = {
  sms: '<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6L4.5 21l4.3-2.3c1 .3 2.1.4 3.2.4 5.5 0 10-3.6 10-8s-4.5-8-10-8z" fill="#fff"/></svg>',
  whatsapp: '<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5z" fill="#fff"/><path d="M8.6 7.6c.3-.6.6-.6.9-.6h.6c.2 0 .5 0 .7.6l.8 1.9c.1.3 0 .5-.1.7l-.6.7c-.1.2-.2.3 0 .6.6 1 1.7 2 2.9 2.6.3.1.5.1.6-.1l.8-.9c.2-.2.4-.3.7-.2l1.8.9c.3.1.5.3.5.5 0 .6-.3 1.5-1 1.9-.7.4-1.6.5-3.5-.3-2.2-1-3.8-3.1-4.3-3.9-.5-.8-1-2.2-.3-3.4z" fill="#25d366"/></svg>',
  email: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="#fff"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5" stroke="#2f6bff" stroke-width="2" stroke-linejoin="round"/></svg>',
};
export const APPBG = { sms: 'linear-gradient(180deg,#45d16b,#23a84a)', whatsapp: 'linear-gradient(180deg,#2fe07a,#13a85a)', email: 'linear-gradient(180deg,#5b9dff,#2f6bff)' };
export const CHAN = { sms: 'TEXT', whatsapp: 'WHATSAPP', email: 'EMAIL' };

// ---- LAST BUSINESS STANDING (18 Nov): the market. One building per company: height = revenue, lit = open. ----
const gbpA = (n) => 'R' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
const escA = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A company's label in two lines ("Slate &" / "Winter"), without "Ltd"; each line cut at `max` characters.
export function labelLines(label, max = 13) {
  const t = String(label || '').replace(/ Ltd$/, ''), i = t.lastIndexOf(' & ');
  const cut = (s) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  return i < 0 ? [cut(t), ''] : [cut(t.slice(0, i) + ' &'), cut(t.slice(i + 3))];
}
// m: { cols: [colours], open, closedNow, shake, label, total }. o: row (window pitch), pair (rooftop people), crown, lab
// (label offset under the base), nf (label font size), money, sign / signFont (CLOSED sign), happy, mark.
export function building(x, w, h, base, m, o = {}) {
  const top = base - h, open = m.open, cols = m.cols && m.cols.length ? m.cols : ['#22e4ff'];
  const row = o.row || 22;
  let s = `<g class="${m.shake ? 'bshake' : ''}${m.closedNow ? ' flick' : ''}">`;
  if (o.crown) s += `<ellipse cx="${x + w / 2}" cy="${top + h * 0.45}" rx="${w * 0.95}" ry="${Math.min(h * 0.6, w * 2.2)}" fill="#ffb627" opacity=".1"/>`;
  if (open) s += `<rect x="${x - 6}" y="${top - 6}" width="${w + 12}" height="${h + 6}" rx="10" fill="#22e4ff" opacity=".06"/>`;
  s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="6" fill="${open ? '#17215e' : '#0a0e28'}" stroke="${open ? (m.mark || '#22e4ff') : m.closedNow ? '#ff4fd8' : '#232c5e'}" stroke-opacity="${open ? 0.5 : 0.85}" stroke-width="3"/>`;
  s += `<rect x="${x}" y="${top}" width="${w}" height="10" rx="5" fill="${open ? hex(cols[0]) : '#1a2048'}" opacity="${open ? 0.9 : 1}"/>`;
  const nc = 3, gx = (w - 20) / nc;
  for (let wy = top + 20; wy < base - 12; wy += row) for (let c = 0; c < nc; c++) {
    const wx = x + 10 + c * gx + 3, r = (Math.floor(wy) * 7 + c * 13 + Math.floor(x)) % 9;
    const fill = open ? (r < 6 ? ['#ffb627', '#22e4ff', '#ffe08a', '#5dffb0', '#22e4ff', '#ffb627'][r] : '#22305e') : '#151b40';
    s += `<rect x="${wx}" y="${wy}" width="${Math.max(2, gx - 7)}" height="${Math.max(3, row - 9)}" rx="2" fill="${fill}" opacity="${open && r < 6 ? 0.85 : 1}"/>`;
  }
  if (open) s += `<line x1="${x + w / 2}" y1="${top}" x2="${x + w / 2}" y2="${top - 18}" stroke="#2a3a80" stroke-width="3"/><circle cx="${x + w / 2}" cy="${top - 20}" r="4.5" fill="${hex(cols[0])}"/>`;
  if (o.pair) {
    const n = cols.length, step = n > 2 ? 22 : 32, k = o.pk || 0.34, mood = open ? (o.happy ? 'happy' : 'hold') : 'sad';
    s += `<g opacity="${open ? 1 : 0.45}" transform="translate(${x + w / 2} ${top - 3})">${cols.map((c, i) => defender((i - (n - 1) / 2) * step, 0, c, i < n / 2 ? 1 : -1, mood, k)).join('')}</g>`;
  }
  if (!open && h > 30) {
    const sw = o.sign || Math.min(w - 8, 84), sy = top + Math.min(h - 22, Math.max(20, h * 0.38));
    s += `<g transform="translate(${x + w / 2} ${sy})"><rect x="${-sw / 2}" y="-14" width="${sw}" height="28" rx="7" fill="#2a0c34" stroke="#ff4fd8" stroke-width="2.5"/><text y="6" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${o.signFont || 15}" letter-spacing="1.2" fill="#ffc6ec">CLOSED</text></g>`;
  }
  // RESTORE FROM BACKUP (18 Nov): a closed building shows its backup bar (one cell per bank needed); a restored one a mint ring.
  if (!open && m.backup && h > 46) {
    const n = m.backup.need, cw = Math.min(16, (w - 26) / n), bx = x + w / 2 - (n * (cw + 4) - 4) / 2 + 9, by = top + Math.min(h - 18, Math.max(20, h * 0.38)) + 22;
    s += `<g><text x="${bx - 12}" y="${by + 10}" text-anchor="middle" font-size="13">💾</text>${Array.from({ length: n }, (_, i) => `<rect x="${bx + i * (cw + 4)}" y="${by}" width="${cw}" height="12" rx="3" fill="${i < m.backup.have ? '#5dffb0' : '#1d2a66'}" stroke="#5dffb0" stroke-opacity=".7" stroke-width="1.5"/>`).join('')}</g>`;
  }
  if (open && m.restored) s += `<g transform="translate(${x + w - 2} ${top + 4})"><circle r="11" fill="#0b2a22" stroke="#5dffb0" stroke-width="2.5"/><path d="M-5 1a5 5 0 1 0 2-5" stroke="#5dffb0" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M-6 -7l3 3-4 1z" fill="#5dffb0"/></g>`;
  if (o.crown) s += `<g transform="translate(${x + w / 2} ${top - (o.pair ? 70 : 34)}) scale(${o.crownK || 0.8})"><path d="M-44 20 L-50 -22 L-24 -2 L0 -36 L24 -2 L50 -22 L44 20Z" fill="#ffb627" stroke="#b36a00" stroke-width="4" stroke-linejoin="round"/><rect x="-46" y="18" width="92" height="14" rx="5" fill="#b36a00"/><circle cx="0" cy="-36" r="7" fill="#ff4fd8"/><circle cx="-50" cy="-22" r="6" fill="#22e4ff"/><circle cx="50" cy="-22" r="6" fill="#22e4ff"/></g>`;
  s += '</g>';
  if (o.nf) {
    const [l1, l2] = labelLines(m.label, o.chars || 13), lx = x + w / 2, ly = base + (o.lab || 26), nf = o.nf, ink = open ? '#f3f1ff' : '#5d6699';
    s += `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${nf}" fill="${ink}">${escA(l1)}</text>`;
    if (l2) s += `<text x="${lx}" y="${ly + nf * 1.08}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${nf}" fill="${ink}">${escA(l2)}</text>`;
    if (o.money !== false) s += `<text x="${lx}" y="${ly + nf * (l2 ? 2.2 : 1.12)}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${nf - 1}" fill="${open ? '#ffb627' : '#5d6699'}">${gbpA(m.total)}</text>`;
  }
  return s;
}
// A row of buildings across W x H. list: building models in order. o: below (room for labels), minH, maxH, w (building
// width, capped by the slot), crownId, plus building() options. max: the revenue that makes the tallest building.
export function skyline(list, o) {
  const W = o.W || 1872, H = o.H, n = Math.max(1, list.length), slot = W / n, w = Math.min(o.w || 96, slot - 10);
  const base = H - o.below, max = Math.max(1, o.max || Math.max(...list.map((m) => m.total || 0)));
  const maxH = Math.min(o.maxH, base - (o.crownId ? 96 : o.pair ? 44 : 26));
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path d="M-30 ${base + 2} H${W + 30}" stroke="#22e4ff" stroke-opacity=".35" stroke-width="3"/>`;
  list.forEach((m, i) => {
    const h = o.minH + (Math.max(0, m.total || 0) / max) * (maxH - o.minH);
    s += building(i * slot + (slot - w) / 2, w, h, base, m, { ...o, crown: o.crownId && o.crownId === m.id });
  });
  return s + '</svg>';
}
