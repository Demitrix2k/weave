(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const tree = dep('tree').tree || dep('tree');
    const stage = dep('stage').stage || dep('stage');
    const arrangement = dep('arrangement').arrangement || dep('arrangement');
    const geometry = dep('geometry').geometry || dep('geometry');

    function copyWindow(window) {
        const floatGeom = window.floatGeom && Object.assign({}, window.floatGeom);
        return Object.assign({}, window, {floatGeom});
    }

    function transitionWindow(window, id, mode, geom, groupId) {
        if (window.id !== id) {
            return copyWindow(window);
        }
        const remembered = window.mode === 'float' && geom ? geom : window.floatGeom;
        return Object.assign({}, window, {
            mode,
            floatGeom: Object.assign({}, remembered),
            groupId: mode === 'arranged' ? groupId : null,
            stageCell: null
        });
    }

    function clearGroupAssignments(groups, id) {
        return groups.map(group => Object.assign({}, group, {
            assignments: (group.assignments || []).map(windowId =>
                windowId === id ? null : windowId)
        }));
    }

    function assignToGroup(groups, id, groupId) {
        const group = groups.find(item => item.id === groupId);
        if (!group) {
            return;
        }
        const index = group.assignments.indexOf(null);
        if (index < 0) {
            group.assignments.push(id);
        } else {
            group.assignments[index] = id;
        }
    }

    function transition(ctx, id, mode, geom, groupId) {
        const result = Object.assign({}, ctx, {
            windows: ctx.windows.map(window =>
                transitionWindow(window, id, mode, geom, groupId))
        });
        const record = ctx.windows.find(window => window.id === id);
        if (!record) {
            return result;
        }
        if (record.mode === 'tiled' && mode !== 'tiled') {
            result.tree = tree.remove(ctx.tree, id);
            if (ctx.stage) {
                result.stage = stage.removeWindow(ctx.stage, id);
            }
        }
        if (mode === 'tiled' && record.mode !== 'tiled') {
            const tiled = result.windows.filter(window =>
                window.mode === 'tiled' && window.id !== id);
            const targetId = tiled.length ? tiled[0].id : null;
            result.tree = tree.insert(ctx.tree, id, targetId, 'right');
            if (ctx.stage) {
                result.stage = stage.addWindow(ctx.stage, id);
            }
        }
        if (ctx.groups) {
            result.groups = clearGroupAssignments(ctx.groups, id);
        }
        if (mode === 'arranged' && result.groups) {
            assignToGroup(result.groups, id, groupId);
        }
        return result;
    }

    function toFloat(ctx, id, geom) {
        return transition(ctx, id, 'float', geom, null);
    }

    function toTile(ctx, id, geom) {
        return transition(ctx, id, 'tiled', geom, null);
    }

    function toArrange(ctx, id, groupId, geom) {
        return transition(ctx, id, 'arranged', geom, groupId);
    }

    function tiledLayout(ctx, area, params) {
        if (ctx.layout === 'stage') {
            const state = ctx.stage || {focus: null, cells: []};
            return stage.layout(state, area, params).rects;
        }
        return tree.layout(ctx.tree, area, params.gaps, params.minSizes);
    }

    function addTiledRects(result, ctx, rects) {
        ctx.windows.filter(window => window.mode === 'tiled').forEach(window => {
            if (rects[window.id]) {
                result[window.id] = rects[window.id];
            }
        });
    }

    function addArrangedRects(result, ctx, area, params) {
        (ctx.groups || []).forEach(group => {
            const slots = arrangement.applyTemplate(group.template, area, params.gaps);
            (group.assignments || []).forEach((id, index) => {
                const belongsToGroup = ctx.windows.some(window =>
                    window.id === id && window.mode === 'arranged' &&
                    window.groupId === group.id);
                if (slots[index] && belongsToGroup) {
                    result[id] = slots[index];
                }
            });
        });
    }

    function layoutContext(ctx, area, params) {
        params = params || {};
        const rects = tiledLayout(ctx, area, params);
        const result = {};
        addTiledRects(result, ctx, rects);
        addArrangedRects(result, ctx, area, params);
        return result;
    }

    class ExpectedGeometry {
        constructor() {
            this.pending = new Map();
        }

        record(id, rect) {
            const queue = this.pending.get(id) || [];
            queue.push(Object.assign({}, rect));
            this.pending.set(id, queue);
        }

        consume(id, rect) {
            const queue = this.pending.get(id) || [];
            const index = queue.findIndex(expected =>
                geometry.equalRects(expected, rect));
            if (index < 0) {
                return false;
            }
            queue.splice(index, 1);
            if (queue.length) {
                this.pending.set(id, queue);
            } else {
                this.pending.delete(id);
            }
            return true;
        }

        clear(id) {
            this.pending.delete(id);
        }
    }

    const api = {toFloat, toTile, toArrange, layoutContext, ExpectedGeometry};
    return Object.assign({}, api, {context: api});
});
