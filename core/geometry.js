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

    const api = {
        neighbour,
        resizeFloat,
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
