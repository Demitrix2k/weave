# Unified KWin window manager script: design draft

Working name: **Weave** (placeholder). One KWin script that replaces Krohnkite + Rectangle.

Status: theoretical draft, 2026-10-24. Items marked **[verify]** are KWin 6.8 API assumptions to check with a throwaway script before relying on them.

## 1. Goals

| # | Goal | Replaces |
|---|------|----------|
| G1 | **Floating**: windows are free. Dragging never triggers re-layout. Keyboard snap actions are one-shot geometry commands. | Rectangle |
| G2 | **Tiled**: the layout owns geometry. Dragging a window *re-slots* it (swap/insert), never leaves a hole. | Krohnkite |
| G3 | **Adjustable layouts for many windows**: tree/BSP, master-stack, columns, monocle; resize by edge. | Krohnkite layouts |
| G4 | **Arrangements for a few windows**: hand-composed, aesthetic placement (gaps, margins, ratios, centred pair, offset trio) that stays floating but can be re-applied. | `arrange-apps` hack, Rectangle thirds/quarters |
| G5 | One mode per window, visible and switchable with one key, one shortcut vocabulary. | `Meta+F` workaround today |

Non-goals: animations (the Geometry Change effect already covers that), a compositor/effect, scrolling-tiler features (niri-style) in v1.

## 2. UX principles

I couldn't get a transcript of the Scott Jenson talk (the fetch returned only YouTube chrome), so these are **my** principles. Replace or amend them with the points you noted from the video.

1. **Window management is chore work; the manager should absorb intent.** The user says "these two side by side" once, and the system remembers it. This is the point of Arrangements.
2. **Direct manipulation beats modes.** Dragging is the most natural gesture, so it must always do something predictable per mode (see section 4) and show a preview before release.
3. **Mode is visible.** A tiled window and a floating window should look different (border colour or title-bar hint) so nobody has to guess why a drag did or didn't stick.
4. **Escape hatches are cheap.** A modifier held during drag temporarily flips the mode. Undo of the last layout action exists.
5. **One modifier per job** (existing scheme): Meta focus, +Shift move, +Ctrl resize, +Alt snap.
6. **No surprises on unplug/dock.** The XG Mobile changes outputs; layouts must survive output loss and return.

## 2a. Memory model from the talk: spatial, associative, episodic

From the slides (ultrawide edge-parking, a scrapbook of related items, and an activity timeline). Mapped to what this script can reasonably do:

| Memory type | In the talk | Here | Scope |
|---|---|---|---|
| **Spatial** | Things stay where you put them; edges are parking space; depth shrinks things toward the edge | Stable rail cells, swap-in-place promotion, depth gradient (7a); arrangements restore positions | v0.3 |
| **Associative** | Related items grouped (a scrapbook beside the document; a graph of related pages and clipboard flow) | Windows can join a named **task group** (extends Groups/stacks): switching to a group brings its windows to the Stage together. Linking is manual in v1; no content inference. | v0.4+ |
| **Episodic** | A timeline of what you did, by app and duration, to jump back to | The model already needs a **focus history** for recency; log `(time, class, caption, duration)` to a local file from day one, and put a timeline overlay on it later. Privacy: local only, capped, off switch. | log in v0.2, UI later |

Cheap now, expensive to retrofit: record focus history and keep window identity stable across restarts (class + caption pattern, not just id).

## 2b. Field feedback (2026-11-01): float first, and restore on login

After about a week of mainly using Rectangle (floating snap, no tiler):

1. **It works great**, so floating-with-snap is the primary experience, not a fallback. Tiling is the opt-in extra. This matches the adapter's inert default (`manageClasses` empty) and puts v0.1 (float + snap, section 11) first in priority.
2. **Windows and positions are remembered across login with floating windows, but not with Krohnkite.** Hypothesis **[verify]**: KWin/the apps restore geometry as each window appears, and a tiler that retiles on every `windowAdded` (Krohnkite does) then overwrites the restored positions with its own layout, window by window, before the session has settled. A floating-only setup never touches them.

**Requirements this adds**

| # | Requirement |
|---|---|
| R1 | **Do not move windows at startup.** After load, and while windows are still appearing, the script only observes. It acts after a settle period (no `windowAdded` for N seconds, default 3, configurable) and then only *adopts* what is there. |
| R2 | **Adopt, don't reorganise.** Floating windows stay exactly where the session restore put them. For windows that were tiled, rebuild the tree from their current geometry (windows whose rectangles share edges form splits; a guillotine partition inference) instead of re-running the generator. A window set that does not fit a clean partition stays floating. |
| R3 | **Persist only what geometry cannot say:** which windows are tiled or arranged, Stage pins, group membership. Window identity is class plus a caption pattern (section 2a), not the id. |
| R4 | **No automatic retile verb on login.** `Retile` is manual. |
| R5 | A **login test** is part of phase acceptance: log out and in with a mixed floating/tiled setup and compare geometries before and after. |

