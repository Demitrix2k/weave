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
    assert.match(xml, /name="resizeStep" type="Int">[\s\S]*?<default>76<\/default>/);
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

// S11: float-first. Fake windows at free rectangles, one snapped, tiled and restored.
const freeRects = {
    '{a}': {x: 300, y: 200, width: 250, height: 340},
    '{b}': {x: 700, y: 300, width: 250, height: 340},
    '{c}': {x: 1100, y: 400, width: 250, height: 340}
};
const counts = {geometry: 0, managed: 3};

function runS11(scenario, rects, options = {}) {
    const ids = Object.keys(freeRects);
    const windows = ids.map(id => ({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, rects[id])
    }));
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s11' + scenario.slice(3) + '.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object,
        seenRects: freeRects, weaveCounts: options.counts || counts,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            activeWindow: windows[0], clientArea: () => dpArea}
    });
    expected.output = null;
    return JSON.parse(lines[0].slice('WEAVE_LIVE '.length));
}

function withFirst(rect) {
    return Object.assign({}, freeRects, {'{a}': rect});
}

test('S11a passes only when nothing moved, nothing was tiled and Weave wrote nothing', () => {
    assert.equal(runS11('S11a', freeRects).status, 'PASS');
    assert.equal(runS11('S11a', withFirst({x: 301, y: 200, width: 250, height: 340})).status,
        'FAIL');
    assert.equal(runS11('S11a', freeRects, {counts: {geometry: 1, managed: 3}}).status,
        'FAIL');
    assert.equal(runS11('S11a', freeRects, {counts: {geometry: 0, managed: 2}}).status,
        'FAIL');
    const ids = Object.keys(freeRects);
    const tiled = core.tree.layout(core.tree.masterStack(ids, 1, 0.6), dpArea, gaps);
    assert.equal(runS11('S11a', tiled).status, 'FAIL');
});

test('S11b to S11d expect the left half, the filled work area and the left half again', () => {
    const half = core.snap.snapRect('leftHalf', dpArea, gaps);
    const fill = core.tree.layout(core.tree.masterStack(['{a}'], 1, 0.6), dpArea, gaps)['{a}'];
    [['S11b', half], ['S11c', fill], ['S11d', half]].forEach(([scenario, rect]) => {
        assert.equal(runS11(scenario, withFirst(rect)).status, 'PASS', scenario);
        const off = Object.assign({}, rect, {width: rect.width - 1});
        assert.equal(runS11(scenario, withFirst(off)).status, 'FAIL', scenario);
        const nudged = {x: 1, y: 2, width: 3, height: 4};
        const moved = Object.assign({}, withFirst(rect), {'{b}': nudged});
        assert.equal(runS11(scenario, moved).status, 'FAIL', scenario);
    });
    assert.deepEqual(fill, {x: 8, y: 40, width: 2544, height: 1384});
});

