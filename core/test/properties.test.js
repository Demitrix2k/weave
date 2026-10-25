const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../index');
const templates = require('../templates.json');
const {mulberry32, integer, caseMessage, freezeDeep} = require('./helpers');
const g = api.geometry;
const t = api.tree;
const s = api.stage;
const SEED = 0xC0FFEE;

function randomArea(random) {
    const width = integer(random, 200, 1200) * 2 + 1;
    const height = integer(random, 150, 700) * 2 + 1;
    return g.rect(integer(random, -500, 500), integer(random, -300, 300),
        width, height);
}

function randomTree(random, count) {
    const ids = Array.from({length: count}, (_, index) => 'w' + index);
    function build(start, end) {
        if (end - start === 1) {
            return {type: 'leaf', windows: [ids[start]], active: 0};
        }
        const middle = start + Math.floor((end - start) / 2);
        return {
            type: 'split',
            dir: random() < 0.5 ? 'h' : 'v',
            ratio: 0.4 + random() * 0.2,
            a: build(start, middle),
            b: build(middle, end)
        };
    }
    return {tree: count ? build(0, count) : null, ids};
}

function assertTreeGeometry(node, area, gap, actualRects, input) {
    if (node.type === 'leaf') {
        node.windows.forEach(id => {
            const rect = actualRects[id];
            assert.ok(rect, caseMessage(SEED, input));
            assert.ok(rect.x >= area.x && rect.y >= area.y, caseMessage(SEED, input));
            assert.ok(rect.x + rect.width <= area.x + area.width,
                caseMessage(SEED, input));
            assert.ok(rect.y + rect.height <= area.y + area.height,
                caseMessage(SEED, input));
            assert.ok(rect.width > 0 && rect.height > 0, caseMessage(SEED, input));
        });
        return;
    }
    const horizontal = node.dir === 'h';
    const parts = horizontal
        ? g.splitH(area, node.ratio, gap)
        : g.splitV(area, node.ratio, gap);
    const [first, second] = parts;
    if (horizontal) {
        assert.equal(second.x - first.x - first.width, Math.min(gap, area.width),
            caseMessage(SEED, input));
        assert.equal(first.width + second.width + Math.min(gap, area.width),
            area.width, caseMessage(SEED, input));
    } else {
        assert.equal(second.y - first.y - first.height, Math.min(gap, area.height),
            caseMessage(SEED, input));
        assert.equal(first.height + second.height + Math.min(gap, area.height),
            area.height, caseMessage(SEED, input));
    }
    assertTreeGeometry(node.a, first, gap, actualRects, input);
    assertTreeGeometry(node.b, second, gap, actualRects, input);
}

function noOverlap(rects, message) {
    const list = Object.values(rects);
    for (let first = 0; first < list.length; first++) {
        for (let second = first + 1; second < list.length; second++) {
            const a = list[first];
            const b = list[second];
            assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x ||
                a.y + a.height <= b.y || b.y + b.height <= a.y, message);
        }
    }
}

test('tree layout conserves bounds, gaps, pixels, and windows in 240 seeded cases', () => {
    const random = mulberry32(SEED);
    for (let iteration = 0; iteration < 240; iteration++) {
        const count = integer(random, 1, 12);
        const {tree, ids} = randomTree(random, count);
        const area = g.rect(integer(random, -500, 500), integer(random, -300, 300),
            integer(random, 800, 1500) * 2 + 1,
            integer(random, 700, 1100) * 2 + 1);
        const gap = integer(random, 0, 24);
        const input = {iteration, count, area, gap, tree};
        const rects = t.layout(tree, area, {inner: gap});
        assert.deepEqual(Object.keys(rects).sort(), ids.slice().sort(),
            caseMessage(SEED, input));
        assertTreeGeometry(tree, g.workRect(area, {}), gap, rects, input);
        noOverlap(rects, caseMessage(SEED, input));
    }
});

