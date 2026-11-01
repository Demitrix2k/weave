const test = require('node:test');
const assert = require('node:assert/strict');
const {tree} = require('../tree');
const {geometry} = require('../geometry');
const {stage} = require('../stage');

const area = {x: 0, y: 0, width: 1000, height: 800};
const gaps = {inner: 10, outer: 0};
// a | (b over c): a 0,0,495,800  b 505,0,495,395  c 505,405,495,395
const t = tree.masterStack(['a', 'b', 'c'], 1, 0.5);

function rects(next) {
    return tree.layout(next, area, gaps);
}

test('neighbour picks the nearest rectangle whose centre and edges lie further that way', () => {
    const r = rects(t);
    assert.equal(geometry.neighbour(r, 'a', 'right'), 'b');
    assert.equal(geometry.neighbour(r, 'b', 'left'), 'a');
    assert.equal(geometry.neighbour(r, 'c', 'left'), 'a');
    assert.equal(geometry.neighbour(r, 'b', 'down'), 'c');
    assert.equal(geometry.neighbour(r, 'c', 'up'), 'b');
});

test('neighbour returns null at the edge and for unknown windows', () => {
    const r = rects(t);
    assert.equal(geometry.neighbour(r, 'a', 'left'), null);
    assert.equal(geometry.neighbour(r, 'a', 'up'), null);
    assert.equal(geometry.neighbour(r, 'a', 'down'), null);
    assert.equal(geometry.neighbour(r, 'b', 'up'), null);
    assert.equal(geometry.neighbour(r, 'c', 'down'), null);
    assert.equal(geometry.neighbour(r, 'c', 'right'), null);
    assert.equal(geometry.neighbour(r, 'zz', 'left'), null);
});

test('neighbour ignores rectangles that only overlap or share a start edge', () => {
    const r = {
        me: {x: 100, y: 100, width: 200, height: 200},
        inside: {x: 150, y: 200, width: 100, height: 50},
        wide: {x: 100, y: 400, width: 600, height: 100},
        same: {x: 100, y: 100, width: 200, height: 200},
        far: {x: 500, y: 120, width: 100, height: 100}
    };
    assert.equal(geometry.neighbour(r, 'me', 'right'), 'far');
    assert.equal(geometry.neighbour(r, 'me', 'down'), 'wide');
    assert.equal(geometry.neighbour(r, 'me', 'left'), null);
    delete r.wide;
    assert.equal(geometry.neighbour(r, 'me', 'down'), null);
});

test('neighbour chooses the nearest centre and the first key on a tie', () => {
    const r = {
        me: {x: 0, y: 300, width: 100, height: 100},
        near: {x: 200, y: 300, width: 100, height: 100},
        far: {x: 600, y: 300, width: 100, height: 100}
    };
    assert.equal(geometry.neighbour(r, 'me', 'right'), 'near');
    const tie = {
        me: {x: 0, y: 0, width: 100, height: 400},
        upper: {x: 200, y: 0, width: 100, height: 100},
        lower: {x: 200, y: 300, width: 100, height: 100}
    };
    assert.equal(geometry.neighbour(tie, 'me', 'right'), 'upper');
});

test('resizeBy moves the separator so the window grows or shrinks by the delta', () => {
    const grown = rects(tree.resizeBy(t, area, gaps, 'a', 'h', 76, 100));
    assert.deepEqual(grown.a, {x: 0, y: 0, width: 571, height: 800});
    assert.deepEqual(grown.b, {x: 581, y: 0, width: 419, height: 395});
    const shrunk = rects(tree.resizeBy(t, area, gaps, 'a', 'h', -76, 100));
    assert.equal(shrunk.a.width, 419);
    const fromStack = rects(tree.resizeBy(t, area, gaps, 'b', 'h', 76, 100));
    assert.deepEqual(fromStack.a, {x: 0, y: 0, width: 419, height: 800});
    assert.deepEqual(fromStack.b, {x: 429, y: 0, width: 571, height: 395});
    assert.deepEqual(fromStack.c, {x: 429, y: 405, width: 571, height: 395});
});