test('the harness runs S11 with defaultMode float, an empty tileClasses and Weave keys', () => {
    const source = fs.readFileSync(path.resolve(__dirname,
        '../livetest/livetest.sh'), 'utf8');
    assert.match(source, /S10h S11a S11b S11c S11d/);
    assert.match(source, /cfg_set defaultMode float/);
    assert.match(source, /cfg_set tileClasses ""/);
    ['check-s11a.js', 'check-s11b.js', 'check-s11c.js', 'check-s11d.js'].forEach(file => {
        assert.ok(source.includes(file), file);
        const code = fs.readFileSync(path.resolve(__dirname, '../livetest/js', file), 'utf8');
        assert.doesNotMatch(code, /desktops\s*=|\.[\t ]*tile\b|\.(close|kill)\(/);
    });
    assert.ok(source.includes('invoke "Weave Snap Left Half"'));
    assert.ok(source.includes('invoke "Weave Toggle Float"'));
    assert.match(source, /HARNESS_KEYS="[^"]*\bdefaultMode\b[^"]*\btileClasses\b/);
    assert.match(source, /for key in \$HARNESS_KEYS; do cfg_del "\$key"; done/);
});

test('S11 compares against the first-seen rectangles after rounding them', () => {
    const fractional = Object.assign({}, freeRects, {'{b}': {x: 700.33, y: 299.6,
        width: 250, height: 340}});
    const lines = [];
    const windows = Object.keys(fractional).map(id => ({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'},
        frameGeometry: Object.assign({}, id === '{b}' ? freeRects[id] : fractional[id],
            id === '{b}' ? {x: 700, y: 300} : {})
    }));
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s11a.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object,
        seenRects: fractional, weaveCounts: counts,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    assert.equal(JSON.parse(lines[0].slice('WEAVE_LIVE '.length)).status, 'PASS');
});

// S12: floating windows resized like a tiler. The fake workspace has kcalc windows a, b, c.
const s12Ids = ['{a}', '{b}', '{c}'];

function s12Windows(rects, extra = []) {
    return s12Ids.map((id, index) => ({
        resourceClass: expected.resourceClass, internalId: id, desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, rects[index])
    })).concat(extra);
}

function runS12(scenario, rects, writes, extra) {
    const windows = s12Windows(rects, extra);
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-' + scenario.toLowerCase() + '.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object,
        liveIds: s12Ids, weaveWrites: writes,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    return JSON.parse(lines[0].slice('WEAVE_LIVE '.length));
}

const s12Rects = {
    start: [[8, 40, 500, 400], [516, 40, 600, 400], [1416, 40, 400, 400]],
    S12a: [[8, 40, 576, 400], [592, 40, 524, 400], [1416, 40, 400, 400]],
    S12b: [[8, 40, 500, 400], [516, 40, 600, 400], [1416, 40, 400, 400]],
    S12c: [[8, 40, 576, 442], [592, 40, 524, 400], [1416, 40, 400, 400]]
};
const toRect = array => ({x: array[0], y: array[1], width: array[2], height: array[3]});

test('S12 expectations are the tiler-style resize steps from the side-by-side start', () => {
    const plan = expected.s12Plan({screens: [{name: 'DP-1'}], clientArea: () => dpArea,
        windowList: () => s12Windows(s12Rects.start.map(toRect))}, s12Ids, core);
    const rects = key => s12Ids.map(id => {
        const rect = plan.states[key][id];
        return [rect.x, rect.y, rect.width, rect.height];
    });
    assert.deepEqual(rects(0), s12Rects.S12a);
    assert.deepEqual(rects(1), s12Rects.S12b);
    assert.deepEqual(rects(2), s12Rects.S12c);
    assert.deepEqual(rects(3)[0], [8, 448, 2544, 976]);
    assert.deepEqual(plan.writes, [2, 2, 2, 1]);
    assert.equal(plan.unsafe, false);
});

test('S12a to S12d pass on the planned rects and fail on a nudge or a write loop', () => {
    const plan = expected.s12Plan({screens: [{name: 'DP-1'}], clientArea: () => dpArea,
        windowList: () => s12Windows(s12Rects.start.map(toRect))}, s12Ids, core);
    ['S12a', 'S12b', 'S12c', 'S12d'].forEach((scenario, index) => {
        const rects = s12Ids.map(id => plan.states[index][id]);
        const writes = plan.writes[index];
        assert.equal(runS12(scenario, rects, writes).status, 'PASS', scenario);
        assert.equal(runS12(scenario, rects, writes + 1).status, 'FAIL', scenario + ' loop');
        const nudged = rects.map(rect => Object.assign({}, rect));
        nudged[1].x += 1;
        assert.equal(runS12(scenario, nudged, writes).status, 'FAIL', scenario + ' nudge');
    });
});

test('S12 is unsafe when a window that is not kcalc would follow the resized edge', () => {
    const outsider = {resourceClass: 'other', internalId: '{z}', normalWindow: true,
        output: {name: 'DP-1'}, frameGeometry: {x: 516, y: 40, width: 600, height: 400}};
    const hidden = Object.assign({}, outsider, {minimized: true});
    const make = extra => ({screens: [{name: 'DP-1'}], clientArea: () => dpArea,
        windowList: () => s12Windows(s12Rects.start.map(toRect), [extra])});
    assert.equal(expected.s12Plan(make(outsider), s12Ids, core).unsafe, true);
    assert.equal(expected.s12Plan(make(hidden), s12Ids, core).unsafe, false);
});

test('the harness runs S12 with the Weave resize keys and checks the write counts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../livetest/livetest.sh'), 'utf8');
    assert.match(source, /S12a S12b S12c S12d/);
    ['Resize Grow Width', 'Resize Shrink Width', 'Resize Grow', 'Resize Fill'].forEach(name =>
        assert.ok(source.includes('invoke "Weave ' + name + '"'), name));
    ['check-s12a.js', 'place-s12.js'].forEach(file => assert.ok(source.includes(file), file));
    ['place-s12.js', 'check-s12a.js', 'check-s12b.js', 'check-s12c.js', 'check-s12d.js']
        .forEach(file => {
            const code = fs.readFileSync(path.resolve(__dirname, '../livetest/js', file), 'utf8');
            assert.doesNotMatch(code, /desktops\s*=|\.[\t ]*tile\b|\.(close|kill)\(/);
        });
});

test('S12d accepts the left edge and the minimum size when the free area is too small', () => {
    const blocker = {resourceClass: 'other', internalId: '{z}', normalWindow: true,
        output: {name: 'DP-1'}, frameGeometry: {x: 0, y: 32, width: 2560, height: 1380}};
    const world = rects => ({screens: [{name: 'DP-1'}], clientArea: () => dpArea,
        windowList: () => s12Windows(rects, [blocker])});
    const start = s12Rects.start.map(toRect);
    const plan = expected.s12Plan(world(start), s12Ids, core);
    assert.equal(plan.small, true);
    assert.deepEqual(plan.states[3]['{a}'], {x: 8, y: 1420, width: 2544, height: 4});
    const run = (a, writes) => {
        const windows = s12Windows([a, plan.states[3]['{b}'], plan.states[3]['{c}']], [blocker]);
        const lines = [];
        expected.output = line => lines.push(line);
        vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
            '../livetest/js/check-s12d.js'), 'utf8'), {
            Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object,
            liveIds: s12Ids, weaveWrites: writes, KCALC_RESOURCE_CLASS: expected.resourceClass,
            workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
                clientArea: () => dpArea}
        });
        expected.output = null;
        return JSON.parse(lines[0].slice('WEAVE_LIVE '.length)).status;
    };
    assert.equal(run({x: 8, y: 1390, width: 250, height: 341}, 1), 'PASS');
    assert.equal(run({x: 9, y: 1390, width: 250, height: 341}, 1), 'FAIL');
    assert.equal(run({x: 8, y: 1390, width: 250, height: 341}, 2), 'FAIL');
    assert.equal(run({x: 8, y: 1390, width: 200, height: 341}, 1), 'FAIL');
});

