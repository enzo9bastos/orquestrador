#!/usr/bin/env bash
# Installs (or updates) the "Orquestrador: window presence" GNOME Shell
# extension for the current user and enables it. On Wayland GNOME only picks up
# a NEW extension after you log out and back in; updates to an installed one
# also need a new session.
set -euo pipefail
UUID=orq-janelas@orquestrador
ORIGEM="$(cd "$(dirname "$0")" && pwd)/$UUID"
DESTINO="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
command -v gnome-extensions >/dev/null || { echo "gnome-extensions not found: this is for GNOME Shell only"; exit 1; }
mkdir -p "$DESTINO"
for f in metadata.json extension.js; do install -m 644 "$ORIGEM/$f" "$DESTINO/$f"; done
echo "installed in $DESTINO"
if gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "enabled. If the app still can't see it, log out and back in (Wayland loads new extensions only on login)."
else
  gsettings set org.gnome.shell enabled-extensions "$(gsettings get org.gnome.shell enabled-extensions | python3 -c "import sys,ast; l=ast.literal_eval(sys.stdin.read().replace('@as ','')); l+=[] if '$UUID' in l else ['$UUID']; print(l)")"
  echo "marked to enable. Log out and back in to load it (Wayland)."
fi
