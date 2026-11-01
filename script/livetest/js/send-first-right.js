(function () {
    var window = workspace.windowList().filter(function (item) {
        return String(item.resourceClass) === KCALC_RESOURCE_CLASS;
    })[0];
    var output = workspace.screens.filter(function (item) {
        return String(item.name) === "HDMI-A-1";
    })[0];
    if (window && output) { workspace.sendClientToScreen(window, output); }
    print("WEAVE_LIVE_STEP sent");
})();
