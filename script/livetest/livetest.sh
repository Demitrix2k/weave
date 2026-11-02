#!/bin/sh
# Uses the same core geometry, tree, and snap code as build.sh for expectations.
# Only kcalc windows are selected, moved, or terminated by this harness.
#
# Usage: livetest.sh [--dry-run] [--json] [--takeover]
# A live Weave setup (installed package, weaveEnabled, [Script-weave] keys or a loaded
# script) is never touched without --takeover: the harness then exits 3 before it changes
# anything. With --takeover it snapshots that setup first and restores it at the end.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# The two overrides exist for the stub-based tests; the defaults are the real paths.
CONFIG=${WEAVE_LIVETEST_KWINRC:-${HOME}/.config/kwinrc}
SCRIPTS=${WEAVE_LIVETEST_SCRIPTS:-${HOME}/.local/share/kwin/scripts}
STATE_ROOT=${XDG_STATE_HOME:-${HOME}/.local/state}/weave-livetest
STATE_FILE=${XDG_STATE_HOME:-${HOME}/.local/state}/weave/state.json
JS_DIR=$ROOT/script/livetest/js
DRY_RUN=false
JSON=false
TAKEOVER=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --json) JSON=true ;;
        --takeover) TAKEOVER=true ;;
        *) printf 'Usage: %s [--dry-run] [--json] [--takeover]\n' "$0"; exit 2 ;;
    esac
done

# The only [Script-weave] keys this harness ever writes or deletes (without --takeover
# the section is empty at the start, so they are its own; with --takeover the whole
# section is saved first).
HARNESS_KEYS="manageClasses settleSeconds logLevel defaultMode tileClasses defaultLayout gapInner gapOuter"
MODIFIED=false
PKG_TOUCHED=false
ENABLED_TOUCHED=false
KEYS_TOUCHED=false
LIVE_FOUND=false
LIVE_LOADED=false
LIVE_REPORT=
SNAP_TMP=
SNAP_KEEP=
RESTORE_FAILED=false
RESTORE_NOTES=

say() { printf '%s\n' "$*"; }
run() {
    if [ "$DRY_RUN" = true ]; then say "DRY-RUN: $*"; return 0; fi
    output=$("$@" 2>&1) || { say "$output"; return 1; }
    case "$output" in
        *NoReply*|*"Remote peer disconnected"*) say "$output"; return 1 ;;
    esac
    [ -z "$output" ] || say "$output"
}

# Every kwriteconfig6 call of the harness goes through kw_set or kw_del.
kw_set() { run kwriteconfig6 --file "$CONFIG" --group "$1" --key "$2" "$3"; }
kw_del() { run kwriteconfig6 --file "$CONFIG" --group "$1" --key "$2" --delete; }
harness_key() {
    for known in $HARNESS_KEYS; do [ "$known" = "$1" ] && return 0; done
    say "BUG: the harness may not touch the Script-weave key $1"
    return 1
}
cfg_set() { harness_key "$1" || return 1; KEYS_TOUCHED=true; kw_set Script-weave "$1" "$2"; }
cfg_del() { harness_key "$1" || return 1; kw_del Script-weave "$1"; }
cfg_enabled_set() { ENABLED_TOUCHED=true; kw_set Plugins weaveEnabled "$1"; }
cfg_enabled_del() { kw_del Plugins weaveEnabled; }

# Package installs: -u when a package is already there (only possible with --takeover).
install_pkg() {
    PKG_TOUCHED=true
    if [ -e "$SCRIPTS/weave" ]; then
        run kpackagetool6 --type=KWin/Script -u "$1"
    else
        run kpackagetool6 --type=KWin/Script -i "$1"
    fi
}

# Lines of the [Script-weave] section of kwinrc (no header, no blank lines).
section_lines() {
    [ -f "$CONFIG" ] || return 0
    awk '/^\[/ { sec = ($0 == "[Script-weave]"); next } sec && NF { print }' "$CONFIG"
}
plugins_value() {
    [ -f "$CONFIG" ] || return 0
    awk '/^\[/ { sec = ($0 == "[Plugins]"); next }
        sec && index($0, "weaveEnabled=") == 1 { print substr($0, 14); exit }' "$CONFIG"
}

# Read-only detection of a live Weave setup. Sets LIVE_FOUND and LIVE_REPORT.
detect_live() {
    LIVE_FOUND=false
    LIVE_REPORT=
    ENABLED_PRESENT=no
    ENABLED_VALUE=
    if [ -e "$SCRIPTS/weave" ] || [ -L "$SCRIPTS/weave" ]; then
        LIVE_FOUND=true
        LIVE_REPORT="$LIVE_REPORT  - installed package: $SCRIPTS/weave
"
    fi
    value=$(kreadconfig6 --file "$CONFIG" --group Plugins --key weaveEnabled \
        --default __weave_absent__ 2>/dev/null || true)
    if [ -z "$value" ] || [ "$value" = __weave_absent__ ]; then value=$(plugins_value); fi
    if [ -n "$value" ] && [ "$value" != __weave_absent__ ]; then
        LIVE_FOUND=true
        ENABLED_PRESENT=yes
        ENABLED_VALUE=$value
        LIVE_REPORT="$LIVE_REPORT  - [Plugins] weaveEnabled=$value in $CONFIG
"
    fi
    keys=$(section_lines | grep -c '=' || true)
    if [ "${keys:-0}" -gt 0 ]; then
        LIVE_FOUND=true
        names=$(section_lines | sed -n 's/=.*//p' | tr '\n' ' ')
        LIVE_REPORT="$LIVE_REPORT  - [Script-weave] has $keys key(s): $names
"
    fi
    loaded=$(qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.isScriptLoaded weave \
        2>/dev/null || true)
    if [ "$loaded" = true ]; then
        LIVE_FOUND=true
        LIVE_LOADED=true
        LIVE_REPORT="$LIVE_REPORT  - the script 'weave' is loaded in KWin
"
    fi
}

