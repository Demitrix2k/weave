(function () {
    var wanted = liveIds[2];
    var window = workspace.windowList().filter(function (item) {
        return String(item.resourceClass) === KCALC_RESOURCE_CLASS &&
            String(item.internalId) === wanted;
    })[0];
    if (window) {
        var rect = window.frameGeometry;
        window.frameGeometry = {x: rect.x + 40, y: rect.y + 40,
            width: rect.width, height: rect.height};
        var moved = window.frameGeometry;
        print("WEAVE_LIVE_STEP moved " + rect.x + "," + rect.y + " -> " +
            moved.x + "," + moved.y);
        return;
    }
    print("WEAVE_LIVE_STEP moved none");
})();
