// Shape check for one layout with four tiled kcalc windows in one context. s13Layout and
// s13Scenario come from the harness. TOL absorbs rounding.
(function () {
    var TOL = 4;
    // kcalc's own minimum height. Weave floats windows whose cell is smaller (newest
    // first), so only the cells of the windows that still fit are checked; the floated
    // ones may be anywhere. Only rows may float windows: every other layout gives all
    // four a cell that fits, and windows floated by the layout limit or fit come back
    // when the layout changes, so all four must be tiled there.
    var MIN_HEIGHT = 341;
    var windows = Weave.liveExpected.kcalcWindows(workspace);
    var actualRects = windows.map(Weave.liveExpected.actual);
    var expected = [];
    var pass = false;
    if (windows.length === 4) {
        var desktop = Weave.liveExpected.desktopFor(workspace, windows[0]);
        var area = Weave.liveExpected.workArea(workspace, windows[0].output, desktop);
        // Shapes (rows, hstack 60 % master, rmaster, 2x2 grid, ultrawide) come from the
        // core layout; the core's split ratios ignore gaps, so rows differ by a few px.
        var ids = ["a", "b", "c", "d"];
        var mins = {};
        ids.forEach(function (id) { mins[id] = {width: 0, height: MIN_HEIGHT}; });
        var fitted = Weave.fit(ids, mins, area, {outer: 8, inner: 8}, s13Layout,
            {masterRatio: 0.6, arrival: ids});
        expected = Weave.liveExpected.layoutRects(s13Layout, fitted.tiled, area);
        var free = actualRects.slice();
        pass = expected.length === fitted.tiled.length &&
            (s13Layout === "rows" || fitted.tiled.length === 4) && expected.every(function (want) {
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
    }
    Weave.liveExpected.emit(s13Scenario, pass, expected, actualRects,
        {layout: s13Layout, windows: windows.length, tolerance: TOL, minHeight: MIN_HEIGHT});
})();
