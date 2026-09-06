# 0008 — Board loop gains In Review

**Date:** 2026-09-06 (IDT, ~22:31)  
**Author:** Joseph (מתעד)  
**Status:** owned v1  
**Sources:** Noa (Ishay process note)

## What happened

MidiMan Kanban adds an **In Review** column. The shipping loop is now:

1. **Building** — coding agent implements  
2. **In Review** — CloudAgent code review + Bugbot; agent session link on the issue  
3. **Ready for Ishay** — play / accept  
4. **Done**

## Role split

- **Noa** orchestrates the review stage — she does **not** deep-review the code herself.  
- Automated / agent review (CloudAgent + Bugbot) holds the bar.  
- **Parallel reviews** are OK (multiple items can sit In Review at once).

## Why it matters

Closes the gap between "agent shipped a PR" and "Ishay should play." Review is a named board state, not a chat promise. Keeps Head of R&D as conductor, not bottleneck code-reader.

## publishable:

- "We added In Review so 'the bot is looking at it' is a column, not a vibe."
- "Head of R&D orchestrates review; she doesn't have to be the reviewer."
- "Parallel In Review is allowed — the board isn't a single-file queue."
