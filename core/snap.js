(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const g = dep('geometry').geometry || dep('geometry');

    function halfAndQuarterActions(area, gap) {
        const halves = g.splitH(area, 0.5, gap);
        const rows = g.splitV(area, 0.5, gap);
        return {
            maximize: area,
            leftHalf: halves[0],
            rightHalf: halves[1],
            topHalf: rows[0],
            bottomHalf: rows[1],
            topLeft: g.splitV(halves[0], 0.5, gap)[0],
            bottomLeft: g.splitV(halves[0], 0.5, gap)[1],
            topRight: g.splitV(halves[1], 0.5, gap)[0],
            bottomRight: g.splitV(halves[1], 0.5, gap)[1]
        };
    }

    function addThirdActions(actions, area, gap) {
        const innerGap = Math.min(Math.max(0, gap), area.width / 2);
        const usableWidth = area.width - 2 * innerGap;
        const firstBoundary = Math.round(usableWidth / 3);
        const secondBoundary = Math.round(2 * usableWidth / 3);
        actions.leftThird = g.rect(area.x, area.y, firstBoundary, area.height);
        actions.centerThird = g.rect(area.x + firstBoundary + innerGap, area.y,
            secondBoundary - firstBoundary, area.height);
        actions.rightThird = g.rect(area.x + secondBoundary + 2 * innerGap,
            area.y, usableWidth - secondBoundary, area.height);
        actions.leftTwoThirds = g.rect(area.x, area.y,
            secondBoundary + innerGap, area.height);
        actions.rightTwoThirds = g.rect(area.x + firstBoundary + innerGap,
            area.y, area.width - firstBoundary - innerGap, area.height);
    }

    function centeredQuarter(area) {
        const width = Math.round(area.width / 2);
        const height = Math.round(area.height / 2);
        const x = area.x + Math.floor((area.width - width) / 2);
        const y = area.y + Math.floor((area.height - height) / 2);
        return g.rect(x, y, width, height);
    }

    function isComposite(action) {
        return action === 'third' || action === 'twoThirds';
    }

    function snapRect(action, area, gaps, current) {
        const workArea = g.workRect(area, gaps);
        const gap = (gaps || {}).inner || 0;
        const actions = halfAndQuarterActions(workArea, gap);
        addThirdActions(actions, workArea, gap);
        actions.centerQuarter = centeredQuarter(workArea);
        if (!actions[action] && !isComposite(action)) {
            throw new Error('Unknown snap action: ' + action);
        }
        const cycles = [
            ['leftHalf', 'rightHalf'],
            ['topHalf', 'bottomHalf'],
            ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
            ['leftThird', 'centerThird', 'rightThird']
        ];
        const composite = {
            third: ['leftThird', 'centerThird', 'rightThird'],
            twoThirds: ['leftTwoThirds', 'rightTwoThirds']
        };
        if (composite[action]) {
            const steps = composite[action];
            const at = steps.findIndex(step => current && g.equalRects(current, actions[step]));
            return actions[steps[(at + 1) % steps.length]];
        }
        const cycle = cycles.find(items => items.includes(action));
        if (cycle && current && g.equalRects(current, actions[action])) {
            const next = (cycle.indexOf(action) + 1) % cycle.length;
            return actions[cycle[next]];
        }
        return actions[action];
    }

    const api = {snapRect};
    return Object.assign({}, api, {snap: api});
});
