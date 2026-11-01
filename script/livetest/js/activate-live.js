(function () {
    var wanted = liveIds[activateIndex];
    var window = workspace.windowList().filter(function (item) {
        return String(item.resourceClass) === KCALC_RESOURCE_CLASS &&
            String(item.internalId) === wanted;
    })[0];
    if (window) { workspace.activeWindow = window; }
    print("WEAVE_LIVE_STEP activated " + activateIndex + " " + (window ? "yes" : "no"));
})();
