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

    function emit(scenario, pass, expected, actualRects) {
        var line = "WEAVE_LIVE {\"scenario\":\"" + scenario + "\",\"status\":\"" +
            (pass ? "PASS" : "FAIL") + "\",\"expected\":" +
            JSON.stringify(expected) + ",\"actual\":" + JSON.stringify(actualRects) + "}";
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
                layout.forEach(function (rect, index) {
                    if (!equalRect(rect, actual(group.windows[index]))) { pass = false; }
                });
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
                pass = expected.every(function (rect, index) {
                    return equalRect(rect, actualRects[index]);
                });
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

    api = {
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