# Copies the live setup into a mktemp directory and into the state directory, before any
# change. Anything that fails here stops the run with nothing modified.
snapshot_live() {
    SNAP_TMP=$(mktemp -d)
    SNAP_KEEP=$STATE_ROOT/restore-$(date +%Y%m%dT%H%M%S)-$$
    (umask 077; mkdir -p "$SNAP_KEEP") || return 1
    if [ -e "$SCRIPTS/weave" ]; then
        mkdir "$SNAP_TMP/package" && cp -a "$SCRIPTS/weave/." "$SNAP_TMP/package/" || return 1
        [ ! -L "$SCRIPTS/weave" ] || readlink "$SCRIPTS/weave" > "$SNAP_TMP/package.link"
        : > "$SNAP_TMP/package.present"
    fi
    section_lines > "$SNAP_TMP/script-weave.lines" || return 1
    printf '%s\n' "$ENABLED_PRESENT" > "$SNAP_TMP/weaveEnabled.present"
    printf '%s\n' "$ENABLED_VALUE" > "$SNAP_TMP/weaveEnabled.value"
    printf '%s\n' "$LIVE_LOADED" > "$SNAP_TMP/loaded"
    [ ! -f "$CONFIG" ] || cp -p "$CONFIG" "$SNAP_TMP/kwinrc.before" || return 1
    [ ! -f "$STATE_FILE" ] || cp -p "$STATE_FILE" "$SNAP_TMP/state.json.file" || return 1
    if state_text=$(qdbus6 org.weave.State /State org.weave.State.Get 2>/dev/null); then
        printf '%s' "$state_text" > "$SNAP_TMP/state.text"
    fi
    cp -a "$SNAP_TMP/." "$SNAP_KEEP/" || return 1
    diff -r "$SNAP_TMP" "$SNAP_KEEP" >/dev/null || return 1
    say "Live Weave setup saved to $SNAP_KEEP"
}

restore_fail() { say "RESTORE STEP FAILED: $*"; RESTORE_FAILED=true; }

