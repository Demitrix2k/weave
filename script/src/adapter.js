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
    var FOCUS_RATIO_MIN = 0.3;
    var FOCUS_RATIO_MAX = 0.8;
    var RESIZE_STEP_MIN = 8;
    var RESIZE_STEP_MAX = 400;
    var STAGE_GRADIENT = 0.5;
    var STAGE_RAIL_MIN = {w: 140, h: 110};
    var ownActivation = null;
    var templates = typeof WEAVE_TEMPLATES === "undefined" ? {} : WEAVE_TEMPLATES;
    var activation = new Map();
    var activationTick = 0;
    var arrivalSeq = 0;
    var groupSeq = 0;

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
                innerGap: null,
                layout: config.defaultLayout,
                stage: null,
                focusRatio: null,
                nMaster: 1,
                groups: []
            };
            contexts.set(key, context);
        }
        return context;
    }

    function discardIfEmpty(context) {
        if (context.ids.length || context.groups.length) { return; }
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

    function parseList(text) {
        return String(text).split(",").map(function (value) {
            return value.trim();
        }).filter(function (value) { return value.length > 0; });
    }

    function choiceValue(value, choices, fallback) {
        var text = String(value).trim();
        if (/^\d+$/.test(text)) {
            return choices[Number(text)] || fallback;
        }
        return choices.indexOf(text) >= 0 ? text : fallback;
    }

    function loadConfig() {
        config = {
            manageClasses: parseList(readConfigValue("manageClasses", "")),
            tileClasses: parseList(readConfigValue("tileClasses", "")),
            defaultMode: choiceValue(readConfigValue("defaultMode", "tiled"),
                ["tiled", "float"], "tiled"),
            gapInner: Math.max(0, Number(readConfigValue("gapInner", 8)) || 0),
            gapOuter: Math.max(0, Number(readConfigValue("gapOuter", 8)) || 0),
            settleSeconds: Math.max(0, Math.floor(Number(
                readConfigValue("settleSeconds", 3)) || 0)),
            dropNativeTiles: configBoolean(readConfigValue("dropNativeTiles", true), true),
            persist: configBoolean(readConfigValue("persist", true), true),
            masterRatio: Number(readConfigValue("masterRatio", 0.6)),
            focusRatio: Number(readConfigValue("focusRatio", 0.6)),
            resizeStep: Number(readConfigValue("resizeStep", 76)),
            defaultLayout: choiceValue(readConfigValue("defaultLayout", "master"),
                ["master", "columns", "monocle", "spiral", "stage"], "master"),
            logLevel: choiceValue(readConfigValue("logLevel", "off"),
                ["off", "info", "debug"], "off")
        };
        if (config.masterRatio < 0 || config.masterRatio > 1) { config.masterRatio = 0.6; }
        config.focusRatio = clampFocusRatio(config.focusRatio, 0.6);
        config.resizeStep = clampResizeStep(config.resizeStep);
        if (!api.tree.validAnyLayout(config.defaultLayout)) { config.defaultLayout = "master"; }
        if (config.defaultMode !== "float") { config.defaultMode = "tiled"; }
        if (["off", "info", "debug"].indexOf(config.logLevel) < 0) {
            config.logLevel = "off";
        }
    }

    function clampResizeStep(value) {
        if (typeof value !== "number" || isNaN(value)) { return 76; }
        return Math.max(RESIZE_STEP_MIN, Math.min(RESIZE_STEP_MAX, Math.round(value)));
    }

    function clampFocusRatio(value, fallback) {
        if (typeof value !== "number" || isNaN(value)) { return fallback; }
        return Math.max(FOCUS_RATIO_MIN, Math.min(FOCUS_RATIO_MAX, value));
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

    // "*" manages every class, "!name" excludes one, other names are exact.
    function manages(cls) {
        var list = config.manageClasses;
        if (list.indexOf("!" + cls) >= 0) { return false; }
        return list.indexOf("*") >= 0 || list.indexOf(cls) >= 0;
    }

    // The mode a window without saved state starts in.
    function arrivalMode(window) {
        var cls = String(property(window, "resourceClass") || "");
        return config.tileClasses.indexOf(cls) >= 0 ? "tiled" : config.defaultMode;
    }

    function eligible(window) {
        var cls = String(property(window, "resourceClass") || "");
        var caption = String(property(window, "caption") || "");
        var dialog = property(window, "dialog") === true ||
            property(window, "windowType") === "dialog";
        return cls.length > 0 && manages(cls) &&
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

    function stageLayout(context) {
        return context.layout === "stage";
    }

    function stageRatio(context) {
        return context.focusRatio === null ? config.focusRatio : context.focusRatio;
    }

    function stageParams(context) {
        return {
            gaps: contextGaps(context),
            focusRatio: stageRatio(context),
            gradient: STAGE_GRADIENT,
            railCellMin: STAGE_RAIL_MIN
        };
    }

    // Brings the stage state in line with the tiled ids without moving anyone.
    function syncStage(context) {
        var state = context.stage || {focus: null, cells: []};
        api.stage.order(state).forEach(function (id) {
            if (context.ids.indexOf(id) < 0) { state = api.stage.removeWindow(state, id); }
        });
        context.ids.forEach(function (id) { state = api.stage.addWindow(state, id); });
        context.stage = state;
    }

    function stageRects(context) {
        if (!context.stage) { syncStage(context); }
        return api.stage.layoutStacked(context.stage, workArea(context),
            stageParams(context)).rects;
    }

    function contextRects(context) {
        if (stageLayout(context)) { return stageRects(context); }
        return api.tree.layout(context.tree, workArea(context), contextGaps(context));
    }

    function applyContext(context) {
        if (context.groups.length) { return; }
        var rects = contextRects(context);
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
        log("debug", "geometry " + id + " " + JSON.stringify(rect));
        window.frameGeometry = rect;
    }

    function effectiveMasters(context) {
        return api.tree.clampMasterCount(context.nMaster, 0, context.ids.length);
    }

    function rebuild(context) {
        if (stageLayout(context)) { syncStage(context); }
        else {
            context.tree = api.tree.generate(context.layout, context.ids.slice(),
                {masterRatio: config.masterRatio, nMaster: effectiveMasters(context)});
        }
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
            mode: state.mode === "tiled" ? "tiled" : "float",
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
            reassigning: false,
            seq: ++arrivalSeq,
            prevMode: null,
            groupId: null
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
                var mode = record ? record.mode : arrivalMode(window);
                if (mode === "float") { floats.push(window); return; }
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
            if (!inferred && config.defaultMode === "float") {
                // no clean partition: keep them managed, floating where they are
                adoptWindows(rest, context, "float", saved.matches);
            }
            adoptWindows(floats, context, "float", saved.matches);
            if (!context.ids.length) { discardIfEmpty(context); }
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
        var mode = arrivalMode(window);
        var state = newState(window, context, mode, null);
        states.set(id, state);
        if (mode === "tiled") { joinTiling(context, id); }
        watchWindow(state);
        // a floating arrival is registered but never moved
        if (mode === "tiled") { applyContext(context); }
        else { discardIfEmpty(context); }
        forgetClosed(window);
        scheduleSave();
        log("info", "managed " + id + " in " + context.key + (mode === "tiled" ? "" : " float"));
    }

    function joinTiling(context, id) {
        if (context.adopted && context.tree && !stageLayout(context)) {
            var existing = context.ids[context.ids.length - 1];
            context.tree = api.tree.insert(context.tree, id, existing, "right");
            context.ids.push(id);
        } else {
            context.ids.push(id);
            rebuild(context);
        }
    }

    function removeWindow(window) {
        var id = windowId(window);
        if (id === null) { return; }
        candidates.delete(id);
        candidateWatches.delete(id);
        activation.delete(id);
        var state = states.get(id);
        if (!state) { return; }
        var context = state.context;
        rememberClosed(state);
        if (state.mode === "arranged") { clearSlot(context, state); }
        context.ids = context.ids.filter(function (item) { return item !== id; });
        states.delete(id);
        state.expected.clear(id);
        if (state.mode === "arranged") {
            discardIfEmpty(context);
            scheduleSave();
            return;
        }
        if (context.adopted && !stageLayout(context)) {
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
        if (state.context.adopted && !stageLayout(state.context)) {
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

    // A floating window may hold a context object that was discarded and rebuilt since.
    function liveContext(context) {
        var existing = contexts.get(context.key);
        if (existing) { return existing; }
        contexts.set(context.key, context);
        return context;
    }

    function tiling(state) {
        if (state.mode === "tiled") { applyContext(state.context); return; }
        state.context = liveContext(state.context);
        state.floatGeometry = roundedRect(property(state.window, "frameGeometry"));
        state.floatWorkArea = workArea(state.context);
        state.mode = "tiled";
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
            if (state.mode === "arranged") { detachFromGroup(state); }
            if (state.floatGeometry && previous.outputName !== next.outputName) {
                var oldArea = workArea(previous);
                var newArea = workArea(next);
                state.floatGeometry = api.geometry.translateClamp(
                    state.floatGeometry, oldArea, newArea);
                state.floatWorkArea = newArea;
            }
            if (state.mode === "tiled") {
                previous.ids = previous.ids.filter(function (id) { return id !== state.id; });
                if (!stageLayout(previous)) {
                    previous.tree = api.tree.remove(previous.tree, state.id);
                }
                if (!previous.adopted || stageLayout(previous)) { rebuild(previous); }
            }
            discardIfEmpty(previous);
            state.context = next;
            if (state.mode === "float") { discardIfEmpty(next); }
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
        if (state.mode === "float") { rememberFloat(state); }
        if (!drag || state.mode !== "tiled") { return; }
        if (drag.move && !drag.resize) {
            var point = property(workspace, "cursorPos");
            var context = state.context;
            if (drag.context.key !== context.key) {
                if (!stageLayout(context)) { insertAtDrop(state, context, point); }
                if (drag.context.ids.length) { applyContext(drag.context); }
                else { discardIfEmpty(drag.context); }
                applyContext(context);
                return;
            }
            if (stageLayout(context)) {
                dropInStage(state, point);
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
            if (stageLayout(state.context)) { resizeStage(state, drag); }
            else { resizeByFrame(state, drag); }
        }
    }

    // A free move or resize only updates the rectangle restored on the next float.
    function rememberFloat(state) {
        var rect = roundedRect(property(state.window, "frameGeometry"));
        if (!rect) { return; }
        state.floatGeometry = rect;
        state.floatWorkArea = workArea(state.context);
        scheduleSave();
    }

    // Applies a new stage state; every change of the focus window is logged.
    function setStage(context, next) {
        var previous = context.stage ? context.stage.focus : null;
        context.stage = next;
        if (next.focus !== previous && next.focus !== null) {
            log("info", "stage " + context.key + " focus -> " + next.focus);
        }
        applyContext(context);
    }

    function stageTargetAt(rects, draggedId, point) {
        var ids = Object.keys(rects).filter(function (id) {
            return id !== draggedId && api.geometry.contains(rects[id], point);
        });
        return ids.length ? ids[0] : null;
    }

    // Dropped on the focus slot or a rail cell: swap slots; elsewhere: spring back.
    function dropInStage(state, point) {
        var context = state.context;
        var target = point ? stageTargetAt(stageRects(context), state.id,
            {x: point.x, y: point.y}) : null;
        if (!target) {
            applyContext(context);
            return;
        }
        setStage(context, api.stage.swap(context.stage, state.id, target));
    }

    // Which edge of the focus window the dragged side corresponds to, per slot.
    function stageEdgeName(stage, id, side) {
        if (stage.focus === id) {
            if (side === "left") { return "focus-left"; }
            return side === "right" ? "focus-right" : null;
        }
        var cell = stage.cells.filter(function (item) { return item.window === id; })[0];
        if (!cell) { return null; }
        if (cell.side === "left" && side === "right") { return "left-rail"; }
        if (cell.side === "right" && side === "left") { return "right-rail"; }
        return null;
    }

    // Only the focus ratio changes: it is derived from the sides that moved.
    function resizeStage(state, drag) {
        var context = state.context;
        var end = roundedRect(property(state.window, "frameGeometry"));
        var start = drag.startGeometry;
        var ratios = [];
        if (context.stage && start && end) {
            changedSides(start, end).forEach(function (change) {
                var where = stageEdgeName(context.stage, state.id, change.side);
                if (!where) { return; }
                var ratio = api.stage.focusRatioForEdge(workArea(context),
                    contextGaps(context), where, change.coord);
                if (ratio !== null) { ratios.push(ratio); }
            });
        }
        if (ratios.length) {
            context.focusRatio = clampFocusRatio(ratios.reduce(function (sum, value) {
                return sum + value;
            }, 0) / ratios.length, config.focusRatio);
            log("debug", "focus ratio " + context.key + " -> " + context.focusRatio);
        }
        applyContext(context);
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
        if (state.mode === "tiled") { floating(state); }
        else if (state.mode === "arranged") { detachFromGroup(state); }
        else { tiling(state); }
    }

    function snap(action) {
        var state = activeState();
        if (!state) { return; }
        var current = roundedRect(property(state.window, "frameGeometry"));
        if (state.mode === "arranged") { detachFromGroup(state); }
        if (state.mode === "tiled") { floating(state); }
        var area = workArea(state.context);
        var rect = api.snapRect(action, area, contextGaps(state.context), current);
        state.floatGeometry = rect;
        state.floatWorkArea = area;
        setGeometry(state.window, rect);
        scheduleSave();
    }

    function dock(side) {
        var state = activeState();
        if (!state || state.mode !== "tiled" || stageLayout(state.context)) { return; }
        state.context.tree = api.tree.dockToSide(state.context.tree, state.id, side);
        state.context.adopted = true;
        applyContext(state.context);
    }

    // The active window when it is tiled in a context without an arrangement.
    function tiledActive() {
        var state = activeState();
        if (!state || state.mode !== "tiled" || state.context.groups.length) { return null; }
        return state;
    }

    function moveToward(direction) {
        var state = tiledActive();
        if (!state) { return; }
        var context = state.context;
        var target = api.neighbour(contextRects(context), state.id, direction);
        if (target === null) { return; }
        if (stageLayout(context)) {
            var next = api.stage.swap(context.stage, state.id, target);
            if (JSON.stringify(next) !== JSON.stringify(context.stage)) {
                setStage(context, next);
            }
            return;
        }
        context.tree = api.tree.swap(context.tree, state.id, target);
        context.adopted = true;
        applyContext(context);
    }

    function onDesktop(window, desktop) {
        if (property(window, "onAllDesktops") === true) { return true; }
        var list = property(window, "desktops");
        return !list || list.length === 0 || list.indexOf(desktop) >= 0;
    }

    function visibleOn(window, context) {
        return property(window, "normalWindow") === true &&
            !property(window, "minimized") && !property(window, "desktopWindow") &&
            outputName(property(window, "output")) === context.outputName &&
            onDesktop(window, context.desktop);
    }

    // The other windows on the state's output and desktop. Only unmanaged and floating
    // windows follow a shared edge; tiled, arranged and Stage windows are fixed obstacles.
    function otherWindows(state) {
        var items = [];
        workspace.windowList().forEach(function (window, index) {
            if (window === state.window || !visibleOn(window, state.context)) { return; }
            var id = windowId(window);
            var other = id === null ? null : states.get(id);
            items.push({
                id: id === null ? "window-" + index : id,
                window: window,
                rect: roundedRect(property(window, "frameGeometry")),
                movable: !other || other.mode === "float"
            });
        });
        return items;
    }

    function moveOther(item, geometry) {
        if (api.geometry.equalRects(item.rect, geometry)) { return; }
        setGeometry(item.window, geometry);
        var other = states.get(item.id);
        if (!other) { return; }
        other.floatGeometry = roundedRect(geometry);
        other.floatWorkArea = workArea(other.context);
    }

    function placeFloat(state, current, next, area) {
        state.floatGeometry = next;
        state.floatWorkArea = area;
        if (!api.geometry.equalRects(current, next)) { setGeometry(state.window, next); }
        scheduleSave();
    }

    // axis: "h", "v" or "both"; shared edges move the neighbours too (see resizeNeighbours)
    function resizeFloating(state, axis, delta) {
        var area = workArea(state.context);
        var current = roundedRect(property(state.window, "frameGeometry"));
        var items = otherWindows(state);
        var result = api.resizeNeighbours(current, items, area, contextGaps(state.context),
            axis, delta);
        result.moves.forEach(function (move) {
            moveOther(items.filter(function (item) { return item.id === move.id; })[0], move.rect);
        });
        placeFloat(state, current, result.rect, area);
    }

    function fillFloating(state) {
        var area = workArea(state.context);
        var current = roundedRect(property(state.window, "frameGeometry"));
        var next = api.fillRect(otherWindows(state).map(function (item) { return item.rect; }),
            area, contextGaps(state.context));
        if (next) { placeFloat(state, current, next, area); }
    }

    // Only the focus window's width means anything in Stage: it changes the focus ratio.
    function resizeStageFocus(state, axis, delta) {
        var context = state.context;
        if (axis !== "h" || !context.stage || context.stage.focus !== state.id) { return; }
        var ratio = api.stage.focusRatioAfterGrow(workArea(context), contextGaps(context),
            stageRatio(context), delta);
        if (ratio === null) { return; }
        context.focusRatio = clampFocusRatio(ratio, stageRatio(context));
        applyContext(context);
    }

    function resizeTiled(state, axis, delta) {
        var context = state.context;
        if (stageLayout(context)) {
            resizeStageFocus(state, axis, delta);
            return;
        }
        var next = api.tree.resizeBy(context.tree, workArea(context), contextGaps(context),
            state.id, axis, delta, MIN_PANE);
        if (!next) { return; }
        context.tree = next;
        context.adopted = true;
        applyContext(context);
    }

    function resizeByKey(axis, sign) {
        var state = activeState();
        if (!state || state.mode === "arranged") { return; }
        var delta = sign * config.resizeStep;
        if (state.mode === "float") {
            resizeFloating(state, axis, delta);
            return;
        }
        if (state.context.groups.length) { return; }
        var axes = axis === "both" ? ["h", "v"] : [axis];
        axes.forEach(function (name) { resizeTiled(state, name, delta); });
    }

    function fillByKey() {
        var state = activeState();
        if (state && state.mode === "float") { fillFloating(state); }
    }

    function changeMasters(delta) {
        var state = tiledActive();
        if (!state || state.context.layout !== "master") { return; }
        var context = state.context;
        var current = effectiveMasters(context);
        var next = api.tree.clampMasterCount(current, delta, context.ids.length);
        if (next === current) { return; }
        context.nMaster = next;
        context.ids = orderedIds(context);
        rebuild(context);
        applyContext(context);
        log("info", "masters " + context.key + " -> " + next);
    }

    function contextStates(context) {
        var members = [];
        states.forEach(function (state) {
            if (state.context.key === context.key) { members.push(state); }
        });
        return members;
    }

    function floatEach(context, members) {
        members.forEach(function (state) { state.mode = "float"; });
        context.ids = context.ids.filter(function (id) {
            return members.indexOf(states.get(id)) < 0;
        });
        rebuild(context);
        members.forEach(function (state) {
            if (!state.floatGeometry) { return; }
            state.floatGeometry = restoreFloatGeometry(state);
            setGeometry(state.window, state.floatGeometry);
        });
        if (!context.ids.length) { discardIfEmpty(context); }
    }

    function tileEach(context, members) {
        members.sort(function (a, b) { return a.seq - b.seq; });
        members.forEach(function (state) {
            state.floatGeometry = roundedRect(property(state.window, "frameGeometry"));
            state.floatWorkArea = workArea(context);
            state.mode = "tiled";
            state.context = context;
            context.ids.push(state.id);
        });
        contexts.set(context.key, context);
        rebuild(context);
        applyContext(context);
    }

    // Floats every tiled window of the active window's context, or, when none is tiled,
    // tiles the floating ones again in arrival order.
    function floatAll() {
        var active = activeState();
        if (!active) { return; }
        var context = contexts.get(active.context.key) || active.context;
        var members = contextStates(context);
        var tiled = members.filter(function (state) { return state.mode === "tiled"; });
        if (tiled.length) { floatEach(context, tiled); }
        else {
            tileEach(context, members.filter(function (state) { return state.mode === "float"; }));
        }
        scheduleSave();
    }

    function promoteActive() {
        var state = tiledActive();
        if (!state) { return; }
        var context = state.context;
        if (stageLayout(context)) {
            promoteActivated(state);
            return;
        }
        var order = orderedIds(context);
        if (order[0] === state.id) { return; }
        context.ids = [state.id].concat(order.filter(function (id) { return id !== state.id; }));
        rebuild(context);
        applyContext(context);
    }

    function installKeyShortcuts() {
        ["Left", "Right", "Up", "Down"].forEach(function (label) {
            shortcut("Move " + label, function () { moveToward(label.toLowerCase()); });
        });
        shortcut("Resize Grow", function () { resizeByKey("both", 1); });
        shortcut("Resize Shrink", function () { resizeByKey("both", -1); });
        shortcut("Resize Fill", fillByKey);
        shortcut("Resize Grow Width", function () { resizeByKey("h", 1); });
        shortcut("Resize Shrink Width", function () { resizeByKey("h", -1); });
        shortcut("Resize Grow Height", function () { resizeByKey("v", 1); });
        shortcut("Resize Shrink Height", function () { resizeByKey("v", -1); });
        shortcut("Master More", function () { changeMasters(1); });
        shortcut("Master Fewer", function () { changeMasters(-1); });
        shortcut("Float All", floatAll);
        shortcut("Promote", promoteActive);
    }

    function installShortcuts() {
        installKeyShortcuts();
        shortcut("Toggle Float", toggleFloat);
        ["Left Half", "Right Half", "Top Half", "Bottom Half", "Top Left",
            "Top Right", "Bottom Left", "Bottom Right", "Maximize", "Center Quarter",
            "Third", "Two Thirds"].forEach(function (label) {
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
            if (state.mode === "arranged") {
                applyGroup(state.context);
                return;
            }
            rebuild(state.context);
            applyContext(state.context);
        });
        shortcut("Dock Left", function () { dock("left"); });
        shortcut("Dock Right", function () { dock("right"); });
        shortcut("Layout Next", function () { cycleLayout(1); });
        shortcut("Layout Previous", function () { cycleLayout(-1); });
        api.tree.CYCLE_LAYOUTS.forEach(function (name) {
            var label = name.replace(/^./, function (c) { return c.toUpperCase(); });
            shortcut("Layout " + label, function () { switchLayout(name); });
        });
        shortcut("Stage Pin", function () { stagePin(true); });
        shortcut("Stage Unpin", function () { stagePin(false); });
        shortcut("Stage Cycle Next", function () { stageCycle(1); });
        shortcut("Stage Cycle Previous", function () { stageCycle(-1); });
        shortcut("Arrange Next", function () { arrangeStep(1); });
        shortcut("Arrange Previous", function () { arrangeStep(-1); });
        shortcut("Arrange Reapply", function () { reapplyGroup(); });
        shortcut("Arrange Release", function () { releaseCommand(); });
    }

    function onActivated(window) {
        settleEvent();
        var id = windowId(window);
        if (id === null) { return; }
        activationTick++;
        activation.set(id, activationTick);
        var own = ownActivation === id;
        ownActivation = null;
        var state = states.get(id);
        if (!state || state.mode !== "tiled") { return; }
        if (state.context.layout === "monocle") { raiseWindow(window); }
        else if (stageLayout(state.context) && !own) { promoteActivated(state); }
    }

    // Focusing a managed window in a Stage context swaps it into the focus slot.
    function promoteActivated(state) {
        var context = state.context;
        if (!context.stage || context.stage.focus === state.id) { return; }
        var next = api.stage.promote(context.stage, state.id);
        if (next.focus !== context.stage.focus) { setStage(context, next); }
    }

    function activateOwn(id) {
        var state = id === null ? null : states.get(id);
        if (!state) { return; }
        ownActivation = id;
        try { workspace.activeWindow = state.window; }
        catch (error) { logError("activate " + id, error); ownActivation = null; }
    }

    function stageContext() {
        var context = activeContext();
        return context && stageLayout(context) && context.stage ? context : null;
    }

    function stagePin(pinned) {
        var state = activeState();
        var context = stageContext();
        if (!state || !context || state.mode !== "tiled") { return; }
        context.stage = pinned ? api.stage.pin(context.stage, state.id) :
            api.stage.unpin(context.stage, state.id);
    }

    function stageCycle(direction) {
        var context = stageContext();
        if (!context) { return; }
        var next = api.stage.cycle(context.stage, direction);
        if (next.focus === context.stage.focus) { return; }
        setStage(context, next);
        activateOwn(next.focus);
    }

    function raiseWindow(window) {
        if (typeof workspace.raiseWindow !== "function") { return; }
        try { workspace.raiseWindow(window); }
        catch (error) { logError("raise window", error); }
    }

    function activeContext() {
        var state = activeState();
        return state ? contextFor(state.window) : null;
    }

    function orderedIds(context) {
        var order = stageLayout(context) && context.stage ?
            api.stage.order(context.stage) : api.tree.leafOrder(context.tree);
        var inTree = order.filter(function (id) {
            return context.ids.indexOf(id) >= 0;
        });
        var missing = context.ids.filter(function (id) { return inTree.indexOf(id) < 0; });
        return inTree.concat(missing);
    }

    function switchLayout(name) {
        var context = activeContext();
        if (!context || !api.tree.validAnyLayout(name)) { return; }
        var wasStage = stageLayout(context);
        context.ids = orderedIds(context);
        context.layout = name;
        if (name === "stage") { enterStage(context, wasStage); }
        else { rebuild(context); }
        log("info", "layout " + context.key + " -> " + name);
        if (context.ids.length) { applyContext(context); }
        var state = activeState();
        if (name === "monocle" && state && state.mode === "tiled") {
            raiseWindow(state.window);
        }
    }

    // Builds the stage from the current order; the active window takes the focus.
    function enterStage(context, wasStage) {
        if (wasStage) { return; }
        var active = activeState();
        var focus = active && active.mode === "tiled" && active.context.key === context.key ?
            active.id : null;
        context.stage = api.stage.fromOrder(context.ids, focus);
        context.adopted = false;
        context.innerGap = null;
    }

    function cycleLayout(step) {
        var context = activeContext();
        if (!context) { return; }
        switchLayout(api.tree.cycleAnyLayout(context.layout, step));
    }

    function copyGroup(group) {
        return Object.assign({}, group, {assignments: group.assignments.slice()});
    }

    function coreContext(context, groups) {
        var windows = [];
        states.forEach(function (state) {
            if (state.context.key !== context.key) { return; }
            windows.push({
                id: state.id,
                mode: state.mode,
                floatGeom: state.floatGeometry,
                groupId: state.groupId
            });
        });
        return {windows: windows, tree: context.tree, groups: groups.map(copyGroup)};
    }

    function groupMemberIds(context) {
        var ids = [];
        context.groups.forEach(function (group) {
            group.assignments.forEach(function (id) {
                if (id !== null) { ids.push(id); }
            });
        });
        return ids;
    }

    function applyGroup(context) {
        var group = context.groups[0];
        if (!group) { return; }
        var rects = api.arrangement.applyTemplate(group.template, workArea(context),
            contextGaps(context));
        group.assignments.forEach(function (id, index) {
            var state = id === null ? null : states.get(id);
            if (!state || state.mode !== "arranged" || state.groupId !== group.id) { return; }
            if (!onContextOutput(state.window, context)) { return; }
            setGeometry(state.window, rects[index]);
        });
    }

    // Empties the window's slot; the group is dropped (and tiling resumes) only
    // when no slot has a window any more.
    function clearSlot(context, state) {
        var next = api.toFloat(coreContext(context, context.groups), state.id);
        context.groups = next.groups.filter(function (group) {
            return group.assignments.some(function (id) { return id !== null; });
        });
        if (!context.groups.length && context.ids.length) { applyContext(context); }
    }

    // Arranged -> floating, left where it is; also used when it leaves the context.
    function detachFromGroup(state) {
        var context = state.context;
        state.floatGeometry = roundedRect(property(state.window, "frameGeometry"));
        state.floatWorkArea = workArea(context);
        clearSlot(context, state);
        state.mode = "float";
        state.groupId = null;
        state.prevMode = null;
        scheduleSave();
    }

    function leaveArrangement(state) {
        var wasTiled = state.prevMode === "tiled";
        state.groupId = null;
        state.prevMode = null;
        if (wasTiled) {
            state.mode = "tiled";
            joinTiling(state.context, state.id);
            return;
        }
        state.mode = "float";
        state.floatGeometry = restoreFloatGeometry(state);
        setGeometry(state.window, state.floatGeometry);
    }

    // Arrival order, so windows rejoining the tiling keep their old relative order.
    function inArrivalOrder(ids) {
        return ids.slice().sort(function (a, b) { return states.get(a).seq - states.get(b).seq; });
    }

    function templateNames() {
        return Object.keys(templates);
    }

    function candidateEntries(context) {
        var entries = [];
        states.forEach(function (state) {
            if (state.context.key !== context.key) { return; }
            entries.push({id: state.id, tick: activation.get(state.id) || 0, seq: state.seq});
        });
        return entries;
    }

    function arrangeWith(name) {
        var template = templates[name];
        var active = activeState();
        if (!template || !active) { return; }
        var context = contextFor(active.window);
        var chosen = api.arrangement.pickWindows(active.id, candidateEntries(context),
            template.slots.length);
        var old = context.groups[0];
        var members = old ? groupMemberIds(context) : [];
        inArrivalOrder(members).forEach(function (id) {
            if (chosen.indexOf(id) < 0) { leaveArrangement(states.get(id)); }
        });
        var group = {id: "g" + (++groupSeq), name: name, template: template,
            assignments: api.arrangement.assign(template, chosen).slots};
        var wasTiled = [];
        var core = coreContext(context, [group]);
        chosen.forEach(function (id) {
            var state = states.get(id);
            state.context = context;
            var frame = null;
            if (state.mode !== "arranged") {
                state.prevMode = state.mode;
                if (state.mode === "tiled") { wasTiled.push(id); }
                if (state.mode === "float") {
                    frame = roundedRect(property(state.window, "frameGeometry"));
                }
            }
            core = api.toArrange(core, id, group.id, frame || undefined);
        });
        chosen.forEach(function (id) {
            var state = states.get(id);
            var record = core.windows.filter(function (item) { return item.id === id; })[0];
            state.mode = "arranged";
            state.groupId = group.id;
            if (record.floatGeom) { state.floatGeometry = roundedRect(record.floatGeom); }
        });
        context.ids = context.ids.filter(function (id) { return wasTiled.indexOf(id) < 0; });
        if (context.adopted) { context.tree = core.tree; } else { rebuild(context); }
        group.assignments = core.groups[0].assignments;
        context.groups = [group];
        contexts.set(context.key, context);
        log("info", "arrange " + context.key + " -> " + name);
        applyGroup(context);
        scheduleSave();
    }

    function arrangeStep(step) {
        var context = activeContext();
        if (!context) { return; }
        var group = context.groups[0];
        var name = api.arrangement.cycleName(templateNames(), group ? group.name : null, step);
        if (name !== null) { arrangeWith(name); }
    }

    function reapplyGroup() {
        var context = activeContext();
        if (context) { applyGroup(context); }
    }

    function releaseCommand() {
        var context = activeContext();
        var group = context && context.groups[0];
        if (!group) { return; }
        var ids = inArrivalOrder(groupMemberIds(context));
        context.groups = [];
        ids.forEach(function (id) { leaveArrangement(states.get(id)); });
        log("info", "release " + context.key);
        if (context.ids.length) { applyContext(context); }
        scheduleSave();
    }

    function refreshConfig() {
        settleEvent();
        loadConfig();
        Array.from(states.values()).forEach(function (state) {
            if (!manages(String(property(state.window, "resourceClass") || ""))) {
                removeWindow(state.window);
            }
        });
        contexts.forEach(function (context) {
            context.innerGap = null;
            applyContext(context);
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
            context.ids.concat(groupMemberIds(context)).forEach(function (id) {
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
        connect(workspace, "windowActivated", onActivated);
        connect(workspace, "aboutToQuit", aboutToQuit);
        connect(property(host, "qApp"), "aboutToQuit", aboutToQuit);
        connect(workspace, "screensChanged", outputsChanged);
        connect(workspace, "outputsChanged", outputsChanged);
        var optionSettings = property(host, "options");
        if (optionSettings && property(optionSettings, "configChanged") !== undefined) {
            connect(optionSettings, "configChanged", refreshConfig);
        } else if (property(workspace, "configChanged") !== undefined) {
            // Keep the test adapter and older KWin wrappers working.
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
