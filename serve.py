#!/usr/bin/env python3
"""The dev server behind serve.sh and phone.sh. Python's stdlib only, like the rest.

`python3 -m http.server` would nearly do, but not quite. It has no TLS switch, and
it does not know what a .webmanifest is -- Chrome refuses a manifest served as
application/octet-stream, so the phone page would never be installable. It also has
no way for two browsers to talk to each other, which remote mode needs (see below).

    python3 serve.py PORT [BIND] [CERT KEY [CAFILE]]

CAFILE is served at /rootCA.pem, so the phone can fetch the certificate authority
it has to trust straight from the address bar. It is read from wherever mkcert
keeps it rather than copied into the project, so there is nothing to clean up.

That download cannot happen over this server's own HTTPS, though: the phone does not
trust the certificate yet -- that is the whole point of fetching it -- and neither
iOS nor Android will take a certificate or a configuration profile across a
connection it distrusts. Safari's "visit this website anyway" covers pages only; a
profile handed over a bad connection is dropped without a word. So when TLS is on,
a second listener goes up on PORT+1 over plain HTTP, serving nothing but the CA and
a one-paragraph page pointing at it.
"""
import base64
import http.client
import http.server
import json
import os
import queue
import secrets
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, urlparse, urlsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
BIND = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
CERT, KEY = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else (None, None)
CAFILE = sys.argv[5] if len(sys.argv) > 5 else None


# ---------------------------------------------------------------- the relay
# Remote mode: iOS has no Web MIDI, so on an iPhone the laptop keeps the piano and
# runs the whole engine, and the phone on the music stand is a live mirror of it.
# The two need a channel, and this server is the only thing they both already talk to.
#
# It is deliberately the smallest thing that works. http.server cannot do WebSockets
# and this project has no dependencies, so: server-sent events one way (a GET that
# never finishes) and ordinary POSTs the other. That asymmetry is the right shape
# anyway -- the laptop broadcasts a stream of events, the phone sends the occasional
# command.
#
# What crosses the wire is *events*, never frames and never ticks: one state snapshot
# per change, one message per hit or miss, and the phone runs its own clock from the
# snapshot's anchor. A room is a handful of messages a second at worst.
#
# The last snapshot per room is kept so a phone that connects late is up to date
# immediately. Only the snapshot is kept, not a log of the marks -- replaying old
# hits onto a fresh screen would paint colours for playing that has already scrolled
# past. Rooms live in memory and die with the process, which is what "the laptop is
# on and near the piano" already implies.

RELAY_QUEUE = 256          # events buffered per subscriber before it is declared stuck
RELAY_PING = 15.0          # seconds between keep-alive comments

_rooms = {}                # id -> { "subs": [Sub], "state": event or None }
_rooms_lock = threading.Lock()

# ---------------------------------------------------------------- the room id
# The room belongs to the *machine*, not to a browser tab.
#
# It used to be minted in the page and kept in localStorage, which is per origin --
# so the Learn page opened on http://localhost:8765 and the same page on
# http://192.168.1.5:8765 were two different rooms on one server, and clearing the
# site data was a third. The phone's link, and more to the point the phone installed
# on the Home screen with `?room=` frozen into it, then pointed at a room the laptop
# had quietly stopped publishing into: a detached app, still connected, showing a
# lesson that never moves again.
#
# So the server mints it, once, into a file beside the development certificate --
# certs/ is git-ignored, so the id is this laptop's and is never shared -- and every
# origin, every restart and every cleared browser gets the same answer from
# /relay/info. Six characters from an alphabet with no vowels in it, so a room never
# spells anything and can be read aloud off the screen.

ROOM_ABC = "23456789bcdfghjkmnpqrstvwxz"
ROOM_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs", "room")


