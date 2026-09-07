#!/usr/bin/env bash
# Label open PRs against main with ci-failed when checks fail; remove when green.
# Invoked by .github/workflows/ci-failed-labels.yml. Requires `gh` + `jq`.
set -euo pipefail

REPO="${MIDIMAN_REPO:-peak-luli/midiman}"
DEFAULT_BRANCH="${MIDIMAN_DEFAULT_BRANCH:-main}"

# shellcheck source=midiman-pr-labels.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/midiman-pr-labels.sh"

SOURCE="unknown"
SHA=""
PR_NUMBER=""
DRY_RUN=0
SELF_TEST=0

usage() {
  cat <<'EOF'
Usage:
  ci-failed-labels.sh --source NAME [--sha SHA] [--pr N] [--dry-run]
  ci-failed-labels.sh --self-test
EOF
}

log() { printf '%s\n' "$*" >&2; }
warn() { printf '::warning::%s\n' "$*" >&2; }
err() { printf '::error::%s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

ci_token() {
  if [[ -n "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$MIDIMAN_GITHUB_TOKEN"
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$GITHUB_TOKEN"
  else
    printf '%s' "${GH_TOKEN:-}"
  fi
}

gh_ci() {
  local t
  t="$(ci_token)"
  if [[ -n "$t" ]]; then
    GH_TOKEN="$t" gh "$@"
  else
    gh "$@"
  fi
}

# Prints failed | pending | green
# Input: JSON array of {status, conclusion}
classify_check_runs() {
  jq -r '
    def lc: (. // "") | ascii_downcase;
    def is_failed($c):
      ["failure","timed_out","startup_failure","action_required","cancelled"] | index($c) != null;
    def is_ok($c):
      ["success","skipped","neutral"] | index($c) != null;
    reduce .[] as $r
      ({failed:0, pending:0, ok:0};
        ($r.status | lc) as $st
        | ($r.conclusion | lc) as $c
        | if $st == "completed" then
            if is_failed($c) then .failed += 1
            elif is_ok($c) then .ok += 1
            else .failed += 1 end
          else .pending += 1 end
      )
    | if .failed > 0 then "failed"
      elif .pending > 0 then "pending"
      else "green" end
  ' <<<"${1:-[]}"
}

# combined state from commit status API (success|pending|failure|error)
classify_combined_status() {
  local state="${1:-}"
  state="$(printf '%s' "$state" | tr '[:upper:]' '[:lower:]')"
  case "$state" in
    failure|error) printf 'failed' ;;
    pending) printf 'pending' ;;
    success|'') printf 'green' ;;
    *) printf 'pending' ;;
  esac
}

# Merge two classifications: failed wins, then pending, then green.
merge_class() {
  local a="$1"
  local b="$2"
  if [[ "$a" == "failed" || "$b" == "failed" ]]; then
    printf 'failed'
  elif [[ "$a" == "pending" || "$b" == "pending" ]]; then
    printf 'pending'
  else
    printf 'green'
  fi
}

