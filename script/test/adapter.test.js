const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const buildFiles = ['geometry', 'tree', 'snap', 'stage', 'scroll', 'arrangement', 'context',
    'persist', 'index'];
const templatesJson = fs.readFileSync(path.join(root, 'core/templates.json'), 'utf8');
const source = buildFiles.map(name => fs.readFileSync(
    path.join(root, 'core', name + '.js'), 'utf8')).concat(
    'var WEAVE_TEMPLATES = ' + templatesJson + ';',
    fs.readFileSync(path.join(root, 'script/src/adapter.js'), 'utf8')).join('\n');

function signal() {
    const handlers = [];
    return {
        connect(handler) { handlers.push(handler); },
        disconnect(handler) { const i = handlers.indexOf(handler); if (i >= 0) handlers.splice(i, 1); },
        emit(...args) { handlers.slice().forEach(handler => handler(...args)); }
    };
}

function makeWindow(id, options = {}) {
    const geometryChanged = signal();
    const tileChanged = signal();
    const signals = {
        frameGeometryChanged: geometryChanged,
        tileChanged,
        minimizedChanged: signal(),
        interactiveMoveResizeStarted: signal(),
        interactiveMoveResizeFinished: signal(),
        outputChanged: signal(),
        desktopsChanged: signal(),
        desktopChanged: signal()
    };
    let geometry = options.frameGeometry || {x: 0.4, y: 0.2, width: 799.6, height: 600.5};
    let geometryWrites = 0;
    let minimized = !!options.minimized;
    let minimizedWrites = 0;
    let tile = null;
    const window = Object.assign(signals, {
        internalId: id,
        resourceClass: options.resourceClass === undefined ? 'editor' : options.resourceClass,
        caption: options.caption === undefined ? 'Window ' + id : options.caption,
        normalWindow: options.normalWindow === undefined ? true : options.normalWindow,
        fullScreen: !!options.fullScreen,
        dialog: !!options.dialog,
        transientFor: options.transientFor || null,
        output: options.output || 'DP-1',
        minSize: options.minSize,
        move: false,
        resize: false,
        frameGeometry: geometry,
        tile: tile
    });
    Object.defineProperty(window, 'minimized', {
        get() { return minimized; },
        set(value) {
            minimizedWrites++;
            if (minimized === value) return;
            minimized = value;
            window.minimizedChanged.emit();
            if (window.onMinimized) window.onMinimized(value);
        }
    });
    Object.defineProperty(window, 'minimizedWrites', {get() { return minimizedWrites; }});
    Object.defineProperty(window, 'frameGeometry', {
        get() { return geometry; },
        set(value) {
            geometryWrites++;
            geometry = Object.assign({}, value);
            geometryChanged.emit();
        }
    });
    Object.defineProperty(window, 'geometryWrites', {get() { return geometryWrites; }});
    Object.defineProperty(window, 'tile', {
        get() { return tile; },
        set(value) {
            tile = value;
            tileChanged.emit();
        }
    });
    return window;
}

function harness(settings = {}, options = {}) {
    settings = Object.assign({settleSeconds: 0}, settings);
    const shortcuts = new Map();
    const logs = [];
    const added = signal();
    const removed = signal();
    const changed = signal();
    const windows = [];
    let now = 1000;
    const timers = [];
    const workspace = {
        windowAdded: added,
        windowRemoved: removed,
        screensChanged: signal(),
        outputsChanged: signal(),
        windowActivated: signal(),
        configChanged: changed,
        activeWindow: null,
        cursorPos: {x: 500, y: 400},
        screens: options.screens || ['DP-1', 'DP-2'],
        desktops: Object.assign({}, options.desktops || {}),
        currentDesktopForScreen(output) {
            const name = typeof output === 'string' ? output : output.name;
            return this.desktops[name] === undefined ? 2 : this.desktops[name];
        },
        clientArea(unused, output) {
            const name = typeof output === 'string' ? output : output.name;
            return options.areas && options.areas[name] ? options.areas[name] :
                {x: 0.4, y: 0.2, width: 1200.4, height: 800.8};
        },
        windowList: () => windows,
        raised: []
    };
    if (!options.noRaise) {
        workspace.raiseWindow = function (window) { this.raised.push(window.internalId); };
    }
    (options.initialWindows || []).forEach(window => windows.push(window));
    const dbusCalls = [];
    const quit = signal();
    workspace.aboutToQuit = quit;
    const host = {
        workspace,
        KWin: {PlacementArea: 0},
        readConfig(name, fallback) {
            return Object.prototype.hasOwnProperty.call(settings, name) ? settings[name] : fallback;
        },
        registerShortcut(name, description, key, handler) {
            shortcuts.set(name, {description, key, handler});
        },
        Date: class { static now() { return now; } },
        startTimer: options.noTimer ? undefined : function (milliseconds, callback) {
            timers.push({due: now + milliseconds, callback});
        },
        print(message) { logs.push(String(message)); }
    };
    if (options.dbus) {
        host.callDBus = function (service, path, iface, method, ...args) {
            const callback = args.pop();
            dbusCalls.push({service, path, iface, method, args});
            if (options.dbus.throws) { throw new Error('no bus'); }
            if (method === 'Get' && options.dbus.deferred) {
                options.dbus.deferred.callback = callback;
            } else if (method === 'Get') {
                callback(options.dbus.reply);
            } else {
                callback();
            }
        };
    }
    const sandbox = vm.createContext({Date: host.Date});
    vm.runInContext(source, sandbox);
    const runtime = sandbox.startWeave(host, sandbox.Weave, sandbox.WEAVE_TEMPLATES);
    function add(window) {
        windows.push(window);
        added.emit(window);
    }
    function remove(window) {
        removed.emit(window);
        const index = windows.indexOf(window);
        if (index >= 0) { windows.splice(index, 1); }
    }
    function advance(milliseconds) {
        const target = now + milliseconds;
        while (true) {
            timers.sort((a, b) => a.due - b.due);
            const next = timers[0];
            if (!next || next.due > target) { break; }
            timers.shift();
            now = next.due;
            next.callback();
        }
        now = target;
    }
    function activate(window) {
        workspace.activeWindow = window;
        workspace.windowActivated.emit(window);
    }
    return {workspace, shortcuts, logs, windows, add, remove, changed, settings,
        advance, now: () => now, dbusCalls, quit, activate, runtime};
}

function geometry(window) {
    return Object.assign({}, window.frameGeometry);
}

function fireShortcut(h, name, window) {
    h.workspace.activeWindow = window;
    h.shortcuts.get('Weave ' + name).handler();
}

test('script is inert by default and every shortcut has an empty default key', () => {
    const h = harness();
    h.add(makeWindow('a'));
    assert.deepEqual(geometry(h.windows[0]), {x: 0.4, y: 0.2, width: 799.6, height: 600.5});
    assert.equal(h.shortcuts.size, 73);
    h.shortcuts.forEach(shortcut => assert.equal(shortcut.key, ''));
});

test('managed windows tile by arrival order with gaps and removal reflows', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a');
    const b = makeWindow('b');
    const c = makeWindow('c');
    h.add(a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 785});
    h.add(b);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 706, height: 785});
    assert.deepEqual(geometry(b), {x: 722, y: 8, width: 470, height: 785});
    h.add(c);
    assert.deepEqual(geometry(c), {x: 722, y: 405, width: 470, height: 388});
    h.remove(a);
    assert.deepEqual(geometry(b), {x: 8, y: 8, width: 706, height: 785});
    assert.deepEqual(geometry(c), {x: 722, y: 8, width: 470, height: 785});
});

test('tiled move inserts at a target edge and springs back when there is no target', () => {
    const h = harness({manageClasses: 'editor', gapInner: 0, gapOuter: 0});
    const a = makeWindow('a');
    const b = makeWindow('b');
    h.add(a);
    h.add(b);
    b.move = true;
    b.interactiveMoveResizeStarted.emit();
    b.frameGeometry = {x: 700, y: 100, width: 500, height: 400};
    h.workspace.cursorPos = {x: geometry(a).x + 2, y: geometry(a).y + 200};
    b.interactiveMoveResizeFinished.emit();
    assert.ok(geometry(b).x < geometry(a).x);
    const reordered = geometry(b);

    b.interactiveMoveResizeStarted.emit();
    b.frameGeometry = {x: 800, y: 200, width: 300, height: 300};
    h.workspace.cursorPos = {x: 5000, y: 5000};
    b.interactiveMoveResizeFinished.emit();
    assert.deepEqual(geometry(b), reordered);
});

test('own and arbitrary geometry events never trigger a relayout', () => {
    const h = harness({manageClasses: 'editor'});
    const a = makeWindow('a');
    h.add(a);
    const afterLayout = geometry(a);
    a.frameGeometryChanged.emit();
    a.frameGeometry = {x: 313, y: 219, width: 99, height: 101};
    a.frameGeometryChanged.emit();
    assert.deepEqual(geometry(a), {x: 313, y: 219, width: 99, height: 101});
    assert.notDeepEqual(geometry(a), afterLayout);
});

test('native tiles are dropped only when configured', () => {
    const enabled = harness({manageClasses: 'editor', dropNativeTiles: true});
    const first = makeWindow('a');
    enabled.add(first);
    first.tile = {name: 'native'};
    assert.equal(first.tile, null, enabled.logs.join('\n'));

    const disabled = harness({manageClasses: 'editor', dropNativeTiles: false});
    const second = makeWindow('b');
    disabled.add(second);
    second.tile = {name: 'native'};
    assert.deepEqual(second.tile, {name: 'native'});
});

test('snap on a tiled window floats it before applying the snap geometry', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a');
    h.add(a);
    fireShortcut(h, 'Snap Left Half', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 588, height: 785});
});

test('fullscreen, empty-class, dialog, non-normal and empty-caption windows are skipped', () => {
    const h = harness({manageClasses: 'editor'});
    const windows = [
        makeWindow('fullscreen', {fullScreen: true}),
        makeWindow('empty-class', {resourceClass: ''}),
        makeWindow('dialog', {dialog: true}),
        makeWindow('non-normal', {normalWindow: false}),
        makeWindow('empty-caption', {caption: ''})
    ];
    windows.forEach(window => h.add(window));
    windows.forEach(window => assert.deepEqual(geometry(window),
        {x: 0.4, y: 0.2, width: 799.6, height: 600.5}));
});

test('fractional work areas and input geometry produce integer geometry output', () => {
    const h = harness({manageClasses: 'editor'});
    const a = makeWindow('a');
    h.add(a);
    Object.values(geometry(a)).forEach(value => assert.equal(Number.isInteger(value), true));
});

test('startup observes arriving windows without geometry writes until settling', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 3});
    const a = makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 706, height: 785}});
    const b = makeWindow('b', {frameGeometry: {x: 722, y: 8, width: 470, height: 785}});
    h.add(a);
    h.advance(1000);
    h.add(b);
    h.advance(2000);
    assert.equal(a.geometryWrites + b.geometryWrites, 0);
    h.advance(1000);
    assert.equal(a.geometryWrites + b.geometryWrites, 0);
    const c = makeWindow('c');
    h.add(c);
    assert.ok(a.geometryWrites + b.geometryWrites + c.geometryWrites > 0);
    assert.ok(Math.abs(geometry(a).width - 706) <= 1);
});

test('settling is extended by each arrival and clean geometry is adopted unchanged', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 2});
    const a = makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 706, height: 785}});
    const b = makeWindow('b', {frameGeometry: {x: 722, y: 8, width: 470, height: 785}});
    h.add(a);
    h.advance(1500);
    h.add(b);
    h.advance(1500);
    assert.equal(a.geometryWrites + b.geometryWrites, 0);
    h.advance(500);
    assert.equal(a.geometryWrites + b.geometryWrites, 0);
    const c = makeWindow('c');
    h.add(c);
    assert.ok(a.geometryWrites + b.geometryWrites + c.geometryWrites > 0);
    assert.ok(Math.abs(geometry(a).width - 706) <= 1);
});

test('non-partitionable startup windows remain floating and untouched', () => {
    const h = harness({manageClasses: 'editor', gapOuter: 8, settleSeconds: 1});
    const windows = [
        makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 500, height: 300}}),
        makeWindow('b', {frameGeometry: {x: 508, y: 8, width: 676, height: 400}}),
        makeWindow('c', {frameGeometry: {x: 20, y: 408, width: 1164, height: 385}})
    ];
    windows.forEach(window => h.add(window));
    h.advance(1000);
    assert.deepEqual(windows.map(window => window.geometryWrites), [0, 0, 0]);
});

test('settleSeconds zero adopts startup geometry and fractional rectangles', () => {
    const a = makeWindow('a', {frameGeometry: {x: 8.4, y: 8.1, width: 706.4,
        height: 784.8}});
    const b = makeWindow('b', {frameGeometry: {x: 722.2, y: 8.1, width: 469.8,
        height: 784.8}});
    const h = harness({manageClasses: 'editor', settleSeconds: 0},
        {initialWindows: [a, b]});
    assert.equal(a.geometryWrites + b.geometryWrites, 0);
    const c = makeWindow('c');
    h.add(c);
    assert.ok(c.geometryWrites > 0);
    assert.ok(Math.abs(geometry(a).width - 706) <= 1);
});

test('lazy settle fallback adopts on the next event after the delay', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 1}, {noTimer: true});
    const a = makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 1184, height: 785}});
    h.add(a);
    h.advance(1000);
    assert.equal(a.geometryWrites, 0);
    fireShortcut(h, 'Toggle Float', a);
    const b = makeWindow('b');
    h.add(b);
    assert.ok(b.geometryWrites > 0);
});

test('output reassignment reflows both contexts and uses a single leaf on the new output', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}
        }
    });
    const a = makeWindow('a');
    const b = makeWindow('b');
    const c = makeWindow('c');
    h.add(a);
    h.add(b);
    h.add(c);
    c.output = 'DP-2';
    c.outputChanged.emit();
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 706, height: 784});
    assert.deepEqual(geometry(b), {x: 722, y: 8, width: 470, height: 784});
    assert.deepEqual(geometry(c), {x: 1208, y: 8, width: 984, height: 784});
    const writes = [a.geometryWrites, b.geometryWrites, c.geometryWrites];
    c.outputChanged.emit();
    assert.deepEqual([a.geometryWrites, b.geometryWrites, c.geometryWrites], writes);
    c.output = 'DP-1';
    c.outputChanged.emit();
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 706, height: 784});
    assert.deepEqual(geometry(b), {x: 722, y: 8, width: 470, height: 388});
    assert.deepEqual(geometry(c), {x: 722, y: 404, width: 470, height: 388});
});

test('desktop changes reassign context and an emptied context can be left behind', () => {
    const h = harness({manageClasses: 'editor', gapOuter: 8}, {
        areas: {'DP-1': {x: 0, y: 0, width: 1200, height: 800}},
        desktops: {'DP-1': 2}
    });
    const a = makeWindow('a');
    h.add(a);
    h.workspace.desktops['DP-1'] = 3;
    a.desktopsChanged.emit();
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 784});
    const before = a.geometryWrites;
    a.desktopChanged.emit();
    assert.equal(a.geometryWrites, before);
});

test('floating windows follow output changes without being relaid', () => {
    const h = harness({manageClasses: 'editor'});
    const a = makeWindow('a');
    h.add(a);
    fireShortcut(h, 'Toggle Float', a);
    const rect = geometry(a);
    const writes = a.geometryWrites;
    a.output = 'DP-2';
    a.outputChanged.emit();
    assert.deepEqual(geometry(a), rect);
    assert.equal(a.geometryWrites, writes);
});

test('cross-output drag inserts at the destination edge and reflows both contexts', () => {
    const h = harness({manageClasses: 'editor', gapInner: 0, gapOuter: 0}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}
        }
    });
    const a = makeWindow('a');
    const b = makeWindow('b', {output: 'DP-2'});
    const c = makeWindow('c');
    h.add(a);
    h.add(b);
    h.add(c);
    c.move = true;
    c.interactiveMoveResizeStarted.emit();
    c.output = 'DP-2';
    c.outputChanged.emit();
    h.workspace.cursorPos = {x: geometry(b).x + 2, y: geometry(b).y + 200};
    c.interactiveMoveResizeFinished.emit();
    assert.deepEqual(geometry(c), {x: 1200, y: 0, width: 500, height: 800});
    assert.deepEqual(geometry(b), {x: 1700, y: 0, width: 500, height: 800});
    assert.deepEqual(geometry(a), {x: 0, y: 0, width: 1200, height: 800});
});

test('reassigned windows regenerate the destination in arrival order', () => {
    const options = {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1200, height: 800}
        }
    };
    const movedHarness = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8}, options);
    const arrivalHarness = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8}, options);
    const moved = ['a', 'b', 'c'].map(id => makeWindow(id));
    const arrivals = ['a', 'b', 'c'].map(id => makeWindow('arrive-' + id,
        {output: 'DP-2'}));
    moved.forEach(window => movedHarness.add(window));
    arrivals.forEach(window => arrivalHarness.add(window));
    moved.forEach(window => {
        window.output = 'DP-2';
        window.outputChanged.emit();
    });
    assert.deepEqual(moved.map(geometry), arrivals.map(geometry));
    assert.deepEqual(moved.map(geometry), [
        {x: 1208, y: 8, width: 706, height: 784},
        {x: 1922, y: 8, width: 470, height: 388},
        {x: 1922, y: 404, width: 470, height: 388}
    ]);
});

test('float restore after output reassignment stays on the new output', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 700}
        }
    });
    const a = makeWindow('a', {frameGeometry: {x: 200, y: 100, width: 500, height: 400}});
    h.add(a);
    a.output = 'DP-2';
    a.outputChanged.emit();
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 1400, y: 100, width: 500, height: 400});
    assert.ok(geometry(a).x >= 1200);
    assert.ok(geometry(a).x + geometry(a).width <= 2200);
});

test('float restore translates straddling rectangles and shrinks oversized ones', () => {
    const h = harness({manageClasses: 'editor'}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 700}
        }
    });
    const a = makeWindow('a', {frameGeometry: {x: 700, y: 100, width: 800, height: 400}});
    h.add(a);
    a.output = 'DP-2';
    a.outputChanged.emit();
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 1400, y: 100, width: 800, height: 400});

    const straddling = makeWindow('straddling', {
        output: 'DP-2',
        frameGeometry: {x: 1100, y: 100, width: 800, height: 400}
    });
    const straddlingHarness = harness({manageClasses: 'editor'}, {
        areas: {'DP-2': {x: 1200, y: 0, width: 1000, height: 700}}
    });
    straddlingHarness.add(straddling);
    fireShortcut(straddlingHarness, 'Toggle Float', straddling);
    assert.deepEqual(geometry(straddling), {x: 1200, y: 100, width: 800, height: 400});

    const oversized = makeWindow('oversized', {
        frameGeometry: {x: -100, y: -100, width: 1600, height: 900}
    });
    const oversizedHarness = harness({manageClasses: 'editor'}, {
        areas: {'DP-1': {x: 0, y: 0, width: 1200, height: 800}}
    });
    oversizedHarness.add(oversized);
    fireShortcut(oversizedHarness, 'Toggle Float', oversized);
    assert.deepEqual(geometry(oversized), {x: 0, y: 0, width: 1200, height: 800});
});

