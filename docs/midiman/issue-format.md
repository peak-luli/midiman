# MidiMan — GitHub issue format

## Authority (Ishay 2026-09-06)

**Miriam** decides ticket questions (canonical issue, dedupe, title, labels, board Status, ACs). **Noa** aligns. Eng approach stays with Noa.

Owner: **Miriam**. Every eng issue must be readable by Ishay as an app user (not a developer).

## Required sections

1. **IDs** — Epic / Priority / Issue / Slice name (see [product-conventions.md](product-conventions.md)). Sit at the top of the **issue body** at ticket open (and use labels). When Ready, the play card sits above this block. **Do not** put `[E#] [P#] [I#]` or slice kebab in the **title**.

2. **User story** — who / what / why in plain language.  
   Example: “As Ishay at the piano with the phone on the stand, I want to land in City of Stars Intro and practice the left-hand vamp in a loop so I feel progress without hunting menus.”

3. **How to get there (STR)** — step-by-step what you *see and tap* in the app. No unexplained code ids. Show labels the UI actually shows (e.g. the button **Put it on the phone**, the step title **Listen**).

4. **Acceptance criteria** — each AC is a **checkbox** (`- [ ]`). ACs *are* the verify list; do **not** add a separate “Verify checklist” section. Write pass/fail so R&D can tick without Ishay at the piano when possible. If an AC is fuzzy, Miriam asks **Noa** before locking.

5. **Out of scope** — hard boundaries.

6. **Wireframes (UI / layout issues)** — required when the ticket changes what the user sees or where controls live (chrome, menus, transitions, new screens, Free practice vs Tutor layout). Put labeled mocks **on that GitHub issue** (body or comment, GitHub-hosted image attachments), not only in chat. Do **not** commit wireframes into the repo `docs/` tree — they are task-scoped, not lasting product docs. Caption each image with the situation. Ishay needs to imagine the change before approving; eng needs the same reference on the ticket.

7. **Ready for Ishay (play card)** — **not** at ticket open. Miriam still owns AC **Steps** / **Pass** / **Fail** at creation — those checkboxes *are* the play list Ishay ticks. When the ticket moves to **Ready for Ishay**, **eng** pastes a **top** section `## Ready for Ishay (play card)` on the **GitHub issue** (PR link + checkout CLI + laptop/phone note only). Do **not** add a second STR list. Ready only when Bugbot is green, review threads are closed, and eng full-viewport shots PASS.

Reference example: GitHub issue **#2** (Intro-coach). UI wireframe example: **#15** / **#13** (E3 coach clarity).

## Title (board scan)

Ishay locked (2026-09-06): titles must read like **actions we’re doing**, not id soup.

- **Good:** `Add step transition cards between steps`
- **Bad:** `[E3] [P0] [I13] step-transition — Between-step card, tap Start (no timer)`

