# Ishay Approved → squash-merge (GitHub Action)

Owner: **Noa** (R&D tooling). Board Status names stay Miriam’s.

When a Midiman Dev ticket moves to **Ishay Approved**, Actions squash-merges the linked eng PR, moves the card to **Done**, and clears **Agent session**. Noa’s half-hour stale-column check is the backup only — this workflow owns the merge. No cron in Actions for the happy path.

Workflow: [`.github/workflows/ishay-approved-merge.yml`](../../.github/workflows/ishay-approved-merge.yml)  
Script: [`.github/scripts/ishay-approved-merge.sh`](../../.github/scripts/ishay-approved-merge.sh)

## Enable

1. **Secret `MIDIMAN_BOARD_TOKEN`** on `peak-luli/midiman`.
   - Fine-grained PAT: repo **Contents / Issues / Pull requests** read+write; org **Projects** read+write.
   - Classic PAT: `repo` + `project`.
   - Do not commit a token. `GITHUB_TOKEN` can merge in this repo; it usually cannot write the org Project.
2. **Enable Actions** on this repo (this workflow).
3. **Wire Status → `repository_dispatch`** (required for event-driven runs — see below).
4. **Smoke test:** Actions → **Ishay Approved squash-merge** → Run workflow with an issue number and `dry_run=true`. Nothing merges.

## Why `repository_dispatch` (not `projects_v2_item`)

Midiman Dev is an **org** Project V2 (`peak-luli`, project **1**, id `PVT_kwDOE2PAWc4Bil8J`).

| Approach | Verdict |
|---|---|
| `on: projects_v2_item` in this repo | **Invalid.** Actions schema rejects the key (`Unexpected value 'projects_v2_item'`). Org Project item events do not wake a repository workflow. Adding it would break `workflow_dispatch` too. |
| Org webhook `projects_v2_item` → `repository_dispatch` type `ishay_approved` | **This is the event-driven path.** |
| `workflow_dispatch` (`issue_number`) | Always available for manual / dry-run. |
| Frequent Actions cron | Out of scope. Noa’s pulse is the stale backup. |

## Wire the org webhook

In **github.com/organizations/peak-luli/settings/hooks**:

1. Add webhook, content type `application/json`.
2. Subscribe to **Projects v2 item** only.
3. Point the URL at a tiny relay (GitHub App, Cloudflare Worker, Pipedream, etc.) that filters and dispatches. GitHub cannot POST the raw Project payload to `repos/.../dispatches` — the body shapes differ.

Relay must dispatch **only** when:

- `projects_v2_item.project_node_id` is `PVT_kwDOE2PAWc4Bil8J`
- `action` is `edited`
- `changes.field_value.field_node_id` is `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` (Status)
- `changes.field_value.to.id` is `0a3d4446` (**Ishay Approved**)

Then resolve the issue number from `content_node_id` (GraphQL `node`) and POST:

```bash
gh api repos/peak-luli/midiman/dispatches \
  -f event_type=ishay_approved \
  -f 'client_payload[issue_number]=55' \
  -f 'client_payload[project_item_id]=PVTI_…'
```

The workflow **re-reads** board Status. A spoofed dispatch for a ticket that is not **Ishay Approved** does not merge.

Manual equivalent (no webhook):

```bash
gh workflow run "Ishay Approved squash-merge" \
  --repo peak-luli/midiman \
  -f issue_number=55 \
  -f dry_run=true
```

## Behavior

Primary gate is **board Status**, not a review event.

1. Prefer Project field **Linked pull requests**. Else open PRs whose body has `Fixes #<issue>` / `closes #<issue>` (and GitHub `closingIssuesReferences`). Prefer open, non-draft, `base=main`, this repo.
2. If mergeable (`mergeable=true` and not DIRTY / BLOCKED / UNSTABLE): squash-merge via the GitHub API. Title is `{PR title} (#N)` like the UI. No `--admin`, no bypass.
3. After merge: Status → **Done** (`17584c9a`); Agent session → `""`; issue comment:
   `**Done** — squash-merged PR #<n> (\`<sha7>\`) from **Ishay Approved** via GitHub Action.`
4. Conflicts / checks blocking: leave **Ishay Approved**, dated `**Ishay Approved blocked**` comment, exit non-zero.
5. Already merged / already Done / no open PR: comment once if helpful, exit 0. No second merge.
6. Pack: one PR `Fixes` several issues → after merge, each linked/Fixes issue still **Ishay Approved** or **Ready** goes Done + clear session + same comment. Siblings in Building / In Review are left alone.

Secondary (same merge function): `pull_request_review` submitted `approved` by `mamlukishay`, **only** if a linked issue is already **Ishay Approved** or **Ready for Ishay**. Building / In Review → no-op.

## Board ids

| Thing | Id |
|---|---|
| Midiman Dev | `PVT_kwDOE2PAWc4Bil8J` |
| Status | `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` |
| Ishay Approved | `0a3d4446` |
| Done | `17584c9a` |
| Agent session | `PVTF_lADOE2PAWc4Bil8Jzhhg_ZU` |
