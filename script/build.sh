#!/bin/sh
# Builds the installable package into script/dist/. The code goes to
# contents/code/main.js (KWin ignores X-Plasma-MainScript and kpackagetool6
# insists on that path). The content hash is injected as BUILD_ID, which the
# adapter prints at startup ("weave loaded build=<hash8>"), so the journal shows
# which build KWin actually runs.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dist="$root/script/dist"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
{
cat \
    "$root/core/geometry.js" \
    "$root/core/tree.js" \
    "$root/core/snap.js" \
    "$root/core/stage.js" \
    "$root/core/arrangement.js" \
    "$root/core/context.js" \
    "$root/core/persist.js" \
    "$root/core/index.js"
# The adapter cannot read files, so the arrangement templates are inlined as data.
printf '\nvar WEAVE_TEMPLATES = %s;\n' "$(cat "$root/core/templates.json")"
cat "$root/script/src/adapter.js"
} > "$tmp"
if command -v sha256sum >/dev/null 2>&1; then
    hash=$(sha256sum "$tmp" | cut -c1-8)
else
    hash=$(date +%Y%m%d%H%M%S)
fi
rm -rf "$dist"
mkdir -p "$dist/contents/code"
cp -r "$root/script/contents/config" "$dist/contents/config"
sed "s/@@BUILD_ID@@/$hash/" "$tmp" > "$dist/contents/code/main.js"
cp "$root/script/metadata.json" "$dist/metadata.json"
printf '%s\n' "$hash" > "$dist/BUILD_ID"
printf 'weave build %s\n' "$hash"
