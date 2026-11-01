const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../../core');
const expected = require('../livetest/js/expected');
core.liveExpected = expected;

test('live harness contains no forbidden shell actions', () => {
    const file = path.resolve(__dirname, '../livetest/livetest.sh');
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /desktops\s*=/);
    assert.doesNotMatch(source, /\.[\t ]*tile\b/);
    assert.doesNotMatch(source, new RegExp('su' + 'do', 'i'));
    assert.doesNotMatch(source, /\bread\b/);
    assert.doesNotMatch(source, /\bpkill\b/);
    assert.match(source, /manageClasses[\s\S]*RESOURCE_CLASS/);
    assert.match(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/expected.js'), 'utf8'), /org\.kde\.kcalc/);
});

const scenarioFiles = {
    S1: 'check-s1.js',
    S2: 'check-s2.js',
    S3: 'check-s3.js',
    S4: 'check-s4.js',
    S5: 'check-s5.js',
    S6: 'check-s6.js'
};

const liveFiles = {
    S7a: 'check-s7a.js', S7b: 'check-s7b.js', S7c: 'check-s7c.js', S7d: 'check-s7d.js',
    S8a: 'check-s8a.js', S8b: 'check-s8b.js', S8c: 'check-s8c.js',
    S9a: 'check-s9a.js', S9b: 'check-s9b.js', S9c: 'check-s9c.js', S9d: 'check-s9d.js',
    S10a: 'check-s10a.js', S10b: 'check-s10b.js', S10c: 'check-s10c.js',
    S10d: 'check-s10d.js', S10e: 'check-s10e.js', S10f: 'check-s10f.js',
    S10g: 'check-s10g.js', S10h: 'check-s10h.js'
};
const movedFile = 'check-s8m.js';
const helperFiles = ['order-s7.js', 'activate-live.js', 'move-s8.js'];

Object.values(Object.assign({}, scenarioFiles, liveFiles)).forEach(file => {
    test(file + ' emits a machine-readable WEAVE_LIVE result', () => {
        const source = fs.readFileSync(path.resolve(__dirname,
            '../livetest/js', file), 'utf8');
        assert.match(source, /WEAVE_LIVE|liveExpected\.(run|emit)/);
    });
});

function fixture(scenario) {
    const areaByName = {
        'DP-1': {x: 0, y: 32, width: 2560, height: 1400},
        'HDMI-A-1': {x: 2560, y: 0, width: 1920, height: 1080}
    };
    const placements = scenario === 'S1' || scenario === 'S6' ?
        ['DP-1', 'DP-1', 'DP-1'] : scenario === 'S4' ?
            ['HDMI-A-1', 'HDMI-A-1', 'HDMI-A-1'] :
                ['DP-1', 'DP-1', 'HDMI-A-1'];
    const windows = placements.map((name, index) => ({
        resourceClass: expected.resourceClass,
        internalId: 'w' + index,
        desktop: 1,
        output: {name},
        frameGeometry: {x: 0, y: 0, width: 1, height: 1}
    }));
    const workspace = {
        screens: Object.keys(areaByName).map(name => ({name})),
        windowList: () => windows,
        clientArea: (type, output) => areaByName[typeof output === 'string' ?
            output : output.name]
    };
    const groups = expected.groupByOutput(windows, workspace);
    Object.keys(groups).forEach(key => {
        const group = groups[key];
        const ids = group.windows.map(window => String(window.internalId));
        let rects;
        if (scenario === 'S6') {
            const tree = core.tree.dockToSide(
                core.tree.masterStack(ids, 1, 0.6), ids[0], 'left');
            rects = core.tree.layout(tree, areaByName[group.name],
                {outer: 8, inner: 8});
        } else {
            rects = core.tree.layout(core.tree.masterStack(ids, 1, 0.6),
                areaByName[group.name], {outer: 8, inner: 8});
        }
        group.windows.forEach(window => { window.frameGeometry = rects[window.internalId]; });
    });
    if (scenario === 'S5') {
        windows[2].frameGeometry = {x: 2600, y: 50, width: 700, height: 500};
    }
    workspace.activeWindow = scenario === 'S3_SNAP' ? windows[0] : windows[0];
    if (scenario === 'S3_SNAP') {
        workspace.activeWindow.frameGeometry = core.snap.snapRect('leftHalf',
            areaByName['DP-1'], {outer: 8, inner: 8});
    }
    return {workspace, windows};
}

