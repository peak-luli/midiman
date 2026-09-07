#!/usr/bin/env bash
# Keep every open midiman PR branch current with main.
# Invoked by .github/workflows/main-sync-pr-branches.yml. Requires `gh` + `jq`.
#
# Happy path: PUT /repos/{owner}/{repo}/pulls/{N}/update-branch with
# expected_head_sha. Quiet on clean updates. On 422 merge conflict /
# CONFLICTING: comment (<!-- midiman-main-sync:conflict -->), continue other
# PRs, then exit non-zero so the run is red for Noa’s watch.
#
# Does not force-merge, rebase-rewrite, or launch CloudAgents.
set -euo pipefail

REPO="${MIDIMAN_REPO:-peak-luli/midiman}"
DEFAULT_BRANCH="${MIDIMAN_DEFAULT_BRANCH:-main}"

MARKER_CONFLICT="<!-- midiman-main-sync:conflict -->"

SOURCE="unknown"
DRY_RUN=0
SELF_TEST=0
PR_NUMBER=""

usage() {
  cat <<'EOF'
Usage:
  main-sync-pr-branches.sh [--source NAME] [--dry-run] [--pr N]
  main-sync-pr-branches.sh --self-test
EOF
}

log() { printf '%s\n' "$*" >&2; }
warn() { printf '::warning::%s\n' "$*" >&2; }
err() { printf '::error::%s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

# Prefer MIDIMAN_GITHUB_TOKEN (PAT with repo write). GITHUB_TOKEN often cannot
# update PR branches owned by others / GitHub Apps.
sync_token() {
  if [[ -n "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$MIDIMAN_GITHUB_TOKEN"
  else
    printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  fi
}

gh_sync() {
  local t
  t="$(sync_token)"
  if [[ -n "$t" ]]; then
    GH_TOKEN="$t" gh "$@"
  else
    gh "$@"
  fi
}

# ---------------------------------------------------------------------------
# Classifiers (exported for --self-test; no network)
# ---------------------------------------------------------------------------
is_conflict_payload() {
  local json="${1:-}"
  local blob
  blob="$(printf '%s' "$json" | tr '[:upper:]' '[:lower:]')"
  case "$blob" in
    *conflict*) return 0 ;;
  esac
  return 1
}

is_sha_mismatch_payload() {
  local json="${1:-}"
  local blob
  blob="$(printf '%s' "$json" | tr '[:upper:]' '[:lower:]')"
  case "$blob" in
    *expected_head_sha*) return 0 ;;
  esac
  return 1
}

is_noop_payload() {
  local json="${1:-}"
  local blob
  blob="$(printf '%s' "$json" | tr '[:upper:]' '[:lower:]')"
  case "$blob" in
    *"no new commits"*) return 0 ;;
  esac
  return 1
}

# Prints: update | skip | conflict
# skip = already current (behind_by == 0). conflict = already CONFLICTING/DIRTY
# while behind. update = behind_by > 0 and not already conflicting.
classify_pr_action() {
  local behind_by="${1:-0}"
  local mergeable="${2:-}"
  local mergeable_state="${3:-}"
  [[ "$behind_by" =~ ^[0-9]+$ ]] || behind_by=0
  if [[ "${behind_by}" -le 0 ]]; then
    printf 'skip'
    return 0
  fi
  local m_lc s_lc
  m_lc="$(printf '%s' "$mergeable" | tr '[:upper:]' '[:lower:]')"
  s_lc="$(printf '%s' "$mergeable_state" | tr '[:upper:]' '[:lower:]')"
  if [[ "$m_lc" == "conflicting" || "$s_lc" == "dirty" ]]; then
    printf 'conflict'
    return 0
  fi
  printf 'update'
}

