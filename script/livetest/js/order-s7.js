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
    var ids = windows.map(function (window) { return String(window.internalId); });
    print("WEAVE_LIVE_STEP ids " + ids.join(" "));
})();
