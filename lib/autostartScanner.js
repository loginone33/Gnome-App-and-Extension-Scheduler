import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

const DesktopAppInfo = GioUnix?.DesktopAppInfo ?? Gio.DesktopAppInfo;

export function getAutostartApps() {
    const autostartPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart']);
    const dir = Gio.File.new_for_path(autostartPath);

    if (!dir.query_exists(null))
        return [];

    const enumerator = dir.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null
    );

    const apps = [];
    let fileInfo;
    while ((fileInfo = enumerator.next_file(null)) !== null) {
        const name = fileInfo.get_name();
        if (!name.endsWith('.desktop') || name.startsWith('scheduled-ext-'))
            continue;

        const filePath = GLib.build_filenamev([autostartPath, name]);
        const appInfo = DesktopAppInfo.new_from_filename(filePath);
        if (!appInfo || appInfo.has_key('X-GNOME-Scheduler-Extension') || appInfo.has_key('X-AppStartTime-Extension'))
            continue;

        const isHidden = appInfo.get_is_hidden();
        const autostartEnabled = appInfo.has_key('X-GNOME-Autostart-enabled')
            ? appInfo.get_boolean('X-GNOME-Autostart-enabled')
            : !isHidden;

        apps.push({
            id: name,
            name: appInfo.get_display_name() || name,
            exec: appInfo.get_commandline() || '',
            icon: appInfo.get_icon(),
            enabled: autostartEnabled,
            filePath,
        });
    }

    return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function getInstalledApps() {
    const all = Gio.AppInfo.get_all();
    const apps = [];

    for (const info of all) {
        if (!info.should_show())
            continue;

        apps.push({
            id: info.get_id(),
            name: info.get_display_name(),
            exec: info.get_commandline() || '',
            icon: info.get_icon(),
        });
    }

    return apps.sort((a, b) => a.name.localeCompare(b.name));
}
