(function () {
    var windows = workspace.windowList().filter(function (window) {
        var output = window.output;
        var name = typeof output === "string" ? output : output.name;
        return String(window.resourceClass) === KCALC_RESOURCE_CLASS &&
            name === "DP-1";
    });
    windows.sort(function (first, second) {
        var one = first.frameGeometry;
        var two = second.frameGeometry;
        return one.x - two.x || one.y - two.y;
    });
    if (windows.length) { workspace.activeWindow = windows[0]; }
    print("WEAVE_LIVE_STEP selected");
})();
