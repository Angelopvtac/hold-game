// Tap safety (16 Nov, Angelo's iPhone: "so many accidental presses"). One helper for every phone
// screen, two rules:
//   1. Tap guard: a newly shown screen or sheet ignores taps for TAP_GUARD_MS, so a tap (or iOS's
//      late synthetic click) meant for the last screen never lands on the new one. Nothing is drawn
//      for it: the animation runs as before, the taps are just dropped.
//   2. Hold to confirm: a consequential or once-only action (RAISE ALARM, LIE LOW, a vote, CUT,
//      Red's SEND, anything spending credits) needs a press held for HOLD_MS. The button fills;
//      the phone ticks at the start and buzzes at the end; letting go early cancels.
// The timing logic is pure (createGuard, createHold), so node tests (test/tap-safety.js) run it;
// install() wires it to a page. A hold button is any element with data-hold="<window function>"
// and optional data-a / data-b arguments; it needs no onclick. data-ms sets a longer hold (the big
// screen's host menu holds for a second). press(el) / release() drive the same hold from a key.

export const TAP_GUARD_MS = 500;
export const HOLD_MS = 600;
// Never guarded (QA, 16 Nov): the side bar (HOLD TO SEE YOUR SIDE) is the same on every screen and only shows
// the side while held, so a press on it right after a redraw is never meant for the last screen. Dropping it
// lost the peek on the takeover, where the screen redraws as the player reaches for the bar.
export const GUARD_EXEMPT = '.peekbar';

// The guard: arm() when something new appears; blocks(t) is true until it has settled.
export function createGuard({ ms = TAP_GUARD_MS } = {}) {
  let until = -Infinity;
  return {
    arm(t) { until = Math.max(until, t + ms); },
    blocks(t) { return t < until; },
    get until() { return until; },
  };
}

// One press-and-hold. press(t) starts it, progress(t) is 0..1, release(t) says how it ended:
// 'done' (held long enough: the action fires once), 'cancel' (let go early) or 'idle' (no press).
// tick(t) returns 'done' exactly once, when the hold completes while still pressed.
export function createHold({ ms = HOLD_MS } = {}) {
  let start = null, fired = false;
  const progress = (t) => (start === null ? 0 : Math.max(0, Math.min(1, (t - start) / ms)));
  return {
    press(t) { start = t; fired = false; },
    progress,
    get pressed() { return start !== null; },
    tick(t) {
      if (start === null || fired) return null;
      if (progress(t) >= 1) { fired = true; return 'done'; }
      return null;
    },
    release(t) {
      if (start === null) return 'idle';
      const done = fired || progress(t) >= 1;
      start = null;
      fired = false;
      return done ? 'done' : 'cancel';
    },
  };
}

// The actions that must be held, by window function name. test/tap-safety.js checks play.html
// never wires one of these to a plain onclick.
export const HOLD_ACTIONS = ['raiseAlarm', 'lieLowNow', 'castVote', 'firstCutGo', 'sendLure', 'buy', 'pick', 'sendCut', 'cutWire', 'sabotageNow', 'pressEmergency', 'lureVote', 'leaveGame'];

// Wires the guard and holds to a page. Returns { arm(), guard }.
//   win: window; vibrate(pattern): the page's haptic helper; now(): clock (Date.now); exempt: selector never guarded.
export function install(win, { vibrate = () => {}, now = () => Date.now(), exempt = GUARD_EXEMPT } = {}) {
  const doc = win.document, guard = createGuard();
  // Capture phase on window: runs before any element's own handler, inline onclick included.
  const drop = (e) => { if (guard.blocks(now()) && !(exempt && e.target && e.target.closest && e.target.closest(exempt))) { e.stopPropagation(); e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); } };
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend']) win.addEventListener(type, drop, true);

  let cur = null; // { el, hold, id, raf }
  const paint = (el, p) => { el.style.setProperty('--hold', String(p)); el.classList.toggle('holding', p > 0 && p < 1); };
  const stop = (outcome) => {
    if (!cur) return;
    const { el, raf } = cur; cur = null;
    win.cancelAnimationFrame(raf);
    el.classList.remove('holding');
    if (outcome !== 'done') paint(el, 0);
  };
  const fire = (el) => {
    vibrate([20, 40, 60]);
    el.classList.add('held');
    paint(el, 1);
    const fn = win[el.dataset.hold];
    const args = ['a', 'b'].filter((k) => k in el.dataset).map((k) => el.dataset[k]);
    win.setTimeout(() => { el.classList.remove('held'); if (el.isConnected) paint(el, 0); }, 450);
    if (typeof fn === 'function') fn(...args);
  };
  const loop = () => {
    if (!cur) return;
    const { el, hold } = cur;
    if (!el.isConnected || el.disabled) return stop('cancel'); // the screen changed under the finger
    const t = now();
    paint(el, hold.progress(t));
    if (hold.tick(t) === 'done') { stop('done'); return fire(el); }
    cur.raf = win.requestAnimationFrame(loop);
  };
  const begin = (el, id) => {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    stop('cancel');
    const hold = createHold({ ms: Number(el.dataset.ms) || HOLD_MS }); hold.press(now());
    cur = { el, hold, id, raf: 0 };
    vibrate(8); // the tick: it has started
    cur.raf = win.requestAnimationFrame(loop);
    return true;
  };
  doc.addEventListener('pointerdown', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-hold]');
    if (!el || e.button > 0) return;
    e.preventDefault(); // no text selection or iOS callout while holding
    if (begin(el, e.pointerId)) { try { el.setPointerCapture(e.pointerId); } catch {} }
  });
  const end = (e) => { if (cur && e.pointerId === cur.id) stop('cancel'); };
  doc.addEventListener('pointerup', end);
  doc.addEventListener('pointercancel', end);
  // Sliding the finger off the button cancels, as on a real hold button.
  doc.addEventListener('pointermove', (e) => {
    if (!cur || e.pointerId !== cur.id) return;
    const r = cur.el.getBoundingClientRect(), pad = 24;
    if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) stop('cancel');
  });
  // A hold button never acts on a plain click (a quick tap only shows how to use it).
  doc.addEventListener('click', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-hold]');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!el.classList.contains('held') && !el.disabled) { el.classList.remove('nudge-hold'); void el.offsetWidth; el.classList.add('nudge-hold'); }
  });
  doc.addEventListener('contextmenu', (e) => { if (e.target && e.target.closest && e.target.closest('[data-hold]')) e.preventDefault(); });
  return { guard, arm() { guard.arm(now()); }, press: (el) => begin(el, 'key'), release: () => { if (cur && cur.id === 'key') stop('cancel'); } };
}
