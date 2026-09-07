#!/usr/bin/env bash
# Squash-merge the eng PR when a Midiman Dev ticket is Status "Ishay Approved".
# Invoked by .github/workflows/ishay-approved-merge.yml. Requires `gh` + `jq`.
#
# Does not force-merge. Does not invent pack siblings — only Project
# "Linked pull requests" and Fixes/closes links on the chosen PR.
set -euo pipefail

REPO="${MIDIMAN_REPO:-peak-luli/midiman}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
DEFAULT_BRANCH="${MIDIMAN_DEFAULT_BRANCH:-main}"

PROJECT_ID="${MIDIMAN_PROJECT_ID:-PVT_kwDOE2PAWc4Bil8J}"
STATUS_FIELD_ID="${MIDIMAN_STATUS_FIELD_ID:-PVTSSF_lADOE2PAWc4Bil8JzhhdaEM}"
STATUS_ISHAY_APPROVED="${MIDIMAN_STATUS_ISHAY_APPROVED:-0a3d4446}"
STATUS_DONE="${MIDIMAN_STATUS_DONE:-17584c9a}"
AGENT_SESSION_FIELD_ID="${MIDIMAN_AGENT_SESSION_FIELD_ID:-PVTF_lADOE2PAWc4Bil8Jzhhg_ZU}"

HUMAN_REVIEWER="${MIDIMAN_HUMAN_REVIEWER:-mamlukishay}"

MARKER_PREFIX="<!-- midiman-ishay-approved-merge:"
MARKER_DONE="${MARKER_PREFIX}done -->"
MARKER_BLOCKED="${MARKER_PREFIX}blocked -->"
MARKER_NOOP="${MARKER_PREFIX}noop -->"

SOURCE="unknown"
ISSUE_NUMBER=""
PROJECT_ITEM_ID=""
PR_NUMBER=""
REVIEWER=""
REVIEW_STATE=""
DRY_RUN=0
SELF_TEST=0

# ---------------------------------------------------------------------------
# Closing-keyword parse (GitHub's close/fix/resolve family). Exported for --self-test.
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

squash_title() {
  local title="${1:-}"
  local number="${2:-}"
  printf '%s (#%s)' "$title" "$number"
}

usage() {
  cat <<'EOF'
Usage:
  ishay-approved-merge.sh --issue N [--project-item PVTI_…] [--source NAME] [--dry-run]
  ishay-approved-merge.sh --source pull_request_review --pr N --reviewer LOGIN --review-state STATE
  ishay-approved-merge.sh --self-test
EOF
}

log() { printf '%s\n' "$*"; }
warn() { printf '::warning::%s\n' "$*"; }
err() { printf '::error::%s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

utc_date() { date -u +%Y-%m-%d; }

board_token() {
  if [[ -n "${MIDIMAN_BOARD_TOKEN:-}" ]]; then
    printf '%s' "$MIDIMAN_BOARD_TOKEN"
  else
    printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  fi
}

merge_token() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$GITHUB_TOKEN"
  else
    board_token
  fi
}

gh_board() { GH_TOKEN="$(board_token)" gh "$@"; }
gh_merge() { GH_TOKEN="$(merge_token)" gh "$@"; }

gql_board() {
  local query="$1"
  shift
  gh_board api graphql -f query="$query" "$@"
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue) ISSUE_NUMBER="${2:-}"; shift 2 ;;
    --project-item) PROJECT_ITEM_ID="${2:-}"; shift 2 ;;
    --source) SOURCE="${2:-}"; shift 2 ;;
    --pr) PR_NUMBER="${2:-}"; shift 2 ;;
    --reviewer) REVIEWER="${2:-}"; shift 2 ;;
    --review-state) REVIEW_STATE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Self-test (no network, no merge)
