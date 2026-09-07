#!/usr/bin/env python3
"""One-shot: POST #78 AC stills to uploads.github.com (same path as serve.py)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

REPO = "peak-luli/midiman"
PR = 80
SHOTS = Path("docs/shots/78-staff-drag-loop")
FILES = [
    "ac4_before_whole_song_bars_1_16.png",
    "ac2_click_cursor_only_loop_unchanged.png",
    "ac5_live_highlight_early_bars.png",
    "ac5_live_highlight_bars_4_9.png",
    "ac1_ac4_after_loop_bars_4_9.png",
    "ac3_before_verse_bars_5_12.png",
    "ac3_after_shrunk_bars_6_9.png",
]


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def gh_get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "midiman-rehost-pr80",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def upload(token: str, png: bytes, name: str, repo_id: int) -> str:
    url = (
        "https://uploads.github.com/user-attachments/assets"
        f"?name={quote(name, safe='._-')}&content_type=image%2Fpng&repository_id={repo_id}"
    )
    req = urllib.request.Request(
        url,
        data=png,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "image/png",
            "User-Agent": "midiman-rehost-pr80",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read() or b"null")
    href = None
    if isinstance(body, dict):
        href = body.get("url") or body.get("href")
        asset = body.get("asset")
        if not href and isinstance(asset, dict):
            href = asset.get("url") or asset.get("href")
    if not isinstance(href, str) or "user-attachments/assets" not in href:
        die(f"upload {name}: no user-attachments url in {body!r}")
    return href.split("?")[0]


def main() -> None:
    token = os.environ.get("MIDIMAN_GITHUB_TOKEN") or ""
    if not token:
        die("MIDIMAN_GITHUB_TOKEN secret is empty")
    try:
        info = gh_get(f"/repos/{REPO}", token)
    except urllib.error.HTTPError as e:
        die(f"GET /repos/{REPO} HTTP {e.code} {e.read()[:200]!r}")
    repo_id = int(info["id"])
    print(f"repo_id {repo_id}")

    urls = []
    for name in FILES:
        path = SHOTS / name
        if not path.is_file():
            die(f"missing {path}")
        png = path.read_bytes()
        if png[:4] != b"\x89PNG":
            die(f"not a png: {path}")
        try:
            href = upload(token, png, name, repo_id)
        except urllib.error.HTTPError as e:
            die(f"upload {name} HTTP {e.code} {e.read()[:300]!r}")
        print(f"{name} {href}")
        urls.append((name, href))

    lines = ["REHOST_URLS"] + [f"{n} {u}" for n, u in urls]
    block = "\n".join(lines) + "\n"
    Path("/tmp/rehost-pr80-urls.txt").write_text(block)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        Path(summary).write_text(
            "## PR #80 user-attachments\n\n"
            + "\n".join(f"- `{n}` — {u}" for n, u in urls)
            + "\n"
        )

    comment = (
        "<!-- midiman-rehost-pr80 -->\n"
        "Rehosted #78 AC stills to GitHub user-attachments.\n\n"
        "```\n"
        + block
        + "```\n"
    )
    subprocess.check_call(
        [
            "gh",
            "api",
            "--method",
            "POST",
            f"repos/{REPO}/issues/{PR}/comments",
            "-f",
            f"body={comment}",
        ]
    )
    print("commented PR", PR)


if __name__ == "__main__":
    main()
