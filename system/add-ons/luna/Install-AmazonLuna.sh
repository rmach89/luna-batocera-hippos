#!/bin/bash
# Amazon Luna for Batocera
# Adds an "luna" system to the EmulationStation carousel that opens
# the Amazon Luna app fullscreen (only Luna and Amazon's own
# sign-in pages), installs Launch Single Game, and adds three shortcuts to
# F1 > Applications ("Amazon Luna", "Amazon Luna Settings" and "Amazon Luna
# Uninstaller"). It puts nothing in the Ports menu (and clears entries older
# versions left there). Run by install.sh:
#     curl -fsSL https://raw.githubusercontent.com/rmach89/luna-batocera-hippos/main/install.sh | bash
#
# It uses the files in /userdata/system/add-ons/luna/ (put there by install.sh):
#   luna.png  luna1.png  luna-background.jpg (optional)
#   es_systems_luna.cfg  gamelist.xml
#   Launch-AmazonLuna.sh  Build-Runtime.py  config.json  app.asar
# and sets up the Electron browser engine: a copy already on this device
# (another add-on's or a BUA app's) is shared, otherwise it's downloaded from
# GitHub (about 100 MB).
LOGDIR=/userdata/system/logs
LOG=$LOGDIR/luna-install.log
mkdir -p "$LOGDIR"
exec > "$LOG" 2>&1

FILES=/userdata/system/add-ons/luna
ES=/userdata/system/configs/emulationstation
ROMS=/userdata/roms/luna
LIST=/userdata/system/launchsingle.systems
LS_SCRIPT=/userdata/system/configs/emulationstation/scripts/game-selected/launchsingle-launch.sh
THEMES=/usr/share/emulationstation/themes
PORTS=/userdata/roms/ports
APPS=/userdata/system/.local/share/applications
SYSAPPS=/usr/share/applications   # where Batocera's F1 > Applications looks (system area)
GAME="Amazon Luna.luna"
# Batocera or HippOS (a Debian-based system built like Batocera: same
# /userdata, same EmulationStation family). On HippOS EmulationStation runs
# as a normal user and every update replaces the system area, so nothing
# goes there: no theme art in system themes, no shortcuts in /usr, no
# service to put them back.
OS=batocera
[ -f "${LUNA_HIPPOS_VERSION:-/usr/share/hippos/version}" ] && OS=hippos
# HippOS's desktop (F1) reads its menu from here (HOME=/userdata there)
DESK_APPS=/userdata/.local/share/applications

echo "$(date): installing Amazon Luna"
if [ "$OS" = hippos ]; then
    echo "System: HippOS $(head -n1 "${LUNA_HIPPOS_VERSION:-/usr/share/hippos/version}" 2>/dev/null)"
else
    echo "System: Batocera $(head -n1 /usr/share/batocera/batocera.version 2>/dev/null)"
fi

