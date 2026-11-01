const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../index');
const {mulberry32, integer, caseMessage} = require('./helpers');

function randomTree(random, ids) {
    function build(list) {
        if (list.length === 1) {
            return {type: 'leaf', windows: [list[0]], active: 0};
        }
        const middle = integer(random, 1, list.length - 1);
        return {
            type: 'split',
            dir: random() < 0.5 ? 'h' : 'v',
            ratio: 0.35 + random() * 0.3,
            a: build(list.slice(0, middle)),
            b: build(list.slice(middle))
        };
    }
    return build(ids);
}

function nearRect(actual, expected, message) {
    ['x', 'y', 'width', 'height'].forEach(key => {
        assert.ok(Math.abs(actual[key] - expected[key]) <= 1,
            message + ' key=' + key + ' expected=' + JSON.stringify(expected) +
            ' actual=' + JSON.stringify(actual));
    });
}

test('infer reproduces seeded guillotine layouts in 240 cases', () => {
    const seed = 0x1F3A2B;
    const random = mulberry32(seed);
    for (let iteration = 0; iteration < 240; iteration++) {
        const count = integer(random, 1, 6);
        const ids = Array.from({length: count}, (_, index) => 'w' + index);
        const area = api.geometry.rect(integer(random, -100, 100),
            integer(random, -100, 100), integer(random, 900, 1200) * 2 + 1,
            integer(random, 600, 800) * 2 + 1);
        const gap = integer(random, 0, 24);
        const tree = randomTree(random, ids);
        const rects = api.tree.layout(tree, area, {inner: gap});
        const inferred = api.tree.infer(rects, area, 2);
        const message = caseMessage(seed, {iteration, count, area, gap, tree});
        assert.ok(inferred, message);
        if (count > 1) {
            assert.ok(Math.abs(inferred.gap - gap) <= 2, message);
        }
        const reproduced = api.tree.layout(inferred.tree, area,
            {inner: inferred.gap});
        ids.forEach(id => nearRect(reproduced[id], rects[id], message));
    }
});

test('infer rejects shifted partitions, overlap, and preserves input', () => {
    const area = {x: 0, y: 0, width: 101, height: 81};
    const original = {
        a: {x: 0, y: 0, width: 50, height: 40},
        b: {x: 54, y: 0, width: 47, height: 40},
        c: {x: 0, y: 44, width: 101, height: 37}
    };
    const snapshot = JSON.stringify(original);
    const inferred = api.tree.infer(original, area);
    assert.ok(inferred);
    assert.equal(JSON.stringify(original), snapshot);
    assert.equal(api.tree.infer({
        a: original.a,
        b: original.b,
        c: {x: 5, y: 44, width: 96, height: 37}
    }, area), null);
    assert.equal(api.tree.infer({
        a: original.a,
        b: {x: 45, y: 0, width: 51, height: 40},
        c: original.c
    }, area), null);
});