test('tree operations preserve input and satisfy inverse properties in 240 cases', () => {
    const random = mulberry32(SEED + 1);
    for (let iteration = 0; iteration < 240; iteration++) {
        const count = integer(random, 2, 12);
        const {tree} = randomTree(random, count);
        const ids = Object.keys(t.layout(tree, g.rect(0, 0, 2000, 1200), {}));
        const id = ids[integer(random, 0, ids.length - 1)];
        const target = ids.find(value => value !== id);
        const input = freezeDeep(tree);
        const addedId = 'added-' + iteration;
        const inserted = t.insert(input, addedId, target, 'center');
        const removed = t.remove(inserted, addedId);
        assert.deepEqual(removed, input, caseMessage(SEED + 1, {iteration, id, target}));
        assert.deepEqual(t.swap(t.swap(input, id, target), id, target), input,
            caseMessage(SEED + 1, {iteration, id, target}));
        for (const side of ['left', 'right', 'top', 'bottom']) {
            const docked = t.dockToSide(input, id, side);
            assert.deepEqual(Object.keys(t.layout(docked, g.rect(0, 0, 2000, 1200), {})).sort(),
                ids.slice().sort(), caseMessage(SEED + 1, {iteration, id, side}));
            const rootSplit = docked;
            const firstIds = Object.keys(t.layout(rootSplit.a, g.rect(0, 0, 2000, 1200), {}));
            if (side === 'left' || side === 'top') {
                assert.ok(firstIds.includes(id), caseMessage(SEED + 1, {iteration, id, side}));
            } else {
                const secondIds = Object.keys(t.layout(rootSplit.b, g.rect(0, 0, 2000, 1200), {}));
                assert.ok(secondIds.includes(id), caseMessage(SEED + 1, {iteration, id, side}));
            }
        }
        assert.deepEqual(input, tree, caseMessage(SEED + 1, {iteration, input}));
    }
});

test('hit testing and split-edge lookup match geometry in 240 seeded cases', () => {
    const random = mulberry32(SEED + 2);
    for (let iteration = 0; iteration < 240; iteration++) {
        const {tree} = randomTree(random, integer(random, 2, 8));
        const area = g.rect(0, 0, 1200, 800);
        const rects = t.layout(tree, area, {});
        const id = Object.keys(rects)[integer(random, 0, Object.keys(rects).length - 1)];
        const rect = rects[id];
        const centre = g.centre(rect);
        assert.equal(t.hitTest(tree, area, {}, centre).edge, 'center',
            caseMessage(SEED + 2, {iteration, rect}));
        assert.equal(t.edgeAt(tree, area, {}, centre, 0), null,
            caseMessage(SEED + 2, {iteration, rect}));
        assert.equal(t.hitTest(tree, area, {}, {
            x: rect.x + Math.min(0.1, rect.width / 4),
            y: centre.y
        }).edge,
            'left', caseMessage(SEED + 2, {iteration, rect}));
        if (tree.type === 'split') {
            const parts = tree.dir === 'h'
                ? g.splitH(area, tree.ratio, 0)
                : g.splitV(area, tree.ratio, 0);
            const point = tree.dir === 'h'
                ? {x: parts[0].x + parts[0].width, y: centre.y}
                : {x: centre.x, y: parts[0].y + parts[0].height};
            assert.deepEqual(t.edgeAt(tree, area, {}, point, 0), [],
                caseMessage(SEED + 2, {iteration, point}));
        }
    }
});

test('tree generators include each id exactly once from zero through twelve', () => {
    for (let count = 0; count <= 12; count++) {
        const ids = Array.from({length: count}, (_, index) => 'g' + index);
        const generators = [t.masterStack(ids), t.columns(ids), t.monocle(ids), t.spiral(ids)];
        generators.forEach(tree => {
            const found = Object.keys(t.layout(tree, g.rect(0, 0, 1600, 900), {}));
            assert.deepEqual(found.sort(), ids.slice().sort());
        });
    }
});

