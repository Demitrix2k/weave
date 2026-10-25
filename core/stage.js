(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const g = dep('geometry').geometry || dep('geometry');
    // Keep six rail positions reserved so geometry stays stable through twelve windows.
    const MIN_RAIL_CELLS = 6;
    // Reduce the outermost rail cell to half the central cell at full gradient.
    const GRADIENT_WEIGHT_FACTOR = 0.5;

    function copy(state) {
        return Object.assign({}, state, {
            cells: state.cells.map(cell => Object.assign({}, cell))
        });
    }

    function ordered(state) {
        return state.cells.slice().sort((a, b) => a.index - b.index ||
            (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1));
    }

    function nextRailCellNearestCentre(state) {
        let index = 0;
        while (true) {
            for (const side of ['left', 'right']) {
                const cell = state.cells.find(item =>
                    item.side === side && item.index === index);
                if (!cell || (cell.window === null && !cell.pinned)) {
                    return cell || {side, index, window: null, pinned: false};
                }
            }
            index++;
        }
    }

    function addWindow(state, id) {
        const result = copy(state);
        if (state.focus === id || state.cells.some(cell => cell.window === id)) {
            return result;
        }
        if (state.focus === null) {
            result.focus = id;
            return result;
        }
        const cell = nextRailCellNearestCentre(result);
        if (!result.cells.includes(cell)) {
            result.cells.push(cell);
        }
        cell.window = id;
        return result;
    }

    function promote(state, id) {
        const result = copy(state);
        const cell = result.cells.find(item => item.window === id);
        if (cell && !cell.pinned) {
            cell.window = result.focus;
            result.focus = id;
        }
        return result;
    }

    function removeWindow(state, id) {
        let result = copy(state);
        result.cells.forEach(cell => {
            if (cell.window === id) {
                cell.window = null;
                cell.pinned = false;
            }
        });
        if (result.focus === id) {
            result.focus = null;
            const next = ordered(result).find(cell =>
                cell.window !== null && !cell.pinned);
            if (next) {
                result = promote(result, next.window);
            }
        }
        return result;
    }

    function cycle(state, direction) {
        const candidates = ordered(state).filter(cell =>
            cell.window !== null && !cell.pinned);
        if (!candidates.length) {
            return copy(state);
        }
        const index = direction < 0 ? candidates.length - 1 : 0;
        return promote(state, candidates[index].window);
    }

    function pin(state, id) {
        const result = copy(state);
        result.cells.forEach(cell => {
            if (cell.window === id) {
                cell.pinned = true;
            }
        });
        return result;
    }

    function unpin(state, id) {
        const result = copy(state);
        result.cells.forEach(cell => {
            if (cell.window === id) {
                cell.pinned = false;
            }
        });
        return result;
    }

    function railCellOrder(count) {
        const indices = [];
        for (let index = count - 1; index >= 0; index--) {
            if (index % 2 === 0) {
                indices.push(index);
            }
        }
        for (let index = 1; index < count; index += 2) {
            indices.push(index);
        }
        return indices;
    }

    function railWeight(index, count, gradient) {
        const depth = count <= 1 ? 0 : index / (count - 1);
        return 1 - gradient * GRADIENT_WEIGHT_FACTOR * depth;
    }

    function railBoundaries(order, count, height, gradient) {
        const totalWeight = order.reduce((sum, index) =>
            sum + railWeight(index, count, gradient), 0);
        const boundaries = [];
        let cumulativeWeight = 0;
        let previousBoundary = 0;
        order.forEach(index => {
            cumulativeWeight += railWeight(index, count, gradient);
            const boundary = Math.round(height * cumulativeWeight / totalWeight);
            boundaries.push(previousBoundary);
            previousBoundary = boundary;
        });
        return boundaries;
    }

    function railGeometry(state, side, area, gaps, params, rects, overflow) {
        const cells = state.cells.filter(cell =>
            cell.window !== null && cell.side === side).sort((a, b) => a.index - b.index);
        if (!cells.length) {
            return;
        }
        const count = Math.max(MIN_RAIL_CELLS, cells[cells.length - 1].index + 1);
        const width = side === 'left' ? area.leftWidth : area.rightWidth;
        const verticalGap = Math.min(Math.max(0, gaps.inner || 0),
            count > 1 ? Math.floor(area.rect.height / (count - 1)) : 0);
        const usableHeight = Math.max(0, area.rect.height - (count - 1) * verticalGap);
        const gradient = Math.max(0, Math.min(1, params.gradient || 0));
        const order = railCellOrder(count);
        const boundaries = railBoundaries(order, count, usableHeight, gradient);
        const min = params.railCellMin || {w: 0, h: 0};

        order.forEach((index, position) => {
            const nextBoundary = position + 1 < count
                ? boundaries[position + 1]
                : usableHeight;
            const height = nextBoundary - boundaries[position];
            const cell = cells.find(item => item.index === index);
            const cellWidth = Math.round(width * railWeight(index, count, gradient));
            if (cell) {
                placeRailCell(cell, side, area, boundaries[position], position,
                    verticalGap, height, cellWidth, min, rects, overflow);
            }
        });
    }

    function placeRailCell(cell, side, area, top, position, verticalGap, height,
        width, min, rects, overflow) {
        if (width < (min.w || 0) || height < (min.h || 0) || !width || !height) {
            // Overflow has no rectangle when the cell cannot meet its minimum size.
            overflow.push(cell.window);
            return;
        }
        const x = side === 'left'
            ? area.rect.x + area.leftWidth - width
            : area.rect.x + area.leftWidth + 2 * area.gap + area.focusWidth;
        const y = area.rect.y + top + position * verticalGap;
        rects[cell.window] = g.rect(x, y, width, height);
    }

    function prepareRailArea(rect, gap, focusWidth) {
        const available = rect.width - 2 * gap;
        const leftWidth = Math.floor((available - focusWidth) / 2);
        const rightWidth = available - focusWidth - leftWidth;
        return {rect, gap, focusWidth, leftWidth, rightWidth};
    }

    function layout(state, workArea, params) {
        params = params || {};
        const gaps = params.gaps || {};
        const rect = g.workRect(workArea, gaps);
        const rects = {};
        const overflow = [];
        const occupied = state.cells.filter(cell => cell.window !== null);
        if (!occupied.length) {
            if (state.focus !== null) {
                rects[state.focus] = rect;
            }
            return {rects, overflow};
        }
        const gap = Math.min(Math.max(0, gaps.inner || 0), Math.floor(rect.width / 2));
        const available = rect.width - 2 * gap;
        const focusRatio = params.focusRatio === undefined ? 0.6 : params.focusRatio;
        const focusWidth = Math.round(available * Math.max(0, Math.min(1, focusRatio)));
        const area = prepareRailArea(rect, gap, focusWidth);
        if (state.focus !== null) {
            const x = rect.x + area.leftWidth + gap;
            rects[state.focus] = g.rect(x, rect.y, focusWidth, rect.height);
        }
        ['left', 'right'].forEach(side =>
            railGeometry(state, side, area, gaps, params, rects, overflow));
        return {rects, overflow};
    }

    const api = {addWindow, removeWindow, promote, cycle, pin, unpin, layout};
    return Object.assign({}, api, {stage: api});
});
