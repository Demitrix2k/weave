#!/bin/sh
# Install the Weave state helper for the current user (no root, no systemd).
# Usage: helper/install.sh [--dry-run]
set -eu

dry=0
case "${1:-}" in
    "") ;;
    --dry-run) dry=1 ;;
    *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin_dir="$HOME/.local/bin"
services_dir="${XDG_DATA_HOME:-$HOME/.local/share}/dbus-1/services"
helper="$bin_dir/weave-state"
service="$services_dir/org.weave.State.service"

run() {
    if [ "$dry" -eq 1 ]; then
        echo "would run: $*"
    else
        "$@"
    fi
}

run mkdir -p "$bin_dir" "$services_dir"
run install -m 755 "$here/weave-state" "$helper"
if [ "$dry" -eq 1 ]; then
    echo "would write: $service (Exec=$helper)"
else
    sed "s|@HELPER@|$helper|" "$here/org.weave.State.service" > "$service"
fi
echo "The session bus picks the service file up for new activations; no restart needed."
