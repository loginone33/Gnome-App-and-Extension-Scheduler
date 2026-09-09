import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as SystemdManager from './lib/systemdManager.js';
import * as AutostartScanner from './lib/autostartScanner.js';
import * as ExtensionScanner from './lib/extensionScanner.js';

const DAYS_LABELS = [
    {day: 1, label: 'Mon'},
    {day: 2, label: 'Tue'},
    {day: 3, label: 'Wed'},
    {day: 4, label: 'Thu'},
    {day: 5, label: 'Fri'},
    {day: 6, label: 'Sat'},
    {day: 7, label: 'Sun'},
];

function getJsonConfig(settings, key) {
    const raw = settings.get_string(key);
    if (!raw || raw.trim() === '')
        return {};
    return JSON.parse(raw);
}

let isSaving = false;

function saveJsonConfig(settings, key, data) {
    isSaving = true;
    settings.set_string(key, JSON.stringify(data));
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        isSaving = false;
        return GLib.SOURCE_REMOVE;
    });
}

function formatDaysSummary(days) {
    if (!days || days.length === 0)
        return 'No days';
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 5 && sorted.every((d, i) => d === i + 1))
        return 'Mon - Fri';
    if (sorted.length === 7)
        return 'Every day';
    if (sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7)
        return 'Weekend';
    const map = {1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun'};
    return sorted.map(d => map[d]).join(', ');
}

function createTimeBox(initialTime, onChange) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        valign: Gtk.Align.CENTER,
    });

    const [initH, initM] = (initialTime || '07:00').split(':').map(Number);

    const hourAdj = new Gtk.Adjustment({
        value: initH,
        lower: 0,
        upper: 23,
        step_increment: 1,
        page_increment: 5,
    });
    const hourSpin = new Gtk.SpinButton({
        adjustment: hourAdj,
        numeric: true,
        wrap: true,
        valign: Gtk.Align.CENTER,
    });

    const colon = new Gtk.Label({label: ':', valign: Gtk.Align.CENTER});

    const minAdj = new Gtk.Adjustment({
        value: initM,
        lower: 0,
        upper: 59,
        step_increment: 5,
        page_increment: 10,
    });
    const minSpin = new Gtk.SpinButton({
        adjustment: minAdj,
        numeric: true,
        wrap: true,
        valign: Gtk.Align.CENTER,
    });

    const emitChange = () => {
        const h = String(hourSpin.get_value_as_int()).padStart(2, '0');
        const m = String(minSpin.get_value_as_int()).padStart(2, '0');
        onChange(`${h}:${m}`);
    };

    hourSpin.connect('value-changed', emitChange);
    minSpin.connect('value-changed', emitChange);

    box.append(hourSpin);
    box.append(colon);
    box.append(minSpin);
    return box;
}

function createDaysBox(initialDays, onChange) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        valign: Gtk.Align.CENTER,
    });

    let currentDays = new Set(initialDays || [1, 2, 3, 4, 5]);

    for (const item of DAYS_LABELS) {
        const btn = new Gtk.ToggleButton({
            label: item.label,
            active: currentDays.has(item.day),
            valign: Gtk.Align.CENTER,
        });

        btn.connect('toggled', () => {
            if (btn.get_active())
                currentDays.add(item.day);
            else
                currentDays.delete(item.day);

            onChange(Array.from(currentDays).sort((a, b) => a - b));
        });

        box.append(btn);
    }

    return box;
}

export default class AppAndExtensionSchedulerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const appsPage = new Adw.PreferencesPage({
            title: 'Applications',
            icon_name: 'application-x-executable-symbolic',
        });
        window.add(appsPage);

        const extensionsPage = new Adw.PreferencesPage({
            title: 'Extensions',
            icon_name: 'application-x-addon-symbolic',
        });
        window.add(extensionsPage);

        this._setupAppsPage(appsPage, window, settings);
        this._setupExtensionsPage(extensionsPage, window, settings);
    }

    _setupAppsPage(page, window, settings) {
        const scheduledGroup = new Adw.PreferencesGroup({
            title: 'Scheduled Applications',
            description: 'Applications launched on specified days and hours.',
        });
        page.add(scheduledGroup);

        const autostartGroup = new Adw.PreferencesGroup({
            title: 'Detected in GNOME Autostart',
            description: 'Applications found in ~/.config/autostart/. You can assign schedules to them.',
        });
        page.add(autostartGroup);

        const addGroup = new Adw.PreferencesGroup({
            title: 'Add Application',
        });
        page.add(addGroup);

        const addRow = new Adw.ActionRow({
            title: 'Choose from installed applications',
            subtitle: 'Search for any application available on the system',
        });
        const addBtn = new Gtk.Button({
            label: 'Browse...',
            valign: Gtk.Align.CENTER,
        });
        addRow.add_suffix(addBtn);
        addRow.set_activatable_widget(addBtn);
        addGroup.add(addRow);

        const scheduledRows = [];
        const autostartRows = [];

        const clearGroup = (group, rows) => {
            for (const row of rows)
                group.remove(row);
            rows.length = 0;
        };

        const refreshUI = () => {
            clearGroup(scheduledGroup, scheduledRows);
            clearGroup(autostartGroup, autostartRows);

            const apps = getJsonConfig(settings, 'scheduled-apps');
            const appIds = Object.keys(apps);

            if (appIds.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'No scheduled applications',
                    subtitle: 'Add an application from autostart or installed applications below.',
                });
                scheduledGroup.add(emptyRow);
                scheduledRows.push(emptyRow);
            } else {
                for (const id of appIds) {
                    const cfg = apps[id];
                    const row = this._buildScheduledAppRow(id, cfg, settings, refreshUI);
                    scheduledGroup.add(row);
                    scheduledRows.push(row);
                }
            }

            const autostartApps = AutostartScanner.getAutostartApps();
            if (autostartApps.length === 0) {
                const noAutoRow = new Adw.ActionRow({
                    title: 'No entries in ~/.config/autostart/',
                });
                autostartGroup.add(noAutoRow);
                autostartRows.push(noAutoRow);
            } else {
                for (const autoApp of autostartApps) {
                    const row = this._buildAutostartAppRow(autoApp, apps, settings, refreshUI);
                    autostartGroup.add(row);
                    autostartRows.push(row);
                }
            }
        };

        addBtn.connect('clicked', () => {
            this._openAppSelector(window, settings, refreshUI);
        });

        const signalId = settings.connect('changed::scheduled-apps', () => {
            if (!isSaving)
                refreshUI();
        });
        window.connect('destroy', () => {
            settings.disconnect(signalId);
        });

        refreshUI();
    }

    _buildScheduledAppRow(appId, cfg, settings, refreshUI) {
        const expander = new Adw.ExpanderRow({
            title: cfg.name || appId,
            subtitle: `${formatDaysSummary(cfg.days)} | ${cfg.startTime || '07:00'} - ${cfg.endTime || '15:00'}`,
            show_enable_switch: true,
            enable_expansion: cfg.enabled ?? true,
        });

        const updateSummary = () => {
            expander.set_subtitle(
                `${formatDaysSummary(cfg.days)} | ${cfg.startTime || '07:00'} - ${cfg.endTime || '15:00'}`
            );
        };

        const updateConfig = async () => {
            const current = getJsonConfig(settings, 'scheduled-apps');
            current[appId] = cfg;
            saveJsonConfig(settings, 'scheduled-apps', current);

            if (cfg.enabled) {
                await SystemdManager.installUnit(
                    appId,
                    cfg.name,
                    cfg.days,
                    cfg.startTime,
                    cfg.endTime,
                    cfg.execCommand
                );
            } else {
                await SystemdManager.disableUnit(appId);
            }
        };

        expander.connect('notify::enable-expansion', () => {
            const val = expander.get_enable_expansion();
            if (cfg.enabled === val)
                return;
            cfg.enabled = val;
            updateConfig();
        });

        const daysRow = new Adw.ActionRow({
            title: 'Days of the week',
        });
        const daysBox = createDaysBox(cfg.days, newDays => {
            cfg.days = newDays;
            updateSummary();
            updateConfig();
        });
        daysRow.add_suffix(daysBox);
        expander.add_row(daysRow);

        const startRow = new Adw.ActionRow({
            title: 'Start time',
            subtitle: 'Launch at specified time or upon login after this time',
        });
        const startBox = createTimeBox(cfg.startTime || '07:00', newTime => {
            cfg.startTime = newTime;
            updateSummary();
            updateConfig();
        });
        startRow.add_suffix(startBox);
        expander.add_row(startRow);

        const endRow = new Adw.ActionRow({
            title: 'End of launch window',
            subtitle: 'Latest permitted time for launching upon login',
        });
        const endBox = createTimeBox(cfg.endTime || '15:00', newTime => {
            cfg.endTime = newTime;
            updateSummary();
            updateConfig();
        });
        endRow.add_suffix(endBox);
        expander.add_row(endRow);

        const deleteRow = new Adw.ActionRow({
            title: 'Remove schedule rule',
        });
        const deleteBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        deleteBtn.connect('clicked', async () => {
            await SystemdManager.removeUnit(appId);
            const current = getJsonConfig(settings, 'scheduled-apps');
            delete current[appId];
            saveJsonConfig(settings, 'scheduled-apps', current);
            refreshUI();
        });
        deleteRow.add_suffix(deleteBtn);
        expander.add_row(deleteRow);

        return expander;
    }

    _buildAutostartAppRow(autoApp, scheduledApps, settings, refreshUI) {
        const isScheduled = !!scheduledApps[autoApp.id];
        const row = new Adw.ActionRow({
            title: autoApp.name,
            subtitle: autoApp.id,
        });

        if (autoApp.icon) {
            const iconImage = Gtk.Image.new_from_gicon(autoApp.icon);
            row.add_prefix(iconImage);
        }

        if (isScheduled) {
            const badge = new Gtk.Label({
                label: 'Schedule active',
                valign: Gtk.Align.CENTER,
                css_classes: ['dim-label'],
            });
            row.add_suffix(badge);
        } else {
            const setBtn = new Gtk.Button({
                label: 'Set schedule',
                valign: Gtk.Align.CENTER,
            });
            setBtn.connect('clicked', async () => {
                const current = getJsonConfig(settings, 'scheduled-apps');
                current[autoApp.id] = {
                    name: autoApp.name,
                    days: [1, 2, 3, 4, 5],
                    startTime: '07:00',
                    endTime: '15:00',
                    enabled: true,
                    execCommand: autoApp.exec,
                };
                saveJsonConfig(settings, 'scheduled-apps', current);
                await SystemdManager.installUnit(
                    autoApp.id,
                    autoApp.name,
                    [1, 2, 3, 4, 5],
                    '07:00',
                    '15:00',
                    autoApp.exec
                );
                refreshUI();
            });
            row.add_suffix(setBtn);
            row.set_activatable_widget(setBtn);
        }

        return row;
    }

    _openAppSelector(parentWindow, settings, refreshUI) {
        const installed = AutostartScanner.getInstalledApps();

        const dialog = new Adw.Window({
            title: 'Select application to schedule',
            modal: true,
            transient_for: parentWindow,
            default_width: 480,
            default_height: 520,
        });

        const toolbarView = new Adw.ToolbarView();
        dialog.set_content(toolbarView);

        const headerBar = new Adw.HeaderBar();
        toolbarView.add_top_bar(headerBar);

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        toolbarView.set_content(mainBox);

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: 'Type application name...',
        });
        mainBox.append(searchEntry);

        const scrolled = new Gtk.ScrolledWindow({
            vexpand: true,
            hexpand: true,
        });
        mainBox.append(scrolled);

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        scrolled.set_child(listBox);

        const rows = [];
        for (const app of installed) {
            const row = new Adw.ActionRow({
                title: app.name,
                subtitle: app.id,
            });
            if (app.icon) {
                const img = Gtk.Image.new_from_gicon(app.icon);
                row.add_prefix(img);
            }

            const chooseBtn = new Gtk.Button({
                label: 'Select',
                valign: Gtk.Align.CENTER,
            });
            chooseBtn.connect('clicked', async () => {
                const current = getJsonConfig(settings, 'scheduled-apps');
                current[app.id] = {
                    name: app.name,
                    days: [1, 2, 3, 4, 5],
                    startTime: '07:00',
                    endTime: '15:00',
                    enabled: true,
                    execCommand: app.exec,
                };
                saveJsonConfig(settings, 'scheduled-apps', current);
                await SystemdManager.installUnit(
                    app.id,
                    app.name,
                    [1, 2, 3, 4, 5],
                    '07:00',
                    '15:00',
                    app.exec
                );
                dialog.close();
                refreshUI();
            });
            row.add_suffix(chooseBtn);
            row.set_activatable_widget(chooseBtn);

            listBox.append(row);
            rows.push({row, name: app.name.toLowerCase(), id: app.id.toLowerCase()});
        }

        searchEntry.connect('search-changed', () => {
            const query = searchEntry.get_text().toLowerCase().trim();
            for (const item of rows) {
                const matches = !query || item.name.includes(query) || item.id.includes(query);
                item.row.set_visible(matches);
            }
        });

        dialog.present();
    }

    _setupExtensionsPage(page, window, settings) {
        const scheduledGroup = new Adw.PreferencesGroup({
            title: 'Scheduled Extensions',
            description: 'Managed extensions are active only during scheduled hours. Unscheduled extensions remain untouched.',
        });
        page.add(scheduledGroup);

        const addGroup = new Adw.PreferencesGroup({
            title: 'Add Extension',
        });
        page.add(addGroup);

        const addRow = new Adw.ActionRow({
            title: 'Choose from installed extensions',
            subtitle: 'Select an extension to automate its active hours',
        });
        const addBtn = new Gtk.Button({
            label: 'Browse...',
            valign: Gtk.Align.CENTER,
        });
        addRow.add_suffix(addBtn);
        addRow.set_activatable_widget(addBtn);
        addGroup.add(addRow);

        const scheduledRows = [];

        const clearGroup = (group, rows) => {
            for (const row of rows)
                group.remove(row);
            rows.length = 0;
        };

        const refreshUI = () => {
            clearGroup(scheduledGroup, scheduledRows);

            const extensions = getJsonConfig(settings, 'scheduled-extensions');
            const uuids = Object.keys(extensions);

            if (uuids.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'No scheduled extensions',
                    subtitle: 'Add an extension to schedule its active window.',
                });
                scheduledGroup.add(emptyRow);
                scheduledRows.push(emptyRow);
            } else {
                for (const uuid of uuids) {
                    const cfg = extensions[uuid];
                    const row = this._buildScheduledExtensionRow(uuid, cfg, settings, refreshUI);
                    scheduledGroup.add(row);
                    scheduledRows.push(row);
                }
            }
        };

        addBtn.connect('clicked', () => {
            this._openExtensionSelector(window, settings, refreshUI);
        });

        const signalId = settings.connect('changed::scheduled-extensions', () => {
            if (!isSaving)
                refreshUI();
        });
        window.connect('destroy', () => {
            settings.disconnect(signalId);
        });

        refreshUI();
    }

    _buildScheduledExtensionRow(uuid, cfg, settings, refreshUI) {
        const expander = new Adw.ExpanderRow({
            title: cfg.name || uuid,
            subtitle: `${formatDaysSummary(cfg.days)} | ${cfg.startTime || '07:00'} - ${cfg.endTime || '15:00'}`,
            show_enable_switch: true,
            enable_expansion: cfg.enabled ?? true,
        });

        const updateSummary = () => {
            expander.set_subtitle(
                `${formatDaysSummary(cfg.days)} | ${cfg.startTime || '07:00'} - ${cfg.endTime || '15:00'}`
            );
        };

        const updateConfig = async () => {
            const current = getJsonConfig(settings, 'scheduled-extensions');
            current[uuid] = cfg;
            saveJsonConfig(settings, 'scheduled-extensions', current);

            if (cfg.enabled) {
                await SystemdManager.installExtensionUnit(
                    uuid,
                    cfg.name,
                    cfg.days,
                    cfg.startTime,
                    cfg.endTime
                );
            } else {
                await SystemdManager.disableExtensionUnit(uuid);
            }
        };

        expander.connect('notify::enable-expansion', () => {
            const val = expander.get_enable_expansion();
            if (cfg.enabled === val)
                return;
            cfg.enabled = val;
            updateConfig();
        });

        const daysRow = new Adw.ActionRow({
            title: 'Days of the week',
        });
        const daysBox = createDaysBox(cfg.days, newDays => {
            cfg.days = newDays;
            updateSummary();
            updateConfig();
        });
        daysRow.add_suffix(daysBox);
        expander.add_row(daysRow);

        const startRow = new Adw.ActionRow({
            title: 'Start time',
            subtitle: 'Active from this time on scheduled days',
        });
        const startBox = createTimeBox(cfg.startTime || '07:00', newTime => {
            cfg.startTime = newTime;
            updateSummary();
            updateConfig();
        });
        startRow.add_suffix(startBox);
        expander.add_row(startRow);

        const endRow = new Adw.ActionRow({
            title: 'End time',
            subtitle: 'Active until this time on scheduled days',
        });
        const endBox = createTimeBox(cfg.endTime || '15:00', newTime => {
            cfg.endTime = newTime;
            updateSummary();
            updateConfig();
        });
        endRow.add_suffix(endBox);
        expander.add_row(endRow);

        const deleteRow = new Adw.ActionRow({
            title: 'Remove schedule rule',
        });
        const deleteBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        deleteBtn.connect('clicked', async () => {
            await SystemdManager.removeExtensionUnit(uuid);
            const current = getJsonConfig(settings, 'scheduled-extensions');
            delete current[uuid];
            saveJsonConfig(settings, 'scheduled-extensions', current);
            refreshUI();
        });
        deleteRow.add_suffix(deleteBtn);
        expander.add_row(deleteRow);

        return expander;
    }

    _openExtensionSelector(parentWindow, settings, refreshUI) {
        const installed = ExtensionScanner.getInstalledExtensions();

        const dialog = new Adw.Window({
            title: 'Select extension to schedule',
            modal: true,
            transient_for: parentWindow,
            default_width: 480,
            default_height: 520,
        });

        const toolbarView = new Adw.ToolbarView();
        dialog.set_content(toolbarView);

        const headerBar = new Adw.HeaderBar();
        toolbarView.add_top_bar(headerBar);

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        toolbarView.set_content(mainBox);

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: 'Type extension name...',
        });
        mainBox.append(searchEntry);

        const scrolled = new Gtk.ScrolledWindow({
            vexpand: true,
            hexpand: true,
        });
        mainBox.append(scrolled);

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        scrolled.set_child(listBox);

        const rows = [];
        for (const ext of installed) {
            const row = new Adw.ActionRow({
                title: ext.name,
                subtitle: `${ext.uuid} • ${ext.isActive ? 'Active' : 'Inactive'}`,
            });

            const statusDot = new Gtk.Image({
                icon_name: 'media-record-symbolic',
                pixel_size: 10,
                valign: Gtk.Align.CENTER,
                tooltip_text: ext.isActive ? 'Currently active' : 'Currently inactive',
                css_classes: ext.isActive ? ['success'] : ['dim-label'],
            });
            row.add_prefix(statusDot);

            const chooseBtn = new Gtk.Button({
                label: 'Select',
                valign: Gtk.Align.CENTER,
            });
            chooseBtn.connect('clicked', async () => {
                const current = getJsonConfig(settings, 'scheduled-extensions');
                current[ext.uuid] = {
                    name: ext.name,
                    days: [1, 2, 3, 4, 5],
                    startTime: '07:00',
                    endTime: '15:00',
                    enabled: true,
                };
                saveJsonConfig(settings, 'scheduled-extensions', current);
                await SystemdManager.installExtensionUnit(
                    ext.uuid,
                    ext.name,
                    [1, 2, 3, 4, 5],
                    '07:00',
                    '15:00'
                );
                dialog.close();
                refreshUI();
            });
            row.add_suffix(chooseBtn);
            row.set_activatable_widget(chooseBtn);

            listBox.append(row);
            rows.push({row, name: ext.name.toLowerCase(), uuid: ext.uuid.toLowerCase()});
        }

        searchEntry.connect('search-changed', () => {
            const query = searchEntry.get_text().toLowerCase().trim();
            for (const item of rows) {
                const matches = !query || item.name.includes(query) || item.uuid.includes(query);
                item.row.set_visible(matches);
            }
        });

        dialog.present();
    }
}
