const test = require('node:test');
const assert = require('node:assert/strict');
const {tree} = require('../tree');

const area = {x: 0, y: 0, width: 1000, height: 800};
const gaps = {inner: 10, outer: 0};
// a | (b over c)
const t = tree.masterStack(['a', 'b', 'c'], 1, 0.5);

test('edgeForSide finds the shared separator from both panes', () => {
    assert.deepEqual(tree.edgeForSide(t, area, gaps, 'a', 'right'), []);
    assert.deepEqual(tree.edgeForSide(t, area, gaps, 'b', 'left'), []);
    assert.deepEqual(tree.edgeForSide(t, area, gaps, 'c', 'left'), []);
});

test('edgeForSide picks the nearest matching ancestor on the vertical axis', () => {
    assert.deepEqual(tree.edgeForSide(t, area, gaps, 'b', 'bottom'), ['b']);
    assert.deepEqual(tree.edgeForSide(t, area, gaps, 'c', 'top'), ['b']);
});

test('edgeForSide returns null on the work-area border or for unknown input', () => {
    assert.equal(tree.edgeForSide(t, area, gaps, 'a', 'left'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'b', 'right'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'b', 'top'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'c', 'bottom'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'a', 'bottom'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'zz', 'left'), null);
    assert.equal(tree.edgeForSide(null, area, gaps, 'a', 'left'), null);
    assert.equal(tree.edgeForSide(t, area, gaps, 'a', 'diagonal'), null);
});

test('edgeForSide skips same-axis splits where the window is on the wrong side', () => {
    const nested = tree.columns(['x', 'y', 'z']);
    assert.deepEqual(tree.edgeForSide(nested, area, gaps, 'y', 'left'), []);
    assert.deepEqual(tree.edgeForSide(nested, area, gaps, 'y', 'right'), ['b']);
    assert.deepEqual(tree.edgeForSide(nested, area, gaps, 'z', 'left'), ['b']);
});

test('ratioForSide maps a coordinate to a ratio and clamps to the minimum pane', () => {
    assert.equal(tree.ratioForSide(t, area, gaps, [], 'right', 495), 0.5);
    assert.equal(tree.ratioForSide(t, area, gaps, [], 'left', 505), 0.5);
    assert.equal(tree.ratioForSide(t, area, gaps, [], 'right', 5), 100 / 990);
    assert.equal(tree.ratioForSide(t, area, gaps, [], 'right', 999), 1 - 100 / 990);
    assert.equal(tree.ratioForSide(t, area, gaps, ['b'], 'bottom', 395), 0.5);
    assert.equal(tree.ratioForSide(t, area, gaps, ['a'], 'right', 10), null);
});
