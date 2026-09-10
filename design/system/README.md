# Middleman design system

One preview HTML per component, each starting with `<!-- @dsCard group="…" -->` so
Claude Design indexes it. Every preview is self-contained (inline CSS, no assets).

The rules a preview shows are **copied verbatim from the app's CSS**, between
`/* app: style.css */` … `/* end app */` markers in its `<style>`; the preview
may add its own layout rules outside those markers. `test/design-system.test.mjs`
checks every line inside the markers exists in the named app file, so the guide
and the app cannot drift.

## The language

- **Flat.** A control is a `#2a2f3a` face on a `--pane` `#1c1f26` panel on a `--bg`
  `#14161a` ground. No shadow, no gradient, no lit edge, no lift.
- **One hairline.** Every border and every divider in the app is
  `1px solid var(--line)` — a structural edge and a control's own outline are the
  same stroke.
- **6px.** A control, a strip, a list row and a tooltip are all 6px; a panel is 8,
  a small control 5, a chip 4, a bar 3, a phone card 12.
- **Amber means on.** `.on` is `--accent` ground, `#14161a` ink, weight 600 — the
  weight is part of the state. Hover is `#333947` and nothing else moves.
- **Sunk means smaller, not lower.** `#22262f` is the inset used by `.mini`, `.chip`,
  `kbd` and a selected row; `#23272f` is dead. The step in colour is the whole signal.
- **Labels are dim, small and uppercase.** A section is named in 10px `.08em`
  uppercase `--dim` with air under it and no rule.
- **One control height.** Everything in the bar is 30px, from `font:13px/16px` plus
  its own padding plus the 1px border. The phone is the exception: `body.mob` keeps
  its own 44px controls and an 8px radius.

## Composition of the bar

The bar is one row of `.grp` groups, left to right, each a fixed set of whole controls:

| group     | practice             | looper               | learn                 |
|-----------|----------------------|----------------------|-----------------------|
| transport | Play · Stop · Click  | Play · Stop · Click  | Play · Click          |
| output    | Out: Piano⎪Computer  | same                 | same                  |
| page      | Melody · ♪           | Backing              | Wait for me · Loop    |
| readout   | bar · beat           | bar · chord          | bar · beat · pass     |
| levels    | speed · vol          | same                 | same                  |
| input     | played · LED         | same                 | same                  |
| status    | one line, truncates  | same                 | same                  |

- **One row.** At laptop width the whole bar fits on one line. `#statusEl` is
  `flex:1 1 0` and truncates first; below laptop width the row wraps, because clipping
  hid a readout rather than merely looking tight.
- **14px between groups, 6px inside one.** Those are the only two distances in the
  bar. The eye reads the 14 as the join and the 6 as the seam.
- **A label sits left of its control**, in 12px `--dim` text — `Speed`, `Volume`.
  `Out:` is the one label that lives *inside* its strip, on a `#20242c` plate at
  11px/500.
- **Readouts are tabular with a reserved width.** `#pos` 102px (192px on Learn, whose
  string is longer), `#played` 100px mono (128px on Learn), `#speed b` 35px and `#vol b` 47px — tabular figures align
  the digits, and the reserve is what stops the row moving when the text gets longer. A readout that
  can *exceed* its reserve moves the row just as badly, so the ones whose length is not bounded —
  the notes you hold — are a fixed width with the overflow clipped, and the text is trimmed to fit
  (`heldLabel`) before it gets there.
- **One height.** Every button, strip and toggle in the row is 30px, so the bar has
  one base line and `align-items:center` has nothing to reconcile.

## Scales

- Spacing: 6 (inside a group) · 8 and 12 (panels) · 10 (list rows) · 14 (bar groups, bar
  and card insets) · 16 (sidebar sections).
- Padding: `button` 6/12 · `.seg>button` 6/9 · `.mini` 3/8 · `.chip` 1/6 · `#bar` 8/14 ·
  panels 10–12.
- Radii: 3 (bars) · 4 (chips, kbd, readouts) · 5 (mini, strip cell) · 6 (buttons,
  strips, rows, tooltips) · 8 (panels) · 12 (phone cards).
- Type: 10 label (uppercase, .08em, `--dim`) · 11 fine · 12 control and secondary ·
  13 button · 14 body · 15 title · 26 overlay. Weights 500 (the `Out:` plate only),
  600 (every `.on`), 700 (titles and readouts); everything else 400.
  `--mono` for numbers that change, `tabular-nums` for all of them.

`backup-c/` holds the option C cards: they document the skeuomorphic block design in
the `skeuo` worktree, not main, and are checked against that worktree.
