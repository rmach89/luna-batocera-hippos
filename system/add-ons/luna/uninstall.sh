#!/bin/bash
# Uninstaller for Amazon Luna on Batocera (and HippOS).
# Run it in a terminal (F1 > Applications > xterm, or SSH):
#     bash /userdata/system/add-ons/luna/uninstall.sh
# It asks whether to keep Launch Single Game (which came with this
# package) and what to keep for a later reinstall: everything (the
# default), the settings only (profiles removed), or nothing.
# Add --all to remove everything without being asked:
#     bash /userdata/system/add-ons/luna/uninstall.sh --all
# The "Amazon Luna Uninstaller" shortcut in F1 > Applications runs
# this in a terminal window with --from-menu (waits for Enter at the end).
# This file lives in the folder it may delete (--all), so read it whole
# before doing anything.
{
USERDATA=/userdata
FILES=$USERDATA/system/add-ons/luna
ES=$USERDATA/system/configs/emulationstation
PORTS=$USERDATA/roms/ports
LOGDIR=$USERDATA/system/logs
ALL=0
FROM_MENU=0
for arg in "$@"; do
    case "$arg" in
        --all) ALL=1 ;;
        --from-menu) FROM_MENU=1 ;;
    esac
done

say() { echo "[Amazon Luna] $*"; }
# Run from BUA (Batocera Unofficial Add-ons): its own "dialog" shows the
# questions on BUA's screen (terminal prompts would wait unseen there)
BUA=
[ "$(type -t dialog 2>/dev/null)" = function ] && BUA=1
finish() {   # finish <exit code>: in the menu's window, wait so you can read it
    if [ "$FROM_MENU" = 1 ] && [ -z "$BUA" ] && [ -t 0 ]; then
        echo
        read -r -p "Press Enter to exit the uninstaller. " _
    fi
    exit "$1"
}

[ -d "$USERDATA/system" ] || { echo "This must be run on Batocera or HippOS."; finish 1; }

# --- a child or teen plays on this machine: the adult PIN first ---
# (a child's or teen's profile is set up). Without the PIN nothing is
# removed, with --all too.
child_here() {
    python3 - "$FILES" <<'CHILD_EOF'
import json, os, sys
f = sys.argv[1]
def load(n):
    try:
        with open(os.path.join(f, n), encoding="utf-8") as h:
            return json.load(h)
    except Exception:
        return {}
p = load("profiles.json")
child = any(isinstance(x, dict) and x.get("age") in ("Child", "Teen") for x in p.get("profiles", []))
sys.exit(0 if child else 1)
CHILD_EOF
}
pin_ok() {   # pin_ok <code>: matches the salted SHA-256 in "pin"
    python3 - "$FILES/pin" "$1" <<'PIN_EOF'
import hashlib, sys
try:
    salt, h = open(sys.argv[1], encoding="utf-8").read().strip().split(":")
except Exception:
    sys.exit(1)
sys.exit(0 if hashlib.sha256((salt + ":" + sys.argv[2]).encode()).hexdigest() == h else 1)
PIN_EOF
}
if [ -d "$FILES" ] && command -v python3 >/dev/null 2>&1 && child_here; then
    echo
    say "A child's or teen's profile is set up on this machine, so removing Amazon Luna"
    say "needs the adult PIN (the one the app asks for)."
    if [ ! -s "$FILES/pin" ]; then
        say "No PIN has been set yet. Open an adult's profile in the app to create one"
        say "(or remove the child's or teen's profile there), then run the uninstaller again."
        say "Nothing was changed."
        finish 1
    fi
    if [ -n "$BUA" ]; then
        # BUA can't take typed answers, so the PIN can't be entered there
        dialog --title "Amazon Luna" --msgbox "A child's or teen's profile is set up, so removing Amazon Luna needs the adult PIN, which can't be typed here.

Use F1 > Applications > Amazon Luna Uninstaller instead. Nothing was changed." 0 0
        say "Needs the PIN: use F1 > Applications > Amazon Luna Uninstaller. Nothing was changed."
        finish 1
    fi
    if [ ! -t 0 ]; then
        say "Run this in a terminal to enter the PIN. Nothing was changed."
        finish 1
    fi
    tries=0
    while :; do
        read -r -s -p "PIN: " code; echo
        if pin_ok "$code"; then break; fi
        tries=$((tries + 1))
        if [ "$tries" -ge 3 ]; then
            say "Wrong PIN. Nothing was changed."
            echo "$(date): uninstall stopped: wrong PIN (a child's profile is set up)" >> "$LOGDIR/luna-install.log"
            finish 1
        fi
        say "Wrong PIN, try again."
    done
fi

# --- are you sure? ---
if [ "$ALL" != 1 ] && [ -n "$BUA" ]; then
    dialog --title "Amazon Luna" --yesno "You are about to remove Amazon Luna. Are you sure?" 0 0 \
        || { say "Nothing was changed."; finish 0; }
elif [ "$ALL" != 1 ] && [ -t 0 ]; then
    echo
    say "You are about to remove Amazon Luna."
    read -r -p "Are you sure? [y/N] " a
    case "$a" in
        y|Y|yes|YES) ;;
        *) say "Nothing was changed."; finish 0 ;;
    esac
