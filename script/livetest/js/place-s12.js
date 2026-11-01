(function () {
    var ids = Weave.liveExpected.kcalcWindows(workspace).map(function (window) {
        return String(window.internalId);
    }).sort();
    var plan = Weave.liveExpected.s12Place(workspace, ids, Weave);
    print("WEAVE_LIVE_STEP s12 ids " + (plan ? ids.join(" ") : "") +
        (plan && plan.unsafe ? " unsafe" : ""));
})();
