#!/usr/bin/env bash
# Shared PR labels for MidiMan Actions (Noa failure-only pulse + optional wakes).
# Source this file, or run: midiman-pr-labels.sh --self-test | ensure | add | remove | has
set -euo pipefail

REPO="${MIDIMAN_REPO:-peak-luli/midiman}"

LABEL_NEEDS_CONFLICT_AGENT="${MIDIMAN_LABEL_NEEDS_CONFLICT_AGENT:-needs-conflict-agent}"
LABEL_CI_FAILED="${MIDIMAN_LABEL_CI_FAILED:-ci-failed}"
LABEL_ISHAY_APPROVED_WAKE="${MIDIMAN_LABEL_ISHAY_APPROVED_WAKE:-ishay-approved}"

label_token() {
  if [[ -n "${MIDIMAN_GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$MIDIMAN_GITHUB_TOKEN"
  else
    printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  fi
}

gh_labels() {
  local t
  t="$(label_token)"
  if [[ -n "$t" ]]; then
    GH_TOKEN="$t" gh "$@"
  else
    gh "$@"
  fi
}

# name|color|description
label_spec() {
  case "$1" in
    needs-conflict-agent)
      printf '%s' "D93F0B|Main sync conflicted with main. Noa: kick a conflict-resolution agent. Not a Midiman Dev Status."
      ;;
    ci-failed)
      printf '%s' "B60205|Open PR against main has failing checks. Noa failure-only pulse. Remove when green."
      ;;
    ishay-approved)
      printf '%s' "5319E7|One-shot wake for the Ishay Approved merge Action. Does NOT change Midiman Dev Status."
      ;;
    *)
      printf '%s' "ededed|"
      ;;
  esac
}

ensure_repo_label() {
  local name="$1"
  local spec color desc
  spec="$(label_spec "$name")"
  color="${spec%%|*}"
  desc="${spec#*|}"
  if [[ "${MIDIMAN_LABELS_DRY_RUN:-0}" == "1" ]]; then
    printf 'ensure_repo_label %s color=%s\n' "$name" "$color" >&2
    return 0
  fi
  local payload tmp rc=0
  payload="$(jq -n --arg name "$name" --arg color "$color" --arg desc "$desc" \
    '{name:$name, color:$color, description:$desc}')"
  tmp="$(mktemp)"
  if ! printf '%s' "$payload" | gh_labels api "repos/${REPO}/labels" --input - >"$tmp" 2>/dev/null; then
    rc=$?
  fi
  if [[ "$rc" -eq 0 ]]; then
    rm -f "$tmp"
    return 0
  fi
  # 422 already_exists is success. Update color/description to stay canonical.
  if printf '%s' "$payload" | gh_labels api --method PATCH "repos/${REPO}/labels/${name}" --input - >/dev/null 2>/dev/null; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 0
}

pr_label_names_json() {
  local n="$1"
  gh_labels api "repos/${REPO}/issues/${n}/labels" --jq '[.[].name]' 2>/dev/null || echo '[]'
}

pr_has_label() {
  local n="$1"
  local name="$2"
  pr_label_names_json "$n" | jq -e --arg n "$name" 'index($n) != null' >/dev/null
}

add_pr_label() {
  local n="$1"
  local name="$2"
  ensure_repo_label "$name"
  if [[ "${MIDIMAN_LABELS_DRY_RUN:-0}" == "1" ]]; then
    printf '[dry-run] would add label %s on #%s\n' "$name" "$n" >&2
    return 0
  fi
  if pr_has_label "$n" "$name"; then
    return 0
  fi
  jq -n --arg n "$name" '{labels:[$n]}' \
    | gh_labels api --method POST "repos/${REPO}/issues/${n}/labels" --input - >/dev/null
}

remove_pr_label() {
  local n="$1"
  local name="$2"
  if [[ "${MIDIMAN_LABELS_DRY_RUN:-0}" == "1" ]]; then
    printf '[dry-run] would remove label %s from #%s\n' "$name" "$n" >&2
    return 0
  fi
  if ! pr_has_label "$n" "$name"; then
    return 0
  fi
  local enc
  enc="$(jq -nr --arg n "$name" '$n | @uri')"
  gh_labels api --method DELETE "repos/${REPO}/issues/${n}/labels/${enc}" >/dev/null 2>/dev/null || true
}

labels_self_test() {
  local fail=0 spec
  [[ "$LABEL_NEEDS_CONFLICT_AGENT" == "needs-conflict-agent" ]] \
    || { echo "FAIL conflict label name"; fail=1; }
  [[ "$LABEL_CI_FAILED" == "ci-failed" ]] \
    || { echo "FAIL ci-failed label name"; fail=1; }
  [[ "$LABEL_ISHAY_APPROVED_WAKE" == "ishay-approved" ]] \
    || { echo "FAIL ishay-approved wake label name"; fail=1; }

  spec="$(label_spec needs-conflict-agent)"
  [[ "$spec" == D93F0B* ]] || { echo "FAIL conflict spec [$spec]"; fail=1; }
  printf '%s' "$spec" | grep -Fq "Not a Midiman Dev Status" \
    || { echo "FAIL conflict desc"; fail=1; }

  spec="$(label_spec ci-failed)"
  [[ "$spec" == B60205* ]] || { echo "FAIL ci-failed spec [$spec]"; fail=1; }
  printf '%s' "$spec" | grep -Fq "failure-only pulse" \
    || { echo "FAIL ci-failed desc"; fail=1; }

  spec="$(label_spec ishay-approved)"
  [[ "$spec" == 5319E7* ]] || { echo "FAIL ishay spec [$spec]"; fail=1; }
  printf '%s' "$spec" | grep -Fq "Does NOT change Midiman Dev Status" \
    || { echo "FAIL ishay desc must not look like Status"; fail=1; }

  if [[ "$fail" -ne 0 ]]; then
    echo "self-test FAILED"
    return 1
  fi
  echo "self-test OK"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --self-test) labels_self_test; exit $? ;;
    ensure) ensure_repo_label "${2:?label name}"; exit 0 ;;
    add) add_pr_label "${2:?pr}" "${3:?label}"; exit 0 ;;
    remove) remove_pr_label "${2:?pr}" "${3:?label}"; exit 0 ;;
    has) pr_has_label "${2:?pr}" "${3:?label}"; exit $? ;;
    *)
      echo "Usage: midiman-pr-labels.sh --self-test | ensure NAME | add PR NAME | remove PR NAME | has PR NAME" >&2
      exit 1
      ;;
  esac
fi