# Puts back exactly what snapshot_live saved. Every step runs even if one fails.
restore_live() {
    snap=$SNAP_TMP
    [ -d "$snap" ] || snap=$SNAP_KEEP
    qdbus6 org.kde.KWin /Scripting unloadScript weave >/dev/null 2>&1
    cfg_enabled_set false || restore_fail "disable the throwaway script"
    qdbus6 org.kde.KWin /KWin reconfigure
    qdbus6 org.kde.KWin /Scripting unloadScript weave
    if [ "$PKG_TOUCHED" = true ]; then
        run kpackagetool6 --type=KWin/Script -r weave || restore_fail "remove throwaway package"
    fi
    if [ -f "$snap/package.present" ]; then
        install_pkg "$snap/package" || restore_fail "reinstall the saved package"
        RESTORE_NOTES="$RESTORE_NOTES package"
    fi
    for key in $HARNESS_KEYS; do
        cfg_del "$key" || restore_fail "delete the harness key $key"
    done
    count=$(grep -c '=' "$snap/script-weave.lines" || true)
    index=1
    while [ "$index" -le "${count:-0}" ]; do
        line=$(grep '=' "$snap/script-weave.lines" | sed -n "${index}p")
        key=${line%%=*}
        value=${line#*=}
        kw_set Script-weave "$key" "$value" || restore_fail "write back the key $key"
        index=$((index + 1))
    done
    RESTORE_NOTES="$RESTORE_NOTES ${count:-0}-config-keys"
    if [ "$(cat "$snap/weaveEnabled.present")" = yes ]; then
        kw_set Plugins weaveEnabled "$(cat "$snap/weaveEnabled.value")" \
            || restore_fail "restore weaveEnabled"
    else
        cfg_enabled_del || restore_fail "delete weaveEnabled again"
    fi
    qdbus6 org.kde.KWin /KWin reconfigure
    if [ -f "$snap/state.text" ]; then
        qdbus6 org.weave.State /State org.weave.State.Set "$(cat "$snap/state.text")" \
            || restore_fail "restore the persistent state"
        RESTORE_NOTES="$RESTORE_NOTES state"
    fi
    if [ "$(cat "$snap/loaded")" = true ]; then
        qdbus6 org.kde.KWin /Scripting start || restore_fail "start the script again"
        RESTORE_NOTES="$RESTORE_NOTES script-restarted"
    fi
    # Check the result against the snapshot.
    now=$(section_lines | grep '=' | sort)
    was=$(grep '=' "$snap/script-weave.lines" | sort)
    [ "$now" = "$was" ] || restore_fail "[Script-weave] differs from the snapshot"
    if [ -f "$snap/package.present" ]; then
        diff -r "$snap/package" "$SCRIPTS/weave" >/dev/null \
            || restore_fail "the package differs from the snapshot"
    elif [ -e "$SCRIPTS/weave" ]; then
        restore_fail "a package is installed that was not there before"
    fi
    if [ "$(plugins_value)" != "$(cat "$snap/weaveEnabled.value")" ]; then
        restore_fail "weaveEnabled differs from the snapshot"
    fi
}

restore_failure_message() {
    say "################################################################"
    say "LIVE WEAVE SETUP NOT FULLY RESTORED."
    say "The saved snapshot is kept in: $SNAP_KEEP"
    [ ! -d "$SNAP_TMP" ] || say "A second copy is kept in: $SNAP_TMP"
    say "Manual restore (the kwin scripts folder is $SCRIPTS):"
    say "  1. qdbus6 org.kde.KWin /Scripting unloadScript weave"
    say "  2. kpackagetool6 --type=KWin/Script -r weave"
    say "  3. kpackagetool6 --type=KWin/Script -i $SNAP_KEEP/package"
    say "  4. rewrite every line of $SNAP_KEEP/script-weave.lines into the"
    say "     [Script-weave] section of $CONFIG (kwriteconfig6, or copy kwinrc.before)"
    say "  5. set [Plugins] weaveEnabled as in weaveEnabled.present / .value"
    say "  6. qdbus6 org.kde.KWin /KWin reconfigure"
    say "  7. qdbus6 org.weave.State /State org.weave.State.Set \"\$(cat $SNAP_KEEP/state.text)\""
    say "  8. qdbus6 org.kde.KWin /Scripting start"
    say "################################################################"
}

# Removes only what this run added when there was no live setup.
uninstall_throwaway() {
    if [ "$ENABLED_TOUCHED" = true ]; then cfg_enabled_set false; fi
    qdbus6 org.kde.KWin /KWin reconfigure
    # Disabling does not unload a running script; a loaded one stays stale.
    qdbus6 org.kde.KWin /Scripting unloadScript weave
    if [ "$PKG_TOUCHED" = true ]; then run kpackagetool6 --type=KWin/Script -r weave; fi
    if [ "$ENABLED_TOUCHED" = true ]; then cfg_enabled_del; fi
    if [ "$KEYS_TOUCHED" = true ]; then
        for key in $HARNESS_KEYS; do cfg_del "$key"; done
    fi
    qdbus6 org.kde.KWin /KWin reconfigure
}

cleanup() {
    result=$?
    trap - EXIT INT TERM
    set +e
    if [ "$DRY_RUN" != true ]; then
        for pid in ${KCALC_PIDS-}; do
            kill "$pid" 2>/dev/null
        done
        for pid in ${KCALC_PIDS-}; do wait "$pid" 2>/dev/null; done
        if [ "$MODIFIED" = true ]; then
            if [ "$LIVE_FOUND" = true ]; then restore_live; else uninstall_throwaway; fi
        fi
        printf 'Remaining kcalc PIDs: '
        pgrep -x kcalc || true
        config_count=$(grep -ic weave "$CONFIG" 2>/dev/null || true)
        script_count=$(find "$SCRIPTS" -maxdepth 2 -iname '*weave*' -print \
            2>/dev/null | wc -l | tr -d ' ')
        say "Leftover weave lines in kwinrc: $config_count"
        say "Installed weave scripts: $script_count"
        if [ "$LIVE_FOUND" != true ]; then
            say "Live install: none found"
        elif [ "$MODIFIED" != true ]; then
            say "Live install: untouched (the run stopped before any change)"
        elif [ "$RESTORE_FAILED" = true ]; then
            say "Live install: RESTORE FAILED"
            restore_failure_message
            [ "$result" -ne 0 ] || result=4
        else
            say "Live install: restored ($RESTORE_NOTES; snapshot kept in $SNAP_KEEP)"
        fi
    else
        say "DRY-RUN: cleanup removes only recorded kcalc PIDs and harness settings."
    fi
    [ -z "${TMP_DIR-}" ] || rm -rf "$TMP_DIR"
    if [ -n "${SNAP_TMP-}" ] && [ "$RESTORE_FAILED" != true ]; then rm -rf "$SNAP_TMP"; fi
    exit "$result"
}

if [ "$DRY_RUN" = true ]; then
    say "Dry run: no commands will be executed."
    say "DRY-RUN: detect a live Weave (no changes): package in the scripts folder,"
    say "DRY-RUN: [Plugins] weaveEnabled, [Script-weave] keys in kwinrc, isScriptLoaded weave"
    say "DRY-RUN: live Weave found and no --takeover: print what was found, exit 3, no change"
    say "DRY-RUN: --takeover: snapshot the package, [Script-weave] lines, weaveEnabled,"
    say "DRY-RUN: loaded flag and org.weave.State.Get into a mktemp dir and into"
    say "DRY-RUN: $STATE_ROOT/restore-<timestamp>/"
    run sh "$ROOT/script/build.sh"
    say "DRY-RUN: kpackagetool6 --type=KWin/Script -i script/dist (-u when a package exists)"
    say "DRY-RUN: kwriteconfig6 Plugins weaveEnabled true"
    RESOURCE_CLASS=$(sed -n 's/^var KCALC_RESOURCE_CLASS = "\([^"]*\)";.*/\1/p' \
        "$JS_DIR/expected.js")
    say "DRY-RUN: kwriteconfig6 Script-weave manageClasses $RESOURCE_CLASS"
    say "DRY-RUN: kwriteconfig6 Script-weave settleSeconds 0"
    say "DRY-RUN: kwriteconfig6 Script-weave logLevel debug"
    say "DRY-RUN: kwriteconfig6 Script-weave gapInner 8 (and gapOuter 8; the checks assume 8 px gaps)"
    say "DRY-RUN: qdbus6 org.kde.KWin /KWin reconfigure"
    say "DRY-RUN: pgrep -x kcalc"
    say "DRY-RUN: mktemp -d"
    say "DRY-RUN: cat core sources and expected.js > <tmp>/check-prefix.js"
    say "DRY-RUN: kcalc (three launches; record each PID)"
    say "DRY-RUN: poll dump.js with journalctl --user --since <timestamp> -o cat"
    say "DRY-RUN: load send-kcalc.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: load check-s1.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: load send-first-right.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: load check-s2.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: select-last-dp.js; invoke Toggle Float; invoke Snap Left Half"
    say "DRY-RUN: load probe-s3-snap.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: invoke Toggle Float; load check-s3.js; run; wait; unload"
    say "DRY-RUN: send-kcalc-right.js; load check-s4.js; run; wait; unload"
    say "DRY-RUN: send-kcalc.js; float first; dump its float size; retile; move to HDMI-A-1"
    say "DRY-RUN: invoke Toggle Float; load check-s5.js; run; wait; unload"
    say "DRY-RUN: invoke Toggle Float; send-kcalc.js; select-master.js; invoke Dock Left"
    say "DRY-RUN: load check-s6.js; run /Scripting/Script<ID>; wait; unload"
    say "DRY-RUN: invoke Weave Layout Master; order-s7.js prints the window ids"
    say "DRY-RUN: invoke Weave Layout Columns/Monocle/Spiral/Master; check-s7a..d.js"
    say "DRY-RUN: activate-live.js x3 (known order); invoke Weave Arrange Next; check-s8a.js"
    say "DRY-RUN: move-s8.js; invoke Weave Arrange Reapply; check-s8b.js"
    say "DRY-RUN: invoke Weave Arrange Release; check-s8c.js"
    say "DRY-RUN: invoke Weave Layout Master; order-s7.js; activate-live.js x1 (index 0)"
    say "DRY-RUN: invoke Weave Layout Stage; check-s9a.js (focus and rail cells)"
    say "DRY-RUN: activate-live.js (index 2); check-s9b.js (promoted, others stay)"
    say "DRY-RUN: invoke Weave Stage Cycle Next; check-s9c.js"
    say "DRY-RUN: invoke Weave Layout Master; check-s9d.js (stage order, master rects)"
    say "DRY-RUN: invoke Weave Layout Master; order-s7.js; activate-live.js; invoke Weave Promote;"
    say "DRY-RUN: check-s10a.js (stack window becomes master)"
    say "DRY-RUN: activate-live.js; invoke Weave Move Down; check-s10b.js (swap with neighbour)"
    say "DRY-RUN: activate-live.js; invoke Weave Resize Grow Width / Shrink Width;"
    say "DRY-RUN: check-s10c.js and check-s10d.js (master edge moves by the step and back)"
    say "DRY-RUN: invoke Weave Master More / Master Fewer; check-s10e.js and check-s10f.js"
    say "DRY-RUN: invoke Weave Float All twice; check-s10g.js (floated), check-s10h.js (tiled)"
    say "DRY-RUN: S11: stop own kcalc, set defaultMode=float tileClasses= (empty), restart script"
    say "DRY-RUN: three new kcalc; dump rects; journal counts of weave geometry/managed lines"
    say "DRY-RUN: check-s11a.js (not moved); select-first-kcalc.js; invoke Weave Snap Left Half;"
    say "DRY-RUN: check-s11b.js; invoke Weave Toggle Float; check-s11c.js (tiled, fills);"
    say "DRY-RUN: invoke Weave Toggle Float; check-s11d.js (previous rect restored)"
    say "DRY-RUN: S12: place-s12.js puts two floating kcalc windows side by side (third apart)"
    say "DRY-RUN: activate-live.js; invoke Weave Resize Grow Width / Shrink Width;"
    say "DRY-RUN: check-s12a.js and check-s12b.js (shared edge moves, neighbour follows, and back)"
    say "DRY-RUN: invoke Weave Resize Grow; check-s12c.js; invoke Weave Resize Fill; check-s12d.js"
    say "DRY-RUN: S13: stop own kcalc, drop defaultMode/tileClasses, restart script, four new kcalc on DP-1"
    say "DRY-RUN: for rows, hstack, rmaster, grid, ultrawide: invoke Weave Layout <Name>; wait to settle;"
    say "DRY-RUN: with WEAVE_LIVETEST_SHOTS=<dir>: spectacle -b -n -f -o <dir>/live-<layout>.png (wait up to 5 s for the file)"
    say "DRY-RUN: check-s13.js (S13a..S13e) prints the four frame rects and asserts the layout shape"
    say "DRY-RUN: journalctl result parsing, summary table, optional JSON array"
    say "DRY-RUN: kill <recorded PID> and wait <recorded PID> for each launch"
    say "DRY-RUN: without a live install: disable/remove Weave, delete the harness keys"
    say "DRY-RUN: with --takeover: unload and remove the throwaway, reinstall the saved package,"
    say "DRY-RUN: delete the harness keys, rewrite the saved [Script-weave] lines, restore"
    say "DRY-RUN: weaveEnabled, reconfigure, org.weave.State.Set <saved>, Scripting start"
    say "DRY-RUN: report 'Live install: none found' or 'Live install: restored (...)'"
    say "DRY-RUN: pgrep -x kcalc; grep kwinrc; find installed scripts; rm -rf <tmp>"
    exit 0
fi

# --- live run ---
detect_live
if [ "$LIVE_FOUND" = true ] && [ "$TAKEOVER" != true ]; then
    say "Refusing to run: a live Weave setup was found and this harness would replace it."
    say "Found:"
    printf '%s' "$LIVE_REPORT"
    say "Nothing was changed. Close nothing, or re-run with --takeover to save this setup"
    say "first and put it back when the run ends (snapshot under $STATE_ROOT)."
    exit 3
fi
if pgrep -x kcalc >/dev/null 2>&1; then
    say "Refusing to run: kcalc is already running. Close it and retry."
    exit 2
fi
TMP_DIR=$(mktemp -d)
KCALC_PIDS=
trap cleanup EXIT
trap 'exit 1' INT TERM
if [ "$LIVE_FOUND" = true ]; then
    say "Takeover: live Weave setup found:"
    printf '%s' "$LIVE_REPORT"
    snapshot_live || { say "FAIL: could not save the live setup; nothing was changed"; exit 1; }
fi
RESOURCE_CLASS=$(sed -n 's/^var KCALC_RESOURCE_CLASS = "\([^"]*\)";.*/\1/p' \
    "$JS_DIR/expected.js")
cat "$ROOT/core/geometry.js" "$ROOT/core/tree.js" "$ROOT/core/snap.js" \
    "$ROOT/core/stage.js" "$ROOT/core/arrangement.js" "$ROOT/core/context.js" \
    "$ROOT/core/index.js" "$JS_DIR/expected.js" \
    > "$TMP_DIR/check-prefix.js"
printf '\nvar WEAVE_LIVE_TEMPLATES = ' >> "$TMP_DIR/check-prefix.js"
cat "$ROOT/core/templates.json" >> "$TMP_DIR/check-prefix.js"
printf ';\n' >> "$TMP_DIR/check-prefix.js"

run sh "$ROOT/script/build.sh"
MODIFIED=true
qdbus6 org.kde.KWin /Scripting unloadScript weave >/dev/null 2>&1 || true
BUILD_ID=$(cat "$ROOT/script/dist/BUILD_ID")
BUILD_TS=$(date --iso-8601=seconds)
install_pkg "$ROOT/script/dist"
cfg_enabled_set true
cfg_set manageClasses "$RESOURCE_CLASS"
cfg_set settleSeconds 0
cfg_set logLevel debug
cfg_set gapInner 8
cfg_set gapOuter 8
# A saved real section (--takeover) must not leak: the checks assume tiling arrivals and the master layout.
cfg_del defaultMode
cfg_del tileClasses
cfg_del defaultLayout
run qdbus6 org.kde.KWin /KWin reconfigure
# Config-enabled scripts are loaded on reconfigure but only run after start.
run qdbus6 org.kde.KWin /Scripting start

# KWin may keep running an older main file; prove the fresh build is loaded.
build_try=0
build_seen=false
while [ "$build_try" -lt 20 ]; do
    if journalctl --user --since "$BUILD_TS" -o cat 2>/dev/null \
            | grep -qF "weave loaded build=$BUILD_ID"; then
        build_seen=true
        break
    fi
    sleep 0.5
    build_try=$((build_try + 1))
done
if [ "$build_seen" != true ]; then
    say "FAIL: stale script: 'weave loaded build=$BUILD_ID' not in the journal"
    exit 1
fi
say "Build $BUILD_ID is loaded."

kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"

load_and_run() {
    script_path=$1
    script_name=$2
    scenario=${3-}
    timestamp=$(date --iso-8601=seconds)
    output=$(qdbus6 org.kde.KWin /Scripting loadScript "$script_path" "$script_name" 2>&1) || {
        say "$output"; return 1;
    }
    case "$output" in *NoReply*|*"Remote peer disconnected"*) say "$output"; return 1 ;; esac
    script_id=$(printf '%s\n' "$output" | tail -n 1 | sed -n \
        's/^[[:space:]]*\([0-9][0-9]*\)[[:space:]]*$/\1/p')
    [ -n "$script_id" ] || { say "Could not parse script id: $output"; return 1; }
    # Script.run did not execute loaded scripts on KWin 6.8.0; start does.
    run qdbus6 org.kde.KWin /Scripting start
    attempt=0
    line=
    while [ "$attempt" -lt 10 ]; do
        journal=$(journalctl --user --since "$timestamp" -o cat 2>/dev/null || true)
        if [ -n "$scenario" ] && [ "$scenario" != SNAP ]; then
            line=$(printf '%s\n' "$journal" | rg -F "WEAVE_LIVE {\"scenario\":\"$scenario\"" \
                | tail -n 1 || true)
        elif [ "$scenario" = SNAP ]; then
            line=$(printf '%s\n' "$journal" | rg '^WEAVE_S3_SNAP ' | tail -n 1 || true)
        else
            line=$(printf '%s\n' "$journal" | rg '^WEAVE_LIVE_STEP ' | tail -n 1 || true)
        fi
        [ -n "$line" ] && break
        sleep 0.5
        attempt=$((attempt + 1))
    done
    if [ -n "$scenario" ] && [ "$scenario" != SNAP ]; then
        if [ -z "$line" ]; then
            line="WEAVE_LIVE {\"scenario\":\"$scenario\",\"status\":\"FAIL\","
            line="$line\"expected\":[],\"actual\":[]}"
        fi
        printf '%s\n' "$line" >> "$TMP_DIR/results"
        say "$line"
    elif [ "$scenario" = SNAP ]; then
        S3_SNAP_STATUS=$(printf '%s\n' "$line" | sed -n \
            's/^WEAVE_S3_SNAP \(PASS\|FAIL\)$/\1/p')
        [ -n "$S3_SNAP_STATUS" ] || S3_SNAP_STATUS=FAIL
    elif [ -z "$line" ]; then
        say "Timed out waiting for script result: $script_name"
        return 1
    fi
    LAST_STEP_LINE=$line
    # unloadScript prints true/false; that is not a result line
    qdbus6 org.kde.KWin /Scripting unloadScript "$script_name" >/dev/null 2>&1 || true
}

