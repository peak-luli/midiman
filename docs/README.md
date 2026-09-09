# MidiMan docs (wiki) — peak-luli company brain

Product docs, company operating rules, agent spaces, and chronicle — **all in this repo**. This `docs/` tree is the single company brain (a separate `company-brain` repo is parked).

## Company

| Doc | Owner | What it is |
|---|---|---|
| [Company index](company/README.md) | (interim) Joseph / Ishay | How the company is organized |
| [Meetings](company/meetings.md) | (was Felix) | How we schedule and write calendar invites |
| [Org / roster](company/org.md) | Joseph (interim) | Who does what |

## Agent spaces

Each agent **owns and keeps current** their page (role, responsibilities, processes in their domain):

| Agent | Space |
|---|---|
| Felix | [docs/agents/felix.md](agents/felix.md) (inactive) |
| Miriam | [docs/agents/miriam.md](agents/miriam.md) |
| Noa | [docs/agents/noa.md](agents/noa.md) |
| Joseph | [docs/agents/joseph.md](agents/joseph.md) |

## MidiMan product

| Doc | Owner | What it is |
|---|---|---|
| [Product conventions](midiman/product-conventions.md) | Miriam | North star, epics/slices/priorities |
| [Issue format](midiman/issue-format.md) | Miriam | User story + STR + AC template |
| [R&D playbook](midiman/rnd-playbook.md) | Noa | Build loop, handoffs, QA |
| [Ishay Approved merge](midiman/ishay-approved-merge.md) | Noa | Squash-merge Ishay Approved; instant wake is org webhook → `repository_dispatch` |
| [Main sync PR branches](midiman/main-sync-pr-branches.md) | Noa | Push-to-main Action that update-branch’s every open eng PR; Noa only on conflicts |
| [Post-merge hygiene](midiman/post-merge-hygiene.md) | Noa | After merge to main: Done + clear Agent session + close leftover issues |
| [Failure labels](midiman/failure-labels.md) | Noa | `needs-conflict-agent` / `ci-failed` for Noa’s failure-only pulse |
| [Architecture](midiman/architecture.md) | Noa | System diagrams |
| [Composer architecture](midiman/composer-architecture.md) | Noa | Record → edit → save as Learn sheet / practice track: the piece data model, editor, build order |
| [Chronicle](chronicle/README.md) | Joseph | Company-building archive |

## Layers

1. **GitHub docs (this)** — shared source of truth  
2. **Agent desk** (profile + memory) — working notes; durable process still lands in docs  
3. **GitHub Issues** — work items only  
4. **Skills** — paste-ready templates  

Canonical remote: `peak-luli/midiman`.