test('moving the only tiled window removes its old context tree', () => {
    const h = harness({manageClasses: 'editor', gapOuter: 8}, {
        areas: {'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}}
    });
    const a = makeWindow('a');
    h.add(a);
    a.output = 'DP-2';
    a.outputChanged.emit();
    assert.deepEqual(geometry(a), {x: 1208, y: 8, width: 984, height: 784});
});

test('output removal migrates windows and drops contexts for vanished screens', () => {
    const h = harness({manageClasses: 'editor', gapOuter: 8}, {
        screens: ['DP-1', 'DP-2'],
        areas: {'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}}
    });
    const a = makeWindow('a');
    h.add(a);
    a.output = 'DP-2';
    h.workspace.screens = ['DP-2'];
    h.workspace.screensChanged.emit();
    assert.deepEqual(geometry(a), {x: 1208, y: 8, width: 984, height: 784});
});

test('observed output changes only record context until startup adoption', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 1}, {
        areas: {'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}}
    });
    const a = makeWindow('a', {
        frameGeometry: {x: 1208, y: 8, width: 984, height: 784}
    });
    h.add(a);
    h.advance(500);
    a.output = 'DP-2';
    a.outputChanged.emit();
    assert.equal(a.geometryWrites, 0);
    h.advance(500);
    assert.equal(a.geometryWrites, 0);
    const b = makeWindow('b', {output: 'DP-2'});
    h.add(b);
    assert.ok(a.geometryWrites + b.geometryWrites > 0);
});

test('a window already moved to another output is not pulled back by a pending reflow', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}
        }
    });
    const a = makeWindow('a');
    const b = makeWindow('b');
    const c = makeWindow('c');
    h.add(a);
    h.add(b);
    h.add(c);
    a.output = 'DP-2';
    b.output = 'DP-2';
    const writes = a.geometryWrites;
    b.outputChanged.emit();
    assert.equal(a.geometryWrites, writes, 'pending window is left alone, not forced back');
    a.outputChanged.emit();
    assert.ok(geometry(a).x >= 1200);
    assert.ok(geometry(b).x >= 1200);
    assert.deepEqual(geometry(c), {x: 8, y: 8, width: 1184, height: 784});
});

const Weave = require('../../core');

function saved(records) {
    return Weave.serialize(records.map(item => ({
        key: Weave.keyOf('editor', item.caption),
        mode: item.mode,
        floatGeom: item.floatGeom,
        geom: item.geom,
        ctx: {outputName: 'DP-1', desktop: 2},
        seen: 1
    })), 2);
}

function sets(h) {
    return h.dbusCalls.filter(call => call.method === 'Set');
}

function loginWindows() {
    return [
        makeWindow('a', {caption: 'Alpha 1', frameGeometry: {x: 8, y: 8, width: 706,
            height: 785}}),
        makeWindow('b', {caption: 'Beta 2', frameGeometry: {x: 722, y: 8, width: 470,
            height: 785}}),
        makeWindow('c', {caption: 'Gamma 3', frameGeometry: {x: 300, y: 300, width: 400,
            height: 300}})
    ];
}

const loginReply = saved([
    {caption: 'Alpha', mode: 'tiled', floatGeom: {x: 50, y: 60, width: 300, height: 200},
        geom: {x: 8, y: 8, width: 706, height: 785}},
    {caption: 'Beta', mode: 'tiled', floatGeom: {x: 400, y: 80, width: 320, height: 220},
        geom: {x: 722, y: 8, width: 470, height: 785}},
    {caption: 'Gamma', mode: 'float', floatGeom: {x: 20, y: 30, width: 410, height: 310},
        geom: {x: 300, y: 300, width: 400, height: 300}}
]);

test('login: saved float window stays out of the tree and nothing moves while settling', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 3},
        {dbus: {reply: loginReply}});
    const [a, b, c] = loginWindows();
    [a, b, c].forEach(window => h.add(window));
    assert.equal(h.dbusCalls.length, 1);
    assert.deepEqual(h.dbusCalls[0].args, []);
    assert.equal(h.dbusCalls[0].method, 'Get');
    h.advance(2999);
    assert.deepEqual([a, b, c].map(window => window.geometryWrites), [0, 0, 0]);
    h.advance(1);
    assert.deepEqual([a, b, c].map(window => window.geometryWrites), [0, 0, 0]);
    assert.equal(sets(h).length, 0);
    assert.deepEqual(geometry(c), {x: 300, y: 300, width: 400, height: 300});
    const d = makeWindow('d', {caption: 'Delta'});
    h.add(d);
    assert.ok(a.geometryWrites > 0 && b.geometryWrites > 0 && d.geometryWrites > 0);
    assert.equal(c.geometryWrites, 0);
    h.advance(2000);
    const records = JSON.parse(sets(h)[0].args[0]).records;
    const gamma = records.find(item => item.key.captionPattern === 'gamma');
    assert.equal(gamma.mode, 'float');
    assert.deepEqual(gamma.floatGeom, {x: 20, y: 30, width: 410, height: 310});
    const alpha = records.find(item => item.key.captionPattern === 'alpha');
    assert.equal(alpha.mode, 'tiled');
    assert.deepEqual(alpha.floatGeom, {x: 50, y: 60, width: 300, height: 200});
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 50, y: 60, width: 300, height: 200});
});

test('without saved data the same three windows are not partitionable and stay put', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 1},
        {dbus: {reply: '{}'}});
    const windows = loginWindows();
    windows.forEach(window => h.add(window));
    h.advance(1000);
    h.add(makeWindow('d', {caption: 'Delta'}));
    assert.deepEqual(windows.map(window => window.geometryWrites), [0, 0, 0]);
});

test('adoption waits for a delayed Get reply and gives up after two seconds', () => {
    const deferred = {};
    const h = harness({manageClasses: 'editor', settleSeconds: 1},
        {dbus: {deferred}});
    const [a, b, c] = loginWindows();
    [a, b, c].forEach(window => h.add(window));
    h.advance(1500);
    h.advance(400);
    assert.equal(a.geometryWrites + b.geometryWrites + c.geometryWrites, 0);
    deferred.callback(loginReply);
    const e = makeWindow('e', {caption: 'Epsilon'});
    h.add(e);
    assert.equal(c.geometryWrites, 0);
    assert.ok(a.geometryWrites > 0);

    const silent = harness({manageClasses: 'editor', settleSeconds: 1},
        {dbus: {deferred: {}}});
    const x = makeWindow('x', {frameGeometry: {x: 8, y: 8, width: 1184, height: 785}});
    silent.add(x);
    silent.advance(1000);
    silent.advance(2000);
    silent.add(makeWindow('y'));
    assert.ok(x.geometryWrites > 0);
    fireShortcut(silent, 'Toggle Float', x);
    silent.advance(5000);
    assert.equal(sets(silent).length, 0);
});

test('persistence is off when callDBus is missing, throws or the reply is not text', () => {
    const variants = [{}, {dbus: {throws: true}}, {dbus: {reply: undefined}}];
    variants.forEach(options => {
        const h = harness({manageClasses: 'editor', settleSeconds: 1, logLevel: 'debug'},
            options);
        const a = makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 1184, height: 785}});
        h.add(a);
        h.advance(1000);
        assert.equal(a.geometryWrites, 0);
        const b = makeWindow('b');
        h.add(b);
        assert.ok(b.geometryWrites > 0);
        fireShortcut(h, 'Toggle Float', b);
        h.advance(5000);
        h.quit.emit();
        assert.equal(sets(h).length, 0);
        assert.equal(h.logs.filter(line => line.includes('persistence off')).length, 1);
    });
});

test('persistence works through the injected host API', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 0, logLevel: 'debug'},
        {dbus: {reply: '{}'}});
    h.add(makeWindow('a'));
    fireShortcut(h, 'Toggle Float', h.windows[0]);
    h.advance(5000);
    assert.equal(h.dbusCalls.filter(call => call.method === 'Get').length, 1);
    assert.ok(sets(h).length >= 1);
    assert.ok(h.logs.some(line => line.includes('persistence ready')));
});

test('without any timer a late Get reply is still used and a missing one times out', () => {
    const deferred = {};
    const h = harness({manageClasses: 'editor', settleSeconds: 0, logLevel: 'debug'},
        {dbus: {deferred}, noTimer: true});
    h.add(makeWindow('a'));
    assert.equal(h.logs.filter(line => line.includes('persistence off')).length, 0);
    deferred.callback('{}');
    assert.ok(h.logs.some(line => line.includes('persistence ready')));
    const never = harness({manageClasses: 'editor', settleSeconds: 0, logLevel: 'debug'},
        {dbus: {deferred: {}}, noTimer: true});
    never.add(makeWindow('b'));
    never.advance(3000);
    never.add(makeWindow('c'));
    assert.ok(never.logs.some(line => line.includes('Get timed out')));
});

test('persist=false and an empty manageClasses never touch D-Bus', () => {
    const off = harness({manageClasses: 'editor', persist: false, settleSeconds: 0},
        {dbus: {reply: loginReply}});
    off.add(makeWindow('a'));
    fireShortcut(off, 'Toggle Float', off.windows[0]);
    off.advance(5000);
    off.quit.emit();
    assert.equal(off.dbusCalls.length, 0);
    const inert = harness({settleSeconds: 0}, {dbus: {reply: loginReply}});
    inert.add(makeWindow('a'));
    assert.equal(inert.dbusCalls.length, 0);
});

test('several changes produce one debounced Set that keeps closed windows', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 1},
        {dbus: {reply: '{}'}});
    const a = makeWindow('a', {caption: 'Alpha', frameGeometry: {x: 8, y: 8, width: 706,
        height: 785}});
    const b = makeWindow('b', {caption: 'Beta', frameGeometry: {x: 722, y: 8, width: 470,
        height: 785}});
    h.add(a);
    h.add(b);
    h.advance(1000);
    assert.equal(sets(h).length, 0);
    fireShortcut(h, 'Toggle Float', a);
    h.advance(1000);
    fireShortcut(h, 'Toggle Float', a);
    h.advance(1000);
    h.remove(b);
    h.advance(1999);
    assert.equal(sets(h).length, 0);
    h.advance(1);
    assert.equal(sets(h).length, 1);
    const call = sets(h)[0];
    assert.deepEqual([call.service, call.path, call.iface],
        ['org.weave.State', '/State', 'org.weave.State']);
    const records = JSON.parse(call.args[0]).records;
    assert.deepEqual(records.map(item => item.key.captionPattern).sort(), ['alpha', 'beta']);
    h.advance(10000);
    assert.equal(sets(h).length, 1);
});

test('aboutToQuit flushes at once and later removals do not save', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 0},
        {dbus: {reply: '{}'}});
    const a = makeWindow('a');
    h.add(a);
    h.quit.emit();
    assert.equal(sets(h).length, 1);
    h.remove(a);
    h.advance(5000);
    assert.equal(sets(h).length, 1);
});

test('frame geometry events of managed windows never cause a save', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 0},
        {dbus: {reply: '{}'}});
    const a = makeWindow('a');
    h.add(a);
    h.advance(5000);
    const before = sets(h).length;
    a.frameGeometryChanged.emit();
    h.advance(5000);
    assert.equal(sets(h).length, before);
});

test('adapter logs its build id at info level and stays quiet when logging is off', () => {
    const loud = harness({logLevel: 'info'});
    assert.ok(loud.logs.some(line => /^weave loaded build=\S+$/.test(line)));
    const quiet = harness({});
    assert.ok(!quiet.logs.some(line => line.includes('loaded build')));
});

test('build.sh injects the content hash into the declarative package', () => {
    const {execFileSync} = require('node:child_process');
    execFileSync('sh', [path.join(root, 'script/build.sh')], {cwd: '/', stdio: 'inherit'});
    const dist = path.join(root, 'script/dist');
    const id = fs.readFileSync(path.join(dist, 'BUILD_ID'), 'utf8').trim();
    assert.match(id, /^[0-9a-f]{8}$/);
    const built = fs.readFileSync(path.join(dist, 'contents/ui', 'lib-' + id, 'weave.js'), 'utf8');
    assert.ok(built.includes('BUILD_ID = "' + id + '"'));
    assert.ok(!built.includes('@@BUILD_ID@@'));
    assert.ok(built.includes('var WEAVE_TEMPLATES = {'));
    assert.ok(built.includes('"pair-centred"'));
    const metadata = JSON.parse(fs.readFileSync(path.join(dist, 'metadata.json'), 'utf8'));
    assert.equal(metadata.KPlugin.Id, 'weave');
    assert.equal(metadata['X-Plasma-API'], 'declarativescript');
    assert.equal(metadata['X-Plasma-MainScript'], 'ui/main.qml');
    assert.equal(fs.existsSync(path.join(dist, 'contents/code/main.js')), false);
    for (const name of ['Weave', 'Picker']) {
        const qml = fs.readFileSync(path.join(dist, 'contents/ui', name + '.qml'), 'utf8');
        assert.ok(!qml.includes('@@BUILD_ID@@'));
        for (const match of qml.matchAll(/import "([^"]+\.js)"/g)) {
            assert.ok(match[1].startsWith('lib-' + id + '/'));
            assert.ok(fs.existsSync(path.join(dist, 'contents/ui', match[1])));
        }
    }
    for (const relative of ['contents/config/main.xml', 'contents/ui/config.ui']) {
        assert.deepEqual(fs.readFileSync(path.join(dist, relative)),
            fs.readFileSync(path.join(root, 'script', relative)));
    }
});

function resizeHarness() {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a');
    const b = makeWindow('b');
    const c = makeWindow('c');
    h.add(a);
    h.add(b);
    h.add(c);
    return {h, a, b, c};
}

function dragFrame(h, window, frame) {
    window.resize = true;
    window.interactiveMoveResizeStarted.emit();
    window.frameGeometry = Object.assign(geometry(window), frame);
    // The cursor is deliberately far from every edge: it must not matter.
    h.workspace.cursorPos = {x: 3000, y: 3000};
    window.interactiveMoveResizeFinished.emit();
    window.resize = false;
}

test('resize: master shrinks and grows by its right edge', () => {
    const {h, a, b} = resizeHarness();
    dragFrame(h, a, {width: 592});
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 592, height: 785});
    assert.equal(geometry(b).x, 608);
    assert.equal(geometry(b).width, 584);
    dragFrame(h, a, {width: 900});
    assert.equal(geometry(a).width, 900);
    assert.equal(geometry(b).x, 916);
});

test('resize: stack window left edge moves the same node as the master right edge', () => {
    const {h, a, b, c} = resizeHarness();
    dragFrame(h, b, {x: 800, width: 392});
    assert.equal(geometry(a).width, 784);
    assert.equal(geometry(b).x, 800);
    assert.equal(geometry(c).x, 800);
});

test('resize: stack windows split from the top and bottom edges', () => {
    const {h, b, c} = resizeHarness();
    dragFrame(h, c, {y: 300, height: 493});
    assert.equal(geometry(b).height, 284);
    assert.equal(geometry(c).y, 300);
    dragFrame(h, b, {height: 492});
    assert.equal(geometry(b).y + geometry(b).height, 500);
    assert.equal(geometry(c).y, 508);
});

test('resize: a corner drag applies both sides', () => {
    const {h, a, b, c} = resizeHarness();
    dragFrame(h, b, {x: 800, width: 392, height: 492});
    assert.equal(geometry(a).width, 784);
    assert.equal(geometry(b).x, 800);
    assert.equal(geometry(b).height, 492);
    assert.equal(geometry(c).y, 508);
});

test('resize: edges on the work-area border are ignored', () => {
    const {h, a, b, c} = resizeHarness();
    const before = [a, b, c].map(geometry);
    dragFrame(h, b, {width: 300});
    dragFrame(h, a, {x: 100, width: 614});
    dragFrame(h, a, {y: 100, height: 693});
    assert.deepEqual([a, b, c].map(geometry), before);
});

test('resize: a floating window never changes the tree', () => {
    const {h, a, b, c} = resizeHarness();
    const before = [a, b, c].map(geometry);
    const loose = makeWindow('f', {resourceClass: 'other'});
    h.add(loose);
    dragFrame(h, loose, {x: 700, width: 100});
    assert.deepEqual([a, b, c].map(geometry), before);
});

test('resize: the ratio is clamped so each pane keeps 100 px', () => {
    const {h, a, b} = resizeHarness();
    dragFrame(h, a, {width: 12});
    assert.equal(geometry(a).width, 100);
    dragFrame(h, a, {width: 1180});
    assert.equal(geometry(b).width, 100);
});

test('resize: no side changed re-applies the layout', () => {
    const {h, a, b, c} = resizeHarness();
    const before = [a, b, c].map(geometry);
    dragFrame(h, a, {x: 8.4, width: 706});
    assert.deepEqual([a, b, c].map(geometry), before);
});

// ---- layouts and arrangements ----

const gapped = {manageClasses: 'editor', gapInner: 8, gapOuter: 8};

function rectOf(window) {
    const g = geometry(window);
    return [g.x, g.y, g.width, g.height];
}

function addWindows(h, count, options) {
    const made = [];
    for (let index = 0; index < count; index++) {
        const window = makeWindow('w' + index, options);
        made.push(window);
        h.add(window);
    }
    return made;
}

const layoutRects = {
    master: {
        1: [[8, 8, 1184, 785]],
        2: [[8, 8, 706, 785], [722, 8, 470, 785]],
        3: [[8, 8, 706, 785], [722, 8, 470, 389], [722, 405, 470, 388]],
        5: [[8, 8, 706, 785], [722, 8, 470, 194], [722, 210, 470, 192],
            [722, 410, 470, 188], [722, 606, 470, 187]]
    },
    columns: {
        1: [[8, 8, 1184, 785]],
        2: [[8, 8, 588, 785], [604, 8, 588, 785]],
        3: [[8, 8, 392, 785], [408, 8, 388, 785], [804, 8, 388, 785]],
        5: [[8, 8, 235, 785], [251, 8, 233, 785], [492, 8, 231, 785], [731, 8, 227, 785],
            [966, 8, 226, 785]]
    },
    monocle: {
        1: [[8, 8, 1184, 785]],
        2: [[8, 8, 1184, 785], [8, 8, 1184, 785]],
        3: [[8, 8, 1184, 785], [8, 8, 1184, 785], [8, 8, 1184, 785]],
        5: [[8, 8, 1184, 785], [8, 8, 1184, 785], [8, 8, 1184, 785], [8, 8, 1184, 785],
            [8, 8, 1184, 785]]
    },
    spiral: {
        1: [[8, 8, 1184, 785]],
        2: [[8, 8, 588, 785], [604, 8, 588, 785]],
        3: [[8, 8, 588, 785], [604, 8, 588, 389], [604, 405, 588, 388]],
        5: [[8, 8, 588, 785], [604, 8, 588, 389], [902, 405, 290, 388], [604, 603, 290, 190],
            [604, 405, 290, 190]]
    },
    rows: {
        1: [[8,8,1184,785]],
        2: [[8,8,1184,389], [8,405,1184,388]],
        3: [[8,8,1184,259], [8,275,1184,255], [8,538,1184,255]],
        5: [[8,8,1184,155], [8,171,1184,154], [8,333,1184,151], [8,492,1184,147], [8,647,1184,146]]
    },
    hstack: {
        1: [[8,8,1184,785]],
        2: [[8,8,1184,466], [8,482,1184,311]],
        3: [[8,8,1184,466], [8,482,588,311], [604,482,588,311]],
        5: [[8,8,1184,466], [8,482,294,311], [310,482,291,311], [609,482,288,311], [905,482,287,311]]
    },
    rmaster: {
        1: [[8,8,1184,785]],
        2: [[486,8,706,785], [8,8,470,785]],
        3: [[486,8,706,785], [8,8,470,389], [8,405,470,388]],
        5: [[486,8,706,785], [8,8,470,194], [8,210,470,192], [8,410,470,188], [8,606,470,187]]
    },
    grid: {
        1: [[8,8,1184,785]],
        2: [[8,8,588,785], [604,8,588,785]],
        3: [[8,8,588,389], [604,8,588,389], [8,405,1184,388]],
        5: [[8,8,392,389], [408,8,388,389], [804,8,388,389], [8,405,588,388], [604,405,588,388]]
    },
    ultrawide: {
        1: [[8,8,1184,785]],
        2: [[8,8,706,785], [722,8,470,785]],
        3: [[251,8,700,785], [959,8,233,785], [8,8,235,785]],
        5: [[251,8,700,785], [959,8,233,389], [8,8,235,389], [959,405,233,388], [8,405,235,388]]
    }
};

