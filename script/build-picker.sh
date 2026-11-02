#!/bin/sh
# Builds the layout picker package into script/dist-picker/. Install with
#   kpackagetool6 --type=KWin/Script -i script/dist-picker
# The JS data file goes into contents/ui/lib-<hash>/ so that an in-place update (-u) plus
# toggling the script picks up new data: KWin's QML engine keeps imported JS files cached
# by path until logout.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
src="$root/script/picker"
dist="$root/script/dist-picker"
hash=$(cat "$src/metadata.json" "$src"/contents/ui/* | sha256sum | cut -c1-8)
rm -rf "$dist"
mkdir -p "$dist"
cp -r "$src/contents" "$src/metadata.json" "$dist/"
ui="$dist/contents/ui"
mkdir "$ui/lib-$hash"
mv "$ui/layouts.js" "$ui/lib-$hash/layouts.js"
grep -q '^import "layouts.js"' "$ui/Picker.qml" \
    || { echo "build-picker.sh: Picker.qml doesn't import \"layouts.js\"" >&2; exit 1; }
sed -i "s#^import \"layouts.js\"#import \"lib-$hash/layouts.js\"#" "$ui/Picker.qml"
printf '%s\n' "$hash" > "$dist/BUILD_ID"
printf 'weave-picker build %s\n' "$hash"
