const test = require('node:test');
const assert = require('node:assert/strict');
const {tree, arrangement} = require('../index.js');

test('layout names: valid, reserved and cycling in both directions', () => {
    assert.deepEqual(tree.LAYOUTS, ['master', 'columns', 'monocle', 'spiral', 'rows', 'hstack',
        'rmaster', 'grid', 'ultrawide']);
    assert.deepEqual(tree.RESERVED_LAYOUTS, ['stage', 'scroll']);
    assert.equal(tree.validAnyLayout('scroll'), true);
    assert.equal(tree.validLayout('scroll'), false);
    assert.equal(tree.cycleAnyLayout('stage', 1), 'scroll');
    assert.equal(tree.cycleAnyLayout('scroll', 1), 'master');
    assert.equal(tree.cycleAnyLayout('master', -1), 'scroll');
    assert.equal(tree.validLayout('spiral'), true);
    assert.equal(tree.validLayout('stage'), false);
    assert.equal(tree.validLayout('nope'), false);
    assert.equal(tree.cycleLayout('master', 1), 'columns');
    assert.equal(tree.cycleLayout('ultrawide', 1), 'master');
    assert.equal(tree.cycleLayout('master', -1), 'ultrawide');
    assert.equal(tree.cycleLayout('spiral', 1), 'rows');
    assert.equal(tree.cycleLayout('stage', 1), 'columns');
    assert.equal(tree.validLayout('ultrawide'), true);
});

test('generate maps names to generators and falls back to master-stack', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(tree.generate('master', list, {masterRatio: 0.5}),
        tree.masterStack(list, 1, 0.5));
    assert.deepEqual(tree.generate('columns', list), tree.columns(list));
    assert.deepEqual(tree.generate('monocle', list), tree.monocle(list));
    assert.deepEqual(tree.generate('spiral', list), tree.spiral(list));
    assert.deepEqual(tree.generate('rows', list), tree.rows(list));
    assert.deepEqual(tree.generate('hstack', list, {nMaster: 2, masterRatio: 0.5}),
        tree.hstack(list, 2, 0.5));
    assert.deepEqual(tree.generate('rmaster', list, {masterRatio: 0.7}), tree.rmaster(list, 1, 0.7));
    assert.deepEqual(tree.generate('grid', list), tree.grid(list));
    assert.deepEqual(tree.generate('ultrawide', list, {masterRatio: 0.4}), tree.ultrawide(list, 0.4));
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

// Every tree layout, 1..9 windows, with and without gaps.
const AREA = {x: 100, y: 50, width: 2560, height: 1440};
const GAPS = [{}, {inner: 8, outer: 8}];
const ids = n => Array.from({length: n}, (_, i) => 'w' + i);
const area = r => r.width * r.height;

function check(name, n, gaps) {
    const list = ids(n);
    const rects = tree.layout(tree.generate(name, list), AREA, gaps);
    const msg = name + ' ' + n + ' ' + JSON.stringify(gaps);
    const keys = Object.keys(rects);
    assert.deepEqual(keys.slice().sort(), list.slice().sort(), msg);
    const inner = gaps.outer || 0;
    keys.forEach(id => {
        const r = rects[id];
        assert.ok(r.width > 0 && r.height > 0, msg + ' size');
        assert.ok(r.x >= AREA.x + inner && r.y >= AREA.y + inner &&
            r.x + r.width <= AREA.x + AREA.width - inner &&
            r.y + r.height <= AREA.y + AREA.height - inner, msg + ' inside');
    });
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
            const a = rects[list[i]], b = rects[list[j]];
            if (name === 'monocle') {
                assert.deepEqual(a, b, msg + ' monocle shares the area');
                continue;
            }
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
                a.y < b.y + b.height && b.y < a.y + a.height;
            assert.equal(overlap, false, msg + ' overlap ' + i + ',' + j);
        }
    if (!gaps.inner) {
        // Without gaps the windows tile the work area exactly (within rounding).
        const total = name === 'monocle' ? area(rects.w0)
            : keys.reduce((sum, id) => sum + area(rects[id]), 0);
        assert.ok(Math.abs(total - area(AREA)) <= 2 * (AREA.width + AREA.height), msg + ' coverage');
    }
    return rects;
}

for (const name of ['master', 'columns', 'monocle', 'spiral', 'rows', 'hstack', 'rmaster', 'grid',
    'ultrawide']) {
    test(name + ': 1..9 windows cover the area without overlap, with and without gaps', () => {
        for (let n = 1; n <= 9; n++)
            GAPS.forEach(gaps => check(name, n, gaps));
        assert.equal(tree.generate(name, []), null);
    });
}

