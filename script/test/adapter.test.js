const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const buildFiles = ['geometry', 'tree', 'snap', 'stage', 'arrangement', 'context',
    'persist', 'index'];
const source = buildFiles.map(name => fs.readFileSync(
    path.join(root, 'core', name + '.js'), 'utf8')).concat(
    fs.readFileSync(path.join(root, 'script/src/adapter.js'), 'utf8')).join('\n');

function signal() {
    const handlers = [];
    return {
        connect(handler) { handlers.push(handler); },
        emit(...args) { handlers.slice().forEach(handler => handler(...args)); }
    };
}

function makeWindow(id, options = {}) {
    const geometryChanged = signal();
    const tileChanged = signal();
    const signals = {
        frameGeometryChanged: geometryChanged,
        tileChanged,
        interactiveMoveResizeStarted: signal(),
        interactiveMoveResizeFinished: signal(),
        outputChanged: signal(),
        desktopsChanged: signal(),
        desktopChanged: signal()
    };
    let geometry = options.frameGeometry || {x: 0.4, y: 0.2, width: 799.6, height: 600.5};
    let geometryWrites = 0;
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
        move: false,
        resize: false,
        frameGeometry: geometry,
        tile: tile
    });
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
        windowList: () => windows
    };
    (options.initialWindows || []).forEach(window => windows.push(window));
    const dbusCalls = [];
    const quit = signal();
    workspace.aboutToQuit = quit;
    const sandbox = vm.createContext({
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
    });
    if (options.dbus) {
        sandbox.callDBus = function (service, path, iface, method, ...args) {
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
    vm.runInContext(options.bareHost ? source.replace(/\}\)\(this\);\s*$/, '})({});') : source,
        sandbox);
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
    return {workspace, shortcuts, logs, windows, add, remove, changed,
        advance, now: () => now, dbusCalls, quit};
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
    assert.equal(h.shortcuts.size, 17);
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

test('persistence works when only globals exist and the host object is empty', () => {
    const h = harness({manageClasses: 'editor', settleSeconds: 0, logLevel: 'debug'},
        {dbus: {reply: '{}'}, bareHost: true});
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

test('build.sh injects the content hash into dist main.js', () => {
    const {execFileSync} = require('node:child_process');
    execFileSync('sh', [path.join(root, 'script/build.sh')], {cwd: '/'});
    const dist = path.join(root, 'script/dist');
    const id = fs.readFileSync(path.join(dist, 'BUILD_ID'), 'utf8').trim();
    assert.match(id, /^[0-9a-f]{8}$/);
    const built = fs.readFileSync(path.join(dist, 'contents/code/main.js'), 'utf8');
    assert.ok(built.includes('BUILD_ID = "' + id + '"'));
    assert.ok(!built.includes('@@BUILD_ID@@'));
});
