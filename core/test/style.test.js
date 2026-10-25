const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runtime JavaScript follows the classic script style constraints', () => {
    const directory = path.join(__dirname, '..');
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.js'));
    files.forEach(name => {
        const source = fs.readFileSync(path.join(directory, name), 'utf8');
        source.split(/\r?\n/).forEach((line, index) => {
            assert.ok(line.length <= 100,
                name + ':' + (index + 1) + ' exceeds 100 characters');
            assert.ok(!/\?\.|\?\?|\bimport\s|\bexport\s/.test(line),
                name + ':' + (index + 1) + ' uses unsupported syntax');
        });
    });
});