function evaluate(file, scenario, fail) {
    const state = fixture(scenario);
    if (fail) {
        const window = scenario === 'S3_SNAP' ? state.workspace.activeWindow :
            scenario === 'S5' ? state.windows[2] : state.windows[0];
        window.frameGeometry = Object.assign({}, window.frameGeometry, {
            x: window.frameGeometry.x + (scenario === 'S5' ? 10000 : 1)
        });
    }
    const lines = [];
    expected.output = line => lines.push(line);
    const context = {
        Weave: core,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        priorSnapPassed: true,
        priorS5Size: {width: 700, height: 500},
        workspace: state.workspace,
        KWin: {PlacementArea: 0},
        print: line => lines.push(line),
        JSON,
        Math,
        String,
        Object
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js', file), 'utf8'), context);
    expected.output = null;
    if (file === 'probe-s3-snap.js') {
        const marker = lines.find(line => line.indexOf('WEAVE_S3_SNAP ') === 0);
        assert.ok(marker, file + ' did not print a snap result');
        return marker.slice('WEAVE_S3_SNAP '.length);
    }
    const record = lines.find(line => line.indexOf('WEAVE_LIVE {') === 0);
    assert.ok(record, file + ' did not print a JSON result');
    return JSON.parse(record.slice('WEAVE_LIVE '.length)).status;
}

test('each live check compares fake workspace/window geometry for PASS and FAIL', () => {
    Object.entries(scenarioFiles).forEach(([scenario, file]) => {
        assert.equal(evaluate(file, scenario, false), 'PASS', file + ' PASS case');
        assert.equal(evaluate(file, scenario, true), 'FAIL', file + ' FAIL case');
    });
});

test('S3 snap probe compares fake geometry for PASS and FAIL', () => {
    assert.equal(evaluate('probe-s3-snap.js', 'S3_SNAP', false), 'PASS');
    assert.equal(evaluate('probe-s3-snap.js', 'S3_SNAP', true), 'FAIL');
});

const templates = require('../../core/templates.json');
const gaps = {outer: 8, inner: 8};
const dpArea = {x: 0, y: 32, width: 2560, height: 1400};

function masterOrder(ids) {
    const rects = core.tree.layout(core.tree.masterStack(ids, 1, 0.6), dpArea, gaps);
    return ids.map(id => rects[id]);
}

// The Stage steps, replayed on the core the way the harness drives the adapter.
function stageLiveRects(scenario, ids) {
    let state = core.stage.fromOrder(ids, ids[0]);
    if (scenario !== 'S9a') { state = core.stage.promote(state, ids[2]); }
    if (scenario === 'S9c' || scenario === 'S9d') { state = core.stage.cycle(state, 1); }
    if (scenario === 'S9d') {
        const order = core.stage.order(state);
        const byOrder = masterOrder(order);
        return ids.map(id => byOrder[order.indexOf(id)]);
    }
    const result = core.stage.layoutStacked(state, dpArea, {gaps: {outer: 8, inner: 8},
        focusRatio: 0.6, gradient: 0.5, railCellMin: {w: 140, h: 110}});
    return ids.map(id => result.rects[id]);
}

// The S10 steps by hand: the master column grows from 1522 to 1598 px (the step is 76), two
// masters stack on the left, and Float All leaves the windows at free rectangles.
function keyLiveRects(scenario, ids) {
    const rectsFor = tree => {
        const rects = core.tree.layout(tree, dpArea, gaps);
        return ids.map(id => rects[id]);
    };
    if (scenario === 'S10c') { return rectsFor(core.tree.masterStack(ids, 1, 1598 / 2536)); }
    if (scenario === 'S10e') { return rectsFor(core.tree.masterStack(ids, 2, 0.6)); }
    if (scenario === 'S10g') {
        return ids.map((id, index) => ({x: 100 + 40 * index, y: 120, width: 300, height: 400}));
    }
    return masterOrder(ids);
}

// Rects the live checks expect after each step, for ids in master-layout order.
function liveRects(scenario, ids) {
    const layoutFor = name => {
        const tree = core.tree.generate(name, ids.slice(), {masterRatio: 0.6});
        const rects = core.tree.layout(tree, dpArea, gaps);
        return ids.map(id => rects[id]);
    };
    if (scenario === 'S7a') { return layoutFor('columns'); }
    if (scenario === 'S7b') { return layoutFor('monocle'); }
    if (scenario === 'S7c') { return layoutFor('spiral'); }
    if (scenario === 'S7d') { return layoutFor('master'); }
    if (scenario.indexOf('S9') === 0) { return stageLiveRects(scenario, ids); }
    if (scenario.indexOf('S10') === 0) { return keyLiveRects(scenario, ids); }
    const template = templates[Object.keys(templates)[0]];
    const slots = template.slots.length;
    // Activation order 1, 2, 0: the active window 0, then 2 (the most recent).
    const chosen = [ids[0], ids[2]].slice(0, slots);
    const slotRects = core.arrangement.applyTemplate(template, dpArea, gaps);
    const tiled = masterOrder(ids);
    if (scenario === 'S8c') {
        const order = [ids[1], ids[0], ids[2]];
        const byOrder = masterOrder(order);
        return ids.map(id => byOrder[order.indexOf(id)]);
    }
    return ids.map((id, index) => chosen.indexOf(id) < 0 ? tiled[index] :
        slotRects[chosen.indexOf(id)]);
}

function evaluateLive(scenario, fail, rawWindows, file, movedOk) {
    const ids = ['{a}', '{b}', '{c}'];
    const rects = liveRects(scenario, ids);
    const windows = ids.map((id, index) => ({
        resourceClass: expected.resourceClass,
        internalId: id,
        desktop: 1,
        output: {name: 'DP-1'},
        frameGeometry: Object.assign({}, rects[index])
    }));
    if (fail && scenario === 'S10g') { windows[1].frameGeometry = masterOrder(ids)[1]; }
    else if (fail) { windows[2].frameGeometry.x += 1; }
    const workspace = {
        screens: [{name: 'DP-1'}],
        windowList: () => rawWindows ? [] : windows,
        clientArea: () => dpArea,
        raiseWindow: () => {}
    };
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js', file || liveFiles[scenario]), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, workspace, liveIds: ids,
        WEAVE_LIVE_TEMPLATES: templates, movedOk: movedOk !== false, JSON, Math, String, Object
    });
    expected.output = null;
    const record = lines.find(line => line.indexOf('WEAVE_LIVE {') === 0);
    assert.ok(record, scenario + ' printed no JSON result');
    return JSON.parse(record.slice('WEAVE_LIVE '.length));
}

