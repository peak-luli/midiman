#!/usr/bin/env bash
# The one command. Serves the app to this laptop *and* to a phone on the same Wi-Fi.
#
#     ./serve.sh [port]        every interface -- the phone can reach it
#     ./serve.sh --local       loopback only, this laptop and nothing else
#
# Why it binds 0.0.0.0 by default: the iPhone on the music stand is a *mirror* of
# this laptop, and a mirror has to reach this same process -- a room lives in this
# server's memory, so a phone sent anywhere else joins an empty room. Bound to
# 127.0.0.1 there is no address to send it to, and the share panel says so instead
# of drawing a QR. Plain http is fine for that path: the mirror needs fetch,
# EventSource, an AudioContext and fullscreen, and none of those is gated on a
# secure context.
#
# What plain http does NOT get you is Web MIDI, which is the phone playing on its
# own with the piano plugged into it. That needs https and a certificate the phone
# trusts -- ./phone.sh.
#
# It binds every interface: run it on a network you trust, Ctrl-C when you are done.
set -euo pipefail
cd "$(dirname "$0")"
# Local .env, if present. Shell-exported variables win. Values are never printed.
# shellcheck source=scripts/load-env.sh
. ./scripts/load-env.sh


BIND=0.0.0.0
PORT=""
for a in "$@"; do
  case "$a" in
    --local|--localhost|--loopback) BIND=127.0.0.1 ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PORT="$a" ;;
  esac
done
PORT="${PORT:-8765}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

# The Wi-Fi address, found the same way phone.sh finds it: the Wi-Fi interface first,
# then whichever interface the default route leaves by, then the hostname. Any of them
# may come up empty -- a laptop with the Wi-Fi off still has to serve the page.
lan_ip() {
  local ip dev
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  if [ -z "$ip" ] && command -v route >/dev/null 2>&1; then
    dev="$(route get default 2>/dev/null | awk '/interface:/{print $2}')"
    [ -n "${dev:-}" ] && ip="$(ipconfig getifaddr "$dev" 2>/dev/null || true)"
  fi
  [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  printf '%s' "$ip"
}

echo
bold "Middleman is up."
printf '  %-28s\033[1mhttp://localhost:%s\033[0m\n' "On this laptop:" "$PORT"

if [ "$BIND" = 127.0.0.1 ]; then
  echo
  dim  "  Loopback only (--local): no phone can reach this. Drop the flag for that."
else
  IP="$(lan_ip)"
  if [ -n "$IP" ]; then
    printf '  %-28s\033[1mhttp://%s:%s/learn-m.html\033[0m\n' "On the phone (same Wi-Fi):" "$IP" "$PORT"
    echo
    echo "Put the laptop's Learn page on the phone: open"
    printf '  \033[1mhttp://localhost:%s/learn.html\033[0m, press "Put it on the phone", scan the QR.\n' "$PORT"
    dim  "  (that QR carries the code — it is the one an iPhone scans, and it needs"
    dim  "   no certificate: the phone mirrors this laptop over plain http.)"
  else
    echo
    dim  "  No Wi-Fi address found — this laptop does not look to be on a network,"
    dim  "  so there is nothing to send the phone. Join the phone's Wi-Fi and restart."
  fi
fi

echo
echo "For a phone that plays on its own, with the piano plugged into it (Android +"
echo "Web MIDI), the phone needs https and a certificate — run ./phone.sh instead."
if [ "$BIND" = 127.0.0.1 ]; then
  dim "  Serving 127.0.0.1 only. Ctrl-C stops it."
else
  dim "  Serving every interface. Trusted Wi-Fi only. Ctrl-C stops it."
fi
echo

exec python3 serve.py "$PORT" "$BIND"
