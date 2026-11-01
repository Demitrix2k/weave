var KCALC_RESOURCE_CLASS = "org.kde.kcalc";

(function (root) {
    "use strict";
    var coreApi = null;
    var api;

    function rounded(rect) {
        return {x: Math.round(rect.x), y: Math.round(rect.y),
            width: Math.round(rect.width), height: Math.round(rect.height)};
    }

    function rectArray(rect) {
        return [rect.x, rect.y, rect.width, rect.height];
    }

    function equalRect(first, second) {
        return first && second && rectArray(first).join(",") ===
            rectArray(second).join(",");
    }

    function workArea(workspace, output, desktop) {
        var placement = typeof KWin === "undefined" ? 0 : KWin.PlacementArea;
        return rounded(workspace.clientArea(placement, output, desktop));
    }

    function tile(ids, area) {
        var tree = coreApi.tree.masterStack(ids, 1, 0.6);
        var rects = coreApi.tree.layout(tree, area, {outer: 8, inner: 8});
        return ids.map(function (id) { return rounded(rects[id]); });
    }

    function actual(window) {
        return rounded(window.frameGeometry);
    }

    function emit(scenario, pass, expected, actualRects, extra) {
        var line = "WEAVE_LIVE {\"scenario\":\"" + scenario + "\",\"status\":\"" +
            (pass ? "PASS" : "FAIL") + "\",\"expected\":" +
            JSON.stringify(expected) + ",\"actual\":" + JSON.stringify(actualRects);
        if (extra) { line += ",\"info\":" + JSON.stringify(extra); }
        line += "}";
        if (api.output) { api.output(line); }
        else if (typeof print === "function") { print(line); }
    }

    function kcalcWindows(workspace) {
        return workspace.windowList().filter(function (window) {
            return String(window.resourceClass) === KCALC_RESOURCE_CLASS;
        });
    }

    function desktopFor(workspace, window) {
        if (typeof workspace.currentDesktopForScreen === "function") {
            return workspace.currentDesktopForScreen(window.output);
        }
        return window.desktop;
    }

    function groupByOutput(windows, workspace) {
        var groups = {};
        windows.forEach(function (window) {
            var output = window.output;
            var name = typeof output === "string" ? output : String(output.name);
            var desktop = desktopFor(workspace, window);
            var key = name + "|" + desktop;
            if (!groups[key]) {
                groups[key] = {name: name, output: output, desktop: desktop,
                    windows: []};
            }
            groups[key].windows.push(window);
        });
        return groups;
    }

    function groupNamed(groups, name) {
        var keys = Object.keys(groups);
        for (var index = 0; index < keys.length; index++) {
            if (groups[keys[index]].name === name) { return groups[keys[index]]; }
        }
        return null;
    }

    function run(scenario, targetWorkspace, priorSnapPassed, engine, priorSize) {
        coreApi = engine || coreApi;
        var windows = kcalcWindows(targetWorkspace);
        var groups = groupByOutput(windows, targetWorkspace);
        var keys = Object.keys(groups).sort();
        var expected = [];
        var actualRects = [];
        var pass = false;
        var dp = groupNamed(groups, "DP-1");
        var hdmi = groupNamed(groups, "HDMI-A-1");
        if (scenario === "S1" || scenario === "S4" || scenario === "S2") {
            var required = scenario === "S1" ? "DP-1" :
                scenario === "S4" ? "HDMI-A-1" : null;
            pass = true;
            keys.forEach(function (key) {
                var group = groups[key];
                var expectedCount = required ? group.name === required ? 3 : 0 :
                    group.name === "DP-1" ? 2 : group.name === "HDMI-A-1" ? 1 : 0;
                if (group.windows.length !== expectedCount) { pass = false; }
                var ids = group.windows.map(function (window) {
                    return String(window.internalId);
                });
                var layout = tile(ids, workArea(targetWorkspace, group.output,
                    group.desktop));
                expected = expected.concat(layout);
                actualRects = actualRects.concat(group.windows.map(actual));
                if (!sameRectSet(layout, group.windows.map(actual))) { pass = false; }
            });
            var expectedGroups = scenario === "S2" ? 2 : 1;
            if (keys.length !== expectedGroups) { pass = false; }
            if (scenario === "S1" && (!dp || dp.windows.length !== 3)) { pass = false; }
            if (scenario === "S2" && (!dp || !hdmi)) { pass = false; }
        } else if (scenario === "S3") {
            var tiled = dp && dp.windows.length === 2 ? dp : null;
            if (tiled) {
                var ids3 = tiled.windows.map(function (window) {
                    return String(window.internalId);
                });
                expected = tile(ids3, workArea(targetWorkspace, tiled.output,
                    tiled.desktop));
                actualRects = tiled.windows.map(actual);
                pass = sameRectSet(expected, actualRects);
            }
            pass = pass && priorSnapPassed === true;
        } else if (scenario === "S5") {
            var floated = windows.filter(function (window) {
                var output = window.output;
                return (typeof output === "string" ? output : output.name) ===
                    "HDMI-A-1";
            })[0];
            if (floated) {
                var area5 = workArea(targetWorkspace, floated.output,
                    desktopFor(targetWorkspace, floated));
                var rect5 = actual(floated);
                expected = [[area5.x, area5.y, area5.width, area5.height],
                    [priorSize ? priorSize.width : 0, priorSize ? priorSize.height : 0]];
                actualRects = [rect5];
                pass = rect5.width > 0 && rect5.height > 0 && rect5.x >= area5.x &&
                    rect5.y >= area5.y && rect5.x + rect5.width <= area5.x + area5.width &&
                    rect5.y + rect5.height <= area5.y + area5.height;
                pass = pass && priorSize && rect5.width === priorSize.width &&
                    rect5.height === priorSize.height;
            }
        } else if (scenario === "S6") {
            var group6 = dp || hdmi;
            if (group6 && group6.windows.length === 3) {
                var area6 = workArea(targetWorkspace, group6.output, group6.desktop);
                // The docked window is the one that was selected: the master,
                // which sits leftmost. The others are ordered top to bottom.
                var ordered = group6.windows.slice().sort(function (first, second) {
                    var one = first.frameGeometry;
                    var two = second.frameGeometry;
                    return one.x - two.x || one.y - two.y;
                });
                var docked6 = ordered[0];
                var others6 = ordered.slice(1).sort(function (first, second) {
                    var one = first.frameGeometry;
                    var two = second.frameGeometry;
                    return one.y - two.y || one.x - two.x;
                });
                var windows6 = [docked6].concat(others6);
                var ids6 = windows6.map(function (window) {
                    return String(window.internalId);
                });
                var base = coreApi.tree.masterStack(ids6, 1, 0.6);
                var docked = coreApi.tree.dockToSide(base, ids6[0], "left");
                var layouts = coreApi.tree.layout(docked, area6, {outer: 8, inner: 8});
                expected = ids6.map(function (id) { return rounded(layouts[id]); });
                actualRects = windows6.map(actual);
                pass = expected.every(function (rect, index) {
                    return equalRect(rect, actualRects[index]);
                });
                pass = pass && actualRects[0].x === area6.x + 8 &&
                    actualRects[0].height === area6.height - 16;
            }
        }
        emit(scenario, pass, expected, actualRects);
        return {scenario: scenario, status: pass ? "PASS" : "FAIL",
            expected: expected, actual: actualRects};
    }

    var GAPS = {outer: 8, inner: 8};
    // Activation order the harness applies before S8, as indices into the id list.
    var ACTIVATION_ORDER = [1, 2, 0];

    // Windows for the ids given by the harness (master-layout order), or null.
    function liveContext(workspace, ids) {
        var all = kcalcWindows(workspace);
        var found = ids.map(function (id) {
            return all.filter(function (window) {
                return String(window.internalId) === id;
            })[0];
        });
        if (!found.length || found.some(function (window) { return !window; })) {
            return null;
        }
        var desktop = desktopFor(workspace, found[0]);
        return {windows: found, ids: ids.slice(), desktop: desktop,
            area: workArea(workspace, found[0].output, desktop)};
    }

    // Windows are launched together, so their arrival order is not the windowList
    // order: compare the set of rects, not the pairing.
    function sameRectSet(expected, actualRects) {
        var key = function (rect) { return rectArray(rect).join(","); };
        var want = expected.map(key).sort();
        var have = actualRects.map(key).sort();
        return want.length === have.length && want.every(function (item, index) {
            return item === have[index];
        });
    }

    function layoutRects(name, ids, area) {
        var tree = coreApi.tree.generate(name, ids.slice(), {masterRatio: 0.6});
        var rects = coreApi.tree.layout(tree, area, GAPS);
        return ids.map(function (id) { return rounded(rects[id]); });
    }

    function allEqual(expected, actualRects) {
        return expected.length === actualRects.length && expected.every(
            function (rect, index) { return equalRect(rect, actualRects[index]); });
    }

    function layoutStep(scenario, context, workspace) {
        var names = {S7a: "columns", S7b: "monocle", S7c: "spiral", S7d: "master"};
        var name = names[scenario];
        var expected = layoutRects(name, context.ids, context.area);
        var actualRects = context.windows.map(actual);
        var pass = allEqual(expected, actualRects);
        if (name === "columns") {
            var sorted = actualRects.slice().sort(function (one, two) {
                return one.x - two.x;
            });
            sorted.forEach(function (rect, index) {
                if (Math.abs(rect.width - sorted[0].width) > 4) { pass = false; }
                if (index && rect.x - (sorted[index - 1].x + sorted[index - 1].width) !==
                        GAPS.inner) { pass = false; }
            });
        }
        if (name === "monocle") {
            var full = {x: context.area.x + GAPS.outer, y: context.area.y + GAPS.outer,
                width: context.area.width - 2 * GAPS.outer,
                height: context.area.height - 2 * GAPS.outer};
            if (!actualRects.every(function (rect) { return equalRect(rect, full); })) {
                pass = false;
            }
        }
        var info = name === "monocle" ?
            {raiseWindow: typeof workspace.raiseWindow} : undefined;
        emit(scenario, pass, expected, actualRects, info);
        return pass;
    }

    function arrangedExpected(context, templates) {
        var names = Object.keys(templates);
        var template = templates[names[0]];
        var entries = context.ids.map(function (id, index) {
            return {id: id, seq: index + 1,
                tick: ACTIVATION_ORDER.indexOf(index) + 1};
        });
        var chosen = coreApi.arrangement.pickWindows(context.ids[0], entries,
            template.slots.length);
        var slots = coreApi.arrangement.assign(template, chosen).slots;
        var rects = coreApi.arrangement.applyTemplate(template, context.area, GAPS);
        var tiled = layoutRects("master", context.ids, context.area);
        return {chosen: chosen, expected: context.ids.map(function (id, index) {
            var slot = slots.indexOf(id);
            return slot < 0 ? tiled[index] : rounded(rects[slot]);
        })};
    }

    function arrangeStep(scenario, context, templates) {
        var actualRects = context.windows.map(actual);
        if (scenario !== "S8c") {
            var arranged = arrangedExpected(context, templates);
            var pass = allEqual(arranged.expected, actualRects);
            emit(scenario, pass, arranged.expected, actualRects,
                {chosen: arranged.chosen});
            return pass;
        }
        // Release: the unchosen window keeps its place in the tree, the released
        // members rejoin after it in arrival order (unknown here: try both).
        var picked = arrangedExpected(context, templates).chosen;
        var rest = context.ids.filter(function (id) { return picked.indexOf(id) < 0; });
        var orders = [rest.concat(picked), rest.concat(picked.slice().reverse())];
        var passes = false;
        var expected = [];
        orders.forEach(function (order) {
            var tiled = layoutRects("master", order, context.area);
            var byId = {};
            order.forEach(function (id, index) { byId[id] = tiled[index]; });
            var candidate = context.ids.map(function (id) { return byId[id]; });
            if (!passes) { expected = candidate; }
            if (!passes && allEqual(candidate, actualRects)) { passes = true; }
        });
        emit(scenario, passes, expected, actualRects, {released: picked});
        return passes;
    }

    // S8 precondition: the window moved by move-s8.js is off its slot.
    function movedStep(context, templates) {
        var arranged = arrangedExpected(context, templates);
        var actualRects = context.windows.map(actual);
        var pass = !equalRect(arranged.expected[2], actualRects[2]);
        emit("S8m", pass, arranged.expected[2], actualRects[2]);
        return pass;
    }

    // Must equal the adapter's Stage constants (a unit test compares the source).
    var STAGE_GRADIENT = 0.5;
    var STAGE_RAIL_MIN = {w: 140, h: 110};
    var FOCUS_RATIO = 0.6;

    // Replays the operations the harness applied before each S9 step on the core.
    function stageState(scenario, ids) {
        var stage = coreApi.stage;
        var state = stage.fromOrder(ids, ids[0]);
        if (scenario !== "S9a") { state = stage.promote(state, ids[2]); }
        if (scenario === "S9c" || scenario === "S9d") { state = stage.cycle(state, 1); }
        return state;
    }

    function stageRects(state, ids, area) {
        var result = coreApi.stage.layoutStacked(state, area, {gaps: GAPS,
            focusRatio: FOCUS_RATIO, gradient: STAGE_GRADIENT,
            railCellMin: STAGE_RAIL_MIN});
        return ids.map(function (id) { return rounded(result.rects[id]); });
    }

    // S9d: back in master, the windows are in stage order (focus, then the cells).
    function masterRectsFor(order, ids, area) {
        var tiled = layoutRects("master", order, area);
        return ids.map(function (id) { return tiled[order.indexOf(id)]; });
    }

    function sizePair(value) {
        return value ? {w: Math.round(value.width), h: Math.round(value.height)} : null;
    }

    // The window's own size limits, when KWin exposes them.
    function limitsOf(window) {
        return {min: sizePair(window.minSize), max: sizePair(window.maxSize)};
    }

    // An app that cannot be as small as a rail cell (kcalc has a minimum size)
    // gets whatever size it can; only its origin is then compared. The focus
    // window is always compared exactly.
    function sizeFeasible(rect, limits, isFocus) {
        if (isFocus) { return true; }
        if (!limits.min) { return false; }
        var inMin = rect.width >= limits.min.w && rect.height >= limits.min.h;
        var inMax = !limits.max || (rect.width <= limits.max.w &&
            rect.height <= limits.max.h);
        return inMin && inMax;
    }

    function sameStageRect(want, have, feasible) {
        if (want.x !== have.x || want.y !== have.y) { return false; }
        return !feasible || (want.width === have.width && want.height === have.height);
    }

    function stageStep(scenario, context) {
        var actualRects = context.windows.map(actual);
        if (context.ids.length !== 3) {
            emit(scenario, false, [], actualRects, {error: "needs three windows"});
            return false;
        }
        var state = stageState(scenario, context.ids);
        var expected = scenario === "S9d" ?
            masterRectsFor(coreApi.stage.order(state), context.ids, context.area) :
            stageRects(state, context.ids, context.area);
        var limits = context.windows.map(limitsOf);
        var checked = context.ids.map(function (id, index) {
            return scenario === "S9d" || sizeFeasible(expected[index], limits[index],
                id === state.focus);
        });
        var pass = expected.every(function (rect, index) {
            return sameStageRect(rect, actualRects[index], checked[index]);
        });
        emit(scenario, pass, expected, actualRects, {focus: state.focus,
            order: coreApi.stage.order(state), sizeChecked: checked, limits: limits});
        return pass;
    }

    // Must equal the adapter's resizeStep default (main.xml) and its MIN_PANE.
    var RESIZE_STEP = 76;
    var MIN_PANE = 100;

    function keyTree(ids, masters) {
        return coreApi.tree.generate("master", ids.slice(),
            {masterRatio: 0.6, nMaster: masters});
    }

    function treeRects(tree, ids, area) {
        var rects = coreApi.tree.layout(tree, area, GAPS);
        return ids.map(function (id) { return rounded(rects[id]); });
    }

    function resizedTree(tree, ids, area, delta) {
        return coreApi.tree.resizeBy(tree, area, GAPS, ids[0], "h", delta, MIN_PANE);
    }

    // Replays the keyboard action of each S10 step on the core. ids are in layout order.
    function keyExpected(scenario, ids, area) {
        var base = keyTree(ids, 1);
        var grown = resizedTree(base, ids, area, RESIZE_STEP);
        var trees = {S10c: grown, S10d: resizedTree(grown, ids, area, -RESIZE_STEP),
            S10e: keyTree(ids, 2)};
        return treeRects(trees[scenario] || base, ids, area);
    }

    function keyStep(scenario, context) {
        var actualRects = context.windows.map(actual);
        var tiled = treeRects(keyTree(context.ids, 1), context.ids, context.area);
        var expected = keyExpected(scenario, context.ids, context.area);
        var pass;
        if (scenario === "S10g") {
            // Floating windows return to rectangles the harness does not know.
            expected = [];
            pass = actualRects.every(function (rect) {
                return !tiled.some(function (item) { return equalRect(item, rect); });
            });
        } else if (scenario === "S10h") {
            // The adapter tiles in its own arrival order, so only the set is known.
            expected = tiled;
            pass = sameRectSet(tiled, actualRects);
        } else {
            pass = allEqual(expected, actualRects);
        }
        var grew = actualRects[0].width - tiled[0].width;
        if (scenario === "S10c") { pass = pass && grew === RESIZE_STEP; }
        if (scenario === "S10d") { pass = pass && grew === 0; }
        if (scenario === "S10e") { pass = pass && actualRects[0].x === actualRects[1].x; }
        emit(scenario, pass, expected, actualRects, {grew: grew});
        return pass;
    }

    function runLive(scenario, targetWorkspace, ids, engine, templates, movedOk) {
        coreApi = engine || coreApi;
        var context = liveContext(targetWorkspace, ids || []);
        var pass = false;
        if (context && scenario === "S8m") {
            pass = movedStep(context, templates);
        } else if (context && scenario === "S8b" && movedOk === false) {
            emit(scenario, false, [], context.windows.map(actual),
                {error: "precondition: window was not displaced"});
        } else if (!context) {
            emit(scenario, false, [], [], {error: "windows missing"});
        } else if (scenario.indexOf("S10") === 0) {
            pass = keyStep(scenario, context);
        } else if (scenario.indexOf("S9") === 0) {
            pass = stageStep(scenario, context);
        } else if (scenario.indexOf("S7") === 0) {
            pass = layoutStep(scenario, context, targetWorkspace);
        } else {
            pass = arrangeStep(scenario, context, templates);
        }
        return {scenario: scenario, status: pass ? "PASS" : "FAIL"};
    }

    api = {
        runLive: runLive,
        resourceClass: KCALC_RESOURCE_CLASS,
        rounded: rounded,
        equalRect: equalRect,
        rectArray: rectArray,
        workArea: workArea,
        tile: tile,
        actual: actual,
        emit: emit,
        kcalcWindows: kcalcWindows,
        desktopFor: desktopFor,
        groupByOutput: groupByOutput,
        groupNamed: groupNamed,
        run: run
    };
    if (typeof module === "object" && module.exports) {
        module.exports = api;
        return;
    }
    root.Weave = root.Weave || {};
    root.Weave.liveExpected = api;
})(this);