// Stage in the default test area (work rect 8,8 1184x785, gaps 8, focusRatio 0.6).
const stageRects = {
    1: [[8, 8, 1184, 785]],
    2: [[249, 8, 701, 785], [8, 265, 233, 142]],
    3: [[249, 8, 701, 785], [8, 265, 233, 142], [958, 265, 234, 142]],
    5: [[249, 8, 701, 785], [8, 265, 233, 142], [958, 265, 234, 142], [20, 415, 221, 135],
        [958, 415, 222, 135]],
    7: [[249, 8, 701, 785], [8, 265, 233, 142], [958, 265, 234, 142], [20, 415, 221, 135],
        [958, 415, 222, 135], [31, 130, 210, 127], [958, 130, 211, 127]],
    13: [[249, 8, 701, 785], [8, 265, 233, 142], [958, 265, 234, 142], [20, 415, 221, 135],
        [958, 415, 222, 135], [31, 130, 210, 127], [958, 130, 211, 127],
        [43, 558, 198, 121], [958, 558, 199, 121], [55, 8, 186, 114], [958, 8, 187, 114],
        [958, 8, 187, 114], [958, 8, 187, 114]]
};

test('every layout gives exact rects for 1, 2, 3 and 5 windows through defaultLayout', () => {
    Object.keys(layoutRects).forEach(name => {
        [1, 2, 3, 5].forEach(count => {
            const h = harness(Object.assign({defaultLayout: name}, gapped));
            const windows = addWindows(h, count);
            assert.deepEqual(windows.map(rectOf), layoutRects[name][count], name + ' ' + count);
        });
    });
});

test('layout shortcuts switch a populated context to the same exact rects', () => {
    Object.keys(layoutRects).forEach(name => {
        [1, 2, 3, 5].forEach(count => {
            const h = harness(gapped);
            const windows = addWindows(h, count);
            fireShortcut(h, 'Layout ' + name[0].toUpperCase() + name.slice(1), windows[0]);
            assert.deepEqual(windows.map(rectOf), layoutRects[name][count], name + ' ' + count);
        });
    });
});

test('layout next and previous include scroll and wrap', () => {
    const h = harness(Object.assign({logLevel: 'info'}, gapped));
    const windows = addWindows(h, 3);
    const names = ['columns', 'monocle', 'spiral', 'rows', 'hstack', 'rmaster',
        'grid', 'ultrawide', 'stage', 'scroll', 'master'];
    names.forEach(name => {
        fireShortcut(h, 'Layout Next', windows[0]);
        assert.equal(h.logs.filter(line => line.includes('layout ')).at(-1),
            'weave layout ["DP-1",2] -> ' + name);
    });
    ['scroll', 'stage', 'ultrawide'].forEach(name => {
        fireShortcut(h, 'Layout Previous', windows[0]);
        assert.equal(h.logs.filter(line => line.includes('layout ')).at(-1),
            'weave layout ["DP-1",2] -> ' + name);
    });
});

test('every layout switch logs "layout <context> -> <name>" at info level', () => {
    const h = harness(Object.assign({logLevel: 'info'}, gapped));
    const windows = addWindows(h, 2);
    fireShortcut(h, 'Layout Columns', windows[0]);
    fireShortcut(h, 'Layout Columns', windows[0]);
    fireShortcut(h, 'Layout Spiral', windows[0]);
    const lines = h.logs.filter(line => line.includes('layout '));
    assert.deepEqual(lines, [
        'weave layout ["DP-1",2] -> columns',
        'weave layout ["DP-1",2] -> columns',
        'weave layout ["DP-1",2] -> spiral'
    ]);
});

test('switching layouts keeps the leaf order, including after a drag swap', () => {
    const h = harness({manageClasses: 'editor', gapInner: 0, gapOuter: 0});
    const [a, b, c] = addWindows(h, 3);
    c.move = true;
    c.interactiveMoveResizeStarted.emit();
    c.frameGeometry = {x: 100, y: 100, width: 300, height: 300};
    h.workspace.cursorPos = {x: geometry(a).x + geometry(a).width / 2,
        y: geometry(a).y + geometry(a).height / 2};
    c.interactiveMoveResizeFinished.emit();
    c.move = false;
    assert.ok(geometry(c).x < geometry(b).x && geometry(a).x > 0);
    fireShortcut(h, 'Layout Columns', a);
    assert.ok(geometry(c).x < geometry(b).x);
    assert.ok(geometry(b).x < geometry(a).x);
    fireShortcut(h, 'Layout Spiral', a);
    fireShortcut(h, 'Layout Master', a);
    assert.ok(geometry(c).x < geometry(b).x && geometry(c).x < geometry(a).x);
    assert.equal(geometry(c).height, 801);
});

test('arrivals use the context layout and a switch clears the adopted state', () => {
    const adopted = [
        makeWindow('a', {frameGeometry: {x: 8, y: 8, width: 706, height: 785}}),
        makeWindow('b', {frameGeometry: {x: 722, y: 8, width: 470, height: 785}})
    ];
    const h = harness(gapped, {initialWindows: adopted});
    fireShortcut(h, 'Layout Columns', adopted[0]);
    const c = makeWindow('c');
    h.add(c);
    assert.deepEqual([adopted[0], adopted[1], c].map(rectOf), layoutRects.columns[3]);

    const monocle = harness(gapped);
    const windows = addWindows(monocle, 2);
    fireShortcut(monocle, 'Layout Monocle', windows[0]);
    const extra = makeWindow('extra');
    monocle.add(extra);
    assert.deepEqual(rectOf(extra), [8, 8, 1184, 785]);
});

test('each context keeps its own layout and defaultLayout seeds new ones', () => {
    const h = harness(Object.assign({defaultLayout: 'spiral'}, gapped));
    const left = addWindows(h, 2);
    const right = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'})];
    right.forEach(window => h.add(window));
    assert.deepEqual(right.map(rectOf), layoutRects.spiral[2]);
    fireShortcut(h, 'Layout Columns', left[0]);
    fireShortcut(h, 'Layout Monocle', right[0]);
    assert.deepEqual(left.map(rectOf), layoutRects.columns[2]);
    assert.deepEqual(right.map(rectOf), layoutRects.monocle[2]);
    h.workspace.desktops['DP-1'] = 3;
    const other = makeWindow('other');
    h.add(other);
    assert.deepEqual(rectOf(other), layoutRects.spiral[1][0]);
    const next = makeWindow('next');
    h.add(next);
    assert.deepEqual([other, next].map(rectOf), layoutRects.spiral[2]);
    assert.deepEqual(left.map(rectOf), layoutRects.columns[2]);
});

test('invalid defaultLayout values fall back to master', () => {
    ['bogus', 'reserved', '', 'Columns', 'Stage'].forEach(value => {
        const h = harness(Object.assign({defaultLayout: value}, gapped));
        assert.deepEqual(addWindows(h, 3).map(rectOf), layoutRects.master[3], value);
    });
    const columns = harness(Object.assign({defaultLayout: 'columns'}, gapped));
    assert.deepEqual(addWindows(columns, 2).map(rectOf), layoutRects.columns[2]);
});

test('monocle raises the active window and tolerates a missing raise API', () => {
    const h = harness(gapped);
    const [a, b] = addWindows(h, 2);
    h.activate(b);
    fireShortcut(h, 'Layout Monocle', b);
    assert.deepEqual(h.workspace.raised, ['w1']);
    h.activate(a);
    assert.deepEqual(h.workspace.raised, ['w1', 'w0']);
    fireShortcut(h, 'Layout Master', a);
    h.activate(b);
    assert.deepEqual(h.workspace.raised, ['w1', 'w0']);

    const bare = harness(gapped, {noRaise: true});
    const windows = addWindows(bare, 2);
    bare.activate(windows[1]);
    fireShortcut(bare, 'Layout Monocle', windows[1]);
    bare.activate(windows[0]);
    assert.deepEqual(rectOf(windows[0]), [8, 8, 1184, 785]);
});

const slotRects = {
    'pair-centred': [[126, 87, 470, 628], [604, 87, 470, 628]],
    'main-side': [[8, 8, 825, 785], [841, 8, 351, 785]],
    'golden-split': [[8, 8, 728, 785], [744, 8, 448, 785]],
    'trio-columns': [[8, 8, 391, 785], [407, 8, 386, 785], [801, 8, 391, 785]],
    'trio-main-two-stacked': [[8, 8, 706, 785], [722, 8, 470, 389], [722, 405, 470, 388]],
    'pair-wide': [[67, 165, 529, 471], [604, 165, 529, 471]]
};

function activatedWindows(h, count) {
    const windows = addWindows(h, count);
    windows.forEach(window => h.activate(window));
    return windows;
}

test('every template gives exact slot rects for 1 to 4 windows and spares the rest', () => {
    Object.keys(slotRects).forEach((name, templateIndex) => {
        [1, 2, 3, 4].forEach(count => {
            const h = harness(gapped);
            const windows = activatedWindows(h, count);
            for (let press = 0; press < templateIndex; press++) {
                fireShortcut(h, 'Arrange Next', windows[count - 1]);
            }
            const before = windows.map(rectOf);
            const writes = windows.map(window => window.geometryWrites);
            fireShortcut(h, 'Arrange Next', windows[count - 1]);
            const slots = slotRects[name];
            const chosen = windows.slice().reverse().slice(0, slots.length);
            chosen.forEach((window, slot) => {
                assert.deepEqual(rectOf(window), slots[slot], name + ' ' + count + ' slot ' + slot);
            });
            windows.forEach((window, index) => {
                if (chosen.indexOf(window) >= 0) { return; }
                assert.deepEqual(rectOf(window), before[index], name + ' ' + count);
                assert.equal(window.geometryWrites, writes[index]);
            });
        });
    });
});

test('arrange next and previous cycle the templates in file order', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 3);
    const names = Object.keys(slotRects);
    for (let press = 0; press < names.length + 1; press++) {
        fireShortcut(h, 'Arrange Next', windows[2]);
        const expected = names[press % names.length];
        assert.deepEqual(rectOf(windows[2]), slotRects[expected][0], expected);
    }
    fireShortcut(h, 'Arrange Previous', windows[2]);
    assert.deepEqual(rectOf(windows[2]), slotRects[names[names.length - 1]][0]);
    const fresh = harness(gapped);
    const single = activatedWindows(fresh, 1);
    fireShortcut(fresh, 'Arrange Previous', single[0]);
    assert.deepEqual(rectOf(single[0]), slotRects['pair-wide'][0]);
});

test('the active window and the most recently active ones fill the slots', () => {
    const h = harness(gapped);
    const [w0, w1, w2, w3] = addWindows(h, 4);
    [w2, w0, w3, w1].forEach(window => h.activate(window));
    const writes = [w0.geometryWrites, w2.geometryWrites];
    fireShortcut(h, 'Arrange Next', w1);
    assert.deepEqual(rectOf(w1), slotRects['pair-centred'][0]);
    assert.deepEqual(rectOf(w3), slotRects['pair-centred'][1]);
    assert.deepEqual([w0.geometryWrites, w2.geometryWrites], writes);
    fireShortcut(h, 'Arrange Next', w1);
    fireShortcut(h, 'Arrange Next', w1);
    fireShortcut(h, 'Arrange Next', w1);
    assert.deepEqual([w1, w3, w0].map(rectOf), slotRects['trio-columns']);
});

test('windows never activated rank last, in arrival order', () => {
    const h = harness(gapped);
    const [w0, w1, w2, w3] = addWindows(h, 4);
    h.activate(w3);
    h.workspace.windowActivated.emit(w1);
    h.workspace.activeWindow = w3;
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', w3); }
    assert.deepEqual([w3, w1, w0].map(rectOf), slotRects['trio-columns']);
    assert.notDeepEqual(rectOf(w2), slotRects['trio-columns'][0]);
});

test('empty slots stay empty and a window set smaller than the template is fine', () => {
    const h = harness(gapped);
    const [only] = activatedWindows(h, 1);
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', only); }
    assert.deepEqual(rectOf(only), slotRects['trio-columns'][0]);
    fireShortcut(h, 'Arrange Reapply', only);
    assert.deepEqual(rectOf(only), slotRects['trio-columns'][0]);
});

test('reapply snaps a wandered group member back to its slot', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 2);
    fireShortcut(h, 'Arrange Next', windows[1]);
    windows[0].frameGeometry = {x: 400, y: 300, width: 200, height: 200};
    windows[1].frameGeometry = {x: 10, y: 10, width: 300, height: 300};
    fireShortcut(h, 'Arrange Reapply', windows[1]);
    assert.deepEqual(rectOf(windows[1]), slotRects['pair-centred'][0]);
    assert.deepEqual(rectOf(windows[0]), slotRects['pair-centred'][1]);
});

test('release returns tiled windows to the tree and floated ones to their rectangle', () => {
    const h = harness(gapped);
    const [w0, w1, w2] = addWindows(h, 3);
    fireShortcut(h, 'Toggle Float', w0);
    w0.frameGeometry = {x: 300, y: 200, width: 500, height: 400};
    [w0, w1, w2].forEach(window => h.activate(window));
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', w2); }
    assert.deepEqual([w2, w1, w0].map(rectOf), slotRects['trio-columns']);
    fireShortcut(h, 'Arrange Release', w2);
    assert.deepEqual(rectOf(w0), [300, 200, 500, 400]);
    assert.deepEqual(rectOf(w1), layoutRects.master[2][0]);
    assert.deepEqual(rectOf(w2), layoutRects.master[2][1]);
    w0.frameGeometry = {x: 50, y: 60, width: 500, height: 400};
    fireShortcut(h, 'Arrange Reapply', w2);
    assert.deepEqual(rectOf(w0), [50, 60, 500, 400]);
    fireShortcut(h, 'Toggle Float', w0);
    assert.deepEqual(rectOf(w0), layoutRects.master[3][2]);
});

test('toggle float on an arranged window releases only that window', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 3);
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', windows[2]); }
    const [w0, w1, w2] = windows;
    fireShortcut(h, 'Toggle Float', w1);
    assert.deepEqual(rectOf(w1), slotRects['trio-columns'][1]);
    w1.frameGeometry = {x: 20, y: 30, width: 400, height: 300};
    fireShortcut(h, 'Arrange Reapply', w2);
    assert.deepEqual(rectOf(w1), [20, 30, 400, 300]);
    assert.deepEqual(rectOf(w0), slotRects['trio-columns'][2]);
    assert.deepEqual(rectOf(w2), slotRects['trio-columns'][0]);
    fireShortcut(h, 'Arrange Release', w2);
    assert.deepEqual(rectOf(w1), [20, 30, 400, 300]);
    fireShortcut(h, 'Toggle Float', w1);
    assert.deepEqual(rectOf(w1), layoutRects.master[3][2]);
});

test('closing an arranged window empties its slot without moving the others', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 4);
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', windows[3]); }
    const [w0, w1, w2, w3] = windows;
    const untouched = w0.geometryWrites;
    const writes = [w2.geometryWrites, w3.geometryWrites];
    h.remove(w2);
    assert.deepEqual([w2.geometryWrites, w3.geometryWrites], writes);
    assert.equal(w0.geometryWrites, untouched);
    w3.frameGeometry = {x: 1, y: 1, width: 100, height: 100};
    fireShortcut(h, 'Arrange Reapply', w3);
    assert.deepEqual(rectOf(w3), slotRects['trio-columns'][0]);
    assert.deepEqual(rectOf(w1), slotRects['trio-columns'][2]);
    h.remove(w3);
    h.remove(w1);
    assert.deepEqual(rectOf(w0), layoutRects.master[1][0]);
});

test('drag does nothing to arranged windows and they are not re-laid', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 3);
    fireShortcut(h, 'Arrange Next', windows[2]);
    const [w0, w1, w2] = windows;
    const writes = [w0.geometryWrites, w1.geometryWrites, w2.geometryWrites];
    w2.move = true;
    w2.interactiveMoveResizeStarted.emit();
    w2.frameGeometry = {x: 640, y: 120, width: 300, height: 300};
    h.workspace.cursorPos = {x: 650, y: 130};
    w2.interactiveMoveResizeFinished.emit();
    w2.move = false;
    assert.deepEqual(rectOf(w2), [640, 120, 300, 300]);
    assert.equal(w2.geometryWrites, writes[2] + 1);
    assert.equal(w1.geometryWrites, writes[1]);
    assert.equal(w0.geometryWrites, writes[0]);
});

test('windows outside the group stay put, also arrivals, until release', () => {
    const h = harness(gapped);
    const windows = activatedWindows(h, 3);
    fireShortcut(h, 'Arrange Next', windows[2]);
    const outside = windows[0];
    const before = [outside.geometryWrites, rectOf(outside)];
    const late = makeWindow('late');
    h.add(late);
    assert.equal(late.geometryWrites, 0);
    fireShortcut(h, 'Layout Columns', windows[2]);
    assert.equal(late.geometryWrites, 0);
    assert.deepEqual([outside.geometryWrites, rectOf(outside)], before);
    fireShortcut(h, 'Arrange Release', windows[2]);
    const row = [outside, late, windows[1], windows[2]].map(rectOf);
    row.forEach(rect => assert.deepEqual([rect[1], rect[3]], [8, 785]));
    assert.ok(row[0][0] < row[1][0] && row[1][0] < row[2][0] && row[2][0] < row[3][0]);
});

test('a template with fewer slots hands extra windows back and keeps their place', () => {
    const h = harness(gapped);
    const [w0, w1, w2] = activatedWindows(h, 3);
    for (let press = 0; press < 4; press++) { fireShortcut(h, 'Arrange Next', w2); }
    fireShortcut(h, 'Arrange Previous', w2);
    assert.deepEqual(rectOf(w2), slotRects['golden-split'][0]);
    assert.deepEqual(rectOf(w1), slotRects['golden-split'][1]);
    assert.deepEqual(rectOf(w0), slotRects['trio-columns'][2]);
    fireShortcut(h, 'Arrange Release', w2);
    assert.deepEqual([w0, w1, w2].map(rectOf), layoutRects.master[3]);
});

test('an arranged window moved to another output leaves the group as a floating one', () => {
    const h = harness(gapped);
    const [w0, w1] = activatedWindows(h, 2);
    fireShortcut(h, 'Arrange Next', w1);
    w0.output = 'DP-2';
    w0.outputChanged.emit();
    const moved = rectOf(w0);
    fireShortcut(h, 'Arrange Reapply', w1);
    assert.deepEqual(rectOf(w0), moved);
    assert.deepEqual(rectOf(w1), slotRects['pair-centred'][0]);
});

test('arranged windows are saved as floating with their remembered rectangle', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 0, gapInner: 8, gapOuter: 8},
        {dbus: {reply: '{}'}});
    const [w0, w1] = activatedWindows(h, 2);
    fireShortcut(h, 'Arrange Next', w1);
    h.advance(2000);
    const calls = h.dbusCalls.filter(call => call.method === 'Set');
    const records = JSON.parse(calls[calls.length - 1].args[0]).records;
    assert.equal(records.length, 2);
    records.forEach(record => assert.equal(record.mode, 'float'));
    assert.ok(records.every(record => record.floatGeom.width > 0));
});

// ---- stage layout ----

const stageSettings = Object.assign({defaultLayout: 'stage'}, gapped);

function totalWrites(windows) {
    return windows.reduce((sum, window) => sum + window.geometryWrites, 0);
}

function dragMove(h, window, point) {
    window.move = true;
    window.interactiveMoveResizeStarted.emit();
    window.frameGeometry = {x: point.x - 50, y: point.y - 50, width: 100, height: 100};
    h.workspace.cursorPos = point;
    window.interactiveMoveResizeFinished.emit();
    window.move = false;
}

function centreOf(rect) {
    return {x: rect[0] + rect[2] / 2, y: rect[1] + rect[3] / 2};
}

