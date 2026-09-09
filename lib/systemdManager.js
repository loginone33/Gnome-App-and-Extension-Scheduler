import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const RUNNER_SCRIPT = `#!/bin/sh
if [ "$1" = "--extension" ]; then
    UUID="$2"
    DAYS="$3"
    START_TIME="$4"
    END_TIME="$5"

    D=$(date +%u)
    H=$(date +%-H)
    M=$(date +%-M)

    SH=\${START_TIME%:*}
    SM=\${START_TIME#*:}
    EH=\${END_TIME%:*}
    EM=\${END_TIME#*:}

    NOW=$(( H * 60 + M ))
    START=$(( 10#$SH * 60 + 10#$SM ))
    END=$(( 10#$EH * 60 + 10#$EM ))

    if echo " $DAYS " | grep -q " $D " && [ "$NOW" -ge "$START" ] && [ "$NOW" -lt "$END" ]; then
        gnome-extensions enable "$UUID"
    else
        gnome-extensions disable "$UUID"
    fi
    exit 0
fi

DAYS="$1"
START_TIME="$2"
END_TIME="$3"
shift 3

D=$(date +%u)
H=$(date +%-H)
M=$(date +%-M)

SH=\${START_TIME%:*}
SM=\${START_TIME#*:}
EH=\${END_TIME%:*}
EM=\${END_TIME#*:}

NOW=$(( H * 60 + M ))
START=$(( 10#$SH * 60 + 10#$SM ))
END=$(( 10#$EH * 60 + 10#$EM ))

if echo " $DAYS " | grep -q " $D " && [ "$NOW" -ge "$START" ] && [ "$NOW" -le "$END" ]; then
    exec "$@"
fi
`;

export function toSafeId(appId) {
    return appId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function cleanExecCommand(cmd) {
    if (!cmd)
        return '';
    return cmd
        .replace(/@@u?\s*%[a-zA-Z]\s*@@/g, '')
        .replace(/%[a-zA-Z]/g, '')
        .trim();
}

export function formatCalendarDays(days) {
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 5 && sorted.every((d, i) => d === i + 1))
        return 'Mon..Fri';
    if (sorted.length === 7)
        return 'Mon..Sun';
    return sorted.map(d => DAY_NAMES[d]).filter(Boolean).join(',');
}

function runCommand(argv) {
    return new Promise((resolve, reject) => {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        proc.wait_check_async(null, (source, res) => {
            const ok = source.wait_check_finish(res);
            if (ok)
                resolve();
            else
                reject(new Error(`Command ${argv.join(' ')} failed`));
        });
    });
}

function getSystemdUserDir() {
    return Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_config_dir(), 'systemd', 'user'])
    );
}

function getAutostartDir() {
    return Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart'])
    );
}

function writeFileAsync(file, content) {
    return new Promise((resolve, reject) => {
        const bytes = GLib.Bytes.new(new TextEncoder().encode(content));
        file.replace_contents_bytes_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (source, res) => {
                const [, etag] = source.replace_contents_finish(res);
                if (etag !== null)
                    resolve();
                else
                    reject(new Error(`Failed to write ${file.get_path()}`));
            }
        );
    });
}

function deleteFileAsync(file) {
    return new Promise((resolve, reject) => {
        file.delete_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
            const ok = source.delete_finish(res);
            if (ok)
                resolve();
            else
                reject(new Error(`Failed to delete ${file.get_path()}`));
        });
    });
}

function loadFileBytesAsync(file) {
    return new Promise((resolve, reject) => {
        file.load_bytes_async(null, (source, res) => {
            const result = source.load_bytes_finish(res);
            if (result)
                resolve(result);
            else
                reject(new Error(`Failed to load ${file.get_path()}`));
        });
    });
}

export async function ensureRunnerScript() {
    const localBin = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin'])
    );
    if (!localBin.query_exists(null))
        localBin.make_directory_with_parents(null);

    const runnerFile = localBin.get_child('gnome-scheduled-runner');
    await writeFileAsync(runnerFile, RUNNER_SCRIPT);
    GLib.chmod(runnerFile.get_path(), 0o755);
    return runnerFile.get_path();
}

