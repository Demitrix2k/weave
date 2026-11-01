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

## Persistence (`persist`, default true)

KWin scripts have no file API, so the adapter keeps which windows were tiled or
floating, and each window's remembered float rectangle, in a small D-Bus helper
(`helper/`, bus name `org.weave.State`, methods `Get() -> s` and `Set(s)`).
Windows are matched by resource class plus a normalised caption, never by id.
Without the helper, `callDBus`, or with `persist=false`, behaviour is the same
as before. Nothing is moved because of saved state; install the helper with
`helper/install.sh` (use `--dry-run` first).