**Open question: where to persist (R3).** KWin scripts have no file API. Candidates **[verify]**: a QML `main.qml` using `Qt.labs.settings`/a file-backed store, writing KConfig through `callDBus`, or a small helper outside KWin (a user service the script talks to over D-Bus, which would also fit the shortcut-profile tooling). If none is reliable, R2 alone covers the common case, since geometry survives and the tree can be inferred.

## 3. Architecture

Three layers, so the interesting logic is testable with plain `node` and doesn't need KWin running.

```
┌──────────────────────────────────────────────────────────┐
│ Adapter (KWin-specific)     main.js + ui/*.qml           │
│  signals in, geometry out, shortcuts, overlay, config    │
├──────────────────────────────────────────────────────────┤
│ Controller                  controller.js                │
│  event → intent → model mutation → layout → apply       │
├──────────────────────────────────────────────────────────┤
│ Model + Layout engine (pure) model.js, layouts/*.js      │
│  Context, Group, Node tree, Slot sets; no KWin imports   │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Model

- **Context** = (output, virtual desktop). Required because `PerOutputVirtualDesktops=true`: each monitor shows its own desktop. All state hangs off a Context.
- **Window record** `{ id, mode: float|tiled|arranged, ctx, floatGeom, groupId? }`. `floatGeom` is the remembered free rectangle, used to restore on untile.
- **Tile layer** (per Context): an ordered tree of splits with ratios (BSP). Master-stack, columns and monocle are *generators* that produce the same tree, so edge-resize and drag-reorder work uniformly. One tree per Context instead of Krohnkite's separate layout classes.
- **Arrangement layer** (per Context): zero or more **Groups**. A Group is a *template* (list of slots with geometry relative to the work area, plus gap/margin/aspect rules) and an assignment window→slot. Templates are data (JSON in config), e.g. `pair-centred`, `main+side`, `trio-cascade`, `golden-split`.
- **Layout function**: `layout(context) → Map<windowId, Rect>`. Pure; unit-testable.

### 3.2 Controller

Event → intent mapping with a **re-entrancy guard**: every geometry the script sets is recorded as "expected"; the resulting `frameGeometryChanged` is ignored if it matches. This is the main source of fighting/jitter in tilers.

Intents: `Float(w)`, `Tile(w)`, `Arrange(w, group)`, `Retile(ctx)`, `Snap(w, action)`, `Reorder(w, target, edge)`, `ResizeEdge(node, delta)`, `Undo`.

### 3.3 Adapter

KWin 6 script API pieces needed:

| Need | API | Note |
|------|-----|------|
| Window lifecycle | `workspace.windowAdded/Removed` | filter by rules (class, type, transient) |
| Drag start/stop | `window.interactiveMoveResizeStarted/Finished`, `…Stepped` | `Stepped` drives the drop preview |
| Move vs resize | `window.move` / `window.resize` flags | decides reorder vs edge resize |
| Work area | `workspace.clientArea(KWin.PlacementArea, output, desktop)` | respects panel |
| Cursor | `workspace.cursorPos` | drop target hit-testing |
| Per-output desktop | `workspace.currentDesktopForScreen` (or equivalent) | already used by Directional Focus |
| Set geometry | `window.frameGeometry = rect` | guarded by 3.2 |
| Shortcuts | `registerShortcut(...)` | all verbs registered here |
| Overlay | QML via `Loader`, like the cheat sheet | drop preview, mode HUD, template picker |
| Config | `readConfig` + `contents/config/main.xml` + `kcfg` UI | |

**Alternative worth evaluating [verify]:** use KWin's *native custom tiles* (`workspace.tilingForScreen`, `Tile.relativeGeometry`, `Tile.manage`, `Tile.split`) as the tiled-mode backend instead of setting geometry ourselves. Pros: native edge dragging, no fight with the compositor, correct on Wayland, snap-to-tile visuals for free. Cons: KWin un-tiles a window the moment you drag it out (we would need to re-insert on `Finished`), script API is thin on creating/destroying layouts, and the layout is per-output only, not per-(output, desktop), so we'd have to swap tile trees on desktop change. Recommendation: prototype both in a 100-line spike; choose after seeing how the drag-out behaviour feels.

## 4. Drag semantics (the central UX contract)

| Window mode | Drag title bar | Drag edge (resize) | Release |
|---|---|---|---|
| **Floating** | Free move. Optional edge/corner **snap zones** show a preview (the Rectangle half/quarter/third zones) and snap on release. No re-layout of others. | Free. | Remember `floatGeom`. |
| **Tiled** | Window lifts out visually; an overlay shows the **drop target** under the cursor (swap with this window / insert left-right-above-below it). | Moves the shared edge; neighbours reflow (tree ratio change). | Commit to the slot. If dropped outside any target, **spring back**: this is the "enforces itself" rule. |
| **Arranged** | Free move (it's floating), but a ghost shows its slot; releasing within ~N px of the slot snaps to it, farther than that detaches it from the group. | Free; edge-resize near another group member offers to link the shared edge. | Optional. |

**Modifier flips** during drag (one key, e.g. Shift): floating→behaves as tiled drop; tiled→temporarily free, and on release the window is *floated* (mode change), not sprung back. This gives G2 and G1 without making users switch modes first.

Mode switching verbs: `Meta+F` toggle float/tiled (kept). New window default per rule: tile if class in `tilingClass`, else float (matches today's `floatDefault=true` + class list).

## 5. Snap actions (Rectangle, kept scope)

Only what's used today: halves, quarters, thirds, maximize-in-gaps, centred quarter. Plus the fork's Grow/Shrink/Fill actions. They're **pure functions** `(workArea, gaps, current) → Rect` in `snap.js`.

Unification rule that removes today's wart: **a Snap on a tiled window converts it to floating first**, then snaps. The user no longer needs `Meta+F` before `Meta+Alt+←`.

Snap + Arrangement: snapping two windows to left half / right half can offer "save as arrangement" (see 6).

## 6. Arrangements (G4, the new idea)

For the two-terminals-with-a-gap look in your first screenshot.

- A template is a set of slots in **relative units** with an aesthetic spec: outer margin, inner gap, aspect/golden ratio, optional vertical offset.
- Applying: `Meta+Alt+Space` opens a small QML picker listing templates; pick one and the focused window plus the next-most-recent N-1 windows fill slots in recency order (reorder by drag in preview).
- Persistence: a Group stores `{template, slot→window class+caption}` so `arrange-apps` (Zen left / Vesktop right, ~1492 px) becomes a saved arrangement with a hotkey, not a bespoke script. Resolves the current hack of driving Krohnkite shortcuts through kglobalaccel.
- Group edges are **soft links**: while a group is intact, resizing one window offers to resize the neighbour (like Rectangle's fork "shared edge moves together").
- "Re-apply" key snaps the group back after you've wandered off.

## 7. Layout engine detail

- Tree nodes: `Split{dir, ratio, a, b}` and `Leaf{windowId}`. Min-size aware: clamp ratios to `window.minSize`.
- Generators from the tree: `master-stack(nMaster, ratio)`, `columns`, `monocle`, `spiral`. Switching generator re-derives the tree from the current leaf order.
- Gaps: `outer` and `inner`, applied after ratio math so snapping and tiling look identical.
- Resize: dragging an edge finds the split node whose boundary is under the cursor and edits its ratio; the "grow/shrink 76 px" steps used by Arrange Apps become `ResizeEdge(node, ±px)`.

## 7a. Focus layout ("Stage"), from the video

Idea: the window you are working in sits large in the **centre**; windows you are not using sit at the **sides**, smaller, so more of them stay visible without competing for attention. Similar in spirit to a centre-master tiler, niri's carousel, or macOS Stage Manager, but driven by **recency/focus**, not by a fixed master slot.

**Geometry**
- Slots: one **Focus** slot (centre, ratio `focusRatio`, default ~60 % of the work area width) and a **left rail** and **right rail** for the rest. Gaps are user-set, 0 allowed, no overlap.
- Rail cells are smaller rectangles stacked along the rail, and **cell positions are stable** (spatial memory, see 2a). Promotion is a **swap in place**: the promoted window's cell is taken by the old focus window, so nothing else moves. New windows take the free cell nearest the centre. Recency does *not* reorder the rails, which corrects my first draft.
- **Depth gradient** (from the talk's grid/perspective visual): cells shrink with distance from the centre, so the outer edge holds the most windows at the smallest size.
- **Ultrawide premise:** the talk's demo is a 3440 px display; on your 16:9 1440p monitors the rails are narrower relative to the focus area, so `focusRatio` and the gradient need tuning, and Stage should be per monitor, not spanning both.
- Overflow: when cells would fall below a minimum size, extra windows collapse into a **stack** in the last rail cell (this is why stacks, Q7, matter here).

**Behaviour**
- Focusing a rail window (click, key, or Directional Focus) **promotes** it to the Focus slot; the old focus window takes its place in the rail. No manual tiling action needed. This is the "absorb the chore" principle.
- `focusRatio` is the one thing edge-resizing changes in this layout. Other geometry stays derived.
- Dragging a window onto the Focus slot swaps it in; dragging out of it to a rail swaps back.
- Pin: a window can be pinned to a rail cell so it doesn't rotate (e.g. Vesktop on the right).

**Scaling the side windows: three options**

| Option | What it is | Verdict |
|---|---|---|
| A. Real resize | Rail windows are actually smaller; apps reflow | **v1.** Plain geometry, works with input and Wayland, same engine as everything else. Limit: apps with a minimum size (clamp, then overflow to stack). |
| B. Visual scale | Parked windows keep their real layout but are drawn as miniatures, as in the talk's screenshots (same content, smaller, so you can still glance at what's in them) | This is the *intended* look; A (reflow) shows less content, not a smaller copy. Two ways: (B1) scripted effect scaling the real window: KWin doesn't remap input for effect-scaled windows, so clicks would land wrongly; (B2) a QML overlay with live window thumbnails (`WindowThumbnailItem`, what Overview/Present Windows use) that handles clicks and promotes the window, with the real windows kept out of the way. B2 is the likelier route **[verify]** that it works from a script's QML on Wayland, how the real windows are parked, and iGPU cost. Spike before committing. |
| C. Scale only in an overview | Used only during a Mission-Control-like gesture | Out of scope; KDE's Overview already exists. |

Implementation note: Stage is a **slot-set generator with recency assignment**, not a binary tree. It plugs into the same Context so `layoutRules` can pick it (1 window maximize, 2 pair, 3+ Stage) and the user can switch to it with a layout key like any other.

## 8. Multi-monitor / dock

- Layout state keyed by `(outputName, desktopId)`; on output removal, windows keep mode and are migrated to the surviving output's context; on return, remembered contexts are restored by output name/serial.
- Per-output desktops: use the same call as Directional Focus to learn which desktop a screen shows.

## 9. Risks and edge cases

- **Fighting the compositor**: tiled windows that refuse to shrink (min-size), CSD apps with shadows (Zen, Vesktop, Claude): use `frameGeometry` not `clientGeometry`.
- **Rounded Corners effect** and Klassy: unaffected, geometry only.
- **KWin 6.8.1 multi-GPU regression**: not related, but our overlay must be lightweight (it composites on the iGPU).
- **Perf on drag**: `Stepped` fires per frame; keep hit-testing O(leaves).
- **Games/fullscreen**: never manage fullscreen or screen-sized borderless windows (the same probe `plasma-theme-sync` uses).
- **Transient/dialog windows**: float by default, centred on parent.
- **Shortcut collisions**: reuse the existing key map so nothing in `kglobalshortcutsrc` has to move.

## 10. Reuse

- Krohnkite is MIT: layout maths and the ignore/float rule model can be adapted with attribution.
- Your kwin-rectangle fork: geometry functions for snap and Grow/Shrink/Fill. Check its licence before copying.
- Cheat-sheet project: QML overlay plumbing, config page plumbing, build script and release flow.
- Directional Focus: already independent and stays a separate script.

## 10-spike. Findings from the drag-log spike (2026-10-25, KWin 6.8.0)

Ran `spikes/drag-log/` in the live session (logging only, since removed): 8 windows seen, 6 drags of one window (5 moves, 1 resize; one of them an edge tile), no errors in the handlers.

| Finding | Consequence |
|---|---|
| `interactiveMoveResizeStarted/Stepped/Finished` fire with correct `move`/`resize` flags; cursor position is readable at each step. | The drag contract (section 4) and drop-target preview are feasible as designed. |
| **Window geometry is fractional** (e.g. `x: 1190.4`, `width: 1231.9999999999995`). | The model must round to whole pixels at the adapter boundary before comparing or setting geometry, or the expected-geometry guard misses matches. |
| `frameGeometryChanged` fired ~1,000 times in a few minutes of normal use. | The guard must match recorded geometries, not just react to the signal; never retile on every change event. |
| Native tile API present: `workspace.tilingForScreen(...).rootTile`, per **output** only; tiles have `manage`, `unmanage`, `split`, `remove`, `resizeByPixels`, `moveByPixels`, `pick`, `relativeGeometry`, `layoutDirection`, `layoutModified`, and signals. `workspace.outputs` is absent, `workspace.screens` works. | Native tiles are a credible later backend; no per-desktop trees, so we would swap trees ourselves. |
| **Edge drag does engage native tiling.** One drag to the right edge produced `dragFinished` with `tileChanged: true`, then a `tileChanged` signal 25 ms later; the window got a tile with `relativeGeometry {x: 0.6227, y: 0, width: 0.3773, height: 1}` (a custom-layout column, not a fixed half). At `Finished` the frame geometry was still the pre-snap one; KWin applies the tile geometry after. A helper window with empty class and caption (1440x1346) appeared during the drag. | **KWin's own edge tiling competes with ours.** The adapter must either turn Plasma's edge tiling off in the profile/install step, or drop the tile on `tileChanged` (`window.tile = null`) and let our model decide. Handlers that act on `Finished` (spring-back, re-slot) run *before* KWin applies the tile, so order matters. Ignore windows with empty class and caption (drag helpers). Native tiles are therefore real, and the own-geometry backend (section 12) must defend against them. |

## 10a. Prior art: Komorebi (Windows, Rust)

Recalled from memory, **[verify]** against its docs before copying any detail. Windows-only and an external daemon, so nothing is reusable as code, but several ideas map straight onto our goals.

| Komorebi idea | What it is | How it lands here |
|---|---|---|
| **Layout rules by window count** | A workspace can map "N windows → layout", e.g. 1 = maximized, 2 = side by side, 3+ = BSP | Answers G3 vs G4 directly: few windows use an Arrangement template, many fall through to the tiling tree. Each Context gets `layoutRules: {1: …, 2: …, 3+: …}`. |
| **Custom layouts as data** | Layouts defined declaratively (columns/rows with ratios) rather than in code | Same as our Arrangement templates; keep the template format close to this so layouts are shareable. |
| **Containers / stacks** | A tile slot can hold several windows with one visible, cycle through them | New: a Leaf may hold a **stack**. Gives tabbed-in-a-tile for free and lets a 3-window arrangement keep a 4th window parked. |
| **Floating layer + per-window float override** | Rules decide manage / ignore / float; a toggle overrides | Matches our float default plus class list; formalise as match rules (class, caption regex, window type). |
| **Workspaces owned by a monitor** | Each monitor has its own ordered workspaces with their own layout | Equals our (output, desktop) Context, and matches your per-output desktops. |
| **Declarative config, hot reload** | One JSON file, live reload | Keep templates, rules and gaps in a file read via `readConfig`/a JSON path, not only in the kcfg UI. |
| **CLI/IPC verbs + event subscribers** | Every action is a command; other tools subscribe to events | KWin scripts can't host a socket, so expose verbs as `registerShortcut`s and optionally as a D-Bus-callable script entry **[verify]**. Event output (current mode/layout) can go to a tiny status file for the panel. |
| **Window borders / unfocused dim** | Overlay border shows focus and mode | We already have Rounded Corners outlines; mode colour could ride on that, or on a QML overlay. |
| **Padding offsets / work-area offset** | Reserve space for bars | Already covered by `clientArea` plus outer gap. |
| **Mouse drag to reorder** | Dragging between containers swaps them | Our tiled-mode drop-target rule (section 4). |

Things Komorebi shows to avoid: a config surface so large that most of it is unused (your own stated need is a handful of actions; keep v1 small), and layout state living outside the WM so it can disagree with reality (in-process KWin avoids that).

## 10b. Prior art: Hyprland (and the i3/sway lineage)

Recalled from memory, **[verify]** details. Hyprland is the closest model for "floating and tiled in one WM".

| Hyprland idea | What it is | How it lands here |
|---|---|---|
| **Per-window float toggle, same verbs** | `togglefloating` flips a window; `movefocus`, `movewindow`, `resizeactive` work on either kind | The base of the overlap idea in section 12: one verb, behaviour chosen by the window's mode. |
| **Mouse binds (`bindm`)** | Modifier+LMB drag moves, modifier+RMB drag resizes, for any window. Dragging a tiled window re-slots it; dragging a floating one moves it | Exactly our section 4 contract. In KWin the modifier+drag is a built-in Window Action; the script only reacts to `interactiveMoveResize*`, so set the modifier in System Settings. |
| **Dwindle layout** | BSP tree; new window splits the focused one; `togglesplit`, `preserve_split`; **pseudotile** keeps a window's own size inside its tile | Our tree already is this. Add **pseudotile** as a per-leaf flag: the tile reserves the slot but the window keeps its preferred size, centred. Good for dialogs, terminals, and the aesthetic goal. |
| **Master layout** | Master area plus stack, `mfact`, orientation, new-is-master | A generator, as in section 7. |
| **Groups** | Tabbed container of windows in one tile | Same as Komorebi stacks; one design, both references. |
| **Special workspace** | Toggleable scratchpad overlay | Out of scope for v1; KDE has no equivalent worth faking. |
| **Submaps** | A modal key set, typically `resize` | Possible with temporary shortcuts (the cheat sheet already does this with 42 of them), but fragile: leftovers in `kglobalshortcutsrc` if the script dies. Prefer the Ctrl-resize chord; offer a submap only if wanted. |
| **Per-workspace rules** | Layout options per workspace (gaps, layout) | Our Context carries its own layout, gaps and `layoutRules` (section 10a). |
| **Bind flags** | repeat on hold, release, locked, mouse | KWin shortcuts have no repeat; holding a key to keep growing a window isn't possible, so resize steps must be sizeable (~76 px as in Arrange Apps) or use the drag. |

## 10c. Bindings: shared vocabulary and overlap

### What tiling managers agree on

Across i3, sway, Hyprland, Komorebi and Krohnkite, the shared vocabulary is:

| Verb | Common binding | Notes |
|---|---|---|
| Focus direction | `Mod+arrows` and `Mod+h/j/k/l` | vim aliases are universal |
| Move window | `Mod+Shift+arrows/hjkl` | |
| Resize | `Mod+r` mode, or `Mod+Ctrl+arrows/hjkl` | modifier variant fits KDE better than a mode |
| Workspace N | `Mod+1..9` | |
| Send to workspace N | `Mod+Shift+1..9` | broken on Norwegian layout (Shift+digit gives `!`/`"`), you already use `Meta+Ctrl+1/2` |
| Toggle float | `Mod+Shift+Space` or `Mod+V`/`Mod+F` | you use `Meta+F` |
| Fullscreen | `Mod+F` | clashes with float on `F`; keep fullscreen on KDE's own `Meta+PgUp`-style or leave default |
| Layout / split | `Mod+e`, `Mod+s`, `Mod+t`... | no consensus; yours (`Meta+T`, `Meta+M`) is fine |
| Close | `Mod+Shift+q` or `Mod+q` | KDE `Alt+F4` stays |

