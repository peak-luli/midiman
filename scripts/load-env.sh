# Sourced by serve.sh and phone.sh from the repo root.
# Exports KEY=VALUE lines from a local .env, if one exists.
# Comments and blank lines are skipped. Already-set shell variables win.
# Values are never printed.
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
    if printenv "$key" >/dev/null 2>&1; then
      continue
    fi
    export "$key=${line#*=}"
  done < .env
fi
