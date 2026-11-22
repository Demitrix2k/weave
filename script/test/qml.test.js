const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

test('built QML package starts, applies picker selection and reloads in isolated Qt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-qml-'));
    try {
        const build = spawnSync('sh', [path.join(__dirname, '../build.sh')], {encoding: 'utf8'});
        assert.equal(build.status, 0, build.stderr);
        fs.cpSync(path.join(__dirname, 'qml'), dir, {recursive: true});
        fs.cpSync(path.join(__dirname, '../dist'), path.join(dir, 'package'), {recursive: true});
        for (const sub of ['home', 'run', 'cache', 'config', 'data'])
            fs.mkdirSync(path.join(dir, sub), {mode: 0o700});
        const run = spawnSync(process.env.QT6_QMLTESTRUNNER || '/usr/lib/qt6/bin/qmltestrunner', ['-input', dir, '-import', dir], {
            encoding: 'utf8', timeout: 30000,
            env: {...process.env, HOME: path.join(dir, 'home'),
                XDG_RUNTIME_DIR: path.join(dir, 'run'), XDG_CACHE_HOME: path.join(dir, 'cache'),
                XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_DATA_HOME: path.join(dir, 'data'),
                DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(dir, 'no-bus'),
                QT_QPA_PLATFORM: 'offscreen', QT_QUICK_BACKEND: 'software',
                QT_QUICK_CONTROLS_STYLE: 'Basic', QT_QPA_PLATFORMTHEME: '',
                DISPLAY: '', WAYLAND_DISPLAY: ''}
        });
        assert.equal(run.status, 0, run.error + '\n' + run.stdout + run.stderr);
        assert.doesNotMatch(run.stdout + run.stderr, /weave error|ReferenceError|TypeError/);
        assert.match(run.stdout, /weave loaded build=[0-9a-f]{8}/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