test('stage gives exact rects for 1, 2, 3, 5, 7 and 13 windows, also through the shortcut', () => {
    [1, 2, 3, 5, 7, 13].forEach(count => {
        const direct = harness(stageSettings);
        assert.deepEqual(addWindows(direct, count).map(rectOf), stageRects[count],
            'defaultLayout ' + count);
        const switched = harness(Object.assign({maxWindows: 99}, gapped));
        const windows = addWindows(switched, count);
        fireShortcut(switched, 'Layout Stage', windows[0]);
        assert.deepEqual(windows.map(rectOf), stageRects[count], 'shortcut ' + count);
    });
});

test('stage overflow windows share the last rail cell as a stack', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 13);
    assert.deepEqual(rectOf(windows[11]), rectOf(windows[10]));
    assert.deepEqual(rectOf(windows[12]), rectOf(windows[10]));
});

test('focusRatio is configurable and clamped to 0.3..0.8', () => {
    const widths = {0.4: 467, 0.9: 934, 0.1: 350, abc: 701};
    Object.keys(widths).forEach(value => {
        const h = harness(Object.assign({focusRatio: value === 'abc' ? value : Number(value)},
            stageSettings));
        assert.equal(rectOf(addWindows(h, 3)[0])[2], widths[value], value);
    });
});

test('activating a rail window swaps it into the focus slot and nothing else moves', () => {
    const h = harness(Object.assign({logLevel: 'info'}, stageSettings));
    const windows = addWindows(h, 5);
    const before = windows.map(rectOf);
    const writes = totalWrites(windows);
    h.activate(windows[3]);
    const after = windows.map(rectOf);
    assert.deepEqual(after[3], before[0]);
    assert.deepEqual(after[0], before[3]);
    [1, 2, 4].forEach(index => assert.deepEqual(after[index], before[index]));
    assert.equal(totalWrites(windows) - writes, 5);
    assert.ok(h.logs.includes('weave stage ["DP-1",2] focus -> w3'));
    // The focus window activated again, or a plain relayout trigger, writes nothing.
    h.activate(windows[3]);
    assert.equal(totalWrites(windows) - writes, 5);
});

test('activating unmanaged, floating or other-context windows leaves the stage alone', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    const other = makeWindow('other', {resourceClass: 'unmanaged'});
    h.add(other);
    const floated = makeWindow('floated');
    h.add(floated);
    fireShortcut(h, 'Toggle Float', floated);
    const elsewhere = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'})];
    elsewhere.forEach(window => h.add(window));
    const before = windows.map(rectOf);
    const writes = totalWrites(windows);
    h.activate(other);
    h.activate(floated);
    h.activate(elsewhere[1]);
    assert.deepEqual(windows.map(rectOf), before);
    assert.equal(totalWrites(windows), writes);
    // The other output has its own stage: its activation only promotes there.
    assert.deepEqual(rectOf(elsewhere[1]), stageRects[2][0]);
    assert.deepEqual(rectOf(elsewhere[0]), stageRects[2][1]);
});

test('a new window takes a rail cell and only an activation promotes it', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 2);
    const extra = makeWindow('extra');
    h.add(extra);
    assert.deepEqual(rectOf(windows[0]), stageRects[3][0]);
    assert.deepEqual(rectOf(extra), stageRects[3][2]);
    h.activate(extra);
    assert.deepEqual(rectOf(extra), stageRects[3][0]);
    assert.deepEqual(rectOf(windows[0]), stageRects[3][2]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][1]);
});

test('closing the focus window promotes the first rail window and others stay', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    h.remove(windows[0]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][0]);
    assert.deepEqual(rectOf(windows[2]), stageRects[3][2]);
});

test('pinned windows keep their cell while the others rotate', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    fireShortcut(h, 'Stage Pin', windows[1]);
    fireShortcut(h, 'Stage Cycle Next', windows[0]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][1]);
    assert.deepEqual(rectOf(windows[2]), stageRects[3][0]);
    assert.deepEqual(rectOf(windows[0]), stageRects[3][2]);
    h.activate(windows[1]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][1]);
    fireShortcut(h, 'Stage Unpin', windows[1]);
    h.activate(windows[1]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][0]);
});

test('stage cycle next and previous promote the first and last rail window', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 5);
    const home = windows.map(rectOf);
    fireShortcut(h, 'Stage Cycle Next', windows[0]);
    assert.deepEqual(rectOf(windows[1]), home[0]);
    assert.deepEqual(rectOf(windows[0]), home[1]);
    assert.equal(h.workspace.activeWindow, windows[1]);
    // The activation the cycle caused itself does not promote anything again.
    h.activate(windows[1]);
    assert.deepEqual(windows.map(rectOf)[0], home[1]);
    fireShortcut(h, 'Stage Cycle Previous', windows[1]);
    assert.deepEqual(rectOf(windows[4]), home[0]);
    assert.deepEqual(rectOf(windows[1]), home[4]);
    assert.equal(h.workspace.activeWindow, windows[4]);
});

test('stage shortcuts do nothing outside a stage context', () => {
    const h = harness(gapped);
    const windows = addWindows(h, 3);
    const before = windows.map(rectOf);
    ['Stage Pin', 'Stage Unpin', 'Stage Cycle Next', 'Stage Cycle Previous'].forEach(
        name => fireShortcut(h, name, windows[1]));
    assert.deepEqual(windows.map(rectOf), before);
});

test('stage drag: onto the focus slot swaps in, onto a rail cell swaps, elsewhere springs back',
    () => {
        const h = harness(stageSettings);
        const windows = addWindows(h, 3);
        const home = windows.map(rectOf);
        dragMove(h, windows[1], centreOf(home[0]));
        assert.deepEqual([1, 0, 2].map(i => rectOf(windows[i])), [home[0], home[1], home[2]]);
        dragMove(h, windows[1], centreOf(home[2]));
        assert.deepEqual(rectOf(windows[1]), home[2]);
        assert.deepEqual(rectOf(windows[2]), home[0]);
        assert.deepEqual(rectOf(windows[0]), home[1]);
        const settled = windows.map(rectOf);
        dragMove(h, windows[0], {x: 5000, y: 5000});
        assert.deepEqual(windows.map(rectOf), settled);
        dragMove(h, windows[0], {x: 245, y: 300});
        assert.deepEqual(windows.map(rectOf), settled);
    });

test('stage drag of the focus window onto a rail cell promotes that cell window', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    const home = windows.map(rectOf);
    dragMove(h, windows[0], centreOf(home[2]));
    assert.deepEqual(rectOf(windows[2]), home[0]);
    assert.deepEqual(rectOf(windows[0]), home[2]);
    assert.deepEqual(rectOf(windows[1]), home[1]);
});

test('stage drag onto a pinned cell springs back', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    const home = windows.map(rectOf);
    fireShortcut(h, 'Stage Pin', windows[2]);
    dragMove(h, windows[0], centreOf(home[2]));
    assert.deepEqual(windows.map(rectOf), home);
});

test('stage edge resize changes only the focus ratio, clamped, and survives a relayout', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    const home = windows.map(rectOf);
    dragFrame(h, windows[0], {x: 366, width: 584});
    assert.equal(rectOf(windows[0])[2], 468);
    assert.deepEqual([1, 2].map(i => rectOf(windows[i])[1]), [home[1][1], home[2][1]]);
    const extra = makeWindow('extra');
    h.add(extra);
    assert.equal(rectOf(windows[0])[2], 468);
    h.remove(extra);
    dragFrame(h, windows[0], {x: 10, width: 824});
    assert.equal(rectOf(windows[0])[2], 934);
    dragFrame(h, windows[0], {x: 590, width: 477});
    assert.equal(rectOf(windows[0])[2], 350);
    fireShortcut(h, 'Retile', windows[0]);
    assert.equal(rectOf(windows[0])[2], 350);
    assert.deepEqual([1, 2].map(i => rectOf(windows[i])[1]), [home[1][1], home[2][1]]);
});

test('stage rail edge drags use the inner side; outer sides and top or bottom are ignored', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    const home = windows.map(rectOf);
    dragFrame(h, windows[1], {width: 292});
    assert.equal(rectOf(windows[0])[2], 584);
    dragFrame(h, windows[2], {x: 900, width: 292});
    assert.equal(rectOf(windows[0])[2], 584);
    dragFrame(h, windows[1], {x: 20, width: 280});
    dragFrame(h, windows[1], {y: 300, height: 100});
    assert.equal(rectOf(windows[0])[2], 584);
    assert.equal(home.length, 3);
});

test('stage resize in one context leaves the focus ratio of the others alone', () => {
    const h = harness(stageSettings);
    const left = addWindows(h, 3);
    const right = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'})];
    right.forEach(window => h.add(window));
    dragFrame(h, left[0], {x: 366, width: 584});
    assert.equal(rectOf(left[0])[2], 468);
    assert.equal(rectOf(right[0])[2], 701);
    h.activate(right[1]);
    assert.equal(rectOf(left[0])[2], 468);
    assert.deepEqual(rectOf(left[1]), [8, 265, 350, 142]);
});

test('leaving stage keeps the window order and re-derives the tree', () => {
    const h = harness(gapped);
    const windows = addWindows(h, 3);
    fireShortcut(h, 'Layout Stage', windows[0]);
    fireShortcut(h, 'Layout Master', windows[0]);
    assert.deepEqual(windows.map(rectOf), layoutRects.master[3]);

    h.activate(windows[1]);
    fireShortcut(h, 'Layout Stage', windows[1]);
    assert.deepEqual(rectOf(windows[1]), stageRects[3][0]);
    h.activate(windows[2]);
    fireShortcut(h, 'Layout Columns', windows[2]);
    // After the promotion the order is focus w2, then the cells: w0, w1.
    const order = [2, 0, 1].map(index => rectOf(windows[index]));
    assert.deepEqual(order, layoutRects.columns[3]);
});

test('entering stage makes the active window the focus and keeps the others in order', () => {
    const h = harness(gapped);
    const windows = addWindows(h, 4);
    h.activate(windows[2]);
    fireShortcut(h, 'Layout Stage', windows[2]);
    const rects = stageRects[5];
    assert.deepEqual(rectOf(windows[2]), rects[0]);
    assert.deepEqual([0, 1, 3].map(index => rectOf(windows[index])), [rects[1], rects[2],
        rects[3]]);
});

test('stage and tree contexts are independent per output and desktop', () => {
    const h = harness(gapped);
    const left = addWindows(h, 3);
    const right = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'}),
        makeWindow('r2', {output: 'DP-2'})];
    right.forEach(window => h.add(window));
    fireShortcut(h, 'Layout Stage', left[0]);
    assert.deepEqual(left.map(rectOf), stageRects[3]);
    assert.deepEqual(right.map(rectOf), layoutRects.master[3]);
    h.activate(right[2]);
    assert.deepEqual(left.map(rectOf), stageRects[3]);
    assert.deepEqual(right.map(rectOf), layoutRects.master[3]);
    h.workspace.desktops['DP-1'] = 3;
    const other = makeWindow('other');
    h.add(other);
    assert.deepEqual(rectOf(other), layoutRects.master[1][0]);
    assert.deepEqual(left.map(rectOf), stageRects[3]);
});

test('a window moved to another output joins that stage in a rail cell', () => {
    const h = harness(stageSettings);
    const left = addWindows(h, 3);
    const right = [makeWindow('r0', {output: 'DP-2'})];
    h.add(right[0]);
    left[2].output = 'DP-2';
    left[2].outputChanged.emit();
    assert.deepEqual(rectOf(left[0]), stageRects[2][0]);
    assert.deepEqual(rectOf(left[1]), stageRects[2][1]);
    assert.deepEqual(rectOf(right[0]), stageRects[2][0]);
    assert.deepEqual(rectOf(left[2]), stageRects[2][1]);
});

test('floating a stage window and tiling it again keeps the others in their cells', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 3);
    fireShortcut(h, 'Toggle Float', windows[1]);
    assert.deepEqual(rectOf(windows[2]), stageRects[3][2]);
    fireShortcut(h, 'Toggle Float', windows[1]);
    assert.deepEqual(windows.map(rectOf), stageRects[3]);
});

test('stage layout switches log the layout line and promotions log the focus line', () => {
    const h = harness(Object.assign({logLevel: 'info'}, gapped));
    const windows = addWindows(h, 3);
    fireShortcut(h, 'Layout Stage', windows[0]);
    h.activate(windows[2]);
    fireShortcut(h, 'Stage Cycle Next', windows[2]);
    const lines = h.logs.filter(line => /layout |stage /.test(line));
    assert.deepEqual(lines, [
        'weave layout ["DP-1",2] -> stage',
        'weave stage ["DP-1",2] focus -> w2',
        'weave stage ["DP-1",2] focus -> w1'
    ]);
});

test('stage windows are saved as tiled records', () => {
    const h = harness(Object.assign({settleSeconds: 0}, stageSettings),
        {dbus: {reply: '{}'}});
    addWindows(h, 3);
    h.advance(2000);
    const calls = h.dbusCalls.filter(call => call.method === 'Set');
    const records = JSON.parse(calls[calls.length - 1].args[0]).records;
    assert.equal(records.length, 3);
    records.forEach(record => assert.equal(record.mode, 'tiled'));
});

test('stage never assigns geometry in a loop: activation and cycling write once per window', () => {
    const h = harness(stageSettings);
    const windows = addWindows(h, 7);
    let writes = totalWrites(windows);
    h.activate(windows[5]);
    assert.equal(totalWrites(windows) - writes, 7);
    writes = totalWrites(windows);
    fireShortcut(h, 'Stage Cycle Next', windows[5]);
    assert.equal(totalWrites(windows) - writes, 7);
    writes = totalWrites(windows);
    windows.forEach(window => window.frameGeometryChanged.emit());
    assert.equal(totalWrites(windows), writes);
});

// ---- keyboard actions: move, resize, master count, float all, promote ----

const master3 = layoutRects.master[3];

function gappedWith(extra, layout) {
    return Object.assign({defaultLayout: layout || 'master'}, gapped, extra || {});
}

function setup(count, layout, extra) {
    const h = harness(gappedWith(extra, layout));
    return {h, windows: addWindows(h, count)};
}

function fire(h, name, window) {
    fireShortcut(h, name, window);
}

function rectsOf(windows) {
    return windows.map(rectOf);
}

function assertNoWrites(windows, action) {
    const before = totalWrites(windows);
    action();
    assert.equal(totalWrites(windows), before);
}

test('keys: shortcut names for the five actions exist with empty default keys', () => {
    const h = harness();
    ['Move Left', 'Move Right', 'Move Up', 'Move Down', 'Resize Grow Width',
        'Resize Shrink Width', 'Resize Grow Height', 'Resize Shrink Height', 'Master More',
        'Master Fewer', 'Float All', 'Reload Config', 'Promote'].forEach(name => {
        assert.ok(h.shortcuts.has('Weave ' + name), name);
        assert.equal(h.shortcuts.get('Weave ' + name).key, '');
    });
});

test('move: master layout swaps with the nearest neighbour in each direction', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    fire(h, 'Move Right', a);
    assert.deepEqual(rectsOf(windows), [master3[1], master3[0], master3[2]]);
    fire(h, 'Move Left', a);
    assert.deepEqual(rectsOf(windows), master3);
    fire(h, 'Move Down', b);
    assert.deepEqual(rectsOf(windows), [master3[0], master3[2], master3[1]]);
    fire(h, 'Move Up', b);
    assert.deepEqual(rectsOf(windows), master3);
    fire(h, 'Move Left', c);
    assert.deepEqual(rectsOf(windows), [master3[2], master3[1], master3[0]]);
});

test('move: nothing happens at the work-area edge and nothing is written', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    assertNoWrites(windows, () => {
        fire(h, 'Move Left', a);
        fire(h, 'Move Up', a);
        fire(h, 'Move Down', a);
        fire(h, 'Move Right', b);
        fire(h, 'Move Up', b);
        fire(h, 'Move Down', c);
        fire(h, 'Move Right', c);
    });
    assert.deepEqual(rectsOf(windows), master3);
});

test('move: columns and spiral swap with the adjacent window, monocle does nothing', () => {
    const columns = setup(3, 'columns');
    fire(columns.h, 'Move Right', columns.windows[0]);
    const row = layoutRects.columns[3];
    assert.deepEqual(rectsOf(columns.windows), [row[1], row[0], row[2]]);
    const spiral = setup(3, 'spiral');
    fire(spiral.h, 'Move Right', spiral.windows[0]);
    const grid = layoutRects.spiral[3];
    assert.deepEqual(rectsOf(spiral.windows), [grid[1], grid[0], grid[2]]);
    const monocle = setup(3, 'monocle');
    assertNoWrites(monocle.windows, () => {
        ['Left', 'Right', 'Up', 'Down'].forEach(side =>
            fire(monocle.h, 'Move ' + side, monocle.windows[1]));
    });
});

test('move: stage swaps the window in place with the neighbouring cell', () => {
    const {h, windows} = setup(3, 'stage');
    const [focus, left, right] = windows;
    fire(h, 'Move Left', focus);
    assert.deepEqual(rectsOf(windows), [stageRects[3][1], stageRects[3][0], stageRects[3][2]]);
    fire(h, 'Move Right', focus);
    assert.deepEqual(rectsOf(windows), stageRects[3]);
    fire(h, 'Move Right', left);
    assert.deepEqual(rectsOf(windows), [stageRects[3][1], stageRects[3][0], stageRects[3][2]]);
    assertNoWrites(windows, () => fire(h, 'Move Right', right));
    assert.equal(rectOf(right)[0], stageRects[3][2][0]);
});

test('move: a pinned stage cell stays where it is', () => {
    const {h, windows} = setup(3, 'stage');
    fire(h, 'Stage Pin', windows[1]);
    assertNoWrites(windows.slice(1), () => fire(h, 'Move Right', windows[1]));
    assert.deepEqual(rectsOf(windows), stageRects[3]);
});

test('move: floating and arranged windows are left alone', () => {
    const {h, windows} = setup(3);
    fire(h, 'Toggle Float', windows[1]);
    const before = rectsOf(windows);
    assertNoWrites(windows, () => fire(h, 'Move Left', windows[1]));
    assert.deepEqual(rectsOf(windows), before);
    const arranged = harness(gapped);
    const set = activatedWindows(arranged, 3);
    fire(arranged, 'Arrange Next', set[2]);
    assertNoWrites(set, () => ['Left', 'Right', 'Up', 'Down'].forEach(side =>
        fire(arranged, 'Move ' + side, set[2])));
});

test('move: marks the context as edited so an arrival is inserted, not re-derived', () => {
    const {h, windows} = setup(3);
    fire(h, 'Move Right', windows[0]);
    const late = makeWindow('late');
    h.add(late);
    assert.deepEqual(rectOf(windows[2]), [722, 405, 231, 388]);
    assert.deepEqual(rectOf(late), [961, 405, 231, 388]);
});

test('move: contexts on other outputs are untouched', () => {
    const {h, windows} = setup(3);
    const others = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'})];
    others.forEach(window => h.add(window));
    const before = rectsOf(others);
    fire(h, 'Move Right', windows[0]);
    assert.deepEqual(rectsOf(others), before);
    assert.deepEqual(rectsOf(windows), [master3[1], master3[0], master3[2]]);
});

test('resize: master grows and shrinks by the step, the stack follows', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    fire(h, 'Resize Grow Width', a);
    assert.deepEqual(rectsOf(windows), [[8, 8, 782, 785], [798, 8, 394, 389],
        [798, 405, 394, 388]]);
    fire(h, 'Resize Shrink Width', a);
    fire(h, 'Resize Shrink Width', a);
    assert.deepEqual(rectsOf(windows), [[8, 8, 630, 785], [646, 8, 546, 389],
        [646, 405, 546, 388]]);
    fire(h, 'Resize Grow Width', a);
    assert.deepEqual(rectsOf(windows), master3);
    assert.ok(b && c);
});

