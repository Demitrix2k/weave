# Weave KWin adapter v0

This package is a source-only adapter for review and unit tests. It has not been
installed, loaded, enabled, or run in KWin. `manageClasses` defaults to empty,
so no windows are managed until classes are explicitly listed. Shortcut
registrations have empty default keys; the separate shortcut-profile tool
assigns keys.

Build the classic KWin script with `./script/build.sh`.
The build writes the package to `script/dist/` (ignored by Git; install that
directory). KWin ignores `X-Plasma-MainScript` for classic scripts, so the code stays
in `contents/code/main.js`; the build injects a content hash and the adapter logs
`weave loaded build=<hash8>` at info level. A script enabled through the config is
loaded on reconfigure but only runs after `qdbus6 org.kde.KWin /Scripting start`, and
disabling does not unload it (use `unloadScript weave`), so the live harness does both.
Run all tests with `node --test core/test script/test`.

`manageClasses` is a comma-separated list of exact `resourceClass` values. Only
normal, non-dialog windows with a nonempty class and caption can be managed.
Fullscreen windows are skipped. The adapter stores state by KWin
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

Each context (output, desktop) has a layout: `master`, `columns`, `monocle` or
`spiral` (`stage` is reserved for a later slice and is not implemented; an
unknown or reserved `defaultLayout` falls back to `master`). New contexts start
with `defaultLayout`; arrivals and reassignments regenerate the tree with the
context's own generator. Shortcuts (all with empty default keys): `Weave Layout
Next`, `Weave Layout Previous`, `Weave Layout Master`, `Weave Layout Columns`,
`Weave Layout Monocle`, `Weave Layout Spiral`. A switch re-derives the tree from
the current leaf order (so drag swaps survive), uses the same `masterRatio` and
gaps as arrivals, clears the "user edited" state, applies the geometry and logs
`layout <context key> -> <name>` at info level. Monocle gives every window the
full work rectangle and raises the active window (and the newly activated one)
when `workspace.raiseWindow` exists. A context forgets its layout once its last
tiled window goes away.

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
