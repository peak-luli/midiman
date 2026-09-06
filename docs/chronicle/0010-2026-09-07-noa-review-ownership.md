# 0010 — In Review stall: ownership vs self-verify (Noa)

**Date:** 2026-09-06 → 2026-09-07 (IDT)  
**Author:** Joseph (מתעד)  
**Status:** owned v1  
**Sources:** Ishay ↔ Noa chat (Ishay asked ~3rd/4th time); Ishay debrief to Joseph 2026-09-07; related Entry [0008](0008-2026-09-06-in-review-column.md)

## What happened

After **In Review** landed on the board (Entry 0008), tickets in that column **did not advance**. Ishay had to ask Noa repeatedly (about three–four times) to drive them.

Surface rule that also showed up in the sweep (real, but secondary): eng reviews ending as **Comment** (including “PASS with residuals”) were treated like shippable — Ishay’s bar is Comment / Request changes → **fix with CloudAgents**; only **Approve** → **Ready for Ishay**. That confusion got corrected in a sweep.

## Ishay’s real diagnosis (2026-09-07)

Not “she didn’t know the Comment rule.” **Ownership.**

- The development flow (Building → In Review → Ready → Done) is **Noa’s process to make flow**.
- She says she owns it and is fixing it — but **doesn’t verify herself** that the work actually happened and the column moved.
- Founder should not have to poke Head of R&D to confirm her own loop is working.

## Role lesson

| Owns the loop | Must also |
|---|---|
| Head of R&D (Noa) | **Self-verify** — read the board back, check review outcomes, move or fix without waiting for Ishay’s third ask |
| Ishay | Play / accept on **Ready for Ishay** — not babysit In Review |

Saying “I own it” without a closed-loop check is the same failure mode as claiming done without verify (already a known Noa bar from earlier days).

Secondary eng note (keep, don’t confuse with ownership): GitHub blocks CloudAgents from true **APPROVE** when review runs as the PR author — temporary hygiene: intended-APPROVE + COMMENT may count until a separate review identity exists (Miriam/Noa weekly agenda).

## Decisions / expectations

| Chose | Rejected |
|---|---|
| Hold Noa accountable for In Review flowing without founder pokes | Treat stalls as “Ishay didn’t remind me” |
| Self-verify as part of ownership | Verbal ownership without board proof |

## publishable:

- “If you own the pipeline, you check the pipeline — the founder isn’t your integration test.”
- “Third time asking about In Review is a process smell, not a scheduling conflict.”
- “Comment isn’t Approve. But the deeper miss was: nobody looked.”