test('resize: a stack window grows by moving its own left edge', () => {
    const {h, windows} = setup(3);
    fire(h, 'Resize Grow Width', windows[1]);
    assert.deepEqual(rectsOf(windows), [[8, 8, 630, 785], [646, 8, 546, 389],
        [646, 405, 546, 388]]);
    fire(h, 'Resize Shrink Width', windows[2]);
    assert.deepEqual(rectsOf(windows), master3);
});

test('resize: height moves the separator between the stack windows', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    fire(h, 'Resize Grow Height', b);
    assert.deepEqual(rectsOf([b, c]), [[722, 8, 470, 465], [722, 481, 470, 312]]);
    fire(h, 'Resize Shrink Height', b);
    fire(h, 'Resize Shrink Height', b);
    assert.deepEqual(rectsOf([b, c]), [[722, 8, 470, 313], [722, 329, 470, 464]]);
    fire(h, 'Resize Grow Height', c);
    fire(h, 'Resize Shrink Height', c);
    assert.deepEqual(rectsOf([b, c]), [[722, 8, 470, 313], [722, 329, 470, 464]]);
    fire(h, 'Resize Grow Height', c);
    assert.deepEqual(rectsOf([b, c]), [[722, 8, 470, 237], [722, 253, 470, 540]]);
    assert.deepEqual(rectOf(a), master3[0]);
});

test('resize: no ancestor split on the axis means no change and no writes', () => {
    const {h, windows} = setup(3);
    assertNoWrites(windows, () => {
        fire(h, 'Resize Grow Height', windows[0]);
        fire(h, 'Resize Shrink Height', windows[0]);
    });
    const single = setup(1);
    assertNoWrites(single.windows, () => {
        ['Grow Width', 'Shrink Width', 'Grow Height', 'Shrink Height'].forEach(name =>
            fire(single.h, 'Resize ' + name, single.windows[0]));
    });
    const monocle = setup(3, 'monocle');
    assertNoWrites(monocle.windows, () => fire(monocle.h, 'Resize Grow Width', monocle.windows[0]));
    const columns = setup(3, 'columns');
    assertNoWrites(columns.windows, () =>
        fire(columns.h, 'Resize Grow Height', columns.windows[1]));
});

test('resize: columns use the nearest split, so the middle column moves its right edge', () => {
    const {h, windows} = setup(3, 'columns');
    fire(h, 'Resize Grow Width', windows[1]);
    assert.deepEqual(rectsOf(windows), [[8, 8, 392, 785], [408, 8, 464, 785], [880, 8, 312, 785]]);
    const first = setup(3, 'columns');
    fire(first.h, 'Resize Grow Width', first.windows[0]);
    assert.deepEqual(rectsOf(first.windows), [[8, 8, 468, 785], [484, 8, 350, 785],
        [842, 8, 350, 785]]);
});

test('resize: each pane keeps 100 px', () => {
    const {h, windows} = setup(2);
    for (let index = 0; index < 12; index++) { fire(h, 'Resize Shrink Width', windows[0]); }
    assert.deepEqual(rectsOf(windows), [[8, 8, 100, 785], [116, 8, 1076, 785]]);
    for (let index = 0; index < 20; index++) { fire(h, 'Resize Grow Width', windows[0]); }
    assert.deepEqual(rectsOf(windows), [[8, 8, 1076, 785], [1092, 8, 100, 785]]);
});

test('resize: resizeStep is configurable and clamped to 8..400', () => {
    const widths = {40: 666, 1000: 306, 2: 698, abc: 630};
    Object.keys(widths).forEach(value => {
        const step = value === 'abc' ? value : Number(value);
        const {h, windows} = setup(2, 'master', {resizeStep: step});
        fire(h, 'Resize Shrink Width', windows[0]);
        assert.equal(rectOf(windows[0])[2], widths[value], value);
    });
});

test('resize: marks the context as edited so an arrival is inserted, not re-derived', () => {
    const {h, windows} = setup(3);
    fire(h, 'Resize Grow Width', windows[0]);
    const late = makeWindow('late');
    h.add(late);
    assert.deepEqual(rectOf(windows[0]), [8, 8, 782, 785]);
    assert.equal(rectOf(late)[0], 999);
});

test('resize: a lone floating window moves only its free sides', () => {
    const {h, windows} = setup(2);
    const [a, b] = windows;
    fire(h, 'Toggle Float', b);
    fire(h, 'Toggle Float', a);
    assert.deepEqual(rectOf(b), [0, 0, 800, 601]);
    fire(h, 'Resize Shrink Width', b);
    assert.deepEqual(rectOf(b), [0, 0, 724, 601]);
    fire(h, 'Resize Grow Width', b);
    fire(h, 'Resize Grow Width', b);
    assert.deepEqual(rectOf(b), [0, 0, 876, 601]);
    fire(h, 'Resize Shrink Height', b);
    assert.deepEqual(rectOf(b), [0, 0, 876, 550]);
    fire(h, 'Resize Grow Height', b);
    assert.deepEqual(rectOf(b), [0, 0, 876, 601]);
});

test('resize: a floating step that would go below 200x150 is refused', () => {
    const {h, windows} = setup(1);
    const b = windows[0];
    fire(h, 'Toggle Float', b);
    for (let index = 0; index < 30; index++) { fire(h, 'Resize Shrink Width', b); }
    assert.equal(rectOf(b)[2], 268);
    const frozen = b.geometryWrites;
    fire(h, 'Resize Shrink Width', b);
    assert.equal(b.geometryWrites, frozen);
    for (let index = 0; index < 30; index++) { fire(h, 'Resize Grow Width', b); }
    assert.deepEqual([rectOf(b)[0], rectOf(b)[2]], [0, 1192]);
    for (let index = 0; index < 30; index++) { fire(h, 'Resize Shrink Height', b); }
    assert.ok(rectOf(b)[3] >= 150 && rectOf(b)[3] < 201);
    for (let index = 0; index < 30; index++) { fire(h, 'Resize Grow Height', b); }
    assert.deepEqual([rectOf(b)[1], rectOf(b)[3]], [0, 793]);
});

test('resize: a resized floating window returns to that size after a tile and float', () => {
    const {h, windows} = setup(2);
    const b = windows[1];
    fire(h, 'Toggle Float', b);
    fire(h, 'Resize Grow Width', b);
    fire(h, 'Toggle Float', b);
    assert.deepEqual(rectOf(b), layoutRects.master[2][1]);
    fire(h, 'Toggle Float', b);
    assert.deepEqual(rectOf(b), [0, 0, 876, 601]);
});

test('resize: stage changes only the focus ratio of the focus window, clamped', () => {
    const {h, windows} = setup(3, 'stage');
    const [focus, left, right] = windows;
    fire(h, 'Resize Grow Width', focus);
    assert.equal(rectOf(focus)[2], 777);
    assert.deepEqual(rectOf(focus), [211, 8, 777, 785]);
    assert.deepEqual([left, right].map(rectOf).map(r => [r[1], r[3]]),
        [[stageRects[3][1][1], stageRects[3][1][3]], [stageRects[3][2][1], stageRects[3][2][3]]]);
    fire(h, 'Resize Shrink Width', focus);
    fire(h, 'Resize Shrink Width', focus);
    assert.deepEqual(rectOf(focus), [287, 8, 625, 785]);
    for (let index = 0; index < 6; index++) { fire(h, 'Resize Grow Width', focus); }
    assert.equal(rectOf(focus)[2], 934);
    for (let index = 0; index < 12; index++) { fire(h, 'Resize Shrink Width', focus); }
    assert.equal(rectOf(focus)[2], 350);
});

test('resize: stage rail windows and the height keys do nothing', () => {
    const {h, windows} = setup(3, 'stage');
    assertNoWrites(windows, () => {
        fire(h, 'Resize Grow Width', windows[1]);
        fire(h, 'Resize Shrink Width', windows[2]);
        fire(h, 'Resize Grow Height', windows[0]);
        fire(h, 'Resize Shrink Height', windows[0]);
    });
    assert.deepEqual(rectsOf(windows), stageRects[3]);
});

test('resize: the focus ratio belongs to the context and survives a stage relayout', () => {
    const h = harness(gappedWith({}, 'stage'));
    const near = addWindows(h, 3);
    const far = [0, 1, 2].map(index => makeWindow('r' + index, {output: 'DP-2'}));
    far.forEach(window => h.add(window));
    fire(h, 'Resize Grow Width', near[0]);
    assert.deepEqual(rectsOf(far), stageRects[3]);
    fire(h, 'Retile', near[0]);
    assert.equal(rectOf(near[0])[2], 777);
    h.activate(near[2]);
    assert.equal(rectOf(near[2])[2], 777);
});

test('resize: arranged windows are left alone', () => {
    const h = harness(gapped);
    const set = activatedWindows(h, 3);
    fire(h, 'Arrange Next', set[2]);
    assertNoWrites(set, () => ['Grow Width', 'Shrink Width', 'Grow Height',
        'Shrink Height'].forEach(name => fire(h, 'Resize ' + name, set[2])));
});

test('masters: more and fewer change the master column of the master layout', () => {
    const {h, windows} = setup(5);
    fire(h, 'Master More', windows[0]);
    assert.deepEqual(rectsOf(windows), [[8, 8, 706, 389], [8, 405, 706, 388],
        [722, 8, 470, 259], [722, 275, 470, 255], [722, 538, 470, 255]]);
    fire(h, 'Master More', windows[0]);
    assert.deepEqual(rectsOf(windows), [[8, 8, 706, 259], [8, 275, 706, 255],
        [8, 538, 706, 255], [722, 8, 470, 389], [722, 405, 470, 388]]);
    fire(h, 'Master More', windows[0]);
    fire(h, 'Master More', windows[0]);
    assert.deepEqual(rectsOf(windows)[4], [722, 8, 470, 785]);
    assertNoWrites(windows, () => fire(h, 'Master More', windows[0]));
    for (let index = 0; index < 3; index++) { fire(h, 'Master Fewer', windows[0]); }
    assert.deepEqual(rectsOf(windows), layoutRects.master[5]);
    assertNoWrites(windows, () => fire(h, 'Master Fewer', windows[0]));
});

test('masters: one or two windows never get more than one master', () => {
    [1, 2].forEach(count => {
        const {h, windows} = setup(count);
        assertNoWrites(windows, () => fire(h, 'Master More', windows[0]));
        assert.deepEqual(rectsOf(windows), layoutRects.master[count]);
    });
});

test('masters: arrivals and removals respect the count and the maximum', () => {
    const {h, windows} = setup(3);
    fire(h, 'Master More', windows[0]);
    assert.deepEqual(rectsOf(windows), [[8, 8, 706, 389], [8, 405, 706, 388], [722, 8, 470, 785]]);
    const late = makeWindow('late');
    h.add(late);
    assert.deepEqual(rectOf(late), [722, 405, 470, 388]);
    h.remove(late);
    h.remove(windows[2]);
    assert.deepEqual(rectsOf(windows.slice(0, 2)), layoutRects.master[2]);
    const again = makeWindow('again');
    h.add(again);
    assert.deepEqual(rectOf(again), [722, 8, 470, 785]);
});

test('masters: the count is per context and other layouts ignore the shortcuts', () => {
    const h = harness(gapped);
    const near = addWindows(h, 4);
    const far = [0, 1, 2, 3].map(index => makeWindow('r' + index, {output: 'DP-2'}));
    far.forEach(window => h.add(window));
    fire(h, 'Master More', near[0]);
    assert.deepEqual(rectOf(far[1]), [722, 8, 470, 259]);
    assert.deepEqual(rectOf(near[1]), [8, 405, 706, 388]);
    fire(h, 'Layout Columns', near[0]);
    assertNoWrites(near, () => fire(h, 'Master Fewer', near[0]));
    fire(h, 'Layout Master', near[0]);
    assert.deepEqual(rectOf(near[1]), [8, 405, 706, 388]);
    fire(h, 'Layout Stage', near[0]);
    assertNoWrites(near, () => fire(h, 'Master More', near[0]));
});

test('masters: a floating window and the shortcut on it change nothing', () => {
    const {h, windows} = setup(4);
    fire(h, 'Toggle Float', windows[3]);
    assertNoWrites(windows, () => fire(h, 'Master More', windows[3]));
});

test('float all: floats every tiled window of the context and tiles them again in order', () => {
    const h = harness(gapped);
    const frames = [{x: 30, y: 40, width: 500, height: 300},
        {x: 100, y: 120, width: 400, height: 350},
        {x: 200, y: 220, width: 450, height: 380}];
    const windows = frames.map((frame, index) => makeWindow('w' + index, {frameGeometry: frame}));
    windows.forEach(window => h.add(window));
    assert.deepEqual(rectsOf(windows), master3);
    fire(h, 'Move Right', windows[0]);
    fire(h, 'Float All', windows[1]);
    assert.deepEqual(rectsOf(windows), frames.map(f => [f.x, f.y, f.width, f.height]));
    fire(h, 'Float All', windows[2]);
    assert.deepEqual(rectsOf(windows), master3);
});

test('float all: one tiled window among floating ones floats the rest', () => {
    const {h, windows} = setup(3);
    fire(h, 'Toggle Float', windows[1]);
    fire(h, 'Float All', windows[0]);
    windows.forEach(window => assert.deepEqual(rectOf(window), [0, 0, 800, 601]));
    fire(h, 'Float All', windows[1]);
    assert.deepEqual(rectsOf(windows), master3);
});

test('float all: a context without tiled windows tiles its floating ones', () => {
    const {h, windows} = setup(2);
    fire(h, 'Toggle Float', windows[0]);
    fire(h, 'Toggle Float', windows[1]);
    fire(h, 'Float All', windows[1]);
    assert.deepEqual(rectsOf(windows), layoutRects.master[2]);
});

test('float all: keeps the context layout, and stage round-trips', () => {
    const columns = setup(3, 'columns');
    fire(columns.h, 'Float All', columns.windows[0]);
    fire(columns.h, 'Float All', columns.windows[0]);
    assert.deepEqual(rectsOf(columns.windows), layoutRects.columns[3]);
    const staged = setup(3, 'stage');
    fire(staged.h, 'Float All', staged.windows[0]);
    fire(staged.h, 'Float All', staged.windows[0]);
    assert.deepEqual(rectsOf(staged.windows), stageRects[3]);
    const switched = setup(3);
    fire(switched.h, 'Layout Spiral', switched.windows[0]);
    fire(switched.h, 'Float All', switched.windows[0]);
    fire(switched.h, 'Float All', switched.windows[0]);
    assert.deepEqual(rectsOf(switched.windows), layoutRects.spiral[3]);
});

test('float all: other contexts and arranged windows stay as they are', () => {
    const h = harness(gapped);
    const near = addWindows(h, 2);
    const far = [makeWindow('r0', {output: 'DP-2'}), makeWindow('r1', {output: 'DP-2'})];
    far.forEach(window => h.add(window));
    const before = rectsOf(far);
    fire(h, 'Float All', near[0]);
    assert.deepEqual(rectsOf(far), before);
    fire(h, 'Float All', near[0]);
    assert.deepEqual(rectsOf(far), before);
    const arranged = harness(gapped);
    const set = activatedWindows(arranged, 3);
    fire(arranged, 'Arrange Next', set[2]);
    const placed = rectsOf(set);
    fire(arranged, 'Float All', set[2]);
    fire(arranged, 'Float All', set[2]);
    assert.deepEqual(rectsOf(set).slice(1), placed.slice(1));
});

test('float all: every window is written once per step', () => {
    const {h, windows} = setup(4);
    let writes = totalWrites(windows);
    fire(h, 'Float All', windows[0]);
    assert.equal(totalWrites(windows) - writes, 4);
    writes = totalWrites(windows);
    fire(h, 'Float All', windows[0]);
    assert.equal(totalWrites(windows) - writes, 4);
    writes = totalWrites(windows);
    windows.forEach(window => window.frameGeometryChanged.emit());
    assert.equal(totalWrites(windows), writes);
});

test('promote: the active window becomes the first of master, columns and spiral', () => {
    ['master', 'columns', 'spiral'].forEach(name => {
        const {h, windows} = setup(3, name);
        const rects = layoutRects[name][3];
        fire(h, 'Promote', windows[2]);
        assert.deepEqual(rectsOf(windows), [rects[1], rects[2], rects[0]], name);
        fire(h, 'Promote', windows[1]);
        assert.deepEqual(rectsOf(windows), [rects[2], rects[0], rects[1]], name);
        assertNoWrites(windows, () => fire(h, 'Promote', windows[1]));
    });
});

test('promote: monocle keeps the geometry and the next layout switch shows the new order', () => {
    const {h, windows} = setup(3, 'monocle');
    fire(h, 'Promote', windows[2]);
    windows.forEach(window => assert.deepEqual(rectOf(window), [8, 8, 1184, 785]));
    fire(h, 'Layout Master', windows[2]);
    assert.deepEqual(rectsOf(windows), [master3[1], master3[2], master3[0]]);
});

test('promote: in stage the window takes the focus slot like an activation does', () => {
    const {h, windows} = setup(3, 'stage');
    fire(h, 'Promote', windows[2]);
    assert.deepEqual(rectsOf(windows), [stageRects[3][2], stageRects[3][1], stageRects[3][0]]);
    assertNoWrites(windows, () => fire(h, 'Promote', windows[2]));
});

test('promote: floating windows do nothing and a promote re-derives after a move', () => {
    const {h, windows} = setup(3);
    fire(h, 'Toggle Float', windows[1]);
    assertNoWrites(windows, () => fire(h, 'Promote', windows[1]));
    const moved = setup(3);
    fire(moved.h, 'Move Right', moved.windows[0]);
    fire(moved.h, 'Promote', moved.windows[2]);
    const late = makeWindow('late');
    moved.h.add(late);
    assert.deepEqual(rectOf(late), [722, 538, 470, 255]);
});

test('promote: each context keeps its own order', () => {
    const h = harness(gapped);
    const near = addWindows(h, 3);
    const far = [0, 1, 2].map(index => makeWindow('r' + index, {output: 'DP-2'}));
    far.forEach(window => h.add(window));
    fire(h, 'Promote', near[2]);
    assert.deepEqual(rectsOf(far), master3);
    assert.deepEqual(rectOf(near[2]), master3[0]);
});

test('keys: every action writes each window at most once and never loops', () => {
    const actions = ['Move Right', 'Resize Grow Width', 'Master More', 'Float All', 'Float All',
        'Promote'];
    const {h, windows} = setup(4);
    actions.forEach(name => {
        const before = totalWrites(windows);
        fire(h, name, windows[3]);
        assert.ok(totalWrites(windows) - before <= windows.length, name);
        const settled = totalWrites(windows);
        windows.forEach(window => window.frameGeometryChanged.emit());
        assert.equal(totalWrites(windows), settled, name);
    });
});

// Float-first mode: manageClasses wildcards, defaultMode and tileClasses.

function editorWindow(id, cls, options = {}) {
    return makeWindow(id, Object.assign({resourceClass: cls, caption: 'Caption ' + id},
        options));
}

function managed(h, window) {
    // Snap does nothing to an unmanaged window, so a write shows that it is managed.
    const before = window.geometryWrites;
    fireShortcut(h, 'Snap Maximize', window);
    return window.geometryWrites > before;
}

test('wildcard: * manages every eligible window and keeps the eligibility rules', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float'});
    const ok = editorWindow('a', 'anything');
    const noClass = editorWindow('b', '');
    const noCaption = editorWindow('c', 'x', {caption: ''});
    const dialog = editorWindow('d', 'x', {dialog: true});
    const child = editorWindow('e', 'x', {transientFor: {}});
    const full = editorWindow('f', 'x', {fullScreen: true});
    const plain = editorWindow('g', 'x', {normalWindow: false});
    const all = [ok, noClass, noCaption, dialog, child, full, plain];
    all.forEach(window => h.add(window));
    assert.deepEqual(all.map(window => managed(h, window)),
        [true, false, false, false, false, false, false]);
});

