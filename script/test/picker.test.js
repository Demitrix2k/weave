const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {build, render, file} = require('../../core/tools/render-picker-data.js');

test('layouts.js matches the generator output', () => {
    assert.equal(fs.readFileSync(file, 'utf8'), render());
});

test('every picker layout has visible rects inside the unit square, non-overlapping', () => {
    const names = build().map(l => l.name);
    assert.deepEqual(names, ['master', 'columns', 'monocle', 'spiral', 'rows', 'hstack',
        'rmaster', 'grid', 'ultrawide', 'stage', 'scroll']);
    for (const {name, rects} of build()) {
        assert.equal(rects.length, name === 'scroll' ? 2 : 4, name);
        for (const [x, y, w, h] of rects) {
            assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001,
                name);
        }
        if (name === 'monocle') continue; // monocle stacks its windows on purpose
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const [a, b] = [rects[i], rects[j]];
                const apart = a[0] + a[2] <= b[0] + 1e-4 || b[0] + b[2] <= a[0] + 1e-4 ||
                    a[1] + a[3] <= b[1] + 1e-4 || b[1] + b[3] <= a[1] + 1e-4;
                assert.ok(apart, `${name} ${i}/${j} overlap`);
            }
        }
    }
});