test('rows: equal full-width rows in window order', () => {
    for (let n = 1; n <= 9; n++) {
        const r = check('rows', n, {});
        for (let i = 0; i < n; i++) {
            assert.equal(r['w' + i].width, AREA.width);
            assert.ok(Math.abs(r['w' + i].height - AREA.height / n) <= 2);
            if (i) assert.ok(r['w' + i].y > r['w' + (i - 1)].y);
        }
    }
});

test('hstack: masters on top side by side, stack below, masterRatio is the top share', () => {
    const r = check('hstack', 5, {});
    assert.equal(r.w0.y, AREA.y);
    assert.equal(r.w0.width, AREA.width);
    assert.ok(Math.abs(r.w0.height - AREA.height * 0.6) <= 1);
    for (const id of ['w1', 'w2', 'w3', 'w4'])
        assert.ok(r[id].y >= r.w0.y + r.w0.height - 1);
    assert.ok(r.w1.x < r.w2.x && r.w2.x < r.w3.x && r.w3.x < r.w4.x);
    const two = tree.layout(tree.hstack(ids(4), 2, 0.5), AREA, {});
    assert.equal(two.w0.y, two.w1.y);
    assert.ok(two.w0.x < two.w1.x);
    assert.equal(two.w2.y, two.w3.y);
    assert.ok(two.w2.y > two.w0.y);
    assert.ok(Math.abs(two.w0.height - AREA.height / 2) <= 1);
    // Too many masters: everything is one row.
    const all = tree.layout(tree.hstack(ids(3), 5), AREA, {});
    assert.equal(all.w0.height, AREA.height);
});

test('rmaster mirrors master: master on the right with its share, stack on the left', () => {
    for (let n = 1; n <= 9; n++) {
        const m = tree.layout(tree.masterStack(ids(n), 1, 0.6), AREA, {});
        const r = check('rmaster', n, {});
        for (const id of Object.keys(m)) {
            assert.equal(r[id].y, m[id].y);
            assert.equal(r[id].height, m[id].height);
            assert.ok(Math.abs(r[id].width - m[id].width) <= 1);
            assert.ok(Math.abs((r[id].x - AREA.x) - (AREA.width - (m[id].x - AREA.x) - m[id].width)) <= 1);
        }
    }
    const r = tree.layout(tree.rmaster(ids(3), 1, 0.7), AREA, {});
    assert.ok(Math.abs(r.w0.width - AREA.width * 0.7) <= 1);
    assert.equal(r.w0.x + r.w0.width, AREA.x + AREA.width);
    assert.equal(r.w1.x, AREA.x);
});

test('grid: ceil(sqrt(n)) columns, equal cells per row, short last row fills the width', () => {
    const cols = {1: 1, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3};
    for (let n = 1; n <= 9; n++) {
        const r = check('grid', n, {});
        const rowCount = Math.ceil(n / cols[n]);
        for (let i = 0; i < n; i++) {
            const row = Math.floor(i / cols[n]);
            const inRow = Math.min(cols[n], n - row * cols[n]);
            assert.ok(Math.abs(r['w' + i].width - AREA.width / inRow) <= 2, 'grid ' + n + ' w' + i);
            assert.ok(Math.abs(r['w' + i].height - AREA.height / rowCount) <= 2);
            if (i % cols[n]) assert.equal(r['w' + i].y, r['w' + (i - 1)].y);
            else if (i) assert.ok(r['w' + i].y > r['w' + (i - 1)].y);
        }
    }
});

test('ultrawide: centre first, then right and left columns alternating', () => {
    const one = tree.layout(tree.ultrawide(ids(1)), AREA, {});
    assert.deepEqual(one.w0, AREA);
    const two = check('ultrawide', 2, {});
    assert.ok(Math.abs(two.w0.width - AREA.width * 0.5) <= 1);
    assert.ok(two.w1.x > two.w0.x);
    const r = check('ultrawide', 6, {});
    // w0 centre, w1 w3 w5 right, w2 w4 left.
    assert.ok(Math.abs(r.w0.width - AREA.width * 0.5) <= 2);
    assert.equal(r.w0.height, AREA.height);
    assert.ok(Math.abs(r.w1.width - AREA.width * 0.25) <= 2);
    assert.ok(Math.abs(r.w2.width - AREA.width * 0.25) <= 2);
    assert.ok(r.w2.x < r.w0.x && r.w1.x > r.w0.x);
    assert.equal(r.w1.x, r.w3.x);
    assert.equal(r.w1.x, r.w5.x);
    assert.equal(r.w2.x, r.w4.x);
    assert.ok(r.w3.y > r.w1.y && r.w5.y > r.w3.y && r.w4.y > r.w2.y);
    const wide = tree.layout(tree.ultrawide(ids(3), 0.6), AREA, {});
    assert.ok(Math.abs(wide.w0.width - AREA.width * 0.6) <= 2);
});
