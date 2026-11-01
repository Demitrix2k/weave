(function () {
    var window = workspace.activeWindow;
    var pass = false;
    var expected = [];
    var actual = [];
    if (window && String(window.resourceClass) === KCALC_RESOURCE_CLASS) {
        var area = Weave.liveExpected.workArea(workspace, window.output,
            Weave.liveExpected.desktopFor(workspace, window));
        var rect = Weave.snap.snapRect("leftHalf", area,
            {outer: 8, inner: 8});
        expected = [rect];
        actual = [Weave.liveExpected.actual(window)];
        pass = Weave.liveExpected.equalRect(rect, actual[0]);
    }
    print("WEAVE_S3_SNAP " + (pass ? "PASS" : "FAIL"));
})();
