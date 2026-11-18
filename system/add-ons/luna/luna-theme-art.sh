#!/bin/bash
# HippOS: adds the Amazon Luna carousel art to themes in /userdata/themes
# that don't have it yet (a theme installed or updated after Amazon Luna).
# Run by EmulationStation when it starts, from
# /userdata/system/configs/emulationstation/scripts/start/luna-theme-art.sh.
#  - Only /userdata/themes is touched; HippOS's built-in themes ship the
#    luna art themselves.
#  - Files a theme already has are never replaced.
#  - Nothing has changed in /userdata/themes since the last run (the usual
#    case): it stops at once.
# What it adds is listed in theme-installed.txt, so the uninstaller removes it.
FILES="${LUNA_HOME:-/userdata/system/add-ons/luna}"
THEMES_DIR="${LUNA_USER_THEMES:-/userdata/themes}"
STAMP="$FILES/theme-art.stamp"
LIST="$FILES/theme-installed.txt"

[ -d "$THEMES_DIR" ] && [ -f "$FILES/luna.png" ] || exit 0

# the themes and when each last changed: the same as last time = nothing to do
now="$(stat -c '%n %Y' "$THEMES_DIR" "$THEMES_DIR"/* 2>/dev/null)"
[ -f "$STAMP" ] && [ "$now" = "$(cat "$STAMP" 2>/dev/null)" ] && exit 0

added=0
put() {   # put <source> <destination>: only when the destination is missing
    [ -f "$1" ] && [ ! -e "$2" ] || return 0
    if cp "$1" "$2" 2>/dev/null; then
        added=$((added+1))
        grep -qxF "$2" "$LIST" 2>/dev/null || echo "$2" >> "$LIST"
    fi
}

for theme in "$THEMES_DIR"/*; do
    [ -d "$theme" ] || continue
    # Carbon-style themes (art/logos, art/background)
    if [ -d "$theme/art" ]; then
        mkdir -p "$theme/art/logos" 2>/dev/null || continue
        for dir in "$theme/art/logos" "$theme/art/logos/br" "$theme/art/logos/jp" "$theme/art/logos/us"; do
            [ -d "$dir" ] || continue
            put "$FILES/luna.png" "$dir/luna.png"
            put "$FILES/luna.png" "$dir/luna-w.png"
        done
        put "$FILES/luna1.png" "$theme/art/logos/luna1.png"
        for dir in "$theme/art/background" "$theme/art/background/br" "$theme/art/background/jp" "$theme/art/background/us"; do
            [ -d "$dir" ] || continue
            put "$FILES/luna-background.jpg" "$dir/luna.jpg"
        done
    fi
    # other themes: beside the theme's own PNG logo for each system
    while IFS= read -r ref; do
        dir="$(dirname "$ref")"
        case "$dir" in "$theme/art/logos"|"$theme/art/logos/"*) continue ;; esac
        put "$FILES/luna.png" "$dir/luna.png"
    done < <(find "$theme" -maxdepth 6 -type f -iname 'snes.png' 2>/dev/null | grep -i 'logo')
done

# remember the state after our own changes, so the next start has nothing to do
stat -c '%n %Y' "$THEMES_DIR" "$THEMES_DIR"/* > "$STAMP" 2>/dev/null
[ "$added" -gt 0 ] && echo "$(date): luna-theme-art: added $added file(s) to themes in $THEMES_DIR" >> /userdata/system/logs/luna-install.log 2>/dev/null
exit 0