# Same-repo open PRs against main (draft + ready). Forks are out of scope.
filter_syncable_prs() {
  jq -c --arg repo "$REPO" --arg base "$DEFAULT_BRANCH" '
    [
      .[]
      | select(.base.ref == $base)
      | select((.head.repo.full_name // "") == $repo)
      | {
          number,
          title,
          draft,
          head_ref: .head.ref,
          head_sha: .head.sha,
          mergeable: (.mergeable | tostring),
          mergeable_state: (.mergeable_state // "")
        }
    ]
  '
}

conflict_comment_body() {
  local n="$1"
  local behind="$2"
  cat <<EOF
${MARKER_CONFLICT}
**Main sync conflicted** — GitHub could not update this branch from \`${DEFAULT_BRANCH}\` (merge conflict / CONFLICTING). Not force-merged.

A **conflict-resolution agent** needs to merge \`${DEFAULT_BRANCH}\` into this branch and resolve conflicts. Other open PRs still sync.

- PR: #${n}
- Behind \`${DEFAULT_BRANCH}\`: ${behind} commit(s)

Noa: kick a conflict agent from this comment / the failed Action run. Do not force-merge.
EOF
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --pr) PR_NUMBER="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Self-test (no network, no writes)
# ---------------------------------------------------------------------------
run_self_test() {
  local fail=0
  local got

  [[ "$MARKER_CONFLICT" == "<!-- midiman-main-sync:conflict -->" ]] \
    || { echo "FAIL marker -> [$MARKER_CONFLICT]"; fail=1; }

  is_conflict_payload '{"message":"merge conflict between base and head"}' \
    || { echo "FAIL 422 merge-conflict message"; fail=1; }
  is_conflict_payload '{"message":"Validation Failed","errors":[{"message":"PR is CONFLICTING"}]}' \
    || { echo "FAIL CONFLICTING in errors"; fail=1; }
  is_conflict_payload '{"message":"expected_head_sha did not match the current SHA of the branch"}' \
    && { echo "FAIL sha mismatch must not classify as conflict"; fail=1; }
  is_sha_mismatch_payload '{"message":"expected_head_sha did not match the current SHA of the branch"}' \
    || { echo "FAIL expected_head_sha mismatch"; fail=1; }
  is_noop_payload '{"message":"There are no new commits on the specified branch to update."}' \
    || { echo "FAIL no-new-commits noop"; fail=1; }
  is_conflict_payload '{"message":"There are no new commits on the specified branch to update."}' \
    && { echo "FAIL noop must not classify as conflict"; fail=1; }

  got="$(classify_pr_action 0 "" "behind")"
  [[ "$got" == "skip" ]] || { echo "FAIL behind_by 0 -> [$got]"; fail=1; }
  got="$(classify_pr_action 3 "true" "behind")"
  [[ "$got" == "update" ]] || { echo "FAIL behind 3 MERGEABLE -> [$got]"; fail=1; }
  got="$(classify_pr_action 2 "CONFLICTING" "dirty")"
  [[ "$got" == "conflict" ]] || { echo "FAIL CONFLICTING behind -> [$got]"; fail=1; }
  got="$(classify_pr_action 1 "false" "dirty")"
  [[ "$got" == "conflict" ]] || { echo "FAIL mergeable=false dirty -> [$got]"; fail=1; }
  got="$(classify_pr_action 1 "false" "unknown")"
  [[ "$got" == "update" ]] || { echo "FAIL mergeable=false unknown should try update -> [$got]"; fail=1; }
  got="$(classify_pr_action 1 "null" "")"
  [[ "$got" == "update" ]] || { echo "FAIL mergeable null should try update -> [$got]"; fail=1; }
  got="$(classify_pr_action 4 "true" "clean")"
  [[ "$got" == "update" ]] || { echo "FAIL behind even if clean-ish -> [$got]"; fail=1; }
  got="$(classify_pr_action 5 "UNKNOWN" "")"
  [[ "$got" == "update" ]] || { echo "FAIL UNKNOWN behind should try update -> [$got]"; fail=1; }

  local filtered
  filtered="$(filter_syncable_prs <<'JSON'
[
  {"number":10,"title":"draft behind","draft":true,"base":{"ref":"main"},"head":{"ref":"feat-a","sha":"aaa","repo":{"full_name":"peak-luli/midiman"}},"mergeable":null,"mergeable_state":"unknown"},
  {"number":11,"title":"ready behind","draft":false,"base":{"ref":"main"},"head":{"ref":"feat-b","sha":"bbb","repo":{"full_name":"peak-luli/midiman"}},"mergeable":true,"mergeable_state":"behind"},
  {"number":12,"title":"fork","draft":false,"base":{"ref":"main"},"head":{"ref":"feat-c","sha":"ccc","repo":{"full_name":"someone/midiman"}},"mergeable":true,"mergeable_state":"behind"},
  {"number":13,"title":"other base","draft":false,"base":{"ref":"develop"},"head":{"ref":"feat-d","sha":"ddd","repo":{"full_name":"peak-luli/midiman"}},"mergeable":true,"mergeable_state":"behind"},
  {"number":14,"title":"null head repo","draft":false,"base":{"ref":"main"},"head":{"ref":"feat-e","sha":"eee","repo":null},"mergeable":true,"mergeable_state":"behind"}
]
JSON
)"
  got="$(jq -r '[.[].number] | join(" ")' <<<"$filtered")"
  [[ "$got" == "10 11" ]] || { echo "FAIL filter numbers -> [$got]"; fail=1; }
  got="$(jq -r '.[] | select(.number==10) | .draft' <<<"$filtered")"
  [[ "$got" == "true" ]] || { echo "FAIL draft included -> [$got]"; fail=1; }

  local body
  body="$(conflict_comment_body 42 7)"
  printf '%s' "$body" | grep -Fq "$MARKER_CONFLICT" \
    || { echo "FAIL comment missing marker"; fail=1; }
  printf '%s' "$body" | grep -Fq "conflict-resolution agent" \
    || { echo "FAIL comment missing agent ask"; fail=1; }
  printf '%s' "$body" | grep -Fq "Not force-merged" \
    || { echo "FAIL comment missing not-force-merged"; fail=1; }
  printf '%s' "$body" | grep -Fq "#42" \
    || { echo "FAIL comment missing PR number"; fail=1; }

  if [[ "$fail" -ne 0 ]]; then
    echo "self-test FAILED"
    exit 1
  fi
  echo "self-test OK"
  exit 0
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  run_self_test
fi

# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------
require_token() {
  if [[ -n "$(sync_token)" ]]; then
    if [[ -z "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
      warn "MIDIMAN_GITHUB_TOKEN is unset; falling back to GITHUB_TOKEN. update-branch often fails for branches owned by others / Apps."
    fi
    return 0
  fi
  if gh auth status >/dev/null 2>&1; then
    warn "No MIDIMAN_GITHUB_TOKEN / GITHUB_TOKEN in the environment; using gh's configured credentials. In Actions, set repo secret MIDIMAN_GITHUB_TOKEN (GITHUB_TOKEN is a fallback and often cannot update others' branches)."
    return 0
  fi
  die "No MIDIMAN_GITHUB_TOKEN / GITHUB_TOKEN available."
}

list_open_prs_json() {
  gh_sync api --paginate "repos/${REPO}/pulls?state=open&base=${DEFAULT_BRANCH}&per_page=100"
}

compare_json() {
  local sha="$1"
  gh_sync api "repos/${REPO}/compare/${DEFAULT_BRANCH}...${sha}"
}

behind_by_of() {
  jq -r '.behind_by // 0'
}

pr_comments_json() {
  local n="$1"
  gh_sync api "repos/${REPO}/issues/${n}/comments" --paginate 2>/dev/null || echo '[]'
}

has_conflict_marker() {
  local n="$1"
  pr_comments_json "$n" | jq -e --arg m "$MARKER_CONFLICT" 'any(.[]; (.body // "") | contains($m))' >/dev/null
}

post_pr_comment() {
  local n="$1"
  local body="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would comment on PR #${n}:"
    log "$body"
    return 0
  fi
  jq -n --arg body "$body" '{body:$body}' \
    | gh_sync api "repos/${REPO}/issues/${n}/comments" --input - >/dev/null
}

comment_conflict() {
  local n="$1"
  local behind="$2"
  if has_conflict_marker "$n"; then
    log "PR #${n} already has ${MARKER_CONFLICT}; not duplicating."
    return 0
  fi
  post_pr_comment "$n" "$(conflict_comment_body "$n" "$behind")"
}

# Sets UPDATE_BODY (stdout+stderr). Returns 0 on HTTP success.
UPDATE_BODY=""
call_update_branch() {
  local n="$1"
  local sha="$2"
  local tmp errf
  tmp="$(mktemp)"
  errf="$(mktemp)"
  local rc=0
  if jq -n --arg sha "$sha" '{expected_head_sha:$sha}' \
    | gh_sync api --method PUT "repos/${REPO}/pulls/${n}/update-branch" \
        --input - >"$tmp" 2>"$errf"; then
    rc=0
  else
    rc=$?
  fi
  UPDATE_BODY="$(cat "$tmp"; echo; cat "$errf")"
  rm -f "$tmp" "$errf"
  return "$rc"
}

refresh_head_sha() {
  local n="$1"
  gh_sync api "repos/${REPO}/pulls/${n}" --jq '.head.sha'
}

try_update_branch() {
  local n="$1"
  local sha="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would PUT pulls/${n}/update-branch expected_head_sha=${sha}"
    printf 'updated'
    return 0
  fi
  local attempt=1
  local cur="$sha"
  while [[ "$attempt" -le 2 ]]; do
    if call_update_branch "$n" "$cur"; then
      printf 'updated'
      return 0
    fi
    if is_noop_payload "$UPDATE_BODY"; then
      printf 'noop'
      return 0
    fi
    if is_conflict_payload "$UPDATE_BODY"; then
      printf 'conflict'
      return 0
    fi
    if is_sha_mismatch_payload "$UPDATE_BODY" && [[ "$attempt" -eq 1 ]]; then
      log "PR #${n}: expected_head_sha raced; retrying once."
      cur="$(refresh_head_sha "$n")"
      attempt=$((attempt + 1))
      continue
    fi
    err "PR #${n}: update-branch failed: ${UPDATE_BODY}"
    printf 'error'
    return 0
  done
  err "PR #${n}: update-branch still failing after retry: ${UPDATE_BODY}"
  printf 'error'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
require_token

log "main-sync-pr-branches source=${SOURCE} dry_run=${DRY_RUN} repo=${REPO} base=${DEFAULT_BRANCH}"

raw="$(list_open_prs_json)"
if ! jq -e 'type == "array"' <<<"$raw" >/dev/null; then
  die "Expected an array of pull requests, got: $(printf '%s' "$raw" | head -c 300)"
fi
syncable="$(filter_syncable_prs <<<"$raw")"
if [[ -n "$PR_NUMBER" ]]; then
  if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    die "--pr must be a number, got: ${PR_NUMBER}"
  fi
  syncable="$(jq -c --arg n "$PR_NUMBER" '[.[] | select(.number == ($n | tonumber))]' <<<"$syncable")"
fi

count="$(jq 'length' <<<"$syncable")"
log "Open same-repo PRs against ${DEFAULT_BRANCH}: ${count}"

if [[ "$count" -eq 0 ]]; then
  log "Nothing to sync."
  exit 0
fi

conflicts=0
errors=0
updated=0
skipped=0

while IFS= read -r row; do
  [[ -n "$row" ]] || continue
  n="$(jq -r '.number' <<<"$row")"
  title="$(jq -r '.title' <<<"$row")"
  draft="$(jq -r '.draft' <<<"$row")"
  sha="$(jq -r '.head_sha' <<<"$row")"
  mergeable="$(jq -r '.mergeable' <<<"$row")"
  mergeable_state="$(jq -r '.mergeable_state' <<<"$row")"
  draft_tag=""
  if [[ "$draft" == "true" ]]; then
    draft_tag=" (draft)"
  fi

  cmp=""
  behind=0
  if ! cmp="$(compare_json "$sha")"; then
    err "PR #${n}${draft_tag}: compare ${DEFAULT_BRANCH}...${sha} failed."
    errors=$((errors + 1))
    continue
  fi
  behind="$(behind_by_of <<<"$cmp")"
  action="$(classify_pr_action "$behind" "$mergeable" "$mergeable_state")"

  case "$action" in
    skip)
      log "PR #${n}${draft_tag}: current (behind_by=${behind}) — ${title}"
      skipped=$((skipped + 1))
      ;;
    conflict)
      err "PR #${n}${draft_tag}: already CONFLICTING/DIRTY and behind_by=${behind} — ${title}"
      comment_conflict "$n" "$behind"
      conflicts=$((conflicts + 1))
      ;;
    update)
      result="$(try_update_branch "$n" "$sha")"
      case "$result" in
        updated|noop)
          log "PR #${n}${draft_tag}: ${result} (behind_by=${behind}) — ${title}"
          updated=$((updated + 1))
          ;;
        conflict)
          err "PR #${n}${draft_tag}: update-branch conflict (behind_by=${behind}) — ${title}"
          comment_conflict "$n" "$behind"
          conflicts=$((conflicts + 1))
          ;;
        *)
          errors=$((errors + 1))
          ;;
      esac
      ;;
  esac
done < <(jq -c '.[]' <<<"$syncable")

log "Done. updated=${updated} skipped=${skipped} conflicts=${conflicts} errors=${errors}"

if [[ "$conflicts" -gt 0 || "$errors" -gt 0 ]]; then
  if [[ "$conflicts" -gt 0 ]]; then
    err "${conflicts} PR(s) conflicted with ${DEFAULT_BRANCH}. Not force-merged. Noa: kick conflict-resolution agents."
  fi
  exit 1
fi
exit 0
