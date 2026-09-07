# Post-merge board hygiene (GitHub Action)

Owner: **Noa** (R&D tooling). Board Status names stay Miriam’s.

After an eng PR **merges to `main`**, this Action marks every linked GitHub Issue **Done** on Midiman Dev, clears **Agent session**, closes the issue if it is still open, and comments once.

It is the merge-agnostic safety net: manual / UI squash merges, and the case where [ishay-approved-merge](ishay-approved-merge.md) merged but missed the board write.

Workflow: [`.github/workflows/post-merge-hygiene.yml`](../../.github/workflows/post-merge-hygiene.yml)  
Script: [`.github/scripts/post-merge-hygiene.sh`](../../.github/scripts/post-merge-hygiene.sh)

## Enable (enough to work)

1. **Existing repo secret `MIDIMAN_GITHUB_TOKEN`** (repo + org Projects write). Do not invent `MIDIMAN_BOARD_TOKEN`. `GITHUB_TOKEN` can comment/close; Project writes use the PAT.
2. **Enable Actions** on this repo. After it lands on **main**, a merged PR to `main` is the wake.

**Smoke test:** Actions → **Post-merge board hygiene** → Run workflow with a recently merged PR number and `dry_run=true`. Nothing is written.

Local (no writes):

```bash
bash .github/scripts/post-merge-hygiene.sh --self-test
```

## Triggers

| Trigger | Role |
|---|---|
| `pull_request` closed **and merged** to `main` | **Primary.** Has PR number + merge SHA. |
| `push` to `main` when the commit subject contains `(#N)` | Covers GitHub squash commits (`Title (#N)`). Parses that PR number. |
| `workflow_dispatch` | Manual / dry-run. Requires `pr_number`. |

Both `pull_request` and `push` often fire for the same merge. The issue comment is **idempotent**.

## Behavior

For each merged same-repo PR against `main`:

1. Resolve linked issues: `Fixes` / `closes` / `resolves` in the PR body, GraphQL `closingIssuesReferences`, and Project **Connected** timeline events.
2. On Midiman Dev (`PVT_kwDOE2PAWc4Bil8J`): Status → **Done** (`17584c9a`); Agent session `PVTF_lADOE2PAWc4Bil8Jzhhg_ZU` → `""`.
3. If the issue is still **open**, close it (`state_reason=completed`). GitHub auto-close from `Fixes` is enough when the keyword was present; this catches board-linked issues without the keyword.
4. Comment once, then skip if the marker already exists:

```
<!-- midiman-post-merge:done -->
**Done** — merged PR #<n> (`<sha7>`) onto `main`. …
```

Issues not on Midiman Dev: close (if open) + comment only. Numbers that are PRs, not issues, are skipped.

## Board ids

Same as [ishay-approved-merge.md](ishay-approved-merge.md).

| Thing | Id |
|---|---|
| Midiman Dev | `PVT_kwDOE2PAWc4Bil8J` |
| Status | `PVTSSF_lADOE2PAWc4Bil8JzhhdaEM` |
| Done | `17584c9a` |
| Agent session | `PVTF_lADOE2PAWc4Bil8Jzhhg_ZU` |