test('resizeBy on the vertical axis uses the nearest vertical split', () => {
    const lower = rects(tree.resizeBy(t, area, gaps, 'b', 'v', 76, 100));
    assert.equal(lower.b.height, 471);
    assert.deepEqual(lower.c, {x: 505, y: 481, width: 495, height: 319});
    const upper = rects(tree.resizeBy(t, area, gaps, 'c', 'v', 76, 100));
    assert.equal(upper.c.y, 329);
    assert.equal(upper.c.height, 471);
    assert.equal(upper.b.height, 319);
});

test('resizeBy is null without an ancestor on that axis and keeps the minimum pane', () => {
    assert.equal(tree.resizeBy(t, area, gaps, 'a', 'v', 76, 100), null);
    assert.equal(tree.resizeBy(tree.monocle(['a', 'b']), area, gaps, 'a', 'h', 76, 100), null);
    assert.equal(tree.resizeBy(t, area, gaps, 'missing', 'h', 76, 100), null);
    const squeezed = rects(tree.resizeBy(t, area, gaps, 'a', 'h', -5000, 100));
    assert.equal(squeezed.a.width, 100);
    const stretched = rects(tree.resizeBy(t, area, gaps, 'a', 'h', 5000, 100));
    assert.equal(stretched.b.width, 100);
});

test('resizeBy does not change the input tree', () => {
    const before = JSON.stringify(t);
    tree.resizeBy(t, area, gaps, 'a', 'h', 76, 100);
    assert.equal(JSON.stringify(t), before);
});

test('clampMasterCount stays between 1 and windows - 1', () => {
    assert.equal(tree.clampMasterCount(1, 1, 5), 2);
    assert.equal(tree.clampMasterCount(4, 1, 5), 4);
    assert.equal(tree.clampMasterCount(1, -1, 5), 1);
    assert.equal(tree.clampMasterCount(3, -1, 5), 2);
    assert.equal(tree.clampMasterCount(1, 1, 2), 1);
    assert.equal(tree.clampMasterCount(1, 1, 1), 1);
    assert.equal(tree.clampMasterCount(undefined, 0, 0), 1);
    assert.equal(tree.clampMasterCount(9, 0, 4), 3);
});

test('masterStack with two masters stacks them left and the rest right', () => {
    const r = tree.layout(tree.masterStack(['a', 'b', 'c', 'd'], 2, 0.5), area, gaps);
    assert.deepEqual(r.a, {x: 0, y: 0, width: 495, height: 395});
    assert.deepEqual(r.b, {x: 0, y: 405, width: 495, height: 395});
    assert.deepEqual(r.c, {x: 505, y: 0, width: 495, height: 395});
    assert.deepEqual(r.d, {x: 505, y: 405, width: 495, height: 395});
});

test('resizeFloat changes the size by half per side and clamps inside the area', () => {
    const rect = {x: 400, y: 300, width: 300, height: 200};
    assert.deepEqual(geometry.resizeFloat(rect, area, 'h', 76, 150),
        {x: 362, y: 300, width: 376, height: 200});
    assert.deepEqual(geometry.resizeFloat(rect, area, 'v', -40, 150),
        {x: 400, y: 320, width: 300, height: 160});
    assert.deepEqual(geometry.resizeFloat(rect, area, 'h', -1000, 150),
        {x: 475, y: 300, width: 150, height: 200});
    assert.deepEqual(geometry.resizeFloat({x: 10, y: 0, width: 300, height: 200}, area,
        'h', 76, 150), {x: 0, y: 0, width: 376, height: 200});
    assert.deepEqual(geometry.resizeFloat({x: 800, y: 0, width: 200, height: 200}, area,
        'h', 1000, 150), {x: 0, y: 0, width: 1000, height: 200});
});

test('resizeFloat never moves a window the wrong way past the limits', () => {
    const small = {x: 100, y: 100, width: 100, height: 100};
    assert.deepEqual(geometry.resizeFloat(small, area, 'h', -76, 150), small);
    const huge = {x: 0, y: 0, width: 1200, height: 100};
    assert.equal(geometry.resizeFloat(huge, area, 'h', 76, 150).width, 1200);
});

test('focusRatioAfterGrow turns pixels into a ratio step of the available width', () => {
    const ratio = stage.focusRatioAfterGrow(area, gaps, 0.5, 100);
    assert.ok(Math.abs(ratio - (0.5 + 100 / 980)) < 1e-12);
    assert.equal(stage.focusRatioAfterGrow({x: 0, y: 0, width: 0, height: 5}, gaps, 0.5, 1), null);
});