// ---- live-install safety ------------------------------------------------------------

const harnessPath = path.resolve(__dirname, '../livetest/livetest.sh');
const harnessSource = () => fs.readFileSync(harnessPath, 'utf8');
const liveSection = source => source.slice(source.indexOf('# --- live run ---'));
const stateChanging = /\b(kw_set|kw_del|cfg_set|cfg_del|cfg_enabled_set|cfg_enabled_del|install_pkg|MODIFIED=true)\b|kwriteconfig6|kpackagetool6|unloadScript|reconfigure|Scripting start|invokeShortcut|\binvoke "/;

test('the refusal for a live install precedes every state-changing command', () => {
    const source = harnessSource();
    const live = liveSection(source);
    const refuse = live.indexOf('exit 3');
    assert.ok(refuse > 0, 'exit 3 exists');
    assert.ok(live.indexOf('detect_live') < refuse);
    const first = live.slice(0, refuse).split('\n')
        .filter(line => !/^\s*(#|say )/.test(line)).join('\n');
    assert.doesNotMatch(first, stateChanging);
    assert.match(live, /\[ "\$LIVE_FOUND" = true \] && \[ "\$TAKEOVER" != true \]/);
    // detection itself is read only
    const detect = source.slice(source.indexOf('detect_live() {'),
        source.indexOf('# Copies the live setup'));
    assert.doesNotMatch(detect, stateChanging);
    assert.match(detect, /kreadconfig6/);
    assert.match(detect, /isScriptLoaded/);
});

test('with --takeover the snapshot happens before the first state change', () => {
    const live = liveSection(harnessSource());
    const snapshot = live.indexOf('snapshot_live ||');
    assert.ok(snapshot > 0);
    const firstChange = live.search(/\b(MODIFIED=true|install_pkg|cfg_set|cfg_enabled_set)\b|unloadScript/);
    assert.ok(snapshot < firstChange);
    assert.match(live, /snapshot_live \|\| \{[^}]*exit 1/);
    const body = harnessSource();
    const snap = body.slice(body.indexOf('snapshot_live() {'), body.indexOf('restore_fail()'));
    ['package', 'script-weave.lines', 'weaveEnabled', 'loaded', 'state.text', 'STATE_ROOT']
        .forEach(word => assert.ok(snap.includes(word), word));
    assert.doesNotMatch(snap, stateChanging);
});

test('the restore code puts back package, keys, weaveEnabled, state and the script', () => {
    const body = harnessSource();
    const restore = body.slice(body.indexOf('restore_live() {'),
        body.indexOf('restore_failure_message() {'));
    ['kpackagetool6', 'install_pkg "$snap/package"', 'script-weave.lines', 'weaveEnabled',
        'org.weave.State.Set', 'Scripting start', 'reconfigure', 'diff -r'].forEach(word =>
        assert.ok(restore.includes(word), word));
    assert.match(body, /Live install: none found/);
    assert.match(body, /Live install: restored/);
    assert.match(body, /RESTORE FAILED/);
    assert.match(body, /result=4/);
});

test('the harness changes the Script-weave section only through guarded helpers', () => {
    const source = harnessSource();
    const lines = source.split('\n');
    lines.forEach((line, index) => {
        if (/^\s*(#|say )/.test(line)) return;
        if (/kwriteconfig6/.test(line)) {
            assert.match(line, /^kw_(set|del)\(\) \{ run kwriteconfig6/, 'line ' + (index + 1));
        }
    });
    assert.match(source, /HARNESS_KEYS="manageClasses settleSeconds logLevel defaultMode tileClasses defaultLayout gapInner gapOuter"/);
    // every cfg_set/cfg_del user passes a literal harness key or iterates over the list
    (source.match(/\bcfg_(set|del) ([A-Za-z$"]+)/g) || []).forEach(call => {
        assert.match(call, /cfg_(set|del) (manageClasses|settleSeconds|logLevel|defaultMode|tileClasses|defaultLayout|gapInner|gapOuter|"\$key")/);
    });
    assert.match(source, /uninstall_throwaway\(\)[\s\S]*PKG_TOUCHED[\s\S]*ENABLED_TOUCHED/);
});

test('rm -rf only touches the harness temp and snapshot directories', () => {
    harnessSource().split('\n').forEach(line => {
        if (!/rm -rf/.test(line) || /^\s*(#|say )/.test(line)) return;
        assert.match(line, /rm -rf "\$(TMP_DIR|SNAP_TMP)"/, line);
    });
});

test('--takeover and exit code 3 are documented', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '../README.md'), 'utf8');
    ['--takeover', 'exit code 3', 'weave-livetest', 'restore-', 'script-weave.lines',
        'org.weave.State.Set', 'Live install'].forEach(word =>
        assert.ok(readme.includes(word), word));
    assert.match(harnessSource(), /Usage: livetest\.sh \[--dry-run\] \[--json\] \[--takeover\]/);
});

// S13: the newer layouts with four tiled windows; the shapes are compared with the core.
function runS13(layout, id, rects) {
    const windows = rects.map((rect, index) => ({
        resourceClass: expected.resourceClass, internalId: '{w' + index + '}', desktop: 1,
        output: {name: 'DP-1'}, frameGeometry: Object.assign({}, rect)
    }));
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s13.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object,
        s13Layout: layout, s13Scenario: id,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            clientArea: () => dpArea}
    });
    expected.output = null;
    return JSON.parse(lines[0].slice('WEAVE_LIVE '.length));
}

test('S13a to S13e accept the core shapes for four windows and reject a moved one', () => {
    const ids = ['a', 'b', 'c', 'd'];
    [['rows', 'S13a'], ['hstack', 'S13b'], ['rmaster', 'S13c'], ['grid', 'S13d'],
        ['ultrawide', 'S13e']].forEach(([layout, id]) => {
        const mins = {};
        ids.forEach(key => { mins[key] = {width: 0, height: 341}; });
        const fitted = core.fit(ids, mins, dpArea, {outer: 8, inner: 8}, layout,
            {masterRatio: 0.6, arrival: ids});
        const placed = core.tree.layout(core.tree.generate(layout, fitted.tiled.slice(),
            {masterRatio: 0.6}), dpArea, {outer: 8, inner: 8});
        const rects = ids.map(key => placed[key] ? expected.rounded(placed[key]) :
            {x: 100, y: 100, width: 300, height: 341});
        const result = runS13(layout, id, rects);
        assert.equal(result.status, 'PASS', layout);
        assert.equal(result.actual.length, 4, layout);
        const off = rects.map((rect, index) => index ? rect : Object.assign({}, rect,
            {x: rect.x + 9}));
        assert.equal(runS13(layout, id, off).status, 'FAIL', layout + ' moved');
        assert.equal(runS13(layout, id, rects.slice(0, 3)).status, 'FAIL', layout + ' count');
    });
});

test('the harness runs S13 with the layout keys and an optional spectacle screenshot', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../livetest/livetest.sh'), 'utf8');
    assert.match(source, /S13a S13b S13c S13d S13e/);
    ['Rows', 'Hstack', 'Rmaster', 'Grid', 'Ultrawide'].forEach(name =>
        assert.ok(source.includes(':' + name), name));
    assert.ok(source.includes('invoke "Weave Layout $s13_label"'));
    assert.ok(source.includes('WEAVE_LIVETEST_SHOTS'));
    assert.ok(source.includes('spectacle -b -n -f -o'));
    assert.ok(source.includes('check-s13.js'));
});

// S14: the Scroll layout; two windows visible per page, the rest minimized.
function runS14(step, axis, rel, prev, wins, active) {
    const windows = wins.map((win, index) => ({
        resourceClass: expected.resourceClass, internalId: '{w' + index + '}', desktop: 1,
        output: {name: 'DP-1'}, minimized: win.minimized,
        frameGeometry: Object.assign({}, win.rect)
    }));
    const lines = [];
    expected.output = line => lines.push(line);
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../livetest/js/check-s14.js'), 'utf8'), {
        Weave: core, KWin: {PlacementArea: 0}, JSON, Math, String, Object, Array,
        s14Step: step, s14Axis: axis, s14Rel: rel, s14Prev: prev,
        KCALC_RESOURCE_CLASS: expected.resourceClass,
        workspace: {screens: [{name: 'DP-1'}], windowList: () => windows,
            activeWindow: active === undefined ? null : windows[active],
            clientArea: () => dpArea}
    });
    expected.output = null;
    return JSON.parse(lines[0].slice('WEAVE_LIVE '.length));
}

