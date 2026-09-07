# Main sync open PR branches (GitHub Action)

Owner: **Noa** (R&D tooling).

**Primary path** is this Action. When `main` advances it lists every **open** PR against `main` (draft + ready) and, for each with `behind_by > 0`, calls GitHub `PUT /repos/peak-luli/midiman/pulls/{N}/update-branch` with `expected_head_sha`. Clean updates are log-only.

**Noa is not required for clean syncs.** She still kicks a **conflict-resolution agent** when a PR comment / failed run says main sync conflicted. She does not force-merge.

Workflow: [`.github/workflows/main-sync-pr-branches.yml`](../../.github/workflows/main-sync-pr-branches.yml)  
Script: [`.github/scripts/main-sync-pr-branches.sh`](../../.github/scripts/main-sync-pr-branches.sh)

This replaces the happy path of Noa’s `midiman-main-sync-branches` / main-push poll.

## Enable (enough to work)

1. **Existing repo secret `MIDIMAN_GITHUB_TOKEN`** (PAT with repo write). Do not invent `MIDIMAN_BOARD_TOKEN`. `GITHUB_TOKEN` is a fallback but often cannot update PR branches owned by others / GitHub Apps.
2. **Enable Actions** on this repo (this workflow). After it lands on **main**, a **push to `main`** is the wake.

**Smoke test:** Actions → **Main sync PR branches** → Run workflow with `dry_run=true`. Lists open PRs and planned updates; nothing is written.

Local (no writes):

```bash
bash .github/scripts/main-sync-pr-branches.sh --self-test
MIDIMAN_GITHUB_TOKEN=… bash .github/scripts/main-sync-pr-branches.sh --dry-run
```

## Triggers

Prefer **event**, not cron. A git push *can* trigger Actions (unlike Midiman Dev Project Status, which cannot — see [ishay-approved-merge.md](ishay-approved-merge.md)).

| Trigger | Role |
|---|---|
| `push` to `main` | **Primary.** Real wake when main advances. |
| `workflow_dispatch` | Manual / dry-run. Optional `pr_number`; empty = every open PR against main. |
| `schedule: "0 * * * *"` | **Backup only.** Belt-and-suspenders. GitHub cron is UTC and may never fire — `ishay-approved-merge` showed **0 schedule runs** after land. Do not treat hourly cron as the primary wake. |

`workflow_run` after CI is **not** wired: this repo has no separate CI workflow on main whose success is a better signal than the push itself.

## Behavior

1. List all **open** PRs with `base=main` (draft + ready). Same-repo heads only — fork PRs are skipped (out of scope).
2. For each, `GET /repos/peak-luli/midiman/compare/main...{head_sha}` and read `behind_by`.
3. `behind_by == 0`: skip (already current). Log only.
4. `behind_by > 0` and not already CONFLICTING/DIRTY: `PUT .../pulls/{N}/update-branch` with `expected_head_sha`. Clean 202: log only (no PR comment).
5. **422 merge conflict / CONFLICTING:** do **not** force-merge. Comment on the PR (once, while the marker is present), add label `needs-conflict-agent`, and continue other PRs. The job **exits non-zero** if any conflict or hard error so the run is red for Noa’s watch/pulse. A later successful sync / already-current PR **removes** `needs-conflict-agent`.
6. `expected_head_sha` race: retry once with a fresh head SHA. No new commits: treat as success.

## Conflict comment marker

HTML comment on the PR (issues comments API):

```
<!-- midiman-main-sync:conflict -->
```

Body says main sync conflicted, was not force-merged, and a conflict-resolution agent needs to merge `main` into the branch. Also applies PR label `needs-conflict-agent` (created if missing). Noa launches that agent; Actions does not.

See [failure-labels.md](failure-labels.md) for Noa’s failure-only pulse (`needs-conflict-agent` + `ci-failed`).

## Out of scope

- Launching Cursor CloudAgents from Actions
- Force-push / rebase rewrite
- Syncing forks outside open midiman PRs
- Ishay Approved squash-merge — already in [`ishay-approved-merge.md`](ishay-approved-merge.md)
