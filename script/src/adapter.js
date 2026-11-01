(function (host) {
    "use strict";

    var api = Weave;
    var states = new Map();
    var contexts = new Map();
    var config = {};
    var observing = false;
    var candidates = new Map();
    var candidateWatches = new Set();
    var settleDeadline = 0;
    var settleGeneration = 0;

    function property(object, name) {
        try { return object == null ? undefined : object[name]; }
        catch (error) { logError("read " + name, error); return undefined; }
    }

    function logError(handler, error) {
        try { print("weave error " + handler + ": " + String(error)); }
        catch (ignored) {}
    }

    function log(level, message) {
        if (config.logLevel === "off") { return; }
        if (config.logLevel === "info" || config.logLevel === "debug" ||
                level === "debug" && config.logLevel === "debug") {
            try { print("weave " + message); } catch (ignored) {}
        }
    }

    function guarded(name, handler) {
        return function () {
            try { return handler.apply(null, arguments); }
            catch (error) { logError(name, error); }
        };
    }

    function connect(object, name, handler) {
        try {
            var signal = property(object, name);
            if (!signal || typeof signal.connect !== "function") { return false; }
            signal.connect(guarded(name, handler));
            return true;
        } catch (error) { logError("connect " + name, error); return false; }
    }

    function roundedRect(value) {
        if (!value) { return null; }
        return {
            x: Math.round(value.x),
            y: Math.round(value.y),
            width: Math.round(value.width),
            height: Math.round(value.height)
        };
    }

    function windowId(window) {
        var value = property(window, "internalId");
        return value === undefined || value === null ? null : String(value);
    }

    function outputName(output) {
        if (typeof output === "string") { return output; }
        var name = property(output, "name");
        return name === undefined || name === null ? String(output) : String(name);
    }

    function contextFor(window) {
        var output = property(window, "output");
        var desktop = typeof workspace.currentDesktopForScreen === "function" ?
            workspace.currentDesktopForScreen(output) : property(workspace, "currentDesktop");
        var name = outputName(output);
        var key = JSON.stringify([name, desktop]);
        var context = contexts.get(key);
        if (!context) {
            context = {
                key: key,
                outputName: name,
                output: output,
                desktop: desktop,
                ids: [],
                tree: null,
                adopted: false,
                innerGap: null
            };
            contexts.set(key, context);
        }
        return context;
    }

    function workArea(context) {
        if (typeof workspace.clientArea !== "function" ||
                typeof KWin === "undefined" || KWin.PlacementArea === undefined) {
            throw new Error("PlacementArea or clientArea unavailable");
        }
        var area = workspace.clientArea(KWin.PlacementArea, context.output,
            context.desktop);
        if (!area || area.width <= 0 || area.height <= 0) {
            throw new Error("invalid work area");
        }
        return roundedRect(area);
    }

    function loadConfig() {
        var classes = String(readConfigValue("manageClasses", ""));
        config = {
            manageClasses: classes.split(",").map(function (value) {
                return value.trim();
            }).filter(function (value) { return value.length > 0; }),
            gapInner: Math.max(0, Number(readConfigValue("gapInner", 8)) || 0),
            gapOuter: Math.max(0, Number(readConfigValue("gapOuter", 8)) || 0),
            settleSeconds: Math.max(0, Math.floor(Number(
                readConfigValue("settleSeconds", 3)) || 0)),
            dropNativeTiles: configBoolean(readConfigValue("dropNativeTiles", true), true),
            masterRatio: Number(readConfigValue("masterRatio", 0.6)),
            logLevel: String(readConfigValue("logLevel", "off"))
        };
        if (config.masterRatio < 0 || config.masterRatio > 1) { config.masterRatio = 0.6; }
        if (["off", "info", "debug"].indexOf(config.logLevel) < 0) {
            config.logLevel = "off";
        }
    }

    function readConfigValue(name, fallback) {
        try { return host.readConfig(name, fallback); }
        catch (error) { logError("readConfig " + name, error); return fallback; }
    }

    function configBoolean(value, fallback) {
        if (value === undefined || value === null) { return fallback; }
        return value === true || value === "true" || value === 1;
    }

    function eligible(window) {
        var cls = String(property(window, "resourceClass") || "");
        var caption = String(property(window, "caption") || "");
        var dialog = property(window, "dialog") === true ||
            property(window, "windowType") === "dialog";
        return config.manageClasses.indexOf(cls) >= 0 && cls.length > 0 &&
            caption.length > 0 && property(window, "normalWindow") === true &&
            !property(window, "fullScreen") && !dialog &&
            !property(window, "transientFor");
    }

    function contextGaps(context) {
        return {
            inner: context.innerGap === null ? config.gapInner : context.innerGap,
            outer: config.gapOuter
        };
    }

    function applyContext(context) {
        var rects = api.tree.layout(context.tree, workArea(context), contextGaps(context));
        context.ids.forEach(function (id) {
            var state = states.get(id);
            if (!state || state.mode !== "tiled" || !rects[id]) { return; }
            setGeometry(state.window, rects[id]);
        });
    }

    function setGeometry(window, geometry) {
        if (!geometry || property(window, "fullScreen")) { return; }
        var rect = roundedRect(geometry);
        var id = windowId(window);
        var state = states.get(id);
        if (state) { state.expected.record(id, rect); }
        window.frameGeometry = rect;
    }

    function rebuild(context) {
        context.tree = api.tree.masterStack(context.ids.slice(), 1, config.masterRatio);
        context.adopted = false;
        context.innerGap = null;
    }

    function recordCandidate(window, restart) {
        var id = windowId(window);
        if (id === null) { return; }
        candidates.set(id, window);
        if (!candidateWatches.has(id)) {
            candidateWatches.add(id);
            connect(window, "interactiveMoveResizeStarted", settleEvent);
            connect(window, "interactiveMoveResizeFinished", settleEvent);
        }
        if (restart && observing) { extendSettle(); }
    }

    function startTimer(milliseconds, callback) {
        if (typeof host.startTimer === "function") {
            host.startTimer(milliseconds, callback);
            return true;
        }
        try {
            if (typeof Qt !== "undefined" && typeof Qt.createQmlObject === "function") {
                var timer = Qt.createQmlObject(
                    "import QtQuick 2.0\nTimer { repeat: false }", workspace,
                    "WeaveSettleTimer");
                timer.interval = milliseconds;
                timer.triggered.connect(callback);
                timer.start();
                return true;
            }
        } catch (error) { logError("create settle timer", error); }
        return false;
    }

    function extendSettle() {
        settleDeadline = Date.now() + config.settleSeconds * 1000;
        settleGeneration++;
        var generation = settleGeneration;
        startTimer(config.settleSeconds * 1000, function () {
            if (generation === settleGeneration) { settleEvent(); }
        });
    }

    function settleEvent() {
        if (!observing || Date.now() < settleDeadline) { return; }
        observing = false;
        adoptCandidates();
    }

    function adoptCandidates() {
        var groups = new Map();
        candidates.forEach(function (window) {
            if (!eligible(window)) { return; }
            var context = contextFor(window);
            var group = groups.get(context.key);
            if (!group) {
                group = {context: context, rects: {}, windows: []};
                groups.set(context.key, group);
            }
            var id = windowId(window);
            var rect = roundedRect(property(window, "frameGeometry"));
            if (!rect) { return; }
            group.rects[id] = rect;
            group.windows.push(window);
        });
        candidates.clear();
        candidateWatches.clear();
        groups.forEach(function (group) {
            var context = group.context;
            var area = api.geometry.workRect(workArea(context),
                {outer: config.gapOuter});
            var inferred = api.tree.infer(group.rects, area, 2);
            if (!inferred) { return; }
            context.tree = inferred.tree;
            context.innerGap = inferred.gap;
            context.adopted = true;
            context.ids = [];
            group.windows.forEach(function (window) {
                var id = windowId(window);
                if (states.has(id)) { return; }
                var state = {
                    id: id,
                    window: window,
                    context: context,
                    mode: "tiled",
                    floatGeometry: roundedRect(property(window, "frameGeometry")),
                    expected: new api.ExpectedGeometry(),
                    drag: null
                };
                states.set(id, state);
                context.ids.push(id);
                watchWindow(state);
            });
            log("info", "adopted " + context.ids.length + " windows in " + context.key);
        });
    }

    function addWindow(window) {
        if (observing) {
            recordCandidate(window, true);
            return;
        }
        if (!eligible(window)) { return; }
        var id = windowId(window);
        if (id === null || states.has(id)) { return; }
        var context = contextFor(window);
        var state = {
            id: id,
            window: window,
            context: context,
            mode: "tiled",
            floatGeometry: roundedRect(property(window, "frameGeometry")),
            expected: new api.ExpectedGeometry(),
            drag: null
        };
        states.set(id, state);
        if (context.adopted && context.tree) {
            var existing = context.ids[context.ids.length - 1];
            context.tree = api.tree.insert(context.tree, id, existing, "right");
            context.ids.push(id);
        } else {
            context.ids.push(id);
            rebuild(context);
        }
        watchWindow(state);
        applyContext(context);
        log("info", "managed " + id + " in " + context.key);
    }

    function removeWindow(window) {
        var id = windowId(window);
        if (id === null) { return; }
        candidates.delete(id);
        candidateWatches.delete(id);
        var state = states.get(id);
        if (!state) { return; }
        var context = state.context;
        context.ids = context.ids.filter(function (item) { return item !== id; });
        states.delete(id);
        state.expected.clear(id);
        if (context.adopted) {
            context.tree = api.tree.remove(context.tree, id);
        } else {
            rebuild(context);
        }
        applyContext(context);
    }

    function floating(state) {
        if (state.mode === "float") { return; }
        state.mode = "float";
        state.context.ids = state.context.ids.filter(function (id) { return id !== state.id; });
        rebuild(state.context);
        if (state.floatGeometry) { setGeometry(state.window, state.floatGeometry); }
        applyContext(state.context);
    }

    function tiling(state) {
        if (state.mode === "tiled") { applyContext(state.context); return; }
        state.floatGeometry = roundedRect(property(state.window, "frameGeometry"));
        state.mode = "tiled";
        state.context.ids.push(state.id);
        rebuild(state.context);
        applyContext(state.context);
    }

    function watchWindow(state) {
        var window = state.window;
        connect(window, "frameGeometryChanged", function () {
            var rect = roundedRect(property(window, "frameGeometry"));
            if (rect) { state.expected.consume(state.id, rect); }
        });
        connect(window, "interactiveMoveResizeStarted", function () {
            settleEvent();
            state.drag = {
                move: !!property(window, "move"),
                resize: !!property(window, "resize"),
                startGeometry: roundedRect(property(window, "frameGeometry"))
            };
        });
        connect(window, "interactiveMoveResizeFinished", function () {
            settleEvent();
            finishDrag(state);
        });
        connect(window, "tileChanged", function () {
            if (state.mode !== "tiled" || !config.dropNativeTiles ||
                    property(window, "tile") == null) { return; }
            try { window.tile = null; }
            catch (error) { logError("drop native tile " + state.id, error); }
            log("info", "dropped native tile for " + state.id);
            applyContext(state.context);
        });
        connect(window, "fullScreenChanged", function () {
            if (property(window, "fullScreen")) { removeWindow(window); }
            else { addWindow(window); }
        });
    }

    function finishDrag(state) {
        var drag = state.drag;
        state.drag = null;
        if (!drag || state.mode !== "tiled") { return; }
        if (drag.move && !drag.resize) {
            var point = property(workspace, "cursorPos");
            var context = state.context;
            var hit = point && api.tree.hitTest(context.tree, workArea(context),
                contextGaps(context), {x: point.x, y: point.y});
            var target = hit && hit.leaf.windows[0];
            if (target && target !== state.id) {
                if (hit.edge === "center") {
                    context.tree = api.tree.swap(context.tree, state.id, target);
                } else {
                    context.tree = api.tree.insert(context.tree, state.id, target, hit.edge);
                }
                applyContext(context);
            } else {
                applyContext(context);
            }
        } else if (drag.resize) {
            resizeAtCursor(state);
        }
    }

    function includesId(node, id) {
        return node.type === "leaf" ? node.windows.indexOf(id) >= 0 :
            includesId(node.a, id) || includesId(node.b, id);
    }

    function resizeAtCursor(state) {
        var point = property(workspace, "cursorPos");
        if (!point) { applyContext(state.context); return; }
        var context = state.context;
        var area = workArea(context);
        var gaps = contextGaps(context);
        var path = api.tree.edgeAt(context.tree, area, gaps, point);
        if (path === null) { applyContext(context); return; }
        var node = context.tree;
        var parentArea = api.geometry.workRect(area, gaps);
        path.forEach(function (part) {
            var split = node;
            var pair = split.dir === "h" ? api.geometry.splitH(parentArea,
                split.ratio, gaps.inner) : api.geometry.splitV(parentArea,
                split.ratio, gaps.inner);
            parentArea = pair[part === "a" ? 0 : 1];
            node = split[part];
        });
        var geometry = roundedRect(property(state.window, "frameGeometry"));
        var inFirst = includesId(node.a, state.id);
        var horizontal = node.dir === "h";
        var start = horizontal ? parentArea.x : parentArea.y;
        var size = horizontal ? parentArea.width : parentArea.height;
        var length = Math.max(1, size - Math.min(gaps.inner, size));
        var boundary = horizontal ? (inFirst ? geometry.x + geometry.width : geometry.x) :
            (inFirst ? geometry.y + geometry.height : geometry.y);
        var ratio = (boundary - start - (inFirst ? 0 : Math.min(gaps.inner, size))) /
            length;
        context.tree = api.tree.setRatio(context.tree, path, ratio);
        applyContext(context);
    }

    function activeState() {
        var window = property(workspace, "activeWindow");
        var id = windowId(window);
        return id === null ? null : states.get(id) || null;
    }

    function shortcut(verb, handler) {
        registerShortcut("Weave " + verb, "Weave: " + verb, "", guarded(verb,
            function () { settleEvent(); return handler.apply(null, arguments); }));
    }

    function toggleFloat() {
        var state = activeState();
        if (!state) { return; }
        if (state.mode === "tiled") { floating(state); } else { tiling(state); }
    }

    function snap(action) {
        var state = activeState();
        if (!state) { return; }
        if (state.mode === "tiled") { floating(state); }
        var area = workArea(state.context);
        var rect = api.snapRect(action, area, contextGaps(state.context));
        state.floatGeometry = rect;
        setGeometry(state.window, rect);
    }

    function dock(side) {
        var state = activeState();
        if (!state || state.mode !== "tiled") { return; }
        state.context.tree = api.tree.dockToSide(state.context.tree, state.id, side);
        applyContext(state.context);
    }

    function installShortcuts() {
        shortcut("Toggle Float", toggleFloat);
        ["Left Half", "Right Half", "Top Half", "Bottom Half", "Top Left",
            "Top Right", "Bottom Left", "Bottom Right", "Maximize", "Center Quarter",
            "Left Third", "Center Third", "Right Third"].forEach(function (label) {
            var action = label.replace(/ /g, "").replace(/^./, function (c) {
                return c.toLowerCase();
            });
            shortcut("Snap " + label, function () { snap(action); });
        });
        shortcut("Retile", function () {
            var state = activeState();
            if (!state) { return; }
            if (state.mode === "float") {
                tiling(state);
                return;
            }
            rebuild(state.context);
            applyContext(state.context);
        });
        shortcut("Dock Left", function () { dock("left"); });
        shortcut("Dock Right", function () { dock("right"); });
    }

    function refreshConfig() {
        settleEvent();
        loadConfig();
        Array.from(states.values()).forEach(function (state) {
            if (config.manageClasses.indexOf(String(property(state.window, "resourceClass"))) < 0) {
                removeWindow(state.window);
            }
        });
        if (typeof workspace.windowList === "function") {
            workspace.windowList().forEach(function (window) {
                if (observing) { recordCandidate(window, false); }
                else { addWindow(window); }
            });
        }
        log("info", "configuration reloaded");
    }

    guarded("startup", function () {
        loadConfig();
        installShortcuts();
        observing = config.settleSeconds > 0;
        connect(workspace, "windowAdded", function (window) {
            settleEvent();
            if (observing) { recordCandidate(window, true); }
            else { addWindow(window); }
        });
        connect(workspace, "windowRemoved", removeWindow);
        connect(workspace, "windowActivated", settleEvent);
        if (property(workspace, "configChanged") !== undefined) {
            connect(workspace, "configChanged", refreshConfig);
        }
        if (typeof workspace.windowList === "function") {
            workspace.windowList().forEach(function (window) {
                if (observing) { recordCandidate(window, false); }
                else { recordCandidate(window, false); }
            });
        }
        if (observing) { extendSettle(); }
        else { adoptCandidates(); }
    })();
})(this);
