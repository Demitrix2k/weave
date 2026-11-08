const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('..');
const {mulberry32, integer, freezeDeep} = require('./helpers');

const s = api.scroll;
const area = {x: 0, y: 0, width: 1200, height: 801};
const gaps = {inner: 8, outer: 8};
const ids = ['a', 'b', 'c', 'd', 'e'];

test('scroll is exported with a normalized immutable state', () => {
    assert.deepEqual(s.create(), {axis: 'h', visible: 2, offset: 0,
        box: {w: 0.88, h: 0.56}, slotLast: {}});
    assert.deepEqual(s.create({axis: 'v', visible: 2.9, offset: 3.8}),
        {axis: 'v', visible: 2, offset: 3, box: {w: 0.88, h: 0.56}, slotLast: {}});
    assert.deepEqual(s.create({axis: 'x', visible: 0, offset: -1}),
        {axis: 'h', visible: 1, offset: 0, box: {w: 0.88, h: 0.56}, slotLast: {}});
    const state = freezeDeep({axis: 'h', visible: 2, offset: 0});
    assert.deepEqual(s.toggleAxis(state), {axis: 'v', visible: 2, offset: 0,
        box: {w: 0.88, h: 0.56}, slotLast: {}});
    assert.deepEqual(state, {axis: 'h', visible: 2, offset: 0});
});

test('page clamps to a full final page and parks the rest in order', () => {
    assert.equal(s.clampOffset(5, 2, 99), 3);
    assert.deepEqual(s.page(ids, {visible: 2, offset: 99}), {
        visible: ['d', 'e'], parked: ['a', 'b', 'c'], offset: 3,
        from: 4, to: 5, count: 5
    });
    assert.deepEqual(s.page([], {visible: 2, offset: 4}), {
        visible: [], parked: [], offset: 0, from: 0, to: 0, count: 0
    });
});

test('horizontal and vertical layouts have exact gap geometry', () => {
    const expectedH = {
        a: {x: 8, y: 8, width: 588, height: 785},
        b: {x: 604, y: 8, width: 588, height: 785}
    };
    const expectedV = {
        a: {x: 8, y: 8, width: 1184, height: 389},
        b: {x: 8, y: 405, width: 1184, height: 388}
    };
    const full = s.create({visible: 1, box: {w: 1, h: 1}});
    assert.deepEqual(s.layout(ids, full, area, gaps).rects,
        {a: {x: 8, y: 8, width: 1184, height: 785}});
    assert.deepEqual(s.layout(ids, s.create({visible: 2, box: {w: 1, h: 1}}), area, gaps,
        {ratio: 0.5}).rects, expectedH);
    assert.deepEqual(s.layout(ids, s.create({axis: 'v', visible: 2, box: {w: 1, h: 1}}), area, gaps,
        {ratio: 0.5}).rects, expectedV);
    const three = s.layout(ids, s.create({visible: 3, box: {w: 1, h: 1}}), area, gaps, {ratio: 0.1}).rects;
    assert.deepEqual(three, {
        a: {x: 8, y: 8, width: 389, height: 785},
        b: {x: 405, y: 8, width: 389, height: 785},
        c: {x: 802, y: 8, width: 390, height: 785}
    });
    assert.deepEqual(s.layout(ids, s.create({visible: 3, offset: 4}), area, gaps).visible,
        ['c', 'd', 'e']);
});

test('scrollBy supports page and window movement with optional wrap', () => {
    const state = s.create({visible: 2});
    assert.equal(s.scrollBy(ids, state, 1).offset, 2);
    assert.equal(s.scrollBy(ids, state, 9).offset, 3);
    assert.equal(s.scrollBy(ids, state, -1).offset, 0);
    assert.equal(s.scrollBy(ids, state, 1, {step: 'window'}).offset, 1);
    assert.equal(s.scrollBy(ids, s.create({visible: 2, offset: 3}), 1,
        {step: 'window', wrap: true}).offset, 0);
    assert.equal(s.scrollBy(ids, state, -1, {wrap: true}).offset, 3);
});

