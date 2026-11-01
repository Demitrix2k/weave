const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../index');
const {mulberry32, integer, caseMessage} = require('./helpers');

const geometry = api.geometry;
const seed = 0xC0FFEE + 20;

test('translateClamp stays bounded, preserves fitting sizes, and is idempotent', () => {
    const random = mulberry32(seed);
    for (let iteration = 0; iteration < 240; iteration++) {
        const area = geometry.rect(integer(random, -1000, 1000),
            integer(random, -500, 500), integer(random, 100, 1600),
            integer(random, 100, 1000));
        const oldArea = geometry.rect(integer(random, -1000, 1000),
            integer(random, -500, 500), integer(random, 100, 1600),
            integer(random, 100, 1000));
        const rectangle = geometry.rect(integer(random, -1500, 1500),
            integer(random, -800, 800), integer(random, 1, 1800),
            integer(random, 1, 1200));
        const result = geometry.translateClamp(rectangle, oldArea, area);
        const message = caseMessage(seed, {iteration, area, oldArea, rectangle});
        assert.ok(result.x >= area.x && result.y >= area.y, message);
        assert.ok(result.x + result.width <= area.x + area.width, message);
        assert.ok(result.y + result.height <= area.y + area.height, message);
        if (rectangle.width <= area.width) {
            assert.equal(result.width, rectangle.width, message);
        }
        if (rectangle.height <= area.height) {
            assert.equal(result.height, rectangle.height, message);
        }
        assert.deepEqual(geometry.translateClamp(result, area, area), result, message);
    }
});
