// Declarative KWin API boundary. Factories create QML objects owned by the root.
function createHost(workspace, kwin, options, application, factories, log) {
    var adapted = {
        get activeWindow() { return workspace.activeWindow; },
        set activeWindow(window) { workspace.activeWindow = window; },
        get cursorPos() { return workspace.cursorPos; },
        get screens() { return workspace.screens; },
        get currentDesktop() { return workspace.currentDesktop; },
        currentDesktopForScreen: function (output) {
            return workspace.currentDesktopForScreen(output);
        },
        clientArea: function (area, output, desktop) {
            return workspace.clientArea(area, output, desktop);
        },
        raiseWindow: function (window) { workspace.raiseWindow(window); },
        windowList: function () {
            // QQmlListProperty is array-like, not a JS Array.
            var result = [];
            var windows = workspace.windows;
            for (var i = 0; i < windows.length; i++) { result.push(windows[i]); }
            return result;
        },
        windowAdded: workspace.windowAdded,
        windowRemoved: workspace.windowRemoved,
        windowActivated: workspace.windowActivated,
        screensChanged: workspace.screensChanged
    };
    return {
        workspace: adapted,
        KWin: kwin,
        options: options,
        qApp: application,
        print: log,
        readConfig: function (name, fallback) { return kwin.readConfig(name, fallback); },
        registerShortcut: function (name, text, sequence, callback) {
            var shortcut = factories.shortcut({name: name, text: text, sequence: sequence});
            shortcut.activated.connect(callback);
        },
        startTimer: function (milliseconds, callback) {
            var timer = factories.timer({interval: milliseconds, repeat: false});
            timer.triggered.connect(function () {
                try { callback(); } finally { timer.destroy(); }
            });
            timer.start();
        },
        callDBus: function (service, path, iface, method) {
            var args = Array.prototype.slice.call(arguments, 4);
            var callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
            var call = factories.dbus({service: service, path: path, dbusInterface: iface,
                method: method, arguments: args});
            call.finished.connect(function (values) {
                try { if (callback) { callback.apply(null, values); } }
                finally { call.destroy(); }
            });
            call.failed.connect(function () {
                try {
                    log("weave error D-Bus " + service + " " + method + " failed");
                    if (callback) { callback(); }
                } finally { call.destroy(); }
            });
            call.call();
        }
    };
}
