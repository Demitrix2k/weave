# Weave pure core

Run `node --test core/test` from the repository root, or `npm test --prefix core`.
No dependencies or desktop integration are required.

Every runtime file is an ES2017 classic script with the specified UMD wrapper.

Scroll (Pages) uses a centered normalized box (`w=.88`, `h=.56` by default;
`1,1` preserves full-area geometry). `scroll.resizeBox` and `scroll.cycleSlot`
are pure helpers for box resizing and in-place visible-slot replacement.
For QML concatenate geometry, tree, snap, stage, scroll, arrangement, context, index in
that order. Load templates.json separately as data. Node can require index.js.
Module namespaces (`geometry`, `tree`, `snap`, `stage`, `scroll`, `arrangement`, `context`)
avoid name collisions; flat exports also exist, with `layout` meaning tree layout.
Inputs are never changed. ExpectedGeometry is the intentional stateful exception:
its private event queue changes when recording or consuming expectations.

## API

- geometry: rect, inset, contains, centre, splitH, splitV, clampSize,
  equalRects, workRect, translateClamp, mostlyInside. Rectangles have x, y,
  width, height. Splits return [a,b]. translateClamp offsets between work areas,
  clamps position, and shrinks only when the rectangle cannot fit.
- tree: insert, remove, swap, setRatio, dockToSide, layout, hitTest, edgeAt,
  infer, masterStack, columns, monocle, spiral, rows, hstack, rmaster, grid,
  ultrawide. `infer(rectsById, area,
  tolerance)` returns `{tree, gap}` for non-overlapping guillotine partitions,
  where `gap` is the inferred common inner gap, or `null` when inference fails.
- snap: snapRect(action, workArea, gaps, current), all specified actions.
- tree layouts by name: LAYOUTS (`master`, `columns`, `monocle`, `spiral`, `rows`, `hstack`, `rmaster`,
  `grid`, `ultrawide`),
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
- scroll: create, clampOffset, page, layout, scrollBy, reveal, setVisible,
  toggleAxis. State is `{axis: 'h'|'v', visible, offset}`; `layout` returns
  rectangles for the visible page plus the parked IDs, and `scrollBy` supports
  page/window steps with optional wrapping.
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

### Window limits and fit

- `tree.maxWindows(name)`: default maximum of tiled windows (`tree.MAX_WINDOWS`); `Infinity`
  for monocle.
- `tree.limitSplit(ids, arrival, limit, keep)`: `{tiled, floated}`; the newest arrivals
  (`arrival` lists ids oldest to newest) float first, never `keep`.
- `tree.fit(ids, mins, area, gaps, name, params)`: `mins[id] = {width, height}`. Floats the
  newest window whose cell is below its minimum, recomputes, repeats; `params` has `nMaster`,
  `masterRatio`, `arrival`, `keep`. If only `keep` is too small, the newest others float.
- Both are pure: re-tiling is the caller's job. The adapter passes tiled plus auto-floated
  ids (arrival order) through them again on layout, master or capacity changes.

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
  gaps; spiral rotates left, top, right, bottom. rows: equal full-width rows. hstack: masters
  side by side on top (masterRatio = top share), stack side by side below. rmaster: master-stack
  mirrored (master on the right, still masterRatio wide; leaf order is stack first, master last).
  grid: ceil(sqrt(n)) columns, rows filled left to right, a short last row spans the width.
  ultrawide: first window the centre column (masterRatio wide, default 0.5), then right and
  left side columns alternating, each a vertical line; two windows give centre + right.
  Empty generators return null. Pictures: `docs/layouts/` (regenerate with
  `node core/tools/render-layouts.js`).
- Minimum sizes include all stacked windows. Infeasible split minima share
  available space in proportion to their minimum requirements, retaining bounds
  and non-overlap rather than extending outside the work area.
- Hit testing uses the closest normalized edge in the outer 25%; ties prefer
  left, right, top, bottom. Resize testing includes the gap plus tolerance
  (default 5); nearest boundary wins, then deepest on a tie. These helpers use
  unconstrained layout because their specified signatures have no minSizes.
- Centred quarter means half width and half height (quarter area). Thirds share
  rounded boundaries; two-thirds include the gap between their constituent thirds.
  The actions `third` (left, centre, right, back to left) and `twoThirds` (left, right)
  use `current` to pick the next slot; any other current rectangle gives the left slot.
  The explicit `leftThird`, `centerThird`, `rightThird`, `leftTwoThirds` and
  `rightTwoThirds` stay available as pure actions.
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
- `geometry.resizeNeighbours(rect, others, area, gaps, 'h'|'v'|'both', delta)`: tiler-style
  floating resize (kwin-rectangle fork rules). `others` are `{id, rect, movable}`; returns
  `{rect, moves: [{id, rect}]}` with the neighbours that follow a shared edge. Windows with
  `movable: false` block their side. `geometry.fillRect(rects, area, gaps)`: largest free
  rectangle or `null`.
- `tree.resizeBy(t, area, gaps, id, 'h'|'v', delta, minPane)`: moves the nearest ancestor split
  on the axis so the window grows by `delta` px (negative shrinks); `null` without such a split.
- `tree.clampMasterCount(count, delta, windows)` (1 to windows - 1, never below 1); the master
  count itself is `tree.generate('master', ids, {nMaster})` / `tree.masterStack(list, n, ratio)`.
- `stage.focusRatioAfterGrow(area, gaps, ratio, delta)`: focus ratio after the focus window
  grows by `delta` px (the caller clamps it).