test('wildcard: !name excludes a class, exact names still work, defaults stay inert', () => {
    const star = harness({manageClasses: '* , !org.kde.plasmashell'});
    const shell = editorWindow('a', 'org.kde.plasmashell');
    const other = editorWindow('b', 'kate');
    star.add(shell);
    star.add(other);
    assert.deepEqual(geometry(shell), {x: 0.4, y: 0.2, width: 799.6, height: 600.5});
    assert.equal(shell.geometryWrites, 0);
    assert.ok(other.geometryWrites > 0);

    const exact = harness({manageClasses: 'kate,!kate,konsole'});
    const kate = editorWindow('c', 'kate');
    const konsole = editorWindow('d', 'konsole');
    exact.add(kate);
    exact.add(konsole);
    assert.equal(kate.geometryWrites, 0);
    assert.ok(konsole.geometryWrites > 0);

    const onlyExclusions = harness({manageClasses: '!kate'});
    const lone = editorWindow('e', 'konsole');
    onlyExclusions.add(lone);
    assert.equal(lone.geometryWrites, 0);

    const inert = harness();
    const idle = editorWindow('f', 'konsole');
    inert.add(idle);
    assert.equal(idle.geometryWrites, 0);
});

test('wildcard: a window turning into an excluded class is released by a config change', () => {
    const h = harness({manageClasses: '*'});
    const a = editorWindow('a', 'kate');
    const b = editorWindow('b', 'kate');
    h.add(a);
    h.add(b);
    h.settings.manageClasses = '*,!kate';
    h.changed.emit();
    const writes = a.geometryWrites;
    fireShortcut(h, 'Snap Left Half', a);
    assert.equal(a.geometryWrites, writes, 'no longer managed');
});

test('defaults: defaultMode tiled, empty tileClasses and an unknown mode behave as before', () => {
    ['tiled', 'bogus', undefined].forEach(mode => {
        const settings = {manageClasses: 'editor', gapInner: 8, gapOuter: 8};
        if (mode !== undefined) { settings.defaultMode = mode; }
        const h = harness(settings);
        const a = makeWindow('a');
        h.add(a);
        assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 785});
    });
});

test('float mode: arrival registers the window but never touches its geometry', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float'});
    const start = {x: 123, y: 45, width: 640, height: 480};
    const windows = ['a', 'b', 'c'].map(id => makeWindow(id, {frameGeometry: start}));
    windows.forEach(window => h.add(window));
    assert.deepEqual(windows.map(window => window.geometryWrites), [0, 0, 0]);
    windows.forEach(window => assert.deepEqual(geometry(window), start));
});

test('float mode: Toggle Float tiles the window and the next toggle restores its rectangle', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', gapInner: 8, gapOuter: 8});
    const start = {x: 123, y: 45, width: 640, height: 480};
    const a = makeWindow('a', {frameGeometry: start});
    h.add(a);
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 785});
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), start);
    assert.equal(a.geometryWrites, 2);
});

test('float mode: tiling one window leaves the floating ones alone and a second joins', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a', {frameGeometry: {x: 100, y: 100, width: 300, height: 300}});
    const b = makeWindow('b', {frameGeometry: {x: 500, y: 100, width: 300, height: 300}});
    const c = makeWindow('c', {frameGeometry: {x: 300, y: 400, width: 300, height: 300}});
    [a, b, c].forEach(window => h.add(window));
    fireShortcut(h, 'Toggle Float', a);
    fireShortcut(h, 'Toggle Float', b);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 706, height: 785});
    assert.deepEqual(geometry(b), {x: 722, y: 8, width: 470, height: 785});
    assert.equal(c.geometryWrites, 0);
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 100, y: 100, width: 300, height: 300});
    assert.deepEqual(geometry(b), {x: 8, y: 8, width: 1184, height: 785});
    assert.equal(c.geometryWrites, 0);
});

test('tileClasses: those classes arrive tiled and relayout, the rest arrive floating', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', tileClasses: 'zen, vesktop',
        gapInner: 8, gapOuter: 8});
    const free = makeWindow('f', {resourceClass: 'kate',
        frameGeometry: {x: 200, y: 200, width: 400, height: 300}});
    const zen = makeWindow('z', {resourceClass: 'zen'});
    const vesktop = makeWindow('v', {resourceClass: 'vesktop'});
    h.add(free);
    h.add(zen);
    assert.deepEqual(geometry(zen), {x: 8, y: 8, width: 1184, height: 785});
    h.add(vesktop);
    assert.deepEqual(geometry(zen), {x: 8, y: 8, width: 706, height: 785});
    assert.deepEqual(geometry(vesktop), {x: 722, y: 8, width: 470, height: 785});
    assert.equal(free.geometryWrites, 0);
    h.remove(zen);
    assert.deepEqual(geometry(vesktop), {x: 8, y: 8, width: 1184, height: 785});
    fireShortcut(h, 'Toggle Float', vesktop);
    assert.equal(free.geometryWrites, 0);
});

test('tileClasses: with the default mode tiled, a tile class changes nothing', () => {
    const h = harness({manageClasses: '*', tileClasses: 'zen', gapInner: 8, gapOuter: 8});
    const other = makeWindow('o', {resourceClass: 'kate'});
    h.add(other);
    assert.deepEqual(geometry(other), {x: 8, y: 8, width: 1184, height: 785});
});

test('float mode: Snap moves a never-tiled window and the next toggle tiles it', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a', {frameGeometry: {x: 300, y: 300, width: 200, height: 200}});
    h.add(a);
    fireShortcut(h, 'Snap Left Half', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 588, height: 785});
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 785});
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 588, height: 785});
});

test('float mode: Layout changes only move the tiled windows of a mixed context', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', tileClasses: 'zen,vesktop',
        gapInner: 8, gapOuter: 8});
    const free = makeWindow('f', {resourceClass: 'kate',
        frameGeometry: {x: 200, y: 200, width: 400, height: 300}});
    const zen = makeWindow('z', {resourceClass: 'zen'});
    const vesktop = makeWindow('v', {resourceClass: 'vesktop'});
    [free, zen, vesktop].forEach(window => h.add(window));
    fireShortcut(h, 'Layout Monocle', zen);
    assert.deepEqual(geometry(vesktop), {x: 8, y: 8, width: 1184, height: 785});
    fireShortcut(h, 'Layout Columns', zen);
    assert.deepEqual(geometry(zen), {x: 8, y: 8, width: 588, height: 785});
    assert.equal(free.geometryWrites, 0);
    fireShortcut(h, 'Promote', vesktop);
    assert.deepEqual(geometry(vesktop), {x: 8, y: 8, width: 588, height: 785});
    assert.equal(free.geometryWrites, 0);
});

test('float mode: Arrange takes floating and tiled windows and Release returns them', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', tileClasses: 'zen',
        gapInner: 8, gapOuter: 8});
    const startFree = {x: 200, y: 200, width: 400, height: 300};
    const free = makeWindow('f', {resourceClass: 'kate', frameGeometry: startFree});
    const zen = makeWindow('z', {resourceClass: 'zen'});
    [free, zen].forEach(window => h.add(window));
    h.activate(zen);
    h.activate(free);
    fireShortcut(h, 'Arrange Next', free);
    assert.ok(free.geometryWrites > 0 && zen.geometryWrites > 1);
    const zenArranged = geometry(zen);
    assert.notDeepEqual(geometry(free), startFree);
    fireShortcut(h, 'Arrange Release', free);
    assert.deepEqual(geometry(free), startFree);
    assert.notDeepEqual(geometry(zen), zenArranged);
    assert.deepEqual(geometry(zen), {x: 8, y: 8, width: 1184, height: 785});
});

test('adoption: float mode adopts non-tile classes as floating and never moves anyone', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', settleSeconds: 2});
    const left = {x: 8, y: 8, width: 706, height: 785};
    const right = {x: 722, y: 8, width: 470, height: 785};
    const a = makeWindow('a', {frameGeometry: left});
    const b = makeWindow('b', {frameGeometry: right});
    const c = makeWindow('c', {frameGeometry: {x: 300, y: 300, width: 400, height: 300}});
    [a, b, c].forEach(window => h.add(window));
    h.advance(2000);
    assert.deepEqual([a, b, c].map(window => window.geometryWrites), [0, 0, 0]);
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 8, y: 8, width: 1184, height: 785});
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), left);
    assert.deepEqual(geometry(b), right);
});

test('adoption: tile classes are adopted as a tree, other classes as floating', () => {
    const initialWindows = [
        makeWindow('z', {resourceClass: 'zen', frameGeometry: {x: 8, y: 8, width: 706,
            height: 785}}),
        makeWindow('v', {resourceClass: 'vesktop', frameGeometry: {x: 722, y: 8, width: 470,
            height: 785}}),
        makeWindow('k', {resourceClass: 'kate', frameGeometry: {x: 300, y: 300, width: 400,
            height: 300}})
    ];
    const h = harness({manageClasses: '*', defaultMode: 'float', tileClasses: 'zen,vesktop',
        settleSeconds: 2, gapInner: 8, gapOuter: 8}, {initialWindows});
    h.advance(2000);
    const [zen, vesktop, kate] = initialWindows;
    assert.deepEqual(initialWindows.map(window => window.geometryWrites), [0, 0, 0]);
    h.remove(zen);
    assert.deepEqual(geometry(vesktop), {x: 8, y: 8, width: 1184, height: 785});
    assert.equal(kate.geometryWrites, 0);
    fireShortcut(h, 'Toggle Float', kate);
    assert.ok(kate.geometryWrites > 0, 'kate is managed');
});

test('adoption: a float-default set that is not a partition is still managed as floating', () => {
    const initialWindows = loginWindows();
    const h = harness({manageClasses: '*', defaultMode: 'float', settleSeconds: 1},
        {initialWindows});
    h.advance(1000);
    assert.deepEqual(initialWindows.map(window => window.geometryWrites), [0, 0, 0]);
    fireShortcut(h, 'Snap Left Half', initialWindows[2]);
    assert.ok(initialWindows[2].geometryWrites > 0);
});

test('persistence: saved modes win over defaultMode and tileClasses', () => {
    const tiledDefault = harness({manageClasses: 'editor', defaultMode: 'float', settleSeconds: 1,
        gapInner: 8, gapOuter: 8}, {dbus: {reply: loginReply}});
    const [a, b, c] = loginWindows();
    [a, b, c].forEach(window => tiledDefault.add(window));
    tiledDefault.advance(1000);
    assert.deepEqual([a, b, c].map(window => window.geometryWrites), [0, 0, 0]);
    tiledDefault.remove(a);
    assert.ok(b.geometryWrites > 0, 'saved tiled windows were adopted into the tree');
    assert.equal(c.geometryWrites, 0);

    const floatsFirst = harness({manageClasses: 'editor', tileClasses: 'editor',
        defaultMode: 'float', settleSeconds: 1}, {dbus: {reply: loginReply}});
    const [d, e, f] = loginWindows();
    [d, e, f].forEach(window => floatsFirst.add(window));
    floatsFirst.advance(1000);
    floatsFirst.remove(d);
    assert.ok(e.geometryWrites > 0);
    assert.equal(f.geometryWrites, 0, 'saved float stays floating although its class tiles');
});

test('persistence: float-mode windows are saved as float and restored as float', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', settleSeconds: 0},
        {dbus: {reply: '{}'}});
    const a = makeWindow('a', {caption: 'Alpha',
        frameGeometry: {x: 50, y: 60, width: 300, height: 200}});
    h.add(a);
    h.advance(2000);
    const records = JSON.parse(sets(h)[0].args[0]).records;
    assert.equal(records.length, 1);
    assert.equal(records[0].mode, 'float');
    assert.deepEqual(records[0].floatGeom, {x: 50, y: 60, width: 300, height: 200});
});

test('reassign: a floating window moved to another output is not touched and tiles there', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', gapInner: 8, gapOuter: 8}, {
        areas: {
            'DP-1': {x: 0, y: 0, width: 1200, height: 800},
            'DP-2': {x: 1200, y: 0, width: 1000, height: 800}
        }
    });
    const a = makeWindow('a', {frameGeometry: {x: 100, y: 100, width: 300, height: 300}});
    h.add(a);
    a.output = 'DP-2';
    a.outputChanged.emit();
    assert.equal(a.geometryWrites, 0);
    fireShortcut(h, 'Toggle Float', a);
    assert.deepEqual(geometry(a), {x: 1208, y: 8, width: 984, height: 784});
    fireShortcut(h, 'Toggle Float', a);
    assert.ok(geometry(a).x >= 1200, 'restored rectangle follows the output');
});

test('drag: moving or resizing a floating window never relayouts and is remembered', () => {
    const h = harness({manageClasses: '*', defaultMode: 'float', tileClasses: 'zen',
        gapInner: 8, gapOuter: 8});
    const zen = makeWindow('z', {resourceClass: 'zen'});
    const free = makeWindow('f', {resourceClass: 'kate',
        frameGeometry: {x: 200, y: 200, width: 400, height: 300}});
    h.add(zen);
    h.add(free);
    const zenWrites = zen.geometryWrites;
    free.move = true;
    free.interactiveMoveResizeStarted.emit();
    free.frameGeometry = {x: 700, y: 150, width: 400, height: 300};
    h.workspace.cursorPos = {x: geometry(zen).x + 10, y: geometry(zen).y + 10};
    free.interactiveMoveResizeFinished.emit();
    free.move = false;
    free.resize = true;
    free.interactiveMoveResizeStarted.emit();
    free.frameGeometry = {x: 700, y: 150, width: 500, height: 350};
    free.interactiveMoveResizeFinished.emit();
    assert.equal(zen.geometryWrites, zenWrites);
    assert.equal(free.geometryWrites, 2, 'only the two test assignments');
    fireShortcut(h, 'Toggle Float', free);
    fireShortcut(h, 'Toggle Float', free);
    assert.deepEqual(geometry(free), {x: 700, y: 150, width: 500, height: 350});
});

test('Snap Third cycles left, centre, right and Snap Two Thirds cycles left, right', () => {
    const h = harness({manageClasses: 'editor', gapInner: 8, gapOuter: 8});
    const a = makeWindow('a', {frameGeometry: {x: 300, y: 300, width: 200, height: 200}});
    h.add(a);
    const shortcutNames = Array.from(h.shortcuts.keys());
    assert.ok(!shortcutNames.some(name => /Snap (Left|Center|Right) Third/.test(name)));
    fireShortcut(h, 'Snap Left Half', a);
    const widths = [];
    const xs = [];
    for (let i = 0; i < 4; i++) {
        fireShortcut(h, 'Snap Third', a);
        widths.push(geometry(a).width);
        xs.push(geometry(a).x);
    }
    assert.deepEqual(xs, [8, 405, 803, 8]);
    assert.deepEqual(widths, [389, 390, 389, 389]);
    const twoXs = [];
    for (let i = 0; i < 3; i++) {
        fireShortcut(h, 'Snap Two Thirds', a);
        twoXs.push(geometry(a).x);
        assert.equal(geometry(a).width, 787);
    }
    assert.deepEqual(twoXs, [8, 405, 8]);
});

// ---- floating resize like a tiler, and Fill ----

function floatSetup(boxes, extra) {
    const h = harness(Object.assign({defaultMode: 'float'}, gappedWith(extra)));
    const windows = boxes.map((box, index) => {
        const options = Object.assign({frameGeometry: {x: box[0], y: box[1], width: box[2],
            height: box[3]}}, box[4] || {});
        const window = makeWindow('f' + index, options);
        h.add(window);
        return window;
    });
    return {h, windows};
}

const leftBox = [8, 8, 500, 400];
const rightBox = [516, 8, 676, 400];

test('tiler resize: shortcut names for grow, shrink and fill exist with empty keys', () => {
    const h = harness();
    ['Resize Grow', 'Resize Shrink', 'Resize Fill'].forEach(name => {
        assert.equal(h.shortcuts.get('Weave ' + name).key, '', name);
    });
});

test('tiler resize: a managed floating neighbour moves with the shared edge', () => {
    const {h, windows} = floatSetup([leftBox, rightBox]);
    const [a, b] = windows;
    fire(h, 'Resize Grow Width', a);
    assert.deepEqual(rectOf(a), [8, 8, 576, 400]);
    assert.deepEqual(rectOf(b), [592, 8, 600, 400]);
    assert.deepEqual([a.geometryWrites, b.geometryWrites], [1, 1]);
    fire(h, 'Resize Shrink Width', a);
    assert.deepEqual(rectOf(a), [8, 8, 500, 400]);
    assert.deepEqual(rectOf(b), [516, 8, 676, 400]);
    assert.deepEqual([a.geometryWrites, b.geometryWrites], [2, 2]);
});

test('tiler resize: the neighbour on the left side is resized by the right window', () => {
    const {h, windows} = floatSetup([leftBox, rightBox]);
    fire(h, 'Resize Grow Width', windows[1]);
    assert.deepEqual(rectOf(windows[1]), [440, 8, 752, 400]);
    assert.deepEqual(rectOf(windows[0]), [8, 8, 424, 400]);
});

test('tiler resize: an unmanaged window is a neighbour too', () => {
    const {h, windows} = floatSetup([leftBox, rightBox.concat([{resourceClass: 'other'}])]);
    fire(h, 'Resize Grow Width', windows[0]);
    assert.deepEqual(rectOf(windows[1]), [592, 8, 600, 400]);
});

test('tiler resize: a neighbour keeps its resized size when it floats again later', () => {
    const {h, windows} = floatSetup([leftBox, rightBox]);
    fire(h, 'Resize Grow Width', windows[0]);
    fire(h, 'Toggle Float', windows[1]);
    fire(h, 'Toggle Float', windows[1]);
    assert.deepEqual(rectOf(windows[1]), [592, 8, 600, 400]);
});

test('tiler resize: other outputs, desktops and minimized windows are ignored', () => {
    const ignored = [{output: 'DP-2'}, {desktops: [3]}, {minimized: true},
        {desktopWindow: true}];
    ignored.forEach(extra => {
        const {h, windows} = floatSetup([leftBox, rightBox.concat([{}])]);
        Object.assign(windows[1], extra);
        fire(h, 'Resize Grow Width', windows[0]);
        assert.deepEqual(rectOf(windows[0]), [8, 8, 576, 400], JSON.stringify(extra));
        assert.equal(windows[1].geometryWrites, 0, JSON.stringify(extra));
    });
});

test('tiler resize: a window on all desktops counts as a neighbour', () => {
    const {h, windows} = floatSetup([leftBox, rightBox]);
    Object.assign(windows[1], {desktops: [3], onAllDesktops: true});
    fire(h, 'Resize Grow Width', windows[0]);
    assert.deepEqual(rectOf(windows[1]), [592, 8, 600, 400]);
});

test('tiler resize: a tiled neighbour is never moved and blocks the shared edge', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    fire(h, 'Toggle Float', b);
    b.frameGeometry = {x: 722, y: 8, width: 470, height: 389};
    assert.deepEqual([rectOf(a), rectOf(c)], [[8, 8, 706, 785], [722, 8, 470, 785]]);
    const writes = totalWrites(windows);
    fire(h, 'Resize Grow Width', b);
    assert.deepEqual(rectOf(b), [722, 8, 470, 389]);
    assert.equal(totalWrites(windows), writes);
});

test('tiler resize: two neighbours on one side both follow', () => {
    const {h, windows} = floatSetup([[8, 8, 500, 400], [516, 8, 676, 200],
        [516, 216, 676, 192]]);
    fire(h, 'Resize Grow Width', windows[0]);
    assert.deepEqual(rectOf(windows[1]), [592, 8, 600, 200]);
    assert.deepEqual(rectOf(windows[2]), [592, 216, 600, 192]);
});