def _room_id():
    """This machine's room: whatever is in certs/room, else a fresh one written there."""
    try:
        with open(ROOM_FILE) as f:
            rid = f.read().strip()
        if rid and rid.isalnum() and len(rid) <= 32:
            return rid
    except OSError:
        pass
    rid = "".join(secrets.choice(ROOM_ABC) for _ in range(6))
    try:
        os.makedirs(os.path.dirname(ROOM_FILE), exist_ok=True)
        with open(ROOM_FILE, "w") as f:
            f.write(rid + "\n")
    except OSError:
        pass                # a read-only checkout: the id still holds for this run
    return rid


ROOM = _room_id()


# ---------------------------------------------------------------- the feedback inbox
# The Learn page has a Feedback control on it, laptop and phone, and this is where its
# notes go: one comment on a standing GitHub issue labelled `feedback`, with whatever
# was on screen attached -- the context fields, and a PNG of the music when the page
# managed to take one (see src/learn/feedback.js). The PNG is uploaded to GitHub's
# user-attachments host, not committed: a shot is not a file in this repository.
#
# It lives on the server for one reason: the token. A GitHub credential in a page is a
# credential on the phone, in the QR, in the browser history and one screenshot away
# from a repository -- so the page posts to this laptop, which is already the thing it
# trusts with the piano, and the laptop does the talking. The token is read from the
# environment and never written anywhere.
#
#     cp .env.example .env   # then put the token in .env (gitignored)
#     ./serve.sh             # loads .env; already-exported shell vars win
#
# Running this file directly skips the shell loader — use ./serve.sh or ./phone.sh.

#
# With no token set, the endpoint still answers -- 202 and a reason -- so the pianist
# gets one grey line rather than a broken button, and the server says once, in the log,
# how to set it. That is the whole failure story: no queue, no retry, no disk. A note
# that did not reach GitHub is a note that was not important enough to interrupt the
# lesson for, and a queue that drains days later into an issue nobody is reading is
# worse than nothing.
#
# After a comment lands, an optional POST can wake a Grok Bot routine so Miriam is
# pinged without watching the issue. Same .env, same rule: a dead webhook is a log
# line, never a failed Send.

TOKEN_ENV = "MIDIMAN_GITHUB_TOKEN"
GH_API = os.environ.get("MIDIMAN_GITHUB_API", "https://api.github.com").rstrip("/")
# User-attachments host: the same place the web UI and `gh issue comment --attach`
# put a PNG. Not the Contents API -- a shot must not become a commit on main.
GH_UPLOAD = os.environ.get("MIDIMAN_GITHUB_UPLOAD", "https://uploads.github.com").rstrip("/")
GH_REPO = os.environ.get("MIDIMAN_FEEDBACK_REPO", "peak-luli/midiman")
GH_ISSUE = os.environ.get("MIDIMAN_FEEDBACK_ISSUE", "10")
GH_LABEL = os.environ.get("MIDIMAN_FEEDBACK_LABEL", "feedback")
GH_TIMEOUT = 8.0
GH_UPLOAD_TIMEOUT = 12.0
SHOT_MAX = 2_000_000              # decoded PNG; matches src/learn/feedback.js
BODY_MAX = 3_000_000              # the JSON POST, base64 overhead included

# Optional ping after a comment lands, so Miriam hears about it without refreshing #10.
# Grok Bot's routine trigger is POST + Authorization: Bearer <sender key>. URL unset
# means do nothing, which is how every laptop already behaves. A webhook that is
# down, slow or angry must not fail the note — the pianist already got "sent".
WEBHOOK_URL_ENV = "MIDIMAN_FEEDBACK_WEBHOOK_URL"
WEBHOOK_KEY_ENV = "MIDIMAN_FEEDBACK_WEBHOOK_KEY"
WEBHOOK_HEADER_ENV = "MIDIMAN_FEEDBACK_WEBHOOK_HEADER"
WEBHOOK_TIMEOUT = 4.0

CHIPS = {"well": "👍 Went well", "friction": "⚠️ Friction"}
NOTE_MAX = 200

_issue_no = None                  # the standing issue, once we have found or made it
_repo_id = None                   # numeric id, needed by the attachments host
_issue_lock = threading.Lock()
_said_no_token = False


