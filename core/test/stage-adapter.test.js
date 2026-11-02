const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('..');

const s = api.stage;
const area = {x: 0, y: 0, width: 1200, height: 801};
const gaps = {inner: 8, outer: 8};

test('stage order and fromOrder round-trip the window order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const state = s.fromOrder(ids);
    assert.equal(state.focus, 'a');
    assert.deepEqual(s.order(state), ids);
    assert.deepEqual(s.order(s.fromOrder(ids, 'c')), ['c', 'a', 'b', 'd', 'e']);
    assert.deepEqual(s.order(s.fromOrder(ids, 'zzz')), ids);
    assert.deepEqual(s.fromOrder([]), {focus: null, cells: []});
    assert.deepEqual(s.order(s.promote(state, 'd')), ['d', 'b', 'c', 'a', 'e']);
});

test('stage swap exchanges two slots and leaves pinned cells alone', () => {
    const state = s.fromOrder(['a', 'b', 'c']);
    const swapped = s.swap(state, 'b', 'c');
    assert.deepEqual(s.order(swapped), ['a', 'c', 'b']);
    assert.deepEqual(s.order(s.swap(state, 'a', 'c')), ['c', 'b', 'a']);
    assert.deepEqual(s.order(s.swap(state, 'c', 'a')), ['c', 'b', 'a']);
    assert.deepEqual(s.swap(state, 'a', 'a'), state);
    assert.deepEqual(s.swap(state, 'a', 'missing'), state);
    assert.deepEqual(s.swap(s.pin(state, 'b'), 'a', 'b'), s.pin(state, 'b'));
    assert.deepEqual(s.order(state), ['a', 'b', 'c']);
});

test('layoutStacked puts overflow windows on the last placed rail cell', () => {
    const params = {gaps, gradient: 0.5, railCellMin: {w: 140, h: 110}};
    const state = s.fromOrder(Array.from({length: 13}, (_, i) => 'w' + i));
    const plain = s.layout(state, area, params);
    const stacked = s.layoutStacked(state, area, params);
    assert.deepEqual(stacked.overflow, ['w11', 'w12']);
    assert.equal(stacked.anchor, 'w10');
    assert.equal(plain.rects.w11, undefined);
    assert.deepEqual(stacked.rects.w11, plain.rects.w10);
    assert.deepEqual(stacked.rects.w12, plain.rects.w10);
    assert.deepEqual(api.layoutContext({windows: state.cells.map(cell => ({
        id: cell.window, mode: 'tiled'})).concat({id: 'w0', mode: 'tiled'}),
    layout: 'stage', stage: state, tree: null, groups: []}, area, params).w12,
    plain.rects.w10);
    assert.equal(s.layoutStacked(s.fromOrder(['a']), area, params).anchor, null);
});

test('focusRatioForEdge inverts the layout for every dragged side', () => {
    const params = {gaps, focusRatio: 0.5};
    const state = s.fromOrder(['a', 'b', 'c']);
    const rects = s.layout(state, area, params).rects;
    const near = (value, wanted) => assert.ok(Math.abs(value - wanted) < 0.002, value);
    near(s.focusRatioForEdge(area, gaps, 'focus-left', rects.a.x), 0.5);
    near(s.focusRatioForEdge(area, gaps, 'focus-right', rects.a.x + rects.a.width), 0.5);
    near(s.focusRatioForEdge(area, gaps, 'left-rail', rects.b.x + rects.b.width), 0.5);
    near(s.focusRatioForEdge(area, gaps, 'right-rail', rects.c.x), 0.5);
    assert.equal(s.focusRatioForEdge(area, gaps, 'bogus', 100), null);
});

test('the layout cycle runs through the tree layouts and then stage', () => {
    assert.deepEqual(api.tree.CYCLE_LAYOUTS, ['master', 'columns', 'monocle', 'spiral', 'rows',
        'hstack', 'rmaster', 'grid', 'ultrawide', 'stage']);
    assert.equal(api.tree.cycleAnyLayout('ultrawide', 1), 'stage');
    assert.equal(api.tree.cycleAnyLayout('stage', 1), 'master');
    assert.equal(api.tree.cycleAnyLayout('master', -1), 'stage');
    assert.equal(api.tree.validAnyLayout('stage'), true);
    assert.equal(api.tree.validAnyLayout('Stage'), false);
    assert.equal(api.tree.validLayout('stage'), false);
});