test('S7 to S10 live checks pass on the right geometry and fail on a nudge', () => {
    Object.keys(liveFiles).forEach(scenario => {
        const good = evaluateLive(scenario, false);
        assert.equal(good.scenario, scenario);
        assert.equal(good.status, 'PASS', scenario + ' PASS case');
        assert.equal(evaluateLive(scenario, true).status, 'FAIL', scenario + ' FAIL case');
        assert.equal(evaluateLive(scenario, false, true).status, 'FAIL');
    });
});

test('S10 fails when the master grew by another amount than the step', () => {
    const ids = ['{a}', '{b}', '{c}'];
    const wrong = core.tree.layout(core.tree.masterStack(ids, 1, 1602 / 2536), dpArea, gaps);
    const windows = ids.map((id, index) => ({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, wrong[id])
    }));
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s10c.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object, liveIds: ids,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    assert.equal(JSON.parse(lines[0].slice('WEAVE_LIVE '.length)).status, 'FAIL');
});

test('S10 constants match the adapter and the config default', () => {
    const adapter = fs.readFileSync(path.resolve(__dirname, '../src/adapter.js'), 'utf8');
    const live = fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/expected.js'), 'utf8');
    const xml = fs.readFileSync(path.resolve(__dirname,
        '../contents/config/main.xml'), 'utf8');
    assert.ok(live.includes('RESIZE_STEP = 76'));
    assert.ok(live.includes('MIN_PANE = 100'));
    assert.ok(adapter.includes('MIN_PANE = 100'));
    assert.ok(adapter.includes('readConfigValue("resizeStep", 76)'));
    assert.match(xml, /name="resizeStep" type="Int">\s*<default>76<\/default>/);
});

test('S8m reports whether the moved window left its slot; S8b needs it', () => {
    assert.equal(evaluateLive('S8b', true, false, movedFile).status, 'PASS');
    assert.equal(evaluateLive('S8b', false, false, movedFile).status, 'FAIL');
    assert.equal(evaluateLive('S8b', false, false, undefined, false).status, 'FAIL');
});

test('S1-style tile checks accept any pairing of the tiled rects', () => {
    const state = fixture('S1');
    const first = state.windows[0].frameGeometry;
    state.windows[0].frameGeometry = state.windows[1].frameGeometry;
    state.windows[1].frameGeometry = first;
    const lines = [];
    expected.output = line => lines.push(line);
    expected.run('S1', state.workspace, true, core);
    expected.output = null;
    assert.match(lines[0], /"status":"PASS"/);
});

test('S7 monocle gives every window the full work rect minus the margins', () => {
    const result = evaluateLive('S7b', false);
    result.actual.forEach(rect => {
        assert.deepEqual(rect, {x: 8, y: 40, width: 2544, height: 1384});
    });
});