filter_open_main_prs() {
  jq -c --arg repo "$REPO" --arg base "$DEFAULT_BRANCH" '
    [
      .[]
      | select((.state // "open") == "open")
      | select((.base.ref // .base) == $base)
      | select((.base.repo.full_name // $repo) == $repo)
      | {number: (.number | tonumber), title: (.title // "")}
    ]
  '
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    --pr) PR_NUMBER="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

run_self_test() {
  local fail=0
  local got

  [[ "$LABEL_CI_FAILED" == "ci-failed" ]] || { echo "FAIL label name"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"success"}]')"
  [[ "$got" == "green" ]] || { echo "FAIL all success -> [$got]"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"failure"}]')"
  [[ "$got" == "failed" ]] || { echo "FAIL one failure -> [$got]"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"success"},{"status":"in_progress","conclusion":null}]')"
  [[ "$got" == "pending" ]] || { echo "FAIL pending + success -> [$got]"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"failure"},{"status":"queued","conclusion":null}]')"
  [[ "$got" == "failed" ]] || { echo "FAIL failure wins over pending -> [$got]"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"skipped"},{"status":"completed","conclusion":"neutral"}]')"
  [[ "$got" == "green" ]] || { echo "FAIL skipped+neutral -> [$got]"; fail=1; }

  got="$(classify_check_runs '[{"status":"completed","conclusion":"timed_out"}]')"
  [[ "$got" == "failed" ]] || { echo "FAIL timed_out -> [$got]"; fail=1; }

  got="$(classify_check_runs '[]')"
  [[ "$got" == "green" ]] || { echo "FAIL empty checks -> [$got]"; fail=1; }

  got="$(classify_combined_status failure)"
  [[ "$got" == "failed" ]] || { echo "FAIL combined failure -> [$got]"; fail=1; }
  got="$(classify_combined_status SUCCESS)"
  [[ "$got" == "green" ]] || { echo "FAIL combined success -> [$got]"; fail=1; }
  got="$(classify_combined_status pending)"
  [[ "$got" == "pending" ]] || { echo "FAIL combined pending -> [$got]"; fail=1; }

  got="$(merge_class green pending)"
  [[ "$got" == "pending" ]] || { echo "FAIL merge green+pending -> [$got]"; fail=1; }
  got="$(merge_class pending failed)"
  [[ "$got" == "failed" ]] || { echo "FAIL merge pending+failed -> [$got]"; fail=1; }
  got="$(merge_class green green)"
  [[ "$got" == "green" ]] || { echo "FAIL merge green+green -> [$got]"; fail=1; }

  local filtered
  filtered="$(filter_open_main_prs <<'JSON'
[
  {"number":10,"title":"open vs main","state":"open","base":{"ref":"main","repo":{"full_name":"peak-luli/midiman"}}},
  {"number":11,"title":"closed","state":"closed","base":{"ref":"main","repo":{"full_name":"peak-luli/midiman"}}},
  {"number":12,"title":"other base","state":"open","base":{"ref":"develop","repo":{"full_name":"peak-luli/midiman"}}}
]
JSON
)"
  got="$(jq -r '[.[].number] | join(" ")' <<<"$filtered")"
  [[ "$got" == "10" ]] || { echo "FAIL filter numbers -> [$got]"; fail=1; }

  labels_self_test >/dev/null || { echo "FAIL labels helper"; fail=1; }

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

if [[ "$DRY_RUN" -eq 1 ]]; then
  MIDIMAN_LABELS_DRY_RUN=1
fi
export MIDIMAN_LABELS_DRY_RUN="${MIDIMAN_LABELS_DRY_RUN:-0}"

require_token() {
  if [[ -z "$(ci_token)" ]]; then
    if gh auth status >/dev/null 2>&1; then
      warn "No MIDIMAN_GITHUB_TOKEN / GITHUB_TOKEN; using gh credentials."
      return 0
    fi
    die "No MIDIMAN_GITHUB_TOKEN / GITHUB_TOKEN available."
  fi
}

list_prs_for_sha() {
  local sha="$1"
  gh_ci api "repos/${REPO}/commits/${sha}/pulls" -H "Accept: application/vnd.github+json" 2>/dev/null || echo '[]'
}

list_check_runs() {
  local sha="$1"
  local out
  out="$(
    gh_ci api --paginate "repos/${REPO}/commits/${sha}/check-runs" \
      --jq '.check_runs // []' 2>/dev/null \
      | jq -s 'add // []' 2>/dev/null \
      || echo '[]'
  )"
  if ! jq -e 'type == "array"' <<<"$out" >/dev/null 2>&1; then
    printf '%s' '[]'
    return 0
  fi
  printf '%s' "$out"
}

combined_status_state() {
  local sha="$1"
  gh_ci api "repos/${REPO}/commits/${sha}/status" --jq '.state // empty' 2>/dev/null || true
}

fetch_pr() {
  local n="$1"
  gh_ci api "repos/${REPO}/pulls/${n}"
}

head_sha_of_pr() {
  local n="$1"
  gh_ci api "repos/${REPO}/pulls/${n}" --jq '.head.sha'
}

apply_class_to_pr() {
  local n="$1"
  local class="$2"
  local title="${3:-}"
  case "$class" in
    failed)
      log "PR #${n}: CI failed — add ${LABEL_CI_FAILED} — ${title}"
      add_pr_label "$n" "$LABEL_CI_FAILED"
      ;;
    green)
      log "PR #${n}: CI green — remove ${LABEL_CI_FAILED} — ${title}"
      remove_pr_label "$n" "$LABEL_CI_FAILED"
      ;;
    pending)
      log "PR #${n}: CI pending — leave ${LABEL_CI_FAILED} unchanged — ${title}"
      ;;
    *)
      log "PR #${n}: CI class=${class} — no label change — ${title}"
      ;;
  esac
}