run_script() {
    source_file=$1
    name=$2
    scenario=$3
    if [ "$source_file" = check-s3.js ]; then
        [ "${S3_SNAP_STATUS-FAIL}" = PASS ] && snap_literal=true || snap_literal=false
        cat "$TMP_DIR/check-prefix.js" > "$TMP_DIR/$name.js"
        printf 'var priorSnapPassed = %s;\n' "$snap_literal" >> "$TMP_DIR/$name.js"
        cat "$JS_DIR/$source_file" >> "$TMP_DIR/$name.js"
    elif [ "$source_file" = check-s5.js ]; then
        printf 'var priorS5Size = {width:%s,height:%s};\n' \
            "${S5_WIDTH-0}" "${S5_HEIGHT-0}" > "$TMP_DIR/$name.js"
        cat "$TMP_DIR/check-prefix.js" >> "$TMP_DIR/$name.js"
        cat "$JS_DIR/$source_file" >> "$TMP_DIR/$name.js"
    else
        cat "$TMP_DIR/check-prefix.js" > "$TMP_DIR/$name.js"
        case "$source_file" in
            check-s7*|check-s8*|check-s9*|check-s10*|check-s11*|check-s12*|check-s13*|activate-live.js|move-s8.js)
                printf '%s\n' "$LIVE_PRE" >> "$TMP_DIR/$name.js" ;;
        esac
        cat "$JS_DIR/$source_file" >> "$TMP_DIR/$name.js"
    fi
    load_and_run "$TMP_DIR/$name.js" "$name" "$scenario"
}

