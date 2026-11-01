const test = require('node:test');
const assert = require('node:assert/strict');
const {tree, arrangement} = require('../index.js');

test('layout names: valid, reserved and cycling in both directions', () => {
    assert.deepEqual(tree.LAYOUTS, ['master', 'columns', 'monocle', 'spiral']);
    assert.deepEqual(tree.RESERVED_LAYOUTS, ['stage']);
    assert.equal(tree.validLayout('spiral'), true);
    assert.equal(tree.validLayout('stage'), false);
    assert.equal(tree.validLayout('nope'), false);
    assert.equal(tree.cycleLayout('master', 1), 'columns');
    assert.equal(tree.cycleLayout('spiral', 1), 'master');
    assert.equal(tree.cycleLayout('master', -1), 'spiral');
    assert.equal(tree.cycleLayout('stage', 1), 'columns');
});

test('generate maps names to generators and falls back to master-stack', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(tree.generate('master', list, {masterRatio: 0.5}),
        tree.masterStack(list, 1, 0.5));
    assert.deepEqual(tree.generate('columns', list), tree.columns(list));
    assert.deepEqual(tree.generate('monocle', list), tree.monocle(list));
    assert.deepEqual(tree.generate('spiral', list), tree.spiral(list));
    assert.deepEqual(tree.generate('stage', list), tree.masterStack(list, 1, undefined));
    assert.equal(tree.generate('columns', []), null);
});

test('leafOrder lists windows first child before second', () => {
    assert.deepEqual(tree.leafOrder(tree.masterStack(['a', 'b', 'c'], 1, 0.6)), ['a', 'b', 'c']);
    assert.deepEqual(tree.leafOrder(null), []);
    const swapped = tree.swap(tree.columns(['a', 'b', 'c']), 'a', 'c');
    assert.deepEqual(tree.leafOrder(swapped), ['c', 'b', 'a']);
});

test('pickWindows puts the active window first, then recency, then arrival order', () => {
    const entries = [
        {id: 'a', tick: 0, seq: 1},
        {id: 'b', tick: 5, seq: 2},
        {id: 'c', tick: 9, seq: 3},
        {id: 'd', tick: 0, seq: 0},
        {id: 'e', tick: 7, seq: 4}
    ];
    assert.deepEqual(arrangement.pickWindows('b', entries, 3), ['b', 'c', 'e']);
    assert.deepEqual(arrangement.pickWindows('a', entries, 5), ['a', 'c', 'e', 'b', 'd']);
    assert.deepEqual(arrangement.pickWindows('c', entries, 9), ['c', 'e', 'b', 'd', 'a']);
    assert.deepEqual(arrangement.pickWindows('zz', entries, 2), ['c', 'e']);
    assert.deepEqual(arrangement.pickWindows('a', entries, 0), []);
    assert.equal(Object.isFrozen(entries), false);
});

test('cycleName wraps and starts sensibly from an unknown name', () => {
    const names = ['x', 'y', 'z'];
    assert.equal(arrangement.cycleName(names, 'x', 1), 'y');
    assert.equal(arrangement.cycleName(names, 'z', 1), 'x');
    assert.equal(arrangement.cycleName(names, 'x', -1), 'z');
    assert.equal(arrangement.cycleName(names, null, 1), 'x');
    assert.equal(arrangement.cycleName(names, null, -1), 'z');
    assert.equal(arrangement.cycleName([], 'x', 1), null);
});
