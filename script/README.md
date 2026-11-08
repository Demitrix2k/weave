# Weave KWin adapter v0

This repository contains the pure layout core and classic KWin script adapter.
`manageClasses` defaults to empty, so no windows are managed until classes are
explicitly listed. Shortcut registrations have empty default keys; the separate
shortcut-profile tool assigns keys.

Build the classic KWin script with `./script/build.sh`.
The build writes the package to `script/dist/` (ignored by Git; install that
directory). KWin ignores `X-Plasma-MainScript` for classic scripts, so the code stays
in `contents/code/main.js`; the build injects a content hash and the adapter logs
`weave loaded build=<hash8>` at info level. A script enabled through the config is
loaded on reconfigure but only runs after `qdbus6 org.kde.KWin /Scripting start`, and
disabling does not unload it (use `unloadScript weave`), so the live harness does both.
Run all tests with `node --test core/test script/test`.

Settings are available from System Settings → Window Management → KWin Scripts → Weave →
Configure. Applying the dialog writes the options to `[Script-weave]` in `kwinrc`; the
running adapter reloads them on KWin's `configChanged` signal.

`manageClasses` is a comma-separated list of exact `resourceClass` values. `*` means
every class, and `!name` excludes one (`*,!org.kde.plasmashell`); a list of only
exclusions manages nothing. Only normal, non-dialog windows with a nonempty class and
caption, without `transientFor`, can be managed. Fullscreen windows are skipped.

## Float first (`defaultMode`, `tileClasses`)

The Rectangle-plus-Krohnkite setup: windows float and snap freely, a few classes tile.
`defaultMode` is `tiled` (default, the behaviour before this option existed) or `float`.
`tileClasses` is a comma-separated list of exact classes; a newly arriving window of one of
them arrives tiled, any other managed window arrives with `defaultMode`.

- A window arriving in `float` mode is registered as managed (Snap, Toggle Float, Layout,
  Arrange, Promote, Retile, Float All work on it) but is never moved or resized on arrival.
  Its remembered float rectangle is the rectangle it has. Toggle Float tiles it into its
  context and the next toggle returns it to that rectangle; a free drag or resize updates
  the remembered rectangle and never relayouts anything.
- Repeating a half or quarter snap while the window still matches that slot cycles
  to the next slot in that grid (for example, Left Half then Left Half moves to Right Half).
- `Snap Third` (Meta+Alt+D) moves to the left third, then centre, right and back to left
  on each press; from any other rectangle it goes to the left third. `Snap Two Thirds`
  (Meta+Alt+F) alternates between the left and right two-thirds, starting at the left.
  G is unbound.
- At startup (the observe/settle phase) nothing is moved. Windows whose class is not in
  `tileClasses` are adopted as floating when `defaultMode` is `float`; `tileClasses` windows
  are adopted as before (tree inferred from their rectangles). If the tiled candidates do not
  form a clean partition, `float` mode keeps them managed and floating where they are.
- Saved state wins for the windows it knows, both ways: a window saved as floating stays
  floating although its class is in `tileClasses`, and one saved as tiled is adopted tiled
  although `defaultMode` is `float`. Windows that open after the settle phase do not use
  saved state; they follow the rule above.
- Moving a floating window to another output or desktop only updates its context; it is not
  moved. The adapter stores state by KWin
`internalId`, and maintains separate master-stack trees for each output and
that output's current desktop.

The adapter uses only KWin's documented script globals and signals plus the
feature-detected properties described in `DESIGN.md` and the drag-log spike.
Runtime API assumptions that still need checking in a real KWin session are
listed in the implementation summary when this source is delivered.

Output and desktop reassignment appends the window to the destination's ordered list and
regenerates its master-stack tree; source contexts also regenerate unless their tree was
adopted at startup or edited by a drag, resize, or dock action.

## Layouts (`defaultLayout`, default `master`)

