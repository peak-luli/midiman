# MidiMan — R&D playbook

Owner: **Noa** (Head of R&D). Update when the build loop changes.

Repo: [`peak-luli/midiman`](https://github.com/peak-luli/midiman) (Issues/PRs live here).

## People

| Role | Who | Owns |
|---|---|---|
| Right hand | Felix | Staffing, cadence, routing |
| PM | Miriam | Briefs, acceptance, roadmap |
| Head of R&D | Noa | How we build, QA bar, tooling, shipping, **architecture docs** |
| Human at the piano | Ishay | Real MIDI play, post-session notes, kick Claude cloud when needed; consult on **major** architecture |

## Loop

1. Miriam brief with **testable acceptance** (GitHub Issue — ACs as checkboxes).
2. Noa plan + slice → Issue updated; task brief for **Claude Code on the web** (or Cursor cloud later).
3. Cloud agent builds on a branch and opens a **PR** (Ishay’s Mac only for verify / real MIDI / phone LAN).
4. Scoped, well-named commits; **PR for playable feature bundles**.
5. Noa wakes from **GitHub watch** (PR/CI) and **main push poll** → review-bot flags + **AC checkboxes** + **PR screenshots**.
6. Ishay plays once (real MIDI) → Noa sends **feedback packet** to Miriam.

Parallel slices are OK when Noa says file overlap is safe (Miriam asks before assuming parallel vs serial).

## Tools (current month)

- **Claude Code on the web** (`claude.ai/code` / `claude --cloud`) — primary until Anthropic month ends. Needs Claude GitHub App on `peak-luli/midiman`. Noa cannot drive Anthropic login from her box; Ishay kicks or uses his signed-in browser.
- **Cursor cloud agents** — next; needs Cursor↔GitHub App access to `peak-luli/midiman`. Prefer **MockMidiBus** for agent/CI without a piano.
- **GitHub connector / Issues** — shared backlog. `#1` conventions, `#2` Intro-coach, `#7` learn-feedback.

## Stack + architecture

Native ES modules, no build step, Web MIDI, `serve.py` relay.  
Living diagrams: [`architecture.md`](architecture.md) — Noa updates these whenever connections change.  
**Major** architecture uncertainty → ask Ishay. Otherwise decide, ship, document.

## QA bar (per slice)

- Unit where logic is pure (e.g. plan shape, streak / accuracy).
- Smoke for Learn / relay when those paths are touched.
- Mock MIDI for agent/CI when MockMidiBus exists; **real MIDI play is human-only (Ishay)**.
- **Acceptance criteria are the verify list.** Each AC is a checkbox on the Issue — no separate Verify section.
- **Screenshots required on cloud/UI PRs** (Ishay locked): attach happy-path shots in the PR body so Noa can catch layout/coach/meter issues before piano play. Code-only cloud PRs are incomplete. Typical set: landing, active scoring step with meter, step-done overlay, phone stand view if AC claims phone.
- **Open every attached shot.** For Feedback / UI evidence the default is the **full Learn viewport** (chrome + content). Eng **fails** staff / `.view` / music-pane crops that hide chrome unless the AC is explicitly about that crop.

## Review order

1. **Noa** — eng review (AC checkboxes + screenshot skim + review-bot flags)
2. **Ishay** — feel play (real MIDI / phone)
3. **Miriam** — product acceptance via feedback packet

## Cloud / Claude handoff (minimum)

Brief must include: goal, repo/branch, Issue AC link, in/out of scope, stack rules, likely files, commit/PR style, **screenshot requirements**, “done = PR with shots so Noa’s watch picks it up.”  
If the slice changes architecture, the PR must update `architecture.md`.

## Feedback packet (back to Miriam)

After play: what worked / what broke / how it felt (+ screenshot if something’s weird).  
Plus PR link, AC checkbox results, and any review flags.

## Related

- [`architecture.md`](architecture.md) — system diagrams
- `issue-format.md` — how Issues are written
- Issues: `#2` Intro-coach, `#7` learn-feedback, `#8` Practice/Looper feedback (parked)
