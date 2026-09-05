# Sourced by serve.sh and phone.sh from the repo root.
# Exports KEY=VALUE lines from a local .env, if one exists.
# Comments and blank lines are skipped. Already-set non-empty variables win;
# an empty export (or a blank KEY= from .env.example) does not block a later value.
# Matching single or double quotes around a value are stripped. Values are never printed.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      ''|\#*) continue ;;
    esac
    case "$line" in
      export\ *) line="${line#export }" ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    case "$key" in
      [A-Za-z_][A-Za-z0-9_]*) ;;
      *) continue ;;
    esac
    # printenv succeeds for an empty export; only a non-empty value should win.
    if [ -n "$(printenv "$key" 2>/dev/null || true)" ]; then
      continue
    fi
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
      \"*\")
        value="${value#\"}"
        value="${value%\"}"
        ;;
      \'*\')
        value="${value#\'}"
        value="${value%\'}"
        ;;
    esac
    export "$key=$value"
  done < .env
fi
