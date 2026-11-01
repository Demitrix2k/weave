(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Weave = Object.assign(root.Weave || {}, factory());
    }
})(this, function () {
    const dep = name => (typeof require === 'function' ? require('./' + name) : Weave);
    const geometryModule = dep('geometry');
    const treeModule = dep('tree');
    const snapModule = dep('snap');
    const stageModule = dep('stage');
    const arrangementModule = dep('arrangement');
    const contextModule = dep('context');
    const persistModule = dep('persist');
    const geometry = geometryModule.geometry || geometryModule;
    const tree = treeModule.tree || treeModule;
    const snap = snapModule.snap || snapModule;
    const stage = stageModule.stage || stageModule;
    const arrangement = arrangementModule.arrangement || arrangementModule;
    const context = contextModule.context || contextModule;
    const persist = persistModule.persist || persistModule;

    return Object.assign({}, geometry, snap, arrangement, context, persist, {
        geometry,
        tree,
        snap,
        stage,
        arrangement,
        context,
        persist,
        insert: tree.insert,
        remove: tree.remove,
        swap: tree.swap,
        setRatio: tree.setRatio,
        dockToSide: tree.dockToSide,
        layout: tree.layout,
        hitTest: tree.hitTest,
        edgeAt: tree.edgeAt,
        edgeForSide: tree.edgeForSide,
        ratioForSide: tree.ratioForSide,
        resizeBy: tree.resizeBy,
        clampMasterCount: tree.clampMasterCount,
        infer: tree.infer,
        masterStack: tree.masterStack,
        columns: tree.columns,
        monocle: tree.monocle,
        spiral: tree.spiral,
        addWindow: stage.addWindow,
        removeWindow: stage.removeWindow,
        promote: stage.promote,
        cycle: stage.cycle,
        pin: stage.pin,
        unpin: stage.unpin
    });
});
