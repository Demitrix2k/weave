// Scroll layout with four kcalc windows in one context. The harness sets s14Step (a..f),
// s14Axis ("h" or "v"), s14Rel ("none", "other", "slot", "same", "target") and s14Prev (ids of the
// windows that were visible one step earlier, or the revealed window for "target").
(function () {
    var TOL = 4;
    var windows = Weave.liveExpected.kcalcWindows(workspace);
    var scenario = "S14" + s14Step;
    var id = function (window) { return String(window.internalId); };
    var actualRects = windows.map(Weave.liveExpected.actual);
    var active = workspace.activeWindow ? id(workspace.activeWindow) : "";
    var visible = windows.filter(function (window) { return !window.minimized; }).map(id);
    var parked = windows.filter(function (window) { return window.minimized; }).map(id);
    var info = {step: s14Step, windows: windows.length, visible: visible, parked: parked,
        active: active, activeIsVisible: visible.indexOf(active) >= 0, tolerance: TOL};
    var expected = [];
    var pass = false;
    var sameSet = function (one, two) {
        return one.length === two.length && one.every(function (item) {
            return two.indexOf(item) >= 0;
        });
    };
    // Unordered match of expected rects against the rects of the given window ids.
    var matches = function (wanted, ids) {
        var free = windows.filter(function (window) { return ids.indexOf(id(window)) >= 0; })
            .map(Weave.liveExpected.actual);
        return wanted.length === free.length && wanted.every(function (want) {
            var at = -1;
            free.forEach(function (rect, index) {
                if (at < 0 && Math.abs(rect.x - want.x) <= TOL &&
                        Math.abs(rect.y - want.y) <= TOL &&
                        Math.abs(rect.width - want.width) <= TOL &&
                        Math.abs(rect.height - want.height) <= TOL) { at = index; }
            });
            if (at < 0) { return false; }
            free.splice(at, 1);
            return true;
        });
    };
    if (windows.length === 4) {
        var desktop = Weave.liveExpected.desktopFor(workspace, windows[0]);
        var area = Weave.liveExpected.workArea(workspace, windows[0].output, desktop);
        if (s14Step === "f") {
            expected = Weave.liveExpected.layoutRects("master", ["a", "b", "c", "d"], area,
                Weave);
            pass = parked.length === 0 && matches(expected, visible);
        } else {
            var page = Weave.scroll.layout(["a", "b"], {axis: s14Axis, visible: 2, offset: 0},
                area, {outer: 8, inner: 8}, {});
            expected = [page.rects.a, page.rects.b].map(function (rect) {
                return {x: Math.round(rect.x), y: Math.round(rect.y),
                    width: Math.round(rect.width), height: Math.round(rect.height)};
            });
            var relOk = s14Rel === "none" ? true :
                s14Rel === "slot" ? visible.filter(function (item) {
                        return s14Prev.indexOf(item) >= 0; }).length === 1 &&
                    visible.indexOf(active) >= 0 && s14Prev.indexOf(active) < 0 :
                s14Rel === "other" ? sameSet(visible.concat(s14Prev), ids4(windows)) &&
                    visible.every(function (item) { return s14Prev.indexOf(item) < 0; }) :
                s14Rel === "same" ? sameSet(visible, s14Prev) :
                visible.indexOf(s14Prev[0]) >= 0 && active === s14Prev[0];
            pass = visible.length === 2 && parked.length === 2 && relOk &&
                matches(expected, visible);
        }
    }
    function ids4(list) { return list.map(id); }
    info.rel = s14Rel;
    info.axis = s14Axis;
    Weave.liveExpected.emit(scenario, pass, expected, actualRects, info);
})();
