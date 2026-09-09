#!/bin/bash
set -e

UUID="app-and-extension-scheduler@loginone"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing App & Extension Scheduler ($UUID)..."

mkdir -p "$TARGET_DIR"

cp metadata.json "$TARGET_DIR/"
cp extension.js "$TARGET_DIR/"
cp prefs.js "$TARGET_DIR/"
cp LICENSE "$TARGET_DIR/"
cp -r lib "$TARGET_DIR/"
cp -r schemas "$TARGET_DIR/"

glib-compile-schemas "$TARGET_DIR/schemas"

gnome-extensions enable "$UUID" 2>/dev/null || true

echo "Installation complete."
echo "Restart GNOME Shell (on Wayland: log out and log back in; on X11: Alt+F2 -> r -> Enter)."