def _one_line(v, limit=200):
    """A field from the page, made safe to drop into markdown: one line, and short."""
    if v is None or v is False:
        return None
    return " ".join(str(v).split())[:limit] or None


def comment_body(payload, image_url=None):
    """The comment, as it reads on the issue. Pure: the tests drive it through here."""
    ctx = payload.get("context") or {}
    if not isinstance(ctx, dict):
        ctx = {}
    device = _one_line(ctx.get("device")) or "laptop"
    if ctx.get("mirroring"):
        device += " (mirroring the laptop)"
    song = _one_line(ctx.get("songTitle")) or "no song"
    song_id = _one_line(ctx.get("songId"))
    practice = "Free practice" if ctx.get("practice") == "free" else "Tutor"
    step, no, count = _one_line(ctx.get("step")), ctx.get("stepNo"), ctx.get("stepCount")
    if step and no and count:
        practice += f" · step {no} of {count} · “{step}”"
    elif step:
        practice += f" · “{step}”"
    where = " · ".join(x for x in [_one_line(ctx.get("section")),
                                   f"bars {_one_line(ctx.get('bars'))}" if ctx.get("bars") else None] if x)

    lines = [f"### {CHIPS.get(payload.get('chip'), payload.get('chip'))} — {device}"]
    note = _one_line(payload.get("note"), NOTE_MAX)
    if note:
        lines += ["", f"> {note}"]
    lines += [""]
    rows = [
        ("Song", f"{song}" + (f" (`{song_id}`)" if song_id else "")),
        ("Mode", practice),
        ("Where", where or None),
        ("How it was going", _one_line(ctx.get("success"))),
        ("Tempo", f"{_one_line(ctx.get('bpm'))} bpm" if ctx.get("bpm") else None),
        ("View", _one_line(ctx.get("view"))),
        ("Sent", _one_line(payload.get("at"))),
    ]
    lines += [f"- **{k}** — {v}" for k, v in rows if v]
    href = _safe_asset_url(image_url)
    if href:
        lines += ["", f"![Learn]({href})"]
    return "\n".join(lines)


def _safe_asset_url(href):
    """Only GitHub attachment hosts. A stub that returns javascript: must not render."""
    if not isinstance(href, str) or not href:
        return None
    try:
        u = urlparse(href)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if u.scheme != "https":
        return None
    if host == "github.com" or host.endswith(".github.com") or host.endswith(".githubusercontent.com"):
        return href
    return None


def _shot_bytes(payload):
    """Optional PNG on the payload. Anything that is not one is ignored, not rejected."""
    img = payload.get("image") if isinstance(payload, dict) else None
    if not isinstance(img, dict) or img.get("mime") != "image/png":
        return None
    data = img.get("data")
    if not isinstance(data, str) or not data:
        return None
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return None
    if len(raw) < 8 or len(raw) > SHOT_MAX:
        return None
    if raw[:4] != b"\x89PNG":
        return None
    return raw


def _repo_numeric_id(token):
    """uploads.github.com wants the numeric repository id, not owner/name."""
    global _repo_id
    if _repo_id:
        return _repo_id
    info = _gh(f"/repos/{GH_REPO}", token)
    _repo_id = int(info["id"])
    return _repo_id


def _upload_shot(token, png, name="learn.png"):
    """
    POST the PNG to GitHub's user-attachments host. Returns an https URL, or raises.
    The caller treats any failure as "no shot" and still writes the text comment.
    """
    rid = _repo_numeric_id(token)
    url = (f"{GH_UPLOAD}/user-attachments/assets"
           f"?name={quote(name, safe='._-')}&content_type=image%2Fpng&repository_id={rid}")
    req = urllib.request.Request(
        url,
        data=png,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "image/png",
            "User-Agent": "middleman-serve",
        },
    )
    with urllib.request.urlopen(req, timeout=GH_UPLOAD_TIMEOUT) as r:
        body = json.loads(r.read() or b"null")
    href = None
    if isinstance(body, dict):
        href = body.get("url") or body.get("href")
        asset = body.get("asset")
        if not href and isinstance(asset, dict):
            href = asset.get("url") or asset.get("href")
    href = _safe_asset_url(href)
    if not href:
        raise ValueError("upload host returned no usable url")
    return href


