(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const VERSION = 1;
    const MAX_RECORDS = 500;
    const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
    const MAX_TEXT = 300;

    function finite(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function captionPattern(caption) {
        let text = String(caption === undefined || caption === null ? '' : caption);
        const cut = text.search(/ [—-] /);
        if (cut > 0) {
            text = text.slice(0, cut);
        }
        return text.toLowerCase().replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim();
    }

    function keyOf(resourceClass, caption) {
        return {
            resourceClass: String(resourceClass === undefined || resourceClass === null ?
                '' : resourceClass),
            captionPattern: captionPattern(caption)
        };
    }

    function keyString(key) {
        return JSON.stringify([key.resourceClass, key.captionPattern]);
    }

    function cleanRect(rect) {
        if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)) {
            return null;
        }
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    }

    function cleanCtx(ctx) {
        const source = ctx && typeof ctx === 'object' ? ctx : {};
        const desktop = source.desktop;
        return {
            outputName: typeof source.outputName === 'string' ?
                source.outputName.slice(0, MAX_TEXT) : '',
            desktop: finite(desktop) || typeof desktop === 'string' ? desktop : null
        };
    }

    function cleanRecord(raw) {
        if (!raw || typeof raw !== 'object' || !raw.key || typeof raw.key !== 'object') {
            return null;
        }
        const resourceClass = raw.key.resourceClass;
        const pattern = raw.key.captionPattern;
        if (typeof resourceClass !== 'string' || !resourceClass.length ||
                typeof pattern !== 'string') {
            return null;
        }
        if (raw.mode !== 'float' && raw.mode !== 'tiled') {
            return null;
        }
        return {
            key: {
                resourceClass: resourceClass.slice(0, MAX_TEXT),
                captionPattern: pattern.slice(0, MAX_TEXT)
            },
            mode: raw.mode,
            floatGeom: cleanRect(raw.floatGeom),
            geom: cleanRect(raw.geom),
            ctx: cleanCtx(raw.ctx),
            seen: finite(raw.seen) ? raw.seen : 0
        };
    }

    function serialize(records, now) {
        const stamp = finite(now) ? now : 0;
        const clean = (Array.isArray(records) ? records : []).map(cleanRecord)
            .filter(record => record !== null)
            .filter(record => !stamp || !record.seen || stamp - record.seen <= MAX_AGE_MS);
        const ordered = clean.map((record, index) => ({record, index}));
        ordered.sort((a, b) => (a.record.seen - b.record.seen) || (a.index - b.index));
        const kept = ordered.slice(-MAX_RECORDS).map(item => item.record);
        return JSON.stringify({version: VERSION, savedAt: stamp, records: kept});
    }

    function parse(saved) {
        try {
            const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!value || typeof value !== 'object' || value.version !== VERSION ||
                    !Array.isArray(value.records)) {
                return [];
            }
            return value.records.map(cleanRecord).filter(record => record !== null);
        } catch (error) {
            return [];
        }
    }

    function byPosition(rectOf) {
        return (a, b) => {
            const left = rectOf(a.item) || {x: 0, y: 0};
            const right = rectOf(b.item) || {x: 0, y: 0};
            return (left.y - right.y) || (left.x - right.x) || (a.index - b.index);
        };
    }

    function ordered(items, rectOf) {
        return items.map((item, index) => ({item, index}))
            .sort(byPosition(rectOf)).map(entry => entry.item);
    }

    function restore(saved, windows) {
        const records = parse(saved);
        const result = {matches: {}, leftovers: []};
        const groups = new Map();
        (Array.isArray(windows) ? windows : []).forEach(window => {
            if (!window || window.id === undefined || window.id === null) {
                return;
            }
            const key = keyString(keyOf(window.resourceClass, window.caption));
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(window);
        });
        const saves = new Map();
        records.forEach(record => {
            const key = keyString(record.key);
            if (!saves.has(key)) {
                saves.set(key, []);
            }
            saves.get(key).push(record);
        });
        saves.forEach((list, key) => {
            const live = ordered(groups.get(key) || [], window => window.geom);
            const sorted = ordered(list, record => record.geom || record.floatGeom);
            sorted.forEach((record, index) => {
                if (index < live.length) {
                    result.matches[live[index].id] = record;
                } else {
                    result.leftovers.push(record);
                }
            });
        });
        return result;
    }

    const persist = {VERSION, MAX_RECORDS, captionPattern, keyOf, keyString,
        serialize, restore};
    return Object.assign({}, persist, {persist});
});
