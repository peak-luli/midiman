#!/usr/bin/env bash
# Assemble the public site into dist/ (or the directory given as $1).
#
#     scripts/site.sh            # -> dist/
#     scripts/site.sh /tmp/out   # -> /tmp/out
#
# There is no build step: the files the browser loads are the files in this repo.
# But the repo also holds things the internet has no business serving -- docs/ is the
# company wiki, design/ the canvases, test/ and serve.py the laptop's own tooling --
# so what gets published is an explicit list, not the working tree. Everything the
# pages reference is here (test/site.test.mjs checks that against sw.js and the HTML).
#
# What the copy does NOT carry is serve.py, so a published site has no phone relay,
# no Feedback endpoint and no composer save: all three fail softly in the pages
# ("This server has no phone relay", "the laptop answered 404") -- see README,
# "Publishing".
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"

rm -rf "$OUT"
mkdir -p "$OUT"

# the pages and their sheets
cp index.html looper.html learn.html learn-m.html composer.html guitar.html "$OUT"/
cp style.css looper.css learn.css learn-m.css composer.css guitar.css "$OUT"/
# the installable phone app
cp manifest.webmanifest sw.js "$OUT"/
# the data
cp tracks.json "$OUT"/
# the modules, the songs, the vendored notation engine, the icons
cp -R src songs vendor icons "$OUT"/

# what a walk through the tree would otherwise carry along
find "$OUT" -name '.DS_Store' -delete
echo "site assembled in $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
