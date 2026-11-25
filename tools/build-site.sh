#!/usr/bin/env bash
# Assemble the public site — exactly what GitHub Pages serves — into OUT.
#   tools/build-site.sh [OUT]      (default: _site in the repo root)
# Copies index.html, apps/ and hub/ (if present) and adds .nojekyll so Pages serves files as-is.
# No build step: the site is the same static files you open locally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1-$ROOT/_site}"

[[ -n "$OUT" ]] || { echo "build-site: output path is empty" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
case "$OUT" in
  /|"$ROOT"|"$HOME") echo "build-site: refusing to build into $OUT" >&2; exit 1;;
esac

rm -rf "${OUT:?}"/* "${OUT:?}"/.nojekyll
cp "$ROOT/index.html" "$OUT/"
cp -R "$ROOT/apps" "$OUT/apps"
[[ -d "$ROOT/hub" ]] && cp -R "$ROOT/hub" "$OUT/hub"
touch "$OUT/.nojekyll"
echo "built site in $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