test('tiler resize: grow and shrink change both dimensions', () => {
    const {h, windows} = floatSetup([[100, 100, 400, 300]]);
    fire(h, 'Resize Grow', windows[0]);
    assert.deepEqual(rectOf(windows[0]), [24, 49, 552, 401]);
    fire(h, 'Resize Shrink', windows[0]);
    assert.deepEqual(rectOf(windows[0]), [100, 100, 400, 300]);
    assert.equal(windows[0].geometryWrites, 2);
});

test('tiler resize: grow and shrink on a tiled window use the tree resize on both axes', () => {
    const {h, windows} = setup(3);
    fire(h, 'Resize Grow', windows[1]);
    const grown = rectOf(windows[1]);
    fire(h, 'Resize Grow Width', windows[2]);
    const {h: h2, windows: w2} = setup(3);
    fire(h2, 'Resize Grow Width', w2[1]);
    fire(h2, 'Resize Grow Height', w2[1]);
    assert.deepEqual(grown, rectOf(w2[1]));
    assert.notDeepEqual(rectsOf(windows), rectsOf(w2));
});

test('fill: takes the largest free area between the other windows', () => {
    const {h, windows} = floatSetup([[8, 8, 400, 785], [800, 8, 392, 785], [500, 300, 100, 100]]);
    fire(h, 'Resize Fill', windows[2]);
    assert.deepEqual(rectOf(windows[2]), [416, 8, 376, 785]);
    assert.equal(windows[2].geometryWrites, 1);
    fire(h, 'Resize Fill', windows[2]);
    assert.equal(windows[2].geometryWrites, 1);
});

test('fill: an alone window fills the work area inside the outer gap', () => {
    const {h, windows} = floatSetup([[300, 300, 100, 100]]);
    fire(h, 'Resize Fill', windows[0]);
    assert.deepEqual(rectOf(windows[0]), [8, 8, 1184, 785]);
});

test('fill: tiled windows are obstacles and a tiled window ignores Fill', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    const writes = totalWrites(windows);
    fire(h, 'Resize Fill', a);
    assert.equal(totalWrites(windows), writes);
    fire(h, 'Toggle Float', b);
    b.frameGeometry = {x: 722, y: 8, width: 470, height: 389};
    const afterFloat = totalWrites(windows);
    fire(h, 'Resize Fill', b);
    assert.equal(totalWrites(windows), afterFloat);
    assert.deepEqual([rectOf(a), rectOf(b), rectOf(c)],
        [[8, 8, 706, 785], [722, 8, 470, 389], [722, 8, 470, 785]]);
});

// ---- Tile All <Layout> ----

const twoScreens = [
    {name: 'DP-1', geometry: {x: 0, y: 0, width: 1200, height: 800}},
    {name: 'DP-2', geometry: {x: 1200, y: 0, width: 1200, height: 800}}
];
const floatSettings = Object.assign({defaultMode: 'float'}, gapped);

// Distinct work areas matter: the basic harness otherwise returns DP-1's area
// for both outputs, which hides geometry written to the wrong monitor.
const twoScreenAreas = Object.fromEntries(twoScreens.map(output =>
    [output.name, output.geometry]));

function assertTiledOnScreen(window, screen, layout = 'master') {
    const area = screen.geometry;
    const rect = geometry(window);
    assert.ok(window.geometryWrites > 0, 'window received a tiled rectangle');
    assert.ok(rect.x >= area.x + 8 && rect.y >= area.y + 8);
    assert.ok(rect.x + rect.width <= area.x + area.width - 8);
    assert.ok(rect.y + rect.height <= area.y + area.height - 8);
    if (layout !== 'scroll') {
        assert.deepEqual(rect, {x: area.x + 8, y: area.y + 8,
            width: area.width - 16, height: area.height - 16});
    }
}

for (const untile of ['Toggle Float', 'Float All']) {
    for (const tile of ['Toggle Float', 'Tile All Master', 'default arrival']) {
        test(`two monitors: ${untile} on right then ${tile} on left`, () => {
            const h = harness(gapped, {screens: twoScreens, areas: twoScreenAreas});
            const right = makeWindow('right', {output: twoScreens[1],
                frameGeometry: {x: 1400, y: 100, width: 300, height: 200}});
            h.add(right);
            assertTiledOnScreen(right, twoScreens[1]);
            fireShortcut(h, untile, right);
            const rightBefore = geometry(right);
            const left = makeWindow('left', {output: twoScreens[0],
                frameGeometry: {x: 100, y: 100, width: 300, height: 200}});
            if (tile !== 'default arrival') {
                h.settings.defaultMode = 'float';
                h.changed.emit();
            }
            h.add(left);
            if (tile !== 'default arrival') {
                h.workspace.cursorPos = {x: 100, y: 100};
                fireShortcut(h, tile, left);
            }
            assertTiledOnScreen(left, twoScreens[0]);
            assert.deepEqual(geometry(right), rightBefore);
            assert.equal(h.logs.some(line => line.includes('weave error')), false);
        });
    }
    for (const tile of ['Toggle Float', 'Tile All Master', 'Tile All Stage',
        'Tile All Scroll', 'Float All']) {
        test(`two monitors: startup left window tiles via ${tile} after right ${untile}`, () => {
            const right = makeWindow('right', {output: twoScreens[1],
                frameGeometry: {x: 1208, y: 8, width: 1184, height: 784}});
            const left = makeWindow('left', {output: twoScreens[0],
                frameGeometry: {x: 100, y: 100, width: 300, height: 200}});
            const h = harness(gapped, {screens: twoScreens, areas: twoScreenAreas,
                initialWindows: [right, left]});
            assert.equal(left.geometryWrites + right.geometryWrites, 0,
                'startup adoption must not move windows');
            fireShortcut(h, untile, right);
            const rightBefore = geometry(right);
            h.workspace.cursorPos = {x: 100, y: 100};
            fireShortcut(h, tile, left);
            assertTiledOnScreen(left, twoScreens[0],
                tile === 'Tile All Scroll' ? 'scroll' : 'master');
            assert.deepEqual(geometry(right), rightBefore);
            assert.equal(h.logs.some(line => line.includes('weave error')), false);
        });
    }
}

test('two monitors: tiling startup floats on left preserves parked scroll windows on right', () => {
    const left = makeWindow('left', {output: twoScreens[0],
        frameGeometry: {x: 100, y: 100, width: 300, height: 200}});
    const userMinimized = makeWindow('user-minimized', {output: twoScreens[0],
        minimized: true, frameGeometry: {x: 100, y: 100, width: 300, height: 200}});
    const h = harness(gapped, {screens: twoScreens, areas: twoScreenAreas,
        initialWindows: [left, userMinimized]});
    h.workspace.cursorPos = {x: 1300, y: 100};
    fireShortcut(h, 'Tile All Scroll', null);
    const right = Array.from({length: 4}, (_, index) => makeWindow('right' + index,
        {output: twoScreens[1],
            frameGeometry: {x: 1400, y: 100, width: 300, height: 200}}));
    right.forEach(window => h.add(window));
    assert.deepEqual(right.map(window => window.minimized), [true, true, false, false]);
    const before = right.map(window => ({rect: geometry(window),
        geometryWrites: window.geometryWrites, minimizedWrites: window.minimizedWrites}));
    h.workspace.cursorPos = {x: 100, y: 100};
    fireShortcut(h, 'Tile All Scroll', left);
    assertTiledOnScreen(left, twoScreens[0], 'scroll');
    assert.equal(userMinimized.minimized, true);
    assert.equal(userMinimized.minimizedWrites, 0);
    assert.equal(userMinimized.geometryWrites, 0);
    assert.deepEqual(right.map(window => ({rect: geometry(window),
        geometryWrites: window.geometryWrites, minimizedWrites: window.minimizedWrites})), before);
    fireShortcut(h, 'Float All', right[3]);
    assert.ok(right.every(window => !window.minimized));
    assert.equal(userMinimized.minimized, true);
    assert.equal(h.logs.some(line => line.includes('weave error')), false);
});

function floatingWindows(h, count, options, prefix = 'w') {
    const made = [];
    for (let index = 0; index < count; index++) {
        const window = makeWindow(prefix + index, options);
        h.add(window);
        window.frameGeometry = {x: 100, y: 100, width: 300, height: 200};
        made.push(window);
    }
    return made;
}

test('Tile All registers one shortcut per layout, named like the Layout ones', () => {
    const h = harness(gapped, {screens: twoScreens});
    ['Master', 'Columns', 'Monocle', 'Spiral', 'Rows', 'Hstack', 'Rmaster', 'Grid',
        'Ultrawide', 'Stage', 'Scroll'].forEach(name => {
        assert.ok(h.shortcuts.has('Weave Tile All ' + name), name);
        assert.ok(h.shortcuts.has('Weave Layout ' + name), name);
    });
});

test('Tile All tiles the floating windows of the cursor monitor with the layout', () => {
    ['columns', 'master'].forEach(name => {
        const h = harness(floatSettings, {screens: twoScreens});
        const windows = floatingWindows(h, 3);
        h.workspace.cursorPos = {x: 50, y: 50};
        h.shortcuts.get('Weave Tile All ' + name[0].toUpperCase() + name.slice(1)).handler();
        assert.deepEqual(windows.map(rectOf), layoutRects[name][3], name);
    });
});

test('Tile All on a fully tiled context is just a layout switch', () => {
    const h = harness(gapped, {screens: twoScreens});
    const windows = addWindows(h, 3);
    const writes = windows.map(window => window.geometryWrites);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(windows.map(rectOf), layoutRects.columns[3]);
    assert.ok(windows.every((window, index) => window.geometryWrites === writes[index] + 1));
});

test('Tile All Stage enters stage with floating windows and syncs an existing stage', () => {
    const h = harness(floatSettings, {screens: twoScreens});
    const windows = floatingWindows(h, 3);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Stage').handler();
    assert.deepEqual(windows.map(rectOf), stageRects[3]);
    const late = makeWindow('late');
    h.add(late);
    late.frameGeometry = {x: 100, y: 100, width: 300, height: 200};
    h.shortcuts.get('Weave Tile All Stage').handler();
    assert.deepEqual(windows.concat(late).map(rectOf).slice(0, 3), stageRects[3]);
    assert.equal(late.frameGeometry.width < 300 || late.frameGeometry.x !== 100, true);
});

test('Tile All Monocle raises the active window', () => {
    const h = harness(floatSettings, {screens: twoScreens});
    const windows = floatingWindows(h, 2);
    h.activate(windows[1]);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Monocle').handler();
    assert.deepEqual(windows.map(rectOf), [[8, 8, 1184, 785], [8, 8, 1184, 785]]);
    assert.deepEqual(h.workspace.raised, ['w1']);
});

test('Tile All with no windows only sets the layout of the context', () => {
    const h = harness(gapped, {screens: twoScreens});
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(addWindows(h, 3).map(rectOf), layoutRects.columns[3]);
});

test('Tile All leaves arranged windows alone', () => {
    const h = harness(gapped, {screens: twoScreens});
    const windows = activatedWindows(h, 3);
    fireShortcut(h, 'Arrange Next', windows[2]);
    const before = windows.map(rectOf);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(windows.map(rectOf), before);
});

test('Tile All leaves the other monitor and unmanaged windows alone', () => {
    const h = harness(floatSettings, {screens: twoScreens});
    const near = floatingWindows(h, 2);
    const far = floatingWindows(h, 2, {output: 'DP-2'}, 'far');
    const plain = makeWindow('plain', {resourceClass: 'other'});
    h.add(plain);
    const farBefore = far.map(rectOf);
    const plainBefore = rectOf(plain);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(near.map(rectOf), layoutRects.columns[2]);
    assert.deepEqual(far.map(rectOf), farBefore);
    assert.deepEqual(rectOf(plain), plainBefore);
});

test('Tile All picks the monitor under the cursor, and does nothing outside every monitor', () => {
    const h = harness(floatSettings, {screens: twoScreens});
    const near = floatingWindows(h, 2);
    const far = floatingWindows(h, 2, {output: 'DP-2'}, 'far');
    const nearBefore = near.map(rectOf);
    const farBefore = far.map(rectOf);
    h.workspace.cursorPos = {x: 5000, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(near.map(rectOf), nearBefore);
    assert.deepEqual(far.map(rectOf), farBefore);
    h.workspace.cursorPos = {x: 1300, y: 50};
    h.shortcuts.get('Weave Tile All Columns').handler();
    assert.deepEqual(far.map(rectOf), layoutRects.columns[2]);
    assert.deepEqual(near.map(rectOf), nearBefore);
});

// ---- Window limits and fit ----
const FLOAT_RECT = [0, 0, 800, 601];
const infoGapped = Object.assign({logLevel: 'info'}, gapped);

test('a window arriving over the layout limit floats, the others keep their cells', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, infoGapped));
    const windows = addWindows(h, 6);
    assert.deepEqual(windows.slice(0, 5).map(rectOf), layoutRects.rows[5]);
    assert.deepEqual(rectOf(windows[5]), FLOAT_RECT);
    assert.ok(h.logs.includes('weave overlimit w5 rows'));
});

test('switching to a layout with a lower limit floats the newest extras', () => {
    const h = harness(infoGapped);
    const windows = addWindows(h, 8);
    fireShortcut(h, 'Layout Columns', windows[0]);
    assert.ok(h.logs.includes('weave overlimit w7 columns'));
    assert.ok(h.logs.includes('weave overlimit w6 columns'));
    assert.deepEqual(windows.slice(0, 6).map(window => rectOf(window)[1]), Array(6).fill(8));
    assert.deepEqual(rectOf(windows[6]), FLOAT_RECT);
    assert.deepEqual(rectOf(windows[7]), FLOAT_RECT);
});

test('closing a tiled window re-tiles the oldest autoFloated one', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, gapped));
    const windows = addWindows(h, 7);
    assert.deepEqual(rectOf(windows[5]), FLOAT_RECT);
    h.remove(windows[0]);
    const tiled = windows.slice(1, 6);
    assert.deepEqual(tiled.map(rectOf), layoutRects.rows[5]);
    assert.deepEqual(rectOf(windows[6]), FLOAT_RECT);
});

test('an overlimit window re-tiles when switching to a layout with a higher limit', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, gapped));
    const windows = addWindows(h, 6);
    assert.deepEqual(rectOf(windows[5]), FLOAT_RECT);
    fireShortcut(h, 'Layout Grid', windows[0]);
    windows.forEach(window => assert.notDeepEqual(rectOf(window), FLOAT_RECT));
    fireShortcut(h, 'Layout Rows', windows[0]);
    assert.deepEqual(windows.slice(0, 5).map(rectOf), layoutRects.rows[5]);
    assert.deepEqual(rectOf(windows[5]), FLOAT_RECT);
});

test('a no-fit window re-tiles when the new layout gives it enough room', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, infoGapped));
    const tall = {minSize: {width: 250, height: 341}};
    const windows = [makeWindow('w0'), makeWindow('w1', tall), makeWindow('w2')];
    windows.forEach(window => h.add(window));
    assert.deepEqual(rectOf(windows[1]), FLOAT_RECT);
    fireShortcut(h, 'Layout Grid', windows[0]);
    windows.forEach(window => assert.notDeepEqual(rectOf(window), FLOAT_RECT));
    assert.ok(rectOf(windows[1])[3] >= 341);
});

test('a user-floated window stays floating across layout switches', () => {
    const h = harness(gapped);
    const windows = addWindows(h, 3);
    fireShortcut(h, 'Toggle Float', windows[1]);
    const rect = rectOf(windows[1]);
    fireShortcut(h, 'Layout Grid', windows[0]);
    fireShortcut(h, 'Layout Columns', windows[0]);
    assert.deepEqual(rectOf(windows[1]), rect);
    assert.deepEqual(windows.filter((window, index) => index !== 1).map(rectOf),
        layoutRects.columns[2]);
});

test('toggling an autoFloated window to tiled clears its flag', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, gapped));
    const windows = addWindows(h, 6);
    fireShortcut(h, 'Toggle Float', windows[5]);
    assert.notDeepEqual(rectOf(windows[5]), FLOAT_RECT);
    // now the window is tiled by the user; toggling it float makes it user-floated
    fireShortcut(h, 'Toggle Float', windows[5]);
    const rect = rectOf(windows[5]);
    fireShortcut(h, 'Layout Grid', windows[0]);
    assert.deepEqual(rectOf(windows[5]), rect);
});

test('Tile All tiles up to the limit and leaves the rest floating', () => {
    const h = harness(floatSettings, {screens: twoScreens});
    const windows = floatingWindows(h, 7);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Rows').handler();
    assert.deepEqual(windows.slice(0, 5).map(rectOf), layoutRects.rows[5]);
    windows.slice(5).forEach(window => {
        assert.deepEqual(rectOf(window), [100, 100, 300, 200]);
    });
});

test('a window whose cell is below its minSize floats', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, infoGapped));
    const windows = [makeWindow('w0'), makeWindow('w1', {minSize: {width: 250, height: 341}}),
        makeWindow('w2')];
    windows.forEach(window => h.add(window));
    assert.ok(h.logs.includes('weave nofit w1 rows'));
    assert.deepEqual(rectOf(windows[0]), layoutRects.rows[2][0]);
    assert.deepEqual(rectOf(windows[2]), layoutRects.rows[2][1]);
    assert.deepEqual(rectOf(windows[1]), FLOAT_RECT);
});

test('a missing or invalid minSize counts as zero', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, gapped));
    const windows = [makeWindow('w0', {minSize: {}}), makeWindow('w1', {minSize: null}),
        makeWindow('w2')];
    windows.forEach(window => h.add(window));
    assert.deepEqual(windows.map(rectOf), layoutRects.rows[3]);
});

test('the active window is never floated by limit or fit', () => {
    const h = harness(Object.assign({defaultLayout: 'rows'}, infoGapped));
    const big = {minSize: {width: 250, height: 341}};
    const windows = [makeWindow('w0', big), makeWindow('w1', big), makeWindow('w2', big)];
    windows.forEach(window => {
        h.workspace.activeWindow = window;
        h.add(window);
    });
    assert.ok(h.logs.includes('weave nofit w1 rows'));
    assert.deepEqual(rectOf(windows[0]), layoutRects.rows[2][0]);
    assert.deepEqual(rectOf(windows[2]), layoutRects.rows[2][1]);
    assert.deepEqual(rectOf(windows[1]), FLOAT_RECT);
    const limit = harness(Object.assign({defaultLayout: 'rows'}, gapped));
    const six = addWindows(limit, 5);
    const last = makeWindow('w5');
    limit.workspace.activeWindow = last;
    limit.add(last);
    assert.equal(rectOf(last)[0], 8);
    assert.deepEqual(rectOf(six[4]), FLOAT_RECT);
});

test('the maxWindows setting overrides the layout default, except for monocle', () => {
    const h = harness(Object.assign({maxWindows: 3}, gapped));
    const windows = addWindows(h, 5);
    assert.deepEqual(windows.slice(0, 3).map(rectOf), layoutRects.master[3]);
    assert.deepEqual(rectOf(windows[3]), FLOAT_RECT);
    assert.deepEqual(rectOf(windows[4]), FLOAT_RECT);
    const mono = harness(Object.assign({maxWindows: 2, defaultLayout: 'monocle'}, gapped));
    const all = addWindows(mono, 5);
    all.forEach(window => assert.deepEqual(rectOf(window), [8, 8, 1184, 785]));
});

test('maxWindows is picked up by a configuration refresh', () => {
    const h = harness(gapped);
    const windows = addWindows(h, 5);
    h.settings.maxWindows = 2;
    h.changed.emit();
    assert.deepEqual(windows.slice(0, 2).map(rectOf), layoutRects.master[2]);
    assert.deepEqual(rectOf(windows[4]), FLOAT_RECT);
});

// ---- Focus keys ----

function activeId(h) {
    return h.workspace.activeWindow ? h.workspace.activeWindow.internalId : null;
}

