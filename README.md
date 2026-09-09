# App & Extension Scheduler for GNOME Shell

[![GNOME Extensions](https://img.shields.io/badge/GNOME_Extensions-Available-blue.svg)](https://extensions.gnome.org/extension/app-and-extension-scheduler/)

**App & Extension Scheduler** is a GNOME Shell extension that allows you to automate both application startup and GNOME Shell extensions lifecycle based on custom days and time windows.

---

## Features

- **Scheduled Applications**: Launch applications automatically on specific days and within designated time windows using native `systemd --user` timers.
  - Reduces initial desktop login overhead by deferring heavy applications (Flatpaks, Electron apps) to their scheduled hours.
  - FreeDesktop `.desktop` entry integration ensures applications launch reliably on system boot and session login within their scheduled window.
- **Scheduled GNOME Extensions**: Automatically enable work-related or situational extensions during active hours and disable them outside (e.g., Mon–Fri 07:00–15:00).
- **Explicit Management Policy**: Only applications and extensions explicitly selected by the user are scheduled. Any unmanaged extension or autostart item is completely untouched.
- **Smart Extension Picker**: Easily select extensions with active/inactive indicators; currently running extensions are prioritized at the top of the selection dialog.
- **Self-Lockout Protection**: Built-in guard strictly prevents the scheduler from scheduling or disabling itself.
- **Lightweight & EGO-Compliant**: Zero polling loops in the GNOME Shell main process. State transitions are driven by systemd user timers and an efficient POSIX helper runner.

---

## Compatibility

- **GNOME Shell**: 45, 46, 47, 48, 49, 50
- **Session**: Wayland & X11

---

## Installation & Deployment

### Local Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/loginone33/Gnome-App-and-Extension-Scheduler.git
   cd Gnome-App-and-Extension-Scheduler
   ```
2. Run the installation script:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
3. Restart GNOME Shell (log out and log back in on Wayland, or press `Alt+F2`, type `r`, and press `Enter` on X11).
4. Enable the extension:
   ```bash
   gnome-extensions enable app-and-extension-scheduler@loginone
   ```
5. Open Preferences:
   ```bash
   gnome-extensions prefs app-and-extension-scheduler@loginone
   ```

### Packaging for extensions.gnome.org (EGO)

To create a clean zip package for upload to extensions.gnome.org:
```bash
gnome-extensions pack --force --extra-source=lib
```

---

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

---

## Support & Donations

If you find this extension helpful, consider supporting its development:

- **Ko-fi**: [loginone](https://ko-fi.com/loginone)
- **Buy Me a Coffee**: [loginone](https://buymeacoffee.com/loginone)
