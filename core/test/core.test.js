const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const api = require('../index');
const {geometry: g, tree: t, stage: s, arrangement: a} = api;
const area = g.rect(-100, 20, 1001, 701);
const gaps = {inner: 7, outer: 13};
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function disjoint(rects) {
    const list = Object.values(rects);
    list.forEach((r, i) => { assert.ok(r.width >= 0 && r.height >= 0); Object.values(r).forEach(value => assert.ok(Number.isInteger(value))); list.slice(0, i).forEach(b => assert.ok(r.x + r.width <= b.x || b.x + b.width <= r.x || r.y + r.height <= b.y || b.y + b.height <= r.y)); });
}
test('splits conserve every pixel for odd sizes, zero and excessive gaps', () => {
    for (let size = 0; size < 50; size++) for (const gap of [0, 1, 7, 100]) for (const ratio of [0, 0.1, 0.5, 0.99, 1]) {
        const r = g.rect(-10, 5, size, size);
        for (const [fn, key] of [[g.splitH, 'width'], [g.splitV, 'height']]) { const [a, b] = fn(r, ratio, gap); assert.equal(a[key] + b[key] + Math.min(gap, size), size); }
    }
});
test('geometry boundaries, insets and size clamps', () => {
    assert.equal(g.contains(area, {x: area.x + area.width, y: 20}), false);
    assert.deepEqual(g.centre(g.rect(0, 0, 3, 5)), {x: 1.5, y: 2.5});
    assert.equal(g.inset(area, 9000, 9000, 9000, 9000).width, 0);
    assert.equal(g.clampSize(area, {w: 1200}).width, 1200);
    assert.ok(g.equalRects(area, Object.assign({}, area)));
});
test('tree insert, stacks, remove, swap and dock preserve inputs', () => {
    const original = freeze(t.columns(['a', 'b', 'c']));
    const stacked = t.insert(original, 'd', 'b', 'center');
    assert.deepEqual(t.layout(stacked, area, gaps).b, t.layout(stacked, area, gaps).d);
    assert.equal(Object.keys(t.layout(t.remove(stacked, 'b'), area, gaps)).length, 3);
    const swapped = t.swap(original, 'a', 'c');
    assert.deepEqual(t.layout(swapped, area, gaps).a, t.layout(original, area, gaps).c);
    for (const side of ['left', 'right', 'top', 'bottom']) { const docked = t.dockToSide(original, 'b', side); assert.equal(Object.keys(t.layout(docked, area, gaps)).length, 3); disjoint(t.layout(docked, area, gaps)); }
    assert.equal(t.remove(t.monocle(['a']), 'a'), null);
});
test('minimum sizes propagate through nested splits and stacks', () => {
    const tree = t.insert(t.columns(['a', 'b']), 'c', 'a', 'center');
    const rects = t.layout(tree, g.rect(0, 0, 1000, 600), {inner: 10}, {c: {w: 700}, b: {w: 200}});
    assert.ok(rects.a.width >= 700); assert.ok(rects.b.width >= 200);
    disjoint(t.layout(t.columns(['a', 'b']), g.rect(0, 0, 50, 20), {inner: 10}, {a: {w: 100}, b: {w: 100}}));
});
test('tree hit zones, gap exclusion and resize paths', () => {
    const tree = t.columns(['a', 'b']), r = g.rect(0, 0, 100, 100);
    assert.equal(t.hitTest(tree, r, {inner: 10}, {x: 22, y: 50}).edge, 'center');
    assert.equal(t.hitTest(tree, r, {inner: 10}, {x: 1, y: 50}).edge, 'left');
    assert.equal(t.hitTest(tree, r, {inner: 10}, {x: 50, y: 50}), null);
    assert.deepEqual(t.edgeAt(tree, r, {inner: 10}, {x: 50, y: 50}, 0), []);
    assert.equal(t.edgeAt(tree, r, {}, {x: 50, y: 200}, 1), null);
    assert.equal(t.setRatio(tree, [], 2).ratio, 1);
});
test('all generators handle empty through twelve windows', () => {
    for (let n = 0; n <= 12; n++) for (const generate of [t.columns, t.monocle, t.spiral, ids => t.masterStack(ids, 2, 0.6)]) {
        const ids = Array.from({length: n}, (_, i) => 'w' + i), rects = t.layout(generate(ids), area, gaps);
        assert.deepEqual(Object.keys(rects).sort(), ids.slice().sort());
        if (generate !== t.monocle) disjoint(rects);
    }
});
test('snap halves, thirds, quarters and maximize respect exact shared gaps', () => {
    const snap = name => api.snapRect(name, area, gaps);
    const left = snap('leftHalf'), right = snap('rightHalf');
    assert.equal(right.x - left.x - left.width, 7);
    assert.equal(snap('rightThird').x - snap('centerThird').x - snap('centerThird').width, 7);
    assert.equal(snap('centerThird').x - snap('leftThird').x - snap('leftThird').width, 7);
    for (const name of ['topHalf','bottomHalf','topLeft','topRight','bottomLeft','bottomRight','leftTwoThirds','rightTwoThirds','centerQuarter','maximize']) {
        const r = snap(name); assert.ok(r.x >= area.x + 13 && r.y >= area.y + 13); assert.ok(r.x + r.width <= area.x + area.width - 13); assert.ok(r.y + r.height <= area.y + area.height - 13);
    }
    assert.throws(() => snap('unknown'));
});
test('stage promotion swaps in place, pinning and vacancy reuse', () => {
    let state = {focus: null, cells: []}; for (const id of ['a','b','c','d']) state = s.addWindow(state, id);
    freeze(state); const promoted = s.promote(state, 'c');
    assert.equal(promoted.focus, 'c'); assert.equal(promoted.cells.find(c => c.window === 'a').side, 'right');
    assert.deepEqual(promoted.cells.filter(c => c.window !== 'a'), state.cells.filter(c => c.window !== 'c'));
    assert.equal(s.promote(s.pin(state, 'b'), 'b').focus, 'a');
    assert.equal(s.promote(s.unpin(s.pin(state, 'b'), 'b'), 'b').focus, 'b');
    const added = s.addWindow(s.removeWindow(state, 'b'), 'e'); assert.equal(added.cells.find(c => c.window === 'e').index, 0);
    assert.equal(s.cycle(state, -1).focus, 'd');
});
test('stage zero through twelve windows and constrained overflow', () => {
    let state = {focus: null, cells: []};
    for (let n = 0; n <= 12; n++) {
        const result = s.layout(state, area, {gaps, gradient: 1, railCellMin: {w: 100, h: 70}});
        assert.equal(Object.keys(result.rects).length + result.overflow.length, n); disjoint(result.rects);
        if (n === 1) assert.deepEqual(result.rects.w0, g.workRect(area, gaps));
        state = s.addWindow(state, 'w' + n);
    }
    assert.ok(s.layout(state, g.rect(0, 0, 100, 40), {gaps, railCellMin: {w: 100, h: 100}}).overflow.length > 0);
});
test('templates validate, quantize shared boundaries and report assignments', () => {
    const templates = require('../templates.json');
    for (const template of Object.values(templates)) { assert.ok(a.validateTemplate(template)); disjoint(a.applyTemplate(freeze(template), area, gaps)); }
    const r = a.applyTemplate(templates['trio-main-two-stacked'], area, gaps);
    assert.equal(r[1].x - r[0].x - r[0].width, 7); assert.equal(r[2].y - r[1].y - r[1].height, 7);
    assert.deepEqual(a.assign(templates['trio-columns'], ['a']).unfilled, [1,2]);
    assert.equal(a.validateTemplate({slots: [{x: 0,y: 0,w: 1,h: 1},{x: 0,y: 0,w: 0.5,h: 0.5}]}), false);
    assert.equal(a.validateTemplate({slots: [{x: -1,y: 0,w: 1,h: 1}]}), false);
});
test('context mode transitions preserve float geometry and exclude floating windows', () => {
    const ctx = freeze({windows: [{id:'a',mode:'float',floatGeom:area},{id:'b',mode:'tiled',floatGeom:area}], tree:t.monocle(['b']), groups: [{id:'g',template:require('../templates.json')['pair-centred'],assignments:[]}]});
    const tiled = api.toTile(ctx, 'a', g.rect(10,20,300,400));
    assert.equal(Object.keys(api.layoutContext(tiled, area, {gaps})).length, 2);
    const floated = api.toFloat(tiled, 'a'); assert.deepEqual(floated.windows[0].floatGeom, g.rect(10,20,300,400));
    assert.deepEqual(Object.keys(api.layoutContext(floated, area, {gaps})), ['b']);
    const arranged = api.toArrange(tiled, 'a', 'g'); assert.equal(Object.keys(api.layoutContext(arranged, area, {gaps})).length, 2);
});
test('expected geometry matches once per recorded event, including out of order', () => {
    const expected = new api.ExpectedGeometry(); expected.record('a', area); expected.record('a', g.rect(0,0,1,1));
    assert.equal(expected.consume('a', g.rect(0,0,2,2)), false); assert.equal(expected.consume('a', area), true); assert.equal(expected.consume('a', area), false);
    assert.equal(expected.consume('a', g.rect(0,0,1,1)), true);
});
test('classic scripts concatenate without require in an isolated engine', () => {
    const sandbox = vm.createContext({});
    const files = ['geometry','tree','snap','stage','arrangement','context','index'];
    vm.runInContext(files.map(name => fs.readFileSync(path.join(__dirname, '..', name + '.js'), 'utf8')).join('\n'), sandbox);
    assert.equal(vm.runInContext('Weave.snapRect("maximize", {x:0,y:0,width:100,height:100}, {outer:5}).width', sandbox), 90);
    assert.equal(vm.runInContext('Weave.tree.layout(Weave.tree.columns(["a","b"]), {x:0,y:0,width:100,height:100}, {}).b.x', sandbox), 50);
});
