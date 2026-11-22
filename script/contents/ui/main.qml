// Keep the entry point stable: KWin caches it until logout. Load the runtime at a
// fresh URL; its JS imports live under a content-hashed directory in the package.
import QtQuick

Loader {
    source: Qt.resolvedUrl("Weave.qml") + "?" + Date.now()
}
