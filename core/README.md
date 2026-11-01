# Weave pure core

Run `node --test core/test` from the repository root, or `npm test --prefix core`.
No dependencies or desktop integration are required.

Every runtime file is an ES2017 classic script with the specified UMD wrapper.
For QML concatenate geometry, tree, snap, stage, arrangement, context, index in
that order. Load templates.json separately as data. Node can require index.js.
Module namespaces (`geometry`, `tree`, `snap`, `stage`, `arrangement`, `context`)
avoid name collisions; flat exports also exist, with `layout` meaning tree layout.
Inputs are never changed. ExpectedGeometry is the intentional stateful exception:
its private event queue changes when recording or consuming expectations.

## API

- geometry: rect, inset, contains, centre, splitH, splitV, clampSize,
  equalRects, workRect, translateClamp, mostlyInside. Rectangles have x, y,
  width, height. Splits return [a,b]. translateClamp offsets between work areas,
  clamps position, and shrinks only when the rectangle cannot fit.
- tree: insert, remove, swap, setRatio, dockToSide, layout, hitTest, edgeAt,
  infer, masterStack, columns, monocle, spiral. `infer(rectsById, area,
  tolerance)` returns `{tree, gap}` for non-overlapping guillotine partitions,
  where `gap` is the inferred common inner gap, or `null` when inference fails.
- snap: snapRect(action, workArea, gaps, current), all specified actions.
- tree layouts by name: LAYOUTS (`master`, `columns`, `monocle`, `spiral`),
  RESERVED_LAYOUTS (`stage`), validLayout(name), generate(name, list,
  {masterRatio, nMaster}) (unknown names fall back to master-stack),
  cycleLayout(name, step) and leafOrder(tree) (window IDs, first child first).
- stage: addWindow, removeWindow, promote, cycle, pin, unpin, swap, layout,
  layoutStacked, order, fromOrder, focusRatioForEdge. State-changing functions
  take (state, id), cycle takes (state, direction), swap takes two IDs (focus or
  rail; it does nothing when either cell is pinned). order(state) is the focus ID
  then the rail IDs by cell; fromOrder(ids, focus) is its inverse (the focus ID,
  default the first, then the rest in order via addWindow). layoutStacked is layout
  plus overflow windows sharing the rectangle of the last rail cell that has one
  (`anchor`); layoutContext uses it. focusRatioForEdge(workArea, gaps, where,
  coord) is the unclamped focus ratio implied by a dragged edge (where: focus-left,
  focus-right, left-rail, right-rail).
- tree also has CYCLE_LAYOUTS (LAYOUTS then stage), validAnyLayout, cycleAnyLayout.
- arrangement: validateTemplate returns boolean; applyTemplate returns rectangles
  in slot order; assign returns {slots: window IDs or null, unfilled: indices,
  overflow: excess IDs}. Templates are {slots: [{x,y,w,h}]}. pickWindows(activeId,
  [{id,tick,seq}], n) returns the active ID, then the most recent (highest tick),
  then never-activated (tick 0) by seq; cycleName(names, current, step) wraps.
- context: toFloat(ctx,id,geometry?), toTile(ctx,id,geometry?),
  toArrange(ctx,id,groupId,geometry?), layoutContext(ctx,area,params).
  Context has windows (array), tree, layout ('stage' or tree by default), stage,
  and groups [{id,template,assignments: ordered IDs or null}]. A transition's
  geometry argument captures the current floating rectangle before leaving float.
  Returning to float preserves floatGeom for the adapter to restore.
- ExpectedGeometry: new ExpectedGeometry(), record(id,rect), consume(id,rect),
  clear(id). Each recorded geometry matches once; unmatched events retain the queue.

## Design ambiguities and chosen policies

- `h` splits width (left/right), `v` splits height (top/bottom). Ratios apply to
  space remaining after the inner gap; the first size rounds and the second gets
  the remainder. Outer gaps apply once. Oversized gaps saturate at available size.
  contains uses half-open bounds; centres can be half-pixels. clampSize accepts
  {w,h} or {width,height} min/max bounds and preserves the origin.