test('reveal moves the smallest amount and setVisible re-clamps', () => {
    const state = s.create({visible: 2, offset: 2});
    assert.equal(s.reveal(ids, state, 'a').offset, 0);
    assert.equal(s.reveal(ids, state, 'c').offset, 2);
    assert.equal(s.reveal(ids, state, 'e').offset, 3);
    assert.strictEqual(s.reveal(ids, state, 'missing'), state);
    assert.deepEqual(s.setVisible(ids, state, 99), {axis: 'h', visible: 5, offset: 0,
        box: {w: 0.88, h: 0.56}, slotLast: {}});
    assert.deepEqual(s.setVisible([], state, 0), {axis: 'h', visible: 1, offset: 0,
        box: {w: 0.88, h: 0.56}, slotLast: {}});
});

test('box is clamped, centered, and resizable', () => {
    const state = s.create({box: {w: 0.1, h: 2}});
    assert.deepEqual(state.box, {w: 0.3, h: 1});
    assert.deepEqual(s.resizeBox(state, 0.2, -0.2).box, {w: 0.5, h: 0.8});
    assert.deepEqual(s.layout(['a', 'b'], s.create(), area, gaps).rects,
        {a: {x: 79, y: 181, width: 517, height: 440},
            b: {x: 604, y: 181, width: 517, height: 440}});
});

test('cycleSlot replaces a visible slot with the next or previous parked window', () => {
    const state = s.create({visible: 2});
    let result = s.cycleSlot(['a', 'b', 'c', 'd'], state, 'b', 1);
    assert.deepEqual(result.ids, ['a', 'c', 'd', 'b']);
    result = s.cycleSlot(result.ids, result.state, 'c', -1);
    assert.deepEqual(result.ids, ['a', 'b', 'c', 'd']);
    assert.deepEqual(s.cycleSlot(['a', 'b', 'c'], s.create({visible: 1}), 'a', 1).ids,
        ['b', 'c', 'a']);
    assert.deepEqual(s.cycleSlot(['a', 'b', 'c'], s.create({visible: 1}), 'a', -1).ids,
        ['c', 'a', 'b']);
    assert.deepEqual(s.cycleSlot(['a', 'b', 'c', 'd', 'e'],
        s.create({axis: 'v', visible: 3}), 'b', 1).ids,
        ['a', 'd', 'c', 'e', 'b']);
    assert.deepEqual(s.cycleSlot(['a', 'b'], state, 'a', 1).ids, ['a', 'b']);
});

test('cycleSlot walks through every window instead of toggling between two', () => {
    const state = s.create({visible: 2});
    let ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const shown = [];
    for (let press = 0; press < 5; press++) {
        ids = s.cycleSlot(ids, state, ids[0], 1).ids;
        shown.push(ids[0]);
        assert.equal(ids[1], 'b');
    }
    assert.deepEqual(shown, ['c', 'd', 'e', 'f', 'a']);
    for (let press = 0; press < 5; press++) {
        ids = s.cycleSlot(ids, state, ids[0], -1).ids;
    }
    assert.equal(ids[0], 'a');
    assert.equal(ids.slice().sort().join(''), 'abcdef');
});

test('layout and navigation do not mutate frozen state', () => {
    const state = freezeDeep({axis: 'h', visible: 2, offset: 99});
    const before = JSON.stringify(state);
    s.layout(ids, state, area, gaps);
    s.scrollBy(ids, state, 1);
    s.reveal(ids, state, 'a');
    s.setVisible(ids, state, 3);
    assert.equal(JSON.stringify(state), before);
});

test('property: visible and parked partition IDs and rectangles do not overlap', () => {
    const random = mulberry32(0x5eed);
    for (let run = 0; run < 100; run++) {
        const count = integer(random, 0, 12);
        const list = Array.from({length: count}, (_, i) => 'w' + i);
        const state = s.create({axis: random() < 0.5 ? 'h' : 'v',
            visible: integer(random, 1, 6), offset: integer(random, 0, 20)});
        const result = s.layout(list, state, area, gaps);
        assert.deepEqual(result.visible.concat(result.parked).sort(), list.sort());
        const rects = Object.values(result.rects);
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                assert.ok(Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
                    Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y));
            }
        }
    }
});
