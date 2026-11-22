pragma Singleton
import QtQuick
QtObject {
    enum Area { PlacementArea }
    function readConfig(name, fallback) {
        const settings = {manageClasses: "editor", settleSeconds: 0, persist: false,
                          defaultMode: "float", logLevel: "info"};
        return settings[name] === undefined ? fallback : settings[name];
    }
}
