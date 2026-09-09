#!/usr/bin/env bash
# Bump the build version everywhere it appears, in one command.
#
# The version lives in four places that must agree, or a release ships
# half-stale: the two ?v= query strings in index.html (which seed the whole
# module graph), BUILD in js/version.js (shown in the UI), and VERSION in
# sw.js (which names the cache generation).
#
# Usage:  tools/release.sh            -> stamps today's date + next suffix
#         tools/release.sh 2026.09.10-1
set -euo pipefail
cd "$(dirname "$0")/.."

current=$(sed -n "s/^export const BUILD = '\(.*\)';$/\1/p" js/version.js)

if [ $# -ge 1 ]; then
  next="$1"
else
  today=$(date -u +%Y.%m.%d)
  if [[ "$current" == "$today"-* ]]; then
    next="$today-$(( ${current##*-} + 1 ))"
  else
    next="$today-1"
  fi
fi

echo "  $current  ->  $next"

sed -i "s|css/app\.css?v=[^\"]*|css/app.css?v=$next|" index.html
sed -i "s|js/app\.js?v=[^\"]*|js/app.js?v=$next|" index.html
sed -i "s|^export const BUILD = '.*';$|export const BUILD = '$next';|" js/version.js
sed -i "s|^const VERSION = 'lumen-.*';$|const VERSION = 'lumen-$next';|" sw.js

# Fail loudly rather than shipping a version mismatch.
found=$(grep -oh "$next" index.html js/version.js sw.js | wc -l)
if [ "$found" -ne 4 ]; then
  echo "ERROR: expected 4 stamps, found $found — check the files by hand" >&2
  exit 1
fi
echo "  stamped 4/4"
