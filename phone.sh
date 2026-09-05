#!/usr/bin/env bash
# Serve the app over https, for a phone with the piano plugged into it.
#
#     ./phone.sh [port]
#
# This is the Android case, and only the Android case. Why it is not just
# `./serve.sh`: when the *phone* opens the MIDI port it needs Web MIDI, Web MIDI
# needs a *secure context*, and http://<laptop-ip>:8765 is not one -- localhost is
# the only origin that gets a free pass. So the phone needs https, and https needs a
# certificate the phone actually trusts, which means mkcert's local CA installed on
# the phone once. Everything below is that, in order, with the certificate kept in
# certs/ (git-ignored) and reused.
#
# An iPhone does not come here at all. There is no Web MIDI on iOS, so the piano
# stays on the laptop and the phone mirrors it -- fetch, EventSource, an AudioContext
# and fullscreen, none of them gated on a secure context. That runs on ./serve.sh
# over plain http, with nothing to install.
#
# It binds every interface: run it on a network you trust, and stop it when you are
# done playing.
set -euo pipefail
cd "$(dirname "$0")"
# Local .env, if present. Shell-exported variables win. Values are never printed.
# shellcheck source=scripts/load-env.sh
. ./scripts/load-env.sh
PORT="${1:-8765}"


bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. the address
IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -n "$IP" ] || IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ] && command -v route >/dev/null 2>&1; then
  DEV="$(route get default 2>/dev/null | awk '/interface:/{print $2}')"
  [ -n "${DEV:-}" ] && IP="$(ipconfig getifaddr "$DEV" 2>/dev/null || true)"
fi
[ -n "$IP" ] || IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
if [ -z "$IP" ]; then
  echo "No Wi-Fi address found — this laptop does not look to be on a network." >&2
  echo "Join the same Wi-Fi as the phone and run this again." >&2
  exit 1
fi

# ---------------------------------------------------------------- 2. the certificate
if ! command -v mkcert >/dev/null 2>&1; then
  echo
  bold "mkcert is not installed, and the phone needs it."
  echo "A self-signed certificate gets you past the warning screen but leaves the"
  echo "origin untrusted, and Web MIDI refuses an untrusted origin — so there is no"
  echo "shortcut here. One line, once:"
  echo
  bold "    brew install mkcert"
  echo
  echo "then run ./phone.sh again."
  exit 1
fi

CAROOT="$(mkcert -CAROOT)"
if [ ! -s "$CAROOT/rootCA.pem" ]; then
  echo "Setting up mkcert's local certificate authority (asks for your password)…"
  mkcert -install
  CAROOT="$(mkcert -CAROOT)"
fi

mkdir -p certs
CERT="certs/$IP.pem" KEY="certs/$IP-key.pem"
# reuse the certificate as long as it still covers today's address -- a laptop that
# moved between networks has a new IP and needs a new one
if [ ! -s "$CERT" ] || ! openssl x509 -in "$CERT" -noout -checkip "$IP" >/dev/null 2>&1; then
  echo "Making a certificate for ${IP}…"
  mkcert -cert-file "$CERT" -key-file "$KEY" "$IP" localhost 127.0.0.1 >/dev/null
fi

# the phone downloads the root CA from this server rather than being emailed it;
# serve.py reads it from mkcert's own directory, so nothing is copied into the project.
# It comes over *plain HTTP* on the next port up: the phone does not trust the
# certificate yet, and neither iOS nor Android will accept one across a connection it
# distrusts -- on iOS the profile download is dropped in silence.
URL="https://$IP:$PORT/learn-m.html"
# the laptop's own page, on the LAN address rather than localhost: the share panel
# builds the phone's link from the address the laptop page is open on, and a room
# lives in this one server process, so both ends have to be on this address
LEARNURL="https://$IP:$PORT/learn.html"
CAPORT=$((PORT + 1))
CAURL="http://$IP:$CAPORT/rootCA.pem"

qr() {
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ANSIUTF8 -m "${2:-2}" "$1"
  elif python3 -c 'import qrcode' >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import sys, qrcode
q = qrcode.QRCode(border=2)
q.add_data(sys.argv[1])
q.print_ascii(invert=True)
PY
  else
    return 1
  fi
}

# ---------------------------------------------------------------- 3. what to do
echo
bold "  ┌──────────────────────────────────────────────────────────────┐"
bold "  │  On the phone — Android, in Chrome:                          │"
bold "  │                                                              │"
printf '\033[1m  │      %-56s│\033[0m\n' "$URL"
bold "  └──────────────────────────────────────────────────────────────┘"
echo

qr "$URL" || dim "  (no QR: brew install qrencode to get one to scan instead of typing)"
dim "  (iPhone: not this one, and not this script — Ctrl-C and run ./serve.sh)"

echo
bold "  Once per phone — trust the certificate"
echo "     It has to come over plain http: the phone does not trust this laptop yet,"
echo "     so an https download of the certificate is refused (silently, on iOS)."
echo
printf '\033[1m       %s\033[0m\n' "$CAURL"
echo
CAQR="$(qr "http://$IP:$CAPORT/" 1 2>/dev/null || true)"
if [ -n "$CAQR" ]; then
  printf '%s\n' "$CAQR"
  dim  "     (that page has the file and these steps on it)"
  echo
fi
bold "     Android — in Chrome"
echo "       1. open the http address above; the file downloads"
echo "       2. leave Chrome. In the SYSTEM Settings app, search “certificate” →"
echo "          Install a certificate → CA certificate → Install anyway →"
echo "          pick rootCA.pem from Downloads"
echo "       3. check it took: Settings → search “trusted credentials” → User"
echo
bold "     iPhone — in Safari, not Chrome"
echo "       (Chrome on iOS cannot hand a profile to the system; Safari can)"
echo "       1. open the http address above in Safari → Allow the profile download"
echo "       2. Settings → General → VPN & Device Management → mkcert → Install"
echo "          (asks for the passcode)"
echo "       3. Settings → General → About → Certificate Trust Settings →"
echo "          switch mkcert on"
echo "       Both 2 and 3 are required — step 3 is the one everybody forgets."
dim  "     (or AirDrop the file straight from $CAROOT/rootCA.pem)"
echo
bold "  Every time"
echo "     • phone and laptop on the same Wi-Fi"
echo "     • Android — the piano plugs into the phone, by USB OTG or Bluetooth MIDI"
echo "       (Bluetooth needs a helper app to make the connection, e.g. MIDI BLE Connect)"
echo "       open the https address at the top; the first tap asks for MIDI permission"
echo "     • iPhone — you do not need this script. There is no Web MIDI on iOS, so the"
echo "       piano stays on the laptop and the phone just mirrors it, and a mirror"
echo "       needs no certificate: Ctrl-C, run ./serve.sh, open its localhost learn"
echo "       page, press “Put it on the phone” and scan THAT QR — it carries the room"
echo "       id and a plain http address. The phone then reads “showing the laptop”."
printf '       (if you are already here, that same QR works from %s)\n' "$LEARNURL"
echo "     • tap ⛶ for full screen, or Add to Home screen once for no browser bar at all"
echo
dim  "  Serving every interface: https on $PORT, the certificate over http on $CAPORT."
dim  "  Trusted Wi-Fi only. Ctrl-C stops both."
echo

exec python3 serve.py "$PORT" 0.0.0.0 "$CERT" "$KEY" "$CAROOT/rootCA.pem"
