// Entry point. KWin caches this file and what it imports until the next login, so it stays
// tiny; the picker lives in Picker.qml, loaded under a new URL each time the script starts
// (an edited Picker.qml takes effect when the script is turned off and on again).
import QtQuick

Loader {
    source: Qt.resolvedUrl("Picker.qml") + "?" + Date.now()
}
