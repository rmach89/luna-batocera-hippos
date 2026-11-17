#!/bin/bash
# Amazon Luna: keeps the app's F1 >
# Applications shortcuts and carousel art in Batocera's system area.
#
# That area (/usr) forgets changes at every reboot, so this links the files
# there from /userdata at every boot:
#   - as a Batocera service (/userdata/system/services/luna, the way BUA's
#     add-ons do it), shown in System settings > Services, or
#   - where Batocera has no services, from one marked line in
#     /userdata/system/custom.sh.
#   luna-service.sh start    link them (only ours; nothing else is touched)
#   luna-service.sh stop     remove our links (a theme's own picture comes back)
#   luna-service.sh status   show what's linked
FILES="${LUNA_FILES:-/userdata/system/add-ons/luna}"
APPS="${LUNA_APPS:-/userdata/system/.local/share/applications}"
SYSAPPS="${LUNA_SYSAPPS:-/usr/share/applications}"
MENUS="${LUNA_MENUS:-/userdata/system/.cache/menus}"
LOG="${LUNA_BOOT_LOG:-/userdata/system/logs/luna-boot.log}"
SYSTEM_AREA="${LUNA_SYSTEM_AREA:-/usr/}"
SHORTCUTS="luna-amazon-luna.desktop luna-settings.desktop luna-uninstall.desktop"

# each (link, file it points to): the shortcuts, then the theme pictures the installer placed
pairs() {
    for f in $SHORTCUTS; do
        [ -f "$APPS/$f" ] && printf '%s\t%s\n' "$SYSAPPS/$f" "$APPS/$f"
    done
    [ -f "$FILES/theme-installed.txt" ] || return 0
    while IFS= read -r dest; do
        case "$dest" in "$SYSTEM_AREA"*) ;; *) continue ;; esac   # themes in /userdata keep their copy anyway
        case "$(basename "$dest")" in
            luna.png|luna-w.png) src="$FILES/luna.png" ;;
            luna1.png)             src="$FILES/luna1.png" ;;
            luna.jpg)              src="$FILES/luna-background.jpg" ;;
            *) continue ;;
        esac
        [ -f "$src" ] && printf '%s\t%s\n' "$dest" "$src"
    done < "$FILES/theme-installed.txt"
}

say() { mkdir -p "$(dirname "$LOG")" 2>/dev/null; echo "$(date): $*" >> "$LOG"; }

case "$1" in
    start)
        [ -d "$FILES" ] || exit 0
        linked=0
        while IFS=$'\t' read -r link src; do
            [ -n "$link" ] || continue
            [ "$(readlink "$link" 2>/dev/null)" = "$src" ] && continue
            # the F1 folder is made if needed; a theme folder a Batocera update removed is skipped
            if [ ! -d "$(dirname "$link")" ]; then
                [ "$(dirname "$link")" = "$SYSAPPS" ] && mkdir -p "$SYSAPPS" 2>/dev/null || continue
            fi
            ln -sfn "$src" "$link" 2>/dev/null && linked=$((linked+1))
        done < <(pairs)
        [ "$linked" -gt 0 ] && rm -rf "$MENUS"
        say "luna links: $linked made (F1 shortcuts and carousel art)"
        ;;
    stop)
        removed=0
        while IFS=$'\t' read -r link src; do
            [ -L "$link" ] && [ "$(readlink "$link")" = "$src" ] || continue
            rm -f "$link"
            # a theme's own picture that ours replaced: put it back
            [ -f "$FILES/theme-backups$link" ] && cp -a "$FILES/theme-backups$link" "$link" 2>/dev/null
            removed=$((removed+1))
        done < <(pairs)
        [ "$removed" -gt 0 ] && rm -rf "$MENUS"
        say "luna links: $removed removed"
        ;;
    status)
        while IFS=$'\t' read -r link src; do
            if [ "$(readlink "$link" 2>/dev/null)" = "$src" ]; then echo "linked:  $link"
            elif [ -e "$link" ]; then echo "a file (not our link): $link"
            else echo "missing: $link"; fi
        done < <(pairs)
        ;;
    *)
        echo "Usage: $0 {start|stop|status}"
        exit 1
        ;;
esac
exit 0