### What KDE already expects

Plasma defaults: `Meta+arrows` quick-tile, `Meta+Ctrl+←/→` desktops, `Ctrl+F1..` desktops, `Meta+Tab`/`Alt+Tab` switching, `Meta+W` overview, `Meta+D` show desktop. Your current map already follows the shared vocabulary and keeps KDE's desktop keys, which is why I'd **not** change the modifier meanings: **Meta focus, +Shift move, +Ctrl resize, +Alt snap, Ctrl desktops**.

### Overlap: one key, mode-dependent behaviour

Instead of two key sets (Krohnkite's and Rectangle's), each verb has one key and the meaning follows the focused window's mode. Mode must be visible (principle 3), or overlap becomes confusing.

| Key (existing) | Floating window | Tiled window | Arranged window |
|---|---|---|---|
| `Meta+arrows` / `hjkl` focus | nearest window that direction (Directional Focus rule) | same | same |
| `Meta+Shift+arrows` move | nudge by step; at screen edge, jump to next monitor | swap with neighbour that direction | move to adjacent slot |
| `Meta+Ctrl+arrows` resize | grow/shrink with the fork's "shared edge moves together" rule | move the shared tree edge | move linked edge |
| `Meta+Alt+arrows` snap | half / quarter zones | **dock to that screen side** (new root split on that side), *or* float + snap (see Q8) | snap to slot / detach |
| `Meta+Alt+U/I/J/K` corners | quarter | float + quarter | float + quarter |
| `Meta+Alt+D/F/G` thirds | third | float + third | float + third |
| `Meta+F` | float → tile | tile → float | detach from group, float |
| `Meta+T` / `Meta+M` | convert current context's windows to the tree layout / monocle | same | same |

