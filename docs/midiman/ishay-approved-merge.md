# Ishay Approved → squash-merge (GitHub Action)

Owner: **Noa** (R&D tooling). Board Status names stay Miriam’s.

**Primary merge** is this Action. When a Midiman Dev card is Status **Ishay Approved**, it squash-merges the linked eng PR (idempotent), moves the card to **Done**, and clears **Agent session**.

**Instant wake** is an **org Projects webhook → `repository_dispatch` `ishay_approved`**. Status→Ishay Approved cannot `on:` a repo workflow. `workflow_dispatch` is the reliable manual wake. `*/5` cron is **backup only** (GitHub has shown **0 schedule runs** after this workflow landed).

**Noa’s half-hour pulse** is the stale backup (not merge-never): if a ticket is still **Ishay Approved** for ~30 minutes and the eng PR is mergeable **CLEAN**, she squash-merges. If it is blocked, she only pings.

Workflow: [`.github/workflows/ishay-approved-merge.yml`](../../.github/workflows/ishay-approved-merge.yml)  
Script: [`.github/scripts/ishay-approved-merge.sh`](../../.github/scripts/ishay-approved-merge.sh)

## Enable (enough to work)

1. **Existing repo secret `MIDIMAN_GITHUB_TOKEN`** (already has repo + org Projects write). Do not invent `MIDIMAN_BOARD_TOKEN`. `GITHUB_TOKEN` can squash-merge in this repo; org Project writes use `MIDIMAN_GITHUB_TOKEN`.
2. **Enable Actions** on this repo (this workflow). After it lands on **main**, `workflow_dispatch` and `repository_dispatch` work immediately. The `*/5 * * * *` schedule is backup only (see below).

**Smoke test:** Actions → **Ishay Approved squash-merge** → Run workflow with `dry_run=true` (leave issue number empty to sweep the column). Nothing merges.

## Triggers

`projects_v2_item` is **not** a valid GitHub Actions `on:` key. The schema rejects it (`Unexpected value`) and org Project Status changes cannot wake a repo workflow. Do not add it.

| Trigger | Role |
|---|---|
| `repository_dispatch` type `ishay_approved` | **Instant path.** Org Projects webhook → relay → this event. Payload may include `issue_number` / `project_item_id`; omit both to sweep. |
| `workflow_dispatch` | **Reliable manual / dry-run.** Optional `issue_number`; empty = full sweep. |
| `issues` labeled `ishay-approved` | Optional one-shot wake. Label is **removed when the job starts**. Does **not** write Midiman Dev Status — board Status remains the merge gate. |
| `schedule: "*/5 * * * *"` | **Backup only.** Do not treat “it is in the YAML” as proof it ran. |
| `pull_request_review` approved by `mamlukishay` | Nice-to-have. Merges only if a linked issue is already **Ishay Approved** or **Ready for Ishay**. |

## Why cron may not fire / how to wire org webhook

GitHub `schedule` is a **best-effort UTC cron** on the **default branch** only. It can delay minutes, skip under load, and in this repo it showed **0 `schedule` runs** after `ishay-approved-merge` landed. Push-based triggers are more reliable (see [main-sync-pr-branches.md](main-sync-pr-branches.md)). This merge job cannot use `push` as the primary wake: the signal is a **Project Status** change, not a git event.

**Status → Ishay Approved cannot `on:` Actions.** Midiman Dev is an org Project V2. `projects_v2_item` is a valid **org webhook** event, not a valid workflow `on:` key.

**Instant path:** subscribe an org webhook (or GitHub App) to **Projects v2 item**, filter, then POST `repository_dispatch`. GitHub cannot POST the raw Project payload to `repos/.../dispatches` — body shapes differ; use a tiny relay (Actions in another repo, Cloudflare Worker, etc.). This Action **re-reads** board Status either way and will not merge unless Status is still **Ishay Approved**.

Filter before dispatching:

- `projects_v2_item.project_node_id` is `PVT_kwDOE2PAWc4Bil8J`
- `action` is `edited`
- `changes.field_value.field_node_id` is `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` (Status)
- `changes.field_value.to.id` is `0a3d4446` (**Ishay Approved**)

Relay:

```bash
gh api repos/peak-luli/midiman/dispatches \
  -f event_type=ishay_approved \
  -f 'client_payload[issue_number]=55' \
  -f 'client_payload[project_item_id]=PVTI_…'
```

Until the webhook is wired: **Run workflow** (`workflow_dispatch`) after moving a card to Ishay Approved, or add the one-shot `ishay-approved` issue label (wake only; not Status). Cron remains the unattended backup if GitHub honors it.

## Behavior

Primary gate is **board Status**.

1. Sweep (cron / empty dispatch) or a single issue (dispatch / `workflow_dispatch` / wake label): prefer Project **Linked pull requests**, else `Fixes` / `closes` / `closingIssuesReferences`. Prefer open, non-draft, `base=main`, this repo.
2. If mergeable (`mergeable=true` and not DIRTY / BLOCKED / UNSTABLE): squash-merge via the GitHub API. Title is `{PR title} (#N)` like the UI. No `--admin`, no bypass.
3. After merge: Status → **Done** (`17584c9a`); Agent session → `""`; issue comment:
   `**Done** — squash-merged PR #<n> (\`<sha7>\`) from **Ishay Approved** via GitHub Action.`
4. Conflicts / checks blocking: leave **Ishay Approved**, dated `**Ishay Approved blocked**` comment, exit non-zero (sweep continues other cards, then fails the run).
5. Already merged / already Done / no open PR: comment once if helpful, treat as success for that card. No second merge.
6. Pack: one PR `Fixes` several issues → after merge, each linked/Fixes issue still **Ishay Approved** or **Ready** goes Done + clear session + same comment. Siblings in Building / In Review are left alone.

[Post-merge hygiene](post-merge-hygiene.md) then runs on the merge to `main` (close leftover open issues, second Done comment with a different marker). Harmless overlap.

## Board ids

| Thing | Id |
|---|---|
| Midiman Dev | `PVT_kwDOE2PAWc4Bil8J` |
| Status | `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` |
| Ishay Approved | `0a3d4446` |
| Done | `17584c9a` |
| Agent session | `PVTF_lADOE2PAWc4Bil8Jzhhg_ZU` |

See also: [main-sync-pr-branches.md](main-sync-pr-branches.md) — push-to-main Action that keeps open PR branches current. [failure-labels.md](failure-labels.md) — `ci-failed` / `needs-conflict-agent` for Noa’s pulse.