test('S14a to S14f check pages, the parked set and the master layout', () => {
    const gaps = {outer: 8, inner: 8};
    const page = axis => core.scroll.layout(['a', 'b'], {axis, visible: 2, offset: 0},
        dpArea, gaps, {});
    const rectOf = (p, id) => expected.rounded(p.rects[id]);
    const off = {x: 50, y: 50, width: 300, height: 400};
    const h = page('h');
    const win = (rect, minimized) => ({rect, minimized});
    const first = [win(rectOf(h, 'a')), win(rectOf(h, 'b')), win(off, true), win(off, true)];
    const a = runS14('a', 'h', 'none', [], first, 0);
    assert.equal(a.status, 'PASS');
    assert.deepEqual(a.info.visible, ['{w0}', '{w1}']);
    assert.deepEqual(a.info.parked, ['{w2}', '{w3}']);
    assert.equal(a.info.active, '{w0}');
    assert.equal(runS14('a', 'h', 'none', [], first.map((w, i) => i === 0 ?
        win(Object.assign({}, w.rect, {x: w.rect.x + 9})) : w), 0).status, 'FAIL');
    assert.equal(runS14('a', 'h', 'none', [], first.slice(0, 3).concat(
        [win(rectOf(h, 'a'))]), 0).status, 'FAIL', 'three visible');
    const second = [win(off, true), win(off, true), win(rectOf(h, 'a')), win(rectOf(h, 'b'))];
    assert.equal(runS14('b', 'h', 'other', ['{w0}', '{w1}'], second, 2).status, 'PASS');
    assert.equal(runS14('b', 'h', 'other', ['{w0}', '{w2}'], second, 2).status, 'FAIL');
    assert.equal(runS14('c', 'h', 'same', ['{w0}', '{w1}'], first, 0).status, 'PASS');
    assert.equal(runS14('c', 'h', 'same', ['{w0}', '{w1}'], second, 2).status, 'FAIL');
    const v = page('v');
    const stacked = [win(rectOf(v, 'a')), win(rectOf(v, 'b')), win(off, true), win(off, true)];
    assert.equal(runS14('d', 'v', 'same', ['{w0}', '{w1}'], stacked, 0).status, 'PASS');
    assert.equal(runS14('d', 'v', 'same', ['{w0}', '{w1}'], first, 0).status, 'FAIL', 'side by side');
    const revealed = [win(off, true), win(rectOf(v, 'a')), win(rectOf(v, 'b')), win(off, true)];
    assert.equal(runS14('e', 'v', 'target', ['{w2}'], revealed, 2).status, 'PASS');
    assert.equal(runS14('e', 'v', 'target', ['{w2}'], revealed, 1).status, 'FAIL', 'focus');
    const ids = ['a', 'b', 'c', 'd'];
    const placed = core.tree.layout(core.tree.generate('master', ids.slice(),
        {masterRatio: 0.6}), dpArea, gaps);
    const all = ids.map(id => win(expected.rounded(placed[id])));
    assert.equal(runS14('f', 'h', 'none', [], all, 0).status, 'PASS');
    assert.equal(runS14('f', 'h', 'none', [], all.map((w, i) => i === 3 ?
        win(w.rect, true) : w), 0).status, 'FAIL', 'one still minimized');
});

