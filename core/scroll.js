(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const geometryModule = dep('geometry');
    const g = geometryModule.geometry || geometryModule;

    function integerAtLeast(value, fallback, minimum) {
        value = Number(value);
        return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
    }

    function fraction(value, fallback) {
        value = Number(value);
        return Number.isFinite(value) ? Math.max(0.3, Math.min(1, value)) : fallback;
    }

    function create(opts) {
        opts = opts || {};
        return {
            axis: opts.axis === 'v' ? 'v' : 'h',
            visible: integerAtLeast(opts.visible, 2, 1),
            offset: integerAtLeast(opts.offset, 0, 0),
            box: {w: fraction(opts.box && opts.box.w, 0.88),
                h: fraction(opts.box && opts.box.h, 0.56)},
            slotLast: Object.assign({}, opts.slotLast || {})
        };
    }

    function clampOffset(count, visible, offset) {
        count = integerAtLeast(count, 0, 0);
        visible = integerAtLeast(visible, 1, 1);
        offset = integerAtLeast(offset, 0, 0);
        return Math.min(offset, Math.max(0, count - visible));
    }

    function page(ids, state) {
        ids = ids || [];
        state = state || create();
        const visibleCount = integerAtLeast(state.visible, 2, 1);
        const offset = clampOffset(ids.length, visibleCount, state.offset);
        const visible = ids.slice(offset, offset + visibleCount);
        const parked = ids.slice(0, offset).concat(ids.slice(offset + visibleCount));
        return {
            visible,
            parked,
            offset,
            from: visible.length ? offset + 1 : 0,
            to: visible.length ? offset + visible.length : 0,
            count: ids.length
        };
    }

    function windows(area, count, axis, gap, ratio) {
        if (!count) {
            return [];
        }
        if (count === 1) {
            return [g.workRect(area, {outer: 0})];
        }
        let remainder = g.workRect(area, {outer: 0});
        const result = [];
        const size = axis === 'v' ? remainder.height : remainder.width;
        const equal = Math.floor(Math.max(0, size - gap * (count - 1)) / count);
        for (let index = 0; index < count - 1; index++) {
            const share = count === 2 && ratio !== undefined ? ratio :
                equal / ((axis === 'v' ? remainder.height : remainder.width) - gap);
            const split = axis === 'v'
                ? g.splitV(remainder, share, gap)
                : g.splitH(remainder, share, gap);
            result.push(split[0]);
            remainder = split[1];
        }
        result.push(remainder);
        return result;
    }

    function layout(ids, state, area, gaps, params) {
        gaps = gaps || {};
        params = params || {};
        const result = page(ids || [], state || create());
        const work = g.workRect(area, gaps);
        const box = (state && state.box) || create().box;
        const inside = box.w === 1 && box.h === 1 ? work : g.rect(
            work.x + (work.width - Math.round(work.width * box.w)) / 2,
            work.y + (work.height - Math.round(work.height * box.h)) / 2,
            work.width * box.w, work.height * box.h);
        const count = result.visible.length;
        const rects = windows(inside, count, (state || {}).axis === 'v' ? 'v' : 'h',
            Math.max(0, gaps.inner || 0), count === 2 ? params.ratio : undefined);
        const byId = {};
        result.visible.forEach((id, index) => { byId[id] = rects[index]; });
        return {rects: byId, visible: result.visible, parked: result.parked,
            offset: result.offset, box: inside};
    }

    function stateCopy(state, offset) {
        const base = create(state || {});
        return {axis: base.axis, visible: base.visible, offset, box: base.box,
            slotLast: Object.assign({}, base.slotLast)};
    }

    function resizeBox(state, dw, dh) {
        const base = create(state || {});
        return {axis: base.axis, visible: base.visible, offset: base.offset,
            box: {w: fraction(base.box.w + Number(dw || 0), base.box.w),
                h: fraction(base.box.h + Number(dh || 0), base.box.h)},
            slotLast: Object.assign({}, base.slotLast)};
    }

    // Replaces the visible window `id` in place with the next (delta > 0) or previous parked
    // window. The parked windows form a queue: next takes the front and `id` joins the back,
    // previous takes the back and `id` joins the front, so repeated presses walk through every
    // window instead of toggling between two. The queue starts after `id` in the list
    // (wrapping), so next prefers the following window. Visible windows keep their list positions.
    function cycleSlot(ids, state, id, delta) {
        ids = (ids || []).slice();
        state = state || create();
        const current = page(ids, state);
        if (current.visible.indexOf(id) < 0 || !current.parked.length) { return {ids, state}; }
        const start = ids.indexOf(id);
        const parkedAt = [];
        for (let step = 1; step <= ids.length; step++) {
            const position = (start + step) % ids.length;
            if (current.parked.indexOf(ids[position]) >= 0) { parkedAt.push(position); }
        }
        const queue = parkedAt.map(position => ids[position]);
        const replacement = delta > 0 ? queue.shift() : queue.pop();
        if (delta > 0) { queue.push(id); } else { queue.unshift(id); }
        ids[start] = replacement;
        parkedAt.forEach((position, index) => { ids[position] = queue[index]; });
        return {ids, state: stateCopy(state, state.offset)};
    }

    function scrollBy(ids, state, delta, opts) {
        ids = ids || [];
        state = state || create();
        opts = opts || {};
        const current = clampOffset(ids.length, state.visible, state.offset);
        const amount = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
        const step = opts.step === 'window' ? 1 : state.visible;
        const max = Math.max(0, ids.length - state.visible);
        let offset = current + amount * step;
        if (opts.wrap && max > 0) {
            offset = offset > max ? 0 : offset < 0 ? max : offset;
        } else {
            offset = clampOffset(ids.length, state.visible, offset);
        }
        return stateCopy(state, offset);
    }

    function reveal(ids, state, id) {
        ids = ids || [];
        state = state || create();
        const index = ids.indexOf(id);
        if (index < 0) {
            return state;
        }
        const current = clampOffset(ids.length, state.visible, state.offset);
        const end = current + state.visible;
        const offset = index < current ? index : index >= end ? index - state.visible + 1 : current;
        return stateCopy(state, clampOffset(ids.length, state.visible, offset));
    }

    function setVisible(ids, state, n) {
        ids = ids || [];
        state = state || create();
        const visible = Math.min(integerAtLeast(n, state.visible, 1), Math.max(1, ids.length));
        return {axis: state.axis === 'v' ? 'v' : 'h', visible,
            offset: clampOffset(ids.length, visible, state.offset), box: create(state).box,
            slotLast: Object.assign({}, state.slotLast)};
    }

    function toggleAxis(state) {
        state = state || create();
        return {axis: state.axis === 'v' ? 'h' : 'v', visible: state.visible, offset: state.offset,
            box: create(state).box, slotLast: Object.assign({}, state.slotLast)};
    }

    const api = {create, clampOffset, page, layout, scrollBy, reveal, setVisible, toggleAxis,
        resizeBox, cycleSlot};
    return Object.assign({}, api, {scroll: api});
});
