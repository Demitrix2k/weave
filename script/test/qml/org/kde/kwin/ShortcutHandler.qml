import QtQuick
QtObject {
    property string name
    property string text
    property string sequence
    signal activated()
    Component.onCompleted: Workspace.shortcuts[name] = this
    Component.onDestruction: delete Workspace.shortcuts[name]
}
