const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/host.js'), 'utf8'), scope);
function signal() {
    let handler;
    return {connect(fn) { handler = fn; }, emit(...args) { handler(...args); }};
}
function fixture() {
    const made = [], logs = [];
    const workspace = {windows: {0: {id: 'a'}, length: 1}, activeWindow: null,
        screens: [], cursorPos: {x: 1, y: 2}, currentDesktop: 1,
        currentDesktopForScreen(output) { assert.equal(this, workspace); return output.desktop; },
        clientArea(...args) { assert.equal(this, workspace); return args; },
        raiseWindow(window) { assert.equal(this, workspace); this.raised = window; }};
    const kwin = {readConfig(name, fallback) { assert.equal(this, kwin); return fallback; }};
    const factory = props => {
        const object = Object.assign({activated: signal(), triggered: signal(),
            finished: signal(), failed: signal(), destroyed: false,
            start() { this.started = true; }, call() { this.called = true; },
            destroy() { this.destroyed = true; }}, props);
        made.push(object);
        return object;
    };
    const host = scope.createHost(workspace, kwin, {}, {},
        {shortcut: factory, timer: factory, dbus: factory}, line => logs.push(line));
    return {host, workspace, made, logs};
}

test('host forwards live workspace values, QObject receivers, and array-like window lists', () => {
    const {host, workspace} = fixture();
    assert.equal(host.workspace.windowList()[0], workspace.windows[0]);
    workspace.windows = {0: {id: 'b'}, length: 1};
    assert.equal(host.workspace.windowList()[0].id, 'b');
    host.workspace.activeWindow = workspace.windows[0];
    assert.equal(workspace.activeWindow, host.workspace.activeWindow);
    assert.equal(host.workspace.currentDesktopForScreen({desktop: 3}), 3);
    assert.deepEqual(host.workspace.clientArea(0, 'output', 3), [0, 'output', 3]);
    host.workspace.raiseWindow(workspace.windows[0]);
    assert.equal(workspace.raised, workspace.windows[0]);
    assert.equal(host.readConfig('gapInner', 8), 8);
});

test('host initializes shortcut identity before connecting its callback', () => {
    const {host, made} = fixture();
    let count = 0;
    host.registerShortcut('Weave Tile All Master', 'Weave: Tile All Master', '', () => count++);
    assert.equal(made[0].name, 'Weave Tile All Master');
    assert.equal(made[0].sequence, '');
    made[0].activated.emit();
    assert.equal(count, 1);
});

test('host unpacks D-Bus replies, handles no-callback calls and failure, destroys calls', () => {
    const {host, made, logs} = fixture();
    let reply;
    host.callDBus('org.weave.State', '/State', 'org.weave.State', 'Get', value => reply = value);
    assert.equal(made[0].called, true);
    assert.equal(made[0].arguments.length, 0);
    made[0].finished.emit(['{"records":[]}']);
    assert.equal(reply, '{"records":[]}');
    assert.equal(made[0].destroyed, true);
    host.callDBus('service', '/path', 'interface', 'Set', 'text', () => {});
    assert.equal(made[1].arguments[0], 'text');
    made[1].finished.emit([]);
    host.callDBus('org.kde.KWin', '/KWin', 'org.kde.KWin', 'reconfigure');
    assert.equal(made[2].arguments.length, 0);
    made[2].finished.emit([]);
    host.callDBus('service', '/path', 'interface', 'Get', value => reply = value);
    made[3].failed.emit();
    assert.equal(reply, undefined);
    assert.equal(made[3].destroyed, true);
    assert.equal(logs.length, 1);
});

test('one-shot timer is destroyed even if its callback throws', () => {
    const {host, made} = fixture();
    host.startTimer(25, () => { throw Error('callback'); });
    assert.equal(made[0].started, true);
    assert.equal(made[0].interval, 25);
    assert.equal(made[0].repeat, false);
    assert.throws(() => made[0].triggered.emit(), /callback/);
    assert.equal(made[0].destroyed, true);
});
