(function(root, factory) {
if (typeof module === 'object' && module.exports)
  module.exports = factory();
else
  root.Weave = Object.assign(root.Weave || {}, factory());
})(this, function() {
const dep = n => (typeof require === 'function' ? require('./' + n) : Weave);
const g = (dep('geometry').geometry || dep('geometry'));
const leaf = windowIds => ({type : 'leaf', windows : windowIds.slice(), active : 0});
const split = (dir, ratio, a, b) => ({type : 'split', dir, ratio, a, b});
function clone(tree) {
  if (!tree)
    return null;
  if (tree.type === 'leaf')
    return Object.assign({}, tree, {windows : tree.windows.slice()});
  return Object.assign({}, tree, {a : clone(tree.a), b : clone(tree.b)});
}
function windowIds(tree) {
  if (!tree)
    return [];
  if (tree.type === 'leaf')
    return tree.windows.slice();
  return windowIds(tree.a).concat(windowIds(tree.b));
}
function remove(t, id) {
  if (!t)
    return null;
  if (t.type === 'leaf') {
    const windows = t.windows.filter(w => w !== id);
    const activeId = t.windows[t.active];
    return windows.length
               ? Object.assign(
                     {}, t,
                     {windows, active : Math.max(0, windows.indexOf(activeId))})
               : null;
  }
  const a = remove(t.a, id);
  const b = remove(t.b, id);
  return a && b ? Object.assign({}, t, {a, b}) : a || b;
}
function insert(t, id, targetLeafId, edge) {
  if (!['left', 'right', 'top', 'bottom', 'center'].includes(edge))
    throw new Error('Invalid edge');
  if (!t)
    return leaf([ id ]);
  if (id === targetLeafId && windowIds(t).includes(id))
    return clone(t);
  if (!windowIds(t).includes(targetLeafId))
    return clone(t);
  t = remove(t, id);
  function visit(n) {
    if (n.type === 'split')
      return Object.assign({}, n, {a : visit(n.a), b : visit(n.b)});
    if (!n.windows.includes(targetLeafId))
      return clone(n);
    if (edge === 'center')
      return Object.assign({}, n, {windows : n.windows.concat([ id ])});
    const before = edge === 'left' || edge === 'top';
    return split(edge === 'left' || edge === 'right' ? 'h' : 'v', 0.5,
                 before ? leaf([ id ]) : clone(n),
                 before ? clone(n) : leaf([ id ]));
  }
  return visit(t);
}
function swap(t, a, b) {
  if (!windowIds(t).includes(a) || !windowIds(t).includes(b))
    return clone(t);
  function visit(n) {
    return n.type === 'leaf'
               ? Object.assign({}, n, {
                   windows : n.windows.map(id => id === a   ? b
                                                 : id === b ? a
                                                            : id)
                 })
               : Object.assign({}, n, {a : visit(n.a), b : visit(n.b)});
  }
  return visit(t);
}
function setRatio(t, path, ratio) {
  return updateRatioAtPath(t, pathParts(path), 0, ratio);
}
function pathParts(path) {
  if (Array.isArray(path))
    return path;
  return path ? path.split('.') : [];
}
function updateRatioAtPath(node, parts, index, ratio) {
  if (!node)
    return null;
  if (index === parts.length) {
    if (node.type !== 'split')
      return clone(node);
    return Object.assign({}, clone(node),
                         {ratio : Math.max(0, Math.min(1, ratio))});
  }
  const result = clone(node);
  const key = parts[index];
  if (node.type === 'split' && (key === 'a' || key === 'b'))
    result[key] = updateRatioAtPath(node[key], parts, index + 1, ratio);
  return result;
}
function dockToSide(t, id, side) {
  if (!['left', 'right', 'top', 'bottom'].includes(side))
    throw new Error('Invalid side');
  const rest = remove(t, id);
  if (!rest)
    return leaf([ id ]);
  const before = side === 'left' || side === 'top';
  return split(side === 'left' || side === 'right' ? 'h' : 'v', 0.5,
               before ? leaf([ id ]) : rest, before ? rest : leaf([ id ]));
}
function minimum(t, sizes, gap) {
  if (t.type === 'leaf')
    return t.windows.reduce((m, id) => {
      const s = sizes[id] || {};
      return {
        w : Math.max(m.w, s.w || s.width || 0),
        h : Math.max(m.h, s.h || s.height || 0)
      };
    }, {w : 0, h : 0});
  const a = minimum(t.a, sizes, gap);
  const b = minimum(t.b, sizes, gap);
  return t.dir === 'h' ? {w : a.w + b.w + gap, h : Math.max(a.h, b.h)}
                       : {w : Math.max(a.w, b.w), h : a.h + b.h + gap};
}
function constrainRatio(t, area, gap, sizes) {
  const horizontal = t.dir === 'h';
  const length = horizontal ? area.width : area.height;
  const available = Math.max(0, length - Math.min(gap, length));
  const firstMinimum = minimum(t.a, sizes, gap);
  const secondMinimum = minimum(t.b, sizes, gap);
  const dimension = horizontal ? 'w' : 'h';
  const firstSize = firstMinimum[dimension];
  const secondSize = secondMinimum[dimension];
  let ratio = Math.max(0, Math.min(1, t.ratio));
  // Keep requested ratios inside the minimum sizes of both subtrees.
  if (available && firstSize + secondSize <= available) {
    ratio = Math.max(firstSize / available,
                     Math.min(1 - secondSize / available, ratio));
  } else if (firstSize + secondSize > available) {
    ratio = firstSize / (firstSize + secondSize);
  }
  return ratio;
}
function splitArea(t, area, gap, sizes) {
  const ratio = constrainRatio(t, area, gap, sizes);
  const splitFunction = t.dir === 'h' ? g.splitH : g.splitV;
  return splitFunction(area, ratio, gap);
}
function childPath(path, key) {
  return path.concat(key);
}
function walkChildren(t, parts, gaps, sizes, fn, path) {
  walk(t.a, parts[0], gaps, sizes, fn, childPath(path, 'a'));
  walk(t.b, parts[1], gaps, sizes, fn, childPath(path, 'b'));
}
function walk(t, area, gaps, sizes, fn, path) {
  if (!t)
    return;
  if (t.type === 'leaf') {
    fn(t, area, path);
    return;
  }
  const gap = Math.max(0, gaps.inner || 0);
  const parts = splitArea(t, area, gap, sizes);
  fn(t, area, path, parts);
  walkChildren(t, parts, gaps, sizes, fn, path);
}
function layout(t, area, gaps, sizes) {
  const result = {};
  gaps = gaps || {};
  walk(t, g.workRect(area, gaps), gaps, sizes || {}, (n, r) => {
    if (n.type === 'leaf')
      n.windows.forEach(id => { result[id] = Object.assign({}, r); });
  }, []);
  return result;
}
function hitTest(t, area, gaps, point) {
  let result = null;
  gaps = gaps || {};
  walk(t, g.workRect(area, gaps), gaps, {}, (n, r) => {
    if (n.type !== 'leaf' || !g.contains(r, point))
      return;
    const distances = [
      (point.x - r.x) / r.width, (r.x + r.width - point.x) / r.width,
      (point.y - r.y) / r.height, (r.y + r.height - point.y) / r.height
    ];
    const m = Math.min.apply(null, distances);
    result = {
      leaf : clone(n),
      edge : m < 0.25
                 ? [ 'left', 'right', 'top', 'bottom' ][distances.indexOf(m)]
                 : 'center'
    };
  }, []);
  return result;
}
function edgeAt(t, area, gaps, point, tolerance) {
  let result = null;
  let distance = Infinity;
  gaps = gaps || {};
  tolerance = tolerance === undefined ? 5 : tolerance;
  walk(t, g.workRect(area, gaps), gaps, {}, (n, r, path, parts) => {
    if (!parts)
      return;
    const horizontal = n.dir === 'h';
    const end = horizontal
        ? parts[0].x + parts[0].width
        : parts[0].y + parts[0].height;
    const start = horizontal ? parts[1].x : parts[1].y;
    const pointCoordinate = horizontal ? point.x : point.y;
    const d = Math.abs(pointCoordinate - (end + start) / 2);
    const along = horizontal
        ? point.y >= r.y && point.y < r.y + r.height
        : point.x >= r.x && point.x < r.x + r.width;
    if (along && d <= tolerance + (start - end) / 2 && d <= distance) {
      distance = d;
      result = path.slice();
    }
  }, []);
  return result;
}
const SIDE_AXIS = {left : 'h', right : 'h', top : 'v', bottom : 'v'};
// Ancestors of the leaf holding id, outermost first: [{node, path, key}] where
// key is 'a' or 'b' (the child the window is in).
function ancestry(t, id) {
  const chain = [];
  let node = t;
  const path = [];
  while (node && node.type === 'split') {
    const key = windowIds(node.a).includes(id) ? 'a' : 'b';
    chain.push({node, path : path.slice(), key});
    path.push(key);
    node = node[key];
  }
  return node && node.type === 'leaf' && node.windows.includes(id) ? chain : null;
}
// Path of the nearest split whose separator is the given side of the window:
// right/bottom need the window in a, left/top need it in b. Null on the border.
function edgeForSide(t, area, gaps, id, side) {
  const axis = SIDE_AXIS[side];
  const chain = axis && ancestry(t, id);
  if (!chain)
    return null;
  const key = side === 'right' || side === 'bottom' ? 'a' : 'b';
  for (let i = chain.length - 1; i >= 0; i--)
    if (chain[i].node.dir === axis && chain[i].key === key)
      return chain[i].path;
  return null;
}
// Ratio that puts the separator at the window's new side coordinate. The
// parent rect is rebuilt from the current tree; each pane keeps minPane px.
function ratioForSide(t, area, gaps, path, side, coord, minPane) {
  gaps = gaps || {};
  const gap = Math.max(0, gaps.inner || 0);
  let rect = g.workRect(area, gaps);
  let node = t;
  for (const key of pathParts(path)) {
    if (!node || node.type !== 'split')
      return null;
    rect = splitArea(node, rect, gap, {})[key === 'a' ? 0 : 1];
    node = node[key];
  }
  if (!node || node.type !== 'split')
    return null;
  const horizontal = node.dir === 'h';
  const size = horizontal ? rect.width : rect.height;
  const innerGap = Math.min(gap, size);
  const length = Math.max(1, size - innerGap);
  const start = horizontal ? rect.x : rect.y;
  const first = side === 'right' || side === 'bottom';
  const ratio = (coord - start - (first ? 0 : innerGap)) / length;
  const low = Math.min(0.5, (minPane === undefined ? 100 : minPane) / length);
  return Math.max(low, Math.min(1 - low, ratio));
}
// Tree after moving the nearest ancestor split on the axis ('h' or 'v') so that the window
// grows by delta px (negative: shrinks). Each pane keeps minPane px. Null without such a split.
function resizeBy(t, area, gaps, id, axis, delta, minPane) {
  const chain = ancestry(t, id);
  const found = chain && chain.filter(item => item.node.dir === axis).pop();
  if (!found)
    return null;
  const horizontal = axis === 'h';
  const side = found.key === 'a' ? (horizontal ? 'right' : 'bottom')
                                 : (horizontal ? 'left' : 'top');
  const rect = layout(t, area, gaps)[id];
  const edge = {
    right : rect.x + rect.width,
    left : rect.x,
    bottom : rect.y + rect.height,
    top : rect.y
  }[side];
  const outward = found.key === 'a' ? delta : -delta;
  const ratio = ratioForSide(t, area, gaps, found.path, side, edge + outward, minPane);
  return ratio === null ? null : setRatio(t, found.path, ratio);
}
// Master count after changing it by delta: at least 1, at most windows - 1 (but not below 1).
function clampMasterCount(count, delta, windows) {
  const wanted = Math.floor(count === undefined ? 1 : count) + (delta || 0);
  return Math.max(1, Math.min(Math.max(1, windows - 1), wanted));
}
function line(list, dir) {
  if (list.length === 1)
    return leaf(list);
  return lineOf(list.map(id => leaf([ id ])), dir);
}
// Equal-sized run of subtrees along one axis (line() for nodes instead of IDs).
function lineOf(nodes, dir) {
  if (!nodes.length)
    return null;
  if (nodes.length === 1)
    return nodes[0];
  return split(dir, 1 / nodes.length, nodes[0], lineOf(nodes.slice(1), dir));
}
function columns(list) {
  return line(list, 'h');
}
function monocle(list) {
  return list.length ? leaf(list) : null;
}
function masterStack(list, nMaster, ratio) {
  nMaster = Math.max(1, Math.floor(nMaster === undefined ? 1 : nMaster));
  if (list.length <= nMaster)
    return line(list, 'v');
  const master = line(list.slice(0, nMaster), 'v');
  const stack = line(list.slice(nMaster), 'v');
  const splitRatio = ratio === undefined ? 0.6 : ratio;
  return split('h', splitRatio, master, stack);
}
// Every window a full-width row.
function rows(list) {
  return line(list, 'v');
}
// Master area on top (masters side by side), stack below (side by side).
function hstack(list, nMaster, ratio) {
  nMaster = Math.max(1, Math.floor(nMaster === undefined ? 1 : nMaster));
  if (list.length <= nMaster)
    return line(list, 'h');
  const master = line(list.slice(0, nMaster), 'h');
  const stack = line(list.slice(nMaster), 'h');
  return split('v', ratio === undefined ? 0.6 : ratio, master, stack);
}
// Mirror of masterStack: master on the right, stack on the left. The ratio is
// still the master's share, so the left child gets 1 - ratio. The leaf order is
// geometric (stack first, master last), like the spiral's.
function rmaster(list, nMaster, ratio) {
  nMaster = Math.max(1, Math.floor(nMaster === undefined ? 1 : nMaster));
  if (list.length <= nMaster)
    return line(list, 'v');
  const master = line(list.slice(0, nMaster), 'v');
  const stack = line(list.slice(nMaster), 'v');
  return split('h', 1 - (ratio === undefined ? 0.6 : ratio), stack, master);
}
// Balanced grid: ceil(sqrt(n)) columns, rows filled left to right. A short last
// row shares the full width.
function grid(list) {
  if (!list.length)
    return null;
  const cols = Math.ceil(Math.sqrt(list.length));
  const rowTrees = [];
  for (let i = 0; i < list.length; i += cols)
    rowTrees.push(line(list.slice(i, i + cols), 'h'));
  return lineOf(rowTrees, 'v');
}
// Centre column first (width ratio, default 0.5), then the right column, then
// the left one, alternating; each side column is a vertical line. Two windows
// give centre + right only.
function ultrawide(list, ratio) {
  if (list.length < 2)
    return line(list, 'v');
  const centre = ratio === undefined ? 0.5 : ratio;
  const right = line(list.filter((id, i) => i >= 1 && i % 2 === 1), 'v');
  const left = line(list.filter((id, i) => i >= 2 && i % 2 === 0), 'v');
  const side = (1 - centre) / 2;
  const middle = split('h', left ? centre / (1 - side) : centre,
                       leaf([ list[0] ]), right);
  return left ? split('h', side, left, middle) : middle;
}
function spiral(list) {
  function build(i) {
    if (i >= list.length)
      return null;
    if (i === list.length - 1)
      return leaf([ list[i] ]);
    const reverse = i % 4 >= 2;
    const rest = build(i + 1);
    const item = leaf([ list[i] ]);
    return split(i % 2 ? 'v' : 'h', 0.5, reverse ? rest : item,
                 reverse ? item : rest);
  }
  return build(0);
}
// Default maximum of tiled windows per layout; the rest of a context floats.
// Stage holds one focus window plus twelve rail cells (see stage.js).
const MAX_WINDOWS = {
  master : 8,
  columns : 6,
  rows : 5,
  spiral : 6,
  hstack : 8,
  rmaster : 8,
  grid : 9,
  ultrawide : 9,
  monocle : Infinity,
  stage : 13,
  scroll : 20
};
function maxWindows(name) {
  return MAX_WINDOWS[name] === undefined ? Infinity : MAX_WINDOWS[name];
}
function arrivalRank(ids, arrival) {
  const rank = {};
  ids.forEach(id => { rank[id] = arrival ? arrival.indexOf(id) : -1; });
  return rank;
}
// Ids sorted newest arrival first. `arrival` lists ids oldest to newest; ids it
// does not name count as the oldest.
function newestFirst(ids, arrival) {
  const rank = arrivalRank(ids, arrival);
  return ids.slice().sort((a, b) => rank[b] - rank[a]);
}
// Splits ids (layout order) into tiled and floated so that at most `limit` stay
// tiled. The newest arrivals float first; `keep` never does.
function limitSplit(ids, arrival, limit, keep) {
  const allowed = Math.max(1, limit);
  const excess = ids.length - allowed;
  if (!(excess > 0))
    return {tiled : ids.slice(), floated : []};
  const floated = newestFirst(ids.filter(id => id !== keep), arrival)
                      .slice(0, excess);
  return {tiled : ids.filter(id => floated.indexOf(id) < 0), floated};
}
function tooSmall(rect, min) {
  return !!rect && !!min && (rect.width < min.width || rect.height < min.height);
}
// Floats windows whose computed rectangle is below their own minimum size
// (`mins[id] = {width, height}`), newest arrival first and never `keep`, and
// recomputes until the rest fit or nothing more can float. params: nMaster,
// masterRatio, arrival, keep. Returns {tiled, floated}.
function fit(ids, mins, area, gaps, name, params) {
  params = params || {};
  let tiled = ids.slice();
  const floated = [];
  while (tiled.length > 1) {
    const nMaster = clampMasterCount(params.nMaster, 0, tiled.length);
    const rects = layout(
        generate(name, tiled, {nMaster, masterRatio : params.masterRatio}), area,
        gaps);
    const bad = tiled.filter(id => tooSmall(rects[id], mins[id]));
    if (!bad.length)
      break;
    let pool = bad.filter(id => id !== params.keep);
    // Only the protected window is too small: shrinking the others can help it.
    if (!pool.length)
      pool = tiled.filter(id => id !== params.keep);
    if (!pool.length)
      break;
    const victim = newestFirst(pool, params.arrival)[0];
    floated.push(victim);
    tiled = tiled.filter(id => id !== victim);
  }
  return {tiled, floated};
}
const LAYOUTS = [
  'master', 'columns', 'monocle', 'spiral', 'rows', 'hstack', 'rmaster', 'grid',
  'ultrawide'
];
// Reserved layouts have their own state and geometry (stage.js, scroll.js).
const RESERVED_LAYOUTS = [ 'stage', 'scroll' ];
function validLayout(name) {
  return LAYOUTS.indexOf(name) >= 0;
}
// Tree for a layout name; unknown and reserved names fall back to master-stack.
function generate(name, list, params) {
  params = params || {};
  if (name === 'columns')
    return columns(list);
  if (name === 'monocle')
    return monocle(list);
  if (name === 'spiral')
    return spiral(list);
  if (name === 'rows')
    return rows(list);
  if (name === 'hstack')
    return hstack(list, params.nMaster, params.masterRatio);
  if (name === 'rmaster')
    return rmaster(list, params.nMaster, params.masterRatio);
  if (name === 'grid')
    return grid(list);
  if (name === 'ultrawide')
    return ultrawide(list, params.masterRatio);
  return masterStack(list, params.nMaster, params.masterRatio);
}
// Every layout the shortcuts can cycle through: tree layouts, then reserved layouts.
const CYCLE_LAYOUTS = LAYOUTS.concat(RESERVED_LAYOUTS);
function validAnyLayout(name) {
  return CYCLE_LAYOUTS.indexOf(name) >= 0;
}
function cycleAnyLayout(name, step) {
  const index = Math.max(0, CYCLE_LAYOUTS.indexOf(name));
  const count = CYCLE_LAYOUTS.length;
  return CYCLE_LAYOUTS[((index + step) % count + count) % count];
}
function cycleLayout(name, step) {
  const index = Math.max(0, LAYOUTS.indexOf(name));
  const count = LAYOUTS.length;
  return LAYOUTS[((index + step) % count + count) % count];
}
// Window IDs in tree order (first child before second).
function leafOrder(t) {
  return windowIds(t);
}
function infer(rectsById, area, tolerance) {
  tolerance = tolerance === undefined ? 2 : Math.max(0, tolerance);
  const entries = Object.keys(rectsById || {}).map(id => ({
    id,
    rect : rectsById[id]
  }));
  if (!entries.length || !area)
    return null;
  if (entries.some(item => !item.rect || item.rect.width <= 0 ||
                           item.rect.height <= 0))
    return null;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i].rect;
      const b = entries[j].rect;
      if (a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height)
        return null;
    }
  }
  const gaps = [];
  function bounds(items) {
    const xs = items.map(item => item.rect.x);
    const ys = items.map(item => item.rect.y);
    const rights = items.map(item => item.rect.x + item.rect.width);
    const bottoms = items.map(item => item.rect.y + item.rect.height);
    return {
      x : Math.min.apply(null, xs), y : Math.min.apply(null, ys),
      right : Math.max.apply(null, rights), bottom : Math.max.apply(null, bottoms)
    };
  }
  function close(a, b) { return Math.abs(a - b) <= tolerance; }
  function build(items) {
    if (items.length === 1)
      return leaf([ items[0].id ]);
    const box = bounds(items);
    const candidates = [];
    [ 'h', 'v' ].forEach(dir => {
      const horizontal = dir === 'h';
      const axisStart = horizontal ? 'x' : 'y';
      const axisEnd = horizontal ? 'right' : 'bottom';
      const crossStart = horizontal ? 'y' : 'x';
      const crossEnd = horizontal ? 'bottom' : 'right';
      const cuts = [];
      items.forEach(item => {
        cuts.push(item.rect[axisStart], item.rect[axisStart] +
            (horizontal ? item.rect.width : item.rect.height));
      });
      cuts.sort((a, b) => a - b);
      for (let c = 1; c < cuts.length; c++) {
        const cut = cuts[c];
        const first = items.filter(item => item.rect[axisStart] +
            (horizontal ? item.rect.width : item.rect.height) <= cut);
        const second = items.filter(item => item.rect[axisStart] >= cut);
        if (!first.length || !second.length || first.length + second.length !== items.length)
          continue;
        const firstBox = bounds(first);
        const secondBox = bounds(second);
        if (firstBox[crossStart] !== box[crossStart] ||
            firstBox[crossEnd] !== box[crossEnd] ||
            secondBox[crossStart] !== box[crossStart] ||
            secondBox[crossEnd] !== box[crossEnd])
          continue;
        const gap = secondBox[axisStart] - firstBox[axisEnd];
        if (gap < 0)
          continue;
        const size = box[axisEnd] - box[axisStart];
        const available = size - Math.max(0, gap);
        if (available <= 0)
          continue;
        candidates.push({
          dir, first, second, gap: Math.max(0, gap),
          ratio: (firstBox[axisEnd] - firstBox[axisStart]) / available
        });
      }
    });
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const a = build(candidate.first);
      const b = build(candidate.second);
      if (!a || !b)
        continue;
      gaps.push(candidate.gap);
      return split(candidate.dir, candidate.ratio, a, b);
    }
    return null;
  }
  const expected = bounds(entries);
  if (!close(expected.x, area.x) || !close(expected.y, area.y) ||
      !close(expected.right, area.x + area.width) ||
      !close(expected.bottom, area.y + area.height))
    return null;
  const inferred = build(entries);
  if (!inferred)
    return null;
  const gap = gaps.length ? gaps[0] : 0;
  if (gaps.some(value => Math.abs(value - gap) > tolerance))
    return null;
  return {tree : inferred, gap};
}
const api = {
  insert,
  remove,
  swap,
  setRatio,
  dockToSide,
  layout,
  hitTest,
  edgeAt,
  edgeForSide,
  ratioForSide,
  resizeBy,
  clampMasterCount,
  masterStack,
  columns,
  monocle,
  spiral,
  rows,
  hstack,
  rmaster,
  grid,
  ultrawide,
  infer,
  LAYOUTS,
  RESERVED_LAYOUTS,
  CYCLE_LAYOUTS,
  validLayout,
  validAnyLayout,
  cycleAnyLayout,
  generate,
  maxWindows,
  limitSplit,
  fit,
  MAX_WINDOWS,
  cycleLayout,
  leafOrder
};
return Object.assign({}, api, {tree : api});
});
