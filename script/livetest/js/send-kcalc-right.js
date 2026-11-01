(function () {
    var targetName = "HDMI-A-1";
    var windows = workspace.windowList();
    var output = workspace.screens.filter(function (screen) {
        return String(screen.name) === targetName;
    })[0];
    if (!output) { print("WEAVE_LIVE FAIL missing output " + targetName); return; }
    function nameOf(window) {
        var current = window.output;
        return typeof current === "string" ? current : String(current.name);
    }
    var pending = 0;
    windows.forEach(function (window) {
        if (String(window.resourceClass) !== KCALC_RESOURCE_CLASS) { return; }
        var before = nameOf(window);
        if (before === targetName) { return; }
        pending++;
        workspace.sendClientToScreen(window, output);
        print("WEAVE_LIVE_SEND " + window.internalId + " " + before + " -> " +
            nameOf(window));
    });
    print("WEAVE_LIVE_STEP sent pending=" + pending);
})();
