#!/bin/sh
# Uses the same core geometry, tree, and snap code as build.sh for expectations.
# Only kcalc windows are selected, moved, or terminated by this harness.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
CONFIG=${HOME}/.config/kwinrc
SCRIPTS=${HOME}/.local/share/kwin/scripts
JS_DIR=$ROOT/script/livetest/js
DRY_RUN=false
JSON=false
case "${1-}" in
    --dry-run) DRY_RUN=true ;;
    --json) JSON=true ;;
    '') ;;
    *) printf 'Usage: %s [--dry-run|--json]\n' "$0"; exit 2 ;;
esac

say() { printf '%s\n' "$*"; }
run() {
    if [ "$DRY_RUN" = true ]; then say "DRY-RUN: $*"; return 0; fi
    output=$("$@" 2>&1) || { say "$output"; return 1; }
    case "$output" in
        *NoReply*|*"Remote peer disconnected"*) say "$output"; return 1 ;;
    esac
    [ -z "$output" ] || say "$output"
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
        kwriteconfig6 --file "$CONFIG" --group Plugins --key weaveEnabled false
        qdbus6 org.kde.KWin /KWin reconfigure
        # Disabling does not unload a running script; a loaded one stays stale.
        qdbus6 org.kde.KWin /Scripting unloadScript weave
        kpackagetool6 --type=KWin/Script -r weave
        kwriteconfig6 --file "$CONFIG" --group Plugins --key weaveEnabled --delete
        kwriteconfig6 --file "$CONFIG" --group Script-weave --key manageClasses --delete
        kwriteconfig6 --file "$CONFIG" --group Script-weave --key settleSeconds --delete
        kwriteconfig6 --file "$CONFIG" --group Script-weave --key logLevel --delete
        qdbus6 org.kde.KWin /KWin reconfigure
        printf 'Remaining kcalc PIDs: '
        pgrep -x kcalc || true
        config_count=$(grep -ic weave "$CONFIG" 2>/dev/null || true)
        script_count=$(find "$SCRIPTS" -maxdepth 2 -iname '*weave*' -print \
            2>/dev/null | wc -l | tr -d ' ')
        say "Leftover weave lines in kwinrc: $config_count"
        say "Installed weave scripts: $script_count"
    else
        say "DRY-RUN: cleanup removes only recorded kcalc PIDs and harness settings."
    fi
    [ -z "${TMP_DIR-}" ] || rm -rf "$TMP_DIR"
    exit "$result"
}

if [ "$DRY_RUN" = true ]; then
    say "Dry run: no commands will be executed."
    run sh "$ROOT/script/build.sh"
    run kpackagetool6 --type=KWin/Script -i "$ROOT/script/dist"
    run kwriteconfig6 --file "$CONFIG" --group Plugins --key weaveEnabled true
    RESOURCE_CLASS=$(sed -n 's/^var KCALC_RESOURCE_CLASS = "\([^"]*\)";.*/\1/p' \
        "$JS_DIR/expected.js")
    run kwriteconfig6 --file "$CONFIG" --group Script-weave --key manageClasses \
        "$RESOURCE_CLASS"
    run kwriteconfig6 --file "$CONFIG" --group Script-weave --key settleSeconds 0
    run kwriteconfig6 --file "$CONFIG" --group Script-weave --key logLevel debug
    run qdbus6 org.kde.KWin /KWin reconfigure
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
    say "DRY-RUN: journalctl result parsing, summary table, optional JSON array"
    say "DRY-RUN: kill <recorded PID> and wait <recorded PID> for each launch"
    say "DRY-RUN: disable/remove Weave, delete four harness config keys, reconfigure"
    say "DRY-RUN: pgrep -x kcalc; grep kwinrc; find installed scripts; rm -rf <tmp>"
    exit 0
fi

if pgrep -x kcalc >/dev/null 2>&1; then
    say "Refusing to run: kcalc is already running. Close it and retry."
    exit 2
fi
TMP_DIR=$(mktemp -d)
KCALC_PIDS=
trap cleanup EXIT
trap 'exit 1' INT TERM
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
qdbus6 org.kde.KWin /Scripting unloadScript weave >/dev/null 2>&1 || true
BUILD_ID=$(cat "$ROOT/script/dist/BUILD_ID")
BUILD_TS=$(date --iso-8601=seconds)
run kpackagetool6 --type=KWin/Script -i "$ROOT/script/dist"
run kwriteconfig6 --file "$CONFIG" --group Plugins --key weaveEnabled true
run kwriteconfig6 --file "$CONFIG" --group Script-weave --key manageClasses \
    "$RESOURCE_CLASS"
run kwriteconfig6 --file "$CONFIG" --group Script-weave --key settleSeconds 0
run kwriteconfig6 --file "$CONFIG" --group Script-weave --key logLevel debug
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
    run qdbus6 org.kde.KWin /Scripting unloadScript "$script_name"
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
            check-s7*|check-s8*|activate-live.js|move-s8.js)
                printf '%s\n' "$LIVE_PRE" >> "$TMP_DIR/$name.js" ;;
        esac
        cat "$JS_DIR/$source_file" >> "$TMP_DIR/$name.js"
    fi
    load_and_run "$TMP_DIR/$name.js" "$name" "$scenario"
}

wait_for_three() {
    attempt=0
    while [ "$attempt" -lt 40 ]; do
        timestamp=$(date --iso-8601=seconds)
        run_script dump.js weave-live-count ''
        journal=$(journalctl --user --since "$timestamp" -o cat 2>/dev/null || true)
        count=$(printf '%s\n' "$journal" | rg -c '^WEAVE_LIVE_WINDOW ' || true)
        [ "${count:-0}" -ge 3 ] && return 0
        sleep 0.5
        attempt=$((attempt + 1))
    done
    say "Timed out waiting for three kcalc windows."
    return 1
}

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

SCENARIOS="S1 S2 S3 S4 S5 S6 S7a S7b S7c S7d S8a S8b S8c"

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
                if(/^S[1-8][a-d]?$/.test(x.scenario))keep[x.scenario]=x;});
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
# Let the 2 s save debounce fire before cleanup unloads the script.
sleep 3
summary