fi

# HippOS: the start script earlier versions used for the built-in theme logo
rm -f "$ES/scripts/start/luna-theme-logo.sh" "$ES/scripts/start/luna-theme-art.sh" "$FILES/theme-art.stamp"

# --- Launch Single Game: keep it? (the default is keep) ---
LS_ARM="$ES/scripts/system-selected/launchsingle-arm.sh"
LS_LAUNCH="$ES/scripts/game-selected/launchsingle-launch.sh"
launchsingle=keep
if [ -f "$LS_ARM" ] || [ -f "$LS_LAUNCH" ]; then
    if [ "$ALL" = 1 ]; then
        launchsingle=remove
    elif [ -n "$BUA" ]; then
        dialog --title "Launch Single Game" --yesno "This package came with Launch Single Game, which opens a system's game straight away when that system has exactly one game.

Keep Launch Single Game for your other systems?" 0 0 \
            || launchsingle=remove
    elif [ -t 0 ]; then
        echo
        say "This package came with Launch Single Game, which opens a system's game"
        say "straight away when that system has exactly one game."
        read -r -p "Keep Launch Single Game for your other systems? [Y/n] " a
        case "$a" in n|N|no|NO) launchsingle=remove ;; esac
    fi
fi

# --- remove Amazon Luna ---
if [ -f "$FILES/Uninstall-AmazonLuna.sh" ]; then
    say "Removing Amazon Luna..."
    LUNA_LAUNCHSINGLE="$launchsingle" bash "$FILES/Uninstall-AmazonLuna.sh"
    cat "$LOGDIR/luna-install.log" 2>/dev/null
elif [ -f "$PORTS/Uninstall Amazon Luna.sh" ]; then
    # installed by an older version, which kept its uninstaller in Ports
    say "Removing Amazon Luna (older version)..."
    bash "$PORTS/Uninstall Amazon Luna.sh"
    cat "$LOGDIR/luna-install.log" 2>/dev/null
    if [ "$launchsingle" = remove ]; then
        rm -f "$LS_ARM" "$LS_LAUNCH" /tmp/launchsingle_armed
        rm -rf "$USERDATA/system/launchsingle"
        say "Removed Launch Single Game."
    fi
else
    say "Amazon Luna's uninstaller wasn't found; removing its files directly..."
    rm -f "$ES/es_systems_luna.cfg"
    rm -f "$USERDATA/roms/luna/Amazon Luna.luna" "$USERDATA/roms/luna/gamelist.xml" "$USERDATA/roms/luna/images/luna.png"
    rmdir "$USERDATA/roms/luna/images" "$USERDATA/roms/luna" 2>/dev/null
    rm -rf "$FILES/runtime" "$FILES/runtime.old" "$FILES/runtime.next" "$FILES/update-staged" "$FILES/update-staged.new"
    rm -f "$USERDATA/system/.local/share/applications/luna-amazon-luna.desktop" \
          "$USERDATA/system/.local/share/applications/luna-uninstall.desktop" \
          "$USERDATA/system/.local/share/applications/luna-settings.desktop" \
          /usr/share/applications/luna-amazon-luna.desktop \
          /usr/share/applications/luna-uninstall.desktop \
          /usr/share/applications/luna-settings.desktop \
          "$USERDATA/.local/share/applications/luna-amazon-luna.desktop" \
          "$USERDATA/.local/share/applications/luna-uninstall.desktop" \
          "$USERDATA/.local/share/applications/luna-settings.desktop"
    rm -rf "$USERDATA/system/.cache/menus"
    # the luna service, or the custom.sh line
    if [ -f "$USERDATA/system/services/luna" ]; then
        for svc in batocera-services hippos-services; do
            command -v $svc >/dev/null 2>&1 && { $svc stop luna >/dev/null 2>&1; $svc disable luna >/dev/null 2>&1; }
        done
        rm -f "$USERDATA/system/services/luna"
    fi
    if [ -f "$USERDATA/system/custom.sh" ] && grep -q '# luna-boot-restore' "$USERDATA/system/custom.sh"; then
        grep -v '# luna-boot-restore' "$USERDATA/system/custom.sh" > "$USERDATA/system/custom.sh.tmp" \
            && cat "$USERDATA/system/custom.sh.tmp" > "$USERDATA/system/custom.sh" && rm -f "$USERDATA/system/custom.sh.tmp"
        if [ -f "$FILES/created-custom-sh" ] && ! grep -vqE '^[[:space:]]*(#.*)?$' "$USERDATA/system/custom.sh"; then
            rm -f "$USERDATA/system/custom.sh"
        fi
    fi
    if [ -f "$FILES/added-to-list" ] && [ -f "$USERDATA/system/launchsingle.systems" ]; then
        tr -d '\r' < "$USERDATA/system/launchsingle.systems" | grep -vx '[[:space:]]*luna[[:space:]]*' > "$USERDATA/system/launchsingle.systems.tmp"
        mv "$USERDATA/system/launchsingle.systems.tmp" "$USERDATA/system/launchsingle.systems"
    fi
    if [ "$launchsingle" = remove ]; then
        rm -f "$LS_ARM" "$LS_LAUNCH" /tmp/launchsingle_armed
        rm -rf "$USERDATA/system/launchsingle"
        say "Removed Launch Single Game."
    fi