test('focus: shortcut names exist with empty default keys', () => {
    const h = harness();
    ['Left', 'Right', 'Up', 'Down', 'Next', 'Previous'].forEach(name => {
        assert.ok(h.shortcuts.has('Weave Focus ' + name), name);
        assert.equal(h.shortcuts.get('Weave Focus ' + name).key, '');
    });
});

test('focus: next and previous follow the layout order and wrap in master', () => {
    const {h, windows} = setup(3);
    const ids = windows.map(window => window.internalId);
    fire(h, 'Focus Next', windows[0]);
    assert.equal(activeId(h), ids[1]);
    fire(h, 'Focus Next', windows[1]);
    assert.equal(activeId(h), ids[2]);
    fire(h, 'Focus Next', windows[2]);
    assert.equal(activeId(h), ids[0]);
    fire(h, 'Focus Previous', windows[0]);
    assert.equal(activeId(h), ids[2]);
    fire(h, 'Focus Previous', windows[2]);
    assert.equal(activeId(h), ids[1]);
    assert.deepEqual(h.workspace.raised, []);
});

test('focus: next follows the layout order after a promote, not the arrival order', () => {
    const {h, windows} = setup(3);
    fire(h, 'Promote', windows[2]);
    fire(h, 'Focus Next', windows[2]);
    assert.equal(activeId(h), 'w0');
});

test('focus: next and previous wrap in monocle and raise the window', () => {
    const {h, windows} = setup(3, 'monocle');
    fire(h, 'Focus Next', windows[2]);
    assert.equal(activeId(h), 'w0');
    fire(h, 'Focus Previous', windows[0]);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Next', windows[0]);
    assert.equal(activeId(h), 'w1');
    assert.deepEqual(h.workspace.raised, ['w0', 'w2', 'w1']);
});

test('focus: directional keys pick the nearest window in a master layout', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    fire(h, 'Focus Right', a);
    assert.equal(activeId(h), 'w1');
    fire(h, 'Focus Down', b);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Left', c);
    assert.equal(activeId(h), 'w0');
    fire(h, 'Focus Right', c);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Up', c);
    assert.equal(activeId(h), 'w1');
    assert.equal(a.geometryWrites > 0, true);
});

test('focus: directional keys stop at the edge and write nothing', () => {
    const {h, windows} = setup(3);
    const [a, b, c] = windows;
    [[a, 'Left', 'w0'], [a, 'Up', 'w0'], [a, 'Down', 'w0'], [b, 'Right', 'w1'],
        [b, 'Up', 'w1'], [c, 'Down', 'w2'], [c, 'Right', 'w2']].forEach(item => {
        assertNoWrites(windows, () => fire(h, 'Focus ' + item[1], item[0]));
        assert.equal(activeId(h), item[2]);
    });
});

test('focus: in monocle the directional keys fall back to previous and next', () => {
    const {h, windows} = setup(3, 'monocle');
    fire(h, 'Focus Right', windows[0]);
    assert.equal(activeId(h), 'w1');
    fire(h, 'Focus Down', windows[1]);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Left', windows[2]);
    assert.equal(activeId(h), 'w1');
    fire(h, 'Focus Up', windows[0]);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Right', windows[2]);
    assert.equal(activeId(h), 'w0');
});

test('focus: floating and minimized windows are skipped', () => {
    const {h, windows} = setup(3);
    fire(h, 'Toggle Float', windows[1]);
    fire(h, 'Focus Next', windows[0]);
    assert.equal(activeId(h), 'w2');
    fire(h, 'Focus Previous', windows[2]);
    assert.equal(activeId(h), 'w0');
    windows[2].minimized = true;
    fire(h, 'Focus Next', windows[0]);
    assert.equal(activeId(h), 'w0');
});

test('focus: windows of the other monitor are not candidates', () => {
    const h = harness(gappedWith(), {screens: twoScreens});
    const left = addWindows(h, 2);
    const other = makeWindow('x', {output: twoScreens[1]});
    h.add(other);
    fire(h, 'Focus Next', left[1]);
    assert.equal(activeId(h), 'w0');
    fire(h, 'Focus Next', other);
    assert.equal(activeId(h), 'x');
    fire(h, 'Focus Right', left[1]);
    assert.equal(activeId(h), 'w1');
});

test('focus: without an active managed window the cursor monitor is used', () => {
    const h = harness(gappedWith(), {screens: twoScreens});
    const first = addWindows(h, 2);
    const second = [makeWindow('x', {output: twoScreens[1]}),
        makeWindow('y', {output: twoScreens[1]})];
    second.forEach(window => h.add(window));
    h.workspace.cursorPos = {x: 1300, y: 50};
    h.workspace.activeWindow = null;
    h.shortcuts.get('Weave Focus Left').handler();
    assert.equal(activeId(h), 'x');
    h.workspace.activeWindow = makeWindow('unmanaged', {resourceClass: 'other'});
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Focus Next').handler();
    assert.equal(activeId(h), first[0].internalId);
    h.workspace.activeWindow = null;
    h.workspace.cursorPos = {x: 5000, y: 50};
    h.shortcuts.get('Weave Focus Next').handler();
    assert.equal(h.workspace.activeWindow, null);
});

test('focus: stage cycles its order and the overflow stack falls back to cycling', () => {
    const {h, windows} = setup(3, 'stage');
    fire(h, 'Focus Next', windows[0]);
    assert.equal(activeId(h), 'w1');
    fire(h, 'Focus Previous', windows[0]);
    assert.equal(activeId(h), 'w2');
    assert.equal(windows.length, 3);
});

// ---- Scroll (Pages), stub signals only ----
// Legacy page/navigation fixtures opt into the old full-area geometry and page step;
// centered-box and slot-step behavior is covered by the v2 cases below.
const scrollSettings = Object.assign({defaultLayout: 'scroll', scrollBoxWidth: 100,
    scrollBoxHeight: 100, scrollStep: 'page'}, gapped);
const scrollH = [[8, 8, 588, 785], [604, 8, 588, 785]];
const scrollV = [[8, 8, 1184, 389], [8, 405, 1184, 388]];
function scrollSetup(count = 4, settings = {}, options = {}) {
    const h = harness(Object.assign({}, scrollSettings, settings), options);
    const windows = addWindows(h, count);
    return {h, windows};
}
function assertScrollPage(windows, indices, rects = scrollH) {
    assert.deepEqual(windows.map(w => w.minimized), windows.map((w, i) => !indices.includes(i)));
    assert.deepEqual(indices.map(i => rectOf(windows[i])), rects);
}

test('scroll: new arrivals append and reveal; four windows show two exact slots', () => {
    const {h, windows} = scrollSetup();
    assertScrollPage(windows, [2, 3]);
    const parkedWrites = windows.slice(0, 2).map(w => w.geometryWrites);
    fireShortcut(h, 'Scroll Next', windows[2]);
    assertScrollPage(windows, [2, 3]);
    assert.deepEqual(windows.slice(0, 2).map(w => w.geometryWrites), parkedWrites);
});

test('scroll: next/previous use page steps, clamp without wrapping and preserve visible focus', () => {
    const {h, windows} = scrollSetup(5);
    fireShortcut(h, 'Scroll Previous', windows[4]);
    assertScrollPage(windows, [1, 2]);
    assert.equal(activeId(h), 'w1');
    fireShortcut(h, 'Scroll Previous', windows[1]);
    assertScrollPage(windows, [0, 1]);
    assert.equal(activeId(h), 'w1');
    fireShortcut(h, 'Scroll Previous', windows[1]);
    assertScrollPage(windows, [0, 1]);
    fireShortcut(h, 'Scroll Next', windows[1]);
    assertScrollPage(windows, [2, 3]);
    assert.equal(activeId(h), 'w2');
    fireShortcut(h, 'Scroll Next', windows[2]);
    assertScrollPage(windows, [3, 4]);
});

test('scroll: configured one-window step and vertical defaults', () => {
    const {h, windows} = scrollSetup(4, {scrollStep: 'window', scrollAxis: 'v'});
    assertScrollPage(windows, [2, 3], scrollV);
    fireShortcut(h, 'Scroll Previous', windows[3]);
    assertScrollPage(windows, [1, 2], scrollV);
});

test('scroll: activating a parked window reveals the smallest amount', () => {
    const {h, windows} = scrollSetup();
    h.activate(windows[1]);
    assertScrollPage(windows, [1, 2]);
    assert.equal(activeId(h), 'w1');
    h.activate(windows[3]);
    assertScrollPage(windows, [2, 3]);
    assert.equal(activeId(h), 'w3');
});

test('scroll: user restoring a parked window reveals it without activation', () => {
    const {h, windows} = scrollSetup();
    h.activate(windows[3]);
    windows[0].minimized = false;
    assertScrollPage(windows, [0, 1]);
    assert.equal(activeId(h), 'w0'); // old active is now parked, first visible wins
});

test('scroll: axis toggle keeps page; leaving scroll restores every parked window', () => {
    const {h, windows} = scrollSetup();
    fireShortcut(h, 'Scroll Axis Toggle', windows[3]);
    assertScrollPage(windows, [2, 3], scrollV);
    fireShortcut(h, 'Scroll Axis Toggle', windows[3]);
    assertScrollPage(windows, [2, 3]);
    fireShortcut(h, 'Layout Columns', windows[3]);
    assert.deepEqual(windows.map(w => w.minimized), [false, false, false, false]);
    assert.deepEqual(windows.map(rectOf), [[8, 8, 294, 785], [310, 8, 291, 785],
        [609, 8, 288, 785], [905, 8, 287, 785]]);
});

test('scroll: user-minimized windows are never restored or parked by Weave', () => {
    const {h, windows} = scrollSetup(2);
    windows[0].minimized = true;
    const writes = windows[0].minimizedWrites;
    const before = rectOf(windows[0]);
    const later = makeWindow('later');
    h.add(later);
    fireShortcut(h, 'Scroll Previous', windows[1]);
    fireShortcut(h, 'Scroll Axis Toggle', windows[1]);
    assert.equal(windows[0].minimizedWrites, writes);
    assert.deepEqual(rectOf(windows[0]), before);
    fireShortcut(h, 'Layout Master', windows[1]);
    assert.equal(windows[0].minimized, true);
    assert.equal(windows[0].minimizedWrites, writes);
});

test('scroll: initially user-minimized window is excluded from slots', () => {
    const {h, windows} = scrollSetup(1);
    const user = makeWindow('user', {minimized: true});
    h.add(user);
    assert.equal(user.minimizedWrites, 0);
    assert.deepEqual(rectOf(windows[0]), [8, 8, 1184, 785]);
    fireShortcut(h, 'Layout Columns', windows[0]);
    assert.equal(user.minimizedWrites, 0);
});

test('scroll: closing visible and parked windows re-clamps a full last page', () => {
    const {h, windows} = scrollSetup(5);
    h.remove(windows[4]);
    assertScrollPage(windows.slice(0, 4), [2, 3]);
    h.remove(windows[0]);
    assertScrollPage(windows.slice(1, 4), [1, 2]);
    h.remove(windows[3]);
    assertScrollPage(windows.slice(1, 3), [0, 1]);
});

test('scroll: minimize feedback writes once per state change, including KWin focus handoff', () => {
    const {h, windows} = scrollSetup();
    windows.forEach(w => {
        w.onMinimized = minimized => {
            if (minimized && h.workspace.activeWindow === w) {
                // KWin may focus another soon-to-be-parked window mid-pass.
                h.activate(windows.find(other => other !== w && !other.minimized));
            }
        };
    });
    const before = windows.map(w => w.minimizedWrites);
    fireShortcut(h, 'Scroll Previous', windows[3]);
    assertScrollPage(windows, [0, 1]);
    assert.equal(activeId(h), 'w0');
    assert.deepEqual(windows.map((w, i) => w.minimizedWrites - before[i]), [1, 1, 1, 1]);
    const after = windows.map(w => w.minimizedWrites);
    fireShortcut(h, 'Scroll Previous', windows[0]);
    assert.deepEqual(windows.map(w => w.minimizedWrites), after);
    assert.equal(h.logs.some(line => line.includes('weave error')), false);
});

test('scroll: positive maxWindows overrides default; zero allows more than ordinary layouts', () => {
    const all = scrollSetup(12);
    assert.equal(all.windows.filter(w => w.minimized).length, 10);
    const limited = scrollSetup(4, {maxWindows: 3});
    assert.equal(limited.windows[3].minimized, false);
    assert.deepEqual(rectOf(limited.windows[3]), FLOAT_RECT);
    assertScrollPage(limited.windows.slice(0, 3), [1, 2]);
});

test('scroll: minimum sizes are tested only on visible slots', () => {
    const {h, windows} = scrollSetup();
    windows[0].minSize = {width: 1000, height: 1000};
    fireShortcut(h, 'Scroll Axis Toggle', windows[3]);
    assert.equal(windows[0].minimized, true);
    assert.equal(windows[0].minimizedWrites, 1);
    fireShortcut(h, 'Scroll Previous', windows[3]);
    assert.equal(windows[0].minimized, false); // visible no-fit auto-floats
    assert.deepEqual(rectOf(windows[0]), FLOAT_RECT);
});

test('scroll: floating a parked window restores it and preserves the remaining order', () => {
    const {h, windows} = scrollSetup();
    fireShortcut(h, 'Toggle Float', windows[0]);
    assert.equal(windows[0].minimized, false);
    fireShortcut(h, 'Scroll Previous', windows[2]);
    assert.deepEqual(windows.slice(1).map(w => w.minimized), [false, false, true]);
});

test('scroll: visible slot drop swaps ids and dropping beyond the edge does not scroll', () => {
    const {h, windows} = scrollSetup();
    const dragged = windows[2];
    dragged.move = true;
    dragged.interactiveMoveResizeStarted.emit();
    h.workspace.cursorPos = {x: 900, y: 200};
    dragged.interactiveMoveResizeFinished.emit();
    assertScrollPage(windows, [3, 2]);
    dragged.interactiveMoveResizeStarted.emit();
    h.workspace.cursorPos = {x: 1300, y: 200};
    dragged.interactiveMoveResizeFinished.emit();
    assertScrollPage(windows, [3, 2]);
});

test('scroll: master count shortcuts change page size and clamp', () => {
    const {h, windows} = scrollSetup();
    fireShortcut(h, 'Master More', windows[3]);
    assert.deepEqual(windows.map(w => w.minimized), [true, false, false, false]);
    fireShortcut(h, 'Master Fewer', windows[3]);
    assertScrollPage(windows, [1, 2]);
});

test('scroll: shared-edge resize updates the ratio on both axes and survives reapply', () => {
    for (const axis of ['h', 'v']) {
        const {h, windows} = scrollSetup(2, {scrollAxis: axis});
        const first = windows[0];
        first.resize = true;
        first.interactiveMoveResizeStarted.emit();
        first.frameGeometry = Object.assign({}, first.frameGeometry,
            axis === 'h' ? {width: 700} : {height: 500});
        first.interactiveMoveResizeFinished.emit();
        assert.equal(axis === 'h' ? first.frameGeometry.width : first.frameGeometry.height,
            axis === 'h' ? 700 : 500);
        const before = windows.map(rectOf);
        fireShortcut(h, 'Scroll Previous', first);
        assert.deepEqual(windows.map(rectOf), before);
    }
});

test('scroll: focus keys reveal parked windows past the page edge', () => {
    const {h, windows} = scrollSetup();
    fireShortcut(h, 'Focus Left', windows[2]);
    assertScrollPage(windows, [1, 2]);
    assert.equal(activeId(h), 'w1');
    fireShortcut(h, 'Focus Previous', windows[1]);
    assertScrollPage(windows, [0, 1]);
    assert.equal(activeId(h), 'w0');
});

test('scroll: retiling a floated window appends and reveals it', () => {
    const {h, windows} = scrollSetup();
    fireShortcut(h, 'Toggle Float', windows[0]);
    fireShortcut(h, 'Toggle Float', windows[0]);
    assertScrollPage(windows, [3, 0]);
});

test('scroll: context axis/page settings are independent across outputs', () => {
    const {h, windows} = scrollSetup();
    const far = ['x', 'y', 'z'].map(id => makeWindow(id, {output: 'DP-2'}));
    far.forEach(w => h.add(w));
    fireShortcut(h, 'Scroll Axis Toggle', windows[3]);
    fireShortcut(h, 'Scroll Previous', windows[3]);
    assertScrollPage(windows, [0, 1], scrollV);
    assertScrollPage(far, [1, 2]);
    windows[2].output = 'DP-2';
    windows[2].outputChanged.emit();
    assert.equal(windows[2].minimized, false);
    assertScrollPage(far.concat(windows[2]), [2, 3]);
    assert.deepEqual(windows.filter(w => w.output === 'DP-1').map(w => w.minimized),
        [false, false, true]);
});

test('scroll: Tile All Scroll includes floating arrivals and Float All restores parked windows', () => {
    const h = harness(Object.assign({}, floatSettings), {screens: twoScreens});
    const windows = floatingWindows(h, 4);
    h.workspace.cursorPos = {x: 50, y: 50};
    h.shortcuts.get('Weave Tile All Scroll').handler();
    assertScrollPage(windows, [2, 3], [[79, 181, 517, 440], [604, 181, 517, 440]]);
    fireShortcut(h, 'Float All', windows[3]);
    assert.ok(windows.every(w => !w.minimized));
});

test('scroll: slot step replaces the focused visible slot and follows focus', () => {
    const {h, windows} = scrollSetup(4, {scrollStep: 'slot'});
    h.activate(windows[1]); // page becomes [1, 2], leaving 2 visible and parked 1
    fireShortcut(h, 'Scroll Next', windows[1]);
    assert.equal(windows[1].minimized, true);
    assert.equal(windows[2].minimized, false);
    assert.equal(windows[3].minimized, false);
    assert.equal(activeId(h), 'w3');
    fireShortcut(h, 'Scroll Previous', windows[3]);
    assert.equal(windows[1].minimized, false);
    assert.equal(windows[3].minimized, true);
    assert.equal(windows[2].minimized, false);
    assert.equal(activeId(h), 'w1');
});

test('scroll: centered default box and outer-edge drag resize', () => {
    const {h, windows} = scrollSetup(2, {scrollStep: 'slot', scrollBoxWidth: 88,
        scrollBoxHeight: 56});
    assert.deepEqual(windows.map(rectOf), [[79, 181, 517, 440], [604, 181, 517, 440]]);
    const first = windows[0];
    first.resize = true;
    first.interactiveMoveResizeStarted.emit();
    first.frameGeometry = Object.assign({}, first.frameGeometry, {x: 59, width: 537});
    first.interactiveMoveResizeFinished.emit();
    assert.deepEqual(windows.map(rectOf), [[59, 181, 537, 440], [604, 181, 537, 440]]);
});


test('picker direct call matches every Tile All shortcut without D-Bus', () => {
    const names = require('../../core').tree.CYCLE_LAYOUTS;
    names.forEach(name => {
        const direct = harness(floatSettings, {screens: twoScreens});
        const shortcut = harness(floatSettings, {screens: twoScreens});
        const a = floatingWindows(direct, 4);
        const b = floatingWindows(shortcut, 4);
        direct.runtime.tileAll(name);
        shortcut.shortcuts.get('Weave Tile All ' + name[0].toUpperCase() + name.slice(1)).handler();
        assert.deepEqual(a.map(rectOf), b.map(rectOf), name);
        assert.deepEqual(a.map(w => w.minimized), b.map(w => w.minimized), name);
        assert.equal(direct.dbusCalls.length, 0);
    });
});

test('stopping the runtime disconnects signals and ignores delayed work and shortcuts', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 1});
    const a = makeWindow('a');
    h.add(a);
    h.runtime.stop();
    h.runtime.stop();
    h.advance(5000);
    h.add(makeWindow('b'));
    fireShortcut(h, 'Toggle Float', a);
    h.runtime.tileAll('columns');
    h.changed.emit();
    assert.ok(h.windows.every(w => w.geometryWrites === 0));
});