def _shot_name(payload):
    ctx = payload.get("context") if isinstance(payload, dict) else None
    device = "phone" if isinstance(ctx, dict) and ctx.get("device") == "phone" else "laptop"
    at = _one_line(payload.get("at") if isinstance(payload, dict) else None) or "shot"
    stamp = "".join(ch if ch.isalnum() else "" for ch in at)[:18] or "shot"
    return f"learn-{device}-{stamp}.png"


def _gh(path, token, data=None, method=None):
    """One GitHub call. Returns the parsed body, or raises -- callers catch everything."""
    req = urllib.request.Request(
        f"{GH_API}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        method=method or ("POST" if data is not None else "GET"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "middleman-serve",
        },
    )
    with urllib.request.urlopen(req, timeout=GH_TIMEOUT) as r:
        return json.loads(r.read() or b"null")


def _standing_issue(token):
    """
    The issue the notes land on. The configured one first -- there is a real inbox
    already open and everybody's links point at it -- then any open issue carrying the
    label, and only if there is none at all is one made. Found once and remembered:
    every note after the first is a single POST.
    """
    global _issue_no
    if _issue_no:
        return _issue_no
    if GH_ISSUE.strip().isdigit():
        _issue_no = int(GH_ISSUE.strip())
        return _issue_no
    found = _gh(f"/repos/{GH_REPO}/issues?state=open&labels={GH_LABEL}&per_page=1", token)
    if found:
        _issue_no = found[0]["number"]
        return _issue_no
    made = _gh(f"/repos/{GH_REPO}/issues", token, {
        "title": "Feedback inbox",
        "body": "Notes from the Feedback control on the Learn page land here, one comment each.",
        "labels": [GH_LABEL],
    })
    _issue_no = made["number"]
    return _issue_no


def post_feedback(payload):
    """
    Put one note on the issue. Returns `(ok, detail)` and never raises: the caller is
    an HTTP handler and the caller's caller is a pianist mid-loop.
    """
    global _said_no_token
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        if not _said_no_token:
            _said_no_token = True
            print(f"  feedback: no {TOKEN_ENV} set, so notes are not going anywhere.\n"
                  f"  Set it (a fine-grained token with issues:write on {GH_REPO}) and restart.",
                  file=sys.stderr)
        return False, "no GitHub token on the laptop"
    try:
        with _issue_lock:
            n = _standing_issue(token)
            image_url = None
            png = _shot_bytes(payload)
            if png:
                try:
                    image_url = _upload_shot(token, png, _shot_name(payload))
                except Exception:
                    # AC3: any upload miss — including IncompleteRead / BadStatusLine
                    # from a truncated PNG response — is a text comment, not a 500.
                    image_url = None
            made = _gh(f"/repos/{GH_REPO}/issues/{n}/comments", token,
                       {"body": comment_body(payload, image_url)})
        detail = {"issue": n, "url": made.get("html_url")}
        if image_url:
            detail["shot"] = True
    except urllib.error.HTTPError as e:
        return False, f"GitHub answered {e.code}"
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
        return False, "GitHub could not be reached"
    except (ValueError, KeyError, TypeError) as e:
        return False, f"GitHub said something unexpected ({type(e).__name__})"
    _notify_feedback(payload, detail)
    return True, detail


def _jsonable(v, depth=0):
    """What a webhook can carry: JSON types only, and not a dump of the process."""
    if depth > 4:
        return None
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int) and not isinstance(v, bool):
        return v
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None
    if isinstance(v, str):
        return v[:500]
    if isinstance(v, dict):
        out = {}
        for i, (k, val) in enumerate(v.items()):
            if i >= 32:
                break
            if isinstance(k, str):
                out[k] = _jsonable(val, depth + 1)
        return out
    if isinstance(v, (list, tuple)):
        return [_jsonable(x, depth + 1) for x in v[:32]]
    return None


