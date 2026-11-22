import QtQuick
import QtTest
import org.kde.kwin

TestCase {
    id: testCase
    name: "WeavePackage"
    when: windowShown
    property var entry: null
    property var a: null
    property var b: null
    Component {
        id: windowFactory
        QtObject {
            property string internalId
            property string resourceClass: "editor"
            property string caption: "Editor"
            property bool normalWindow: true
            property bool dialog: false
            property bool fullScreen: false
            property bool minimized: false
            property bool move: false
            property bool resize: false
            property var transientFor: null
            property var tile: null
            property var output: Workspace.screens[0]
            property var desktops: [1]
            property rect frameGeometry: Qt.rect(100, 100, 300, 200)
            property size minSize: Qt.size(0, 0)
            signal interactiveMoveResizeStarted()
            signal interactiveMoveResizeFinished()
        }
    }
    function initTestCase() {
        a = windowFactory.createObject(testCase, {internalId: "a"});
        b = windowFactory.createObject(testCase, {internalId: "b"});
        Workspace.windows = [a, b];
        Workspace.activeWindow = a;
        const component = Qt.createComponent("package/contents/ui/main.qml");
        compare(component.status, Component.Ready, component.errorString());
        entry = component.createObject(testCase);
        verify(entry !== null);
        tryVerify(function () { return entry.item !== null && entry.item.runtime !== null; });
        tryVerify(function () { return Workspace.shortcuts.WeaveLayoutPickerShow !== undefined; });
    }
    function test_direct_picker_and_reload() {
        // Loading the package registers both the old actions and the picker action.
        compare(Object.keys(Workspace.shortcuts).length, 74);
        compare(a.frameGeometry, Qt.rect(100, 100, 300, 200));
        Workspace.shortcuts.WeaveLayoutPickerShow.activated();
        tryVerify(function () { return Workspace.shortcuts["WeavePicker Key 2"] !== undefined; });
        Workspace.shortcuts["WeavePicker Key 2"].activated(); // Columns, through the picker timer.
        tryCompare(a, "frameGeometry", Qt.rect(8, 8, 588, 784));
        compare(b.frameGeometry, Qt.rect(604, 8, 588, 784));
        tryVerify(function () { return Object.keys(Workspace.shortcuts).length === 74; });
        verify(Workspace.calls.every(function (call) { return call.method !== "invokeShortcut"; }));
        compare(Workspace.calls.filter(function (call) { return call.method === "unregister"; }).length, 16);
        Options.configChanged();
        const oldRuntime = entry.item.runtime;
        entry.destroy();
        entry = null;
        tryVerify(function () { return Object.keys(Workspace.shortcuts).length === 0; });
        a.frameGeometry = Qt.rect(100, 100, 300, 200);
        oldRuntime.tileAll("master");
        compare(a.frameGeometry, Qt.rect(100, 100, 300, 200));
        const component = Qt.createComponent("package/contents/ui/main.qml?reload");
        entry = component.createObject(testCase);
        tryVerify(function () { return Object.keys(Workspace.shortcuts).length === 74; });
        compare(a.frameGeometry, Qt.rect(100, 100, 300, 200));
    }
    function cleanupTestCase() { if (entry) entry.destroy(); }
}
