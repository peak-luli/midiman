# MidiMan — GitHub issue format

Owner: **Miriam**. Every eng issue must be readable by Ishay as an app user (not a developer).

## Required sections

1. **IDs** — Epic / Priority / Issue / Slice name (see [product-conventions.md](product-conventions.md)). Can sit at the top of the issue.

2. **User story** — who / what / why in plain language.  
   Example: “As Ishay at the piano with the phone on the stand, I want to land in City of Stars Intro and practice the left-hand vamp in a loop so I feel progress without hunting menus.”

3. **How to get there (STR)** — step-by-step what you *see and tap* in the app. No unexplained code ids. Show labels the UI actually shows (e.g. the button **Put it on the phone**, the step title **Listen**).

4. **Acceptance criteria** — each AC is a **checkbox** (`- [ ]`). ACs *are* the verify list; do **not** add a separate “Verify checklist” section. Write pass/fail so R&D can tick without Ishay at the piano when possible. If an AC is fuzzy, Miriam asks **Noa** before locking.

5. **Out of scope** — hard boundaries.

6. **Wireframes (UI / layout issues)** — required when the ticket changes what the user sees or where controls live (chrome, menus, transitions, new screens, Free practice vs Tutor layout). Put labeled mocks **on the GitHub issue** (body or comment), not only in chat. Prefer files under `docs/midiman/wireframes/` with a short caption per image (which situation). Ishay needs to imagine the change before approving; eng needs the same reference on the ticket.

Reference example: GitHub issue **#2** (Intro-coach). UI wireframe example: **#15** / **#13** (E3 coach clarity).

## UI / screenshot ACs

When an AC or PR proof uses screenshots of Learn, Feedback, or phone UI chrome, the shot must show the **entire app viewport** the user sees — chrome plus content (transport / step / meter / music / keys as applicable). Staff-only, music-pane-only, or `.view`-only crops **fail** unless the AC is explicitly about that crop alone.

Write **Pass** / **Fail** so eng can reject a crop without real-MIDI play (example Fail: “Staff-strip or `.view` crop; chrome missing”).

## Paste-ready template

Copy this into a new GitHub issue. Replace the placeholders. If a section truly doesn’t fit (e.g. pure docs chore), stop and ask Ishay — don’t force a fake user story.

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
<!-- Required when layout/chrome changes. Caption each image with the situation. -->
- **<situation>:** <image or link under docs/midiman/wireframes/…>

## Out of scope
- <what this issue deliberately does not do>
```

Title pattern: `[E#] [P0|P1|P2] [I#] Slice-name — short human title`

## Don’t

- Don’t put agent persona / working-style docs in Issues (those live on the agent’s desk).
- Don’t use raw module/file names or `#elementId` as the only description of a feature — translate to what the user sees.
- Don’t duplicate ACs with a second R&D verify checklist.
- Don’t write UI screenshot ACs that pass a staff / `.view` crop when the user would see chrome.
- Don’t leave UI layout mocks only in chat — put them on the ticket.

## When asking Ishay to decide

Restate the choice with a **short concrete example** of what he’d experience either way. For layout / chrome choices, show a **wireframe** first.