test('the harness runs S14 with the scroll shortcuts in order', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../livetest/livetest.sh'), 'utf8');
    assert.match(source, /S14a S14b S14c S14d S14e S14f/);
    const order = ['Weave Layout Scroll', 'Weave Scroll Next', 'Weave Scroll Previous',
        'Weave Scroll Axis Toggle', 'activate-s14.js', 'Weave Layout Master'];
    let at = source.indexOf('S14: the Scroll layout');
    order.forEach(item => {
        const next = source.indexOf(item, at);
        assert.ok(next > at, item);
        at = next;
    });
    assert.ok(source.includes('check-s14.js'));
    assert.ok(source.includes('core/scroll.js'));
});

// ---- behavioural tests against stub executables -------------------------------------

const {spawnSync} = require('node:child_process');
const os = require('node:os');

const iniLib = `
const fs = require('fs');
exports.parse = file => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const lines = text === '' ? [] : text.replace(/\\n$/, '').split('\\n');
    const groups = [{name: null, lines: []}];
    lines.forEach(line => {
        const m = /^\\[(.*)\\]$/.exec(line);
        if (m) groups.push({name: m[1], lines: []}); else groups[groups.length - 1].lines.push(line);
    });
    return groups;
};
exports.write = (file, groups) => {
    const out = [];
    groups.forEach(g => { if (g.name !== null) out.push('[' + g.name + ']'); out.push(...g.lines); });
    fs.writeFileSync(file, out.length ? out.join('\\n') + '\\n' : '');
};
exports.keyOf = line => line.slice(0, line.indexOf('='));
`;

const stubs = {
    'kreadconfig6': `#!/usr/bin/env node
const fs = require('fs'); const ini = require('./ini.js'); const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, 'kreadconfig6 ' + a.join(' ') + '\\n');
let file, group, key, def = '';
for (let i = 0; i < a.length; i++) {
    if (a[i] === '--file') file = a[++i]; else if (a[i] === '--group') group = a[++i];
    else if (a[i] === '--key') key = a[++i]; else if (a[i] === '--default') def = a[++i];
}
const g = ini.parse(file).find(x => x.name === group);
const line = g && g.lines.find(l => l.indexOf('=') > 0 && ini.keyOf(l) === key);
process.stdout.write((line === undefined ? def : line.slice(key.length + 1)) + '\\n');
`,
    'kwriteconfig6': `#!/usr/bin/env node
const fs = require('fs'); const ini = require('./ini.js'); const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, 'kwriteconfig6 ' + a.join(' ') + '\\n');
let file, group, key, del = false; const rest = [];
for (let i = 0; i < a.length; i++) {
    if (a[i] === '--file') file = a[++i]; else if (a[i] === '--group') group = a[++i];
    else if (a[i] === '--key') key = a[++i]; else if (a[i] === '--delete') del = true;
    else rest.push(a[i]);
}
if (file !== process.env.FAKE_RC) { console.error('stub: refusing foreign file ' + file); process.exit(9); }
const groups = ini.parse(file);
let g = groups.find(x => x.name === group);
if (!g && !del) {
    const last = groups[groups.length - 1];
    if (last.lines.length && last.lines[last.lines.length - 1] !== '') last.lines.push('');
    g = {name: group, lines: []}; groups.push(g);
}
if (g) {
    let tail = 0; while (g.lines.length > tail && g.lines[g.lines.length - 1 - tail] === '') tail++;
    g.lines = g.lines.slice(0, g.lines.length - tail);
    g.lines = g.lines.filter(l => !(l.indexOf('=') > 0 && ini.keyOf(l) === key));
    if (!del) g.lines.push(key + '=' + (rest[0] === undefined ? '' : rest[0]));
    const body = g.lines.sort((x, y) =>
        ini.keyOf(x) < ini.keyOf(y) ? -1 : ini.keyOf(x) > ini.keyOf(y) ? 1 : 0);
    g.lines = body.concat(new Array(tail).fill(''));
}
ini.write(file, groups);
`,
    'kpackagetool6': `#!/bin/sh
echo "kpackagetool6 $*" >> "$STUB_LOG"
case "$1" in --type=*) shift ;; esac
mode=$1; arg=$2
if [ -n "\${STUB_FAIL_ON-}" ]; then
    case "$arg" in *"$STUB_FAIL_ON"*) echo "stub failure" >&2; exit 1 ;; esac
fi
case "$mode" in
    -i) if [ -e "$FAKE_SCRIPTS/weave" ]; then echo "already installed" >&2; exit 1; fi
        mkdir -p "$FAKE_SCRIPTS"; cp -a "$arg" "$FAKE_SCRIPTS/weave" ;;
    -u) [ -e "$FAKE_SCRIPTS/weave" ] || exit 1
        rm -rf "$FAKE_SCRIPTS/weave"; cp -a "$arg" "$FAKE_SCRIPTS/weave" ;;
    -r) rm -rf "$FAKE_SCRIPTS/weave" ;;
esac
`,
    'qdbus6': `#!/bin/sh
echo "qdbus6 $*" >> "$STUB_LOG"
case "$*" in
    *isScriptLoaded*) cat "$STUB_DIR/loaded" ;;
    "org.kde.KWin /Scripting unloadScript weave") echo false > "$STUB_DIR/loaded" ;;
    "org.kde.KWin /Scripting start")
        if [ -e "$FAKE_SCRIPTS/weave" ] && grep -q '^weaveEnabled=true' "$FAKE_RC"; then
            echo true > "$STUB_DIR/loaded"
        fi ;;
    *" loadScript "*) echo 7 ;;
    *org.weave.State.Get) cat "$STUB_DIR/state"; echo ;;
    *org.weave.State.Set*) printf '%s' "$4" > "$STUB_DIR/state" ;;
esac
exit 0
`,
    'journalctl': `#!/bin/sh
echo "journalctl $*" >> "$STUB_LOG"
echo "weave loaded build=$(cat "$STUB_BUILD_ID")"
`,
    'kcalc': '#!/bin/sh\necho "kcalc $*" >> "$STUB_LOG"\nexit 0\n',
    'gdbus': '#!/bin/sh\necho "gdbus $*" >> "$STUB_LOG"\nexit 0\n',
    'pgrep': '#!/bin/sh\necho "pgrep $*" >> "$STUB_LOG"\nexit 1\n',
    'sleep': '#!/bin/sh\nexit 0\n'
};