wait_for_count() {
    want_count=$1
    attempt=0
    while [ "$attempt" -lt 40 ]; do
        timestamp=$(date --iso-8601=seconds)
        run_script dump.js weave-live-count ''
        journal=$(journalctl --user --since "$timestamp" -o cat 2>/dev/null || true)
        count=$(printf '%s\n' "$journal" | rg -c '^WEAVE_LIVE_WINDOW ' || true)
        [ "${count:-0}" -ge "$want_count" ] && return 0
        sleep 0.5
        attempt=$((attempt + 1))
    done
    say "Timed out waiting for $want_count kcalc windows."
    return 1
}
wait_for_three() { wait_for_count 3; }

# Moving a window between outputs is asynchronous in KWin, so repeat the
# idempotent send script until it reports no window left to move.
send_all() {
    send_file=$1
    send_name=$2
    send_try=0
    while [ "$send_try" -lt 4 ]; do
        LAST_STEP_LINE=
        run_script "$send_file" "$send_name" ''
        case "$LAST_STEP_LINE" in *"pending=0") return 0 ;; esac
        sleep 0.7
        send_try=$((send_try + 1))
    done
    say "Windows did not all reach the target output."
    return 0
}

snapshot_first_size() {
    timestamp=$(date --iso-8601=seconds)
    run_script dump.js weave-live-before-s5 ''
    journal=$(journalctl --user --since "$timestamp" -o cat 2>/dev/null || true)
    size=$(printf '%s\n' "$journal" | awk '$1 == "WEAVE_LIVE_WINDOW" \
        {print $7 "," $8; exit}')
    S5_WIDTH=${size%,*}
    S5_HEIGHT=${size#*,}
    [ -n "$S5_WIDTH" ] && [ -n "$S5_HEIGHT" ]
}

SCENARIOS="S1 S2 S3 S4 S5 S6 S7a S7b S7c S7d S8a S8b S8c S9a S9b S9c S9d"
SCENARIOS="$SCENARIOS S10a S10b S10c S10d S10e S10f S10g S10h S11a S11b S11c S11d"
SCENARIOS="$SCENARIOS S12a S12b S12c S12d S13a S13b S13c S13d S13e"

summary() {
    statuses=
    failures=0
    for scenario in $SCENARIOS; do
        line=$(rg -F "WEAVE_LIVE {\"scenario\":\"$scenario\"" \
            "$TMP_DIR/results" 2>/dev/null | tail -n 1 || true)
        status=$(printf '%s\n' "$line" | sed -n 's/.*"status":"\(PASS\|FAIL\)".*/\1/p')
        [ -n "$status" ] || status=FAIL
        [ "$status" = PASS ] || failures=$((failures + 1))
        statuses="$statuses $status"
    done
    say "Summary table"
    say "Scenario | Status"
    index=1
    for scenario in $SCENARIOS; do
        status=$(printf '%s\n' "$statuses" | cut -d' ' -f$((index + 1)))
        say "$scenario | $status"
        index=$((index + 1))
    done
    if [ "$JSON" = true ]; then
        node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8")
            .trim().split(/\n/).filter(Boolean).map(x=>JSON.parse(x.slice(11)));
            const keep={};rows.forEach(x=>{
                if(/^S[0-9]+[a-h]?$/.test(x.scenario))keep[x.scenario]=x;});
            process.stdout.write(JSON.stringify(Object.keys(keep).sort().map(k=>keep[k]))+"\n");' \
            "$TMP_DIR/results"
    fi
    [ "$failures" -eq 0 ]
}

wait_for_three
send_all send-kcalc.js weave-live-send-left
run_script check-s1.js weave-live-check-s1 S1
run_script send-first-right.js weave-live-move-one ''
run_script check-s2.js weave-live-check-s2 S2
run_script select-last-dp.js weave-live-select-s3 ''
invoke() { run qdbus6 org.kde.kglobalaccel /component/kwin \
    org.kde.kglobalaccel.Component.invokeShortcut "$1"; }
invoke "Weave Toggle Float"
invoke "Weave Snap Left Half"
run_script probe-s3-snap.js weave-live-probe-s3-snap SNAP
invoke "Weave Toggle Float"
run_script check-s3.js weave-live-check-s3 S3
send_all send-kcalc-right.js weave-live-send-right
run_script check-s4.js weave-live-check-s4 S4
send_all send-kcalc.js weave-live-send-left
run_script select-first-kcalc.js weave-live-select-s5-size ''
invoke "Weave Toggle Float"
snapshot_first_size
invoke "Weave Toggle Float"
run_script send-first-right.js weave-live-move-s5 ''
run_script select-first-kcalc.js weave-live-select-s5 ''
invoke "Weave Toggle Float"
run_script check-s5.js weave-live-check-s5 S5
invoke "Weave Toggle Float"
send_all send-kcalc.js weave-live-restore-left-s6
run_script select-master.js weave-live-select-s6 ''
invoke "Weave Dock Left"
run_script check-s6.js weave-live-check-s6 S6

# S7: layouts per context. Reset to master first so the window order is known.
LIVE_PRE=
invoke "Weave Layout Master"
sleep 1
LAST_STEP_LINE=
run_script order-s7.js weave-live-order-s7 ''
LIVE_IDS=${LAST_STEP_LINE#WEAVE_LIVE_STEP ids }
live_js=
for live_id in $LIVE_IDS; do
    [ -z "$live_js" ] && live_js="\"$live_id\"" || live_js="$live_js,\"$live_id\""
done
LIVE_PRE="var liveIds = [$live_js];"
say "S7/S8 window order (master layout): $LIVE_IDS"
invoke "Weave Layout Columns"
sleep 0.7
run_script check-s7a.js weave-live-check-s7a S7a
invoke "Weave Layout Monocle"
sleep 0.7
run_script check-s7b.js weave-live-check-s7b S7b
invoke "Weave Layout Spiral"
sleep 0.7
run_script check-s7c.js weave-live-check-s7c S7c
invoke "Weave Layout Master"
sleep 0.7
run_script check-s7d.js weave-live-check-s7d S7d

# S8: arrangements. Activation order is index 1, 2, 0 (the last one is active).
for activate_index in 1 2 0; do
    LIVE_PRE="var liveIds = [$live_js]; var activateIndex = $activate_index;"
    run_script activate-live.js weave-live-activate-s8-$activate_index ''
    sleep 0.3
done
LIVE_PRE="var liveIds = [$live_js];"
invoke "Weave Arrange Next"
sleep 0.7
run_script check-s8a.js weave-live-check-s8a S8a
run_script move-s8.js weave-live-move-s8 ''
sleep 1
run_script check-s8m.js weave-live-check-s8m S8m
case "$LAST_STEP_LINE" in
    *'"status":"PASS"'*) moved_ok=true ;;
    *) moved_ok=false ;;
