# MidiMan — product conventions

Owner: **Miriam** (PM). Update this file when Ishay locks a product rule.

## North star

Sit down → phone on the stand → tutor-in-a-loop.  
Practice / Learn / Looper are **modes of one tutor**. Loops are the soul/default.  
Live success feedback and challenges (e.g. 2 passes @ 85%) stay.  
Tutor notches the user up in small steps when quality holds.  
**Personal cohesive product first** — not commercial yet.

## Near-term bet

Learn **City of Stars** (even a single part) with a middle-ground coach:  
scripted coach lines + live feedback + auto notch-up.  
Full LLM / voice chat comes later. Practice stays. Looper / jam / Bluetooth later.

## Authority (Ishay 2026-09-06)

On **ticket decisions**, **Miriam (PM) outranks Noa (Head of R&D)**.  
Ticket decisions include: which GitHub issue is canonical, open/close/dedupe, titles, labels, Midiman Dev **Status**, and product ACs/copy on the issue.  
Noa owns eng approach, CloudAgents, PRs, and code review — and **aligns to Miriam’s ticket call** when they conflict.  
Ishay outranks both.

## Board columns (Ishay 2026-09-06)

Midiman Dev: **Backlog → Building → On hold → In Review → Ready for Ishay → Done**.

| Column | Meaning |
|---|---|
| **Backlog** | Not started, sorted by prio |
| **Building** | Live coding agent + session link on ticket |
| **On hold** | Started but blocked; no live coding agent; block reason on ticket |
| **In Review** | Live review CloudAgent + session link |
| **Ready for Ishay** | Waiting his play; no live coding agent |
| **Done** | Done |

## Tracking language

| Term | Meaning |
|---|---|
| **Epic** (E1, E2, …) | Outcome-sized bet (e.g. E1 = Learn City of Stars) |
| **Slice** (named) | Shippable chunk under an epic (e.g. Intro-coach) |
| **P0 / P1 / P2** | Priority only — not a name for the work |
| **Issue** (I#) | GitHub tracking id |
| **Milestone** | Date / release marker only |

**Title (Ishay 2026-09-06):** plain **action** people can scan on the board — not id soup.

- Good: `Add step transition cards between steps`
- Bad: `[E3] [P0] [I13] step-transition — Between-step card, tap Start (no timer)`

Put **E# / P0–P2 / I# / slice** in the issue **body IDs block** and **labels** only.

**Ready for Ishay (Ishay 2026-09-06):** the GitHub issue gets a top play card before the column move — see [issue-format.md](issue-format.md).

## Bugs / friction pipeline (Ishay 2026-09-06)

Same board as features: **[Midiman Dev](https://github.com/orgs/peak-luli/projects/1)** — columns **Backlog → Building → Ready for Ishay → Done**. No second board.

Board view **Bugs** filters `label:bug`.

### Labels

| Label | Meaning |
|---|---|
| `bug` | Defect / friction ticket — not a feature slice |
| `for-now` | Talk to Ishay the same day for build go |
| `later` | Park for Miriam/Ishay Weekly. If open Later bugs hit 6+, Miriam pings for an ad-hoc meet |
| `p0` / `p1` / `p2` | Severity — set when the bug is pulled into **Building**, not at first triage |

### Flow

1. App Feedback comments land on standing inbox **[#10](https://github.com/peak-luli/midiman/issues/10)**. A comment is **never** a ticket by itself.
2. Miriam triages → keep / love note, noise, or file a real GitHub issue (action title + user story + how-to-get-there + checkbox ACs) with `bug` plus `for-now` or `later`, and add it to **Backlog**.
3. **For-now** → Miriam pings Ishay the same day with one concrete example. On go → add a priority label (`p0` / `p1` / `p2`) and Noa can move it to **Building**.
4. **Later** → stay in **Backlog** until the weekly (Mon 18:30 Asia/Jerusalem, Miriam/Ishay Weekly) or an ad-hoc meet at 6+ open Later bugs.
5. Once **Building**, same **Ready for Ishay** play path as features — see [issue-format.md](issue-format.md).

### Standing meeting

**Miriam/Ishay Weekly** — Mondays 18:30–19:30 Asia/Jerusalem on the Midiman calendar. Bugs pipeline + roadmap + optional live bug-bash.

## Locked product decisions (P0)

- **Notch** = next tutor **plan step** (not a separate difficulty axis).
- Coach lines at **step boundaries / advance overlay** only — not every loop wrap.
- Phone QR/LAN mirror is required ergonomics for Learn.
- Prefer web + phone mirror over native apps for now.
- **Feedback / UI evidence = full viewport.** A screenshot that is part of acceptance must show the entire app window the user sees (chrome + content: transport / step / meter / music / keys as applicable). Miriam writes that into the AC **Pass** / **Fail** whenever screenshots are required. Staff / music-pane / `.view`-only crops fail unless the AC is explicitly about that crop.

## Surfaces (status)

| Surface | Status |
|---|---|
| Practice | Works; stays |
| Learn (+ phone) | Main spine for P0 |
| Looper | Strong but unfinished; lower priority |
| Jam / Bluetooth | Lowest |
| Guitar pitch POC | Experiment; not wired into tutor |
| Voice / LLM | Vision |
