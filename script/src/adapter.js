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
    var persistence = "off";
    var persistWaiting = false;
    var persistFailed = false;
    var persistDeadline = 0;
    var savedText = null;
    var ledger = [];
    var saveGeneration = 0;
    var quitting = false;
    var STATE_SERVICE = "org.weave.State";
    var BUILD_ID = "@@BUILD_ID@@";
    var MIN_PANE = 100;

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

    function discardIfEmpty(context) {
        if (context.ids.length) { return; }
        contexts.delete(context.key);
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
            persist: configBoolean(readConfigValue("persist", true), true),
            masterRatio: Number(readConfigValue("masterRatio", 0.6)),
            logLevel: String(readConfigValue("logLevel", "off"))
        };
        if (config.masterRatio < 0 || config.masterRatio > 1) { config.masterRatio = 0.6; }
        if (["off", "info", "debug"].indexOf(config.logLevel) < 0) {
            config.logLevel = "off";
        }
    }

    function readConfigValue(name, fallback) {
        try {
            if (typeof readConfig === "function") { return readConfig(name, fallback); }
            if (host && typeof host.readConfig === "function") {
                return host.readConfig(name, fallback);
            }
            return fallback;
        }
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

    function onContextOutput(window, context) {
        return outputName(property(window, "output")) === context.outputName;
    }

    function applyContext(context) {
        var rects = api.tree.layout(context.tree, workArea(context), contextGaps(context));
        context.ids.forEach(function (id) {
            var state = states.get(id);
            if (!state || state.mode !== "tiled" || !rects[id]) { return; }
            if (!onContextOutput(state.window, context)) {
                log("debug", "skip " + id + ": output changed, reassignment pending");
                return;
            }
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
            connectContextSignals(window, function () { contextFor(window); });
        }
        if (restart && observing) { extendSettle(); }
    }

    function startTimer(milliseconds, callback) {
        if (host && typeof host.startTimer === "function") {
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
        if (persistence === "pending") {
            if (Date.now() >= persistDeadline) {
                persistFail("Get timed out");
                return;
            }
            waitForState();
            return;
        }
        observing = false;
        adoptCandidates();
    }

    function waitForState() {
        if (persistWaiting) { return; }
        persistWaiting = true;
        var started = startTimer(2000, guarded("state timeout", function () {
            if (persistence === "pending") { persistFail("Get timed out"); }
        }));
        if (!started) { log("debug", "persistence: no timer, Get timeout checks on events"); }
    }

    function persistFail(what, error) {
        persistence = "off";
        if (!persistFailed) {
            persistFailed = true;
            log("debug", "persistence off: " + what + (error ? " " + String(error) : ""));
        }
        if (persistWaiting) { settleEvent(); }
    }

    function sendDBus() {
        if (typeof callDBus === "function") { return callDBus.apply(null, arguments); }
        if (host && typeof host.callDBus === "function") {
            return host.callDBus.apply(host, arguments);
        }
        throw new Error("callDBus unavailable");
    }

    function startPersistence() {
        persistence = "off";
        log("debug", "persistence config: persist=" + String(config.persist) +
            " manageClasses=" + JSON.stringify(config.manageClasses));
        if (!config.persist) {
            log("debug", "persistence off: persist disabled");
            return;
        }
        if (config.manageClasses.length === 0) {
            log("debug", "persistence off: no manageClasses");
            return;
        }
        persistence = "pending";
        persistDeadline = Date.now() + 2000;
        log("debug", "persistence pending: sending Get");
        try {
            sendDBus(STATE_SERVICE, "/State", STATE_SERVICE, "Get",
                guarded("state reply", onStateReply));
        } catch (error) { persistFail("Get", error); }
    }

    function onStateReply(text) {
        if (persistence !== "pending") { return; }
        savedText = typeof text === "string" ? text : null;
        persistence = savedText === null ? "off" : "ready";
        log("debug", "persistence Get reply: " + typeof text + " length " +
            (savedText === null ? "n/a" : savedText.length));
        if (persistence === "off") { log("debug", "persistence off: empty Get reply"); }
        else { log("debug", "persistence ready"); }
        if (persistWaiting) { settleEvent(); }
    }

    function desktopNumber(desktop) {
        if (typeof desktop === "number" || typeof desktop === "string") { return desktop; }
        var number = property(desktop, "x11DesktopNumber");
        return typeof number === "number" ? number : null;
    }

    function recordFor(state) {
        var window = state.window;
        return {
            key: api.keyOf(property(window, "resourceClass"), property(window, "caption")),
            mode: state.mode === "float" ? "float" : "tiled",
            floatGeom: state.floatGeometry,
            geom: roundedRect(property(window, "frameGeometry")),
            ctx: {
                outputName: state.context.outputName,
                desktop: desktopNumber(state.context.desktop)
            },
            seen: Date.now()
        };
    }

    function rememberClosed(state) {
        if (persistence === "ready") { ledger.push(recordFor(state)); }
    }

    function forgetClosed(window) {
        var wanted = api.keyString(api.keyOf(property(window, "resourceClass"),
            property(window, "caption")));
        for (var index = ledger.length - 1; index >= 0; index--) {
            if (api.keyString(ledger[index].key) === wanted) {
                ledger.splice(index, 1);
                return;
            }
        }
    }

    function scheduleSave() {
        if (persistence !== "ready" || observing || quitting) { return; }
        saveGeneration++;
        var generation = saveGeneration;
        var started = startTimer(2000, guarded("save", function () {
            if (generation === saveGeneration) { flushSave(); }
        }));
        if (!started) { flushSave(); }
    }

    function flushSave() {
        saveGeneration++;
        if (persistence !== "ready" || observing) { return; }
        var records = ledger.slice();
        states.forEach(function (state) { records.push(recordFor(state)); });
        var text = api.serialize(records, Date.now());
        log("debug", "persistence Set sent: " + records.length + " records, " +
            text.length + " chars");
        try {
            sendDBus(STATE_SERVICE, "/State", STATE_SERVICE, "Set", text,
                guarded("state set reply", function () {}));
        } catch (error) { persistFail("Set", error); }
    }

    function aboutToQuit() {
        flushSave();
        quitting = true;
    }

    function newState(window, context, mode, record) {
        var rect = roundedRect(property(window, "frameGeometry"));
        var remembered = record && record.floatGeom ? roundedRect(record.floatGeom) : rect;
        return {
            id: windowId(window),
            window: window,
            context: context,
            mode: mode,
            floatGeometry: remembered,
            floatWorkArea: workArea(context),
            expected: new api.ExpectedGeometry(),
            drag: null,
            reassigning: false
        };
    }

    function adoptCandidates() {
        var groups = new Map();
        var listing = [];
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
            listing.push({
                id: id,
                resourceClass: property(window, "resourceClass"),
                caption: property(window, "caption"),
                geom: rect
            });
        });
        var saved = {matches: {}, leftovers: []};
        if (persistence === "ready") {
            saved = api.restore(savedText, listing);
            ledger = saved.leftovers;
        }
        candidates.clear();
        candidateWatches.clear();
        groups.forEach(function (group) {
            var context = group.context;
            var area = api.geometry.workRect(workArea(context),
                {outer: config.gapOuter});
            var floats = [];
            var rest = [];
            var rects = {};
            group.windows.forEach(function (window) {
                var id = windowId(window);
                var record = saved.matches[id];
                if (record && record.mode === "float") { floats.push(window); return; }
                rest.push(window);
                rects[id] = group.rects[id];
            });
            var inferred = rest.length ? api.tree.infer(rects, area, 2) : null;
            context.ids = [];
            if (inferred) {
                context.tree = inferred.tree;
                context.innerGap = inferred.gap;
                context.adopted = true;
                adoptWindows(rest, context, "tiled", saved.matches);
            }
            adoptWindows(floats, context, "float", saved.matches);
            if (!inferred) { discardIfEmpty(context); }
            log("info", "adopted " + context.ids.length + " windows in " + context.key);
        });
    }

    function adoptWindows(windows, context, mode, matches) {
        windows.forEach(function (window) {
            var id = windowId(window);
            if (states.has(id)) { return; }
            var state = newState(window, context, mode, matches[id]);
            states.set(id, state);
            if (mode === "tiled") { context.ids.push(id); }
            watchWindow(state);
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
        var state = newState(window, context, "tiled", null);
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
        forgetClosed(window);
        scheduleSave();
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
        rememberClosed(state);
        context.ids = context.ids.filter(function (item) { return item !== id; });
        states.delete(id);
        state.expected.clear(id);
        if (context.adopted) {
            context.tree = api.tree.remove(context.tree, id);
        } else {
            rebuild(context);
        }
        if (context.ids.length) { applyContext(context); }
        else { discardIfEmpty(context); }
        scheduleSave();
    }

    function floating(state) {
        if (state.mode === "float") { return; }
        state.mode = "float";
        state.context.ids = state.context.ids.filter(function (id) { return id !== state.id; });
        if (state.context.adopted) {
            state.context.tree = api.tree.remove(state.context.tree, state.id);
        } else {
            rebuild(state.context);
        }
        if (state.floatGeometry) {
            state.floatGeometry = restoreFloatGeometry(state);
            setGeometry(state.window, state.floatGeometry);
        }
        if (state.context.ids.length) { applyContext(state.context); }
        else { discardIfEmpty(state.context); }
        scheduleSave();
    }

    function tiling(state) {
        if (state.mode === "tiled") { applyContext(state.context); return; }
        state.floatGeometry = roundedRect(property(state.window, "frameGeometry"));
        state.floatWorkArea = workArea(state.context);
        state.mode = "tiled";
        contexts.set(state.context.key, state.context);
        state.context.ids.push(state.id);
        rebuild(state.context);
        applyContext(state.context);
        scheduleSave();
    }

    function restoreFloatGeometry(state) {
        var area = workArea(state.context);
        if (state.floatGeometry && !api.geometry.mostlyInside(state.floatGeometry, area)) {
            state.floatGeometry = api.geometry.translateClamp(state.floatGeometry,
                state.floatWorkArea || area, area);
        } else if (state.floatGeometry) {
            state.floatGeometry = api.geometry.translateClamp(state.floatGeometry,
                area, area);
        }
        state.floatWorkArea = area;
        return state.floatGeometry;
    }

    function watchWindow(state) {
        var window = state.window;
        connectContextSignals(window, function () {
            if (!observing) { reassign(state); }
            else { contextFor(window); }
        });
        connect(window, "frameGeometryChanged", function () {
            var rect = roundedRect(property(window, "frameGeometry"));
            if (rect) { state.expected.consume(state.id, rect); }
        });
        connect(window, "interactiveMoveResizeStarted", function () {
            settleEvent();
            state.drag = {
                move: !!property(window, "move"),
                resize: !!property(window, "resize"),
                startGeometry: roundedRect(property(window, "frameGeometry")),
                context: state.context
            };
        });
        connect(window, "interactiveMoveResizeFinished", function () {
            settleEvent();
            if (!observing) { reassign(state); }
            if (states.has(state.id)) { finishDrag(state); }
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

    function connectContextSignals(window, handler) {
        ["outputChanged", "desktopsChanged", "desktopChanged"].forEach(function (name) {
            connect(window, name, handler);
        });
    }

    function reassign(state) {
        if (!state || state.reassigning || !states.has(state.id)) { return; }
        if (!eligible(state.window)) {
            removeWindow(state.window);
            return;
        }
        var next = contextFor(state.window);
        var previous = state.context;
        if (next.key === previous.key) {
            state.context = next;
            return;
        }
        state.reassigning = true;
        try {
            if (state.floatGeometry && previous.outputName !== next.outputName) {
                var oldArea = workArea(previous);
                var newArea = workArea(next);
                state.floatGeometry = api.geometry.translateClamp(
                    state.floatGeometry, oldArea, newArea);
                state.floatWorkArea = newArea;
            }
            if (state.mode === "tiled") {
                previous.ids = previous.ids.filter(function (id) { return id !== state.id; });
                previous.tree = api.tree.remove(previous.tree, state.id);
                if (!previous.adopted) { rebuild(previous); }
            }
            discardIfEmpty(previous);
            state.context = next;
            if (state.mode === "tiled") {
                next.ids = next.ids.filter(function (id) { return id !== state.id; });
                next.ids.push(state.id);
                rebuild(next);
            }
            if (previous.ids.length) { applyContext(previous); }
            if (state.mode === "tiled") { applyContext(next); }
            log("info", "moved " + state.id + " from " + previous.key + " to " + next.key);
        } finally {
            state.reassigning = false;
        }
    }

    function finishDrag(state) {
        var drag = state.drag;
        state.drag = null;
        if (!drag || state.mode !== "tiled") { return; }
        if (drag.move && !drag.resize) {
            var point = property(workspace, "cursorPos");
            var context = state.context;
            if (drag.context.key !== context.key) {
                insertAtDrop(state, context, point);
                if (drag.context.ids.length) { applyContext(drag.context); }
                else { discardIfEmpty(drag.context); }
                applyContext(context);
                return;
            }
            var hit = point && api.tree.hitTest(context.tree, workArea(context),
                contextGaps(context), {x: point.x, y: point.y});
            var target = hit && hit.leaf.windows[0];
            if (target && target !== state.id) {
                if (hit.edge === "center") {
                    context.tree = api.tree.swap(context.tree, state.id, target);
                } else {
                    context.tree = api.tree.insert(context.tree, state.id, target, hit.edge);
                }
                context.adopted = true;
                applyContext(context);
            } else {
                applyContext(context);
            }
        } else if (drag.resize) {
            resizeByFrame(state, drag);
        }
    }

    function insertAtDrop(state, context, point) {
        context.tree = api.tree.remove(context.tree, state.id);
        var hit = point && context.tree && api.tree.hitTest(context.tree,
            workArea(context), contextGaps(context), {x: point.x, y: point.y});
        var target = hit && hit.leaf.windows[0];
        if (target) {
            context.tree = api.tree.insert(context.tree, state.id, target, hit.edge);
        } else {
            context.tree = api.tree.insert(null, state.id, null, "right");
        }
        context.adopted = true;
    }

    function changedSides(start, end) {
        var sides = [];
        if (Math.abs(end.x - start.x) > 1) { sides.push({side: "left", coord: end.x}); }
        if (Math.abs(end.x + end.width - start.x - start.width) > 1) {
            sides.push({side: "right", coord: end.x + end.width});
        }
        if (Math.abs(end.y - start.y) > 1) { sides.push({side: "top", coord: end.y}); }
        if (Math.abs(end.y + end.height - start.y - start.height) > 1) {
            sides.push({side: "bottom", coord: end.y + end.height});
        }
        return sides;
    }

    function resizeByFrame(state, drag) {
        var context = state.context;
        var end = roundedRect(property(state.window, "frameGeometry"));
        var start = drag.startGeometry;
        if (!context.tree || !start || !end) { applyContext(context); return; }
        var area = workArea(context);
        var gaps = contextGaps(context);
        var edges = [];
        changedSides(start, end).forEach(function (change) {
            var path = api.tree.edgeForSide(context.tree, area, gaps, state.id, change.side);
            if (path) { edges.push({path: path, side: change.side, coord: change.coord}); }
        });
        edges.sort(function (a, b) { return a.path.length - b.path.length; });
        log("debug", "resize " + state.id + " edges=" + JSON.stringify(edges));
        edges.forEach(function (edge) {
            var ratio = api.tree.ratioForSide(context.tree, area, gaps, edge.path,
                edge.side, edge.coord, MIN_PANE);
            if (ratio === null) { return; }
            context.tree = api.tree.setRatio(context.tree, edge.path, ratio);
        });
        if (edges.length) { context.adopted = true; }
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
        state.floatWorkArea = area;
        setGeometry(state.window, rect);
        scheduleSave();
    }

    function dock(side) {
        var state = activeState();
        if (!state || state.mode !== "tiled") { return; }
        state.context.tree = api.tree.dockToSide(state.context.tree, state.id, side);
        state.context.adopted = true;
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

    function outputNames() {
        var outputs = property(workspace, "screens") || property(workspace, "outputs");
        if (typeof outputs === "function") { outputs = outputs.call(workspace); }
        if (!outputs || typeof outputs.length !== "number") { return null; }
        var names = [];
        for (var index = 0; index < outputs.length; index++) {
            names.push(outputName(outputs[index]));
        }
        return names;
    }

    function outputsChanged() {
        var names = outputNames();
        if (!names) { return; }
        Array.from(states.values()).forEach(function (state) { reassign(state); });
        Array.from(contexts.values()).forEach(function (context) {
            if (names.indexOf(context.outputName) >= 0) { return; }
            context.ids.slice().forEach(function (id) {
                var state = states.get(id);
                if (state) { reassign(state); }
            });
            if (!context.ids.length) { discardIfEmpty(context); }
        });
    }

    guarded("startup", function () {
        loadConfig();
        log("info", "loaded build=" + BUILD_ID);
        installShortcuts();
        startPersistence();
        observing = config.settleSeconds > 0 || persistence === "pending";
        connect(workspace, "windowAdded", function (window) {
            settleEvent();
            if (observing) { recordCandidate(window, true); }
            else { addWindow(window); }
        });
        connect(workspace, "windowRemoved", removeWindow);
        connect(workspace, "windowActivated", settleEvent);
        connect(workspace, "aboutToQuit", aboutToQuit);
        connect(property(host, "qApp"), "aboutToQuit", aboutToQuit);
        connect(workspace, "screensChanged", outputsChanged);
        connect(workspace, "outputsChanged", outputsChanged);
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