const originalRc = [
    '[General]', 'Name=test', '', '[Plugins]', 'krohnkiteEnabled=true', 'weaveEnabled=true', '',
    '[Script-weave]', 'defaultMode=float', 'focusRatio=0.6', 'gapInner=6', 'gapOuter=8',
    'logLevel=info', 'manageClasses=*,!org.kde.plasmashell', 'persist=true',
    'resizeStep=80', 'settleSeconds=2', 'tileClasses=org.kde.konsole', '',
    '[Script-other]', 'x=1', ''].join('\n');
const statelessRc = ['[General]', 'Name=test', '', '[Plugins]', 'krohnkiteEnabled=true', ''].join('\n');
const originalState = '{"records":[{"class":"a","mode":"tiled"}]}';

function makeWorld(options) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-livetest-'));
    const world = {dir, home: path.join(dir, 'home'), stubs: path.join(dir, 'stubs'),
        log: path.join(dir, 'calls.log'), rc: path.join(dir, 'home/.config/kwinrc'),
        scripts: path.join(dir, 'home/.local/share/kwin/scripts'),
        stubDir: path.join(dir, 'stubdata'), stateHome: path.join(dir, 'home/.local/state')};
    [world.stubs, world.stubDir, path.dirname(world.rc), world.scripts, world.stateHome]
        .forEach(d => fs.mkdirSync(d, {recursive: true}));
    fs.writeFileSync(path.join(world.stubs, 'ini.js'), iniLib);
    Object.keys(stubs).forEach(name => {
        fs.writeFileSync(path.join(world.stubs, name), stubs[name], {mode: 0o755});
    });
    fs.writeFileSync(world.log, '');
    fs.writeFileSync(world.rc, options.rc);
    fs.writeFileSync(path.join(world.stubDir, 'loaded'), options.loaded ? 'true\n' : 'false\n');
    fs.writeFileSync(path.join(world.stubDir, 'state'), options.state || '');
    if (options.package) {
        const pkg = path.join(world.scripts, 'weave');
        fs.mkdirSync(path.join(pkg, 'contents/ui'), {recursive: true});
        fs.writeFileSync(path.join(pkg, 'metadata.json'), '{"KPlugin":{"Id":"weave"},"X-Plasma-API":"declarativescript","note":"user copy"}\n');
        fs.writeFileSync(path.join(pkg, 'contents/ui/main.qml'), 'import QtQuick\nItem { property string user: "å" }\n');
        fs.writeFileSync(path.join(pkg, 'contents/ui/data.bin'), Buffer.from([0, 1, 2, 255]));
    }
    return world;
}