# ---------------------------------------------------------------------------
run_self_test() {
  local fail=0
  local got

  got="$(parse_fix_numbers "Fixes #55." | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "55" ]] || { echo "FAIL parse Fixes #55. -> [$got]"; fail=1; }

  got="$(parse_fix_numbers $'Fixes #46, Fixes #48, Fixes #61.\n' | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "46 48 61" ]] || { echo "FAIL pack Fixes -> [$got]"; fail=1; }

  got="$(parse_fix_numbers "This mentions #10 but no keyword" | tr '\n' ' ')"
  [[ -z "${got// /}" ]] || { echo "FAIL mention-only #10 -> [$got]"; fail=1; }

  got="$(parse_fix_numbers "closes peak-luli/midiman#14" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "14" ]] || { echo "FAIL repo-qualified closes -> [$got]"; fail=1; }

  got="$(parse_fix_numbers "Closes #8." | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  [[ "$got" == "8" ]] || { echo "FAIL Closes #8 -> [$got]"; fail=1; }

  got="$(squash_title "Capture Feedback screenshot when Feedback opens, not on submit" 64)"
  [[ "$got" == "Capture Feedback screenshot when Feedback opens, not on submit (#64)" ]] \
    || { echo "FAIL squash title -> [$got]"; fail=1; }

  is_approved_option "$STATUS_ISHAY_APPROVED" "Ishay Approved" \
    || { echo "FAIL approved option id"; fail=1; }
  is_approved_option "nope" "Building" \
    && { echo "FAIL Building must not be approved"; fail=1; }
  is_ready_option "" "Ready for Ishay" \
    || { echo "FAIL Ready for Ishay name"; fail=1; }
  is_ready_option "" "Building" \
    && { echo "FAIL Building must not be Ready"; fail=1; }
  is_merge_intent_status "$STATUS_ISHAY_APPROVED" "Ishay Approved" \
    || { echo "FAIL merge intent Approved"; fail=1; }
  is_merge_intent_status "" "In Review" \
    && { echo "FAIL In Review must not be merge intent"; fail=1; }
  is_done_option "$STATUS_DONE" "Done" \
    || { echo "FAIL Done option"; fail=1; }

  local reason
  if reason="$(mergeability_block_reason '{"number":64,"mergeable":true,"mergeable_state":"clean","draft":false}')"; then
    echo "FAIL CLEAN should merge, got [$reason]"; fail=1
  fi
  if reason="$(mergeability_block_reason '{"number":64,"mergeable":false,"mergeable_state":"dirty","draft":false}')"; then
    [[ "$reason" == *"DIRTY"* || "$reason" == *"not mergeable"* ]] \
      || { echo "FAIL DIRTY reason [$reason]"; fail=1; }
  else
    echo "FAIL DIRTY should block"; fail=1
  fi
  if reason="$(mergeability_block_reason '{"number":64,"mergeable":true,"mergeable_state":"unstable","draft":false}')"; then
    [[ "$reason" == *"UNSTABLE"* ]] || { echo "FAIL UNSTABLE reason [$reason]"; fail=1; }
  else
    echo "FAIL UNSTABLE should block"; fail=1
  fi
  if reason="$(mergeability_block_reason '{"number":64,"mergeable":true,"mergeable_state":"blocked","draft":false}')"; then
    [[ "$reason" == *"BLOCKED"* ]] || { echo "FAIL BLOCKED reason [$reason]"; fail=1; }
  else
    echo "FAIL BLOCKED should block"; fail=1
  fi
  if reason="$(mergeability_block_reason '{"number":64,"mergeable":true,"mergeable_state":"clean","draft":true}')"; then
    [[ "$reason" == *"draft"* ]] || { echo "FAIL draft reason [$reason]"; fail=1; }
  else
    echo "FAIL draft should block"; fail=1
  fi

  if [[ "$fail" -ne 0 ]]; then
    echo "self-test FAILED"
    exit 1
  fi
  echo "self-test OK"
  exit 0
}

# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------
issue_comments_json() {
  local issue="$1"
  gh_merge api "repos/${REPO}/issues/${issue}/comments" --paginate 2>/dev/null || echo '[]'
}

has_marker() {
  local issue="$1"
  local marker="$2"
  issue_comments_json "$issue" | jq -e --arg m "$marker" 'any(.[]; (.body // "") | contains($m))' >/dev/null
}

