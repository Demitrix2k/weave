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

Object.values(scenarioFiles).forEach(file => {
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
