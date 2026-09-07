#!/usr/bin/env bash
# After an eng PR merges to main: Done on Midiman Dev, clear Agent session,
# close still-open linked issues, comment once.
# Invoked by .github/workflows/post-merge-hygiene.yml. Requires `gh` + `jq`.
set -euo pipefail

REPO="${MIDIMAN_REPO:-peak-luli/midiman}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
DEFAULT_BRANCH="${MIDIMAN_DEFAULT_BRANCH:-main}"

PROJECT_ID="${MIDIMAN_PROJECT_ID:-PVT_kwDOE2PAWc4Bil8J}"
STATUS_FIELD_ID="${MIDIMAN_STATUS_FIELD_ID:-PVTSSF_lADOE2PAWc4Bil8JzhhdaEM}"
STATUS_DONE="${MIDIMAN_STATUS_DONE:-17584c9a}"
AGENT_SESSION_FIELD_ID="${MIDIMAN_AGENT_SESSION_FIELD_ID:-PVTF_lADOE2PAWc4Bil8Jzhhg_ZU}"

MARKER_DONE="<!-- midiman-post-merge:done -->"

SOURCE="unknown"
PR_NUMBER=""
SHA=""
DRY_RUN=0
SELF_TEST=0

usage() {
  cat <<'EOF'
Usage:
  post-merge-hygiene.sh --source pull_request --pr N [--sha SHA] [--dry-run]
  post-merge-hygiene.sh --source push [--dry-run]
  post-merge-hygiene.sh --source workflow_dispatch --pr N [--sha SHA] [--dry-run]
  post-merge-hygiene.sh --self-test
EOF
}