last_blocked_reason() {
  local issue="$1"
  issue_comments_json "$issue" | jq -r --arg m "$MARKER_BLOCKED" '
    [.[] | select((.body // "") | contains($m)) | .body] | last // empty
    | if . == "" then empty else
        sub("(?s).*\\*\\*Ishay Approved blocked\\*\\* — [0-9-]+[:]?\\s*";"")
        | sub(" Left Status[\\s\\S]*$";"")
      end
  '
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
    | gh_merge api "repos/${REPO}/issues/${issue}/comments" --input - >/dev/null
}

comment_once() {
  local issue="$1"
  local marker="$2"
  local body="$3"
  if has_marker "$issue" "$marker"; then
    log "Issue #${issue} already has ${marker}; skipping comment."
    return 0
  fi
  post_comment "$issue" "${marker}"$'\n'"${body}"
}

comment_blocked() {
  local issue="$1"
  local reason="$2"
  local dated
  dated="$(utc_date)"
  local prev
  prev="$(last_blocked_reason "$issue" || true)"
  if [[ -n "$prev" && "$prev" == "$reason" ]]; then
    log "Issue #${issue} already has the same blocker; not duplicating."
    return 0
  fi
  post_comment "$issue" \
    "${MARKER_BLOCKED}"$'\n'"**Ishay Approved blocked** — ${dated}: ${reason} Left Status **Ishay Approved**; not force-merged."
}

# ---------------------------------------------------------------------------
# Project / issue loaders
# ---------------------------------------------------------------------------
STATUS_OPTIONS_JSON=""
READY_OPTION_IDS=""

load_status_options() {
  local q
  q='query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2SingleSelectField {
        id
        name
        options { id name }
      }
    }
  }'
  STATUS_OPTIONS_JSON="$(gql_board "$q" -f id="$STATUS_FIELD_ID" || echo '{"data":{}}')"
  if [[ "$(jq -r '.data.node.id // empty' <<<"$STATUS_OPTIONS_JSON")" != "$STATUS_FIELD_ID" ]]; then
    warn "Could not read Status field options (token may lack org Project access). Using hardcoded option ids only."
    STATUS_OPTIONS_JSON='{"data":{"node":{"options":[]}}}'
  fi

  READY_OPTION_IDS="$(
    jq -r '
      [.data.node.options[]?
        | select((.name == "Ready") or (.name | startswith("Ready")))
        | .id]
      | unique | .[]
    ' <<<"$STATUS_OPTIONS_JSON"
  )"
  log "Status options loaded. Ready-family ids: ${READY_OPTION_IDS:-"(none resolved; name-match at runtime)"}"
}

is_ready_option() {
  local option_id="${1:-}"
  local name="${2:-}"
  if [[ -n "$option_id" && -n "$READY_OPTION_IDS" ]]; then
    printf '%s\n' "$READY_OPTION_IDS" | grep -Fxq "$option_id" && return 0
  fi
  [[ "$name" == "Ready" || "$name" == Ready* ]]
}

is_approved_option() {
  local option_id="${1:-}"
  local name="${2:-}"
  [[ "$option_id" == "$STATUS_ISHAY_APPROVED" || "$name" == "Ishay Approved" ]]
}

is_done_option() {
  local option_id="${1:-}"
  local name="${2:-}"
  [[ "$option_id" == "$STATUS_DONE" || "$name" == "Done" ]]
}

is_merge_intent_status() {
  local option_id="${1:-}"
  local name="${2:-}"
  is_approved_option "$option_id" "$name" || is_ready_option "$option_id" "$name"
}

ITEM_JSON=""

load_item_status() {
  local item_id="$1"
  local q
  q='query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        id
        project { id }
        status: fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        linked: fieldValueByName(name: "Linked pull requests") {
          ... on ProjectV2ItemFieldPullRequestValue {
            pullRequests(first: 20) {
              nodes {
                number title url state isDraft merged mergeable mergeStateStatus
                baseRefName updatedAt body
                repository { nameWithOwner }
                closingIssuesReferences(first: 30) {
                  nodes { number repository { nameWithOwner } }
                }
              }
            }
          }
        }
        content {
          __typename
          ... on Issue {
            number title url state
            repository { nameWithOwner }
          }
          ... on PullRequest {
            number title
            repository { nameWithOwner }
          }
        }
      }
    }
  }'
  ITEM_JSON="$(gql_board "$q" -f id="$item_id")"
}

item_status_id() { jq -r '.data.node.status.optionId // empty' <<<"$ITEM_JSON"; }
item_status_name() { jq -r '.data.node.status.name // empty' <<<"$ITEM_JSON"; }

FOUND_ITEM_ID=""