export async function syncAutostartDesktop(appId, appName, days, startTime, endTime, execCommand) {
    const runnerPath = await ensureRunnerScript();
    const autostartDir = getAutostartDir();
    if (!autostartDir.query_exists(null))
        autostartDir.make_directory_with_parents(null);

    const filename = appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
    const desktopFile = autostartDir.get_child(filename);

    const daysList = days.join(' ');
    const cleanExec = cleanExecCommand(execCommand) || `gtk-launch "${appId}"`;
    const execLine = `${runnerPath} "${daysList}" ${startTime} ${endTime} ${cleanExec}`;

    if (desktopFile.query_exists(null)) {
        const [bytes] = await loadFileBytesAsync(desktopFile);
        let content = new TextDecoder().decode(bytes.toArray());

        let origExec = cleanExec;
        const origMatch = content.match(/^X-AppStartTime-OriginalExec=(.*)$/m);
        if (origMatch) {
            origExec = origMatch[1];
        } else {
            const match = content.match(/^Exec=(.*)$/m);
            if (match && !match[1].includes('gnome-scheduled-runner'))
                origExec = match[1];
        }

        content = content.replace(/^X-AppStartTime-OriginalExec=.*\n?/gm, '');
        const entryIdx = content.indexOf('[Desktop Entry]');
        if (entryIdx > 0)
            content = content.slice(entryIdx);

        content = content.replace(/^\[Desktop Entry\]\n?/, `[Desktop Entry]\nX-AppStartTime-OriginalExec=${origExec}\n`);
        content = content.replace(/^Exec=.*/m, `Exec=${execLine}`);

        if (content.includes('X-GNOME-Autostart-enabled='))
            content = content.replace(/X-GNOME-Autostart-enabled=.*/, 'X-GNOME-Autostart-enabled=true');
        else
            content += '\nX-GNOME-Autostart-enabled=true\n';

        await writeFileAsync(desktopFile, content);
    } else {
        const content = `[Desktop Entry]
X-AppStartTime-OriginalExec=${cleanExec}
X-AppStartTime-Managed=true
Type=Application
Name=${appName}
Exec=${execLine}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
        await writeFileAsync(desktopFile, content);
    }
}

export async function disableAutostartDesktop(appId) {
    const autostartDir = getAutostartDir();
    const filename = appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
    const desktopFile = autostartDir.get_child(filename);

    if (!desktopFile.query_exists(null))
        return;

    const [bytes] = await loadFileBytesAsync(desktopFile);
    let content = new TextDecoder().decode(bytes.toArray());

    if (content.includes('X-GNOME-Autostart-enabled='))
        content = content.replace(/X-GNOME-Autostart-enabled=.*/, 'X-GNOME-Autostart-enabled=false');
    else
        content += '\nX-GNOME-Autostart-enabled=false\n';

    await writeFileAsync(desktopFile, content);
}

export async function removeAutostartDesktop(appId) {
    const autostartDir = getAutostartDir();
    const filename = appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
    const desktopFile = autostartDir.get_child(filename);

    if (!desktopFile.query_exists(null))
        return;

    const [bytes] = await loadFileBytesAsync(desktopFile);
    let content = new TextDecoder().decode(bytes.toArray());

    if (content.includes('X-AppStartTime-Managed=true')) {
        await deleteFileAsync(desktopFile);
        return;
    }

    const matchOrig = content.match(/X-AppStartTime-OriginalExec=(.*)/);
    if (matchOrig) {
        const orig = matchOrig[1];
        content = content.replace(/^Exec=.*/m, `Exec=${orig}`);
        content = content.replace(/X-AppStartTime-OriginalExec=.*\n?/, '');
    }

    content = content.replace(/X-GNOME-Autostart-enabled=.*/, 'X-GNOME-Autostart-enabled=true');
    await writeFileAsync(desktopFile, content);
}

export async function installUnit(appId, appName, days, startTime, endTime, execCommand) {
    const safeId = toSafeId(appId);
    const systemdDir = getSystemdUserDir();

    if (!systemdDir.query_exists(null))
        systemdDir.make_directory_with_parents(null);

    const serviceFile = systemdDir.get_child(`gnome-scheduler-${safeId}.service`);
    const timerFile = systemdDir.get_child(`gnome-scheduler-${safeId}.timer`);

    const daysList = days.join(' ');
    const calendarDays = formatCalendarDays(days);
    const cleanExec = cleanExecCommand(execCommand) || `gtk-launch "${appId}"`;
    const runnerPath = await ensureRunnerScript();
    const execLine = `${runnerPath} "${daysList}" ${startTime} ${endTime} ${cleanExec}`;
    const systemdExec = execLine.replace(/%/g, '%%');

    const serviceContent = `[Unit]
Description=Scheduled launch for ${appName}
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=oneshot
ExecStart=${systemdExec}
`;

    const timerContent = `[Unit]
Description=Scheduled timer for ${appName}
PartOf=graphical-session.target

[Timer]
OnCalendar=${calendarDays} *-*-* ${startTime}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

    await writeFileAsync(serviceFile, serviceContent);
    await writeFileAsync(timerFile, timerContent);

    await runCommand(['systemctl', '--user', 'daemon-reload']);
    await runCommand(['systemctl', '--user', 'enable', '--now', `gnome-scheduler-${safeId}.timer`]);

    await syncAutostartDesktop(appId, appName, days, startTime, endTime, cleanExec);
}

export async function disableUnit(appId) {
    const safeId = toSafeId(appId);
    await runCommand(['systemctl', '--user', 'disable', '--now', `gnome-scheduler-${safeId}.timer`]);
    await disableAutostartDesktop(appId);
}

export async function removeUnit(appId) {
    const safeId = toSafeId(appId);
    const systemdDir = getSystemdUserDir();
    const serviceFile = systemdDir.get_child(`gnome-scheduler-${safeId}.service`);
    const timerFile = systemdDir.get_child(`gnome-scheduler-${safeId}.timer`);

    await runCommand(['systemctl', '--user', 'disable', '--now', `gnome-scheduler-${safeId}.timer`]);

    if (timerFile.query_exists(null))
        await deleteFileAsync(timerFile);
    if (serviceFile.query_exists(null))
        await deleteFileAsync(serviceFile);

    await runCommand(['systemctl', '--user', 'daemon-reload']);

    await removeAutostartDesktop(appId);
}

export async function installExtensionUnit(uuid, name, days, startTime, endTime) {
    const safeId = toSafeId(uuid);
    const systemdDir = getSystemdUserDir();

    if (!systemdDir.query_exists(null))
        systemdDir.make_directory_with_parents(null);

    const serviceFile = systemdDir.get_child(`gnome-scheduler-ext-${safeId}.service`);
    const timerFile = systemdDir.get_child(`gnome-scheduler-ext-${safeId}.timer`);

    const daysList = days.join(' ');
    const calendarDays = formatCalendarDays(days);
    const runnerPath = await ensureRunnerScript();
    const execLine = `${runnerPath} --extension "${uuid}" "${daysList}" ${startTime} ${endTime}`;

    const serviceContent = `[Unit]
Description=Scheduled extension state for ${name}
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=oneshot
ExecStart=${execLine}
`;

    const timerContent = `[Unit]
Description=Scheduled timer for extension ${name}
PartOf=graphical-session.target

[Timer]
OnCalendar=${calendarDays} *-*-* ${startTime}:00
OnCalendar=${calendarDays} *-*-* ${endTime}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

    await writeFileAsync(serviceFile, serviceContent);
    await writeFileAsync(timerFile, timerContent);

    await runCommand(['systemctl', '--user', 'daemon-reload']);
    await runCommand(['systemctl', '--user', 'enable', '--now', `gnome-scheduler-ext-${safeId}.timer`]);

    const autostartDir = getAutostartDir();
    if (!autostartDir.query_exists(null))
        autostartDir.make_directory_with_parents(null);

    const autostartFile = autostartDir.get_child(`scheduled-ext-${safeId}.desktop`);
    const autostartContent = `[Desktop Entry]
Type=Application
Name=Scheduled Extension: ${name}
Exec=${execLine}
Terminal=false
NoDisplay=true
X-AppStartTime-Extension=true
X-GNOME-Autostart-enabled=true
`;
    await writeFileAsync(autostartFile, autostartContent);

    await runCommand([runnerPath, '--extension', uuid, daysList, startTime, endTime]);
}

export async function disableExtensionUnit(uuid) {
    const safeId = toSafeId(uuid);
    await runCommand(['systemctl', '--user', 'disable', '--now', `gnome-scheduler-ext-${safeId}.timer`]);

    const autostartDir = getAutostartDir();
    const autostartFile = autostartDir.get_child(`scheduled-ext-${safeId}.desktop`);
    if (autostartFile.query_exists(null)) {
        const [bytes] = await loadFileBytesAsync(autostartFile);
        let content = new TextDecoder().decode(bytes.toArray());
        if (content.includes('X-GNOME-Autostart-enabled='))
            content = content.replace(/X-GNOME-Autostart-enabled=.*/, 'X-GNOME-Autostart-enabled=false');
        else
            content += '\nX-GNOME-Autostart-enabled=false\n';
        await writeFileAsync(autostartFile, content);
    }
}

export async function removeExtensionUnit(uuid) {
    const safeId = toSafeId(uuid);
    const systemdDir = getSystemdUserDir();
    const serviceFile = systemdDir.get_child(`gnome-scheduler-ext-${safeId}.service`);
    const timerFile = systemdDir.get_child(`gnome-scheduler-ext-${safeId}.timer`);

    await runCommand(['systemctl', '--user', 'disable', '--now', `gnome-scheduler-ext-${safeId}.timer`]);

    if (timerFile.query_exists(null))
        await deleteFileAsync(timerFile);
    if (serviceFile.query_exists(null))
        await deleteFileAsync(serviceFile);

    await runCommand(['systemctl', '--user', 'daemon-reload']);

    const autostartDir = getAutostartDir();
    const autostartFile = autostartDir.get_child(`scheduled-ext-${safeId}.desktop`);
    if (autostartFile.query_exists(null))
        await deleteFileAsync(autostartFile);
}
