(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const g = dep('geometry').geometry || dep('geometry');
    const epsilon = 1e-9;

    function validSlot(slot) {
        return [slot.x, slot.y, slot.w, slot.h].every(Number.isFinite) &&
            slot.x >= 0 && slot.y >= 0 && slot.w > 0 && slot.h > 0 &&
            slot.x + slot.w <= 1 + epsilon && slot.y + slot.h <= 1 + epsilon;
    }

    function overlapWidth(first, second) {
        return Math.min(first.x + first.w, second.x + second.w) -
            Math.max(first.x, second.x);
    }

    function overlapHeight(first, second) {
        return Math.min(first.y + first.h, second.y + second.h) -
            Math.max(first.y, second.y);
    }

    function slotsOverlap(first, second) {
        return overlapWidth(first, second) > epsilon &&
            overlapHeight(first, second) > epsilon;
    }

    function validateTemplate(template) {
        if (!template || !Array.isArray(template.slots)) {
            return false;
        }
        return template.slots.every((slot, index) => {
            if (!validSlot(slot)) {
                return false;
            }
            return template.slots.slice(0, index).every(other =>
                !slotsOverlap(slot, other));
        });
    }

    function touchingVertically(first, second) {
        const overlap = overlapHeight(first, second);
        return overlap > epsilon;
    }

    function touchingHorizontally(first, second) {
        const overlap = overlapWidth(first, second);
        return overlap > epsilon;
    }

    function trimForSlot(slot, slots, gap) {
        const trim = {left: 0, right: 0, top: 0, bottom: 0};
        slots.forEach(other => {
            if (slot === other) {
                return;
            }
            if (touchingVertically(slot, other) &&
                Math.abs(slot.x + slot.w - other.x) < epsilon) {
                trim.right = Math.ceil(gap / 2);
            }
            if (touchingVertically(slot, other) &&
                Math.abs(other.x + other.w - slot.x) < epsilon) {
                trim.left = Math.floor(gap / 2);
            }
            if (touchingHorizontally(slot, other) &&
                Math.abs(slot.y + slot.h - other.y) < epsilon) {
                trim.bottom = Math.ceil(gap / 2);
            }
            if (touchingHorizontally(slot, other) &&
                Math.abs(other.y + other.h - slot.y) < epsilon) {
                trim.top = Math.floor(gap / 2);
            }
        });
        return trim;
    }

    function slotRect(slot, area, trim) {
        const x = Math.round(area.width * slot.x);
        const y = Math.round(area.height * slot.y);
        const right = Math.round(area.width * (slot.x + slot.w));
        const bottom = Math.round(area.height * (slot.y + slot.h));
        const rect = g.rect(area.x + x, area.y + y, right - x, bottom - y);
        return g.inset(rect, trim.top, trim.right, trim.bottom, trim.left);
    }

    function applyTemplate(template, area, gaps) {
        if (!validateTemplate(template)) {
            throw new Error('Invalid template');
        }
        const workArea = g.workRect(area, gaps);
        const gap = Math.max(0, (gaps || {}).inner || 0);
        return template.slots.map(slot => {
            const trim = trimForSlot(slot, template.slots, gap);
            return slotRect(slot, workArea, trim);
        });
    }

    function assign(template, windowIds) {
        if (!validateTemplate(template)) {
            throw new Error('Invalid template');
        }
        const slots = template.slots.map((slot, index) =>
            index < windowIds.length ? windowIds[index] : null);
        const unfilled = slots.reduce((indices, id, index) => {
            return id === null ? indices.concat(index) : indices;
        }, []);
        return {slots, unfilled, overflow: windowIds.slice(slots.length)};
    }

    function byRecency(first, second) {
        return ((second.tick || 0) - (first.tick || 0)) || (first.seq - second.seq);
    }

    // Window IDs to place in a template: the active window first, then the most
    // recently activated; never-activated windows (tick 0) last, in arrival (seq) order.
    function pickWindows(activeId, entries, count) {
        const active = entries.filter(entry => entry.id === activeId);
        const rest = entries.filter(entry => entry.id !== activeId).sort(byRecency);
        return active.concat(rest).slice(0, Math.max(0, count)).map(entry => entry.id);
    }

    // Name `step` places after `current` in `names`, wrapping; unknown current
    // starts at the first name (forward) or the last (backward).
    function cycleName(names, current, step) {
        if (!names.length) {
            return null;
        }
        const index = names.indexOf(current);
        if (index < 0) {
            return step > 0 ? names[0] : names[names.length - 1];
        }
        const count = names.length;
        return names[((index + step) % count + count) % count];
    }

    const api = {applyTemplate, assign, validateTemplate, pickWindows, cycleName};
    return Object.assign({}, api, {arrangement: api});
});
