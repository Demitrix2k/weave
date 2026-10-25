function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function integer(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function caseMessage(seed, input) {
    return 'seed=' + seed + ' input=' + JSON.stringify(input);
}

function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.keys(value).forEach(key => freezeDeep(value[key]));
    }
    return value;
}

module.exports = {mulberry32, integer, caseMessage, freezeDeep};
