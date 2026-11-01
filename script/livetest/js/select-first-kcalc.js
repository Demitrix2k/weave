(function () {
    var window = workspace.windowList().filter(function (item) {
        return String(item.resourceClass) === KCALC_RESOURCE_CLASS;
    })[0];
    if (window) { workspace.activeWindow = window; }
    print("WEAVE_LIVE_STEP selected");
})();