fi
# nothing of this package left in Ports
rm -f "$PORTS/Install Amazon Luna.sh" "$PORTS/Uninstall Amazon Luna.sh" \
      "$PORTS/Install Launch Single Game.sh" "$PORTS/Uninstall Launch Single Game.sh"

# --- sign-ins, profiles and settings: what to keep for a reinstall (the default is everything) ---
#   1 keep everything   2 remove the profiles, keep the settings   3 remove everything
if [ -d "$FILES" ]; then
    keep=1
    if [ "$ALL" = 1 ]; then
        keep=3
    elif [ -n "$BUA" ]; then
        a="$(dialog --stdout --title "Amazon Luna" --menu "What should be kept for a later reinstall?" 0 0 0 \
            1 "Keep everything: everyone's Amazon sign-ins, profiles, PIN and settings" \
            2 "Remove the profiles (sign-ins, gamerpics and the PIN), keep the settings" \
            3 "Remove everything" 2>/dev/null | head -n1)"
        case "$a" in 2) keep=2 ;; 3) keep=3 ;; esac
    elif [ -t 0 ]; then
        echo
        say "What should be kept for a later reinstall?"
        echo "  1) Keep everything: everyone's Amazon sign-ins, profiles, PIN and settings"
        echo "  2) Remove the profiles (sign-ins, gamerpics and the PIN), keep the settings"
        echo "  3) Remove everything"
        read -r -p "Choose 1, 2 or 3 [1]: " a
        case "$a" in 2) keep=2 ;; 3) keep=3 ;; esac
    fi
    if [ "$keep" = 3 ]; then
        rm -rf "$FILES"
        say "Deleted $FILES (sign-ins, profiles, PIN and settings)."
    else
        # the package's own files go; what belongs to the people who play
        # stays (profile, profiles.json, profile-settings, profile-pics, pin,
        # config.json, picked-games.json and the small "seen it" files)
        ( cd "$FILES" 2>/dev/null && rm -rf app.asar app-source lib launchsingle runtime runtime.old runtime.next runtime.new \
            electron-* theme-backups ./*.sh ./*.py es_systems_luna.cfg gamelist.xml luna.png luna1.png \
            luna-icon.png luna-settings-icon.png luna-uninstall-icon.png luna-hippos.png luna-hippos-logo.sh hippos-theme-files.txt theme-art.stamp luna-theme-art.sh update-ref luna-apply-update.sh last-version luna-background.jpg luna-intro.mp4 luna-intro.webm luna-intro-frames.webp luna-intro-audio.ogg \
            README.txt added-to-list theme-installed.txt )
        if [ "$keep" = 2 ]; then
            # everyone's sign-in and profile go: the browser storage, the
            # profiles and their own settings, gamerpics, the PIN and the
            # "a child signed in" note
            ( cd "$FILES" 2>/dev/null && rm -rf profile profiles.json profile-settings profile-pics pin reset-pin \
                children-mode rating-cache.json pick-tip-due )
            cat > "$FILES/KEPT-FOR-REINSTALL.txt" <<'KEPT_EOF'
Amazon Luna was uninstalled. The profiles, everyone's Amazon sign-in
and the PIN were removed; the settings (config.json) were kept, so a
reinstall keeps your Settings choices. Everyone signs in again.

To remove the settings too, delete this whole folder:
    /userdata/system/add-ons/luna
KEPT_EOF
            say "Removed the profiles, sign-ins and PIN; kept the settings in $FILES."
        else
            cat > "$FILES/KEPT-FOR-REINSTALL.txt" <<'KEPT_EOF'
Amazon Luna was uninstalled, but these were kept so a reinstall
picks up where you left off: everyone's Amazon sign-in (profile), the
profiles (profiles.json, profile-settings, profile-pics), the PIN and
the settings (config.json).

To remove them too, delete this whole folder:
    /userdata/system/add-ons/luna
KEPT_EOF
            say "Kept the sign-ins, profiles, PIN and settings in $FILES, so a reinstall keeps them."
        fi
        say "(To remove what's left later, delete that folder.)"
    fi
fi

echo
say "Done. Amazon Luna has been removed."
# EmulationStation reloads its systems and games by itself (the same as Main
# Menu > Game settings > Update gamelists), so it leaves the carousel without a restart
if [ -n "$BUA" ]; then
    say "BUA reloads EmulationStation when it's done."
elif command -v curl >/dev/null 2>&1; then
    setsid bash -c "sleep 2; curl -s -m 10 http://127.0.0.1:1234/reloadgames" < /dev/null > /dev/null 2>&1 &
    say "EmulationStation updates its carousel in a moment."
else
    say "To see it gone from the carousel: Main Menu > Game settings > Update gamelists."
fi
finish 0
}
