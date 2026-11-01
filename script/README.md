# Weave KWin adapter v0

This package is a source-only adapter for review and unit tests. It has not been
installed, loaded, enabled, or run in KWin. `manageClasses` defaults to empty,
so no windows are managed until classes are explicitly listed. Shortcut
registrations have empty default keys; the separate shortcut-profile tool
assigns keys.

Build the classic KWin script with `./script/build.sh`. The generated
`script/contents/code/main.js` is ignored by Git and is rebuilt by the tests.
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
