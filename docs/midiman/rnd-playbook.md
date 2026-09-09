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
5. Noa wakes from **GitHub watch** (PR/CI) and **main push poll** → review-bot flags + **AC checkboxes** + **PR screenshots**. **Open PR branches vs `main`:** a GitHub Action owns the happy path ([`main-sync-pr-branches.md`](main-sync-pr-branches.md)) — Noa is not required for clean syncs. She kicks a conflict-resolution agent only when the Action comments `<!-- midiman-main-sync:conflict -->` / labels `needs-conflict-agent` / the job goes red. **Failure-only pulse labels:** [`failure-labels.md`](failure-labels.md) (`needs-conflict-agent`, `ci-failed`).
6. Ishay plays once (real MIDI) → Noa sends **feedback packet** to Miriam.

Parallel slices are OK when Noa says file overlap is safe (Miriam asks before assuming parallel vs serial).

## Tools (current month)

- **Claude Code on the web** (`claude.ai/code` / `claude --cloud`) — primary until Anthropic month ends. Needs Claude GitHub App on `peak-luli/midiman`. Noa cannot drive Anthropic login from her box; Ishay kicks or uses his signed-in browser.
- **Cursor cloud agents** — next; needs Cursor↔GitHub App access to `peak-luli/midiman`. Prefer **MockMidiBus** for agent/CI without a piano.
- **GitHub connector / Issues** — shared backlog. `#1` conventions, `#2` Intro-coach, `#7` learn-feedback.
- **Main sync PR branches** — GitHub Action (`push` to `main`) is the **primary** update of every open eng PR branch from `main`. Uses existing `MIDIMAN_GITHUB_TOKEN`. Setup: [`main-sync-pr-branches.md`](main-sync-pr-branches.md). Noa is not required for clean syncs; she only kicks a conflict-resolution agent when the Action comments a conflict / labels `needs-conflict-agent` / the job is red.
- **Ishay Approved merge** — GitHub Action squash-merges when Midiman Dev Status is **Ishay Approved**. **Instant wake** is org Projects webhook → `repository_dispatch` `ishay_approved` (Status cannot `on:` Actions). `workflow_dispatch` is the reliable manual wake; `*/5` cron is backup only (`schedule` showed **0 runs** after land). Uses existing `MIDIMAN_GITHUB_TOKEN`. Setup: [`ishay-approved-merge.md`](ishay-approved-merge.md). Noa’s half-hour pulse is the stale backup: squash-merge if still Approved ~30m+ and the PR is CLEAN; ping only if blocked.
- **Post-merge board hygiene** — After a PR merges to `main`, mark linked issues **Done**, clear Agent session, close if still open. [`post-merge-hygiene.md`](post-merge-hygiene.md).
- **Failure labels** — `needs-conflict-agent` and `ci-failed` on open PRs against `main` for Noa’s failure-only pulse. [`failure-labels.md`](failure-labels.md).
- **Song transcription** — a score (PDF / scan / photos) into `songs/*.json` is an agent job with a fixed pipeline and four machine-checkable gates: `.claude/skills/transcribe-song/`. Point an agent at the skill rather than at the PDF; a vision-only read of a score is wrong about roughly one bar in six.

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
- [`main-sync-pr-branches.md`](main-sync-pr-branches.md) — Action that keeps open PR branches current with main
- [`ishay-approved-merge.md`](ishay-approved-merge.md) — Action that squash-merges Ishay Approved
- [`post-merge-hygiene.md`](post-merge-hygiene.md) — Action that marks linked issues Done after merge to main
- [`failure-labels.md`](failure-labels.md) — `needs-conflict-agent` / `ci-failed` for Noa’s pulse
- `issue-format.md` — how Issues are written
- Issues: `#2` Intro-coach, `#7` learn-feedback, `#8` Practice/Looper feedback (parked)