classify_sha() {
  local sha="$1"
  local runs combined c1 c2
  runs="$(list_check_runs "$sha")"
  if ! jq -e 'type == "array"' <<<"$runs" >/dev/null 2>&1; then
    runs='[]'
  fi
  # Compact to status/conclusion for the classifier.
  runs="$(jq -c '[.[] | {status:(.status // ""), conclusion:(.conclusion // "")}]' <<<"$runs")"
  c1="$(classify_check_runs "$runs")"
  combined="$(combined_status_state "$sha")"
  c2="$(classify_combined_status "$combined")"
  merge_class "$c1" "$c2"
}

require_token
ensure_repo_label "$LABEL_CI_FAILED"

log "ci-failed-labels source=${SOURCE} sha=${SHA:-none} pr=${PR_NUMBER:-none} dry_run=${DRY_RUN}"

if [[ -n "$PR_NUMBER" ]]; then
  if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    die "--pr must be a number, got: ${PR_NUMBER}"
  fi
  if [[ -z "$SHA" ]]; then
    SHA="$(head_sha_of_pr "$PR_NUMBER")"
  fi
  local_pr="$(fetch_pr "$PR_NUMBER")"
  state="$(jq -r '.state' <<<"$local_pr")"
  base="$(jq -r '.base.ref' <<<"$local_pr")"
  title="$(jq -r '.title' <<<"$local_pr")"
  if [[ "$state" != "open" || "$base" != "$DEFAULT_BRANCH" ]]; then
    log "PR #${PR_NUMBER} is state=${state} base=${base}; only open PRs against ${DEFAULT_BRANCH} are labeled."
    exit 0
  fi
  class="$(classify_sha "$SHA")"
  apply_class_to_pr "$PR_NUMBER" "$class" "$title"
  exit 0
fi

if [[ -z "$SHA" ]]; then
  die "Need --sha or --pr."
fi

raw="$(list_prs_for_sha "$SHA")"
if ! jq -e 'type == "array"' <<<"$raw" >/dev/null 2>&1; then
  log "No PR list for ${SHA}; nothing to do."
  exit 0
fi
prs="$(filter_open_main_prs <<<"$raw")"
count="$(jq 'length' <<<"$prs")"
log "Open ${DEFAULT_BRANCH} PRs for ${SHA}: ${count}"
if [[ "$count" -eq 0 ]]; then
  log "No open PR against ${DEFAULT_BRANCH} for this SHA. Exit 0."
  exit 0
fi

class="$(classify_sha "$SHA")"
log "SHA ${SHA} classified as ${class}"

while IFS= read -r row; do
  [[ -n "$row" ]] || continue
  n="$(jq -r '.number' <<<"$row")"
  title="$(jq -r '.title' <<<"$row")"
  apply_class_to_pr "$n" "$class" "$title"
done < <(jq -c '.[]' <<<"$prs")

exit 0
