#!/usr/bin/env bash
# Publish the site to Netlify. One token, no dependencies: the site is assembled by
# scripts/site.sh, zipped, and handed to Netlify's deploy API with curl.
#
#     scripts/netlify-deploy.sh            # production deploy
#     scripts/netlify-deploy.sh --draft    # a preview URL, production untouched
#
# Needs MIDIMAN_NETLIFY_PAT, a Netlify personal access token (User settings ->
# Applications -> Personal access tokens). Locally it comes from .env, like the
# other secrets; in Actions it is a repository secret of the same name.
#
# Which site: MIDIMAN_NETLIFY_SITE_ID if set, else the site named
# MIDIMAN_NETLIFY_SITE (default "peak-luli-midiman") on the token's team -- found by name, or
# created on the first run. Names are global across Netlify ("midiman" itself is taken), so if this one belongs
# to someone else the create fails and the message says to pick another name.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/load-env.sh
. ./scripts/load-env.sh

API=https://api.netlify.com/api/v1
DRAFT=""
for a in "$@"; do
  case "$a" in
    --draft) DRAFT="?draft=true" ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

: "${MIDIMAN_NETLIFY_PAT:?MIDIMAN_NETLIFY_PAT is not set -- a Netlify personal access token, in .env or the shell}"
NAME="${MIDIMAN_NETLIFY_SITE:-peak-luli-midiman}"
SITE_ID="${MIDIMAN_NETLIFY_SITE_ID:-}"

# curl against the API, the token never on the command line
api() {
  local method="$1" path="$2"; shift 2
  curl -sS --fail-with-body -X "$method" "$API$path" \
    -H @<(printf 'Authorization: Bearer %s\n' "$MIDIMAN_NETLIFY_PAT") "$@"
}

if [ -z "$SITE_ID" ]; then
  SITE_ID="$(api GET "/sites?name=$NAME" | jq -r --arg n "$NAME" '[.[] | select(.name == $n)][0].id // empty')"
fi
if [ -z "$SITE_ID" ]; then
  echo "no site named $NAME on this token's team -- creating it"
  if ! created="$(api POST /sites -H 'Content-Type: application/json' -d "{\"name\":\"$NAME\"}")"; then
    echo "$created" >&2
    echo "could not create a site named $NAME (names are global on Netlify; set" >&2
    echo "MIDIMAN_NETLIFY_SITE to another name, or MIDIMAN_NETLIFY_SITE_ID to an existing site)" >&2
    exit 1
  fi
  SITE_ID="$(printf '%s' "$created" | jq -r .id)"
fi
echo "site: $NAME ($SITE_ID)"

bash scripts/site.sh dist
ZIP="$(mktemp -t midiman-site.XXXXXX).zip"
trap 'rm -f "$ZIP"' EXIT
(cd dist && zip -q -r -X "$ZIP" .)

msg="$(git log -1 --format='%h %s' 2>/dev/null || echo 'local deploy')"
deploy="$(api POST "/sites/$SITE_ID/deploys$DRAFT" \
  -H 'Content-Type: application/zip' -H "X-Deploy-Title: $msg" --data-binary "@$ZIP")"
DEPLOY_ID="$(printf '%s' "$deploy" | jq -r .id)"
echo "deploy $DEPLOY_ID uploaded, waiting for Netlify to process it"

# a zip deploy is processed after the upload; a few seconds, usually
for _ in $(seq 1 60); do
  deploy="$(api GET "/deploys/$DEPLOY_ID")"
  state="$(printf '%s' "$deploy" | jq -r .state)"
  case "$state" in
    ready) break ;;
    error) echo "deploy failed: $(printf '%s' "$deploy" | jq -r '.error_message // "no message"')" >&2; exit 1 ;;
  esac
  sleep 2
done
[ "$state" = ready ] || { echo "deploy still $state after two minutes; check app.netlify.com" >&2; exit 1; }

if [ -n "$DRAFT" ]; then
  echo "preview: $(printf '%s' "$deploy" | jq -r .deploy_ssl_url)"
else
  echo "live:    $(printf '%s' "$deploy" | jq -r .ssl_url)"
fi