# make sure the package files were copied over
missing=""
for f in luna.png luna-apply-update.sh luna-theme-art.sh luna-icon.png luna-uninstall-icon.png luna-settings-icon.png luna1.png es_systems_luna.cfg gamelist.xml Launch-AmazonLuna.sh Run-App.sh Return-To-Carousel.py uninstall.sh Uninstall-From-Menu.sh Build-Runtime.py Sync-GameList.py gamebox3d.py luna-service.sh config.json app.asar launchsingle/launchsingle-arm.sh launchsingle/launchsingle-launch.sh; do
    [ -s "$FILES/$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
    echo "Install failed: missing from $FILES:$missing"
    echo "Run install.sh instead: curl -fsSL https://raw.githubusercontent.com/rmach89/luna-batocera-hippos/main/install.sh | bash"
    exit 1
fi

mkdir -p "$ES" "$ROMS/images" || { echo "Install failed: could not create folders."; exit 1; }

# strip any Windows line endings picked up while copying, then set permissions
for f in es_systems_luna.cfg gamelist.xml luna-apply-update.sh luna-theme-art.sh Launch-AmazonLuna.sh Run-App.sh Return-To-Carousel.py uninstall.sh Uninstall-From-Menu.sh Build-Runtime.py Sync-GameList.py luna-service.sh config.json launchsingle/launchsingle-arm.sh launchsingle/launchsingle-launch.sh; do
    tr -d '\r' < "$FILES/$f" > "$FILES/$f.tmp" && mv "$FILES/$f.tmp" "$FILES/$f"
done
chmod +x "$FILES/luna-service.sh" "$FILES/luna-apply-update.sh" "$FILES/luna-theme-art.sh" "$FILES/Launch-AmazonLuna.sh" "$FILES/Run-App.sh" "$FILES/Return-To-Carousel.py" "$FILES/uninstall.sh" "$FILES/Uninstall-From-Menu.sh" "$FILES/Build-Runtime.py" "$FILES/Sync-GameList.py"

# --- Launch Single Game (optional: install.sh asks; LUNA_SINGLE_LAUNCH=yes/no) ---
# Two EmulationStation event scripts: when you pick a system that holds
# exactly one game, that game launches straight away.
SINGLE="${LUNA_SINGLE_LAUNCH:-yes}"
LS_DIR="$ES/scripts"
LS_ARM="$LS_DIR/system-selected/launchsingle-arm.sh"
LS_WAS_INSTALLED=0
[ -f "$LS_SCRIPT" ] && [ -f "$LS_ARM" ] && LS_WAS_INSTALLED=1
# remember the choice (the app and the game list leave single launch alone without it)
python3 - "$FILES/config.json" "$SINGLE" <<'CFG_EOF' || true
import json, sys
p, single = sys.argv[1], sys.argv[2] == "yes"
try:
    c = json.load(open(p))
except Exception:
    c = {}
c["single_launch"] = single
open(p, "w").write(json.dumps(c, indent=2) + "\n")
CFG_EOF
if [ "$SINGLE" != yes ]; then
    echo "Launch Single Game: not installed (you chose to skip it)."
    # luna out of its list, if this package put it there
    if [ -f "$FILES/added-to-list" ] && [ -f "$LIST" ]; then
        tr -d '\r' < "$LIST" | grep -vx '[[:space:]]*luna[[:space:]]*' > "$LIST.tmp" && mv "$LIST.tmp" "$LIST"
        rm -f "$FILES/added-to-list"
        echo "Took luna out of $LIST."
    fi
    if [ "$LS_WAS_INSTALLED" = 1 ] && [ ! -f "$LIST" ]; then
        echo "Note: Launch Single Game is installed with no $LIST, so every one-game system (luna too) still opens straight away."
    fi
else
mkdir -p "$LS_DIR/system-selected" "$LS_DIR/game-selected"
# remove copies from a manual install so the scripts don't run twice
for f in "$LS_DIR/system-selected/arm.sh" "$LS_DIR/game-selected/launch.sh"; do
    if [ -f "$f" ] && grep -q launchsingle "$f"; then rm -f "$f"; fi
done
cp -f "$FILES/launchsingle/launchsingle-arm.sh" "$LS_ARM"
cp -f "$FILES/launchsingle/launchsingle-launch.sh" "$LS_SCRIPT"
chmod +x "$LS_ARM" "$LS_SCRIPT"
if [ "$LS_WAS_INSTALLED" = 1 ]; then
    echo "Launch Single Game was already installed; updated it."
else
    echo "Installed Launch Single Game."
fi
fi
# nothing of this package goes in Ports; remove entries older versions left there
rm -f "$PORTS/Install Launch Single Game.sh" "$PORTS/Uninstall Launch Single Game.sh" \
      "$PORTS/Install Amazon Luna.sh" "$PORTS/Uninstall Amazon Luna.sh"

# the luna system
cp -f "$FILES/es_systems_luna.cfg" "$ES/es_systems_luna.cfg"

# one placeholder "game", its name and your artwork
echo "Placeholder for Amazon Luna. Launching it opens the Amazon Luna app." > "$ROMS/$GAME"
echo "Placeholder for Amazon Luna's settings. Launching it opens the app's settings screen." > "$ROMS/Amazon Luna Settings.luna"
# the game list: the app's entries (" Amazon Luna" and " Amazon Luna
# Settings": description, developer, genre, players...) replace older ones;
# anything else already in the list is kept
if [ ! -f "$ROMS/gamelist.xml" ]; then
    cp "$FILES/gamelist.xml" "$ROMS/gamelist.xml"
else
    python3 - "$ROMS/gamelist.xml" "$FILES/gamelist.xml" <<'GAMELIST_EOF' || cp -f "$FILES/gamelist.xml" "$ROMS/gamelist.xml"
import re, sys
mine, ours = sys.argv[1], sys.argv[2]
text = open(mine, encoding="utf-8", errors="replace").read()
entries = "".join(re.findall(r"[ \t]*<game>.*?</game>\s*", open(ours, encoding="utf-8").read(), re.S))
if "</gameList>" not in text:
    raise SystemExit(1)
# drop the old entries for the app and its settings (by their paths), keep the rest
text = re.sub(r"[ \t]*<game>(?:(?!</game>).)*?<path>\./Amazon Luna(?: Settings)?\.luna</path>.*?</game>\s*", "", text, flags=re.S)
text = text.replace("</gameList>", entries + "</gameList>", 1)
open(mine, "w", encoding="utf-8").write(text)
GAMELIST_EOF
fi
# the entry's picture (screenshot/thumbnail): the cloud icon, square, fits the tile
cp -f "$FILES/luna-icon.png" "$ROMS/images/luna.png"
cp -f "$FILES/luna-settings-icon.png" "$ROMS/images/luna-settings.png"

# launch-single-game allow-list (only when it was chosen)
if [ "$SINGLE" != yes ]; then
    :
elif [ -f "$LIST" ]; then
    if tr -d '\r' < "$LIST" | grep -qx '[[:space:]]*luna[[:space:]]*'; then
        echo "luna is already in $LIST."
    else
        [ -n "$(tail -c 1 "$LIST")" ] && echo >> "$LIST"
        echo luna >> "$LIST"
        touch "$FILES/added-to-list"
        echo "Added luna to $LIST."
    fi
elif [ "$LS_WAS_INSTALLED" = 1 ]; then
    # you deleted the list on purpose: every one-game system auto-launches
    echo "No $LIST, so every one-game system auto-launches, including luna."
else
    cat > "$LIST" <<'LIST_EOF'
# Launch Single Game: systems that open their game straight away when they
# hold exactly one game. One system short name per line (the same as its
# folder name under /userdata/roms, e.g. ports, nes, snes).
# Lines starting with # are ignored. Delete this file to allow every system.
luna
LIST_EOF
    touch "$FILES/added-to-list"
    echo "Created $LIST with luna."
fi

# " Amazon Luna Settings" in luna's list, except when Launch Single Game
# opens the app the moment luna is picked: it only does that with a single
# file in the folder, and the list is never seen then anyway (Settings is in
# the app and in F1 > Applications)
LS_SCRIPT="$ES/scripts/game-selected/launchsingle-launch.sh"
if [ -f "$LS_SCRIPT" ] && { [ ! -f "$LIST" ] || tr -d '\r' < "$LIST" | grep -qx '[[:space:]]*luna[[:space:]]*'; } \
   && ! grep -qE '"game_list": *"(all|picked)"' "$FILES/config.json" 2>/dev/null; then
    rm -f "$ROMS/Amazon Luna Settings.luna"
    python3 - "$ROMS/gamelist.xml" <<'NOSETTINGS_EOF' 2>/dev/null
import re, sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
t = re.sub(r"[ \t]*<game>(?:(?!</game>).)*?<path>\./Amazon Luna Settings\.luna</path>.*?</game>\s*", "", t, flags=re.S)
open(p, "w", encoding="utf-8").write(t)
NOSETTINGS_EOF
    echo "Launch Single Game opens the app straight away, so luna's list has no Settings entry (Settings: in the app, or F1 > Applications)."
fi

# links from an earlier install come down first (copying onto one of
# our own links would write over the app's own picture); put back after
bash "$FILES/luna-service.sh" stop >/dev/null 2>&1
# theme artwork (best effort; on Batocera, luna-service.sh puts the system
# themes' copies back at every boot)
# Themes look for a system's carousel logo and background by its name
# (luna), sometimes in per-region folders (br/ jp/ us/) and as a "-w"
# variant, so put a copy everywhere the theme might look.
[ -f "$FILES/theme-installed.txt" ] || : > "$FILES/theme-installed.txt"

theme_put() {   # theme_put <source file> <destination>
    local src="$1" dest="$2"
    [ -f "$src" ] || return 0
    # back up a file the theme already had, once (mirrored under theme-backups)
    if [ -e "$dest" ] && [ ! -e "$FILES/theme-backups$dest" ] && ! grep -qxF "$dest" "$FILES/theme-installed.txt"; then
        mkdir -p "$(dirname "$FILES/theme-backups$dest")"
        cp -a "$dest" "$FILES/theme-backups$dest"
    fi
    if cp -f "$src" "$dest" 2>/dev/null; then
        grep -qxF "$dest" "$FILES/theme-installed.txt" || echo "$dest" >> "$FILES/theme-installed.txt"
    else
        echo "Could not copy to $dest"
    fi
}

# older versions also put a second logo in themes under another name: put
# back what the theme had there (or remove it), and drop the old copy
rm -f "$FILES/greenlight.png"
if [ -f "$FILES/theme-installed.txt" ] && grep -q '/greenlight\.png$' "$FILES/theme-installed.txt"; then
    grep '/greenlight\.png$' "$FILES/theme-installed.txt" | while IFS= read -r dest; do
        if [ -e "$FILES/theme-backups$dest" ]; then cp -af "$FILES/theme-backups$dest" "$dest" 2>/dev/null; rm -f "$FILES/theme-backups$dest"
        else rm -f "$dest"; fi
    done
    grep -v '/greenlight\.png$' "$FILES/theme-installed.txt" > "$FILES/theme-installed.txt.new"; mv -f "$FILES/theme-installed.txt.new" "$FILES/theme-installed.txt"
fi

count=0
usr_changed=0
THEME_DIRS=("$THEMES"/* /userdata/themes/*)
if [ "$OS" = hippos ]; then
    # system themes are read-only for the HippOS user and replaced by updates
    THEME_DIRS=(/userdata/themes/*)
    echo "HippOS: themes in /userdata/themes get the carousel art here; HippOS's built-in themes get theirs from HippOS."
fi
for theme in "${THEME_DIRS[@]}"; do
    [ -d "$theme" ] || continue
    case "$theme" in "$THEMES"/*) under_usr=1 ;; *) under_usr=0 ;; esac
    touched=0
    # Carbon-style themes (art/logos, art/background)
    if [ -d "$theme/art" ]; then
        mkdir -p "$theme/art/logos" 2>/dev/null || { echo "Could not create $theme/art/logos"; continue; }
        # carousel logo: the main folder plus any region folders the theme has
        for dir in "$theme/art/logos" "$theme/art/logos/br" "$theme/art/logos/jp" "$theme/art/logos/us"; do
            [ -d "$dir" ] || continue
            theme_put "$FILES/luna.png" "$dir/luna.png"
            theme_put "$FILES/luna.png" "$dir/luna-w.png"
        done
        theme_put "$FILES/luna1.png" "$theme/art/logos/luna1.png"
        # carousel background (must be .jpg), only in themes that have per-system backgrounds
        for dir in "$theme/art/background" "$theme/art/background/br" "$theme/art/background/jp" "$theme/art/background/us"; do
            [ -d "$dir" ] || continue
            theme_put "$FILES/luna-background.jpg" "$dir/luna.jpg"
        done
        touched=1
    fi
    # other themes: wherever the theme keeps a PNG logo for each system (found
    # by looking for its SNES logo), put the luna logo beside it. Themes that
    # only use SVG logos will show the system's name instead.
    while IFS= read -r ref; do
        dir="$(dirname "$ref")"
        case "$dir" in "$theme/art/logos"|"$theme/art/logos/"*) continue ;; esac
        theme_put "$FILES/luna.png" "$dir/luna.png"
        touched=1
    done < <(find "$theme" -maxdepth 6 -type f -iname 'snes.png' 2>/dev/null | grep -i 'logo')
    if [ "$touched" = 1 ]; then
        count=$((count+1))
        [ "$under_usr" = 1 ] && usr_changed=1
    fi
done
echo "Copied the carousel logo (and background, where the theme has them) into $count theme(s)."

# --- HippOS: its built-in themes ---
# HippOS's own themes are in its system area, which this installer never
# writes to (no sudo): HippOS ships the luna carousel art in them itself.
# Earlier versions of this installer copied a logo there with sudo and kept
# it there with a start script: that script is removed (copies already made
# go away with the next HippOS update).
# Themes added to /userdata/themes later get the art too: EmulationStation
# runs luna-theme-art.sh when it starts. It only touches /userdata/themes,
# never replaces a file a theme has, and stops at once when no theme has
# changed since the last time.
if [ "$OS" = hippos ]; then
    rm -f "$ES/scripts/start/luna-theme-logo.sh" "$FILES/hippos-theme-files.txt" "$FILES/luna-hippos-logo.sh" "$FILES/luna-hippos.png" "$FILES/luna.svg" "$FILES/theme-art.stamp"
    mkdir -p "$ES/scripts/start"
    cat > "$ES/scripts/start/luna-theme-art.sh" << 'START_EOF'
#!/bin/bash
# Amazon Luna: carousel art for themes added to /userdata/themes later
# (only adds missing files; does nothing when no theme has changed).
s=/userdata/system/add-ons/luna/luna-theme-art.sh
[ -x "$s" ] && "$s" >/dev/null 2>&1
exit 0
START_EOF
    chmod +x "$ES/scripts/start/luna-theme-art.sh"
    "$FILES/luna-theme-art.sh"
    echo "HippOS: themes added to /userdata/themes later get the carousel art when EmulationStation starts."
fi

# stop here if the important parts are missing, leaving the installer in place
if [ ! -f "$ES/es_systems_luna.cfg" ] || [ ! -x "$FILES/Launch-AmazonLuna.sh" ] || [ ! -f "$ROMS/$GAME" ]; then
    echo "Install failed: the system file, launcher or placeholder is missing."
    exit 1
fi

# download and set up the newest browser engine (Electron), replacing an
# older one from an earlier install. If there's no internet right now, the
# install still finishes and this runs again on first launch.
if command -v python3 >/dev/null 2>&1; then
    python3 "$FILES/Build-Runtime.py" --latest || echo "Note: the browser engine isn't set up yet. It will be tried again the first time you launch Amazon Luna."
else
    echo "Install failed: Python 3 is needed to set up the app, and it wasn't found."
    exit 1
fi

# write the uninstaller into the add-on folder (not Ports; run uninstall.sh)
cat > "$FILES/Uninstall-AmazonLuna.sh" <<'UNINSTALL_EOF'
#!/bin/bash
# Removes Amazon Luna. Run by uninstall.sh, which asks first whether
# to keep Launch Single Game and passes the answer as
#   LUNA_LAUNCHSINGLE=keep   (the default)  or  LUNA_LAUNCHSINGLE=remove
LOGDIR=/userdata/system/logs
mkdir -p "$LOGDIR"
exec > "$LOGDIR/luna-install.log" 2>&1

FILES=/userdata/system/add-ons/luna
ES=/userdata/system/configs/emulationstation
ROMS=/userdata/roms/luna
LIST=/userdata/system/launchsingle.systems
PORTS=/userdata/roms/ports

echo "$(date): removing Amazon Luna"
# our links in the system area come down first, before a theme's own
# pictures are put back (copying onto one of our links would write over the app's)
[ -f "$FILES/luna-service.sh" ] && bash "$FILES/luna-service.sh" stop >/dev/null 2>&1
# the games Settings > Batocera game list added (files, pictures, entries)
if [ -f "$FILES/gamelist-state.json" ] && [ -f "$FILES/Sync-GameList.py" ]; then
    python3 "$FILES/Sync-GameList.py" off >/dev/null 2>&1 && echo "Removed the games from Batocera's list."
fi
rm -f "$ES/es_systems_luna.cfg"
rm -f "$ROMS/Amazon Luna.luna" "$ROMS/Amazon Luna Settings.luna" "$ROMS/gamelist.xml" "$ROMS/images/luna.png" "$ROMS/images/luna-settings.png"
rmdir "$ROMS/images" "$ROMS" 2>/dev/null

# take luna off the allow-list, only if the installer put it there
if [ -f "$FILES/added-to-list" ] && [ -f "$LIST" ]; then
    tr -d '\r' < "$LIST" | grep -vx '[[:space:]]*luna[[:space:]]*' > "$LIST.tmp"
    mv "$LIST.tmp" "$LIST"
fi
rm -f "$FILES/added-to-list"

# put back theme files themes had before, remove the ones we added
if [ -f "$FILES/theme-installed.txt" ]; then
    while IFS= read -r dest; do
        [ -n "$dest" ] || continue
        saved="$FILES/theme-backups$dest"
        if [ ! -f "$saved" ]; then
            # older versions kept backups as theme-backups/<theme>/<file>
            tname="$(basename "$(dirname "$(dirname "$(dirname "$dest")")")")"
            saved="$FILES/theme-backups/$tname/$(basename "$dest")"
        fi
        if [ -f "$saved" ]; then cp -a "$saved" "$dest"; else rm -f "$dest"; fi
    done < "$FILES/theme-installed.txt"
fi
rm -rf "$FILES/theme-installed.txt" "$FILES/theme-backups"

# remove the downloaded browser engine (about 250 MB unpacked)
rm -rf "$FILES/runtime" "$FILES/runtime.old"

# remove the F1 > Applications shortcuts (both places), refresh F1's menu
rm -f /userdata/system/.local/share/applications/luna-amazon-luna.desktop \
      /userdata/system/.local/share/applications/luna-uninstall.desktop \
      /userdata/system/.local/share/applications/luna-settings.desktop \
      /usr/share/applications/luna-amazon-luna.desktop \
      /usr/share/applications/luna-uninstall.desktop \
      /usr/share/applications/luna-settings.desktop
rm -f /userdata/.local/share/applications/luna-amazon-luna.desktop \
      /userdata/.local/share/applications/luna-uninstall.desktop \
      /userdata/.local/share/applications/luna-settings.desktop
rm -rf /userdata/system/.cache/menus

# stop whatever put the shortcuts and art back at boot
SVC=/userdata/system/services/luna
if [ -f "$SVC" ]; then
    for svc in batocera-services hippos-services; do
        command -v $svc >/dev/null 2>&1 && { $svc stop luna >/dev/null 2>&1; $svc disable luna >/dev/null 2>&1; }
    done
    rm -f "$SVC"
    echo "Removed the luna service."
fi
CUSTOM=/userdata/system/custom.sh
if [ -f "$CUSTOM" ] && grep -q '# luna-boot-restore' "$CUSTOM"; then
    grep -v '# luna-boot-restore' "$CUSTOM" > "$CUSTOM.tmp" && cat "$CUSTOM.tmp" > "$CUSTOM" && rm -f "$CUSTOM.tmp"
    echo "Took Amazon Luna's line out of $CUSTOM."
    if [ -f "$FILES/created-custom-sh" ] && ! grep -vqE '^[[:space:]]*(#.*)?$' "$CUSTOM"; then
        rm -f "$CUSTOM"; echo "Removed $CUSTOM (it only had that line)."
    fi
fi
rm -f "$FILES/created-custom-sh" "$FILES/persist-mode"

# HippOS: the start script earlier versions used for the built-in theme logo
rm -f "$ES/scripts/start/luna-theme-logo.sh" "$ES/scripts/start/luna-theme-art.sh" "$FILES/hippos-theme-files.txt" "$FILES/theme-art.stamp"

# nothing of this package in Ports (also clears entries from older versions)
rm -f "$PORTS/Install Amazon Luna.sh" "$PORTS/Uninstall Amazon Luna.sh"

# Launch Single Game: keep unless asked to remove it
if [ "${LUNA_LAUNCHSINGLE:-keep}" = "remove" ]; then
    rm -f "$ES/scripts/system-selected/launchsingle-arm.sh" "$ES/scripts/game-selected/launchsingle-launch.sh" /tmp/launchsingle_armed
    rm -f "$PORTS/Install Launch Single Game.sh" "$PORTS/Uninstall Launch Single Game.sh"
    rm -rf /userdata/system/launchsingle
    echo "Removed Launch Single Game. Your launchsingle.systems list was left in place."
else
    echo "Kept Launch Single Game."
fi

echo "Removed Amazon Luna."
echo "Your Amazon sign-in (profile), settings (config.json) and the package files are still in $FILES"
echo "so reinstalling keeps you signed in. Delete that folder to remove everything."

( sleep 2; curl -s http://127.0.0.1:1234/reloadgames ) >/dev/null 2>&1 &
exit 0
UNINSTALL_EOF
chmod +x "$FILES/Uninstall-AmazonLuna.sh"

# --- F1 > Applications shortcuts ---
mkdir -p "$APPS"
cat > "$APPS/luna-amazon-luna.desktop" <<DESKTOP_EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Amazon Luna
Comment=Play Amazon Luna (luna.amazon.com)
Exec=/bin/bash $FILES/Launch-AmazonLuna.sh
Icon=$FILES/luna-icon.png
Terminal=false
Categories=Game;batocera.linux;
DESKTOP_EOF
cat > "$APPS/luna-uninstall.desktop" <<DESKTOP_EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Amazon Luna Uninstaller
Comment=Remove Amazon Luna (asks first)
Exec=/bin/bash $FILES/Uninstall-From-Menu.sh
Icon=$FILES/luna-uninstall-icon.png
Terminal=false
Categories=Utility;batocera.linux;
DESKTOP_EOF
cat > "$APPS/luna-settings.desktop" <<DESKTOP_EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Amazon Luna Settings
Comment=Region, picture, game list and more
Exec=/bin/bash $FILES/Launch-AmazonLuna.sh --settings
Icon=$FILES/luna-settings-icon.png
Terminal=false
Categories=Utility;batocera.linux;
DESKTOP_EOF
chmod 755 "$APPS/luna-amazon-luna.desktop" "$APPS/luna-uninstall.desktop" "$APPS/luna-settings.desktop"
if [ "$OS" = hippos ]; then
    # HippOS's desktop (F1) has a full menu that reads the user's own folder:
    # no copy in the system area needed
    mkdir -p "$DESK_APPS"
    for f in luna-amazon-luna.desktop luna-uninstall.desktop luna-settings.desktop; do
        sed 's/;batocera\.linux;/;/' "$APPS/$f" > "$DESK_APPS/$f" && chmod 755 "$DESK_APPS/$f"
    done
    echo "Added \"Amazon Luna\", \"Amazon Luna Settings\" and \"Amazon Luna Uninstaller\" to the desktop's applications menu (F1)."
# Batocera's F1 > Applications reads the system folder, so put a copy there too
elif mkdir -p "$SYSAPPS" 2>/dev/null && cp -f "$APPS/luna-amazon-luna.desktop" "$APPS/luna-uninstall.desktop" "$APPS/luna-settings.desktop" "$SYSAPPS/" 2>/dev/null; then
    chmod 755 "$SYSAPPS/luna-amazon-luna.desktop" "$SYSAPPS/luna-uninstall.desktop" "$SYSAPPS/luna-settings.desktop"
else
    echo "Could not copy the shortcuts to $SYSAPPS."
fi
# make F1 re-read its menu
rm -rf /userdata/system/.cache/menus
[ "$OS" = hippos ] || echo "Added \"Amazon Luna\", \"Amazon Luna Settings\" and \"Amazon Luna Uninstaller\" to F1 > Applications."

# the system area forgets changes at every reboot, so
# luna-service.sh links the theme art and F1 shortcuts there from
# /userdata at every boot:
#   - as a Batocera service (the way BUA's add-ons do it), when this Batocera
#     has services; shown in System settings > Services
#   - otherwise from one marked line in /userdata/system/custom.sh
SVC_DIR=/userdata/system/services
CUSTOM=/userdata/system/custom.sh
if [ -e "$SVC_DIR/symlink_manager" ] || [ -f /userdata/roms/ports/bua.sh ]; then
    echo "Batocera Unofficial Add-ons (BUA) is installed."
fi
MODE=custom
[ "$OS" = hippos ] && MODE=none
if [ "$MODE" = none ]; then
    : # HippOS: nothing of ours is in the system area, so nothing to put back at boot
elif command -v batocera-services >/dev/null 2>&1; then
    mkdir -p "$SVC_DIR" && cp -f "$FILES/luna-service.sh" "$SVC_DIR/luna" && chmod +x "$SVC_DIR/luna" && MODE=service
fi
if [ "$MODE" = none ]; then
    # a boot line or service from an earlier install isn't needed
    if [ -f "$CUSTOM" ] && grep -q '# luna-boot-restore' "$CUSTOM"; then
        grep -v '# luna-boot-restore' "$CUSTOM" > "$CUSTOM.tmp" && cat "$CUSTOM.tmp" > "$CUSTOM" && rm -f "$CUSTOM.tmp"
    fi
    rm -f "$SVC_DIR/luna"
    echo "HippOS: everything is in /userdata, so nothing needs putting back after a reboot or update."
elif [ "$MODE" = service ]; then
    batocera-services enable luna >/dev/null 2>&1 || echo "Note: couldn't switch on the luna service; turn it on in System settings > Services."
    batocera-services start luna >/dev/null 2>&1 || bash "$SVC_DIR/luna" start
    # a boot line left by an earlier version isn't needed any more
    if [ -f "$CUSTOM" ] && grep -q '# luna-boot-restore' "$CUSTOM"; then
        grep -v '# luna-boot-restore' "$CUSTOM" > "$CUSTOM.tmp" && cat "$CUSTOM.tmp" > "$CUSTOM" && rm -f "$CUSTOM.tmp"
    fi
    echo "Keeping the shortcuts and carousel art with the luna service (System settings > Services)."
else
    LINE='[ "$1" = "stop" ] || bash /userdata/system/add-ons/luna/luna-service.sh start >/dev/null 2>&1 &  # luna-boot-restore (Amazon Luna: links its F1 shortcuts and carousel art at boot)'
    if [ -f "$CUSTOM" ]; then
        if ! grep -q '# luna-boot-restore' "$CUSTOM"; then
            python3 - "$CUSTOM" "$LINE" <<'CUSTOM_EOF'
import sys
p, line = sys.argv[1], sys.argv[2]
text = open(p, encoding="utf-8", errors="surrogateescape").read().replace("\r\n", "\n")
lines = text.split("\n")
at = 1 if lines and lines[0].startswith("#!") else 0
lines.insert(at, line)
open(p, "w", encoding="utf-8", errors="surrogateescape").write("\n".join(lines))
CUSTOM_EOF
        fi
    else
        printf '#!/bin/bash\n%s\n' "$LINE" > "$CUSTOM"
        touch "$FILES/created-custom-sh"
    fi
    chmod +x "$CUSTOM" 2>/dev/null
    bash "$FILES/luna-service.sh" start
    echo "This Batocera has no services: keeping the shortcuts and carousel art with a line in $CUSTOM."
fi
echo "$MODE" > "$FILES/persist-mode"

echo "Installed. Restart EmulationStation to see Amazon Luna in the carousel."
echo "To remove it later: F1 > Applications > Amazon Luna Uninstaller,"
echo "or run: bash /userdata/system/add-ons/luna/uninstall.sh"

# refresh lists (best effort)
( sleep 2; curl -s http://127.0.0.1:1234/reloadgames ) >/dev/null 2>&1 &
exit 0