log() { printf '%s\n' "$*" >&2; }
warn() { printf '::warning::%s\n' "$*" >&2; }
err() { printf '::error::%s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

board_token() {
  if [[ -n "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$MIDIMAN_GITHUB_TOKEN"
  else
    printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  fi
}

repo_token() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$GITHUB_TOKEN"
  else
    board_token
  fi
}

gh_board() {
  local t
  t="$(board_token)"
  if [[ -n "$t" ]]; then
    GH_TOKEN="$t" gh "$@"
  else
    gh "$@"
  fi
}
gh_repo() {
  local t
  t="$(repo_token)"
  if [[ -n "$t" ]]; then
    GH_TOKEN="$t" gh "$@"
  else
    gh "$@"
  fi
}

gql_board() {
  local query="$1"
  shift
  gh_board api graphql -f query="$query" "$@"
}

gql_repo() {
  local query="$1"
  shift
  gh_repo api graphql -f query="$query" "$@"
}

# ---------------------------------------------------------------------------
# Closing-keyword parse (GitHub's close/fix/resolve family).
# ---------------------------------------------------------------------------
parse_fix_numbers() {
  local body="${1:-}"
  local repo="${2:-$REPO}"
  local repo_esc
  repo_esc="$(printf '%s' "$repo" | sed 's/[.[\*^$()+?{|]/\\&/g')"
  printf '%s' "$body" \
    | grep -Eoi "(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+(${repo_esc})?#[0-9]+" \
    | grep -Eo '[0-9]+$' \
    | sort -n \
    | uniq \
    || true
}

# Squash titles end with (#N). Merge commits start with Merge pull request #N.
parse_merged_pr_numbers_from_message() {
  local msg="${1:-}"
  local first
  first="$(printf '%s' "$msg" | tr -d '\r' | head -n1 | sed 's/[[:space:]]*$//')"
  if [[ "$first" =~ \(#([0-9]+)\)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$first" =~ ^Merge\ pull\ request\ #([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
}

done_comment_body() {
  local pr_n="$1"
  local sha="$2"
  local sha7="${sha:0:7}"
  cat <<EOF
${MARKER_DONE}
**Done** — merged PR #${pr_n} (\`${sha7}\`) onto \`${DEFAULT_BRANCH}\`. Midiman Dev Status **Done**; Agent session cleared.
EOF
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --pr) PR_NUMBER="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
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

  [[ "$MARKER_DONE" == "<!-- midiman-post-merge:done -->" ]] \
    || { echo "FAIL marker -> [$MARKER_DONE]"; fail=1; }

  [[ "$PROJECT_ID" == "PVT_kwDOE2PAWc4Bil8J" ]] \
    || { echo "FAIL project id -> [$PROJECT_ID]"; fail=1; }
  [[ "$STATUS_FIELD_ID" == "PVTSSF_lADOE2PAWc4Bil8JzhhdaEM" ]] \
    || { echo "FAIL status field -> [$STATUS_FIELD_ID]"; fail=1; }
  [[ "$STATUS_DONE" == "17584c9a" ]] \
    || { echo "FAIL Done option -> [$STATUS_DONE]"; fail=1; }
  [[ "$AGENT_SESSION_FIELD_ID" == "PVTF_lADOE2PAWc4Bil8Jzhhg_ZU" ]] \
    || { echo "FAIL Agent session field -> [$AGENT_SESSION_FIELD_ID]"; fail=1; }

  got="$(parse_fix_numbers "Fixes #55." | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "55" ]] || { echo "FAIL parse Fixes #55. -> [$got]"; fail=1; }

  got="$(parse_fix_numbers $'Fixes #46, Fixes #48, Fixes #61.\n' | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "46 48 61" ]] || { echo "FAIL pack Fixes -> [$got]"; fail=1; }

  got="$(parse_fix_numbers "This mentions #10 but no keyword" | tr '\n' ' ')"
  [[ -z "${got// /}" ]] || { echo "FAIL mention-only #10 -> [$got]"; fail=1; }

  got="$(parse_fix_numbers "closes peak-luli/midiman#14" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "14" ]] || { echo "FAIL repo-qualified closes -> [$got]"; fail=1; }

  got="$(parse_merged_pr_numbers_from_message "Capture Feedback screenshot when Feedback opens, not on submit (#64)")"
  [[ "$got" == "64" ]] || { echo "FAIL squash title (#64) -> [$got]"; fail=1; }

  got="$(parse_merged_pr_numbers_from_message $'Auto-update open PR branches when main advances (#71)\n\nMore body')"
  [[ "$got" == "71" ]] || { echo "FAIL squash with body -> [$got]"; fail=1; }

  got="$(parse_merged_pr_numbers_from_message "Merge pull request #68 from peak-luli/cursor/ishay-approved-merge-7b4b")"
  [[ "$got" == "68" ]] || { echo "FAIL merge commit -> [$got]"; fail=1; }

  got="$(parse_merged_pr_numbers_from_message $'Mention (#64) in passing on the first line\n')"
  [[ -z "$got" ]] || { echo "FAIL mention-in-passing (#64) -> [$got]"; fail=1; }

  got="$(parse_merged_pr_numbers_from_message "chore: no pr number here")"
  [[ -z "$got" ]] || { echo "FAIL no-number -> [$got]"; fail=1; }

  local body
  body="$(done_comment_body 68 abcdef1234567890)"
  printf '%s' "$body" | grep -Fq "$MARKER_DONE" \
    || { echo "FAIL comment missing marker"; fail=1; }
  printf '%s' "$body" | grep -Fq "#68" \
    || { echo "FAIL comment missing PR number"; fail=1; }
  printf '%s' "$body" | grep -Fq '`abcdef1`' \
    || { echo "FAIL comment missing squash SHA7"; fail=1; }

  local log_out log_err
  log_out="$(log "noise-must-not-be-stdout" 2>/dev/null)"
  log_err="$(log "noise-must-be-stderr" 2>&1 >/dev/null)"
  [[ -z "$log_out" ]] || { echo "FAIL log leaked to stdout [$log_out]"; fail=1; }
  [[ "$log_err" == "noise-must-be-stderr" ]] || { echo "FAIL log stderr [$log_err]"; fail=1; }

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
BOARD_OK=1

require_tokens() {
  if [[ -z "$(repo_token)" ]]; then
    if gh auth status >/dev/null 2>&1; then
      warn "No GITHUB_TOKEN / MIDIMAN_GITHUB_TOKEN in the environment; using gh credentials. In Actions, set repo secret MIDIMAN_GITHUB_TOKEN."
    else
      die "No GITHUB_TOKEN / MIDIMAN_GITHUB_TOKEN available."
    fi
  fi
  if [[ -z "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
    warn "MIDIMAN_GITHUB_TOKEN is unset; falling back to GITHUB_TOKEN / gh. Org Project writes often fail without the PAT."
  fi
  local proj
  proj="$(gql_board 'query($id: ID!) { node(id: $id) { ... on ProjectV2 { id title } } }' -f id="$PROJECT_ID" || echo '{}')"
  if [[ "$(jq -r '.data.node.id // empty' <<<"$proj")" != "$PROJECT_ID" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      warn "Cannot read Midiman Dev (${PROJECT_ID}) in dry-run; will skip board writes. Check MIDIMAN_GITHUB_TOKEN (repo + org Projects write)."
      BOARD_OK=0
      return 0
    fi
    die "Cannot read Midiman Dev (${PROJECT_ID}). Check repo secret MIDIMAN_GITHUB_TOKEN (repo + org Projects write)."
  fi
}

issue_comments_json() {
  local issue="$1"
  gh_repo api "repos/${REPO}/issues/${issue}/comments" --paginate 2>/dev/null || echo '[]'
}

has_marker() {
  local issue="$1"
  local marker="$2"
  issue_comments_json "$issue" | jq -e --arg m "$marker" 'any(.[]; (.body // "") | contains($m))' >/dev/null
}

post_comment() {
  local issue="$1"
  local body="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would comment on #${issue}:"
    log "$body"
    return 0
  fi
  jq -n --arg body "$body" '{body:$body}' \
    | gh_repo api "repos/${REPO}/issues/${issue}/comments" --input - >/dev/null
}

comment_once() {
  local issue="$1"
  local body="$2"
  if has_marker "$issue" "$MARKER_DONE"; then
    log "Issue #${issue} already has ${MARKER_DONE}; skipping comment."
    return 0
  fi
  post_comment "$issue" "$body"
}

set_status_done() {
  local item_id="$1"
  if [[ "$BOARD_OK" -ne 1 ]]; then
    log "Skipping Status Done for ${item_id} (no Midiman Dev access)."
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would set item ${item_id} Status -> Done (${STATUS_DONE})"
    return 0
  fi
  local q out
  q='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }'
  out="$(gql_board "$q" \
    -f projectId="$PROJECT_ID" \
    -f itemId="$item_id" \
    -f fieldId="$STATUS_FIELD_ID" \
    -f optionId="$STATUS_DONE")" || die "Status update request failed for ${item_id}."
  if jq -e '.errors' <<<"$out" >/dev/null 2>&1; then
    die "Status update GraphQL errors for ${item_id}: $(jq -c '.errors' <<<"$out")"
  fi
}

clear_agent_session() {
  local item_id="$1"
  if [[ "$BOARD_OK" -ne 1 ]]; then
    log "Skipping Agent session clear for ${item_id} (no Midiman Dev access)."
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would clear Agent session on ${item_id}"
    return 0
  fi
  local q out
  q='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: "" }
    }) { projectV2Item { id } }
  }'
  out="$(gql_board "$q" \
    -f projectId="$PROJECT_ID" \
    -f itemId="$item_id" \
    -f fieldId="$AGENT_SESSION_FIELD_ID")" || die "Agent session clear request failed for ${item_id}."
  if jq -e '.errors' <<<"$out" >/dev/null 2>&1; then
    die "Agent session clear GraphQL errors for ${item_id}: $(jq -c '.errors' <<<"$out")"
  fi
}

close_issue_completed() {
  local number="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would close issue #${number} (completed)"
    return 0
  fi
  jq -n '{state:"closed", state_reason:"completed"}' \
    | gh_repo api --method PATCH "repos/${REPO}/issues/${number}" --input - >/dev/null
}

FOUND_ITEM_ID=""
ISSUE_STATE=""

# Returns 0 if this number is an Issue on Midiman Dev.
lookup_item_for_issue() {
  local number="$1"
  FOUND_ITEM_ID=""
  ISSUE_STATE=""

  if [[ "$BOARD_OK" -ne 1 ]]; then
    local rest
    rest="$(gh_repo api "repos/${REPO}/issues/${number}" 2>/dev/null || echo '{}')"
    if [[ "$(jq -r '.number // empty' <<<"$rest")" != "$number" ]]; then
      log "Number #${number} is not an Issue in ${REPO} (PR or missing); skipping board/close."
      return 1
    fi
    if [[ "$(jq -r '.pull_request // empty' <<<"$rest")" != "" ]]; then
      log "Number #${number} is a pull request, not an Issue; skipping."
      return 1
    fi
    ISSUE_STATE="$(jq -r '.state // empty' <<<"$rest" | tr '[:lower:]' '[:upper:]')"
    FOUND_ITEM_ID=""
    return 1
  fi

  local q json
  q='query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        state
        projectItems(first: 30) {
          nodes { id project { id title } }
        }
      }
    }
  }'
  json="$(gql_board "$q" -f owner="$OWNER" -f name="$NAME" -F number="$number" || true)"
  if jq -e '.errors' <<<"$json" >/dev/null 2>&1; then
    die "GraphQL failed loading issue #${number}. Check MIDIMAN_GITHUB_TOKEN. $(jq -c '.errors' <<<"$json")"
  fi
  if [[ "$(jq -r '.data.repository.issue.number // empty' <<<"$json")" != "$number" ]]; then
    log "Number #${number} is not an Issue in ${REPO} (PR or missing); skipping board/close."
    return 1
  fi
  ISSUE_STATE="$(jq -r '.data.repository.issue.state // empty' <<<"$json")"
  FOUND_ITEM_ID="$(jq -r --arg pid "$PROJECT_ID" '
    .data.repository.issue.projectItems.nodes[]
    | select(.project.id == $pid)
    | .id
  ' <<<"$json" | head -n1)"
  [[ -n "$FOUND_ITEM_ID" ]]
}

hygiene_one_issue() {
  local number="$1"
  local pr_n="$2"
  local sha="$3"
  local on_board=0
  if lookup_item_for_issue "$number"; then
    on_board=1
  fi
  if [[ "$on_board" -eq 1 ]]; then
    log "Issue #${number} on Midiman Dev item=${FOUND_ITEM_ID} state=${ISSUE_STATE:-?} — Status Done, clear Agent session."
    set_status_done "$FOUND_ITEM_ID"
    clear_agent_session "$FOUND_ITEM_ID"
  elif [[ -n "$ISSUE_STATE" ]]; then
    warn "Issue #${number} is not on Midiman Dev; close+comment only."
  else
    return 0
  fi

  if [[ "${ISSUE_STATE^^}" == "OPEN" ]]; then
    log "Issue #${number} still open; closing (completed)."
    close_issue_completed "$number"
    ISSUE_STATE="CLOSED"
  else
    log "Issue #${number} already ${ISSUE_STATE:-unknown}."
  fi

  comment_once "$number" "$(done_comment_body "$pr_n" "$sha")"
}

# Linked issues: Fixes/closes in body + closingIssuesReferences + ConnectedEvent timeline.
linked_issue_numbers() {
  local pr_n="$1"
  local q json from_api from_timeline from_body body
  q='query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        body
        closingIssuesReferences(first: 50) {
          nodes { number repository { nameWithOwner } }
        }
        timelineItems(first: 100, itemTypes: [CONNECTED_EVENT]) {
          nodes {
            __typename
            ... on ConnectedEvent {
              subject {
                ... on Issue { number repository { nameWithOwner } }
              }
              source {
                ... on Issue { number repository { nameWithOwner } }
              }
            }
          }
        }
      }
    }
  }'
  json="$(gql_repo "$q" -f owner="$OWNER" -f name="$NAME" -F number="$pr_n" || true)"
  if jq -e '.errors' <<<"$json" >/dev/null 2>&1; then
    warn "GraphQL linked-issues query had errors for PR #${pr_n}: $(jq -c '.errors' <<<"$json")"
  fi
  body="$(jq -r '.data.repository.pullRequest.body // empty' <<<"$json")"
  if [[ -z "$body" ]]; then
    body="$(jq -r '.body // empty' <<<"$(fetch_pr "$pr_n")")"
  fi
  from_body="$(parse_fix_numbers "$body")"
  from_api="$(jq -r --arg repo "$REPO" '
    [.data.repository.pullRequest.closingIssuesReferences.nodes[]?
      | select(.repository.nameWithOwner == $repo)
      | .number]
    | unique | .[]
  ' <<<"$json" 2>/dev/null || true)"
  from_timeline="$(jq -r --arg repo "$REPO" '
    [
      .data.repository.pullRequest.timelineItems.nodes[]?
      | select(.__typename == "ConnectedEvent")
      | .subject, .source
      | select(.number != null and .repository.nameWithOwner == $repo)
      | .number
    ] | unique | .[]
  ' <<<"$json" 2>/dev/null || true)"
  printf '%s\n%s\n%s\n' "$from_api" "$from_timeline" "$from_body" \
    | grep -E '^[0-9]+$' \
    | sort -n \
    | uniq \
    || true
}

fetch_pr() {
  local n="$1"
  gh_repo api "repos/${REPO}/pulls/${n}"
}

process_merged_pr() {
  local n="$1"
  local sha="${2:-}"
  local rest repo base merged state merge_sha
  if ! rest="$(fetch_pr "$n")"; then
    warn "PR #${n} not found; skipping."
    return 0
  fi
  repo="$(jq -r '.base.repo.full_name // empty' <<<"$rest")"
  base="$(jq -r '.base.ref // empty' <<<"$rest")"
  merged="$(jq -r '.merged // false' <<<"$rest")"
  state="$(jq -r '.state // empty' <<<"$rest")"
  merge_sha="$(jq -r '.merge_commit_sha // empty' <<<"$rest")"
  if [[ "$repo" != "$REPO" || "$base" != "$DEFAULT_BRANCH" ]]; then
    log "PR #${n} is ${repo}@${base}, not ${REPO}@${DEFAULT_BRANCH}; skipping."
    return 0
  fi
  if [[ "$merged" != "true" ]]; then
    log "PR #${n} is not merged (state=${state} merged=${merged}); skipping."
    return 0
  fi
  if [[ -z "$sha" || "$sha" == "null" ]]; then
    sha="$merge_sha"
  fi
  if [[ -z "$sha" ]]; then
    sha="merged"
  fi
  log "Post-merge hygiene for PR #${n} sha=${sha}"

  local issues
  issues="$(linked_issue_numbers "$n")"
  if [[ -z "$issues" ]]; then
    log "PR #${n} has no Fixes/closes / timeline-linked issues in ${REPO}. Nothing to mark Done."
    return 0
  fi
  log "Linked issues: $(printf '%s' "$issues" | tr '\n' ' ')"
  local issue
  while IFS= read -r issue; do
    [[ -n "$issue" ]] || continue
    hygiene_one_issue "$issue" "$n" "$sha"
  done <<<"$issues"
}

pr_numbers_from_push_event() {
  local path="${GITHUB_EVENT_PATH:-}"
  if [[ -z "$path" || ! -f "$path" ]]; then
    return 0
  fi
  local msg
  while IFS= read -r msg; do
    [[ -n "$msg" ]] || continue
    parse_merged_pr_numbers_from_message "$msg"
  done < <(jq -r '.commits[]?.message // empty, .head_commit.message // empty' "$path")
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
require_tokens

log "post-merge-hygiene source=${SOURCE} pr=${PR_NUMBER:-none} sha=${SHA:-none} dry_run=${DRY_RUN}"

if [[ "$SOURCE" == "push" && -z "$PR_NUMBER" ]]; then
  local_nums=""
  local_nums="$(pr_numbers_from_push_event | grep -E '^[0-9]+$' | sort -n | uniq || true)"
  if [[ -z "$local_nums" ]]; then
    log "Push to ${DEFAULT_BRANCH} has no squash (#N) / merge-commit PR numbers. Nothing to do."
    exit 0
  fi
  log "Push parsed PR number(s): $(printf '%s' "$local_nums" | tr '\n' ' ')"
  while IFS= read -r n; do
    [[ -n "$n" ]] || continue
    process_merged_pr "$n" "$SHA"
  done <<<"$local_nums"
  exit 0
fi

if [[ -z "$PR_NUMBER" ]]; then
  die "Need --pr, or --source push with GITHUB_EVENT_PATH commits."
fi
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  die "--pr must be a number, got: ${PR_NUMBER}"
fi
process_merged_pr "$PR_NUMBER" "$SHA"
exit 0
