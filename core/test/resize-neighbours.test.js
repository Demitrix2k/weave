const test = require('node:test');
const assert = require('node:assert/strict');
const {geometry} = require('../geometry');

const area = {x: 0, y: 0, width: 1200, height: 801};
const gaps = {inner: 8, outer: 8};
const r = (x, y, width, height) => ({x, y, width, height});
const other = (id, rectangle, movable) => ({id, rect: rectangle, movable: movable !== false});
const resize = (rectangle, others, axis, delta) =>
    geometry.resizeNeighbours(rectangle, others, area, gaps, axis, delta);

test('free window: only the sides away from the work area edge move', () => {
    const grown = resize(r(0, 0, 800, 601), [], 'h', 76);
    assert.deepEqual(grown, {rect: r(0, 0, 876, 601), moves: []});
    assert.deepEqual(resize(r(100, 100, 400, 300), [], 'h', 76).rect, r(24, 100, 552, 300));
});

test('the step on the short axis scales with the aspect ratio', () => {
    assert.deepEqual(resize(r(100, 100, 400, 300), [], 'v', 76).rect, r(100, 49, 400, 401));
});

test('a neighbour sharing the right edge moves together with it', () => {
    const b = other('b', r(516, 8, 676, 400));
    const result = resize(r(8, 8, 500, 400), [b], 'h', 76);
    assert.deepEqual(result.rect, r(8, 8, 576, 400));
    assert.deepEqual(result.moves, [{id: 'b', rect: r(592, 8, 600, 400)}]);
});

test('a neighbour sharing the left edge moves together with it', () => {
    const b = other('b', r(8, 8, 500, 400));
    const result = resize(r(516, 8, 676, 400), [b], 'h', 76);
    assert.deepEqual(result.rect, r(440, 8, 752, 400));
    assert.deepEqual(result.moves, [{id: 'b', rect: r(8, 8, 424, 400)}]);
});

test('every neighbour along a side follows', () => {
    const top = other('t', r(516, 8, 676, 200));
    const bottom = other('u', r(516, 216, 676, 192));
    const result = resize(r(8, 8, 500, 400), [top, bottom], 'h', 76);
    assert.deepEqual(result.moves, [
        {id: 't', rect: r(592, 8, 600, 200)},
        {id: 'u', rect: r(592, 216, 600, 192)}
    ]);
});

test('neighbours above and below move on the height axis', () => {
    const below = other('d', r(8, 416, 600, 377));
    const result = resize(r(8, 8, 600, 400), [below], 'v', 76);
    assert.deepEqual(result.rect, r(8, 8, 600, 451));
    assert.deepEqual(result.moves, [{id: 'd', rect: r(8, 467, 600, 326)}]);
});

test('shrink mirrors grow and hands the space back', () => {
    const b = other('b', r(516, 8, 676, 400));
    const grown = resize(r(8, 8, 500, 400), [b], 'h', 76);
    const back = resize(grown.rect, [other('b', grown.moves[0].rect)], 'h', -76);
    assert.deepEqual(back.rect, r(8, 8, 500, 400));
    assert.deepEqual(back.moves, [{id: 'b', rect: r(516, 8, 676, 400)}]);
});

test('growing stops when the neighbour would get narrower than 200 px', () => {
    const b = other('b', r(516, 8, 250, 400));
    const result = resize(r(8, 8, 500, 400), [b], 'h', 76);
    assert.deepEqual(result.rect, r(8, 8, 550, 400));
    assert.deepEqual(result.moves, [{id: 'b', rect: r(566, 8, 200, 400)}]);
    const stuck = resize(result.rect, [other('b', result.moves[0].rect)], 'h', 76);
    assert.deepEqual(stuck.rect, result.rect);
});

test('a free side stops at the next window, keeping the inner gap', () => {
    const wall = other('w', r(358, 8, 100, 300));
    assert.deepEqual(resize(r(8, 8, 300, 300), [wall], 'h', 76).rect, r(8, 8, 342, 300));
    const far = other('w', r(500, 8, 100, 300));
    assert.deepEqual(resize(r(8, 8, 300, 300), [far], 'h', 76).rect, r(8, 8, 376, 300));
});

test('a window filling the work area cannot grow and shrinks from both sides', () => {
    const full = r(8, 8, 1184, 785);
    assert.deepEqual(resize(full, [], 'both', 76).rect, full);
    assert.deepEqual(resize(full, [], 'h', -76).rect, r(84, 8, 1032, 785));
});

test('the minimum size refuses a step that would go below 200x150', () => {
    const small = r(100, 100, 250, 300);
    assert.deepEqual(resize(small, [], 'h', -76).rect, small);
    assert.deepEqual(resize(r(100, 100, 300, 160), [], 'v', -76).rect, r(100, 100, 300, 160));
});

test('both dimensions at once', () => {
    const result = resize(r(100, 100, 400, 300), [], 'both', 76);
    assert.deepEqual(result.rect, r(24, 49, 552, 401));
    assert.deepEqual(resize(result.rect, [], 'both', -76).rect, r(100, 100, 400, 300));
});

test('a window that must not move blocks the side instead of following', () => {
    const fixed = other('t', r(516, 8, 676, 400), false);
    const result = resize(r(8, 8, 500, 400), [fixed], 'h', 76);
    assert.deepEqual(result, {rect: r(8, 8, 500, 400), moves: []});
    assert.deepEqual(resize(r(100, 8, 408, 400), [fixed], 'h', -76).moves, []);
});

test('neighbours that do not overlap along the side are ignored', () => {
    const lower = other('l', r(516, 500, 676, 200));
    const result = resize(r(8, 8, 500, 400), [lower], 'h', 76);
    assert.deepEqual(result.moves, []);
    assert.deepEqual(result.rect, r(8, 8, 576, 400));
});

test('fill: an empty work area is filled inside the outer gap', () => {
    assert.deepEqual(geometry.fillRect([], area, gaps), r(8, 8, 1184, 785));
});

test('fill: the free column between two windows', () => {
    const left = r(8, 8, 400, 785);
    const right = r(800, 8, 392, 785);
    assert.deepEqual(geometry.fillRect([left, right], area, gaps), r(416, 8, 376, 785));
});

test('fill: the larger of two free areas wins', () => {
    const tall = r(8, 8, 300, 785);
    const low = r(316, 400, 876, 393);
    assert.deepEqual(geometry.fillRect([tall, low], area, gaps), r(316, 8, 876, 384));
});

test('fill: equal areas pick the leftmost, then the topmost', () => {
    const middle = r(400, 8, 400, 785);
    assert.deepEqual(geometry.fillRect([middle], area, gaps), r(8, 8, 384, 785));
    const band = r(8, 300, 1184, 201);
    assert.deepEqual(geometry.fillRect([band], area, gaps), r(8, 8, 1184, 284));
});

test('fill: nothing free gives null; windows outside the work area are ignored', () => {
    assert.equal(geometry.fillRect([r(0, 0, 1200, 801)], area, gaps), null);
    assert.deepEqual(geometry.fillRect([r(2000, 0, 100, 100)], area, gaps), r(8, 8, 1184, 785));
});
