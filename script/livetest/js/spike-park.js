// Spike: park windows by minimizing (kcalc windows only). Prints SPIKE lines.
(function () {
    var out = function (o) { print("SPIKE " + JSON.stringify(o)); };
    var wins = workspace.windowList().filter(function (w) {
        return String(w.resourceClass).indexOf("kcalc") >= 0;
    });
    if (wins.length < 4) { out({ error: "need 4 kcalc, got " + wins.length }); out({ done: true }); return; }
    wins = wins.slice(0, 4);
    var ids = wins.map(function (w) { return String(w.internalId); });
    var now = function () { return Date.now(); };
    var later = function (ms, fn) {
        var t = new QTimer(); t.singleShot = true; t.interval = ms;
        t.timeout.connect(function () { fn(); });
        t.start();
    };
    var geo = function (w) { var g = w.frameGeometry; return [g.x, g.y, g.width, g.height]; };
    var cnt = { minChanged: 0, activated: [], geoTimes: [] };
    var cur = null;
    wins.forEach(function (w, i) {
        w.minimizedChanged.connect(function () { cnt.minChanged++; if (cur) cur.sigT = cur.sigT || (now() - cur.t0); cur && (cur.sigCount = (cur.sigCount || 0) + 1); });
        w.frameGeometryChanged.connect(function () { if (cur && cur.id === i) cur.lastGeo = now() - cur.t0; });
    });
    workspace.windowActivated.connect(function (w) {
        cnt.activated.push((w ? ids.indexOf(String(w.internalId)) : -1) + "@" + (cur ? (now() - cur.t0) : "-"));
    });
    // tile side by side
    var out0 = wins[0].output;
    var area = workspace.clientArea(KWin.PlacementArea, out0, workspace.currentDesktop);
    var W = Math.floor(area.width / 4);
    var tileH = Math.min(area.height, 500);
    var orig = [];
    wins.forEach(function (w, i) {
        orig.push(geo(w));
        w.frameGeometry = { x: area.x + i * W, y: area.y, width: W, height: tileH };
    });
    var res = { runs: [], geomSurvive: [], desktopOutputKept: [] };
    var run = 0, phase = 0, step;
    var tiled;
    var startRun = function () {
        var id = run % 2; var w = wins[id];
        cur = { id: id, t0: now(), sigT: null, lastGeo: null, sigCount: 0 };
        cnt.minChanged = 0;
        var before = geo(w), dBefore = String(w.desktops.map(function (d) { return d.id; })), oBefore = String(w.output.name);
        w.minimized = true;
        later(400, function () {
            var m = { id: id, op: "min", sigMs: cur.sigT, lastGeoMs: cur.lastGeo, sigCount: cur.sigCount, geoAfter: geo(w), geoBefore: before };
            var cm = cur;
            cur = { id: id, t0: now(), sigT: null, lastGeo: null, sigCount: 0 };
            w.minimized = false;
            later(400, function () {
                var r = { id: id, op: "restore", sigMs: cur.sigT, lastGeoMs: cur.lastGeo, sigCount: cur.sigCount, geoAfter: geo(w) };
                res.runs.push([m, r]);
                res.geomSurvive.push(JSON.stringify(before) === JSON.stringify(geo(w)));
                res.desktopOutputKept.push(dBefore === String(w.desktops.map(function (d) { return d.id; })) && oBefore === String(w.output.name));
                run++;
                if (run < 10) startRun(); else phase2();
            });
        });
    };
    var phase2 = function () {
        cur = null;
        var p = {};
        var w2 = wins[2], w3 = wins[3];
        workspace.activeWindow = w2;
        later(300, function () {
            p.activeBefore = ids.indexOf(String(workspace.activeWindow && workspace.activeWindow.internalId));
            cnt.activated = [];
            cur = { t0: now() };
            w2.minimized = true;
            later(400, function () {
                var a = workspace.activeWindow;
                p.activeAfterMinimizeActive = a ? (ids.indexOf(String(a.internalId)) >= 0 ? "kcalc#" + ids.indexOf(String(a.internalId)) : "other:" + String(a.resourceClass)) : "none";
                p.activatedEventsOnMinimize = cnt.activated.slice();
                // list / stacking
                p.inWindowList = workspace.windowList().some(function (x) { return String(x.internalId) === ids[2]; });
                p.inStackingOrder = workspace.stackingOrder.some(function (x) { return String(x.internalId) === ids[2]; });
                p.minimizedFlagInStacking = workspace.stackingOrder.filter(function (x) { return String(x.internalId) === ids[2]; }).map(function (x) { return x.minimized; });
                // restore via minimized=false, watch activation
                cnt.activated = []; cur = { t0: now() };
                w2.minimized = false;
                later(400, function () {
                    var a2 = workspace.activeWindow;
                    p.activeAfterRestoreByProp = a2 ? (ids.indexOf(String(a2.internalId)) >= 0 ? "kcalc#" + ids.indexOf(String(a2.internalId)) : "other:" + String(a2.resourceClass)) : "none";
                    p.activatedEventsOnRestore = cnt.activated.slice();
                    // activeWindow = minimized
                    workspace.activeWindow = w3; 
                    later(300, function () {
                        w2.minimized = true;
                        later(300, function () {
                            cnt.activated = []; cur = { t0: now() };
                            var before = w2.minimized;
                            workspace.activeWindow = w2;
                            later(500, function () {
                                p.activeWindowAssignRestores = { minimizedBefore: before, minimizedAfter: w2.minimized, isActive: workspace.activeWindow && String(workspace.activeWindow.internalId) === ids[2], events: cnt.activated.slice() };
                                // restore originals, cleanup state
                                w2.minimized = false;
                                res.phase2 = p;
                                res.origGeo = orig;
                                out(res);
                                out({ done: true });
                            });
                        });
                    });
                });
            });
        });
    };
    later(500, startRun);
})();
