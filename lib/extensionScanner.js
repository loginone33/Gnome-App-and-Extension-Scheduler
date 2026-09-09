import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SELF_UUID = 'app-and-extension-scheduler@loginone';

function scanDir(dirPath, map) {
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null))
        return;

    const enumerator = dir.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null
    );

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            continue;

        const subDirName = info.get_name();
        const metaFile = dir.get_child(subDirName).get_child('metadata.json');
        if (!metaFile.query_exists(null))
            continue;

        const [bytes] = metaFile.load_bytes(null);
        if (!bytes)
            continue;

        const text = new TextDecoder().decode(bytes.toArray());
        const data = JSON.parse(text);

        if (!data.uuid || data.uuid === SELF_UUID)
            continue;

        if (!map.has(data.uuid)) {
            map.set(data.uuid, {
                uuid: data.uuid,
                name: data.name || data.uuid,
                description: data.description || '',
                version: data.version ?? null,
            });
        }
    }
}

export function getInstalledExtensions() {
    const map = new Map();

    const userExtDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions']);
    scanDir(userExtDir, map);

    const systemExtDir = '/usr/share/gnome-shell/extensions';
    scanDir(systemExtDir, map);

    const shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const enabledUuids = new Set(shellSettings.get_strv('enabled-extensions'));

    const list = Array.from(map.values()).map(ext => ({
        ...ext,
        isActive: enabledUuids.has(ext.uuid),
    }));

    return list.sort((a, b) => {
        if (a.isActive !== b.isActive)
            return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
