import QtQuick
QtObject {
    id: root
    property string service
    property string path
    property string dbusInterface
    property string method
    property var arguments
    signal finished(var returnValue)
    signal failed()
    function call() {
        Workspace.calls.push({service: service, method: method, args: arguments});
        Qt.callLater(function () { root.finished(root.method === "Get" ? ["{}"] : []); });
    }
}
