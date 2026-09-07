# Ishay Approved → squash-merge (GitHub Action)

Owner: **Noa** (R&D tooling). Board Status names stay Miriam’s.

**Primary merge** is this Action. A **5-minute cron sweep** lists Midiman Dev items with Status **Ishay Approved**, squash-merges each linked eng PR (idempotent), moves the card to **Done**, and clears **Agent session**.

**Noa’s half-hour pulse** is the stale backup (not merge-never): if a ticket is still **Ishay Approved** for ~30 minutes and the eng PR is mergeable **CLEAN**, she squash-merges. If it is blocked, she only pings.

Workflow: [`.github/workflows/ishay-approved-merge.yml`](../../.github/workflows/ishay-approved-merge.yml)  
Script: [`.github/scripts/ishay-approved-merge.sh`](../../.github/scripts/ishay-approved-merge.sh)

## Enable (enough to work)

1. **Existing repo secret `MIDIMAN_GITHUB_TOKEN`** (already has repo + org Projects write). Do not invent `MIDIMAN_BOARD_TOKEN`. `GITHUB_TOKEN` can squash-merge in this repo; org Project writes use `MIDIMAN_GITHUB_TOKEN`.
2. **Enable Actions** on this repo (this workflow). After it lands on **main**, the `*/5 * * * *` schedule starts (GitHub cron is UTC and may drift a few minutes).

That is the default that must work. No org webhook required.

**Smoke test:** Actions → **Ishay Approved squash-merge** → Run workflow with `dry_run=true` (leave issue number empty to sweep the column). Nothing merges.

## Triggers

`projects_v2_item` is **not** a valid GitHub Actions `on:` key. The schema rejects it (`Unexpected value`) and org Project Status changes cannot wake a repo workflow. Do not add it.

**Schedule reliability:** after this workflow landed, GitHub showed **0 `schedule` runs**. Cron is UTC, may drift, and may never fire. Push-based triggers are more reliable (see [main-sync-pr-branches.md](main-sync-pr-branches.md)). This merge job still uses `*/5` because Project Status cannot wake Actions; do not treat “it is in the YAML” as proof it ran.

| Trigger | Role |
|---|---|
| `schedule: "*/5 * * * *"` | **Primary (intended).** Sweep every Ishay Approved item. |
| `workflow_dispatch` | Manual / dry-run. Optional `issue_number`; empty = full sweep. |
| `repository_dispatch` type `ishay_approved` | Optional instant wake (see below). Payload may include `issue_number` / `project_item_id`; omit both to sweep. |
| `pull_request_review` approved by `mamlukishay` | Nice-to-have. Merges only if a linked issue is already **Ishay Approved** or **Ready for Ishay**. |

## Optional: org webhook → instant dispatch

Not required. For a faster wake than five minutes, an org webhook (or any relay) subscribed to **Projects v2 item** can POST:

```bash
gh api repos/peak-luli/midiman/dispatches \
  -f event_type=ishay_approved \
  -f 'client_payload[issue_number]=55' \
  -f 'client_payload[project_item_id]=PVTI_…'
```

Filter before dispatching:

- `projects_v2_item.project_node_id` is `PVT_kwDOE2PAWc4Bil8J`
- `action` is `edited`
- `changes.field_value.field_node_id` is `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` (Status)
- `changes.field_value.to.id` is `0a3d4446` (**Ishay Approved**)

GitHub cannot POST the raw Project payload to `repos/.../dispatches` — body shapes differ; use a tiny relay. The Action **re-reads** board Status either way.

## Behavior

Primary gate is **board Status**.

1. Sweep (cron) or a single issue (dispatch / `workflow_dispatch`): prefer Project **Linked pull requests**, else `Fixes` / `closes` / `closingIssuesReferences`. Prefer open, non-draft, `base=main`, this repo.
2. If mergeable (`mergeable=true` and not DIRTY / BLOCKED / UNSTABLE): squash-merge via the GitHub API. Title is `{PR title} (#N)` like the UI. No `--admin`, no bypass.
3. After merge: Status → **Done** (`17584c9a`); Agent session → `""`; issue comment:
   `**Done** — squash-merged PR #<n> (\`<sha7>\`) from **Ishay Approved** via GitHub Action.`
4. Conflicts / checks blocking: leave **Ishay Approved**, dated `**Ishay Approved blocked**` comment, exit non-zero (sweep continues other cards, then fails the run).
5. Already merged / already Done / no open PR: comment once if helpful, treat as success for that card. No second merge.
6. Pack: one PR `Fixes` several issues → after merge, each linked/Fixes issue still **Ishay Approved** or **Ready** goes Done + clear session + same comment. Siblings in Building / In Review are left alone.

## Board ids

| Thing | Id |
|---|---|
| Midiman Dev | `PVT_kwDOE2PAWc4Bil8J` |
| Status | `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` |
| Ishay Approved | `0a3d4446` |
| Done | `17584c9a` |
| Agent session | `PVTF_lADOE2PAWc4Bil8Jzhhg_ZU` |

See also: [main-sync-pr-branches.md](main-sync-pr-branches.md) — push-to-main Action that keeps open PR branches current (event trigger; cron is backup only).
