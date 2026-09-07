// Free practice section range: click one section, then Shift+click (laptop) or
// long-press (phone) another. Every section between them in list order is taken,
// inclusive. Gaps are never skipped — the range is always a contiguous span.

const LONG_MS = 480;
const SLOP2 = 10 * 10;

/** Inclusive bar range covering sections [a, b] in list order. */
export function sectionSpan(sections, a, b) {
  const i = Math.max(0, Math.min(a, b, sections.length - 1));
  const j = Math.min(sections.length - 1, Math.max(a, b, 0));
  return { from: sections[i].from, to: sections[j].to, start: i, end: j };
}

/** Section indexes whose bars sit fully inside [from, to]. */
export function sectionsCovered(sections, from, to) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.from >= lo && s.to <= hi) out.push(i);
  }
  return out;
}

/** True when [from, to] is exactly the inclusive span of one or more sections. */
export function sectionAligned(sections, from, to) {
  const cov = sectionsCovered(sections, from, to);
  return !!cov.length
    && sections[cov[0]].from === from
    && sections[cov.at(-1)].to === to;
}

/** Light a section chip when the loop is a section-aligned span that contains it. */
export function sectionOn(sections, from, to, i) {
  const s = sections[i];
  return !!s && s.from >= from && s.to <= to && sectionAligned(sections, from, to);
}

export const wholeSongOn = (from, to, nbars) => from === 0 && to === nbars - 1;

/** First section whose bars contain `bar`, or -1. */
export function sectionAt(sections, bar) {
  return sections.findIndex(s => bar >= s.from && bar <= s.to);
}

/**
 * The section a Shift+click / long-press stretches from. A stored index wins;
 * otherwise the start of the current aligned span, else the section at `from`.
 */
export function rangeAnchor(sections, from, to, stored) {
  if (Number.isInteger(stored) && stored >= 0 && stored < sections.length) return stored;
  if (sectionAligned(sections, from, to)) return sectionsCovered(sections, from, to)[0];
  const at = sectionAt(sections, from);
  return at >= 0 ? at : 0;
}

/**
 * Apply a section-chip pick. `sec` is a section index or `'all'`. `extend` is
 * Shift (or the phone long-press). Always returns a contiguous bar span.
 */
export function pickSection(sections, { sec, extend, anchor, from, to, nbars }) {
  if (sec === 'all') return { from: 0, to: nbars - 1, anchor: 0 };
  const i = +sec;
  if (!Number.isInteger(i) || i < 0 || i >= sections.length) return null;
  if (extend) {
    const a = rangeAnchor(sections, from, to, anchor);
    const span = sectionSpan(sections, a, i);
    return { from: span.from, to: span.to, anchor: a };
  }
  const s = sections[i];
  return { from: s.from, to: s.to, anchor: i };
}

/** Ruler / sheet label: one name, or "Intro – Theme" for an aligned span. */
export function rangeTitle(sections, from, to) {
  if (sectionAligned(sections, from, to)) {
    const cov = sectionsCovered(sections, from, to);
    if (cov.length === 1) return sections[cov[0]].name;
    return `${sections[cov[0]].name} – ${sections[cov.at(-1)].name}`;
  }
  const i = sectionAt(sections, from);
  return i >= 0 ? sections[i].name : '';
}

/**
 * Wire the existing Free practice section chips: click = one section, Shift+click
 * or a touch/pen long-press = the inclusive span. No Ctrl/Cmd gap multi-select.
 */
export function bindSecChips(host, pick) {
  let press = null;
  const clearTimer = () => { if (press?.timer) clearTimeout(press.timer); if (press) press.timer = 0; };
  const done = () => { clearTimer(); press = null; };
  const value = d => (d.dataset.sec === 'all' ? 'all' : +d.dataset.sec);

  host.addEventListener('pointerdown', e => {
    const d = e.target.closest('[data-sec]');
    if (!d || e.button || e.shiftKey || e.pointerType === 'mouse') return;
    const sec = value(d);
    press = {
      sec, ranged: false, x: e.clientX, y: e.clientY,
      timer: setTimeout(() => { press.ranged = true; pick(sec, true); }, LONG_MS),
    };
  });
  host.addEventListener('pointermove', e => {
    if (!press || press.ranged) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (dx * dx + dy * dy > SLOP2) clearTimer();
  });
  host.addEventListener('pointerup', () => {
    clearTimer();
    // swallow only the click that belongs to this long-press, and only briefly
    if (press?.ranged) {
      const p = press;
      setTimeout(() => { if (press === p) press = null; }, 350);
    }
  });
  host.addEventListener('pointercancel', done);
  host.addEventListener('contextmenu', e => {
    if (e.target.closest('[data-sec]')) e.preventDefault();
  });
  host.addEventListener('click', e => {
    const d = e.target.closest('[data-sec]');
    if (!d) return;
    if (press?.ranged && value(d) === press.sec) { done(); return; }
    done();
    pick(value(d), e.shiftKey);
  });
}