# Sets FOUND_ITEM_ID and ISSUE_META_JSON. Dies on API errors (not in a subshell).
# Returns 0 if the issue is on Midiman Dev, 1 if it is not.
lookup_item_for_issue() {
  local number="$1"
  FOUND_ITEM_ID=""
  local q
  q='query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        title
        url
        state
        projectItems(first: 30) {
          nodes { id project { id title } }
        }
        closedByPullRequestsReferences(first: 30) {
          nodes {
            number title url state isDraft merged mergeable mergeStateStatus
            baseRefName updatedAt body
            repository { nameWithOwner }
            closingIssuesReferences(first: 30) {
              nodes { number repository { nameWithOwner } }
            }
          }
        }
      }
    }
  }'
  local json
  json="$(gql_board "$q" -f owner="$OWNER" -f name="$NAME" -F number="$number" || true)"
  if jq -e '.errors' <<<"$json" >/dev/null 2>&1; then
    die "GraphQL failed loading issue #${number}. Check MIDIMAN_BOARD_TOKEN (repo + org Projects write). $(jq -c '.errors' <<<"$json")"
  fi
  if [[ "$(jq -r '.data.repository.issue.number // empty' <<<"$json")" != "$number" ]]; then
    die "Issue #${number} not found in ${REPO}."
  fi
  ISSUE_META_JSON="$json"
  FOUND_ITEM_ID="$(jq -r --arg pid "$PROJECT_ID" '
    .data.repository.issue.projectItems.nodes[]
    | select(.project.id == $pid)
    | .id
  ' <<<"$json" | head -n1)"
  [[ -n "$FOUND_ITEM_ID" ]]
}

ISSUE_META_JSON=""

resolve_issue_from_item() {
  local item_id="$1"
  load_item_status "$item_id"
  local typename repo number
  typename="$(jq -r '.data.node.content.__typename // empty' <<<"$ITEM_JSON")"
  repo="$(jq -r '.data.node.content.repository.nameWithOwner // empty' <<<"$ITEM_JSON")"
  number="$(jq -r '.data.node.content.number // empty' <<<"$ITEM_JSON")"
  if [[ "$typename" != "Issue" ]]; then
    log "Project item ${item_id} is ${typename:-not an issue}; ignoring."
    return 1
  fi
  if [[ "$repo" != "$REPO" ]]; then
    log "Project item ${item_id} is ${repo}#${number}, not ${REPO}; ignoring."
    return 1
  fi
  ISSUE_NUMBER="$number"
  return 0
}

