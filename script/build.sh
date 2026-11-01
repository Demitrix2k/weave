#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target="$root/script/contents/code/main.js"
mkdir -p "$(dirname -- "$target")"
cat \
    "$root/core/geometry.js" \
    "$root/core/tree.js" \
    "$root/core/snap.js" \
    "$root/core/stage.js" \
    "$root/core/arrangement.js" \
    "$root/core/context.js" \
    "$root/core/index.js" \
    "$root/script/src/adapter.js" > "$target"