test('live helper scripts only touch kcalc windows and avoid forbidden calls', () => {
    helperFiles.concat(Object.values(liveFiles)).forEach(file => {
        const source = fs.readFileSync(path.resolve(__dirname,
            '../livetest/js', file), 'utf8');
        assert.doesNotMatch(source, /desktops\s*=/);
        assert.doesNotMatch(source, /\.[\t ]*tile\b/);
        assert.doesNotMatch(source, /\.(close|kill)\(/);
        source.split('\n').forEach(line => assert.ok(line.length <= 100, file + ': ' + line));
    });
    ['order-s7.js', 'move-s8.js', 'activate-live.js'].forEach(file => {
        assert.match(fs.readFileSync(path.resolve(__dirname,
            '../livetest/js', file), 'utf8'), /KCALC_RESOURCE_CLASS/);
    });
});

test('the harness runs every new scenario and only Weave shortcuts', () => {
    const source = fs.readFileSync(path.resolve(__dirname,
        '../livetest/livetest.sh'), 'utf8');
    Object.values(liveFiles).forEach(file => assert.ok(source.includes(file), file));
    ['Layout Columns', 'Layout Monocle', 'Layout Spiral', 'Layout Master',
        'Arrange Next', 'Arrange Reapply', 'Arrange Release', 'Promote', 'Move Down',
        'Resize Grow Width', 'Resize Shrink Width', 'Master More', 'Master Fewer',
        'Float All'].forEach(name =>
        assert.ok(source.includes('invoke "Weave ' + name + '"'), name));
    const shortcuts = source.match(/invoke "[^"]*"/g) || [];
    shortcuts.forEach(call => assert.match(call, /^invoke "Weave /));
    assert.match(source, /S7a S7b S7c S7d S8a S8b S8c S9a S9b S9c S9d/);
    assert.match(source, /S10a S10b S10c S10d S10e S10f S10g S10h/);
    ['Layout Stage', 'Stage Cycle Next'].forEach(name =>
        assert.ok(source.includes('invoke "Weave ' + name + '"'), name));
});

test('S9 expectations use the same Stage constants as the adapter', () => {
    const adapter = fs.readFileSync(path.resolve(__dirname, '../src/adapter.js'), 'utf8');
    const live = fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/expected.js'), 'utf8');
    ['STAGE_GRADIENT = 0.5', 'STAGE_RAIL_MIN = {w: 140, h: 110}'].forEach(text => {
        assert.ok(adapter.includes(text), text);
        assert.ok(live.includes(text), text);
    });
    assert.match(adapter, /focusRatio", 0\.6/);
    assert.ok(live.includes('FOCUS_RATIO = 0.6'));
});

test('S9 checks fail when the focus window is not the promoted one', () => {
    const ids = ['{a}', '{b}', '{c}'];
    const wrong = stageLiveRects('S9a', ids);
    const windows = ids.map((id, index) => ({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, wrong[index])
    }));
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s9b.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object, liveIds: ids,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    assert.equal(JSON.parse(lines[0].slice('WEAVE_LIVE '.length)).status, 'FAIL');
});

function stageWindows(scenario, limits) {
    const ids = ['{a}', '{b}', '{c}'];
    const rects = stageLiveRects(scenario, ids);
    return {ids, windows: ids.map((id, index) => Object.assign({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, rects[index])
    }, limits))};
}

function runS9(scenario, windows, ids) {
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s' + scenario.slice(1).toLowerCase() + '.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object, liveIds: ids,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    return JSON.parse(lines[0].slice('WEAVE_LIVE '.length));
}

test('S9 compares rail sizes only where the app can be that small', () => {
    const limits = {minSize: {width: 100, height: 100}, maxSize: {width: 9999, height: 9999}};
    const exact = stageWindows('S9a', limits);
    assert.equal(runS9('S9a', exact.windows, exact.ids).status, 'PASS');
    const wider = stageWindows('S9a', limits);
    wider.windows[1].frameGeometry.width += 1;
    assert.equal(runS9('S9a', wider.windows, wider.ids).status, 'FAIL');
    const tall = {minSize: {width: 250, height: 341}, maxSize: {width: 9999, height: 9999}};
    const clamped = stageWindows('S9a', tall);
    clamped.windows[1].frameGeometry.width = 250;
    clamped.windows[1].frameGeometry.height = 341;
    const result = runS9('S9a', clamped.windows, clamped.ids);
    assert.equal(result.status, 'PASS');
    assert.deepEqual(result.info.sizeChecked, [true, false, false]);
    clamped.windows[1].frameGeometry.x += 1;
    assert.equal(runS9('S9a', clamped.windows, clamped.ids).status, 'FAIL');
    clamped.windows[1].frameGeometry.x -= 1;
    clamped.windows[0].frameGeometry.width -= 1;
    assert.equal(runS9('S9a', clamped.windows, clamped.ids).status, 'FAIL');
});
