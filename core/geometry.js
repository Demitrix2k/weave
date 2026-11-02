(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

    function rect(x, y, width, height) {
        return {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(0, Math.round(width)),
            height: Math.max(0, Math.round(height))
        };
    }

    function inset(area, top, right, bottom, left) {
        const x = Math.min(area.width, Math.max(0, left));
        const y = Math.min(area.height, Math.max(0, top));
        const width = Math.max(0, area.width - x - right);
        const height = Math.max(0, area.height - y - bottom);
        return rect(area.x + x, area.y + y, width, height);
    }

    function contains(area, point) {
        return point.x >= area.x && point.y >= area.y &&
            point.x < area.x + area.width && point.y < area.y + area.height;
    }

    function centre(area) {
        return {x: area.x + area.width / 2, y: area.y + area.height / 2};
    }

    function split(area, ratio, gap, horizontal) {
        const size = horizontal ? area.width : area.height;
        const innerGap = clamp(Math.round(gap || 0), 0, size);
        // Round only the first share so the second receives every remaining pixel.
        const firstSize = Math.round((size - innerGap) * clamp(ratio, 0, 1));
        const secondSize = size - innerGap - firstSize;
        if (horizontal) {
            const first = rect(area.x, area.y, firstSize, area.height);
            const second = rect(area.x + firstSize + innerGap, area.y,
                secondSize, area.height);
            return [first, second];
        }
        const first = rect(area.x, area.y, area.width, firstSize);
        const second = rect(area.x, area.y + firstSize + innerGap,
            area.width, secondSize);
        return [first, second];
    }

    function splitH(area, ratio, gap) {
        return split(area, ratio, gap, true);
    }

    function splitV(area, ratio, gap) {
        return split(area, ratio, gap, false);
    }

    function minDimension(bounds, shortName, longName) {
        return bounds[shortName] || bounds[longName] || 0;
    }

    function maxDimension(bounds, shortName, longName) {
        if (bounds[shortName] !== undefined) {
            return bounds[shortName];
        }
        return bounds[longName] === undefined ? Infinity : bounds[longName];
    }

    function clampSize(area, min, max) {
        min = min || {};
        max = max || {};
        const minWidth = minDimension(min, 'w', 'width');
        const minHeight = minDimension(min, 'h', 'height');
        const maxWidth = maxDimension(max, 'w', 'width');
        const maxHeight = maxDimension(max, 'h', 'height');
        const width = clamp(area.width, minWidth, maxWidth);
        const height = clamp(area.height, minHeight, maxHeight);
        return rect(area.x, area.y, width, height);
    }

    function equalRects(first, second) {
        if (!first || !second) {
            return false;
        }
        return ['x', 'y', 'width', 'height'].every(key =>
            first[key] === second[key]);
    }

    function workRect(area, gaps) {
        const outer = Math.max(0, (gaps || {}).outer || 0);
        const copy = rect(area.x, area.y, area.width, area.height);
        return inset(copy, outer, outer, outer, outer);
    }

    function translateClamp(rectangle, oldArea, newArea) {
        const width = Math.min(rectangle.width, newArea.width);
        const height = Math.min(rectangle.height, newArea.height);
        const x = clamp(rectangle.x + newArea.x - oldArea.x,
            newArea.x, newArea.x + newArea.width - width);
        const y = clamp(rectangle.y + newArea.y - oldArea.y,
            newArea.y, newArea.y + newArea.height - height);
        return rect(x, y, width, height);
    }

    function overlapArea(first, second) {
        const width = Math.max(0, Math.min(first.x + first.width,
            second.x + second.width) - Math.max(first.x, second.x));
        const height = Math.max(0, Math.min(first.y + first.height,
            second.y + second.height) - Math.max(first.y, second.y));
        return width * height;
    }

    function mostlyInside(rectangle, area) {
        const total = rectangle.width * rectangle.height;
        return total > 0 && overlapArea(rectangle, area) * 2 > total;
    }

    function isFurther(from, candidate, direction) {
        const horizontal = direction === 'left' || direction === 'right';
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const start = horizontal ? 'x' : 'y';
        const length = horizontal ? 'width' : 'height';
        const middle = rectangle => rectangle[start] + rectangle[length] / 2;
        const end = rectangle => rectangle[start] + rectangle[length];
        return sign * (candidate[start] - from[start]) > 0 &&
            sign * (end(candidate) - end(from)) > 0 &&
            sign * (middle(candidate) - middle(from)) > 0;
    }

    // ID of the nearest rectangle in a direction (left, right, up, down), or null. A
    // rectangle counts only if its centre and both edges lie further that way; the nearest
    // centre (sum of both axis distances) wins and the first in key order breaks ties.
    function neighbour(rects, id, direction) {
        const from = rects[id];
        if (!from) {
            return null;
        }
        const origin = centre(from);
        let best = null;
        let bestDistance = Infinity;
        Object.keys(rects).forEach(other => {
            if (other === id || !isFurther(from, rects[other], direction)) {
                return;
            }
            const point = centre(rects[other]);
            const distance = Math.abs(point.x - origin.x) + Math.abs(point.y - origin.y);
            if (distance < bestDistance) {
                best = other;
                bestDistance = distance;
            }
        });
        return best;
    }

    // ID of the rectangle to focus in a direction, or null. Like neighbour, a rectangle
    // counts only if its centre and both edges lie further that way; up and down also need
    // shared width. Lowest score wins: across * 4 + along + centre / 1000, where across is
    // the gap on the other axis (so lined-up rectangles win), along the gap in the
    // direction and centre the centre distance along it. The first in key order breaks ties.
    function focusTarget(rects, id, direction) {
        const from = rects[id];
        if (!from) {
            return null;
        }
        const horizontal = direction === 'left' || direction === 'right';
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const start = horizontal ? 'x' : 'y';
        const length = horizontal ? 'width' : 'height';
        const cross = horizontal ? 'y' : 'x';
        const crossLength = horizontal ? 'height' : 'width';
        let best = null;
        let bestScore = Infinity;
        Object.keys(rects).forEach(other => {
            const rectangle = rects[other];
            if (other === id || !isFurther(from, rectangle, direction)) {
                return;
            }
            const overlap = Math.min(from[cross] + from[crossLength],
                rectangle[cross] + rectangle[crossLength]) -
                Math.max(from[cross], rectangle[cross]);
            if (!horizontal && overlap <= 0) {
                return;
            }
            const across = Math.max(0, rectangle[cross] - from[cross] - from[crossLength],
                from[cross] - rectangle[cross] - rectangle[crossLength]);
            const along = sign > 0 ?
                Math.max(0, rectangle[start] - from[start] - from[length]) :
                Math.max(0, from[start] - rectangle[start] - rectangle[length]);
            const centreGap = Math.abs(rectangle[start] + rectangle[length] / 2 -
                from[start] - from[length] / 2);
            const score = across * 4 + along + centreGap / 1000;
            if (score < bestScore) {
                best = other;
                bestScore = score;
            }
        });
        return best;
    }

    // True if another rectangle has the same position and size as id's, each value within
    // tolerance px (monocle, a Stage overflow stack).
    function sharesRect(rects, id, tolerance) {
        const from = rects[id];
        return !!from && Object.keys(rects).some(other => other !== id &&
            ['x', 'y', 'width', 'height'].every(key =>
                Math.abs(rects[other][key] - from[key]) <= tolerance));
    }

    // Floating resize: the size along the axis ('h' width, 'v' height) changes by delta in
    // total, half per side, and stays inside the area and at least minSize (a window already
    // outside those limits is never moved the wrong way).
    function resizeFloat(rectangle, area, axis, delta, minSize) {
        const horizontal = axis === 'h';
        const size = horizontal ? rectangle.width : rectangle.height;
        const limit = horizontal ? area.width : area.height;
        const wanted = clamp(size + delta, Math.min(minSize, limit), limit);
        const next = delta < 0 ? Math.min(size, wanted) : Math.max(size, wanted);
        const origin = horizontal ? area.x : area.y;
        const start = Math.round((horizontal ? rectangle.x : rectangle.y) - (next - size) / 2);
        const placed = clamp(start, origin, origin + limit - next);
        return horizontal
            ? rect(placed, rectangle.y, next, rectangle.height)
            : rect(rectangle.x, placed, rectangle.width, next);
    }

    // ---- keyboard resize like a tiler, and Fill (ported from the kwin-rectangle fork) ----

    const TILER_SLACK = 4;
    const TILER_NEAR = 12;
    const TILER_MIN = {w: 200, h: 150};

    function gapAt(side, from, other) {
        const gaps = {
            right: other.x - (from.x + from.width),
            left: from.x - (other.x + other.width),
            bottom: other.y - (from.y + from.height),
            top: from.y - (other.y + other.height)
        };
        return gaps[side];
    }

    function spansSide(side, from, other) {
        if (side === 'left' || side === 'right') {
            return other.y < from.y + from.height && other.y + other.height > from.y;
        }
        return other.x < from.x + from.width && other.x + other.width > from.x;
    }

    // Free distance between a window side and the work area edge (outer gap kept).
    function roomAt(side, from, area, outer) {
        const rooms = {
            right: area.x + area.width - outer - (from.x + from.width),
            left: from.x - (area.x + outer),
            bottom: area.y + area.height - outer - (from.y + from.height),
            top: from.y - (area.y + outer)
        };
        return rooms[side];
    }

    // Outward movement of one side (positive grows the window) and the other windows whose
    // facing edge moves with it. Entries of others: {id, rect, movable}. A side that touches
    // a window which must not move (tiled, arranged) stays put when growing.
    function sideMove(side, from, others, area, gaps, step, grow) {
        const horizontal = side === 'left' || side === 'right';
        const min = horizontal ? TILER_MIN.w : TILER_MIN.h;
        const sizeOf = rectangle => (horizontal ? rectangle.width : rectangle.height);
        const near = gaps.inner + TILER_NEAR;
        const spanning = others.filter(item => spansSide(side, from, item.rect));
        const gapOf = item => gapAt(side, from, item.rect);
        const touching = spanning.filter(item =>
            gapOf(item) >= -TILER_SLACK && gapOf(item) <= near);
        const blocked = touching.some(item => !item.movable);
        const follow = blocked ? [] : touching;
        const room = roomAt(side, from, area, gaps.outer);
        let move = -step;
        if (touching.length && grow) {
            move = blocked ? 0 : Math.min(step, ...touching.map(item => sizeOf(item.rect) - min));
        } else if (!touching.length && room <= TILER_SLACK) {
            move = 0;
        } else if (!touching.length && grow) {
            const free = spanning.map(gapOf).filter(gap => gap > near).map(gap => gap - gaps.inner);
            move = Math.min(step, room, ...free);
        }
        if (grow && move < 0) { move = 0; }
        return {move, follow: follow.map(item => item.id)};
    }

    function followRect(side, other, move) {
        if (side === 'right') {
            return rect(other.x + move, other.y, other.width - move, other.height);
        }
        if (side === 'left') {
            return rect(other.x, other.y, other.width - move, other.height);
        }
        if (side === 'bottom') {
            return rect(other.x, other.y + move, other.width, other.height - move);
        }
        return rect(other.x, other.y, other.width, other.height - move);
    }

    // Tiler-style resize of a floating window by |delta| px on the long axis of the work area
    // (the other axis scaled by the aspect ratio); delta > 0 grows, < 0 shrinks. axis: 'h',
    // 'v' or 'both'. A side facing a neighbour moves the shared edge and the neighbour with
    // it, a side facing free space moves on its own up to the next window or the work area
    // edge (outer gap kept), a side on the work area edge stays put. Returns the new
    // rectangle and the moved neighbours as {id, rect}.
    function resizeNeighbours(rectangle, others, area, gaps, axis, delta) {
        const long = Math.max(area.width, area.height);
        const steps = {
            h: Math.abs(delta) * area.width / long,
            v: Math.abs(delta) * area.height / long
        };
        const grow = delta > 0;
        const sides = {left: 'h', right: 'h', top: 'v', bottom: 'v'};
        const moves = {left: 0, right: 0, top: 0, bottom: 0};
        const follows = {};
        Object.keys(sides).forEach(side => {
            follows[side] = [];
            if (axis !== 'both' && axis !== sides[side]) { return; }
            const result = sideMove(side, rectangle, others, area, gaps, steps[sides[side]], grow);
            moves[side] = result.move;
            follows[side] = result.follow;
        });
        if (!grow) {
            // a window pinned on both sides of an axis shrinks from both sides
            if (axis !== 'v' && moves.left === 0 && moves.right === 0) {
                moves.left = moves.right = -steps.h;
            }
            if (axis !== 'h' && moves.top === 0 && moves.bottom === 0) {
                moves.top = moves.bottom = -steps.v;
            }
        }
        if (rectangle.width + moves.left + moves.right < TILER_MIN.w) {
            moves.left = moves.right = 0;
        }
        if (rectangle.height + moves.top + moves.bottom < TILER_MIN.h) {
            moves.top = moves.bottom = 0;
        }
        const moved = [];
        Object.keys(sides).forEach(side => {
            follows[side].forEach(id => {
                const item = others.find(other => other.id === id);
                moved.push({id, rect: followRect(side, item.rect, moves[side])});
            });
        });
        const next = rect(rectangle.x - moves.left, rectangle.y - moves.top,
            rectangle.width + moves.left + moves.right,
            rectangle.height + moves.top + moves.bottom);
        return {rect: next, moves: moved};
    }

    function sortedUnique(values, low, high) {
        const inside = values.filter(value => value >= low && value <= high);
        return Array.from(new Set(inside)).sort((a, b) => a - b);
    }

    function hitsBox(boxes, x1, y1, x2, y2) {
        return boxes.some(box => box.x1 < x2 && box.x2 > x1 && box.y1 < y2 && box.y2 > y1);
    }

    // Largest rectangle inside the work area (outer gap kept) that overlaps none of the
    // rectangles (inner gap kept around them), or null. Candidate edges lie on the work area
    // or on an obstacle edge; the first of equal areas in x then y order wins.
    function fillRect(obstacles, area, gaps) {
        const left = area.x + gaps.outer;
        const top = area.y + gaps.outer;
        const right = area.x + area.width - gaps.outer;
        const bottom = area.y + area.height - gaps.outer;
        const boxes = obstacles.map(item => ({
            x1: item.x - gaps.inner,
            y1: item.y - gaps.inner,
            x2: item.x + item.width + gaps.inner,
            y2: item.y + item.height + gaps.inner
        })).filter(box => box.x2 > left && box.x1 < right && box.y2 > top && box.y1 < bottom);
        const xs = sortedUnique([left, right].concat(...boxes.map(b => [b.x1, b.x2])),
            left, right);
        const ys = sortedUnique([top, bottom].concat(...boxes.map(b => [b.y1, b.y2])),
            top, bottom);
        let best = null;
        let bestArea = 0;
        for (let i = 0; i < xs.length; i++) {
            for (let j = i + 1; j < xs.length; j++) {
                for (let k = 0; k < ys.length; k++) {
                    for (let l = k + 1; l < ys.length; l++) {
                        const size = (xs[j] - xs[i]) * (ys[l] - ys[k]);
                        if (size <= bestArea || hitsBox(boxes, xs[i], ys[k], xs[j], ys[l])) {
                            continue;
                        }
                        bestArea = size;
                        best = rect(xs[i], ys[k], xs[j] - xs[i], ys[l] - ys[k]);
                    }
                }
            }
        }
        return best;
    }

    const api = {
        neighbour,
        focusTarget,
        sharesRect,
        resizeFloat,
        resizeNeighbours,
        fillRect,
        rect,
        inset,
        contains,
        centre,
        splitH,
        splitV,
        clampSize,
        equalRects,
        workRect,
        translateClamp,
        mostlyInside
    };
    return Object.assign({}, api, {geometry: api});
});
