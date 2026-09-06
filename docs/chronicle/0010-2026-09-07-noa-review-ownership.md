# 0010 — In Review stall: ownership vs self-verify (Noa)

**Date:** 2026-09-06 → 2026-09-07 (IDT)  
**Author:** Joseph (מתעד)  
**Status:** owned v2 (Noa insights added)  
**Sources:** Ishay ↔ Noa chat (Ishay asked ~3rd/4th time); Ishay debrief to Joseph 2026-09-07; **Noa archive reply to Joseph 2026-09-07**; Entry [0008](0008-2026-09-06-in-review-column.md); Entry [0009](0009-2026-09-06-miriam-ticket-authority.md)

## What happened

After **In Review** landed on the board (Entry 0008), tickets in that column **did not advance**. Ishay had to ask Noa repeatedly (about three–four times) to drive them.

**Board recovery (2026-09-07 early IDT):** Ishay reports no stale In Review — work is Building / waiting-reschedule. Loop healthy again after the fixes below.

## Ishay’s diagnosis (2026-09-07)

Not only “wrong review outcome.” **Ownership.**

- The development flow is **Noa’s process to make flow**.
- She says she owns it and is fixing it — but **doesn’t verify herself** that the work actually happened and the column moved.
- Founder should not have to poke Head of R&D to confirm her own loop is working.

## Noa’s take (2026-09-07) — what broke

Source: Noa → Joseph, for the archive.

1. **Wrong Ready gate on review outcome.** Eng reviews posted as GitHub **COMMENT** with “PASS-with-residuals” were treated as Ready-eligible. Ishay’s rule: **APPROVE → Ready**; **COMMENT / REQUEST_CHANGES → fix CloudAgent same turn**.
2. **Idle after finish.** In Review went quiet once packaging/review agents finished — no next live owner. Silent finish = process miss.
3. **Wrong gate (Bugbot).** Tickets sat “blocked on Bugbot enable.” Bugbot is **not** the eng-review / Ready gate (CloudAgent review only).
4. **GitHub self-approve block.** CloudAgents auth as `mamlukishay` (= PR author), so real `APPROVE` is rejected → fallback COMMENT → stall or inconsistent Ready without an explicit “intended APPROVE” exception.
5. **Soft column semantics.** Building without a live agent; Ready with leftover “wait for X”; no **On hold** for blocked-no-agent.

## What Noa changed

1. **Skills:** eng review must submit **APPROVE / REQUEST_CHANGES / COMMENT**; Ready **only** on APPROVE (or **intended APPROVE + COMMENT** when self-approve is blocked). COMMENT/CHANGES → same-turn fix agent.
2. **In Review never idle** — live CloudAgent + session link, or move **On hold** with block reason.
3. New board column **On hold** (Miriam owns board). Locked meanings: Backlog / Building (live coding) / On hold / In Review (live review) / Ready (no live agent) / Done.
4. Board field **Agent session** — set on launch/retarget, clear on end/swap; keep issue comment too.
5. Stripped Bugbot from Ready/eng-review path. Weekly agenda: separate review GitHub identity so real APPROVE works.

## Owning In Review (Noa → future-you)

- After every review-finish wake: dump → triage **same turn** — Ready, fix agent, or On hold + reason. Never leave the column empty-handed.
- Don’t Ready on Comment-only unless the body says intended APPROVE (self-approve exception) and ACs + shots pass.
- Building / In Review without a live `bc-…` in Agent session = wrong column.
- Miriam outranks on ticket/Status (Entry 0009); **Noa owns the eng loop and must advance it without waiting for Ishay to poke.**

## Role lesson (both sides)

| Lens | Lesson |
|---|---|
| Ishay | Ownership includes **self-verify** — verbal “I’m fixing it” without board proof is the miss |
| Noa | Same-turn triage after every review wake; never idle In Review; Correct gates (Approve, not Bugbot) |
| Ishay’s seat | Play / accept on **Ready** — not babysit In Review |

## Decisions / expectations

| Chose | Rejected |
|---|---|
| Hold Noa accountable for In Review flowing without founder pokes | Treat stalls as “Ishay didn’t remind me” |
| Self-verify as part of ownership | Verbal ownership without board proof |
| Ready only on APPROVE (or intended-APPROVE exception) | Ready on Comment / PASS-with-residuals |
| On hold + Agent session for live work | Soft columns / Bugbot as Ready gate |

## publishable:

- “If you own the pipeline, you check the pipeline — the founder isn’t your integration test.”
- “Third time asking about In Review is a process smell, not a scheduling conflict.”
- “Comment isn’t Approve. Silent finish isn’t ownership.”
- “Same-turn triage after every review wake — or the column dies.”
