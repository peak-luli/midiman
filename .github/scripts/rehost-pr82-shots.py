#!/usr/bin/env python3
"""Upload PR #82 AC stills to GitHub user-attachments (same path as serve.py).

Uses secrets.MIDIMAN_GITHUB_TOKEN (user PAT). Cloud ghs_ / stale injected PAT
cannot POST to uploads.github.com. The same PAT must upload and publish the
URLs in a rendered markdown comment, or anonymous GETs 404.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

REPO = "peak-luli/midiman"
PR = 82
API = "https://api.github.com"
UPLOAD = "https://uploads.github.com"
SHOT_DIR = Path("docs/shots/river-flows-in-you")
SHOTS = [
    ("ac1-laptop-song-list-open.png", "AC1 — Learn list + River Flows in You open (laptop 1280×800)"),
    ("ac2-laptop-free-practice-guide.png", "AC2 — Free practice, 48 bpm, Guide on, bars 1–8"),
    ("ac3-laptop-opening-staff.png", "AC3 — Opening staff, A minor, 6/8, LH arpeggio + RH melody"),
    ("ac4-phone-path.png", "AC4 — Phone Learn path, River Flows in You, 31 steps"),
    ("ac4-phone-staff-portrait.png", "AC4 — Phone Staff, River Flows in You bars 1–8"),
]


def gh(path: str, token: str, data=None, method=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        method=method or ("POST" if data is not None else "GET"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "midiman-rehost-pr82",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def upload_png(token: str, repo_id: int, png: bytes, name: str) -> str:
    url = (
        f"{UPLOAD}/user-attachments/assets"
        f"?name={quote(name, safe='._-')}"
        f"&content_type=image%2Fpng"
        f"&repository_id={repo_id}"
    )
    req = urllib.request.Request(
        url,
        data=png,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "image/png",
            "User-Agent": "midiman-rehost-pr82",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        body = json.loads(r.read() or b"null")
    href = None
    if isinstance(body, dict):
        href = body.get("url") or body.get("href")
        asset = body.get("asset")
        if not href and isinstance(asset, dict):
            href = asset.get("url") or asset.get("href")
    if not isinstance(href, str) or "user-attachments/assets" not in href:
        raise SystemExit(f"upload returned no user-attachments url: {body!r}")
    return href


def main() -> int:
    token = (os.environ.get("MIDIMAN_GITHUB_TOKEN") or "").strip()
    if not token:
        print("MIDIMAN_GITHUB_TOKEN unset", file=sys.stderr)
        return 2
    if token.startswith("ghs_"):
        print("MIDIMAN_GITHUB_TOKEN is an App token; user-attachments will 404", file=sys.stderr)
        return 2

    try:
        me = gh("/user", token)
        repo = gh(f"/repos/{REPO}", token)
    except urllib.error.HTTPError as e:
        print(f"auth/repo failed: {e.code} {e.read()[:300]!r}", file=sys.stderr)
        return 1
    repo_id = int(repo["id"])
    print(f"uploader={me.get('login')} repo_id={repo_id}")

    urls = []
    for name, alt in SHOTS:
        path = SHOT_DIR / name
        if not path.is_file():
            print(f"missing {path}", file=sys.stderr)
            return 1
        png = path.read_bytes()
        if png[:4] != b"\x89PNG":
            print(f"not a png: {path}", file=sys.stderr)
            return 1
        href = upload_png(token, repo_id, png, name)
        print(f"uploaded {name} -> {href}")
        urls.append((name, alt, href))

    lines = [
        "<!-- midiman-rehost-pr82-images -->",
        "Packaging AC stills for #81 / PR #82 as public `user-attachments` (rendered):",
        "",
    ]
    for _name, alt, href in urls:
        lines += [f"![{alt}]({href})", ""]
    lines += [
        "```",
        "REHOST_URLS",
        *[f"{name} {href}" for name, _alt, href in urls],
        "```",
    ]
    gh(f"/repos/{REPO}/issues/{PR}/comments", token, {"body": "\n".join(lines)})
    print("commented on PR", PR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
