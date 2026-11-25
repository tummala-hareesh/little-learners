#!/usr/bin/env bash
# Assemble the public site — exactly what GitHub Pages serves — into OUT.
#   tools/build-site.sh [OUT]      (default: _site in the repo root)
# Copies the git-tracked files of index.html, apps/ and hub/ (if present) and adds .nojekyll so Pages
# serves files as-is. Untracked or ignored files (drafts, .DS_Store, recordings) are never published,
# and symlinks are refused (a link could publish files from outside the site).
# This file is the single source of truth for what gets published (tests/site mirrors it in ALLOWED_TOP).
# No build step: the site is the same static files you open locally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1-$ROOT/_site}"
SITE_PATHS=(index.html apps hub)

[[ -n "$OUT" ]] || { echo "build-site: output path is empty" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
case "$OUT" in
  /|"$ROOT"|"$HOME") echo "build-site: refusing to build into $OUT" >&2; exit 1;;
esac
# Only ever clear an empty folder or a previous build (marked by .nojekyll), never anything else.
if [[ -n "$(ls -A "$OUT")" && ! -f "$OUT/.nojekyll" ]]; then
  echo "build-site: $OUT is not empty and isn't a previous build; refusing to clear it" >&2
  exit 1
fi

mapfile -d '' FILES < <(git -C "$ROOT" ls-files -z -- "${SITE_PATHS[@]}")
[[ ${#FILES[@]} -gt 0 ]] || { echo "build-site: no tracked site files under $ROOT" >&2; exit 1; }
for f in "${FILES[@]}"; do
  if [[ -L "$ROOT/$f" ]]; then echo "build-site: symlinks are not allowed in the site: $f" >&2; exit 1; fi
done

rm -rf "${OUT:?}"/* "${OUT:?}"/.nojekyll
for f in "${FILES[@]}"; do
  [[ -f "$ROOT/$f" ]] || continue   # tracked but deleted in the working tree
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$ROOT/$f" "$OUT/$f"
done
touch "$OUT/.nojekyll"
echo "built site in $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
