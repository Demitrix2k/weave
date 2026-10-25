# weave-spike

Written-only KWin 6.8 JavaScript spike for DESIGN.md sections 3.3, 4 and 7a.
It has not been installed, enabled, loaded or run. There are no shortcuts.
By default it only logs; it never changes geometry unless an experiment is enabled.
This tests real resizing for the rail demo, not option B's visual thumbnails.

Every script log line starts with `weave-spike`, followed by one JSON object.
Errors use `weave-spike error ...` and normally include `event: "error"` in JSON.
Captions are truncated to 160 characters. Logs still contain window titles and app
classes; they go to the user's journal via KWin's `print` output.

## Manual lifecycle (not performed)

From this directory, install only when ready to test in the real session:

```sh
kpackagetool6 --type=KWin/Script -i .
```

Enable **Weave drag logging spike** in System Settings → Window Management →
KWin Scripts and apply. Disable it there and apply to stop it. The corresponding
kwinrc flag is:

```ini
[Plugins]
weave-spikeEnabled=true
```

Use `weave-spikeEnabled=false` to disable. Editing that flag alone may not reload
the running scripts; use the settings page to apply the change. This package does
not install a profile switcher or modify any existing shortcut or tiler settings.
The profile-switcher prerequisite in DESIGN.md still applies before real use.

After disabling, uninstall with:

```sh
kpackagetool6 --type=KWin/Script -r weave-spike
```

View logs with:

```sh
journalctl --user -g weave-spike
journalctl --user -f -g weave-spike
```

## Optional experiments

`contents/config/main.xml` declares the options read by `readConfig`. There is no
configuration GUI. Defaults are `springBack=false`, `springBackClasses=""`, and
`railDemo=false`. A manual kwinrc example, to be applied only when deliberately
testing, is:

```ini
[Script-weave-spike]
springBack=true
springBackClasses=org.kde.konsole,kitty
railDemo=false
```

Restart the script through the KWin Scripts settings page after changing options.
Class matching is exact and case-sensitive; comma-separated entries are trimmed.
Only completed moves (not resizes) of listed classes spring back. Fullscreen
windows are skipped by both experiments. Geometry assignments have a synchronous
re-entrancy guard and log requested and actual geometry.

With `railDemo=true`, the handler connected to `workspace.windowActivated` calls
`railActivation` on activation. The first call in a burst places the active normal
window in a centred 60% cell, then the next two eligible windows in cyclic
`windowList()` order on that output in left/right 20% cells. A burst ends after
250 ms without an activation; nested activations during layout are suppressed.
It uses the output's placement work area and only `frameGeometry` assignments.
Missing rail windows leave empty cells. It does not change desktops, focus,
native tiles, or maximization state; app constraints can prevent exact placement.
It does not restore prior geometry when disabled. Keep both experiments off for
an unmodified view of native drag behaviour.

## What to inspect in a later session

- `features` is one JSON line with version detection, feature availability and
  tile property/method enumeration. QObject enumeration may omit members, so
  `manage`, `split`, `remove`, and `relativeGeometry` are also probed explicitly.
- `window` reports existing/new windows and which requested signals connected.
- `dragStarted`, `dragStepped` (at most once per 100 ms per drag), and
  `dragFinished` capture geometry and cursor data. Finish includes duration,
  whether any tile transition was seen, and whether the final tile differs from
  the start. A change away and back is retained if `tileChanged` fires.
- Other records include geometry, tile, fullscreen and optional geometry writes.

## API assumptions needing real-session verification

- Whether KWin exposes `KWIN_VERSION_STRING`, `workspace.kwinVersion`,
  `workspace.version`, or `workspace.supportInformation()` to JavaScript. The
  version is reported as unavailable if none works; it is never fabricated.
- Whether `screens`/`outputs` contain output objects accepted by
  `tilingForScreen(output)` and `currentDesktopForScreen(output)`. The demo uses
  `workspace.currentDesktop` if the latter method is absent. A signature mismatch
  is logged and aborts that handler rather than guessing another output.
- Whether `clientArea(KWin.PlacementArea, output, desktop)` accepts that overload
  and the desktop returned on this per-output-desktop session.
- Whether a tiling manager exposes `rootTile`, and whether `Tile` is a global.
  No native tile method is invoked and no native layout is changed.
- Whether `window.tile` wrappers have stable identity, and when `tileChanged`
  fires relative to drag Started/Finished. Detachment before Started or after
  Finished cannot be attributed to that drag by this logger.
- Whether move/resize flags are already set at Started, whether `cursorPos` is
  readable as a point, and whether all listed signals are script-visible.
- Whether `windowActivated` supplies the window (otherwise activeWindow is used),
  and whether `windowList()` supplies an array with the expected ordering.
- Whether `print` reaches the user journal and geometry notifications are
  synchronous. Delayed notifications still log but may show `ownChange=false`.

No runtime validation against KWin has been performed, by design.