- Leaves have no separate identity: targetLeafId is any window ID in the target
  stack. swap exchanges window IDs, retaining each leaf's active index. Missing
  targets are no-ops. Removal preserves the active window if possible, else uses
  index zero. Empty trees are null. setRatio/edgeAt use arrays of 'a'/'b'; setRatio
  also accepts dotted strings. Root path is []; no hit is null.
- Docking uses a 50/50 root split. Master-stack defaults to one master and 60%,
  stacking masters and secondaries vertically. Columns use equal width before
  gaps; spiral rotates left, top, right, bottom. Empty generators return null.
- Minimum sizes include all stacked windows. Infeasible split minima share
  available space in proportion to their minimum requirements, retaining bounds
  and non-overlap rather than extending outside the work area.
- Hit testing uses the closest normalized edge in the outer 25%; ties prefer
  left, right, top, bottom. Resize testing includes the gap plus tolerance
  (default 5); nearest boundary wins, then deepest on a tie. These helpers use
  unconstrained layout because their specified signatures have no minSizes.
- Centred quarter means half width and half height (quarter area). Thirds share
  rounded boundaries; two-thirds include the gap between their constituent thirds.
  current is reserved for future relative snap actions.
- Stage reserves six cells per side for stable geometry across 0–12 windows,
  including empty cells. Cell indices rank distance from the vertical centre;
  index zero is just above centre, one just below, then outward. Allocation tries
  left then right at each index and reuses vacancies. Both rails remain reserved
  with two windows; focus alone fills the work area. Beyond twelve windows,
  capacity expands. Gradient reduces outer cell width/height to at most half the
  central size, with widths anchored toward focus. Geometry never compacts after
  removal. Pinned cells cannot be promoted or selected by cycling. Removing focus
  promotes the first unpinned occupied cell; with only pinned rails focus is null.
  Positive cycle swaps with the first eligible rail, negative with the last;
  assignment remains stable except for that swap. Overflow is left then right,
  index order; overflow IDs have no rectangle and the caller creates the stack.
- Arrangement proportions were unspecified: pair-centred occupies 80% width and
  height, main-side uses 70/30, golden-split uses the golden ratio, trio columns
  use thirds and main/two-stacked uses 60/40. Touching relative edges get exactly
  the inner gap by splitting its pixels between neighbours; intentional relative
  whitespace remains. Excessive gaps collapse slots to zero size without overlap.
  Template validation permits touching edges, rejects overlap and out-of-range data.
- Context layout is explicit, with no automatic window-count switching. Groups
  use inline templates and ordered assignments. Transitions remove old membership
  and use the first group vacancy; floating geometry is remembered independently.
  layoutContext returns only rectangles; Stage overflow windows get the stack
  rectangle (layoutStacked), and stage.layout still reports them separately. Records use stageCell as adapter metadata; changing
  mode clears it. Multiple groups are independent and may occupy the same area.
- ExpectedGeometry queues multiple pending writes, allowing out-of-order events;
  unmatched events do not erase expectations. clear explicitly discards stale IDs.

## Keyboard action helpers

- `geometry.neighbour(rects, id, 'left'|'right'|'up'|'down')`: nearest rectangle whose centre
  and both edges lie further that way (nearest centre wins, first key on a tie), or `null`.
- `geometry.resizeFloat(rect, area, 'h'|'v', delta, minSize)`: floating resize, half per side,
  clamped inside the area and to `minSize`.
- `tree.resizeBy(t, area, gaps, id, 'h'|'v', delta, minPane)`: moves the nearest ancestor split
  on the axis so the window grows by `delta` px (negative shrinks); `null` without such a split.
- `tree.clampMasterCount(count, delta, windows)` (1 to windows - 1, never below 1); the master
  count itself is `tree.generate('master', ids, {nMaster})` / `tree.masterStack(list, n, ratio)`.
- `stage.focusRatioAfterGrow(area, gaps, ratio, delta)`: focus ratio after the focus window
  grows by `delta` px (the caller clamps it).