IDs (E# / P0–P2 / I# / slice) live in the **body IDs block** and **labels** only — not in the title people scan on the Project board.

## Bugs

Ishay locked (2026-09-06): a friction ticket uses `bug` plus `for-now` or `later`. Add `p0` / `p1` / `p2` when it moves to **Building**, not at first triage. Same AC template as features (user story + how-to-get-there + checkbox ACs). Wireframes if the bug is UI / layout. Never put timing or priority soup in the title (`for-now`, `later`, `p0`). Full pipeline: [product-conventions.md](product-conventions.md).

## UI / screenshot ACs

When an AC or PR proof uses screenshots of Learn, Feedback, or phone UI chrome, the shot must show the **entire app viewport** the user sees — chrome plus content (transport / step / meter / music / keys as applicable). Staff-only, music-pane-only, or `.view`-only crops **fail** unless the AC is explicitly about that crop alone.

Write **Pass** / **Fail** so eng can reject a crop without real-MIDI play (example Fail: “Staff-strip or `.view` crop; chrome missing”).

## Ready for Ishay (play card)

Ishay locked (2026-09-06): when a ticket moves to **Ready for Ishay**, the **GitHub issue** (not only the PR) must start with `## Ready for Ishay (play card)`. Eng fills this block at Ready — Miriam does **not** write it when she opens the ticket.

Ishay revised (2026-09-06 afternoon): do **not** add Play STRs. Acceptance criteria checkboxes (**Steps** / **Pass** / **Fail**) are already the play list — he ticks those.

The play card must include, in this order:

1. **Link to the PR.**
2. **One copy-paste CLI** with **no branch name**:

   ```bash
   gh pr checkout <N> && ./serve.sh
   ```

   Then the usual laptop + phone note: laptop is <http://localhost:8765>; same Wi-Fi phone uses the LAN URL `./serve.sh` prints, or open Learn on the laptop and press **Put it on the phone**.

Do **not** paste a second STR / Play STRs list on the card. Do not move the ticket to Ready while Bugbot is red, a review thread is still open, or eng full-viewport shots fail.

## Paste-ready template

Copy this into a new GitHub issue. Replace the placeholders. If a section truly doesn’t fit (e.g. pure docs chore), stop and ask Ishay — don’t force a fake user story.

The Ready play card is **optional at ticket open**. Miriam leaves it out. Eng pastes the Ready block (below) at the **top** of the issue when the ticket is Ready for Ishay.

**Title (separate field):** action phrase, e.g. `Add step transition cards between steps`

```markdown
## IDs
- **Epic:** E# — <outcome name>
- **Priority:** P0 | P1 | P2
- **Issue:** I# (same as this GitHub number)
- **Slice:** <short-name>

## User story
I am <who, in what situation>.  
I want <what I’m trying to do in the app>.  
So that <why it matters to me>.

### How to get there
1. <Open which page / mode — use the labels on screen>
2. <Tap / choose …>
3. <What I should see next — quote the words on screen>
4. …

## Goal
One or two sentences: what “done” feels like for this slice.

## Acceptance criteria

Tick each AC when it passes. The ACs are the verify list.

- [ ] **AC1 — <plain title>**  
  **Steps:** <how to reach this check>  
  **Pass:** <what I see / hear / can do — UI/Feedback shots: full app viewport, not a staff crop>  
  **Fail:** <what must not happen>

- [ ] **AC2 — <plain title>**  
  **Steps:** …  
  **Pass:** …  
  **Fail:** …

## Wireframes (UI / layout only)
<!-- Required when layout/chrome changes. Attach images on this issue; caption each situation. Do not commit to repo docs. -->
- **<situation>:** <attach image on this issue>

## Out of scope
- <what this issue deliberately does not do>
```

**Eng — paste at the top of the issue when Ready** (not at ticket open):

````markdown
## Ready for Ishay (play card)
- **PR:** https://github.com/peak-luli/midiman/pull/<N>

```bash
gh pr checkout <N> && ./serve.sh
```

Laptop: http://localhost:8765  
Phone (same Wi-Fi): LAN URL from `./serve.sh`, or Learn → **Put it on the phone**.
````

## Don’t

- Don’t put `[E#] [P#] [I#]` or slice kebab in the **title** — body IDs + labels only (Ishay 2026-09-06).
- Don’t put `for-now` / `later` / `p0`–`p2` timing or priority soup in a **bug** title — labels only.
- Don’t put agent persona / working-style docs in Issues (those live on the agent’s desk).
- Don’t use raw module/file names or `#elementId` as the only description of a feature — translate to what the user sees.
- Don’t duplicate ACs with a second R&D verify checklist.
- Don’t write UI screenshot ACs that pass a staff / `.view` crop when the user would see chrome.
- Don’t leave UI layout mocks only in chat — put them on the ticket.
- Don’t commit task wireframes into repo `docs/`.
- Don’t move a ticket to **Ready for Ishay** without a top `## Ready for Ishay (play card)` on the **GitHub issue** (PR link + checkout CLI + laptop/phone note only).
- Don’t put a branch name in the play-card CLI — `gh pr checkout <N> && ./serve.sh` only.
- Don’t add a second STR / Play STRs list at Ready — AC **Steps** / **Pass** / **Fail** are the play list.
- Don’t mark Ready while Bugbot is red, review threads are open, or eng full-viewport shots fail.
- Don’t ask Miriam to write the Ready play card at ticket open — eng adds it at Ready. Miriam still owns AC **Steps** / **Pass** / **Fail** at creation.

## When asking Ishay to decide

Restate the choice with a **short concrete example** of what he’d experience either way. For layout / chrome choices, show a **wireframe** first.
