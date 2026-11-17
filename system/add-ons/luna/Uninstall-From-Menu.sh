#!/bin/bash
# Run by the "Amazon Luna Uninstaller" shortcut in F1 > Applications.
# Opens a terminal window and runs the uninstaller in it, which first says
# "You are about to remove Amazon Luna" and asks "Are you sure?".
UNINSTALL=/userdata/system/add-ons/luna/uninstall.sh
TITLE="Amazon Luna Uninstaller"
LOG=/userdata/system/logs/luna-install.log

if [ ! -f "$UNINSTALL" ]; then
    echo "$(date): menu uninstall: $UNINSTALL not found" >> "$LOG"
    exit 1
fi

if command -v xterm >/dev/null 2>&1; then
    exec xterm -T "$TITLE" -geometry 100x30 -e bash "$UNINSTALL" --from-menu
elif command -v lxterminal >/dev/null 2>&1; then
    exec lxterminal --title="$TITLE" -e bash "$UNINSTALL" --from-menu
elif command -v xfce4-terminal >/dev/null 2>&1; then
    exec xfce4-terminal --title="$TITLE" -x bash "$UNINSTALL" --from-menu
fi
echo "$(date): menu uninstall: no terminal program found; run: bash $UNINSTALL" >> "$LOG"
exit 1