esac
LIVE_PRE="var liveIds = [$live_js]; var movedOk = $moved_ok;"
invoke "Weave Arrange Reapply"
sleep 0.7
run_script check-s8b.js weave-live-check-s8b S8b
LIVE_PRE="var liveIds = [$live_js];"
invoke "Weave Arrange Release"
sleep 0.7
run_script check-s8c.js weave-live-check-s8c S8c

# S9: the Stage layout. The window order is taken again, because Release above
# rejoined the windows in its own order; the first window is made active so that
# it becomes the focus when Stage is entered.
LIVE_PRE=
invoke "Weave Layout Master"
sleep 1
LAST_STEP_LINE=
run_script order-s7.js weave-live-order-s9 ''
LIVE_IDS=${LAST_STEP_LINE#WEAVE_LIVE_STEP ids }
live_js=
for live_id in $LIVE_IDS; do
    [ -z "$live_js" ] && live_js="\"$live_id\"" || live_js="$live_js,\"$live_id\""
done
say "S9 window order (master layout): $LIVE_IDS"
LIVE_PRE="var liveIds = [$live_js]; var activateIndex = 0;"
run_script activate-live.js weave-live-activate-s9-0 ''
sleep 0.5
LIVE_PRE="var liveIds = [$live_js];"
invoke "Weave Layout Stage"
sleep 1
run_script check-s9a.js weave-live-check-s9a S9a
LIVE_PRE="var liveIds = [$live_js]; var activateIndex = 2;"
run_script activate-live.js weave-live-activate-s9-2 ''
sleep 1
LIVE_PRE="var liveIds = [$live_js];"
run_script check-s9b.js weave-live-check-s9b S9b
invoke "Weave Stage Cycle Next"
sleep 1
run_script check-s9c.js weave-live-check-s9c S9c
invoke "Weave Layout Master"
sleep 1
run_script check-s9d.js weave-live-check-s9d S9d
# S10: keyboard actions on the master layout. Orders are tracked here: the window ids in
# layout order before each step (from the position sort), then permuted as the step does.
LIVE_PRE=
invoke "Weave Layout Master"
sleep 1
LAST_STEP_LINE=
run_script order-s7.js weave-live-order-s10 ''
LIVE_IDS=${LAST_STEP_LINE#WEAVE_LIVE_STEP ids }
set -- $LIVE_IDS
I0=$1; I1=$2; I2=$3
ids_js() { printf '"%s",' "$@" | sed 's/,$//'; }
activate_in() {
    LIVE_PRE="var liveIds = [$1]; var activateIndex = $2;"
    run_script activate-live.js weave-live-activate-s10 ''
    sleep 0.5
}
say "S10 window order (master layout): $LIVE_IDS"
ORDER1=$(ids_js "$I2" "$I0" "$I1")
ORDER2=$(ids_js "$I2" "$I1" "$I0")
activate_in "$(ids_js "$I0" "$I1" "$I2")" 2
invoke "Weave Promote"
sleep 1
LIVE_PRE="var liveIds = [$ORDER1];"
run_script check-s10a.js weave-live-check-s10a S10a
activate_in "$ORDER1" 1
invoke "Weave Move Down"
sleep 1
LIVE_PRE="var liveIds = [$ORDER2];"
run_script check-s10b.js weave-live-check-s10b S10b
activate_in "$ORDER2" 0
invoke "Weave Resize Grow Width"
sleep 1
LIVE_PRE="var liveIds = [$ORDER2];"
run_script check-s10c.js weave-live-check-s10c S10c
invoke "Weave Resize Shrink Width"
sleep 1
run_script check-s10d.js weave-live-check-s10d S10d
invoke "Weave Master More"
sleep 1
run_script check-s10e.js weave-live-check-s10e S10e
invoke "Weave Master Fewer"
sleep 1
run_script check-s10f.js weave-live-check-s10f S10f
invoke "Weave Float All"
sleep 1
run_script check-s10g.js weave-live-check-s10g S10g
invoke "Weave Float All"
sleep 1
run_script check-s10h.js weave-live-check-s10h S10h

# S11: float first. The script restarts with defaultMode=float and no tileClasses, and
# three new kcalc windows must stay exactly where the app put them.
stop_kcalc() {
    for stop_pid in $KCALC_PIDS; do kill "$stop_pid" 2>/dev/null || true; done
    for stop_pid in $KCALC_PIDS; do wait "$stop_pid" 2>/dev/null || true; done
    KCALC_PIDS=
    gone_try=0
    while pgrep -x kcalc >/dev/null 2>&1 && [ "$gone_try" -lt 20 ]; do
        sleep 0.5
        gone_try=$((gone_try + 1))
    done
    ! pgrep -x kcalc >/dev/null 2>&1
}
journal_count() {
    journalctl --user --since "$1" -o cat 2>/dev/null | rg -c "$2" || true
}
S11_OK=true
sleep 3
stop_kcalc || { say "S11: kcalc did not close"; S11_OK=false; }
if [ "$S11_OK" = true ]; then
    qdbus6 org.kde.KWin /Scripting unloadScript weave >/dev/null 2>&1 || true
    cfg_set defaultMode float
    cfg_set tileClasses ""
    S11_TS=$(date --iso-8601=seconds)
    run qdbus6 org.kde.KWin /KWin reconfigure
    run qdbus6 org.kde.KWin /Scripting start
    s11_try=0
    s11_seen=false
    while [ "$s11_try" -lt 20 ]; do
        if journalctl --user --since "$S11_TS" -o cat 2>/dev/null \
                | grep -qF "weave loaded build=$BUILD_ID"; then
            s11_seen=true
            break
        fi
        sleep 0.5
        s11_try=$((s11_try + 1))
    done
    [ "$s11_seen" = true ] || { say "S11: script did not restart"; S11_OK=false; }
fi
if [ "$S11_OK" = true ]; then
    sleep 1
    S11_TS=$(date --iso-8601=seconds)
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    wait_for_three || S11_OK=false
fi
if [ "$S11_OK" = true ]; then
    # Rectangles when first seen (the first poll that finds all three), then 1.5 s later.
    dump_ts=$(date --iso-8601=seconds)
    run_script dump.js weave-live-first-s11 ''
    seen_js=$(journalctl --user --since "$dump_ts" -o cat 2>/dev/null | awk \
        '$1 == "WEAVE_LIVE_WINDOW" {printf "%s\"%s\":{x:%s,y:%s,width:%s,height:%s}", \
        (n++ ? "," : ""), $2, $5, $6, $7, $8}')
    sleep 1.5
    S11_GEOMETRY=$(journal_count "$S11_TS" 'weave geometry ')
    S11_MANAGED=$(journal_count "$S11_TS" 'weave managed .* float')
    say "S11: weave geometry lines=$S11_GEOMETRY managed float lines=$S11_MANAGED"
    LIVE_PRE="var seenRects = {$seen_js}; var weaveCounts = {geometry: ${S11_GEOMETRY:-0},"
    LIVE_PRE="$LIVE_PRE managed: ${S11_MANAGED:-0}};"
    run_script check-s11a.js weave-live-check-s11a S11a
    run_script select-first-kcalc.js weave-live-select-s11 ''
    sleep 0.5
    invoke "Weave Snap Left Half"
    sleep 1
    run_script check-s11b.js weave-live-check-s11b S11b
    invoke "Weave Toggle Float"
    sleep 1
    run_script check-s11c.js weave-live-check-s11c S11c
    invoke "Weave Toggle Float"
    sleep 1
    run_script check-s11d.js weave-live-check-s11d S11d
fi
# S12: tiler-style resize of floating windows. Two kcalc windows are placed side by side
# sharing an edge (the third stays apart); expectations come from the core, which also
# says how many geometry writes Weave may make per key press (a loop would write more).
s12_before() { S12_TS=$(date --iso-8601=seconds); }
s12_check() {
    sleep 1
    S12_WRITES=$(journal_count "$S12_TS" 'weave geometry ')
    LIVE_PRE="var liveIds = [$S12_JS]; var weaveWrites = ${S12_WRITES:-0};"
    run_script "check-$1.js" "weave-live-check-$1" "$2"
}
S12_OK=$S11_OK
if [ "$S12_OK" = true ]; then
    LIVE_PRE=
    LAST_STEP_LINE=
    run_script place-s12.js weave-live-place-s12 ''
    sleep 1.5
    S12_IDS=${LAST_STEP_LINE#WEAVE_LIVE_STEP s12 ids }
    case "$S12_IDS" in *unsafe*|'') S12_OK=false ;; esac
fi
if [ "$S12_OK" = true ]; then
    set -- $S12_IDS
    S12_JS=$(ids_js "$1" "$2" "$3")
    say "S12 windows (first is resized): $S12_IDS"
    activate_in "$S12_JS" 0
    sleep 1
    s12_before
    invoke "Weave Resize Grow Width"
    s12_check s12a S12a
    s12_before
    invoke "Weave Resize Shrink Width"
    s12_check s12b S12b
    s12_before
    invoke "Weave Resize Grow"
    s12_check s12c S12c
    s12_before
    invoke "Weave Resize Fill"
    s12_check s12d S12d
else
    say "S12 skipped: windows missing or a non-kcalc window would be moved"
fi

# S13: the newer layouts with four tiled kcalc windows in one context. Weave goes back to
# tiling by default (defaultMode and tileClasses removed), four new windows are sent to
# DP-1, then each layout is switched to, given time to settle, optionally photographed
# (WEAVE_LIVETEST_SHOTS=<dir>) and checked by shape.
S13_SHOTS=${WEAVE_LIVETEST_SHOTS-}
shot() {
    [ -n "$S13_SHOTS" ] || return 0
    mkdir -p "$S13_SHOTS" 2>/dev/null || { say "S13: cannot create $S13_SHOTS"; return 0; }
    shot_file=$S13_SHOTS/live-$1.png
    rm -f "$shot_file"
    spectacle -b -n -f -o "$shot_file" >/dev/null 2>&1 || say "S13: spectacle failed for $1"
    shot_try=0
    while [ ! -s "$shot_file" ] && [ "$shot_try" -lt 10 ]; do
        sleep 0.5
        shot_try=$((shot_try + 1))
    done
    if [ -s "$shot_file" ]; then say "S13: screenshot $shot_file"
    else say "S13: no screenshot for $1"; fi
}
S13_OK=$S12_OK
sleep 3
if [ "$S13_OK" = true ]; then
    stop_kcalc || { say "S13: kcalc did not close"; S13_OK=false; }
fi
if [ "$S13_OK" = true ]; then
    qdbus6 org.kde.KWin /Scripting unloadScript weave >/dev/null 2>&1 || true
    cfg_del defaultMode
    cfg_del tileClasses
    S13_TS=$(date --iso-8601=seconds)
    run qdbus6 org.kde.KWin /KWin reconfigure
    run qdbus6 org.kde.KWin /Scripting start
    s13_try=0
    s13_seen=false
    while [ "$s13_try" -lt 20 ]; do
        if journalctl --user --since "$S13_TS" -o cat 2>/dev/null \
                | grep -qF "weave loaded build=$BUILD_ID"; then
            s13_seen=true
            break
        fi
        sleep 0.5
        s13_try=$((s13_try + 1))
    done
    [ "$s13_seen" = true ] || { say "S13: script did not restart"; S13_OK=false; }
fi
if [ "$S13_OK" = true ]; then
    sleep 1
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    kcalc >/dev/null 2>&1 & KCALC_PIDS="$KCALC_PIDS $!"
    wait_for_count 4 || S13_OK=false
fi
if [ "$S13_OK" = true ]; then
    send_all send-kcalc.js weave-live-send-s13
    sleep 1
    for s13_pair in rows:S13a:Rows hstack:S13b:Hstack rmaster:S13c:Rmaster \
            grid:S13d:Grid ultrawide:S13e:Ultrawide; do
        s13_layout=${s13_pair%%:*}
        s13_rest=${s13_pair#*:}
        s13_id=${s13_rest%%:*}
        s13_label=${s13_rest#*:}
        invoke "Weave Layout $s13_label"
        sleep 1.5
        shot "$s13_layout"
        LIVE_PRE="var s13Layout = \"$s13_layout\"; var s13Scenario = \"$s13_id\";"
        run_script check-s13.js "weave-live-check-$s13_id" "$s13_id"
    done
else
    say "S13 skipped: four tiled windows were not available"
fi
# Let the 2 s save debounce fire before cleanup unloads the script.
sleep 3
summary
