import QtQuick
import org.kde.kwin
import "lib-@@BUILD_ID@@/weave.js" as Engine
import "lib-@@BUILD_ID@@/host.js" as Host

Item {
    id: root
    property var runtime: null
    property var host: null

    Component { id: shortcutFactory; ShortcutHandler {} }
    Component { id: timerFactory; Timer {} }
    Component { id: dbusFactory; DBusCall {} }

    Component.onCompleted: {
        // In declarative scripts the client-area enum lives on Workspace (KWin 6.8:
        // KWin.PlacementArea is undefined, Workspace.PlacementArea is 0), and enums don't
        // travel with an object handed to JS, so pass the values the adapter needs.
        var kwin = {
            PlacementArea: Workspace.PlacementArea,
            MaximizeArea: Workspace.MaximizeArea,
            FullScreenArea: Workspace.FullScreenArea,
            readConfig: function (name, fallback) { return KWin.readConfig(name, fallback); }
        };
        host = Host.createHost(Workspace, kwin, Options, Qt.application, {
            shortcut: function (properties) { return shortcutFactory.createObject(root, properties); },
            timer: function (properties) { return timerFactory.createObject(root, properties); },
            dbus: function (properties) { return dbusFactory.createObject(root, properties); }
        }, function (message) { console.log(message); });
        runtime = Engine.start(host);
        // Fresh URL also invalidates the picker component after an in-place update.
        picker.setSource(Qt.resolvedUrl("Picker.qml") + "?" + Date.now(), {host: host});
    }

    Loader { id: picker }
    Connections {
        target: picker.item
        function onLayoutSelected(name) {
            if (root.runtime) root.runtime.tileAll(name);
        }
    }

    Component.onDestruction: {
        if (runtime) runtime.stop();
        runtime = null;
    }
}