def _webhook_authorization():
    """
    Grok Bot's trigger card copies `Authorization: Bearer <sender key>`. The key
    env is that sender key; HEADER, if set, is the whole Authorization value and
    wins, including a pasted `Authorization: …` line.
    """
    raw = os.environ.get(WEBHOOK_HEADER_ENV, "").strip()
    if raw:
        if raw.lower().startswith("authorization:"):
            raw = raw.split(":", 1)[1].strip()
        return raw or None
    key = os.environ.get(WEBHOOK_KEY_ENV, "").strip()
    return f"Bearer {key}" if key else None


def _notify_feedback(payload, detail):
    """
    One POST to the configured routine, then forget it. Never raises: a webhook
    miss is not a missed note, and the page has already been told ok.
    """
    dest = os.environ.get(WEBHOOK_URL_ENV, "").strip()
    if not dest:
        return
    try:
        ctx = payload.get("context")
        ctx = _jsonable(ctx) if isinstance(ctx, dict) else {}
        note = payload.get("note") if isinstance(payload.get("note"), str) else ""
        at = payload.get("at")
        if not isinstance(at, str) or not at.strip():
            at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        body = {
            "chip": payload.get("chip"),
            "note": note,
            "context": ctx,
            "issue": detail.get("issue"),
            "url": detail.get("url"),
            "at": at,
        }
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "middleman-serve",
        }
        auth = _webhook_authorization()
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(
            dest,
            data=json.dumps(body, separators=(",", ":")).encode(),
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=WEBHOOK_TIMEOUT) as r:
            r.read()
    except Exception as e:
        # one line, no URL, no key: enough to see it failed, nothing to leak
        print(f"  feedback: webhook did not accept the ping ({type(e).__name__})",
              file=sys.stderr)


def valid_feedback(payload):
    """The contract with the page: a known chip, and a note that is one short line."""
    if not isinstance(payload, dict) or payload.get("chip") not in CHIPS:
        return False
    note = payload.get("note", "")
    return isinstance(note, str) and len(note) <= NOTE_MAX * 2


class Sub:
    """One subscriber's mailbox. `cid` lets a sender skip its own messages."""

    def __init__(self, cid):
        self.cid = cid
        self.q = queue.Queue(maxsize=RELAY_QUEUE)


def _room(rid):
    with _rooms_lock:
        return _rooms.setdefault(rid, {"subs": [], "state": None})


def _publish(rid, event, sender=None):
    """Fan one event out to a room, and keep it if it is the state snapshot."""
    room = _room(rid)
    line = json.dumps(event, separators=(",", ":"))
    with _rooms_lock:
        if event.get("type") == "state":
            room["state"] = line
        subs = list(room["subs"])
    for s in subs:
        if s.cid and s.cid == sender:
            continue
        try:
            s.q.put_nowait(line)
        except queue.Full:
            pass       # a subscriber that cannot keep up is dropped, not waited for


