const test = require('node:test');
const assert = require('node:assert/strict');
const {tree} = require('../index.js');

test('default window limits per layout', () => {
    const expected = {master: 8, columns: 6, rows: 5, spiral: 6, hstack: 8, rmaster: 8,
        grid: 9, ultrawide: 9, stage: 13, scroll: 20};
    Object.keys(expected).forEach(name => assert.equal(tree.maxWindows(name), expected[name]));
    assert.equal(tree.maxWindows('monocle'), Infinity);
    assert.equal(tree.maxWindows('nope'), Infinity);
});

test('limitSplit floats the newest arrivals and never the kept window', () => {
    const ids = ['a', 'b', 'c', 'd'];
    assert.deepEqual(tree.limitSplit(ids, ids, 4, null), {tiled: ids, floated: []});
    assert.deepEqual(tree.limitSplit(ids, ids, 2, null),
        {tiled: ['a', 'b'], floated: ['d', 'c']});
    assert.deepEqual(tree.limitSplit(ids, ids, 2, 'd'),
        {tiled: ['a', 'd'], floated: ['c', 'b']});
    assert.deepEqual(tree.limitSplit(['b', 'a', 'c'], ['a', 'b', 'c'], 2, null),
        {tiled: ['b', 'a'], floated: ['c']});
});

const area = {x: 0, y: 0, width: 2560, height: 1440};
const gaps = {inner: 8, outer: 8};

test('fit keeps everything that fits', () => {
    const mins = {a: {width: 250, height: 341}, b: {width: 250, height: 341}};
    assert.deepEqual(tree.fit(['a', 'b'], mins, area, gaps, 'rows', {}),
        {tiled: ['a', 'b'], floated: []});
});

test('fit floats the newest windows in rows when 1440p cannot hold 5 of height 341', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const mins = {};
    ids.forEach(id => { mins[id] = {width: 250, height: 341}; });
    const result = tree.fit(ids, mins, area, gaps, 'rows', {arrival: ids});
    assert.deepEqual(result, {tiled: ['a', 'b', 'c', 'd'], floated: ['e']});
    const four = tree.layout(tree.generate('rows', result.tiled), area, gaps);
    result.tiled.forEach(id => assert.ok(four[id].height >= 341));
});

test('fit only floats windows when needed and spares the kept one', () => {
    const ids = ['a', 'b', 'c'];
    const tall = {width: 0, height: 700};
    const mins = {a: tall, b: tall, c: tall};
    const result = tree.fit(ids, mins, area, gaps, 'rows', {arrival: ids, keep: 'c'});
    assert.deepEqual(result, {tiled: ['a', 'c'], floated: ['b']});
});

test('fit floats others when only the kept window is too small', () => {
    const ids = ['a', 'b', 'c'];
    const result = tree.fit(ids, {c: {width: 0, height: 700}}, area, gaps, 'rows',
        {arrival: ids, keep: 'c'});
    assert.deepEqual(result.tiled, ['a', 'c']);
    assert.deepEqual(tree.fit(['a'], {a: {width: 9999, height: 9999}}, area, gaps, 'rows',
        {}), {tiled: ['a'], floated: []});
});

test('fit handles the master count and missing sizes', () => {
    const ids = ['a', 'b', 'c'];
    const result = tree.fit(ids, {b: {width: 5000, height: 0}}, area, gaps, 'master',
        {nMaster: 1, masterRatio: 0.6, arrival: ids});
    assert.deepEqual(result, {tiled: ['a', 'c'], floated: ['b']});
    assert.deepEqual(tree.fit(ids, {}, area, gaps, 'monocle'), {tiled: ids, floated: []});
});
