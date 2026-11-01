(function () {
    var windows = workspace.windowList().filter(function (window) {
        var output = window.output;
        var name = typeof output === "string" ? output : output.name;
        return String(window.resourceClass) === KCALC_RESOURCE_CLASS &&
            name === "DP-1";
    });
    if (windows.length) { workspace.activeWindow = windows[windows.length - 1]; }
    print("WEAVE_LIVE_STEP selected");
})();