Each context (output, desktop) has a layout: `master`, `columns`, `monocle`,
`spiral`, `rows`, `hstack`, `rmaster`, `grid`, `ultrawide` or `stage` (see below; an unknown `defaultLayout` falls back to
`master`). New contexts start
with `defaultLayout`; arrivals and reassignments regenerate the tree with the
context's own generator. Shortcuts (all with empty default keys): `Weave Layout
Next`, `Weave Layout Previous`, `Weave Layout Master`, `Weave Layout Columns`,
`Weave Layout Monocle`, `Weave Layout Spiral`, `Weave Layout Rows`, `Weave Layout HStack`,
`Weave Layout RMaster`, `Weave Layout Grid`, `Weave Layout Ultrawide`, `Weave Layout Stage` (Next
and Previous cycle in that order, stage last). Pictures of every layout: [docs/layouts](../docs/layouts/README.md).
`rows`: equal full-width rows. `hstack`: master row on top (`masterRatio` high), stack row below.
`rmaster`: `master` mirrored (master right, still `masterRatio` wide). `grid`: ceil(sqrt(n)) columns,
short last row spans the width. `ultrawide`: first window a centre column (`masterRatio` wide,
so 0.6 with the default setting), then right and left side columns alternating. In the settings
list the new layouts follow `stage`, so saved `defaultLayout` indexes keep their meaning. The adapter maps the
geometric leaf order of `rmaster` and `ultrawide` back to list order, so cycling layouts keeps
the window order. A switch re-derives the tree from
the current leaf order (so drag swaps survive), uses the same `masterRatio` and
gaps as arrivals, clears the "user edited" state, applies the geometry and logs
`layout <context key> -> <name>` at info level. Monocle gives every window the
full work rectangle and raises the active window (and the newly activated one)
when `workspace.raiseWindow` exists. A context forgets its layout once its last
tiled window goes away.

## Window limits and fit (`maxWindows`, default 0)

Each layout holds only so many tiled windows; the rest of the context floats instead of
being squeezed into unusable cells.

| Layout | Default limit |
| --- | --- |
| master, hstack, rmaster | 8 |
| columns, spiral | 6 |
| rows | 5 |
| grid, ultrawide | 9 |
| stage | 13 (focus plus 12 rail cells) |
| monocle | unlimited |

`maxWindows` (0 to 99) overrides the limit of every tree layout except monocle; 0 uses the
table. Stage always uses 13.

- **Over the limit:** the windows beyond it float, newest arrival first, never the active
  window. This runs whenever a context is laid out: a window arrives, a layout is chosen
  (Layout shortcuts, Tile All, which tiles up to the limit and leaves the rest floating),
  the master count changes, or the configuration is refreshed. A floated window returns
  to its remembered float rectangle, as with Toggle Float. Log: `weave overlimit <id> <layout>`.
- **Fit:** KWin reports each window's `minSize`. If a computed cell is smaller than the
  window's minimum in width or height, that window floats (newest first, never the active
  one) and the layout is recomputed until everything fits. If only the active window is
  too small, the newest others float instead. A missing `minSize` counts as 0. The check
  uses the generated layout (not hand-resized ratios) and is skipped for stage. Log:
  `weave nofit <id> <layout>`.
- **Coming back:** windows floated by Weave itself (over the limit or no fit) are
  remembered as auto-floated, apart from windows you float. Whenever a context is laid
  out through a layout change (Layout shortcuts, Tile All, the picker), a master count
  change, a `maxWindows` or other configuration refresh, or a window leaving it (closed,
  floated by you, moved to another monitor or desktop), the tiled windows plus the
  context's auto-floated ones are split again in arrival order. Those that now fit are
  tiled again, so closing a tiled window re-tiles the oldest auto-floated one first. A
  window you float yourself (Toggle Float, Float All, dragging it out, snapping) is never
  re-tiled by Weave, and moving or snapping an auto-floated window makes it yours. Toggle
  Float on an auto-floated window tiles it and clears the mark. The mark is not
  persisted: after a restart auto-floated windows count as floating by you.

## Stage layout (`stage`, `focusRatio` default 0.6, clamped 0.3 to 0.8)

One window sits large in the centre (the focus slot); the others sit in fixed
cells in a left and right rail, smaller toward the outer edge (real resize, no
visual scaling). Geometry comes from the core (`stage.layoutStacked`): six rail
cells per side stay reserved, so cells never move when windows come and go; cells
below the adapter's minimum size (140x110) overflow into a stack that shares the
last rail cell's rectangle. Each context keeps its own stage state, built when you
enter Stage from the current order (the active window of the context becomes the
focus, otherwise the first); leaving re-derives a tree from the current order.

- Activating (focusing) a managed window of a Stage context swaps it into the
  focus slot (log `stage <context> focus -> <id>`); nothing else moves. Activations
  of unmanaged or floating windows, of windows in other contexts, and the one the
  adapter itself causes with a cycle are ignored. A new window takes the free cell
  nearest the centre and is promoted only if KWin activates it.
- Shortcuts (empty default keys): `Weave Stage Pin` / `Weave Stage Unpin` (the active
  window's rail cell; it is not promoted or cycled while pinned; note that a focused
  window has no cell, and a focus change by activation promotes first), `Weave Stage
  Cycle Next` / `Weave Stage Cycle Previous` (core `stage.cycle`: swap the focus with
  the first / last unpinned rail window, then activate the new focus; repeated Next
  therefore alternates between two windows rather than visiting all of them).
- Drag: dropping on the focus slot or on a rail cell swaps the two windows; anywhere
  else (gaps, empty space, pinned cells) springs back. Edge resize changes only the
  context's focus ratio (focus window: either side; rail window: its inner side;
  other sides are ignored) and does not touch any tree.
- Persistence: Stage windows are saved as tiled. The layout name, the cell
  assignment, pins and the per-context focus ratio are not persisted.

## Keyboard actions (`resizeStep`, default 76, range 8 to 400)

The five actions Krohnkite had. All shortcuts have empty default keys. They act on the
active window and do nothing for windows that are not managed, and (apart from Float All)
for floating or arranged windows (except Resize and Resize Fill, which work on floating
windows). Move, Resize, Master and Promote also do nothing in a context that has an
arrangement.

- `Weave Move Left` / `Move Right` / `Move Up` / `Move Down`: the active tiled window swaps
  with the nearest window in that direction, found from the layout rectangles (a window
  counts only if its centre and both edges lie further that way; the nearest centre wins).
  At the work-area edge nothing happens. In Stage the window swaps in place with the
  neighbouring cell (pinned cells stay). Marks the context as user-edited, like a drag swap.
- `Weave Focus Left` / `Focus Right` / `Focus Up` / `Focus Down`: activates the nearest managed
  tiled window of the context in that direction (layout rectangles; a window counts only if its
  centre and both edges lie further that way, up and down also need shared width; score
  across * 4 + along + centre / 1000). Stops at the edge. Only when no window lies that way
  and another window has the same rectangle (monocle, a Stage overflow stack) do Left and Up
  act as Previous and Right and Down as Next. `Weave Focus Next` / `Focus Previous` step
  through the context's layout order (Stage: its order) and wrap. Floating, arranged,
  unmanaged and minimized windows and other monitors' windows are skipped. Without an active
  managed window they act on the monitor under the cursor and focus its first window.
  Monocle raises the focused window.
- `Weave Resize Grow Width` / `Shrink Width` / `Grow Height` / `Shrink Height`: moves the
  edge of the nearest ancestor split on that axis by `resizeStep` px, so this window grows
  or shrinks by the step (each pane keeps 100 px). No split on that axis means no change
  (a lone window, monocle, a master window's height). In Stage only the focus window's
  width works: it changes the context's focus ratio (0.3 to 0.8); rail windows and the
  height keys do nothing. Floating windows resize like a tiler, see below.
- `Weave Resize Grow` / `Resize Shrink`: both dimensions at once. Floating windows follow
  the rules below; a tiled window applies its width and then its height resize.
- `Weave Resize Fill` (floating windows only): the window takes the largest free
  rectangle inside the work area (outer gap kept) that overlaps no other window (inner
  gap kept around them). Candidate edges are the work area and the other windows' edges;
  among equal areas the leftmost, then the topmost wins. Nothing free means no change.
  Tiled and arranged windows ignore it.

Floating resize (a port of the `Rectangle: Resize: Grow/Shrink` actions of the user's
kwin-rectangle fork; `Grow`/`Shrink` and the width/height variants share the rules). The
step is `resizeStep` px on the long axis of the work area and scaled by its aspect ratio on
the other, and each side moves on its own:

- a side that faces another window within the inner gap plus 12 px (or overlaps it by up
  to 4 px) moves the shared edge, and that window is resized with it: it gives space when
  growing (it keeps at least 200 px wide / 150 px high, which limits the step) and takes
  space back when shrinking;
- a side facing free space moves until the next window (inner gap kept) or the work-area
  edge (outer gap kept);
- a side on the work-area edge stays put; shrinking a window pinned on both sides of an
  axis shrinks it from both sides;
- a step that would leave the window under 200x150 is refused.

Neighbours are the normal, visible windows on the same output and desktop, managed or not.
Only unmanaged and floating windows are moved (through `setGeometry`, so the expected-
geometry guard sees the writes; a managed floating one also remembers its new size). Tiled,
arranged and Stage windows are never moved: they block the side (it does not grow) but
shrinking still works. Differences from the fork: 200x150 and the 4/12 px tolerances are
the fork's numbers; the work area replaces its margins; tiled windows block instead of
being moved; the fork's Rectangle-state bookkeeping (unsnap restore) does not exist here.

- `Weave Master More` / `Master Fewer`: master-window count of the context for the
  `master`, `hstack` and `rmaster` layouts (at least 1, at most windows minus one but never below 1). The layout
  is re-derived from the current order; other layouts ignore the shortcuts. The count
  is kept per context and is not persisted.
- `Weave Float All`: if any managed window in the active window's context is tiled, all
  of them become floating (each returns to its remembered float rectangle, as with
  Toggle Float); otherwise every floating window tiles again in arrival order. The
  context keeps its layout. Windows of other contexts and arranged windows are not touched.
- `Weave Tile All Master` / `Columns` / `Monocle` / `Spiral` / `Rows` / `Hstack` / `Rmaster` /
  `Grid` / `Ultrawide` / `Stage` (empty default keys; one per layout, named like the Layout
  shortcuts, so a picker can call them through kglobalaccel `invokeShortcut`): they act on the
  context (output and its current desktop) of the monitor under the mouse cursor, found as the
  output whose geometry holds `workspace.cursorPos`, and do nothing if the cursor is on none.
  The context's layout becomes the named one and every floating managed window in it is tiled
  (arrival order, as in Float All), all placed once by the new layout. Already tiled windows keep
  their order, so a fully tiled context is just a layout switch, and an empty one only gets the
  layout. Arranged windows, unmanaged windows and other contexts are not touched. Monocle raises
  the active window if it is in that context.
- `Weave Reload Config`: asks KWin to reconfigure, which makes Weave re-read its settings
  and re-apply gaps and layouts. Use it after Apply in the settings dialog, which does not
  emit KWin's config-changed signal by itself (KDE bug 463292). No default key.
- `Weave Promote`: all tree layouts (master, columns, spiral, monocle, ...) move the active window to the
  first position of the context's order and re-derive the tree (clears the "user edited"
  state); Stage swaps it into the focus slot, as an activation does.

## Arrangements

Shortcuts (empty default keys): `Weave Arrange Next`, `Weave Arrange Previous`
(cycle through `core/templates.json` in file order, starting at the first, or the
last for Previous), `Weave Arrange Reapply`, `Weave Arrange Release`. The build
inlines `templates.json` as `WEAVE_TEMPLATES`, because a KWin script cannot read files.

- Windows: the active window plus the N-1 most recently activated managed
  windows of the same context (any mode), N being the template's slot count.
  Never-activated windows rank last, in arrival order. Fewer windows than slots
  leaves the extra slots empty.
- Geometry: slot rectangles come from `arrangement.applyTemplate` on the work
  area with the outer margin and inner gap (gaps only, no overlap).
- Policy (v1): the group takes over the context. Its windows become mode
  `arranged` and leave the tree. The other windows of the context are left
  exactly where they are: tiled ones stay in the tree but the tiling is
  suspended while a group exists (nothing is laid out, including arrivals and
  layout switches, which only update the tree), so no tree-versus-group overlap
  rules are needed. `Release` resumes tiling.
- Arranged windows are not re-laid on drag. `Reapply` snaps the group back.
  `Release` returns every member to the mode it had before (floated windows go
  back to their remembered free rectangle, captured when the group was applied;
  tiled ones rejoin the tree in arrival order and the context is laid out).
- Applying another template re-picks the windows; members that drop out go back
  to their previous mode (floated ones are restored, tiled ones rejoin the tree
  but keep their position until tiling resumes).
- `Toggle Float`, any `Snap` action, or moving the window to another output
  detaches that one window: it becomes floating and stays where it is. Closing
  an arranged window empties its slot; nothing else moves. When the last member
  is gone the group is dropped and tiling resumes.
- Persistence: the record format has only `float` and `tiled`, so arranged
  windows are saved as `float` with their remembered free rectangle (the group
  and slot are not persisted, and nothing is arranged on login).

## Persistence (`persist`, default true)

KWin scripts have no file API, so the adapter keeps which windows were tiled or
floating, and each window's remembered float rectangle, in a small D-Bus helper
(`helper/`, bus name `org.weave.State`, methods `Get() -> s` and `Set(s)`).
Windows are matched by resource class plus a normalised caption, never by id.
Without the helper, `callDBus`, or with `persist=false`, behaviour is the same
as before. Nothing is moved because of saved state; install the helper with
`helper/install.sh` (use `--dry-run` first).

## Live harness (`script/livetest/livetest.sh`)

`timeout 300 sh script/livetest/livetest.sh` installs a throwaway Weave, runs the kcalc
scenarios inside the running KWin session and removes the throwaway again. It only
touches kcalc windows, and writes only the `[Script-weave]` keys `manageClasses`,
`settleSeconds`, `logLevel`, `defaultMode`, `tileClasses`, `defaultLayout`, `gapInner` and `gapOuter` (both
set to 8, which the shape checks assume) plus `[Plugins] weaveEnabled`.
Options: `--dry-run` (prints the plan, including the snapshot and restore steps, runs
nothing), `--json`, `--takeover`.

**A live Weave is never replaced by accident.** Before it changes anything the harness
looks (read only) for a live setup: a `weave` package in `~/.local/share/kwin/scripts`,
a `[Plugins] weaveEnabled` entry, any key in `[Script-weave]` of `~/.config/kwinrc`, or a
loaded script `weave`. If it finds one and `--takeover` was not given it lists what it
found and ends with **exit code 3**, before any `kwriteconfig6`, `kpackagetool6`,
`unloadScript` or other state-changing call. Exit code 2 still means kcalc is already
running.

**`--takeover`** allows the replacement and makes it reversible:

1. Before any change it saves the live setup twice: into a `mktemp` directory (kept until
   cleanup is done) and into
   `${XDG_STATE_HOME:-$HOME/.local/state}/weave-livetest/restore-<timestamp>-<pid>/`, so a
   crash cannot lose it. The snapshot holds `package/` (the installed package folder),
   `script-weave.lines` (every line of `[Script-weave]`), `weaveEnabled.present` and
   `weaveEnabled.value`, `loaded` (was the script loaded), `kwinrc.before` (the whole
   file), `state.text` (`org.weave.State.Get`, the persistent state) and
   `state.json.file` (a copy of `~/.local/state/weave/state.json`).
2. When the run ends (also after a failure or Ctrl+C) cleanup unloads and removes the
   throwaway, reinstalls the saved package, deletes the harness keys, writes every saved
   key back, restores `weaveEnabled` (or deletes it when it was absent), reconfigures,
   sets the saved state with `org.weave.State.Set` (instead of leaving what the
   throwaway wrote), and calls `qdbus6 org.kde.KWin /Scripting start` when the script was
   loaded, so your Weave runs again. It then checks the result against the snapshot.
3. The report ends with `Live install: restored (...)`; the mktemp copy is deleted and
   the copy under `~/.local/state/weave-livetest/` stays. Without a live install the
   report says `Live install: none found` and the throwaway is removed as before.
4. If any restore step fails the harness prints `Live install: RESTORE FAILED`, the path
   of the snapshot and the manual steps, keeps the snapshot and exits non-zero.

Manual restore from a snapshot `S`:

```sh
qdbus6 org.kde.KWin /Scripting unloadScript weave
kpackagetool6 --type=KWin/Script -r weave
kpackagetool6 --type=KWin/Script -i S/package        # -u if weave is still installed
# put the lines of S/script-weave.lines back under [Script-weave] in ~/.config/kwinrc
# (kwriteconfig6 --file ~/.config/kwinrc --group Script-weave --key K V), or copy
# S/kwinrc.before over it; set [Plugins] weaveEnabled as in S/weaveEnabled.*
qdbus6 org.kde.KWin /KWin reconfigure
qdbus6 org.weave.State /State org.weave.State.Set "$(cat S/state.text)"
qdbus6 org.kde.KWin /Scripting start
```

**S13 (layouts, four windows).** After S12 the harness stops its kcalc windows, drops
`defaultMode`/`tileClasses` so windows tile again, restarts Weave, opens four kcalc on DP-1
and, for each of `rows`, `hstack`, `rmaster`, `grid`, `ultrawide`, invokes
`Weave Layout <Name>`, waits, and runs `check-s13.js` (scenarios `S13a` to `S13e`). The check
prints the four frame rects to the journal and asserts the shape within 4 px: rows = four
equal full-width rows; hstack = master on top at 60 % height, three below; rmaster = master
right, three stacked left; grid = 2x2; ultrawide = centre column, one window left, two
stacked right. With `WEAVE_LIVETEST_SHOTS=<dir>` set, each layout is also photographed with
`spectacle -b -n -f -o <dir>/live-<layout>.png` (waits up to 5 s for the file); unset means
no screenshots. Example:
`WEAVE_LIVETEST_SHOTS=$HOME/shots timeout 400 sh script/livetest/livetest.sh --takeover`.

Tests: `script/test/livetest.test.js` runs the real harness against stub executables
(`kreadconfig6`, `kwriteconfig6`, `kpackagetool6`, `qdbus6`, `journalctl`, `kcalc`, ...)
in a temporary `HOME`; the test hooks are the environment variables
`WEAVE_LIVETEST_KWINRC` and `WEAVE_LIVETEST_SCRIPTS` (defaults: the real paths).

## Layout picker (`weave-picker`)

A second KWin package that shows an overlay with a card per layout (master, columns,
monocle, spiral, rows, hstack, rmaster, grid, ultrawide, stage) on the monitor under the
cursor. Choosing one runs the Weave shortcut `Weave Tile All <Name>`.

Install (builds with `script/build.sh`, which also calls `script/build-picker.sh`):

    sh script/build.sh
    kpackagetool6 --type=KWin/Script -i script/dist-picker   # -u to update
    kwriteconfig6 --file kwinrc --group Plugins --key weave-pickerEnabled true
    qdbus6 org.kde.KWin /KWin reconfigure

Then bind a key to `Weave Layout Picker: Show or hide the layout picker` in System Settings >
Shortcuts (it has no default key). Weave itself must be loaded.

How it works: the overlay is a frameless, unmanaged window covering the monitor under
`Workspace.cursorPos`. KWin never gives its own QML windows keyboard focus, so while it is
open the keys are temporary global shortcuts named `WeavePicker Key ...`: Left/Right/Up/Down
move the selection, Return chooses it, `1`-`9` and `0` choose a layout directly, Escape
closes. A click on a card chooses it; a click outside the cards, or on another window,
closes without change. On choosing, the overlay closes, 50 ms later the Weave shortcut is
invoked through kglobalaccel (`invokeShortcut` on `/component/kwin`); the cursor is never
moved, because Weave picks the target monitor from it. The thumbnails come from
`script/picker/contents/ui/layouts.js`, generated from the core with
`node core/tools/render-picker-data.js` (checked by a test).

Warning: all temporary shortcuts are unregistered on close and when the script is
destroyed. If KWin freezes while the picker is open they may be left behind and keep
swallowing Escape, Return, the arrows and digits. Check with
`grep WeavePicker ~/.config/kglobalshortcutsrc` and remove leftovers.

Border effects: the overlay window's caption is `Weave Layout Picker overlay`; add it to
KDE Rounded Corners' exclusions (`[Round-Corners] Exclusions=`) so it gets no outline.

Qt caches a folder's file list and imported JS until logout: after an update (`-u`) toggle
the script off and on; the data file lives in `contents/ui/lib-<hash>/` for that reason.

## Scroll layout (Pages)

`Layout Scroll` selects a page of tiled windows; Layout Next/Previous and the
picker include Scroll. `Tile All Scroll` includes floating windows on the cursor's
monitor. All shortcuts have empty default keys.

- `Scroll Next` / `Scroll Previous`: with default `slot`, replace the active visible slot with the next/previous parked window; `page` and `window` retain page and one-window scrolling.
- `Scroll Axis Toggle`: switch between side-by-side columns and stacked rows.
- The existing master-count increase/decrease shortcuts change windows per page.
- Focus Next/Previous and focus along the page axis can reveal parked windows.

`scrollAxis` is `h` (default) or `v`, `scrollVisible` defaults to 2, and
`scrollStep` is `slot` (default), `page`, or `window`. `scrollBoxWidth` and
`scrollBoxHeight` default to 88% and 56% of the gapped work area. The settings dialog stores axis and
step as combo indices. Axis, visible count, offset, box and split ratio live per
context for this session; new contexts use the configured defaults. Scroll's
window limit is 20 when `maxWindows=0`; a positive setting overrides it.
Only the visible page is checked against window minimum sizes.

Windows outside the page are minimized and flagged as parked by Weave. They
remain visible as minimized windows in the task manager. Activating or restoring
one reveals it. A new tiled window is appended and revealed; closing one clamps
the page again. Leaving Scroll or tiling restores windows parked by Weave;
user-minimized windows are preserved and excluded from page slots.
Dropping on another visible slot swaps the windows, with no edge scrolling.
Dragging the shared edge of a two-window page adjusts its split ratio. Dragging
an outer box edge resizes the centered box symmetrically; Resize Grow/Shrink
shortcuts use the same resize step.
