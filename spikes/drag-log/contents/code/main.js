(function () {
    "use strict";

    function log(event, data) {
        try {
            data = data || {};
            data.event = event;
            data.time = Date.now();
            print((event === "error" ? "weave-spike error " : "weave-spike ") + JSON.stringify(data));
        } catch (error) {
            try { print("weave-spike error " + String(error)); } catch (ignored) {}
        }
    }

    function guarded(name, handler) {
        return function () {
            try { return handler.apply(null, arguments); }
            catch (error) { log("error", {handler: name, message: String(error)}); }
        };
    }

    function get(object, name) {
        try { return object == null ? undefined : object[name]; }
        catch (error) {
            log("error", {handler: "get " + name, message: String(error)});
            return undefined;
        }
    }

    function feature(object, name) {
        var value = get(object, name);
        return {exists: value !== undefined, type: typeof value};
    }

    function rect(value) {
        if (!value) { return null; }
        return {x: value.x, y: value.y, width: value.width, height: value.height};
    }

    function cursor() {
        var value = get(workspace, "cursorPos");
        return value ? {x: value.x, y: value.y} : null;
    }

    function id(window) {
        var value = get(window, "internalId");
        return value == null ? null : String(value);
    }

    function windows() {
        return typeof get(workspace, "windowList") === "function" ? workspace.windowList() : [];
    }

    function connect(object, name, handler) {
        try {
            var signal = get(object, name);
            if (!signal || typeof signal.connect !== "function") { return false; }
            signal.connect(guarded(name, handler));
            return true;
        } catch (error) {
            log("error", {handler: "connect " + name, message: String(error)});
            return false;
        }
    }

    function tileInfo(tile) {
        if (tile == null) { return null; }
        var names = [];
        var seen = {};
        function add(name) {
            if (!Object.prototype.hasOwnProperty.call(seen, name)) {
                seen[name] = true;
                names.push(name);
            }
        }
        try { for (var name in tile) { add(name); } }
        catch (error) { log("error", {handler: "enumerate tile", message: String(error)}); }
        try {
            var object = tile;
            var depth = 0;
            while (object && depth++ < 10) {
                Object.getOwnPropertyNames(object).forEach(add);
                object = Object.getPrototypeOf(object);
            }
        } catch (error) { log("error", {handler: "tile prototypes", message: String(error)}); }
        var api = {};
        ["manage", "split", "remove", "relativeGeometry"].forEach(function (name) {
            api[name] = feature(tile, name);
            if (api[name].exists) { add(name); }
        });
        return {properties: names.sort(), api: api, relativeGeometry: rect(get(tile, "relativeGeometry"))};
    }

    function configBool(name) {
        var value = readConfig(name, false);
        return value === true || value === "true" || value === 1;
    }

    var springBack = false;
    var springBackClasses = [];
    var railDemo = false;
    var records = [];
    var applyingRail = false;
    var lastActivation = null;

    function setGeometry(record, geometry, reason) {
        if (!geometry || get(record.window, "fullScreen")) { return; }
        record.applying = true;
        try {
            record.window.frameGeometry = rect(geometry);
            log("geometrySet", {id: id(record.window), reason: reason,
                requested: rect(geometry), actual: rect(get(record.window, "frameGeometry"))});
        } finally { record.applying = false; }
    }

    function observeTile(record) {
        if (!record.drag) { return; }
        var tile = get(record.window, "tile");
        if (tile !== record.drag.lastTile) { record.drag.tileChanged = true; }
        record.drag.lastTile = tile;
    }

    function track(window) {
        if (!window) { return null; }
        for (var i = 0; i < records.length; i++) {
            if (records[i].window === window) { return records[i]; }
        }
        var record = {window: window, drag: null, applying: false};
        records.push(record);
        var signals = {};
        signals.interactiveMoveResizeStarted = connect(window, "interactiveMoveResizeStarted", function () {
            if (record.applying) { return; }
            record.drag = {geometry: rect(get(window, "frameGeometry")), cursor: cursor(),
                started: Date.now(), lastStep: null, move: !!get(window, "move"),
                resize: !!get(window, "resize"), startTile: get(window, "tile"),
                lastTile: get(window, "tile"), tileChanged: false};
            log("dragStarted", {id: id(window), geometry: record.drag.geometry,
                cursor: record.drag.cursor, move: record.drag.move, resize: record.drag.resize,
                tile: tileInfo(record.drag.startTile)});
        });
        signals.interactiveMoveResizeStepped = connect(window, "interactiveMoveResizeStepped", function () {
            if (record.applying) { return; }
            observeTile(record);
            var now = Date.now();
            if (record.drag && record.drag.lastStep !== null && now - record.drag.lastStep < 100) { return; }
            if (!record.drag) { return; }
            record.drag.lastStep = now;
            log("dragStepped", {id: id(window), cursor: cursor(), geometry: rect(get(window, "frameGeometry"))});
        });
        signals.interactiveMoveResizeFinished = connect(window, "interactiveMoveResizeFinished", function () {
            if (record.applying) { return; }
            observeTile(record);
            var drag = record.drag;
            record.drag = null;
            log("dragFinished", {id: id(window), geometry: rect(get(window, "frameGeometry")),
                cursor: cursor(), durationMs: drag ? Date.now() - drag.started : null,
                move: drag ? drag.move : null, resize: drag ? drag.resize : null,
                tileChanged: drag ? drag.tileChanged : null,
                finalTileDiffers: drag ? get(window, "tile") !== drag.startTile : null,
                tile: tileInfo(get(window, "tile"))});
            if (springBack && drag && drag.move && !drag.resize &&
                    springBackClasses.indexOf(String(get(window, "resourceClass"))) !== -1) {
                setGeometry(record, drag.geometry, "springBack");
            }
        });
        signals.frameGeometryChanged = connect(window, "frameGeometryChanged", function () {
            observeTile(record);
            log("frameGeometryChanged", {id: id(window), geometry: rect(get(window, "frameGeometry")),
                ownChange: record.applying});
        });
        signals.tileChanged = connect(window, "tileChanged", function () {
            if (record.drag) { record.drag.tileChanged = true; }
            observeTile(record);
            log("tileChanged", {id: id(window), tile: tileInfo(get(window, "tile"))});
        });
        signals.fullScreenChanged = connect(window, "fullScreenChanged", function () {
            log("fullScreenChanged", {id: id(window), fullScreen: !!get(window, "fullScreen")});
        });
        log("window", {id: id(window), resourceClass: String(get(window, "resourceClass") || ""),
            caption: String(get(window, "caption") || "").slice(0, 160),
            normalWindow: get(window, "normalWindow"), frameGeometry: rect(get(window, "frameGeometry")),
            tileProperty: feature(window, "tile"), tile: tileInfo(get(window, "tile")), signals: signals});
        return record;
    }

    function railActivation(window) {
        if (!railDemo || applyingRail) { return; }
        var now = Date.now();
        var inBurst = lastActivation !== null && now - lastActivation < 250;
        lastActivation = now;
        if (inBurst) { return; }
        window = window || get(workspace, "activeWindow");
        if (!window || get(window, "fullScreen") || !get(window, "normalWindow")) { return; }
        var output = get(window, "output");
        if (!output || typeof get(workspace, "clientArea") !== "function" ||
                typeof KWin === "undefined" || get(KWin, "PlacementArea") === undefined) {
            log("railSkipped", {reason: "output or clientArea API unavailable"});
            return;
        }
        var desktop;
        if (typeof get(workspace, "currentDesktopForScreen") === "function") {
            desktop = workspace.currentDesktopForScreen(output);
        } else {
            desktop = get(workspace, "currentDesktop");
        }
        var area = rect(workspace.clientArea(KWin.PlacementArea, output, desktop));
        if (!area || !(area.width > 0) || !(area.height > 0)) {
            log("railSkipped", {reason: "invalid work area"});
            return;
        }
        var list = windows();
        var selected = [window];
        var start = list.indexOf(window);
        for (var i = 1; i <= list.length && selected.length < 3; i++) {
            var candidate = list[(start + i) % list.length];
            if (candidate !== window && get(candidate, "output") === output &&
                    get(candidate, "normalWindow") && !get(candidate, "fullScreen")) {
                selected.push(candidate);
            }
        }
        var railWidth = Math.round(area.width * 0.2);
        var cells = [
            {x: area.x + railWidth, y: area.y, width: area.width - 2 * railWidth, height: area.height},
            {x: area.x, y: area.y, width: railWidth, height: area.height},
            {x: area.x + area.width - railWidth, y: area.y, width: railWidth, height: area.height}
        ];
        applyingRail = true;
        try {
            selected.forEach(function (candidate, index) {
                setGeometry(track(candidate), cells[index], "railDemo");
            });
        } finally { applyingRail = false; }
    }

    guarded("startup", function () {
        var features = {};
        ["windowList", "clientArea", "cursorPos", "currentDesktopForScreen", "screens",
            "outputs", "activeWindow", "rootTile", "tilingForScreen"].forEach(function (name) {
            features[name] = feature(workspace, name);
        });
        var version = typeof KWIN_VERSION_STRING !== "undefined" ? String(KWIN_VERSION_STRING) : null;
        var versionSource = version ? "KWIN_VERSION_STRING" : null;
        ["supportInformation", "kwinVersion", "version"].forEach(function (name) {
            if (version) { return; }
            guarded("probe version " + name, function () {
                var value = get(workspace, name);
                if (name === "supportInformation" && typeof value === "function") {
                    var match = String(workspace.supportInformation()).match(/KWin version:\s*([^\n\r]+)/i);
                    if (match) { version = match[1]; versionSource = "supportInformation"; }
                } else if (name !== "supportInformation" && value != null && typeof value !== "function") {
                    version = String(value); versionSource = "workspace." + name;
                }
            })();
        });
        var tiles = [];
        var root = get(workspace, "rootTile");
        if (root && typeof root !== "function") { tiles.push({source: "workspace.rootTile", tile: tileInfo(root)}); }
        var outputs = get(workspace, "outputs") || get(workspace, "screens") || [];
        if (typeof get(workspace, "tilingForScreen") === "function") {
            for (var i = 0; i < outputs.length; i++) {
                guarded("probe tilingForScreen", function (output) {
                    var manager = workspace.tilingForScreen(output);
                    var tile = get(manager, "rootTile");
                    if (tile) { tiles.push({source: "tilingForScreen.rootTile", output: i, tile: tileInfo(tile)}); }
                })(outputs[i]);
            }
        }
        var existing = windows();
        existing.forEach(function (window) {
            var tile = get(window, "tile");
            if (tile) { tiles.push({source: "window.tile", id: id(window), tile: tileInfo(tile)}); }
        });
        log("features", {kwinVersion: version, versionSource: versionSource,
            versionStatus: version ? "detected" : "unavailable in scripting globals",
            workspace: features, Tile: {exists: typeof Tile !== "undefined", type: typeof Tile},
            windowTile: existing.length ? feature(existing[0], "tile") : {exists: null, reason: "no windows"},
            tiles: tiles});
        guarded("config", function () {
            springBack = configBool("springBack");
            springBackClasses = String(readConfig("springBackClasses", "")).split(",").map(function (value) {
                return value.trim();
            }).filter(function (value) { return value.length > 0; });
            railDemo = configBool("railDemo");
        })();
        log("config", {springBack: springBack, springBackClasses: springBackClasses, railDemo: railDemo});
        connect(workspace, "windowAdded", track);
        connect(workspace, "windowRemoved", function (window) {
            records = records.filter(function (record) { return record.window !== window; });
        });
        connect(workspace, "windowActivated", railActivation);
        existing.forEach(guarded("existing window", track));
    })();
})();