def _addrs():
    """This machine's own IPv4 addresses, the one the phone should use first.

    The laptop's share panel builds the phone's link from this: the page itself is
    usually open on localhost, and "localhost" on the phone is the phone. Loopback is
    dropped -- an address that cannot leave the laptop is exactly the bug this fixes.

    The default-route address comes first because a laptop can have several (Wi-Fi,
    a docking station, a VM bridge) and only one of them is the network the phone is
    on. Connecting a UDP socket sends nothing; it only asks the routing table which
    interface a packet to the outside world would leave by. The hostname lookup after
    it is the fallback for the odd setup where that answers nothing. Neither may
    raise: a laptop with the Wi-Fi off still has to serve the page.
    """
    out = []

    def add(a):
        if a and a not in out and not a.startswith("127.") and a != "0.0.0.0":
            out.append(a)

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        add(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass
    return out


def _send_ca(h):
    """Hand over mkcert's root certificate, shaped so a phone recognises it."""
    try:
        with open(CAFILE, "rb") as f:
            body = f.read()
    except OSError:
        h.send_error(404)
        return
    h.send_response(200)
    # a content type Android's certificate installer and iOS's profile installer
    # both recognise, and a filename, so it lands as rootCA.pem, not "download"
    h.send_header("Content-Type", "application/x-x509-ca-cert")
    h.send_header("Content-Disposition", 'attachment; filename="rootCA.pem"')
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
    }

    # ------------------------------------------------------------ helpers
    def _json(self, obj, code=200):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _query(self):
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        return u.path, {k: v[0] for k, v in q.items()}

    # ------------------------------------------------------------ GET
    def do_GET(self):
        path, q = self._query()
        if path == "/relay/time":
            # a monotonic clock, in milliseconds, for the NTP-style round trips in
            # src/learn/sync.js. Both ends measure against this one, so neither has to
            # know anything about the other's performance.now() origin.
            return self._json({"t": time.monotonic() * 1000})
        if path == "/relay/info":
            # who this process is, so the share panel can build a link the phone can
            # reach. It has to be *this* process: rooms live in memory, so a phone
            # sent to some other server on the LAN would join an empty room.
            #
            # `room` is the one both ends pair on. Answering it here is what lets a
            # phone that was installed on the Home screen months ago, with a room
            # frozen into its URL, find the room the laptop is actually in.
            return self._json({"port": PORT, "tls": bool(CERT), "bind": BIND,
                               "addrs": _addrs(), "room": ROOM})
        if path == "/relay/events":
            return self._events(q.get("room", ""), q.get("client", ""))
        if CAFILE and path == "/rootCA.pem":
            return _send_ca(self)
        super().do_GET()

    def _events(self, rid, cid):
        """One subscriber's stream. It never returns until the socket goes away."""
        if not rid:
            return self._json({"error": "room required"}, 400)
        room = _room(rid)
        sub = Sub(cid)
        with _rooms_lock:
            room["subs"].append(sub)
            snapshot = room["state"]
            others = len(room["subs"])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(b'data: {"type":"open"}\n\n')
            if snapshot:
                self.wfile.write(b"data: " + snapshot.encode() + b"\n\n")
            # tell whoever is already here that someone arrived, so the host can send a
            # snapshot with a fresh anchor rather than leaving the newcomer on a stale one
            _publish(rid, {"type": "join", "client": cid, "subs": others}, sender=cid)
            while True:
                try:
                    line = sub.q.get(timeout=RELAY_PING)
                    self.wfile.write(b"data: " + line.encode() + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")     # keeps proxies and phones from hanging up
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass                                        # the page navigated away or the Wi-Fi blinked
        finally:
            with _rooms_lock:
                if sub in room["subs"]:
                    room["subs"].remove(sub)
                left = len(room["subs"])
            _publish(rid, {"type": "leave", "client": cid, "subs": left})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path, q = self._query()
        if path == "/feedback":
            return self._feedback()
        if path != "/relay/send":
            return self._json({"error": "not found"}, 404)
        rid = q.get("room", "")
        if not rid:
            return self._json({"error": "room required"}, 400)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            event = json.loads(self.rfile.read(n) or b"null")
        except (ValueError, TypeError):
            return self._json({"error": "bad json"}, 400)
        if not isinstance(event, dict):
            return self._json({"error": "expected an object"}, 400)
        _publish(rid, event, sender=q.get("client") or event.get("from"))
        with _rooms_lock:
            subs = len(_rooms.get(rid, {}).get("subs", []))
        return self._json({"ok": True, "subs": subs})

    def _feedback(self):
        """
        One note from the Learn page onto the standing issue.

        Two codes and they mean different things. 400 is the page sending something
        that is not a note -- a bug here, and worth failing loudly. 202 is a note that
        arrived and did not reach GitHub: no token, no internet, an API that said no.
        That one is not an error at this end and the page shows it as a grey line,
        because a pianist mid-loop cannot do anything about it either way.
        """
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > BODY_MAX:
                return self._json({"ok": False, "reason": "too large"}, 400)
            payload = json.loads(self.rfile.read(n) or b"null")
        except (ValueError, TypeError):
            return self._json({"ok": False, "reason": "bad json"}, 400)
        if not valid_feedback(payload):
            return self._json({"ok": False, "reason": "expected a chip and a note"}, 400)
        ok, detail = post_feedback(payload)
        if ok:
            out = {"ok": True, "issue": detail["issue"], "url": detail["url"]}
            if detail.get("shot"):
                out["shot"] = True
            return self._json(out)
        return self._json({"ok": False, "reason": detail}, 202)

    def end_headers(self):
        # the pages are edited and reloaded all day; a cached module is a wasted hour
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # the relay is chatty by design: one line per command would bury everything else
        if self.path.startswith("/relay/"):
            return
        super().log_message(fmt, *args)


# ------------------------------------------------------- the certificate window
# Plain HTTP, PORT+1, and it serves two things: the certificate, and a page saying
# what the certificate is for. Everything else is a 404 -- this listener exists to
# solve one chicken-and-egg problem and should not become a second way into the app.

CA_PAGE = """<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Trust this laptop</title>
<style>
 body{{font:16px/1.55 -apple-system,system-ui,sans-serif;margin:0;padding:28px 22px;
      max-width:34em;color:#1b1b1f;background:#fbfbfd}}
 h1{{font-size:1.35rem;margin:0 0 .6em}} h2{{font-size:1rem;margin:1.8em 0 .4em}}
 a.btn{{display:block;text-align:center;background:#2a5bd7;color:#fff;
        text-decoration:none;padding:14px;border-radius:11px;font-weight:600;margin:1.2em 0}}
 ol{{padding-left:1.2em}} li{{margin:.35em 0}}
 p.after{{margin-top:2em;border-top:1px solid #e2e2e8;padding-top:1.2em}}
 code{{background:#ececf2;padding:1px 5px;border-radius:4px}}
</style>
<h1>Trust this laptop</h1>
<p>The app needs HTTPS to reach the piano, and this laptop signs its own certificate.
Install the certificate below once and the phone will stop complaining.
This page is plain HTTP on purpose — the phone cannot download a certificate over a
connection it does not trust yet.</p>
<a class=btn href="/rootCA.pem" download="rootCA.pem">Download rootCA.pem</a>
<h2>iPhone (Safari — Chrome cannot do this)</h2>
<ol><li>Tap <b>Allow</b> when it offers the profile.</li>
<li>Settings → General → <b>VPN &amp; Device Management</b> → mkcert → <b>Install</b>.</li>
<li>Settings → General → About → <b>Certificate Trust Settings</b> → switch mkcert on.</li></ol>
<p>Both steps are needed — the second one is the one everybody forgets.</p>
<h2>Android (Chrome)</h2>
<ol><li>The file lands in Downloads.</li>
<li>Open the <b>Settings app</b>, search <code>certificate</code>, choose
<b>Install a certificate</b> → <b>CA certificate</b> → <b>Install anyway</b>.</li>
<li>Pick <code>rootCA.pem</code> from Downloads.</li></ol>
<p class=after>Then come back to the app:<br>
<a href="{app}">{app}</a></p>
"""


class CAHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/rootCA.pem":
            return _send_ca(self)
        if path == "/":
            host = (self.headers.get("Host") or f"{BIND}:{PORT + 1}").rsplit(":", 1)[0]
            body = CA_PAGE.format(app=f"https://{host}:{PORT}/learn-m.html").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


srv = http.server.ThreadingHTTPServer((BIND, PORT), Handler)
srv.daemon_threads = True
ca_srv = None
if CERT:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    if CAFILE:
        ca_srv = http.server.ThreadingHTTPServer((BIND, PORT + 1), CAHandler)
        ca_srv.daemon_threads = True
        threading.Thread(target=ca_srv.serve_forever, daemon=True).start()
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    srv.server_close()
    if ca_srv:
        ca_srv.shutdown()
        ca_srv.server_close()
