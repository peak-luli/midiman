# Failure labels (Noa pulse)

Owner: **Noa** (R&D tooling). These labels are **not** Midiman Dev Status.

Noa’s **failure-only pulse** watches two PR labels. Clean PRs stay unlabeled; she does not need a watch on every open PR.

| Label | When it appears | Who applies it | What Noa does |
|---|---|---|---|
| `needs-conflict-agent` | Main sync could not update the branch from `main` (merge conflict / CONFLICTING) | [`main-sync-pr-branches.yml`](../../.github/workflows/main-sync-pr-branches.yml) | Kick a **conflict-resolution agent**. Do not force-merge. |
| `ci-failed` | Open PR against `main` has failing GitHub checks / commit statuses | [`ci-failed-labels.yml`](../../.github/workflows/ci-failed-labels.yml) | Kick a fix agent / look at the failing check. Remove is automatic when checks go green. |

Related comment marker (same conflict as the first label):

```
<!-- midiman-main-sync:conflict -->
```

## `needs-conflict-agent`

Added when main-sync posts (or would post) the conflict comment. Removed when a later sync finds the PR current or successfully updates the branch.

Does **not** change Midiman Dev Status.

## `ci-failed`

**Wakes** (GitHub will **not** fire `check_suite` / `check_run` for suites created by GitHub Actions):

| Trigger | What it actually catches |
|---|---|
| `workflow_run` completed | **Actions CI.** The only automatic wake when another Actions workflow finishes. Sibling names are listed in the workflow YAML; add a new PR CI workflow name there when one lands. Do not list **CI failure labels** (loop). |
| `check_suite` completed | Third-party **Checks apps** only (Bugbot / review-bot). Not Actions. |
| `status` | Older commit-status API. Actions jobs are check runs, not `status` contexts. |
| `workflow_dispatch` | Manual / dry-run. Classifier is the same once invoked. |

`needs-conflict-agent` (main-sync) is the reliable Noa pulse of the two today. `ci-failed` shows up for Checks apps / `status` / dispatch immediately, and for Actions CI once a PR workflow is listed under `workflow_run`.

For the event SHA, list open same-repo PRs against `main`, then classify **all** check runs + combined commit status:

- Any completed failure / timed_out / cancelled / action_required → **add** `ci-failed`
- All completed checks success / skipped / neutral **and** combined status success → **remove** `ci-failed`
- Still pending, no failures → **leave** the label unchanged

This repo may have few PR checks today. Bugbot-style Checks apps still wake `check_suite`; a future Actions CI job needs its workflow `name:` added to `ci-failed-labels.yml`.

**Smoke test:** Actions → **CI failure labels** → Run workflow with an open PR number and `dry_run=true`.

## Not a Status label

`ishay-approved` is a **one-shot wake** for [ishay-approved-merge](ishay-approved-merge.md). It is removed when that job starts. It does **not** mean board Status is Ishay Approved and is not part of the failure pulse.