Rules that keep this predictable:

1. **Snap always produces a floating-style result** (a plain rectangle) unless the user chose "dock", so the old "Rectangle doesn't work on tiled windows" problem disappears.
2. **The Alt layer is the explicit floating vocabulary**: it always means geometry, whatever the mode. The plain and Shift/Ctrl layers are "do the natural thing for this mode".
3. **Mouse mirrors keys**: modifier+drag move → per-mode drag contract; modifier+right-drag resize → edge or free resize.
4. **Never overlap across a mode change silently**: any key that converts a window (snap on a tiled window) flashes the mode HUD.
5. **Conflicts to resolve in the doc before coding**: `Ctrl+Shift+L` (cheat sheet), kitty's layout key, and anything on `Meta+Alt+*` that KDE binds.

## 11. Phased plan

0. **Shortcut profile switcher (11a):** capture the current Krohnkite + Rectangle setup as a profile, build `save/apply/off/status`, solve the "running kglobalacceld ignores changes" question, and test a round trip. Nothing below starts until `off` is proven.
1. **Spike (1 weekend):** print a window's drag events; test native `Tile` API vs `frameGeometry` for the drag-spring-back behaviour. Decide backend.
2. **v0.1 Float + Snap:** parity with kwin-rectangle fork, plus drag snap zones with preview.
3. **v0.2 Tiled:** BSP tree, drop-target overlay, edge resize, `Meta+F`, spring-back.
4. **v0.3 Arrangements:** templates, picker, saved groups, port `arrange-apps`. Stacks and the **Stage** layout (7a, option A) land here too.
5. **v0.4 Polish:** mode indicator, undo, rules UI, output hot-plug.
6. **Retire** Krohnkite, kwin-rectangle and arrange-apps; keep a migration note in `AGENTS.md`.