test('snap actions stay bounded and thirds and special actions are exact in 240 cases', () => {
    const random = mulberry32(SEED + 3);
    const actions = ['maximize', 'leftHalf', 'rightHalf', 'topHalf', 'bottomHalf',
        'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'leftThird',
        'centerThird', 'rightThird', 'leftTwoThirds', 'rightTwoThirds', 'centerQuarter'];
    for (let iteration = 0; iteration < 240; iteration++) {
        const area = randomArea(random);
        const outer = integer(random, 0, 40);
        const inner = integer(random, 0, 24);
        const gaps = {outer, inner};
        const work = g.workRect(area, gaps);
        actions.forEach(action => {
            const rect = api.snapRect(action, area, gaps);
            assert.ok(rect.x >= work.x && rect.y >= work.y &&
                rect.x + rect.width <= work.x + work.width &&
                rect.y + rect.height <= work.y + work.height,
                caseMessage(SEED + 3, {iteration, action, area, gaps, rect}));
        });
        const left = api.snapRect('leftThird', area, gaps);
        const middle = api.snapRect('centerThird', area, gaps);
        const right = api.snapRect('rightThird', area, gaps);
        assert.equal(middle.x - left.x - left.width, Math.min(inner, work.width / 2),
            caseMessage(SEED + 3, {iteration, area, gaps}));
        assert.equal(right.x - middle.x - middle.width, Math.min(inner, work.width / 2),
            caseMessage(SEED + 3, {iteration, area, gaps}));
        const message = caseMessage(SEED + 3, {iteration, area, gaps});
        assert.equal(api.snapRect('maximize', area, gaps).width, work.width, message);
        const quarter = api.snapRect('centerQuarter', area, gaps);
        assert.equal(quarter.width, Math.round(work.width / 2), message);
        assert.equal(quarter.height, Math.round(work.height / 2), message);
        const quarterCentre = g.centre(quarter);
        const workCentre = g.centre(work);
        assert.ok(Math.abs(quarterCentre.x - workCentre.x) <= 1, message);
        assert.ok(Math.abs(quarterCentre.y - workCentre.y) <= 1, message);
    }
});

test('Stage geometry and state transitions preserve cells across 240 cases', () => {
    const random = mulberry32(SEED + 4);
    for (let iteration = 0; iteration < 240; iteration++) {
        const count = integer(random, 0, 12);
        let state = {focus: null, cells: []};
        for (let index = 0; index < count; index++) {
            state = s.addWindow(state, 's' + index);
        }
        freezeDeep(state);
        const area = iteration % 2 === 0
            ? g.rect(0, 0, 2560, 1410)
            : randomArea(random);
        const params = {
            focusRatio: random() * 0.8 + 0.1,
            gradient: random(),
            gaps: {outer: integer(random, 0, 30), inner: integer(random, 0, 24)}
        };
        const result = s.layout(state, area, params);
        const ids = state.focus === null ? [] : [state.focus];
        state.cells.forEach(cell => { if (cell.window !== null) ids.push(cell.window); });
        assert.equal(Object.keys(result.rects).length + result.overflow.length, ids.length,
            caseMessage(SEED + 4, {iteration, count, area, params}));
        const placedIds = Object.keys(result.rects).concat(result.overflow).sort();
        assert.deepEqual(placedIds, ids.slice().sort(),
            caseMessage(SEED + 4, {iteration, count, area, params}));
        noOverlap(result.rects, caseMessage(SEED + 4, {iteration, count, area, params}));
        const work = g.workRect(area, params.gaps);
        Object.values(result.rects).forEach(rect => {
            assert.ok(rect.x >= work.x && rect.y >= work.y &&
                rect.x + rect.width <= work.x + work.width &&
                rect.y + rect.height <= work.y + work.height,
                caseMessage(SEED + 4, {iteration, count, area, params, rect}));
        });
        if (state.focus !== null && state.cells.some(cell => cell.window !== null)) {
            const focus = result.rects[state.focus];
            assert.ok(Math.abs(g.centre(focus).x - g.centre(work).x) <= 1,
                caseMessage(SEED + 4, {iteration, area, params, focus}));
            const availableWidth = work.width - 2 * Math.min(
                params.gaps.inner, Math.floor(work.width / 2));
            assert.ok(Math.abs(focus.width / availableWidth - params.focusRatio) < 0.01,
                caseMessage(SEED + 4, {iteration, area, params, focus}));
        }
        if (count > 1) {
            const pinnedId = state.cells[0].window;
            const pinned = s.pin(state, pinnedId);
            const moved = s.promote(pinned, pinnedId);
            const message = caseMessage(SEED + 4, {iteration, pinnedId});
            assert.equal(moved.focus, pinned.focus,
                message);
            assert.deepEqual(moved.cells, pinned.cells,
                message);
            const cycled = s.cycle(pinned, 1);
            assert.deepEqual(cycled.cells[0], pinned.cells[0], message);

            const target = state.cells.find(cell => cell.window !== null &&
                !cell.pinned);
            const promoted = s.promote(state, target.window);
            const changedCells = promoted.cells.filter((cell, index) =>
                cell.window !== state.cells[index].window);
            assert.equal(promoted.focus, target.window, message);
            assert.equal(changedCells.length, 1, message);
            assert.equal(changedCells[0].window, state.focus, message);

            const pinnedState = s.pin(state, pinnedId);
            const expectedNext = pinnedState.cells.find(cell =>
                cell.window !== null && !cell.pinned);
            const removedFocus = s.removeWindow(pinnedState, pinnedState.focus);
            assert.equal(removedFocus.focus,
                expectedNext ? expectedNext.window : null, message);
        }
    }
});

