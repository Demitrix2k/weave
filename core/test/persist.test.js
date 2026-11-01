const test = require('node:test');
const assert = require('node:assert/strict');
const Weave = require('..');

function record(cls, caption, mode, geom, extra) {
    return Object.assign({
        key: Weave.keyOf(cls, caption),
        mode,
        floatGeom: {x: 1, y: 2, width: 300, height: 200},
        geom,
        ctx: {outputName: 'DP-1', desktop: 1},
        seen: 1000
    }, extra);
}

const at = (x, y) => ({x, y, width: 100, height: 100});

test('caption pattern strips digits, trailing parts and case', () => {
    assert.equal(Weave.captionPattern('Report 12 - Final.odt — LibreOffice 7'), 'report');
    assert.equal(Weave.captionPattern('README.md — Kate'), 'readme.md');
    assert.equal(Weave.captionPattern('Terminal  3'), 'terminal');
    assert.equal(Weave.captionPattern(' - odd'), '- odd');
    assert.equal(Weave.captionPattern(undefined), '');
    assert.deepEqual(Weave.keyOf('kitty', 'Zsh 4'), {resourceClass: 'kitty',
        captionPattern: 'zsh'});
});

test('serialize and restore round trip by key, never by id', () => {
    const text = Weave.serialize([
        record('kate', 'a.txt — Kate', 'float', at(0, 0)),
        record('kitty', 'zsh 1', 'tiled', at(0, 0))
    ], 2000);
    const result = Weave.restore(text, [
        {id: 'w9', resourceClass: 'kitty', caption: 'zsh 7', geom: at(5, 5)},
        {id: 'w3', resourceClass: 'kate', caption: 'a.txt — Kate', geom: at(9, 9)},
        {id: 'w4', resourceClass: 'kate', caption: 'other', geom: at(1, 1)}
    ]);
    assert.equal(result.matches.w9.mode, 'tiled');
    assert.equal(result.matches.w3.mode, 'float');
    assert.equal(result.matches.w4, undefined);
    assert.deepEqual(result.matches.w3.floatGeom, {x: 1, y: 2, width: 300, height: 200});
    assert.equal(result.leftovers.length, 0);
});

test('duplicate keys are matched in geometry order, extras become leftovers', () => {
    const text = Weave.serialize([
        record('kitty', 'zsh', 'float', at(500, 0)),
        record('kitty', 'zsh', 'tiled', at(0, 0)),
        record('kitty', 'zsh', 'float', at(0, 300))
    ], 2000);
    const windows = [
        {id: 'right', resourceClass: 'kitty', caption: 'zsh', geom: at(600, 10)},
        {id: 'left', resourceClass: 'kitty', caption: 'zsh', geom: at(10, 10)}
    ];
    const result = Weave.restore(text, windows);
    assert.equal(result.matches.left.mode, 'tiled');
    assert.equal(result.matches.right.mode, 'float');
    assert.equal(result.leftovers.length, 1);
    assert.deepEqual(result.leftovers[0].geom, at(0, 300));
});

test('unknown version and garbage are ignored without throwing', () => {
    const windows = [{id: 'a', resourceClass: 'kitty', caption: 'zsh', geom: at(0, 0)}];
    const inputs = [
        JSON.stringify({version: 99, records: [record('kitty', 'zsh', 'float', at(0, 0))]}),
        '{', '', '[]', 'null', '42', null, undefined, {version: 1, records: 'x'},
        JSON.stringify({version: 1, records: [null, 3, {key: 1}, {key: {}, mode: 'float'},
            {key: {resourceClass: 'kitty', captionPattern: 'zsh'}, mode: 'sideways'}]})
    ];
    inputs.forEach(input => {
        assert.deepEqual(Weave.restore(input, windows), {matches: {}, leftovers: []});
    });
    assert.deepEqual(Weave.restore('{}', null), {matches: {}, leftovers: []});
    assert.doesNotThrow(() => Weave.serialize('nonsense', NaN));
    assert.equal(JSON.parse(Weave.serialize(null, 5)).records.length, 0);
});

test('bad rectangles are dropped from records but the record survives', () => {
    const bad = record('kitty', 'zsh', 'float', {x: 'a', y: 0, width: -1, height: 5},
        {floatGeom: {x: 0, y: 0, width: 0, height: 10}});
    const parsed = JSON.parse(Weave.serialize([bad], 5)).records[0];
    assert.equal(parsed.floatGeom, null);
    assert.equal(parsed.geom, null);
});

test('size is bounded to 500 records and the oldest go first, old ones expire', () => {
    const records = [];
    for (let index = 0; index < 700; index++) {
        records.push(record('kitty', 'zsh ' + index + 'x'.repeat(index % 3), 'float',
            at(index, 0), {seen: 1000 + index}));
    }
    const kept = JSON.parse(Weave.serialize(records, 5000)).records;
    assert.equal(kept.length, 500);
    assert.equal(kept[0].seen, 1200);
    assert.equal(kept[499].seen, 1699);
    const day = 24 * 3600 * 1000;
    const aged = JSON.parse(Weave.serialize([
        record('a', 'x', 'float', at(0, 0), {seen: 1}),
        record('b', 'x', 'float', at(0, 0), {seen: 40 * day})
    ], 45 * day)).records;
    assert.deepEqual(aged.map(item => item.key.resourceClass), ['b']);
});
