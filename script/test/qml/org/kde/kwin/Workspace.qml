pragma Singleton
import QtQuick
QtObject {
    property list<QtObject> windows
    property var screens: [{name: "DP-1", geometry: Qt.rect(0, 0, 1200, 800)}]
    property var activeScreen: screens[0]
    property var activeWindow: null
    property point cursorPos: Qt.point(100, 100)
    property int currentDesktop: 1
    property var shortcuts: ({})
    property var calls: []
    signal windowAdded(var window)
    signal windowRemoved(var window)
    signal windowActivated(var window)
    function currentDesktopForScreen(output) { return 1; }
    function clientArea(area, output, desktop) { return Qt.rect(0, 0, 1200, 800); }
    function raiseWindow(window) {}
}
