#!/bin/sh
# Build one declarative KWin package. All imported JS gets a content-hashed path:
# KWin caches imported scripts until logout, even after unloading the package.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dist="$root/script/dist"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
{
# Give the unchanged UMD core a local export object, independent of QML's global
# object. Its factories refer to the lexical Weave variable while bundling.
printf 'function createCore() {\nvar Weave = {};\n(function () {\n'
cat \
    "$root/core/geometry.js" \
    "$root/core/tree.js" \
    "$root/core/snap.js" \
    "$root/core/stage.js" \
    "$root/core/scroll.js" \
    "$root/core/arrangement.js" \
    "$root/core/context.js" \
    "$root/core/persist.js" \
    "$root/core/index.js"
printf '\n}).call({Weave: Weave});\nreturn Weave;\n}\n'
printf '\nvar WEAVE_TEMPLATES = %s;\n' "$(cat "$root/core/templates.json")"
cat "$root/script/src/adapter.js"
printf '\nfunction start(host) { return startWeave(host, createCore(), WEAVE_TEMPLATES); }\n'
} > "$tmp"
hash=$({ cat "$tmp" "$root/script/src/host.js" "$root/script/metadata.json" \
    "$root/script/build.sh" "$root/script/contents/ui/"* \
    "$root/script/contents/config/"*; } | sha256sum | cut -c1-8)
rm -rf "$dist"
mkdir -p "$dist/contents/ui/lib-$hash"
cp -r "$root/script/contents/config" "$dist/contents/config"
cp -r "$root/script/contents/ui/." "$dist/contents/ui/"
ui="$dist/contents/ui"
sed "s/@@BUILD_ID@@/$hash/g" "$tmp" > "$ui/lib-$hash/weave.js"
cp "$root/script/src/host.js" "$ui/lib-$hash/host.js"
mv "$ui/layouts.js" "$ui/lib-$hash/layouts.js"
for name in Weave Picker; do
    sed "s/@@BUILD_ID@@/$hash/g" "$root/script/contents/ui/$name.qml" > "$ui/$name.qml"
done
cp "$root/script/metadata.json" "$dist/metadata.json"
printf '%s\n' "$hash" > "$dist/BUILD_ID"
printf 'weave build %s\n' "$hash"
