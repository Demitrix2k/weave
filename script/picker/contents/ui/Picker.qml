// Weave Layout Picker: a shortcut shows a card per layout on the monitor under the cursor.
// Click a card, or use the keys (arrows, Return, 1-9 and 0, Escape) to choose. The overlay
// closes first, then the Weave shortcut "Weave Tile All <Name>" is invoked through
// kglobalaccel; Weave takes the monitor from the cursor, so the cursor is never moved.
import QtQuick
import QtQuick.Window as QW
import org.kde.kwin
import org.kde.kirigami as Kirigami
import "layouts.js" as Data

Item {
    id: root

    readonly property string actionName: "WeaveLayoutPickerShow"
    readonly property var digitKeys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
    readonly property var moveKeys: ["Left", "Right", "Up", "Down"]
    readonly property var fixedKeys: ["Escape", "Return"].concat(moveKeys)
    property string pending: ""

    function keyName(k) { return "WeavePicker Key " + k; }

    function dbus(path, iface, method, args, done) {
        const call = Qt.createQmlObject(
            'import org.kde.kwin; DBusCall { service: "org.kde.kglobalaccel" }', root);
        call.path = path;
        call.dbusInterface = iface;
        call.method = method;
        call.arguments = args || [];
        call.finished.connect(() => { done(); call.destroy(); });
        call.failed.connect(() => { done(); call.destroy(); });
        call.call();
    }

    function screenUnderCursor() {
        const p = Workspace.cursorPos;
        const screens = Workspace.screens;
        for (let i = 0; i < screens.length; i++) {
            const g = screens[i].geometry;
            if (p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height)
                return g;
        }
        return Workspace.activeScreen.geometry;
    }

    function colorSetting(text) {
        const m = /^(\d+),(\d+),(\d+)(?:,(\d+))?$/.exec(String(text).trim());
        if (m) return Qt.rgba(m[1] / 255, m[2] / 255, m[3] / 255,
                              m[4] === undefined ? 1 : m[4] / 255);
        return String(text);
    }

    // Started from a menu, KWin hands focus back to a window right after the menu closes;
    // that activation must not count as clicking away.
    property double openedAt: 0

    function openPicker() {
        if (overlay.visible) return;
        overlay.area = screenUnderCursor();
        overlay.current = 0;
        overlay.show();
        overlay.raise();
        keys.active = true;
        openedAt = Date.now();
    }

    // KWin never gives its own QML windows keyboard focus, so while the picker is up its keys
    // are temporary global shortcuts, removed from KDE's list again on close so the keys go
    // back to the apps.
    function releaseKeys() {
        if (!keys.active) return;
        keys.active = false;
        for (const k of fixedKeys.concat(digitKeys))
            dbus("/kglobalaccel", "org.kde.KGlobalAccel", "unregister",
                 ["kwin", keyName(k)], () => {});
    }

    function closePicker() {
        overlay.visible = false;
        releaseKeys();
    }

    function choose(index) {
        if (index < 0 || index >= Data.layouts.length) return;
        const name = Data.layouts[index].name;
        pending = "Weave Tile All " + name.charAt(0).toUpperCase() + name.slice(1);
        closePicker();
        invokeTimer.restart();
    }

    // Let the overlay leave the screen before Weave looks at the cursor and the windows.
    Timer {
        id: invokeTimer
        interval: 50
        onTriggered: {
            const name = root.pending;
            root.pending = "";
            if (name)
                root.dbus("/component/kwin", "org.kde.kglobalaccel.Component",
                          "invokeShortcut", [name], () => {});
        }
    }

    ShortcutHandler {
        name: root.actionName
        text: "Weave Layout Picker: Show or hide the layout picker"
        onActivated: overlay.visible ? root.closePicker() : root.openPicker()
    }

    Loader {
        id: keys
        active: false
        sourceComponent: Item {
            ShortcutHandler {
                name: root.keyName("Escape")
                text: "Weave Layout Picker: Close (only while it is open)"
                sequence: "Escape"
                onActivated: root.closePicker()
            }
            ShortcutHandler {
                name: root.keyName("Return")
                text: "Weave Layout Picker: Choose the selected layout (only while it is open)"
                sequence: "Return"
                onActivated: root.choose(overlay.current)
            }
            ShortcutHandler {
                name: root.keyName("Left")
                text: "Weave Layout Picker: Select the previous layout (only while it is open)"
                sequence: "Left"
                onActivated: overlay.move(-1, 0)
            }
            ShortcutHandler {
                name: root.keyName("Right")
                text: "Weave Layout Picker: Select the next layout (only while it is open)"
                sequence: "Right"
                onActivated: overlay.move(1, 0)
            }
            ShortcutHandler {
                name: root.keyName("Up")
                text: "Weave Layout Picker: Select the layout above (only while it is open)"
                sequence: "Up"
                onActivated: overlay.move(0, -1)
            }
            ShortcutHandler {
                name: root.keyName("Down")
                text: "Weave Layout Picker: Select the layout below (only while it is open)"
                sequence: "Down"
                onActivated: overlay.move(0, 1)
            }
            Instantiator {
                model: root.digitKeys
                delegate: ShortcutHandler {
                    required property string modelData
                    required property int index
                    name: root.keyName(modelData)
                    text: "Weave Layout Picker: Choose layout " + modelData
                          + " (only while it is open)"
                    sequence: modelData
                    onActivated: root.choose(index)
                }
            }
        }
    }

    // Also when the script is turned off or reloaded while the picker is open.
    Component.onDestruction: {
        if (overlay.visible) overlay.visible = false;
        releaseKeys();
    }

    // Clicking another window (or the desktop) activates it: close then.
    Connections {
        target: Workspace
        function onWindowActivated(w) {
            if (overlay.visible && Date.now() - root.openedAt > 800) root.closePicker();
        }
    }

    QW.Window {
        id: overlay
        // KWin treats this as a normal window whatever its flags, so border effects may
        // outline it; they can exclude it by this caption.
        title: "Weave Layout Picker overlay"
        // Unmanaged, so KWin places it exactly: it covers the monitor from its corner.
        flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
        color: "transparent"
        visible: false

        Kirigami.Theme.colorSet: Kirigami.Theme.View
        Kirigami.Theme.inherit: false

        property var area: null
        property int current: 0
        readonly property int columns: 5
        readonly property int count: Data.layouts.length
        readonly property color accent: Kirigami.Theme.highlightColor
        readonly property real cardW: Math.min(area ? area.width * 0.17 : 1,
                                               Kirigami.Units.gridUnit * 16)
        readonly property real cardH: cardW * 0.78
        readonly property real gap: Kirigami.Units.gridUnit

        x: area ? area.x : 0
        y: area ? area.y : 0
        width: area ? area.width : 1
        height: area ? area.height : 1

        function move(dx, dy) {
            const rows = Math.ceil(count / columns);
            let col = current % columns + dx;
            let row = Math.floor(current / columns) + dy;
            col = Math.max(0, Math.min(columns - 1, col));
            row = Math.max(0, Math.min(rows - 1, row));
            current = Math.min(count - 1, row * columns + col);
        }

        Rectangle {
            anchors.fill: parent
            color: Qt.alpha(Kirigami.Theme.backgroundColor, 0.6)
            MouseArea {
                anchors.fill: parent
                onClicked: root.closePicker()
            }
        }

        Rectangle {
            id: panel
            anchors.centerIn: parent
            width: grid.width + overlay.gap * 2
            height: grid.height + overlay.gap * 2
            radius: 6
            color: Qt.alpha(Kirigami.Theme.backgroundColor, 0.95)
            border.color: Qt.alpha(overlay.accent, 0.5)
            border.width: 1
            // Swallow clicks on the panel between the cards.
            MouseArea { anchors.fill: parent }

            Grid {
                id: grid
                anchors.centerIn: parent
                columns: overlay.columns
                spacing: overlay.gap

                Repeater {
                    model: Data.layouts
                    delegate: Rectangle {
                        id: card
                        required property var modelData
                        required property int index
                        readonly property bool selected: overlay.current === index
                        width: overlay.cardW
                        height: overlay.cardH
                        radius: 6
                        color: selected ? Qt.alpha(overlay.accent, 0.2)
                                        : Qt.alpha(Kirigami.Theme.textColor, 0.06)
                        border.color: selected ? overlay.accent
                                               : Qt.alpha(Kirigami.Theme.textColor, 0.15)
                        border.width: selected ? 2 : 1

                        Item {
                            id: thumb
                            x: overlay.gap / 2
                            y: overlay.gap / 2
                            width: parent.width - overlay.gap
                            height: width * 9 / 16
                            Rectangle {
                                anchors.fill: parent
                                radius: 2
                                color: Qt.alpha(Kirigami.Theme.textColor, 0.08)
                            }
                            Repeater {
                                model: card.modelData.rects
                                delegate: Rectangle {
                                    required property var modelData
                                    required property int index
                                    readonly property bool mono: card.modelData.name === "monocle"
                                    // Monocle stacks every window: draw a cascade instead.
                                    readonly property real off: mono ? index * 0.025 : 0
                                    x: (modelData[0] + off) * thumb.width
                                    y: (modelData[1] + off) * thumb.height
                                    width: (modelData[2] - (mono ? 0.075 : 0)) * thumb.width
                                    height: (modelData[3] - (mono ? 0.075 : 0)) * thumb.height
                                    radius: 2
                                    color: Qt.alpha(overlay.accent, index === 0 ? 0.75 : 0.45)
                                    border.color: overlay.accent
                                    border.width: 1
                                }
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: overlay.gap / 2
                            elide: Text.ElideRight
                            color: Kirigami.Theme.textColor
                            font.pixelSize: Kirigami.Units.gridUnit * 0.9
                            text: (card.index + 1) % 10 + "  "
                                  + card.modelData.name.charAt(0).toUpperCase()
                                  + card.modelData.name.slice(1)
                        }

                        MouseArea {
                            anchors.fill: parent
                            hoverEnabled: true
                            onEntered: overlay.current = card.index
                            onClicked: root.choose(card.index)
                        }
                    }
                }
            }
        }
    }
}