test('arrangement templates tile exact shared edges in random work areas', () => {
    const random = mulberry32(SEED + 5);
    Object.values(templates).forEach(template => assert.ok(api.validateTemplate(template)));
    for (let iteration = 0; iteration < 240; iteration++) {
        const area = randomArea(random);
        const inner = integer(random, 0, 24);
        Object.values(templates).forEach(template => {
            const rects = api.applyTemplate(template, area, {outer: 0, inner});
            noOverlap(Object.fromEntries(rects.map((rect, index) => [index, rect])),
                caseMessage(SEED + 5, {iteration, template, area, inner}));
            template.slots.forEach((slot, index) => {
                template.slots.forEach((other, otherIndex) => {
                    if (index === otherIndex) {
                        return;
                    }
                    const vertical = Math.min(slot.y + slot.h, other.y + other.h) >
                        Math.max(slot.y, other.y);
                    const horizontal = Math.min(slot.x + slot.w, other.x + other.w) >
                        Math.max(slot.x, other.x);
                    if (vertical && Math.abs(slot.x + slot.w - other.x) < 1e-9) {
                        assert.equal(rects[otherIndex].x - rects[index].x -
                            rects[index].width, inner,
                            caseMessage(SEED + 5, {iteration, template, area, inner}));
                    }
                    if (horizontal && Math.abs(slot.y + slot.h - other.y) < 1e-9) {
                        assert.equal(rects[otherIndex].y - rects[index].y -
                            rects[index].height, inner,
                            caseMessage(SEED + 5, {iteration, template, area, inner}));
                    }
                });
            });
        });
    }
});

test('context transitions restore float geometry and expected geometry consumes once', () => {
    const random = mulberry32(SEED + 6);
    const ctx = {
        windows: [{id: 'a', mode: 'float', floatGeom: null}],
        tree: null,
        groups: []
    };
    for (let iteration = 0; iteration < 240; iteration++) {
        const geom = randomArea(random);
        const tiled = api.toTile(ctx, 'a', geom);
        const floated = api.toFloat(tiled, 'a');
        assert.deepEqual(floated.windows[0].floatGeom, geom,
            caseMessage(SEED + 6, {iteration, geom}));
        const expected = new api.ExpectedGeometry();
        expected.record('a', geom);
        assert.equal(expected.consume('a', geom), true,
            caseMessage(SEED + 6, {iteration, geom}));
        assert.equal(expected.consume('a', geom), false,
            caseMessage(SEED + 6, {iteration, geom}));
    }
    const missingGeometry = api.toTile({
        windows: [{id: 'b', mode: 'float'}],
        tree: null
    }, 'b');
    assert.deepEqual(missingGeometry.windows[0].floatGeom, {});
});