## 11a. Prerequisite: shortcut profile switcher (build this first)

Requirement (2026-10-25): before the new script ever runs for real, there must be a tool that **backs up the current shortcuts, installs the new script's shortcuts, and when the new script is turned off puts the old ones back.** Two scripts claiming the same keys, or a half-reverted rc file, would leave the desktop in a state that's annoying to debug, so this lands as **phase 0**.

**Shape:** a user-level script in `~/.config/scripts/kwin/` (fish or python, not root; the repo conventions apply: `--dry-run`, `fish -n`/`sh -n` check, no hardcoded home). Working name `kwin-profile`.

| Command | Does |
|---|---|
| `kwin-profile save <name>` | Snapshot the *managed set* of shortcuts + plugin flags from the live config into `profiles/<name>/`. |
| `kwin-profile apply <name> [--dry-run]` | Take a timestamped full backup, then switch to the profile (steps below). |
| `kwin-profile off` | Re-apply the profile that was active before the last `apply` (default: `krohnkite-rectangle`). One command, usable from any terminal, so a broken key map can't lock you out. |
| `kwin-profile status` / `diff <name>` | Show active profile and any drift between live config and the profile. |
| `kwin-profile list` | Profiles and backups. |

**What a profile contains**
- **Managed set:** the list of actions the profiles care about (Krohnkite's, kwin-rectangle's, Directional Focus's, Arrange Apps's, KWin's own rebound window actions such as Window to Desktop, the new script's). It is the *union* across profiles, stored once in `managed.txt`.
- **Per profile:** the value of every action in the managed set (`none` for ones the profile doesn't use). Applying writes all of them, so switching is symmetric and lossless: actions outside the managed set (your other KDE shortcuts) are never touched, and shortcuts you changed *after* the last save aren't clobbered by a whole-file revert.
- **Plugin flags** in `kwinrc` `[Plugins]`: `krohnkiteEnabled`, the kwin-rectangle and `arrange-apps` flags, the new script's. Only the target profile's scripts are enabled, so nothing else registers keys.
- Script settings sections (`[Script-krohnkite]`, etc.) stay put; they are harmless while a script is disabled.

**Apply sequence**
1. Full timestamped backup of `kglobalshortcutsrc` and `kwinrc` into the existing `~/.local/share/kglobalshortcuts-backups/`.
2. Disable the outgoing profile's scripts, enable the incoming ones (`kwriteconfig6`, then `qdbus6 org.kde.KWin /KWin reconfigure`; the "toggle off and on" caveat from `AGENTS.md` applies).
3. Write the managed set's shortcut values.
4. Make the running `kglobalacceld` pick them up: **talk to it over D-Bus, don't edit the rc file.** HyprKwin's tool does exactly this (see 11b): `org.kde.KGlobalAccel.setForeignShortcut(action, keys)` changes any component's shortcut live, the way System Settings does, and needs no logout. Free the key from its old owner first, then re-register ours (`set []`, then `set [key]`), because the daemon gives a key only to the action that registered it first. Fallback if D-Bus misbehaves on this Plasma: write the files and say "log out and in".
5. Verify: read each action's live shortcut back via D-Bus and report mismatches. Exit non-zero on any.

**Safety**
- Never edits `kglobalshortcutsrc` in place without the backup existing first.
- `off` must work with no GUI and no working shortcuts: it runs from a plain terminal tab.
- Ships with two initial profiles: `krohnkite-rectangle` (captured from the live system **before** anything else is installed) and `weave` (generated from the key map in 10c/12a).
- Profiles live in `scripts/kwin/profiles/` so chezmoi tracks them; the timestamped backups stay untracked (as today).
- Testing the new script without touching live shortcuts: a nested KWin session probably still shares the user's kglobalacceld, so don't assume it is isolated **[verify]**; the profile tool's `--dry-run` and backup are the real safety net.

### 11b. How HyprKwin does it (read 2026-10-25)

Source: `~/.local/share/kwin/scripts/hyprkwin/contents/tools/hyprkwin-shortcuts.py` (301 lines, Python with `dbus-python`; `PySide6` only for printing key names). Both are installed here. It is the closest existing solution to 11a.

| Aspect | HyprKwin | Take for `kwin-profile` |
|---|---|---|
| Channel | Live **D-Bus** to `org.kde.kglobalaccel`: `allComponents`, `Component.allShortcutInfos`, `getGlobalShortcutsByKey`, `setForeignShortcut` | Same. This also reads *which action owns a key*, which the rc file can't tell us cheaply. |
| Backup | `backup` stores **every** global shortcut of every component as JSON (`component`, `name`, `keys`) plus a raw copy of `kglobalshortcutsrc`. Written once; an existing snapshot is never overwritten, so upgrades keep the original. | Keep both formats; the JSON is the restore source, the raw copy is the human fallback. But take a *new timestamped* backup per `apply` as well, since a once-only snapshot can't cover later changes. |
| Rebind | `check` lists conflicts; `apply` takes each key away from its current holder (logging `{action, old keys}`), then binds it to HyprKwin's action. | Same conflict model, but driven by a profile's declared bindings rather than defaults parsed from the script's own `shortcuts.js`. |
| Undo | `restore` replays the change log **newest first**; `reinstate` restores the full snapshot and also takes keys back from anything that claimed them since. Both rename or delete state so a later run starts clean. | Adopt both: log-based `off` (cheap, exact) and snapshot-based `reinstate` (safety net). |
| Safety details | Identity is `component + name`; skips actions that no longer exist; keeps an action that's already correct; handles `+` as a key (`Meta++`); notes that **Plasma 6.6 records an action whose key was already taken with no key at all**, so defaults are read from source. | Copy the identity scheme and the skip-if-unchanged rule. Expect the 6.6 quirk too: our script's actions can show empty keys, so the profile must carry the *intended* keys itself. |
| Lifecycle | `install.sh` runs `backup`, `uninstall.sh` runs `reinstate`. | `kwin-profile apply weave` / `off` are that pair. |

**Gaps in HyprKwin worth fixing**
- It only knows **one** before/after pair (its own defaults); we need named, switchable profiles in both directions.
- It does not toggle which scripts are enabled; conflicts are resolved key by key. We also flip the plugin flags so two tilers never run at once.
- It stores no verification step; we read back after writing.
- **On this machine its backup has never been taken:** `~/.local/share/hyprkwin/` is empty, because HyprKwin was installed through Get New Stuff, not its `install.sh`. So the tool is untested here; treat it as design evidence, not proof it works on this Plasma. A dry round trip on a scratch action is the first test in phase 0.

## 12. Decisions (2026-10-25)

| # | Question | Decision |
|---|---|---|
| 1 | Backend: native `Tile` or own geometry | **Own geometry (`frameGeometry`) by default**, behind a `Backend` interface so native tiles can be added later without touching the model. Reason: easiest to maintain; Krohnkite shows the approach holds up across KWin versions, while the script-facing `Tile` API is thin and has shifted between 6.x releases. The spike (phase 1) still checks drag-out behaviour so this is a confirmed choice, not a guess. |
| 2 | Overlap in arrangements | **No overlap.** Gaps only, user-set from 0 upward (inner and outer separately). |
| 3 | Modifier that flips drag behaviour | **Ctrl, configurable.** Shift is taken: Plasma uses Shift while dragging to show its own tile overlay. Alt is KDE's move-window modifier and our snap layer. |
| 4 | State granularity | **Per desktop per monitor** (the Context from section 3.1). |
| 5 | Video's UX point | Becomes **section 7a, the Stage layout**. |
| 6 | Window-count layout rules | **Opt-in per Context, off by default.** Automatic layout changes surprise people; v1 switches layouts manually. Stage and pair templates are reachable by key. |
| 7 | Stacks/groups | **Yes, in v1 if cheap.** Needed anyway for Stage overflow. A leaf holds an ordered list; one window is visible. |
| 8 | `Meta+Alt+arrows` on tiled window | **Dock to that side of the tree.** Float-and-snap stays on corners/thirds keys, which always float. |
| 9 | Pseudotiling | **No for v1.** Stage and Arrangements cover the aesthetic need. Revisit later. |
| 10 | Bindings | See 12a. |
| 11 | Session restore (2026-11-01) | **Required**, see 2b: observe-then-adopt at startup, never retile on login. Floating + snap is the primary mode. |

### 12a. Binding suggestions

Keep the modifier scheme (Meta focus, +Shift move, +Ctrl resize, +Alt snap, Ctrl+Meta desktops). Additions, all optional:

- `Meta+Shift+Return`: **promote** focused window to the Focus slot / master (the dwm/i3 convention, and the Stage verb).
- `Meta+,` and `Meta+.`: cycle which window sits in the Focus slot through the rail order (carousel feel).
- `Meta+Shift+Space`: float/tile alias of `Meta+F`, because it's the i3/sway/Hyprland habit and costs nothing.
- Every directional verb accepts arrows **and** `hjkl` (you already do this for focus, move and resize; make it uniform, including Alt-layer halves).
- Leave `Meta+Alt+U/I/J/K` for corners and `D/F/G` for thirds as they are.
- Run `Meta+Ctrl+1/2` through the same "send to desktop" logic; no change needed for the Norwegian-layout issue.

## 13. Still open

1. **Stage defaults:** `focusRatio` (60 %?), how many rail cells before overflow, and left/right balance. Best chosen by trying it on your two 1440p monitors.
2. **Scaling option B** (visual scale effect): worth a spike later, or never?
3. Should Stage be the **default layout** for new Contexts, or an explicit choice?
