(function () {
    var windows = workspace.windowList();
    windows.forEach(function (window) {
        if (String(window.resourceClass) !== KCALC_RESOURCE_CLASS) { return; }
        var rect = window.frameGeometry;
        var output = window.output;
        var name = typeof output === "string" ? output : output.name;
        print("WEAVE_LIVE_WINDOW " + window.internalId + " " + name + " " +
            window.desktop + " " + rect.x + " " + rect.y + " " +
            rect.width + " " + rect.height);
    });
    print("WEAVE_LIVE_STEP dump complete");
})();
