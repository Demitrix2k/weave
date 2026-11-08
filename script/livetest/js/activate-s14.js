// Activates the first parked (minimized) kcalc window, as a user would from the task list.
(function () {
    var parked = Weave.liveExpected.kcalcWindows(workspace).filter(function (window) {
        return window.minimized;
    });
    if (parked.length) { workspace.activeWindow = parked[0]; }
    print("WEAVE_LIVE_STEP activated " + (parked.length ? String(parked[0].internalId) : "none"));
})();