function harness(world, args, extraEnv) {
    const env = Object.assign({}, process.env, {
        HOME: world.home, XDG_STATE_HOME: world.stateHome,
        XDG_CONFIG_HOME: path.join(world.home, '.config'),
        XDG_RUNTIME_DIR: path.join(world.dir, 'run'),
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(world.dir, 'no-bus'),
        PATH: [world.stubs, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
        STUB_LOG: world.log, STUB_DIR: world.stubDir, FAKE_RC: world.rc,
        FAKE_SCRIPTS: world.scripts,
        STUB_BUILD_ID: path.resolve(__dirname, '../dist/BUILD_ID'),
        WEAVE_LIVETEST_KWINRC: world.rc, WEAVE_LIVETEST_SCRIPTS: world.scripts
    }, extraEnv || {});
    const result = spawnSync('sh', [harnessPath].concat(args), {env, encoding: 'utf8',
        timeout: 120000, cwd: world.dir});
    return {code: result.status, out: result.stdout + result.stderr,
        calls: fs.readFileSync(world.log, 'utf8').split('\n').filter(Boolean)};
}

function snapshotTree(dir) {
    const out = {};
    const walk = (current, prefix) => fs.readdirSync(current).sort().forEach(name => {
        const full = path.join(current, name);
        const rel = prefix + '/' + name;
        if (fs.statSync(full).isDirectory()) walk(full, rel);
        else out[rel] = fs.readFileSync(full).toString('hex');
    });
    if (fs.existsSync(dir)) walk(dir, '');
    return out;
}

const cleanWorld = world => fs.rmSync(world.dir, {recursive: true, force: true});
const changing = /^(kwriteconfig6|kpackagetool6) |unloadScript|reconfigure|Scripting start|loadScript|State\.Set|invokeShortcut/;

test('stubs shadow every real tool the harness can call', () => {
    const world = makeWorld({rc: statelessRc, loaded: false});
    try {
        ['kreadconfig6', 'kwriteconfig6', 'kpackagetool6', 'qdbus6', 'journalctl', 'kcalc',
            'gdbus', 'pgrep', 'sleep'].forEach(name => {
            const found = spawnSync('sh', ['-c', 'command -v ' + name], {encoding: 'utf8',
                env: {PATH: [world.stubs, '/usr/bin', '/bin'].join(':')}});
            assert.equal(found.stdout.trim(), path.join(world.stubs, name), name);
        });
    } finally { cleanWorld(world); }
});

[
    ['an installed package', {package: true}],
    ['weaveEnabled in kwinrc', {rc: '[Plugins]\nweaveEnabled=false\n'}],
    ['a Script-weave key', {rc: '[Script-weave]\ngapInner=6\n'}],
    ['a loaded script', {loaded: true}],
    ['everything', {package: true, rc: originalRc, loaded: true, state: originalState}]
].forEach(([name, extra]) => {
    test('a live install (' + name + ') without --takeover exits 3 and changes nothing', () => {
        const world = makeWorld(Object.assign({rc: statelessRc, loaded: false}, extra));
        try {
            const rcBefore = fs.readFileSync(world.rc, 'utf8');
            const treeBefore = snapshotTree(world.scripts);
            const result = harness(world, []);
            assert.equal(result.code, 3, result.out);
            assert.match(result.out, /would replace it/);
            assert.match(result.out, /--takeover/);
            assert.equal(result.calls.filter(call => changing.test(call)).length, 0,
                result.calls.join('\n'));
            result.calls.forEach(call => assert.match(call, /^(kreadconfig6 |qdbus6 .*isScriptLoaded)/));
            assert.equal(fs.readFileSync(world.rc, 'utf8'), rcBefore);
            assert.deepEqual(snapshotTree(world.scripts), treeBefore);
            assert.equal(fs.existsSync(path.join(world.stateHome, 'weave-livetest')), false);
        } finally { cleanWorld(world); }
    });
});

test('--takeover restores kwinrc, the package, the state and the running script', () => {
    const world = makeWorld({rc: originalRc, loaded: true, package: true, state: originalState});
    try {
        const treeBefore = snapshotTree(path.join(world.scripts, 'weave'));
        const rcBefore = fs.readFileSync(world.rc);
        const result = harness(world, ['--takeover']);
        assert.notEqual(result.code, 0, 'the stubbed run must abort early');
        assert.match(result.out, /Timed out waiting for three kcalc windows|Timed out/);
        const log = result.calls;
        // the throwaway really replaced things during the run
        assert.ok(log.some(call => /^kpackagetool6 .*-u .*dist/.test(call)), log.join('\n'));
        assert.ok(log.some(call => /kwriteconfig6 .*--key manageClasses org\.kde\.kcalc/.test(call)));
        // nothing but the final state is left
        assert.ok(fs.readFileSync(world.rc).equals(rcBefore), fs.readFileSync(world.rc, 'utf8'));
        assert.deepEqual(snapshotTree(path.join(world.scripts, 'weave')), treeBefore);
        assert.equal(fs.readFileSync(path.join(world.stubDir, 'state'), 'utf8'), originalState);
        assert.equal(fs.readFileSync(path.join(world.stubDir, 'loaded'), 'utf8').trim(), 'true');
        const lastPackage = log.map((c, i) => /^kpackagetool6/.test(c) ? i : -1)
            .reduce((a, b) => Math.max(a, b), -1);
        const start = log.lastIndexOf('qdbus6 org.kde.KWin /Scripting start');
        assert.ok(start > lastPackage, 'Scripting start comes after the reinstall');
        assert.ok(log.some(call => call.startsWith('qdbus6 org.weave.State /State org.weave.State.Set ')));
        assert.match(result.out, /Live install: restored/);
        // the snapshot copy stays in the state directory, the mktemp copy is gone
        const root = path.join(world.stateHome, 'weave-livetest');
        const kept = fs.readdirSync(root);
        assert.equal(kept.length, 1);
        assert.match(kept[0], /^restore-/);
        const files = fs.readdirSync(path.join(root, kept[0])).sort();
        ['kwinrc.before', 'loaded', 'package', 'script-weave.lines', 'state.text',
            'weaveEnabled.present', 'weaveEnabled.value'].forEach(name =>
            assert.ok(files.includes(name), name));
        assert.deepEqual(snapshotTree(path.join(root, kept[0], 'package')), treeBefore);
        assert.equal(fs.readFileSync(path.join(root, kept[0], 'kwinrc.before'), 'utf8'), originalRc);
        // every key the harness wrote or deleted is one of its own
        log.filter(call => /^kwriteconfig6 .*--group Script-weave/.test(call)).forEach(call => {
            const key = /--key (\S+)/.exec(call)[1];
            const saved = /^[a-zA-Z]+$/.test(key);
            assert.ok(saved, call);
        });
        assert.equal(log.some(call => /org\.kde\.KWin \/Scripting unloadScript weave/.test(call)), true);
    } finally { cleanWorld(world); }
});

test('--takeover with only Script-weave keys (no package) restores those keys', () => {
    const world = makeWorld({rc: originalRc.replace('weaveEnabled=true\n', ''), loaded: false});
    try {
        const rcBefore = fs.readFileSync(world.rc);
        const result = harness(world, ['--takeover']);
        assert.notEqual(result.code, 0);
        assert.ok(fs.readFileSync(world.rc).equals(rcBefore), fs.readFileSync(world.rc, 'utf8'));
        assert.equal(fs.existsSync(path.join(world.scripts, 'weave')), false);
        assert.equal(result.calls.includes('qdbus6 org.kde.KWin /Scripting start'), true,
            'the throwaway run starts it; the restore does not start an unloaded script again');
        assert.match(result.out, /Live install: restored/);
    } finally { cleanWorld(world); }
});

test('a failed restore is loud, exits non-zero and keeps the snapshot', () => {
    const world = makeWorld({rc: originalRc, loaded: true, package: true, state: originalState});
    try {
        const result = harness(world, ['--takeover'], {STUB_FAIL_ON: '/package'});
        assert.notEqual(result.code, 0);
        assert.match(result.out, /RESTORE FAILED/);
        assert.match(result.out, /NOT FULLY RESTORED/);
        const root = path.join(world.stateHome, 'weave-livetest');
        const kept = fs.readdirSync(root);
        assert.equal(kept.length, 1);
        assert.ok(result.out.includes(path.join(root, kept[0])), 'names the snapshot path');
        assert.match(result.out, /Manual restore/);
        assert.ok(fs.existsSync(path.join(root, kept[0], 'package/metadata.json')));
    } finally { cleanWorld(world); }
});

test('without a live install the throwaway is installed, then removed as before', () => {
    const world = makeWorld({rc: statelessRc, loaded: false});
    try {
        const rcBefore = fs.readFileSync(world.rc, 'utf8');
        const result = harness(world, []);
        assert.notEqual(result.code, 0);
        assert.match(result.out, /Live install: none found/);
        assert.ok(result.calls.some(call => /^kpackagetool6 .*-i .*dist/.test(call)));
        assert.ok(result.calls.some(call => /^kpackagetool6 .*-r weave/.test(call)));
        assert.equal(result.calls.some(call => /^kpackagetool6 \S+ -u /.test(call)), false);
        assert.equal(result.calls.some(call => /org\.weave\.State/.test(call)), false);
        assert.equal(fs.existsSync(path.join(world.scripts, 'weave')), false);
        const after = fs.readFileSync(world.rc, 'utf8');
        assert.doesNotMatch(after, /weaveEnabled=|manageClasses|settleSeconds|logLevel/);
        assert.match(after, /krohnkiteEnabled=true/);
        const content = text => text.split('\n').filter(line => line && line !== '[Script-weave]');
        assert.deepEqual(content(after), content(rcBefore));
        assert.equal(fs.existsSync(path.join(world.stateHome, 'weave-livetest')), false);
        result.calls.filter(call => /^kwriteconfig6 /.test(call)).forEach(call => {
            if (/--group Script-weave/.test(call)) {
                assert.match(call, /--key (manageClasses|settleSeconds|logLevel|defaultMode|tileClasses|defaultLayout|gapInner|gapOuter)\b/);
            } else {
                assert.match(call, /--group Plugins --key weaveEnabled/);
            }
        });
    } finally { cleanWorld(world); }
});

test('--takeover with nothing to take over behaves like a plain run', () => {
    const world = makeWorld({rc: statelessRc, loaded: false});
    try {
        const result = harness(world, ['--takeover']);
        assert.match(result.out, /Live install: none found/);
        assert.equal(fs.existsSync(path.join(world.stateHome, 'weave-livetest')), false);
    } finally { cleanWorld(world); }
});

test('--dry-run prints the snapshot and restore plan and runs nothing', () => {
    const world = makeWorld({rc: originalRc, loaded: true, package: true, state: originalState});
    try {
        const rcBefore = fs.readFileSync(world.rc);
        const result = harness(world, ['--dry-run', '--takeover']);
        assert.equal(result.code, 0, result.out);
        assert.match(result.out, /DRY-RUN: --takeover: snapshot/);
        assert.match(result.out, /org\.weave\.State\.Set <saved>/);
        assert.match(result.out, /weave-livetest\/restore-<timestamp>/);
        assert.deepEqual(result.calls, []);
        assert.ok(fs.readFileSync(world.rc).equals(rcBefore));
        assert.equal(fs.existsSync(path.join(world.stateHome, 'weave-livetest')), false);
    } finally { cleanWorld(world); }
});
