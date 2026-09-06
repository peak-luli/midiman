# 0009 — PM outranks R&D on tickets (+ locks #61)

**Date:** 2026-09-06 (IDT)  
**Author:** Joseph (מתעד)  
**Status:** owned v1  
**Sources:** Miriam (Ishay lock); [`docs/midiman/product-conventions.md`](../midiman/product-conventions.md) Authority section; issue [#61](https://github.com/peak-luli/midiman/issues/61)

## Decision — authority

Ishay locked: on **ticket decisions**, **Miriam (PM) outranks Noa (Head of R&D)**. Noa aligns.

Ticket decisions include: which GitHub issue is canonical, open/close/dedupe, titles, labels, Midiman Dev **Status**, and product ACs/copy on the issue.

Noa still owns eng approach, CloudAgents, PRs, and code review — and follows Miriam’s ticket call when they conflict. Ishay outranks both.

Logged in product conventions + issue-format + agent profiles.

## Tidbit — locks 4–5 fiasco closed

Pass-copy / “locks 4–5” work had duplicate tickets. Miriam picked canonical **[#61](https://github.com/peak-luli/midiman/issues/61)** (not #60) — exactly the kind of call the authority rule is for.

## Why it matters

After Felix, ops is Ishay + Miriam + Noa. Without a clear ticket owner, eng and product can open twin issues and burn a day arguing which is real. PM owns the board truth; R&D owns how to build what’s on it.

## publishable:

- “On the board, PM outranks Head of R&D — eng still owns the how.”
- “Canonical ticket is a product decision, not a merge race.”
- “We closed the locks fiasco by picking one issue (#61) and meaning it.”