# ---------------------------------------------------------------------------
# PR resolution
# ---------------------------------------------------------------------------
pr_candidates_json() {
  local linked='[]'
  local refs='[]'
  if [[ -n "$ITEM_JSON" ]]; then
    linked="$(jq -c '.data.node.linked.pullRequests.nodes // []' <<<"$ITEM_JSON")"
  fi
  if [[ -n "$ISSUE_META_JSON" ]]; then
    refs="$(jq -c '.data.repository.issue.closedByPullRequestsReferences.nodes // []' <<<"$ISSUE_META_JSON")"
  fi

  local search='[]'
  # Fallback: open PRs in this repo whose body Fixes this issue (not yet in refs).
  if [[ -n "$ISSUE_NUMBER" ]]; then
    local listed
    listed="$(gh_merge pr list --repo "$REPO" --state open --base "$DEFAULT_BRANCH" --limit 100 \
      --json number,title,body,isDraft,url,updatedAt,mergeable 2>/dev/null || echo '[]')"
    search="$(
      jq -c --argjson n "$ISSUE_NUMBER" --arg repo "$REPO" --arg base "$DEFAULT_BRANCH" '
        [
          .[]
          | select(.body != null)
          | select(
              (.body | test("(?i)(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+(#|\($repo)#)\($n)\\b"))
            )
          | {
              number, title, url, body,
              state: "OPEN",
              isDraft,
              merged: false,
              mergeable: (if .mergeable == "MERGEABLE" then "MERGEABLE"
                          elif .mergeable == "CONFLICTING" then "CONFLICTING"
                          else "UNKNOWN" end),
              mergeStateStatus: "UNKNOWN",
              baseRefName: $base,
              updatedAt,
              repository: { nameWithOwner: $repo },
              closingIssuesReferences: { nodes: [{ number: ($n | tonumber), repository: { nameWithOwner: $repo } }] },
              source: "fixes-search"
            }
        ]
      ' <<<"$listed"
    )"
  fi

  local forced='[]'
  if [[ -n "${PR_NUMBER:-}" ]]; then
    local forced_rest
    if forced_rest="$(fetch_pr "$PR_NUMBER" 2>/dev/null)"; then
      forced="$(jq -c --arg repo "$REPO" '
        [{
          number: .number,
          title: .title,
          url: .html_url,
          body: (.body // ""),
          state: (.state | ascii_upcase),
          isDraft: .draft,
          merged: (.merged // false),
          mergeable: (if .mergeable == true then "MERGEABLE"
                      elif .mergeable == false then "CONFLICTING"
                      else "UNKNOWN" end),
          mergeStateStatus: ((.mergeable_state // "UNKNOWN") | ascii_upcase),
          baseRefName: .base.ref,
          updatedAt: .updated_at,
          repository: { nameWithOwner: $repo },
          closingIssuesReferences: { nodes: [] },
          source: "forced"
        }]
      ' <<<"$forced_rest")"
    fi
  fi

  jq -n --argjson linked "$linked" --argjson refs "$refs" --argjson search "$search" --argjson forced "$forced" --arg repo "$REPO" --arg base "$DEFAULT_BRANCH" '
    def norm:
      . + {
        source: (.source // "api"),
        repository: (.repository.nameWithOwner // ""),
        closing: [((.closingIssuesReferences.nodes // [])[] | select(.repository.nameWithOwner == $repo) | .number)]
      };
    [($linked[] | norm | .source = "linked"),
     ($refs[] | norm | .source = "closes-ref"),
     ($search[] | norm),
     ($forced[] | norm)]
    | unique_by(.number)
    | map(select(.repository == $repo and .baseRefName == $base))
  '
}

pick_open_pr() {
  local cands="$1"
  jq -c --argjson forced "${PR_NUMBER:-null}" '
    def rank:
      (if .source == "linked" then 0 elif .source == "closes-ref" then 1 else 2 end);
    (if $forced != null then map(select(.number == $forced)) else . end)
    | map(select((.state | ascii_upcase) == "OPEN" and (.isDraft | not) and (.merged | not)))
    | sort_by(.updatedAt)
    | reverse
    | sort_by(rank)
    | first // empty
  ' <<<"$cands"
}

pick_merged_pr() {
  local cands="$1"
  jq -c --argjson forced "${PR_NUMBER:-null}" '
    (if $forced != null then map(select(.number == $forced)) else . end)
    | map(select(.merged == true or ((.state | ascii_upcase) == "MERGED")))
    | sort_by(.updatedAt)
    | reverse
    | first // empty
  ' <<<"$cands"
}

fetch_pr() {
  local n="$1"
  gh_merge api "repos/${REPO}/pulls/${n}"
}

wait_mergeable() {
  local n="$1"
  local i json mergeable
  json=""
  for i in 1 2 3 4 5 6; do
    json="$(fetch_pr "$n")"
    mergeable="$(jq -r '.mergeable' <<<"$json")"
    if [[ "$mergeable" != "null" ]]; then
      printf '%s' "$json"
      return 0
    fi
    log "PR #${n} mergeable is still computing (attempt ${i}); waiting 2s."
    sleep 2
  done
  printf '%s' "$json"
}

pack_issue_numbers() {
  local pr_json="$1"
  local body from_api from_body
  body="$(jq -r '.body // empty' <<<"$pr_json")"
  from_api="$(jq -r --arg repo "$REPO" '
    [(.closingIssuesReferences.nodes // [])[]
      | select(.repository.nameWithOwner == $repo)
      | .number]
    | unique | .[]
  ' <<<"$pr_json" 2>/dev/null || true)"
  # REST payload has no closingIssuesReferences; GraphQL cand might.
  if [[ -z "$from_api" ]]; then
    from_api="$(jq -r --arg repo "$REPO" '
      [.closing[]? // empty] | unique | .[]
    ' <<<"$pr_json" 2>/dev/null || true)"
  fi
  from_body="$(parse_fix_numbers "$body")"
  printf '%s\n%s\n%s\n' "$from_api" "$from_body" "$ISSUE_NUMBER" \
    | grep -E '^[0-9]+$' \
    | sort -n \
    | uniq
}

# ---------------------------------------------------------------------------
# Board writes
# ---------------------------------------------------------------------------
set_status() {
  local item_id="$1"
  local option_id="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would set item ${item_id} Status -> ${option_id}"
    return 0
  fi
  local q
  q='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }'
  gql_board "$q" \
    -f projectId="$PROJECT_ID" \
    -f itemId="$item_id" \
    -f fieldId="$STATUS_FIELD_ID" \
    -f optionId="$option_id" >/dev/null
}

clear_agent_session() {
  local item_id="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would clear Agent session on ${item_id}"
    return 0
  fi
  local q
  q='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: "" }
    }) { projectV2Item { id } }
  }'
  gql_board "$q" \
    -f projectId="$PROJECT_ID" \
    -f itemId="$item_id" \
    -f fieldId="$AGENT_SESSION_FIELD_ID" >/dev/null
}

mark_issue_done() {
  local number="$1"
  local pr_n="$2"
  local sha="$3"
  local sha7="${sha:0:7}"
  local item=""
  if lookup_item_for_issue "$number"; then
    item="$FOUND_ITEM_ID"
  fi
  if [[ -z "$item" ]]; then
    warn "Issue #${number} is not on Midiman Dev; commenting Done only."
  else
    load_item_status "$item"
    local sid sname
    sid="$(item_status_id)"
    sname="$(item_status_name)"
    if is_done_option "$sid" "$sname"; then
      log "Issue #${number} already Done."
    elif is_merge_intent_status "$sid" "$sname" || is_approved_option "$sid" "$sname"; then
      set_status "$item" "$STATUS_DONE"
      clear_agent_session "$item"
    else
      log "Issue #${number} Status is ${sname:-$sid}; not moving to Done (not Ishay Approved/Ready)."
      return 0
    fi
  fi
  comment_once "$number" "$MARKER_DONE" \
    "**Done** — squash-merged PR #${pr_n} (\`${sha7}\`) from **Ishay Approved** via GitHub Action."
}

# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------
squash_merge_pr() {
  local n="$1"
  local title="$2"
  local subject
  subject="$(squash_title "$title" "$n")"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would squash-merge PR #${n} with title: ${subject}"
    printf '%s' "dryrun00000000000000000000000000000000000"
    return 0
  fi
  local payload sha
  payload="$(jq -n --arg title "$subject" '{merge_method:"squash", commit_title:$title}')"
  local tmp rc=0
  tmp="$(mktemp)"
  if ! printf '%s' "$payload" | gh_merge api --method PUT "repos/${REPO}/pulls/${n}/merge" --input - >"$tmp"; then
    rc=1
  fi
  if [[ "$rc" -ne 0 && -n "${MIDIMAN_BOARD_TOKEN:-}" && "${GITHUB_TOKEN:-}" != "${MIDIMAN_BOARD_TOKEN:-}" ]]; then
    log "Merge with GITHUB_TOKEN failed; retrying with MIDIMAN_BOARD_TOKEN."
    if printf '%s' "$payload" | GH_TOKEN="$MIDIMAN_BOARD_TOKEN" gh api --method PUT "repos/${REPO}/pulls/${n}/merge" --input - >"$tmp"; then
      rc=0
    fi
  fi
  if [[ "$rc" -ne 0 ]]; then
    cat "$tmp" >&2 || true
    rm -f "$tmp"
    return 1
  fi
  sha="$(jq -r '.sha // empty' "$tmp")"
  rm -f "$tmp"
  [[ -n "$sha" ]] || return 1
  printf '%s' "$sha"
}

mergeability_block_reason() {
  local json="$1"
  local n mergeable state draft
  n="$(jq -r '.number' <<<"$json")"
  mergeable="$(jq -r '.mergeable' <<<"$json")"
  state="$(jq -r '.mergeable_state // empty' <<<"$json")"
  draft="$(jq -r '.draft' <<<"$json")"

  if [[ "$draft" == "true" ]]; then
    printf 'PR #%s is a draft.' "$n"
    return 0
  fi
  if [[ "$mergeable" != "true" ]]; then
    printf 'PR #%s is not mergeable (mergeable=%s, mergeable_state=%s). Conflicts or GitHub has not computed a clean merge.' \
      "$n" "$mergeable" "$state"
    return 0
  fi
  case "$state" in
    clean|has_hooks|'')
      return 1
      ;;
    dirty)
      printf 'PR #%s has conflicts (DIRTY).' "$n"
      return 0
      ;;
    blocked)
      printf 'PR #%s is BLOCKED (required reviews or required checks).' "$n"
      return 0
      ;;
    unstable)
      printf 'PR #%s is UNSTABLE (checks pending or failing).' "$n"
      return 0
      ;;
    behind)
      # Squash is still allowed unless branch protection requires it up to date;
      # that case usually surfaces as blocked. Allow when mergeable=true.
      return 1
      ;;
    *)
      printf 'PR #%s mergeable_state=%s; not CLEAN. Not force-merging.' "$n" "$state"
      return 0
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Main paths
# ---------------------------------------------------------------------------
require_tokens() {
  if [[ -z "$(merge_token)" ]]; then
    die "No GITHUB_TOKEN / MIDIMAN_BOARD_TOKEN available."
  fi
  if [[ -z "${MIDIMAN_BOARD_TOKEN:-}" ]]; then
    warn "MIDIMAN_BOARD_TOKEN is unset; falling back to GITHUB_TOKEN. Org Project writes often fail with GITHUB_TOKEN."
  fi
  local proj
  proj="$(gql_board 'query($id: ID!) { node(id: $id) { ... on ProjectV2 { id title } } }' -f id="$PROJECT_ID" || echo '{}')"
  if [[ "$(jq -r '.data.node.id // empty' <<<"$proj")" != "$PROJECT_ID" ]]; then
    die "Cannot read Midiman Dev (${PROJECT_ID}). Add repo secret MIDIMAN_BOARD_TOKEN (repo + org Projects write)."
  fi
}

handle_review_gate() {
  if [[ "${REVIEW_STATE,,}" != "approved" ]]; then
    log "Review state is ${REVIEW_STATE:-empty}, not approved. Nothing to do."
    exit 0
  fi
  if [[ "$REVIEWER" != "$HUMAN_REVIEWER" ]]; then
    log "Reviewer ${REVIEWER:-unknown} is not ${HUMAN_REVIEWER}. Nothing to do."
    exit 0
  fi
  [[ -n "$PR_NUMBER" ]] || die "pull_request_review path requires --pr."
}

run_from_issue() {
  require_tokens
  load_status_options

  if [[ -n "$PROJECT_ITEM_ID" && -z "$ISSUE_NUMBER" ]]; then
    resolve_issue_from_item "$PROJECT_ITEM_ID" || exit 0
  fi
  [[ -n "$ISSUE_NUMBER" ]] || die "Need --issue or --project-item."

  local item=""
  if lookup_item_for_issue "$ISSUE_NUMBER"; then
    item="$FOUND_ITEM_ID"
  fi
  if [[ -z "$item" ]]; then
    comment_once "$ISSUE_NUMBER" "$MARKER_NOOP" \
      "**Ishay Approved** — issue is not on Midiman Dev; GitHub Action will not merge."
    log "Issue #${ISSUE_NUMBER} is not on Midiman Dev. Exit 0."
    exit 0
  fi
  PROJECT_ITEM_ID="$item"
  load_item_status "$item"

  local sid sname
  sid="$(item_status_id)"
  sname="$(item_status_name)"
  log "Issue #${ISSUE_NUMBER} Status=${sname:-?} (${sid:-?}) source=${SOURCE}"

  if is_done_option "$sid" "$sname"; then
    comment_once "$ISSUE_NUMBER" "$MARKER_NOOP" \
      "**Already Done** — Midiman Dev Status is already **Done**; no merge."
    log "Already Done. Exit 0."
    exit 0
  fi

  local intent_ok=0
  if is_approved_option "$sid" "$sname"; then
    intent_ok=1
  elif [[ "$SOURCE" == "pull_request_review" ]] && is_ready_option "$sid" "$sname"; then
    intent_ok=1
  fi

  if [[ "$intent_ok" -ne 1 ]]; then
    if [[ "$SOURCE" == "pull_request_review" ]]; then
      log "Board Status is ${sname:-unknown} (Building/In Review/other). Review path does nothing."
      exit 0
    fi
    comment_once "$ISSUE_NUMBER" "$MARKER_NOOP" \
      "**Ishay Approved** — board Status is **${sname:-unknown}**, not **Ishay Approved**. Action will not merge."
    log "No Ishay Approved intent. Exit 0."
    exit 0
  fi

  local cands open_pr merged_pr
  cands="$(pr_candidates_json)"
  log "PR candidates: $(jq -c '[.[] | {number, state, source, isDraft, merged}]' <<<"$cands")"
  open_pr="$(pick_open_pr "$cands")"
  merged_pr="$(pick_merged_pr "$cands")"

  if [[ -z "$open_pr" || "$open_pr" == "null" ]]; then
    if [[ -n "$merged_pr" && "$merged_pr" != "null" ]]; then
      local mn msha
      mn="$(jq -r '.number' <<<"$merged_pr")"
      msha="$(gh_merge api "repos/${REPO}/pulls/${mn}" --jq '.merge_commit_sha // .head.sha // "merged"')"
      log "PR #${mn} already merged. Marking Done (idempotent)."
      local sib
      while IFS= read -r sib; do
        [[ -n "$sib" ]] || continue
        mark_issue_done "$sib" "$mn" "$msha"
      done < <(pack_issue_numbers "$merged_pr")
      exit 0
    fi
    comment_once "$ISSUE_NUMBER" "$MARKER_NOOP" \
      "**Ishay Approved** — no open eng PR linked or \`Fixes #${ISSUE_NUMBER}\` for this issue; nothing to squash-merge."
    log "No open or merged PR. Exit 0."
    exit 0
  fi

  local n title
  n="$(jq -r '.number' <<<"$open_pr")"
  title="$(jq -r '.title' <<<"$open_pr")"
  log "Selected PR #${n} (${title})"

  local rest
  rest="$(wait_mergeable "$n")"
  local reason
  if reason="$(mergeability_block_reason "$rest")"; then
    comment_blocked "$ISSUE_NUMBER" "$reason"
    die "$reason"
  fi

  local sha
  if ! sha="$(squash_merge_pr "$n" "$title")"; then
    comment_blocked "$ISSUE_NUMBER" "PR #${n} squash-merge API failed. Left Status **Ishay Approved**; not force-merged."
    die "Squash-merge of PR #${n} failed."
  fi
  log "Squash-merged PR #${n} sha=${sha}"

  # Prefer REST body + GraphQL closing refs from the candidate, plus Fixes parse.
  local combined
  combined="$(jq -n --argjson cand "$open_pr" --argjson rest "$rest" '
    $rest + {
      closingIssuesReferences: ($cand.closingIssuesReferences // {nodes: []}),
      closing: ($cand.closing // [])
    }
  ')"
  local sib
  while IFS= read -r sib; do
    [[ -n "$sib" ]] || continue
    mark_issue_done "$sib" "$n" "$sha"
  done < <(pack_issue_numbers "$combined")
  log "Done."
}

run_from_review() {
  handle_review_gate
  require_tokens
  load_status_options

  local rest
  rest="$(fetch_pr "$PR_NUMBER")"
  local repo base draft state
  repo="$(jq -r '.base.repo.full_name' <<<"$rest")"
  base="$(jq -r '.base.ref' <<<"$rest")"
  draft="$(jq -r '.draft' <<<"$rest")"
  state="$(jq -r '.state' <<<"$rest")"
  if [[ "$repo" != "$REPO" || "$base" != "$DEFAULT_BRANCH" ]]; then
    log "PR #${PR_NUMBER} is ${repo}@${base}, not ${REPO}@${DEFAULT_BRANCH}. Nothing to do."
    exit 0
  fi
  if [[ "$draft" == "true" || "$state" != "open" ]]; then
    log "PR #${PR_NUMBER} is draft=${draft} state=${state}. Nothing to do."
    exit 0
  fi

  local body issues
  body="$(jq -r '.body // empty' <<<"$rest")"
  issues="$(parse_fix_numbers "$body")"
  # Also GraphQL closing refs
  local q refs
  q='query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 30) {
          nodes { number repository { nameWithOwner } }
        }
      }
    }
  }'
  refs="$(gql_board "$q" -f owner="$OWNER" -f name="$NAME" -F number="$PR_NUMBER" \
    | jq -r --arg repo "$REPO" '
        [.data.repository.pullRequest.closingIssuesReferences.nodes[]?
          | select(.repository.nameWithOwner == $repo) | .number]
        | unique | .[]
      ')"
  issues="$(printf '%s\n%s\n' "$issues" "$refs" | grep -E '^[0-9]+$' | sort -n | uniq || true)"
  if [[ -z "$issues" ]]; then
    log "PR #${PR_NUMBER} has no Fixes/closes issues in ${REPO}. Nothing to do."
    exit 0
  fi

  local found=""
  local n sid sname item
  while IFS= read -r n; do
    [[ -n "$n" ]] || continue
    lookup_item_for_issue "$n" || true
    item="$FOUND_ITEM_ID"
    [[ -n "$item" ]] || continue
    load_item_status "$item"
    sid="$(item_status_id)"
    sname="$(item_status_name)"
    if is_merge_intent_status "$sid" "$sname"; then
      found="$n"
      log "Review path: issue #${n} is ${sname} — merge intent."
      break
    fi
    log "Review path: issue #${n} is ${sname:-unknown} — not Approved/Ready."
  done <<<"$issues"

  if [[ -z "$found" ]]; then
    log "No linked issue is Ishay Approved or Ready for Ishay. Review path does nothing."
    exit 0
  fi

  ISSUE_NUMBER="$found"
  run_from_issue
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  run_self_test
fi

if [[ "$SOURCE" == "pull_request_review" && -n "$PR_NUMBER" && -z "$ISSUE_NUMBER" ]]; then
  run_from_review
else
  if [[ "$SOURCE" == "pull_request_review" ]]; then
    handle_review_gate
  fi
  run_from_issue
fi
